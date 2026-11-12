// The agents' events as a page may show them (src/engine/events.ts): each new event against a row with the payload the
// product really writes (src/agents/loop.ts, src/ap/checkerAgent.ts recordChecked, src/ap/payerAgent.ts recordProposed
// on branch ap-agents-1112, read 12 November), and nothing beyond its short list of fields. No IBAN, key or full
// account number reaches a page; a tool's input never does.
import { describe, expect, it } from "vitest";
import { publicEvent, type EventRow } from "../src/engine/events.js";

const IBAN = "DE89 3704 0044 0532 0130 00";
const row = (event: string, payload: Record<string, unknown>, actor = "checker", subject: string | null = "ap.check.AP-0001"): EventRow =>
  ({ seq: 7, ts: "2026-11-13T10:00:00.000Z", actor, event, subject, payload_json: JSON.stringify(payload) });
const fieldsOf = (event: string, payload: Record<string, unknown>) => publicEvent(row(event, payload)).fields;

describe("the agents' events on a page", () => {
  it("claude.asking: who asks which model, and nothing of the prompt", () => {
    expect(fieldsOf("claude.asking", { role: "read", model: "claude-sonnet-4-5", prompt: `pay ${IBAN}` })).toEqual({ role: "read", model: "claude-sonnet-4-5" });
    expect(fieldsOf("claude.asking", { agent: "checker", model: "claude-haiku-4-5", turn: 2, messages: [IBAN] })).toEqual({ agent: "checker", model: "claude-haiku-4-5", turn: 2 });
  });

  it("agent.tool: the tool's name and the first sentence of its answer, masked and short; never its input", () => {
    const f = fieldsOf("agent.tool", {
      agent: "checker", model: "claude-haiku-4-5", request_id: "req_011", tool: "read_invoice", input: { invoice_id: "AP-0001", iban: IBAN },
      result: `Bergtex Textil GmbH asks EUR 1,850.00 to ${IBAN} by 16 November. The supplier file holds the same account. ${"x".repeat(300)}`, ms: 12, turn: 1, blocked_by: "schema",
    });
    expect(f).toEqual({ agent: "checker", tool: "read_invoice", turn: 1, model: "claude-haiku-4-5", request_id: "req_011", ms: 12, answer: "Bergtex Textil GmbH asks EUR 1,850.00 to ****3000 by 16 November." });
    expect(JSON.stringify(f)).not.toMatch(/3704|0532|AP-0001"|iban/);
  });

  it("agent.tool: an answer of one long sentence is cut at 160 characters", () => {
    const answer = fieldsOf("agent.tool", { agent: "payer", tool: "plan", turn: 1, model: "m", request_id: null, ms: 1, result: "a".repeat(400) }).answer as string;
    expect(answer.length).toBeLessThanOrEqual(160);
    expect(answer.endsWith("…")).toBe(true);
  });

  it("agent.said: the model's words, masked, at most 600 characters", () => {
    const f = fieldsOf("agent.said", { agent: "checker", model: "claude-haiku-4-5", request_id: "req_012", turn: 2, text: `The bank account ${IBAN} matches; account 123456789012 is new. key sk-ant-api03-abcdefghijklmnop. ${"y".repeat(800)}` });
    expect(Object.keys(f).sort()).toEqual(["agent", "model", "text", "turn"]);
    const text = f.text as string;
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).toContain("****3000");
    expect(text).toContain("****9012");
    expect(text).not.toMatch(/3704|12345678|sk-ant-api03/);
    // A date and an amount stay readable.
    expect(fieldsOf("agent.said", { agent: "payer", turn: 1, model: "m", text: "Pay EUR 1,850.00 on 2026-11-16." }).text).toBe("Pay EUR 1,850.00 on 2026-11-16.");
  });

  it("masks an IBAN or an account number however it is written: hyphens, non-breaking or double spaces, dots", () => {
    for (const text of ["IBAN is DE89-3704-0044-0532-0130-00. ok", "IBAN is DE89\u00a03704\u00a00044\u00a00532\u00a00130\u00a000. ok", "IBAN is DE89  3704  0044  0532  0130  00. ok", "IBAN is DE89370400440532013000. ok", "IBAN is de89 3704 0044 0532 0130 00. ok"]) {
      expect(fieldsOf("agent.said", { agent: "a", turn: 1, model: "m", text }).text).toBe("IBAN is ****3000. ok");
    }
    for (const text of ["acct 1234-5678-9012-3456", "acct 1234 5678 9012 3456", "acct 1234.5678.9012.3456", "acct 1234\u00a05678\u00a09012\u00a03456"]) {
      expect(fieldsOf("agent.said", { agent: "a", turn: 1, model: "m", text }).text).toBe("acct ****3456");
    }
    // A date and an amount are not account numbers.
    expect(fieldsOf("agent.said", { agent: "a", turn: 1, model: "m", text: "Due 2026-11-16, EUR 1,850.00 (16.11.2026)." }).text).toBe("Due 2026-11-16, EUR 1,850.00 (16.11.2026).");
  });

  it("agent.nudged: which agent, and why, masked", () => {
    expect(fieldsOf("agent.nudged", { agent: "checker", model: "claude-haiku-4-5", reason: `no decision yet for ${IBAN}` })).toEqual({ agent: "checker", reason: "no decision yet for ****3000" });
  });

  it("agent.run: the run's model, outcome, turns, cost and time; never its tools' inputs or its words", () => {
    const f = fieldsOf("agent.run", {
      agent: "checker", model: "claude-haiku-4-5", status: "done", turns: 3, tools: ["read_invoice", "decide"], blocked: [], said: `paid to ${IBAN}`,
      cost_usd_micros: 4210, latency_ms: 2100, from_seq: 4, run_id: "run_1", tokens: { input: 1000, output: 200 }, claude_ms: [700], claude_calls: [], request_ids: ["req_011"],
    });
    // Task A6: with the request id of the call that gave the answer.
    expect(f).toEqual({ agent: "checker", model: "claude-haiku-4-5", status: "done", turns: 3, cost_usd_micros: 4210, latency_ms: 2100, request_id: "req_011" });
  });

  it("ap.checker_decided: who decided and what code required; the codes of code's findings, never their words; the agent's reason and code's why, masked (task A6)", () => {
    const f = fieldsOf("ap.checker_decided", {
      invoice_id: "AP-0001", source: "claude", model: "claude-haiku-4-5", action: "hold", reason: `the account ${IBAN} is new`, agent_findings: [{ code: "x", detail: IBAN }],
      code_findings: [{ code: "bank_details_changed", level: "review" }, { code: "possible_duplicate", level: "review" }],
      outcome: "hold", overridden_by: null, overridden: false, code_requires: "hold", why: `code holds ${IBAN}`, status: "needs_review",
      task: "ap.check.AP-0001", run_id: "run_1", request_ids: ["req_011"], origin: { actor: "agent" },
    });
    expect(f).toEqual({ source: "claude", model: "claude-haiku-4-5", action: "hold", outcome: "hold", overridden: false, overridden_by: null, code_requires: "hold", codes: "bank_details_changed,possible_duplicate",
      reason: "the account ****3000 is new", enforced: "code holds ****3000", request_id: "req_011" });
  });

  it("ap.payer_proposed: the proposal's rail, day and currency, and whether code overrode it; never the terms", () => {
    const f = fieldsOf("ap.payer_proposed", {
      invoice_id: "AP-0001", invoice_no: "BTX-2026-21", source: "fallback", model: null, rail: "airwallex", pay_on: "2026-11-16", pay_currency: "EUR", reason: `to ${IBAN}`,
      outcome: "pay_today", overridden_by: "code", overridden: true, why: "due soon", next: "file", terms: { iban: IBAN }, task: "ap.pay.AP-0001", run_id: "r", request_ids: [], origin: null,
    }, );
    expect(f).toEqual({ source: "fallback", model: null, rail: "airwallex", pay_on: "2026-11-16", pay_currency: "EUR", outcome: "pay_today", overridden: true, overridden_by: "code", reason: "to ****3000", enforced: "due soon" });
  });

  it("claude.capped: the reason, one of the known ones; anything else is left out", () => {
    for (const reason of ["switch_off", "no_key", "action_budget", "company_cap", "pool_day_cap", "address_cap", "all_time_cap", "busy"]) {
      expect(fieldsOf("claude.capped", { reason, scope: "co:t_x" })).toEqual({ reason });
    }
    expect(fieldsOf("claude.capped", { reason: `over ${IBAN}` })).toEqual({});
  });

  it("keeps the subject of an event on the list, and the actor as written", () => {
    const e = publicEvent(row("agent.run", { agent: "payer", model: "m", status: "done", turns: 1, cost_usd_micros: 1, latency_ms: 1 }, "payer", "ap.pay.AP-0001"));
    expect(e).toMatchObject({ seq: 7, actor: "payer", event: "agent.run", subject: "ap.pay.AP-0001" });
  });
});
