// Chaos per partner (master list 409 and 726), next to test/chaos.test.ts (Anthropic, the relay, Metal's RPC, Airwallex)
// and test/erp-hardening.test.ts (Business Central and Exact 429s): T:0 down and slow, Moneybird down and slow, Claude
// slow on /try/sign, and the tokenisation RPC down in the middle of a flow. Each case asserts plain behaviour (a plain
// message, a stop or a retry, a recorded row) and, after the partner is back, nothing paid, posted or sent twice.
// Fakes only: no network.
import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { doubleEntry, type Posting } from "../src/accounting/books.js";
import type { JournalLine } from "../src/accounting/gl.js";
import { T0Client, t0AccountType } from "../src/accounting/t0.js";
import { t0SinkOnce } from "../src/accounting/t0Sink.js";
import { CHART } from "../src/config/gl.js";
import { openDb } from "../src/db/open.js";
import { staticToken } from "../src/erp/auth.js";
import { ErpError, fetchTransport, type HttpRequest, type Transport } from "../src/erp/connector.js";
import { MoneybirdConnector, type MoneybirdConfig } from "../src/erp/moneybird.js";
import { syncAll, syncStatus, type SyncItem } from "../src/erp/sync.js";
import { claudeReadInvoice } from "../src/try/claude.js";
import type { Request } from "../src/tokenize/client.js";
import { READ_BY_CODE } from "../worker/src/agentLine.js";
import { TrySignDesk } from "../worker/src/trySign.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";
import { FakeMoneybird, TAX } from "./fakes/moneybird.js";
import { chartAccounts, FakeT0 } from "./fakes/t0.js";
import { StandInAdvisor } from "./support/adviceStandIn.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { liveWorld, removeTokenizeWorlds } from "./support/tokenizeWorld.js";
import { TEST_RATE, call, sqlOver, t0 as tryClock, walkAgents } from "./support/trySign.js";

afterAll(removeTokenizeWorlds);

/** A fetch that never answers: it waits until the caller's own time limit aborts it, as a partner that hangs does. */
const hangingFetch = (seen: string[] = []) => ((url: string, init: RequestInit = {}) => {
  seen.push(String(url));
  return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))));
}) as unknown as typeof fetch;

// ── T:0 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const line = (over: Partial<JournalLine>): JournalLine => ({
  date: "2026-11-12T10:00:00Z", source: "card", ref: "r", description: "d", counterparty: "c", agent: "sourcing", cost_centre: "CC100",
  gl_account: "6100", gl_name: "Software", bank_account: "1200", amount: "-19.99", currency: "EUR", proof: "p", approval: "", rule: "", ...over,
});
const postings: Posting[] = doubleEntry([
  line({ source: "opening", ref: "funding", description: "Owner funds the EUR account", agent: "", cost_centre: "", gl_account: "3000", amount: "1000.00", proof: "dep_1", date: "2026-11-11T08:00:00Z" }),
  line({ source: "card", ref: "txn_1", description: "Software seat", amount: "-19.99", proof: "txn_1" }),
  line({ source: "transfer", ref: "req_9", description: "Licence", agent: "treasury", cost_centre: "CC300", gl_account: "6350", amount: "-240.00", proof: "tr_9" }),
]);
const books = () => ({ balanced: true, postings });
const t0Env = { T0_ENABLED: "on" } as NodeJS.ProcessEnv;

describe("T:0 down, then back", () => {
  it("goes down after the first journal entry: the push stops and says so, the payment is not touched; back up, each entry is in T:0 once", async () => {
    const db = openDb(":memory:");
    const fake = new FakeT0(chartAccounts(Object.keys(CHART), (c) => t0AccountType(c) ?? "expenses"));
    let posts = 0, down = false;
    const flaky = (async (url: string, init?: RequestInit) => {
      if (down) throw new TypeError("fetch failed: connect ECONNREFUSED");
      const r = await fake.fetch(url, init);
      if ((init?.method ?? "GET").toUpperCase() === "POST" && ++posts === 1) down = true; // T:0 falls over right after the first post
      return r;
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    const first = await t0SinkOnce(db, { env: t0Env, client: new T0Client({ apiKey: fake.key, fetch: flaky, retryDelayMs: 0 }), books, log: (l) => lines.push(l) });
    expect(first).toMatchObject({ ran: true, ok: false, error: expect.stringMatching(/ECONNREFUSED|fetch failed/) });
    expect(lines.join("\n")).toContain("push to T:0 failed, ignored (the payment is not affected)");
    expect(fake.entries).toHaveLength(1);
    // The one that went in is recorded in the ledger, so the next run never sends it again.
    expect((db.prepare("SELECT COUNT(*) AS n FROM t0_postings").get() as { n: number }).n).toBe(1);

    down = false;
    const again = await t0SinkOnce(db, { env: t0Env, client: new T0Client({ apiKey: fake.key, fetch: flaky, retryDelayMs: 0 }), books });
    expect(again).toEqual({ ran: true, ok: true, posted: 2, skipped: 1 });
    expect(fake.entries).toHaveLength(3);
    expect(new Set(fake.entries.map((e) => e.je_number)).size).toBe(3);
  });

  it("slow: the client's time limit fires, nothing is posted and the push says why; the next push posts each entry once", async () => {
    const db = openDb(":memory:");
    const fake = new FakeT0(chartAccounts(Object.keys(CHART), (c) => t0AccountType(c) ?? "expenses"));
    const seen: string[] = [];
    const started = Date.now();
    const slow = await t0SinkOnce(db, { env: t0Env, client: new T0Client({ apiKey: fake.key, fetch: hangingFetch(seen), retryDelayMs: 0, timeoutMs: 40 }), books });
    expect(slow).toMatchObject({ ran: true, ok: false });
    expect((slow as { error: string }).error).toMatch(/abort|time/i);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fake.posts()).toBe(0);
    expect(seen.length).toBeGreaterThan(0);
    const back = await t0SinkOnce(db, { env: t0Env, client: new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 }), books });
    expect(back).toEqual({ ran: true, ok: true, posted: 3, skipped: 0 });
    expect(await t0SinkOnce(db, { env: t0Env, client: new T0Client({ apiKey: fake.key, fetch: fake.fetch, retryDelayMs: 0 }), books })).toEqual({ ran: true, ok: true, posted: 0, skipped: 3 });
    expect(fake.entries).toHaveLength(3);
  });
});

