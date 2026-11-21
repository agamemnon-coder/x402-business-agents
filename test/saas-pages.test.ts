// The product page under "More" (12 Nov): /security ("Security and trust"). Since 21 Nov (the owner: "we still have a
// lot of old things on the new page") only what is current: the architecture with its controls, "What we did, with
// evidence", the limits of this build and the CI checks; the layers diagram, its charts, the eleven control cards and
// the red team's October rounds are gone. Nothing on it is typed in by hand. It is served by the Worker and by
// `npm run judge` under a style-only policy (no script), linked from "More" and from the footer, and named in llms.txt.
// /pricing went on 13 Nov, evening (owner): it answers 302 to /home, and nothing links to it.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHECK_PATHS } from "../src/cli/judge.js";
import { repoHref } from "../src/redesign/productPage.js";
import { HARNESS_LINE, NOT_YET_LINE, NOT_YET_SOURCES, docLine, securityLead, securityPage } from "../src/redesign/security.js";
import { evidenceItems } from "../src/redesign/securityEvidence.js";
import { buildPages } from "../src/relay/assets.js";
import { AIRWALLEX_PAGE, BOOKS_PAGE, CLAUDE_PAGE, METAL_PAGE, PROOF_PAGE, RUNS_PAGE, SECURITY_CSP, SECURITY_PAGE, VISA_PAGE } from "../src/servers/dashboard.js";
import { menuItemOf } from "../src/ui/more.js";
import { navHtml } from "../src/ui/nav.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { HEADER_PATHS } from "./security-headers.rules.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// "&amp;" last, so an escaped entity ("&amp;lt;") is decoded once, never twice.
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The page's <main> as a person reads it with every fold open: tags out, entities decoded, white space single. */
const mainText = (html: string) => decode((/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The repository files a page links to on GitHub (without any #anchor). */
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const repoLinks = (html: string) => [...html.matchAll(new RegExp(`href="${reEscape(REPO)}([^"#]+)`, "g"))].map((m) => m[1]!);

describe("/security: security and trust, current only (21 Nov)", () => {
  const html = securityPage(), text = mainText(html);

  it("runs top to bottom: the architecture, what we did with evidence, the limits, the CI checks", () => {
    const at = (s: string) => html.indexOf(s);
    const order = ['id="arch"', 'class="card ev"', 'id="s-away"', 'id="s-notyet"', 'id="cichk-h"'].map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps none of the old blocks: no layers diagram or its charts, no control cards, no October red-team rounds", () => {
    for (const gone of ['id="layers"', 'id="hostile"', 'id="where"', 'id="s-sign"', 'id="s-redteam"', 'id="s-audit"', "zheat", "zlayers"]) expect({ gone, found: html.includes(gone) }).toEqual({ gone, found: false });
    expect(text).not.toMatch(/31 October|2 November|Red team: \d+ attacks/);
  });

  it("says under the heading the newest attack tests' figures, as the evidence items show them", () => {
    const items = evidenceItems();
    const zt = items.find((x) => x.id === "e-zerotrust")!, rt = items.find((x) => x.id === "e-redteam")!;
    expect(securityLead()).toContain(`${zt.fig.toLowerCase()} attacks on the payment path stopped`);
    expect(securityLead()).toContain(`${rt.fig.toLowerCase()} attacks on the public API held`);
    expect(text).toContain(securityLead());
    const report = JSON.parse(read("docs/zero-trust/report.json")) as { attacks_run: number; attacks_stopped: number; attacks_where_money_moved: number };
    expect(zt.fig).toBe(report.attacks_stopped === report.attacks_run ? `All ${report.attacks_run}` : `${report.attacks_stopped} of ${report.attacks_run}`);
    expect(zt.note.startsWith(report.attacks_where_money_moved === 0 ? "None moved money" : `${report.attacks_where_money_moved} moved money`)).toBe(true);
  });

  it("not yet: one honest sentence, each part of it a sentence the docs say, word for word", () => {
    expect(text).toContain(NOT_YET_LINE);
    for (const l of NOT_YET_SOURCES) expect(docLine(l)).toBe(l);
    expect(html).toContain(repoHref("docs/controls.md", "#not-in-place-summary"));
  });

  it("says what is real in its own words: sandbox and testnet only, the harness simulated", () => {
    const real = html.slice(html.indexOf('<details class="real"'));
    expect(real).toContain("Sandbox and testnet only");
    expect(decode(real)).toContain(HARNESS_LINE);
  });
});

describe("the page on the site, and the one that went", () => {
  const pages = buildPages() as Pages;

  it("is built once and served as it is: the same page from the Worker's bundle and the judge server; /pricing is gone", () => {
    expect(SECURITY_PAGE).toBe(securityPage());
    // Without /try/sign in the bundle the page is served unchanged; with it, /security's link to Try leads there.
    expect(pages.security).toBe(SECURITY_PAGE);
    const gone = pageResponse(new Request("https://x.test/pricing"), pages);
    // 21 Nov (Max): the plans are on /business, beside the 30-Day Founding Partner Pilot; /pricing lands there.
    expect({ status: gone?.status, to: gone?.headers.get("location") }).toEqual({ status: 302, to: "/business#pricing" });
    expect((buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv) as Pages).security).toContain('href="/try" data-next="/try"');
    expect(CHECK_PATHS).toEqual(expect.arrayContaining(["/security"]));
    expect(CHECK_PATHS).not.toContain("/pricing");
    // 12 Nov (review): the README said "18 pages" while the list grew; it now names the list, which no count can outdate.
    // Since 13 Nov (the README upgrade) the quick start's own line says it, as a comment beside the command.
    const check = read("README.md").split("\n").find((l) => l.startsWith("npm run judge -- --check")) ?? "";
    expect(check).toContain("every page in CHECK_PATHS built from the main run's record, offline");
    expect(check).not.toMatch(/\b\d+ pages\b/);
    expect(read("src/cli/judge.ts")).toContain("for (const path of CHECK_PATHS) {");
    expect(HEADER_PATHS.filter((h) => ["/pricing", "/security"].includes(h.path))).toEqual(expect.arrayContaining([{ path: "/pricing", kind: "redirect", status: 302 }, { path: "/security", kind: "page", status: 200 }]));
  });

  it("carries no script, so it is served under a style-only policy of its own", () => {
    for (const [name, html, csp] of [["security", SECURITY_PAGE, SECURITY_CSP]] as const) {
      expect({ name, scripts: scriptBlocks(html) }).toEqual({ name, scripts: [] });
      expect({ name, styles: (html.match(/<style>/g) ?? []).length }).toEqual({ name, styles: 1 });
      expect({ name, csp }).toEqual({ name, csp: expect.stringMatching(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/) });
      expect(pages.csp[name]).toBe(csp);
      const res = pageResponse(new Request(`https://x.test/${name}`), pages)!;
      expect({ name, status: res.status, type: res.headers.get("content-type"), csp: res.headers.get("content-security-policy") }).toEqual({ name, status: 200, type: "text/html; charset=utf-8", csp });
      // No image, font or script from anywhere but the site itself.
      expect({ name, outside: html.match(/<(?:img|script|link)[^>]*(?:src|href)="https?:[^"]*"/g) ?? [] }).toEqual({ name, outside: [] });
    }
    // An older bundle without the pages answers nothing for them (the Worker then serves the clean 404).
    const { security: _s, ...older } = pages;
    expect(pageResponse(new Request("https://x.test/security"), older as Pages)).toBeNull();
  });

  it("is marked in the menu as the page the reader is on, under More", () => {
    for (const [key, html] of [["security", SECURITY_PAGE]] as const) {
      const nav = /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)![1]!;
      expect({ key, more: /<details class="pmore"><summary class="on">More<\/summary>/.test(nav), here: nav.includes(`<a href="${key}" aria-current="page">`), tabs: (nav.match(/class="on" aria-current="page"/g) ?? []).length }).toEqual({ key, more: true, here: true, tabs: 0 });
    }
    // Elsewhere "More" is not marked, and the dropdown is closed until the reader opens it.
    const home = /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(pages.home!)![1]!;
    expect(home).toContain('<details class="pmore"><summary>More</summary>');
    expect(home).not.toMatch(/<details class="pmore" open/);
  });

  // 12 Nov (orchestrator's preview): the marked item follows the page. A page listed under More marks More and its own
  // link there, never a tab; /runs marks Proof. One mapping in the nav code (src/ui/more.ts menuItemOf).
  // Jury, 13 Nov: /runs highlighted Proof, which read as a bug; it marks no tab now.
  it("mark the item the page sits under: partner pages mark More, /runs marks no tab", () => {
    const state = (html: string) => {
      const nav = /<nav class="tabs" aria-label="Main">([\s\S]*?)<\/nav>/.exec(html)![1]!;
      return { more: /<summary class="on">More<\/summary>/.test(nav), tabs: [...nav.matchAll(/<a href="(\w+)" class="on" aria-current="page">/g)].map((m) => m[1]) };
    };
    // /books (with T:0 in it since 21 Nov; /t0 answers 301 there): under More like the partner pages.
    for (const [key, html] of [["airwallex", AIRWALLEX_PAGE], ["metal", METAL_PAGE], ["visa", VISA_PAGE], ["claude", CLAUDE_PAGE], ["books", BOOKS_PAGE]] as const) {
      expect({ key, ...state(html), here: html.includes(`<a href="${key === "metal" ? "alta" : key}" aria-current="page">`) }).toEqual({ key, more: true, tabs: [], here: true });
    }
    expect(state(RUNS_PAGE)).toEqual({ more: false, tabs: [] });
    expect(state(PROOF_PAGE)).toEqual({ more: false, tabs: ["proof"] });
    expect(state(pages.home!)).toEqual({ more: false, tabs: ["home"] });
    // The older navigation (src/ui/nav.ts) maps the same way.
    for (const key of ["airwallex", "metal", "visa", "claude"] as const) {
      const nav = navHtml(key);
      expect({ key, proof: /data-nav="proof" class="on"/.test(nav), more: /<summary class="on">More<\/summary>/.test(nav) }).toEqual({ key, proof: false, more: true });
    }
    expect(navHtml("month")).toMatch(/data-nav="proof" class="on"/);
    expect(menuItemOf("runs")).toBeNull();
    // The product tour and Pricing went on 13 Nov, evening (owner): neither is under More.
    expect(menuItemOf("tour")).toBeNull();
    expect(menuItemOf("pricing")).toBeNull();
    expect(menuItemOf("security")).toBe("more");
    expect(menuItemOf("proof")).toBe("proof");
    expect(menuItemOf(null)).toBeNull();
  });

  it("links only to repository files that exist", () => {
    for (const [name, html] of [["security", SECURITY_PAGE]] as const) {
      const files = repoLinks(html);
      expect({ name, some: files.length > 0 }).toEqual({ name, some: true });
      for (const f of files) expect({ name, file: f, exists: existsSync(new URL(`../${f}`, import.meta.url)) }).toEqual({ name, file: f, exists: true });
    }
  });

  it("is named in llms.txt, one line, with what it is; /pricing is not", () => {
    const lines = read("llms.txt").split("\n");
    expect(lines.filter((l) => /kit11\.max-31b\.workers\.dev\/(pricing|tour)\b/.test(l))).toEqual([]);
    expect(lines.filter((l) => / https:\/\/kit11\.max-31b\.workers\.dev\/security( |$)/.test(l))).toEqual(["- Security and trust: https://kit11.max-31b.workers.dev/security (each control with its proof, and what is not in place yet; sandbox and testnet only)"]);
  });
});
