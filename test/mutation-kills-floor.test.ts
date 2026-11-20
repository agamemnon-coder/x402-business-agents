// Mutation testing, 20 November (docs/evidence/mutation-testing.md, group floor): the gaps the mutants of the floor policy
// showed. No test file imported src/policy/payoutLock.ts, the one lock and ledger of money spoken for that both payout
// executors judge the EUR and USD floors under, so none of its mutants was reached by a test that imports it; and the
// treasury's boundaries (free euros exactly equal to what is needed, a quote that leaves USD exactly at its floor, the
// fee reserve at its cap) were not all pinned. Breaks if the lock lets two payout steps overlap or stops after a failed
// one, if a hold can be negative, counts after its release or in another currency or for the payment being judged, if
// Purser's fee on a payout not yet at Airwallex stops counting, or if a floor boundary moves by a cent.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { exclusive, heldPayoutCents, holdPayout, owedPlatformFeeCents, releasePayout } from "../src/policy/payoutLock.js";
import {
  checkQuoteAgainstFloor, feeReserveCents, feeReserveOverCap, freeEurCents, planInvoice, proposalExpiry, SWIFT_FEE_BUFFER, SWIFT_FEE_RESERVE_CAP_CENTS,
} from "../src/policy/treasury.js";
import { SWIFT_FEE_MAX_EUR_CENTS } from "../src/config/policy.js";

const reservations = (db: DB) => db.prepare("SELECT key, proposal_id, currency, cents, status FROM payout_reservations ORDER BY key").all();

describe("the payout lock (exclusive)", () => {
  it("runs one step at a time, in the order asked, each after the one before has finished", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = exclusive(async () => { log.push("first:start"); await gate; log.push("first:end"); return 1; });
    const second = exclusive(() => { log.push("second"); return 2; });
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(["first:start"]);
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(log).toEqual(["first:start", "first:end", "second"]);
  });

  it("passes a step's failure to its caller and still runs the next step", async () => {
    const failed = exclusive(async () => { throw new Error("balance read failed"); });
    const next = exclusive(() => "ran");
    await expect(failed).rejects.toThrow("balance read failed");
    expect(await next).toBe("ran");
  });
});

describe("payout holds", () => {
  it("holds under a key, never below zero, and a second hold under the same key replaces the first and holds again", () => {
    const db = openDb(":memory:");
    holdPayout(db, "P-0001", "rq-1", "EUR", 12_000);
    holdPayout(db, "P-0001", "rq-2", "USD", -500);
    expect(reservations(db)).toEqual([
      { key: "rq-1", proposal_id: "P-0001", currency: "EUR", cents: 12_000, status: "HELD" },
      { key: "rq-2", proposal_id: "P-0001", currency: "USD", cents: 0, status: "HELD" },
    ]);
    releasePayout(db, "rq-1");
    holdPayout(db, "P-0001", "rq-1", "USD", 7_000);
    expect(reservations(db)[0]).toEqual({ key: "rq-1", proposal_id: "P-0001", currency: "USD", cents: 7_000, status: "HELD" });
  });

  it("counts held money per currency, leaves out released holds and the payment being judged", () => {
    const db = openDb(":memory:");
    holdPayout(db, "P-0001", "a", "EUR", 10_000);
    holdPayout(db, "P-0002", "b", "EUR", 2_500);
    holdPayout(db, "P-0003", "c", "USD", 900);
    holdPayout(db, "P-0004", "d", "EUR", 400);
    releasePayout(db, "d");
    releasePayout(db, "nothing-held-under-this-key");
    expect(heldPayoutCents(db, "EUR")).toBe(12_500);
    expect(heldPayoutCents(db, "USD")).toBe(900);
    expect(heldPayoutCents(db, "EUR", "P-0001")).toBe(2_500);
    expect(heldPayoutCents(db, "GBP")).toBe(0);
    expect(reservations(db).find((r) => (r as { key: string }).key === "d")).toMatchObject({ status: "RELEASED" });
  });

  it("is zero on a ledger from before the holds and Purser's fees (no tables)", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE payout_reservations; DROP TABLE platform_fees");
    expect(heldPayoutCents(db, "EUR")).toBe(0);
    expect(owedPlatformFeeCents(db, "EUR")).toBe(0);
  });
});

