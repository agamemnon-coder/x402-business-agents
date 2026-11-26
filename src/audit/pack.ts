// The signed audit pack (26 Nov): one self-verifying JSON file per period for an auditor. It holds the period's audit
// rows whole (each row's hash recomputed by the verifier) and the links of every row before them back to the genesis
// hash (src/audit/log.ts checkChainLinks), so the chain is shown intact from its first row to the period's last. Beside
// the rows, the same rows sorted for reading: every decision on a payment or a proposal, every approval (who, with which
// method and passkey, over which terms hash), every policy version and change, every refusal and hold, every
// reconciliation; then the proposals they name with their exact terms (hashed again by the verifier) and their approval
// rows, and the policy versions in force with their rules (hashed again).
//
// A manifest lists each section's rows by SHA-256 (of the row's canonical JSON, RFC 8785) and is signed with Ed25519 by
// the audit checkpoint key (src/audit/checkpointer.ts; never in the ledger, never in the pack). How the reading sections
// were sorted out of the rows is in the manifest too, so a pack made today still verifies after the code learns new
// events. The verifier (verifyAuditPack below; npm run verify-audit-pack) needs no database and no network: one changed
// byte or one removed row fails, saying which section, which row and why.
//
// What it does not prove: whose key signed it unless the verifier pins one (--trust, or PURSER_CHECKPOINT_TRUST); what
// a row before the period said (only its link is in the pack); or a passkey's WebAuthn signature (the pack names the
// credential and the stored assertion's hash; npm run verify checks the signatures against the ledger).

import { createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import type { DB } from "../db/open.js";
import { REFUSAL_EVENTS } from "../dashboard/snapshot.js";
import { verifyLedger } from "../ledger/core.js";
import { sha256Hex, termsHash, type Terms } from "../lib/terms.js";
import { WITHIN_LIMIT } from "../policy/signedApproval.js";
import { policySha } from "../policy/versions.js";
import { MONEY_EVENTS } from "../provenance/origin.js";
import { keyIdOf, normalisePublicKey, rawPublicKey } from "./checkpoint.js";
import { checkChainLinks, GENESIS, verifyAuditChain, verifyAuditRowsFrom, type AuditRowStored } from "./log.js";

export const AUDIT_PACK_FORMAT = "purser.audit-pack/v1";

/** The reading sections, each sorted out of the period's audit rows by event (exact names and patterns). */
export const DERIVED = ["decisions", "approvals", "policy_changes", "refusals_holds", "reconciliation"] as const;
export type Derived = typeof DERIVED[number];
export const SECTIONS = ["chain_before", "audit_rows", ...DERIVED, "proposals", "policy_versions"] as const;
export type Section = typeof SECTIONS[number];

export interface DeriveRule { events: string[]; patterns: string[] }

/** The approval events: a person's decision (or the second of two), a first signature, code's within the limit. */
const APPROVAL_EVENTS = ["proposal.approved", "proposal.rejected", "proposal.cosigned", "proposal.factor_signed", "approval.too_late", WITHIN_LIMIT];

/** How each reading section is sorted out of the rows today; carried in the signed manifest. */
export function deriveRules(): Record<Derived, DeriveRule> {
  return {
    decisions: { events: [...MONEY_EVENTS].sort(), patterns: ["^proposal\\.", "^approval\\.", "^execution\\.", "^hub\\.gate"] },
    approvals: { events: [...APPROVAL_EVENTS].sort(), patterns: [] },
    policy_changes: { events: ["setting.changed"], patterns: ["^policy\\."] },
    // "[._]held$": a hold named either way, `sweep.held` or `payment.anomaly_held` (26 Nov: `\.held$` missed the second).
    refusals_holds: { events: [...REFUSAL_EVENTS].sort(), patterns: ["refus", "[._]held$", "hold", "blocked", "declin", "quarantin", "tripped", "too_late", "fraud_suspected", "injection_flagged"] },
    reconciliation: { events: [], patterns: ["reconcil", "\\.difference$", "\\.agreed$", "disagrees"] },
  };
}

/** One audit row as a reading section shows it: where it is in the chain, and what it says. */
export interface PackEvent { seq: number; row_hash: string; ts: string; actor: string; event: string; subject: string | null; payload: Json }

export interface PackProposal {
  proposal_id: string; kind: string; created_by: string; created_at: string; status_at_pack: string; policy_version: number | null;
  terms: Json; terms_sha256: string;
  approval: { decision: string; approved_sha256: string; approver: string; method: string; created_at: string; policy_version: number | null } | null;
  cosignatures: { person: string; approver: string; credential_id: string; terms_sha256: string; assertion_sha256: string; created_at: string }[];
}

export interface PackPolicyVersion { version: number; sha256: string; created_at: string; values: Record<string, string> }

export interface SectionDigest { rows: number; sha256: string; row_sha256: string[] }

export interface AuditPackManifest {
  format: typeof AUDIT_PACK_FORMAT;
  /** Inclusive UTC days. */
  period: { from: string; to: string };
  made_at: string;
  /** The period's rows are seq first_seq..last_seq; before: the row just before them (seq 0 and the genesis hash at the start). */
  audit: { first_seq: number; last_seq: number; rows: number; before: { seq: number; head: string }; head: string; log_rows: number; log_head: string };
  /** The bookkeeping ledger's own chain, verified when the pack was made (src/ledger/core.ts verifyLedger). */
  ledger: { entries: number; head: string };
  derive: Record<Derived, DeriveRule>;
  sections: Record<Section, SectionDigest>;
  key_id: string;
  public_key: string;
}

export interface AuditPack {
  format: typeof AUDIT_PACK_FORMAT;
  note: string;
  manifest: AuditPackManifest;
  /** Ed25519 over the manifest's canonical JSON, base64url. */
  signature: string;
  sections: {
    chain_before: { seq: number; prev_hash: string; row_hash: string }[];
    audit_rows: AuditRowStored[];
    decisions: PackEvent[]; approvals: PackEvent[]; policy_changes: PackEvent[]; refusals_holds: PackEvent[]; reconciliation: PackEvent[];
    proposals: PackProposal[];
    policy_versions: PackPolicyVersion[];
  };
}

export const AUDIT_PACK_NOTE = "A Purser audit pack: check it with `npm run verify-audit-pack -- <file> --trust <public key>`. "
  + "The manifest lists every row's SHA-256 and is signed with Ed25519; the audit rows are hash-chained from the genesis hash.";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD day that exists, as the instant it starts (UTC), or null. */
export function dayStart(day: string): number | null {
  const m = DAY.exec(day);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === day ? t : null;
}

export const rowSha256 = (row: unknown): string => sha256Hex(jcs(row as Json));
const sectionSha256 = (rowHashes: string[]): string => sha256Hex(rowHashes.join("\n"));

function digest(rows: unknown[]): SectionDigest {
  const row_sha256 = rows.map(rowSha256);
  return { rows: rows.length, sha256: sectionSha256(row_sha256), row_sha256 };
}

function matcher(rule: DeriveRule): (event: string) => boolean {
  const events = new Set(rule.events);
  const patterns = rule.patterns.map((p) => new RegExp(p));
  return (event) => events.has(event) || patterns.some((r) => r.test(event));
}

/** A reading section from the period's rows, by its rule. */
export function deriveSection(rows: AuditRowStored[], rule: DeriveRule): PackEvent[] {
  const match = matcher(rule);
  return rows.filter((r) => match(r.event)).map((r) => ({ seq: r.seq, row_hash: r.row_hash, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));
}

export interface PackSigner { key: KeyObject }

/** The period's run of the audit chain, as the audit pack and the compliance evidence (src/compliance/evidence.ts) take it. */
export interface PeriodRows {
  /** The period's first instant and the instant after its last day (UTC, ms). */
  start: number; end: number;
  rows: AuditRowStored[];
  /** Every row before the period, and the hash the period's first row links to (the genesis hash at the start). */
  before: AuditRowStored[]; beforeHead: string;
  /** The whole log, verified from the genesis hash. */
  chain: { rows: number; head: string };
}

/**
 * The audit rows of the days from..to (inclusive, UTC): one unbroken run of the chain. Refuses a period that is not one
 * and an audit log that does not verify: nothing made from these rows ever vouches for a broken log.
 */
export function periodAuditRows(db: DB, period: { from: string; to: string }): PeriodRows {
  const start = dayStart(period.from);
  const endDay = dayStart(period.to);
  if (start === null) throw new Error(`--from ${JSON.stringify(period.from)} is not a day (YYYY-MM-DD)`);
  if (endDay === null) throw new Error(`--to ${JSON.stringify(period.to)} is not a day (YYYY-MM-DD)`);
  if (endDay < start) throw new Error(`the period ends (${period.to}) before it starts (${period.from})`);
  const end = endDay + 86_400_000;
  const chain = verifyAuditChain(db);
  if (!chain.ok) throw new Error(`the audit log does not verify at row ${chain.seq} (${chain.reason}); no pack is made over it (npm run verify)`);
  const all = db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[];
  // The period is one unbroken run of the chain: from the first row stamped on or after its start to the last stamped
  // before its end (rows are written in time order; one out of order inside the run is kept, in its place).
  const inPeriod = (r: AuditRowStored) => { const t = Date.parse(r.ts); return t >= start && t < end; };
  const firstIdx = all.findIndex((r) => Date.parse(r.ts) >= start);
  const a = firstIdx < 0 ? all.length : firstIdx;
  let b = a - 1;
  for (let i = all.length - 1; i >= a; i--) if (inPeriod(all[i]!)) { b = i; break; }
  const before = all.slice(0, a);
  return { start, end, rows: all.slice(a, b + 1), before, beforeHead: before.length ? before[before.length - 1]!.row_hash : GENESIS, chain: { rows: chain.rows, head: chain.head } };
}

/** Ed25519 over a manifest's canonical JSON (RFC 8785), base64url: how a pack's manifest is signed. */
export function signManifest(manifest: object, signer: PackSigner): string {
  return edSign(null, Buffer.from(jcs(manifest as unknown as Json), "utf8"), signer.key).toString("base64url");
}

/**
 * The checks "signature" and "key" on a signed manifest (its public_key and key_id inside it), as verify-audit-pack
 * prints them: the Ed25519 signature over the manifest's canonical JSON, and whose key signed it against the pinned
 * keys. With none pinned, "key" is not checked (UNPINNED) and is never ok.
 */
export function manifestSignatureChecks(m: { public_key: string; key_id: string }, signature: string, trustedKeys: string[] = []): PackCheck[] {
  const sigOk = (() => {
    try {
      const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: m.public_key }, format: "jwk" });
      return edVerify(null, Buffer.from(jcs(m as unknown as Json), "utf8"), key, Buffer.from(signature, "base64url"));
    } catch { return false; }
  })();
  const idOk = (() => { try { return keyIdOf(m.public_key) === m.key_id; } catch { return false; } })();
  const checks: PackCheck[] = [{
    check: "signature", ok: sigOk && idOk,
    detail: !idOk ? `key_id ${String(m.key_id)} is not the id of the public key in the manifest`
      : sigOk ? `Ed25519 verifies over the manifest with key ${m.key_id}` : `Ed25519 does not verify over the manifest with key ${m.key_id}: the manifest or the signature was changed`,
  }];
  const trusted = trustedKeys.map(normalisePublicKey);
  if (trusted.length) checks.push({ check: "key", ok: trusted.includes(m.public_key), detail: trusted.includes(m.public_key) ? `key ${m.key_id} is pinned` : `signed by key ${m.key_id}, which is not a pinned key (${trusted.map(keyIdOf).join(", ")})` });
  // No pinned key: whose key signed it is not checked, and the pack is not valid. Anyone can rebuild a pack and sign it
  // again with their own key; the signature alone proves only that someone signed it.
  else checks.push({ check: "key", ok: false, not_checked: true, detail: `UNPINNED: signed by key ${m.key_id}, which no pinned key vouches for: pass --trust <public key> (the signer's, from where you got it, not from the file)` });
  return checks;
}

