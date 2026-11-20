// The film's capture (src/film/capture.ts) driven by a stand-in for Playwright's browser, with the real ffmpeg (the
// test is skipped without it): no Chromium is needed. The stand-in answers each page call the way a page would (its
// text, its scroll position, a JPEG per screenshot) and records what was done to it. Breaks if a shot is filmed from a
// page that fails its checks, if the next address is not tried, if a hold costs more than one screenshot, if an
// action is skipped, or if a shot that fails half-way leaves a partial clip behind.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { FPS, captureShot, pageChecks } from "../src/film/capture.js";
import type { Shot } from "../src/film/shots.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

interface PageText { body: string; menu: string; shown?: string }

/** A page that answers like a real one, from its text; `fail` makes navigation throw. */
function fakeBrowser(pages: Record<string, PageText | { fail: string }>, jpeg: Buffer) {
  const log: string[] = [];
  let contexts = 0, closed = 0;
  const browser = {
    newContext: async (opts: Record<string, unknown>) => {
      contexts++;
      log.push(`context ${JSON.stringify((opts as { viewport: unknown }).viewport)} mobile=${String(opts.isMobile)}`);
      let current: PageText | null = null;
      let scroll = 0;
      let hash = "";
      const page = {
        goto: async (url: string) => {
          const p = pages[url];
          if (!p) throw new Error(`net::ERR_CONNECTION_REFUSED at ${url}\n  call log`);
          if ("fail" in p) throw new Error(p.fail);
          current = p;
          log.push(`goto ${url}`);
        },
        addStyleTag: async () => undefined,
        waitForTimeout: async () => undefined,
        waitForLoadState: async () => { throw new Error("no idle"); },
        waitForFunction: async () => { throw new Error("timeout"); },
        evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
          const src = fn.toString();
          if (src.includes("menu:")) return { body: current!.body, menu: current!.menu };
          if (src.includes("createTreeWalker")) { log.push(`aim ${JSON.stringify(arg)}`); return 600; }
          if (src.includes("outlineOffset")) { log.push(`highlight ${JSON.stringify(arg)}`); return undefined; }
          if (src.includes("location.hash ===")) return hash === arg;
          if (src.includes("location.hash =")) { hash = String(arg); log.push(`hash ${hash}`); return undefined; }
          if (src.includes("scrollTo(0, 0)")) { scroll = 0; return undefined; }
          if (src.includes("scrollTo(0, y)")) { scroll = Number(arg); return undefined; }
          if (/=>\s*scrollY\s*$/.test(src.trim())) return scroll;
          if (src.includes("document.body.innerText")) return current!.shown ?? current!.body;
          return undefined; // fonts, folds, animation frames, open menus
        },
        getByRole: (role: string, o: { name: string }) => ({ or: () => ({ first: () => ({ click: async () => { log.push(`click ${role} ${o.name}`); } }) }) }),
        mouse: { move: async () => undefined },
        locator: () => ({ first: () => ({ setInputFiles: async (f: string) => { log.push(`pick ${f}`); } }) }),
        context: () => ({ newCDPSession: async () => ({ send: async () => ({ data: jpeg.toString("base64") }) }) }),
      };
      return { newPage: async () => page, close: async () => { closed++; } };
    },
  };
  return { browser: browser as unknown as Browser, log, counts: () => ({ contexts, closed }) };
}

const shot = (o: Partial<Shot>): Shot => ({ id: "X1", what: "a fixture", viewport: "desktop", actions: [{ hold: 0.1 }], must: ["A fixture page"], ...o });

