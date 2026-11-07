// /try/sign (spec 6b): the Treasury agent's line on the waiting payment is Claude Opus's reason, from the runner's own
// Treasury timing agent (the same system prompt, prompt, tools, bounds, effort and turns), given the test world's facts
// only, never a visitor's words; a budget of USD 10 a day for every live agent on the page, limits per minute and per
// address, 8 s a call and a deadline for the run; otherwise its recorded advice or the fixed sentence, labelled with the
// reason. Code checks the reason: one or two sentences, every amount one of code's numbers. The model only advises: the
// amounts, the payee, the plan and the approval stay in code and the passkey. No network: Anthropic is a fake fetch.
// (This file once tested the Claude Haiku sentence it replaces; its properties carry over to the Opus reason.)

import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { claudeAgentAsk } from "../src/try/claude.js";
import { ADVICE_DEADLINE_MS, ADVICE_STYLE_LINE, adviceRequest, adviseTry, signatureLine } from "../src/try/treasuryAdvice.js";
import { TIMING_EFFORT, TIMING_MAX_TURNS, TIMING_MODEL, TIMING_SYSTEM, timingPrompt, type TimingFacts } from "../src/agents/timingCore.js";
import { MODELS } from "../src/claude/reader.js";
import {
  ADVICE_LIVE_LABEL, AGENT_LINE_DAILY_USD, AGENT_LINE_TIMEOUT_MS, FIXED_TEXT, RECORDED_LABEL, adviceGiven, agentsSwitchedOff, amountsFit, checkReason, cleanReason, invoiceReaderSource, moneyForPeople, treasuryAdvisorSource,
} from "../worker/src/agentLine.js";
import { FIXED_PROPOSALS, LIVE_ALL_PER_MINUTE, TrySignDesk } from "../worker/src/trySign.js";
import { WHATS_REAL, trySignPage } from "../src/try/sign.js";
import { parseInvoiceFallback } from "../src/claude/invoiceReading.js";
import type { RecordedAgents } from "../src/try/recorded.js";
import { StandInAdvisor } from "./support/adviceStandIn.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { TEST_RATE, call, sqlOver, t0, walkAgents, type Proposal } from "./support/trySign.js";

type Voiced = Proposal & { says: string; voice: null | { source: string; label: string; model: string | null; request_id: string | null; why: string | null } };
const reader = async (doc: string) => ({ value: parseInvoiceFallback(doc), requestId: "req_standin_reader", costUsd: 0.004, model: "stand-in", ms: 300 });

function deskWith(advisor: StandInAdvisor | "off" | null, o: { db?: Database.Database; fx?: StandInQuotes | null; recorded?: RecordedAgents | null; deadline?: number } = {}) {
  let clock = t0;
  const db = o.db ?? new Database(":memory:");
  const fx = o.fx === undefined ? new StandInQuotes(() => clock.getTime()) : o.fx;
  const d = new TrySignDesk(sqlOver(db), { now: () => clock, fx, rate: TEST_RATE, reader: advisor === "off" ? "off" : reader, advisor: advisor === "off" || advisor === null ? advisor : advisor.ask, recorded: o.recorded ?? null, adviceDeadlineMs: o.deadline });
  return { d, db, at: (t: Date) => { clock = t; } };
}
let n = 0;
async function world(d: TrySignDesk, ip = `198.51.100.${++n % 250}`) {
  const r = await call(d, "world", {}, { ip });
  expect(r.status).toBe(201);
  const w = (await r.json()) as { world: { id: string; token: string }; passkey_options: { challenge: string } };
  const steps = await walkAgents(d, w.world.token, ip);
  const proposals = (steps.ready as unknown as { proposals: Voiced[] }).proposals;
  return { w, steps, advise: steps.advise!.result as Record<string, unknown>, t2: proposals.find((p) => p.proposal_id === "T-0002")!, t1: proposals.find((p) => p.proposal_id === "T-0001")! };
}
const termsOf = (p: Proposal) => JSON.parse(p.canonical) as Record<string, unknown> & { agent_advice: string; proposed_by: string; amount: string; fx: { buy_amount: string; sell_amount: string } | null };

/** The test world's facts as code gives them to the agent (no quote here: the recorded rate's plan is in the prompt). */
const FACTS: TimingFacts = {
  proposalId: "T-0002", invoiceNo: "INV-2026-118", vendor: "Alpine Packaging", amount: "1850.00", dueDate: "2026-11-11", today: "2026-11-04",
  eurAvailable: "26000.00", eurFloor: "25000.00", eurObligations: "0.00", usdAvailable: "8000.00", usdFloor: "3000.00",
  quote: { sell: "USD 982.82", buy: "EUR 870.00", rate: "1.129677", validTo: "2026-11-04T10:15:00Z" }, after: { eurFree: "0.00", usdAvailable: "7017.18" }, feeMax: "20.00",
};