/**
 * The audit pack of the days from..to (inclusive, UTC). Refuses a ledger whose audit log or bookkeeping chain does not
 * verify: a pack never vouches for a broken one.
 */
export function buildAuditPack(db: DB, period: { from: string; to: string }, signer: PackSigner, now = new Date()): AuditPack {
  const { start, end, rows, before, beforeHead, chain } = periodAuditRows(db, period);
  const ledger = verifyLedger(db);
  if (!ledger.ok) throw new Error(`the bookkeeping ledger does not verify at entry ${ledger.entry_id} (${ledger.reason}); no pack is made over it (npm run verify)`);

  const rules = deriveRules();
  const derived = Object.fromEntries(DERIVED.map((d) => [d, deriveSection(rows, rules[d])])) as Record<Derived, PackEvent[]>;

  // The proposals the period's decisions name, with their exact terms and their approval.
  const ids = [...new Set([...derived.decisions, ...derived.approvals].map((e) => e.subject).filter((s): s is string => typeof s === "string"))].sort();
  const proposals: PackProposal[] = [];
  for (const id of ids) {
    const p = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as
      { proposal_id: string; kind: string; terms_json: string; terms_sha256: string; created_by: string; status: string; created_at: string; policy_version?: number | null } | undefined;
    if (!p) continue;
    const appr = db.prepare("SELECT decision, approved_sha256, approver, method, created_at, policy_version FROM approvals WHERE proposal_id = ?").get(id) as PackProposal["approval"] | undefined;
    const cos = db.prepare("SELECT person, approver, credential_id, terms_sha256, assertion_sha256, created_at FROM cosignatures WHERE proposal_id = ? ORDER BY created_at, rowid").all(id) as PackProposal["cosignatures"];
    let terms: Json;
    try { terms = JSON.parse(p.terms_json) as Json; } catch { terms = p.terms_json; }
    proposals.push({
      proposal_id: p.proposal_id, kind: p.kind, created_by: p.created_by, created_at: p.created_at, status_at_pack: p.status, policy_version: p.policy_version ?? null,
      terms, terms_sha256: p.terms_sha256, approval: appr ? { ...appr, policy_version: appr.policy_version ?? null } : null, cosignatures: cos,
    });
  }

  // The policy versions in force during the period: the one at its start, and every one recorded in it.
  const versions = (db.prepare("SELECT version, sha256, values_json, created_at FROM policy_versions ORDER BY version").all() as { version: number; sha256: string; values_json: string; created_at: string }[])
    .map((v) => ({ version: v.version, sha256: v.sha256, created_at: v.created_at, values: JSON.parse(v.values_json) as Record<string, string> }));
  const atStart = versions.filter((v) => Date.parse(v.created_at) < start).pop();
  const policy_versions = versions.filter((v) => v === atStart || (Date.parse(v.created_at) >= start && Date.parse(v.created_at) < end));

  const sections: AuditPack["sections"] = {
    chain_before: before.map((r) => ({ seq: r.seq, prev_hash: r.prev_hash, row_hash: r.row_hash })),
    audit_rows: rows, ...derived, proposals, policy_versions,
  };
  const publicKey = rawPublicKey(signer.key);
  const manifest: AuditPackManifest = {
    format: AUDIT_PACK_FORMAT, period: { from: period.from, to: period.to }, made_at: now.toISOString(),
    audit: {
      first_seq: before.length + 1, last_seq: before.length + rows.length, rows: rows.length,
      before: { seq: before.length, head: beforeHead }, head: rows.length ? rows[rows.length - 1]!.row_hash : beforeHead,
      log_rows: chain.rows, log_head: chain.head,
    },
    ledger: { entries: ledger.entries, head: ledger.head },
    derive: rules,
    sections: Object.fromEntries(SECTIONS.map((s) => [s, digest(sections[s])])) as Record<Section, SectionDigest>,
    key_id: keyIdOf(publicKey), public_key: publicKey,
  };
  const signature = signManifest(manifest, signer);
  return { format: AUDIT_PACK_FORMAT, note: AUDIT_PACK_NOTE, manifest, signature, sections };
}

