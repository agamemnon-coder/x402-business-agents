// The runner dashboard's trace (src/dashboard/trace.ts, /api/trace/:seq) shows the payables agents' runs: each tool the
// agent called, its reason, the enforced outcome and the override when code made one; and the agents' counts are in
// agentStats, which the dashboard and npm run agent-summary print. Breaks if a Checker or Payer run has no decision
// step, if an override is not shown as stopped with code's reason, or if a fallback reads as Claude's decision.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { MODELS } from "../src/claude/reader.js";
import { agentStats } from "../src/dashboard/agentStats.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { agentTraces, type Trace } from "../src/dashboard/trace.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const TODAY = now.toISOString().slice(0, 10);
const FORGED = EN.replace("DE89 3704 0044 0532 0130 00", "DE02 1203 0000 0000 2020 51").replace("BTX-2026-21", "BTX-2026-22");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

type Call = { name: string; input: unknown };
function fake(turns: Call[][], model: string): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 800, output_tokens: 100 };
    if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model, usage, _request_id: `req_trace${i}` };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model, usage, _request_id: `req_trace${i}` };
  } } } } as unknown as Anthropic;
}
const decide = (action: string, reason: string, findings: string[] = []): Call => ({ name: "decide", input: { action, reason, findings } });
const propose = (rail: string, payCurrency: string, reason: string): Call => ({ name: "propose_payment", input: { rail, pay_on: TODAY, pay_currency: payCurrency, reason } });

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  process.env.KIT11_AP_AGENTS = "on";
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-trace-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => {
  delete process.env.KIT11_AP_AGENTS;
  rmSync(dir, { recursive: true, force: true });
});

const add = async (text: string, claude: Anthropic | null, filename: string) => {
  const out = await ingestDocument(db, { ...deps, claude }, { bytes: await pdfOf(text), filename, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice;
};
const stepOf = (t: Trace, kind: string) => t.steps.filter((s) => s.kind === kind);

describe("the trace of the payables agents", () => {
  it("shows the Checker's run: its tools, its reason, and the override with code's reason when it said pay on a forged IBAN", async () => {
    const said = "Everything on this invoice looks in order, so it can be paid now.";
    const inv = await add(FORGED, fake([[{ name: "supplier_on_file", input: {} }, { name: "check_bank_details", input: {} }], [decide("pay", said)]], MODELS.act), "forged.pdf");
    expect(inv.status).toBe("blocked");
    const [t] = agentTraces(db).filter((x) => x.agent === "checker");
    expect(t).toMatchObject({ agent: "checker", agent_name: "Checker agent", model: MODELS.act, status: "done", turns: 2, request_ids: ["req_trace1", "req_trace2"] });
    expect(t!.task).toMatch(/^ap\.check\.[0-9a-f]{16}$/);
    expect(stepOf(t!, "tool").map((s) => s.tool)).toEqual(["supplier_on_file", "check_bank_details", "decide"]);
    expect(stepOf(t!, "tool")[1]).toMatchObject({ blocked: false, check: expect.stringContaining("read only") });
    expect(stepOf(t!, "tool")[1]!.result).toMatch(/not the (one|account) on file|differs|does not match/i);
    const [d] = stepOf(t!, "decision");
    expect(t!.decision_seq).toBe(d!.seq);
    expect(d).toMatchObject({ event: "ap.checker_decided", blocked: true });
    expect(d!.text).toContain(said);
    expect(d!.text).toMatch(/The Checker agent decided to pay .*Code's checks overrode it/);
    expect(d!.text).toContain("held for a person");
    expect(d!.check).toMatch(/^code's checks overrode the agent \(possible_fraud\): /);
    // The feed line of the decision opens this trace.
    const line = buildSnapshot(db).feed.find((f) => f.event === "ap.checker_decided");
    expect(line).toMatchObject({ trace: t!.run_seq, tone: "refusal" });
  });

  it("shows the Payer's run: the rail, the day and the currency it proposed, its reason, and what code made of it", async () => {
    const inv = await add(EN, null, "invoice.pdf");
    const reason = "Paying today from the USD balance on the locked quote keeps every balance above its floor.";
    await payApInvoice(db, awx, inv.id, now, parserOnly, { claude: fake([[{ name: "cash_position", input: {} }, { name: "fx_quote", input: {} }], [propose("bank_swift", "USD", reason)]], MODELS.classify) });
    const [t] = agentTraces(db).filter((x) => x.agent === "payer");
    expect(t).toMatchObject({ agent: "payer", agent_name: "Payer agent", task: `ap.pay.${inv.id}`, model: MODELS.classify, status: "done" });
    expect(stepOf(t!, "tool").map((s) => s.tool)).toEqual(["cash_position", "fx_quote", "propose_payment"]);
    const [d] = stepOf(t!, "decision");
    expect(d).toMatchObject({ event: "ap.payer_proposed", blocked: false });
    expect(d!.text).toContain(reason);
    expect(d!.text).toMatch(new RegExp(`The Payer agent proposed paying BTX-2026-21 on ${TODAY} by a SWIFT bank payout through Airwallex, from USD`));
    expect(d!.text).toContain("Filed for the CFO's Face ID");
    expect(d!.check).toMatch(/the CFO signs the exact terms with Face ID/);
  });

  it("shows a held proposal as stopped, with code's reason", async () => {
    const inv = await add(EN, null, "invoice.pdf");
    await payApInvoice(db, awx, inv.id, now, parserOnly, { claude: fake([[propose("bank_swift", "EUR", "Paying today from the EUR balance is the simplest way and avoids a conversion.")]], MODELS.classify) });
    const [t] = agentTraces(db).filter((x) => x.agent === "payer");
    const [d] = stepOf(t!, "decision");
    expect(d).toMatchObject({ blocked: true });
    expect(d!.text).toMatch(/Code held it: .*EUR/);
    expect(d!.check).toMatch(/^code held the agent's proposal \((below_floor|not_enough_money)\): /);
  });

  it("shows a fallback as code's decision, never as Claude's", async () => {
    await add(EN, null, "invoice.pdf");
    const [t] = agentTraces(db).filter((x) => x.agent === "checker");
    expect(t).toMatchObject({ status: "unavailable", note: "no KIT11_ANTHROPIC_API_KEY" });
    const [d] = stepOf(t!, "decision");
    expect(d!.text).toMatch(/^Code's checks decided /);
    expect(d!.text).toContain("the Checker agent did not decide");
    expect(d!.check).toMatch(/^fallback \(code\): no KIT11_ANTHROPIC_API_KEY/);
  });
});

describe("the agents' counts", () => {
  it("agentStats lists each payables agent with its decisions, fallbacks and overrides", async () => {
    await add(FORGED, fake([[decide("pay", "Everything on this invoice looks in order, so it can be paid now.")]], MODELS.act), "forged.pdf");
    const inv = await add(EN, null, "invoice.pdf");
    await payApInvoice(db, awx, inv.id, now, parserOnly, { claude: fake([[propose("bank_swift", "EUR", "Paying today from the EUR balance is the simplest way and avoids a conversion.")]], MODELS.classify) });
    const stats = agentStats(db);
    expect(stats.find((s) => s.agent === "checker")).toMatchObject({ decisions: 2, by_claude: 1, fallback: 1, fallback_pct: 50, overridden: 1, models: [MODELS.act] });
    expect(stats.find((s) => s.agent === "payer")).toMatchObject({ decisions: 1, by_claude: 1, fallback: 0, overridden: 1, models: [MODELS.classify] });
    expect(buildSnapshot(db).agent_stats.find((s) => s.agent === "checker")).toMatchObject({ overridden: 1 });
  });
});
