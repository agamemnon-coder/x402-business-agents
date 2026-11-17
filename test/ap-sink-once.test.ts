// Round 3 review (17 Nov): pushOnce checked ap_sink_events, awaited the push, and only then wrote its row, so two syncs at
// once (the payables server and the autopilot on one ledger) both pushed: two rows in the journal for one event.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CsvFileSink, pushOnce, type ApEntry, type BookkeepingSink } from "../src/ap/books.js";
import { openDb } from "../src/db/open.js";
import type { ApInvoiceRow } from "../src/ap/store.js";

const inv = { id: "AP-9", doc_sha256: "x" } as unknown as ApInvoiceRow;
const entries: ApEntry[] = [{ date: "2026-11-10", invoice_id: "AP-9", event: "payment", account: "2100", account_name: "", debit: "100.00", credit: "", currency: "EUR", memo: "m", doc_sha256: "x" }];
const ledger = () => { const db = openDb(":memory:"); db.pragma("foreign_keys = OFF"); return db; };

describe("a sink takes each event of an invoice once, also when two syncs run at once", () => {
  it("writes one journal row for two concurrent pushes", async () => {
    const db = ledger();
    const path = join(mkdtempSync(join(tmpdir(), "sink-once-")), "journal.csv");
    const sink = new CsvFileSink(path);
    const r = await Promise.all([pushOnce(db, sink, "payment", entries, inv, new Date()), pushOnce(db, sink, "payment", entries, inv, new Date())]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("frees the event again when the push fails, and retakes a claim a stopped process left over ten minutes ago", async () => {
    const db = ledger();
    let n = 0;
    const failing: BookkeepingSink = { name: "flaky", push: async () => { n++; throw new Error("down"); } } as unknown as BookkeepingSink;
    expect(await pushOnce(db, failing, "payment", entries, inv, new Date())).toBe(false);
    const ok: BookkeepingSink = { name: "flaky", push: async () => { n++; } } as unknown as BookkeepingSink;
    expect(await pushOnce(db, ok, "payment", entries, inv, new Date())).toBe(true);
    expect(n).toBe(2);
    // A claim left by a process that stopped mid-push.
    db.prepare("INSERT INTO ap_sink_events (invoice_id, event, sink, pushed_at) VALUES ('AP-9', 'reversal', 'flaky', 'pushing:2026-11-10T09:00:00.000Z')").run();
    expect(await pushOnce(db, ok, "reversal", entries, inv, new Date("2026-11-10T09:05:00Z"))).toBe(false);
    expect(await pushOnce(db, ok, "reversal", entries, inv, new Date("2026-11-10T09:11:00Z"))).toBe(true);
  });
});
