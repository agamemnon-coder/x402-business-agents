// The Claude meter on /try (cloud/src/try/presentMode.ts claudeMeter, stepNote), 21 Nov 2026. Max: "On /try it says
// 'No Claude call yet · code': it makes it look fake", and "6 calls at $0.0019 at the approved step: I think it uses
// more than we say". These pin the arithmetic from a known usage object to the agent's run row to the page's tally, and
// replay a recorded walk of the public /try (docs/runs/2026-11-21-phone-try/run-4.json, the engine's own events as the
// page read them) to the figures the engine recorded for it (summary.json: 17 requests, USD 0.003580 in the main tab).
import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent, type AgentTool } from "../src/agents/loop.js";
import { callCostMicros } from "../src/claude/pricing.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { openDb } from "../src/db/open.js";
import { publicEvent } from "../src/engine/events.js";
import { claudeCall, claudeMeter, presentExtra, stepNote } from "../cloud/src/try/presentMode.js";

type Ev = { seq: number; event: string; actor: string; fields: Record<string, unknown> };
const run4 = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-21-phone-try/run-4.json", import.meta.url), "utf8")) as { events: { main: Ev[] } };
const summary = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-21-phone-try/summary.json", import.meta.url), "utf8")) as { runs: { run: number; claude: { main_cost_usd_micros: number; calls: { tab: string; request_ids: string[] }[] } }[] };
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
/** The page's tally (takeCall): one entry per event claudeCall counts, `n` its requests, `cost` the engine's own. */
const tally = (events: Ev[]) => events.flatMap((e) => {
  const cc = claudeCall(e.event, e.fields);
  return cc ? [{ who: e.event === "agent.run" ? title(String(e.fields.agent)) : "Reader", n: cc.n, cost: Number(e.fields.cost_usd_micros), model: "Haiku 5.5" }] : [];
});

describe("the price of one call, from a known usage object (src/claude/pricing.ts, Anthropic's list price)", () => {
  it("prices a Haiku 5.5 call's input, output, cache reads and cache writes, rounded up to a micro-dollar", () => {
    // $0.10 input, $0.50 output, $0.01 cache read, $0.125 five-minute cache write, per million tokens (prompt up to 100,000).
    expect(callCostMicros("claude-haiku-5-5", { input: 1215, output: 89, cache_read: 0, cache_write: 0 })).toBe(166);
    expect(callCostMicros("claude-haiku-5-5", { input: 300, output: 120, cache_read: 2400, cache_write: 0 })).toBe(30 + 60 + 24);
    expect(callCostMicros("claude-haiku-5-5", { input: 300, output: 120, cache_read: 0, cache_write: 2400 })).toBe(30 + 60 + 300);
  });
});

