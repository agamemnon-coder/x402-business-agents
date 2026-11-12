// A small world with one movement (and one failed attempt) on every rail Purser records: transfers with a fee and
// without approval, an FX conversion, a card charge and a decline, Metal sales, purchases, a refund, a sweep and its
// credit, a clearing withdrawal, an Airi purchase and a payment into a Global Account. Test data only.
import type { DB } from "../../src/db/open.js";
import { termsHash, TERMS_SCHEMA, type Terms } from "../../src/lib/terms.js";

// Signed terms that hash to their approvals, as a real ledger holds them: the books refuse to post what a signed
// proposal speaks for when its stored terms no longer hash to the signed hash (src/ledger/termsLock.ts).
const TERMS_OK = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-1", expires_at: "2026-11-10T00:00:00Z" } as Terms;
const TERMS_FX = { schema: TERMS_SCHEMA, kind: "fx", proposal_id: "P-2", expires_at: "2026-11-10T00:00:00Z" } as Terms;
const SHA_OK = termsHash(TERMS_OK);
const SHA_NONE = "b".repeat(64);
const SHA_FX = termsHash(TERMS_FX);

export function moneyWorld(d: DB): void {
  const run = (sql: string, ...p: unknown[]) => d.prepare(sql).run(...p);
  run("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method, status) VALUES ('ben_1', 'Bergtex Textil GmbH', '3000', ?, 'COBADEFFXXX', 'EUR', 'SWIFT', 'ACTIVE')", "d".repeat(64));
  for (const no of ["BTX-1", "BTX-2", "BTX-3"]) run("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES (?, 'Bergtex Textil GmbH', '100.00', 'EUR', '2026-11-30', ?, 'COBADEFFXXX', 'ben_1', ?, 'OPEN')", no, "d".repeat(64), "e".repeat(64));
  run("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-1', 'invoice_payment', ?, ?, 'treasury', 'EXECUTED', '2026-11-10', '2026-11-01')", JSON.stringify(TERMS_OK), SHA_OK);
  run("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES ('P-1', 'APPROVED', ?, 'cfo', 'passkey', '', '2026-11-01T09:00:00Z')", SHA_OK);
  run("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-2', 'fx', ?, ?, 'treasury', 'EXECUTED', '2026-11-10', '2026-11-01')", JSON.stringify(TERMS_FX), SHA_FX);
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
