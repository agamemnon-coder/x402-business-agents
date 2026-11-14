// /docs, "Docs and API" (12 Nov): one page for a developer or integrator. Four cards: the agent API (an MCP server),
// the Purser Cloud REST API, payments between agents and Airwallex's webhooks, and how to run it offline. Nothing is
// typed in: the tools are the MCP server's own (asked from the server where the page is built, so the page cannot drift
// from the code), the commands are package.json's, each variable name is checked against the file that reads it, and
// every link goes to a file of the repository. Names only, never a value. Sandbox and testnet only. No script.

import type { ClaudeReader } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { agentApiServer } from "../platform/mcpServer.js";
import { foldHtml, outLink, productPage, repoHref, repoText } from "./productPage.js";
import { PROOF_CHAIN_CSS, proofChainHtml, type ChainStep } from "./proofRuns.js";
import { COPY_JS } from "./runs.js";
import { TRY_URL, esc, icon } from "./ui.js";
import { DEMO_CONNECTOR_TOKEN, PURSER_CLOUD_MCP, PURSER_CLOUD_URL } from "../ui/more.js";

// The agent API.

export interface ApiTool { name: string; title: string; description: string }

/**
 * The agent API's tools, as src/platform/mcpServer.ts registers them: the server is built here (no tool is called, so
 * it needs no ledger, no key and no reader) and its own list is read, in the order of the code. test/saas-status-docs
 * asks the same server over the protocol and holds this list to the answer.
 */
export function agentTools(): ApiTool[] {
  const server = agentApiServer({} as DB, "ext:docs", null, {} as ClaudeReader, "");
  const registered = (server as unknown as { _registeredTools?: Record<string, { title?: string; description?: string; enabled?: boolean }> })._registeredTools;
  const tools = Object.entries(registered ?? {}).filter(([, t]) => t.enabled !== false).map(([name, t]) => {
    if (!t.title || !t.description) throw new Error(`src/platform/mcpServer.ts: the tool ${name} has no title or no description`);
    return { name, title: t.title, description: t.description };
  });
  if (!tools.length) throw new Error("src/platform/mcpServer.ts: the server's tools could not be read");
  return tools;
}

/** The npm script that runs `command`, by its name in package.json; none: an error, never a guess. */
function npmScript(command: string): string {
  const scripts = (JSON.parse(repoText("package.json")) as { scripts: Record<string, string> }).scripts;
  const name = Object.keys(scripts).find((k) => scripts[k] === command);
  if (!name) throw new Error(`package.json has no script that runs: ${command}`);
  return name;
}
/** The agent API on stdio (src/cli/mcp.ts); -s keeps npm's own lines off stdout, which is the MCP channel. */
export const MCP_COMMAND = `npm run -s ${npmScript("tsx src/cli/mcp.ts")}`;
export const JUDGE_COMMAND = `npm run ${npmScript("tsx src/cli/judge.ts")}`;

export interface EnvName { name: string; what: string; /** The file that reads it from the environment. */ source: string }
/** The variables the agent API reads, by name (src/cli/mcp.ts says which): never a value. */
export const MCP_ENV: readonly EnvName[] = [
  { name: "KIT11_AGENT", what: "the name of the outside agent this server serves", source: "src/cli/mcp.ts" },
  { name: "KIT11_AGENT_KEY", what: "the agent's key, once one was issued; a rotated or missing key is refused", source: "src/platform/mcpServer.ts" },
  { name: "KIT11_DB", what: "the runner's ledger file", source: "src/db/open.ts" },
  { name: "AIRWALLEX_CLIENT_ID", what: "the Airwallex sandbox keys' client id", source: "src/airwallex/client.ts" },
  { name: "AIRWALLEX_API_KEY", what: "the Airwallex sandbox key; without the two, no card can be charged", source: "src/airwallex/client.ts" },
];
/** Each name, checked against the file that reads it; a file that no longer reads it is an error. */
function envNames(): readonly EnvName[] {
  for (const e of MCP_ENV) if (!new RegExp(`\\benv\\.${e.name}\\b`).test(repoText(e.source))) throw new Error(`${e.source} no longer reads ${e.name}`);
  return MCP_ENV;
}
const AGENT_API_DOC = "docs/agent-api.md";
/** What no tool can do, as the server's own file says it (checked where the page is built). */
const NO_TOOL = "no tool approves, sets a limit or touches another agent's card";

// The Purser Cloud REST API.

/**
 * A public demo of Purser Cloud's API, when there is one: its address (https). Unset for now: the page links the hands-on
 * test preview (TRY_URL) and the repository. Once set, the page also links the demo's OpenAPI document.
 */
