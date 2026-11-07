// /try/sign, screen 1 (spec 6b, Max 7 Nov): the Treasury agent prepares the waiting payment (T-0002) Purser's way, one
// step per POST /agents: (1) Claude Sonnet reads Alpine Packaging's invoice, a document code wrote; (2) Purser's code
// checks the reading against the document's own lines, the payee against the allowlist, the text for planted lines, and
// the amount against what the agent may pay alone; (3) code plans the payment (EUR needed = invoice + fee ceiling,
// convert only the shortfall) and asks for a quote for exactly that; (4) Claude Opus advises; (5) the terms are written
// from the reading. The test world holds EUR and USD with their floors. The model readings and the advice are stand-ins
// here (no key in the tests), the quote a stand-in too; the recording a stand-in fixture made in the test.

import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ALPINE_INVOICE, alpineInvoice, invoiceDay } from "../src/try/invoiceDoc.js";
import { checkInvoiceReading, parseInvoiceFallback, type Invoice } from "../src/claude/invoiceReading.js";
import { assessAgainst } from "../src/policy/fraudCore.js";
import { findInjections } from "../src/policy/injection.js";
import { readRecorded, type RecordedAgents } from "../src/try/recorded.js";
import { CODE_LABEL, READ_BY_CODE, RECORDED_LABEL } from "../worker/src/agentLine.js";
import { TEST_ALLOWLIST } from "../worker/src/trick.js";
import { AGENT_STEPS, FEE_MAX, NEXT_INVOICE, TEST_BALANCES, TEST_RULES, TEST_WORLD, TrySignDesk, checkPayment, rateOfQuote, wellFormed } from "../worker/src/trySign.js";
import type { InvoiceReadSource } from "../src/try/claude.js";
import type Anthropic from "@anthropic-ai/sdk";
import type { FxSource } from "../worker/src/fxQuote.js";
import { InconsistentFacts, licenceNumbers, type TimingFacts } from "../src/agents/timingCore.js";
import { adviseTiming } from "../src/agents/timingAgent.js";
import { openDb } from "../src/db/open.js";
import { StandInAdvisor } from "./support/adviceStandIn.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { BASE, RP, TEST_RATE, call, challengeOf, signBody, sqlOver, t0, walkAgents, type Proposal } from "./support/trySign.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const nodeSha = (iban: string) => sha(iban.replace(/\s+/g, "").toUpperCase());
/** A stand-in for live Sonnet: answers what `read` makes of the document, counts its calls. */
function readerStandIn(read: (doc: string) => Invoice = parseInvoiceFallback) {
  const seen: string[] = [];
  const source: InvoiceReadSource = async (doc) => { seen.push(doc); return { value: read(doc), requestId: "req_standin_reader", costUsd: 0.004, model: "stand-in", ms: 300 }; };
  return { source, seen };
}
function deskOf(o: { reader?: InvoiceReadSource | "off" | null; advisor?: StandInAdvisor | null; fx?: StandInQuotes | null; recorded?: RecordedAgents | null; invoiceAmount?: string } = {}) {
  let clock = t0;
  const fx = o.fx === undefined ? new StandInQuotes(() => clock.getTime()) : o.fx;
  const db = new Database(":memory:");
  const d = new TrySignDesk(sqlOver(db), { now: () => clock, fx, rate: TEST_RATE, reader: o.reader === undefined ? readerStandIn().source : o.reader,
    advisor: o.advisor === undefined ? new StandInAdvisor().ask : o.advisor?.ask ?? null, recorded: o.recorded ?? null, invoiceAmount: o.invoiceAmount });
  return { d, db, fx, at: (t: Date) => { clock = t; } };
}
let ipN = 0;
async function opened(d: TrySignDesk, ip = `198.51.100.${++ipN % 250}`) {
  const r = await call(d, "world", {}, { ip });
  expect(r.status).toBe(201);
  return { ip, w: (await r.json()) as { world: { id: string; token: string }; proposals: Proposal[]; passkey_options: { challenge: string }; agents: { next: string } } };
}
const step = async (d: TrySignDesk, token: string, ip: string, name?: string) => {
  const r = await call(d, "agents", { token, ...(name ? { step: name } : {}) }, { ip });
  return { status: r.status, j: (await r.json()) as Record<string, unknown> & { step: string; result: Record<string, unknown>; next: string | null; done: boolean; proposals?: Proposal[] } };
};
const terms = (p: Proposal) => JSON.parse(p.canonical) as Record<string, unknown> & { amount: string; payee: string; payee_iban: string; reference: string; agent_advice: string; proposed_by: string; fx: { buy_amount: string; sell_amount: string; quote_id: string } | null };

