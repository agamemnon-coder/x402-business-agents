// Agent run 1's record (docs/demo/agent-run.json): it holds the whole run's approvals, mandate replacements, refunds,
// sweep, refusals, the dispute case and each proposal's terms (src/demo/runLedger.ts), and nothing secret: no passkey
// credential id or assertion, no viewer key, no relay host or token, no private key.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scrub, secretsIn, type RunLedger } from "../src/demo/runLedger.js";

const RAW = readFileSync(new URL("../docs/demo/agent-run.json", import.meta.url), "utf8");
const rec = JSON.parse(RAW) as { ledger?: RunLedger };

describe("agent run 1's record", () => {
  it("holds no secret", () => {
    expect(secretsIn(RAW)).toEqual([]);
    expect(secretsIn(readFileSync(new URL("../docs/demo/autonomy.json", import.meta.url), "utf8"))).toEqual([]);
  });

  it("finds the secrets it guards against", () => {
    expect(secretsIn('{"credential_id":"Pya6Ldsoo5WzeAaohC8TkiY1-Xc"}')).toHaveLength(1);
    expect(secretsIn('"approver":"max (passkey Pya6Ldso)"')).toHaveLength(1);
    expect(secretsIn('"href":"https://purser-relay.example.workers.dev/#k=abcdefgh12345"').length).toBeGreaterThanOrEqual(1);
    expect(secretsIn('{"token": "x"}')).toHaveLength(1);
    expect(secretsIn('"href":"https://testnet.metalntwx.com/tx/0xabc"')).toEqual([]);
  });

  it("scrubs passkey ids and labels, Airwallex ids and balances, and keeps the rest", () => {
    const out = scrub({ approver: "max (passkey Pya6Ldso) + test-controller (passkey FbRa0Ia1)", passkey: { credential_id: "x", assertion_sha256: "y" }, tx: "0x1", terms: { amount: "240.00", beneficiary_id: "b", transfer_request_id: "r", balances_before: {}, iban_last4: "2051" }, origin: { request_id: "req_1" } });
    expect(out).toEqual({ approver: "max + test-controller", tx: "0x1", terms: { amount: "240.00" }, origin: { request_id: "req_1" } });
  });

  it("holds the whole run's approvals, both mandate replacements, the dispute case and the proposals' terms", () => {
    const l = rec.ledger!;
    expect(l).toBeTruthy();
    const ev = (e: string, s?: string) => l.events.filter((r) => r.event === e && (s === undefined || r.subject === s));
    expect(ev("proposal.cosigned", "P-0003")[0]!.payload).toMatchObject({ of: "1 of 2", approver: "max" });
    expect(ev("proposal.approved", "P-0003")[0]!.payload).toMatchObject({ approver: "max + test-controller" });
    expect(ev("mandate.replaced").map((r) => r.payload.tx)).toEqual(["0x563d4fff7bb58072ae0dbea4a6593c86af7020038286b44a31aeb875d297b152", "0x0e7f9d0a21b1a687fe13502981e4e2f01574949aa33001a8a99a802499ba2d8e"]);
    expect(ev("upstream.refused_on_chain")[0]!.payload.tx).toBe("0x3ad8de2f1a4896567f089786438418f0bf3be0d2c61807a9f157b89ed7d9a84d");
    expect(ev("refund.paid")).toHaveLength(3);
    expect(ev("proposal.failed", "P-0005")[0]!.payload.error).toMatch(/400 fee_unknown/);
    expect(l.proposals.map((p) => p.proposal_id)).toEqual(["P-0001", "P-0002", "P-0003", "P-0004", "P-0005"]);
    expect(l.proposals.find((p) => p.proposal_id === "P-0005")!.terms).toMatchObject({ amount: "240.00", currency: "EUR", vendor: "Stockline Data GmbH", method: "SWIFT" });
    expect(l.disputes).toHaveLength(1);
    expect((l.disputes[0]!.evidence as unknown[]).length).toBe(12);
  });
});
