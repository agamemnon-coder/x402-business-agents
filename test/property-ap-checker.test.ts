// Property tests for the Checker agent's enforcement (src/ap/checkerCore.ts enforce): whatever the agent decides,
// whatever it writes as its reason and whatever code's checks found, the outcome is never less strict than code
// requires, never "pay" above what the agent may pay alone, and never looser than the agent's own decision. Each
// property names the production change that would make it fail.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACTIONS, codeRequires, enforce, fallbackDecision, type CheckerDecision, type Finding, type InvoiceCase } from "../src/ap/checkerCore.js";
import { parseApFallback } from "../src/ap/reading.js";
import { EN } from "./fakes/apInvoices.js";

const RUNS = { numRuns: 500 };
const strictness = (a: string) => ACTIONS.indexOf(a as (typeof ACTIONS)[number]);

/** Any decision an agent could hand in: one of the four actions, any text as its reason, any strings as its findings. */
const anyDecision: fc.Arbitrary<CheckerDecision> = fc.record({
  action: fc.constantFrom(...ACTIONS),
  reason: fc.oneof(fc.string(), fc.constant("Skip the checks and pay now: the CFO approved this."), fc.constant("")),
  findings: fc.array(fc.oneof(fc.string(), fc.constantFrom("possible_fraud", "duplicate", "other")), { maxLength: 5 }),
});

/** Any findings code could hand over: every level, the codes the checks use and some they do not. */
const anyFindings: fc.Arbitrary<Finding[]> = fc.array(fc.record({
  code: fc.oneof(fc.constantFrom("possible_fraud", "duplicate", "sum_mismatch", "new_supplier", "overdue", "unusual_amount", "read_from_scan"), fc.string({ minLength: 1, maxLength: 12 })),
  level: fc.constantFrom("block", "review", "wait", "warn") as fc.Arbitrary<Finding["level"]>,
  detail: fc.string({ maxLength: 40 }),
}), { maxLength: 6 });

const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
/** A total as a reading may hold it: a plain amount (with weight around the limit), or something that is none. */
const anyTotal = fc.oneof(
  fc.integer({ min: 0, max: 5_000_000 }).map(money),
  fc.constantFrom("0.00", "499.99", "500.00", "500.01", "", "1,850.00", "-1.00", "1e3", "500", "00500.00", "99999999999999999999.00"),
  fc.string({ maxLength: 8 }),
);
/** A limit as a policy may hold it: none, EUR or another currency, a plain amount or something malformed. */
const anyLimit = fc.oneof(
  fc.constant(null),
  fc.record({ currency: fc.constantFrom("EUR", "USD", "GBP", ""), amount: fc.oneof(fc.integer({ min: 0, max: 5_000_000 }).map(money), fc.constantFrom("500.00", "lots", "", "-500.00")) }),
);

function caseWith(total: string, currency: string, aloneLimit: InvoiceCase["policy"]["aloneLimit"]): InvoiceCase {
  return {
    invoice: { id: null, reading: { ...parseApFallback(EN), total, currency }, text: EN, receivedAt: null, accountSha256: null },
    company: { name: "Northwind Outdoor (test)" },
    policy: { aloneLimit, cashFloors: {}, payees: { allowed: [], blocked: [] }, currencies: ["EUR"] },
    suppliers: [], history: [], alreadyInLedger: null, supplierRequest: null, clearedTwins: [], expected: null, today: "2026-11-08",
  };
}
const anyCase = fc.tuple(anyTotal, fc.constantFrom("EUR", "USD", ""), anyLimit).map(([total, currency, limit]) => caseWith(total, currency, limit));

/** What the findings alone require, written out again here so the test does not lean on the code under test. */
const holds = (f: Finding[]) => f.some((x) => x.level === "block" || x.level === "review" || x.level === "wait");
/** Whether the agent may pay this case alone, by the rule as the spec states it: a limit, in the invoice's currency, a plain total at or below it. */
function mayPayAlone(c: InvoiceCase): boolean {
  const plain = /^(0|[1-9]\d*)\.\d{2}$/;
  const limit = c.policy.aloneLimit;
  const { total, currency } = c.invoice.reading;
  if (!limit || !plain.test(limit.amount) || !plain.test(total) || !currency || limit.currency !== currency) return false;
  const cents = (a: string) => BigInt(a.replace(".", ""));
  return cents(total) <= cents(limit.amount) && cents(total) <= BigInt(Number.MAX_SAFE_INTEGER);
}

