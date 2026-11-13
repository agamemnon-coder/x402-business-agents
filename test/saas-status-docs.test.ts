// The other two product pages under "More" (12 Nov): /docs ("Docs and API") and /status. Nothing on them is typed in by
// hand. /docs lists the agent API's tools as the code defines them (asked from the MCP server itself here, over the
// protocol), the command and the variable names from package.json and the code, and links only to files that exist.
// /status starts neutral and turns positive only on a well-formed answer of the site's own /health; a failed or odd
// answer says so, and the page can never show a false "all good". Its list of runs is /runs' own.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import vm from "node:vm";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHECK_PATHS, startJudge } from "../src/cli/judge.js";
import { TRY_URL } from "../src/redesign/ui.js";
import { openDb } from "../src/db/open.js";
import { agentId } from "../src/platform/externalAgents.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { CLOUD_DEMO_URL, CLOUD_PREVIEW_LINE, CLOUD_OPENAPI_PATH, MCP_COMMAND, MCP_ENV, agentTools, docsPage } from "../src/redesign/docs.js";
import { LIVE_RUN_EXPECTED_MS, RUNNER_DOWN_AFTER_MS } from "../src/ops/publicHealth.js";
import { RUNS_TITLE, liveRuns } from "../src/redesign/runs.js";
import { STATUS_RUNS, latestRuns, runLabels, statusPage } from "../src/redesign/status.js";
import { buildPages } from "../src/relay/assets.js";
import { sqlOver, startLocalRelay } from "../src/relay/local.js";
import { buildRelayState, stateHash } from "../src/relay/state.js";
import { DOCS_CSP, DOCS_PAGE, STATUS_CSP, STATUS_OFFLINE_CSP, STATUS_PAGE, STATUS_PAGE_OFFLINE } from "../src/servers/dashboard.js";
import { SITE_URL } from "../src/ui/meta.js";
import { Relay, pageResponse, type Pages } from "../worker/src/core.js";
import { HEADER_PATHS } from "./security-headers.rules.js";
import { scriptBlocks, scriptBody } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
// "&amp;" last, so an escaped entity ("&amp;lt;") is decoded once, never twice.
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The page's <main> as a person reads it with every fold open: tags out, entities decoded, white space single. */
const mainText = (html: string) => decode((/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The words in sight, as test/site-v4.test.ts counts them: <main>, no drawing, a fold as its summary only. */
function visibleWords(html: string): number {
  let main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? html;
  for (let prev = ""; prev !== main;) { prev = main; main = main.replace(/<svg\b[^>]*>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, " "); }
  const text = main.replace(/<details\b[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, " $1 ").replace(/<[^>]+>/g, " ");
  return decode(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
/** A piece of a page as a person reads it. */
const plain = (piece: string) => mainText(`<main>${piece}</main>`);
/** One card of a page, by its id. */
const card = (html: string, id: string) => new RegExp(`<article class="pc card[^"]*" id="${id}"[^>]*>[\\s\\S]*?</article>`).exec(html)?.[0] ?? "";
const NUM = /\d+(?:[.,]\d+)*/g;
const numbers = (text: string) => [...new Set(text.match(NUM) ?? [])];
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The repository files a page links to on GitHub, each with its #anchor (or ""). */
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const repoLinks = (html: string) => [...html.matchAll(new RegExp(`href="${reEscape(REPO)}([^"#]+)(#[^"]*)?"`, "g"))].map((m) => ({ file: m[1]!, anchor: (m[2] ?? "").slice(1) }));
/** A Markdown heading's anchor, as GitHub makes it: lower case, punctuation out, spaces to dashes. */
const anchorOf = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
const headings = (file: string) => read(file).split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => anchorOf(l.replace(/^#+ /, "")));
const nav = (html: string) => /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)![1]!;
const STYLE_ONLY = /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/;

/** The agent API's tools as an MCP client is told them: the server itself, asked over the protocol. */
async function toolsOverMcp(): Promise<{ name: string; title: string; description: string }[]> {
  const server = agentApiServer(openDb(":memory:"), agentId("docs-test"), null);
  const client = new Client({ name: "docs-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => ({ name: t.name, title: t.title ?? "", description: t.description ?? "" }));
}

describe("/docs: docs and API", () => {
  const html = docsPage(), text = mainText(html);

  it("is one page for a developer or integrator, with one heading and an honest label", () => {
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain("<h1>Docs and API</h1>");
    expect(html).toContain("<title>Purser · Docs and API</title>");
    expect(html).toMatch(/<span class="pill note">(?:<svg[\s\S]*?<\/svg>)?Sandbox and testnet only<\/span>/);
    expect([...html.matchAll(/<article class="pc card[^"]*" id="([a-z-]+)"/g)].map((m) => m[1])).toEqual(["agent-api", "cloud-api", "payments", "connect-ai", "offline"]);
  });

  it("lists exactly the tools the code defines, in the code's order, each with its own title; every description is in the fold, word for word", async () => {
    const tools = await toolsOverMcp();
    expect(tools.length).toBeGreaterThan(0);
    // The page's list is the server's: the same names, titles and descriptions, in the same order.
    expect(agentTools()).toEqual(tools);
    const api = card(html, "agent-api");
    expect([...api.matchAll(/<li data-tool="([a-z_]+)"><code>([a-z_]+)<\/code> ([^<]+)<\/li>/g)].map((m) => [m[1], m[2], decode(m[3]!)])).toEqual(tools.map((t) => [t.name, t.name, t.title]));
    // No tool beside them anywhere on the page: every snake_case name in code marks is one of the server's.
    expect([...new Set([...html.matchAll(/<code>([a-z]+(?:_[a-z]+)+)<\/code>/g)].map((m) => m[1]))].sort()).toEqual(tools.map((t) => t.name).sort());
    const fold = /<details class="fold"><summary>What each tool does<\/summary>([\s\S]*?)<\/details>/.exec(api)?.[1] ?? "";
    expect([...fold.matchAll(/<li><code>([a-z_]+)<\/code>: ([^<]+)<\/li>/g)].map((m) => [m[1], decode(m[2]!)])).toEqual(tools.map((t) => [t.name, t.description]));
    // What the tools cannot do, as the server's own file says it.
    expect(read("src/platform/mcpServer.ts")).toContain("no tool approves, sets a limit or touches another agent's card");
    // 12 Nov (review): the guide the card links, and docs/claude.md, name the same tools and count them right.
    const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    const guide = read("docs/agent-api.md");
    expect(guide).toContain(`The outside agent gets ${words[tools.length]} tools:`);
    const table = guide.slice(guide.indexOf(`gets ${words[tools.length]} tools:`)).split("\n\n")[1] ?? "";
    expect([...table.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).sort()).toEqual(tools.map((t) => t.name).sort());
    expect(read("docs/claude.md").replace(/\s+/g, " ")).toContain(`gets ${words[tools.length]} tools and no keys`);
    expect(plain(api)).toContain("No tool approves, sets a limit or touches another agent's card.");
    // A sixth tool in the code would be a sixth line here.
    expect(tools.map((t) => t.name)).toEqual(["request_company_card", "company_card", "pay_with_card", "request_limit_raise", "ask_for_task_card"]);
  });

  it("gives the command from package.json and the names of the variables it reads, each found in the code; names only, never a value", () => {
    const scripts = json<{ scripts: Record<string, string> }>("package.json").scripts;
    expect(scripts.mcp).toBe("tsx src/cli/mcp.ts");
    expect(MCP_COMMAND).toBe("npm run -s mcp");
    const api = card(html, "agent-api");
    expect(api).toContain(`<code>${MCP_COMMAND}</code>`);
    expect(MCP_ENV.map((e) => e.name)).toEqual(["KIT11_AGENT", "KIT11_AGENT_KEY", "KIT11_DB", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"]);
    for (const e of MCP_ENV) {
      // Each name is read from the environment in the file the page names for it.
      expect({ name: e.name, read: new RegExp(`\\benv\\.${e.name}\\b`).test(read(e.source)) }).toEqual({ name: e.name, read: true });
      expect({ name: e.name, shown: api.includes(`<code>${e.name}</code>`) }).toEqual({ name: e.name, shown: true });
    }
    // Everything the server's own two files read from the environment is on the page.
    const own = [...`${read("src/cli/mcp.ts")}\n${read("src/platform/mcpServer.ts")}`.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!);
    expect(own.length).toBeGreaterThan(0);
    for (const name of own) expect(MCP_ENV.map((e) => e.name)).toContain(name);
    // No other variable name on the page, and no value for any (no NAME=…).
    expect([...new Set(text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [])].sort()).toEqual(MCP_ENV.map((e) => e.name).sort());
    expect(html).not.toMatch(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*=/);
    expect(repoLinks(api)).toEqual([{ file: "docs/agent-api.md", anchor: "outside-agents-the-agent-api-mcp" }]);
  });

  it("links the Purser Cloud REST API's reference and the route table that builds its OpenAPI document; no public address while the demo constant is unset", () => {
    expect(CLOUD_DEMO_URL).toBeNull();
    expect(CLOUD_OPENAPI_PATH).toBe("/v1/openapi.json");
    // The route is in the route table, and the table builds the document.
    const app = read("cloud/src/app.ts");
    expect(app).toContain(`path: "${CLOUD_OPENAPI_PATH}"`);
    expect(app).toContain("export function openApi(origin: string)");
    const api = card(html, "cloud-api");
    expect(repoLinks(api)).toEqual([{ file: "docs/cloud.md", anchor: "the-api" }, { file: "cloud/src/app.ts", anchor: "" }]);
    expect(plain(api)).toContain(CLOUD_OPENAPI_PATH);
    // Unset: no link to any address but the repository's files and the hands-on test preview (jury check, 12 Nov: one
    // statement on Purser Cloud everywhere), and the page says what the doc says.
    expect([...api.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => !h.startsWith(REPO))).toEqual([TRY_URL]);
    expect(read("docs/cloud.md").replace(/\*\*/g, "").replace(/\s+/g, " ")).toContain(CLOUD_PREVIEW_LINE);
    expect(plain(api)).toContain("It runs publicly as a test preview: test companies, test money on a simulated bank.");
    expect(html).toBe(docsPage({ cloudDemoUrl: null }));
  });

  it("shows the demo's OpenAPI document too once the constant is set, labelled a demo with test money, and nothing else changes", () => {
    const set = docsPage({ cloudDemoUrl: "https://demo.example.test/" });
    const api = card(set, "cloud-api");
    expect([...api.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => !h.startsWith(REPO))).toEqual(["https://demo.example.test/v1/openapi.json"]);
    expect(api).toContain('<a class="pf" href="https://demo.example.test/v1/openapi.json" target="_blank" rel="noopener">OpenAPI on the demo (test money) ↗</a>');
    expect(plain(api)).not.toContain("It runs publicly as a test preview");
    expect(repoLinks(api)).toEqual([{ file: "docs/cloud.md", anchor: "the-api" }, { file: "cloud/src/app.ts", anchor: "" }]);
    // The other cards are the same.
    for (const id of ["agent-api", "payments", "offline"]) expect(card(set, id)).toBe(card(html, id));
    expect(visibleWords(set)).toBeLessThanOrEqual(280);
    // Only an https address is linked; anything else is an error where the page is built.
    expect(() => docsPage({ cloudDemoUrl: "javascript:alert(1)" })).toThrow();
    expect(() => docsPage({ cloudDemoUrl: "http://demo.example.test" })).toThrow();
  });

  it("names payments between agents (x402) and Airwallex's webhooks through the relay, one line each, with the document that describes it", () => {
    const pay = card(html, "payments");
    expect([...pay.matchAll(/<li>/g)].length).toBe(2);
    expect(repoLinks(pay)).toEqual([{ file: "docs/metal-award.md", anchor: "3-x402-on-metal-agents-pay-per-request" }, { file: "docs/airwallex.md", anchor: "webhooks" }]);
    expect(plain(pay)).toMatch(/x402/);
    expect(plain(pay)).toMatch(/webhooks?/i);
    // What the two lines say is what the documents say.
    expect(read("docs/metal-award.md")).toContain("## 3. x402 on Metal: agents pay per request");
    expect(read("docs/airwallex.md")).toContain("The relay checks the signature and keeps the event. The runner checks it again with its own copy of the secret");
    expect(plain(pay)).toContain("Metal's testnet");
    expect(plain(pay)).toContain("Airwallex's sandbox");
  });

  it("says how to run it offline: npm run judge, with the README", () => {
    const off = card(html, "offline");
    expect(json<{ scripts: Record<string, string> }>("package.json").scripts.judge).toBe("tsx src/cli/judge.ts");
    expect(off).toContain("<code>npm run judge</code>");
    // The README's commands are under "Verify it yourself in 3 commands" since its first screen was shortened (12 Nov).
    expect(repoLinks(off)).toEqual([{ file: "README.md", anchor: "verify-it-yourself-in-3-commands" }]);
    expect(read("README.md")).toMatch(/^npm run judge -- --check$/m);
    expect(read("README.md")).toContain("after that, no network and no keys.");
    expect(plain(off)).toContain("no keys");
  });

  // 210 since the review of 12 Nov: an aside on the project name next to the variable names (6 words; removed again in the final review, 13 Nov).
  // 245 since 13 Nov (owner): the "Connect your AI" card, its sentence, the demo token and its link (35 words). 280 since
  // the jury the same day: Purser Cloud as a guest in the card, its link, and its steps with Claude folded (274 as built).
  it("stays within 280 words in sight, the folds closed", () => {
    expect(visibleWords(html)).toBeLessThanOrEqual(280);
    expect((html.match(/<details class="fold"/g) ?? []).length).toBeGreaterThan(0);
    expect(html).not.toMatch(/<details class="fold" open/);
  });

  it("shows no number of its own: only the names the code and the docs use", () => {
    // Names with digits in them are names (x402, the KIT11_ variables, the OpenAPI document's path), and the tools'
    // descriptions are the code's own words (held to the server's answer above): nothing else carries a figure.
    const ours = (t: string) => agentTools().reduce((rest, tool) => rest.replace(tool.description, " "), t).replace(/\bx402\b|\bKIT11_[A-Z_]+\b|\/v1\/[\w./]+|\bhttps:\/\/[\w.-]+\/[\w/.-]*/g, " ");
    expect(numbers(ours(text))).toEqual([]);
    expect(numbers(ours(`${text} over 40 customers`))).toEqual(["40"]);
  });

  it("says what is real in its own words: sandbox and testnet only, and that the preview is private", () => {
    const real = decode(/<details class="real" id="real">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "");
    expect(real).toContain("Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.");
    // 12 Nov (jury check): one statement on Purser Cloud everywhere (src/redesign/docs.ts CLOUD_PREVIEW_LINE).
    expect(real).toContain(CLOUD_PREVIEW_LINE);
    expect(real).not.toMatch(/Northwind|Real Claude decisions/);
    expect(html).not.toMatch(/certified|endorsed|approved by/i);
  });
});

describe("/docs on the site", () => {
  const pages = buildPages() as Pages;

  it("is built once and served as it is, by the Worker's bundle and the judge server, under a style-only policy (no script)", () => {
    expect(DOCS_PAGE).toBe(docsPage());
    expect(pages.docs).toBe(DOCS_PAGE);
    expect(scriptBlocks(DOCS_PAGE)).toEqual([]);
    expect((DOCS_PAGE.match(/<style>/g) ?? []).length).toBe(1);
    expect(DOCS_CSP).toMatch(STYLE_ONLY);
    expect(pages.csp.docs).toBe(DOCS_CSP);
    const res = pageResponse(new Request("https://x.test/docs"), pages)!;
    expect({ status: res.status, type: res.headers.get("content-type"), csp: res.headers.get("content-security-policy") }).toEqual({ status: 200, type: "text/html; charset=utf-8", csp: DOCS_CSP });
    expect(DOCS_PAGE.match(/<(?:img|script|link)[^>]*(?:src|href)="https?:[^"]*"/g) ?? []).toEqual([]);
    expect(CHECK_PATHS).toContain("/docs");
    expect(HEADER_PATHS.filter((h) => h.path === "/docs")).toEqual([{ path: "/docs", kind: "page", status: 200 }]);
    // An older bundle without the page answers nothing for it (the Worker then serves the clean 404).
    const { docs: _d, ...older } = pages;
    expect(pageResponse(new Request("https://x.test/docs"), older as Pages)).toBeNull();
  });

  it("is in the menu under More, marked as the page the reader is on, and in the footer", () => {
    const n = nav(DOCS_PAGE);
    expect({ more: /<details class="pmore"><summary class="on">More<\/summary>/.test(n), here: n.includes('<a href="docs" aria-current="page">Docs</a>'), tabs: (n.match(/class="on" aria-current="page"/g) ?? []).length }).toEqual({ more: true, here: true, tabs: 0 });
    expect(nav(pages.home!)).toContain('<a href="docs">Docs</a>');
    expect(/<footer class="foot">[\s\S]*?<\/footer>/.exec(pages.home!)![0]).toMatch(/<a class="flink" href="docs">Docs<\/a>/);
  });

  it("links only to repository files that exist, and to headings those files have", () => {
    const links = repoLinks(DOCS_PAGE);
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const l of links) {
      expect({ file: l.file, exists: existsSync(new URL(`../${l.file}`, import.meta.url)) }).toEqual({ file: l.file, exists: true });
      if (l.anchor) expect({ file: l.file, anchor: l.anchor, found: headings(l.file).includes(l.anchor) }).toEqual({ file: l.file, anchor: l.anchor, found: true });
    }
  });

  it("is named in llms.txt, one line, with what it is", () => {
    expect(read("llms.txt").split("\n").filter((l) => / https:\/\/kit11\.max-31b\.workers\.dev\/docs( |$)/.test(l))).toEqual(["- Docs and API: https://kit11.max-31b.workers.dev/docs (the agent API's tools as the code defines them, the Purser Cloud REST API's reference, x402 and the Airwallex webhooks, and how to run it offline; sandbox and testnet only)"]);
  });
});

// /status.

/** What the page shows once its script has run: the card's tone and each line, as a reader sees them. */
interface Shown { tone: string | null; head: string; site: string; runner: string; sync: string; alarms: string; agents: string | null; good: string[]; bad: string[] }
interface Answer { status: number; json(): Promise<unknown> }
/** The page's elements that carry an id, as its HTML has them: enough of a document for the page's one script. */
function fakeDocument(html: string) {
  const els = new Map<string, { textContent: string; className: string; hidden: boolean; attrs: Record<string, string>; setAttribute(k: string, v: string): void }>();
  for (const m of (/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "").matchAll(/<[a-z0-9]+\b[^>]*\bid="([a-z-]+)"[^>]*>([^<]*)/g)) {
    els.set(m[1]!, { textContent: decode(m[2]!), className: /\bclass="([^"]*)"/.exec(m[0])?.[1] ?? "", hidden: /\shidden(?:[\s>]|$)/.test(m[0]), attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  }
  return { els, document: { getElementById: (id: string) => els.get(id) ?? null } };
}
/**
 * Runs the page's own script (the one inline script of the HTML given) against `health`, the answer to its one request,
 * and returns what the page then shows. The script may ask for one address only: "health", relative to the page.
 */
async function shown(html: string, health: () => Promise<Answer>): Promise<Shown> {
  const blocks = scriptBlocks(html);
  expect(blocks.length).toBe(1);
  const { els, document } = fakeDocument(html);
  const asked: unknown[][] = [];
  const fetch = (...a: unknown[]) => { asked.push(a); return health(); };
  vm.runInNewContext(scriptBody(blocks[0]!), { document, fetch });
  const card = els.get("now")!;
  for (let i = 0; i < 600 && card.attrs["data-tone"] === undefined; i++) await new Promise((r) => setTimeout(r, 5));
  expect(asked).toEqual([["health", { cache: "no-store", credentials: "omit" }]]);
  const t = (id: string) => els.get(id)!.textContent;
  const lines = ["st-site", "st-runner", "st-sync", "st-alarms"];
  return {
    tone: card.attrs["data-tone"] ?? null, head: t("st-head"), site: t("st-site"), runner: t("st-runner"), sync: t("st-sync"), alarms: t("st-alarms"),
    agents: els.get("st-agents-row")!.hidden ? null : t("st-agents"),
    good: lines.filter((id) => els.get(id)!.className === "good"), bad: lines.filter((id) => els.get(id)!.className === "bad"),
  };
}
const answer = (status: number, body: unknown): (() => Promise<Answer>) => async () => ({ status, json: async () => body });
/** What the page shows while nothing was read: its HTML as served, and (word for word otherwise) after a failed read. */
const UNREAD = { site: "Not read", runner: "Not read", sync: "Not read", alarms: "Not read", agents: null, good: [], bad: [] };
const COULD_NOT = { tone: "unread", head: "The status could not be read just now", ...UNREAD };
const minutes = (ms: number) => `${ms / 60_000} minute${ms === 60_000 ? "" : "s"}`;

describe("/status: what the page says before anything is read, and without JavaScript", () => {
  const html = statusPage(), text = mainText(html);

  it("is one calm page with one heading and an honest label", () => {
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
    expect(html).toContain("<h1>Status</h1>");
    expect(html).toContain("<title>Purser · Status</title>");
    expect(html).toMatch(/<span class="pill note">(?:<svg[\s\S]*?<\/svg>)?Sandbox and testnet only<\/span>/);
    expect([...html.matchAll(/<article class="pc card[^"]*" id="([a-z-]+)"/g)].map((m) => m[1])).toEqual(["now", "runs"]);
    expect(visibleWords(html)).toBeLessThanOrEqual(90);
    expect(visibleWords(statusPage("offline"))).toBeLessThanOrEqual(90);
  });

  it("starts neutral: nothing in its HTML says the site is up, that no alarm stands or that a run is or is not going on", () => {
    const now = plain(card(html, "now"));
    expect(now).toBe("Live status not read yet Site — Runner — Last sync — Alarms — Try agents today — The raw answer: /health");
    expect(card(html, "now")).toMatch(/<article class="pc card" id="now" aria-live="polite">/);
    expect(card(html, "now")).not.toMatch(/data-tone|class="good"|class="bad"/);
    // The words a read answer brings are only in the script, never in the page's own text.
    for (const word of [/\bUp\b/, /\bNone\b/, /No live run/, /in progress/, /Syncing/, /all good/i, /operational/i]) expect({ word: String(word), found: word.test(text) }).toEqual({ word: String(word), found: false });
    // The line for the Try page's agents is hidden until an answer carries it.
    expect(card(html, "now")).toMatch(/<div id="st-agents-row" hidden>/);
  });

  it("links to /health, the raw answer, in the page itself, so a reader without JavaScript has it too", () => {
    expect(card(html, "now")).toContain('<a class="pf" href="health">The raw answer: /health</a>');
  });

  it("reads one address only, the site's own /health, and writes text only (no HTML from the answer)", () => {
    const js = scriptBody(scriptBlocks(html)[0]!);
    expect([...js.matchAll(/\bfetch\(([^,)]*)/g)].map((m) => m[1])).toEqual(['"health"']);
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|sessionStorage|document\.cookie|XMLHttpRequest|WebSocket|sendBeacon/);
    expect(js).not.toMatch(/https?:\/\//);
  });
});

describe("/status against the local relay (src/relay/local.ts): the quiet state and the live state", () => {
  const TOKEN = "status-test-token";
  let server: Server, base: string, html: string;
  const health = () => fetch(`${base}/health`);
  const sync = async () => {
    const state = buildRelayState(openDb(":memory:"), { rpId: "localhost", relayToken: TOKEN }, new Date());
    const r = await fetch(`${base}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(state), state, acks: [] }) });
    expect(r.status).toBe(200);
  };
  beforeAll(async () => {
    ({ server, url: base } = await startLocalRelay({ port: 0, token: TOKEN }));
    html = await (await fetch(`${base}/status`)).text();
  });
  afterAll(() => server?.close());

  it("serves the page under a policy that allows its one script, its one style and requests to the site itself only", async () => {
    const res = await fetch(`${base}/status`);
    expect(res.status).toBe(200);
    expect(html).toBe(STATUS_PAGE);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toBe(STATUS_CSP);
    const hash = (tag: "script" | "style") => `'sha256-${createHash("sha256").update(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html)![1]!, "utf8").digest("base64")}'`;
    expect(csp).toBe(`default-src 'none'; script-src ${hash("script")}; style-src ${hash("style")}; connect-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
    expect(scriptBlocks(html).length).toBe(1);
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
  });

  it("quiet: no runner has synced, which is the normal state and no error", async () => {
    const h = await health();
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ status: "recorded_demo", words: "Recorded demo · the live runner runs during live runs", runner: "off", alerts: [], checked_at: null, last_sync: null });
    expect(await shown(html, health)).toEqual({ tone: "quiet", head: "No live run in progress", site: "Up", runner: "Off between runs", sync: "None on record", alarms: "No report on record", agents: null, good: ["st-site"], bad: [] });
  });

  it("live: a runner syncs, so a live run is in progress and no alarm stands", async () => {
    await sync();
    const h = await health();
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ status: "ok", runner: "up", alerts: [] });
    expect(await shown(html, health)).toEqual({ tone: "ok", head: "A live run is in progress", site: "Up", runner: "Syncing", sync: `In the last ${minutes(RUNNER_DOWN_AFTER_MS)}`, alarms: "None", agents: null, good: ["st-site", "st-runner", "st-alarms"], bad: [] });
    expect(minutes(RUNNER_DOWN_AFTER_MS)).toBe("2 minutes");
  });
});

describe("/status against the relay's own logic at other times (worker/src/core.ts, its clock moved)", () => {
  const TOKEN = "status-clock-token";
  const T0 = Date.parse("2026-11-12T09:30:00.000Z");
  const html = statusPage();
  /** A relay with its own clock; `alerts` are the alarm codes its runner reports at each sync. */
  function relayAt(o: { liveRun?: boolean; alerts?: string[]; health?: boolean } = {}) {
    let clock = T0;
    const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => new Date(clock), liveRun: o.liveRun });
    const sync = async () => {
      const at = new Date(clock).toISOString();
      const health = { status: o.alerts?.length ? "alert" : "ok", at, alerts: (o.alerts ?? []).map((code) => ({ code, severity: "critical", since: at, words: "x" })), metrics: {} };
      const state = { generated_at: at, snapshot: o.health === false ? {} : { health }, approvals: {} };
      const r = await relay.fetch(new Request("https://x.test/api/runner/sync", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: "h", state, acks: [] }) }));
      expect(r.status).toBe(200);
    };
    return { sync, later: (ms: number) => { clock += ms; }, health: () => relay.fetch(new Request("https://x.test/health")) };
  }

  it("quiet after a live run: the last sync's time, in UTC, and no alarm at that sync", async () => {
    const r = relayAt();
    await r.sync();
    r.later(LIVE_RUN_EXPECTED_MS + 1000);
    expect((await r.health()).status).toBe(200);
    expect(await shown(html, r.health)).toEqual({ tone: "quiet", head: "No live run in progress", site: "Up", runner: "Off between runs", sync: "12 Nov 2026, 09:30 UTC", alarms: "None at last sync", agents: null, good: ["st-site"], bad: [] });
  });

  it("quiet, with an alarm that stood at the last sync: named, and not called none", async () => {
    const r = relayAt({ alerts: ["ledger_mismatch", "card_drift"] });
    await r.sync();
    r.later(LIVE_RUN_EXPECTED_MS + 1000);
    expect(await shown(html, r.health)).toMatchObject({ tone: "quiet", head: "No live run in progress", site: "Up", alarms: "ledger_mismatch, card_drift (at last sync)", bad: ["st-alarms"] });
  });

  it("a live run whose runner stopped syncing is an alarm, said plainly (the answer is a 503)", async () => {
    const r = relayAt();
    await r.sync();
    r.later(RUNNER_DOWN_AFTER_MS + 1000);
    const h = await r.health();
    expect(h.status).toBe(503);
    expect(await h.json()).toMatchObject({ status: "alert", runner: "down", alerts: ["runner_down"] });
    expect(await shown(html, r.health)).toEqual({ tone: "alarm", head: "Live run expected, but the runner stopped syncing", site: "Up", runner: "Not syncing", sync: `Over ${minutes(RUNNER_DOWN_AFTER_MS)} ago`, alarms: "runner_down", agents: null, good: ["st-site"], bad: ["st-runner", "st-alarms"] });
  });

  it("a live run with an alarm from the runner: the alarm's code, never 'None'", async () => {
    const r = relayAt({ alerts: ["ledger_mismatch"] });
    await r.sync();
    expect((await r.health()).status).toBe(503);
    expect(await shown(html, r.health)).toEqual({ tone: "alarm", head: "A live run is in progress, with an alarm", site: "Up", runner: "Syncing", sync: `In the last ${minutes(RUNNER_DOWN_AFTER_MS)}`, alarms: "ledger_mismatch", agents: null, good: ["st-site", "st-runner"], bad: ["st-alarms"] });
  });

  it("a declared live run with no sync yet, and a runner that sends no health report: alarms, not 'all good'", async () => {
    const declared = relayAt({ liveRun: true });
    expect(await shown(html, declared.health)).toEqual({ tone: "alarm", head: "Live run declared, but the runner has not synced", site: "Up", runner: "No sync on record", sync: "None on record", alarms: "No health report from the runner", agents: null, good: ["st-site"], bad: ["st-runner", "st-alarms"] });
    const old = relayAt({ health: false });
    await old.sync();
    expect(await (await old.health()).json()).toMatchObject({ status: "alert", runner: "up", alerts: [] });
    expect(await shown(html, old.health)).toMatchObject({ tone: "alarm", head: "A live run is in progress, with an alarm", runner: "Syncing", alarms: "No health report from the runner", bad: ["st-alarms"] });
  });

  it("shows the Try page's live agents' spend of the day when /health carries it, as /health gives it", async () => {
    const quiet = { status: "recorded_demo", words: "x", runner: "off", alerts: [], checked_at: null, last_sync: null };
    expect((await shown(html, answer(200, { ...quiet, live_agents_today: { usd: 0.1234, budget_usd: 10 } }))).agents).toBe("$0.12 of $10.00");
    expect((await shown(html, answer(200, quiet))).agents).toBeNull();
    // An odd figure is left out; the rest of the answer still stands.
    for (const odd of [{ usd: "1", budget_usd: 10 }, { usd: -1, budget_usd: 10 }, { usd: 1 }, "x", { usd: 1, budget_usd: 0 }]) expect(await shown(html, answer(200, { ...quiet, live_agents_today: odd }))).toMatchObject({ tone: "quiet", agents: null });
  });
});

describe("/status when /health fails or answers something unexpected", () => {
  const html = statusPage();
  const ok = { status: "ok", runner: "up", alerts: [], checked_at: "2026-11-12T09:30:00.000Z" };
  const quiet = { status: "recorded_demo", words: "x", runner: "off", alerts: [], checked_at: null, last_sync: null };

  it("says plainly that the status could not be read, and nothing else, when the request fails", async () => {
    expect(await shown(html, () => Promise.reject(new TypeError("Failed to fetch")))).toEqual(COULD_NOT);
  });

  it("says the same when the answer is not JSON: an error page, a 404 page, an empty answer", async () => {
    const notJson = (status: number) => async () => ({ status, json: () => Promise.reject(new SyntaxError("Unexpected token <")) });
    for (const status of [200, 404, 500, 502]) expect({ status, shown: await shown(html, notJson(status)) }).toEqual({ status, shown: COULD_NOT });
  });

  it("says the same for every answer that is JSON but not /health's own shape, so no odd answer can read as good", async () => {
    const odd: [string, number, unknown][] = [
      ["null", 200, null], ["a string", 200, "ok"], ["a list", 200, []], ["an empty object", 200, {}],
      ["ok without a runner", 200, { status: "ok", alerts: [] }],
      ["ok without alerts", 200, { status: "ok", runner: "up" }],
      ["ok with an alarm", 200, { ...ok, alerts: ["runner_down"] }],
      ["ok with the runner down", 200, { ...ok, runner: "down" }],
      ["ok with the runner off", 200, { ...ok, runner: "off" }],
      ["ok on a 503", 503, ok],
      ["ok on a 500", 500, ok],
      ["an alert on a 200", 200, { status: "alert", runner: "down", alerts: ["runner_down"], checked_at: null }],
      ["an alert with an unknown runner word", 503, { status: "alert", runner: "fine", alerts: [] }],
      ["quiet on a 503", 503, quiet],
      ["quiet with the runner up", 200, { ...quiet, runner: "up" }],
      ["quiet with a last sync that is no time", 200, { ...quiet, last_sync: "yesterday" }],
      ["quiet with a last sync that is no string", 200, { ...quiet, last_sync: 1731400000 }],
      ["an unknown status", 200, { ...ok, status: "green" }],
      ["alerts that are not a list", 200, { ...ok, alerts: "none" }],
      ["an alarm that is not a code", 503, { status: "alert", runner: "up", alerts: ["<img src=x onerror=alert(1)>"] }],
      ["an alarm that is an object", 503, { status: "alert", runner: "up", alerts: [{ code: "x" }] }],
      // The runner's own dashboard answers /health in another shape (src/ops/health.ts): not this page's.
      ["the dashboard server's own health", 200, { status: "ok", at: "2026-11-12T09:30:00.000Z", alerts: [], metrics: {} }],
    ];
    for (const [what, status, body] of odd) expect({ what, shown: await shown(html, answer(status, body)) }).toEqual({ what, shown: COULD_NOT });
  });

  it("turns positive only on the two well-formed good answers: the live run without alarms, and the quiet state", async () => {
    expect(await shown(html, answer(200, ok))).toMatchObject({ tone: "ok", site: "Up", alarms: "None" });
    expect(await shown(html, answer(200, quiet))).toMatchObject({ tone: "quiet", site: "Up" });
  });
});

describe("/status: the latest live runs", () => {
  const html = statusPage(), runs = card(html, "runs");
  // Jury pass, 13 Nov: a partial run (runs.ts PARTIAL_RUNS) is not a live run on /status either.
  const all = liveRuns().filter((r) => !r.partial);

  it("lists the five newest runs of /runs' own list, newest first, each with its day and the start of its title", () => {
    expect(STATUS_RUNS).toBe(5);
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect([...all].sort((a, b) => b.iso.localeCompare(a.iso)).map((r) => r.key)).toEqual(all.map((r) => r.key));
    const five = latestRuns();
    expect(five.map((r) => r.key)).toEqual(all.slice(0, 5).map((r) => r.key));
    const items = [...runs.matchAll(/<li><time datetime="([^"]+)">([^<]+)<\/time> <a class="pf" href="([^"]+)" target="_blank" rel="noopener" title="([^"]+)">([^<]+) ↗<\/a><\/li>/g)].map((m) => ({ iso: m[1]!, day: m[2]!, href: m[3]!, full: decode(m[4]!), short: decode(m[5]!) }));
    expect(items.length).toBe(5);
    items.forEach((it, i) => {
      const row = all[i]!;
      expect({ i, iso: it.iso, full: it.full }).toEqual({ i, iso: row.iso, full: row.title });
      // The day as /runs writes it, without the year; the title up to its first colon or bracket, never other words.
      expect({ i, day: it.day }).toEqual({ i, day: row.date.replace(/ \d{4}$/, "") });
      expect({ i, starts: row.title.startsWith(it.short), short: it.short.length > 0 && it.short.length <= row.title.length }).toEqual({ i, starts: true, short: true });
      expect(five[i]).toMatchObject({ key: row.key, title: row.title, short: it.short, href: it.href });
    });
    expect(plain(runs)).toContain("Latest live runs");
  });

  it("links each run to its record in the repository: a file /runs names for that run, and one that exists", () => {
    const five = latestRuns();
    five.forEach((r, i) => {
      const row = all[i]!;
      expect(r.href.startsWith(REPO)).toBe(true);
      const file = r.href.slice(REPO.length);
      expect({ key: r.key, file, exists: existsSync(new URL(`../${file}`, import.meta.url)) }).toEqual({ key: r.key, file, exists: true });
      // One of the run's own files on /runs (some are written there relative to docs/runs/README.md).
      expect({ key: r.key, own: row.files.some((f) => f.href === r.href || f.href.replace(/^(?:\.\.\/)+/, "") === file) }).toEqual({ key: r.key, own: true });
    });
  });

  // 12 Nov (review): one pill of all five runs' labels read as if each applied to every run ("Nothing bought" is the
  // Airi run's alone). Now each label heads the runs it belongs to, as /runs labels each run; one pill only when all
  // five share it. Each label is said once per group, so the page stays within its 90 words.
  it("labels each run with its own money label, as /runs does, and links to every live run", () => {
    const five = all.slice(0, 5), labels = [...new Set(five.map((r) => r.money))];
    for (const l of labels) expect(l).toMatch(/test money|Nothing bought/i);
    expect(runLabels([{ money: "A" }, { money: "A" }])).toEqual({ pill: "A", groups: false });
    expect(runLabels([{ money: "A" }, { money: "B" }])).toEqual({ pill: null, groups: true });
    const { pill, groups } = runLabels(five);
    const head = /<h2>[\s\S]*?<\/h2>/.exec(runs)?.[0] ?? "";
    if (pill === null) expect(head).not.toContain('<span class="pill">');
    else expect(head).toContain(`<span class="pill">${pill}</span>`);
    // Walk the list: a label item heads the runs after it, until the next one.
    let current: string | null = null, heads = 0;
    const labelled: (string | null)[] = [];
    for (const m of runs.matchAll(/<li class="grp">([^<]+)<\/li>|<li><time /g)) {
      if (m[1] !== undefined) { current = decode(m[1]); heads++; } else labelled.push(current);
    }
    expect(labelled).toEqual(five.map((r) => (groups ? r.money : null)));
    // One label item where the label changes, never two in a row for the same label.
    expect(heads).toBe(groups ? five.filter((r, i) => i === 0 || r.money !== five[i - 1]!.money).length : 0);
    // With today's five runs the labels differ, so the list is grouped by them.
    expect(groups).toBe(labels.length > 1);
    expect(runs).toContain(`<a class="pf" href="runs">${RUNS_TITLE}</a>`);
  });

  it("shows no number that is not a run's own day or title", () => {
    const allowed = new Set(all.slice(0, 5).flatMap((r) => numbers(`${r.date.replace(/ \d{4}$/, "")} ${r.title}`)));
    const text = mainText(html);
    expect(numbers(text).filter((n) => !allowed.has(n))).toEqual([]);
    expect(numbers(`${text} 99.9% uptime`).filter((n) => !allowed.has(n))).toEqual(["99.9"]);
  });
});

describe("/status on the site", () => {
  const pages = buildPages() as Pages;
  let judge: Server, judgeUrl: string;
  beforeAll(async () => { ({ server: judge, url: judgeUrl } = await startJudge(0)); });
  afterAll(() => judge?.close());

  it("is built once and served by the Worker's bundle with its script, under its own policy", () => {
    expect(STATUS_PAGE).toBe(statusPage());
    expect(pages.status).toBe(STATUS_PAGE);
    expect(pages.csp.status).toBe(STATUS_CSP);
    const res = pageResponse(new Request("https://x.test/status"), pages)!;
    expect({ status: res.status, type: res.headers.get("content-type"), csp: res.headers.get("content-security-policy") }).toEqual({ status: 200, type: "text/html; charset=utf-8", csp: STATUS_CSP });
    expect(STATUS_PAGE.match(/<(?:img|script|link)[^>]*(?:src|href)="https?:[^"]*"/g) ?? []).toEqual([]);
    expect(CHECK_PATHS).toContain("/status");
    expect(HEADER_PATHS.filter((h) => h.path === "/status")).toEqual([{ path: "/status", kind: "page", status: 200 }]);
    const { status: _s, ...older } = pages;
    expect(pageResponse(new Request("https://x.test/status"), older as Pages)).toBeNull();
    // /health itself is the relay's answer, not a page of the bundle (worker/src/index.ts sends it to the relay).
    expect(pageResponse(new Request("https://x.test/health"), pages)).toBeNull();
  });

  it("keeps both pages under their policies with /try/sign in the bundle: the Try tab is the hands-on demo either way, never a script or a style changes", () => {
    const on = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as Pages;
    const hash = (html: string, tag: "script" | "style") => `'sha256-${createHash("sha256").update(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(html)![1]!, "utf8").digest("base64")}'`;
    expect(on.csp.status).toBe(STATUS_CSP);
    expect(on.csp.status).toContain(`script-src ${hash(on.status!, "script")};`);
    expect(on.csp.status).toContain(`style-src ${hash(on.status!, "style")};`);
    expect(on.csp.docs).toBe(DOCS_CSP);
    expect(on.csp.docs).toContain(`style-src ${hash(on.docs!, "style")};`);
    for (const [html, built] of [[on.status!, STATUS_PAGE], [on.docs!, DOCS_PAGE]] as const) {
      // The Try tab opens the hands-on demo (TRY_URL, the owner, 12 Nov) whatever the bundle carries; at most an in-page
      // "next" link turns to /try/sign.
      expect(nav(html)).toContain(`<a href="${TRY_URL}">Try</a>`);
      expect(html.replace(/href="try\/sign" data-next="try"/g, 'href="try" data-next="try"')).toBe(built);
    }
  });

  it("offline (npm run judge) there is no /health and no runner, so that copy says so: no script, no request, no link that leads nowhere", async () => {
    expect((await fetch(`${judgeUrl}/health`)).status).toBe(404);
    const res = await fetch(`${judgeUrl}/status`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBe(STATUS_PAGE_OFFLINE);
    expect(STATUS_PAGE_OFFLINE).toBe(statusPage("offline"));
    expect(res.headers.get("content-security-policy")).toBe(STATUS_OFFLINE_CSP);
    expect(STATUS_OFFLINE_CSP).toMatch(STYLE_ONLY);
    expect(scriptBlocks(html)).toEqual([]);
    expect(html).not.toMatch(/href="\/?health"/);
    const now = card(html, "now");
    expect(plain(now)).toBe("No live status in this copy It runs on your computer, with no runner behind it. The hosted status page ↗");
    expect(now).toContain(`<a class="pf" href="${SITE_URL}/status" target="_blank" rel="noopener">The hosted status page ↗</a>`);
    expect(html).toContain('<p class="lead">An offline copy, with no live status.</p>');
    // The runs are the same list.
    expect(card(html, "runs")).toBe(card(STATUS_PAGE, "runs"));
  });

  it("is no longer in the menu or the footer (12 Nov, owner); the page itself still answers", () => {
    for (const html of [STATUS_PAGE, STATUS_PAGE_OFFLINE]) expect(nav(html)).not.toContain('href="status"');
    expect([...nav(pages.home!).matchAll(/<div class="pmenu">([\s\S]*?)<\/div>/g)].flatMap((m) => [...m[1]!.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((a) => a[1]))).toEqual(["Purser Cloud", "Pricing", "Security", "Docs", "Books", "Airwallex", "Metal", "Visa", "Claude"]);
    expect(/<footer class="foot">[\s\S]*?<\/footer>/.exec(pages.home!)![0]).not.toMatch(/href="status"/);
  });

  it("carries the site's icon and link-preview image like the other pages, and says what is real in its own words", () => {
    for (const html of [STATUS_PAGE, STATUS_PAGE_OFFLINE, DOCS_PAGE]) {
      expect(html).toMatch(/<link rel="icon" href="assets\/favicon\.svg"/);
      expect(html).toMatch(/<meta property="og:image" content="https:\/\/kit11\.max-31b\.workers\.dev\/assets\/og\.png\?v=1113">/);
    }
    const real = decode(/<details class="real" id="real">([\s\S]*?)<\/details>/.exec(STATUS_PAGE)?.[1] ?? "");
    expect(real).toContain("Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.");
    expect(real).toContain("The live part is this site's own /health, read by your browser when the page opens.");
    expect(real).toContain("No live run in progress is the normal state: the hosted pages replay the recorded run.");
    expect(real).not.toMatch(/Northwind|Real Claude decisions/);
    expect(STATUS_PAGE).not.toMatch(/certified|endorsed|approved by|uptime|SLA\b/i);
  });

  it("is named in llms.txt, one line, with what it is", () => {
    expect(read("llms.txt").split("\n").filter((l) => / https:\/\/kit11\.max-31b\.workers\.dev\/status( |$)/.test(l))).toEqual(["- Status: https://kit11.max-31b.workers.dev/status (the site's own /health in plain words, where no live run in progress is the normal state, and the five latest live runs; sandbox and testnet only)"]);
  });
});
