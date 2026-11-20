// "Connect Purser to anything" (20 Nov, the owner: "make it clear and possible that Purser connects to everything and
// everyone, findable in the docs and in Purser Cloud"). It holds: every connection the hub names is in the catalogue
// GET /v1/connections serves (cloud/src/connections.ts) with the same label, or is marked "planned" and is not there;
// every catalogue entry is in the hub, under its group; every link in the hub reaches a file in the repository (and an
// in-page anchor a heading); and Purser Cloud's Settings, Connections renders that list with each label and guide.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECTION_GROUPS, connectionsCatalogue, HUB_DOC, REPO_BLOB, type ConnectionGroup } from "../cloud/src/connections.js";
import { CONNECTIONS_VIEW_JS } from "../cloud/src/connectionsView.js";
import { consolePage } from "../cloud/src/console.js";
import { CONNECT_HUB_DOC, CONNECT_HUB_LABEL, homePage } from "../src/redesign/home.js";
import { MESSAGES } from "../src/ui/i18n.js";

const ROOT = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
const HUB = read(HUB_DOC);
const ORIGIN = "https://cloud.test";
const cat = connectionsCatalogue(ORIGIN);
const all = [...cat.money, ...cat.connections];

/** The hub's sections, by group, in its order (the headings the console's groups follow). */
const SECTION: Record<ConnectionGroup, string> = {
  rails: "## Payment rails", ai: "## AI agents over MCP", api: "## The API and webhooks", "no-code": "## No-code tools",
  accounting: "## Accounting", more: "## Peppol, ISO 20022, chat, workplace and the full export",
};
const LABELS = ["live", "sandbox", "testnet", "format export", "built, not tested live", "built, run once in a sandbox", "planned"];

/** Each row of the hub's connection tables, with the section it sits under. */
function hubRows(): { section: string; name: string; label: string; quickstart: string; guide: string }[] {
  const out: { section: string; name: string; label: string; quickstart: string; guide: string }[] = [];
  let section = "", inTable = false;
  for (const line of HUB.split("\n")) {
    if (line.startsWith("## ")) { section = line; inTable = false; continue; }
    if (line === "| Connection | Label | Quickstart | Guide |") { inTable = true; continue; }
    if (!inTable || line.startsWith("|---")) continue;
    if (!line.startsWith("| ")) { inTable = false; continue; }
    const cells = line.slice(2, -2).split(" | ");
    expect({ line, cells: cells.length }).toEqual({ line, cells: 4 });
    out.push({ section, name: cells[0]!, label: cells[1]!, quickstart: cells[2]!, guide: cells[3]! });
  }
  return out;
}

