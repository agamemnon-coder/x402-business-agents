import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TRY_CALLS, TRY_MODEL_PER_MINUTE, TRY_PER_DAY, TRY_PER_MINUTE, TryDesk } from "../worker/src/try.js";

const sql = () => {
  const db = new Database(":memory:");
  return { exec: (q: string, ...b: unknown[]) => { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
};
const BASE = "https://kit11.example.workers.dev";
const ask = (d: TryDesk, text: string, headers: Record<string, string> = {}) =>
  d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: JSON.stringify({ text }), headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "203.0.113.7", ...headers } }));
// A stand-in for the Messages API (never the real one): every call costs 1000 tokens in, 100 out.
const api = (answers: Record<string, unknown>[]) => {
  let n = 0;
  return (async (_u: string, init: RequestInit) => {
    void init;
    return new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answers[n++ % answers.length]) }], usage: { input_tokens: 1000, output_tokens: 100 } }));
  }) as unknown as typeof fetch;
};

describe("Try Purser on the relay", () => {
  it("answers with Claude's reading and code's decision, and keeps the key out of the answer", async () => {
    const d = new TryDesk(sql(), { anthropicKey: "sk-test-secret", fetcher: api([{ kind: "flight" }, { item: "flight", merchant: null, amount: "250", currency: "EUR", date: null, payee: null }]) });
    const res = await ask(d, "Book a flight to Berlin, max €250");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ outcome: "paid", mode: "claude" });
    expect(body).not.toContain("sk-test-secret");
  });

  it("reads by code alone once today's budget is spent", async () => {
    const d = new TryDesk(sql(), { anthropicKey: "k", budgetUsd: 0.001, fetcher: api([{ kind: "flight" }, { item: "f", merchant: null, amount: "250", currency: "EUR", date: null, payee: null }]) });
    expect((await (await ask(d, "Book a flight to Berlin, max €250")).json() as { mode: string }).mode).toBe("claude");
    const second = await (await ask(d, "Book a flight to Berlin, max €250", { "cf-connecting-ip": "198.51.100.1" })).json() as { mode: string; steps: { detail: string }[] };
    expect(second.mode).toBe("plain");
    expect(second.steps[0]!.detail).toContain("budget");
  });

  it("pauses the models for everyone when many addresses try at once, so the day's budget cannot go in minutes", async () => {
    // Seen live on 30 October: a client behind a rotating proxy shows a new address on most requests.
    let clock = Date.parse("2026-10-30T12:00:00Z");
    const d = new TryDesk(sql(), { anthropicKey: "k", now: () => new Date(clock), fetcher: api([{ kind: "software" }, { item: "Figma", merchant: "Figma", amount: null, currency: null, date: null, payee: null }]) });
    const mode = async (i: number) => (await (await ask(d, "Buy Figma", { "cf-connecting-ip": `198.51.100.${i}` })).json() as { mode: string; steps: { detail: string }[] });
    // The ceiling counts model calls: a typed task is two (Haiku sorts, Sonnet reads), so 30 tries a minute as before.
    expect(TRY_MODEL_PER_MINUTE / TRY_CALLS.text).toBe(30);
    for (let i = 1; i <= TRY_MODEL_PER_MINUTE / TRY_CALLS.text; i++) expect((await mode(i)).mode).toBe("claude");
    const crowded = await mode(200);
    expect(crowded.mode).toBe("plain");
    expect(crowded.steps[0]!.detail).toContain("many visitors");
    clock += 61_000;
    expect((await mode(201)).mode).toBe("claude");
  });

  it("limits each address per minute and per day", async () => {
    let clock = Date.parse("2026-10-30T12:00:00Z");
    const d = new TryDesk(sql(), { now: () => new Date(clock) });
    for (let i = 0; i < TRY_PER_MINUTE; i++) expect((await ask(d, "Buy a PS5")).status).toBe(200);
    expect((await ask(d, "Buy a PS5")).status).toBe(429);
    for (let i = TRY_PER_MINUTE; i < TRY_PER_DAY; i++) { clock += 61_000; expect((await ask(d, "Buy a PS5")).status).toBe(200); }
    clock += 61_000;
    expect((await ask(d, "Buy a PS5")).status).toBe(429);
    expect((await ask(d, "Buy a PS5", { "cf-connecting-ip": "198.51.100.9" })).status).toBe(200);
  });

  it("refuses other sites, long texts and odd bodies", async () => {
    const d = new TryDesk(sql(), {});
    expect((await ask(d, "Buy a PS5", { origin: "https://evil.example" })).status).toBe(403);
    expect((await ask(d, "x".repeat(281))).status).toBe(413);
    expect((await d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: "{", headers: { origin: BASE } }))).status).toBe(400);
    expect((await d.fetch(new Request(`${BASE}/api/try`))).status).toBe(405);
  });
});