describe("an agent's run row holds every call it made (src/agents/loop.ts)", () => {
  const tool: AgentTool<z.ZodType> = { name: "look", description: "Looks.", input: z.strictObject({}), run: async () => ({ text: "seen" }) };
  // Thinking tokens are part of output_tokens (the API's billed total), so they are priced with the output.
  const usage = [
    { input_tokens: 1400, output_tokens: 210, cache_read_input_tokens: 0, cache_creation_input_tokens: 2100 },
    { input_tokens: 380, output_tokens: 95, cache_read_input_tokens: 2100, cache_creation_input_tokens: 0 },
  ];
  it("sums each turn's own usage, one claude_ms per call, and a failed attempt retried is not a second call", async () => {
    const db = openDb(":memory:");
    let i = 0, attempts = 0;
    const replies = [
      { content: [{ type: "tool_use", id: "t1", name: "look", input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" },
    ];
    const client = { beta: { messages: { create: async () => {
      attempts++;
      if (attempts === 2) throw new Error("socket hang up"); // transient: retried once, nothing billed for it
      const k = i++;
      return { ...replies[k], model: "claude-haiku-5-5", _request_id: `req_meter${k}`, usage: usage[k] };
    } } } } as unknown as Anthropic;
    await runAgent(db, { agent: "checker", task: "t", model: "claude-haiku-5-5", system: "s", prompt: "p", tools: [tool], retryDelayMs: 0 }, client);
    const row = db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event = 'agent.run'").get() as Parameters<typeof publicEvent>[0];
    const p = JSON.parse(row.payload_json) as { cost_usd_micros: number; claude_calls: { cost_usd_micros: number; retried?: boolean }[] };
    const each = usage.map((u) => callCostMicros("claude-haiku-5-5", { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens })!);
    expect(each).toEqual([140 + 105 + 263, 38 + 48 + 21]);
    expect(p.claude_calls.map((c) => c.cost_usd_micros)).toEqual(each);
    expect(p.claude_calls[1]!.retried).toBe(true);
    expect(p.cost_usd_micros).toBe(each[0]! + each[1]!);
    // As the page reads it: two calls, the run's cost.
    const ev = publicEvent(row);
    expect(claudeCall(ev.event, ev.fields)).toEqual({ n: 2 });
    expect(ev.fields.cost_usd_micros).toBe(615);
  });
});

describe("a reading Claude answered but that was not used is still counted (src/claude/reader.ts)", () => {
  it("writes the refused answer's request id and cost in claude.fallback, and the page counts it as one call", async () => {
    const db = openDb(":memory:");
    const client = { beta: { messages: { parse: async (p: { model: string }) => ({ model: p.model, stop_reason: "refusal", stop_details: { category: null }, parsed_output: null, _request_id: "req_refused01",
      usage: { input_tokens: 1200, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) } } } as unknown as Anthropic;
    const reader = new ClaudeReader(db, client, Date.now, { act: "claude-haiku-5-5" });
    const out = await reader.ask({ task: "t", role: "act", actor: "treasury", schema: z.object({ ok: z.boolean() }), instruction: "i", document: "d" }, () => ({ ok: false }));
    expect(out.source).toBe("fallback");
    const row = db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event = 'claude.fallback'").get() as Parameters<typeof publicEvent>[0];
    const ev = publicEvent(row);
    expect(ev.fields).toMatchObject({ source: "fallback", cost_usd_micros: 122 });
    // The SDK reads _request_id off its own response; a stand-in has none, so the row says null and the page counts no call.
    expect(claudeCall("claude.fallback", { ...ev.fields, request_id: "req_refused01" })).toEqual({ n: 1 });
    expect(claudeCall("claude.fallback", { source: "fallback", model: "claude-haiku-5-5" })).toBeNull();
    expect(claudeCall("claude.fallback", { cost_usd_micros: 5 })).toBeNull();
  });
});

describe("the meter replays a recorded walk of the public /try to the engine's own figures", () => {
  const main = run4.events.main;
  const approved = main.find((e) => e.event === "proposal.approved")!.seq;
  const second = main.find((e) => e.event === "ap.received" && e.fields.amount === "1850.00")!;
  const firstSecondCall = main.find((e) => e.seq > 53 && e.event === "claude.read")!.seq;

  it("counts 17 calls, USD 0.0036, at the CFO's approval: every request the main tab's run made", () => {
    const m = claudeMeter(tally(main.filter((e) => e.seq <= approved)), "claude");
    const rec = summary.runs.find((r) => r.run === 4)!.claude;
    const requests = rec.calls.filter((c) => c.tab === "main").reduce((x, c) => x + c.request_ids.length, 0);
    expect(m.n).toBe(requests);
    expect(m.n).toBe(17);
    expect(m.micros).toBe(rec.main_cost_usd_micros);
    expect(m.head).toBe("$0.0036 · 17 Claude calls");
    expect(m.why).toBe("17 Claude calls: Reader 5, Treasury 4, Checker 4, Payer 4. Claude Haiku 5.5; each call priced from its own token usage (input, output and cache) at Anthropic's list price: $0.0036 in all.");
  });

  it("the EUR 1,850.00 invoice alone: 6 entries but 9 calls for USD 0.0019 (the reader's 3, two each for three agents)", () => {
    const own = tally(main.filter((e) => e.seq >= firstSecondCall && e.seq <= approved));
    expect(own.length).toBe(6);
    const m = claudeMeter(own, "claude");
    expect([m.n, m.micros, m.head]).toEqual([9, 1890, "$0.0019 · 9 Claude calls"]);
    expect(m.why.startsWith("9 Claude calls: Reader 3, Treasury 2, Checker 2, Payer 2.")).toBe(true);
    // The reading itself, the badge's figure: classify and read, both before the invoice was received.
    const reading = tally(main.filter((e) => e.seq >= firstSecondCall && e.seq < second.seq && e.event === "claude.read"));
    expect([claudeMeter(reading, "claude").n, claudeMeter(reading, "claude").micros]).toEqual([2, 255]);
  });
});

describe("never an absence: pending, Purser's rules, or the calls (Max, 21 Nov 2026)", () => {
  it("says Claude is next before its first call, and Purser's rules when code reads", () => {
    expect(claudeMeter([], "claude").head).toBe("Claude is next");
    expect(claudeMeter([], "").head).toBe("Claude is next");
    expect(claudeMeter([], "code").head).toBe("Purser's rules · no AI needed");
    expect(claudeMeter([{ who: "Reader", n: 1, cost: 87 }], "claude").head).toBe("$0.0001 · 1 Claude call");
  });
  it("names what decides every step: Invoice, Read, Check, Sign, Paid and the one-cent change", () => {
    const steps = ["invoice", "reading", "work", "workAlone", "workCash", "approve", "books", "booksAlone", "pay", "refused"];
    const live = steps.map((g) => stepNote(g, "claude", g === "invoice" ? 0 : 9));
    const code = steps.map((g) => stepNote(g, "code", 0));
    expect(live).toEqual([
      "Next: Claude reads the invoice you pick", "Claude is reading the invoice",
      "Read by Claude · Purser's rules check it · no AI needed for this check", "Read by Claude · Purser's rules check it · no AI needed for this check",
      "Purser's rules hold it · no AI needed for this check", "Your passkey signs · Purser's rules check it, no AI needed",
      "Purser's rules pay and book it · no AI needed", "Purser's rules pay and book it · no AI needed",
      "Purser's rules check the signature · no AI needed", "Purser's rules check the signature · no AI needed",
    ]);
    expect(code.slice(0, 3)).toEqual(["Purser's code reads it · no AI needed", "Purser's code reads the PDF · no AI needed", "Purser's rules check it · no AI needed for this check"]);
    expect(stepNote("reading", "claude", 0)).toBe("Claude is next: it reads the PDF");
    for (const t of [...live, ...code, claudeMeter([], "code").head, claudeMeter([], "claude").head]) expect(t).not.toMatch(/no claude|not asked|no model/i);
  });
  it("is the page's own function, and no page text says a Claude call is missing", () => {
    for (const kind of ["public", "present"] as const) {
      const { script } = presentExtra(kind);
      expect(script).toContain(`const claudeMeter=${claudeMeter.toString()};const stepNote=${stepNote.toString()};`);
      expect(script).not.toMatch(/no Claude call|No Claude call|Claude not asked|Not asked in this run/);
      expect(() => new Function(script)).not.toThrow();
    }
    // `npm run judge` serves the page from tsx, which wraps a named inner function in a helper (__name) the page lacks:
    // the functions the page runs as text name none (21 Nov 2026: the first claudeMeter did, and /try threw on judge).
    for (const f of [claudeMeter, stepNote, claudeCall]) expect(f.toString()).not.toMatch(/\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^()]*\)|\w+)\s*=>|\bfunction\s+\w+\s*\(|__name/);
  });
});