describe("the invoice: a document code writes in the runner's format, genuine", () => {
  it("Alpine Packaging, INV-2026-118, dated two days ago, due in seven, EUR 1,850.00, its own IBAN and BIC", () => {
    const doc = alpineInvoice(t0);
    expect(doc).toContain("Alpine Packaging\nTest address, not a real company");
    expect(doc).toContain(`Date: ${invoiceDay(new Date(t0.getTime() - 2 * 86_400_000))}`);
    expect(doc).toContain("Date: 2 November 2026");
    expect(doc).toContain("Due date: 11 November 2026");
    expect(doc).toContain("Shipping boxes, October                       EUR 1,850.00");
    expect(doc).toContain("Total due                                     EUR 1,850.00");
    expect(doc).toContain("Pay by SWIFT to:\nAccount name: Alpine Packaging\nIBAN: DE00 0000 0000 0000 0001 18\nBIC: TESTDEFFXXX\nPayment reference: INV-2026-118");
    expect(parseInvoiceFallback(doc)).toEqual({ invoice_no: "INV-2026-118", vendor: "Alpine Packaging", amount: "1850.00", currency: "EUR", due_date: "2026-11-11", iban: "DE00000000000000000118", bic: "TESTDEFFXXX", reference: "INV-2026-118" });
    expect(ALPINE_INVOICE.vendor).toBe("Alpine Packaging");
  });
  it("passes the runner's fraud check against the test allowlist and its injection screen", () => {
    const doc = alpineInvoice(t0);
    const inv = parseInvoiceFallback(doc);
    const all = TEST_ALLOWLIST.map((b) => ({ beneficiary_id: b.beneficiary_id, name: b.name, iban_last4: b.iban.slice(-4), iban_sha256: nodeSha(b.iban), bic: b.bic }));
    const f = assessAgainst(all, inv, doc, nodeSha(inv.iban));
    expect(f.blocked).toBe(false);
    expect(f.signals.filter((s) => s.blocks)).toEqual([]);
    expect(findInjections(doc)).toEqual([]);
  });
});

describe("checkPayment: Purser's two-currency check (planInvoice, the USD floor, the EUR floor, then the limit alone)", () => {
  const quote = (buy: string, sell: string) => ({ quote_id: "q", buy_currency: "EUR", sell_currency: "USD", buy_amount: buy, sell_amount: sell, client_rate: "1.129677", valid_to_at: "2026-11-04T10:15:00Z", source: "stand-in" as const });
  it("T-0002, EUR 1,850.00: needed 1,870.00, free 1,000.00, short 870.00 bought with its quote; waits for a signature", () => {
    expect(TEST_WORLD).toMatchObject({ balance: "26000.00", reserve_floor: "25000.00", usd_balance: "8000.00", usd_floor: "3000.00", alone_limit: "500.00" });
    expect(FEE_MAX).toBe("20.00");
    const c = checkPayment("1850.00", TEST_BALANCES, TEST_RULES, { quote: quote("870.00", "982.82") });
    expect(c).toEqual({ check: "pass", waits: "Above the EUR 500.00 an agent may pay alone, so it waits for a person's signature.",
      plan: { needed: "1870.00", fee_max: "20.00", free: "1000.00", shortfall: "870.00", buy: "870.00", sell: "982.82", rate_from: "its quote" } });
  });
  it("T-0001, EUR 6,500.00: blocked by the floors at T-0002's quote's rate, in a CFO's words", () => {
    const rate = rateOfQuote(quote("870.00", "982.82"));
    const c = checkPayment("6500.00", TEST_BALANCES, TEST_RULES, { rate });
    expect(c.check).toBe("fail");
    expect(c.check === "fail" && c.rule).toBe("Reserve floors: it needs EUR 6,520.00 (the invoice + the EUR 20.00 fee ceiling) and only EUR 1,000.00 is free above the EUR floor. Converting the EUR 5,520.00 short takes USD 6,235.83 at the quote's rate, more than the USD 5,000.00 free above the USD floor of USD 3,000.00.");
  });
  it("T-0003 after T-0002: needed 1,260.00, free 20.00, short 1,240.00; no rate at all blocks a payment that needs FX", () => {
    const after = { eur: "25020.00", usd: "7017.18" };
    expect(checkPayment(NEXT_INVOICE.amount, after, TEST_RULES, { quote: quote("1240.00", "1400.80") })).toMatchObject({ check: "pass", plan: { needed: "1260.00", free: "20.00", buy: "1240.00", sell: "1400.80" } });
    expect(checkPayment(NEXT_INVOICE.amount, after, { ...TEST_RULES, alone_limit: "2000.00" }, { quote: quote("1240.00", "1400.80") })).toMatchObject({ check: "pass", waits: "" });
    const none = checkPayment("1850.00");
    expect(none.check === "fail" && none.rule).toMatch(/^No rate to plan the conversion/);
    // A quote for another amount than the shortfall is not the payment's: the rate decides, or nothing does.
    expect(checkPayment("1850.00", TEST_BALANCES, TEST_RULES, { quote: quote("1850.00", "2089.90") }).check).toBe("fail");
  });
  it("the EUR floor: a balance already under it pays nothing", () => {
    const c = checkPayment("100.00", { eur: "24000.00", usd: "8000.00" }, TEST_RULES, { rate: { usdPerEur: "1.1", from: "a rate" } });
    expect(c.check === "fail" && c.rule).toBe("Reserve floor: the EUR balance is already below its floor of EUR 25,000.00, so nothing more is paid.");
  });
});

