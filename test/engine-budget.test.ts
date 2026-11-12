// Claude in the engine under hard ceilings (src/engine/budget.ts, the reader's options in src/claude/reader.ts). The
// Anthropic client runs on a stand-in fetch with canned answers: no request leaves the process, and no key is real.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeReader, MODELS } from "../src/claude/reader.js";
import { callCostMicros } from "../src/claude/pricing.js";
import { openDb, type DB } from "../src/db/open.js";
import { actionBudget, tryClaudeClient, worstCaseMicros } from "../src/engine/budget.js";

const Reading = z.object({ vendor: z.string(), total: z.string() });
const fallback = () => ({ vendor: "from the parser", total: "0.00" });
const ask = { task: "ap.read:test", role: "act" as const, actor: "treasury" as const, schema: Reading, instruction: "Read this invoice.", document: "Bergtex Textil GmbH, total EUR 1,850.00" };

interface Seen { model: string; max_tokens: number; chars: number }
/** A fetch that answers every call with a reading and the usage `usage(body)` says, and records what it was asked. */
function standIn(usage: (b: { max_tokens: number; chars: number }) => { input: number; output: number } = () => ({ input: 1200, output: 80 })) {
  const seen: Seen[] = [];
  let n = 0;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const body = (await req.json()) as { model: string; max_tokens: number };
    const chars = JSON.stringify(body).length;
    seen.push({ model: body.model, max_tokens: body.max_tokens, chars });
    const u = usage({ max_tokens: body.max_tokens, chars });
    return new Response(JSON.stringify({
      id: `msg_${++n}`, type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify({ vendor: "Bergtex Textil GmbH", total: "1850.00" }) }],
      usage: { input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json", "request-id": `req_stand_in_${n}` } });
  }) as typeof fetch;
  return { client: new Anthropic({ apiKey: "stand-in-not-a-key", fetch: f, maxRetries: 0 }), seen };
}
const rows = (db: DB) => db.prepare("SELECT event, payload_json FROM audit_log ORDER BY seq").all() as { event: string; payload_json: string }[];

describe("the reader's options for the engine (budget, maxTokens, announce)", () => {
  it("changes nothing without them: max_tokens 16,000 and no row before the call", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    const r = await new ClaudeReader(db, s.client).ask(ask, fallback);
    expect(r.source).toBe("claude");
    expect(s.seen[0]!.max_tokens).toBe(16_000);
    expect(rows(db).map((x) => x.event)).toEqual(["claude.read"]);
  });

  it("announces a call just before it is sent (role and model, never the prompt), and asks for no more than maxTokens", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    await new ClaudeReader(db, s.client, Date.now, {}, { announce: true, maxTokens: 4_000 }).ask(ask, fallback);
    expect(s.seen[0]!.max_tokens).toBe(4_000);
    const r = rows(db);
    expect(r.map((x) => x.event)).toEqual(["claude.asking", "claude.read"]);
    expect(JSON.parse(r[0]!.payload_json)).toEqual({ role: "read", model: MODELS.act });
  });

  it("counts what each call cost against the action's budget, and the reading's row carries model and cost", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    const budget = actionBudget(250_000);
    await new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000 }).ask(ask, fallback);
    const read = JSON.parse(rows(db).at(-1)!.payload_json) as { model: string; cost_usd_micros: number };
    // (request_id: the reader takes it from the parsed answer, which the SDK 1.3.0 leaves without it over a stand-in fetch.)
    expect(read).toMatchObject({ model: MODELS.act });
    expect(read.cost_usd_micros).toBe(callCostMicros(MODELS.act, { input: 1200, output: 80, cache_read: 0, cache_write: 0 }));
    expect(budget.left()).toBe(250_000 - read.cost_usd_micros);
  });

  it("does not send a call whose worst case is more than the action has left: the parser reads, and the rows say why", async () => {
    const db = openDb(":memory:");
    const s = standIn();
    const budget = actionBudget(worstCaseMicros(MODELS.act, 4_000, 10) - 1);
    const r = await new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000, announce: true }).ask(ask, fallback);
    expect(s.seen).toHaveLength(0);
    expect(r).toMatchObject({ source: "fallback", value: fallback() });
    const events = rows(db);
    expect(events.map((x) => x.event)).toEqual(["claude.capped", "claude.fallback"]);
    expect(JSON.parse(events[0]!.payload_json)).toMatchObject({ reason: "action_budget", model: MODELS.act });
  });

  it("never records more than the action's budget, even when every answer uses all it may", async () => {
    const db = openDb(":memory:");
    // The stand-in reports the most a call could use: the whole prompt and every token of max_tokens.
    const s = standIn((b) => ({ input: Math.ceil(b.chars / 3), output: b.max_tokens }));
    const reserved = 60_000;
    const budget = actionBudget(reserved);
    const reader = new ClaudeReader(db, s.client, Date.now, {}, { budget, maxTokens: 4_000 });
    for (let i = 0; i < 10; i++) await reader.ask({ ...ask, task: `ap.read:${i}` }, fallback);
    const spent = rows(db).filter((x) => x.event === "claude.read").reduce((a, x) => a + (JSON.parse(x.payload_json) as { cost_usd_micros: number }).cost_usd_micros, 0);
    expect(s.seen.length).toBeGreaterThan(0);
    expect(s.seen.length).toBeLessThan(10);
    expect(spent).toBeLessThanOrEqual(reserved);
  });

  it("counts a call that failed after it was sent at its worst case (it may have been billed)", async () => {
    const db = openDb(":memory:");
    const f = (async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "overloaded" } }), { status: 529 })) as typeof fetch;
    const budget = actionBudget(1_000_000);
    const r = await new ClaudeReader(db, new Anthropic({ apiKey: "stand-in-not-a-key", fetch: f, maxRetries: 0 }), Date.now, {}, { budget, maxTokens: 4_000 }).ask(ask, fallback);
    expect(r.source).toBe("fallback");
    expect(budget.left()).toBeLessThan(1_000_000);
    expect(1_000_000 - budget.left()).toBeLessThanOrEqual(worstCaseMicros(MODELS.act, 4_000, 100_000));
  });

  it("bounds a call's worst case from the price list, and cannot bound a model it has no price for", () => {
    expect(worstCaseMicros(MODELS.act, 4_000, 3_000)).toBeGreaterThan(callCostMicros(MODELS.act, { input: 1_000, output: 4_000, cache_read: 0, cache_write: 0 })!);
    expect(worstCaseMicros("claude-unknown", 1, 1)).toBe(Infinity);
  });

  it("gives a visitor's company a client that waits 30 seconds at most and retries nothing itself", () => {
    const c = tryClaudeClient("stand-in-not-a-key");
    expect(c.timeout).toBe(30_000);
    expect(c.maxRetries).toBe(0);
  });
});
