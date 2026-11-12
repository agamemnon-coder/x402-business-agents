// SPIKE probe 5: the Anthropic SDK, the repository's reader (src/claude/reader.ts) and its agent loop (src/agents/loop.ts)
// inside a SQLite-backed Durable Object. NO API call is made: the SDK is given a stand-in fetch with canned answers.
import { DurableObject } from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import schemaSql from "../../../src/db/schema.sql";
import { runAgent, type AgentTool } from "../../../src/agents/loop.js";
import { verifyAuditChain } from "../../../src/audit/log.js";
import { ClaudeReader, MODELS, claudeClient } from "../../../src/claude/reader.js";
import type { DB } from "../../../src/db/open.js";
import { currentOrigin } from "../../../src/provenance/origin.js";
import { miniDb, type DoCtx } from "./_miniDb.js";
import { json, steps } from "./_util.js";

/** A fetch that answers from a script and records what it was asked; nothing leaves the isolate. */
function scripted(answers: unknown[]) {
  const seen: { url: string; model: unknown; betas: string | null; hasKeyHeader: boolean; tools: number; stream: unknown }[] = [];
  let i = 0;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    const body = (await req.clone().json().catch(() => null)) as { model?: string; tools?: unknown[]; stream?: unknown } | null;
    seen.push({ url: req.url, model: body?.model, betas: req.headers.get("anthropic-beta"), hasKeyHeader: req.headers.has("x-api-key"), tools: body?.tools?.length ?? 0, stream: body?.stream ?? false });
    const answer = answers[Math.min(i++, answers.length - 1)];
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json", "request-id": `req_spike_${i}` } });
  }) as typeof fetch;
  return { f, seen };
}
const message = (model: string, content: unknown[], stop_reason: string) => ({
  id: "msg_spike", type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

export class Engine extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const { out, step } = steps(req);
    const ctx = (this as unknown as { ctx: DoCtx }).ctx;
    // The engine's own audit_log table and its append-only triggers, cut from src/db/schema.sql (bundled as text).
    const ddl = /CREATE TABLE IF NOT EXISTS audit_log \([\s\S]*?audit_log is append-only'\); END;\s*CREATE TRIGGER[\s\S]*?END;/.exec(schemaSql)?.[0] ?? "";
    await step("audit_log_ddl_from_schema_sql", () => { ctx.storage.sql.exec(ddl); return { ddl_chars: ddl.length, schema_sql_chars: schemaSql.length }; });
    const db = miniDb(ctx) as unknown as DB;

    await step("sdk_constructs", () => {
      const c = new Anthropic({ apiKey: "spike-not-a-key", fetch: scripted([]).f, maxRetries: 0 });
      return { hasBetaMessages: typeof c.beta.messages.create === "function", hasParse: typeof c.beta.messages.parse === "function", withOptions: typeof c.withOptions === "function" };
    });
    await step("claudeClient_from_process_env", () => ({ client: claudeClient() !== null, keyVisibleInProcessEnv: typeof process.env.KIT11_ANTHROPIC_API_KEY === "string" }));

    // The reader: one structured call (beta.messages.parse with a zod output format), checked and audited by engine code.
    await step("reader_ask_structured", async () => {
      const Reading = z.object({ vendor: z.string(), invoice_no: z.string(), total: z.string() });
      const s = scripted([message(MODELS.act, [{ type: "text", text: JSON.stringify({ vendor: "Zeeland Verpakkingen B.V. (test)", invoice_no: "ZV-5001", total: "4.84" }) }], "end_turn")]);
      const reader = new ClaudeReader(db, new Anthropic({ apiKey: "spike-not-a-key", fetch: s.f, maxRetries: 0 }));
      const r = await reader.ask({ task: "ap.read", role: "act", actor: "claude", schema: Reading, instruction: "Read this invoice.", document: "Factuurnummer: ZV-5001" }, () => ({ vendor: "", invoice_no: "", total: "" }));
      const row = db.prepare("SELECT event, payload_json FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { event: string; payload_json: string };
      const p = JSON.parse(row.payload_json) as { request_id: string; cost_usd_micros: number; model: string };
      return { source: r.source, value: r.value, model: r.model, asked: s.seen, audit: { event: row.event, request_id: p.request_id, cost_usd_micros: p.cost_usd_micros } };
    });
    await step("reader_falls_back_on_wrong_shape", async () => {
      const s = scripted([message(MODELS.act, [{ type: "text", text: JSON.stringify({ vendor: 7 }) }], "end_turn")]);
      const reader = new ClaudeReader(db, new Anthropic({ apiKey: "spike-not-a-key", fetch: s.f, maxRetries: 0 }));
      const r = await reader.ask({ task: "ap.read", role: "act", actor: "claude", schema: z.object({ vendor: z.string() }), instruction: "Read.", document: "x" }, () => ({ vendor: "from the parser" }));
      return { source: r.source, note: r.note, value: r.value };
    });

    // The agent loop: Claude asks for a tool, code runs it (with the run's origin in force), Claude finishes.
    await step("agent_loop_one_tool_use", async () => {
      let originInTool: unknown = "not run";
      const balance: AgentTool<z.ZodType> = {
        name: "read_balance", description: "The balance of one currency account.", input: z.object({ currency: z.string() }),
        run: async (input: { currency: string }) => { await new Promise((r) => setTimeout(r, 1)); originInTool = currentOrigin(); return { text: `${input.currency} 1,250.00 available` }; },
      } as AgentTool<z.ZodType>;
      const s = scripted([
        message(MODELS.act, [{ type: "text", text: "I will check the balance first." }, { type: "tool_use", id: "toolu_spike_1", name: "read_balance", input: { currency: "EUR" } }], "tool_use"),
        message(MODELS.act, [{ type: "text", text: "EUR 1,250.00 is available; the invoice of EUR 4.84 can be paid." }], "end_turn"),
      ]);
      const run = await runAgent(db, { agent: "treasury", task: "spike.loop", model: MODELS.act, system: "You are the treasury agent.", prompt: "Can we pay ZV-5001?", tools: [balance], retryDelayMs: 0 }, new Anthropic({ apiKey: "spike-not-a-key", fetch: s.f, maxRetries: 0 }));
      const events = (db.prepare("SELECT event FROM audit_log ORDER BY seq").all() as { event: string }[]).map((r) => r.event);
      return { status: run.status, turns: run.turns, calls: run.calls, text: run.text, costMicros: run.costMicros, originInTool, apiCalls: s.seen.length, secondCallHadTools: s.seen[1]?.tools, events };
    });
    await step("agent_loop_tool_input_refused_by_schema", async () => {
      const t: AgentTool<z.ZodType> = { name: "read_balance", description: "x", input: z.object({ currency: z.enum(["EUR", "USD"]) }), run: async () => ({ text: "never" }) } as AgentTool<z.ZodType>;
      const s = scripted([
        message(MODELS.act, [{ type: "tool_use", id: "toolu_spike_2", name: "read_balance", input: { currency: "XXX" } }], "tool_use"),
        message(MODELS.act, [{ type: "text", text: "Stopped." }], "end_turn"),
      ]);
      const run = await runAgent(db, { agent: "treasury", task: "spike.refusal", model: MODELS.act, system: "s", prompt: "p", tools: [t], retryDelayMs: 0 }, new Anthropic({ apiKey: "spike-not-a-key", fetch: s.f, maxRetries: 0 }));
      return { status: run.status, blocked: run.calls.map((c) => c.blocked) };
    });
    await step("audit_chain_verifies_and_is_append_only", () => {
      const chain = verifyAuditChain(db);
      let refused = "";
      try { ctx.storage.sql.exec("UPDATE audit_log SET actor = 'x' WHERE seq = 1"); refused = "NOT refused"; } catch (e) { refused = String((e as Error).message).slice(0, 80); }
      return { chain, update_refused: refused };
    });
    return json(out);
  }
}

export default {
  fetch(req: Request, env: { ENGINE: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }): Promise<Response> {
    return env.ENGINE.get(env.ENGINE.idFromName("t_probe")).fetch(req);
  },
};
