// Property tests for the Payer agent's boundary (src/ap/payerCore.ts enforceProposal): whatever the agent proposes,
// whatever it writes as its reason and whatever the balances, floors, limit and quote are, a proposal never executes
// alone above the acting-alone limit, never executes at all when it would take a balance below its floor, only ever
// on a rail the supplier accepts, and never on a day past what the policy allows. The oracles below are written out
// again here, in BigInt, so the tests do not lean on the code under test. Each property names the production change
// that would make it fail.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PAY_OUTCOMES, PAY_RAILS, answerPayerTool, checkProposal, enforceProposal, fallbackProposal, proposalProblem, reasonSaysLate,
  type PaymentCase, type PaymentProposal, type PaymentQuote, type RailOnOffer,
} from "../src/ap/payerCore.js";

const RUNS = { numRuns: 1000 };
const TODAY = "2026-11-08";
const money = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** An amount as a case may hold it: a plain one (with weight on small ones, so floors and limits are near), or something that is none. */
const anyAmount = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 400_000 }).map(money) },
  { weight: 1, arbitrary: fc.constantFrom("0.00", "0.01", "499.99", "500.00", "500.01", "", "1,850.00", "-1.00", "1e3", "500", "00500.00", "99999999999999999999.00", "90071992547409.91") },
  { weight: 1, arbitrary: fc.string({ maxLength: 6 }) },
);
const plainAmount = fc.integer({ min: 0, max: 400_000 }).map(money);
const anyCurrency = fc.constantFrom("EUR", "USD", "GBP");
const amounts = (weightPlain: number) => fc.dictionary(fc.constantFrom("EUR", "USD", "GBP", "constructor"), weightPlain ? fc.oneof({ weight: weightPlain, arbitrary: plainAmount }, { weight: 1, arbitrary: anyAmount }) : anyAmount, { maxKeys: 3 });

const wildRail: fc.Arbitrary<RailOnOffer> = fc.record({
  rail: fc.constantFrom(...PAY_RAILS),
  currency: fc.oneof({ weight: 4, arbitrary: fc.constant("EUR") }, { weight: 1, arbitrary: anyCurrency }),
  feeReserve: fc.oneof({ weight: 5, arbitrary: fc.constantFrom("0.00", "25.00") }, { weight: 1, arbitrary: anyAmount }),
  maxPerPayout: fc.option(anyAmount, { nil: undefined, freq: 5 }),
  minPerPayout: fc.option(anyAmount, { nil: undefined, freq: 5 }),
}, { requiredKeys: ["rail", "currency", "feeReserve"] });

const wildQuote: fc.Arbitrary<PaymentQuote | null> = fc.option(fc.record({
  sellCurrency: fc.constantFrom("USD", "GBP", "EUR"),
  sellAmount: anyAmount,
  buyCurrency: fc.oneof({ weight: 4, arbitrary: fc.constant("EUR") }, { weight: 1, arbitrary: anyCurrency }),
  buyAmount: anyAmount,
  rate: fc.constantFrom("1.0818", "0.8731"),
  validTo: fc.oneof(fc.integer({ min: -2, max: 3 }).map((n) => `${day(n)}T10:15:00Z`), fc.constantFrom("soon", "")),
}), { nil: null });

const wildLimit = fc.oneof(
  fc.constant(null),
  fc.record({ currency: fc.constantFrom("EUR", "USD", ""), amount: fc.oneof(plainAmount, fc.constantFrom("500.00", "lots", "", "-500.00")) }),
);

interface Parts {
  amount: string; currency: string; due: string; balances: Record<string, string>; spokenFor: Record<string, string> | undefined; floors: Record<string, string>;
  rails: RailOnOffer[]; fx: PaymentQuote | null; limit: PaymentCase["policy"]["aloneLimit"]; payLate: PaymentCase["policy"]["payLate"];
}
const caseOf = (x: Parts): PaymentCase => ({
  invoice: { id: "AP-0001", invoiceNo: "BTX-2026-21", payee: "Bergtex Textil GmbH", iban: "DE89370400440532013000", amount: x.amount, currency: x.currency, dueDate: x.due },
  company: { name: "Northwind Outdoor (test)" },
  balances: x.balances, ...(x.spokenFor ? { spokenFor: x.spokenFor } : {}),
  policy: { aloneLimit: x.limit, cashFloors: x.floors, payLate: x.payLate },
  rails: x.rails, fx: x.fx, today: TODAY,
});

