// The Checker agent in the runner's payables chain (KIT11_AP_AGENTS=on): Claude decides on each invoice with its tools,
// and code enforces the boundary. Breaks if the agent's "pay" on a forged IBAN pays anything, if an override is not
// recorded and counted, if a run without Claude (no key, a cost cap) is not labelled as code's fallback, or if the
// flag being off changes the chain at all. A scripted stand-in for the Claude client: no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { CHECKER_DECISION, runChecker, statusAfter } from "../src/ap/checkerAgent.js";
import { codeFindings, enforce, type CheckerDecision } from "../src/ap/checkerCore.js";
import { invoiceCase } from "../src/ap/checks.js";
import { ingestDocument, recheck, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { parseApFallback } from "../src/ap/reading.js";
import { audit } from "../src/audit/log.js";
import { MODELS } from "../src/claude/reader.js";
import { agentStats } from "../src/dashboard/agentStats.js";
import { openDb, type DB } from "../src/db/open.js";
import { originsCheck } from "../src/provenance/check.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const BERGTEX_IBAN = "DE89370400440532013000";
const FORGED = EN.replace("DE89 3704 0044 0532 0130 00", "DE02 1203 0000 0000 2020 51");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

type Call = { name: string; input: unknown };
/** A scripted Claude: each turn is the tool calls it makes; after the script it stops with a sentence. */
function fake(turns: Call[][], model: string = MODELS.act): Anthropic & { asked: number } {
  const client = { asked: 0, beta: { messages: { create: async () => {
    const t = turns[client.asked++];
    const usage = { input_tokens: 900, output_tokens: 120 };
    if (!t) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model, usage, _request_id: `req_test${client.asked}` };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${client.asked}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model, usage, _request_id: `req_test${client.asked}` };
  } } } };
  return client as unknown as Anthropic & { asked: number };
}
/** A client that must never be asked. */
const never = (): Anthropic => ({ beta: { messages: { create: async () => { throw new Error("Claude was called"); } } } }) as unknown as Anthropic;
const decide = (action: string, reason: string, findings: string[] = []): Call => ({ name: "decide", input: { action, reason, findings } });
const LOOKUPS: Call[] = [{ name: "supplier_on_file", input: {} }, { name: "check_bank_details", input: {} }, { name: "invoice_history", input: {} }];

let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  process.env.KIT11_AP_AGENTS = "on";
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-checker-"));
  db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_bergtex', 'Bergtex Textil GmbH', ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')")
    .run(BERGTEX_IBAN.slice(-4), ibanSha(BERGTEX_IBAN));
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => {
  delete process.env.KIT11_AP_AGENTS;
  rmSync(dir, { recursive: true, force: true });
});