/** What the pack holds, in a line per section, for the command line. */
export function packSummary(p: AuditPack): string[] {
  const m = p.manifest;
  return [
    `period ${m.period.from} .. ${m.period.to}: audit rows ${m.audit.first_seq}..${m.audit.last_seq} (${m.audit.rows}), head ${m.audit.head.slice(0, 16)}…`,
    ...SECTIONS.map((s) => `  ${s.padEnd(15)} ${String(m.sections[s].rows).padStart(5)} rows  sha256 ${m.sections[s].sha256.slice(0, 16)}…`),
    `signed by key ${m.key_id} (Ed25519 ${m.public_key})`,
  ];
}

// --- Verification: no database, no network. ----------------------------------------------------------------------

/** One check; not_checked when it could not be made (no pinned key, no audit pack given): never ok, but not a failure found. */
export interface PackCheck { check: string; ok: boolean; detail: string; not_checked?: true }
/**
 * ok only when every check passed. incomplete when none failed but one could not be made (not_checked): the verifier
 * says UNPINNED or PARTIAL then, never VALID.
 */
export interface PackResult { ok: boolean; checks: PackCheck[]; incomplete?: boolean }

/** The result of a list of checks: ok, or incomplete when the only checks not passed are ones not made. */
export function packResult(checks: PackCheck[]): PackResult {
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  const incomplete = !ok && checks.length > 0 && checks.every((c) => c.ok || c.not_checked === true);
  return incomplete ? { ok, checks, incomplete } : { ok, checks };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const short = (h: unknown) => (typeof h === "string" && h.length > 16 ? `${h.slice(0, 12)}…` : String(h));
const same = (x: unknown, y: unknown) => { try { return jcs(x as Json) === jcs(y as Json); } catch { return false; } };

/**
 * Every check on an audit pack: its shape, the manifest's signature and whose key signed it (not checked, never ok, with no key pinned), every
 * section's rows against the manifest's hashes, the audit chain from the genesis hash through the period, each reading
 * section against the rows it was sorted out of, every proposal's terms against their hash and its approval, and every
 * policy version's rules against its hash. Each detail names the section, the row and what differs.
 */
export function verifyAuditPack(pack: unknown, opts: { trusted?: string[] } = {}): PackResult {
  const checks: PackCheck[] = [];
  const add = (check: string, ok: boolean, detail: string, notChecked = false) => { checks.push(notChecked ? { check, ok, detail, not_checked: true } : { check, ok, detail }); return ok; };
  const done = (): PackResult => packResult(checks);
  try {
    return run();
  } catch (e) {
    add("error", false, (e as Error).message);
    return done();
  }

  function run(): PackResult {
    const shaped = isObj(pack) && pack.format === AUDIT_PACK_FORMAT && isObj(pack.manifest) && typeof pack.signature === "string" && isObj(pack.sections)
      && isObj(pack.manifest.sections) && isObj(pack.manifest.audit) && isObj(pack.manifest.derive) && typeof pack.manifest.public_key === "string";
    if (!add("format", shaped, shaped ? `${AUDIT_PACK_FORMAT}, period ${String((pack.manifest as AuditPackManifest).period?.from)} .. ${String((pack.manifest as AuditPackManifest).period?.to)}` : `not a ${AUDIT_PACK_FORMAT} file (a field is missing or of the wrong type)`)) return done();
    const p = pack as unknown as AuditPack;
    const m = p.manifest;

    // 1. The signature over the manifest, and the key.
    for (const c of manifestSignatureChecks(m, p.signature, opts.trusted ?? [])) add(c.check, c.ok, c.detail, c.not_checked);

    // 2. The sections against the manifest: the same names, and every row's hash.
    const names = Object.keys(p.sections).sort(), want = [...SECTIONS].sort(), listed = Object.keys(m.sections).sort();
    const namesOk = same(names, want) && same(listed, want);
    add("sections", namesOk, namesOk ? `${SECTIONS.length} sections, as the manifest lists` : `the file has ${names.join(", ")}; the manifest lists ${listed.join(", ")}; a pack has ${want.join(", ")}`);
    for (const s of SECTIONS) {
      const rows = (p.sections as Record<string, unknown>)[s], d = m.sections[s];
      if (!Array.isArray(rows) || !isObj(d) || !Array.isArray(d.row_sha256)) { add(`hash ${s}`, false, `${s} is missing or not a list`); continue; }
      add(`hash ${s}`, ...rowsAgainst(s, rows, d));
    }

    // 3. The audit chain: the links before the period from the genesis hash, then the period's rows, each hashed again.
    const before = Array.isArray(p.sections.chain_before) ? p.sections.chain_before : [];
    const rows = Array.isArray(p.sections.audit_rows) ? p.sections.audit_rows : [];
    const links = checkChainLinks(before);
    const head = before.length ? before[before.length - 1]!.row_hash : GENESIS;
    const linkWhy = !links.ok ? `the links before the period break at row ${links.seq}: ${links.reason}`
      : before.length !== m.audit.before.seq || head !== m.audit.before.head ? `the links before the period end at row ${before.length} (${short(head)}); the manifest says row ${m.audit.before.seq} (${short(m.audit.before.head)})` : null;
    const period = verifyAuditRowsFrom(rows, { seq: before.length, head });
    const periodWhy = !period.ok ? `audit row ${period.seq}: ${period.reason}`
      : (rows[0]?.seq ?? before.length + 1) !== m.audit.first_seq || before.length + rows.length !== m.audit.last_seq || rows.length !== m.audit.rows ? `the period's rows run ${rows[0]?.seq ?? "-"}..${rows[rows.length - 1]?.seq ?? "-"} (${rows.length}); the manifest says ${m.audit.first_seq}..${m.audit.last_seq} (${m.audit.rows})`
      : period.head !== m.audit.head ? `the chain ends at ${short(period.head)}; the manifest says ${short(m.audit.head)}` : null;
    const why = linkWhy ?? periodWhy;
    add("audit chain", why === null, why ?? `intact from the genesis hash: ${before.length} rows linked before the period, rows ${m.audit.first_seq}..${m.audit.last_seq} hashed again, head ${short(m.audit.head)} as signed`);

    // 4. Each reading section is exactly the rows its signed rule sorts out of the period's rows.
    for (const d of DERIVED) {
      const rule = m.derive[d];
      const got = (p.sections as Record<string, unknown>)[d];
      if (!isObj(rule) || !Array.isArray(rule.events) || !Array.isArray(rule.patterns) || !Array.isArray(got)) { add(d, false, `${d}: no rule or no rows`); continue; }
      add(d, ...derivedAgainst(d, got as PackEvent[], deriveSection(rows, rule)));
    }

    // 5. The proposals: each one's terms hash to its hash, its approval names that hash, and every approval row's
    // proposal is here with the hash the row names.
    const props = Array.isArray(p.sections.proposals) ? p.sections.proposals : [];
    const byId = new Map(props.map((x) => [x.proposal_id, x]));
    const bad: string[] = [];
    for (const x of props) {
      let h: string | null = null;
      try { h = termsHash(x.terms as Terms); } catch (e) { bad.push(`${x.proposal_id}: its terms are not canonical terms (${(e as Error).message})`); continue; }
      if (h !== x.terms_sha256) bad.push(`${x.proposal_id}: its terms hash to ${short(h)}, the pack says ${short(x.terms_sha256)}`);
      else if (isObj(x.terms) && x.terms.kind !== x.kind) bad.push(`${x.proposal_id}: a ${String(x.kind)} whose signed terms say ${String(x.terms.kind)}`);
      else if (x.approval && x.approval.decision === "APPROVED" && x.approval.approved_sha256 !== h) bad.push(`${x.proposal_id}: approved ${short(x.approval.approved_sha256)}, not its terms ${short(h)}`);
      else { const c = x.cosignatures.find((y) => y.terms_sha256 !== h); if (c) bad.push(`${x.proposal_id}: ${c.person}'s first signature is over ${short(c.terms_sha256)}, not its terms`); }
    }
    for (const e of Array.isArray(p.sections.approvals) ? p.sections.approvals : []) {
      const x = e.subject === null ? undefined : byId.get(e.subject);
      const named = isObj(e.payload) ? e.payload.terms_sha256 : undefined;
      if (!x) bad.push(`approval row ${e.seq} (${e.event} ${String(e.subject)}): the proposal's terms are not in the pack`);
      else if (named !== undefined && named !== x.terms_sha256) bad.push(`approval row ${e.seq} (${e.event} ${String(e.subject)}) names terms ${short(named)}, the proposal's are ${short(x.terms_sha256)}`);
    }
    add("proposals", bad.length === 0, bad.length ? bad.join("; ") : `${props.length} proposals: each one's terms hash to its hash, and every approval row names those terms`);

    // 6. The policy versions: each one's rules hash to its hash, and every version recorded in the period is here.
    const vs = Array.isArray(p.sections.policy_versions) ? p.sections.policy_versions : [];
    const vbad: string[] = [];
    for (const v of vs) if (!isObj(v.values) || policySha(v.values) !== v.sha256) vbad.push(`policy v${v.version}: its rules hash to ${isObj(v.values) ? short(policySha(v.values)) : "nothing"}, the pack says ${short(v.sha256)}`);
    for (const e of rows.filter((r) => r.event === "policy.version")) {
      const pl = JSON.parse(e.payload_json) as { version?: unknown; sha256?: unknown };
      const v = vs.find((x) => x.version === pl.version);
      if (!v) vbad.push(`policy v${String(pl.version)} (audit row ${e.seq}) is not in policy_versions`);
      else if (v.sha256 !== pl.sha256) vbad.push(`policy v${v.version}: audit row ${e.seq} says ${short(pl.sha256)}, policy_versions says ${short(v.sha256)}`);
    }
    add("policy versions", vbad.length === 0, vbad.length ? vbad.join("; ") : `${vs.length} versions (in force at the start and recorded in the period): each one's rules hash to its hash`);
    return done();
  }
}

/** A section's rows against the manifest's list of row hashes: which row changed, which is missing, which was added. */
function rowsAgainst(name: string, rows: unknown[], d: SectionDigest): [boolean, string] {
  const got = rows.map(rowSha256);
  const why: string[] = [];
  if (sectionSha256(d.row_sha256) !== d.sha256) why.push(`the manifest's row list does not hash to its sha256 ${short(d.sha256)}`);
  if (got.length === d.row_sha256.length) {
    got.forEach((h, i) => { if (h !== d.row_sha256[i]) why.push(`row ${i + 1}${label(rows[i])} hashes to ${short(h)}, the manifest says ${short(d.row_sha256[i])}: it was changed`); });
  } else {
    const have = new Set(got), listed = new Set(d.row_sha256);
    const missing = d.row_sha256.map((h, i) => ({ h, i })).filter((x) => !have.has(x.h));
    const extra = got.map((h, i) => ({ h, i })).filter((x) => !listed.has(x.h));
    why.push(`${rows.length} rows, the manifest lists ${d.row_sha256.length}`
      + missing.map((x) => `; the manifest's row ${x.i + 1} (sha256 ${short(x.h)}) is not in the file`).join("")
      + extra.map((x) => `; row ${x.i + 1}${label(rows[x.i])} is not in the manifest`).join(""));
  }
  if (d.rows !== d.row_sha256.length) why.push(`the manifest says ${d.rows} rows and lists ${d.row_sha256.length}`);
  return [why.length === 0, why.length ? `${name}: ${why.join("; ")}` : `${rows.length} rows, each as the manifest lists (sha256 ${short(d.sha256)})`];
}

const label = (r: unknown): string => {
  if (!isObj(r)) return "";
  if (typeof r.seq === "number") return ` (audit row ${r.seq}${typeof r.event === "string" ? ` ${r.event}` : ""}${typeof r.subject === "string" ? ` ${r.subject}` : ""})`;
  if (typeof r.proposal_id === "string") return ` (${r.proposal_id})`;
  if (typeof r.version === "number") return ` (policy v${r.version})`;
  return "";
};

/** A reading section against the rows its rule sorts out: every one there, none added, none changed. */
function derivedAgainst(name: string, got: PackEvent[], want: PackEvent[]): [boolean, string] {
  const bySeq = new Map(got.map((e) => [isObj(e) ? e.seq : NaN, e]));
  const wantSeq = new Set(want.map((e) => e.seq));
  const why: string[] = [];
  for (const w of want) {
    const g = bySeq.get(w.seq);
    if (!g) why.push(`audit row ${w.seq} (${w.event}${w.subject ? ` ${w.subject}` : ""}) is not in it`);
    else if (!same(g, w)) why.push(`its row for audit row ${w.seq} (${w.event}${w.subject ? ` ${w.subject}` : ""}) is not what that row says`);
  }
  for (const g of got) if (!isObj(g) || !wantSeq.has(g.seq as number)) why.push(`it has a row for audit row ${isObj(g) ? String(g.seq) : "?"}, which its rule does not sort into it`);
  if (why.length === 0 && got.some((g, i) => g.seq !== want[i]?.seq)) why.push("its rows are not in the chain's order");
  return [why.length === 0, why.length ? `${name}: ${why.join("; ")}` : `${got.length} rows: exactly the period's audit rows its signed rule sorts into it`];
}
