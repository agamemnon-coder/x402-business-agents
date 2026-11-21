// Purser's CFO policy as Rego (policy/purser.rego, docs/policy-opa.md) decides exactly as Purser does. Every case runs
// through Purser's own code (src/policy/rego.ts purserDecision: enforceProposal, decideAiriPurchase, aloneDecision, as
// the engine calls them) and through OPA (`opa eval` over policy/purser.rego, one batched eval), and the two must give
// the same outcome and the same reason code on each. The cases: the Payer's eval corpus (src/evals/apAgentCases.ts),
// every case of the held-out adversarial evals v2 to v17 as a reader hands it over and as Purser's own parser reads it,
// the Airi run's recorded policy, and generated cases at every limit and one cent either side, each payee and merchant
// allowed and not, every currency mismatch, every day boundary, and amounts code cannot read.
// OPA is the official binary (CI downloads a pinned release and checks its SHA-256, .github/workflows/ci.yml). Without
// it on PATH (or OPA_BIN) the test is skipped locally with the reason; in CI (CI set) a missing binary fails it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AIRI_HARD_CAP_CENTS, type AiriPolicy } from "../src/airi/policy.js";
import type { AiriPurchaseRequest } from "../src/airi/purchase.js";
import { fallbackProposal, type PaymentCase, type PaymentProposal, type PaymentQuote, type RailOnOffer } from "../src/ap/payerCore.js";
import { AP_PAYER_CASES } from "../src/evals/apAgentCases.js";
import { ADV_ARMS, fieldsFor, type AnyAdvCase } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, paymentCaseFor, type AdvCase } from "../src/evals/adversarialV2Cases.js";
import { ADV_V3_CASES } from "../src/evals/adversarialV3Cases.js";
import { ADV_V4_CASES } from "../src/evals/adversarialV4Cases.js";
import { ADV_V5_CASES } from "../src/evals/adversarialV5Cases.js";
import { ADV_V6_CASES } from "../src/evals/adversarialV6Cases.js";
import { ADV_V7_CASES } from "../src/evals/adversarialV7Cases.js";
import { ADV_V8_CASES } from "../src/evals/adversarialV8Cases.js";
import { ADV_V9_CASES } from "../src/evals/adversarialV9Cases.js";
import { ADV_V10_CASES } from "../src/evals/adversarialV10Cases.js";
import { ADV_V11_CASES } from "../src/evals/adversarialV11Cases.js";
import { ADV_V12_CASES } from "../src/evals/adversarialV12Cases.js";
import { ADV_V13_CASES } from "../src/evals/adversarialV13Cases.js";
import { ADV_V14_CASES } from "../src/evals/adversarialV14Cases.js";
import { ADV_V15_CASES } from "../src/evals/adversarialV15Cases.js";
import { ADV_V16_CASES } from "../src/evals/adversarialV16Cases.js";
import { ADV_V17_CASES } from "../src/evals/adversarialV17Cases.js";
import { ALWAYS_PAY } from "../src/evals/worstCaseWords.js";
import { fromCents, toCents } from "../src/lib/money.js";
import {
  exportRegoInput, fromPaymentCase, merchantOrigin, purserDecision, readRegoPolicy, REGO_BATCH_QUERY, REGO_PATH, REGO_QUERY, regoData, writeRegoBundle,
  type RegoContext, type RegoDecision, type RegoPayment, type RegoPolicy,
} from "../src/policy/rego.js";
import { airiRun } from "../src/redesign/airiRun.js";

// ── OPA ──

