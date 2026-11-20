// Execution re-checks the signature, not only the row (security review, 20 November, finding 1). Until now the execution
// guard compared the stored terms' hash with the hash on the approval row, and both live in the same database: a row
// written straight into it (method 'passkey', no stored signature, status APPROVED) ran. Now, before money moves, the
// approval the guard is about to act on is checked against what only the approver could have made:
//   - a passkey approval: the passkey signatures stored with it (passkey_assertions) verify, here and now, against the
//     enrolled public keys, over the exact terms (src/passkey/storedSignature.ts); as many different people as the
//     approval names, and two whenever four eyes applies to the signed terms; a high-risk approval's security key too;
//     a line of a signed batch through its batch: the batch's own signatures, over terms that list this line's hash;
//   - an approval by Purser's code within the limit to pay alone (method 'policy'): its proposal.within_limit record,
//     a limit in force at that moment (src/policy/aloneLimit.ts) that covers the exact amount, and, when the CFO signed
//     that limit, the policy change's own signature (finding 7);
//   - a typed hash prefix (cli, web, telegram): only while no passkey is enrolled, as decide() allows it.
// One signature check per signer, per execution; the audit chain is not hashed again for it.
// Since the outside audit (finding 1.3) a passkey row counts only with its enrolment seal (src/passkey/seal.ts), a MAC
// with a key outside the ledger, so a public key written into the database signs nothing here. What this does not close:
// whoever can write the database file can still change the policy rows that decide how many people must sign, and,
// while no passkey is enrolled, approve by typed prefix (docs/security.md, accepted risks).

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { approvalHashOf } from "../metal/ownersExecute.js";
import { passkeyById } from "../passkey/ledger.js";
import { sealRefusal } from "../passkey/seal.js";
import { assertionSha256, verifyStoredSignature, type PinnedKey } from "../passkey/storedSignature.js";
import { aloneLimitRecord, sourceWords, type AloneRecord } from "./aloneLimit.js";
import { BATCH_KIND } from "./batchLines.js";
import { fourEyes } from "./fourEyes.js";
import { aloneDecision } from "./withinLimit.js";

interface Proposal { proposal_id: string; kind: string; terms_json: string; terms_sha256: string }
interface Approval { approved_sha256: string; approver: string; method: string; created_at: string }

/** The approval method of a payment approved by Purser's code within the limit to pay alone. */
export const POLICY_METHOD = "policy";
/** The audit row of such an approval. */
export const WITHIN_LIMIT = "proposal.within_limit";
/** The kinds code may pay alone. */
export const ALONE_KINDS = new Set(["invoice_payment", "supplier_payment"]);

