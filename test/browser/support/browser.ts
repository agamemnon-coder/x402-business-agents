// Which browser a check runs in: BROWSER=chromium (the default), firefox or webkit. CI runs the guest pages and
// /try/sign in Chromium (job judge), in WebKit (job webkit) and in Firefox (job firefox, .github/workflows/ci.yml).
// Playwright is not a dependency of this repo's runtime; it comes with the environment (Chromium pre-installed here;
// CI installs Firefox for its own job with `npx playwright install --with-deps firefox`).
import { createRequire } from "node:module";
import type { Browser, BrowserContextOptions } from "playwright";

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
  browser.newContext = (o?: BrowserContextOptions) => newContext(contextOptions(name, o));
  return browser;
}