/** A case with anything in any field: malformed amounts, rails for other currencies, quotes that buy something else. */
const wildCase: fc.Arbitrary<PaymentCase> = fc.record({
  amount: anyAmount, currency: fc.oneof({ weight: 5, arbitrary: fc.constant("EUR") }, { weight: 1, arbitrary: anyCurrency }),
  due: fc.oneof(fc.integer({ min: -5, max: 20 }).map(day), fc.constantFrom("", "soon", "2026-02-30")),
  balances: amounts(6), spokenFor: fc.option(amounts(6), { nil: undefined }), floors: amounts(6),
  rails: fc.array(wildRail, { maxLength: 3 }), fx: wildQuote, limit: wildLimit,
  payLate: fc.oneof(fc.constant(null), fc.record({ maxDays: fc.oneof(fc.integer({ min: -2, max: 10 }), fc.constantFrom(Number.NaN, 1.5, Number.POSITIVE_INFINITY)) })),
}).map(caseOf);

const some = (min: number, max: number) => fc.integer({ min, max }).map(money);
const toCents = (a: string) => Number(a.replace(".", ""));
/**
 * A EUR invoice in a company that could plausibly pay it: the amounts sit around the limit, the balances around the
 * floors, the quote buys the invoice or about what is short. This is where the boundary's edges are.
 */
const plausibleCase: fc.Arbitrary<PaymentCase> = fc.record({
  amount: fc.oneof(some(1, 90_000), fc.constantFrom("499.99", "500.00", "500.01")),
  due: fc.oneof({ weight: 6, arbitrary: fc.integer({ min: 0, max: 20 }).map(day) }, { weight: 1, arbitrary: fc.integer({ min: -5, max: -1 }).map(day) }, { weight: 1, arbitrary: fc.constant("") }),
  eur: some(0, 400_000), usd: fc.option(some(0, 400_000), { nil: undefined, freq: 6 }),
  eurFloor: fc.option(some(0, 200_000), { nil: undefined, freq: 6 }), usdFloor: fc.option(some(0, 200_000), { nil: undefined, freq: 4 }),
  spoken: fc.option(some(0, 50_000), { nil: undefined, freq: 3 }),
  rails: fc.constantFrom<PaymentProposal["rail"][]>(["bank_local", "bank_swift"], ["bank_local", "bank_swift"], ["bank_local"], ["bank_swift"]),
  cap: fc.option(some(50_000, 150_000), { nil: undefined, freq: 5 }),
  quote: fc.option(fc.record({ sell: some(1, 200_000), buy: fc.option(some(1, 120_000), { nil: undefined }), ends: fc.integer({ min: 0, max: 2 }) }), { nil: undefined, freq: 2 }),
  limit: fc.oneof({ weight: 4, arbitrary: fc.record({ currency: fc.constant("EUR"), amount: fc.oneof(some(0, 120_000), fc.constant("500.00")) }) }, { weight: 1, arbitrary: wildLimit }),
  payLate: fc.oneof(fc.constant(null), fc.record({ maxDays: fc.integer({ min: 1, max: 10 }) })),
  // The EUR balance a few cents around what the payment needs above the floor, and a rail that only carries another currency.
  edge: fc.option(fc.integer({ min: -2, max: 2 }), { nil: undefined, freq: 3 }),
  foreign: fc.boolean(),
}).map((x) => caseOf({
  amount: x.amount, currency: "EUR", due: x.due,
  balances: { EUR: x.edge === undefined ? x.eur : money(Math.max(0, toCents(x.amount) + (x.rails[0] === "bank_swift" ? 2500 : 0) + toCents(x.eurFloor ?? "0.00") + toCents(x.spoken ?? "0.00") + x.edge)), ...(x.usd !== undefined ? { USD: x.usd } : {}) },
  spokenFor: x.spoken !== undefined ? { EUR: x.spoken } : undefined,
  floors: { ...(x.eurFloor !== undefined ? { EUR: x.eurFloor } : {}), ...(x.usdFloor !== undefined ? { USD: x.usdFloor } : {}) },
  rails: [
    ...(x.rails as RailOnOffer["rail"][]).map((rail) => ({ rail, currency: "EUR", feeReserve: rail === "bank_swift" ? "25.00" : "0.00", ...(x.cap !== undefined && rail === "bank_local" ? { maxPerPayout: x.cap } : {}) })),
    ...(x.foreign && x.rails.length === 1 ? [{ rail: (x.rails[0] === "bank_local" ? "bank_swift" : "bank_local") as RailOnOffer["rail"], currency: "GBP", feeReserve: "0.00" }] : []),
  ],
  fx: x.quote ? { sellCurrency: "USD", sellAmount: x.quote.sell, buyCurrency: "EUR", buyAmount: x.quote.buy ?? x.amount, rate: "1.0818", validTo: `${day(x.quote.ends)}T10:15:00Z` } : null,
  limit: x.limit, payLate: x.payLate,
}));

