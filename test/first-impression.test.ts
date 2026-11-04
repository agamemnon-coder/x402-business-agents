// The first impression (4 Nov): "/" is Home itself for a guest, so a reader without script (a link preview, a fetch)
// sees Home and not the CFO dashboard's hidden blocks; with a query it stays the CFO dashboard's page (/?recorded and
// /?autonomy, as the README and the deck link them); the CFO's viewer link (#view=…, never sent to a server) goes on
// from Home to the dashboard. The browser side of the same: test/browser/root.check.ts.
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startJudge } from "../src/cli/judge.js";
import { CORE_SENTENCE, HERO } from "../src/config/brand.js";
import { CFO_FORWARD_JS } from "../src/redesign/home.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";

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
  it("is Home itself (no query), under Home's own CSP: no redirect, nothing of the CFO dashboard in the HTML", async () => {
    for (const path of ["/", "/?"]) {
      const r = get(path)!;
      expect(r.status).toBe(200);
      expect(r.headers.get("content-security-policy")).toBe(pages.csp.home);
      const html = await r.text();
      expect(html).toBe(pages.home);
      expect(html).toContain(`<h1 class="h-hero">${HERO}</h1>`);
      expect(html).toContain('href="try/sign"');
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

  it("sends the CFO's viewer link on to the dashboard, \"#\" and all, and a device that keeps a key", () => {
    expect(forward("/", `#view=${KEY}`, null)).toEqual([`./?dashboard#view=${KEY}`]);
    expect(forward("/", `#view=${KEY}&runner=${RUNNER}`, null)).toEqual([`./?dashboard#view=${KEY}&runner=${RUNNER}`]);
    expect(forward("/", `#runner=${RUNNER}`, null)).toEqual([`./?dashboard#runner=${RUNNER}`]);
    expect(forward("/", "", KEY)).toEqual(["./?dashboard"]);
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
    expect(pages.dashboard).toContain(`<h1>Overview</h1><div class="sub">${CORE_SENTENCE}</div>`);
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
    expect(home).toContain(`<h1 class="h-hero">${HERO}</h1>`);
    for (const q of ["?recorded", "?autonomy", "?signin"]) expect(await (await fetch(`${base}/${q}`)).text()).toContain('id="recorded-data"');
  });
});
