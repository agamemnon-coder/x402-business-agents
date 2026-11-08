// The ledger fed from what Purser already records (bookkeeping core, decision 2): no typing, each source line once,
// and the stored books agree with the books Purser computes on the fly (src/accounting/books.ts).
import { describe, expect, it } from "vitest";
import { books } from "../src/accounting/books.js";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { redTeamWorld } from "../src/redteam/world.js";
import { ledgerRows, lockMonth, verifyLedger } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { trialBalance, vatOverview } from "../src/ledger/reports.js";
import { exportCsv, exportJson } from "../src/ledger/export.js";

describe("syncing the ledger from Purser's own records", () => {
  it("posts every movement once, balanced, with the same balances as the computed books", async () => {
    const w = await redTeamWorld();
    await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    await buyPlan(w.db, w.issuing, "replyhub-starter", w.now());
    const first = syncLedger(w.db, w.now());
    expect(first.posted).toBeGreaterThan(0);
    expect(syncLedger(w.db, w.now())).toEqual({ posted: 0, already: first.posted, reversed: 0 });

    const stored = trialBalance(w.db).map((t) => [t.account, t.currency, t.balance_cents]);
    const computed = books(w.db).trial.filter((t) => t.balance_cents !== 0 || t.debit_cents !== 0).map((t) => [t.account, t.currency, t.balance_cents]);
    expect(stored).toEqual(computed);
    expect(verifyLedger(w.db)).toMatchObject({ ok: true, entries: first.posted });
    const cards = ledgerRows(w.db).filter((e) => e.source_key?.startsWith("card|"));
    expect(cards.map((e) => e.created_by)).toEqual(["purser-feed", "purser-feed"]);
    // Each agent's card spend keeps its cost centre (Sourcing CC100, Support CC200); no VAT code is guessed.
    expect(cards.map((e) => e.lines.find((l) => l.account === "6100")).map((l) => [l?.cost_centre, l?.vat_code]).sort()).toEqual([["CC100", null], ["CC200", null]]);
  });

  it("posts a new movement on the next sync, and a late one from a closed month on the first open day", async () => {
    const w = await redTeamWorld();
    await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    syncLedger(w.db, w.now());
    const month = w.now().toISOString().slice(0, 7);
    lockMonth(w.db, month, "test", w.now());
    await buyPlan(w.db, w.issuing, "replyhub-starter", w.now());
    expect(syncLedger(w.db, w.now()).posted).toBe(1);
    const last = ledgerRows(w.db).at(-1)!;
    expect(last.posting_date > last.doc_date).toBe(true);
    expect(last.posting_date.endsWith("-01")).toBe(true);
  });

  it("sets no VAT code it does not know: card spend shows up as uncoded in the VAT overview", async () => {
    const w = await redTeamWorld();
    await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    syncLedger(w.db, w.now());
    const d = w.now();
    const quarter = `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    expect(vatOverview(w.db, quarter).uncoded_lines).toBeGreaterThan(0);
  });

  it("exports every line as CSV and the whole ledger as JSON with its chain head", async () => {
    const w = await redTeamWorld();
    await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    syncLedger(w.db, w.now());
    const csv = exportCsv(w.db).trimEnd().split("\n");
    expect(csv[0]).toBe("entry,posting_date,doc_date,description,account,account_name,debit,credit,currency,cost_centre,vat_code,vat,party,doc_ref,due_date,source_key,entry_hash");
    expect(csv).toHaveLength(1 + ledgerRows(w.db).reduce((s, e) => s + e.lines.length, 0));
    const json = JSON.parse(exportJson(w.db)) as { check: { ok: boolean; head: string }; entries: unknown[] };
    expect(json.check.ok).toBe(true);
    expect(json.entries).toHaveLength(ledgerRows(w.db).length);
  });

  // Review of PR #108, finding 1: a source line's key held its date, and a payout's date changes from SENT to PAID.
  const transferWorld = async () => {
    const w = await redTeamWorld();
    w.db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('INV-1', 'Bergtex Textil GmbH', '1000.00', 'EUR', '2026-11-30', 'h', 'b', 'd', 'RECEIVED')").run();
    w.db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-1', 'req-1', 'INV-1', '1000.00', 'EUR', 'SWIFT', 'EUR 5.00', 'SENT', 'a', '2026-11-03T10:00:00.000Z')").run();
    return w;
  };
  const netOf = (db: Parameters<typeof trialBalance>[0], account: string, currency = "EUR") => trialBalance(db).find((t) => t.account === account && t.currency === currency)?.balance_cents ?? 0;

  it("posts a supplier payment once when its payout goes from SENT to PAID", async () => {
    const w = await transferWorld();
    syncLedger(w.db, w.now());
    const before = netOf(w.db, "6900") + netOf(w.db, "6200");
    w.db.prepare("UPDATE transfers SET status = 'PAID', updated_at = '2026-11-04T09:00:00.000Z' WHERE request_id = 'req-1'").run();
    const again = syncLedger(w.db, w.now());
    expect(netOf(w.db, "6900") + netOf(w.db, "6200")).toBe(before);
    expect(before).toBe(100_000);
    expect(again).toMatchObject({ posted: 0, reversed: 0 });
    expect(verifyLedger(w.db).ok).toBe(true);
  });

  it("does not post a card charge again when Airwallex re-keys it, and reverses one that is reversed or merged away", async () => {
    const w = await redTeamWorld();
    await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
    syncLedger(w.db, w.now());
    const spend = () => netOf(w.db, "6100");
    const charged = spend();
    expect(charged).toBeGreaterThan(0);
    const id = (w.db.prepare("SELECT transaction_id FROM card_transactions WHERE approved = 1").get() as { transaction_id: string }).transaction_id;
    // Re-keyed under the card transaction id: the same authorisation, nothing new to post.
    w.db.prepare("UPDATE card_transactions SET transaction_id = 'ctx-new' WHERE transaction_id = ?").run(id);
    expect(syncLedger(w.db, w.now())).toMatchObject({ posted: 0, reversed: 0 });
    expect(spend()).toBe(charged);
    // Recorded twice (old and new id), then merged into one: the second posting is reversed, not kept.
    const row = w.db.prepare("SELECT * FROM card_transactions WHERE transaction_id = 'ctx-new'").get() as Record<string, unknown>;
    w.db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, purpose, source, occurred_at, recorded_at) VALUES (@x, @card_id, @agent, @merchant, @mcc, @amount_cents, @currency, @status, @approved, @failure_reason, @purpose, @source, @occurred_at, @recorded_at)").run({ ...row, x: "legacy-dup" });
    syncLedger(w.db, w.now());
    expect(spend()).toBe(2 * charged);
    w.db.prepare("DELETE FROM card_transactions WHERE transaction_id = 'legacy-dup'").run();
    expect(syncLedger(w.db, w.now()).reversed).toBe(1);
    expect(spend()).toBe(charged);
    // Reversed by the card network later: the spend is reversed in the ledger too.
    w.db.prepare("UPDATE card_transactions SET approved = 0, status = 'REVERSED' WHERE transaction_id = 'ctx-new'").run();
    expect(syncLedger(w.db, w.now()).reversed).toBe(1);
    expect(spend()).toBe(0);
    expect(verifyLedger(w.db).ok).toBe(true);
  });
});