describe("Purser's fees still owed with a payout not yet at Airwallex", () => {
  it("counts a DUE fee whose payout row is SUBMITTING, in its currency, except the payment being judged; to the cent", () => {
    const db = openDb(":memory:");
    db.pragma("foreign_keys = OFF");
    const transfer = db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, '100.00', 'EUR', 'SWIFT', '20.00', ?, 'h', 'x')");
    const fee = db.prepare("INSERT INTO platform_fees (request_id, proposal_id, payout_request_id, amount, currency, destination, status, approval_sha256, updated_at) VALUES (?, ?, ?, ?, ?, 'acct', ?, 'h', 'x')");
    transfer.run("pay-1", "I-1", "SUBMITTING");
    transfer.run("pay-2", "I-2", "SUBMITTING");
    transfer.run("pay-3", "I-3", "PAID");
    transfer.run("pay-4", "I-4", "SUBMITTING");
    fee.run("fee-1", "P-0001", "pay-1", "1.15", "EUR", "DUE");
    fee.run("fee-2", "P-0002", "pay-2", "2.29", "EUR", "DUE");
    fee.run("fee-3", "P-0003", "pay-3", "5.00", "EUR", "DUE"); // its payout is at Airwallex: in its balance already
    fee.run("fee-4", "P-0004", "pay-4", "7.00", "EUR", "SETTLED");
    fee.run("fee-5", "P-0005", "pay-4", "0.70", "USD", "DUE");
    expect(owedPlatformFeeCents(db, "EUR")).toBe(344);
    expect(owedPlatformFeeCents(db, "EUR", "P-0002")).toBe(115);
    expect(owedPlatformFeeCents(db, "USD")).toBe(70);
  });
});

describe("the treasury's floors", () => {
  const s = { eurAvailableCents: 500_000, eurFloorCents: 100_000, eurObligationsCents: 50_000, usdAvailableCents: 300_000, usdFloorCents: 200_000 };

  it("free euros: available minus floor, commitments and payouts under way", () => {
    expect(freeEurCents(s)).toBe(350_000);
    expect(freeEurCents({ ...s, eurInFlightCents: 25_000 })).toBe(325_000);
  });

  it("pays from euros when free euros are exactly what is needed, converts the cent short of it, and plans nothing below the floor", () => {
    const fee = SWIFT_FEE_MAX_EUR_CENTS;
    expect(planInvoice(350_000 - fee, s)).toEqual({ kind: "pay_from_eur", needEurCents: 350_000, freeEurCents: 350_000 });
    expect(planInvoice(350_001 - fee, s)).toEqual({ kind: "convert_shortfall", needEurCents: 350_001, freeEurCents: 350_000, buyEurCents: 1 });
    expect(planInvoice(1_000, { ...s, eurAvailableCents: 150_000 })).toEqual({ kind: "convert_shortfall", needEurCents: 1_000 + fee, freeEurCents: 0, buyEurCents: 1_000 + fee });
    expect(planInvoice(1_000, { ...s, eurAvailableCents: 149_999 })).toEqual({ kind: "underfunded", needEurCents: 1_000 + fee, freeEurCents: -1 });
  });

  it("refuses an amount that is not a positive whole number of cents, and a fee reserve under the ceiling", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 2 ** 53]) expect(() => planInvoice(bad, s)).toThrow(`bad invoice amount: ${bad}`);
    expect(() => planInvoice(100, s, SWIFT_FEE_MAX_EUR_CENTS - 1)).toThrow(`bad fee reserve: ${SWIFT_FEE_MAX_EUR_CENTS - 1}`);
    expect(() => planInvoice(100, s, 2500.5)).toThrow("bad fee reserve: 2500.5");
    expect(planInvoice(100, s, SWIFT_FEE_MAX_EUR_CENTS + 1).needEurCents).toBe(100 + SWIFT_FEE_MAX_EUR_CENTS + 1);
  });

  it("a quote may leave USD exactly at its floor, not a cent under, and says by how much it would fall", () => {
    expect(checkQuoteAgainstFloor(100_000, s)).toEqual({ ok: true, usdAfterCents: 200_000 });
    expect(checkQuoteAgainstFloor(100_001, s)).toEqual({ ok: false, usdAfterCents: 199_999, reason: "USD would drop to 1999.99, under its floor of 2000.00" });
    expect(checkQuoteAgainstFloor(300_050, s)).toEqual({ ok: false, usdAfterCents: -50, reason: "USD would drop to -0.50, under its floor of 2000.00" });
  });

  it("the fee reserve: the highest fee plus the buffer, rounded up, between the ceiling and its cap; over the cap is a person's question", () => {
    expect(SWIFT_FEE_BUFFER).toBe(1.25);
    expect(feeReserveCents([1_000, 2_001, 1_500])).toBe(Math.ceil(2_001 * 1.25));
    expect(feeReserveCents([-5])).toBe(SWIFT_FEE_MAX_EUR_CENTS);
    const cap = SWIFT_FEE_RESERVE_CAP_CENTS;
    expect(feeReserveOverCap([cap / 1.25])).toBe(false);
    expect(feeReserveOverCap([cap / 1.25 + 1])).toBe(true);
    expect(feeReserveOverCap([])).toBe(false);
  });

  it("a proposal expires at its time to live, or 30 seconds before its quote when that is earlier", () => {
    expect(proposalExpiry(1_000, 600_000)).toBe(601_000);
    expect(proposalExpiry(1_000, 600_000, 200_000)).toBe(170_000);
    expect(proposalExpiry(1_000, 600_000, 900_000)).toBe(601_000);
    expect(proposalExpiry(1_000, 600_000, 200_000, 10_000)).toBe(190_000);
  });
});
