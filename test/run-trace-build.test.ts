// The main run's companion record (src/demo/runTrace.ts), built from a small ledger made here rather than the main
// run's own. Breaks if a payment of any kind is dropped or mis-railed, if an Alta payment is tied to the wrong mandate,
// if the SWIFT transfer loses its approval hash or proposal, if the record is built from a ledger that is not the
// record's (or whose chain is broken), or if something private reaches the companion.
import { describe, expect, it } from "vitest";
import { audit, verifyAuditChain } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { RECORD_UNCHANGED, runTrace, TRACE_SCHEMA, traceLabel } from "../src/demo/runTrace.js";

const TX = (d: string) => `0x${d.repeat(64)}`;
const PAYER = "0x00000000000000000000000000000000000000a1";
const SHA = "a".repeat(64);

function ledger(): DB {
  const db = openDb(":memory:");
  const t = (h: number) => new Date(Date.UTC(2026, 10, 3, h)).toISOString();
  // A mandate for the customer's agent and two for sourcing (bound, then replaced): each Alta payment is tied to the
  // last one before it.
  audit(db, "owner-signer", "mandate.bound", "customer", { tx: TX("1"), cap: "0.05", budget: "1.00", mandate_hash: "m1" }, new Date(t(1)));
  audit(db, "owner-signer", "mandate.bound", "sourcing", { tx: TX("2"), cap: "0.03", budget: "10.00" }, new Date(t(1)));
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, tx_hash) VALUES (5, '/stock', 5, ?, 'u', '{}', 'DELIVERED', ?, ?)").run(PAYER, t(2), TX("3"));
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at, tx_hash) VALUES (6, '/stock', 5, ?, 'u', '{}', 'ABORTED_NO_CHARGE', ?, NULL)").run(PAYER, t(2));
  audit(db, "support", "sale.delivered", "5", { origin: { actor: "external", party: "customer", name: "Retailer (passkey abcdefgh12)" } }, new Date(t(2)));
  db.prepare("INSERT INTO upstream_purchases (id, price_cents, tx_hash, outcome, created_at) VALUES (55, 2, ?, 'PAID', ?), (56, 4, NULL, 'REFUSED', ?)").run(TX("4"), t(3), t(3));
  audit(db, "sourcing", "upstream.paid", "55", { tx: TX("4"), origin: { actor: "agent", agent: "sourcing", model: "m", request_id: null, run_id: "r1" } }, new Date(t(3)));
  audit(db, "owner-signer", "mandate.replaced", "sourcing", { tx: TX("5"), cap: "0.04", budget: "12.00", proposal_id: "P-0002" }, new Date(t(4)));
  db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (1, 5, 'rf-1', 5, ?, 'PAID', ?)").run(PAYER, TX("6"));
  audit(db, "support", "refund.paid", "5", { tx: TX("6") }, new Date(t(5)));
  db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sweep-20261103-1', 135, ?, 'PAID', ?)").run(TX("7"), t(6));
  audit(db, "treasury", "sweep.paid", "sweep-20261103-1", {}, new Date(t(6)));
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'h1', 'c1', '1234', 'n', 'EUR', 3000, 10000, 'ACTIVE', 'x', 'x')").run();
  db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES ('01a1a12f-card', 'c1', 'sourcing', 'Packwise', '5734', 1999, 'EUR', 'APPROVED', 1, 'poll', ?, 'x'), ('declined-1', 'c1', 'sourcing', 'Packwise', '5734', 99999, 'EUR', 'DECLINED', 0, 'poll', ?, 'x')").run(t(7), t(7));
  audit(db, "sourcing", "card.charge_approved", "01a1a12f-card", { agent: "sourcing", amount: "19.99" }, new Date(t(7)));
  db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('INV-1', 'Vendor', '1850.00', 'EUR', '2026-11-30', 'x', 'BIC', 'x', 'PAID')").run();
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0001', 'invoice_payment', '{}', ?, 'payables', 'EXECUTED', 'x', 'x')").run(SHA);
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('03360bfa-tr', 'rq1', 'INV-1', '1850.00', 'EUR', 'SWIFT', '0', 'PAID', ?, ?)").run(SHA, t(8));
  audit(db, "awx-executor", "transfer.created", "03360bfa-tr", { amount: "1850.00" }, new Date(t(8)));
  return db;
}

const recordOf = (db: DB) => {
  const c = verifyAuditChain(db);
  if (!c.ok) throw new Error("the fixture's chain is broken");
  return { run: "run-1", audit: { rows: c.rows, head: c.head } };
};

