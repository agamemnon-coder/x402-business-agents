// Least privilege, visible (src/policy/principals.ts AGENT_TOOLS, ACTION_WORDS, toolRefusal). Each agent principal
// lists exactly the tools it may call as a model and the money actions it may take; anything else is refused in code
// before it runs, with an audit event (principal.tool_refused): in the agent loop (src/agents/loop.ts), at the agent
// API (src/platform/mcpServer.ts), and when an approved payment is executed (src/executors/*Payment.ts). The table in
// docs/security/agent-permissions.md is held to the code here, cell by cell. Fake model client only; no network.
import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/agents/loop.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeSupplierPayment, holdReason } from "../src/executors/supplierPayment.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { agentId } from "../src/platform/externalAgents.js";
import { AGENT_TOOLS, DEFAULT_CAPABILITIES, principal, TOOL_REFUSED, toolRefusal } from "../src/policy/principals.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { NL } from "./fakes/apInvoices.js";
import { supplierWorld, type SupplierWorld } from "./support/supplierWorld.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return {
    beta: {
      messages: {
        create: async () => {
          const t = turns[i++];
          const usage = { input_tokens: 800, output_tokens: 100 };
          if (!t) return { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
          return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
        },
      },
    },
  } as unknown as Anthropic;
}
const refusals = (db: DB) => (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(TOOL_REFUSED) as { subject: string; payload_json: string }[])
  .map((r) => ({ subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }));

describe("the agent loop runs only the tools on the agent's list", () => {
  let db: DB;
  beforeEach(() => { db = openDb(":memory:"); });
  afterEach(() => db.close());

  it("the Sourcing agent handed a refund tool: it never runs, the model is told, the refusal is audited", async () => {
    const ran: string[] = [];
    const tool = (name: string) => ({ name, description: name, input: z.strictObject({}), run: async () => { ran.push(name); return { text: `${name} ran` }; } });
    const run = await runAgent(db, {
      agent: "sourcing", task: "test.least_privilege", model: "claude-haiku-5-5", system: "s", prompt: "p", retryDelayMs: 0,
      tools: [tool("check_offer"), tool("refund"), tool("code_invoice")],
    }, fake([[{ name: "check_offer", input: {} }, { name: "refund", input: {} }], [{ name: "code_invoice", input: {} }]]));
    expect(ran).toEqual(["check_offer"]);
    expect(run.calls.map((c) => [c.tool, c.blocked ?? null])).toEqual([["check_offer", null], ["refund", "least privilege"], ["code_invoice", "least privilege"]]);
    expect(run.calls[1]!.text).toMatch(/^tool_denied: the Sourcing agent may not call refund; nothing was done/);
    expect(refusals(db)).toEqual([
      expect.objectContaining({ subject: "sourcing", tool: "refund", via: "agent loop", task: "test.least_privilege" }),
      expect.objectContaining({ subject: "sourcing", tool: "code_invoice", via: "agent loop" }),
    ]);
  });

  it("each agent's own tools pass; the Support and Treasury agents may not pay for the Sourcing agent", () => {
    for (const [agent, tools] of Object.entries(AGENT_TOOLS)) for (const t of tools.split(" ")) expect(toolRefusal(db, agent, t, { via: "test" })).toBeNull();
    for (const agent of ["support", "treasury"]) for (const t of ["try_purchase", "buy_software", "set_buy_policy"]) expect(toolRefusal(db, agent, t, { via: "test" })).toMatch(/^tool_denied/);
    expect(toolRefusal(db, "sourcing", "sweep_earnings", { via: "test" })).toMatch(/^tool_denied/);
    expect(toolRefusal(db, "support", "code_invoice", { via: "test" })).toMatch(/^tool_denied/);
    // A money action on its capabilities is its own: the Treasury agent may run its approved supplier payments.
    expect(toolRefusal(db, "treasury", "supplier_payment", { via: "test" })).toBeNull();
    expect(refusals(db)).toHaveLength(8);
  });

  it("agents that hold no money keep the tools their code hands them (the payables agents, the controller, the evals)", () => {
    for (const agent of ["checker", "payer", "controller", "books"]) expect(toolRefusal(db, agent, "anything", { via: "test" })).toBeNull();
    expect(refusals(db)).toEqual([]);
  });
});

