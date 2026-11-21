// "Connect Purser to anything" (20 Nov, the owner: "make it clear and possible that Purser connects to everything and
// everyone, findable in the docs and in Purser Cloud"). It holds: every connection the hub names is in the catalogue
// GET /v1/connections serves (cloud/src/connections.ts) with the same label, or is marked "planned" and is not there;
// every catalogue entry is in the hub, under its group; every link in the hub reaches a file in the repository (and an
// in-page anchor a heading); and Purser Cloud's Settings, Connections renders that list with each label and guide.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECTION_GROUPS, connectionsCatalogue, HUB_DOC, REPO_BLOB, type ConnectionGroup } from "../cloud/src/connections.js";
import { BRAND_LOGOS } from "../cloud/src/brandLogos.gen.js";
import { CONNECTIONS_LOGOS_JS, CONNECTIONS_VIEW_JS } from "../cloud/src/connectionsView.js";
import { createHash } from "node:crypto";
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
    const page = ["cs.cx.kind.planned", "cs.cx.more", "cs.cx.needs", "cs.cx.record", "cs.cx.here.connected", "cs.cx.here.not_connected", "cs.cx.here.not_available",
      "cs.cx.sum.here", "cs.cx.sum.live", "cs.cx.sum.test", "cs.cx.sum.file", "cs.cx.sum.built", "cs.cx.sum.planned", "cs.nav.connections", "cs.cxp.lede", "cs.cxp.setup", "cs.cxp.setup_sub", "cs.cxp.setup_sub_reader"];
    for (const k of [...keys, ...page, "cs.cx.title", "cs.cx.lede", "cs.cx.hub", "cs.cx.guide", "cs.cx.rule"]) {
      expect({ k, en: k in MESSAGES.en, nl: k in MESSAGES.nl }).toEqual({ k, en: true, nl: true });
    }
    expect(MESSAGES.nl["cs.cx.title" as keyof typeof MESSAGES.nl]).toBe("Alle verbindingen");
  });

  it("gives every connection a unique id, what a company needs, the company's own rows it stands on, and a record that is a file", async () => {
    const ids = [...all.map((c) => c.id), ...cat.planned.map((p) => p.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of all) expect({ name: c.name, needs: c.needs.length > 10 }).toEqual({ name: c.name, needs: true });
    // The rows a card stands on are the ids GET /v1/connections/mine really returns.
    const { testCloud } = await import("./support/cloud.js");
    const c = testCloud();
    try {
      const t = await c.tenant("hub");
      const mine = new Set(((await c.req("GET", "/v1/connections/mine", { key: t.session })).json.items as { id: string }[]).map((x) => x.id));
      for (const x of all) for (const id of x.company) expect({ name: x.name, id, known: mine.has(id) }).toEqual({ name: x.name, id, known: true });
    } finally { c.close(); }
    // A record backs only a label that claims a run, and it is a file in the repository.
    for (const x of all.filter((y) => y.record)) {
      expect({ name: x.name, kind: ["live", "sandbox", "testnet", "built, run once in a sandbox"].includes(x.kind) }).toEqual({ name: x.name, kind: true });
      expect({ name: x.name, exists: existsSync(new URL(x.record!.slice(REPO_BLOB.length), ROOT)) }).toEqual({ name: x.name, exists: true });
    }
    // Every planned one is a "planned" row of the hub, under its group.
    const rows = hubRows();
    for (const p of cat.planned) expect(rows.find((r) => r.name === p.name)).toMatchObject({ label: "planned", section: SECTION[p.group] });
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

describe("Purser Cloud's Connections page (its own tab since 21 Nov)", () => {
  type View = (c: unknown, t: unknown, tk: unknown, e: typeof el, o?: unknown) => Node[];
  const view = () => new Function(`${CONNECTIONS_VIEW_JS}\nreturn connectionsViewOf;`)() as View;
  const render = (lang: "en" | "nl", o?: unknown) => {
    const m = MESSAGES[lang] as Record<string, string>;
    const t = (k: string, v?: Record<string, string>) => { let s = m[k] ?? k; for (const x in v ?? {}) s = s.split(`{${x}}`).join(v![x]!); return s; };
    const tk = (k: string, fallback: string) => (k in m ? m[k]! : fallback);
    return el("div", "card panel connections", view()(JSON.parse(JSON.stringify(cat)), t, tk, el, o));
  };
  const cards = (card: Node) => find(card, (n) => n.tag === "li" && n.cls.startsWith("cx-card"));
  const cardOf = (card: Node, name: string) => cards(card).find((li) => find(li, (n) => n.tag === "b").map(text)[0] === name)!;

  it("renders one card per connection, planned ones too, each with its label, what it needs, its guide and its run record, in six sections", () => {
    const card = render("en");
    expect(cards(card)).toHaveLength(all.length + cat.planned.length);
    for (const c of [...all, ...cat.planned.map((p) => ({ ...p, kind: "planned", record: undefined }))]) {
      const li = cardOf(card, c.name);
      const hrefs = find(li, (n) => n.tag === "a").map((a) => a.href);
      expect({ name: c.name, label: text(find(li, (n) => n.cls.startsWith("pill"))[0]!), doc: hrefs.includes(c.doc), record: c.record ? hrefs.includes(c.record) : true, needs: text(find(li, (n) => n.cls === "cx-needs")[0]!).includes(c.needs) })
        .toEqual({ name: c.name, label: c.kind, doc: true, record: true, needs: true });
    }
    const heads = find(card, (n) => n.tag === "h2").map(text);
    // 21 Nov (the owner): six sections by what a company connects, each with its count; every card in exactly one.
    expect(heads).toEqual(["Every connection", "Money rails3", "Bookkeeping & ERP12", "AI & agents10", "Messaging & alerts3", "API, data & export7", "Sign-in & workspace2"]);
    expect(heads.slice(1).reduce((n, h) => n + Number(/\d+$/.exec(h)![0]), 0)).toBe(all.length + cat.planned.length);
    const top = find(card, (n) => n.tag === "a").slice(0, 2).map((a) => a.href);
    expect(top).toEqual([`${ORIGIN}/connect-ai`, cat.hub]);
    for (const a of find(card, (n) => n.tag === "a")) expect([a.target, a.rel]).toEqual(["_blank", "noopener"]);
    expect(text(card)).toContain("None of these approves a payment");
    // Live green, test money blue, built and not yet tried live amber, planned dashed grey.
    const tone = (cls: string) => [...new Set(find(card, (n) => n.cls === cls).map(text))].sort();
    expect(tone("pill ok")).toEqual(["live"]);
    expect(tone("pill tmoney")).toEqual(["built, run once in a sandbox", "sandbox", "testnet"]);
    expect(tone("pill warn")).toEqual(["built, not tested live"]);
    expect(tone("pill plan")).toEqual(["planned"]);
    // The summary counts the labels as they are; nothing about a company without the company's rows.
    const sum = find(card, (n) => n.cls === "cx-sum")[0]!;
    expect(find(sum, (n) => n.tag === "b").map(text)).toEqual([String(all.filter((c) => c.kind === "live").length), String(all.filter((c) => ["sandbox", "testnet", "built, run once in a sandbox"].includes(c.kind)).length),
      String(all.filter((c) => c.kind === "format export").length), String(all.filter((c) => c.kind === "built, not tested live").length), String(cat.planned.length)]);
    expect(find(card, (n) => n.cls.startsWith("cx-here"))).toHaveLength(0);
  });

  it("says where each connection stands for this company from its own rows, and puts a button only where the console gives one", () => {
    const mine = [
      { id: "mcp", status: "connected", detail: "1 connector token" }, { id: "api_keys", status: "not_connected", detail: null }, { id: "webhook", status: "not_connected", detail: null },
      { id: "sign_in_google", status: "not_available", detail: null }, { id: "sign_in_microsoft", status: "not_available", detail: null }, { id: "sign_in_apple", status: "not_available", detail: null },
      { id: "slack", status: "not_connected", detail: null }, { id: "teams", status: "connected", detail: null },
    ];
    const card = render("en", { mine, action: (x: { id: string }) => (x.id === "rest" ? el("button", "btn", "Make a key") : null) });
    const here = (name: string) => { const p = find(cardOf(card, name), (n) => n.cls.startsWith("cx-here"))[0]; return p ? `${p.cls} ${text(p)}` : null; };
    expect(here("MCP server (Connect any AI)")).toBe("cx-here connected Connected for this company · 1 connector token");
    expect(here("Claude")).toBe("cx-here connected Connected for this company · 1 connector token");
    expect(here("Read API (REST) and its OpenAPI")).toBe("cx-here not_connected Not connected yet: you can switch it on");
    expect(here("Sign in with Google, Microsoft and Apple")).toBe("cx-here not_available Not offered on this cloud yet");
    expect(here("Slack and Microsoft Teams messages")).toMatch(/^cx-here connected /);
    // No row for it: no line (ChatGPT's own use of a token is not known; a file export has nothing to connect).
    expect(here("ChatGPT")).toBeNull();
    expect(here("Xero")).toBeNull();
    expect(cardOf(card, "MCP server (Connect any AI)").cls).toBe("cx-card on");
    expect(text(find(card, (n) => n.cls === "cx-stat here")[0]!)).toBe("3connected for this company");
    expect(find(card, (n) => n.tag === "button").map((b) => text(b))).toEqual(["Make a key"]);
    expect(find(cardOf(card, "Read API (REST) and its OpenAPI"), (n) => n.tag === "button")).toHaveLength(1);
  });

  it("shows each product's own logo where one is on record, named for a screen reader, and letters or an icon where none is", () => {
    const logos = Object.fromEntries(Object.entries(BRAND_LOGOS).map(([k, v]) => [k, { name: v.name, uri: v.uri }]));
    const card = render("en", { logos: { ...logos, airwallex: { name: "Airwallex", uri: "data:image/png;base64,AA" } }, icon: (n: string) => el("span", `ic-${n}`) });
    const imgs = (name: string) => find(cardOf(card, name), (n) => n.tag === "img").map((i) => (i as Node & { alt: string }).alt);
    expect(imgs("Airwallex")).toEqual(["Airwallex"]);
    expect(imgs("Visa via Airwallex Airi")).toEqual(["Visa"]);
    expect(imgs("Slack and Microsoft Teams messages")).toEqual(["Slack", "Microsoft Teams"]);
    expect(imgs("Sign in with Google, Microsoft and Apple")).toEqual(["Google", "Microsoft", "Apple"]);
    expect(imgs("Moneybird (API)")).toEqual(["Moneybird"]);
    expect(imgs("Business Central and Odoo (API)")).toEqual(["Microsoft", "Odoo"]);
    // No logo on record: T:0 keeps its letters; Purser's own webhook its icon.
    expect(imgs("T:0 (outside ledger)")).toEqual([]);
    expect(text(find(cardOf(card, "T:0 (outside ledger)"), (n) => n.cls.includes("cx-letters"))[0]!)).toBe("T:0");
    expect(find(cardOf(card, "Webhooks"), (n) => n.cls === "ic-zap")).toHaveLength(1);
    // Every logo is a data URL (the console's img-src allows data:, nothing is fetched from elsewhere).
    for (const [k, v] of Object.entries(BRAND_LOGOS)) expect({ k, data: v.uri.startsWith("data:image/svg+xml,") }).toEqual({ k, data: true });
    expect(CONNECTIONS_LOGOS_JS).not.toMatch(/https?:\/\/(?!www\.w3\.org|ns\.adobe\.com)/);
  });

  it("holds each logo to its file and its record in src/ui/logos/README.md", () => {
    const readme = read("src/ui/logos/README.md");
    for (const [k, v] of Object.entries(BRAND_LOGOS)) {
      const src = k === "alta" ? "src/ui/logos/alta.svg" : null;
      const file = src ?? readme.split("\n").map((l) => /^\| ([\w.-]+\.svg) \|.*`([0-9a-f]{64})` \|$/.exec(l)).find((m) => m && m[2]!.startsWith(v.sha256))?.[1];
      expect({ k, recorded: !!file }).toEqual({ k, recorded: true });
      const path = src ?? `src/ui/logos/brands/${file}`;
      expect({ k, sha: createHash("sha256").update(readFileSync(new URL(path, ROOT))).digest("hex").slice(0, 16) }).toEqual({ k, sha: v.sha256 });
    }
  });

  it("speaks Dutch in Dutch, keeps the names as they are, and links nothing but http(s)", () => {
    const card = render("nl");
    expect(text(card)).toContain("Alle verbindingen");
    expect(text(card)).toContain("gebouwd, nog niet live getest");
    expect(text(card)).toContain("Alta (formerly Metal)");
    const bad = { ...cat, hub: "javascript:alert(1)", connections: [{ ...cat.connections[0]!, doc: "javascript:alert(1)", record: "javascript:alert(2)" }], money: [], planned: [] };
    const nodes = el("div", "", view()(bad, (k: string) => k, (_k: string, f: string) => f, el));
    expect(find(nodes, (n) => n.tag === "a").map((a) => a.href)).toEqual([`${ORIGIN}/connect-ai`]);
  });

  it("is its own tab, reads /v1/connections and the company's own rows, and Settings no longer repeats it", () => {
    const html = consolePage("n0nce", { origin: ORIGIN, rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain(CONNECTIONS_VIEW_JS.trim());
    expect(html).toContain('<a href="#/connections" data-tab="connections" data-t="cs.nav.connections">Connections</a>');
    const page = html.slice(html.indexOf("async function connectionsView(q){"), html.indexOf("// --- The router"));
    expect(page).toContain("api('/v1/connections')");
    expect(page).toContain("api('/v1/connections/mine')");
    expect(page).toContain("connectionsViewOf(cat,t,tk,el,{mine:");
    for (const card of ["claudeCard(m,owner)", "webhookCard()", "alertsCard()", "chatCard()", "drawConn()", "drawInts()", "drawAwx()"]) expect({ card, there: page.includes(card) }).toEqual({ card, there: true });
    const settings = html.slice(html.indexOf("async function settingsView(q){"), html.indexOf("// --- Connections (21 Nov)"));
    // 21 Nov (the owner): "remove the Connections section from Settings since there is already a Connections tab".
    expect(settings).not.toContain("cx-pointer");
    expect(settings).not.toContain("connectionsViewOf");
    for (const card of ["youCard(m)", "policyCard()", "notifyCard(m)", "accessCard(m)", "dangerCard(m)"]) expect({ card, there: settings.includes(card) }).toEqual({ card, there: true });
    expect(view_free(CONNECTIONS_VIEW_JS)).toBe(true);
    expect(MESSAGES.nl["cs.nav.connections" as keyof typeof MESSAGES.nl]).toBe("Koppelingen");
  });
});

/** The view builds with el() only: no DOM, no network, no clock, no HTML from text. */
function view_free(js: string): boolean {
  return !/\b(document|window|fetch|Date|setTimeout|setInterval|innerHTML|outerHTML|insertAdjacentHTML|eval|Function)\b/.test(js);
}