/** GitHub's anchor for a heading. */
const slug = (h: string) => h.replace(/^#+\s*/, "").toLowerCase().replace(/[`*]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
const anchorsOf = (text: string) => new Set(text.split("\n").filter((l) => /^#{1,6} /.test(l)).map(slug));

describe("the hub, docs/integrations/README.md", () => {
  const rows = hubRows();

  it("is titled 'Connect Purser to anything', with its groups in order, each a table", () => {
    expect(HUB.split("\n")[0]).toBe("# Connect Purser to anything");
    const at = CONNECTION_GROUPS.map((g) => HUB.indexOf(`\n${SECTION[g]}\n`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const g of CONNECTION_GROUPS) expect({ g, rows: rows.filter((r) => r.section === SECTION[g]).length > 0 }).toEqual({ g, rows: true });
  });

  it("names each connection with the catalogue's label, or 'planned' for one the catalogue does not hold", () => {
    expect(rows.length).toBeGreaterThan(25);
    for (const r of rows) {
      expect({ name: r.name, label: LABELS.includes(r.label) }).toEqual({ name: r.name, label: true });
      const c = all.find((x) => x.name === r.name);
      if (r.label === "planned") expect({ name: r.name, inCatalogue: Boolean(c) }).toEqual({ name: r.name, inCatalogue: false });
      else expect({ name: r.name, label: c?.kind ?? "not in cloud/src/connections.ts" }).toEqual({ name: r.name, label: r.label });
      expect({ name: r.name, quickstart: r.quickstart.length > 10, guide: /\]\(/.test(r.guide) }).toEqual({ name: r.name, quickstart: true, guide: true });
    }
    expect(rows.filter((r) => r.label === "planned").map((r) => r.name)).toEqual(["Peppol network (an Access Point)"]);
  });

  it("holds every catalogue entry once, under its group's section", () => {
    for (const c of all) {
      const found = rows.filter((r) => r.name === c.name);
      expect({ name: c.name, n: found.length, section: found[0]?.section }).toEqual({ name: c.name, n: 1, section: SECTION[c.group] });
    }
  });

  it("links only to files in the repository (and in-page anchors to its own headings)", () => {
    const links = [...HUB.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThan(40);
    const own = anchorsOf(HUB);
    for (const l of links) {
      if (/^https?:/.test(l)) continue;
      const [path, anchor] = l.split("#") as [string, string | undefined];
      if (!path) { expect({ l, anchor: own.has(anchor!) }).toEqual({ l, anchor: true }); continue; }
      const file = new URL(path, new URL(HUB_DOC, ROOT));
      expect({ l, exists: existsSync(file) }).toEqual({ l, exists: true });
      if (anchor && file.pathname.endsWith(".md")) expect({ l, anchor: anchorsOf(readFileSync(file, "utf8")).has(anchor) }).toEqual({ l, anchor: true });
    }
  });

  it("says Alta (formerly Metal) at its first mention, implies no endorsement, and has 'Build your own connector'", () => {
    expect(HUB.indexOf("Alta (formerly Metal)")).toBe(HUB.search(/\bAlta\b/));
    expect(HUB).toMatch(/no endorsement implied/i);
    const own = HUB.slice(HUB.indexOf("## Build your own connector"), HUB.indexOf("\n## ", HUB.indexOf("## Build your own connector") + 5));
    for (const want of ["read and propose", "/v1/openapi.json", "x-purser-signature", "HMAC-SHA256", "/mcp"]) expect({ want, there: own.includes(want) }).toEqual({ want, there: true });
  });
});

describe("the catalogue, GET /v1/connections", () => {
  it("links each connection to a guide that is a file in the repository, with its anchor", () => {
    expect(cat.hub).toBe(`${REPO_BLOB}${HUB_DOC}`);
    for (const c of all) {
      expect({ name: c.name, doc: c.doc.startsWith(REPO_BLOB) }).toEqual({ name: c.name, doc: true });
      const [path, anchor] = c.doc.slice(REPO_BLOB.length).split("#") as [string, string | undefined];
      expect({ name: c.name, exists: existsSync(new URL(path, ROOT)) }).toEqual({ name: c.name, exists: true });
      if (anchor) expect({ name: c.name, anchor: anchorsOf(read(path)).has(anchor) }).toEqual({ name: c.name, anchor: true });
    }
  });

  it("has the console's words for every group and label, in Dutch and English", () => {
    const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const keys = [...CONNECTION_GROUPS.map((g) => `cs.cx.group.${keyOf(g)}`), ...new Set(all.map((c) => `cs.cx.kind.${keyOf(c.kind)}`))];
    for (const k of [...keys, "cs.cx.title", "cs.cx.lede", "cs.cx.hub", "cs.cx.guide", "cs.cx.rule"]) {
      expect({ k, en: k in MESSAGES.en, nl: k in MESSAGES.nl }).toEqual({ k, en: true, nl: true });
    }
    expect(MESSAGES.nl["cs.cx.title" as keyof typeof MESSAGES.nl]).toBe("Verbindingen");
  });
});

describe("where the hub is linked", () => {
  it("from the README (next to Connect any AI, and its row in More), docs/README.md, llms.txt and Home's footer", () => {
    const readme = read("README.md");
    expect(readme.split(`](${HUB_DOC})`).length - 1).toBe(2);
    expect(readme).toMatch(/\(\[Connect any AI\]\(#more\)\)\. Everything else Purser connects to, each labelled: \[Connect Purser to anything\]\(docs\/integrations\/README\.md\)\./);
    expect(readme).toMatch(/\n\| Connect any AI \|[^\n]*\n\| Connect to anything \|[^\n]*\]\(docs\/integrations\/README\.md\) \|\n/);
    expect(read("docs/README.md")).toContain("[integrations/README.md](integrations/README.md): **Connect Purser to anything**");
    expect(read("llms.txt")).toContain(`- Connect Purser to anything: `);
    expect(read("llms.txt")).toContain(`${REPO_BLOB}${HUB_DOC}`);
    expect(CONNECT_HUB_DOC).toBe(HUB_DOC);
    const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(homePage())![0];
    expect(foot).toContain(`<a class="flink" href="${REPO_BLOB}${HUB_DOC}">${CONNECT_HUB_LABEL}</a>`);
  });
});

/** A stand-in for the console's el(): a tree of plain objects, its text read back as a person would. */
type Node = { tag: string; cls: string; kids: (Node | string)[]; href?: string; target?: string; rel?: string };
const el = (tag: string, cls: string, kids?: unknown): Node => ({ tag, cls, kids: ([] as unknown[]).concat(kids ?? []).filter((k) => k !== null && k !== undefined && k !== false) as (Node | string)[] });
const text = (n: Node | string): string => (typeof n === "string" ? n : n.kids.map(text).join(""));
const find = (n: Node | string, pick: (x: Node) => boolean, out: Node[] = []): Node[] => {
  if (typeof n === "string") return out;
  if (pick(n)) out.push(n);
  for (const k of n.kids) find(k, pick, out);
  return out;
};

describe("Purser Cloud's Settings, Connections", () => {
  const render = (lang: "en" | "nl") => {
    const m = MESSAGES[lang] as Record<string, string>;
    const t = (k: string) => m[k] ?? k, tk = (k: string, fallback: string) => (k in m ? m[k]! : fallback);
    const view = new Function(`${CONNECTIONS_VIEW_JS}\nreturn connectionsViewOf;`)() as (c: unknown, t: unknown, tk: unknown, e: typeof el) => Node[];
    return el("div", "card panel connections", view(JSON.parse(JSON.stringify(cat)), t, tk, el));
  };

  it("renders the catalogue's list: each connection with its label and a link to its guide, grouped as the hub, then the hub and /connect-ai", () => {
    const card = render("en");
    const items = find(card, (n) => n.tag === "li");
    expect(items).toHaveLength(all.length);
    for (const c of all) {
      const li = items.find((x) => (x.kids[0] as Node).tag === "b" && text(x.kids[0]!) === c.name)!;
      expect({ name: c.name, label: text(find(li, (n) => n.cls.startsWith("pill"))[0]!), doc: find(li, (n) => n.tag === "a")[0]?.href }).toEqual({ name: c.name, label: c.kind, doc: c.doc });
    }
    const heads = find(card, (n) => n.tag === "h2").map(text);
    expect(heads).toEqual(["Connections", "Payment rails", "AI agents over MCP", "The API and webhooks", "No-code tools", "Accounting", "Peppol, ISO 20022, chat and the full export"]);
    const top = find(card, (n) => n.tag === "a").slice(0, 2).map((a) => a.href);
    expect(top).toEqual([`${ORIGIN}/connect-ai`, cat.hub]);
    for (const a of find(card, (n) => n.tag === "a")) expect([a.target, a.rel]).toEqual(["_blank", "noopener"]);
    expect(text(card)).toContain("None of these approves a payment");
    // Live in green, built and not yet tried live in amber.
    expect(find(card, (n) => n.cls === "pill ok").map(text).every((x) => x === "live")).toBe(true);
    expect(find(card, (n) => n.cls === "pill warn").map(text).every((x) => x === "built, not tested live")).toBe(true);
  });

  it("speaks Dutch in Dutch, keeps the names as they are, and links nothing but http(s)", () => {
    const card = render("nl");
    expect(text(card)).toContain("Verbindingen");
    expect(text(card)).toContain("gebouwd, nog niet live getest");
    expect(text(card)).toContain("Alta (formerly Metal)");
    const view = new Function(`${CONNECTIONS_VIEW_JS}\nreturn connectionsViewOf;`)() as (c: unknown, t: unknown, tk: unknown, e: typeof el) => Node[];
    const bad = { ...cat, hub: "javascript:alert(1)", connections: [{ ...cat.connections[0]!, doc: "javascript:alert(1)" }], money: [] };
    const nodes = el("div", "", view(bad, (k: string) => k, (_k: string, f: string) => f, el));
    expect(find(nodes, (n) => n.tag === "a").map((a) => a.href)).toEqual([`${ORIGIN}/connect-ai`]);
  });

  it("is in the console's script, reads /v1/connections, and sits on the Settings page for owners and everyone else", () => {
    const html = consolePage("n0nce", { origin: ORIGIN, rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain(CONNECTIONS_VIEW_JS.trim());
    expect(html).toContain("api('/v1/connections')");
    const settings = html.slice(html.indexOf("async function settingsView(){"), html.indexOf("async function drawConn(){"));
    expect(settings.match(/await connectionsCard\(\)/g)).toHaveLength(2);
    expect(view_free(CONNECTIONS_VIEW_JS)).toBe(true);
  });
});

/** The view builds with el() only: no DOM, no network, no clock, no HTML from text. */
function view_free(js: string): boolean {
  return !/\b(document|window|fetch|Date|setTimeout|setInterval|innerHTML|outerHTML|insertAdjacentHTML|eval|Function)\b/.test(js);
}
