// P1 over MCP: a client connects to the agent API as one outside agent and sees only tools that ask, pay within the
// card's limits, or read. The whole path: ask for a card, wait for the CFO, pay, get declined, ask for a raise.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { agentId, executeAgentOnboard } from "../src/platform/externalAgents.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

describe("the agent API over MCP (P1)", () => {
  it("offers four tools, none of which can approve; the card comes only after the CFO's approval", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const id = agentId("acme-research");
    const server = agentApiServer(db, id, awx);
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["company_card", "pay_with_card", "request_company_card", "request_limit_raise"]);
    expect(tools.some((t) => /approve|policy|freeze|decide/.test(t))).toBe(false);

    const early = await client.callTool({ name: "pay_with_card", arguments: { merchant: "TrailData Reports", amount_eur: "19.00", description: "Q4 report" } });
    expect(early.isError).toBe(true);
    expect(text(early)).toMatch(/no company card yet/);

    const asked = await client.callTool({ name: "request_company_card", arguments: { display_name: "Acme Research agent", purpose: "market reports", per_purchase_eur: "25.00", monthly_eur: "100.00" } });
    expect(text(asked)).toMatch(/^Asked\. P-0001 waits for the CFO's Face ID/);
    expect(JSON.parse(text(await client.callTool({ name: "company_card", arguments: {} })))).toMatchObject({ status: "REQUESTED", proposal_status: "PENDING_APPROVAL", card: null });

    // The CFO approves (on the phone, with Face ID; here directly) and the runner issues the card.
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-0001'").get() as { terms_sha256: string };
    decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
    await executeAgentOnboard(db, awx, "P-0001");

    expect(text(await client.callTool({ name: "pay_with_card", arguments: { merchant: "TrailData Reports", amount_eur: "19.00", description: "Q4 report" } }))).toMatch(/^Airwallex approved 19\.00 EUR/);
    expect(text(await client.callTool({ name: "pay_with_card", arguments: { merchant: "TrailData Reports", amount_eur: "40.00", description: "bundle" } }))).toMatch(/^Airwallex declined 40\.00 EUR at TrailData Reports: LIMIT_EXCEEDED/);
    expect(text(await client.callTool({ name: "request_limit_raise", arguments: { per_purchase_eur: "40.00", reason: "the bundle" } }))).toMatch(/^Asked\. P-0002 waits/);
    // Malformed input is refused by the schema before any code runs.
    const bad = await client.callTool({ name: "pay_with_card", arguments: { merchant: "X", amount_eur: "1e9", description: "d" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