export const CLOUD_DEMO_URL: string | null = null;
/** The OpenAPI document's route (cloud/src/app.ts builds it from its route table). */
export const CLOUD_OPENAPI_PATH = "/v1/openapi.json";
const CLOUD_DOC = "docs/cloud.md", CLOUD_ROUTES = "cloud/src/app.ts";
/** One statement wherever Purser Cloud's status is said (jury check, 12 Nov): docs/cloud.md, this page, the form. */
export const CLOUD_PREVIEW_LINE = "Purser Cloud runs publicly as a test preview at purser-try.max-31b.workers.dev/try: test companies, test money on a simulated bank. Its console's hosted preview exists but is private (behind an access key); no customer uses it.";

/** The demo's OpenAPI address; only an https address is ever linked. */
function demoOpenApi(url: string): string {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error(`the Purser Cloud demo address must be https: ${url}`);
  return `${u.origin}${CLOUD_OPENAPI_PATH}`;
}

// Payments and webhooks; offline.

const X402_DOC = "docs/metal-award.md", X402_ANCHOR = "#3-x402-on-alta-agents-pay-per-request";
const WEBHOOKS_DOC = "docs/airwallex.md", WEBHOOKS_ANCHOR = "#webhooks";
const README = "README.md", README_ANCHOR = "#verify-it-yourself-in-3-commands";
/** Connect your AI (owner, 13 Nov): the connector's own guide, and the demo company's public read-only token. */
const CONNECT_DOC = "docs/connect-claude.md", DEMO_TOKEN = DEMO_CONNECTOR_TOKEN;
/** The cloud's per-client setup page (cloud/src/claude/connectPage.ts) and the connections guide (13 Nov). */
const CONNECT_PAGE = `${PURSER_CLOUD_URL}connect-ai`, CONNECTIONS_DOC = "docs/connections.md";

/** The cloud MCP server's read tools, counted from its own list (cloud/src/claude/mcp.ts READ_TOOLS), so the number
 *  /docs gives follows the server when tools are added. */
