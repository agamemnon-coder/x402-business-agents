// The record of a run on the passkey account (npm run owners -- record): docs/runs/<date>-faceid-onchain.json and a
// readable .md beside it. It is written from what the world's ledger holds, and from nothing else:
//   - the audit rows: the passkeys' enrolment, the account's creation and funding (owners.account_created, owners.tx_*),
//     each proposal and who approved it (proposal.*), each relay (owners.sent, owners.executed, owners.reverted), and the
//     agent's payments and Metal's refusals (owners.pay_started, owners.paid, owners.pay_not_paid,
//     owners.refused_on_chain, owners.over_cap_not_refused);
//   - the call log: every call the run made, by method and by step, against the budget;
//   - a proposal's stored terms (its digest, its deadline, what it binds), used only when they still hash to the
//     terms_sha256 its proposal.created row holds, so they too are what an audit row vouches for.
// It makes no call. Every time in it is an audit row's time; none is read from the clock. A step with no row is "not
// run". It says which passkey signed, by label and fingerprint; what kind of device holds a passkey it cannot know
// (attestation is none), so a device is recorded as the owner states it, and a passkey whose label marks a virtual test
// passkey is recorded as that whatever anyone states.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { verifyAuditChain } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { redactJson, redactSecrets } from "../lib/redact.js";
import { termsHash } from "../lib/terms.js";
import { CHAIN_ID, EXPLORER_TX } from "./network.js";
import { countByStep, readOwnersCalls, type OwnersCall } from "./ownersBudget.js";
import type { OwnersExecuteTerms } from "./ownersExecute.js";
import { loadVerifier } from "./verifierCompile.js";

/** Passkey labels that are virtual test passkeys by this repository's convention (src/ops/reliability.ts signerLabel). */
export const VIRTUAL_LABELS = {
  "test-controller": "virtual test passkey: Chromium's virtual authenticator driven by docs/runs/driver/test-controller.ts; not a person's device",
  "test-cfo": "virtual test passkey in the CFO role: a virtual authenticator driven by code, as this repository's dry runs use; not a person's device",
} as const;
const STATED = "as stated by the owner";
const NOT_STATED = "not stated";
export const DEVICE_NOTE = "Attestation is none, so the device type cannot be proven: a device description here is the owner's statement, not a finding of this record.";
/** What the record says when no label marks a virtual test passkey: that, and no more. The rows cannot show that no stand-in was used. */
export const NO_STAND_IN = "No passkey carries a virtual test label. What device holds each passkey is not proven (see The owners).";
const TITLE = "The passkey account on chain: run record";
/** The page's own words, each with its technical name once. */
const WORDS = "The terms hash is the SHA-256 of a proposal's terms (`terms_sha256`). The digest the passkeys sign is the account's own hash of the call, its sequence number and its deadline (its Execute digest). The runner relays an approved proposal as one call to the account that carries both signatures (`executeSigned`); the account checks them itself.";
export const CLI_NOTE = "A cli:<command> line is one whole run of the metal-agent CLI; the requests it makes inside are not counted.";

/** The command cannot write a record: something it needs is missing, or the target holds another world's record. Nothing was written. */
export class RecordRefused extends Error {
  constructor(message: string) { super(message); this.name = "RecordRefused"; }
}

export interface RecordInputs {
  /** OWNERS_CALL_BUDGET: the calls the owner agreed for this world. */
  budget: number;
  /** OWNERS_DEVICE_CFO and OWNERS_DEVICE_CONTROLLER: free text, recorded as stated. */
  devices?: { cfo?: string | undefined; controller?: string | undefined };
  /** The lines of the file OWNERS_DEVIATIONS names; null when no file was named. */
  deviations?: string[] | null;
  /** The environment, for redaction only: no value of it is recorded. */
  env?: Record<string, string | undefined>;
}

export interface RecordOwner {
  role: "CFO" | "second approver";
  label: string;
  fingerprint: string | null;
  enrolled_at: string | null;
  virtual: boolean;
  device: string;
  device_basis: typeof STATED | typeof NOT_STATED | "the passkey's label marks a virtual test passkey";
  /** Present when a device was stated for a virtual test passkey: the statement is not recorded. */
  stated_device_ignored?: string;
}

export type StepKind = "setup" | "proposal" | "approvals" | "relay" | "payment" | "refusal";
export interface RecordStep {
  kind: StepKind;
  step: string;
  outcome: string;
  at: string | null;
  tx: string | null;
  explorer: string | null;
  detail: string;
  proposal_id?: string;
  payment_id?: string;
  /** On a refusal: the later payment of the same amount, as an owners.paid row names this refusal. */
  paid_later?: { payment_id: string; tx: string | null; explorer: string | null; at: string; under_proposal: string; cap_then: string; cap_now: string };
  /** On a payment: the refusal it answers, as its own owners.paid row names it. */
  after_refusal?: { payment_id: string; tx: string | null; explorer: string | null; under_proposal: string; cap_then: string; cap_now: string };
}

export interface RecordApproval {
  by: string; role: RecordOwner["role"] | null; fingerprint: string | null;
  /** The passkey's label marks a virtual test passkey: it is named as one wherever this approval is. */
  virtual: boolean;
  at: string; of: string;
}
export interface RecordProposal {
  proposal_id: string;
  what: string | null;
  status: string;
  created_at: string;
  terms_sha256: string;
  onchain_digest: string | null;
  expires_at: string | null;
  mandate: string | null;
  cap: string | null;
  budget: string | null;
  /** A replace: the mandate it ends, and that mandate's cap and budget. */
  replaces?: string; was_cap?: string; was_budget?: string;
  approvals: RecordApproval[];
  /** Signatures the runner did not count, with its reason. */
  not_counted: { at: string; why: string }[];
  tx: string | null;
  explorer: string | null;
  note?: string;
}