describe("the main run's companion record", () => {
  it("keeps every payment with its rail, its audit row and the mandate in force, and nothing private", () => {
    const db = ledger();
    const out = runTrace(db, { generated: "2026-11-20", record: recordOf(db), recordFile: "docs/demo/main-run.json" });
    expect(out.schema).toBe(TRACE_SCHEMA);
    expect(out.label).toBe(traceLabel("2026-11-20"));
    expect(out.source).toEqual({ record: "docs/demo/main-run.json", run: "run-1", ledger_matches_record: true });
    expect(out.payments.map((p) => [p.id, p.kind, p.rail])).toEqual([
      ["sale-5", "sale", "metal"],
      ["purchase-55", "purchase", "metal"],
      ["refund-5", "refund", "metal"],
      ["sweep-20261103-1", "sweep", "metal"],
      ["card-01a1a12f", "card", "airwallex_card"],
      ["transfer-03360bfa", "transfer", "airwallex_swift"],
    ]);
    const by = Object.fromEntries(out.payments.map((p) => [p.id, p]));
    const seqOf = (event: string, subject: string) => (db.prepare("SELECT seq FROM audit_log WHERE event = ? AND subject = ?").get(event, subject) as { seq: number }).seq;
    // The sale is the customer's mandate's; the purchase was paid under sourcing's first mandate (the replacement came
    // after it); no mandate held the refund (support) or the sweep (treasury).
    expect(by["sale-5"]!.mandate_seq).toBe(seqOf("mandate.bound", "customer"));
    expect(by["purchase-55"]!.mandate_seq).toBe(seqOf("mandate.bound", "sourcing"));
    expect(by["refund-5"]!.mandate_seq).toBeNull();
    expect(by["sale-5"]!).toMatchObject({ amount: "0.05", currency: "USDZ", rail_id: TX("3"), audit: { seq: seqOf("sale.delivered", "5"), event: "sale.delivered" } });
    // The origin is kept as recorded, scrubbed of the passkey credential.
    expect(by["sale-5"]!.origin).toEqual({ actor: "external", party: "customer", name: "Retailer" });
    expect(by["purchase-55"]!.origin).toEqual({ actor: "agent", agent: "sourcing", model: "m", request_id: null, run_id: "r1" });
    // The refund is dated by its audit row, the card and transfer by their own times.
    expect(by["refund-5"]!.at).toBe(new Date(Date.UTC(2026, 10, 3, 5)).toISOString());
    expect(by["card-01a1a12f"]!).toMatchObject({ amount: "19.99", currency: "EUR", rail_id: "01a1a12f-card", approval_sha256: null, mandate_seq: null });
    expect(by["transfer-03360bfa"]!).toMatchObject({ amount: "1850.00", currency: "EUR", approval_sha256: SHA, proposal_id: "P-0001" });
    expect(out.mandates.map((m) => [m.agent, m.event, m.cap, m.mandate_hash, m.proposal_id])).toEqual([
      ["customer", "mandate.bound", "0.05", "m1", null],
      ["sourcing", "mandate.bound", "0.03", null, null],
      ["sourcing", "mandate.replaced", "0.04", null, "P-0002"],
    ]);
    // The journal books the same payments; the audit chain is kept as links only.
    expect(out.journal.map((l) => l.source)).toEqual(expect.arrayContaining(["sale", "upstream", "refund", "card", "transfer"]));
    expect(out.audit).toMatchObject({ rows: recordOf(db).audit.rows, head: recordOf(db).audit.head, intact: true });
    expect(Object.keys(out.audit.links[0]!).sort()).toEqual(["prev_hash", "row_hash", "seq"]);
    expect(RECORD_UNCHANGED).toMatch(/unchanged/);
  });

  it("refuses a date that is not YYYY-MM-DD, a ledger that is not the record's, and a payment with no single audit row", () => {
    const db = ledger();
    const record = recordOf(db);
    expect(() => runTrace(db, { generated: "20 Nov", record, recordFile: "r" })).toThrow("generated must be a date, YYYY-MM-DD");
    expect(() => runTrace(db, { generated: "2026-11-20", record: { run: "x", audit: { rows: record.audit.rows + 1, head: record.audit.head } }, recordFile: "r" }))
      .toThrow(/this ledger is not the record's: \d+ rows/);
    expect(() => runTrace(db, { generated: "2026-11-20", record: { run: "x", audit: { rows: record.audit.rows, head: "f".repeat(64) } }, recordFile: "r" }))
      .toThrow(/the record says \d+ rows, head ffffffffffff/);
    // A second row for the same sale: which one recorded it is not clear, so nothing is built.
    audit(db, "support", "sale.delivered", "5", {});
    expect(() => runTrace(db, { generated: "2026-11-20", record: recordOf(db), recordFile: "r" })).toThrow("expected one sale.delivered row for 5, found 2");
  });

  it("refuses a ledger whose audit chain is broken", () => {
    const db = ledger();
    const record = recordOf(db);
    // The append-only guard is taken off to stand in for an edit made outside the program.
    db.exec("DROP TRIGGER audit_log_no_update");
    db.prepare("UPDATE audit_log SET payload_json = '{\"tx\":\"tampered\"}' WHERE seq = 2").run();
    expect(() => runTrace(db, { generated: "2026-11-20", record, recordFile: "r" })).toThrow(/the ledger's audit chain is broken at seq 2/);
  });

  it("refuses to carry something private", () => {
    const db = ledger();
    // A sale whose payer field is not scrubbed and names a relay host: the companion would leak it.
    db.prepare("UPDATE sales SET tx_hash = 'https://relay.example.workers.dev/x\"' WHERE sale_id = 5").run();
    expect(() => runTrace(db, { generated: "2026-11-20", record: recordOf(db), recordFile: "r" })).toThrow(/the companion would carry something private: relay host/);
  });
});