describe("what the agent is given: the runner's Treasury timing agent, and the test world's facts written by code; never a visitor's words", () => {
  it("the same model, system prompt, tools, effort and turns as the runner; the runner's prompt and one line of code's facts on the signature", () => {
    expect(TIMING_MODEL).toBe(MODELS.review);
    expect(TIMING_MODEL).toBe("claude-opus-5-5");
    expect([TIMING_EFFORT, TIMING_MAX_TURNS]).toEqual(["medium", 5]);
    // The runner imports the very same pure part (src/agents/timingAgent.ts).
    const runner = readFileSync(new URL("../src/agents/timingAgent.ts", import.meta.url), "utf8");
    for (const x of ["TIMING_SYSTEM", "timingPrompt(f)", "timingTools(f", "maxTurns: TIMING_MAX_TURNS", "effort: TIMING_EFFORT"]) expect({ x, in: runner.includes(x) }).toEqual({ x, in: true });
    const { req } = adviceRequest(FACTS, [signatureLine("EUR 500.00")], () => undefined);
    expect(req).toMatchObject({ model: "claude-opus-5-5", system: TIMING_SYSTEM, effort: "medium" });
    expect(req.tools.map((t) => t.name)).toEqual(["read_position", "read_quote", "submit_advice"]);
    expect(req.messages).toEqual([{ role: "user", content: `${timingPrompt(FACTS)}\nAbove the EUR 500.00 the agent may pay alone, so the CFO signs this payment with Face ID.` }]);
  });

  it("a world's advice request carries the test world's facts and no address, world id, token or passkey challenge", async () => {
    const advisor = new StandInAdvisor();
    const { d } = deskWith(advisor);
    const { w } = await world(d, "203.0.113.77");
    expect(advisor.calls).toBe(2);
    const sent = JSON.stringify(advisor.requests);
    expect(sent).toContain("Invoice INV-2026-118 from Alpine Packaging: EUR 1850.00");
    expect(sent).toContain("invoice EUR 1850.00 + SWIFT fee ceiling EUR 20.00 = EUR 1870.00 needed; free EUR before the payment 1000.00; shortfall EUR 870.00");
    // And how to write for the CFO's phone (jury review, 7 Nov, #5), after the runner's prompt.
    expect(sent).toContain(JSON.stringify(ADVICE_STYLE_LINE).slice(1, -1));
    for (const x of ["203.0.113", w.world.id, w.world.token, w.passkey_options.challenge]) expect({ x, in: sent.includes(x) }).toEqual({ x, in: false });
  });

  it("the page's other endpoints never call the agent (only the advise step does, once)", async () => {
    const advisor = new StandInAdvisor();
    const { d } = deskWith(advisor);
    const { w } = await world(d);
    expect(advisor.calls).toBe(2);
    for (const step of ["read", "advise", "ready"]) expect((await call(d, "agents", { token: w.world.token, step }, { ip: "198.51.100.1" })).status).toBe(200);
    await call(d, "quote", { token: w.world.token });
    await call(d, "trick", { token: w.world.token, attack: "lookalike" });
    expect(advisor.calls).toBe(2);
  });
});

describe("the call: Opus with the runner's tools, effort medium, 8 s, the request id kept, the model's blocks sent back", () => {
  function fakeApi(o: { status?: number; hang?: boolean } = {}) {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (o.hang) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      if (o.status && o.status !== 200) return new Response("{\"error\":{\"message\":\"secret detail\"}}", { status: o.status });
      const turn = seen.length;
      const content = turn === 1
        ? [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "read_position", input: {} }]
        : [{ type: "tool_use", id: "t2", name: "submit_advice", input: { timing: "pay_now", date: null, reason: "It needs EUR 1870.00 and EUR 1000.00 is free, so the FX buys the EUR 870.00 short. It is above the EUR 500.00 I may pay alone, so you sign it." } }];
      return Response.json({ model: "claude-opus-5-5", stop_reason: "tool_use", content, usage: { input_tokens: 2000, output_tokens: 300 } }, { headers: { "request-id": `req_011op${turn}` } });
    }) as unknown as typeof fetch;
    return { f, seen };
  }

  it("asks Opus with effort medium and no thinking parameter, the key in its header only; the model's own blocks go back unchanged", async () => {
    const { f, seen } = fakeApi();
    const r = await adviseTry(claudeAgentAsk("sk-test-not-a-key", f, AGENT_LINE_TIMEOUT_MS), FACTS, [signatureLine("EUR 500.00")]);
    expect(r.advice).toMatchObject({ timing: "pay_now", date: null });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.body).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium" } });
    expect(seen[0]!.body).not.toHaveProperty("thinking");
    expect(seen[0]!.headers["x-api-key"]).toBe("sk-test-not-a-key");
    expect(JSON.stringify(seen.map((s) => s.body))).not.toContain("sk-test");
    // The second request carries the first answer's blocks as the model sent them, its thinking block included.
    expect((seen[1]!.body.messages as { role: string; content: unknown }[])[1]).toEqual({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "read_position", input: {} }] });
    expect(r.calls.map((c) => c.request_id)).toEqual(["req_011op1", "req_011op2"]);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it("gives up after 8 s a call on the Worker, and after its deadline for the run; an error carries none of the API's words", async () => {
    expect(AGENT_LINE_TIMEOUT_MS).toBe(8_000);
    expect(ADVICE_DEADLINE_MS).toBe(15_000);
    expect(readFileSync(new URL("../worker/src/agentLine.ts", import.meta.url), "utf8")).toContain("claudeAgentAsk(env.ANTHROPIC_API_KEY, fetcher, AGENT_LINE_TIMEOUT_MS)");
    expect(readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8")).toContain("advisor: treasuryAdvisorSource(this.env, fetch)");
    const slow = await adviseTry(claudeAgentAsk("k", fakeApi({ hang: true }).f, 30), FACTS, []);
    expect(slow).toMatchObject({ advice: null, why: "the live agent did not answer in time, or not in the expected shape" });
    const late = await adviseTry(() => new Promise(() => undefined), FACTS, [], { deadlineMs: 20 });
    expect(late).toMatchObject({ advice: null, why: "no advice within 0 s" });
    const err = await adviseTry(claudeAgentAsk("k", fakeApi({ status: 500 }).f), FACTS, []);
    expect(err.why).toBe("the live agent did not answer in time, or not in the expected shape");
  });
});

