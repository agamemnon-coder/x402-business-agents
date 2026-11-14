// Customer payments left "being settled" (review of dashboard-chain, 2 November): resolved by the reconciliation and
// the runner from the ledger and Alta's facilitator, never left lowering the customer's figures for good.
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb, type DB } from "../src/db/open.js";
import { reconcile } from "../src/finance/reconcile.js";
import { RESOLVE_AFTER_MS, resolveSettlements, type SettlementLookup } from "../src/finance/settlements.js";
import { centsToBaseUnits } from "../src/lib/money.js";
import { mandateAvailability, mandatePayments } from "../src/policy/available.js";

const PAYER = "0xdeb2b72781c12b9d2cd66798f47161c88601dd5f";
const BUSINESS = "0x00000000000000000000000000000000000000b1";
const nonce = (n: number) => `0x${(0xa5bb0000 + n).toString(16).padStart(64, "0")}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const NOW = new Date("2026-11-02T17:00:00Z");
const longAgo = new Date(NOW.getTime() - RESOLVE_AFTER_MS - 2 * 60_000).toISOString();

/** A customer mandate with one recorded sale (0.05) and settlements in the given states. */
function world(): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "customer", { cap: "0.10", budget: "5.00", payee: BUSINESS });
  db.prepare("INSERT INTO metal_accounts (role, address) VALUES ('business', ?)").run(BUSINESS);
  sale(db, 1);
  return db;
}
function sale(db: DB, n: number): void {
  db.prepare(`INSERT INTO sales (route, price_cents, payer, settlement_id, tx_hash, request_url, request_params_json, status, created_at)
              VALUES ('GET /v1/stock', 5, ?, ?, ?, 'u', '{}', 'DELIVERED', ?)`).run(PAYER, `eip155:63825:eip3009:0xb5d5:${PAYER}:${nonce(n)}`, tx(n), NOW.toISOString());
}
function settling(db: DB, n: number, startedAt = longAgo, validBefore: number | null = null): void {
  db.prepare("INSERT INTO sale_settlements (key, payer, nonce, price_cents, status, valid_before, started_at, updated_at) VALUES (?, ?, ?, 5, 'SETTLING', ?, ?, ?)")
    .run(`${PAYER}:${nonce(n)}`, PAYER, nonce(n), validBefore, startedAt, startedAt);
}
/** The token: which nonces are used on chain. */
const chainUsed = (...used: number[]) => async (payer: string, n: string) => {
  expect(payer).toBe(PAYER);
  return used.some((x) => nonce(x) === n);
};
const status = (db: DB, n: number) => db.prepare("SELECT status, tx_hash, sale_id, detail FROM sale_settlements WHERE nonce = ?").get(nonce(n)) as { status: string; tx_hash: string | null; sale_id: number | null; detail: string };
/** The facilitator: settled the payments named here (by n), nothing else. */
const facilitator = (...settled: number[]): SettlementLookup & { asked: string[] } => {
  const asked: string[] = [];
  return Object.assign(async (payTo: string, n: string) => {
    asked.push(`${payTo}:${n}`);
    const i = settled.find((x) => nonce(x) === n);
    return i === undefined ? undefined : { transaction: tx(i), amount: String(centsToBaseUnits(5)) };
  }, { asked });
};

describe("resolving payments left being settled", () => {
  it("a settlement whose sale is recorded (the row could not be closed) is DONE, without asking the facilitator", async () => {
    const db = world();
    settling(db, 1);
    // Counted once meanwhile: the sale, not also a pending line.
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 5, pendingCents: 0 });
    const f = facilitator();
    const r = await resolveSettlements(db, { settlementByNonce: f }, NOW);
    expect(r.resolved).toEqual([{ key: `${PAYER}:${nonce(1)}`, outcome: "DONE", cents: 5, tx: tx(1), sale_id: 1 }]);
    expect(f.asked).toEqual([]);
    expect(status(db, 1)).toMatchObject({ status: "DONE", sale_id: 1 });
  });

  it("settled at the facilitator with no sale: CHARGED, counted as paid as on chain, and sent to the CFO as owed back", async () => {
    const db = world();
    settling(db, 2);
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 5, pendingCents: 5 });
    const r = await resolveSettlements(db, { settlementByNonce: facilitator(2), authorizationUsed: chainUsed(2) }, NOW);
    expect(r.resolved.map((x) => x.outcome)).toEqual(["CHARGED"]);
    expect(status(db, 2)).toMatchObject({ status: "CHARGED", tx_hash: tx(2), sale_id: null });
    expect(status(db, 2).detail).toMatch(/charged, no delivery recorded; owed back unless a person finds it was delivered/);
    // No sale is written: whether the stock check reached the customer is not known. The mandate counts it, as Alta does.
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 1 });
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 10, pendingCents: 0 });
    expect(mandatePayments(db, "customer").at(-1)).toMatchObject({ cents: 5, tx: tx(2), nonce: nonce(2), state: "paid" });
    expect(buildSnapshot(db).budgets.counterparty).toMatchObject({ spent: "0.10", pending: "0.00" });
    const events = db.prepare("SELECT event FROM audit_log WHERE event IN ('sale.settlement_resolved', 'reconcile.difference') ORDER BY seq").all();
    expect(events).toEqual([{ event: "sale.settlement_resolved" }, { event: "reconcile.difference" }]);
    expect(buildSnapshot(db).feed.some((f) => /was charged with no delivery recorded .*owed back unless a person finds it was delivered/.test(f.text))).toBe(true);
  });

  it("FAILED only when the chain proves nothing moved: nonce unused and its authorization expired", async () => {
    const db = world();
    settling(db, 3);
    await resolveSettlements(db, { settlementByNonce: facilitator(), authorizationUsed: chainUsed() }, NOW);
    expect(status(db, 3).status).toBe("FAILED");
    expect(status(db, 3).detail).toMatch(/^nothing moved: not at the facilitator, its nonce unused on chain and its authorization expired at /);
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 5, pendingCents: 0 });
  });

  it("an empty facilitator list alone is not proof: used on chain, still valid, or the chain not asked keeps it open", async () => {
    const db = world();
    settling(db, 7); // used on chain: it moved, the facilitator has not listed it yet
    settling(db, 8, longAgo, Math.floor(NOW.getTime() / 1000) + 60); // its authorization is still valid
    settling(db, 9); // the chain cannot be asked
    const once = await resolveSettlements(db, { settlementByNonce: facilitator(), authorizationUsed: async (p, n) => (n === nonce(9) ? Promise.reject(new Error("HTTP request failed.")) : chainUsed(7)(p, n)) }, NOW);
    expect(once).toMatchObject({ resolved: [], open: 3, skipped: "settlements left open (the chain could not be asked: HTTP request failed.)" });
    expect(status(db, 7)).toMatchObject({ status: "SETTLING", detail: "its nonce is used on chain but the facilitator lists no settlement yet: it moved; waiting for the facilitator's record" });
    expect(status(db, 8).status).toBe("SETTLING");
    expect(status(db, 8).detail).toMatch(/^not at the facilitator yet; its authorization is valid until .+, so it may still settle$/);
    expect(status(db, 9)).toMatchObject({ status: "SETTLING", detail: "not at the facilitator; the chain could not be asked whether its nonce was used" });
    expect((await resolveSettlements(db, { settlementByNonce: facilitator() }, NOW)).skipped).toMatch(/the chain could not be asked whether the nonce was used/);
    expect(status(db, 9).status).toBe("SETTLING");
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 5, pendingCents: 15 });
  });

  it("a sale recorded while the facilitator was asked: DONE, never also CHARGED", async () => {
    const db = world();
    settling(db, 10);
    const late: SettlementLookup = async () => { sale(db, 10); return { transaction: tx(10), amount: String(centsToBaseUnits(5)) }; };
    const r = await resolveSettlements(db, { settlementByNonce: late }, NOW);
    expect(r.resolved).toEqual([{ key: `${PAYER}:${nonce(10)}`, outcome: "DONE", cents: 5, tx: tx(10), sale_id: 2 }]);
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 10, pendingCents: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'reconcile.difference'").get()).toEqual({ n: 0 });
  });

  it("a CHARGED row whose sale turns up later counts once, as the sale", () => {
    const db = world();
    db.prepare("INSERT INTO sale_settlements (key, payer, nonce, price_cents, status, tx_hash, started_at, updated_at) VALUES (?, ?, ?, 5, 'CHARGED', ?, ?, ?)")
      .run(`${PAYER}:${nonce(11)}`, PAYER, nonce(11), tx(11), longAgo, longAgo);
    expect(mandateAvailability(db, "customer").paidCents).toBe(10);
    sale(db, 11);
    expect(mandateAvailability(db, "customer").paidCents).toBe(10);
    expect(mandatePayments(db, "customer").filter((p) => p.nonce === nonce(11))).toEqual([expect.objectContaining({ what: "sale 2", state: "paid" })]);
  });

  it("leaves a fresh one alone, and one it cannot look up open, saying why", async () => {
    const db = world();
    settling(db, 4, new Date(NOW.getTime() - 60_000).toISOString());
    settling(db, 5);
    const f = facilitator(4, 5);
    expect(await resolveSettlements(db, {}, NOW)).toEqual({ resolved: [], open: 1, skipped: "settlements left open (no facilitator look-up configured)" });
    const down: SettlementLookup = async () => { throw new Error("fetch failed"); };
    expect(await resolveSettlements(db, { settlementByNonce: down }, NOW)).toMatchObject({ resolved: [], open: 1, skipped: "settlements left open (the facilitator could not be asked: fetch failed)" });
    expect(f.asked).toEqual([]);
    expect([status(db, 4).status, status(db, 5).status]).toEqual(["SETTLING", "SETTLING"]);
  });

  it("runs with the reconciliation, which reports a charged payment as a difference", async () => {
    const db = world();
    settling(db, 6);
    const r = await reconcile(db, { settlementByNonce: facilitator(6) }, NOW);
    expect(r.settlements).toEqual([{ key: `${PAYER}:${nonce(6)}`, outcome: "CHARGED", cents: 5, tx: tx(6), sale_id: null }]);
    expect(r.differences).toEqual([expect.objectContaining({ area: "metal", ref: `${PAYER}:${nonce(6)}` })]);
    // One alarm row for it, written by the resolution (not again by the reconciliation).
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'reconcile.difference'").get()).toEqual({ n: 1 });
  });
});

describe("ledgers from the first sale_settlements: the rebuild is one transaction", () => {
  const OLD = `CREATE TABLE sale_settlements (key TEXT PRIMARY KEY, payer TEXT NOT NULL, nonce TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('SETTLING', 'DONE', 'FAILED')), sale_id INTEGER, tx_hash TEXT, detail TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  const tables = (path: string) => { const r = new Database(path, { readonly: true }); try { return (r.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sale_settlements%' ORDER BY name").all() as { name: string }[]).map((x) => x.name); } finally { r.close(); } };
  const rowsOf = (path: string) => { const r = new Database(path, { readonly: true }); try { return r.prepare("SELECT key, status FROM sale_settlements ORDER BY key").all(); } finally { r.close(); } };
  function ledger(sql: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "settlements-"));
    const path = join(dir, "l.sqlite");
    const raw = new Database(path);
    raw.exec(sql);
    raw.close();
    return { dir, path };
  }

  it("a rebuild that fails half-way leaves the old table whole (nothing stranded)", () => {
    // A row the new table refuses makes the copy fail after the old table was renamed and the new one created.
    const { dir, path } = ledger(`CREATE TABLE sale_settlements (key TEXT PRIMARY KEY, payer TEXT NOT NULL, nonce TEXT NOT NULL, price_cents INTEGER NOT NULL,
      status TEXT NOT NULL, sale_id INTEGER, tx_hash TEXT, detail TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO sale_settlements VALUES ('a', 'p', 'n1', 5, 'SETTLING', NULL, NULL, NULL, 't', 't'), ('b', 'p', 'n2', 5, 'WEIRD', NULL, NULL, NULL, 't', 't');`);
    try {
      expect(() => openDb(path)).toThrow(/CHECK constraint failed/);
      expect(tables(path)).toEqual(["sale_settlements"]);
      expect(rowsOf(path)).toEqual([{ key: "a", status: "SETTLING" }, { key: "b", status: "WEIRD" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rows stranded by an earlier rebuild without a transaction are brought back, the newer copy kept", () => {
    const { dir, path } = ledger(`${OLD.replace("CREATE TABLE sale_settlements", "CREATE TABLE sale_settlements_old")};
      INSERT INTO sale_settlements_old VALUES ('a', 'p', 'n1', 5, 'SETTLING', NULL, NULL, NULL, 't', 't'), ('b', 'p', 'n2', 5, 'SETTLING', NULL, NULL, NULL, 't', 't');
      ${OLD.replace("'FAILED')", "'FAILED', 'CHARGED')")};
      INSERT INTO sale_settlements VALUES ('b', 'p', 'n2', 5, 'DONE', NULL, '0xab', NULL, 't', 't2');`);
    try {
      openDb(path).close();
      expect(tables(path)).toEqual(["sale_settlements"]);
      expect(rowsOf(path)).toEqual([{ key: "a", status: "SETTLING" }, { key: "b", status: "DONE" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("several processes opening the same old ledger at the same moment: all open, the rows are there once (5 rounds)", async () => {
    // Review of 5e27de0: two openers both saw a column missing and both added it ("duplicate column name"). Each child
    // imports first, then waits for one shared start time, so the openings really overlap.
    for (let round = 0; round < 5; round++) {
      const { dir, path } = ledger(`${OLD}; INSERT INTO sale_settlements VALUES ('a', 'p', 'n1', 5, 'SETTLING', NULL, NULL, NULL, 't', 't');`);
      try {
        const script = join(dir, "open.mts");
        writeFileSync(script, `import { openDb } from ${JSON.stringify(resolve("src/db/open.ts"))};\nconst at = Number(process.argv[3]);\nwhile (Date.now() < at) { /* the shared start */ }\nopenDb(process.argv[2]).close();\nconsole.log("opened");\n`);
        const startAt = Date.now() + 2500;
        const run = () => new Promise<{ code: number | null; out: string }>((done) => {
          const c = spawn(process.execPath, ["--import", "tsx", script, path, String(startAt)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          c.stdout.on("data", (d: Buffer) => (out += d.toString()));
          c.stderr.on("data", (d: Buffer) => (out += d.toString()));
          c.on("close", (code) => done({ code, out }));
        });
        const all = await Promise.all([run(), run(), run(), run()]);
        expect(all.map((r) => r.code), all.map((r) => r.out).join("\n")).toEqual([0, 0, 0, 0]);
        expect(tables(path)).toEqual(["sale_settlements"]);
        expect(rowsOf(path)).toEqual([{ key: "a", status: "SETTLING" }]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 90_000);
});

describe("ledgers from the first sale_settlements", () => {
  it("are rebuilt once with the CHARGED state, rows kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "settlements-"));
    try {
      const path = join(dir, "l.sqlite");
      const raw = new Database(path);
      raw.exec(`CREATE TABLE sale_settlements (key TEXT PRIMARY KEY, payer TEXT NOT NULL, nonce TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        status TEXT NOT NULL CHECK (status IN ('SETTLING', 'DONE', 'FAILED')), sale_id INTEGER, tx_hash TEXT, detail TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO sale_settlements VALUES ('k', 'p', 'n', 5, 'SETTLING', NULL, NULL, NULL, 't', 't');`);
      raw.close();
      const db = openDb(path);
      expect(db.prepare("SELECT key, status FROM sale_settlements").all()).toEqual([{ key: "k", status: "SETTLING" }]);
      db.prepare("UPDATE sale_settlements SET status = 'CHARGED'").run();
      db.close();
      expect(openDb(path).prepare("SELECT status FROM sale_settlements").get()).toEqual({ status: "CHARGED" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