// ── Moneybird ───────────────────────────────────────────────────────────────────────────────────────────────────────
const noSleep = async () => {};
function moneybird(transport: (inner: Transport) => Transport) {
  const fake = new FakeMoneybird();
  const cfg: MoneybirdConfig = {
    baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR",
    taxRates: { NL21: TAX[0]!.id, NL9: TAX[1]!.id, NL0: TAX[2]!.id }, glMap: {}, projects: { CC100: "458026356994737301" }, ignoreCostCentres: false,
  };
  return { fake, c: new MoneybirdConnector(cfg, transport(fake.transport), staticToken(fake.token)), db: openDb(":memory:") };
}
const items = (): SyncItem[] => [
  { kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() },
  { kind: "payment", object: samplePayment() }, { kind: "journal", object: sampleJournal() },
];

describe("Moneybird down, then back", () => {
  it("goes down after the supplier and the invoice: the rest is marked failed with the reason; back up, nothing is posted twice", async () => {
    let down = false;
    const { fake, c, db } = moneybird((inner) => ({
      async send(req: HttpRequest) {
        if (down) throw new ErpError("network", `${req.method} moneybird.com: connect ECONNREFUSED`, { retryable: true });
        const r = await inner.send(req);
        if (req.method === "POST" && /\/documents\/purchase_invoices\.json$/.test(new URL(req.url).pathname)) down = true;
        return r;
      },
    }));
    const first = await syncAll(db, c, items(), { sleep: noSleep, maxAttempts: 2 });
    // The invoice's header went in; its PDF did not (Moneybird fell over), so the invoice is failed, with the reason, and
    // the payment waits for it. The journal entry failed on its own.
    expect(first.map((r) => [r.kind, r.outcome])).toEqual([["vendor", "pushed"], ["invoice", "failed"], ["payment", "waiting"], ["journal", "failed"]]);
    expect(first.filter((r) => r.outcome === "failed").every((r) => /network|ECONNREFUSED/.test(r.detail ?? ""))).toBe(true);
    expect(syncStatus(db, "moneybird").filter((r) => r.status === "failed").map((r) => r.kind).sort()).toEqual(["invoice", "journal"]);
    const before = { contacts: fake.contacts.size, invoices: fake.invoices.size };

    down = false;
    const again = await syncAll(db, c, items(), { sleep: noSleep });
    expect(again.map((r) => r.outcome)).not.toContain("failed");
    expect(again.filter((r) => r.kind === "payment" || r.kind === "journal").map((r) => r.outcome)).toEqual(["pushed", "pushed"]);
    expect(again.find((r) => r.kind === "vendor")!.outcome).toBe("unchanged");
    expect({ contacts: fake.contacts.size, invoices: fake.invoices.size }).toEqual(before);
    expect(fake.posts("/contacts")).toHaveLength(1);
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(1);
    expect(fake.journals.size).toBe(1);
    expect(fake.attachments).toHaveLength(1);
    // A third run sends nothing at all.
    const sent = fake.transport.sent.length;
    expect((await syncAll(db, c, items(), { sleep: noSleep })).every((r) => r.outcome === "unchanged")).toBe(true);
    expect(fake.transport.sent.filter((r) => r.method !== "GET").length).toBe(fake.transport.sent.slice(0, sent).filter((r) => r.method !== "GET").length);
  });

  it("slow: the live transport's time limit turns a hanging Moneybird into a retryable network error, with no body sent twice", async () => {
    const real = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = hangingFetch(seen);
    try {
      const t = fetchTransport(40);
      const err = await t.send({ method: "POST", url: "https://moneybird.com/api/v2/123/contacts.json", headers: { authorization: "Bearer test" }, body: "{}" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ErpError);
      expect(err).toMatchObject({ kind: "network", retryable: true });
      expect((err as Error).message).not.toContain("Bearer");
      expect(seen).toHaveLength(1);
    } finally {
      globalThis.fetch = real;
    }
    // The sync runner's answer to that error, through the same connector: it asks before it sends again, so a slow
    // answer that did land is found, not doubled.
    let slowOnce = true;
    const { fake, c, db } = moneybird((inner) => ({
      async send(req: HttpRequest) {
        if (slowOnce && req.method === "POST") {
          slowOnce = false;
          await inner.send(req); // Moneybird did it, but the answer never came back in time
          throw new ErpError("network", `${req.method} moneybird.com: The operation was aborted due to timeout`, { retryable: true });
        }
        return inner.send(req);
      },
    }));
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep });
    expect(res[0]!.outcome).toMatch(/pushed|found_existing/);
    expect(fake.contacts.size).toBe(1);
  });
});

