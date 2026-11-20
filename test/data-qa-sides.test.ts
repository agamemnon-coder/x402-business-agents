// Data QA (src/finance/dataQa.ts), the parts test/data-qa.test.ts leaves out: the Airwallex payments in the ledger
// (the SWIFT transfer and its fee, conversions, the deposit that books a sweep, card charges an audit row names under
// another id), each side's verdict when a source fails or disagrees, the Books' own checks and the report's sections.
// Offline: Airwallex and the chain are fakes. Breaks if a difference is called a match, a payment is read that the
// audit rows do not name (or one they do is dropped), or a failed source is reported as anything but skipped.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { airwallexDiffs, booksDiffs, booksIndex, chainDiffs, ledgerPayments, renderReport, runDataQa, type BooksIndex, type Check, type Payment } from "../src/finance/dataQa.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { USDZ } from "../src/metal/network.js";

const BUSINESS = "0x00000000000000000000000000000000000000b1";
const SWEEP = "0x00000000000000000000000000000000000000d4";
const TX = (d: string) => `0x${d.repeat(64)}`;
const E16 = 10n ** 16n;
const HEAD = { ledger: "l.db", upto: 99, rows: 9, anchor: "a", generatedAt: "now", airwallex: "fake", metal: "fake" };

function awxLedger(): DB {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO metal_accounts (address, role) VALUES (?, 'business'), (?, 'sweep')").run(BUSINESS, SWEEP);
  const inv = db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES (?, 'Vendor', '1.00', 'EUR', '2026-11-30', 'x', 'BIC', 'x', 'PAID')");
  const tr = db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES (?, ?, ?, ?, 'EUR', 'SWIFT', '0', ?, ?, 'sha', ?)");
  const pay = (id: string | null, rq: string, amount: string, fee: string | null, status: string, at: string) => { inv.run(`INV-${rq}`); tr.run(id, rq, `INV-${rq}`, amount, fee, status, at); };
  pay("tr1", "rq1", "1850.00", "EUR 13.41", "PAID", "2026-11-03T08:00:00Z");
  pay(null, "rq2", "10.00", null, "FAILED", "2026-11-03T08:01:00Z"); // never reached Airwallex
  pay("tr3", "rq3", "20.00", null, "PAID", "2026-11-03T08:02:00Z"); // no audit row names it: a later test run
  pay("tr4", "rq4", "30.00", null, "SENT", "2026-11-03T08:03:00Z");
  audit(db, "treasury", "transfer.created", "tr1", {});
  audit(db, "treasury", "transfer.created", "tr4", {});
  const q = db.prepare("INSERT INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, 'USD/EUR', ?, ?, '0.9', '2026-11-03T07:00:00Z', 'x')");
  const c = db.prepare("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, 'SETTLED', 'sha')");
  q.run("q1", "370.00", "418.40"); c.run("cv1", "q1", "fx-rq1", "370.00", "418.40");
  q.run("q2", "100.00", null); c.run("cv2", "q2", "fx-rq2", "100.00", null); // the sell side was not known when it was booked
  q.run("q3", "1.00", "1.10"); c.run("cv3", "q3", "fx-rq3", "1.00", "1.10"); // not in the audit rows
  audit(db, "treasury", "fx.converted", "cv1", {});
  audit(db, "treasury", "fx.converted", "cv2", {});
  const cc = db.prepare("INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_deposit_id, awx_reference, created_at) VALUES (?, ?, ?, ?, ?, 7, 9, ?, 'REF-1', '2026-11-03T09:00:00Z')");
  cc.run("k1", TX("a"), SWEEP, BUSINESS, String(135n * E16), "dp1");
  cc.run("k2", TX("b"), SWEEP, BUSINESS, String(1n * E16), "dp2"); // its deposit is not in the audit rows
  audit(db, "treasury", "credit.deposited", "k1", { deposit_id: "dp1" });
  db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('sourcing', 'h1', 'c1', '1234', 'n', 'EUR', 3000, 10000, 'ACTIVE', 'x', 'x')").run();
  const ct = db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, source, occurred_at, recorded_at) VALUES (?, 'c1', 'sourcing', 'Packwise', '5734', ?, 'EUR', ?, ?, ?, 'poll', ?, 'x')");
  ct.run("t-legacy", 1999, "APPROVED", 1, null, "2000-01-01T00:00:00Z"); // its audit row names it "t-new"
  ct.run("t-declined", 5000, "DECLINED", 0, "EXCEEDS_LIMIT", "2000-01-01T00:00:00Z"); // no audit row at all
  ct.run("t-late", 100, "APPROVED", 1, null, "2999-01-01T00:00:00Z"); // after the ledger's last row: a later run
  audit(db, "sourcing", "card.charge_approved", "t-new", { agent: "sourcing", amount: "19.99" });
  // Rows with nothing to check: a funding row with no transaction, a mandate row with none.
  audit(db, "owner-signer", "business.funded", BUSINESS, { amount: "20.00" });
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03" });
  audit(db, "owner-signer", "mandate.bound", null, { tx: TX("c") });
  return db;
}

