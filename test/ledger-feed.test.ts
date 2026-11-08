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
    expect(syncLedger(w.db, w.now())).toEqual({ posted: 0, already: first.posted });

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
});