/** A payment Metal refused and the same amount paid later, each from its own audit row, with the change of the cap between them. */
export interface RefusedThenPaid {
  amount: string;
  payee_name: string;
  refused: { at: string; tx: string | null; explorer: string | null; reason: string; cap: string; under_proposal: string };
  raised_by: { proposal_id: string; what: string; was_cap: string | null; cap: string; at: string; tx: string | null; explorer: string | null } | null;
  paid: { at: string; tx: string | null; explorer: string | null; cap: string; under_proposal: string };
}

export interface OwnersRecord {
  record: string;
  ran_at: string;
  last_row_at: string;
  dates_note: string;
  written_from: { audit_rows: number; call_log_lines: number; audit_log: { rows: number; head: string; chain: "verified" }; note: string };
  network: "Metal testnet";
  chain_id: number;
  money: string;
  stand_in: string | null;
  /** What stand_in does and does not say: it is read from the labels; the devices are not proven. */
  stand_in_note: string;
  verifier: string | null;
  verifier_artifact: { openzeppelin: string; compiler: string; evm: string; bytecode_sha256: string };
  verifier_note: string;
  account: string;
  threshold: number;
  owners: RecordOwner[];
  device_note: string;
  signing_note: string;
  steps: RecordStep[];
  refused_then_paid: RefusedThenPaid[];
  proposals: RecordProposal[];
  calls: { budget: number; used: number; left: number; by_method: Record<string, number>; by_step: { step: string; requests: number; cli_runs: number }[]; first_call_at: string | null; last_call_at: string | null; note: string };
  deviations: string[];
  deviations_note: string;
}

// ---- reading the rows ---------------------------------------------------------------------------------------------------

interface Row { seq: number; ts: string; event: string; subject: string | null; p: Record<string, unknown> }
const EVENTS = [
  "passkey.enrolment_opened", "passkey.enrolled",
  "owners.account_created", "owners.tx_sent", "owners.tx_unsent", "owners.tx_done",
  "proposal.created", "proposal.cosigned", "proposal.approved", "proposal.rejected", "proposal.expired", "proposal.executing", "proposal.executed", "proposal.failed", "proposal.needs_reapproval",
  "approval.too_late", "passkey.refused",
  "owners.sent", "owners.unsent", "owners.executed", "owners.reverted",
  "owners.pay_started", "owners.paid", "owners.pay_not_paid", "owners.refused_on_chain", "owners.over_cap_not_refused",
] as const;
const STATUS_OF: Record<string, string> = {
  "proposal.created": "PENDING_APPROVAL", "proposal.cosigned": "PENDING_APPROVAL", "proposal.approved": "APPROVED", "proposal.rejected": "REJECTED", "proposal.expired": "EXPIRED",
  "proposal.executing": "EXECUTING", "proposal.executed": "EXECUTED", "proposal.failed": "FAILED", "proposal.needs_reapproval": "NEEDS_REAPPROVAL",
};

const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
const isTx = (x: unknown): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
const link = (tx: string | null) => (tx ? `${EXPLORER_TX}${tx}` : null);
const isVirtual = (label: string) => Object.hasOwn(VIRTUAL_LABELS, label);
/** "test-controller (virtual test passkey 5117-…)", "max (passkey DD36-…)": a virtual test passkey is named as one wherever it is named. */
const passkeyName = (label: string, fingerprint: string | null) => (isVirtual(label) ? `${label} (virtual test passkey${fingerprint ? ` ${fingerprint}` : ""})` : `${label}${fingerprint ? ` (passkey ${fingerprint})` : ""}`);
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Free text for the record: no credential (the one redactor), no address of the relay or of anything else but the
 * explorer, one line, and no longer than `cap` characters.
 */
function cleaner(env: Record<string, string | undefined>): (text: string, cap: number) => string {
  const relayHost = (() => { try { return env.KIT11_RELAY_URL ? new URL(env.KIT11_RELAY_URL).host : null; } catch { return null; } })();
  return (text, cap) => {
    let t = redactSecrets(text, env as NodeJS.ProcessEnv);
    // Any address but the explorer's goes, whole (a path under the relay names a proposal's page); then the relay's bare name.
    t = t.replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, (url) => (url.startsWith(EXPLORER_TX) ? url : "[address removed]"));
    if (relayHost) t = t.split(relayHost).join("[relay address]");
    t = t.replace(/\b[a-z0-9][a-z0-9.-]*\.workers\.dev\b/gi, "[relay address]");
    // One line of printable text.
    // eslint-disable-next-line no-control-regex -- control characters are what is removed here
    t = t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
    return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
  };
}

const DEVICE_CAP = 120;
const LINE_CAP = 300;
const MAX_DEVIATIONS = 50;

/**
 * Builds the record from the ledger, the call log's lines and what the runner stated. Pure: it reads, it calls nothing
 * and writes nothing. Throws RecordRefused when the audit log does not verify or holds no passkey account.
 */
