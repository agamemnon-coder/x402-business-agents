// The agent loop: Claude picks tools, code runs them through its own checks. A fake client stands in for the API
// (tests never call it). What matters: a tool only runs on input that fits its schema, a check that blocks is
// logged with its name, every call lands in the audit chain without secrets, and any failure leaves the caller's
// deterministic fallback in charge.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { agentsOn, runAgent, type AgentTool } from "../src/agents/loop.js";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };
type Reply = { content: Block[]; stop_reason: string; stop_details?: unknown };

/** A client whose answers come from `script`, one per call; it records what it was sent. */
function fake(script: (Reply | Error)[]): { client: Anthropic; sent: unknown[] } {
  const sent: unknown[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          sent.push(JSON.parse(JSON.stringify(params)));
          const r = script[i++];
          if (!r) throw new Error("the fake ran out of answers");
          if (r instanceof Error) throw r;
          return { ...r, model: "claude-test", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const add: AgentTool<z.ZodObject<{ a: z.ZodNumber; b: z.ZodNumber }>> = {
  name: "add", description: "Adds two numbers.", input: z.strictObject({ a: z.number(), b: z.number() }),
  run: async ({ a, b }) => ({ text: String(a + b) }),
};
const spec = (tools: AgentTool<z.ZodType>[], extra: Partial<Parameters<typeof runAgent>[1]> = {}) =>
  ({ agent: "treasury" as const, task: "test", model: "claude-test", system: "You add numbers.", prompt: "What is 2 + 3?", tools, ...extra });
const use = (id: string, name: string, input: unknown): Reply => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" });
const say = (text: string): Reply => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });

describe("the agent loop", () => {
  it("is unavailable without a client, and runs no tool", async () => {
    const db = openDb(":memory:");
    let ran = false;
    const r = await runAgent(db, spec([{ ...add, run: async () => { ran = true; return { text: "" }; } }]), null);
    expect(r.status).toBe("unavailable");
    expect(ran).toBe(false);
  });

  it("runs a tool Claude asks for, sends the result back, and finishes with Claude's words", async () => {
    const db = openDb(":memory:");
    const { client, sent } = fake([use("t1", "add", { a: 2, b: 3 }), say("2 + 3 is 5.")]);
    const r = await runAgent(db, spec([add]), client);
    expect(r.status).toBe("done");
    expect(r.calls).toEqual([{ tool: "add", input: { a: 2, b: 3 }, text: "5" }]);
    expect(r.text).toBe("2 + 3 is 5.");
    const second = sent[1] as { messages: { role: string; content: unknown }[] };
    expect(second.messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "5" }] });
    const rows = db.prepare("SELECT event FROM audit_log ORDER BY seq").all() as { event: string }[];
    expect(rows.map((x) => x.event)).toEqual(["agent.tool", "agent.run"]);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("sends each tool as a strict schema", async () => {
    const db = openDb(":memory:");
    const { client, sent } = fake([say("done")]);
    await runAgent(db, spec([add]), client);
    const tools = (sent[0] as { tools: { name: string; strict: boolean; input_schema: { additionalProperties: boolean } }[] }).tools;
    expect(tools[0]).toMatchObject({ name: "add", strict: true, input_schema: { additionalProperties: false } });
  });

  it("never runs a tool on input that does not fit its schema; Claude gets the reason", async () => {
    const db = openDb(":memory:");
    let ran = 0;
    const counting = { ...add, run: async (i: { a: number; b: number }) => { ran++; return add.run(i); } };
    const { client, sent } = fake([use("t1", "add", { a: "2", b: 3 }), say("I could not add them.")]);
    const r = await runAgent(db, spec([counting]), client);
    expect(ran).toBe(0);
    expect(r.calls[0]).toMatchObject({ tool: "add", blocked: "schema" });
    const result = (sent[1] as { messages: { content: { is_error?: boolean; content: string }[] }[] }).messages.at(-1)!.content[0]!;
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/does not fit/);
  });

  it("refuses a tool it does not have", async () => {
    const db = openDb(":memory:");
    const { client } = fake([use("t1", "pay_anyone", { to: "0xdead" }), say("ok")]);
    const r = await runAgent(db, spec([add]), client);
    expect(r.calls[0]).toMatchObject({ tool: "pay_anyone", blocked: "unknown tool" });
  });

  it("logs which check blocked a call", async () => {
    const db = openDb(":memory:");
    const guarded: AgentTool<z.ZodType> = { ...add, name: "refund", run: async () => ({ text: "refused: over the mandate's cap", blocked: "mandate cap" }) };
    const { client } = fake([use("t1", "refund", { a: 1, b: 1 }), say("It was refused.")]);
    const r = await runAgent(db, spec([guarded]), client);
    expect(r.calls[0]).toMatchObject({ blocked: "mandate cap" });
    const row = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.tool'").get() as { payload_json: string };
    expect(JSON.parse(row.payload_json)).toMatchObject({ tool: "refund", blocked_by: "mandate cap" });
  });

  it("stops at a final tool without asking Claude again", async () => {
    const db = openDb(":memory:");
    const submit: AgentTool<z.ZodType> = { ...add, name: "submit", run: async () => ({ text: "accepted", final: true }) };
    const { client, sent } = fake([use("t1", "submit", { a: 1, b: 1 })]);
    const r = await runAgent(db, spec([submit]), client);
    expect(r.status).toBe("done");
    expect(sent).toHaveLength(1);
  });

  it("gives up after its turn limit, and says so", async () => {
    const db = openDb(":memory:");
    const { client } = fake([use("t1", "add", { a: 1, b: 1 }), use("t2", "add", { a: 1, b: 1 }), use("t3", "add", { a: 1, b: 1 })]);
    const r = await runAgent(db, spec([add], { maxTurns: 2 }), client);
    expect(r.status).toBe("incomplete");
  });

  it("is unavailable when the API fails or refuses", async () => {
    const db = openDb(":memory:");
    expect((await runAgent(db, spec([add]), fake([new Error("socket hang up")]).client)).status).toBe("unavailable");
    const refused = await runAgent(db, spec([add]), fake([{ content: [], stop_reason: "refusal", stop_details: { category: "cyber" } }]).client);
    expect(refused).toMatchObject({ status: "unavailable", note: expect.stringMatching(/refused/) });
  });

  it("keeps secrets out of the audit log", async () => {
    const db = openDb(":memory:");
    const secret = "https://rpc-testnet.metalntwx.com/v1/abcdefghijklmnopqrstuvwxyz";
    const echo: AgentTool<z.ZodType> = { name: "note", description: "Notes text.", input: z.strictObject({ text: z.string() }), run: async () => ({ text: `noted ${secret}` }) };
    const { client } = fake([use("t1", "note", { text: `call ${secret}` }), say(`done ${secret}`)]);
    await runAgent(db, spec([echo]), client);
    const all = (db.prepare("SELECT payload_json FROM audit_log").all() as { payload_json: string }[]).map((r) => r.payload_json).join("\n");
    expect(all).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("keeps secrets out of the prompt it sends", async () => {
    const db = openDb(":memory:");
    const { client, sent } = fake([say("ok")]);
    await runAgent(db, spec([add], { prompt: "see https://rpc-testnet.metalntwx.com/v1/abcdefghijklmnopqrstuvwxyz" }), client);
    expect(JSON.stringify(sent[0])).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("counts what the run cost, for the dashboard", async () => {
    const db = openDb(":memory:");
    const { client } = fake([use("t1", "add", { a: 2, b: 3 }), say("5")]);
    const r = await runAgent(db, spec([add], { model: "claude-haiku-5-5" }), client);
    expect(r.turns).toBe(2);
    const run = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run'").get() as { payload_json: string }).payload_json);
    expect(run).toMatchObject({ agent: "treasury", status: "done", turns: 2, tools: ["add"] });
    expect(typeof run.latency_ms).toBe("number");
  });

  it("decides nothing unless KIT11_AGENTS=on: off, every flow runs code's fixed decisions", () => {
    expect(agentsOn({})).toBe(false);
    expect(agentsOn({ KIT11_AGENTS: "1" })).toBe(false);
    expect(agentsOn({ KIT11_AGENTS: "on" })).toBe(true);
  });
});
