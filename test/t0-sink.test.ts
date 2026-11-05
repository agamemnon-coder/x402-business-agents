// The T:0 sink (src/accounting/t0Sink.ts), behind T0_ENABLED: Purser's books go to T:0 after a money action, once per
// journal entry, and a payment never depends on T:0. Every call goes to the in-memory T:0 (test/fakes/t0.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doubleEntry, type Posting } from "../src/accounting/books.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { CHART } from "../src/config/gl.js";
import { T0Client, t0AccountType } from "../src/accounting/t0.js";
import { ratesFromEnv, T0Sink, t0SinkOnce } from "../src/accounting/t0Sink.js";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { termsHash } from "../src/lib/terms.js";
import { chartAccounts, FakeT0 } from "./fakes/t0.js";

const line = (over: Partial<JournalLine>): JournalLine => ({
  date: "2026-10-30T10:00:00Z", source: "card", ref: "r", description: "d", counterparty: "c", agent: "sourcing", cost_centre: "CC100",
  gl_account: "6100", gl_name: "Software", bank_account: "1200", amount: "-19.99", currency: "EUR", proof: "p", approval: "", rule: "", ...over,
});
const day: JournalLine[] = [
  line({ source: "opening", ref: "funding", description: "Owner funds the EUR account", agent: "", cost_centre: "", gl_account: "3000", bank_account: "1200", amount: "1000.00", currency: "EUR", proof: "dep_1", date: "2026-10-29T08:00:00Z" }),
  line({ source: "card", ref: "txn_1", description: "Software seat", gl_account: "6100", bank_account: "1200", amount: "-19.99", currency: "EUR", proof: "txn_1" }),
  line({ source: "transfer", ref: "req_9", description: "Licence", agent: "treasury", cost_centre: "CC300", gl_account: "6350", bank_account: "1200", amount: "-240.00", currency: "EUR", proof: "tr_9" }),
];
const postings: Posting[] = doubleEntry(day);
const fixedBooks = () => ({ balanced: true, postings });

let db: ReturnType<typeof openDb>;
let fake: FakeT0;
let client: T0Client;
const env = (over: Record<string, string> = {}) => ({ T0_ENABLED: "on", ...over }) as NodeJS.ProcessEnv;

