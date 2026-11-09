// The transactions register: every rail appears, refused attempts never count as money moved, totals per currency,
// each reconciliation state constructed on purpose, the approval check, and the CSV export matching the list.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { filterRows, registerCsv, transactionRegister, type TxRow } from "../src/money/register.js";

const NOW = new Date("2026-11-09T10:00:00Z");
const SHA_OK = "a".repeat(64);
const SHA_NONE = "b".repeat(64);
const SHA_FX = "c".repeat(64);
let db: DB;

/** A small world with one movement (and one failed attempt) on every rail. */
function world(d: DB): void {
  const run = (sql: string, ...p: unknown[]) => d.prepare(sql).run(...p);
  run("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES ('ben_1', 'Bergtex Textil GmbH', '3000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT', 'ACTIVE')", "d".repeat(64));
  for (const no of ["BTX-1", "BTX-2", "BTX-3"]) run("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES (?, 'Bergtex Textil GmbH', '100.00', 'EUR', '2026-11-30', ?, 'COBADEFFXXX', 'ben_1', ?, 'OPEN')", no, "d".repeat(64), "e".repeat(64));
  run("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-1', 'invoice_payment', '{}', ?, 'treasury', 'EXECUTED', '2026-11-10', '2026-11-01')", SHA_OK);
  run("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-1', 'APPROVED', ?, 'cfo', 'passkey', '', '2026-11-01T09:00:00Z')", SHA_OK);
  run("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-2', 'fx', '{}', ?, 'treasury', 'EXECUTED', '2026-11-10', '2026-11-01')", SHA_FX);
  run("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-2', 'APPROVED', ?, 'cfo', 'passkey', '', '2026-11-01T09:05:00Z')", SHA_FX);
  // Transfers: one paid with a fee, one failed, one paid without any approval on file.
  run("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('tr_1', 'req-1', 'BTX-1', '100.00', 'EUR', 'SWIFT', 'EUR 15.00', 'EUR 12.50', 'PAID', ?, '2026-11-02T10:00:00Z')", SHA_OK);
  run("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, failure_reason, approval_sha256, updated_at) VALUES (NULL, 'req-2', 'BTX-2', '100.00', 'EUR', 'SWIFT', 'EUR 15.00', 'FAILED', 'beneficiary rejected', ?, '2026-11-03T10:00:00Z')", SHA_OK);
  run("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr_3', 'req-3', 'BTX-3', '100.00', 'EUR', 'SWIFT', 'EUR 15.00', 'PAID', ?, '2026-11-04T10:00:00Z')", SHA_NONE);
  // FX: EUR sold, USD bought.
  run("INSERT INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES ('q1', 'EUR/USD', '110.00', '100.00', '1.1', '2026-11-05T10:00:00Z', '2026-11-05T10:15:00Z')");
  run("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES ('conv_1', 'q1', 'fx-1', '110.00', '100.00', 'SETTLED', ?)", SHA_FX);
  // Card: a charge and a decline.
  run("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('support', 'ch_1', 'card_1', '4242', 'support', 'EUR', 10000, 50000, 'ACTIVE', '2026-11-01', '2026-11-01')");
  run("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES ('ctx_1', 'card_1', 'support', 'Helpdesk SaaS', '5734', 4900, 'EUR', 'APPROVED', 1, 'simulation', '2026-11-06T10:00:00Z', '2026-11-06T10:00:01Z')");
  run("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, source, occurred_at, recorded_at) VALUES ('ctx_2', 'card_1', 'support', 'Casino', '7995', 9900, 'EUR', 'DECLINED', 0, 'merchant category not allowed', 'simulation', '2026-11-06T11:00:00Z', '2026-11-06T11:00:01Z')");
  // Metal: a sale, a paid and a refused purchase, a refund, a sweep and its credit.
  run("INSERT INTO upstream_purchases (id, price_cents, tx_hash, outcome, created_at) VALUES (1, 3, '0xup1', 'PAID', '2026-11-07T09:00:00Z')");
  run("INSERT INTO upstream_purchases (id, price_cents, outcome, refusal_reason, created_at) VALUES (2, 3, 'REFUSED', 'mandate_cap_exceeded', '2026-11-07T09:01:00Z')");
  run("INSERT INTO sales (sale_id, route, price_cents, payer, tx_hash, request_url, request_params_json, status, created_at, upstream_purchase_id) VALUES (1, '/stock', 5, '0xretailer000000000000', '0xsale1', 'http://x', '{}', 'DELIVERED', '2026-11-07T09:00:01Z', 1)");
  run("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (2, '/stock', 5, '0xretailer000000000000', 'http://x', '{}', 'ABORTED_NO_CHARGE', '2026-11-07T09:01:01Z')");
  run("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (1, 1, 'pay-r1', 5, '0xretailer000000000000', 'PAID', '0xref1')");
  run("INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_deposit_id, awx_reference, created_at) VALUES ('ev1', '0xsw1', '0xa', '0xb', '20000000000000000', 10, 12, 'dep_1', 'ref', '2026-11-08T10:05:00Z')");
  run("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, event_key, created_at) VALUES ('sw-1', 2, '0xsw1', 'PAID', 'ev1', '2026-11-08T10:00:00Z')");
  // Metal clearing: earnings withdrawn into the wallet. Airi: a single-use card purchase.
  run("INSERT INTO clearing_ops (id, party, kind, units, tx, created_at) VALUES (1, 'seller', 'withdraw', '30000000000000000', '0xclr1', '2026-11-08T11:00:00Z')");
  run("INSERT INTO airi_purchases (action_id, agent, route, order_sha256, terms_json, cents, day, status, mandate_id, checkout_ref, created_at, updated_at) VALUES ('act-1', 'support', 'alone', ?, ?, 1200, '2026-11-08', 'SETTLED', 'm-1', 'chk-1', '2026-11-08T13:00:00Z', '2026-11-08T13:00:05Z')",
    "f".repeat(64), JSON.stringify({ currency: "EUR", amount: "12.00", merchant: { name: "Office Store" } }));
  // Money in at a Global Account.
  run("INSERT INTO receivables (invoice_no, customer, currency, amount_cents, paid_cents, due_date, status, issued_at) VALUES ('NW-1', 'Ridgeline Outfitters', 'EUR', 50000, 50000, '2026-11-30', 'PAID', '2026-11-01')");
  run("INSERT INTO receipts (deposit_id, currency, amount_cents, payer, invoice_no, applied_cents, outcome, detail, received_at) VALUES ('dep_in_1', 'EUR', 50000, 'Ridgeline Outfitters', 'NW-1', 50000, 'MATCHED', 'ok', '2026-11-08T12:00:00Z')");
}