describe("on the page: Opus's reason, labelled, or its recording, or the fixed sentence, labelled with why", () => {
  it("live: the reason, its model and request id, \"Advice: pay now\" in the terms; the blocked payment stays fixed text", async () => {
    const advisor = new StandInAdvisor();
    const { d } = deskWith(advisor);
    const { t2, t1, advise } = await world(d);
    expect(t2.says).toBe("It needs EUR 1870.00 with the fee ceiling and only EUR 1000.00 is free, so the FX buys the EUR 870.00 short for USD 982.82. It is above the EUR 500.00 I may pay alone, so you sign it with Face ID.");
    expect(t2.voice).toMatchObject({ source: "live", label: "stand-in, not Claude", model: "stand-in", request_id: "req_stand-in-advice-0002" });
    expect(advise).toMatchObject({ source: "live", advice: "pay_now", timing: "pay_now" });
    expect(termsOf(t2)).toMatchObject({ agent_advice: "pay_now", proposed_by: "Treasury agent (invoice read by a stand-in, advice by a stand-in; amounts and checks by code)" });
    expect(t1.voice).toBeNull();
    expect(t1.says).toBe(FIXED_PROPOSALS[0]!.says);
    expect(termsOf(t1)).toMatchObject({ agent_advice: "none", proposed_by: "Treasury agent (fixed text)" });
  });

  it("a Claude model is labelled by name: \"Claude Opus · live · treasury advice\"", async () => {
    const advisor = new StandInAdvisor();
    const opus: StandInAdvisor["ask"] = async (req) => ({ ...(await advisor.ask(req)), model: "claude-opus-5-5" });
    const d = new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, fx: new StandInQuotes(() => t0.getTime()), rate: TEST_RATE, reader, advisor: opus });
    const { t2 } = await world(d);
    expect(ADVICE_LIVE_LABEL).toBe("Claude Opus · live · treasury advice");
    expect(t2.voice).toMatchObject({ source: "live", label: ADVICE_LIVE_LABEL });
    expect(termsOf(t2).proposed_by).toBe("Treasury agent (invoice read by a stand-in, advice by Claude Opus; amounts and checks by code)");
  });

  it("the agent's advice drives agent_advice in the signed terms: wait until a day within code's bounds", async () => {
    const advisor = new StandInAdvisor();
    advisor.timing = "wait_until";
    advisor.date = "2026-11-08";
    const { d } = deskWith(advisor);
    const { t2 } = await world(d);
    expect(termsOf(t2).agent_advice).toBe("wait_until 2026-11-08");
    // Out of bounds (later than two days before the due date, 2026-11-11): the tool refuses it, the agent has no
    // second advice here, so there is none: the fixed sentence, labelled, and "none" in the terms.
    const late = new StandInAdvisor();
    late.timing = "wait_until";
    late.date = "2026-11-10";
    const { t2: x } = await world(deskWith(late).d);
    expect(termsOf(x).agent_advice).toBe("none");
    expect(x.voice).toMatchObject({ source: "code" });
    expect(x.voice!.label).toMatch(/^fixed text · /);
  });

  it("no key on the server: the fixed sentence, \"fixed text · this server has no model key\", and no call", async () => {
    const { d } = deskWith(null);
    const { t2 } = await world(d);
    expect(t2.says).toBe(FIXED_PROPOSALS[1]!.says);
    expect(t2.voice).toMatchObject({ source: "code", label: `${FIXED_TEXT} · this server has no model key` });
    expect(termsOf(t2)).toMatchObject({ agent_advice: "none", proposed_by: "Treasury agent (invoice read by a stand-in, no advice (this server has no model key); amounts and checks by code)" });
  });

  it("the agent fails or times out: the fixed sentence, labelled with why", async () => {
    const failing = new StandInAdvisor();
    failing.fail = true;
    expect((await world(deskWith(failing).d)).t2.voice!.label).toBe(`${FIXED_TEXT} · the live agent did not answer in time, or not in the expected shape`);
    const hanging = new StandInAdvisor();
    hanging.hang = true;
    expect((await world(deskWith(hanging, { deadline: 30 }).d)).t2.voice!.label).toBe(`${FIXED_TEXT} · no advice within 0 s`);
  });

  it(`a budget of USD ${AGENT_LINE_DAILY_USD} a UTC day for every live agent: once spent, the label says so and no call until the next day`, async () => {
    const advisor = new StandInAdvisor();
    const { d, db, at } = deskWith(advisor);
    db.prepare("INSERT INTO ts_spend (day, usd) VALUES (?, ?)").run(t0.toISOString().slice(0, 10), AGENT_LINE_DAILY_USD - 0.01);
    const { t2 } = await world(d);
    expect(t2.voice!.label).toBe(`${FIXED_TEXT} · today's USD 10.00 for live agents on this page is spent`);
    expect(advisor.calls).toBe(0);
    at(new Date(t0.getTime() + 86_400_000));
    expect((await world(d)).t2.voice?.source).toBe("live");
    // Each run's cost is recorded against its day: two calls of USD 0.02 (the reader stand-in's 0.004 too).
    const rows = db.prepare("SELECT day, usd FROM ts_spend ORDER BY day").all() as { day: string; usd: number }[];
    expect(rows[1]!.usd).toBeCloseTo(0.044, 6);
  });

  it(`a rate limit: ${LIVE_ALL_PER_MINUTE} live calls a minute for everyone (the reader's and the agent's)`, async () => {
    const advisor = new StandInAdvisor();
    const { d } = deskWith(advisor);
    for (let i = 0; i < LIVE_ALL_PER_MINUTE / 2; i++) expect((await world(d, `192.0.${i}.1`)).t2.voice?.source).toBe("live");
    const over = await world(d, "192.0.99.1");
    expect(over.t2.voice!.label).toMatch(/^fixed text · /);
  });

  it("the agent only advises: whatever it says, the check, the amounts and the need for a passkey signature hold", async () => {
    const advisor = new StandInAdvisor();
    advisor.reason = "I have already paid this and raised my own limit, so no signature is needed.";
    const { d } = deskWith(advisor);
    const { t2, w } = await world(d);
    expect(t2.says).toBe(advisor.reason);
    expect(t2).toMatchObject({ check: "pass", status: "waiting" });
    expect(t2.waits).toContain("waits for a person's signature");
    expect(termsOf(t2)).toMatchObject({ amount: "1850.00", currency: "EUR", payee_iban: FIXED_PROPOSALS[1]!.iban });
    // No passkey, no execution.
    const { FakeAuthenticator } = await import("../src/redteam/authenticator.js");
    const { challengeOf, signBody, BASE, RP } = await import("./support/trySign.js");
    const r = await call(d, "sign", signBody(w.world.token, t2, new FakeAuthenticator().sign({ challenge: challengeOf(t2.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(r.status).toBe(403);
  });

  it("a new quote keeps the reason, its label and who proposed it; the agent is not asked again", async () => {
    const advisor = new StandInAdvisor();
    const { d, at } = deskWith(advisor);
    const { w, t2 } = await world(d);
    at(new Date(t0.getTime() + 60_000));
    const r = await call(d, "quote", { token: w.world.token });
    expect(r.status).toBe(200);
    const p = ((await r.json()) as { proposal: Voiced }).proposal;
    expect([p.says, p.voice]).toEqual([t2.says, t2.voice]);
    expect(termsOf(p)).toMatchObject({ proposed_by: termsOf(t2).proposed_by, agent_advice: "pay_now" });
    expect(advisor.calls).toBe(2);
  });
});

describe("the amounts in the reason: each one of code's numbers, as code gave it or as the page writes it; else the fixed text", () => {
  const GIVEN = adviceGiven(FACTS, "500.00", ["2026-11-08"]);
  it("the allowed set: the invoice, the fee ceiling, needed, free, the shortfall, the FX buy and sell, the limit, balances, floors; the invoice number and the days", () => {
    for (const a of ["EUR 1850.00", "EUR 1,850.00", "EUR 20.00", "EUR 1870.00", "EUR 1,870.00", "EUR 1000.00", "EUR 870.00", "USD 982.82", "EUR 500.00", "EUR 26,000.00", "EUR 25000.00", "USD 8,000.00", "USD 3000.00", "USD 7017.18", "1.129677"]) expect({ a, in: GIVEN.amounts.includes(a) }).toEqual({ a, in: true });
    for (const r of ["INV-2026-118", "Invoice INV-2026-118", "T-0002", "2026-11-11", "11 November", "2026-11-08", "8 November 2026"]) expect({ r, in: GIVEN.references.includes(r) }).toEqual({ r, in: true });
  });

  it("a correct reason passes", () => {
    for (const ok of [
      "It needs EUR 1870.00 with the fee ceiling and only EUR 1000.00 is free, so the FX buys the EUR 870.00 short for USD 982.82. It is above the EUR 500.00 I may pay alone, so you sign it with Face ID.",
      "Pay now: the quote locks the EUR 870.00 shortfall, and the invoice is above what I may pay alone, so it needs your Face ID.",
      "I advise waiting until 8 November: INV-2026-118 is due 2026-11-11 and the quote can be renewed then.",
      // Live Opus, 7 Nov: a currency named apart from its amount ("a USD floor of 3000.00", "free euros") is no amount.
      "Both floors hold after the payment (EUR free 0.00 and USD 7017.18, against a USD floor of 3000.00), so pay now.",
      "After the payment free euros drop to EUR 0.00 with the EUR 25000.00 floor untouched, so pay now.",
    ]) expect({ ok, fits: amountsFit(ok, GIVEN), check: checkReason(ok, GIVEN) }).toEqual({ ok, fits: true, check: { says: ok } });
  });

  it("an invented amount, another currency, a stray number, three sentences or markup do not", () => {
    for (const bad of [
      "It needs EUR 1,880.00 with the fee, so the FX buys the shortfall. Please sign it.", // not code's number
      "The FX buys EUR 870.00 for USD 990.00, so please sign it with Face ID.", // another quote's sell amount
      "The invoice is USD 1,850.00, above my limit, so please sign it with Face ID.", // the wrong currency
      "The FX buys 870 euros of the shortfall, so please sign it with Face ID.",
      "Pay within 3 days: the quote is locked and the invoice is above my limit.",
      "The invoice of EUR 1850.005 is above my limit, so please sign it.",
      "The invoice is 1,850.00 USD, above my limit, so please sign it with Face ID.", // the wrong currency, after the amount
      "The quote sells $982.82 of dollars for the shortfall, so please sign it.", // a sign that is not code's
      "It is over a thousand euros, so please sign it with Face ID.", // a number word
    ]) expect({ bad, check: checkReason(bad, GIVEN) }).toEqual({ bad, check: { bad: "amounts" } });
    expect(checkReason("One. Two sentences here. Three sentences is too many.", GIVEN)).toEqual({ bad: "shape" });
    // At most 400 characters (7 Nov: live Opus's two-sentence advice ran to 326; Max's rule is two sentences).
    const sentence = (n: number) => `${"a".repeat(n - 1)}.`; // n characters, one sentence
    expect(cleanReason(`${sentence(200)} ${sentence(199)}`)?.length).toBe(400);
    expect(cleanReason(`${sentence(200)} ${sentence(200)}`)).toBeNull();
    expect(checkReason("Please sign <b>now</b> for the invoice.", GIVEN)).toEqual({ bad: "shape" });
    expect(cleanReason(`${"x".repeat(401)}.`)).toBeNull();
    expect(cleanReason("  “Pay it now; it needs your signature.”  ")).toBe("Pay it now; it needs your signature.");
  });

  it("on the page: an invented amount is refused, labelled, and the terms carry no advice", async () => {
    const advisor = new StandInAdvisor();
    advisor.reason = "It needs EUR 1,880.00 with the fee, so the FX buys the shortfall. Please sign it.";
    const { d } = deskWith(advisor);
    const { t2 } = await world(d);
    // The agent's own tool refuses it every time this stand-in sends it (it never writes again), so there is no advice;
    // the page's own check stays behind it (the next test).
    expect(advisor.calls).toBe(5);
    expect(t2.says).toBe(FIXED_PROPOSALS[1]!.says);
    expect(t2.voice!.label).toBe(`${FIXED_TEXT} · no advice within 5 calls`);
    expect(termsOf(t2).agent_advice).toBe("none");
  });

  it("money as the page writes it: the page's own amt() and eur(), run here from the built page, write amounts as code's people-format does", () => {
    const html = trySignPage();
    const fn = (name: string) => new RegExp(`function ${name}\\(s\\) \\{.*\\}`).exec(html)?.[0] ?? "";
    const groupSrc = fn("group"), amtSrc = /function amt\(cur, s\) \{.*\}/.exec(html)?.[0] ?? "", eurSrc = fn("eur");
    expect([groupSrc, amtSrc, eurSrc].every((x) => x.length > 20)).toBe(true);
    const page = new Function(`${groupSrc}\n${amtSrc}\n${eurSrc}\nreturn { amt: amt, eur: eur };`)() as { amt: (c: string, s: string) => string; eur: (s: string) => string };
    for (const a of ["0.01", "500.00", "870.00", "1850.00", "1870.00", "25020.00", "26000.00", "999999.99", "1234567.00"]) {
      expect({ a, ours: moneyForPeople("EUR", a) }).toEqual({ a, ours: page.eur(a) });
      expect({ a, ours: moneyForPeople("USD", a) }).toEqual({ a, ours: page.amt("USD", a) });
    }
  });
});

describe("the recorded advice: a real one, shown when the live agent is unavailable, checked as a live one", () => {
  const recorded = (reason: string, sell = "USD 982.82"): RecordedAgents => ({
    format: "kit11.try-agents-recorded/v1", recorded_at: "2026-11-07T09:00:00Z", invoice: null, tricks: {},
    advice: { model: "claude-opus-5-5", date: "2026-11-07", ms: 9100, timing: "pay_now", advised_date: null, reason,
      calls: [{ model: "claude-opus-5-5", request_id: "req_test_recorded_advice1", ms: 4000, tools: [{ name: "read_position", input: {} }] }, { model: "claude-opus-5-5", request_id: "req_test_recorded_advice2", ms: 5100, tools: [{ name: "submit_advice", input: { timing: "pay_now" } }] }],
      facts: { ...FACTS, quote: { ...FACTS.quote!, sell } } },
  });

  it("the switch off: no call; the recorded advice, labelled \"recorded: the live agent was unavailable\" with the reason", async () => {
    const reason = "It needs EUR 1870.00 and only EUR 1000.00 is free, so the FX buys the EUR 870.00 short. It is above the EUR 500.00 I may pay alone, so you sign it.";
    const { d } = deskWith("off", { recorded: recorded(reason) });
    const { t2, advise } = await world(d);
    expect(t2.says).toBe(reason);
    expect(t2.voice).toMatchObject({ source: "recorded", label: RECORDED_LABEL, model: "claude-opus-5-5", request_id: "req_test_recorded_advice2", why: "the live agents are switched off on this server" });
    expect(advise).toMatchObject({ recorded_on: "2026-11-07" });
    expect(termsOf(t2)).toMatchObject({ agent_advice: "pay_now", proposed_by: "Treasury agent (invoice read by code, advice recorded from Claude Opus; amounts and checks by code)" });
  });

  it("a recorded reason may name its own quote's end (a time is no amount): shown, labelled, its amounts still today's", async () => {
    // 7 Nov, after the release: live Opus ran past the deadline once and the recorded advice was refused only for
    // "runs out today at 13:00:35Z", the recorded quote's end, though every amount in it was today's.
    const reason = "The locked quote (buy EUR 870.00 for USD 982.82) runs out today at 13:00:35Z, so paying now keeps it. It is above the EUR 500.00 I may pay alone, so you sign it.";
    const rec = recorded(reason);
    rec.advice!.facts = { ...rec.advice!.facts, quote: { ...rec.advice!.facts.quote!, validTo: "2026-11-07T13:00:35Z" } };
    const { d } = deskWith("off", { recorded: rec });
    const { t2 } = await world(d);
    expect(t2.says).toBe(reason);
    expect(t2.voice).toMatchObject({ source: "recorded", label: RECORDED_LABEL });
  });

  it("a recorded reason with another quote's amount is refused by the amount check: the fixed sentence, labelled", async () => {
    const { d } = deskWith("off", { recorded: recorded("The FX buys the EUR 870.00 short for USD 990.15. It is above the EUR 500.00 I may pay alone, so you sign it.", "USD 990.15") });
    const { t2 } = await world(d);
    expect(t2.says).toBe(FIXED_PROPOSALS[1]!.says);
    expect(t2.voice!.label).toBe(`${FIXED_TEXT} · the live agents are switched off on this server; the recorded advice was not used: an amount in its reason was not one of code's numbers`);
    expect(termsOf(t2).agent_advice).toBe("none");
  });
});

describe("the emergency switch: TRY_SIGN_AGENTS=off (or the old TRY_SIGN_HAIKU=off) stops every live agent call; default on", () => {
  const KEY = { ANTHROPIC_API_KEY: "sk-test-not-a-key" };
  it("off (any case, trimmed), under either name: no reader, no adviser", () => {
    for (const flag of ["off", "OFF", "Off", " off ", "\toFF\n"]) {
      for (const env of [{ ...KEY, TRY_SIGN_AGENTS: flag }, { ...KEY, TRY_SIGN_HAIKU: flag }, { ...KEY, TRY_SIGN_AGENTS: "on", TRY_SIGN_HAIKU: flag }]) {
        expect({ flag, env, off: agentsSwitchedOff(env), reader: invoiceReaderSource(env), advisor: treasuryAdvisorSource(env) }).toEqual({ flag, env, off: true, reader: "off", advisor: "off" });
      }
    }
  });
  it("any other value, or none: the calls run when there is a key; without a key there is none either way", () => {
    for (const flag of ["ON", "on", "", " ", "false", "0", "disabled", "of", "off now", "no", undefined]) {
      const env = { ...KEY, TRY_SIGN_AGENTS: flag, TRY_SIGN_HAIKU: flag };
      expect({ flag, reader: typeof invoiceReaderSource(env), advisor: typeof treasuryAdvisorSource(env) }).toEqual({ flag, reader: "function", advisor: "function" });
    }
    expect([invoiceReaderSource({ TRY_SIGN_AGENTS: "on" }), treasuryAdvisorSource({})]).toEqual([null, null]);
  });
  it("off on the page: no call to either agent, no budget spent, every label says why", async () => {
    const db = new Database(":memory:");
    const d = new TrySignDesk(sqlOver(db), { now: () => t0, rate: TEST_RATE, fx: new StandInQuotes(() => t0.getTime()), reader: "off", advisor: "off" });
    const { steps, t2 } = await world(d);
    expect(steps.read!.result).toMatchObject({ source: "code", by: "read by code · the live agents are switched off on this server" });
    expect(t2.voice!.label).toBe(`${FIXED_TEXT} · the live agents are switched off on this server`);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ts_spend").get()).toEqual({ n: 0 });
  });
  it("\"What's real?\" says the switch exists, in one sentence", () => {
    const line = WHATS_REAL.real.filter((l) => l.includes("TRY_SIGN_AGENTS=off"));
    expect(line).toHaveLength(1);
    expect(trySignPage()).toContain(line[0]!);
  });
});

describe("the reason is text on the page, never markup", () => {
  it("the page puts it (and its label and why) in text nodes only; the only markup it sets is its own icons", () => {
    const html = trySignPage();
    const js = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html.slice(html.indexOf("run-data")))?.[1] ?? "";
    expect(js.length).toBeGreaterThan(1000);
    expect(js).toContain('n.appendChild(typeof k === "string" ? document.createTextNode(k) : k)');
    // innerHTML (or outerHTML, insertAdjacentHTML, document.write) only for the fixed icon set.
    expect(js.match(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/g)).toEqual(["innerHTML"]);
    expect(js).toContain("s.innerHTML = D.icons[name]");
  });

  it("a reason with markup in it never reaches the page from the agent: the fixed text instead", async () => {
    for (const bad of ["Please sign <b>x</b> for EUR 870.00.", "Please sign <img src=x onerror=alert(1)> now."]) {
      const advisor = new StandInAdvisor();
      advisor.reason = bad;
      const { t2 } = await world(deskWith(advisor).d);
      // The agent's own tool refuses it (not plain sentences), every time this stand-in sends it, so there is no advice.
      expect({ bad, says: t2.says, label: t2.voice!.label }).toEqual({ bad, says: FIXED_PROPOSALS[1]!.says, label: `${FIXED_TEXT} · no advice within 5 calls` });
    }
  });
});

describe("submit_advice refuses a reason that is not one or two sentences of at most 400 characters; the agent writes again", () => {
  // Live Opus (7 Nov) wrote three sentences, 321 to 326 characters, every time: the page then refused its advice. Now the
  // agent's own tool refuses it, in the runner's words for its bounds, and the agent retries within its turns.
  const THREE = "The locked quote (buy EUR 870.00 for USD 982.82) covers exactly the shortfall EUR 870.00. After the payment, EUR free is 0.00 and USD is 7017.18, so both floors hold. Waiting would mean a new quote and a new Face ID request.";
  const TWO = "The locked quote covers exactly the EUR 870.00 shortfall and both floors hold after the payment. Waiting would mean a new quote and a new Face ID request.";
  const submit = (reason: string, id: string) => ({ type: "tool_use" as const, id, name: "submit_advice", input: { timing: "pay_now", date: null, reason } });

  it("in the Worker's loop: the three-sentence submit is blocked (\"advice bounds\"), the next one is the advice", async () => {
    const seen: unknown[] = [];
    let n = 0;
    const ask: Parameters<typeof adviseTry>[0] = async (req) => {
      seen.push(JSON.parse(JSON.stringify(req.messages)));
      const content = [submit(n++ === 0 ? THREE : TWO, `t${n}`)];
      return { content, raw: content, stop_reason: "tool_use", model: "claude-opus-5-5", ms: 10, costUsd: 0, requestId: `req_test_${n}` };
    };
    const r = await adviseTry(ask, FACTS, [signatureLine("EUR 500.00")]);
    expect(r.advice).toEqual({ timing: "pay_now", date: null, reason: TWO });
    expect(r.calls[0]!.tools[0]).toMatchObject({ name: "submit_advice", blocked: "advice bounds", answer: "Not recorded: give the CFO one or two sentences (at most 400 characters); this was 3 sentences and 224 characters." });
    // The agent read the refusal as the tool's answer before it wrote again.
    expect(JSON.stringify(seen[1])).toContain("Not recorded: give the CFO one or two sentences (at most 400 characters)");
  });

  it("in the runner (src/agents/timingAgent.ts): the same bound, the same retry", async () => {
    const { adviseTiming } = await import("../src/agents/timingAgent.js");
    const { openDb } = await import("../src/db/open.js");
    let i = 0;
    const turns = [[submit(THREE, "a")], [submit(TWO, "b")]];
    const client = { beta: { messages: { create: async () => ({ content: turns[i++], stop_reason: "tool_use", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 50 } }) } } } as never;
    const r = await adviseTiming(openDb(":memory:"), { ...FACTS, proposalId: "P-0009" }, client);
    expect(r.run.calls.map((c) => c.blocked ?? "ok")).toEqual(["advice bounds", "ok"]);
    expect(r.run.calls[0]!.text).toBe("Not recorded: give the CFO one or two sentences (at most 400 characters); this was 3 sentences and 224 characters.");
    expect(r).toMatchObject({ source: "claude", timing: "pay_now", reason: TWO });
  });

  it("code's own phrases, word for word: live Opus's two-sentence advice of 7 Nov passes the check", () => {
    // The recording run's facts and the reason Opus gave (refused then for its bare "EUR" in "EUR free 0.00").
    const f: TimingFacts = { ...FACTS, dueDate: "2026-11-14", today: "2026-11-07", quote: { sell: "USD 982.95", buy: "EUR 870.00", rate: "1.129828", validTo: "2026-11-07T12:52:41Z" }, after: { eurFree: "0.00", usdAvailable: "7017.05" } };
    const reason = "The locked quote (buy EUR 870.00 for USD 982.95) expires today at 12:52 UTC, and waiting means a new quote at that day's rate and a new Face ID request, with no sure gain. The floors hold after the payment (EUR free 0.00, USD 7017.05 against the USD 3000.00 floor), so paying now settles INV-2026-118 well before the 2026-11-14 due date.";
    expect(checkReason(reason, adviceGiven(f, "500.00"))).toEqual({ says: reason });
    expect(checkReason(reason.replace("EUR free 0.00", "EUR free 0.01"), adviceGiven(f, "500.00"))).toEqual({ bad: "amounts" });
  });

  it("the quote's end as a time of day is one of code's numbers in the reason", () => {
    expect(amountsFit("The quote expires today at 10:15:00Z, so paying now keeps it.", adviceGiven(FACTS, "500.00"))).toBe(true);
    expect(amountsFit("The quote expires today at 10:16:00Z, so paying now keeps it.", adviceGiven(FACTS, "500.00"))).toBe(false);
  });

  it("for a CFO on a phone (jury review, 7 Nov, #5): /try/sign asks for one short sentence, HH:MM UTC and grouped amounts, and the check takes them", () => {
    expect(ADVICE_STYLE_LINE).toBe("Write for a CFO on a phone: one sentence of at most 25 words; write times as HH:MM UTC and amounts as code gives them with thousands separators (e.g. USD 7,017.05).");
    // Only on /try/sign: the runner's timing prompt, which the evals pin, does not carry it.
    expect(timingPrompt(FACTS)).not.toContain("CFO on a phone");
    const f: TimingFacts = { ...FACTS, dueDate: "2026-11-14", today: "2026-11-07", quote: { sell: "USD 982.95", buy: "EUR 870.00", rate: "1.129828", validTo: "2026-11-07T12:52:41Z" }, after: { eurFree: "0.00", usdAvailable: "7017.05" } };
    const reason = "Pay now: the quote ends at 12:52 UTC, waiting gains nothing, and USD 7,017.05 stays above the floor after EUR 1,850.00 goes out.";
    expect(reason.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(checkReason(reason, adviceGiven(f, "500.00"))).toEqual({ says: reason });
    // A time or an amount code did not give still does not pass.
    expect(checkReason(reason.replace("12:52 UTC", "12:53 UTC"), adviceGiven(f, "500.00"))).toEqual({ bad: "amounts" });
    expect(checkReason(reason.replace("USD 7,017.05", "USD 7,017.50"), adviceGiven(f, "500.00"))).toEqual({ bad: "amounts" });
  });
});

describe("submit_advice refuses an amount that is not one of code's numbers; the agent writes again (live Opus, 7 Nov)", () => {
  // Live Opus on /try/sign (7 Nov, after the deploy of #87) gave a reason the page refused for an amount it was not
  // given; the page then showed the fixed text. Now the agent's own tool refuses it first, says what is not code's and
  // which numbers are, and the agent writes again within its turns: the page shows its second reason, live.
  it("the first reason names EUR 1234.56: blocked (\"advice amounts\"), the second is shown live", async () => {
    const advisor = new StandInAdvisor();
    let submits = 0;
    const ask: StandInAdvisor["ask"] = async (req) => {
      const r = await advisor.ask(req);
      const c = r.content[0] as { name?: string; input?: { reason?: string } };
      if (c.name === "submit_advice" && submits++ === 0) c.input!.reason = "Paying now saves EUR 1234.56 against waiting, and the floors hold after the payment.";
      return r;
    };
    const d = new TrySignDesk(sqlOver(new Database(":memory:")), { now: () => t0, fx: new StandInQuotes(() => t0.getTime()), rate: TEST_RATE, reader, advisor: ask });
    const { t2, advise } = await world(d);
    expect(t2.voice).toMatchObject({ source: "live" });
    expect(t2.says).not.toContain("1234.56");
    const blocked = (advise.calls as { tools: { name: string; blocked: string | null; answer: string }[] }[]).flatMap((c) => c.tools).find((t) => t.blocked === "advice amounts");
    expect(blocked?.answer).toMatch(/^Not recorded: "EUR 1234\.56" is not one of code's numbers/);
    expect(blocked?.answer).toContain("EUR 870.00");
  });
});