beforeEach(() => {
  db = openDb(":memory:");
  fake = new FakeT0(chartAccounts(Object.keys(CHART), (c) => t0AccountType(c) ?? "expenses"));
  client = new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("t0SinkOnce", () => {
  it("does nothing with T0_ENABLED off", async () => {
    expect(await t0SinkOnce(db, { env: {}, client, books: fixedBooks })).toEqual({ ran: false, reason: "off" });
    expect(fake.calls).toEqual([]);
  });

  it("posts nothing, and says so, when T0_API_KEY is not set", async () => {
    const lines: string[] = [];
    expect(await t0SinkOnce(db, { env: env(), books: fixedBooks, log: (l) => lines.push(l) })).toEqual({ ran: false, reason: "no key" });
    expect(lines[0]).toContain("T0_API_KEY is not set");
  });

  it("posts each journal entry once: a second run posts nothing new", async () => {
    const first = await t0SinkOnce(db, { env: env(), client, books: fixedBooks });
    expect(first).toEqual({ ran: true, ok: true, posted: 3, skipped: 0 });
    expect(fake.entries).toHaveLength(3);
    const second = await t0SinkOnce(db, { env: env(), client, books: fixedBooks });
    // Fails if: the je_number dedup (t0_postings, and T:0's own list) stops working: entries would be booked twice.
    expect(second).toEqual({ ran: true, ok: true, posted: 0, skipped: 3 });
    expect(fake.entries).toHaveLength(3);
    expect((db.prepare("SELECT COUNT(*) AS n FROM t0_postings").get() as { n: number }).n).toBe(3);
  });

  it("skips by the ledger's record even when T:0 does not list the entries yet", async () => {
    await t0SinkOnce(db, { env: env(), client, books: fixedBooks });
    fake.hideEntries = true;
    expect(await t0SinkOnce(db, { env: env(), client, books: fixedBooks })).toMatchObject({ posted: 0, skipped: 3 });
    expect(fake.entries).toHaveLength(3);
  });

  it("logs and returns when T:0 fails, never throws, and never puts the key in the log", async () => {
    const lines: string[] = [];
    fake.forced.push({ status: 500, body: { code: "CAPI00" } }, { status: 500, body: { code: "CAPI00" } });
    const r = await t0SinkOnce(db, { env: env({ T0_API_KEY: fake.key }), client, books: fixedBooks, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ ran: true, ok: false });
    expect(lines.join("\n")).toContain("ignored (the payment is not affected)");
    expect(lines.join("\n")).not.toContain(fake.key);
  });

  it("a key T:0 rejects (401 CAPI11, as on 5 November) is logged and dropped: nothing posted, nothing recorded", async () => {
    const lines: string[] = [];
    const rejected = new T0Client({ apiKey: "t0-rejected-key", fetch: fake.fetch, retryDelayMs: 0 });
    const r = await t0SinkOnce(db, { env: env({ T0_API_KEY: "t0-rejected-key" }), client: rejected, books: fixedBooks, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ ran: true, ok: false, error: expect.stringContaining("401 CAPI11") });
    expect(fake.posts()).toBe(0);
    expect(lines.join("\n")).toContain("ignored (the payment is not affected)");
    expect(lines.join("\n")).not.toContain("t0-rejected-key");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't0_postings'").get()).toBeUndefined();
  });

  it("stops before any post on a missing rate or a bad T0_RATES, and logs it", async () => {
    const usd = doubleEntry([line({ source: "opening", ref: "f", gl_account: "3000", bank_account: "1201", amount: "5.00", currency: "USD", agent: "", cost_centre: "" })]);
    const r = await t0SinkOnce(db, { env: env(), client, books: () => ({ balanced: true, postings: usd }) });
    expect(r).toMatchObject({ ran: true, ok: false });
    expect(fake.posts()).toBe(0);
    expect(ratesFromEnv("USD=x")).toEqual(expect.stringContaining("not CUR=rate"));
    const rate = ratesFromEnv("USD=0.92, EUR=1");
    expect(typeof rate === "function" && rate("2026-11-04", "USD")).toBe(0.92);
  });
});

describe("T0Sink", () => {
  it("runs one push at a time and folds requests made meanwhile into one more run", async () => {
    const sink = new T0Sink(db, { env: env(), client, books: fixedBooks });
    const a = sink.afterMoney();
    const b = sink.afterMoney();
    const c = sink.afterMoney();
    await Promise.all([a, b, c]);
    // One run posted, the folded second run found nothing new: never two runs listing and posting at once.
    expect(fake.entries).toHaveLength(3);
    expect(sink.last).toEqual({ ran: true, ok: true, posted: 0, skipped: 3 });
  });
});

describe("after an executed proposal", () => {
  it("a payment completes even when T:0 is down; the sink only logs", async () => {
    vi.stubEnv("T0_ENABLED", "on");
    vi.stubEnv("T0_API_KEY", "t0-key-for-tests");
    vi.stubEnv("T0_BASE_URL", "https://t0.invalid");
    vi.stubEnv("HUB_DECISIONS_ENABLED", "");
    const failing = vi.fn(async (_url: unknown, _init?: unknown): Promise<Response> => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", failing);
    try {
      const { execute } = await import("../src/executors/index.js");
      const terms: Terms = { schema: TERMS_SCHEMA, kind: "dev_test", proposal_id: "P-0001", expires_at: "2099-01-01T00:00:00Z", label: "DEV TEST: moves no money", purpose: "t0 sink", amount: "0.00" };
      createProposal(db, { terms, createdBy: "system" });
      decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: termsHash(terms).slice(0, 8), approver: "max", method: "cli" });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await execute(db, "P-0001");
      expect((db.prepare("SELECT status FROM proposals").get() as { status: string }).status).toBe("EXECUTED");
      await vi.waitFor(() => expect(log.mock.calls.flat().join("\n")).toContain("push to T:0 failed, ignored"));
      expect(log.mock.calls.flat().join("\n")).not.toContain("t0-key-for-tests");
      expect(failing.mock.calls.every(([u]) => String(u).startsWith("https://t0.invalid/"))).toBe(true);
      log.mockRestore();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
