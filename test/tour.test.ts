// The 3-minute product tour (owner, 13 Nov): /tour replaced /judge ("it looks amateur and has old links"). Four steps as
// cards, each with a screenshot and one link to a page the site serves today: Try, Proof, Purser Cloud as a guest,
// Connect your AI. /judge answers 301 to /tour so old links keep working; "Judge" is out of the top menu, on the site and
// on Purser Cloud's shared header. The page has no script; its CSP allows its own style and images only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageResponse } from "../worker/src/core.js";
import { buildPages, flowLinks } from "../src/relay/assets.js";
import { LOGOS, MOVED, TOUR_CSP, TOUR_PAGE } from "../src/servers/dashboard.js";
import { INBOX_NAME, SIGN_NAME, TOUR_LINK, TOUR_STEPS, TOUR_TITLE, TOUR_URL, tourPage } from "../src/redesign/tour.js";
import { NAV_MAIN, navHtml } from "../src/ui/nav.js";
import { header } from "../src/redesign/ui.js";
import { siteHeader } from "../cloud/src/siteHeader.js";
import { DEMO_CONNECTOR_TOKEN, PURSER_CLOUD_MCP, PURSER_CLOUD_URL } from "../src/ui/more.js";
import { DEMO_CONNECTOR_TOKEN as CLOUD_DEMO_TOKEN } from "../cloud/src/auth.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ON = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const OFF = buildPages({} as NodeJS.ProcessEnv);
const SITE = "https://kit11.max-31b.workers.dev";

/** The status the Worker's pages answer a GET with, following 302s as a browser does; 404 for no page. */
function served(path: string, pages = ON): number {
  let r = pageResponse(new Request(`${SITE}${path}`), pages);
  for (let hops = 0; r && (r.status === 302 || r.status === 301) && hops < 3; hops++) r = pageResponse(new Request(new URL(r.headers.get("location")!, SITE)), pages);
  return r?.status ?? 404;
}

/** What each step says, as a mark on the page it links to (Purser Cloud is another site: its setup is on /docs). */
const SEES: Record<string, { path: string; html: () => string; marks: string[] }> = {
  // /try/sign: the CFO approves with their own passkey, then the changed cent is refused.
  sign: { path: "/try/sign", html: () => ON.trySign!, marks: ["You're the CFO", "change one cent"] },
  try: { path: "/try", html: () => ON.try, marks: [] },
  proof: { path: "/proof", html: () => ON.proof!, marks: ["Visa via Airwallex", "Airwallex", "Metal"] },
  cloud: { path: "/docs", html: () => ON.docs!, marks: ["Try as guest", PURSER_CLOUD_URL] },
  connect: { path: "/docs", html: () => ON.docs!, marks: ['id="connect-ai"', PURSER_CLOUD_MCP, DEMO_CONNECTOR_TOKEN, "Cursor", "Gemini CLI"] },
};

