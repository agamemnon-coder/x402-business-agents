import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { openDb, type DB } from "../src/db/open.js";
import { heldCents, recoverHolds, releaseHold, reserveSpend, settleHold, spendLimits } from "../src/policy/holds.js";

const now = new Date("2026-10-30T12:00:00Z");
/** A world whose agents have bound mandates (cap, budget), as bootstrap records them. */
function world(mandates: Record<string, { cap: string; budget: string }>): { db: DB; file: string } {
  const file = join(mkdtempSync(join(tmpdir(), "holds-")), "w.sqlite");
  const db = openDb(file);
  for (const [agent, m] of Object.entries(mandates)) audit(db, "treasury", "mandate.bound", agent, { cap: m.cap, budget: m.budget, payee: "0x0000000000000000000000000000000000000001" }, now);
  return { db, file };
}
/** A paid refund in the ledger, as the refund executor records it. */
function paidRefund(db: DB, saleId: number, paymentId: string, cents: number): void {
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (?, '/v1/stock', ?, '0x1', '/v1/stock', '{}', 'DELIVERED', ?)").run(saleId, cents, now.toISOString());
  db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome) VALUES (?, ?, ?, '0x1', 'PAID')").run(saleId, paymentId, cents);
}

describe("spend holds", () => {
  it("reserves against the agent's mandate budget and refuses what would go over it", () => {
    const { db } = world({ support: { cap: "0.10", budget: "0.25" } });
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "r1", now })).toBeNull();
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "r2", now })).toBeNull();
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "r3", now })).toMatch(/^budget_exceeded: .*support.*0\.25/);
    expect(heldCents(db, "support")).toBe(20);
  });

  it("refuses a payment over the mandate's cap per payment", () => {
    const { db } = world({ support: { cap: "0.10", budget: "4.00" } });
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 11, ref: "r1", now })).toMatch(/^mandate_cap_exceeded/);
  });

  it("counts a retry under the same reference once", () => {
    const { db } = world({ support: { cap: "0.10", budget: "0.10" } });
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "refund-7", now })).toBeNull();
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "refund-7", now })).toBeNull();
    expect(heldCents(db, "support")).toBe(10);
  });

  it("keeps all agents together under the shared total", () => {
    const { db } = world({ sourcing: { cap: "4.00", budget: "12.00" }, treasury: { cap: "4.00", budget: "12.00" } });
    let ok = 0;
    // Two hours apart, so the velocity limits (per minute and per hour) never decide here: only the total does.
    const at = (i: number) => new Date(now.getTime() + i * 7_200_000);
    for (let i = 0; i < 20; i++) if (reserveSpend(db, { agent: i % 2 ? "sourcing" : "treasury", rail: "metal", cents: 400, ref: `t${i}`, now: at(i) }) === null) ok++;
    expect(ok * 400).toBeLessThanOrEqual(TOTAL_BUDGET_CENTS);
    expect(ok).toBe(TOTAL_BUDGET_CENTS / 400);
    expect(reserveSpend(db, { agent: "sourcing", rail: "metal", cents: 1, ref: "last", now: at(21) })).toMatch(/^total_budget_exceeded/);
  });

  it("frees a released hold and keeps a settled one counted by its ledger row", () => {
    const { db } = world({ support: { cap: "0.10", budget: "0.10" } });
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "a", now })).toBeNull();
    releaseHold(db, "a", "refused by the chain", now);
    expect(heldCents(db, "support")).toBe(0);
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "b", now })).toBeNull();
    paidRefund(db, 5, "b", 10);
    settleHold(db, "b", now);
    expect(heldCents(db, "support")).toBe(0);
    expect(spendLimits(db, "support").spentCents).toBe(10);
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 1, ref: "c", now })).toMatch(/^budget_exceeded/);
  });

  it("on restart settles holds whose payment is in the ledger and keeps the rest counted until they are resolved", () => {
    const { db } = world({ support: { cap: "0.10", budget: "1.00" } });
    reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "p1", now });
    reserveSpend(db, { agent: "support", rail: "metal", cents: 10, ref: "p2", now });
    paidRefund(db, 9, "p1", 10);
    expect(recoverHolds(db, now)).toEqual({ settled: 1, released: 0, open: 1 });
    expect(heldCents(db, "support")).toBe(10);
  });
});