const proposalOf = (db: DB, id: string) => db.prepare("SELECT proposal_id, kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as Proposal | undefined;
const approvalOf = (db: DB, id: string) => db.prepare("SELECT approved_sha256, approver, method, created_at FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(id) as Approval | undefined;

/** Whether the proposal's stored terms still hash to its hash and to the approved hash. */
function intact(p: Proposal, a: Approval): boolean {
  try {
    const h = termsHash(JSON.parse(p.terms_json) as Terms);
    return h === p.terms_sha256 && h === a.approved_sha256;
  } catch {
    return false;
  }
}

/** The people an approval names ("max (passkey …) + anna (passkey …)": two) and whether it names a security key. */
function named(approver: string): { people: string[]; securityKey: boolean } {
  const people = approver.split(" + ").map((x) => x.split(" (")[0]!.trim());
  return { people, securityKey: /\(passkey and security key\)/.test(approver) };
}

/** Each stored signature of `table` for these exact terms that verifies against its own pinned key: whose key it is. */
function verifiedSigners(db: DB, table: "passkey_assertions" | "security_key_assertions", p: Proposal, signed: string, keyOf: (id: string) => (PinnedKey & { label: string; enrolled_at: string }) | string | null): { labels: Set<string>; problem: string | null; rows: number } {
  const where = table === "passkey_assertions" ? "AND outcome = 'APPROVED'" : "";
  let stored: { assertion_sha256: string; credential_id: string; assertion_json: string; verified_at: string }[];
  try {
    stored = db.prepare(`SELECT assertion_sha256, credential_id, assertion_json, verified_at FROM ${table} WHERE proposal_id = ? AND terms_sha256 = ? ${where} ORDER BY verified_at`).all(p.proposal_id, p.terms_sha256) as typeof stored;
  } catch {
    stored = []; // no such table: nothing was ever signed with a security key here
  }
  const labels = new Set<string>();
  let problem: string | null = null;
  for (const s of stored) {
    const key = keyOf(s.credential_id);
    let why: string | null;
    if (typeof key === "string") why = `signed by ${s.credential_id.slice(0, 8)}, but ${key}`;
    else if (!key) why = `signed by a key that is not enrolled (${s.credential_id.slice(0, 8)})`;
    else if (Date.parse(key.enrolled_at) > Date.parse(s.verified_at)) why = "signed before the key was enrolled";
    else {
      let response: AuthenticationResponseJSON | null = null;
      try { response = JSON.parse(s.assertion_json) as AuthenticationResponseJSON; } catch { /* below */ }
      if (!response || assertionSha256(response) !== s.assertion_sha256) why = "the stored signature was changed";
      else {
        const v = verifyStoredSignature(response, signed, key);
        why = v.ok ? null : v.reason;
      }
    }
    if (why === null && key && typeof key !== "string") labels.add(key.label);
    else problem ??= why;
  }
  return { labels, problem, rows: stored.length };
}

/** Why `p`'s passkey approval is not backed by verifying signatures over its exact terms, or null when it is. */
function passkeyRefusal(db: DB, filed: Proposal, a: Approval, depth = 0): string | null {
  const id = filed.proposal_id;
  if (!intact(filed, a)) return `${id}: the stored terms do not hash to the approved hash`;
  // The kind inside the signed terms, not the column beside them (which the hash does not cover).
  const p: Proposal = { ...filed, kind: String((JSON.parse(filed.terms_json) as { kind?: unknown }).kind) };
  let signed: string;
  try {
    signed = approvalHashOf(p);
  } catch (e) {
    return `${id}: ${(e as Error).message}`;
  }
  const { people, securityKey } = named(a.approver);
  // Four eyes is read from the signed terms (src/policy/fourEyes.ts), not only from the names on the row.
  let needs = people.length;
  try { if (fourEyes(db, p)) needs = Math.max(needs, 2); } catch { needs = Math.max(needs, 2); }
  // Only a passkey the enrolment ceremony sealed counts (src/passkey/seal.ts): not a row written into the ledger.
  const own = verifiedSigners(db, "passkey_assertions", p, signed, (cid) => {
    const pk = passkeyById(db, cid);
    return pk ? sealRefusal(db, pk) ?? pk : null;
  });
  if (own.labels.size === 0 && own.rows === 0 && depth === 0) {
    // A line of a signed batch has no signature of its own: the CFO signed the batch, whose terms list this line's hash.
    const viaBatch = batchRefusal(db, p);
    if (viaBatch === null) return null;
    if (viaBatch !== "not in a batch") return viaBatch;
  }
  if (own.labels.size === 0) return `${id}: approved as a passkey approval, but ${own.rows === 0 ? "no passkey signature is stored for its terms" : `no stored passkey signature verifies over its exact terms (${own.problem})`}`;
  if (own.labels.size < needs) return `${id}: needs the passkey signatures of ${needs} different people, and ${own.labels.size} verif${own.labels.size === 1 ? "ies" : "y"}${own.problem ? ` (${own.problem})` : ""}`;
  if (securityKey) {
    const sk = verifiedSigners(db, "security_key_assertions", p, signed, (cid) => {
      try { return (db.prepare("SELECT * FROM security_keys WHERE credential_id = ?").get(cid) as (PinnedKey & { label: string; enrolled_at: string }) | undefined) ?? null; } catch { return null; }
    });
    if (!people.some((person) => sk.labels.has(person) && own.labels.has(person))) return `${id}: approved with a passkey and a security key, but no stored security key signature of the same person verifies over its exact terms${sk.problem ? ` (${sk.problem})` : ""}`;
  }
  return null;
}

/** Null when `line` is in a batch the CFO signed (verifying signatures) whose signed terms list it with its exact hash. */
function batchRefusal(db: DB, line: Proposal): string | null {
  const batches = db.prepare("SELECT batch_id FROM batch_lines WHERE proposal_id = ? AND terms_sha256 = ? ORDER BY batch_id DESC").all(line.proposal_id, line.terms_sha256) as { batch_id: string }[];
  if (batches.length === 0) return "not in a batch";
  let last = `${line.proposal_id}: no batch it is in was signed`;
  for (const { batch_id } of batches) {
    const b = proposalOf(db, batch_id);
    const ba = approvalOf(db, batch_id);
    if (!b || b.kind !== BATCH_KIND || !ba || ba.method !== "passkey") continue;
    let listed: boolean;
    try {
      listed = ((JSON.parse(b.terms_json) as { lines?: { proposal_id?: unknown; terms_sha256?: unknown }[] }).lines ?? [])
        .some((l) => l.proposal_id === line.proposal_id && l.terms_sha256 === line.terms_sha256);
    } catch { listed = false; }
    if (!listed) { last = `${line.proposal_id}: batch ${batch_id}'s signed terms do not list it with these terms`; continue; }
    const why = passkeyRefusal(db, b, ba, 1);
    if (why === null) return null;
    last = `${line.proposal_id} is a line of batch ${batch_id}: ${why}`;
  }
  return last;
}

/**
 * For a payment approved by code within the limit to pay alone: why that approval does not stand, or null when it does,
 * with the limit it stood on. It stands only with its proposal.within_limit record over the approved hash, a limit in
 * force at that moment (signed by the CFO, or a labelled system default) and the exact amount within it. `signature`
 * also re-verifies the signed limit's own passkey signature.
 */
export function policyApprovalCheck(db: DB, proposalId: string, opts: { signature: boolean }): { ok: true; limit: AloneRecord } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason: `${proposalId}: ${reason}` });
  const p = proposalOf(db, proposalId);
  const a = approvalOf(db, proposalId);
  if (!p || !a) return no("no approval on record");
  if (a.method !== POLICY_METHOD) return no(`approved by ${a.method}, not by the policy`);
  if (!ALONE_KINDS.has(p.kind)) return no(`a ${p.kind} is never paid alone`);
  if (!intact(p, a)) return no("the stored terms do not hash to the approved hash");
  const rec = db.prepare("SELECT seq, payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq DESC LIMIT 1").get(WITHIN_LIMIT, proposalId) as { seq: number; payload_json: string } | undefined;
  let recorded: string | undefined;
  try { recorded = rec ? (JSON.parse(rec.payload_json) as { terms_sha256?: string }).terms_sha256 : undefined; } catch { recorded = undefined; }
  if (!rec || recorded !== a.approved_sha256) return no(`approved by the policy, but no ${WITHIN_LIMIT} record stands for these terms`);
  const limit = aloneLimitRecord(db, rec.seq);
  if (!limit) return no("approved by the policy, but no limit to pay alone was in force then (none signed by the CFO, and no labelled system default)");
  const t = JSON.parse(p.terms_json) as { amount?: unknown; currency?: unknown };
  if (aloneDecision(t.amount, t.currency, limit) !== "within") return no(`${String(t.currency)} ${String(t.amount)} is not within the ${limit.currency} ${limit.amount} in force then`);
  if (opts.signature && limit.source.kind === "signed") {
    const lp = proposalOf(db, limit.source.proposal_id);
    const la = approvalOf(db, limit.source.proposal_id);
    const why = lp && la ? passkeyRefusal(db, lp, la) : `${limit.source.proposal_id} has no approval`;
    if (why) return no(`the limit to pay alone it stood on is not signed: ${why}`);
  }
  return { ok: true, limit };
}

/**
 * Why the approval on record for `proposalId` does not stand on what only its approver could have made, or null when it
 * does (see the top of this file). Reads the ledger and verifies signatures; writes nothing.
 */
export function approvalSignatureRefusal(db: DB, proposalId: string): string | null {
  const p = proposalOf(db, proposalId);
  const a = approvalOf(db, proposalId);
  if (!p || !a) return `${proposalId} has no approval`;
  if (a.method === "passkey") return passkeyRefusal(db, p, a);
  if (a.method === POLICY_METHOD) {
    const c = policyApprovalCheck(db, proposalId, { signature: true });
    return c.ok ? null : c.reason;
  }
  // A typed hash prefix: decide() refuses one while a passkey is active; none counts once a passkey was enrolled before it.
  const keys = db.prepare("SELECT status, enrolled_at FROM passkeys").all() as { status: string; enrolled_at: string }[];
  const enrolled = keys.some((k) => k.status === "ACTIVE" || Date.parse(k.enrolled_at) <= Date.parse(a.created_at));
  return enrolled ? `${proposalId}: approved by ${a.method} (a typed hash prefix), but a passkey is enrolled: only a passkey signature approves` : null;
}

/** The limit's source in words, for the record and verify. */
export { sourceWords };
