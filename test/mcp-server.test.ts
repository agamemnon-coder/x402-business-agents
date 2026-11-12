// P1 over MCP: a client connects to the agent API as one outside agent and sees only tools that ask, pay within the
// card's limits, or read. The whole path: ask for a card, wait for the CFO, pay, get declined, ask for a raise.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { agentId, executeAgentOnboard, requestCompanyCard } from "../src/platform/externalAgents.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { redactJson, redactSecrets } from "../src/lib/redact.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { ClaudeReader } from "../src/claude/reader.js";

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

describe("the agent API over MCP (P1)", () => {
  it("offers five tools, none of which can approve; the card comes only after the CFO's approval", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const id = agentId("acme-research");
    const server = agentApiServer(db, id, awx);
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["ask_for_task_card", "company_card", "pay_with_card", "request_company_card", "request_limit_raise"]);
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

describe("an agent asking Purser for a task card over MCP (G)", () => {
  // Breaks if an agent's own request is issued at once: it is always a proposal for the CFO's Face ID.
  it("turns the agent's request into a proposal by that agent, never a card", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    const id = agentId("trail-bot");
    const server = agentApiServer(db, id, awx, new ClaudeReader(db, null));
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "ask_for_task_card", arguments: { message: "I need a train ticket to Antwerp for the retailer visit, at most €40" } });
    expect(text(r)).toMatch(/^I proposed P-0001: a single-use train card, at most 40\.00 EUR/);
    expect(db.prepare("SELECT kind, created_by FROM proposals").all()).toEqual([{ kind: "task_card", created_by: id }]);
    expect(awx.cards).toHaveLength(0);
  });
});

/** A client connected as one outside agent whose company card the CFO has approved and the runner has issued. */
async function withCard(name = "acme-research") {
  const db = openDb(":memory:");
  const awx = new FakeIssuing();
  const id = agentId(name);
  requestCompanyCard(db, id, { displayName: "Acme Research agent", purpose: "market reports", perTx: "25.00", monthly: "100.00" });
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-0001'").get() as { terms_sha256: string };
  decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
  await executeAgentOnboard(db, awx, "P-0001");
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([agentApiServer(db, id, awx, new ClaudeReader(db, null)).connect(a), client.connect(b)]);
  return { db, awx, id, client };
}

type Result = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const pay = (client: Client, merchant: string, amount_eur: string) =>
  client.callTool({ name: "pay_with_card", arguments: { merchant, amount_eur, description: "Q4 report" } }) as Promise<Result>;

describe("what an outside agent reads back (the agent API's results)", () => {
  // Breaks if the server still announces an old product name to the clients that connect to it.
  it("announces itself as purser-agent-api", async () => {
    const { client } = await withCard();
    expect(client.getServerVersion()?.name).toBe("purser-agent-api");
    await client.close();
  });

  // Breaks if a decline comes back as an ordinary result an agent must parse prose to understand, or if the sentence
  // the agent has always read changes.
  it("returns a limit decline as a refusal with a structured object that names the next tool", async () => {
    const { client } = await withCard();
    const r = await pay(client, "TrailData Reports", "40.00");
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/^Airwallex declined 40\.00 EUR at TrailData Reports: LIMIT_EXCEEDED/);
    const declined = { approved: false, refused_by: "airwallex", reason: "LIMIT_EXCEEDED", amount_eur: "40.00", merchant: "TrailData Reports", next_tool: "request_limit_raise" };
    expect(r.structuredContent).toEqual(declined);
    expect(r.content[1]).toEqual({ type: "text", text: JSON.stringify(declined) });
    await client.close();
  });

  it("returns an approved charge with its transaction id, not as a refusal", async () => {
    const { client, awx } = await withCard();
    const r = await pay(client, "TrailData Reports", "19.00");
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toMatch(/^Airwallex approved 19\.00 EUR at TrailData Reports \(transaction /);
    expect(r.structuredContent).toEqual({ approved: true, amount_eur: "19.00", merchant: "TrailData Reports", transaction_id: awx.txs[0]!.transactionId });
    await client.close();
  });

  // Breaks if Purser's own refusal (the agent's identity was revoked, say) loses its code, or reads like Airwallex's.
  it("returns Purser's own refusal with its code", async () => {
    const { client, db, id } = await withCard();
    revokePrincipal(db, id, "the contract ended", "max");
    const r = await pay(client, "TrailData Reports", "19.00");
    expect(r.isError).toBe(true);
    const sentence = r.content[0]!.text;
    expect(sentence).toMatch(/^principal_revoked: /);
    expect(r.structuredContent).toEqual({ refused: true, refused_by: "purser", code: "principal_revoked", message: sentence.slice(sentence.indexOf(":") + 1).trim() });
    expect(r.content[1]).toEqual({ type: "text", text: JSON.stringify(r.structuredContent) });
    await client.close();
  });

  // Breaks if a frozen card points the agent at a limit raise: no raise unfreezes a card the CFO stopped.
  it("names no next tool when the card is frozen", async () => {
    const { client, awx } = await withCard();
    await awx.setCardStatus(awx.cards[0]!.cardId, "INACTIVE");
    const r = await pay(client, "TrailData Reports", "19.00");
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ approved: false, refused_by: "airwallex", reason: "CARD_INACTIVE" });
    expect(r.structuredContent).not.toHaveProperty("next_tool");
    await client.close();
  });

  // Breaks if a credential the runner holds can come back to the agent in a sentence or in the structured object.
  it("never hands a secret back to the agent", async () => {
    const fake = "fake-airwallex-key-for-this-test-0123";
    vi.stubEnv("AIRWALLEX_API_KEY", fake);
    try {
      const { client, db, id } = await withCard();
      const results = [await pay(client, `Shop ${fake}`, "19.00"), await pay(client, `Shop ${fake}`, "40.00")];
      revokePrincipal(db, id, `leaked ${fake}`, "max");
      results.push(await pay(client, "TrailData Reports", "19.00"));
      for (const r of results) {
        expect(r.structuredContent).toBeDefined();
        expect(r.structuredContent).toEqual(redactJson(r.structuredContent));
        for (const c of r.content) expect(c.text).toBe(redactSecrets(c.text));
        expect(JSON.stringify(r)).not.toContain(fake);
      }
      await client.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
