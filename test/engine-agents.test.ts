// Task A6: the payables agents in the cloud engine (src/engine/host.ts). The Checker decides on an invoice as it is read,
// the Coder codes it before its accrual is booked, and the Payer proposes on the engine's plan when the CFO opens Pay;
// all within the action's reservation (src/engine/budget.ts budgetedClient), code enforcing every boundary. Claude is a
// stand-in that plays each agent by its tools: no request leaves the process. Breaks if an agent's decision is not in
// the events with its request id, if the switch-off path stops writing code's labelled fallback, if a call is sent
// whose worst case does not fit the action, or if the status says "live" while Claude may not be asked.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { useDocStore } from "../src/ap/docStore.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { openDb, type DB } from "../src/db/open.js";
import { actionBudget, budgetedClient, type ClaudeAccess, type CappedReason } from "../src/engine/budget.js";
import { publicEvent, type EventRow } from "../src/engine/events.js";
import { EngineHost, parserOnly } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { eventLine } from "../cloud/src/tryEvents.js";

type Block = { type: "tool_use"; id: string; name: string; input: unknown } | { type: "text"; text: string };
interface Req { model: string; max_tokens: number; tools?: { name: string }[]; messages: { role: string; content: unknown }[] }

/** The last tool results the agent got, as text: the stand-in reads them like the model would. */
const lastResults = (r: Req): string => {
  const last = r.messages.at(-1)?.content;
  return Array.isArray(last) ? last.map((b: { content?: unknown }) => (typeof b.content === "string" ? b.content : "")).join("\n") : "";
};

/**
 * Claude, stood in: by the tools it is handed, it plays the Checker (looks the supplier up, then decides to pay), the
 * Coder (reads the lines and the VAT arithmetic, then codes every line on the rate that reproduces the VAT) or the
 * Payer (reads the rails and the due date, then proposes the first rail on the due date's today). Each answer carries
 * a request id.
 */
