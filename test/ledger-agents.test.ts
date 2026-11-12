// The ledger agents (12 Nov): the Controller's month-end review and Ask the books. Off by default; the agent only
// proposes or answers, code checks the evidence and every figure, a person approves before anything is posted, and the
// loop's hard per-run cap stops a run before a turn could cross it. Fake client only.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { askBooks } from "../src/agents/booksAgent.js";
import { amountsIn } from "../src/agents/booksCore.js";
import { controllerProposals, decideProposal, ledgerInvoices, reviewMonth } from "../src/agents/controllerAgent.js";
import { fallbackReview } from "../src/agents/controllerCore.js";
import { openDb } from "../src/db/open.js";
import { verifyLedger } from "../src/ledger/core.js";
import { BOOKS_CASES, BOOKS_TODAY, CONTROLLER_CASES, postInvoice, seedBooks } from "../src/evals/ledgerAgentCases.js";
import { runBooksCase, runControllerCase } from "../src/evals/ledgerAgentEvals.js";

const ON = { KIT11_CONTROLLER_AGENT: "on", KIT11_BOOKS_AGENT: "on" };
type Call = { name: string; input: unknown };

/** A fake Claude: each turn is a list of tool calls (or a final text); `inputTokens` sets what each turn reports. */
function fake(turns: (Call[] | ((sent: string) => Call[]))[], inputTokens = 2000): { client: Anthropic; calls: () => number } {
  let i = 0;
  const client = { beta: { messages: { create: async (req: { messages: { content: unknown }[] }) => {
    const t = turns[i++];
    const usage = { input_tokens: inputTokens, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if (!t) return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage, _request_id: `req_${i}` };
    const calls = typeof t === "function" ? t(JSON.stringify(req.messages)) : t;
    return { content: calls.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-sonnet-5-5", usage, _request_id: `req_${i}` };
  } } } } as unknown as Anthropic;
  return { client, calls: () => i };
}

function world(id: string) {
  const c = CONTROLLER_CASES.find((x) => x.id === id)!;
  const db = openDb(":memory:");
  const ids = new Map<string, number>();
  for (const inv of c.invoices) ids.set(inv.key, postInvoice(db, inv));
  return { db, c, ids };
}

describe("the Controller agent", () => {
  it("is off by default: no call, no row", async () => {
    const { db } = world("dup-same-number");
    const f = fake([]);
    expect(await reviewMonth(db, "2026-10", { client: f.client, env: {} })).toBeNull();
    expect(f.calls()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: 0 });
  });

  it("reads the supplier invoices from the ledger as posted", () => {
    const { db, ids } = world("vat-wrong-rate");
    const office = ledgerInvoices(db).find((i) => i.entry_id === ids.get("office-oct"))!;
    expect(office).toMatchObject({ party: "Paperclip Office", net_cents: 10_000, vat_cents: 900, vat_code: "P21", total_cents: 10_900, month: "2026-10" });
  });

  it("stores the agent's proposal as pending, refuses one without evidence, and writes a decision row with model, request ids and cost", async () => {
    const { db, ids } = world("dup-same-number");
    const dup = ids.get("bt-oct-again")!, orig = ids.get("bt-oct")!, stock = ids.get("stockline-2026-10")!;
    const f = fake([
      [{ name: "list_invoices", input: {} }],
      [{ name: "find_duplicates", input: { entry_id: dup } }],
      [{ name: "propose", input: { entry_id: dup, kind: "duplicate", duplicate_of: orig, reason: "Same invoice number BT-1034 twice." } },
        { name: "propose", input: { entry_id: stock, kind: "duplicate", duplicate_of: null, reason: "made up" } }],
      [{ name: "finish", input: { summary: "One duplicate." } }],
    ]);
    const r = (await reviewMonth(db, "2026-10", { client: f.client, env: ON, retryDelayMs: 0 }))!;
    expect(r.source).toBe("claude");
    expect(r.proposals.map((p) => [p.entry_id, p.kind, p.status])).toEqual([[dup, "duplicate", "pending"]]);
    expect(r.proposals[0]!.correction).toEqual({ action: "reverse_entry", entry_id: dup, duplicate_of: orig, amount_cents: 133_100, currency: "EUR" });
    const tools = (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.tool'").all() as { payload_json: string }[]).map((x) => JSON.parse(x.payload_json) as { tool: string; blocked_by?: string });
    expect(tools.find((t) => t.tool === "propose" && t.blocked_by)?.blocked_by).toBe("evidence");
    const row = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'controller.reviewed'").get() as { payload_json: string }).payload_json);
    expect(row).toMatchObject({ source: "claude", model: "claude-sonnet-5-5", run: { status: "done", turns: 4 } });
    expect(row.run.request_ids).toEqual(["req_1", "req_2", "req_3", "req_4"]);
    expect(row.run.cost_usd_micros).toBeGreaterThan(0);
    // Nothing was posted: a proposal waits for a person.
    expect((db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE reverses IS NOT NULL").get() as { n: number }).n).toBe(0);
  });

  it("posts only when a named person approves: a reversal for a duplicate, a balanced VAT correction for a mismatch", async () => {
    const { db, ids } = world("two-problems");
    const f = fake([
      [{ name: "propose", input: { entry_id: ids.get("bt-oct-again")!, kind: "duplicate", duplicate_of: null, reason: "Same number." } },
        { name: "propose", input: { entry_id: ids.get("office-oct")!, kind: "vat_mismatch", duplicate_of: null, reason: "VAT too high." } }],
      [{ name: "finish", input: { summary: "Two." } }],
    ]);
    const r = (await reviewMonth(db, "2026-10", { client: f.client, env: ON, retryDelayMs: 0 }))!;
    expect(() => decideProposal(db, r.proposals[0]!.id, "approve", "controller")).toThrow(/a person decides/);
    const a = decideProposal(db, r.proposals[0]!.id, "approve", "test-cfo");
    expect(a.posted_entry).not.toBeNull();
    const v = decideProposal(db, r.proposals[1]!.id, "approve", "test-cfo");
    const lines = db.prepare("SELECT account, debit_cents, credit_cents FROM ledger_lines WHERE entry_id = ? ORDER BY line_no").all(v.posted_entry) as { account: string; debit_cents: number; credit_cents: number }[];
    // 21% of 100.00 is 21.00; 20.00 was posted: 1.00 moves from the expense to input VAT.
    expect(lines.map((l) => [l.account, l.debit_cents, l.credit_cents])).toEqual([["1510", 100, 0], ["6900", 0, 100]]);
    expect(verifyLedger(db).ok).toBe(true);
    expect(() => decideProposal(db, a.id, "reject", "test-cfo")).toThrow(/already approved/);
    expect(controllerProposals(db, "2026-10").map((p) => p.status)).toEqual(["approved", "approved"]);
  });

  it("falls back to code's rules, labelled, when there is no model", async () => {
    const { db, ids } = world("trap-weekly-courier");
    const r = (await reviewMonth(db, "2026-10", { client: null, env: ON }))!;
    expect(r.source).toBe("fallback");
    // Code's strict rule flags the weekly courier: the judgment the agent is there for.
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(r.proposals.every((p) => p.proposed_by === "code" && ids.has("fastline-41"))).toBe(true);
  });

  it("stops before a turn could cross the run's hard dollar cap", async () => {
    const { db } = world("clean-month");
    // Each turn reports 120k input tokens (USD 0.24 at Sonnet's list price): the second turn could cross USD 0.40.
    const f = fake([[{ name: "list_invoices", input: {} }], [{ name: "list_invoices", input: {} }], [{ name: "finish", input: { summary: "x" } }]], 120_000);
    const r = (await reviewMonth(db, "2026-10", { client: f.client, env: ON, retryDelayMs: 0 }))!;
    expect(f.calls()).toBe(1);
    expect(r.source).toBe("fallback");
    expect(r.run!.note).toMatch(/run cap/);
  });

  it("has at least 15 cases, and code's fallback is graded on them", async () => {
    expect(CONTROLLER_CASES.length).toBeGreaterThanOrEqual(15);
    const rows = await Promise.all(CONTROLLER_CASES.map((c) => runControllerCase(c, null, "none")));
    expect(rows.every((r) => r.source === "fallback")).toBe(true);
    // The fallback misses the judgment cases (weekly courier, annual plan): the eval can tell it from a good reviewer.
    expect(rows.filter((r) => !r.passed).map((r) => r.case)).toEqual(expect.arrayContaining(["trap-weekly-courier", "trap-annual-plan"]));
    expect(fallbackReview({ month: "2026-10", invoices: [], history: [] })).toEqual([]);
  });
});

describe("Ask the books", () => {
  const seeded = () => { const db = openDb(":memory:"); seedBooks(db); return db; };

  it("is off by default", async () => {
    const f = fake([]);
    expect(await askBooks(seeded(), "What is our EUR balance?", { client: f.client, env: {} })).toBeNull();
    expect(f.calls()).toBe(0);
  });

  it("accepts an answer whose every figure is a search's total, and records the lines behind it", async () => {
    const db = seeded();
    const f = fake([
      [{ name: "find_lines", input: { accounts: ["1200"], party: null, from: null, to: null, text: null } }],
      [{ name: "answer", input: { text: "The EUR bank holds 9.99.", figures: [{ label: "EUR bank", amount: "9.99", currency: "EUR", source: "Q1", measure: "net" }], cannot_answer: false } }],
      (sent: string) => {
        const net = /net (-?[\d.]+)/.exec(sent)![1]!.replace("-", "");
        return [{ name: "answer", input: { text: `The EUR bank holds ${Number(net).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`, figures: [{ label: "EUR bank", amount: net, currency: "EUR", source: "Q1", measure: "net" }], cannot_answer: false } }];
      },
    ]);
    const r = (await askBooks(db, "What is in the EUR bank?", { client: f.client, env: ON, today: BOOKS_TODAY, retryDelayMs: 0 }))!;
    expect(r.source).toBe("claude");
    const want = BOOKS_CASES.find((c) => c.id === "eur-bank-balance")!.expect!(db)[0]!.amount;
    expect(r.answer.figures[0]!.amount).toBe(want);
    const row = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'books.answered'").get() as { payload_json: string }).payload_json);
    expect(row.run.attempts).toBe(2);
    expect(row.sources[0].lines.length).toBeGreaterThan(5);
    expect(row.run.request_ids).toEqual(["req_1", "req_2", "req_3"]);
  });

  it("refuses an amount in the text that is not a figure, a source it never saw, and amounts in a cannot-answer", async () => {
    const db = seeded();
    const f = fake([
      [{ name: "answer", input: { text: "Revenue was 1,000,000.00.", figures: [{ label: "r", amount: "1000000.00", currency: "EUR", source: "Q1", measure: "credit" }], cannot_answer: false } }],
      [{ name: "answer", input: { text: "About 5000.00 next month.", figures: [], cannot_answer: true } }],
      [{ name: "answer", input: { text: "Probably 12.00.", figures: [], cannot_answer: false } }],
    ]);
    const r = (await askBooks(db, "What was revenue in September?", { client: f.client, env: ON, today: BOOKS_TODAY, retryDelayMs: 0 }))!;
    expect(r.source).toBe("fallback");
    expect(r.note).toMatch(/refused the agent's 3/);
    expect(r.answer.cannot_answer).toBe(true);
    expect(amountsIn("1,000,000.00 and 12.5 and 7.00")).toEqual(["1000000.00", "7.00"]);
  });

  it("has at least 15 cases with expectations computed from the seeded ledger", () => {
    expect(BOOKS_CASES.length).toBeGreaterThanOrEqual(15);
    const db = seeded();
    for (const c of BOOKS_CASES) for (const e of c.expect?.(db) ?? []) expect(e.amount).toMatch(/^\d+\.\d{2}$/);
    expect(BOOKS_CASES.filter((c) => c.expect === null).length).toBeGreaterThanOrEqual(3);
  });

  it("grades code's fallback: it can only say it cannot answer", async () => {
    const rows = await Promise.all(BOOKS_CASES.map((c) => runBooksCase(c, null, "none")));
    const refusals = BOOKS_CASES.filter((c) => c.expect === null).map((c) => c.id);
    expect(rows.filter((r) => refusals.includes(r.case)).every((r) => r.passed)).toBe(true);
    expect(rows.filter((r) => !refusals.includes(r.case)).every((r) => !r.passed && r.source === "fallback")).toBe(true);
  });
});
