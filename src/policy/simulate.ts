// The policy simulator: "what would have happened?" Before the CFO signs a policy change, Purser replays the period's
// supplier payments (invoice and supplier payments, the kinds an agent may ever pay alone) under the policy in force and
// under the proposed one, and says per payment what each would have decided: paid alone by the agent, sent to the CFO,
// or refused. It re-runs Purser's own decision code, not a copy of it:
//   refused   the executors' policy holds (src/executors/supplierPayment.ts holdReason): the emergency stop, the treasury
//             agent stopped or paused, a blocked payee (counterparty:<name>), the paying legal entity not open to the
//             agent (pay_from.<entity>.treasury, src/policy/entities.ts);
//   the CFO   what approveWithinLimit (src/policy/approvals.ts) checks before code approves a payment alone: the limit to
//             pay alone (aloneDecision, src/policy/withinLimit.ts, integer cents), four eyes (fourEyes), the second key
//             (secondKey.ts) and the anomaly hold (anomaly.ts), each over the payee's paid history as it stood when the
//             payment was filed;
//   alone     none of those.
// What is not policy is taken from the record and kept as it was: a payment filed outside the payables inbox is never paid
// alone (only src/ap/pay.ts payAlone approves alone), nor one an agent, the cash check or a task mandate declined
// (ap.alone_declined), nor one whose invoice carries a finding code sends to the CFO. The simulator cannot know what the
// Checker and Payer agents would have said of a payment that went straight to the CFO because it was above the limit;
// it assumes they would have agreed with code, and the docs say so (docs/governance.md).
//
// Read-only and deterministic: it runs SELECTs only, writes nothing (no audit row, no setting, no proposal), calls no rail
// and no model; the same ledger and arguments give the same answer (test/policy-simulate.test.ts checks the ledger is
// byte-identical after a run). Its summary is shown beside a policy change (the runner's dashboard, the phone, the CLI);
// it is never part of the signed terms: the passkey signs the change exactly as before.

import type { DB } from "../db/open.js";
import { aloneLimitInForce } from "./aloneLimit.js";
import { anomalyReasonsFrom, anomalyThresholdsFrom } from "./anomaly.js";
import { entityOf, listEntities, mayPayFrom, payFromKey } from "./entities.js";
import { fourEyes } from "./fourEyes.js";
import { policyValue } from "./rules.js";
import { paidBefore, paymentSecondKeyReasons, type Paid, type PaymentTerms } from "./secondKey.js";
import { ALONE_KINDS, POLICY_METHOD } from "./signedApproval.js";
import { aloneDecision } from "./withinLimit.js";

export type SimOutcome = "alone" | "cfo" | "refused";
/** How a payment's decision moves under the proposed policy: the four counts. */
export type SimChange = "needs_cfo" | "paid_alone" | "refused" | "unchanged";

export interface SimDecision { outcome: SimOutcome; why: string }

export interface SimulatedPayment {
  proposal_id: string;
  kind: string;
  created_at: string;
  payee: string;
  amount: string;
  currency: string;
  /** The proposal's status now (EXECUTED, PENDING_APPROVAL, …). */
  status: string;
  /** How it was actually decided: approved by code within the limit (alone), or anything else (the CFO). */
  recorded: "alone" | "cfo";
  /** Purser's decision under the policy in force now, and under the proposed one. */
  before: SimDecision;
  after: SimDecision;
  change: SimChange;
}

export interface PolicySimulation {
  /** The first day replayed (YYYY-MM-DD, UTC) and the moment the period ends. */
  since: string;
  until: string;
  changes: { key: string; from: string; to: string }[];
  payments: SimulatedPayment[];
  counts: Record<SimChange, number>;
  /** One line: "If this had been in force since 2026-11-01: 1 payment would have …". */
  summary: string;
}

/** The period replayed when none is given. */
export const SIMULATION_DAYS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Finding codes on an invoice that send it to the CFO whatever the limit (src/ap/checkerCore.ts codeRequires, src/ap/pay.ts payAlone). */
const CFO_FINDINGS = new Set(["instructions_in_document", "possible_split", "text_not_read", "unusual_amount"]);
/** Who declined to pay alone for a reason that is not the CFO policy (src/ap/pay.ts AloneDeclined); "limit" and "anomaly" are replayed. */
const FIXED_DECLINES: Record<string, string> = {
  code: "code's checks of the invoice", checker: "the Checker agent", payer: "the Payer agent", cash: "the cash check", mandate: "a task mandate", token: "a task token",
};