function standInClaude() {
  const seen: Req[] = [];
  let n = 0;
  const create = async (r: Req) => {
    seen.push(r);
    const id = `req_a6_${++n}`;
    const tools = new Set((r.tools ?? []).map((t) => t.name));
    const turn = r.messages.filter((m) => m.role === "assistant").length;
    const use = (name: string, input: unknown): Block => ({ type: "tool_use", id: `tu_${n}_${name}`, name, input });
    let content: Block[];
    if (tools.has("decide")) {
      content = turn === 0 ? [use("supplier_on_file", {})] : [use("decide", { action: "pay", reason: "Bergtex is on file and the bank details match; the totals add up.", findings: [] })];
    } else if (tools.has("code_invoice")) {
      if (turn === 0) content = [use("invoice_lines", {}), use("vat_codes", {})];
      else {
        const seenText = lastResults(r);
        const lines = [...new Set([...seenText.matchAll(/\bline (\d+)\b/gi)].map((m) => Number(m[1])))];
        // The first purchase code code does not refuse for this invoice; none: no VAT code (a person books the VAT).
        const code = seenText.split("\n").map((l) => /^(P\w+): (?!.*Refused|.*refused)/.exec(l)?.[1]).find(Boolean) ?? null;
        content = [use("code_invoice", { lines: (lines.length ? lines : [1]).map((line_no) => ({ line_no, account: "6200", vat_code: code, cost_centre: null })), reason: "Goods from Bergtex, as before; the VAT is 21% of the net." })];
      }
    } else if (tools.has("propose_payment")) {
      if (turn === 0) content = [use("supplier_rails", {}), use("due_date", {}), use("fx_quote", {})];
      else {
        const t = lastResults(r);
        const rail = /\bbank_swift\b/.test(t) && !/\bbank_local\b/.test(t) ? "bank_swift" : "bank_local";
        const today = /\btoday is (\d{4}-\d{2}-\d{2})/i.exec(t)?.[1] ?? /(\d{4}-\d{2}-\d{2})/.exec(t)?.[1] ?? new Date().toISOString().slice(0, 10);
        // The locked quote's currency when there is one (the engine plans the conversion when EUR alone would go under its floor).
        const sells = /\bsells? ([A-Z]{3})\b/.exec(t)?.[1] ?? /\bfrom ([A-Z]{3})\b/.exec(t)?.[1];
        const from = sells && sells !== "EUR" ? sells : "EUR";
        content = [use("propose_payment", { rail, pay_on: today, pay_currency: from, reason: `Pay today from ${from} on the locked quote, so every balance stays above its floor.` })];
      }
    } else {
      content = [{ type: "text", text: "nothing to do" }];
    }
    return { id: `msg_${n}`, _request_id: id, type: "message", role: "assistant", model: r.model, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", content,
      usage: { input_tokens: 1500, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, seen };
}

/** Claude access as the cloud gives it (cloud/src/engine/claudeAccess.ts): the reader parses, the agents ask the stand-in within the action's budget. */
function access(o: { refuse?: CappedReason; micros?: number; client: Anthropic }) {
  const log = { reserved: 0, settled: [] as number[] };
  const a: ClaudeAccess = {
    reserve: async () => {
      if (o.refuse) return { ok: false, reason: o.refuse };
      log.reserved++;
      return { ok: true, reservation: { micros: o.micros ?? 250_000, settle: async (m: number) => { log.settled.push(m); } } };
    },
    // The reading is not what is tested here: the parser reads (as the stand-in's answers are the agents').
    reader: (db) => new ClaudeReader(db, null),
    agents: (budget) => budgetedClient(o.client, budget),
    status: async () => ({ on: !o.refuse, cap_micros: 400_000, spent_micros: null }),
  };
  return { access: a, log };
}

function host(claude?: ClaudeAccess) {
  const db = openDb(":memory:");
  const docs = new Map<string, Buffer>();
  useDocStore(db, { put: (sha, b) => { docs.set(`mem:${sha}`, Buffer.from(b)); return `mem:${sha}`; }, get: (p) => docs.get(p)! });
  const store = { text: null as string | null, load() { return this.text; }, save(t: string) { this.text = t; } };
  const bank = standInBank(store);
  const h = new EngineHost({
    db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => store.save(bankToText(bank)),
    rp: { rpId: "engine.example.invalid", origin: "https://engine.example.invalid" }, company: { name: "Agents Test Co", lang: "en" }, vault: null, feed: null,
    ...(claude ? { claude } : {}),
  });
  return { db, host: h };
}

const events = (db: DB) => (db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log ORDER BY seq").all() as EventRow[]).map(publicEvent);
const decided = (db: DB, name: string) => events(db).filter((e) => e.event === name);

describe("the payables agents in the cloud engine (task A6)", () => {
  it("the Checker and the Coder decide on an upload, the Payer on Pay; each decision is in the events with its request id", async () => {
    const s = standInClaude();
    const { access: a, log } = access({ client: s.client });
    const { db, host: h } = host(a);
    await h.seed();
    expect((await h.status()).agents).toBe("live");
    const up = await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(up.kind).toBe("invoice");

    const [check] = decided(db, "ap.checker_decided");
    expect(check!.fields).toMatchObject({ source: "claude", model: "claude-haiku-5-5", action: "pay" });
    expect(check!.fields.request_id).toMatch(/^req_a6_\d+$/);
    expect(check!.fields.reason).toMatch(/Bergtex is on file/);
    // The /try "At work" panel: the agent's own step, its reason, then what Purser's code enforced.
    const line = eventLine(check!);
    expect(line.who).toBe("Checker agent · Claude Haiku 5.5");
    expect(line.text).toMatch(/^Decided: pay, because Bergtex is on file.*Purser's code enforced: ask cfo; the agent may pay no invoice alone/);
    const [coded] = decided(db, "ap.coded");
    expect(eventLine(coded!).who).toBe("Coder agent · Claude Haiku 5.5");
    expect(coded!.fields).toMatchObject({ source: "claude", model: "claude-haiku-5-5", account: "6200" });
    expect(coded!.fields.request_id).toMatch(/^req_a6_\d+$/);
    // Every agent call in the events: each run with its last request id, each tool call with its own.
    const runs = decided(db, "agent.run");
    expect(runs.map((r) => r.fields.agent)).toEqual(["checker", "treasury"]);
    expect(runs.every((r) => /^req_a6_\d+$/.test(String(r.fields.request_id)))).toBe(true);
    // Haiku, at most 2,000 tokens an answer, inside the upload's one reservation.
    expect(s.seen.every((r) => r.model === "claude-haiku-5-5" && r.max_tokens <= 2_000)).toBe(true);
    expect(log.reserved).toBe(1);
    expect(log.settled).toHaveLength(1);

    expect(up.invoice!.payable).toBe(true);
    {
      const p = await h.propose(up.invoice!.id);
      const [payer] = decided(db, "ap.payer_proposed");
      expect(payer!.fields).toMatchObject({ source: "claude", model: "claude-haiku-5-5", outcome: "ask_cfo" });
      expect(payer!.fields.request_id).toMatch(/^req_a6_\d+$/);
      expect(eventLine(payer!)).toMatchObject({ who: "Payer agent · Claude Haiku 5.5" });
      expect(eventLine(payer!).text).toMatch(/^Proposed: pay on \d{4}-\d{2}-\d{2} via bank swift from [A-Z]{3}, because .*Purser's code enforced: ask cfo/);
      expect(typeof payer!.fields.enforced).toBe("string");
      expect(log.reserved).toBe(2);
      // Filed for the CFO's Face ID: code let the agent's proposal through on the engine's own plan.
      expect(p).toMatchObject({ ok: true });
    }
  });

  it("with the switch off, nothing is sent: code decides, labelled, and the status says code", async () => {
    const s = standInClaude();
    const { access: a } = access({ refuse: "switch_off", client: s.client });
    const { db, host: h } = host(a);
    await h.seed();
    expect((await h.status()).agents).toBe("code");
    const up = await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect(up.kind).toBe("invoice");
    expect(s.seen).toHaveLength(0);
    expect(decided(db, "claude.capped")[0]!.fields).toEqual({ reason: "switch_off" });
    const [check] = decided(db, "ap.checker_decided");
    expect(check!.fields).toMatchObject({ source: "fallback", model: null });
    const [coded] = decided(db, "ap.coded");
    expect(coded!.fields.source).toBe("fallback");
  });

  it("without Claude access the agents do not run at all, as before", async () => {
    const { db, host: h } = host();
    await h.seed();
    await h.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
    expect((await h.status()).agents).toBe("code");
    expect(decided(db, "ap.checker_decided")).toHaveLength(0);
    expect(decided(db, "agent.run")).toHaveLength(0);
  });

  it("an agent's call whose worst case does not fit what the action has left is not sent", async () => {
    const s = standInClaude();
    const budget = actionBudget(10);
    const c = budgetedClient(s.client, budget);
    await expect(c.beta.messages.create({ model: "claude-haiku-5-5", max_tokens: 16_000, messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/action_budget/);
    expect(s.seen).toHaveLength(0);
    const roomy = actionBudget(100_000);
    await budgetedClient(s.client, roomy).beta.messages.create({ model: "claude-haiku-5-5", max_tokens: 16_000, messages: [{ role: "user", content: "x" }] });
    expect(s.seen[0]!.max_tokens).toBe(2_000);
    expect(roomy.left()).toBeLessThan(100_000);
  });
});
