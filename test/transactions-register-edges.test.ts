// The transactions register's less common rows (src/money/register.ts): Purser's platform fee, an FX conversion still
// settling or cancelled, an Airi purchase released or under the CFO's approval, money in with no invoice, a clearing
// sale, a purchase in doubt, refunds refused or under approval, a sweep not paid, a credit seen on chain only, and a
// clearing withdrawal that failed. Each says in words what happened, and counts as money moved only when it moved.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { transactionRegister, type TxRow } from "../src/money/register.js";
import { moneyWorld as world } from "./fakes/moneyWorld.js";

let db: DB;
const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
const by = (rows: TxRow[], id: string) => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}: ${rows.map((x) => x.id).join(", ")}`);
  return r;
};

beforeEach(() => {
  db = openDb(":memory:");
  world(db);
});

describe("the register's less common rows", () => {
  it("Purser's platform fee: taken when settled, 'not taken' when switched off, the status in words otherwise", () => {
    const cols = (db.prepare("PRAGMA table_info(platform_fees)").all() as { name: string; notnull: number; dflt_value: unknown }[]);
    expect(cols.length).toBeGreaterThan(0);
    const insert = (request: string, status: string, currency = "EUR", fee: string | null = "fee_tr_1") => {
      const v: Record<string, unknown> = { request_id: request, proposal_id: "P-1", amount: "1.00", currency, fee_transfer_id: fee, status, approval_sha256: "c".repeat(64), updated_at: `2026-11-09T0${request.slice(-1)}:00:00Z` };
      for (const c of cols) if (!(c.name in v) && c.notnull && c.dflt_value === null) v[c.name] = c.name.endsWith("_at") ? "2026-11-09T00:00:00Z" : "x";
      const keys = Object.keys(v);
      run(`INSERT INTO platform_fees (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map((k) => v[k]));
    };
    insert("req-1", "SETTLED");
    insert("req-2", "NOT_TAKEN", "USD", null);
    insert("req-3", "IN_FLIGHT");
    const { rows } = transactionRegister(db);
    expect(by(rows, "platform_fee:req-1")).toMatchObject({ moved: true, status_words: "taken", counterparty: "Purser", eur_equivalent: "1.00", proof: "fee_tr_1" });
    expect(by(rows, "platform_fee:req-2")).toMatchObject({ moved: false, status_words: "not taken (fee switched off)", eur_equivalent: null });
    expect(by(rows, "platform_fee:req-3")).toMatchObject({ moved: false, status_words: "in flight" });
    expect(by(rows, "platform_fee:req-1").approval).toMatchObject({ required: true, proposal_id: "P-1" });
  });

  it("an FX conversion: still settling counts as moved and is flagged; a cancelled one moved nothing; a USD/EUR pair has its EUR side", () => {
    run("INSERT INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES ('q2', 'USD/EUR', '90.00', '100.00', '0.9', '2026-11-05T11:00:00Z', '2026-11-05T11:15:00Z')");
    run("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES ('conv_2', 'q2', 'fx-2', '90.00', '100.00', 'SCHEDULED', ?)", "c".repeat(64));
    run("INSERT INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES ('q3', 'USD/GBP', '80.00', NULL, '0.8', '2026-11-05T12:00:00Z', '2026-11-05T12:15:00Z')");
    run("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES ('conv_3', 'q3', 'fx-3', '80.00', NULL, 'CANCELLED', ?)", "c".repeat(64));
    const { rows } = transactionRegister(db);
    expect(by(rows, "fx:conv_2:sell")).toMatchObject({ moved: true, status_words: "converting, not settled yet", currency: "USD", eur_equivalent: "90.00" });
    expect(by(rows, "fx:conv_2:buy")).toMatchObject({ currency: "EUR", amount: "90.00" });
    expect(by(rows, "fx:conv_2:buy").flags).toContain("not_settled");
    // No sell amount: only the bought leg is listed, and nothing moved.
    expect(rows.some((r) => r.id === "fx:conv_3:sell")).toBe(false);
    expect(by(rows, "fx:conv_3:buy")).toMatchObject({ moved: false, status_words: "cancelled", eur_equivalent: null });
  });

  it("an Airi purchase released moved nothing; one under a proposal needs the CFO's approval; terms without a currency are EUR", () => {
    run("INSERT INTO airi_purchases (action_id, agent, route, order_sha256, terms_json, cents, day, status, mandate_id, checkout_ref, proposal_id, created_at, updated_at) VALUES ('act-2', 'sourcing', 'cfo', ?, ?, 900, '2026-11-08', 'RELEASED', 'm-2', NULL, 'P-1', '2026-11-08T14:00:00Z', '2026-11-08T14:00:05Z')",
      "f".repeat(64), JSON.stringify({ amount: "9.00" }));
    run("INSERT INTO airi_purchases (action_id, agent, route, order_sha256, terms_json, cents, day, status, mandate_id, checkout_ref, created_at, updated_at) VALUES ('act-3', 'sourcing', 'alone', ?, ?, 900, '2026-11-08', 'WAITING_FOR_TAP', NULL, NULL, '2026-11-08T15:00:00Z', '2026-11-08T15:00:05Z')",
      "e".repeat(64), JSON.stringify({ currency: "USD", merchant: { name: "Data Co" } }));
    const { rows } = transactionRegister(db);
    expect(by(rows, "airi:act-2")).toMatchObject({ moved: false, status_words: "released, nothing paid", currency: "EUR", counterparty: "", proof: "m-2" });
    expect(by(rows, "airi:act-2").approval).toMatchObject({ required: true, proposal_id: "P-1" });
    expect(by(rows, "airi:act-3")).toMatchObject({ moved: false, status_words: "waiting for tap", eur_equivalent: null, proof: null });
  });

  it("money in with no matching invoice and no payer", () => {
    run("INSERT INTO receipts (deposit_id, currency, amount_cents, payer, invoice_no, applied_cents, outcome, detail, received_at) VALUES ('dep_in_2', 'USD', 1500, NULL, NULL, 0, 'UNMATCHED', 'no invoice', '2026-11-08T16:00:00Z')");
    const r = by(transactionRegister(db).rows, "receipt:dep_in_2");
    expect(r).toMatchObject({ description: "Payment with no matching invoice", counterparty: "", invoice: null, moved: true, status_words: "received, unmatched", eur_equivalent: null });
    expect(r.approval.required).toBe(false);
  });

  it("a clearing sale proves itself by the clearing receipt; a failed settlement and a purchase in doubt are not counted", () => {
    run("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, scheme, clearing_json) VALUES (3, '/stock', 5, '0xretailer0000000000000000000', 'http://x', '{}', 'DELIVERED', '2026-11-07T09:02:01Z', 'bajillion', ?)",
      JSON.stringify({ paid: { invoice: { id: "inv_clr_1" } } }));
    run("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, scheme) VALUES (4, '/stock', 5, '0xr', 'http://x', '{}', 'SETTLE_FAILED', '2026-11-07T09:03:01Z', 'bajillion')");
    run("INSERT INTO upstream_purchases (id, price_cents, outcome, created_at) VALUES (3, 3, 'IN_DOUBT', '2026-11-07T09:04:00Z')");
    run("INSERT INTO upstream_purchases (id, price_cents, outcome, created_at) VALUES (4, 3, 'REFUSED', '2026-11-07T09:05:00Z')");
    const { rows } = transactionRegister(db);
    expect(by(rows, "sale:3")).toMatchObject({ rail: "metal_clearing", moved: true, proof: "inv_clr_1", counterparty: "0xretailer00…" });
    expect(by(rows, "sale:4")).toMatchObject({ moved: false, status_words: "settlement failed, not charged", proof: null, counterparty: "0xr" });
    expect(by(rows, "upstream:3")).toMatchObject({ moved: false, status_words: "in doubt: not counted until the chain says" });
    expect(by(rows, "upstream:4")).toMatchObject({ moved: false, status_words: "refused" });
  });

  it("refunds: refused with and without a reason, pending in words, and one under the CFO's approval", () => {
    for (const id of [5, 6, 7]) run("INSERT INTO sales (sale_id, route, price_cents, payer, tx_hash, request_url, request_params_json, status, created_at) VALUES (?, '/stock', 5, '0xr', ?, 'http://x', '{}', 'DELIVERED', '2026-11-07T10:00:00Z')", id, `0xs${id}`);
    run("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, refusal_reason) VALUES (2, 5, 'pay-r2', 5, '0xretailer000000000000', 'REFUSED', 'over the cap')");
    run("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome) VALUES (3, 6, 'pay-r3', 5, '0xretailer000000000000', 'REFUSED')");
    run("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, proposal_id) VALUES (4, 7, 'pay-r4', 5, '0xretailer000000000000', 'PENDING', 'P-1')");
    const { rows } = transactionRegister(db);
    expect(by(rows, "refund:2")).toMatchObject({ moved: false, status_words: "refused: over the cap" });
    expect(by(rows, "refund:3").status_words).toBe("refused");
    expect(by(rows, "refund:4")).toMatchObject({ moved: false, status_words: "pending" });
    expect(by(rows, "refund:4").approval).toMatchObject({ required: true, proposal_id: "P-1", decision: "APPROVED" });
  });

  it("a sweep not paid, a credit seen on chain only, and a clearing withdrawal that failed: none counted as moved", () => {
    run("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-2', 3, NULL, 'HELD', '2026-11-08T10:30:00Z')");
    run("INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_reference, created_at) VALUES ('ev2', '0xsw2', '0xa', '0xb', '30000000000000000', 11, 12, 'ref2', '2026-11-08T10:35:00Z')");
    run("INSERT INTO clearing_ops (id, party, kind, units, tx, detail, created_at) VALUES (2, 'seller', 'withdraw', '10000000000000000', NULL, 'no balance', '2026-11-08T11:30:00Z')");
    const { rows } = transactionRegister(db);
    expect(by(rows, "sweep:sw-2")).toMatchObject({ moved: false, status_words: "held" });
    expect(by(rows, "credit:ev2")).toMatchObject({ moved: false, status: "SEEN_ON_CHAIN", status_words: "seen on chain, not yet credited", proof: "0xsw2" });
    expect(by(rows, "clearing:2:out")).toMatchObject({ moved: false, status: "FAILED", status_words: "failed: no balance" });
    expect(by(rows, "clearing:2:in").description).toBe("Clearing earnings withdrawn (into the wallet)");
    for (const id of ["sweep:sw-2", "credit:ev2", "clearing:2:out", "clearing:2:in"]) expect(by(rows, id).reconciliation).toBe("not_applicable");
  });

  it("a transfer for an invoice the inbox does not know names the invoice from the transfer, and its fee in another currency is not added", () => {
    run("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES ('ZZ-9', 'Zeta Ltd', '50.00', 'USD', '2026-11-30', ?, 'COBADEFFXXX', 'ben_1', ?, 'OPEN')", "d".repeat(64), "e".repeat(64));
    run("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('tr_9', 'req-9', 'ZZ-9', '50.00', 'USD', 'LOCAL', 'USD 0.00', 'EUR 1.00', 'IN_APPROVAL', ?, '2026-11-09T10:00:00Z')", "c".repeat(64));
    const r = by(transactionRegister(db).rows, "transfer:req-9");
    expect(r.status_words).toBe("waiting for Airwallex approval");
    expect(r.invoice).toMatchObject({ ap_id: null, supplier_no: "ZZ-9", document: null });
    expect(r.eur_equivalent).toBeNull();
  });
});