const OPA = process.env.OPA_BIN || "opa";
const opaVersion = (() => {
  const r = spawnSync(OPA, ["version"], { encoding: "utf8" });
  return r.status === 0 ? /Version: (\S+)/.exec(r.stdout)?.[1] ?? "unknown" : null;
})();
const REGO = fileURLToPath(REGO_PATH);
const dir = mkdtempSync(join(tmpdir(), "purser-rego-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function opa(args: string[]): unknown {
  const r = spawnSync(OPA, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`opa ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
/** One batched `opa eval` over these inputs: the decision for each, in order. */
function opaDecisions(inputs: unknown[], data: unknown = null): RegoDecision[] {
  const input = join(dir, `input-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(input, JSON.stringify({ cases: inputs }));
  const args = ["eval", "--format", "json", "-d", REGO, "-i", input];
  if (data !== null) {
    const d = join(dir, `data-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(d, JSON.stringify(data));
    args.push("-d", d);
  }
  const out = JSON.parse(opa([...args, REGO_BATCH_QUERY]) as string) as { result: { expressions: { value: RegoDecision[] }[] }[] };
  return out.result[0]!.expressions[0]!.value;
}

// ── The cases ──

interface Case { name: string; policy: RegoPolicy; payment: RegoPayment; ctx: RegoContext }
const cases: Case[] = [];
const add = (name: string, policy: RegoPolicy, payment: RegoPayment, ctx: RegoContext) => cases.push({ name, policy, payment, ctx });
const fromCase = (name: string, c: PaymentCase, p: PaymentProposal) => { const x = fromPaymentCase(c, p); add(name, x.policy, x.payment, x.ctx); };

/** The proposals a Payer might hand in for a case: code's own plan, the eval's pay-today, each rail, and late days. */
function proposalsFor(c: PaymentCase): [string, PaymentProposal][] {
  let plan: PaymentProposal | null;
  try { const { source: _s, ...p } = fallbackProposal(c); plan = p; } catch { plan = null; }
  const today: PaymentProposal = { rail: c.rails[0]?.rail ?? "", pay_on: c.today, pay_currency: c.invoice.currency, reason: ALWAYS_PAY.reason };
  const out: [string, PaymentProposal][] = [["pay-today", today]];
  if (plan) out.push(["fallback", plan]);
  if (c.fx) out.push(["from-quote", { ...today, pay_currency: c.fx.sellCurrency }]);
  for (const r of c.rails) out.push([`rail-${r.rail}-${r.currency}`, { ...today, rail: r.rail }]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(c.invoice.dueDate)) out.push(["on-due", { ...today, pay_on: c.invoice.dueDate }], ["late", { ...today, pay_on: c.invoice.dueDate, reason: "Paid late, after the due date." }]);
  return out;
}

// 1. The Payer's eval corpus.
for (const k of AP_PAYER_CASES) for (const [n, p] of proposalsFor(k.case)) fromCase(`payer-eval/${k.id}/${n}`, k.case, p);

// 2. The held-out adversarial evals v2 to v17: each case as the reader hands it over and as Purser's parser reads it.
const ROUNDS: [string, readonly unknown[]][] = [
  ["v2", ADV_V2_CASES], ["v3", ADV_V3_CASES], ["v4", ADV_V4_CASES], ["v5", ADV_V5_CASES], ["v6", ADV_V6_CASES], ["v7", ADV_V7_CASES],
  ["v8", ADV_V8_CASES], ["v9", ADV_V9_CASES], ["v10", ADV_V10_CASES], ["v11", ADV_V11_CASES], ["v12", ADV_V12_CASES], ["v13", ADV_V13_CASES],
  ["v14", ADV_V14_CASES], ["v15", ADV_V15_CASES], ["v16", ADV_V16_CASES], ["v17", ADV_V17_CASES],
];
let adversarial = 0;
for (const [round, list] of ROUNDS) {
  for (const k of list as AnyAdvCase[]) {
    for (const arm of ADV_ARMS.filter((a) => a !== "no_rules")) {
      const pc = paymentCaseFor(k as AdvCase, fieldsFor(k, arm));
      for (const [n, p] of proposalsFor(pc)) { fromCase(`adversarial-${round}/${k.id}/${arm}/${n}`, pc, p); adversarial++; }
    }
  }
}

// 3. Generated: the Payer's boundary at every limit, one cent either side, and every way a case can be wrong.
const LOCAL: RailOnOffer = { rail: "bank_local", currency: "EUR", feeReserve: "0.00" };
const SWIFT: RailOnOffer = { rail: "bank_swift", currency: "EUR", feeReserve: "25.00" };
const QUOTE: PaymentQuote = { quoteId: "q_1", sellCurrency: "USD", sellAmount: "2001.34", buyCurrency: "EUR", buyAmount: "1850.00", rate: "1.0818", validTo: "2026-11-08T10:15:00Z" };
const BASE: PaymentCase = {
  invoice: { id: "AP-0007", invoiceNo: "BTX-2026-21", payee: "Bergtex Textil GmbH", iban: "DE89370400440532013000", amount: "300.00", currency: "EUR", dueDate: "2026-11-20" },
  company: { name: "Northwind Outdoor (test)" },
  balances: { EUR: "30000.00", USD: "8000.00" },
  policy: { aloneLimit: { currency: "EUR", amount: "500.00" }, cashFloors: { EUR: "25000.00", USD: "3000.00" }, payLate: null },
  rails: [LOCAL, SWIFT], fx: null, today: "2026-11-08",
};
type Patch = Partial<Omit<PaymentCase, "invoice" | "policy">> & { invoice?: Partial<PaymentCase["invoice"]>; policy?: Partial<PaymentCase["policy"]> };
const caseOf = (p: Patch = {}): PaymentCase => ({ ...BASE, ...p, invoice: { ...BASE.invoice, ...p.invoice }, policy: { ...BASE.policy, ...p.policy } });
const PROP: PaymentProposal = { rail: "bank_local", pay_on: "2026-11-08", pay_currency: "EUR", reason: "Paying today keeps the EUR balance above its floor." };
const prop = (p: Partial<PaymentProposal> = {}) => ({ ...PROP, ...p });
const around = (cents: number) => [cents - 1, cents, cents + 1].filter((c) => c >= 0).map(fromCents);
const gen = (name: string, c: PaymentCase, p: PaymentProposal = PROP) => fromCase(`generated/${name}`, c, p);
const generatedStart = cases.length;

// The limit to pay alone, one cent either side, in each currency and with limits code cannot read.
for (const limit of ["0.00", "0.01", "500.00", "1850.00"]) {
  for (const amount of around(toCents(limit))) {
    if (amount === "0.00") continue;
    gen(`alone ${limit}/${amount}`, caseOf({ invoice: { amount }, policy: { aloneLimit: { currency: "EUR", amount: limit } } }));
    gen(`alone ${limit}/${amount} USD limit`, caseOf({ invoice: { amount }, policy: { aloneLimit: { currency: "USD", amount: limit } } }));
  }
}
for (const aloneLimit of [null, { currency: "EUR", amount: "lots" }, { currency: "EUR", amount: "0500.00" }, { currency: "", amount: "500.00" }, { amount: "500.00" } as never]) {
  gen(`alone limit ${JSON.stringify(aloneLimit)}`, caseOf({ policy: { aloneLimit } }));
}
gen("invoice in no currency", caseOf({ invoice: { currency: "" }, rails: [{ ...LOCAL, currency: "" }] }), prop({ pay_currency: "" }));
// The floor, one cent either side, on each rail (its fee reserve counts), from the invoice's currency.
for (const [rail, fee] of [["bank_local", 0], ["bank_swift", 2500]] as const) {
  for (const d of [-1, 0, 1]) {
    const eur = fromCents(2_500_000 + 30_000 + fee + d);
    gen(`floor ${rail} ${d}`, caseOf({ balances: { EUR: eur, USD: "8000.00" } }), prop({ rail }));
    gen(`floor ${rail} ${d} spoken for`, caseOf({ balances: { EUR: fromCents(2_500_000 + 30_000 + fee + d + 80_000), USD: "8000.00" }, spokenFor: { EUR: "800.00" } }), prop({ rail }));
    gen(`no money ${rail} ${d}`, caseOf({ balances: { EUR: fromCents(30_000 + fee + d) }, policy: { cashFloors: {} } }), prop({ rail }));
  }
}
// The rail: accepted or not (the supplier's payee details), its currency, and what one payout carries, one cent either side.
gen("no rail on file", caseOf({ rails: [] }));
gen("rail not accepted", caseOf({ rails: [SWIFT] }));
gen("rail in another currency", caseOf({ rails: [{ ...LOCAL, currency: "USD" }] }));
gen("rail second for the currency", caseOf({ rails: [{ ...LOCAL, currency: "USD", maxPerPayout: "1.00" }, LOCAL] }));
gen("unknown rail", caseOf(), prop({ rail: "card" }));
gen("payee not text, no rail", caseOf({ invoice: { payee: 42 as never }, rails: [] }));
gen("payee not text, rail ok", caseOf({ invoice: { payee: null as never } }));
gen("payee not text, other currency", caseOf({ invoice: { payee: null as never }, rails: [{ ...LOCAL, currency: "USD" }] }));
gen("iban not text", caseOf({ invoice: { iban: null as never } }));
for (const amount of around(100_000)) gen(`rail max ${amount}`, caseOf({ invoice: { amount }, rails: [{ ...LOCAL, maxPerPayout: "1000.00" }] }));
for (const amount of around(1_000)) gen(`rail min ${amount}`, caseOf({ invoice: { amount }, rails: [{ ...LOCAL, minPerPayout: "10.00" }] }));
for (const bad of ["1,000.00", "", null]) {
  gen(`rail max unreadable ${bad}`, caseOf({ rails: [{ ...LOCAL, maxPerPayout: bad as string }] }));
  gen(`rail min unreadable ${bad}`, caseOf({ rails: [{ ...LOCAL, minPerPayout: bad as string }] }));
  gen(`fee reserve unreadable ${bad}`, caseOf({ rails: [{ ...LOCAL, feeReserve: bad as string }] }));
}
// Amounts code cannot read.
for (const amount of ["300", "300.0", "0300.00", "-1.00", "0.00", "1e3", " 300.00", "300.00 ", "3,00", "９００.００", "90071992547409.91", "90071992547409.92", "99999999999999999999.00"]) {
  gen(`amount ${JSON.stringify(amount)}`, caseOf({ invoice: { amount } }));
}
gen("amount a number", caseOf({ invoice: { amount: 300 as never } }));
for (const v of ["30,000.00", "30000", null]) {
  gen(`balance unreadable ${v}`, caseOf({ balances: { EUR: v as string } }));
  gen(`floor unreadable ${v}`, caseOf({ policy: { cashFloors: { EUR: v as string } } }));
  gen(`spoken for unreadable ${v}`, caseOf({ spokenFor: { EUR: v as string } }));
}
gen("balances null", caseOf({ balances: null as never }));
gen("floors null", caseOf({ policy: { cashFloors: null as never } }));
gen("spoken for null", caseOf({ spokenFor: null as never }));
gen("no balance in the currency", caseOf({ balances: { USD: "8000.00" }, policy: { cashFloors: {} } }));
gen("huge balances", caseOf({ balances: { EUR: "90071992547409.91" }, spokenFor: { EUR: "0.00" } }));
gen("huge spoken for", caseOf({ balances: { EUR: "0.00" }, spokenFor: { EUR: "90071992547409.91" }, policy: { cashFloors: {} } }));
// Days: before today, on it, the due date, one day after, the latest the policy allows and one after; with and without
// a reason that says it is late; overdue, no due date, days that are none; leap days; the year 9999.
const REASONS = ["Paying today keeps the EUR balance above its floor.", "Paid late, after the due date.", "It is OVERDUE.", "Paid past its due date", "Paid past due", "lately", "Paid ſlate", "paid paſt due", "pay after the due"];
for (const payLate of [null, { maxDays: 0 }, { maxDays: 1 }, { maxDays: 5 }, { maxDays: 3650 }, { maxDays: 3651 }, { maxDays: 2.5 }, { maxDays: -1 }, { maxDays: "5" as never }]) {
  for (const dueDate of ["2026-11-20", "2026-11-01", "", "2026-02-30", "20261120", "2026-11-08"]) {
    for (const pay_on of ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-20", "2026-11-21", "2026-11-25", "2026-11-26", "2036-11-17", "2036-11-18", "2026-13-01", "2026-11-31", "soon"]) {
      for (const reason of [REASONS[0]!, REASONS[1]!]) gen(`day ${JSON.stringify(payLate)} due ${dueDate} on ${pay_on} ${reason.slice(0, 8)}`, caseOf({ invoice: { dueDate }, policy: { payLate } }), prop({ pay_on, reason }));
    }
  }
}
for (const reason of REASONS) gen(`late words ${reason}`, caseOf({ policy: { payLate: { maxDays: 5 } } }), prop({ pay_on: "2026-11-22", reason }));
for (const today of ["2028-02-28", "2028-02-29", "2027-02-29", "0000-02-29", "1900-02-29", "2000-02-29", "9999-12-31", "2026-11-8", ""]) {
  for (const d of [0, 1, 2]) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(today) ? new Date(Date.parse(`${today.slice(0, 4)}-${today.slice(5, 7)}-01T00:00:00Z`) + (Number(today.slice(8)) - 1 + d) * 86_400_000) : null;
    const pay_on = day && !Number.isNaN(day.getTime()) ? day.toISOString().slice(0, 10) : today;
    gen(`today ${today} +${d}`, caseOf({ today, invoice: { dueDate: today }, policy: { payLate: { maxDays: 1 } } }), prop({ pay_on, reason: "Paid late." }));
  }
}
gen("year 9999 late", caseOf({ today: "9999-12-30", invoice: { dueDate: "9999-12-31" }, policy: { payLate: { maxDays: 3650 } } }), prop({ pay_on: "9999-12-31", reason: "late" }));
gen("year 9999 past latest", caseOf({ today: "9999-12-30", invoice: { dueDate: "9999-12-30" }, policy: { payLate: { maxDays: 3650 } } }), prop({ pay_on: "9999-12-31", reason: "late" }));
// The currency it is paid from: no quote, a quote for another pair, the quote's floors and its end.
const fxCase = (p: Patch = {}) => caseOf({ invoice: { amount: "1850.00" }, balances: { EUR: "25300.00", USD: "8000.00" }, fx: QUOTE, ...p });
gen("pay from USD without a quote", caseOf({ fx: null }), prop({ pay_currency: "USD" }));
gen("pay from GBP with a USD quote", fxCase(), prop({ pay_currency: "GBP" }));
gen("quote buys another currency", fxCase({ fx: { ...QUOTE, buyCurrency: "GBP" } }), prop({ pay_currency: "USD" }));
gen("quote pays", fxCase(), prop({ pay_currency: "USD" }));
gen("quote ignored, EUR below floor", fxCase());
for (const [k, v] of [["sellAmount", "0.00"], ["buyAmount", "-1.00"], ["sellAmount", "2,001.34"], ["validTo", "tomorrow"], ["validTo", 20261108], ["validTo", "2026-11-07T23:59:59Z"], ["validTo", "2026-11-08"], ["validTo", "2026-02-30T00:00:00Z"]] as const) {
  gen(`quote ${k}=${v}`, fxCase({ fx: { ...QUOTE, [k]: v } as PaymentQuote }), prop({ pay_currency: "USD" }));
}
gen("quote ends before the day", fxCase(), prop({ pay_currency: "USD", pay_on: "2026-11-09" }));
for (const d of [-1, 0, 1]) {
  gen(`quote USD floor ${d}`, fxCase({ balances: { EUR: "25300.00", USD: fromCents(300_000 + 200_134 + d) } }), prop({ pay_currency: "USD" }));
  gen(`quote USD empty ${d}`, fxCase({ balances: { EUR: "25300.00", USD: fromCents(200_134 + d) }, policy: { cashFloors: { EUR: "25000.00" } } }), prop({ pay_currency: "USD" }));
  gen(`quote EUR side ${d}`, fxCase({ invoice: { amount: fromCents(185_000 + 30_000 + d) }, balances: { EUR: "25000.00", USD: "8000.00" } }), prop({ pay_currency: "USD" }));
  gen(`quote EUR side no floor ${d}`, fxCase({ invoice: { amount: fromCents(185_000 + d) }, balances: { EUR: "0.00", USD: "8000.00" }, policy: { cashFloors: { USD: "3000.00" } } }), prop({ pay_currency: "USD" }));
}
// Proposals that are none.
for (const bad of [null, {}, { rail: "bank_local", pay_on: "2026-11-08", pay_currency: "EUR" }, { ...PROP, pay_on: 20261108 }, ["bank_local"]]) gen(`proposal ${JSON.stringify(bad)}`, caseOf(), bad as never);

// A seeded sweep over the same values, combined at random.
let seed = 0x5eed;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
for (let i = 0; i < 1500; i++) {
  const amount = pick(["0.01", "299.99", "300.00", "499.99", "500.00", "500.01", "999.99", "1000.00", "1000.01", "1850.00", "5000.00", "25000.00", "0.00", "1.5"]);
  const c = caseOf({
    invoice: { amount, currency: pick(["EUR", "EUR", "USD", ""]), dueDate: pick(["2026-11-20", "2026-11-01", "", "2026-11-08", "2026-11-10"]) },
    balances: { EUR: pick(["30000.00", "25300.00", "25500.00", "26000.00", "0.00", "100000.00"]), USD: pick(["8000.00", "3000.00", "5001.34", "40000.00"]) },
    ...(rnd() < 0.3 ? { spokenFor: { EUR: pick(["0.00", "800.00", "5000.00"]) } } : {}),
    policy: {
      aloneLimit: pick([{ currency: "EUR", amount: "500.00" }, { currency: "EUR", amount: "1000.00" }, { currency: "USD", amount: "500.00" }, null]),
      cashFloors: pick<Record<string, string>>([{ EUR: "25000.00", USD: "3000.00" }, { EUR: "0.00" }, {}]),
      payLate: pick([null, { maxDays: 3 }, { maxDays: 30 }]),
    },
    rails: pick([[LOCAL, SWIFT], [LOCAL], [SWIFT], [], [{ ...LOCAL, maxPerPayout: "1000.00", minPerPayout: "1.00" }], [{ ...LOCAL, currency: "USD" }, SWIFT]]),
    fx: pick([null, QUOTE, { ...QUOTE, sellAmount: "550.00", buyAmount: "500.00" }]),
  });
  const p = prop({ rail: pick(["bank_local", "bank_swift"]), pay_on: pick(["2026-11-07", "2026-11-08", "2026-11-12", "2026-11-20", "2026-11-23", "2026-12-08"]), pay_currency: pick(["EUR", "USD"]), reason: pick(REASONS) });
  gen(`sweep ${i}`, c, p);
}

// 4. The Airi rail: the run's recorded policy and generated purchases at every limit, merchant and currency.
const run = airiRun();
const SHOP = "https://shop.test";
const airiPolicies: [string, AiriPolicy][] = [
  ["default", { aloneMaxCents: 2000, alonePerDay: 3, hardCapCents: AIRI_HARD_CAP_CENTS, currencies: ["EUR"], merchants: [SHOP, "https://kit11.max-31b.workers.dev"] }],
  ["support", { aloneMaxCents: 1000, alonePerDay: 2, hardCapCents: AIRI_HARD_CAP_CENTS, currencies: ["EUR"], merchants: [SHOP] }],
  ["nothing alone", { aloneMaxCents: 0, alonePerDay: 0, hardCapCents: AIRI_HARD_CAP_CENTS, currencies: ["EUR"], merchants: [] }],
];
if (run) airiPolicies.push(["airi run", { aloneMaxCents: toCents(run.policy.alone_max_eur), alonePerDay: run.policy.alone_per_day, hardCapCents: AIRI_HARD_CAP_CENTS, currencies: ["EUR"], merchants: [SHOP] }]);
const purchase = (amount: string, over: Partial<AiriPurchaseRequest> = {}): AiriPurchaseRequest => ({
  agent: "sourcing", paymentMethodId: "pm", merchantName: "Shop", merchantUrl: `${SHOP}/checkout`, merchantCountry: "NL", amount, currency: "EUR",
  items: [{ name: "x", unitPrice: amount, quantity: "1" }], description: "d", ...over,
});
const airiPolicy: RegoPolicy = { aloneLimit: null, cashFloors: {}, payLate: null };
for (const [pn, ap] of airiPolicies) {
  const policy = { ...airiPolicy, agentPurchase: ap };
  const buy = (name: string, req: AiriPurchaseRequest, aloneToday?: number) => add(`airi/${pn}/${name}`, policy, { kind: "agent_purchase", request: req }, aloneToday === undefined ? {} : { aloneToday });
  for (const amount of [...around(ap.aloneMaxCents), ...around(ap.hardCapCents), "0.01", "0.00"]) {
    for (const today of [undefined, 0, ap.alonePerDay - 1, ap.alonePerDay, ap.alonePerDay + 1]) buy(`${amount} after ${today}`, purchase(amount), today);
  }
  for (const url of [`${SHOP}/`, "https://kit11.max-31b.workers.dev/", "https://evil.test/", "http://shop.test/", "https://user:pw@shop.test/", "not a url", "https://SHOP.test/x", "https://shop.test:443/", "https://shop.test:8443/"]) buy(`merchant ${url}`, purchase("5.00", { merchantUrl: url }));
  for (const currency of ["EUR", "USD", "eur", ""]) buy(`currency ${currency}`, purchase("5.00", { currency }));
  buy("items add up", purchase("6.00", { items: [{ name: "a", unitPrice: "1.50", quantity: "2" }, { name: "b", unitPrice: "3.00", quantity: "1" }] }));
  buy("items do not add up", purchase("6.01", { items: [{ name: "a", unitPrice: "1.50", quantity: "2" }, { name: "b", unitPrice: "3.00", quantity: "1" }] }));
  buy("no items", purchase("5.00", { items: [] }));
  for (const quantity of ["0", "01", "10000", "9999", "1.5", ""]) buy(`quantity ${quantity}`, purchase("5.00", { items: [{ name: "a", unitPrice: "5.00", quantity }] }));
  for (const amount of ["5", "05.00", "1000000000.00", "999999999.99", "-5.00", "5.001"]) buy(`amount ${amount}`, purchase(amount));
  buy("item price unreadable", purchase("5.00", { items: [{ name: "a", unitPrice: "5,00", quantity: "1" }] }));
}

// 5. Within the limit to pay alone (aloneDecision), one cent either side, with limits and amounts code cannot read.
for (const limit of ["500.00", "0.00", "0.01", "000500.00", "999999999.99", "1000000000.00", "abc", "500"]) {
  const policy: RegoPolicy = { aloneLimit: { currency: "EUR", amount: limit }, cashFloors: {}, payLate: null };
  const top = /^\d{1,9}\.\d{2}$/.test(limit) ? Number(limit.replace(".", "")) : 50_000;
  for (const amount of [...around(top), "0500.00", "500", "", "5e2"]) {
    for (const currency of ["EUR", "USD", ""]) add(`alone/${limit}/${amount}/${currency}`, policy, { kind: "pay_alone", amount, currency }, {});
  }
  add(`alone/${limit}/number`, policy, { kind: "pay_alone", amount: 500, currency: "EUR" }, {});
  add(`alone/${limit}/missing`, policy, { kind: "pay_alone", amount: undefined, currency: undefined }, {});
}
add("alone/no limit", { aloneLimit: null, cashFloors: {}, payLate: null }, { kind: "pay_alone", amount: "1.00", currency: "EUR" }, {});

const generated = cases.length - generatedStart;

// ── The test ──

describe.runIf(opaVersion === null && !process.env.CI)("Purser's policy as Rego (OPA not installed)", () => {
  it.skip(`skipped: no opa binary on PATH (or OPA_BIN); CI downloads the pinned release. ${cases.length} cases would run`, () => {});
});

describe.runIf(opaVersion !== null || !!process.env.CI)("Purser's policy as Rego: OPA decides exactly as Purser does", () => {
  it("has opa (CI fails without it)", () => {
    expect(opaVersion, "opa is not on PATH: the CI step 'OPA (pinned)' puts the pinned release there").not.toBeNull();
  });

  it("the rules pass opa check --strict", () => {
    expect(() => opa(["check", "--strict", REGO])).not.toThrow();
  });

  it(`gives the same outcome and reason on every case (${cases.length}: ${adversarial} adversarial, ${generated} generated)`, () => {
    expect(cases.length).toBeGreaterThan(5000);
    const purser = cases.map((k) => purserDecision(k.policy, k.payment, k.ctx));
    const rego = opaDecisions(cases.map((k) => exportRegoInput(k.policy, k.payment, k.ctx)));
    expect(rego.length).toBe(cases.length);
    const diverged = cases.flatMap((k, i) => (JSON.stringify(purser[i]) === JSON.stringify(rego[i]) ? [] : [{ case: k.name, purser: purser[i], opa: rego[i] }]));
    expect(diverged.slice(0, 20)).toEqual([]);
    // Every outcome and most reasons occur, so the cases reach every rule.
    const seen = new Set(purser.map((d) => `${d.outcome}:${d.reason}`));
    for (const r of ["pay:null", "ask_cfo:above_alone_limit", "ask_cfo:no_alone_limit", "ask_cfo:alone_limit_other_currency", "hold:below_floor", "hold:not_enough_money",
      "hold:rail_not_accepted", "hold:rail_limit", "hold:after_due_date", "hold:pay_date_past", "hold:pay_date_invalid", "hold:pay_currency_not_available", "hold:fx_quote_ended",
      "hold:position_unreadable", "hold:amount_unreadable", "hold:invalid_proposal", "refuse:PURSER_MERCHANT_NOT_ALLOWED", "refuse:PURSER_MERCHANT_URL_INVALID",
      "refuse:PURSER_CURRENCY_NOT_ALLOWED", "refuse:PURSER_ABOVE_HARD_CAP", "refuse:PURSER_AMOUNT_INVALID", "refuse:PURSER_ITEMS_TOTAL_MISMATCH", "ask_cfo:alone_per_day_used",
      "ask_cfo:not_within", "ask_cfo:no_limit"]) expect(seen, r).toContain(r);
  }, 180_000);

  it("reads the company's policy from data.json when the input carries none", () => {
    const policy: RegoPolicy = { aloneLimit: BASE.policy.aloneLimit, cashFloors: BASE.policy.cashFloors, payLate: BASE.policy.payLate, agentPurchase: airiPolicies[0]![1] };
    const mine = cases.filter((k) => k.name.startsWith("generated/sweep") || k.name.startsWith("airi/default/")).map((k) => ({ ...k, policy: { ...k.policy, ...policy, ...(k.payment.kind === "supplier_payment" ? {} : { aloneLimit: null }) } }));
    const purser = mine.map((k) => purserDecision(k.policy, k.payment, k.ctx));
    // One data.json per policy: the supplier cases under the base policy, the purchases under the default rail policy.
    for (const kind of ["supplier_payment", "agent_purchase"] as const) {
      const sub = mine.map((k, i) => ({ k, i })).filter(({ k }) => k.payment.kind === kind);
      const rego = opaDecisions(sub.map(({ k }) => exportRegoInput(k.policy, k.payment, k.ctx, { withPolicy: false })), regoData(sub[0]!.k.policy));
      expect(rego).toEqual(sub.map(({ i }) => purser[i]));
    }
  }, 60_000);

  it("npm run policy:rego writes a bundle OPA loads", () => {
    const policy = readRegoPolicy(JSON.parse(readFileSync(new URL("../policy/example-policy.json", import.meta.url), "utf8")));
    const out = join(dir, "bundle");
    const { files, revision } = writeRegoBundle(policy, out);
    expect(files.map((f) => f.slice(out.length + 1))).toEqual(["purser.rego", "data.json", ".manifest"]);
    expect(revision).toMatch(/^[0-9a-f]{64}$/);
    const payment: RegoPayment = { kind: "agent_purchase", request: purchase("5.00", { merchantUrl: "https://kit11.max-31b.workers.dev/" }) };
    const input = join(dir, "one.json");
    writeFileSync(input, JSON.stringify(exportRegoInput(policy, payment, { aloneToday: 0 }, { withPolicy: false })));
    const got = JSON.parse(opa(["eval", "--format", "json", "-b", out, "-i", input, REGO_QUERY]) as string) as { result: { expressions: { value: RegoDecision }[] }[] };
    expect(got.result[0]!.expressions[0]!.value).toEqual(purserDecision(policy, payment, { aloneToday: 0 }));
    expect(got.result[0]!.expressions[0]!.value).toEqual({ outcome: "pay", reason: null });
  });
});

describe("the exporter (no OPA needed)", () => {
  it("gives OPA the merchant's origin as Purser's own check reads it", () => {
    expect(merchantOrigin("https://shop.test/checkout?x=1")).toBe("https://shop.test");
    expect(merchantOrigin("https://SHOP.test:443/")).toBe("https://shop.test");
    expect(merchantOrigin("http://shop.test/")).toBeNull();
    expect(merchantOrigin("https://u:p@shop.test/")).toBeNull();
    expect(merchantOrigin("nope")).toBeNull();
  });

  it("refuses a policy file that is not in Purser's shape", () => {
    expect(() => readRegoPolicy({ aloneLimit: { currency: "EUR", amount: "5" }, cashFloors: {}, payLate: null })).toThrow(/aloneLimit/);
    expect(() => readRegoPolicy({ aloneLimit: null, cashFloors: { EUR: 1 }, payLate: null })).toThrow(/cashFloors/);
    expect(() => readRegoPolicy({ aloneLimit: null, cashFloors: {}, payLate: { maxDays: "5" } })).toThrow(/payLate/);
    expect(() => readRegoPolicy({ aloneLimit: null, cashFloors: {}, payLate: null, agentPurchase: { merchants: [] } })).toThrow(/agentPurchase/);
    expect(readRegoPolicy({ aloneLimit: null, cashFloors: {}, payLate: null })).toEqual({ aloneLimit: null, cashFloors: {}, payLate: null });
  });

  it("puts the policy in the input unless it is left to data.json", () => {
    const x = fromPaymentCase(BASE, PROP);
    expect(exportRegoInput(x.policy, x.payment, x.ctx)).toMatchObject({ kind: "supplier_payment", policy: x.policy, context: { today: "2026-11-08" } });
    expect(exportRegoInput(x.policy, x.payment, x.ctx, { withPolicy: false })).not.toHaveProperty("policy");
  });
});
