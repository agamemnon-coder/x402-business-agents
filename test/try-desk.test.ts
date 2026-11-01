import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TRY_MODEL_PER_MINUTE, TRY_PER_DAY, TRY_PER_MINUTE, TryDesk } from "../worker/src/try.js";

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
    for (let i = 1; i <= TRY_MODEL_PER_MINUTE; i++) expect((await mode(i)).mode).toBe("claude");
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
