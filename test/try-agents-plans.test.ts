// /try/sign's agents (worker/src/trySign.ts, POST /agents) on the plans other than the main one: an invoice the EUR above
// the floor already pays (no quote asked, no FX in the terms), a quote that comes back expired or for another amount
// (never used: the agent is not asked to advise on it), the reasons the Treasury agent was not asked (no model key,
// switched off), and a world that expires while a step runs (the step's result is not kept).
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TrySignDesk } from "../worker/src/trySign.js";
import type { FxQuote, FxSource } from "../worker/src/fxQuote.js";
import { parseInvoiceFallback } from "../src/claude/invoiceReading.js";
import type { InvoiceReadSource } from "../src/try/claude.js";
import { StandInAdvisor } from "./support/adviceStandIn.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { TEST_RATE, call, sqlOver, t0, type Proposal } from "./support/trySign.js";

const reader: InvoiceReadSource = async (doc) => ({ value: parseInvoiceFallback(doc), requestId: "req_standin_reader", costUsd: 0.004, model: "stand-in", ms: 300 });

function deskOf(o: { fx?: FxSource | null; advisor?: StandInAdvisor | "off" | null; invoiceAmount?: string; reader?: InvoiceReadSource } = {}) {
  let clock = t0;
  const fx = o.fx === undefined ? new StandInQuotes(() => clock.getTime()) : o.fx;
  const advisor = o.advisor === undefined ? new StandInAdvisor().ask : o.advisor === "off" || o.advisor === null ? o.advisor : o.advisor.ask;
  const d = new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => clock, fx, rate: TEST_RATE, reader: o.reader ?? reader, advisor, invoiceAmount: o.invoiceAmount });
  return { d, fx, at: (t: Date) => { clock = t; } };
}
let ipN = 0;
async function opened(d: TrySignDesk) {
  const ip = `192.0.2.${++ipN % 250}`;
  const r = await call(d, "world", {}, { ip });
  expect(r.status).toBe(201);
  return { ip, token: ((await r.json()) as { world: { token: string } }).world.token };
}
type StepAnswer = { step: string; result: Record<string, unknown> & { ticks?: { id: string; ok: boolean; label: string }[] }; proposals?: Proposal[]; done: boolean; paid_alone?: unknown[]; error?: string; expired?: boolean };
async function walk(d: TrySignDesk, token: string, ip: string) {
  const out: Record<string, StepAnswer> = {};
  for (;;) {
    const r = await call(d, "agents", { token }, { ip });
    expect(r.status).toBe(200);
    const j = (await r.json()) as StepAnswer;
    out[j.step] = j;
    if (j.done) return out;
  }
}
const quoteOf = (a: { buyAmount: string }, o: Partial<FxQuote> = {}): FxQuote => ({
  quote_id: "stand-in-odd-0000-0000-000000000000", sell_currency: "USD", buy_currency: "EUR", buy_amount: a.buyAmount, sell_amount: "999.99",
  client_rate: "1.129677", valid_to_at: "2026-11-04T10:15:00Z", source: "stand-in", ...o,
});

describe("an invoice the EUR above the floor already pays", () => {
  it("is planned from EUR with no quote asked, advised on without one, and its terms carry no FX", async () => {
    const { d, fx } = deskOf({ invoiceAmount: "300.00" });
    const { ip, token } = await opened(d);
    const s = await walk(d, token, ip);
    const alone = s.check!.result.ticks!.find((t) => t.id === "alone")!;
    expect(alone.label).toBe("EUR 300.00 is within the EUR 500.00 the agent may pay alone");
    expect(s.quote!.result).toMatchObject({ fx: null, no_fx: true, plan: { buy: null } });
    expect(String(s.quote!.result.plan_words)).toContain("No FX needed.");
    expect((fx as StandInQuotes).calls).toBe(0);
    // The agent is asked with code's numbers and no quote; whatever it says, it is checked before use.
    expect(["live", "recorded", "code"]).toContain(s.advise!.result.source);
    const t2 = s.ready!.result.proposal as Proposal;
    expect(JSON.parse(t2.canonical)).toMatchObject({ amount: "300.00", fx: null });
  });
});

describe("a quote that is not for the shortfall is never used", () => {
  for (const [what, make, reason] of [
    ["already expired", (a: { buyAmount: string }) => quoteOf(a, { valid_to_at: "2026-11-04T09:59:00Z" }), "the quote had already expired"],
    ["for another amount", (a: { buyAmount: string }) => quoteOf(a, { buy_amount: "1.00" }), "the quote was not for the amount asked"],
  ] as const) {
    it(`a quote ${what}: no live quote, the shortfall checked at the recorded rate, and the agent not asked`, async () => {
      let asked = 0;
      const fx: FxSource = { quote: async (a) => { asked++; return make(a); } };
      const advisor = new StandInAdvisor();
      const { d } = deskOf({ fx, advisor });
      const { ip, token } = await opened(d);
      const s = await walk(d, token, ip);
      expect(asked).toBe(1);
      expect(s.quote!.result.fx).toEqual({ status: "unavailable", reason });
      expect(String(s.quote!.result.by)).toContain("no live quote");
      expect(s.advise!.result).toMatchObject({ source: "code", advice: "none", why: "there is no live quote to advise on" });
      const t2 = s.ready!.result.proposal as Proposal;
      expect(JSON.parse(t2.canonical).fx).toBeNull();
    });
  }
});

describe("why the Treasury agent was not asked, when a conversion has no live quote", () => {
  it("this server has no model key, or the live agents are switched off", async () => {
    for (const [advisor, why] of [[null, "this server has no model key"], ["off", "the live agents are switched off on this server"]] as const) {
      const { d } = deskOf({ fx: null, advisor });
      const { ip, token } = await opened(d);
      const s = await walk(d, token, ip);
      expect(s.quote!.result.fx).toEqual({ status: "unavailable", reason: "this server has no Airwallex sandbox key" });
      expect(s.advise!.result).toMatchObject({ source: "code", why, advice: "none" });
      expect(String(s.advise!.result.by)).toContain(why);
    }
  });
});

describe("a world that expires while a step runs", () => {
  it("answers 410 and keeps nothing of the step", async () => {
    let expireNow: (() => void) | null = null;
    const slow: InvoiceReadSource = async (doc) => { expireNow?.(); return reader(doc); };
    const { d, at } = deskOf({ reader: slow });
    const { ip, token } = await opened(d);
    expireNow = () => at(new Date(t0.getTime() + 2 * 60 * 60 * 1000));
    const r = await call(d, "agents", { token }, { ip });
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ error: "this test world expired; start a new one", expired: true });
  });
});
