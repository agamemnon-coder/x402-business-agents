// The MCP agent interface's transcript for /claude (12 Nov): an outside agent connects to Purser's agent API over MCP
// and uses its tools, in-process, with no network: an in-memory ledger, a simulated card issuer (FakeIssuing, not
// Airwallex) and the CFO's approval given in code (not Face ID), each labelled in the record. No model is asked: the
// "agent" is this script, so every call and answer is the server's own.
//
//   npx tsx docs/runs/2026-11-12-mcp-transcript/make.mts > docs/runs/2026-11-12-mcp-transcript.json
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openDb } from "../../../src/db/open.js";
import { decide } from "../../../src/policy/approvals.js";
import { agentApiServer } from "../../../src/platform/mcpServer.js";
import { agentId, executeAgentOnboard } from "../../../src/platform/externalAgents.js";
import { FakeIssuing } from "../../../src/redteam/issuing.js";

const db = openDb(":memory:");
const awx = new FakeIssuing();
const id = agentId("acme-research");
const server = agentApiServer(db, id, awx);
const client = new Client({ name: "acme-research-agent", version: "1.0.0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
const steps: { call: string; arguments?: Record<string, unknown>; is_error: boolean; answer: string }[] = [];
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  steps.push({ call: name, ...(Object.keys(args).length ? { arguments: args } : {}), is_error: r.isError === true, answer: r.content.map((c) => c.text).join("\n") });
};
const info = client.getServerVersion();
const tools = (await client.listTools()).tools.map((t) => ({ name: t.name, read_only: t.annotations?.readOnlyHint === true }));
await call("pay_with_card", { merchant: "TrailData Reports", amount_eur: "19.00", description: "Q4 report" });
await call("request_company_card", { display_name: "Acme Research agent", purpose: "market reports", per_purchase_eur: "25.00", monthly_eur: "100.00" });
const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-0001'").get() as { terms_sha256: string };
decide(db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
await executeAgentOnboard(db, awx, "P-0001");
const approval = { proposal: "P-0001", by: "the CFO's approval given in code for this transcript (method cli), not Face ID", then: "the runner issued the card on the simulated issuer" };
await call("pay_with_card", { merchant: "TrailData Reports", amount_eur: "19.00", description: "Q4 report" });
await call("pay_with_card", { merchant: "TrailData Reports", amount_eur: "40.00", description: "bundle" });
await call("request_limit_raise", { per_purchase_eur: "40.00", reason: "the bundle" });
await client.close();
const out = {
  title: "Purser's agent API over MCP: one outside agent's session, in-process",
  made_on: "2026-11-12", made_by: "docs/runs/2026-11-12-mcp-transcript/make.mts",
  server: { name: info?.name ?? null, version: info?.version ?? null },
  stand_ins: ["an in-memory ledger", "FakeIssuing, a simulated card issuer (not Airwallex; the server's answers name Airwallex all the same)", "the CFO's approval given in code (not Face ID)", "no model: the agent is the script"],
  network: "none",
  tools, steps, approval_between: { after_step: 2, ...approval },
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
