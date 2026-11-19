// Discovery (19 Nov, integrations; docs/integrations/README.md): how another program finds out what Purser Cloud offers.
//
//   GET /openapi.json                  the API as OpenAPI 3.1 (the same document as /v1/openapi.json, at the usual place)
//   GET /api                           the API reference: the document rendered as one HTML page (no script at all)
//   GET /.well-known/agent.json        an A2A Agent Card (Google's Agent2Agent protocol): who Purser is, its skills, how
//   GET /.well-known/agent-card.json   to authenticate, where to call it (the newer name of the same card)
//
// Every skill on the card reads or proposes. None approves: approving is a signed-in person's passkey over the exact
// terms, in Purser Cloud. Purser does not run A2A task messaging (message/send); the card points to the MCP server and
// the REST API, which are what an agent calls.

import { randomToken } from "./crypto.js";
import { TAG_DESCRIPTIONS } from "./apiSpec.js";

export interface DiscoveryCtx { env: { origin: string; version?: string } }
export interface DiscoveryKit {
  json(status: number, body: unknown): Response;
  openApi(origin: string): Record<string, unknown>;
}
export interface DiscoveryRoute<C extends DiscoveryCtx> { method: "GET"; path: string; summary: string; need: "public"; run: (c: C) => Promise<Response> }

export const DISCOVERY_PATHS = ["/openapi.json", "/api", "/.well-known/agent.json", "/.well-known/agent-card.json"] as const;
export const isDiscoveryPath = (p: string): boolean => (DISCOVERY_PATHS as readonly string[]).includes(p);

const REPO = "https://github.com/agamemnon-coder/x402-business-agents";

/** A skill of the card: what it does, and where an agent calls it (an MCP tool, a REST operation of the OpenAPI document). */
export interface AgentSkill {
  id: string; name: string; description: string; tags: string[]; examples: string[];
  inputModes: string[]; outputModes: string[];
  /** Purser's own extension: the MCP tool and the OpenAPI operationIds that carry this skill, and what it may change. */
  "x-purser": { mcp_tools: string[]; operations: string[]; effect: "reads" | "proposes" };
}

export const AGENT_SKILLS: AgentSkill[] = [
  {
    id: "read-books", name: "Read the books",
    description: "Read the company's supplier invoices, payments, the transactions register, the ledger and its reports. Read only.",
    tags: ["accounts payable", "invoices", "ledger", "read-only"], examples: ["Which supplier invoices are due this week?", "Show invoice AP-0004."],
    inputModes: ["text/plain", "application/json"], outputModes: ["application/json"],
    "x-purser": { mcp_tools: ["list_invoices", "get_invoice", "list_transactions", "books_report", "company_overview"], operations: ["listInvoices", "getInvoice", "getMe"], effect: "reads" },
  },
  {
    id: "pending-approvals", name: "What waits for the CFO",
    description: "The invoices that can be proposed, and the payments that wait for the CFO's passkey, with supplier, amount and status. Read only.",
    tags: ["approvals", "read-only"], examples: ["What needs the CFO's signature?"],
    inputModes: ["text/plain", "application/json"], outputModes: ["application/json"],
    "x-purser": { mcp_tools: ["pending_approvals", "what_needs_attention"], operations: ["listPayableInvoices"], effect: "reads" },
  },
  {
    id: "propose-payment", name: "Propose an invoice's payment",
    description: "File a supplier invoice's payment for the CFO's approval. Nothing is paid until the CFO signs the exact terms with their passkey (within a pay-alone limit the CFO set, off unless set, the CFO's policy pays). Needs a key with the propose scope. The agent can never approve.",
    tags: ["payments", "proposal", "human-approval"], examples: ["Propose paying invoice AP-0004."],
    inputModes: ["application/json"], outputModes: ["application/json"],
    "x-purser": { mcp_tools: ["propose_invoice_payment"], operations: ["proposePayment"], effect: "proposes" },
  },
  {
    id: "proposal-status", name: "A proposal's status",
    description: "Where a payment proposal stands: waiting for the CFO's passkey, approved and paid, refused or expired, with the terms it is for. Read only.",
    tags: ["payments", "status", "read-only"], examples: ["Has P-0009 been approved?"],
    inputModes: ["text/plain", "application/json"], outputModes: ["application/json"],
    "x-purser": { mcp_tools: ["payment_proposal"], operations: ["getProposal"], effect: "reads" },
  },
];

