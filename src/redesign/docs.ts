// /docs, "Docs and API" (12 Nov): one page for a developer or integrator. Four cards: the agent API (an MCP server),
// the Purser Cloud REST API, payments between agents and Airwallex's webhooks, and how to run it offline. Nothing is
// typed in: the tools are the MCP server's own (asked from the server where the page is built, so the page cannot drift
// from the code), the commands are package.json's, each variable name is checked against the file that reads it, and
// every link goes to a file of the repository. Names only, never a value. Sandbox and testnet only. No script.

import type { ClaudeReader } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { agentApiServer } from "../platform/mcpServer.js";
import { foldHtml, outLink, productPage, repoHref, repoText } from "./productPage.js";
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
const head = (ic: string, title: string, pill = "") => `<h2><span class="ic">${icon(ic, 19)}</span>${esc(title)}${pill ? `<span class="pill">${esc(pill)}</span>` : ""}</h2>`;

export function docsPage(o: { cloudDemoUrl?: string | null } = {}): string {
  const tools = agentTools(), env = envNames();
  const demo = o.cloudDemoUrl === undefined ? CLOUD_DEMO_URL : o.cloudDemoUrl;
  if (!repoText("src/platform/mcpServer.ts").includes(NO_TOOL)) throw new Error("src/platform/mcpServer.ts no longer says what no tool can do");
  if (!repoText(CLOUD_ROUTES).includes(`path: "${CLOUD_OPENAPI_PATH}"`)) throw new Error(`${CLOUD_ROUTES} no longer serves ${CLOUD_OPENAPI_PATH}`);
  if (!repoText(CONNECT_DOC).includes(`\`${DEMO_CONNECTOR_TOKEN}\``) || !repoText("cloud/src/auth.ts").includes(`DEMO_CONNECTOR_TOKEN = "${DEMO_CONNECTOR_TOKEN}"`)) throw new Error("the demo company's connector token is not the one the cloud and its guide name");
  if (!repoText("cloud/src/claude/routes.ts").includes('path: "/connect-ai"')) throw new Error("the cloud no longer serves /connect-ai");
  if (!repoText("cloud/src/connections.ts").includes("export function connectionsCatalogue")) throw new Error("cloud/src/connections.ts no longer lists the connections");
  if (!repoText(CLOUD_DOC).replace(/\*\*/g, "").replace(/\s+/g, " ").includes(CLOUD_PREVIEW_LINE)) throw new Error(`${CLOUD_DOC} no longer says what the preview is`);
  const body = `<div class="cols c2">
  <article class="pc card wide" id="connect-ai">${head("link-2", "Connect your AI")}
    <p><b>Connect your AI:</b> ${code(PURSER_CLOUD_MCP)}, ${readToolCount()} read tools, demo token ${code(DEMO_TOKEN)}. Claude, Cursor, VS Code or Gemini CLI reads your books over MCP and can propose a payment; only the CFO's Face ID approves one. <b>Try as guest</b> in Purser Cloud opens the same read-only demo company.</p>
    <div class="links">${outLink(CONNECT_PAGE, "Setup for each AI")}${outLink(PURSER_CLOUD_URL, "Open Purser Cloud (test money)")}${outLink(repoHref(CONNECT_DOC), "The connector's guide")}</div>
    ${foldHtml("Open Purser Cloud as guest, connect Claude", [
      `Open Purser Cloud and choose <b>Try as guest</b>. No passkey, no e-mail.`,
      `claude.ai or Claude Desktop: Settings, Connectors, <b>Add custom connector</b>. Paste ${code(PURSER_CLOUD_MCP)}. On Purser's sign-in page choose <b>Use the demo company</b>.`,
      `Claude Code: ${code(`claude mcp add --transport http purser ${PURSER_CLOUD_MCP} --header "Authorization: Bearer ${DEMO_TOKEN}"`)}`,
      `Then ask "what's waiting for the CFO?". The demo token reads and proposes nothing.`,
    ])}
    ${foldHtml("Connections: read or export only", [
      `Live: the MCP server, the read API and its OpenAPI (${code("/v1/openapi.read.json")}), signed webhooks for ${code("payment.paid")}, ${code("approval.needed")} and ${code("books.closed")}.`,
      "Format exports, not live integrations: Xero, QuickBooks Online and Exact Online CSV, Slack and Teams messages, an ISO payment message.",
      `From the runner: Moneybird's API (run once in a sandbox) and Exact Online's API (built, not tested live). ${outLink(repoHref(CONNECTIONS_DOC), "Every connection, labelled")}`,
    ])}</article>
  <article class="pc card fd wide" id="agent-api">${head("bot", "Outside-agent card API (local)")}
    <p>An outside agent works under the CFO's policy through these tools. ${esc(NO_TOOL.replace(/^n/, "N"))}.</p>
    <ul class="pl">${tools.map((t) => `<li data-tool="${esc(t.name)}">${code(t.name)} ${esc(t.title)}</li>`).join("")}</ul>
    <p>Run it: ${code(MCP_COMMAND)}</p>
    <p class="sub">It reads ${env.map((e) => code(e.name)).join(", ")}.</p>
    <div class="links">${outLink(repoHref(AGENT_API_DOC, "#outside-agents-the-agent-api-mcp"), "The agent API guide")}</div>
    ${foldHtml("What each tool does", tools.map((t) => `${code(t.name)}: ${esc(t.description)}`))}
    ${foldHtml("What each variable is", env.map((e) => `${code(e.name)}: ${esc(e.what)}`))}</article>
  <article class="pc card" id="cloud-api">${head("database", "Purser Cloud REST API", demo ? "" : "Test preview")}
    <p>One JSON API for invoices, suppliers, payments and the ledger. Its OpenAPI document, ${code(CLOUD_OPENAPI_PATH)}, is built from the route table.${demo ? "" : " It runs publicly as a test preview: test companies, test money on a simulated bank."}</p>
    <div class="links">${outLink(repoHref(CLOUD_DOC, "#the-api"), "The API reference")}${outLink(repoHref(CLOUD_ROUTES), "The route table")}${demo ? outLink(demoOpenApi(demo), "OpenAPI on the demo (test money)") : outLink(TRY_URL, "The test preview")}</div></article>
  <article class="pc card" id="payments">${head("arrow-left-right", "Payments and webhooks")}
    <ul class="pl"><li>Agents pay each other per request over x402, on Alta's testnet. ${outLink(repoHref(X402_DOC, X402_ANCHOR), "x402 on Alta")}</li><li>Airwallex's sandbox sends its webhooks to the relay, which checks each signature. ${outLink(repoHref(WEBHOOKS_DOC, WEBHOOKS_ANCHOR), "Airwallex webhooks")}</li></ul></article>
  <article class="pc card wide" id="offline">${head("play", "Run it yourself, offline")}
    <p>${code(JUDGE_COMMAND)} serves this site's pages on your computer from the recorded run, with no keys.</p>
    <div class="links">${outLink(repoHref(README, README_ANCHOR), "The README")}</div></article>
</div>`;
  return productPage({
    key: "docs", title: "Docs and API", h1: "Docs and API", label: "Sandbox and testnet only",
    lead: "For developers and integrators.",
    description: "Purser for developers: the agent API's tools (an MCP server), the Purser Cloud REST API and its OpenAPI document, x402 payments between agents, Airwallex webhooks, and how to run it offline. Sandbox and testnet only.",
    body,
    source: `Source: src/platform/mcpServer.ts (the tools), package.json (the commands), ${CLOUD_ROUTES} and the docs each link names.`,
    real: [
      "Sandbox and testnet only: Airwallex's sandbox, Alta's testnet, test money.",
      "The tools are read from the agent API's own code where this page is built.",
      "Purser Cloud runs publicly as a test preview at purser-try.max-31b.workers.dev/try: test companies, test money on a simulated bank. Its console's hosted preview exists but is private (behind an access key); no customer uses it.",
    ],
  });
}