describe("data QA: the Airwallex payments in the ledger", () => {
  it("reads each Airwallex payment the audit rows name, with its fee, its sell side and its card note", () => {
    const ps = ledgerPayments(awxLedger(), 99);
    expect(ps.map((p) => `${p.kind}:${p.id}`)).toEqual([
      "Airwallex transfer:tr1", "Airwallex transfer:tr4",
      "Airwallex conversion:cv1", "Airwallex conversion:cv2",
      "Airwallex deposit:dp1",
      "Airwallex card transaction:t-legacy", "Airwallex card transaction:t-declined",
      "Metal mandate:" + TX("c"),
    ]);
    const by = (id: string) => ps.find((p) => p.id === id)!;
    expect(by("tr1")).toMatchObject({ ledger: "EUR 1850.00 for invoice INV-rq1, PAID, fee EUR 13.41", awx: { fee: "EUR 13.41" } });
    expect(by("tr1").books!.lines).toEqual([{ amount: "-1850.00", currency: "EUR", proof: "tr1" }, { amount: "-13.41", currency: "EUR", proof: "tr1" }]);
    expect(by("tr4").awx).not.toHaveProperty("fee");
    expect(by("tr4").books!.lines).toHaveLength(1);
    expect(by("cv1").books!.lines.map((l) => l.amount)).toEqual(["-418.40", "370.00"]);
    expect(by("cv2")).toMatchObject({ ledger: "USD ? → EUR 100.00, SETTLED", awx: { sell: "" } });
    expect(by("cv2").books!.lines).toEqual([{ amount: "100.00", currency: "EUR", proof: "cv2" }]);
    expect(by("dp1")).toMatchObject({ awx: { amount: "1.35", currency: "USD", reference: "REF-1", since: "2026-11-02T09:00:00.000Z" }, chain: { tx: TX("a"), block: 7, transfer: { from: SWEEP, to: BUSINESS, cents: 135 } } });
    expect(by("t-legacy").note).toMatch(/^the audit row \(seq \d+\) names this charge t-new, not the ledger's id$/);
    expect(by("t-declined")).toMatchObject({ ledger: "EUR 50.00 at Packwise (sourcing), declined EXCEEDS_LIMIT", note: "no audit row names this charge", books: { lines: [] } });
    expect(by(TX("c")).ledger).toBe("? bound: cap ?, budget ?");
  });

  it("checks each side, says where a source failed, and books what the journal holds", async () => {
    const db = awxLedger();
    const ps = ledgerPayments(db, 99);
    const awx = async (path: string): Promise<unknown> => {
      if (path === "/transfers/tr1") return { transfer_amount: 1850, transfer_currency: "EUR", status: "PAID", fee_amount: 13.41, fee_currency: "EUR" };
      if (path === "/transfers/tr4") throw new TypeError("fetch failed\nat line 2");
      if (path === "/fx/conversions/cv1") return { buy_amount: 370, buy_currency: "EUR", sell_amount: 418.4, sell_currency: "USD", status: "SETTLED" };
      if (path.startsWith("/fx/conversions")) throw "a bare string"; // by id and by list: no answer at all
      if (path === "/deposits/dp1") return { amount: 1.35, currency: "USD", status: "SETTLED", reference: "ref-1" };
      if (path.startsWith("/issuing/transactions/")) throw new Error("404");
      if (path === "/issuing/transactions") return { items: [{ transaction_id: "t-legacy", transaction_amount: -19.99, transaction_currency: "EUR", status: "APPROVED" }], has_more: false };
      return { items: [] };
    };
    const receipt = async (tx: string) => {
      if (tx === TX("a")) return { status: "success" as const, block: 7, from: SWEEP, transfers: [{ token: USDZ, from: SWEEP, to: BUSINESS, value: 135n * E16 }] };
      throw new Error("rpc down");
    };
    const checks = await runDataQa(db, ps, { awx, receipt }, { usdz: USDZ, scrub: (s) => s.replace("Packwise", "[merchant]"), concurrency: 2 });
    const of = (id: string, side: string) => checks.find((c) => c.id === id && c.side === side);
    expect(of("tr1", "Airwallex")).toMatchObject({ outcome: "match", detail: "EUR 1850.00, PAID, fee EUR 13.41" });
    expect(of("tr1", "Books")).toMatchObject({ outcome: "match" });
    expect(of("tr1", "Books")!.detail).toMatch(/^-1850\.00 EUR \+ -13\.41 EUR \(accounts /);
    // A failed lookup is skipped with the error's first line, its name kept unless it is a plain Error.
    expect(of("tr4", "Airwallex")).toMatchObject({ outcome: "skipped", detail: "Airwallex did not answer: TypeError: fetch failed" });
    expect(of("cv2", "Airwallex")).toMatchObject({ outcome: "skipped", detail: "Airwallex did not answer: a bare string" });
    expect(of("cv1", "Airwallex")!.outcome).toBe("match");
    expect(of("cv1", "Books")!.outcome).toBe("match");
    expect(of("cv2", "Books")!.outcome).toBe("match");
    expect(of("dp1", "Airwallex")).toMatchObject({ outcome: "match", detail: "USD 1.35, SETTLED, reference ref-1" });
    expect(of("dp1", "Metal")!.outcome).toBe("match");
    expect(of("dp1", "Books")!.outcome).toBe("match");
    expect(of("t-legacy", "Airwallex")!.outcome).toBe("match");
    // The declined charge: Airwallex has no record, and the Books rightly hold nothing.
    expect(of("t-declined", "Airwallex")).toMatchObject({ outcome: "difference", detail: "Airwallex has no record with this id" });
    expect(of("t-declined", "Books")).toMatchObject({ outcome: "match", detail: "not booked, as nothing moved" });
    expect(of(TX("c"), "Metal")).toMatchObject({ outcome: "skipped", detail: "the RPC did not answer: rpc down" });
    expect(checks.some((c) => c.detail.includes("Packwise"))).toBe(false);

    const md = renderReport(ps, checks, HEAD);
    expect(md).toContain("| Airwallex transfer | 1/2 match, 1 skipped | n/a | 2/2 match |");
    expect(md).toContain("## Notes on the ledger\n\n- **Airwallex card transaction `t-legacy`**: the audit row (seq");
    expect(md).toContain("- Airwallex: Airwallex did not answer: TypeError: fetch failed (1: Airwallex transfer)");
    expect(md).toContain("- **Airwallex card transaction `t-declined`** (Airwallex): Airwallex has no record with this id. Ledger: EUR 50.00");
    expect(md).toMatch(/\| Metal mandate \| `0xcccccccc…cccc` \| \? bound: cap \?, budget \? \| n\/a \| skipped \| n\/a \|/);
  });

  it("says a paid row with no transaction hash is a difference, and skips Metal with no RPC", async () => {
    const db = openDb(":memory:");
    const ps: Payment[] = [
      { kind: "Metal upstream purchase", id: "9", ledger: "paid", chain: { tx: null, transfer: { from: BUSINESS, to: SWEEP, cents: 2 } } },
      { kind: "Metal sweep", id: "sw", ledger: "paid", chain: { tx: TX("1") } },
    ];
    const checks = await runDataQa(db, ps, {}, { usdz: USDZ });
    expect(checks).toEqual([
      { kind: "Metal upstream purchase", id: "9", side: "Metal", outcome: "difference", detail: "the ledger calls it paid but holds no transaction hash" },
      { kind: "Metal sweep", id: "sw", side: "Metal", outcome: "skipped", detail: "no Metal RPC" },
    ]);
    const md = renderReport(ps, checks, HEAD);
    expect(md).toContain("## Notes on the ledger\n\nNone.");
    expect(md).toContain("- Metal: no Metal RPC (1: Metal sweep)");
    // A check whose payment is not in the list still prints, with the ledger unknown.
    const orphan: Check = { kind: "Metal sale", id: "404", side: "Books", outcome: "difference", detail: "x" };
    expect(renderReport([], [orphan], HEAD)).toContain("- **Metal sale `404`** (Books): x. Ledger: ?.");
    expect(renderReport([], [], HEAD)).toContain("## Differences\n\nNone.");
    expect(renderReport([], [], HEAD)).toContain("## Skipped\n\nNone.");
  });
});

describe("data QA: Airwallex's record against the ledger's", () => {
  it("finds a conversion and a card charge on a later page, and says what differs", async () => {
    const pages: string[] = [];
    const card = { type: "card" as const, id: "t9", cardId: "c1", amount: "5.00", currency: "EUR", approved: true, failure: null };
    const r = await airwallexDiffs(async (path, query) => {
      if (!query) throw new Error("404");
      pages.push(query.page_num!);
      return query.page_num === "0"
        ? { items: [{ card_transaction_data: { card_transaction_id: "other" } }], has_more: true }
        : { items: [{ card_transaction_data: { card_transaction_id: "t9" }, transaction_amount: "abc", transaction_currency: "USD", process_result: "DECLINED", failure_reason: "BLOCKED" }] };
    }, card);
    expect(pages).toEqual(["0", "1"]);
    expect(r).toEqual({
      found: true, said: "USD abc, DECLINED BLOCKED",
      diffs: ["result: Airwallex declined, ledger approved", "amount: Airwallex abc, ledger 5.00", "currency: Airwallex USD, ledger EUR", "failure reason: Airwallex BLOCKED, ledger (none)"],
    });
  });

  it("calls a record missing when every lookup answered none, and when a list never ends gives up", async () => {
    const transfer = { type: "transfer" as const, id: "tr9", amount: "1.00", currency: "EUR", status: "PAID" };
    expect(await airwallexDiffs(async () => undefined, transfer)).toEqual({ found: false });
    const conversion = { type: "conversion" as const, id: "cv9", requestId: "rq9", buy: "1.00", buyCurrency: "EUR", sell: "1.10", sellCurrency: "USD", status: "SETTLED" };
    let calls = 0;
    expect(await airwallexDiffs(async (path) => { calls++; if (path.startsWith("/fx/conversions/")) throw new Error("404"); return { has_more: true }; }, conversion)).toEqual({ found: false });
    expect(calls).toBe(21); // the lookup by id, then twenty pages
    // A transfer whose fee Airwallex reports but the ledger does not: the fee is not compared.
    const noFee = await airwallexDiffs(async () => ({ transfer_amount: 1, transfer_currency: "EUR", status: "PAID", fee_amount: 2, fee_currency: "EUR" }), transfer);
    expect(noFee).toEqual({ found: true, diffs: [], said: "EUR 1.00, PAID, fee EUR 2.00" });
    // A deposit not yet settled, for another amount and reference.
    const deposit = { type: "deposit" as const, id: "dp9", amount: "1.35", currency: "USD", reference: "R", since: "x" };
    const pending = await airwallexDiffs(async () => ({ amount: 1, currency: "USD", status: "PENDING" }), deposit);
    expect(pending).toMatchObject({ found: true, diffs: ["status: Airwallex PENDING, ledger SETTLED", "amount: Airwallex 1.00, ledger 1.35", "reference: Airwallex (none), ledger r"] });
  });
});

describe("data QA: the chain and the Books", () => {
  it("names the transfers a receipt holds instead of the one the ledger expects, and checks no transfer when none is expected", () => {
    const r = { status: "success" as const, block: 3, from: BUSINESS, transfers: [{ token: USDZ.toUpperCase(), from: BUSINESS, to: SWEEP, value: 12345n }, { token: "0xother", from: BUSINESS, to: SWEEP, value: 2n * E16 }] };
    const d = chainDiffs(r, { tx: TX("1"), transfer: { from: BUSINESS, to: SWEEP, cents: 2 } }, USDZ);
    expect(d.diffs).toEqual([`no *USDZ transfer of 0.02 0x00000000…00b1 → 0x00000000…00d4; the receipt has 12345 0x00000000…00b1 → 0x00000000…00d4`]);
    expect(chainDiffs(r, { tx: TX("1"), block: 3 }, USDZ)).toEqual({ diffs: [], said: "success in block 3" });
  });

  it("reports postings that are missing, extra, unbalanced or carry another proof", () => {
    const line = (o: Partial<JournalLine>): JournalLine => ({ date: "d", source: "sale", ref: "1", description: "Sale 1", counterparty: "", agent: "", cost_centre: "", gl_account: "4000", gl_name: "", bank_account: "1210", amount: "0.05", currency: "USDZ", proof: TX("1"), approval: "", rule: "", ...o });
    const posting = (debit: number, credit: number, account: string) => ({ entry: "J-00001", date: "d", account, account_name: "", debit_cents: debit, credit_cents: credit, currency: "USDZ", description: "", ref: "1" });
    const index = { lines: [{ line: line({}), postings: [posting(5, 0, "1210"), posting(0, 4, "4000")] }] } as unknown as BooksIndex;
    const spec = { source: "sale" as const, ref: "1", lines: [{ amount: "0.05", currency: "USDZ", proof: TX("2") }] };
    expect(booksDiffs(index, spec).diffs).toEqual([
      "Sale 1: 2 postings, debit 0.05, credit 0.04 for 0.05",
      `Sale 1: proof 0x11111111…1111, ledger 0x22222222…2222`,
    ]);
    expect(booksDiffs(index, { ...spec, lines: [] }).diffs[0]).toBe("booked although nothing moved: 0.05 USDZ");
    expect(booksDiffs(index, { ...spec, ref: "2" })).toEqual({ diffs: ["postings: books (none), ledger 0.05 USDZ"], said: "not booked, as nothing moved" });
  });

  it("indexes the opening lines and the journal under the entry numbers the books give them", () => {
    const db = openDb(":memory:");
    audit(db, "owner-signer", "business.funded", BUSINESS, { amount: "20.00", tx: TX("1") });
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES ('sw-1', 135, ?, 'PAID', '2026-11-03T10:00:00Z')").run(TX("2"));
    const idx = booksIndex(db);
    expect(idx.lines.map((l) => [l.line.source, l.postings.map((p) => p.entry)[0]])).toEqual([["opening", "O-001"], ["sweep", "J-00002"]]);
    expect(idx.lines.every((l) => l.postings.length === 2)).toBe(true);
  });
});
