// D19 block 1, proof per decision: every Claude call in an agent's run records the API's request id, the model, the
// tokens and cache hits, the latency and the cost; a transient API failure gets one retry, then a labelled fallback;
// an agent over its hourly Claude budget makes no call. Breaks if a call's request id is dropped from the trace, if a
// rate limit falls back without one retry, if a non-transient failure is retried, or if the cap is not enforced.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { AGENT_HOURLY_CAP_MICROS, runAgent } from "../src/agents/loop.js";

const reply = (id: string, tool?: string) => Object.defineProperty({
  content: tool ? [{ type: "tool_use", id: "t1", name: tool, input: {} }] : [{ type: "text", text: "done" }],
  stop_reason: tool ? "tool_use" : "end_turn", model: "claude-haiku-5-5",
  usage: { input_tokens: 1200, output_tokens: 90, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
}, "_request_id", { value: id, enumerable: false });

function client(script: (object | Error)[]) {
  let i = 0;
  let calls = 0;
  return { calls: () => calls, c: { beta: { messages: { create: async () => { calls++; const s = script[i++]; if (s instanceof Error) throw s; return s; } } } } as unknown as Anthropic };
}
const spec = { agent: "sourcing" as const, task: "t", model: "claude-haiku-5-5", system: "s", prompt: "p", retryDelayMs: 0,
  tools: [{ name: "look", description: "d", input: z.strictObject({}), run: async () => ({ text: "ok" }) }] };
const runRow = (db: ReturnType<typeof openDb>) => JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string }).payload_json);

describe("proof per agent decision", () => {
  it("records each call's request id, tokens, cache hits, latency and cost, and the request id on each tool row", async () => {
    const db = openDb(":memory:");
    const { c } = client([reply("req_A", "look"), reply("req_B")]);
    const r = await runAgent(db, spec, c);
    expect(r.status).toBe("done");
    const row = runRow(db);
    expect(row.request_ids).toEqual(["req_A", "req_B"]);
    expect(row.claude_calls[0]).toMatchObject({ request_id: "req_A", model: "claude-haiku-5-5", tokens: { input: 1200, output: 90, cache_read: 1000 } });
    expect(row.claude_calls[0].cost_usd_micros).toBeGreaterThan(0);
    const tool = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.tool'").get() as { payload_json: string }).payload_json);
    expect(tool.request_id).toBe("req_A");
  });

  it("retries a rate limit once, then goes on; a second failure falls back, labelled", async () => {
    const db = openDb(":memory:");
    const limited = () => new Anthropic.RateLimitError(429, { error: { type: "rate_limit_error" } }, "rate limited", new Headers());
    const ok = client([limited(), reply("req_C")]);
    expect((await runAgent(db, spec, ok.c)).status).toBe("done");
    expect(ok.calls()).toBe(2);
    expect(runRow(db).claude_calls[0]).toMatchObject({ request_id: "req_C", retried: true });
    const bad = client([limited(), limited()]);
    const r = await runAgent(db, spec, bad.c);
    expect(r).toMatchObject({ status: "unavailable", note: expect.stringMatching(/after one retry/) });
    expect(bad.calls()).toBe(2);
  });

  it("does not retry a failure that is not transient", async () => {
    const db = openDb(":memory:");
    const bad = client([new Anthropic.BadRequestError(400, { error: { type: "invalid_request_error" } }, "bad", new Headers())]);
    expect((await runAgent(db, spec, bad.c)).status).toBe("unavailable");
    expect(bad.calls()).toBe(1);
  });

  it("makes no call over the hourly Claude budget, and warns once at 80 %", async () => {
    const db = openDb(":memory:");
    const cap = AGENT_HOURLY_CAP_MICROS.sourcing!;
    audit(db, "sourcing", "agent.run", "x", { cost_usd_micros: Math.ceil(cap * 0.85) });
    const a = client([reply("req_D")]);
    expect((await runAgent(db, spec, a.c)).status).toBe("done");
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'agent.cost_warning'").get()).toEqual({ n: 1 });
    audit(db, "sourcing", "agent.run", "x", { cost_usd_micros: cap });
    const b = client([reply("req_E")]);
    expect(await runAgent(db, spec, b.c)).toMatchObject({ status: "unavailable", note: expect.stringMatching(/cost cap/) });
    expect(b.calls()).toBe(0);
  });
});
