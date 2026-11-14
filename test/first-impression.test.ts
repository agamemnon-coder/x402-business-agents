// The first impression (4 Nov): "/" is Home itself for a guest, so a reader without script (a link preview, a fetch)
// sees Home and not the CFO dashboard's hidden blocks; with a query it stays the CFO dashboard's page (/?recorded and
// /?autonomy, as the README and the deck link them); the CFO's viewer link (#view=…, never sent to a server) goes on
// from Home to the dashboard. The browser side of the same: test/browser/root.check.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startJudge } from "../src/cli/judge.js";
import { CORE_SENTENCE, DIFFERENTIATORS, HERO, WHAT_IT_IS } from "../src/config/brand.js";
import { HOME_SUB, CFO_FORWARD_JS, homeHeadingHtml } from "../src/redesign/home.js";
import { esc } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { textOutsideTags } from "./support/scriptBlocks.js";

// The bundle as deployed (TRY_SIGN_ENABLED on since 4 November).
const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
const get = (path: string, p: Pages = pages) => pageResponse(new Request(`https://kit11.example${path}`), p);
/** A viewer key's shape (32 hex); not a real one. */
const KEY = "ab".repeat(16);
const RUNNER = "A".repeat(91);

/** Runs Home's forward with a stand-in location, storage and history; returns where it sent the browser, if anywhere. */
function forward(pathname: string, hash: string, kept: string | null | "blocked"): string[] {
  const loc = { pathname, search: "", hash, replace: vi.fn() };
  const storage = { getItem: (k: string) => { if (kept === "blocked") throw new Error("storage blocked"); return k === "kit11.view" ? kept : null; } };
  // The key leaves Home's own address before the browser moves on (the address the dashboard is handed keeps it).
  const history = { replaceState: vi.fn((_s: unknown, _t: string, url: string) => { expect(loc.replace).not.toHaveBeenCalled(); loc.hash = ""; expect(url).toBe(pathname); }) };
  new Function("location", "localStorage", "history", CFO_FORWARD_JS)(loc, storage, history);
  if (loc.replace.mock.calls.length) expect(history.replaceState).toHaveBeenCalledTimes(hash ? 1 : 0);
  else expect(history.replaceState).not.toHaveBeenCalled();
  return loc.replace.mock.calls.map((c) => String(c[0]));
}

