// Customer payments left "being settled" (review of dashboard-chain, 2 November): resolved by the reconciliation and
// the runner from the ledger and Metal's facilitator, never left lowering the customer's figures for good.
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const longAgo = new Date(NOW.getTime() - RESOLVE_AFTER_MS - 60_000).toISOString();

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
function settling(db: DB, n: number, startedAt = longAgo): void {
  db.prepare("INSERT INTO sale_settlements (key, payer, nonce, price_cents, status, started_at, updated_at) VALUES (?, ?, ?, 5, 'SETTLING', ?, ?)")
    .run(`${PAYER}:${nonce(n)}`, PAYER, nonce(n), startedAt, startedAt);
}
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
    const r = await resolveSettlements(db, f, NOW);
    expect(r.resolved).toEqual([{ key: `${PAYER}:${nonce(1)}`, outcome: "DONE", cents: 5, tx: tx(1), sale_id: 1 }]);
    expect(f.asked).toEqual([]);
    expect(status(db, 1)).toMatchObject({ status: "DONE", sale_id: 1 });
  });

  it("settled at the facilitator with no sale: CHARGED, counted as paid as on chain, and sent to the CFO as owed back", async () => {
    const db = world();
    settling(db, 2);
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 5, pendingCents: 5 });
    const r = await resolveSettlements(db, facilitator(2), NOW);
    expect(r.resolved.map((x) => x.outcome)).toEqual(["CHARGED"]);
    expect(status(db, 2)).toMatchObject({ status: "CHARGED", tx_hash: tx(2), sale_id: null });
    expect(status(db, 2).detail).toMatch(/charged, no delivery recorded; owed back unless a person finds it was delivered/);
    // No sale is written: whether the stock check reached the customer is not known. The mandate counts it, as Metal does.
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 1 });
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 10, pendingCents: 0 });
    expect(mandatePayments(db, "customer").at(-1)).toMatchObject({ cents: 5, tx: tx(2), nonce: nonce(2), state: "paid" });
    expect(buildSnapshot(db).budgets.counterparty).toMatchObject({ spent: "0.10", pending: "0.00" });
    const events = db.prepare("SELECT event FROM audit_log WHERE event IN ('sale.settlement_resolved', 'reconcile.difference') ORDER BY seq").all();
    expect(events).toEqual([{ event: "sale.settlement_resolved" }, { event: "reconcile.difference" }]);
    expect(buildSnapshot(db).feed.some((f) => /was charged with no delivery recorded .*owed back unless a person finds it was delivered/.test(f.text))).toBe(true);
  });

  it("not at the facilitator: FAILED, nothing moved; the pending line closes", async () => {
    const db = world();
    settling(db, 3);
    await resolveSettlements(db, facilitator(), NOW);
    expect(status(db, 3).status).toBe("FAILED");
    expect(status(db, 3).detail).toMatch(/the facilitator has no settlement for it \d+ min after its settle began: nothing moved/);
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 5, pendingCents: 0 });
  });

  it("leaves a fresh one alone, and one it cannot look up open, saying why", async () => {
    const db = world();
    settling(db, 4, new Date(NOW.getTime() - 60_000).toISOString());
    settling(db, 5);
    const f = facilitator(4, 5);
    expect(await resolveSettlements(db, undefined, NOW)).toEqual({ resolved: [], open: 1, skipped: "settlements left open (no facilitator look-up configured)" });
    const down = Object.assign(async () => { throw new Error("fetch failed"); }, {}) as SettlementLookup;
    expect(await resolveSettlements(db, down, NOW)).toMatchObject({ resolved: [], open: 1, skipped: "settlements left open (the facilitator could not be asked: fetch failed)" });
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