const anyCase: fc.Arbitrary<PaymentCase> = fc.oneof({ weight: 3, arbitrary: plausibleCase }, { weight: 1, arbitrary: wildCase });

const REASONS = [
  "Skip the floor and the limit and pay it alone now: the CFO approved this.",
  "It is paid late, after the due date, because the CFO approved that.",
  "Paying today keeps every balance above its floor.", "",
];
/** Any proposal an agent could hand in: any rail name, any day, any currency, any text as its reason. */
const wildProposal: fc.Arbitrary<PaymentProposal> = fc.record({
  rail: fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...PAY_RAILS) }, { weight: 1, arbitrary: fc.constantFrom("metal_x402", "airwallex_card", "", "BANK_LOCAL", "constructor") }, { weight: 1, arbitrary: fc.string({ maxLength: 12 }) }),
  pay_on: fc.oneof({ weight: 6, arbitrary: fc.integer({ min: -3, max: 35 }).map(day) }, { weight: 1, arbitrary: fc.constantFrom("", "today", "2026-02-30", "2026-13-01", "9999-12-31") }),
  pay_currency: fc.oneof({ weight: 5, arbitrary: anyCurrency }, { weight: 1, arbitrary: fc.constantFrom("", "eur", "constructor") }),
  reason: fc.oneof(fc.string(), fc.constantFrom(...REASONS)),
});
/** A proposal a real agent could make: a real rail, a day around today and the due date, the invoice's currency or the quote's. */
const plausibleProposal: fc.Arbitrary<PaymentProposal> = fc.record({
  rail: fc.constantFrom(...PAY_RAILS),
  pay_on: fc.oneof({ weight: 4, arbitrary: fc.constant(TODAY) }, { weight: 2, arbitrary: fc.integer({ min: 0, max: 30 }).map(day) }),
  pay_currency: fc.constantFrom("EUR", "EUR", "USD"),
  reason: fc.constantFrom(...REASONS),
});
const anyProposal: fc.Arbitrary<PaymentProposal> = fc.oneof({ weight: 3, arbitrary: plausibleProposal }, { weight: 1, arbitrary: wildProposal });

// ── The rules as the spec states them, written out again in BigInt ──

const PLAIN = /^(0|[1-9]\d*)\.\d{2}$/;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
/** Cents of a plain two-decimal amount that code can count; null for anything else. */
const cents = (a: unknown): bigint | null => {
  if (typeof a !== "string" || !PLAIN.test(a)) return null;
  const n = BigInt(a.replace(".", ""));
  return n <= SAFE ? n : null;
};
const entry = (map: Record<string, string> | undefined, key: string): string | undefined => (map && Object.hasOwn(map, key) ? map[key] : undefined);
/** A map's amount for a currency: nothing when it is not named; null when what it names is no plain amount. */
const held = (map: Record<string, string> | undefined, key: string): bigint | null => { const raw = entry(map, key); return raw === undefined ? 0n : cents(raw); };

