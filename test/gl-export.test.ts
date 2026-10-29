// E4: every payment in the ledger gets a GL account and a cost centre, and the journal exports to CSV and JSON for an
// ERP. Only money that moved is a line: refused purchases, declined card charges and aborted sales are not.
import { beforeEach, describe, expect, it } from "vitest";
import { journal, journalCsv, journalJson } from "../src/accounting/gl.js";
import { openDb, type DB } from "../src/db/open.js";

const T = (m: number) => `2026-10-29T11:${String(m).padStart(2, "0")}:00.000Z`;

function seed(db: DB) {
  const sale = db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, settlement_id, tx_hash, request_url, request_params_json, status, created_at, scheme, clearing_json) VALUES (?, '/v1/stock', ?, '0xSummit', ?, ?, 'u', '{}', ?, ?, ?, ?)");
  sale.run(1, 5, "s1", "0xsale1", "DELIVERED", T(1), "exact", null);
  sale.run(2, 7, "s2", null, "DELIVERED", T(2), "bajillion", JSON.stringify({ paid: { invoice: { id: "0xinv:2" } } }));
  sale.run(3, 5, "s3", null, "ABORTED_NO_CHARGE", T(3), "exact", null);
  const up = db.prepare("INSERT INTO upstream_purchases (id, price_cents, tx_hash, outcome, created_at) VALUES (?, ?, ?, ?, ?)");
  up.run(1, 2, "0xup1", "PAID", T(1));
  up.run(2, 4, null, "REFUSED", T(4));
  db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (1, 1, 'r1', 5, '0xSummit', 'PAID', '0xref1')").run();
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'ch', 'card_s', '1902', 'n', 'EUR', 3000, 10000, 'ACTIVE', ?, ?)").run(T(0), T(0));
  const card = db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, source, occurred_at, recorded_at) VALUES (?, 'card_s', 'sourcing', ?, '5734', ?, 'EUR', ?, ?, ?, 'poll', ?, ?)");
  card.run("ctx1", "=HYPERLINK(\"http://x\")", 1999, "APPROVED", 1, null, T(5), T(5));
  card.run("ctx2", "Packwise", 4500, "DECLINED", 0, "LIMIT_EXCEEDED", T(6), T(6));
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0005', 'invoice_payment', '{}', 'hash5', 'treasury', 'EXECUTED', ?, ?)").run(T(30), T(7));
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben', 'Bergtex Textil GmbH', '3000', 'x', 'COBADEFFXXX', 'EUR', 'SWIFT')").run();
  db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, status) VALUES ('BTX-2026-11', 'Bergtex Textil GmbH', '1850.00', 'EUR', '2026-11-15', 'x', 'COBADEFFXXX', 'ben', 'd', 'RECEIVED')").run();
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES ('tr1', 'req1', 'BTX-2026-11', '1850.00', 'EUR', 'SWIFT', '20.00', 'EUR 13.46', 'PAID', 'hash5', ?)").run(T(9));
  db.prepare("INSERT INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to, used_by_conversion) VALUES ('q1', 'USD/EUR', '370.00', '416.92', '1.126803', ?, ?, 'cv-req')").run(T(8), T(23));
  db.prepare("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES ('cv1', 'q1', 'cv-req', '370.00', '416.92', 'SETTLED', 'hash5')").run();
  db.prepare("INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_deposit_id, awx_reference, created_at) VALUES ('ek', '0xsweep', 'a', 'b', '1350000000000000000', 1, 1, 'dep1', '0xsweep', ?)").run(T(11));
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, event_key, created_at) VALUES ('sweep-1', 135, '0xsweep', 'PAID', 'ek', ?)").run(T(10));
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sweep-0', 150, NULL, 'REFUSED', ?)").run(T(10));
}

describe("GL journal (E4)", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    seed(db);
  });

  it("books every payment that moved money, and nothing that did not", () => {
    const lines = journal(db);
    const refs = lines.map((l) => `${l.source}:${l.ref}`);
    expect(refs).toContain("sale:1");
    expect(refs).toContain("sale:2");
    expect(refs).not.toContain("sale:3");
    expect(refs).toContain("upstream:1");
    expect(refs).not.toContain("upstream:2");
    expect(refs).toContain("card:ctx1");
    expect(refs).not.toContain("card:ctx2");
    expect(refs).not.toContain("sweep:sweep-0");
    expect(lines).toHaveLength(11);
    // In date order.
    expect([...lines].sort((a, b) => a.date.localeCompare(b.date))).toEqual(lines);
  });

  it("gives each line a GL account, a cost centre, a bank account and its proof", () => {
    const by = (source: string, ref: string) => journal(db).filter((l) => l.source === source && l.ref === ref);
    expect(by("sale", "1")[0]).toMatchObject({ gl_account: "4000", cost_centre: "CC100", bank_account: "1210", amount: "0.05", currency: "USDZ", proof: "0xsale1" });
    expect(by("sale", "2")[0]).toMatchObject({ gl_account: "4000", bank_account: "1220", amount: "0.07", proof: "0xinv:2" });
    expect(by("upstream", "1")[0]).toMatchObject({ gl_account: "5000", cost_centre: "CC100", amount: "-0.02", proof: "0xup1" });
    expect(by("refund", "1")[0]).toMatchObject({ gl_account: "4100", cost_centre: "CC200", amount: "-0.05" });
    expect(by("card", "ctx1")[0]).toMatchObject({ gl_account: "6100", cost_centre: "CC100", bank_account: "1200", amount: "-19.99", currency: "EUR" });
    const [pay, fee] = by("transfer", "req1");
    expect(pay).toMatchObject({ gl_account: "6200", cost_centre: "CC300", amount: "-1850.00", currency: "EUR", counterparty: "Bergtex Textil GmbH", approval: "P-0005" });
    expect(fee).toMatchObject({ gl_account: "6800", amount: "-13.46", currency: "EUR", approval: "P-0005" });
    const fx = by("fx", "cv1");
    expect(fx.map((l) => [l.bank_account, l.amount, l.currency, l.gl_account])).toEqual([["1201", "-416.92", "USD", "1590"], ["1200", "370.00", "EUR", "1590"]]);
    const sweep = journal(db).filter((l) => l.ref === "sweep-1" || l.ref === "dep1");
    expect(sweep.map((l) => [l.bank_account, l.amount, l.currency, l.gl_account])).toEqual([["1210", "-1.35", "USDZ", "1590"], ["1201", "1.35", "USD", "1590"]]);
    // Every line says which rule coded it.
    for (const l of journal(db)) expect(l.rule).toMatch(/\S/);
  });

  it("exports CSV an ERP can import, safe against spreadsheet formulas", () => {
    const csv = journalCsv(journal(db));
    const [head, ...rows] = csv.trimEnd().split("\r\n");
    expect(head).toBe("date,source,ref,description,counterparty,agent,cost_centre,gl_account,gl_name,bank_account,amount,currency,proof,approval,rule");
    expect(rows).toHaveLength(11);
    // A merchant name from outside cannot become a formula; amounts stay numbers.
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toMatch(/,-19\.99,EUR,/);
  });

  it("exports JSON with the chart of accounts and cost centres it used", () => {
    const j = JSON.parse(journalJson(journal(db)));
    expect(j.chart["4000"]).toMatch(/revenue/i);
    expect(j.cost_centres.CC300).toMatch(/finance/i);
    expect(j.lines).toHaveLength(11);
  });
});