/** The A2A Agent Card (protocol 0.3 fields). Built from the origin only: it names no company and holds no secret. */
export function agentCard(origin: string, version = "dev"): Record<string, unknown> {
  return {
    protocolVersion: "0.3.0",
    name: "Purser",
    description: "Purser pays a company's supplier invoices with AI agents. An agent may read the books and propose a payment; above the agents' limit the CFO signs the exact terms with a passkey, and one changed cent breaks the signature. No agent, key or chat message can approve. Test money only until a company goes live. This card is for discovery: call the skills over MCP (url) or the REST API (OpenAPI); Purser does not run A2A task messaging.",
    url: `${origin}/mcp`,
    version,
    provider: { organization: "Purser (open source, MIT)", url: REPO },
    documentationUrl: `${origin}/api`,
    iconUrl: `${origin}/icon.png`,
    capabilities: {
      streaming: false, pushNotifications: false, stateTransitionHistory: false,
      extensions: [{
        uri: `${REPO}/blob/main/docs/integrations/README.md#a2a-agent-card`,
        description: "Where Purser's skills are called: the MCP server and the REST API. Approving a payment is never one of them.",
        required: false,
        params: { mcp: `${origin}/mcp`, openapi: `${origin}/openapi.json`, rest_base: `${origin}/v1`, a2a_task_messaging: false, approves_payments: false },
      }],
    },
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", description: "A Purser API key (pck_…) with the read scope, and propose to file payments; at /mcp, a Claude connector token or an OAuth access token. Keys are made in Purser Cloud by an owner and shown once." },
    },
    security: [{ bearer: [] }],
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json"],
    skills: AGENT_SKILLS,
    supportsAuthenticatedExtendedCard: false,
  };
}

// --- The reference page ----------------------------------------------------------------------------------------------

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Op { summary?: string; operationId?: string; tags?: string[]; parameters?: { name: string; in: string; description?: string }[]; requestBody?: { content?: Record<string, { schema?: unknown }> }; "x-purser-needs"?: string; "x-purser-step-up"?: string; responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }

/** The OpenAPI document as one page: every operation by tag, with what it needs, its parameters and its body. No script. */
export function referencePage(spec: Record<string, unknown>, nonce: string): string {
  const paths = spec.paths as Record<string, Record<string, Op>>;
  const byTag = new Map<string, string[]>();
  for (const [path, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = op.tags?.[0] ?? "Company";
      const params = (op.parameters ?? []).map((p) => `<li><code>${esc(p.name)}</code> <span class="m">${esc(p.in)}</span>${p.description ? ` ${esc(p.description)}` : ""}</li>`).join("");
      const reqSchema = op.requestBody?.content?.["application/json"]?.schema;
      const okSchema = Object.entries(op.responses ?? {}).find(([s]) => s.startsWith("2"))?.[1]?.content?.["application/json"]?.schema;
      const html = `<article id="${esc(op.operationId ?? `${method}-${path}`)}"><h3><span class="v ${esc(method)}">${esc(method.toUpperCase())}</span> <code>${esc(path)}</code></h3>`
        + `<p>${esc(op.summary ?? "")}</p><p class="m">operationId <code>${esc(op.operationId ?? "")}</code> · needs <b>${esc(op["x-purser-needs"] ?? "")}</b>${op["x-purser-step-up"] ? ` · step-up: ${esc(op["x-purser-step-up"])}` : ""}</p>`
        + (params ? `<ul>${params}</ul>` : "")
        + (reqSchema ? `<details><summary>Request body</summary><pre>${esc(JSON.stringify(reqSchema, null, 2))}</pre></details>` : "")
        + (okSchema ? `<details><summary>Answer</summary><pre>${esc(JSON.stringify(okSchema, null, 2))}</pre></details>` : "")
        + "</article>";
      byTag.set(tag, [...(byTag.get(tag) ?? []), html]);
    }
  }
  const order = Object.keys(TAG_DESCRIPTIONS).filter((t) => byTag.has(t));
  const schemas = (spec.components as { schemas?: Record<string, unknown> } | undefined)?.schemas ?? {};
  const info = spec.info as { title: string; version: string; description: string };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purser API reference</title><style nonce="${nonce}">
:root{--bg:#fff;--fg:#1c1c1c;--muted:#5d5d5d;--line:#e3e3e3;--code:#f5f5f2;--accent:#0b5e3c}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#ececec;--muted:#a6a6a6;--line:#2c2c2c;--code:#1e1e1e;--accent:#6fd3a6}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:28px;margin:0 0 4px}h2{margin-top:40px;border-bottom:1px solid var(--line);padding-bottom:4px}h3{font-size:16px;margin:0 0 4px;word-break:break-all}
article{border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0}code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
pre{background:var(--code);padding:10px;border-radius:6px;overflow:auto}.m{color:var(--muted);font-size:14px}.v{display:inline-block;min-width:56px;font-weight:700;color:var(--accent)}
.safe{border-left:4px solid var(--accent);padding:8px 12px;background:var(--code)}a{color:var(--accent)}nav a{margin-right:12px}</style></head><body><main>
<h1>${esc(info.title)}</h1><p class="m">Version ${esc(info.version)} · OpenAPI 3.1 · <a href="/openapi.json">/openapi.json</a> · <a href="/.well-known/agent.json">A2A Agent Card</a> · <a href="${REPO}/blob/main/docs/integrations/README.md">Ways to connect</a></p>
<p>${esc(info.description)}</p>
<p class="safe"><b>The safety boundary.</b> A key reads (scope <code>read</code>) and files an invoice's payment for the CFO's approval (scope <code>propose</code>). No key, agent, integration or chat message approves: approving is a signed-in person's passkey over the exact terms, in Purser Cloud. Test money only until a company goes live.</p>
<nav>${order.map((t) => `<a href="#${esc(t.replace(/\W+/g, "-"))}">${esc(t)}</a>`).join("")}<a href="#schemas">Schemas</a></nav>
${order.map((t) => `<section><h2 id="${esc(t.replace(/\W+/g, "-"))}">${esc(t)}</h2><p class="m">${esc(TAG_DESCRIPTIONS[t])}</p>${byTag.get(t)!.join("")}</section>`).join("\n")}
<section><h2 id="schemas">Schemas</h2>${Object.entries(schemas).map(([n, s]) => `<details><summary><code>${esc(n)}</code></summary><pre>${esc(JSON.stringify(s, null, 2))}</pre></details>`).join("")}</section>
</main></body></html>`;
}

const pageHeaders = (nonce: string) => ({
  "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff",
  // No script runs here at all: styles by nonce, nothing else may load.
  "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
});

export function discoveryRoutes<C extends DiscoveryCtx>(kit: DiscoveryKit): DiscoveryRoute<C>[] {
  const card = async (c: C) => {
    const r = kit.json(200, agentCard(c.env.origin, c.env.version ?? "dev"));
    r.headers.set("cache-control", "public, max-age=300");
    // Read by agents and tools on other origins.
    r.headers.set("access-control-allow-origin", "*");
    return r;
  };
  return [
    { method: "GET", path: "/openapi.json", summary: "This API, as OpenAPI 3.1 (the same document as /v1/openapi.json).", need: "public", run: async (c) => {
      const r = kit.json(200, kit.openApi(c.env.origin));
      r.headers.set("access-control-allow-origin", "*");
      return r;
    } },
    { method: "GET", path: "/api", summary: "The API reference: the OpenAPI document as one HTML page (no script).", need: "public", run: async (c) => {
      const nonce = randomToken(16);
      return new Response(referencePage(kit.openApi(c.env.origin), nonce), { status: 200, headers: pageHeaders(nonce) });
    } },
    { method: "GET", path: "/.well-known/agent.json", summary: "The A2A Agent Card (Agent2Agent protocol): Purser's skills (read and propose; never approve), its auth scheme and where to call it.", need: "public", run: card },
    { method: "GET", path: "/.well-known/agent-card.json", summary: "The same A2A Agent Card at the newer well-known name.", need: "public", run: card },
  ];
}