describe.skipIf(!hasFfmpeg)("the capture, with a stand-in browser", () => {
  let dir = "";
  let jpeg = Buffer.alloc(0);
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "capture-fake-"));
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=64x36", "-frames:v", "1", join(dir, "f.jpg")]);
    jpeg = readFileSync(join(dir, "f.jpg"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses a shot with no address yet, and a page that fails its checks, trying the next address first", async () => {
    const { browser } = fakeBrowser({}, jpeg);
    expect(await captureShot(browser, shot({ urls: [], gate: { stream: "home-story" } }), join(dir, "a.mp4"), { root: dir }))
      .toEqual({ id: "X1", refused: ["no address yet (home-story): a fixture"] });
    // A local address with no local server is no address either.
    expect(await captureShot(browser, shot({ urls: ["local:/x"] }), join(dir, "a.mp4"), { root: dir }))
      .toEqual({ id: "X1", refused: ["no address yet (no stream): a fixture"] });

    const pages = {
      "http://a/": { body: "Something else", menu: "Home Watch" },
      "http://b/": { fail: "Timeout 60000ms exceeded.\nmore" },
      "http://c/": { body: "A fixture page   with Proof", menu: "Home Watch Try" },
    };
    const fb = fakeBrowser(pages, jpeg);
    const gated = shot({ urls: ["http://a/", "http://b/", "http://c/", "http://d/"], gate: { stream: "home-story", menuWithout: "Watch", pageWith: "The new home" } });
    const r = await captureShot(fb.browser, gated, join(dir, "b.mp4"), { root: dir });
    expect(r).toEqual({ id: "X1", refused: [
      `http://a/: missing "A fixture page"; gate home-story: the menu still has "Watch"; gate home-story: no "The new home" on the page`,
      "http://b/: Timeout 60000ms exceeded.",
      `http://c/: gate home-story: the menu still has "Watch"; gate home-story: no "The new home" on the page`,
      "http://d/: net::ERR_CONNECTION_REFUSED at http://d/",
    ] });
    // Every page it opened was closed again, and nothing was written.
    expect(fb.counts()).toEqual({ contexts: 4, closed: 4 });
    expect(existsSync(join(dir, "b.mp4"))).toBe(false);
  });

  it("films each action: a hold repeats one screenshot, a scroll takes one per frame, a click, a pick, a highlight and a tab", async () => {
    const fb = fakeBrowser({ "http://local:9/page": { body: "A fixture page", menu: "Home Try" } }, jpeg);
    const s = shot({
      viewport: "phone",
      urls: ["local:/page"],
      actions: [{ hold: 0.5 }, { scroll: "Scroll here", s: 0.25 }, { click: "Open" }, { pick: "docs/x.pdf" }, { highlight: ["Paid"] }, { hash: "#/agents" }, { hold: 0.25 }],
      gate: { stream: "s", menuWithout: "Watch", pageWith: "fixture" },
    });
    const logs: string[] = [];
    const out = join(dir, "c.mp4");
    const r = await captureShot(fb.browser, s, out, { root: "/repo", local: "http://local:9", draft: true, log: (l) => logs.push(l) });
    const holdFrames = Math.round(0.5 * FPS) + Math.round(0.25 * FPS);
    const scrollFrames = Math.round(0.25 * FPS);
    // One screenshot to start, one per scroll frame, one after each of the click, pick, highlight and tab.
    expect(r).toEqual({ id: "X1", url: "http://local:9/page", seconds: 1, frames: holdFrames + scrollFrames, screenshots: 1 + scrollFrames + 4 });
    expect(statSync(out).size).toBeGreaterThan(0);
    expect(fb.log).toEqual([
      'context {"width":390,"height":844} mobile=true',
      "goto http://local:9/page",
      'aim {"text":"Scroll here","at":0.3}',
      "click button Open",
      "pick /repo/docs/x.pdf",
      'highlight ["Paid"]',
      "hash #/agents",
    ]);
    expect(logs).toEqual([`X1: ${holdFrames + scrollFrames} frames from ${1 + scrollFrames + 4} screenshots, http://local:9/page`]);
  });

  it("refuses a shot whose page shows a defect after its actions, and leaves no partial clip", async () => {
    const fb = fakeBrowser({ "http://e/": { body: "A fixture page", menu: "", shown: "A fixture page NaN undefined" } }, jpeg);
    const out = join(dir, "d.mp4");
    const r = await captureShot(fb.browser, shot({ urls: ["http://e/"], mustNot: ["NaN", "undefined", "Error"] }), out, { root: dir, draft: true });
    expect(r).toEqual({ id: "X1", refused: [`http://e/: the page shows "NaN", "undefined" after its actions`] });
    expect(existsSync(out)).toBe(false);
  });
});

describe("a page's checks before the first frame", () => {
  it("lists the missing lines (whitespace folded) and each gate that fails", async () => {
    const page = { evaluate: async () => ({ body: "Tamper\n refused  here", menu: "Home  Proof" }) };
    const s = shot({ must: ["Tamper refused", "Gone"], gate: { stream: "g", menuWithout: "Proof", pageWith: "refused here" } });
    expect(await pageChecks(page as never, s)).toEqual(['missing "Gone"', 'gate g: the menu still has "Proof"']);
    expect(await pageChecks(page as never, shot({ must: [] }))).toEqual([]);
  });
});
