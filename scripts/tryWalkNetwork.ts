// The phone and the slow network a recorded /try walk can take (20 Nov, before judging; scripts/try-live-record.ts and
// scripts/smoke-judge.ts): an iPhone's screen and user agent, and DevTools' "Slow 4G" through the DevTools Protocol.
// Pure, apart from throttle(), which only sends one DevTools command to a page it is given.
import type { BrowserContext, Page } from "playwright";
import type { BrowserName } from "../test/browser/support/browser.js";

/**
 * Playwright 1.63's "iPhone 15" device (its devices table, copied so the record says what was used without loading
 * Playwright here): the screen, the Safari user agent, touch, 3x. In WebKit this is the engine of Safari on that phone;
 * in Chromium it is Chromium at that size with that user agent (so the page names Face ID), not Safari.
 */
export const IPHONE = {
  viewport: { width: 393, height: 659 },
  screen: { width: 393, height: 852 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;

/** One network profile, as DevTools' Network.emulateNetworkConditions takes it (bytes a second; ms of added round trip). */
export interface NetworkProfile { name: string; latency_ms: number; download_bytes_s: number; upload_bytes_s: number }

/**
 * The profiles a walk can be throttled to: DevTools' own presets (Chrome 120 and later), with their throughput as
 * DevTools sets it (bits a second / 8 * 0.9): slow-4g, 562.5 ms added round trip, 1.6 Mbit/s down, 750 kbit/s up;
 * fast-4g, 165 ms, 9 Mbit/s down, 1.5 Mbit/s up.
 */
export const NETWORKS: Record<string, NetworkProfile> = {
  "slow-4g": { name: "slow-4g", latency_ms: 562.5, download_bytes_s: Math.round((1.6 * 1_000_000) / 8 * 0.9), upload_bytes_s: Math.round((750 * 1000) / 8 * 0.9) },
  "fast-4g": { name: "fast-4g", latency_ms: 165, download_bytes_s: Math.round((9 * 1_000_000) / 8 * 0.9), upload_bytes_s: Math.round((1.5 * 1_000_000) / 8 * 0.9) },
};

/**
 * The profile NETWORK names, or null when it names none. A name that is not a profile, or any profile in a browser
 * Playwright cannot throttle (WebKit, Firefox: no DevTools Protocol there), throws: a walk is never recorded as
 * throttled when it was not.
 */
export function networkProfile(name: string | undefined, browser: BrowserName): NetworkProfile | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!n || n === "none") return null;
  const p = NETWORKS[n];
  if (!p) throw new Error(`NETWORK must be one of ${Object.keys(NETWORKS).join(", ")} (or none), not "${name}"`);
  if (browser !== "chromium") throw new Error(`NETWORK=${n} needs Chromium (the DevTools Protocol); ${browser} cannot be throttled by Playwright`);
  return p;
}

/** Puts a page on the profile (Chromium's DevTools Protocol), before it loads anything; nothing when there is none. */
export async function throttle(ctx: BrowserContext, page: Page, p: NetworkProfile | null): Promise<void> {
  if (!p) return;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: p.latency_ms, downloadThroughput: p.download_bytes_s, uploadThroughput: p.upload_bytes_s });
}

/** scripts/try-live-series.ts PLAN=phones: walk n as WebKit, Chromium, then Chromium on Slow 4G, each as an iPhone 15, in turn. */
export function phonePlan(n: number): { profile: string; browser: string; network?: string } {
  const k = (n - 1) % 3;
  return k === 0 ? { profile: "phone-iphone", browser: "webkit" } : k === 1 ? { profile: "phone-iphone", browser: "chromium" } : { profile: "phone-iphone", browser: "chromium", network: "slow-4g" };
}
