// What a run's record takes from its ledger for the pages (src/demo/runLedger.ts runLedger): the rows of the events the
// pages show (and every sweep.* and transfer.* row), each proposal's terms and the dispute case, all public-safe: no
// passkey label or credential id, no IBAN, no Airwallex request id on an FX row or a proposal's quote, a mandate's
// credential hash renamed. A row without a payload is kept, empty, never dropped.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { audit } from "../src/audit/log.js";
import { runLedger, scrub, secretsIn } from "../src/demo/runLedger.js";
import { createProposal } from "../src/policy/approvals.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";

const T0 = new Date("2026-11-03T10:00:00Z");
const expires = "2026-11-03T11:00:00Z";

describe("the run's ledger for the pages", () => {
  it("keeps the shown events and every sweep and transfer row, in order, and leaves the rest out", () => {
    const db = openDb(":memory:");
    audit(db, "treasury", "fx.converted", "conv_1", { request_id: "awx-req-1", sell: "USD 676.39", buy: "EUR 623.40", origin: { actor: "code", rule: "r" } }, T0);
    audit(db, "system", "agent.run", "wake", { status: "done" }, T0);
    audit(db, "treasury", "sweep.paid", "sw-1", null, T0);
    audit(db, "awx-executor", "transfer.status", "tr_1", { status: "PAID", beneficiary_id: "ben_1", iban: "DE89370400440532013000" }, T0);
    audit(db, "cfo", "proposal.approved", "P-0001", { approver: "Max (passkey AbCdEf123)", credential_id: "cred-xyz", mandate: { credential_hash: "0x11" } }, T0);
    const r = runLedger(db);
    expect(r.events.map((e) => e.event)).toEqual(["fx.converted", "sweep.paid", "transfer.status", "proposal.approved"]);
    expect(r.events[0]!.payload).toMatchObject({ sell: "USD 676.39", buy: "EUR 623.40" });
    expect(r.events[0]!.payload).not.toHaveProperty("request_id");
    expect(r.events[1]!.payload).toEqual({});
    expect(r.events[2]!.payload).toEqual({ status: "PAID" });
    expect(r.events[3]!.payload).toEqual({ approver: "Max", mandate: { mandate_hash: "0x11" } });
    expect(secretsIn(JSON.stringify(r))).toEqual([]);
  });

  it("gives each proposal's terms without its quote's request id, and the dispute case with its evidence", () => {
    const db = openDb(":memory:");
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0001", expires_at: expires, amount: "1850.00", conversion: { quote_id: "q_1", request_id: "awx-req-2", sell_amount: "676.39" } } as unknown as Terms, createdBy: "treasury" }, T0);
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0002", expires_at: expires, total: "0.15", conversion: null } as unknown as Terms, createdBy: "support" }, T0);
    db.prepare("INSERT INTO disputes (dispute_id, customer, email_sha256, claims_json, evidence_json, verdicts_json, created_at) VALUES ('D-1', '0xcust', 'e', '[{\"sale\":7}]', NULL, 'oops', '2026-11-03T10:05:00Z')").run();
    const r = runLedger(db);
    expect(r.proposals.map((p) => [p.proposal_id, p.kind, p.created_by])).toEqual([["P-0001", "invoice_payment", "treasury"], ["P-0002", "refund_batch", "support"]]);
    expect(r.proposals[0]!.terms.conversion).toEqual({ quote_id: "q_1", sell_amount: "676.39" });
    expect(r.proposals[1]!.terms.conversion).toBeNull();
    expect(r.disputes).toEqual([{ dispute_id: "D-1", customer: "0xcust", created_at: "2026-11-03T10:05:00Z", claims: [{ sale: 7 }], evidence: null, verdicts: null }]);
  });

  it("scrubs nested keys and labels, and finds what must never be published", () => {
    expect(scrub({ a: [{ relay: "h", note: "signed (passkey Zz9_-x)" }], credential_hash: "0x1", replaces_credential_hash: "0x2", n: 3 })).toEqual({ a: [{ note: "signed" }], mandate_hash: "0x1", replaces_mandate_hash: "0x2", n: 3 });
    expect(secretsIn('{"credential_id":"x"} https://relay.example.workers.dev/ "secret": 1 #view=abcdefgh12')).toEqual([
      "passkey credential id: \"credential_id\"",
      "viewer key: #view=abcdefgh12",
      "relay host: https://relay.example.workers.dev",
      "private key: \"secret\":",
    ]);
  });
});