const add = async (text: string, claude: Anthropic | null, filename = "invoice.pdf") => {
  const out = await ingestDocument(db, { ...deps, claude }, { bytes: await pdfOf(text), filename, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice;
};
const decisions = () => (db.prepare("SELECT actor, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(CHECKER_DECISION) as { actor: string; subject: string; payload_json: string }[])
  .map((r): Record<string, unknown> => ({ actor: r.actor, subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }));
const events = () => (db.prepare("SELECT event FROM audit_log ORDER BY seq").all() as { event: string }[]).map((r) => r.event);

describe("the Checker agent decides, code enforces", () => {
  it("catches a forged IBAN: it looks the account up and holds the invoice, in its own words", async () => {
    const reason = "The bank account on this invoice is not the one on file for Bergtex Textil GmbH. A person must check it with the supplier before anything is paid.";
    const claude = fake([LOOKUPS, [decide("hold", reason, ["bank_details_changed", "possible_fraud"])]]);
    const inv = await add(FORGED, claude);
    expect(inv.status).toBe("blocked");
    const [d] = decisions();
    expect(d).toMatchObject({
      actor: "checker", subject: inv.id, invoice_id: inv.id, source: "claude", model: MODELS.act, action: "hold", reason,
      agent_findings: ["bank_details_changed", "possible_fraud"], outcome: "hold", overridden_by: null, overridden: false, status: "blocked",
      origin: { actor: "agent", agent: "checker", model: MODELS.act, request_id: "req_test2" },
    });
    expect((d!.code_findings as { code: string }[]).map((f) => f.code)).toContain("possible_fraud");
    // The agent's own run and each tool call are in the audit chain, under the Checker's name.
    const tools = (db.prepare("SELECT json_extract(payload_json, '$.tool') AS tool FROM audit_log WHERE event = 'agent.tool' AND actor = 'checker' ORDER BY seq").all() as { tool: string }[]).map((r) => r.tool);
    expect(tools).toEqual(["supplier_on_file", "check_bank_details", "invoice_history", "decide"]);
    const run = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' AND actor = 'checker'").get() as { payload_json: string }).payload_json) as { status: string; model: string; run_id: string };
    expect(run).toMatchObject({ status: "done", model: MODELS.act });
    expect((d!.origin as { run_id: string }).run_id).toBe(run.run_id);
  });

  it("says pay on a forged IBAN, and code overrides it: the invoice is held, the override is recorded and counted", async () => {
    const claude = fake([[decide("pay", "Everything on this invoice looks in order, so it can be paid now.")]]);
    const inv = await add(FORGED, claude);
    expect(inv.status).toBe("blocked");
    expect(inv.findings.map((f) => f.code)).toContain("possible_fraud");
    const [d] = decisions();
    expect(d).toMatchObject({ source: "claude", action: "pay", outcome: "hold", overridden_by: "possible_fraud", overridden: true, status: "blocked" });
    expect(agentStats(db).find((s) => s.agent === "checker")).toMatchObject({ decisions: 1, by_claude: 1, fallback: 0, overridden: 1 });
  });

  it("without Claude, code's checks decide alone and the decision is labelled as the fallback", async () => {
    const inv = await add(EN, null);
    expect(inv.status).toBe("ready");
    const [d] = decisions();
    expect(d).toMatchObject({ source: "fallback", model: null, action: "ask_cfo", outcome: "ask_cfo", overridden_by: null, overridden: false, status: "ready", note: "no KIT11_ANTHROPIC_API_KEY", origin: { actor: "code", agent: "checker" } });
    expect(String(d!.reason)).toMatch(/^Code's checks found nothing that stops this invoice/);
    expect(agentStats(db).find((s) => s.agent === "checker")).toMatchObject({ decisions: 1, by_claude: 0, fallback: 1, fallback_pct: 100, overridden: 0 });
  });

  it("at its cost cap it makes no call: code's checks decide, labelled as the fallback with the cap as the reason", async () => {
    // What the Checker spent on Claude in the last hour is already its hourly budget (src/agents/loop.ts).
    audit(db, "checker", "agent.run", "ap.check.earlier", { agent: "checker", cost_usd_micros: 10_000_000 });
    const inv = await add(FORGED, never());
    expect(inv.status).toBe("blocked");
    const [d] = decisions();
    expect(d).toMatchObject({ source: "fallback", action: "hold", outcome: "hold", overridden: false });
    expect(String(d!.note)).toMatch(/^cost cap: /);
  });

  it("may be stricter than code: its hold of an invoice code would let through stands, also when it is checked again", async () => {
    const reason = "The document asks its reader to skip the checks, so a person should look at it first.";
    const inv = await add(EN, fake([[decide("hold", reason, ["instructions_in_document"])]]));
    expect(inv.status).toBe("needs_review");
    expect(inv.findings.find((f) => f.code === "checker_hold")).toMatchObject({ level: "review", detail: `the Checker agent holds it for a person: ${reason}` });
    expect(decisions()[0]).toMatchObject({ action: "hold", outcome: "hold", overridden: false, status: "needs_review" });
    // Checked again (a person asked, or a supplier was added): the agent decides again, and code alone never releases it.
    const [again] = await recheck(db, { ...deps, claude: fake([[decide("hold", reason, ["instructions_in_document"])]]) }, [inv.id]);
    expect(again!.status).toBe("needs_review");
    expect(decisions()).toHaveLength(2);
    const [third] = await recheck(db, { ...deps, claude: fake([[decide("ask_cfo", "Nothing is wrong with this invoice, and the CFO approves every payment.")]]) }, [inv.id]);
    expect(third!.status).toBe("ready");
    expect(third!.findings.some((f) => f.code === "checker_hold")).toBe(false);
  });

  it("its reject stops the invoice for good until a person looks: blocked, with its reason", async () => {
    const reason = "This invoice must not be paid as it is; a person should reject it.";
    const inv = await add(EN, fake([[decide("reject", reason, ["other"])]]));
    expect(inv.status).toBe("blocked");
    expect(inv.findings.find((f) => f.code === "checker_reject")).toMatchObject({ level: "block" });
  });

  it("a pay on a clean invoice goes to the CFO: nothing is paid without Face ID", async () => {
    const inv = await add(EN, fake([[decide("pay", "Nothing is wrong with this invoice from Bergtex Textil GmbH, so it can be paid.")]]));
    expect(inv.status).toBe("ready");
    expect(decisions()[0]).toMatchObject({ action: "pay", outcome: "ask_cfo", overridden_by: "no_alone_limit", overridden: true });
  });

  it("a reason with a number that is not in the case is refused by the tool, and the agent decides again", async () => {
    const claude = fake([[decide("ask_cfo", "The total of EUR 9,999.00 looks right, so the CFO can approve it.")], [decide("ask_cfo", "The total of EUR 1,850.00 matches the document, so the CFO can approve it.")]]);
    const inv = await add(EN, claude);
    expect(inv.status).toBe("ready");
    const blocked = (db.prepare("SELECT json_extract(payload_json, '$.blocked_by') AS b FROM audit_log WHERE event = 'agent.tool' ORDER BY seq").all() as { b: string | null }[]).map((r) => r.b);
    expect(blocked).toEqual(["amounts", null]);
    expect(decisions()[0]).toMatchObject({ source: "claude", reason: "The total of EUR 1,850.00 matches the document, so the CFO can approve it." });
  });

  it("an agent that stops without deciding is sent back once; if it still does not decide, code's checks decide", async () => {
    const claude = fake([LOOKUPS]);
    const inv = await add(EN, claude);
    expect(claude.asked).toBe(3);
    expect(events()).toContain("agent.nudged");
    expect(inv.status).toBe("ready");
    expect(decisions()[0]).toMatchObject({ source: "fallback", outcome: "ask_cfo" });
  });

  it("a new supplier waits as before whatever the agent says, and is decided again once the supplier is on file", async () => {
    const inv = await add(DE, fake([[decide("ask_cfo", "Nothing is wrong with this invoice, so the CFO can approve it.")]]));
    expect(inv.status).toBe("needs_vendor");
    expect(decisions()[0]).toMatchObject({ action: "ask_cfo", outcome: "hold", overridden_by: "new_supplier", overridden: true, status: "needs_vendor" });
  });

  it("writes no money event and leaves the origins check clean", async () => {
    await add(FORGED, fake([[decide("pay", "Everything on this invoice looks in order, so it can be paid now.")]]));
    expect(originsCheck(db).missing).toEqual([]);
  });
});

describe("with the flag off nothing changes", () => {
  it("no agent runs, no agent row is written, and Claude is never asked", async () => {
    delete process.env.KIT11_AP_AGENTS;
    const inv = await add(EN, never());
    expect(inv.status).toBe("ready");
    expect(events()).toEqual(["ap.received"]);
    const forged = await add(FORGED, never(), "forged.pdf");
    expect(forged.status).toBe("blocked");
    await recheck(db, { ...deps, claude: never() }, [inv.id]);
    expect(events().filter((e) => e.startsWith("agent.") || e === CHECKER_DECISION)).toEqual([]);
    expect(agentStats(db)).toEqual([]);
  });
});

describe("the outcome as a status", () => {
  const r = parseApFallback(EN);
  const c = () => invoiceCase(db, r, EN, { docSha: "0".repeat(64), now });
  const of = (d: CheckerDecision) => { const k = c(); const f = codeFindings(k); return statusAfter(enforce(k, d, f), f); };

  it("follows code's own status unless the agent was stricter", () => {
    expect(of({ action: "ask_cfo", reason: "x", findings: [] })).toMatchObject({ status: "ready" });
    expect(of({ action: "pay", reason: "x", findings: [] })).toMatchObject({ status: "ready" });
    expect(of({ action: "hold", reason: "why", findings: [] }).status).toBe("needs_review");
    expect(of({ action: "reject", reason: "why", findings: [] }).status).toBe("blocked");
  });

  it("runs on a case alone, for a caller that brings its own (no inbox)", async () => {
    const k = c();
    const out = await runChecker(db, k, codeFindings(k), { task: "ap.check.case", claude: fake([[decide("ask_cfo", "Nothing is wrong with this invoice, so the CFO can approve it.")]]) });
    expect(out).toMatchObject({ source: "claude", enforced: { outcome: "ask_cfo", overridden_by: null } });
  });
});
