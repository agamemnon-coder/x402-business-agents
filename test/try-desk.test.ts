import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { TRY_PER_DAY, TRY_PER_MINUTE, TryDesk } from "../worker/src/try.js";

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
    const body = JSON.parse(String(init.body)) as { tools: { name: string }[] };
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: body.tools[0]!.name, input: answers[n++ % answers.length] }], usage: { input_tokens: 1000, output_tokens: 100 } }));
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
