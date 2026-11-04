// npm run data-qa (src/finance/dataQa.ts): each ledger payment against Airwallex, Metal and the Books. Offline: the
// Airwallex GET and the chain receipt are fakes. Breaks if a wrong amount, a missing record, a reverted transaction or
// a payment the Books lack goes unreported, or if rows after the cut-off audit row are checked.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { airwallexDiffs, chainDiffs, ledgerPayments, renderReport, runDataQa, type ChainReceipt, type QaSources } from "../src/finance/dataQa.js";
import { USDZ } from "../src/metal/network.js";

const BUSINESS = "0x00000000000000000000000000000000000000b1";
const SUPPLIER = "0x00000000000000000000000000000000000000c2";
const TX1 = `0x${"1".repeat(64)}`;
const TX2 = `0x${"2".repeat(64)}`;
const E16 = 10n ** 16n;

function ledger() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business'), (?, 'supplier')").run(BUSINESS, SUPPLIER);
  const buy = db.prepare("INSERT INTO upstream_purchases (id, price_cents, tx_hash, outcome, refusal_reason, created_at) VALUES (?, ?, ?, ?, ?, '2026-10-30T07:00:00Z')");
  buy.run(1, 2, TX1, "PAID", null);
  buy.run(2, 2, TX2, "PAID", null);
  buy.run(3, 4, null, "REFUSED", "mandate_cap_exceeded");
  buy.run(4, 2, TX2, "PAID", null);
  audit(db, "sourcing", "upstream.paid", "1", { tx: TX1 });
  audit(db, "sourcing", "upstream.paid", "2", { tx: TX2 });
  audit(db, "sourcing", "upstream.refused", "3", { reason: "mandate_cap_exceeded" });
  audit(db, "sourcing", "upstream.paid", "4", { tx: TX2 }); // after the cut-off below
  return db;
}

const receipt = (over: Partial<ChainReceipt> = {}, value = 2n * E16): ChainReceipt => ({ status: "success", block: 7, from: BUSINESS, transfers: [{ token: USDZ, from: BUSINESS, to: SUPPLIER, value }], ...over });

