// A seeded ledger for the compliance evidence (src/compliance/evidence.ts): test data only, made by Purser's own code
// where a test can drive it (proposals, passkey approvals, policy changes, the emergency stop, agent identities), and
// with audit() for the events whose writer needs a rail (a refusal, a hold, a reconciliation), as test/audit-pack.test.ts
// does. October has one payment (before the period), November everything below, December one reconciliation (after it).
// The secrets this world hands out (an agent's bearer key, its signing key) are returned so a test can look for them.
import { audit } from "../../src/audit/log.js";
import { openDb, type DB } from "../../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../../src/executors/policyChange.js";
import { TERMS_SCHEMA } from "../../src/lib/terms.js";
import { signAgentRequest, verifyAgentIdentity } from "../../src/policy/agentIdentity.js";
import { RATIONALE_NOT_VIEWED, RATIONALE_VIEWED } from "../../src/passkey/process.js";
import { ANOMALY_HELD } from "../../src/policy/anomaly.js";
import { createProposal, decide, nextProposalId } from "../../src/policy/approvals.js";
import { expirePrincipal, revokePrincipal, rotatePrincipalKey } from "../../src/policy/principals.js";
import { approveSigned, testPasskey } from "./signedApproval.js";

export const OCT = new Date("2026-10-20T09:00:00Z");
export const NOV = (day: number, h = 9, min = 0): Date => new Date(`2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`);
export const DEC = new Date("2026-12-02T09:00:00Z");
export const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

function invoice(db: DB, amount: string, now: Date) {
  const expires = new Date(now.getTime() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: nextProposalId(db), expires_at: expires, amount, currency: "EUR", vendor: "Bergtex Textil GmbH" }, createdBy: "treasury" }, now);
}

/** A person's policy change, proposed (by lena, who signs nothing: segregation of duties needs a named proposer) and approved by `people`. */
function policyChange(db: DB, changes: { key: string; to: string }[], reason: string, at: Date, people: string[]): string {
  const p = proposePolicyChange(db, { changes, reason, proposedBy: "lena" }, "human", at);
  people.forEach((person, i) => approveSigned(db, p.proposal_id, new Date(at.getTime() + i * 60_000), person));
  executePolicyChange(db, p.proposal_id, new Date(at.getTime() + people.length * 60_000));
  return p.proposal_id;
}

export interface ComplianceWorld { db: DB; ids: Record<string, string>; secrets: string[] }

/** The seeded ledger, in memory or in a file (the end-to-end run of the CLIs). */
export function complianceWorld(file = ":memory:"): ComplianceWorld {
  const db = openDb(file);
  testPasskey(db, "max", OCT);
  testPasskey(db, "anna", OCT);
  const oct = invoice(db, "400.00", OCT);
  approveSigned(db, oct.proposal_id, OCT, "max");

  // The CFO turns segregation of duties on; two people loosen the limit; the emergency stop is pulled and lifted.
  const sodOn = policyChange(db, [{ key: "approval.policy_sod_eur", to: "1000.00" }], "segregation of duties", NOV(2), ["max"]);
  const loosen = policyChange(db, [{ key: "ap.alone_eur", to: "2500.00" }], "month-end volume", NOV(3), ["max", "anna"]);
  const stop = policyChange(db, [{ key: "freeze", to: "on" }], "suspected leaked key", NOV(4), ["max"]);
  audit(db, "human", RATIONALE_NOT_VIEWED, stop, { credential: "test0002", reported_by: "the approval page, not signed (written after the change here; the runner writes it just before)" }, NOV(4, 9, 30));
  const lift = policyChange(db, [{ key: "freeze", to: "off" }], "key rotated, incident closed", NOV(5), ["max", "anna"]);

  // Agent identities: one agent's key rotated (a new bearer key and signing key), one signed request verified and one
  // with a bad signature refused, one agent revoked, one given an end date.
  const rotated = rotatePrincipalKey(db, "support", "max", NOV(6));
  const body = { refund: "R-1" };
  const good = signAgentRequest(rotated.identity!.private_pem, { agent: "support", method: "POST", target: "/v1/refunds", body, now: NOV(6, 10) });
  verifyAgentIdentity(db, { agent: "support", method: "POST", target: "/v1/refunds", body, proof: good }, { mode: "required", now: NOV(6, 10), via: "agent-api" });
  const forged = { ...signAgentRequest(rotated.identity!.private_pem, { agent: "support", method: "POST", target: "/v1/refunds", body, now: NOV(6, 11) }), body_sha256: "0".repeat(64) };
  verifyAgentIdentity(db, { agent: "support", method: "POST", target: "/v1/refunds", body, proof: forged }, { mode: "required", now: NOV(6, 11), via: "agent-api" });
  revokePrincipal(db, "sourcing", "stopped buying reports", "max", NOV(7));
  expirePrincipal(db, "support", DEC, "max", NOV(7, 10));

  // Payments: one approved with the passkey, one rejected; a payment held as an anomaly, a refund refused, a sweep held.
  const paid = invoice(db, "1850.00", NOV(10));
  // The approval page's automation-bias signal (PC-26), as src/passkey/process.ts records it before the approval:
  // Anna opened Details before signing this payment; Max did not before signing the emergency stop (test data).
  audit(db, "human", RATIONALE_VIEWED, paid.proposal_id, { terms_sha256: paid.terms_sha256, credential: "test0001", reported_by: "the approval page, not signed" }, NOV(10));
  approveSigned(db, paid.proposal_id, NOV(10), "anna");
  const no = invoice(db, "990.00", NOV(11));
  decide(db, { proposalId: no.proposal_id, decision: "REJECTED", typedPrefix: no.terms_sha256.slice(0, 8), approver: "max", method: "cli", note: "not ours" }, NOV(11));
  audit(db, "system", ANOMALY_HELD, "P-9001", { proposal_id: "P-9001", agent: "payer", reasons: ["7.0 times the median of the payee's last 5 paid invoices (test data)"] }, NOV(12));
  audit(db, "support", "refund.refused", "R-7", { reason: "policy_cap_exceeded: 60.00 is over the Support agent's limit of 50.00" }, NOV(12, 10));
  audit(db, "treasury", "sweep.held", "S-3", { reason: "EUR floor" }, NOV(13));
  audit(db, "claude", "claude.read", "read-1", { model: "stand-in (test data)", input_sha256: "a".repeat(64) }, NOV(14));
  audit(db, "system", "reconcile.done", null, { checked: "12", differences: "1" }, NOV(28));
  audit(db, "system", "reconcile.difference", "AP-3", { ledger: "1850.00", bank: "1805.00" }, NOV(28, 10));
  audit(db, "system", "reconcile.done", null, { checked: "4", differences: "0" }, DEC);
  return {
    db,
    ids: { oct: oct.proposal_id, sodOn, loosen, stop, lift, paid: paid.proposal_id, no: no.proposal_id },
    secrets: [rotated.key, rotated.identity!.private_pem, ...rotated.identity!.private_pem.split("\n").filter((l) => l.length > 40)],
  };
}
