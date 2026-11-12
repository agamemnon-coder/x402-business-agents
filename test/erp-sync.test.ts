// The ERP sync runner (src/erp/sync.ts): dependencies first, nothing posted twice, retries only what may be retried,
// a crash between "sent" and "recorded" found again instead of posted again, and a changed object never overwritten.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { ErpError, type ErpConnector, type RefResolver } from "../src/erp/connector.js";
import type { JournalEntry, ObjectKind, Payment, PurchaseInvoice, Vendor } from "../src/erp/model.js";
import { correct, ensureErpSchema, syncAll, syncStatus, type SyncItem } from "../src/erp/sync.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

type Call = { op: string; id: string; refs?: Record<string, string | null> };

/** A connector that remembers what it "created" and fails on cue. */
function fakeConnector(o: { failures?: Record<string, ErpError[]>; existing?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const store = new Map<string, string>(Object.entries(o.existing ?? {}));
  let n = 0;
  const fail = (key: string) => {
    const q = o.failures?.[key];
    if (q && q.length) throw q.shift()!;
  };
  const conn: ErpConnector & { calls: Call[]; store: Map<string, string> } = {
    name: "exact", calls, store,
    async pullChartOfAccounts() { return []; },
    async pullVendors() { return []; },
    async findExisting(kind: ObjectKind, obj: Vendor | PurchaseInvoice | Payment | JournalEntry) {
      calls.push({ op: `find:${kind}`, id: obj.id });
      return store.get(`${kind}:${obj.id}`) ?? null;
    },
    async pushVendor(v) { calls.push({ op: "vendor", id: v.id }); fail(`vendor:${v.id}`); const id = `ext-v-${++n}`; store.set(`vendor:${v.id}`, id); return id; },
    async pushPurchaseInvoice(inv, refs: RefResolver) {
      calls.push({ op: "invoice", id: inv.id, refs: { vendor: refs.vendor(inv.vendorId) } }); fail(`invoice:${inv.id}`);
      const id = `ext-i-${++n}`; store.set(`invoice:${inv.id}`, id); return id;
    },
    async pushCreditNote(inv, orig) { calls.push({ op: "credit", id: inv.id, refs: { original: orig } }); return `ext-c-${++n}`; },
    async pushPayment(p, refs) { calls.push({ op: "payment", id: p.id, refs: { invoice: refs.invoice(p.invoiceId) } }); fail(`payment:${p.id}`); const id = `ext-p-${++n}`; store.set(`payment:${p.id}`, id); return id; },
    async pushJournalEntry(j) { calls.push({ op: "journal", id: j.id }); fail(`journal:${j.id}`); const id = `ext-j-${++n}`; store.set(`journal:${j.id}`, id); return id; },
    async pullPaymentStatus() { return "unknown"; },
  };
  return conn;
}

const items = (): SyncItem[] => [
  // Deliberately out of order: the runner sends the vendor first.
  { kind: "payment", object: samplePayment() },
  { kind: "journal", object: sampleJournal() },
  { kind: "invoice", object: sampleInvoice() },
  { kind: "vendor", object: sampleVendor() },
];
const noSleep = async () => {};

describe("the ERP sync runner", () => {
  it("sends vendor, invoice, payment, journal in that order, each with the ids it depends on", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    const res = await syncAll(db, c, items(), { sleep: noSleep });
    expect(res.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["vendor:pushed", "invoice:pushed", "payment:pushed", "journal:pushed"]);
    expect(c.calls.map((x) => x.op)).toEqual(["vendor", "invoice", "payment", "journal"]);
    expect(c.calls[1]!.refs).toEqual({ vendor: "ext-v-1" });
    expect(c.calls[2]!.refs).toEqual({ invoice: "ext-i-2" });
    expect(syncStatus(db, "exact").every((r) => r.status === "synced")).toBe(true);
    // Every result is in the audit log.
    const events = (db.prepare("SELECT event FROM audit_log WHERE event LIKE 'erp.%' ORDER BY seq").all() as { event: string }[]).map((e) => e.event);
    expect(events).toEqual(["erp.pushed", "erp.pushed", "erp.pushed", "erp.pushed"]);
  });

  it("sends nothing the second time when nothing changed", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    await syncAll(db, c, items(), { sleep: noSleep });
    const before = c.calls.length;
    const res = await syncAll(db, c, items(), { sleep: noSleep });
    expect(res.every((r) => r.outcome === "unchanged")).toBe(true);
    expect(c.calls.length).toBe(before);
  });

  it("lets an invoice wait while its vendor is not in the ERP yet", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector({ failures: { "vendor:V-1": [new ErpError("validation", "HTTP 400: name too long", { status: 400 })] } });
    const res = await syncAll(db, c, items(), { sleep: noSleep });
    expect(res.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["vendor:failed", "invoice:waiting", "payment:waiting", "journal:pushed"]);
    expect(res[0]!.detail).toMatch(/name too long/);
    expect(c.calls.filter((x) => x.op === "vendor")).toHaveLength(1); // a validation error is not retried
  });

  it("retries a rate limit and a server error with back-off, honouring Retry-After", async () => {
    const db = openDb(":memory:");
    const slept: number[] = [];
    const c = fakeConnector({ failures: { "vendor:V-1": [new ErpError("rate_limited", "429", { retryable: true, retryAfterMs: 7000, status: 429 }), new ErpError("server", "503", { retryable: true, status: 503 })] } });
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: async (ms) => { slept.push(ms); }, baseDelayMs: 100 });
    expect(res[0]!.outcome).toBe("pushed");
    expect(slept).toEqual([7000, 200]);
  });

  it("gives up after the last attempt and says why", async () => {
    const db = openDb(":memory:");
    const e = () => new ErpError("rate_limited", "429", { retryable: true, status: 429 });
    const c = fakeConnector({ failures: { "vendor:V-1": [e(), e(), e()] } });
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep, maxAttempts: 3 });
    expect(res[0]!.outcome).toBe("failed");
    expect(syncStatus(db, "exact")[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("never posts twice: after an answer that never came, it looks for the object first and finds it", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    // The ERP created the invoice, but the answer was lost (a network error after the request went out).
    const lost = new ErpError("network", "socket hang up", { retryable: true });
    c.pushPurchaseInvoice = async (inv) => { c.calls.push({ op: "invoice", id: inv.id }); c.store.set(`invoice:${inv.id}`, "ext-i-created"); throw lost; };
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }], { sleep: noSleep });
    expect(res[1]).toMatchObject({ outcome: "found_existing", externalId: "ext-i-created" });
    expect(c.calls.filter((x) => x.op === "invoice")).toHaveLength(1);
    expect(c.calls.map((x) => x.op)).toContain("find:invoice");
  });

  it("after a crash between sending and recording, the next run finds the object instead of sending it again", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector({ existing: { "vendor:V-1": "ext-v-earlier" } });
    // A row left in 'pending' by a run that stopped after sending.
    ensureErpSchema(db);
    db.prepare("INSERT INTO erp_sync (connector, kind, object_id, status, attempts, updated_at) VALUES ('exact', 'vendor', 'V-1', 'pending', 1, '2026-11-08T00:00:00Z')").run();
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep });
    expect(res[0]).toMatchObject({ outcome: "found_existing", externalId: "ext-v-earlier" });
    expect(c.calls.map((x) => x.op)).toEqual(["find:vendor"]);
  });

  it("refuses an invalid object before any request", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    const bad = sampleJournal();
    bad.lines[0]!.debitCents += 1;
    const res = await syncAll(db, c, [{ kind: "journal", object: bad }], { sleep: noSleep });
    expect(res[0]).toMatchObject({ outcome: "invalid" });
    expect(res[0]!.detail).toMatch(/does not balance/);
    expect(c.calls).toEqual([]);
  });

  it("never overwrites an invoice that changed after it was sent: it needs a correction, done with a credit note", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }], { sleep: noSleep });
    const changed = sampleInvoice();
    changed.lines[0]!.netCents += 1000;
    changed.lines[0]!.vatCents += 210;
    changed.totals = { netCents: changed.totals.netCents + 1000, vatCents: changed.totals.vatCents + 210, grossCents: changed.totals.grossCents + 1210 };
    const res = await syncAll(db, c, [{ kind: "invoice", object: changed }], { sleep: noSleep });
    expect(res[0]!.outcome).toBe("needs_correction");
    expect(c.calls.filter((x) => x.op === "invoice")).toHaveLength(1); // nothing sent over the first one
    // The correction: a credit note against the original as it was sent, then the new version.
    const fixed = await correct(db, c, { kind: "invoice", object: changed });
    expect(fixed.outcome).toBe("corrected");
    const credit = c.calls.find((x) => x.op === "credit")!;
    expect(credit.refs).toEqual({ original: "ext-i-2" });
    expect(c.calls.filter((x) => x.op === "invoice")).toHaveLength(2);
    expect(syncStatus(db, "exact").find((r) => r.kind === "invoice")).toMatchObject({ status: "synced" });
    const audit = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'erp.corrected'").get() as { payload_json: string };
    expect(JSON.parse(audit.payload_json)).toMatchObject({ credit_note: expect.stringMatching(/^ext-c-/), replaced: "ext-i-2" });
  });

  it("does not correct a vendor or a payment by itself: a person checks those", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep });
    const moved = { ...sampleVendor(), ibanLast4: "9999", ibanSha256: "a".repeat(64) };
    expect((await syncAll(db, c, [{ kind: "vendor", object: moved }], { sleep: noSleep }))[0]!.outcome).toBe("needs_correction");
    await expect(correct(db, c, { kind: "vendor", object: moved })).rejects.toThrow(/a person/);
  });

  it("in a dry run, writes nothing to the ledger", async () => {
    const db = openDb(":memory:");
    const c = fakeConnector();
    const res = await syncAll(db, c, items(), { sleep: noSleep, dryRun: true });
    expect(res.map((r) => r.outcome)).toEqual(["pushed", "pushed", "pushed", "pushed"]);
    expect(syncStatus(db, "exact")).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event LIKE 'erp.%'").get() as { n: number }).n).toBe(0);
  });
});