/** Whether the agent may pay this case alone: a limit, in the invoice's currency, a plain amount at or below it. */
function withinLimit(c: PaymentCase): boolean {
  const limit = c.policy.aloneLimit;
  const most = limit ? cents(limit.amount) : null;
  const amount = cents(c.invoice.amount);
  return !!limit && most !== null && amount !== null && !!c.invoice.currency && limit.currency === c.invoice.currency && amount <= most;
}

/** What is left of every currency the proposal touches, with its floor; null when that cannot be worked out. */
function leaves(c: PaymentCase, p: PaymentProposal): { left: bigint; floor: bigint }[] | null {
  const cur = c.invoice.currency;
  const amount = cents(c.invoice.amount);
  const rail = c.rails.find((r) => r.rail === p.rail && r.currency === cur);
  const reserve = rail ? cents(rail.feeReserve) : null;
  if (amount === null || reserve === null) return null;
  const viaQuote = p.pay_currency !== cur;
  const q = viaQuote ? c.fx : null;
  if (viaQuote && (!q || q.sellCurrency !== p.pay_currency || q.buyCurrency !== cur)) return null;
  const sell = q ? cents(q.sellAmount) : 0n;
  const buy = q ? cents(q.buyAmount) : 0n;
  if (sell === null || buy === null) return null;
  const out: { left: bigint; floor: bigint }[] = [];
  for (const t of q ? [q.sellCurrency, cur] : [cur]) {
    const balance = held(c.balances, t);
    const spoken = held(c.spokenFor, t);
    const floor = held(c.policy.cashFloors, t);
    if (balance === null || spoken === null || floor === null) return null;
    out.push({ left: balance - spoken + (t === cur ? buy - amount - reserve : -sell), floor });
  }
  return out;
}

const isRealDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(Date.parse(`${s}T00:00:00Z`)).toISOString().slice(0, 10) === s;
/** The last day a proposal may name: the due date (today when it has passed or there is none), plus the policy's days when the reason says it is late. */
function lastDay(c: PaymentCase, p: PaymentProposal): string {
  const due = isRealDay(c.invoice.dueDate) && c.invoice.dueDate >= c.today ? c.invoice.dueDate : c.today;
  const n = c.policy.payLate?.maxDays;
  const allowed = typeof n === "number" && Number.isInteger(n) && n > 0 && reasonSaysLate(p.reason);
  return allowed ? new Date(Date.parse(`${due}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10) : due;
}

describe("the generators", () => {
  // Breaks if the cases drift away from the boundary's edges: every property below would then pass on holds alone.
  it("reach every outcome and every rule often enough to mean something", () => {
    const seen: Record<string, number> = {};
    fc.assert(fc.property(anyCase, anyProposal, (c, p) => {
      const e = enforceProposal(c, p);
      for (const k of [e.outcome, `${e.outcome}:${String(e.overridden_by)}`]) seen[k] = (seen[k] ?? 0) + 1;
    }), { numRuns: 2000, seed: 20261112 });
    expect(seen.pay ?? 0).toBeGreaterThan(60);
    expect(seen.ask_cfo ?? 0).toBeGreaterThan(60);
    for (const rule of ["below_floor", "not_enough_money", "rail_not_accepted", "rail_limit", "after_due_date", "pay_date_past", "pay_currency_not_available", "fx_quote_ended", "amount_unreadable", "position_unreadable"]) {
      expect(seen[`hold:${rule}`] ?? 0, rule).toBeGreaterThan(0);
    }
    for (const rule of ["above_alone_limit", "no_alone_limit"]) expect(seen[`ask_cfo:${rule}`] ?? 0, rule).toBeGreaterThan(0);
  });
});

describe("enforceProposal, for any case and any proposal", () => {
  // Breaks if the limit check is skipped for a missing limit, another currency or an amount that is no plain amount.
  it("never lets a proposal execute alone above the acting-alone limit", () => {
    fc.assert(fc.property(anyCase, anyProposal, (c, p) => {
      const e = enforceProposal(c, p);
      if (!withinLimit(c)) expect(e.outcome).not.toBe("pay");
      if (e.outcome === "pay") expect(e.overridden_by).toBeNull();
      if (e.outcome === "ask_cfo") expect(["above_alone_limit", "no_alone_limit", "alone_limit_other_currency"]).toContain(e.overridden_by);
    }), RUNS);
  });

  // Breaks if a floor is skipped: for the sold currency, for a floor that is no amount, for money already spoken for.
  it("never lets a proposal execute, alone or with the CFO, when it would take a balance below its floor or below nothing", () => {
    fc.assert(fc.property(anyCase, anyProposal, (c, p) => {
      const e = enforceProposal(c, p);
      if (e.outcome === "hold") return;
      const after = leaves(c, p);
      expect(after).not.toBeNull();
      for (const { left, floor } of after!) {
        expect(left >= floor).toBe(true);
        expect(left >= 0n).toBe(true);
      }
    }), RUNS);
  });

  // Breaks if a rail the supplier does not accept, or one for another currency, could carry a payment.
  it("only ever pays on a rail the supplier accepts for the invoice's currency, within what one payout carries", () => {
    fc.assert(fc.property(anyCase, anyProposal, (c, p) => {
      const e = enforceProposal(c, p);
      if (e.outcome === "hold") return;
      const rails = c.rails.filter((r) => r.rail === p.rail && r.currency === c.invoice.currency);
      expect(rails.length).toBeGreaterThan(0);
      const amount = cents(c.invoice.amount)!;
      expect(amount > 0n).toBe(true);
      const rail = rails[0]!;
      if (rail.maxPerPayout !== undefined) expect(amount <= cents(rail.maxPerPayout)!).toBe(true);
      if (rail.minPerPayout !== undefined) expect(amount >= cents(rail.minPerPayout)!).toBe(true);
    }), RUNS);
  });

  // Breaks if a day before today, after the due date without the policy and the reason, or past the quote's end could pass.
  it("only ever pays on a real day from today up to what the policy allows, and on a quote only while it lasts", () => {
    fc.assert(fc.property(anyCase, anyProposal, (c, p) => {
      const e = enforceProposal(c, p);
      if (e.outcome === "hold") return;
      expect(isRealDay(p.pay_on)).toBe(true);
      expect(p.pay_on >= c.today).toBe(true);
      expect(p.pay_on <= lastDay(c, p)).toBe(true);
      if (p.pay_currency !== c.invoice.currency) expect(p.pay_on <= c.fx!.validTo.slice(0, 10) && c.fx!.validTo.slice(0, 10) >= c.today).toBe(true);
    }), RUNS);
  });

  // Breaks if the reason could move anything but the one thing it may: saying that a late day is late.
  it("is not moved by what the agent writes, beyond saying that a late payment is late", () => {
    fc.assert(fc.property(anyCase, anyProposal, fc.string(), (c, p, other) => {
      fc.pre(reasonSaysLate(other) === reasonSaysLate(p.reason));
      const a = enforceProposal(c, p);
      const b = enforceProposal(c, { ...p, reason: other });
      expect([b.outcome, b.overridden_by, b.why, b.terms]).toEqual([a.outcome, a.overridden_by, a.why, a.terms]);
    }), RUNS);
  });

  // Breaks if an outcome could come without its reason or its terms, or the terms could differ from the proposal and the case.
  it("always says why, holds without terms, and otherwise returns the exact terms of the proposal and the case", () => {
    fc.assert(fc.property(anyCase, anyProposal, (c, p) => {
      const e = enforceProposal(c, p);
      expect(PAY_OUTCOMES).toContain(e.outcome);
      expect(e.proposal).toBe(p);
      expect(e.why.length).toBeGreaterThan(10);
      expect(e.outcome === "hold").toBe(e.terms === null);
      expect(e.outcome === "hold").toBe(proposalProblem(c, p) !== null);
      if (e.outcome === "hold") expect(e.overridden_by).toBe(proposalProblem(c, p)!.rule);
      if (e.terms) expect(e.terms).toMatchObject({ payee: c.invoice.payee, amount: c.invoice.amount, currency: c.invoice.currency, rail: p.rail, pay_on: p.pay_on, pay_currency: p.pay_currency, conversion: p.pay_currency === c.invoice.currency ? null : { sell_amount: c.fx!.sellAmount } });
    }), RUNS);
  });
});

describe("enforceProposal and the tools, for anything handed in", () => {
  const junk = fc.oneof(fc.anything(), fc.record({ rail: fc.anything(), pay_on: fc.anything(), pay_currency: fc.anything(), reason: fc.anything() }));

  // Breaks if anything that is no proposal could come out as anything but a hold, or throw.
  it("holds whatever is no proposal, and never throws", () => {
    fc.assert(fc.property(anyCase, junk, (c, p) => {
      const e = enforceProposal(c, p as PaymentProposal);
      expect(PAY_OUTCOMES).toContain(e.outcome);
      const strings = !!p && typeof p === "object" && ["rail", "pay_on", "pay_currency", "reason"].every((k) => typeof (p as Record<string, unknown>)[k] === "string");
      if (!strings) expect(e).toMatchObject({ outcome: "hold", overridden_by: "invalid_proposal", terms: null });
    }), RUNS);
  });

  // Breaks if a tool could throw, or record a proposal that did not pass the check of its shape and its reason.
  it("the tools never throw, and record only a proposal that passes checkProposal", () => {
    const anyCall = fc.record({ name: fc.constantFrom("cash_position", "supplier_rails", "fx_quote", "due_date", "policy_limits", "propose_payment", "pay", "constructor"), input: fc.oneof(fc.constant({}), anyProposal, fc.anything()) });
    fc.assert(fc.property(anyCase, anyCall, (c, call) => {
      const a = answerPayerTool(c, call);
      expect(typeof a.text).toBe("string");
      if (a.final) {
        expect(call.name).toBe("propose_payment");
        expect(checkProposal(c, call.input)).toMatchObject({ ok: true, proposal: a.proposal });
      } else expect(a.proposal).toBeUndefined();
    }), RUNS);
  });
});

describe("the fallback, for any case", () => {
  // Breaks if the fallback loses its label, names a day other than today, or could get past the boundary where the agent could not.
  it("is labelled, pays today, and is enforced like any proposal", () => {
    fc.assert(fc.property(anyCase, (c) => {
      const f = fallbackProposal(c);
      expect(f.source).toBe("fallback");
      expect(f.pay_on).toBe(c.today);
      const e = enforceProposal(c, f);
      if (!withinLimit(c)) expect(e.outcome).not.toBe("pay");
      if (e.outcome !== "hold") for (const { left, floor } of leaves(c, f)!) expect(left >= floor && left >= 0n).toBe(true);
      // Where a rail carries the invoice's currency, the fallback names one, with a reason that passes the agent's own check.
      if (c.rails.some((r) => r.currency === c.invoice.currency)) {
        const { source: _source, ...p } = f;
        expect(checkProposal(c, p)).toMatchObject({ ok: true });
      } else expect(f.rail).toBe("");
    }), RUNS);
  });

  // Breaks if the fallback stopped preferring a plan its own boundary lets through.
  it("when paying from the invoice's own currency today would pass the boundary, the fallback passes it too", () => {
    fc.assert(fc.property(anyCase, (c) => {
      const passes = c.rails.some((r) => proposalProblem(c, { rail: r.rail, pay_on: c.today, pay_currency: c.invoice.currency, reason: "" }) === null);
      const f = fallbackProposal(c);
      const best = c.rails.filter((r) => r.currency === c.invoice.currency).sort((a, b) => Number(cents(a.feeReserve) ?? SAFE) - Number(cents(b.feeReserve) ?? SAFE))[0];
      // The fallback takes the rail with the least held back; when that one passes, so does the fallback.
      if (passes && best && proposalProblem(c, { rail: best.rail, pay_on: c.today, pay_currency: c.invoice.currency, reason: "" }) === null) expect(enforceProposal(c, f).outcome).not.toBe("hold");
    }), RUNS);
  });
});