describe("Try Purser on the relay: the visitor changes the world (D21)", () => {
  const world = (d: TryDesk, id: unknown, headers: Record<string, string> = {}) =>
    d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: JSON.stringify({ world: id }), headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "203.0.113.8", ...headers } }));
  // A stand-in for the Messages API with tools (never the real one): the agent finishes at once.
  const agentApi = (async () => new Response(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100 },
    content: [{ type: "tool_use", id: "x1", name: "finish", input: { summary: "Kept Stockline; told nobody." } }] }), { status: 200 })) as unknown as typeof fetch;

  it("runs one wake of the Sourcing agent with Claude, and keeps the key out of the answer", async () => {
    const d = new TryDesk(sql(), { anthropicKey: "sk-test-secret", fetcher: agentApi });
    const res = await world(d, "stockline-back");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ source: "claude", summary: "Kept Stockline; told nobody.", world: { id: "stockline-back" } });
    expect(body).not.toContain("sk-test-secret");
  });

  it("refuses a world it does not know", async () => {
    const d = new TryDesk(sql(), {});
    expect((await world(d, "drain-the-treasury")).status).toBe(400);
    expect((await world(d, 7)).status).toBe(400);
  });

  it("shares the limits of the text tries: per address, and code alone once today's budget is spent", async () => {
    const d = new TryDesk(sql(), { anthropicKey: "k", budgetUsd: 0.0001, fetcher: agentApi });
    expect((await (await world(d, "price-rise")).json() as { source: string }).source).toBe("claude");
    const second = await (await world(d, "price-rise", { "cf-connecting-ip": "198.51.100.77" })).json() as { source: string; why: string };
    expect(second).toMatchObject({ source: "code", why: "today's budget for model calls is spent" });
    const busy = new TryDesk(sql(), {});
    for (let i = 0; i < TRY_PER_MINUTE; i++) expect((await world(busy, "price-rise")).status).toBe(200);
    expect((await ask(busy, "Buy a PS5", { "cf-connecting-ip": "203.0.113.8" })).status).toBe(429);
  });
});

describe("Try desk review fixes (1 Nov): world tries are weighed by their model calls, spend is counted per call", () => {
  const world = (d: TryDesk, id: string, ip: string) =>
    d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: JSON.stringify({ world: id }), headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": ip } }));
  // Stand-in Messages API (test only): the agent keeps looking at the market and never finishes.
  const looping = (onCall: () => void = () => {}) => (async () => { onCall(); return new Response(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: "tool_use", id: "m", name: "market", input: {} }] }), { status: 200 }); }) as unknown as typeof fetch;

  it("a world try counts as five model calls toward everyone's ceiling a minute", async () => {
    const d = new TryDesk(sql(), { anthropicKey: "k", fetcher: looping() });
    expect(TRY_CALLS.world).toBe(5);
    for (let i = 1; i <= TRY_MODEL_PER_MINUTE / TRY_CALLS.world; i++) expect((await (await world(d, "price-rise", `198.51.100.${i}`)).json() as { calls: number }).calls).toBe(5);
    expect(await (await world(d, "price-rise", "198.51.100.200")).json()).toMatchObject({ source: "code", calls: 0, why: "many visitors are trying it right now, so the models pause for a minute" });
  });

  it("records the spend after every call and stops the wake when the day's budget runs out in the middle of it", async () => {
    const d = new TryDesk(sql(), { anthropicKey: "k", budgetUsd: 0.000001, fetcher: looping() });
    expect(await (await world(d, "price-rise", "203.0.113.9")).json()).toMatchObject({ source: "code", calls: 1, why: "today's budget for model calls is spent" });
  });

  it("ends a wake that runs past 30 seconds", async () => {
    let clock = Date.parse("2026-11-05T10:00:00Z");
    const d = new TryDesk(sql(), { anthropicKey: "k", now: () => new Date(clock), fetcher: looping(() => { clock += 31_000; }) });
    expect(await (await world(d, "price-rise", "203.0.113.10")).json()).toMatchObject({ source: "code", calls: 1, why: "the agent took longer than 30 seconds" });
  });
});