describe("data QA", () => {
  it("reads payments only up to the cut-off audit row", () => {
    expect(ledgerPayments(ledger(), 3).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("matches what agrees, and reports a wrong amount, a reverted transaction and a refusal that has a transaction", async () => {
    const db = ledger();
    const chain: Record<string, ChainReceipt> = { [TX1]: receipt(), [TX2]: receipt({ status: "reverted" }, 3n * E16) };
    const src: QaSources = { receipt: async (tx) => chain[tx] ?? null, awxMissing: "no keys" };
    const checks = await runDataQa(db, ledgerPayments(db, 3), src, { usdz: USDZ });
    const of = (id: string, side: string) => checks.find((c) => c.id === id && c.side === side)!;
    expect(of("1", "Metal")).toMatchObject({ outcome: "match" });
    expect(of("1", "Books")).toMatchObject({ outcome: "match" });
    expect(of("2", "Metal").outcome).toBe("difference");
    expect(of("2", "Metal").detail).toMatch(/reverted.*no \*USDZ transfer of 0\.02.*the receipt has 0\.03/);
    expect(of("3", "Metal")).toMatchObject({ outcome: "match", detail: expect.stringMatching(/refused before any transaction/) });
    expect(of("3", "Books")).toMatchObject({ outcome: "match", detail: "not booked, as nothing moved" });
    const md = renderReport(ledgerPayments(db, 3), checks, { ledger: ":memory:", upto: 3, rows: 3, anchor: "test", generatedAt: "now", airwallex: "skipped", metal: "fake" });
    expect(md).toContain("| Metal upstream purchase | 3 | 6 | 5 | 1 | 0 |");
    expect(md).toContain("**Metal upstream purchase `2`** (Metal)");
  });

  it("skips a side with a note when its source is missing, and reports a record Airwallex lacks", async () => {
    const db = ledger();
    db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'h1', 'c1', '1234', 'n', 'EUR', 3000, 10000, 'ACTIVE', 'x', 'x')").run();
    db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES ('t1', 'c1', 'sourcing', 'Packwise', '5734', 1999, 'EUR', 'PENDING', 1, 'poll', '2026-10-30T07:00:00Z', 'x')").run();
    audit(db, "sourcing", "card.charge_approved", "t1", { agent: "sourcing", amount: "19.99", currency: "EUR" });
    const payments = ledgerPayments(db, 99).filter((p) => p.kind === "Airwallex card transaction");
    const none = await runDataQa(db, payments, { metalMissing: "no RPC" }, { usdz: USDZ });
    expect(none.find((c) => c.side === "Airwallex")).toMatchObject({ outcome: "skipped" });
    const gets: string[] = [];
    const missing = await runDataQa(db, payments, { awx: async (p) => { gets.push(p); return p.endsWith("/t1") ? Promise.reject(new Error("404")) : { items: [] }; } }, { usdz: USDZ });
    expect(missing.find((c) => c.side === "Airwallex")).toMatchObject({ outcome: "difference", detail: "Airwallex has no record with this id" });
    const found = await runDataQa(db, payments, { awx: async () => ({ card_transaction_id: "t1", transaction_amount: -19.99, transaction_currency: "EUR", status: "APPROVED" }) }, { usdz: USDZ });
    expect(found.find((c) => c.side === "Airwallex")).toMatchObject({ outcome: "match" });
    expect(found.find((c) => c.side === "Books")).toMatchObject({ outcome: "match" });
    expect(gets.every((p) => p.startsWith("/issuing/transactions"))).toBe(true);
  });

  // Breaks if a payment kind drops out of the cross-check: funding, sales (one by clearing), a refund, the sweep and
  // the mandate binds each become a payment with the chain and Books sides they must match.
  it("finds funding, sales, refunds, the sweep and mandate changes in the ledger", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business'), (?, 'owner'), (?, 'sweep')").run(BUSINESS, SUPPLIER, `0x${"d".repeat(40)}`);
    const sale = db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, scheme, tx_hash) VALUES (?, '/stock', 5, ?, 'u', '{}', 'DELIVERED', 'x', ?, ?)");
    sale.run(1, SUPPLIER, "exact", TX1);
    sale.run(2, SUPPLIER, "bajillion", null);
    db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (1, 1, 'rf-1', 5, ?, 'PAID', ?)").run(SUPPLIER, TX2);
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-1', 135, ?, 'PAID', 'x')").run(TX2);
    audit(db, "owner-signer", "business.funded", BUSINESS, { amount: "20.00", tx: TX1 });
    audit(db, "support", "sale.delivered", "1", {});
    audit(db, "support", "sale.delivered", "2", {});
    audit(db, "support", "refund.paid", "1", {});
    audit(db, "treasury", "sweep.paid", "sw-1", {});
    audit(db, "owner-signer", "mandate.bound", "sourcing", { tx: TX1, cap: "0.03", budget: "10.00" });
    audit(db, "owner-signer", "mandate.replaced", "sourcing", { tx: TX2, cap: "0.04", budget: "12.00", proposal_id: "P-0002" });
    const ps = ledgerPayments(db, 99);
    expect(ps.map((p) => p.kind)).toEqual(["Metal funding", "Metal sale", "Metal sale", "Metal refund", "Metal sweep", "Metal mandate", "Metal mandate"]);
    expect(ps[2]!.chain).toBeUndefined(); // a clearing sale has a receipt, not its own transaction
    expect(ps[3]!.chain?.transfer).toEqual({ from: BUSINESS, to: SUPPLIER, cents: 5 });
    expect(ps[6]!.ledger).toMatch(/replaced \(P-0002\): cap 0\.04, budget 12\.00/);
  });

  // Breaks if a transfer, conversion or deposit that differs at Airwallex is called a match, or if a lookup by id that
  // fails is not followed by the list lookup.
  it("compares transfers, conversions and deposits with Airwallex, by id and then by list", async () => {
    const transfer = { type: "transfer" as const, id: "tr1", amount: "1850.00", currency: "EUR", status: "PAID", fee: "EUR 13.41" };
    const same = await airwallexDiffs(async () => ({ transfer_amount: 1850, transfer_currency: "EUR", status: "PAID", fee_amount: 13.41, fee_currency: "EUR" }), transfer);
    expect(same).toMatchObject({ found: true, diffs: [] });
    const off = await airwallexDiffs(async () => ({ transfer_amount: "1850.5", transfer_currency: "EUR", status: "FAILED" }), transfer);
    expect(off).toMatchObject({ found: true, diffs: ["status: Airwallex FAILED, ledger PAID", "amount: Airwallex 1850.50, ledger 1850.00"] });
    await expect(airwallexDiffs(async () => { throw new Error("503"); }, transfer)).rejects.toThrow("503");

    const conversion = { type: "conversion" as const, id: "cv1", requestId: "rq1", buy: "370.00", buyCurrency: "EUR", sell: "418.40", sellCurrency: "USD", status: "SETTLED" };
    const paths: string[] = [];
    const listed = await airwallexDiffs(async (path) => {
      paths.push(path);
      if (path.startsWith("/fx/conversions/")) throw new Error("404");
      return { items: [{ request_id: "rq1", buy_amount: 370, buy_currency: "EUR", sell_amount: 418.4, sell_currency: "USD", status: "SETTLED" }], has_more: false };
    }, conversion);
    expect(listed).toMatchObject({ found: true, diffs: [] });
    expect(paths).toEqual(["/fx/conversions/cv1", "/fx/conversions"]);

    const deposit = { type: "deposit" as const, id: "dp1", amount: "1.35", currency: "USD", reference: "0xABC", since: "2026-10-29T00:00:00Z" };
    expect(await airwallexDiffs(async () => ({ amount: 1.35, currency: "USD", status: "SETTLED", reference: "0xabc" }), deposit)).toMatchObject({ found: true, diffs: [] });
    const none = await airwallexDiffs(async (path) => (path.startsWith("/deposits/") ? Promise.reject(new Error("404")) : { items: [{ id: "other" }], has_more: false }), deposit);
    expect(none).toEqual({ found: false });
  });

  it("reports a missing transaction, a revert and a wrong block on chain", () => {
    expect(chainDiffs(null, { tx: TX1 }, USDZ)).toEqual({ diffs: ["no such transaction on chain"], said: "not found" });
    const r = chainDiffs(receipt({ status: "reverted", block: 8 }), { tx: TX1, block: 7, transfer: { from: BUSINESS, to: SUPPLIER, cents: 2 } }, USDZ);
    expect(r.diffs).toEqual(["the transaction reverted on chain", "block: chain 8, ledger 7"]);
    expect(chainDiffs(receipt({ transfers: [] }), { tx: TX1, transfer: { from: BUSINESS, to: SUPPLIER, cents: 2 } }, USDZ).diffs[0]).toMatch(/the receipt has no \*USDZ transfer/);
  });
});