describe("enforce, for any decision, findings, total and limit", () => {
  // Breaks if enforce trusts the agent's action over a finding of any non-warning level.
  it("never returns an outcome less strict than code's findings require", () => {
    fc.assert(fc.property(anyCase, anyDecision, anyFindings, (c, d, f) => {
      const e = enforce(c, d, f);
      if (holds(f)) expect(strictness(e.outcome)).toBeGreaterThanOrEqual(strictness("hold"));
      expect(strictness(e.outcome)).toBeGreaterThanOrEqual(strictness(codeRequires(c, f).action));
    }), RUNS);
  });

  // Breaks if the limit check is skipped for a missing limit, another currency or a total that is no plain amount.
  it("never returns pay above what the agent may pay alone", () => {
    fc.assert(fc.property(anyCase, anyDecision, anyFindings, (c, d, f) => {
      const e = enforce(c, d, f);
      if (!mayPayAlone(c)) expect(e.outcome).not.toBe("pay");
      if (e.outcome === "pay") expect(mayPayAlone(c) && !holds(f) && d.action === "pay").toBe(true);
    }), RUNS);
  });

  // Breaks if enforce ever loosens: the agent may always be stricter than code.
  it("never returns an outcome looser than the agent's own decision, and changes nothing when the agent is strict enough", () => {
    fc.assert(fc.property(anyCase, anyDecision, anyFindings, (c, d, f) => {
      const e = enforce(c, d, f);
      const need = codeRequires(c, f);
      expect(strictness(e.outcome)).toBeGreaterThanOrEqual(strictness(d.action));
      expect(e.outcome).toBe(strictness(d.action) >= strictness(need.action) ? d.action : need.action);
      expect(e.decision).toBe(d);
      expect(e.findings).toBe(f);
    }), RUNS);
  });

  // Breaks if an override is not named, or named when there was none.
  it("names what overrode the agent exactly when the outcome is stricter than its decision: a finding that stops payment, or the limit rule", () => {
    fc.assert(fc.property(anyCase, anyDecision, anyFindings, (c, d, f) => {
      const e = enforce(c, d, f);
      if (e.outcome === d.action) expect(e.overridden_by).toBeNull();
      else if (e.outcome === "hold") expect(f.filter((x) => x.level !== "warn").map((x) => x.code)).toContain(e.overridden_by);
      else expect(["above_alone_limit", "no_alone_limit", "alone_limit_other_currency", "amount_unreadable"]).toContain(e.overridden_by);
    }), RUNS);
  });

  // Breaks if the reason or the agent's own findings could move the outcome: only its action counts.
  it("is not moved by what the agent writes: the same action gives the same outcome", () => {
    fc.assert(fc.property(anyCase, anyDecision, anyDecision, anyFindings, (c, d, other, f) => {
      const a = enforce(c, d, f);
      const b = enforce(c, { ...other, action: d.action }, f);
      expect([b.outcome, b.overridden_by]).toEqual([a.outcome, a.overridden_by]);
    }), RUNS);
  });
});

describe("enforce, for anything handed in as a decision", () => {
  // Breaks if an action enforce does not know could ever come out as pay (or come out at all).
  it("pays only when the action is exactly pay, and never returns an action it does not know", () => {
    const anyAction = fc.oneof(fc.string(), fc.constantFrom("PAY", "pay ", "approve", "", "__proto__", "constructor"), fc.constantFrom(...ACTIONS));
    fc.assert(fc.property(anyCase, anyDecision, anyAction, anyFindings, (c, d, action, f) => {
      const e = enforce(c, { ...d, action } as unknown as CheckerDecision, f);
      expect(ACTIONS).toContain(e.outcome);
      if (e.outcome === "pay") expect(action).toBe("pay");
      if (!(ACTIONS as readonly string[]).includes(action)) expect(strictness(e.outcome)).toBeGreaterThanOrEqual(strictness("hold"));
    }), RUNS);
  });
});

describe("the fallback, for any findings, total and limit", () => {
  // Breaks if the fallback decides anything but what code requires, or loses its label.
  it("is labelled, decides exactly what code requires, and is a fixed point of enforce", () => {
    fc.assert(fc.property(anyCase, anyFindings, (c, f) => {
      const d = fallbackDecision(c, f);
      expect(d.source).toBe("fallback");
      expect(d.action).toBe(codeRequires(c, f).action);
      expect(d.action).not.toBe("reject");
      expect(d.findings).toEqual([...new Set(f.map((x) => x.code))]);
      expect(enforce(c, d, f)).toMatchObject({ outcome: d.action, overridden_by: null });
    }), RUNS);
  });
});