export function buildOwnersRecord(db: DB, calls: readonly OwnersCall[], inputs: RecordInputs): OwnersRecord {
  const clean = cleaner(inputs.env ?? {});
  const chain = verifyAuditChain(db);
  if (!chain.ok) throw new RecordRefused(`refused: this ledger's audit log does not verify (row ${chain.seq}: ${chain.reason}); a record is written from rows that do. Nothing was written.`);
  const all = (db.prepare(`SELECT seq, ts, event, subject, payload_json FROM audit_log WHERE event IN (${EVENTS.map(() => "?").join(", ")}) ORDER BY seq`).all(...EVENTS) as { seq: number; ts: string; event: string; subject: string | null; payload_json: string }[])
    .map((r): Row => ({ seq: r.seq, ts: r.ts, event: r.event, subject: r.subject, p: JSON.parse(r.payload_json) as Record<string, unknown> }));
  const used = new Set<number>();
  const use = <T extends Row | undefined>(r: T): T => { if (r) used.add(r.seq); return r; };
  const of = (event: string, subject?: string | null) => all.filter((r) => r.event === event && (subject === undefined || r.subject === subject));

  const created = use(of("owners.account_created").at(-1));
  if (!created) throw new RecordRefused("refused: this world's audit log holds no passkey account yet (npm run owners -- setup); there is nothing to record. Nothing was written.");
  const account = String(created.p.account);
  for (const r of of("owners.account_created")) use(r);

  // ---- the owners: the two passkeys the account was created for, from their enrolment rows --------------------------
  const labels = Array.isArray(created.p.owners) ? (created.p.owners as unknown[]).map(String) : [];
  const enrolments = labels.map((label) => {
    const row = use(of("passkey.enrolled").filter((r) => r.seq < created.seq && r.p.label === label).at(-1));
    const window = row ? use(of("passkey.enrolment_opened", String(row.p.window_id)).at(-1)) : undefined;
    return { label, row, added: Boolean(window?.p.adds) };
  });
  // Who is who: a virtual test label names its own role; of the others, the passkey this world added beside the first
  // is the second approver, and where that does not tell them apart, the one enrolled first is the CFO.
  const roles = new Map<string, RecordOwner["role"]>();
  for (const e of enrolments) if (e.label === "test-cfo") roles.set(e.label, "CFO"); else if (e.label === "test-controller") roles.set(e.label, "second approver");
  const rest = enrolments.filter((e) => !roles.has(e.label)).sort((x, y) => Number(x.added) - Number(y.added) || (x.row?.seq ?? Infinity) - (y.row?.seq ?? Infinity));
  for (const e of rest) roles.set(e.label, (["CFO", "second approver"] as const).find((r) => ![...roles.values()].includes(r)) ?? "second approver");
  const stated = (role: RecordOwner["role"]) => { const t = role === "CFO" ? inputs.devices?.cfo : inputs.devices?.controller; return t && t.trim() ? clean(t, DEVICE_CAP) : null; };
  const owners: RecordOwner[] = enrolments.map((e): RecordOwner => {
    const role = roles.get(e.label)!;
    const virtual = isVirtual(e.label) ? (VIRTUAL_LABELS as Record<string, string>)[e.label] : undefined;
    const text = stated(role);
    const base = { role, label: e.label, fingerprint: str(e.row?.p.fingerprint), enrolled_at: e.row?.ts ?? null };
    if (virtual) return { ...base, virtual: true, device: virtual, device_basis: "the passkey's label marks a virtual test passkey", ...(text ? { stated_device_ignored: "a device description was stated for this owner and is not recorded: the label marks a virtual test passkey" } : {}) };
    return { ...base, virtual: false, device: text ?? NOT_STATED, device_basis: text ? STATED : NOT_STATED };
  }).sort((x, y) => (x.role === y.role ? 0 : x.role === "CFO" ? -1 : 1));
  const byCredential = new Map(enrolments.flatMap((e) => (e.row?.subject ? [[e.row.subject, owners.find((o) => o.label === e.label)!] as const] : [])));
  const standIns = owners.filter((o) => o.virtual).map((o) => `the ${o.role} "${o.label}" is a ${o.device}${o.role === "CFO" ? "; no person's device signed as the CFO" : ""}`);

  // ---- steps, each from its own rows, kept with the first row's number so they can be put in the rows' order --------
  const steps: { order: number; step: RecordStep }[] = [];
  const add = (order: number, step: RecordStep) => { steps.push({ order, step }); };

  // The account's creation and funding: one step per transaction this world signed (owners.tx_sent), with how it ended.
  const journal = all.filter((r) => r.event === "owners.tx_sent" && (r.subject ?? "").startsWith("setup:"));
  const seenTx = new Set<string>();
  for (const sent of journal) {
    const tx = String(sent.p.tx);
    if (seenTx.has(tx.toLowerCase())) continue;
    seenTx.add(tx.toLowerCase());
    use(sent);
    const done = use(of("owners.tx_done", sent.subject).filter((r) => same(r.p.tx, tx)).at(-1));
    const unsent = use(of("owners.tx_unsent", sent.subject).filter((r) => same(r.p.tx, tx)).at(-1));
    const outcome = done ? (done.p.ok === true ? "done" : "reverted") : unsent ? "not sent" : "sent, no receipt recorded";
    const detail = done ? [typeof done.p.block === "number" ? `block ${done.p.block}` : "", str(done.p.gas_used) ? `${String(done.p.gas_used)} gas` : "", done.p.ok === true ? "" : clean(String(done.p.reason ?? "reverted on chain"), LINE_CAP)].filter(Boolean).join("; ")
      : unsent ? `it never left this machine: ${clean(String(unsent.p.why ?? ""), LINE_CAP)}` : "";
    add(sent.seq, { kind: "setup", step: clean(String(sent.p.what ?? sent.subject), LINE_CAP), outcome, at: (done ?? unsent ?? sent).ts, tx: isTx(tx) && !unsent ? tx : null, explorer: isTx(tx) && !unsent ? link(tx) : null, detail });
  }
  const journaled = (prefix: string) => journal.some((r) => (r.subject ?? "").startsWith(prefix));
  const notRun: RecordStep[] = [];
  const planned = (kind: StepKind, step: string, detail: string) => { notRun.push({ kind, step, outcome: "not run", at: null, tx: null, explorer: null, detail }); };
  if (!journaled("setup:create-account:")) planned("setup", "create the passkey account", "no creation transaction in this world's audit rows (the account's row holds none)");
  if (!journaled("setup:fund-account:")) planned("setup", "fund the passkey account", "no transfer to the account in this world's audit rows");

  // The proposals: each owners_execute this world filed, who approved it and when, and each relay of it.
  const proposals: RecordProposal[] = [];
  const executedAction = new Map<string, { row: Row; what: string; cap: string; was_cap: string | null }>();
  for (const filed of of("proposal.created").filter((r) => r.p.kind === "owners_execute")) {
    use(filed);
    const id = String(filed.subject);
    const mine = all.filter((r) => r.subject === id && r.seq >= filed.seq);
    for (const r of mine) if (r.event.startsWith("proposal.") || r.event.startsWith("owners.") || r.event === "approval.too_late" || r.event === "passkey.refused") use(r);
    const status = STATUS_OF[mine.filter((r) => r.event in STATUS_OF).at(-1)!.event]!;
    // The stored terms count only while they hash to what the audit row holds.
    const stored = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string } | undefined;
    let t: OwnersExecuteTerms | null = null;
    try { const parsed = stored ? (JSON.parse(stored.terms_json) as OwnersExecuteTerms) : null; if (parsed && termsHash(parsed) === filed.p.terms_sha256) t = parsed; } catch { /* recorded as unreadable below */ }
    const a = t?.action;
    // A limit a replace leaves as it was is said to be unchanged; a revoke's limits are what ends, not what is granted.
    const change = (name: string, was: string | undefined, now: string) => (was === now ? `${name} ${now} (unchanged)` : `${name} ${was} → ${now}`);
    const words = !a ? "a proposal whose stored terms do not hash to the terms hash in its audit row"
      : a.what === "replace" ? `replace the ${a.agent} mandate: ${change("cap", a.was_cap, a.cap)}, ${change("budget", a.was_budget, a.budget)}, ${a.payee_name} only`
        : a.what === "revoke" ? `revoke the ${a.agent} mandate: it ends the mandate that allowed up to ${a.cap} a payment, ${a.budget} in all, ${a.payee_name} only`
          : `${a.what} the ${a.agent} mandate: up to ${a.cap} a payment, ${a.budget} in all, ${a.payee_name} only`;
    add(filed.seq, { kind: "proposal", step: `propose ${id}: ${clean(words, LINE_CAP)}`, outcome: "filed", at: filed.ts, tx: null, explorer: null, proposal_id: id,
      detail: t ? `terms hash ${String(filed.p.terms_sha256)}; the digest the passkeys sign ${t.onchain_digest}; to be signed by ${t.expires_at}` : `terms hash ${String(filed.p.terms_sha256)}; no digest is recorded` });

    const approvals: RecordApproval[] = [];
    const signed = mine.filter((r) => r.event === "proposal.cosigned" || r.event === "proposal.approved");
    for (const r of signed) {
      const credential = str((r.p.passkey as { credential_id?: unknown } | undefined)?.credential_id);
      const owner = credential ? byCredential.get(credential) : undefined;
      // The approved row names both approvers; the one who signed last is its passkey.
      const by = owner?.label ?? clean(String(r.event === "proposal.cosigned" ? r.p.person ?? r.p.approver : String(r.p.approver).split(" + ").at(-1)), 80);
      approvals.push({ by, role: owner?.role ?? null, fingerprint: owner?.fingerprint ?? null, virtual: owner?.virtual ?? isVirtual(by), at: r.ts, of: r.event === "proposal.cosigned" ? String(r.p.of ?? "1 of 2") : `${approvals.length + 1} of ${approvals.length + 1}` });
    }
    const signerOf = (r: Row) => byCredential.get(str((r.p.passkey as { credential_id?: unknown } | undefined)?.credential_id) ?? "")?.label;
    const notCounted = mine.filter((r) => r.event === "approval.too_late" || r.event === "passkey.refused").map((r) => ({ at: r.ts, why: r.event === "approval.too_late"
      ? `a signature${signerOf(r) ? ` by ${passkeyName(signerOf(r)!, null)}` : ""} arrived after the terms ran out (${String(r.p.expires_at)}) and was not counted` : clean(String(r.p.reason ?? "refused"), LINE_CAP) }));
    const ended = mine.find((r) => r.event === "proposal.expired" || r.event === "proposal.rejected");
    add(signed[0]?.seq ?? filed.seq + 0.1, { kind: "approvals", step: `the owners sign ${id}`, proposal_id: id, at: signed.at(-1)?.ts ?? ended?.ts ?? null, tx: null, explorer: null,
      outcome: approvals.length ? `${approvals.length} of 2 approvals` : ended ? (ended.event === "proposal.expired" ? "expired: no approval counted" : "rejected") : "no approval recorded",
      detail: [...approvals.map((x) => `${passkeyName(x.by, x.fingerprint)} at ${x.at}`), ...notCounted.map((x) => `not counted at ${x.at}: ${x.why}`)].join("; ") });

    // Each transaction the runner signed for it (owners.sent), with how it ended.
    const sends = mine.filter((r) => r.event === "owners.sent");
    let ranTx: string | null = null;
    for (const sent of sends) {
      const tx = String(sent.p.tx);
      const executed = mine.find((r) => r.event === "owners.executed" && same(r.p.tx, tx));
      const reverted = mine.find((r) => r.event === "owners.reverted" && same(r.p.tx, tx));
      const unsent = mine.find((r) => r.event === "owners.unsent" && same(r.p.tx, tx));
      if (executed) ranTx = tx;
      add(sent.seq, { kind: "relay", step: `the runner relays ${id} to the account`, proposal_id: id, at: (executed ?? reverted ?? unsent ?? sent).ts, tx: unsent ? null : tx, explorer: unsent ? null : link(tx),
        outcome: executed ? "executed" : reverted ? "reverted" : unsent ? "not sent" : "sent, no receipt recorded",
        detail: executed ? `the account ran it: ${a ? `${a.what} the ${a.agent} mandate` : "the call in its terms"}` : reverted ? `the account's reason: ${clean(String(reverted.p.reason ?? ""), LINE_CAP)}` : unsent ? `it never left this machine: ${clean(String(unsent.p.why ?? ""), LINE_CAP)}` : "" });
      if (executed) {
        const action = executed.p.action as { what?: unknown; cap?: unknown; was_cap?: unknown } | undefined;
        executedAction.set(id, { row: executed, what: String(action?.what ?? ""), cap: String(action?.cap ?? ""), was_cap: str(action?.was_cap) });
      }
    }
    if (!sends.length) {
      const failed = mine.filter((r) => r.event === "proposal.failed").at(-1);
      add(failed?.seq ?? (signed.at(-1)?.seq ?? filed.seq) + 0.2, { kind: "relay", step: `the runner relays ${id} to the account`, proposal_id: id, at: failed?.ts ?? null, tx: null, explorer: null,
        outcome: failed ? "failed, nothing sent" : "not run", detail: failed ? clean(String(failed.p.error ?? ""), LINE_CAP) : "no transaction for it in this world's audit rows" });
    }
    proposals.push({
      proposal_id: id, what: a?.what ?? null, status, created_at: filed.ts, terms_sha256: String(filed.p.terms_sha256), onchain_digest: t?.onchain_digest ?? null, expires_at: t?.expires_at ?? null,
      mandate: a?.mandate ?? null, cap: a?.cap ?? null, budget: a?.budget ?? null,
      ...(a?.what === "replace" && a.replaces && a.was_cap && a.was_budget ? { replaces: a.replaces, was_cap: a.was_cap, was_budget: a.was_budget } : {}),
      approvals, not_counted: notCounted, tx: ranTx, explorer: link(ranTx),
      ...(t ? {} : { note: "the stored terms do not hash to the terms hash in the audit row: nothing of them is recorded" }),
    });
  }
  for (const what of ["bind", "replace", "revoke"]) {
    if (!proposals.some((p) => p.what === what)) planned("proposal", `${what} the mandate: a proposal, both owners' approvals, and the account's call`, `no ${what} proposal in this world's audit rows`);
  }

  // The agent's payments and Metal's refusals, by payment id.
  const payEvents = ["owners.pay_started", "owners.paid", "owners.pay_not_paid", "owners.refused_on_chain", "owners.over_cap_not_refused"];
  const payRows = all.filter((r) => payEvents.includes(r.event));
  const refusedThenPaid: RefusedThenPaid[] = [];
  let [anyInside, anyRefusal, anyAfter] = [false, false, false];
  for (const id of [...new Set(payRows.map((r) => String(r.subject)))]) {
    const mine = payRows.filter((r) => r.subject === id);
    for (const r of mine) use(r);
    const first = mine[0]!;
    const paid = mine.find((r) => r.event === "owners.paid");
    const refused = mine.find((r) => r.event === "owners.refused_on_chain");
    const notRefused = mine.find((r) => r.event === "owners.over_cap_not_refused");
    const notPaid = mine.filter((r) => r.event === "owners.pay_not_paid").at(-1);
    const any = paid ?? refused ?? notRefused ?? notPaid ?? first;
    const [amount, payee] = [String(any.p.amount ?? first.p.amount), clean(String(any.p.payee_name ?? first.p.payee_name ?? "the payee"), 80)];
    const under = String(any.p.proposal_id ?? first.p.proposal_id ?? "");
    if (refused || notRefused || first.p.kind === "one cent over the cap") {
      anyRefusal = true;
      const cap = String((refused ?? notRefused)?.p.cap ?? "");
      // The later payment of this amount, when an owners.paid row names this refusal as the one it answers.
      const later = payRows.find((r) => r.event === "owners.paid" && (r.p.after_refusal as { payment_id?: unknown } | undefined)?.payment_id === id);
      const laterLink = later ? later.p.after_refusal as { cap_then?: unknown; cap_now?: unknown } : null;
      const tx = refused && isTx(refused.p.tx) ? refused.p.tx : null;
      add(first.seq, { kind: "refusal", step: `${amount} to ${payee}, over the mandate's ${cap || "per-payment"} cap`, payment_id: id, ...(under ? { proposal_id: under } : {}), at: (refused ?? notRefused ?? first).ts, tx, explorer: link(tx),
        outcome: refused ? "refused on chain" : notRefused ? "NOT refused: a person checks it" : "started, no outcome recorded",
        detail: refused ? `Metal's reason: ${clean(String(refused.p.reason ?? ""), LINE_CAP)}${refused.p.read_from ? `; read from ${clean(String(refused.p.read_from), 120)}` : ""}` : notRefused ? clean(String(notRefused.p.error ?? ""), LINE_CAP) : "",
        ...(later ? { paid_later: { payment_id: String(later.subject), tx: isTx(later.p.tx) ? later.p.tx : null, explorer: link(isTx(later.p.tx) ? later.p.tx : null), at: later.ts, under_proposal: String(later.p.proposal_id), cap_then: String(laterLink!.cap_then), cap_now: String(laterLink!.cap_now) } } : {}) });
      if (refused && later) {
        const raised = executedAction.get(String(later.p.proposal_id));
        const laterTx = isTx(later.p.tx) ? later.p.tx : null;
        const raisedTx = raised && isTx(raised.row.p.tx) ? raised.row.p.tx : null;
        refusedThenPaid.push({
          amount, payee_name: payee,
          refused: { at: refused.ts, tx, explorer: link(tx), reason: clean(String(refused.p.reason ?? ""), LINE_CAP), cap: String(laterLink!.cap_then), under_proposal: under },
          raised_by: raised ? { proposal_id: String(later.p.proposal_id), what: raised.what, was_cap: raised.was_cap, cap: raised.cap, at: raised.row.ts, tx: raisedTx, explorer: link(raisedTx) } : null,
          paid: { at: later.ts, tx: laterTx, explorer: link(laterTx), cap: String(laterLink!.cap_now), under_proposal: String(later.p.proposal_id) },
        });
      }
    } else {
      const after = paid?.p.after_refusal as { payment_id?: unknown; tx?: unknown; proposal_id?: unknown; cap_then?: unknown; cap_now?: unknown } | undefined;
      const answers = after ?? (first.p.refused as { payment_id?: unknown } | undefined);
      if (answers) anyAfter = true; else anyInside = true;
      const tx = paid && isTx(paid.p.tx) ? paid.p.tx : notPaid && isTx(notPaid.p.tx) ? notPaid.p.tx : null;
      add(first.seq, { kind: "payment", payment_id: id, ...(under ? { proposal_id: under } : {}), at: (paid ?? notPaid ?? first).ts, tx, explorer: link(tx),
        step: answers ? `the Sourcing agent pays ${amount} to ${payee}: the amount Metal refused before, under the mandate ${under} bound` : `the Sourcing agent pays ${amount} to ${payee} inside the mandate`,
        outcome: paid ? "paid" : notPaid ? "not paid" : "started, no outcome recorded",
        detail: paid ? clean(String(paid.p.signed_by ?? ""), LINE_CAP) : notPaid ? clean(`${String(notPaid.p.outcome ?? "").toLowerCase()}${notPaid.p.reason ? `: ${String(notPaid.p.reason)}` : ""}`, LINE_CAP) : "",
        ...(after && typeof after.payment_id === "string" ? { after_refusal: { payment_id: after.payment_id, tx: isTx(after.tx) ? after.tx : null, explorer: link(isTx(after.tx) ? after.tx : null), under_proposal: String(after.proposal_id), cap_then: String(after.cap_then), cap_now: String(after.cap_now) } } : {}) });
    }
  }
  if (!anyInside) planned("payment", "the Sourcing agent pays inside the mandate", "no payment in this world's audit rows");
  if (!anyRefusal) planned("refusal", "a payment over the mandate's cap, refused on chain", "no attempt over the cap in this world's audit rows");
  if (!anyAfter) planned("payment", "the refused amount, paid after the owners raised the cap", "no such payment in this world's audit rows");

  // ---- the calls, from the log ------------------------------------------------------------------------------------------
  const methods = new Map<string, number>();
  for (const c of calls) methods.set(c.method, (methods.get(c.method) ?? 0) + 1);
  const by_method = Object.fromEntries([...methods.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])));

  // ---- what the runner stated ---------------------------------------------------------------------------------------------
  const lines = (inputs.deviations ?? []).map((l) => clean(l, LINE_CAP)).filter(Boolean);
  const deviations = lines.length > MAX_DEVIATIONS ? [...lines.slice(0, MAX_DEVIATIONS), `(${lines.length - MAX_DEVIATIONS} more lines of the file are not recorded)`] : lines;

  const verifier = loadVerifier();
  const usedRows = all.filter((r) => used.has(r.seq));
  const ownersRows = usedRows.filter((r) => r.event.startsWith("owners."));
  const record: OwnersRecord = {
    // The title says so when a passkey's label marks a virtual test passkey; what the others are it does not say.
    record: standIns.length ? `${TITLE} (with ${standIns.length > 1 ? "virtual test passkeys" : "a virtual test passkey"})` : TITLE,
    ran_at: (ownersRows[0] ?? created).ts,
    last_row_at: usedRows.at(-1)!.ts,
    dates_note: "The run's start is the time of this world's first audit row about the account. Every time in this record is the time of an audit row (UTC); none is read from the clock.",
    written_from: {
      audit_rows: usedRows.length, call_log_lines: calls.length, audit_log: { rows: chain.rows, head: chain.head, chain: "verified" },
      note: "Written from the ledger's audit rows and the call log; no call was made to write it. A proposal's digest, deadline and limits are read from its stored terms, which hash to the terms hash in its audit row (terms_sha256). A step with no row is recorded as not run.",
    },
    network: "Metal testnet", chain_id: CHAIN_ID, money: "amounts are in test USD (the testnet's token USDZ): test money, nothing here has real value",
    stand_in: standIns.length ? standIns.join("; ") : null,
    stand_in_note: standIns.length ? "Read from the passkeys' labels. What device holds any other passkey is not proven (see The owners)." : NO_STAND_IN,
    verifier: str(created.p.verifier),
    verifier_artifact: { openzeppelin: verifier.openzeppelin, compiler: verifier.compiler, evm: verifier.evmVersion, bytecode_sha256: verifier.bytecode_sha256 },
    verifier_note: "The artifact is the one this repository compiles from OpenZeppelin's source (contracts/ERC7913WebAuthnVerifier.json), deployed on 1 November (docs/runs/passkey-owners.json). This run did not deploy it or compare the deployed code with it.",
    account, threshold: Number(created.p.threshold),
    owners, device_note: DEVICE_NOTE,
    signing_note: "The rows show which enrolled passkey signed each approval, by its credential, and when. They do not show what kind of device holds a passkey.",
    steps: [...steps.sort((x, y) => x.order - y.order).map((s) => s.step), ...notRun],
    refused_then_paid: refusedThenPaid,
    proposals,
    calls: {
      budget: inputs.budget, used: calls.length, left: Math.max(0, inputs.budget - calls.length), by_method, by_step: countByStep(calls),
      first_call_at: str(calls[0]?.at), last_call_at: str(calls.at(-1)?.at), note: CLI_NOTE,
    },
    deviations,
    deviations_note: inputs.deviations === null || inputs.deviations === undefined
      ? "No deviations file was given (OWNERS_DEVIATIONS): none are stated here, which is not the same as none happened."
      : "As the runner wrote them in a text file, one a line; code did not check them.",
  };
  // Once more over every string: no credential leaves in a record.
  return redactJson(record, (inputs.env ?? {}) as NodeJS.ProcessEnv);
}