describe("POST /agents: one step per request, in order, kept per world", () => {
  it("the world opens with T-0001 only and no outside call; T-0002 comes with the last step", async () => {
    const reader = readerStandIn();
    const advisor = new StandInAdvisor();
    const { d, fx } = deskOf({ reader: reader.source, advisor });
    const { w, ip } = await opened(d);
    expect(w.proposals.map((p) => p.proposal_id)).toEqual(["T-0001"]);
    expect(w.agents.next).toBe("read");
    expect([reader.seen.length, advisor.calls, fx!.calls]).toEqual([0, 0, 0]);
    const names: string[] = [];
    for (let i = 0; i < AGENT_STEPS.length; i++) {
      const s = await step(d, w.world.token, ip);
      expect(s.status).toBe(200);
      names.push(s.j.step);
    }
    expect(names).toEqual(["read", "check", "quote", "advise", "ready"]);
    expect([reader.seen.length, advisor.calls, fx!.calls]).toEqual([1, 2, 1]);
  });

  it("each step's answer: the reading's fields, code's checks one by one, the plan and the quote, the advice, the terms", async () => {
    const { d } = deskOf();
    const { w, ip } = await opened(d);
    const s = await walkAgents(d, w.world.token, ip);
    const r = (k: string) => (s[k] as { result: Record<string, unknown> }).result;
    expect(r("read")).toMatchObject({ source: "live", by: "stand-in, not Claude", fields: { vendor: "Alpine Packaging", amount: "1850.00", currency: "EUR", iban: "DE00000000000000000118", invoice_no: "INV-2026-118", due_date: "2026-11-11" }, request_id: "req_standin_reader" });
    expect(r("check")).toMatchObject({ by: CODE_LABEL, blocked: null });
    expect((r("check").ticks as { id: string; ok: boolean; label: string }[]).map((t) => [t.id, t.ok, t.label])).toEqual([
      ["reading", true, "The reading matches the invoice's own lines"],
      ["allowlist", true, "Alpine Packaging is on the allowlist, IBAN …0118"],
      ["planted", true, "No planted instructions in the invoice"],
      ["alone", true, "EUR 1,850.00 is above the EUR 500.00 the agent may pay alone: it goes to you"],
    ]);
    expect(r("quote")).toMatchObject({ by: "stand-in quote, not Airwallex", plan: { needed: "1870.00", free: "1000.00", shortfall: "870.00", buy: "870.00", sell: "982.82" },
      plan_words: "Needed EUR 1,870.00 (invoice + EUR 20.00 fee ceiling). Free EUR 1,000.00 above the floor. Code converts the EUR 870.00 short.",
      fx: { status: "live", quote: { buy_amount: "870.00", sell_amount: "982.82" } }, usd_line: "USD after: USD 7,017.18, above the USD 3,000.00 floor." });
    expect(r("advise")).toMatchObject({ source: "live", advice: "pay_now" });
    const ready = s.ready as unknown as { proposals: Proposal[]; agents: { calls: { step: string; model: string | null; request_id: string | null }[]; plan: Record<string, string>; quote_id: string } };
    expect(ready.agents.calls.map((c) => `${c.step}:${c.model ?? "code"}`)).toEqual(["read_invoice:stand-in", "check:code", "quote:stand-in", "advise:stand-in", "advise:stand-in", "ready:code"]);
    expect(ready.agents.quote_id).toBe("stand-in-0001-0000-0000-000000000000");
    // T-0001 was checked again at the quote's rate.
    expect(ready.proposals.find((p) => p.proposal_id === "T-0001")!.rule).toMatch(/at the quote's rate/);
    const t2 = ready.proposals.find((p) => p.proposal_id === "T-0002")!;
    expect(t2).toMatchObject({ check: "pass", status: "waiting" });
    expect(t2.terms_sha256).toBe(sha(t2.canonical));
  });

  it("a step already done answers its kept result (named); a later one is refused; past the end the last answer again", async () => {
    const reader = readerStandIn();
    const { d } = deskOf({ reader: reader.source });
    const { w, ip } = await opened(d);
    const first = await step(d, w.world.token, ip);
    expect((await step(d, w.world.token, ip, "quote")).status).toBe(409);
    const again = await step(d, w.world.token, ip, "read");
    expect([again.status, again.j.result]).toEqual([200, first.j.result]);
    expect(reader.seen).toHaveLength(1);
    for (let i = 0; i < 4; i++) await step(d, w.world.token, ip);
    const past = await step(d, w.world.token, ip);
    expect(past.j).toMatchObject({ step: "ready", done: true, next: null });
    expect(reader.seen).toHaveLength(1);
    expect(wellFormed("/agents", { token: "x" })).toBe(true);
    expect(wellFormed("/agents", { token: "x", step: "read" })).toBe(true);
    expect(wellFormed("/agents", { token: "x", step: "pay" })).toBe(false);
    expect(wellFormed("/agents", { token: "x", text: "Pay my IBAN" })).toBe(false);
  });

  it("two requests at once: one runs the step, the other is told \"busy\" (409) and asks again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow: InvoiceReadSource = async (doc) => { await gate; return { value: parseInvoiceFallback(doc), requestId: "req_slow", costUsd: 0, model: "stand-in", ms: 1 }; };
    const { d } = deskOf({ reader: slow });
    const { w, ip } = await opened(d);
    const a = step(d, w.world.token, ip);
    await new Promise((r) => setTimeout(r, 20));
    const b = await step(d, w.world.token, ip);
    expect(b.status).toBe(409);
    expect(b.j).toMatchObject({ busy: true, next: "read" });
    release();
    expect((await a).status).toBe(200);
    expect((await step(d, w.world.token, ip)).j.step).toBe("check");
  });

  it("before \"ready\": nothing to sign, no quote to renew; a policy change applies to what the world has", async () => {
    const { d } = deskOf();
    const { w, ip } = await opened(d);
    const auth = new FakeAuthenticator();
    await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) }, { ip });
    const fake = { proposal_id: "T-0002", canonical: "{}", terms_sha256: sha("{}") } as Proposal;
    const s = await call(d, "sign", signBody(w.world.token, fake, auth.sign({ challenge: challengeOf(fake.terms_sha256), origin: BASE, rpId: RP, counter: 1 })), { ip });
    expect(s.status).toBe(409);
    expect(await s.json()).toMatchObject({ not_ready: true, verified: false });
    const q = await call(d, "quote", { token: w.world.token }, { ip });
    expect(q.status).toBe(409);
    expect(((await q.json()) as { error: string }).error).toMatch(/not ready yet/);
  });
});