describe("the agent API refuses a tool outside the outside agent's capabilities, audited", () => {
  it("a revoked capability: refused before anything runs, with principal.tool_refused", async () => {
    const db = openDb(":memory:");
    const id = agentId("acme-research");
    const p = principal(db, id)!;
    const caps = JSON.parse(p.capabilities_json) as { tools: string[] };
    db.prepare("UPDATE principals SET capabilities_json = ? WHERE principal_id = ?").run(JSON.stringify({ ...caps, tools: caps.tools.filter((t) => t !== "pay_with_card") }), id);
    const server = agentApiServer(db, id, new FakeIssuing());
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "pay_with_card", arguments: { merchant: "TrailData Reports", amount_eur: "19.00", description: "Q4 report" } });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ refused: true, refused_by: "purser", code: "capability_denied" });
    expect(refusals(db)).toEqual([expect.objectContaining({ subject: id, tool: "pay_with_card", via: "agent API (MCP)" })]);
    await client.close();
    db.close();
  });
});

describe("an approved supplier payment asks the Treasury agent's identity for the action itself", () => {
  let w: SupplierWorld;
  beforeEach(async () => { w = await supplierWorld(); });
  afterEach(() => w.done());

  it("without supplier_payment among its actions, nothing is paid, whatever the approval", async () => {
    const { proposalId, terms } = await w.approvedPayment(NL, "nl.pdf");
    const p = principal(w.db, "treasury")!;
    const caps = JSON.parse(p.capabilities_json) as { tools: string[] };
    w.db.prepare("UPDATE principals SET capabilities_json = ? WHERE principal_id = 'treasury'").run(JSON.stringify({ ...caps, tools: caps.tools.filter((t) => t !== "supplier_payment") }));
    expect(holdReason(w.db, terms, new Date())).toBe("capability_denied: the treasury agent may not use supplier_payment; nothing is paid");
    await expect(executeSupplierPayment(w.db, w.awx, w.awx, proposalId)).rejects.toThrow(/may not use supplier_payment/);
    expect(w.awx.transfers).toHaveLength(0);
  });
});

describe("docs/security/agent-permissions.md is the code's table", () => {
  const doc = readFileSync(new URL("../docs/security/agent-permissions.md", import.meta.url), "utf8");
  /** The rows of the table under one agent's heading, as "tool kind", sorted; each must say what the tool does. */
  const KINDS = new Set(["read", "talk", "propose", "pay", "action"]);
  function rows(agent: string): string[] {
    const start = doc.indexOf(`\n## ${agent}\n`);
    expect(start, `a section for ${agent}`).toBeGreaterThan(-1);
    const end = doc.indexOf("\n## ", start + 1);
    const section = doc.slice(start, end === -1 ? undefined : end);
    const found = [...section.matchAll(/^\| `([a-z_]+)` \| ([a-z]+) \| (.*?) \|$/gm)];
    for (const m of found) expect(m[3]!.trim().length, `${agent} ${m[1]}: what it does`).toBeGreaterThan(10);
    for (const m of found) expect(KINDS.has(m[2]!), `${agent} ${m[1]}: a kind`).toBe(true);
    // A tool among the money actions is an action; any other is one of the agent's own tools.
    return found.map((m) => `${m[1]} ${m[2] === "action" ? "action" : "tool"}`).sort();
  }
  for (const agent of ["sourcing", "support", "treasury"] as const) {
    it(`${agent}: every tool and action it may call, and nothing else`, () => {
      const want = [...AGENT_TOOLS[agent].split(" ").map((t) => `${t} tool`), ...DEFAULT_CAPABILITIES[agent]!.tools.map((t) => `${t} action`)].sort();
      expect(rows(agent)).toEqual(want);
    });
  }
  it("outside agents: the agent API's tools, each an action on its capabilities", () => {
    expect(rows("outside")).toEqual(DEFAULT_CAPABILITIES.outside!.tools.map((t) => `${t} action`).sort());
  });
});