type Lookup = (key: string) => string;
interface Policy {
  value: Lookup;
  /** The limit to pay alone: the one in force (signed by the CFO, or a labelled default), or the proposed one. */
  limit: { currency: string; amount: string } | null;
  /** Whether the treasury agent may pay from this entity. */
  mayPayFrom(entity: string): boolean;
}

interface Row { proposal_id: string; kind: string; terms_json: string; status: string; created_at: string }
interface Facts {
  terms: PaymentTerms & { beneficiary_name?: string; paying_entity?: { id?: unknown } | null; funding_account?: { id?: unknown } | null };
  /** Executed payments before this one was filed (oldest first), for the anomaly hold and the second key. */
  history: Paid[];
  /** Why Purser would never pay it alone, from the record (not the policy); null when nothing stops it. */
  fixed: string | null;
}

/**
 * Replays the period's supplier payments under the policy in force and under it with `changes` applied (each key set to
 * `to`; "" removes an optional limit). `since`: the first day, YYYY-MM-DD (default: 30 days before `now`). Writes
 * nothing; see the header.
 */
export function simulatePolicyChange(db: DB, changes: { key: string; to: string }[], o: { since?: string; now?: Date } = {}): PolicySimulation {
  const now = o.now ?? new Date();
  const since = o.since ?? new Date(now.getTime() - SIMULATION_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!DAY.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`))) throw new Error(`since is a day like 2026-11-01 (YYYY-MM-DD), not ${JSON.stringify(since)}`);
  const proposed = new Map<string, string>();
  for (const c of changes) {
    if (proposed.has(c.key)) throw new Error(`${c.key} is changed twice`);
    proposed.set(c.key, c.to);
  }
  const current: Policy = {
    value: (key) => policyValue(db, key),
    limit: aloneLimitInForce(db),
    mayPayFrom: (entity) => mayPayFrom(db, "treasury", entity),
  };
  const next: Policy = {
    value: (key) => (proposed.has(key) ? proposed.get(key)! : current.value(key)),
    // The proposed limit counts as signed: the CFO's passkey is what this change asks for.
    limit: proposed.has("ap.alone_eur") ? (proposed.get("ap.alone_eur") ? { currency: "EUR", amount: proposed.get("ap.alone_eur")! } : null) : current.limit,
    mayPayFrom: (entity) => {
      const key = payFromKey(entity, "treasury");
      return proposed.has(key) ? proposed.get(key) === "allowed" : current.mayPayFrom(entity);
    },
  };

  const kinds = [...ALONE_KINDS];
  const rows = db.prepare(`SELECT proposal_id, kind, terms_json, status, created_at FROM proposals WHERE kind IN (${kinds.map(() => "?").join(", ")}) AND created_at >= ? AND created_at <= ? ORDER BY created_at, proposal_id`)
    .all(...kinds, `${since}T00:00:00.000Z`, now.toISOString()) as Row[];
  const paid = paidBefore(db);
  const recordedAlone = new Set((db.prepare("SELECT proposal_id FROM approvals WHERE decision = 'APPROVED' AND method = ?").all(POLICY_METHOD) as { proposal_id: string }[]).map((r) => r.proposal_id));

  const payments = rows.flatMap((p): SimulatedPayment[] => {
    let terms: Facts["terms"];
    try { terms = JSON.parse(p.terms_json) as Facts["terms"]; } catch { return []; }
    const facts: Facts = { terms, history: paid.filter((x) => x.first_at < p.created_at), fixed: fixedReason(db, p.proposal_id) };
    const before = decide(db, p, facts, current);
    const after = decide(db, p, facts, next);
    return [{
      proposal_id: p.proposal_id, kind: p.kind, created_at: p.created_at, payee: String(terms.beneficiary_name ?? terms.vendor ?? ""),
      amount: String(terms.amount ?? ""), currency: String(terms.currency ?? ""), status: p.status,
      recorded: recordedAlone.has(p.proposal_id) ? "alone" : "cfo", before, after, change: changeOf(before.outcome, after.outcome),
    }];
  });
  const counts: Record<SimChange, number> = { needs_cfo: 0, paid_alone: 0, refused: 0, unchanged: 0 };
  for (const p of payments) counts[p.change] += 1;
  return {
    since, until: now.toISOString(), changes: changes.map((c) => ({ key: c.key, from: current.value(c.key), to: c.to })),
    payments, counts, summary: summaryLine(since, payments.length, counts),
  };
}

const changeOf = (before: SimOutcome, after: SimOutcome): SimChange => (before === after ? "unchanged" : after === "alone" ? "paid_alone" : after === "cfo" ? "needs_cfo" : "refused");

/** Purser's decision on one payment under one policy. */
function decide(db: DB, p: Row, f: Facts, policy: Policy): SimDecision {
  const t = f.terms;
  const v = policy.value;
  const payee = String(t.beneficiary_name ?? "");
  // The executors' holds (holdReason): refused, nothing paid, whoever approved it.
  if (payee && v(`counterparty:${payee}`) === "blocked") return { outcome: "refused", why: `${payee} is blocked by the CFO policy` };
  if (v("freeze") === "on") return { outcome: "refused", why: "the emergency stop is on" };
  if (v("stop.treasury") === "on") return { outcome: "refused", why: "the treasury agent is stopped (velocity limit)" };
  if (v("pause.treasury") === "on") return { outcome: "refused", why: "the treasury agent is paused by the CFO" };
  const entity = entityWhy(db, t, policy);
  if (entity) return { outcome: "refused", why: entity };
  // What approveWithinLimit checks, after the record's own reasons.
  if (f.fixed) return { outcome: "cfo", why: f.fixed };
  const within = policy.limit ? aloneDecision(t.amount, t.currency, policy.limit) : "no_limit";
  if (within === "no_limit") return { outcome: "cfo", why: "no limit to pay alone: the CFO signs every payment" };
  if (within === "not_within") return { outcome: "cfo", why: `${String(t.currency)} ${String(t.amount)} is not within the ${policy.limit!.currency} ${policy.limit!.amount} the agent may pay alone` };
  if (fourEyes(db, p, v)) return { outcome: "cfo", why: "two people sign it (four eyes)" };
  const highRisk = paymentSecondKeyReasons(db, { ...t, kind: p.kind }, new Date(p.created_at), f.history, v);
  if (highRisk.length) return { outcome: "cfo", why: `high-risk (${highRisk.join("; ")}): the CFO signs it with two keys` };
  const odd = anomalyReasonsFrom(anomalyThresholdsFrom(v), p, f.history);
  if (odd.length) return { outcome: "cfo", why: odd.join("; ") };
  return { outcome: "alone", why: `within the ${policy.limit!.currency} ${policy.limit!.amount} the agent may pay alone` };
}

/** The paying entity rule (src/policy/entities.ts entityRefusal) with the policy's own pay_from values; null: allowed. */
function entityWhy(db: DB, t: Facts["terms"], policy: Policy): string | null {
  const pe = t.paying_entity, fa = t.funding_account;
  if (pe == null && fa == null) return listEntities(db).length ? "entity_missing: the company holds legal entities and these terms name none to pay from" : null;
  const id = typeof pe?.id === "string" ? pe.id : "";
  const e = id ? entityOf(db, id) : null;
  if (!e) return `entity_unknown: the company does not hold ${JSON.stringify(id || null)}`;
  if (!policy.mayPayFrom(e.id)) return `entity_not_permitted: the treasury agent may not pay from ${e.id} (${payFromKey(e.id, "treasury")})`;
  const account = typeof fa?.id === "string" ? fa.id : "";
  return account === e.funding_account ? null : `funding_account_mismatch: ${e.id} pays only from its own account`;
}

/** Why the record says Purser would never pay this payment alone, whatever the policy; null when nothing does. */
function fixedReason(db: DB, proposalId: string): string | null {
  const inv = db.prepare("SELECT id, findings_json FROM ap_invoices WHERE proposal_id = ? ORDER BY id LIMIT 1").get(proposalId) as { id: string; findings_json: string } | undefined;
  if (!inv) return "filed outside the payables inbox: only an inbox invoice's payment is ever paid alone";
  let findings: { code?: unknown }[] = [];
  try { findings = JSON.parse(inv.findings_json) as typeof findings; } catch { /* unreadable: none */ }
  const finding = Array.isArray(findings) ? findings.find((x) => typeof x?.code === "string" && CFO_FINDINGS.has(x.code)) : undefined;
  if (finding) return `the invoice's finding ${String(finding.code)} sends it to the CFO`;
  const declined = db.prepare("SELECT json_extract(payload_json, '$.by') AS by FROM audit_log WHERE event = 'ap.alone_declined' AND json_extract(payload_json, '$.proposal_id') = ? ORDER BY seq DESC LIMIT 1").get(proposalId) as { by: string | null } | undefined;
  const who = declined?.by ? FIXED_DECLINES[declined.by] : undefined;
  return who ? `${who} did not say pay at the time` : null;
}

const plural = (n: number) => (n === 1 ? "1 payment" : `${n} payments`);

/** The one line shown beside a policy change. */
export function summaryLine(since: string, total: number, c: Record<SimChange, number>): string {
  const head = `If this had been in force since ${since}:`;
  if (total === 0) return `${head} there were no supplier payments to replay.`;
  if (c.unchanged === total) return `${head} no payment would have been decided differently (${total} replayed).`;
  const parts = [
    c.paid_alone ? `${plural(c.paid_alone)} would have been paid alone instead of by the CFO` : "",
    c.needs_cfo ? `${plural(c.needs_cfo)} would have needed the CFO` : "",
    c.refused ? `${plural(c.refused)} would have been refused` : "",
  ].filter(Boolean);
  // "1 payment would …, 2 payments would …" reads as "1 payment would …, 2 would …".
  const said = parts.map((s, i) => (i === 0 ? s : s.replace(/^(\d+) payments? /, "$1 "))).join(", ");
  return `${head} ${said}; ${c.unchanged} unchanged (${total} replayed).`;
}

/**
 * The summary for a policy_change proposal's display (the runner's dashboard, the phone), from its stored terms; null when
 * the terms cannot be read or name no change. Never part of the signed terms.
 */
export function simulationLine(db: DB, termsJson: string, now = new Date()): string | null {
  let changes: unknown;
  try { changes = (JSON.parse(termsJson) as { changes?: unknown }).changes; } catch { return null; }
  if (!Array.isArray(changes) || !changes.length) return null;
  const list = changes.filter((c): c is { key: string; to: string } => typeof (c as { key?: unknown })?.key === "string" && typeof (c as { to?: unknown })?.to === "string");
  if (list.length !== changes.length) return null;
  try { return simulatePolicyChange(db, list, { now }).summary; } catch { return null; }
}

/**
 * `npm run policy -- simulate <key>=<value> ... [--since YYYY-MM-DD]`: the changes and the first day. A value "none"
 * removes an optional limit, as `policy set` reads it. The first "=" ends the key.
 */
export function parseSimulationArgs(args: string[]): { changes: { key: string; to: string }[]; since?: string } {
  const changes: { key: string; to: string }[] = [];
  let since: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--since") {
      since = args[++i];
      if (since === undefined) throw new Error("--since needs a day like 2026-11-01");
      continue;
    }
    const eq = a.indexOf("=");
    if (eq <= 0) throw new Error(`write each change as <key>=<value>, not ${JSON.stringify(a)}`);
    const to = a.slice(eq + 1);
    changes.push({ key: a.slice(0, eq), to: to === "none" ? "" : to });
  }
  return { changes, ...(since !== undefined ? { since } : {}) };
}

const WORDS: Record<SimOutcome, string> = { alone: "paid alone", cfo: "the CFO", refused: "refused" };

/** The CLI's report: the changes, the summary, then each payment whose decision would change, with why. */
export function simulationReport(s: PolicySimulation): string[] {
  const out = [...s.changes.map((c) => `change   ${c.key}: ${c.from || "not set"} -> ${c.to || "not set"}`), s.summary];
  for (const p of s.payments.filter((x) => x.change !== "unchanged")) {
    out.push(`${p.proposal_id.padEnd(8)} ${p.created_at.slice(0, 10)} ${`${p.currency} ${p.amount}`.padEnd(16)} ${p.payee.slice(0, 40).padEnd(40)} ${WORDS[p.before.outcome]} -> ${WORDS[p.after.outcome]}: ${p.after.why}`);
  }
  out.push("Nothing was written and nothing was paid: a read-only replay of the ledger. The policy changes only with the CFO's passkey.");
  return out;
}