// ---- the readable page ------------------------------------------------------------------------------------------------

/** Text inside a Markdown table cell or line: nothing in it is read as markup. */
const md = (text: string) => text.replace(/([\\`*_[\]<>|])/g, "\\$1");
const tx = (hash: string | null, explorer: string | null) => (hash && explorer ? `[\`${hash.slice(0, 10)}…${hash.slice(-6)}\`](${explorer})` : "");

export function renderOwnersRecord(r: OwnersRecord): string {
  const out: string[] = [];
  const p = (...lines: string[]) => { out.push(...lines, ""); };
  p(`# ${r.record}`);
  p(`${r.network} (chain ${r.chain_id}); ${r.money}. It started ${r.ran_at}; its last audit row is from ${r.last_row_at}.`,
    `Written from ${r.written_from.audit_rows} audit rows and ${r.written_from.call_log_lines} call-log lines; no call was made to write it. The audit log's hash chain verifies (${r.written_from.audit_log.rows} rows, head \`${r.written_from.audit_log.head.slice(0, 16)}…\`). ${r.dates_note}`);
  p(r.stand_in ? `**Stand-in:** ${md(r.stand_in)}.` : `**Stand-in:** ${NO_STAND_IN.charAt(0).toLowerCase()}${NO_STAND_IN.slice(1)}`);
  p("## The account");
  p(`- Account \`${r.account}\`: ${r.owners.length} owners, threshold ${r.threshold}.`,
    `- WebAuthn verifier \`${r.verifier ?? "not in the account's row"}\`: OpenZeppelin ${r.verifier_artifact.openzeppelin}, ${r.verifier_artifact.compiler}, EVM ${r.verifier_artifact.evm}, bytecode sha256 \`${r.verifier_artifact.bytecode_sha256}\`. ${r.verifier_note}`);
  p("## The owners");
  p("| Role | Passkey label | Fingerprint | Enrolled | Device |", "| --- | --- | --- | --- | --- |",
    ...r.owners.map((o) => `| ${o.role} | ${md(o.label)} | ${o.fingerprint ?? "not in the enrolment row"} | ${o.enrolled_at ?? "no enrolment row"} | ${md(o.device)}${o.device_basis === STATED ? ` (${STATED})` : ""}${o.stated_device_ignored ? `; ${o.stated_device_ignored}` : ""} |`));
  p(`${r.device_note} ${r.signing_note}`);
  p("## The steps, in the order of the audit rows");
  p(WORDS);
  p("| # | When (UTC) | Step | Outcome | Transaction |", "| --- | --- | --- | --- | --- |",
    ...r.steps.map((s, i) => `| ${i + 1} | ${s.at ?? ""} | ${md(s.step)}${s.detail ? `<br>${md(s.detail)}` : ""} | ${s.outcome === "not run" ? "not run" : `**${md(s.outcome)}**`} | ${tx(s.tx, s.explorer)} |`));
  if (r.refused_then_paid.length) {
    p("## Refused, then paid");
    for (const x of r.refused_then_paid) {
      p(`${x.amount} to ${md(x.payee_name)}:`,
        `1. ${x.refused.at}: refused on chain under the ${x.refused.cap} cap of ${x.refused.under_proposal} (${md(x.refused.reason)}) ${tx(x.refused.tx, x.refused.explorer)}`,
        x.raised_by ? `2. ${x.raised_by.at}: both owners signed ${x.raised_by.proposal_id}, and the account ran it: ${md(x.raised_by.what)}, cap ${x.raised_by.was_cap ? `${x.raised_by.was_cap} → ` : ""}${x.raised_by.cap} ${tx(x.raised_by.tx, x.raised_by.explorer)}` : "2. no row shows the call that raised the cap",
        `3. ${x.paid.at}: paid under the ${x.paid.cap} cap of ${x.paid.under_proposal} ${tx(x.paid.tx, x.paid.explorer)}`);
    }
  }
  p("## The proposals");
  for (const q of r.proposals) {
    p(`### ${q.proposal_id}: ${q.what ?? "terms not recorded"} (${q.status})`);
    p(`- filed ${q.created_at}${q.expires_at ? `; to be signed by ${q.expires_at}` : ""}`,
      `- terms hash \`${q.terms_sha256}\``,
      `- the digest the passkeys sign ${q.onchain_digest ? `\`${q.onchain_digest}\`` : "not recorded"}`,
      ...(q.cap && q.budget ? [`- ${q.what === "revoke" ? "ends the mandate that allowed " : ""}up to ${q.cap} a payment, ${q.budget} in all${q.was_cap && q.was_budget ? ` (before: ${q.was_cap} a payment, ${q.was_budget} in all)` : ""}`] : []),
      ...(q.approvals.length ? q.approvals.map((x) => `- approval ${x.of}: ${md(x.by)}${x.virtual ? " (virtual test passkey)" : ""}${x.role ? `, the ${x.role}` : ""}${x.fingerprint ? `, passkey ${x.fingerprint}` : ""}, at ${x.at}`) : ["- no approval recorded"]),
      ...q.not_counted.map((x) => `- not counted at ${x.at}: ${md(x.why)}`),
      ...(q.tx ? [`- run by the account in ${tx(q.tx, q.explorer)}`] : []),
      ...(q.note ? [`- ${q.note}`] : []));
  }
  p("## Calls");
  p(`${r.calls.used} of the ${r.calls.budget} calls agreed were used (${r.calls.left} left). ${r.calls.note}`);
  p("| Method | Lines |", "| --- | --- |", ...Object.entries(r.calls.by_method).map(([m, n]) => `| \`${m.replace(/[`|]/g, "")}\` | ${n} |`));
  p("| Step | Requests | CLI runs |", "| --- | --- | --- |", ...r.calls.by_step.map((s) => `| ${md(s.step)} | ${s.requests} | ${s.cli_runs} |`));
  p("## Deviations");
  p(...(r.deviations.length ? r.deviations.map((d) => `- ${md(d)}`) : ["- none stated"]), "", r.deviations_note);
  return `${out.join("\n").trimEnd()}\n`;
}

