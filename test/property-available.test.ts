// Property tests for B3: available = limit − paid − pending − held, the same everywhere, and holds never let the
// spent-plus-held total pass a mandate budget or the agents' shared total, whatever the order of events.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { TOTAL_BUDGET_CENTS } from "../src/config/policy.js";
import { openDb, type DB } from "../src/db/open.js";
import { mandateAvailability } from "../src/policy/available.js";
import { heldCents, ledgerSpent, releaseHold, reserveSpend, settleHold } from "../src/policy/holds.js";

const start = Date.parse("2026-11-03T10:00:00Z");
const BUDGETS = { support: 400, treasury: 1200 } as const;
type Who = keyof typeof BUDGETS;

function world(): DB {
  const db = openDb(":memory:");
  for (const [agent, budget] of Object.entries(BUDGETS)) {
    audit(db, "treasury", "mandate.bound", agent, { cap: "4.00", budget: (budget / 100).toFixed(2), payee: "0x0000000000000000000000000000000000000001" }, new Date(start));
  }
  return db;
}

/** The ledger row a settled payment leaves behind: a refund (support) or a sweep (treasury), paid or still pending. */
function record(db: DB, who: Who, ref: string, cents: number, outcome: "PAID" | "PENDING", n: number): void {
  if (who === "support") {
    db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (?, '/v1/stock', ?, '0x1', '/v1/stock', '{}', 'DELIVERED', ?)").run(n, cents, new Date(start).toISOString());
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome) VALUES (?, ?, ?, '0x1', ?)").run(n, ref, cents, outcome);
  } else {
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES (?, ?, ?, ?)").run(ref, cents, outcome, new Date(start).toISOString());
  }
}

const step = fc.record({
  who: fc.constantFrom<Who>("support", "treasury"),
  cents: fc.integer({ min: 1, max: 400 }),
  end: fc.constantFrom("paid", "pending", "released", "open"),
});

describe("available = limit − paid − pending − held (property)", () => {
  it("holds the identity after any sequence, and never lets spent plus held pass a budget or the shared total", () => {
    fc.assert(fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
      const db = world();
      steps.forEach((s, i) => {
        // Two hours apart: the velocity limits are tested elsewhere; here only the budgets decide.
        const now = new Date(start + i * 7_200_000);
        const ref = `p${i}`;
        if (reserveSpend(db, { agent: s.who, rail: "metal", cents: s.cents, ref, now }) !== null) return;
        if (s.end === "released") releaseHold(db, ref, "did not happen", now);
        else if (s.end !== "open") { record(db, s.who, ref, s.cents, s.end === "paid" ? "PAID" : "PENDING", i + 1); settleHold(db, ref, now); }
      });
      let total = 0;
      for (const who of Object.keys(BUDGETS) as Who[]) {
        const a = mandateAvailability(db, who);
        expect(a.availableCents).toBe(BUDGETS[who] - a.paidCents - a.pendingCents - a.heldCents);
        expect(a.paidCents + a.pendingCents).toBe(ledgerSpent(db, who));
        expect(a.heldCents).toBe(heldCents(db, who));
        expect(a.availableCents).toBeGreaterThanOrEqual(0);
        total += a.paidCents + a.pendingCents + a.heldCents;
      }
      expect(total).toBeLessThanOrEqual(TOTAL_BUDGET_CENTS);
    }), { numRuns: 200 });
  });
});
