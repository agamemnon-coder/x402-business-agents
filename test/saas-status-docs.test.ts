// The other two product pages under "More" (12 Nov): /docs ("Docs and API") and /status. Nothing on them is typed in by
// hand. /docs lists the agent API's tools as the code defines them (asked from the MCP server itself here, over the
// protocol), the command and the variable names from package.json and the code, and links only to files that exist.
// /status starts neutral and turns positive only on a well-formed answer of the site's own /health; a failed or odd
// answer says so, and the page can never show a false "all good". Its list of runs is /runs' own.
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { CHECK_PATHS } from "../src/cli/judge.js";
import { openDb } from "../src/db/open.js";
import { agentId } from "../src/platform/externalAgents.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { CLOUD_DEMO_URL, CLOUD_OPENAPI_PATH, MCP_COMMAND, MCP_ENV, agentTools, docsPage } from "../src/redesign/docs.js";
import { buildPages } from "../src/relay/assets.js";
import { DOCS_CSP, DOCS_PAGE } from "../src/servers/dashboard.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { HEADER_PATHS } from "./security-headers.rules.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = <T>(p: string) => JSON.parse(read(p)) as T;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
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
const repoLinks = (html: string) => [...html.matchAll(new RegExp(`href="${REPO.replace(/[.]/g, "\\.")}([^"#]+)(#[^"]*)?"`, "g"))].map((m) => ({ file: m[1]!, anchor: (m[2] ?? "").slice(1) }));
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
    expect(html).toContain("<title>Docs and API</title>");
    expect(html).toMatch(/<span class="pill note">(?:<svg[\s\S]*?<\/svg>)?Sandbox and testnet only<\/span>/);
    expect([...html.matchAll(/<article class="pc card[^"]*" id="([a-z-]+)"/g)].map((m) => m[1])).toEqual(["agent-api", "cloud-api", "payments", "offline"]);
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
    // Unset: no link to any address but the repository's files, and the page says the preview is private, as the doc does.
    expect([...api.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => !h.startsWith(REPO))).toEqual([]);
    expect(read("docs/cloud.md").replace(/\s+/g, " ")).toContain("A hosted preview exists but is private (behind an access key); no customer uses it.");
    expect(plain(api)).toContain("The hosted preview is private, so there is no public address yet.");
    expect(html).toBe(docsPage({ cloudDemoUrl: null }));
  });

  it("shows the demo's OpenAPI document too once the constant is set, labelled a demo with test money, and nothing else changes", () => {
    const set = docsPage({ cloudDemoUrl: "https://demo.example.test/" });
    const api = card(set, "cloud-api");
    expect([...api.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => !h.startsWith(REPO))).toEqual(["https://demo.example.test/v1/openapi.json"]);
    expect(api).toContain('<a class="pf" href="https://demo.example.test/v1/openapi.json" target="_blank" rel="noopener">OpenAPI on the demo (test money) ↗</a>');
    expect(plain(api)).not.toContain("no public address yet");
    expect(repoLinks(api)).toEqual([{ file: "docs/cloud.md", anchor: "the-api" }, { file: "cloud/src/app.ts", anchor: "" }]);
    // The other cards are the same.
    for (const id of ["agent-api", "payments", "offline"]) expect(card(set, id)).toBe(card(html, id));
    expect(visibleWords(set)).toBeLessThanOrEqual(200);
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
    expect(read("docs/airwallex.md")).toContain("The relay checks the signature and keeps the event. The runner then checks the signature again");
    expect(plain(pay)).toContain("Metal's testnet");
    expect(plain(pay)).toContain("Airwallex's sandbox");
  });

  it("says how to run it offline: npm run judge, with the README", () => {
    const off = card(html, "offline");
    expect(json<{ scripts: Record<string, string> }>("package.json").scripts.judge).toBe("tsx src/cli/judge.ts");
    expect(off).toContain("<code>npm run judge</code>");
    expect(repoLinks(off)).toEqual([{ file: "README.md", anchor: "how-to-run" }]);
    expect(read("README.md")).toMatch(/^npm run judge$/m);
    expect(read("README.md")).toContain("Offline, with no keys.");
    expect(plain(off)).toContain("no keys");
  });

  it("stays within 200 words in sight, the folds closed", () => {
    expect(visibleWords(html)).toBeLessThanOrEqual(200);
    expect((html.match(/<details class="fold"/g) ?? []).length).toBeGreaterThan(0);
    expect(html).not.toMatch(/<details class="fold" open/);
  });

  it("shows no number of its own: only the names the code and the docs use", () => {
    // Names with digits in them are names (x402, the KIT11_ variables, the OpenAPI document's path), and the tools'
    // descriptions are the code's own words (held to the server's answer above): nothing else carries a figure.
    const ours = (t: string) => agentTools().reduce((rest, tool) => rest.replace(tool.description, " "), t).replace(/\bx402\b|\bKIT11_[A-Z_]+\b|\/v1\/[\w./]+/g, " ");
    expect(numbers(ours(text))).toEqual([]);
    expect(numbers(ours(`${text} over 40 customers`))).toEqual(["40"]);
  });

  it("says what is real in its own words: sandbox and testnet only, and that the preview is private", () => {
    const real = decode(/<details class="real" id="real">([\s\S]*?)<\/details>/.exec(html)?.[1] ?? "");
    expect(real).toContain("Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.");
    expect(real).toContain("Purser Cloud's hosted preview is private (behind an access key); no customer uses it.");
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
    expect(read("llms.txt").split("\n").filter((l) => l.includes("https://kit11.max-31b.workers.dev/docs"))).toEqual(["- Docs and API: https://kit11.max-31b.workers.dev/docs (the agent API's tools as the code defines them, the Purser Cloud REST API's reference, x402 and the Airwallex webhooks, and how to run it offline; sandbox and testnet only)"]);
  });
});