const by = (rows: TxRow[], id: string) => rows.find((r) => r.id === id)!;

beforeEach(() => {
  db = openDb(":memory:");
  world(db);
});

describe("the transactions register", () => {
  it("lists every rail, refused and failed attempts included", () => {
    const { rows } = transactionRegister(db);
    expect(new Set(rows.map((r) => r.rail))).toEqual(new Set(["airwallex_transfer", "airwallex_fx", "airwallex_card", "airwallex_airi", "airwallex_receipt", "metal", "metal_clearing"]));
    expect(by(rows, "transfer:req-2")).toMatchObject({ moved: false, status_words: "failed: beneficiary rejected" });
    expect(by(rows, "card:ctx_2")).toMatchObject({ moved: false, status_words: "declined by Airwallex: merchant category not allowed" });
    expect(by(rows, "upstream:2")).toMatchObject({ moved: false, status_words: "refused: mandate_cap_exceeded" });
    expect(by(rows, "sale:2")).toMatchObject({ moved: false, status_words: "aborted, not charged" });
    expect(by(rows, "fx:conv_1:sell")).toMatchObject({ direction: "internal", amount: "100.00", currency: "EUR", eur_equivalent: "100.00" });
    expect(by(rows, "fx:conv_1:buy")).toMatchObject({ direction: "internal", amount: "110.00", currency: "USD", eur_equivalent: "100.00" });
    // The payee's account appears masked only.
    expect(by(rows, "transfer:req-1").counterparty_account).toBe("…3000");
    expect(JSON.stringify(rows)).not.toMatch(/DE\d{20}/);
    // Newest first.
    expect(rows.map((r) => r.at)).toEqual([...rows.map((r) => r.at)].sort().reverse());
  });

  it("never counts an attempt that did not move money, and totals per currency", () => {
    const { totals } = transactionRegister(db);
    const eur = totals.find((t) => t.currency === "EUR")!;
    // Out: two paid transfers (100 + 100) and one card charge (49); the failed transfer and the decline never count.
    expect(eur).toMatchObject({ in: "500.00", out: "261.00", internal_out: "100.00", fees: "12.50", moved: 6, not_moved: 2 });
    expect(totals.find((t) => t.currency === "USD")).toMatchObject({ internal_in: "110.02", internal_out: "0.00" });
    // Metal: 0.05 in, 0.03 paid out and 0.05 refunded; the refused purchase and the aborted sale count nowhere.
    expect(totals.find((t) => t.currency === "USDZ")).toMatchObject({ in: "0.05", out: "0.08", internal_in: "0.03", internal_out: "0.05", not_moved: 2 });
  });

  it("flags money that moved without the CFO's approval", () => {
    const r = transactionRegister(db);
    expect(by(r.rows, "transfer:req-1").approval).toMatchObject({ required: true, proposal_id: "P-1", decision: "APPROVED", method: "passkey" });
    expect(by(r.rows, "transfer:req-3").flags).toContain("no_approval");
    expect(r.check.without_approval).toEqual(["transfer:req-3"]);
    // A card charge needs no approval of its own: the card's limits carry it.
    expect(by(r.rows, "card:ctx_1").approval.required).toBe(false);
  });

  it("is unbooked until the ledger is synced, then matched to the cent", () => {
    const before = transactionRegister(db);
    expect(by(before.rows, "transfer:req-1").reconciliation).toBe("missing_booking");
    expect(before.check.without_booking.length).toBe(before.check.moved);
    syncLedger(db, NOW);
    const after = transactionRegister(db);
    // Every rail the ledger feed books is matched; Airi purchases are not booked by the feed yet, and the register says so.
    for (const r of after.rows.filter((x) => x.moved && x.rail !== "airwallex_airi")) expect([r.id, r.reconciliation]).toEqual([r.id, "matched"]);
    expect(by(after.rows, "airi:act-1").reconciliation).toBe("missing_booking");
    expect(by(after.rows, "transfer:req-1").booking.booked).toBe("-112.50");
    expect(after.check).toMatchObject({ unreconciled: 1, without_booking: ["airi:act-1"], bookings_without_movement: [] });
    for (const r of after.rows.filter((x) => !x.moved)) expect(r.reconciliation).toBe("not_applicable");
  });

  it("says when a movement has no proof from its rail", () => {
    db.prepare("UPDATE transfers SET transfer_id = NULL WHERE request_id = 'req-1'").run();
    syncLedger(db, NOW);
    const row = by(transactionRegister(db).rows, "transfer:req-1");
    expect(row).toMatchObject({ reconciliation: "missing_rail_record" });
    expect(row.flags).toContain("no_proof");
  });

  it("says when the booking differs from the movement", () => {
    syncLedger(db, NOW);
    // The rail record changes after it was booked (an amount corrected at Airwallex), and the ledger has not caught up.
    db.prepare("UPDATE card_transactions SET amount_cents = 5900 WHERE transaction_id = 'ctx_1'").run();
    const r = transactionRegister(db);
    // The card's identity includes its amount, so the old posting no longer belongs to it: unbooked, and the old one is orphaned.
    expect(by(r.rows, "card:ctx_1").reconciliation).toBe("missing_booking");
    expect(r.check.bookings_without_movement.length).toBe(1);
    db.prepare("UPDATE card_transactions SET amount_cents = 4900 WHERE transaction_id = 'ctx_1'").run();
    db.prepare("UPDATE transfers SET amount = '90.00' WHERE request_id = 'req-1'").run();
    const t = by(transactionRegister(db).rows, "transfer:req-1");
    expect(t.reconciliation).toBe("amount_mismatch");
    expect(t.booking.booked).toBe("-112.50");
  });

  it("says when something is booked although nothing moved", () => {
    syncLedger(db, NOW);
    db.prepare("UPDATE transfers SET status = 'FAILED' WHERE request_id = 'req-1'").run();
    const r = transactionRegister(db);
    expect(by(r.rows, "transfer:req-1")).toMatchObject({ moved: false, reconciliation: "amount_mismatch", flags: ["booked_not_moved"] });
    expect(r.check.amount_mismatch).toContain("transfer:req-1");
  });

  it("ignores postings that are not the feed's, and filters", () => {
    postEntry(db, { date: "2026-11-01", description: "manual", created_by: "accountant", lines: [{ account: "1200", debit: 100, currency: "EUR" }, { account: "4000", credit: 100, currency: "EUR" }] }, NOW);
    const r = transactionRegister(db);
    expect(r.check.bookings_without_movement).toEqual([]);
    expect(filterRows(r.rows, { rail: "metal", moved: false }).map((x) => x.id).sort()).toEqual(["sale:2", "upstream:2"]);
    expect(filterRows(r.rows, { currency: "USD" }).map((x) => x.id).sort()).toEqual(["credit:ev1", "fx:conv_1:buy"]);
    expect(filterRows(r.rows, { from: "2026-11-06", to: "2026-11-06" }).map((x) => x.id).sort()).toEqual(["card:ctx_1", "card:ctx_2"]);
    expect(filterRows(r.rows, { q: "bergtex" }).length).toBe(3);
  });

  it("exports the same rows as CSV, one line each, formulas defused", () => {
    db.prepare("UPDATE card_transactions SET merchant = '=HYPERLINK(1)' WHERE transaction_id = 'ctx_2'").run();
    const { rows } = transactionRegister(db);
    const csv = registerCsv(rows).trimEnd().split("\r\n");
    expect(csv).toHaveLength(rows.length + 1);
    expect(csv[0]).toMatch(/^id,at,direction,rail,/);
    expect(csv.slice(1).map((l) => l.split(",")[0])).toEqual(rows.map((r) => r.id));
    expect(csv.find((l) => l.startsWith("card:ctx_2"))).toContain("'=HYPERLINK(1)");
  });
});