describe("the terms come from the agent's checked reading, not from fixed values", () => {
  it("an invoice for EUR 1,900.00: the signed terms carry 1,900.00 and an FX buy of 920.00 (1,920.00 needed, 1,000.00 free)", async () => {
    const { d } = deskOf({ invoiceAmount: "1900.00" });
    const { w, ip } = await opened(d);
    const s = await walkAgents(d, w.world.token, ip);
    const t2 = (s.ready as unknown as { proposals: Proposal[] }).proposals.find((p) => p.proposal_id === "T-0002")!;
    expect(terms(t2)).toMatchObject({ amount: "1900.00", payee: "Alpine Packaging (test payee)", payee_iban: "DE00000000000000000118", reference: "Invoice INV-2026-118", fx: { buy_amount: "920.00" } });
    expect((s.quote as { result: { plan: { buy: string } } }).result.plan.buy).toBe("920.00");
  });

  it("a reading that fails the check is not used: code's reading, labelled; the terms say who read it", async () => {
    // The stand-in "reads" another amount than the document says.
    const reader = readerStandIn((doc) => ({ ...parseInvoiceFallback(doc), amount: "185.00" }));
    expect(checkInvoiceReading({ ...parseInvoiceFallback(alpineInvoice(t0)), amount: "185.00" }, alpineInvoice(t0))).toBe("the reading differs from the document's own lines: amount");
    const { d } = deskOf({ reader: reader.source });
    const { w, ip } = await opened(d);
    const s = await walkAgents(d, w.world.token, ip);
    const check = (s.check as { result: { ticks: { id: string; ok: boolean }[]; reading: { source: string; label: string; note: string } } }).result;
    expect(check.ticks.find((t) => t.id === "reading")!.ok).toBe(false);
    expect(check.reading).toMatchObject({ source: "code", label: `${READ_BY_CODE} · the reading failed the check` });
    expect(check.reading.note).toMatch(/^the reading failed the runner's check \(the reading differs from the document's own lines: amount\)/);
    const t2 = (s.ready as unknown as { proposals: Proposal[] }).proposals.find((p) => p.proposal_id === "T-0002")!;
    expect(terms(t2)).toMatchObject({ amount: "1850.00", fx: { buy_amount: "870.00" } });
    expect(terms(t2).proposed_by).toMatch(/^Treasury agent \(invoice read by code, /);
  });

  it("the signed T-0002 runs by the stand-in: EUR 26,000.00 + 870.00 - 1,850.00 = 25,020.00, USD 8,000.00 - 982.82; the fee ceiling stays", async () => {
    const { d } = deskOf();
    const { w, ip } = await opened(d);
    const auth = new FakeAuthenticator();
    await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) }, { ip });
    const s = await walkAgents(d, w.world.token, ip);
    const t2 = (s.ready as unknown as { proposals: Proposal[] }).proposals.find((p) => p.proposal_id === "T-0002")!;
    const r = await call(d, "sign", signBody(w.world.token, t2, auth.sign({ challenge: challengeOf(t2.terms_sha256), origin: BASE, rpId: RP, counter: 1 })), { ip });
    const out = (await r.json()) as { verified: boolean; executed: Record<string, unknown>; world: Record<string, string> };
    expect(out.verified).toBe(true);
    expect(out.executed).toMatchObject({ amount: "1850.00", balance_after: "25020.00", usd_after: "7017.18", fx_bought: "870.00", fx_sold: "982.82", fx_quote_id: "stand-in-0001-0000-0000-000000000000" });
    expect(out.executed.fee).toBe("The stand-in charges no SWIFT fee; the EUR 20.00 fee ceiling the plan reserved stays in the balance.");
    expect(out.world).toMatchObject({ balance: "25020.00", usd_balance: "7017.18" });
  });
});