export function readToolCount(): number {
  const t = repoText("cloud/src/claude/mcp.ts"), a = t.indexOf("const READ_TOOLS"), b = t.indexOf("\n];", a);
  const n = a < 0 || b < 0 ? 0 : (t.slice(a, b).match(/\n {2}\{\n/g) ?? []).length;
  if (!n) throw new Error("cloud/src/claude/mcp.ts no longer has a READ_TOOLS list to count");
  return n;
}

const code = (s: string) => `<code>${esc(s)}</code>`;
const head = (ic: string, title: string, pill = "") => `<h2><span class="ic">${icon(ic, 22)}</span>${esc(title)}${pill ? `<span class="pill">${esc(pill)}</span>` : ""}</h2>`;
/** A value to paste, with a copy button (Max, 14 Nov: "less text, more clear and concrete"). The button needs the
 *  clipboard, so without it (or without script) it is hidden and the value stays selectable. */
const chip = (label: string, value: string) => `<span class="cchip"><span class="k">${esc(label)}</span>${code(value)}<button type="button" class="cp" data-copy="${esc(value)}" aria-label="${esc(`Copy ${label.toLowerCase()}`)}">${icon("copy", 15)}</button></span>`;
/** The AI clients the connector's guide names (docs/connect-claude.md), as small chips. */
export const WORKS_WITH = ["Claude", "Cursor", "VS Code", "Gemini CLI"] as const;
/**
 * Each tool's purpose in a few words, for the grid (Max, 14 Nov). Keyed by the server's own names: a tool the code adds
 * without one here is an error where the page is built, so the grid never drops or invents a tool. The title and the
 * description, the code's own words, are in the fold.
 */
export const TOOL_PURPOSE: Readonly<Record<string, string>> = {
  request_company_card: "Ask for a card",
  company_card: "Show my card",
  pay_with_card: "Pay a merchant",
  request_limit_raise: "Ask a higher limit",
  ask_for_task_card: "A card per task",
};
/** The path of a request, from your AI to the rails: what /docs draws above the cards. */
export const DOCS_FLOW: readonly ChainStep[] = [
  { icon: "bot", title: "Your AI", text: "Asks" },
  { icon: "link-2", title: "MCP", text: "Read only" },
  { icon: "database", title: "Purser", text: "Checks" },
  { icon: "scan-face", title: "CFO's Face ID", text: "Approves" },
  { icon: "landmark", title: "The rails", text: "Pay" },
];

export const DOCS_CSS = `${PROOF_CHAIN_CSS}
@media (min-width: 761px) { ol.pchain.n5 { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
ol.pchain.n5 { margin: 0; }
.pc .promise { font-size: 17px; font-weight: 600; line-height: 1.45; }
.chips { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; }
.cchip { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; min-width: 0; padding: 0 0 0 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--sunken); }
.cchip .k { font-size: 13px; font-weight: 650; color: var(--muted); white-space: nowrap; }
.cchip code { min-width: 0; overflow-wrap: anywhere; }
.cchip .cp { flex: none; width: 44px; height: 44px; border: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 10px; display: inline-grid; place-items: center; }
.cchip .cp:hover { color: var(--text); } .cchip .cp.ok { color: var(--ok); }
.ww { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); }
.ww li { padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 600; }
.ww li.l { padding: 0; border: 0; background: none; color: var(--muted); font-weight: 600; }
ul.tools { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 600px) { ul.tools { grid-template-columns: minmax(0, 1fr); } }
ul.tools li { display: grid; gap: 1px; font-size: 14.5px; line-height: 1.35; color: var(--muted); padding: 8px 10px; border-radius: 10px; background: var(--sunken); min-width: 0; }
ul.tools li code { color: var(--text); font-size: 13.5px; }`;

export function docsPage(o: { cloudDemoUrl?: string | null } = {}): string {
  const tools = agentTools(), env = envNames();
  const demo = o.cloudDemoUrl === undefined ? CLOUD_DEMO_URL : o.cloudDemoUrl;
  if (!repoText("src/platform/mcpServer.ts").includes(NO_TOOL)) throw new Error("src/platform/mcpServer.ts no longer says what no tool can do");
  if (!repoText(CLOUD_ROUTES).includes(`path: "${CLOUD_OPENAPI_PATH}"`)) throw new Error(`${CLOUD_ROUTES} no longer serves ${CLOUD_OPENAPI_PATH}`);
  if (!repoText(CONNECT_DOC).includes(`\`${DEMO_CONNECTOR_TOKEN}\``) || !repoText("cloud/src/auth.ts").includes(`DEMO_CONNECTOR_TOKEN = "${DEMO_CONNECTOR_TOKEN}"`)) throw new Error("the demo company's connector token is not the one the cloud and its guide name");
  if (!repoText("cloud/src/claude/routes.ts").includes('path: "/connect-ai"')) throw new Error("the cloud no longer serves /connect-ai");
  if (!repoText("cloud/src/connections.ts").includes("export function connectionsCatalogue")) throw new Error("cloud/src/connections.ts no longer lists the connections");
  if (!repoText(CLOUD_DOC).replace(/\*\*/g, "").replace(/\s+/g, " ").includes(CLOUD_PREVIEW_LINE)) throw new Error(`${CLOUD_DOC} no longer says what the preview is`);
  for (const t of tools) if (!TOOL_PURPOSE[t.name]) throw new Error(`docs.ts: the tool ${t.name} has no purpose for the grid`);
  for (const c of WORKS_WITH) if (!repoText(CONNECT_DOC).includes(c)) throw new Error(`${CONNECT_DOC} no longer names ${c}`);
  // Max, 14 Nov: "less text, more clear and concrete". One promise per card, the values to paste as chips with a copy
  // button, the clients as chips, the tools as a grid; the steps, the variables and each tool's words stay folded.
  const body = `${proofChainHtml(DOCS_FLOW).replace('<ol class="pchain"', '<ol class="pchain n5"').replace('aria-label="The proof chain"', 'aria-label="From your AI to the rails"')}
<div class="cols c2">
  <article class="pc card wide" id="connect-ai">${head("link-2", "Connect your AI")}
    <p class="promise">Your AI reads the books; only the CFO's Face ID approves.</p>
    <div class="chips">${chip("MCP", PURSER_CLOUD_MCP)}${chip("Demo token", DEMO_TOKEN)}</div>
    <ul class="ww"><li class="l">${readToolCount()} read tools · works with</li>${WORKS_WITH.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    <div class="links">${outLink(CONNECT_PAGE, "Setup for each AI")}${outLink(PURSER_CLOUD_URL, "Purser Cloud (test money)")}</div>
    ${foldHtml("Connect Claude, step by step", [
      `Open Purser Cloud and choose <b>Try as guest</b>. No passkey, no e-mail.`,
      `claude.ai or Claude Desktop: Settings, Connectors, <b>Add custom connector</b>. Paste ${code(PURSER_CLOUD_MCP)}. On Purser's sign-in page choose <b>Use the demo company</b>.`,
      `Claude Code: ${code(`claude mcp add --transport http purser ${PURSER_CLOUD_MCP} --header "Authorization: Bearer ${DEMO_TOKEN}"`)}`,
      `Then ask "what's waiting for the CFO?". The demo token reads and proposes nothing.`,
      outLink(repoHref(CONNECT_DOC), "The connector's guide"),
    ])}
    ${foldHtml("Other connections", [
      `Live: the MCP server, the read API and its OpenAPI (${code("/v1/openapi.read.json")}), signed webhooks for ${code("payment.paid")}, ${code("approval.needed")} and ${code("books.closed")}.`,
      "Format exports, not live integrations: Xero, QuickBooks Online and Exact Online CSV, Slack and Teams messages, an ISO payment message.",
      `From the runner: Moneybird's API (run once in a sandbox) and Exact Online's API (built, not tested live). ${outLink(repoHref(CONNECTIONS_DOC), "Every connection, labelled")}`,
    ])}</article>
  <article class="pc card fd wide" id="agent-api">${head("bot", "Outside-agent card API (local)")}
    <p class="promise">Outside agents work under the CFO's policy.</p>
    <ul class="tools">${tools.map((t) => `<li data-tool="${esc(t.name)}"><code>${esc(t.name)}</code> ${esc(TOOL_PURPOSE[t.name]!)}</li>`).join("")}</ul>
    <div class="chips">${chip("Run", MCP_COMMAND)}</div>
    ${foldHtml("What each tool does", [esc(`${NO_TOOL.replace(/^n/, "N")}.`), ...tools.map((t) => `${code(t.name)}, ${esc(t.title)}: ${esc(t.description)}`), outLink(repoHref(AGENT_API_DOC, "#outside-agents-the-agent-api-mcp"), "The agent API guide")])}
    ${foldHtml("Variables it reads", env.map((e) => `${code(e.name)}: ${esc(e.what)}`))}</article>
  <article class="pc card" id="cloud-api">${head("database", "Purser Cloud REST API", demo ? "" : "Test preview")}
    <p class="promise">One JSON API for invoices, suppliers, payments and the ledger.</p>
    <div class="chips">${chip("OpenAPI", CLOUD_OPENAPI_PATH)}</div>
    <div class="links">${outLink(repoHref(CLOUD_DOC, "#the-api"), "The API reference")}${demo ? outLink(demoOpenApi(demo), "OpenAPI on the demo (test money)") : ""}</div>
    ${foldHtml("Where it runs", [`${demo ? "" : "It runs publicly as a test preview: test companies, test money on a simulated bank. "}The OpenAPI document is built from ${outLink(repoHref(CLOUD_ROUTES), "the route table")}.`, ...(demo ? [] : [outLink(TRY_URL, "The test preview")])])}</article>
  <article class="pc card" id="payments">${head("arrow-left-right", "Payments and webhooks")}
    <ul class="pl"><li>x402 payments between agents, on Alta's testnet. ${outLink(repoHref(X402_DOC, X402_ANCHOR), "x402 on Alta")}</li><li>Airwallex's sandbox webhooks, each signature checked. ${outLink(repoHref(WEBHOOKS_DOC, WEBHOOKS_ANCHOR), "Airwallex webhooks")}</li></ul></article>
  <article class="pc card wide" id="offline">${head("play", "Run it yourself, offline")}
    <p class="promise">This site offline, from the recorded run, no keys.</p>
    <div class="chips">${chip("Run", JUDGE_COMMAND)}</div>
    <div class="links">${outLink(repoHref(README, README_ANCHOR), "The README")}</div></article>
</div>`;
  return productPage({
    key: "docs", title: "Docs and API", h1: "Docs and API", label: "Sandbox and testnet only",
    lead: "For developers and integrators.",
    description: "Purser for developers: the agent API's tools (an MCP server), the Purser Cloud REST API and its OpenAPI document, x402 payments between agents, Airwallex webhooks, and how to run it offline. Sandbox and testnet only.",
    body, css: DOCS_CSS, js: COPY_JS,
    source: `Source: src/platform/mcpServer.ts (the tools), package.json (the commands), ${CLOUD_ROUTES} and the docs each link names.`,
    real: [
      "Sandbox and testnet only: Airwallex's sandbox, Alta's testnet, test money.",
      "The tools are read from the agent API's own code where this page is built.",
      "Purser Cloud runs publicly as a test preview at purser-try.max-31b.workers.dev/try: test companies, test money on a simulated bank. Its console's hosted preview exists but is private (behind an access key); no customer uses it.",
    ],
  });
}