// ── Claude slow on /try/sign ─────────────────────────────────────────────────────────────────────────────────────────
describe("Claude slow on /try/sign", () => {
  it("the reader's time limit fires, code's own reading takes over, labelled with the reason, and the terms still come", async () => {
    const seen: string[] = [];
    const reader = claudeReadInvoice("sk-test-not-a-key", hangingFetch(seen), 40);
    const d = new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => tryClock, fx: new StandInQuotes(() => tryClock.getTime()), rate: TEST_RATE, reader, advisor: new StandInAdvisor().ask, recorded: null });
    const ip = "198.51.100.77";
    const opened = await call(d, "world", {}, { ip });
    expect(opened.status).toBe(201);
    const { world } = (await opened.json()) as { world: { token: string } };
    const started = Date.now();
    const s = await walkAgents(d, world.token, ip);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(seen).toHaveLength(1); // one call, not retried in a loop
    const read = (s.read as { result: { source: string; by: string; live: boolean } }).result;
    expect(read).toMatchObject({ source: "code", live: false });
    expect(read.by).toBe(`${READ_BY_CODE} · the live agent did not answer in time, or not in the expected shape`);
    const check = (s.check as { result: { reading: { source: string; label: string } } }).result;
    expect(check.reading).toMatchObject({ source: "code", label: expect.stringContaining(READ_BY_CODE) });
    const proposals = (s.ready as unknown as { proposals: { proposal_id: string; canonical: string }[] }).proposals;
    expect(JSON.parse(proposals.find((p) => p.proposal_id === "T-0002")!.canonical)).toMatchObject({ amount: "1850.00" });
  });
});

// ── The tokenisation RPC ─────────────────────────────────────────────────────────────────────────────────────────────
describe("the tokenisation RPC goes down in the middle of finance", () => {
  it("stops with a plain message after the offer, signs nothing new while down; back up, each transaction is on chain once and the price is paid once", async () => {
    const w = await liveWorld();
    await w.upTo("finance");
    let sends = 0, down = false;
    const outage: Request = async (a) => {
      if (down) throw new Error("connect ECONNREFUSED (simulated RPC outage)");
      const r = await w.chain.request(a);
      if (a.method === "eth_getTransactionReceipt" && r && sends >= 1) down = true; // down right after the offer's receipt
      if (a.method === "eth_sendRawTransaction") sends++;
      return r;
    };
    const creditorBefore = await w.balance(w.role("creditor").address);
    const mined = w.chain.mined.length;
    const stopped = await w.run("finance", {}, outage);
    expect(stopped.code).not.toBe(0);
    expect(stopped.text).toMatch(/ECONNREFUSED|STOPPED|stopped/);
    expect(w.statusOf("offer")).toBe("success");
    expect(w.chain.mined.length - mined).toBe(1);
    // Whatever the run recorded before the outage is at most signed, never sent twice.
    expect(w.txs().filter((t) => t.key === "offer")).toHaveLength(1);

    down = false;
    const again = await w.run("finance");
    expect({ code: again.code, text: again.text }).toMatchObject({ code: 0 });
    for (const key of ["offer", "financier-approve", "accept"]) expect({ key, n: w.txs().filter((t) => t.key === key).length, status: w.statusOf(key) }).toEqual({ key, n: 1, status: "success" });
    expect(w.chain.mined.length - mined).toBe(3);
    const paid = (await w.balance(w.role("creditor").address)) - creditorBefore;
    expect(paid > 0n).toBe(true);
    // Run once more: nothing is sent, nothing is paid again.
    const third = await w.run("finance");
    expect(third.code).toBe(0);
    expect(third.requests.filter((m) => m === "eth_sendRawTransaction")).toEqual([]);
    expect((await w.balance(w.role("creditor").address)) - creditorBefore).toBe(paid);
  }, 60_000);
});