describe("/tour: five steps, three minutes", () => {
  // Judges, 13 Nov (#7): one hero demo first, "Sign in 60 seconds" (/try/sign); then "Run the payables inbox" (/try).
  it("is Sign in 60 seconds, Run the payables inbox, Proof, a sample company, Connect your AI, in that order, 180 s in all", () => {
    expect(TOUR_TITLE).toBe("Product tour · 3 minutes");
    expect([SIGN_NAME, INBOX_NAME]).toEqual(["Sign in 60 seconds", "Run the payables inbox"]);
    expect(TOUR_STEPS.map((s) => [s.title, s.link.href])).toEqual([
      [SIGN_NAME, "/try/sign"],
      [INBOX_NAME, "/try"],
      ["See the proof", "/proof"],
      ["Look around a sample company", PURSER_CLOUD_URL],
      ["Connect your AI", "/docs#connect-ai"],
    ]);
    expect(TOUR_STEPS.reduce((t, s) => t + s.seconds, 0)).toBe(180);
    expect(DEMO_CONNECTOR_TOKEN).toBe(CLOUD_DEMO_TOKEN);
    expect(PURSER_CLOUD_URL).toBe("https://purser-try.max-31b.workers.dev/");
    for (const s of TOUR_STEPS) expect({ step: s.id, oneLine: !s.text.includes("\n") && s.text.length <= 200 }).toEqual({ step: s.id, oneLine: true });
  });

  // Owner, 13 Nov: a visitor who is not technical. Each card says in one plain sentence what you will see or do
  // ("You'll see", "You'll approve", "You'll run"), has one big button, and the page uses no jargon.
  it("speaks plainly: one sentence per card, what you'll see, one big button, no jargon", () => {
    for (const s of TOUR_STEPS) {
      expect({ step: s.id, sentences: s.text.split(/(?<=[.!?])\s+/).length }).toEqual({ step: s.id, sentences: 1 });
      expect({ step: s.id, says: /^You'll (see|approve|run) /.test(s.text) }).toEqual({ step: s.id, says: true });
    }
    const main = /<main>[\s\S]*<\/main>/.exec(TOUR_PAGE)![0];
    const words = main.replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/\b(relay|MCP|x402|testnet|sandbox|API|passkey|token|OAuth|ledger|webhook|rail|CLI|SDK|JSON|endpoint)s?\b/i);
    // Each card's one button, read from the markup (no pattern built from a URL): exactly the steps' links, in order.
    const buttons = main.split('<div class="go">').slice(1).map((seg) => ({ count: (seg.split("</div>")[0]!.match(/<a /g) ?? []).length, href: /^<a class="btn[^"]*" href="([^"]*)"/.exec(seg)?.[1] ?? null }));
    expect(buttons).toEqual(TOUR_STEPS.map((s) => ({ count: 1, href: s.link.href })));
    expect(TOUR_PAGE).toContain(".stop .go .btn { height: 52px;");
  });

  for (const s of TOUR_STEPS) {
    it(`step ${TOUR_STEPS.indexOf(s) + 1} (${s.id}) links to a page the site serves, shows a screenshot of it, and says only what that page shows`, () => {
      if (s.link.href.startsWith("/")) expect({ path: s.link.href, status: served(s.link.href.replace(/#.*/, "")) }).toEqual({ path: s.link.href, status: 200 });
      else expect(s.link.href).toBe(PURSER_CLOUD_URL);
      const file = new URL(`../docs/assets/tour/${s.image}`, import.meta.url);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(80_000);
      expect(LOGOS[s.image]?.type).toBe("image/webp");
      expect(served(`/assets/${s.image}`)).toBe(200);
      const see = SEES[s.id]!;
      for (const m of see.marks) expect({ step: s.id, mark: m, shown: see.html().includes(m) }).toEqual({ step: s.id, mark: m, shown: true });
    });
  }

  it("draws each step as a card with its number, time, title, line, screenshot and one link; no old page, no raw path", () => {
    const html = tourPage();
    expect(html).toBe(TOUR_PAGE);
    expect(html).toContain('<h1 class="h-hero">Product tour · 3 minutes</h1>');
    for (const [i, s] of TOUR_STEPS.entries()) {
      expect(html).toContain(`<span class="n">${i + 1}</span>`);
      expect(html).toContain(`<h2>${s.title}</h2>`);
      expect(html).toContain(`<img src="assets/${s.image}" alt="`);
      expect(html).toContain(`href="${s.link.href}"`);
    }
    const main = /<main>[\s\S]*<\/main>/.exec(html)![0];
    expect(main).not.toMatch(/href="\/?(judge|watch|replay|live|demo|overview|month|lab|film|try\/verify|trace)\b/);
    // Below 600 px the screenshots are not shown (review, 13 Nov: unreadable thumbnails at phone width).
    expect(html).toContain("@media (max-width: 599px) { .stop .shot { display: none; } }");
    // The lead says what holds without overclaiming: agents pay alone within their limits (review, 13 Nov).
    expect(html).toContain("Purser lets AI agents pay a company's bills, and above an agent's limit, only the CFO's Face ID moves money.");
    // No file path or command in what a visitor reads (the footer's "What's real?" names its source, as every page does).
    expect(main.replace(/<[^>]+>/g, " ")).not.toMatch(/\bsrc\/|docs\/|\.ts\b|npm run|localStorage|jury|judg/i);
  });

  it("has no script, and its CSP allows its own style and images only", () => {
    expect(scriptBlocks(TOUR_PAGE)).toHaveLength(0);
    expect(TOUR_PAGE).not.toMatch(/<script|<form/);
    const style = /<style>([\s\S]*?)<\/style>/.exec(TOUR_PAGE)![1]!;
    expect(TOUR_CSP).toContain(`style-src 'sha256-${createHash("sha256").update(style, "utf8").digest("base64")}'`);
    expect(TOUR_CSP).toContain("script-src 'none'");
    expect(TOUR_CSP).toContain("connect-src 'none'");
    expect(TOUR_CSP).toContain("img-src 'self'");
    expect(TOUR_CSP).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it("the Worker serves it at /tour in either bundle, and /judge answers 301 to it, query kept", () => {
    for (const pages of [ON, OFF]) {
      const r = pageResponse(new Request(`${SITE}/tour`), pages);
      expect(r?.status).toBe(200);
      expect(r?.headers.get("content-security-policy")).toBe(TOUR_CSP);
      expect(pages.tour).toBe(flowLinks(TOUR_PAGE, pages === ON));
      const moved = pageResponse(new Request(`${SITE}/judge?from=form`), pages);
      expect(moved?.status).toBe(301);
      expect(moved?.headers.get("location")).toBe("/tour?from=form");
      // A link pasted with its full stop still lands.
      expect(served("/judge.", pages)).toBe(200);
    }
    expect(MOVED).toEqual({ "/judge": "/tour" });
  });
});

describe("Judge is out of the menu", () => {
  it("neither the site's header nor Purser Cloud's shared header has it", () => {
    expect(NAV_MAIN.map(([, label]) => label)).not.toContain("Judge");
    for (const html of [header("home"), header("tour"), siteHeader("try"), siteHeader("cloud"), siteHeader(null)]) {
      expect(html).not.toMatch(/>Judge</);
      expect(html).not.toMatch(/href="[^"]*\/?judge"/);
    }
    // Max, 13 Nov: "Product tour" is the first item under More, in both navigations; /tour marks More, never a tab.
    for (const html of [header("home"), navHtml("home"), siteHeader(null)]) expect(/<div class="pmenu"><a href="[^"]*tour">Product tour<\/a>/.test(html)).toBe(true);
    expect(header("tour")).toContain('<summary class="on">More</summary>');
    expect(header("tour")).toContain('<a href="tour" aria-current="page">Product tour</a>');
    expect(header("tour")).not.toMatch(/<a href="[^"]*" class="on" aria-current="page">/);
  });

  it("no page the site serves links to /judge", () => {
    for (const pages of [ON, OFF]) {
      for (const [name, html] of Object.entries(pages)) {
        if (typeof html !== "string") continue;
        expect({ name, judge: /href="[^"]*\/judge\b|href="judge"/.test(html) }).toEqual({ name, judge: false });
      }
    }
  });
});

describe("the way in: Home, the README, llms.txt and the form", () => {
  it("Home's one primary button opens /tour, in either bundle (owner, 13 Nov: the obvious place to start)", () => {
    for (const pages of [ON, OFF]) {
      // The hero's button and "Product tour" under More.
      expect(pages.home!.match(/href="tour"/g)).toHaveLength(2);
      expect(pages.home).toContain('<a class="btn primary big start" href="tour">Take the 3-minute tour');
    }
  });

  it("the README has one line to /tour near the top, and none to /judge", () => {
    const lines = read("README.md").split("\n");
    const at = lines.findIndex((l) => l.includes(TOUR_URL));
    expect(TOUR_URL).toBe(`${SITE}/tour`);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(20);
    expect(lines[at]).toContain(`**[${TOUR_LINK}](${TOUR_URL})**`);
    expect(lines.filter((l) => l.includes(TOUR_URL))).toHaveLength(1);
    expect(read("README.md")).not.toMatch(/workers\.dev\/judge\b|Judge it in 3 minutes/);
  });

  it("llms.txt names the tour and the replay at their current addresses", () => {
    const llms = read("llms.txt");
    expect(llms).toContain(`The 3-minute product tour: ${TOUR_URL}`);
    expect(llms).not.toMatch(/workers\.dev\/(judge|watch)\b/);
  });

  it("the form's instructions start with /tour, and the form stays under 4,000 characters", () => {
    const form = read("docs/submission/README.md");
    const ins = form.split("<!-- instructions -->")[1]!.split("<!-- /instructions -->")[0]!.trim();
    expect(ins.startsWith(`1. The 3-minute product tour: <${TOUR_URL}>`)).toBe(true);
    expect(ins).not.toMatch(/https:\/\/[^\s<>]*[.,](?=\s|$)/);
    expect(ins.length).toBeLessThan(4000);
  });
});