describe("/ for a guest", () => {
  it("says the film's line as its heading (Max, 5 Nov): \"AI agents spend. You sign off.\", the three sentences under it (jury review, 6 Nov)", () => {
    expect(HERO).toBe("AI agents spend. You sign off.");
    expect(readFileSync(new URL("../docs/media/social-preview.html", import.meta.url), "utf8")).toContain("<h1>AI agents spend.<br><em>You sign off.</em></h1>");
    // Section D (6 Nov): what Purser is, the three sentences, Try it in 30 seconds (in a minute since 7 Nov), then the badges and the Kit 11 line.
    // Max, 7 Nov: the heading, what Purser is, then the way through in three steps and one button (the three sentences
    // stay in the README, the form and the deck).
    // Max, 7 Nov (second round): the one button right under the heading, with only that sentence between; since the
    // jury review of 7 Nov (#2) the three sentences under it too, then the button.
    // Competitive review, 10 Nov: the one button, to /try/sign, right under what Purser is; the three sentences stay in the
    // README, the form and the deck.
    // Home as one story (12 Nov): the heading's two sentences on two lines, what Purser is, then the one button.
    expect(homeHeadingHtml()).toBe('<h1 class="h-hero"><span>AI agents spend.</span> <span>You sign off.</span></h1>');
    expect(textOutsideTags(homeHeadingHtml()).replace(/\s+/g, " ").trim()).toBe(HERO);
    // The enterprise pass (owner, 12 Nov): the heading, Home's one sentence, then the two buttons, the first to the hands-on
    // demo (again since the product tour went, 13 Nov, evening), the second the proof.
    expect(pages.home).toContain(`${homeHeadingHtml()}\n    <p class="what">${esc(HOME_SUB)}</p>\n    <div class="ctas"><a class="btn primary big start" href="/try">`);
    expect(WHAT_IT_IS.length).toBeGreaterThan(0);
    expect(DIFFERENTIATORS.length).toBe(3);
    // The core sentence stays the page's description.
    expect(pages.home).toContain(`<meta name="description" content="${HERO} ${CORE_SENTENCE}">`);
  });
  it("is Home itself (no query), under Home's own CSP: no redirect, nothing of the CFO dashboard in the HTML", async () => {
    for (const path of ["/", "/?"]) {
      const r = get(path)!;
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toBe(pages.csp.home);
      const html = await r.text();
      expect(html).toBe(pages.home);
      expect(html).toContain(homeHeadingHtml());
      expect(html).toContain('href="/try"');
      expect(html).not.toMatch(/The runner is offline|How the CFO signs in|recorded-data/);
    }
  });

  it("stays the CFO dashboard's page with any query: the replays (README, deck), the sign-in note, the CFO's ?dashboard", async () => {
    for (const path of ["/?recorded", "/?autonomy", "/?recorded&agents", "/?autonomy&disputes", "/?signin", "/?dashboard", "/?present"]) {
      const r = get(path)!;
      expect({ path, csp: r.headers.get("content-security-policy") }).toEqual({ path, csp: pages.csp.dashboard });
      expect(await r.text()).toBe(pages.dashboard);
    }
    // A bundle built before Home serves the dashboard at "/", as before.
    const older: Pages = { ...pages };
    delete older.home;
    expect(await get("/", older)!.text()).toBe(pages.dashboard);
  });

  it("sends the CFO's viewer link on to the dashboard, \"#\" and all; a device that merely kept a key stays on Home (owner, 12 Nov)", () => {
    expect(forward("/", `#view=${KEY}`, null)).toEqual([`./?dashboard#view=${KEY}`]);
    expect(forward("/", `#view=${KEY}&runner=${RUNNER}`, null)).toEqual([`./?dashboard#view=${KEY}&runner=${RUNNER}`]);
    expect(forward("/", `#runner=${RUNNER}`, null)).toEqual([`./?dashboard#runner=${RUNNER}`]);
    expect(forward("/", "", KEY)).toEqual([]);
  });

  it("leaves a guest on Home, and Home's own tab (/home) alone even for the CFO", () => {
    expect(forward("/", "", null)).toEqual([]);
    expect(forward("/", "#top", null)).toEqual([]);
    expect(forward("/", "#view=not-a-key", null)).toEqual([]);
    expect(forward("/", `#view=${KEY}x`, null)).toEqual([]);
    expect(forward("/", "", "blocked")).toEqual([]);
    expect(forward("/home", `#view=${KEY}`, KEY)).toEqual([]);
  });

  it("runs under Home's CSP, and reads the key as the dashboard stores and reads it", () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(pages.home!)![1]!;
    expect(script).toContain(CFO_FORWARD_JS);
    expect(pages.csp.home).toContain(`'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`);
    expect(pages.dashboard).toContain('localStorage.setItem("kit11.view", viewKey)');
    expect(pages.dashboard).toContain("/(?:^#|&)view=([0-9a-f]{32})(?:&|$)/");
    expect(pages.dashboard).toContain("/(?:^#|&)runner=([A-Za-z0-9_-]{80,200})(?:&|$)/");
    // The dashboard's own guard stays: a guest on its address (?dashboard, any other query) goes to Home.
    expect(pages.dashboard).toContain('location.replace("home");');
    expect(pages.dashboard).toContain('tabs([["Dashboard", "?dashboard"');
  });
});

describe("the honest core sentence", () => {
  it("is the CFO dashboard's Overview line, word for word", () => {
    // 14 Nov: the first mention on the page reads "Alta (formerly Metal)" (src/ui/formerly.ts).
    expect(pages.dashboard.replace("Alta (formerly Metal)", "Alta")).toContain(`<h1>Overview</h1><div class="sub">${CORE_SENTENCE}</div>`);
    expect(pages.dashboard).not.toContain("__CORE_SENTENCE__");
  });

  it("leaves no \"every limit\" and no \"can't break\" on any page of the bundle as deployed, /try/sign included", () => {
    expect(pages.trySign).toBeTruthy();
    const all = Object.entries(pages as unknown as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !["font"].includes(e[0]));
    for (const [name, text] of all) expect({ name, found: /every limit|can['’]t break|can\\u2019t break/i.exec(text)?.[0] ?? null }).toEqual({ name, found: null });
  });
});

describe("npm run judge answers / as the relay does", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => { ({ server, url: base } = await startJudge(0)); });
  afterAll(() => server?.close());

  it("Home at /, the dashboard's page with a query", async () => {
    const home = await (await fetch(`${base}/`)).text();
    expect(home).toContain(homeHeadingHtml());
    for (const q of ["?recorded", "?autonomy", "?signin"]) expect(await (await fetch(`${base}/${q}`)).text()).toContain('id="recorded-data"');
  });
});
