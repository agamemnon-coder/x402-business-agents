// The Airwallex soak's record (src/e2e/airwallexSoakRecord.ts, `npm run airwallex:soak -- record`): built from the run's
// results, its call log and the HTTP status of each call only. Here on hand-made results: what it counts, which /proof
// band figures it says it would move, the refusal rows the band's walk would find, and what its Markdown shows for a
// matching payment, a mismatch, an error, a conversion, a negative control and an early stop.
import { describe, expect, it } from "vitest";
import type { CallLine } from "../src/airwallex/callBudget.js";
import { compareTransfer, SOAK_PASSKEY_LABEL, type NegativeResult, type PaymentResult, type SoakResults } from "../src/e2e/airwallexSoak.js";
import { refusalRowsIn, renderSoakMarkdown, soakRecord } from "../src/e2e/airwallexSoakRecord.js";

const SHA = "a".repeat(64);
const want = { sha: SHA, amount: "33.33", currency: "EUR", beneficiaryId: "ben-1", reference: "BTX-SOAK-01", requestId: "req-1" };
const paidRead = { id: "t1", request_id: "req-1", status: "PAID", transfer_amount: 33.33, transfer_currency: "EUR", beneficiary_id: "ben-1", reference: "BTX-SOAK-01", metadata: { approval_sha256: SHA } };

function payment(n: number, o: Partial<PaymentResult> = {}): PaymentResult {
  return {
    n, payee: "Bergtex", invoice_no: `BTX-SOAK-${String(n).padStart(2, "0")}`, amount: "33.33", currency: "EUR", why: "small", fx_planned: false,
    proposal_id: `P-${n}`, terms_sha256: SHA, signed_by: SOAK_PASSKEY_LABEL, transfer_request_id: `req-${n}`, conversion: null,
    transfer_id: `t${n}`, status_after_execute: "EXECUTED", create_sent_at: "2026-11-19T10:00:00.100Z", create_answered_at: "2026-11-19T10:00:00.300Z",
    paid_seen_at: "2026-11-19T10:00:01.250Z", create_to_paid_ms: 1150, readback: compareTransfer(paidRead, want), readback_at: "2026-11-19T10:00:02Z",
    calls: { total: 6, by_endpoint: { "POST /transfers/create": 1, "GET /transfers/{id}": 5 } }, started_at: "2026-11-19T10:00:00Z", ended_at: "2026-11-19T10:00:02Z", error: null,
    ...o,
  };
}

function negative(n: number, o: Partial<NegativeResult> = {}): NegativeResult {
  return {
    n, after_payment: 5, payee: "Bergtex", invoice_no: `BTX-SOAK-N0${n}`, amount: "12.00", fx_planned: false, tamper: "amount +0.01",
    changed: { field: "amount", from: "12.00", to: "12.01" }, proposal_id: `P-N${n}`, signed_sha256: SHA, transfer_request_id: `nreq-${n}`, conversion_request_id: null,
    refused: true, refusal: "the terms do not match the approved hash", at: "2026-11-19T11:00:00Z",
    calls_from_change_to_refusal: { total: 1, post: 0, by_endpoint: { "GET /balances/current": 1 } }, rail_creates_in_window: 0, ledger_transfer_rows: 0, ledger_conversion_rows: 0,
    airwallex_lookup: { transfer_found: false, conversion_found: null }, error: null,
    ...o,
  };
}

const call = (at: string, method: string, endpoint: string): CallLine => ({ at, method, endpoint, pid: 1 });
const CALLS: CallLine[] = [
  call("2026-11-19T09:59:00Z", "GET", "/balances/current"),
  call("2026-11-19T10:00:00Z", "POST", "/transfers/create"),
  call("2026-11-19T10:00:01Z", "GET", "/transfers/{id}"),
  call("2026-11-19T10:01:00Z", "POST", "/transfers/create"),
  call("2026-11-19T10:01:01Z", "GET", "/transfers/{id}"),
  call("2026-11-19T11:00:00Z", "GET", "/balances/current"),
];

function results(o: Partial<SoakResults> = {}): SoakResults {
  return {
    stream: "airwallex-soak", started_at: "2026-11-19T09:59:00Z", ended_at: "2026-11-19T11:00:01Z", mode: "live",
    setup: { calls: { total: 1, by_endpoint: { "GET /balances/current": 1 } }, balances_before: { EUR: "5000.00", USD: "2000.00" }, beneficiaries: { bergtex: "ben-1" }, floors: { EUR: "1000.00" } },
    payments: [payment(1), payment(2, { create_to_paid_ms: 2000 })], negatives: [negative(1)], stopped: null,
    ...o,
  };
}

