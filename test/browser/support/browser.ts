// Which browser a check runs in: BROWSER=chromium (the default), firefox or webkit. CI runs the guest pages and
// /try/sign in Chromium (job judge), in WebKit (job webkit) and in Firefox (job firefox, .github/workflows/ci.yml).
// Playwright is not a dependency of this repo's runtime; it comes with the environment (Chromium pre-installed here;
// CI installs Firefox for its own job with `npx playwright install --with-deps firefox`).
import { createRequire } from "node:module";
import type { Browser, BrowserContextOptions, Page } from "playwright";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type BrowserName = (typeof BROWSERS)[number];

/** The browser named by BROWSER, or Chromium; anything else is refused, never silently replaced. */
export function browserName(env: Record<string, string | undefined> = process.env): BrowserName {
  const b = (env.BROWSER ?? "chromium").trim().toLowerCase() || "chromium";
  if (!(BROWSERS as readonly string[]).includes(b)) throw new Error(`BROWSER must be one of ${BROWSERS.join(", ")}, not "${b}"`);
  return b as BrowserName;
}

/** A context's options as this browser takes them: Firefox has no `isMobile` (Playwright refuses it), so it is dropped there. */
export function contextOptions(name: BrowserName, o: BrowserContextOptions = {}): BrowserContextOptions {
  if (name !== "firefox" || !("isMobile" in o)) return o;
  const rest = { ...o };
  delete rest.isMobile;
  return rest;
}

/** Whether the check can drive WebAuthn with Chromium's virtual authenticator (CDP). Elsewhere it uses the software passkey. */
export const hasVirtualAuthenticator = (name: BrowserName): boolean => name === "chromium";

/**
 * Launches the browser BROWSER names. Every context it makes takes its options through contextOptions, so a check written
 * for Chromium (with isMobile) runs in Firefox unchanged.
 */
export async function launchBrowser(name: BrowserName = browserName()): Promise<Browser> {
  const require = createRequire(import.meta.url);
  const pw = require("playwright") as Record<BrowserName, { launch(o?: { executablePath?: string }): Promise<Browser> }>;
  const browser = await pw[name].launch(name === "chromium" && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (o?: BrowserContextOptions) => {
    const context = await newContext(contextOptions(name, o));
    if (name === "firefox") {
      context.on("page", retryStalledGoto);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => retryStalledGoto(await newPage());
    }
    return context;
  };
  if (name === "firefox") {
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (o?: BrowserContextOptions) => retryStalledGoto(await newPage(contextOptions(name, o)));
  }
  return browser;
}

const RETRIED = Symbol("retried");
/**
 * Firefox only (13 Nov): now and then a navigation to the local server, typically a new context's first, never finishes
 * (seen in CI and here, late in a run, in pages.check.ts and trysign.check.ts: once with no request issued at all, once
 * with its request answered but no load event), while the server answers a fetch in 2 ms and a second goto loads at
 * once. Every goto of a Firefox page gets 15 s, then one more try with its own timeout, said in the log. A page that
 * fails twice still fails the check; other errors are not retried.
 */
function retryStalledGoto(page: Page): Page {
  const p = page as Page & { [RETRIED]?: true };
  if (p[RETRIED]) return page;
  p[RETRIED] = true;
  const goto = page.goto.bind(page);
  page.goto = async (url, o = {}) => {
    try {
      return await goto(url, { ...o, timeout: Math.min(o.timeout ?? 30_000, 15_000) });
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "TimeoutError") throw e;
      console.log(`info  ${url}: Firefox did not finish loading it within 15 s; tried again`);
      return await goto(url, o);
    }
  };
  return page;
}

/**
 * A navigation to the local server that Firefox now and then does not finish (13 Nov, in CI and here, late in a run): a
 * new context's goto timed out, once with no request issued at all and once with its request answered but no load,
 * while the server answered a fetch in 2 ms, a fresh browser loaded the page at once, and a second goto did too. Tried
 * again once, said in the log; a page that fails twice still fails the check. Used by pages.check.ts and trysign.check.ts.
 */
export async function gotoLoaded(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "load", timeout: 15_000 });
  } catch {
    console.log(`info  ${url}: the browser did not finish loading it within 15 s; tried again`);
    await page.goto(url, { waitUntil: "load" });
  }
}