describe("the recorded reading: a real one, when the live reader is unavailable, checked as a live one", () => {
  const rec = (reading: Invoice): RecordedAgents => ({ format: "kit11.try-agents-recorded/v1", recorded_at: "2026-11-07T09:00:00Z", advice: null, tricks: {},
    invoice: { model: "claude-sonnet-5-5", request_id: "req_test_recorded_read1", date: "2026-11-07", ms: 3200, reading } });

  it("the switch off: Sonnet's recorded reading, labelled with the reason; it passes code's check, so it is the one used", async () => {
    const { d } = deskOf({ reader: "off", recorded: rec(parseInvoiceFallback(alpineInvoice(new Date("2026-11-07T09:00:00Z")))) });
    const { w, ip } = await opened(d);
    const s = await walkAgents(d, w.world.token, ip);
    const read = (s.read as { result: Record<string, unknown> }).result;
    expect(read).toMatchObject({ source: "recorded", by: RECORDED_LABEL, note: "the live agents are switched off on this server", request_id: "req_test_recorded_read1", recorded_on: "2026-11-07" });
    const check = (s.check as { result: { reading: { source: string } } }).result;
    expect(check.reading.source).toBe("recorded");
    const t2 = (s.ready as unknown as { proposals: Proposal[] }).proposals.find((p) => p.proposal_id === "T-0002")!;
    expect(terms(t2).proposed_by).toMatch(/^Treasury agent \(invoice reading recorded from Claude Sonnet, /);
  });

  it("a recorded reading for another amount fails the check: code's reading is used, labelled", async () => {
    const { d } = deskOf({ reader: "off", recorded: rec({ ...parseInvoiceFallback(alpineInvoice(t0)), amount: "1900.00" }) });
    const { w, ip } = await opened(d);
    const s = await walkAgents(d, w.world.token, ip);
    expect((s.check as { result: { reading: { source: string; label: string } } }).result.reading).toMatchObject({ source: "code", label: `${READ_BY_CODE} · the recorded reading failed the check` });
  });

  it("the recording is read field by field: a made-up request id, a stand-in model or another format is no recording", () => {
    const good = { format: "kit11.try-agents-recorded/v1", recorded_at: "2026-11-07T09:00:00Z", invoice: { model: "claude-sonnet-5-5", request_id: "req_011CVabcdef", date: "2026-11-07", ms: 3000, reading: parseInvoiceFallback(alpineInvoice(t0)) }, advice: null, tricks: {} };
    expect(readRecorded(good)?.invoice?.request_id).toBe("req_011CVabcdef");
    expect(readRecorded({ ...good, invoice: { ...good.invoice, model: "stand-in" } })?.invoice).toBeNull();
    expect(readRecorded({ ...good, invoice: { ...good.invoice, request_id: "x" } })?.invoice).toBeNull();
    expect(readRecorded({ ...good, format: "other" })).toBeNull();
    expect(readRecorded(null)).toBeNull();
  });
});

describe("the quote step: no FX needed, or no live quote", () => {
  it("no sandbox key: the plan at the recorded rate, no quote in the terms, and no advice (nothing to advise on), labelled", async () => {
    const { d } = deskOf({ fx: null });
    const { w, ip } = await opened(d);
    const s = await walkAgents(d, w.world.token, ip);
    const q = (s.quote as { result: Record<string, unknown> }).result;
    expect(q).toMatchObject({ by: `${CODE_LABEL} · no live quote`, fx: { status: "unavailable", reason: "this server has no Airwallex sandbox key" }, plan: { buy: "870.00", sell: "982.82" } });
    const t2 = (s.ready as unknown as { proposals: (Proposal & { voice: { label: string } })[] }).proposals.find((p) => p.proposal_id === "T-0002")!;
    expect(terms(t2).fx).toBeNull();
    expect(t2.voice.label).toBe("fixed text · there is no live quote to advise on");
  });
});

describe("the facts the Treasury agent is given add up (live Opus found them inconsistent, 7 Nov)", () => {
  // The bug: with no recorded rate (the recording script's desk), the plan before the quote could not price the
  // conversion, so it came back with no buy; the quote step read that as "no FX needed", asked for no quote, and gave
  // the agent EUR free after the payment -870.00 with no quote, which licenceNumbers read as +870.00 (it stripped the
  // sign): "free EUR before 2740.00, shortfall 0.00". Opus saw the contradiction and refused to advise paying.
  const sandboxShaped: FxSource = {
    quote: async (a) => ({ quote_id: "0b6f1d1c-4b8e-4f62-9a57-8c2f0f4a1e93", sell_currency: a.sellCurrency, buy_currency: a.buyCurrency, buy_amount: a.buyAmount,
      sell_amount: "982.10", client_rate: "1.128851", valid_to_at: new Date(t0.getTime() + 15 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), source: "airwallex-sandbox" }),
  };
  const LINE = "Code's numbers for this payment (quote these; do not compute your own): invoice EUR 1850.00 + SWIFT fee ceiling EUR 20.00 = EUR 1870.00 needed; free EUR before the payment 1000.00; shortfall EUR 870.00 (EUR needed minus free EUR); the FX converts exactly that: buy EUR 870.00 for USD 982.10.";

  for (const [path, rate] of [["the recording script's desk (no recorded rate)", null], ["the Worker's desk (the recorded rate)", TEST_RATE]] as const) {
    it(`${path}: needed 1,870.00, free 1,000.00, shortfall 870.00, buy EUR 870.00, and the position after agrees`, async () => {
      const advisor = new StandInAdvisor();
      const d = new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, fx: sandboxShaped, rate, reader: readerStandIn().source, advisor: advisor.ask });
      const { w, ip } = await opened(d);
      const s = await walkAgents(d, w.world.token, ip);
      expect((s.quote as { result: Record<string, unknown> }).result).toMatchObject({ plan: { needed: "1870.00", free: "1000.00", shortfall: "870.00", buy: "870.00", sell: "982.10" }, fx: { status: "live" } });
      const prompt = String(advisor.requests[0]!.messages[0]!.content);
      expect(prompt).toContain(LINE);
      // read_position, as the agent read it: EUR free after the payment 0.00, never negative.
      const position = JSON.stringify(advisor.requests[1]!.messages[2]!.content);
      expect(position).toContain("After the payment as planned: EUR free 0.00, USD 7017.90.");
      expect((s.advise as { result: { facts: Record<string, unknown>; source: string } }).result).toMatchObject({ source: "live",
        facts: { amount: "1850.00", feeMax: "20.00", eurAvailable: "26000.00", usdAvailable: "8000.00", quote: { sell: "USD 982.10", buy: "EUR 870.00" }, after: { eurFree: "0.00", usdAvailable: "7017.90" } } });
    });
  }

  it("the plan names what to convert with or without a rate; only the USD is unknown without one", () => {
    const c = checkPayment("1850.00");
    expect(c).toMatchObject({ check: "fail", plan: { needed: "1870.00", free: "1000.00", shortfall: "870.00", buy: "870.00", sell: null } });
  });

  it("licenceNumbers refuses a negative or malformed amount instead of stripping its sign; valid ones as before", () => {
    const f = { amount: "1850.00", feeMax: "20.00", quote: null, after: { eurFree: "-870.00", usdAvailable: "8000.00" } };
    expect(() => licenceNumbers(f)).toThrow(InconsistentFacts);
    expect(() => licenceNumbers({ ...f, after: { ...f.after, eurFree: "870 EUR" } })).toThrow(/not a plain amount/);
    expect(() => licenceNumbers({ ...f, amount: "100.00", after: { ...f.after, eurFree: "0.00" }, quote: { sell: "USD 500.00", buy: "EUR 400.00", rate: "1.1", validTo: "x" } })).toThrow(/negative/);
    expect(licenceNumbers({ ...f, after: { ...f.after, eurFree: "0.00" }, quote: { sell: "USD 982.10", buy: "EUR 870.00", rate: "1.128851", validTo: "x" } })).toEqual({ needed: "1870.00", freeBefore: "1000.00", shortfall: "870.00", fxBuy: "870.00" });
  });

  it("the runner's agent is not asked on numbers that do not add up: no call, the proposal stands as code planned it", async () => {
    let calls = 0;
    const client = { beta: { messages: { create: async () => { calls++; throw new Error("not to be called"); } } } } as unknown as Anthropic;
    const f: TimingFacts = { proposalId: "P-1", invoiceNo: "X-1", vendor: "V", amount: "1850.00", dueDate: "2026-11-15", today: "2026-11-05", eurAvailable: "26000.00", eurFloor: "25000.00", eurObligations: "0.00",
      usdAvailable: "8000.00", usdFloor: "3000.00", quote: null, after: { eurFree: "-870.00", usdAvailable: "8000.00" }, feeMax: "20.00" };
    const r = await adviseTiming(openDb(":memory:"), f, client);
    expect(r).toMatchObject({ source: "fallback", timing: null, run: { status: "unavailable" } });
    expect(r.run.note).toMatch(/^code's numbers for this payment do not add up/);
    expect(calls).toBe(0);
  });
});