// ---- writing it ---------------------------------------------------------------------------------------------------------

/**
 * Writes the record as <date>-faceid-onchain.json and .md into `dir`; the date is the record's own (its first owners
 * row). A file already there is rewritten only when it is this same account's record: another world's is never
 * overwritten.
 */
export function writeOwnersRecord(r: OwnersRecord, dir: string): { json: string; md: string } {
  const base = join(dir, `${r.ran_at.slice(0, 10)}-faceid-onchain`);
  const [json, page] = [`${base}.json`, `${base}.md`];
  if (existsSync(json)) {
    let there: { account?: unknown };
    try { there = JSON.parse(readFileSync(json, "utf8")) as { account?: unknown }; } catch { throw new RecordRefused(`refused: ${json} is there and cannot be read as a record; it is not overwritten. Nothing was written.`); }
    if (!same(there.account, r.account)) throw new RecordRefused(`refused: ${json} is the record of another world (account ${String(there.account)}), and this world's account is ${r.account}; it is not overwritten. Nothing was written.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(json, `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(page, renderOwnersRecord(r));
  return { json, md: page };
}

const REPO = resolve(import.meta.dirname, "../..");

/** What `record` needs from the environment; empty when it may run. It makes no call, so it needs no go and no endpoint. */
export function recordRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (!/^\d+$/.test(env.OWNERS_CALL_BUDGET ?? "")) why.push("OWNERS_CALL_BUDGET (a whole number: the calls the owner agreed for this world; the record states the calls used against it)");
  if (!env.OWNERS_CALL_LOG) why.push("OWNERS_CALL_LOG (the world's call log: the record counts the calls from it)");
  else if (!existsSync(env.OWNERS_CALL_LOG)) why.push("OWNERS_CALL_LOG names a file that is not there (a record of a run that called Metal needs its call log)");
  if (env.OWNERS_DEVIATIONS && !existsSync(env.OWNERS_DEVIATIONS)) why.push("OWNERS_DEVIATIONS names a file that is not there (leave it unset when there is none)");
  return why;
}

/**
 * The command: reads the environment's settings, builds the record from the ledger and the call log, writes it, and
 * says so. `dir` is where it is written (the repository's docs/runs unless OWNERS_RECORD_DIR names another folder).
 */
export function recordRun(db: DB, env: Record<string, string | undefined>, say: (line: string) => void, dir: string = env.OWNERS_RECORD_DIR ?? join(REPO, "docs/runs")): { record: OwnersRecord; json: string; md: string } {
  const missing = recordRefusals(env);
  if (missing.length) throw new RecordRefused(`refused: the record needs ${missing.join("; ")}. Nothing was written, and nothing was called.`);
  const calls = readOwnersCalls(env.OWNERS_CALL_LOG!);
  const record = buildOwnersRecord(db, calls, {
    budget: Number(env.OWNERS_CALL_BUDGET), env,
    devices: { cfo: env.OWNERS_DEVICE_CFO, controller: env.OWNERS_DEVICE_CONTROLLER },
    deviations: env.OWNERS_DEVIATIONS ? readFileSync(env.OWNERS_DEVIATIONS, "utf8").split("\n").filter((l) => l.trim()) : null,
  });
  const written = writeOwnersRecord(record, dir);
  const shown = (path: string) => { const rel = relative(process.cwd(), path); return rel.startsWith("..") ? path : rel; };
  say(`ACCOUNT          ${record.account}: ${record.owners.map((o) => `${o.role} ${passkeyName(o.label, o.fingerprint)}`).join(", ")}; threshold ${record.threshold}`);
  if (record.stand_in) say(`STAND-IN         ${record.stand_in}`);
  for (const s of record.steps) say(`${s.outcome === "not run" ? "not run " : "step    "}         ${s.step}${s.outcome === "not run" ? "" : `: ${s.outcome}`}`);
  say(`CALLS            ${record.calls.used} of ${record.calls.budget} used in this world, as the call log holds them`);
  say(`RECORD           ${shown(written.json)} and ${shown(written.md)} written from ${record.written_from.audit_rows} audit rows and ${record.written_from.call_log_lines} call-log lines; no call was made`);
  return { record, ...written };
}