describe("refusalRowsIn: the refusal rows the band's walk would find", () => {
  it("counts each audit-like row whose event is a refusal once, by its row hash or its event, time and subject", () => {
    expect(refusalRowsIn(null)).toBe(0);
    expect(refusalRowsIn({ event: "payment.executed", row_hash: "x" })).toBe(0);
    const row = { event: "proposal.refused", row_hash: "h1" };
    // The same row twice (by hash) counts once; nested in arrays and objects it is still found.
    expect(refusalRowsIn([row, { deeper: [row] }])).toBe(1);
    expect(refusalRowsIn([{ event: "card.declined", ts: "t", subject: "c1" }, { event: "card.declined", ts: "t", subject: "c1" }, { event: "fraud.flagged", ts: "t2" }, { event: "x.rejected" }])).toBe(3);
    expect(refusalRowsIn({ event: 7 })).toBe(0);
  });
});

describe("the soak record", () => {
  it("summarizes the run, counts the calls by endpoint and keeps the first and last", () => {
    const rec = soakRecord(results(), CALLS, [], { budget: 450, file: "docs/runs/2026-11-19-airwallex-soak.json" });
    expect(rec).toMatchObject({ stream: "airwallex-soak", sandbox: "api.sandbox.airwallex.com", test_money: true, stopped: null, budget: { approved: 450, used: 6 } });
    expect(rec.signer).toBe(`${SOAK_PASSKEY_LABEL} (no person's Face ID)`);
    expect(rec.summary).toMatchObject({ planned: 2, created: 2, paid: 2, readback_matches: 2 });
    expect(rec.calls).toMatchObject({ total: 6, first: "2026-11-19T09:59:00Z", last: "2026-11-19T11:00:00Z" });
    expect(rec.calls.by_endpoint).toEqual([
      { endpoint: "GET /balances/current", calls: 2 },
      { endpoint: "POST /transfers/create", calls: 2 },
      { endpoint: "GET /transfers/{id}", calls: 2 },
    ]);
  });

  it("says which band figures it would move: the calls and one run, and no refusal rows when it holds none", () => {
    const rec = soakRecord(results(), CALLS, [], { budget: 450, file: "docs/runs/x.json" });
    expect(rec.band.excluded).toMatch(/^docs\/runs\/x\.json and its \.md are in NOT_IN_BAND/);
    expect(rec.band.would_change_once_counted).toEqual([
      expect.objectContaining({ figure: "Airwallex sandbox API calls in the run records", by: 6 }),
      expect.objectContaining({ figure: "sandbox and testnet runs", by: 1 }),
    ]);
    expect(rec.band.unchanged.at(-1)).toMatch(/^refusals on record \(the record holds no audit row/);
  });

  it("counts refusal rows it carries as a band figure instead", () => {
    const rec = soakRecord(results({ negatives: [negative(1, { refusal: "refused" }), Object.assign(negative(2), { audit: [{ event: "proposal.refused", row_hash: "r2" }] })] }), CALLS, [], { budget: null, file: "f.json" });
    expect(rec.band.would_change_once_counted.at(-1)).toMatchObject({ figure: "refusals on record", by: 1 });
    expect(rec.band.unchanged.some((u) => u.startsWith("refusals on record"))).toBe(false);
  });

  it("has no first or last call when the log is empty", () => {
    const rec = soakRecord(results({ payments: [], negatives: [] }), [], [], { budget: null, file: "f.json" });
    expect(rec.calls).toMatchObject({ total: 0, first: null, last: null, by_endpoint: [] });
  });
});

describe("the soak record in Markdown", () => {
  it("shows the aggregates, each payment's read-back and timing, each negative control and the band", () => {
    const fx = payment(3, {
      fx_planned: true,
      conversion: { conversion_id: "c1", quote_id: "q1", request_id: "cr1", buy: "40.00", sell: "43.10", client_rate: "0.928", readback: { found: 1, conversion_id: "c1", status: "SETTLED", buy_amount: "40.00", sell_amount: "43.10", approval_sha256: SHA, all_match: true, differences: [] } },
    });
    const mismatch = payment(4, { readback: compareTransfer({ ...paidRead, transfer_amount: 33.34, metadata: { approval_sha256: "b".repeat(64) } }, want), create_to_paid_ms: null, paid_seen_at: null });
    const failed = payment(5, { error: "HTTP 400 at create", transfer_id: null, readback: null, create_to_paid_ms: null, create_sent_at: null });
    const fxOff = payment(6, { conversion: { conversion_id: null, quote_id: "q2", request_id: "cr2", buy: "1.00", sell: "1.08", client_rate: "0.93", readback: { found: 0, conversion_id: null, status: null, buy_amount: null, sell_amount: null, approval_sha256: null, all_match: false, differences: ["not found"] } } });
    const fxNoRead = payment(7, { conversion: { conversion_id: null, quote_id: "q3", request_id: "cr3", buy: "1.00", sell: "1.08", client_rate: "0.93", readback: null } });
    const negs = [
      negative(1),
      negative(2, { tamper: "conversion.buy_amount +0.01", changed: null, refused: false, refusal: null, calls_from_change_to_refusal: { total: 0, post: 0, by_endpoint: {} }, airwallex_lookup: { transfer_found: true, conversion_found: true } }),
      negative(3, { error: "the ledger was locked", airwallex_lookup: null }),
      negative(4, { airwallex_lookup: { transfer_found: false, conversion_found: false } }),
    ];
    const r = results({ payments: [payment(1), fx, mismatch, failed, fxOff, fxNoRead], negatives: negs, stopped: "the budget would be exceeded | stop" });
    const http = [
      { at: "t1", method: "POST", endpoint: "/transfers/create", status: 201 },
      { at: "t2", method: "GET", endpoint: "/transfers/{id}", status: 429 },
      { at: "t3", method: "POST", endpoint: "/transfers/create", status: 400 },
    ];
    const rec = soakRecord(r, CALLS, http, { budget: 450, file: "docs/runs/d.json" });
    const md = renderSoakMarkdown(rec, "2026-11-19");

    expect(md).toMatch(/^# Airwallex soak, 2026-11-19: 30 supplier payments/);
    expect(md).toContain(`**Signed by the ${SOAK_PASSKEY_LABEL} (no person's Face ID).**`);
    // An early stop is said, a pipe in it escaped.
    expect(md).toContain("**Stopped early:** the budget would be exceeded \\| stop");
    expect(md).toContain("| Transfers created | 5/6 |");
    expect(md).toContain("| PAID at Airwallex (read back; simulated) | 5/6 |");
    expect(md).toContain("| HTTP 429 answers / other non-2xx | 1 / 1 |");
    expect(md).toContain("| Errors | payment 5: HTTP 400 at create; negative 3: the ledger was locked |");
    expect(md).toContain("| Negative controls refused before any create | 3/4 |");
    expect(md).toContain("| Calls from the one-cent change to the refusal: total / POST / creates | 3 / 0 / 0 (3 GET /balances/current) |");
    expect(md).toContain("| Airwallex calls in all (budget) | 6 (450) |");

    const row = (n: number) => md.split("\n").find((l) => l.startsWith(`| ${n} | BTX-SOAK-0${n} |`))!;
    expect(row(1)).toContain("| PAID, match | 10:00:00.100 → 10:00:01.250 | 1150 | 6 |");
    expect(row(1)).toContain(`\`${SHA}\` =`);
    expect(row(3)).toContain("USD 43.10 at 0.928; read back, match");
    expect(row(4)).toContain("MISMATCH: approval_sha256, amount");
    expect(row(4)).toContain(`\`${SHA}\` ≠`);
    expect(row(4)).toContain("| — | — |");
    expect(row(5)).toContain("ERROR HTTP 400 at create");
    expect(row(6)).toContain("read back: not found");
    expect(row(7)).toContain("read back: —");

    const neg = (n: number) => md.split("\n").find((l) => l.startsWith(`| ${n} | 5 | BTX-SOAK-N0${n} |`))!;
    expect(neg(1)).toBe("| 1 | 5 | BTX-SOAK-N01 | amount +0.01: amount 12.00 → 12.01 | yes | 1 (0): 1 GET /balances/current | none / — | the terms do not match the approved hash |");
    expect(neg(2)).toBe("| 2 | 5 | BTX-SOAK-N02 | conversion.buy_amount +0.01 | NO | 0 (0) | FOUND / FOUND | — |");
    expect(neg(3)).toContain("| — | ERROR the ledger was locked |");
    expect(neg(4)).toContain("| none / none |");

    expect(md).toContain("| `GET /balances/current` | 2 |");
    expect(md).toContain("| **Total** | **6** |");
    expect(md).toContain("First call 2026-11-19T09:59:00Z, last 2026-11-19T11:00:00Z. Setup: 1 GET /balances/current; balances before: EUR 5000.00, USD 2000.00.");
    expect(md).toContain("- Airwallex sandbox API calls in the run records: +6 (");
    expect(md).toContain("- Unchanged: tests passing; Alta testnet transactions (none in this record)");
  });

  it("writes dashes for what a run without latencies, budget or HTTP statuses does not have", () => {
    const r = results({ payments: [payment(1, { create_to_paid_ms: null, readback: null })], negatives: [] });
    const rec = soakRecord(r, [], null as unknown as [], { budget: null, file: "f.json" });
    const md = renderSoakMarkdown(rec, "2026-11-20");
    expect(md).not.toContain("Stopped early");
    expect(md).toContain("| create→PAID latency p50 / p95 (min, max) | — |");
    expect(md).toContain("| Airwallex calls in all (budget) | 0 (—) |");
    expect(md).toContain("| HTTP 429 answers / other non-2xx | — |");
    expect(md).toContain("| Errors | none |");
    expect(md).toContain("| Calls from the one-cent change to the refusal: total / POST / creates | 0 / 0 / 0 |");
    expect(md).toContain("First call —, last —.");
    expect(md.split("\n").find((l) => l.startsWith("| 1 | BTX-SOAK-01 |"))).toContain("| —, — |");
  });
});
