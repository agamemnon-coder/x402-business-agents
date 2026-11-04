// The judge tour has no dead links: `npm run judge` serves every page a juror can reach offline, and every link those
// pages carry (in their HTML, or as a path their script builds) must answer, not end on the 404 page. The emergency
// stop on the recorded dashboard links to /policy?freeze=on, which was a 404 offline (Max, 3 November).
// Local only: the judge server on a free port; links to other sites are not fetched.
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJudge } from "../src/cli/judge.js";
import { REDIRECTS } from "../src/servers/dashboard.js";

/** The tour: the pages `npm run judge -- --check` serves, and every redirect. */
export const TOUR = ["/", "/home", "/watch", "/proof", "/metal", "/metal/report", "/visa", "/airwallex", "/claude", "/?recorded", "/demo", "/live", "/film", "/try", "/month", "/lab", ...Object.keys(REDIRECTS)];

let server: Server;
let base: string;
beforeAll(async () => {
  ({ server, url: base } = await startJudge(0));
});
afterAll(() => {
  server.close();
});

/** Same-origin hrefs and srcs in the HTML, and relative page paths a script builds as a string ("policy?agent=" …). */
function linksIn(html: string, page: URL): URL[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) found.add(m[1]!);
  for (const m of html.matchAll(/["'](policy\?[a-z]+=[^"']*|approve\/|enrol)["']/g)) found.add(m[1]!);
  const out: URL[] = [];
  for (const raw of found) {
    if (raw.startsWith("#") || /^(mailto|tel|data|javascript):/.test(raw) || raw.includes("__")) continue;
    const u = new URL(raw.replace(/&amp;/g, "&"), page);
    if (u.origin === page.origin) out.push(u);
  }
  return out;
}

describe("the judge tour", () => {
  it("serves every page, and every link on it answers (no 404)", async () => {
    const dead: string[] = [];
    let checked = 0;
    const seen = new Set<string>();
    for (const path of TOUR) {
      const page = new URL(path, base);
      const res = await fetch(page);
      if (res.status !== 200) {
        dead.push(`${path} → ${res.status}`);
        continue;
      }
      for (const link of linksIn(await res.text(), new URL(res.url))) {
        const key = link.pathname + link.search;
        if (seen.has(key)) continue;
        seen.add(key);
        // A script-built path ending in "=" or "/" is completed at run time with an id; its page must exist.
        const r = await fetch(link, { redirect: "follow" });
        checked++;
        if (r.status === 404) dead.push(`${path}: ${key} → 404`);
      }
    }
    expect(dead).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });

  it("serves the policy page the emergency stop opens, offline, with its script and stylesheet", async () => {
    const res = await fetch(new URL("/policy?freeze=on", base));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('data-page="policy"');
    for (const asset of ["/assets/approve.js", "/assets/approve.css"]) expect((await fetch(new URL(asset, base))).status).toBe(200);
    // Offline there is no runner: the page's question for the approvals is answered as such, never as data.
    const api = await fetch(new URL("/api/approvals", base));
    expect(api.status).toBe(200);
    expect(await api.json()).toMatchObject({ offline: true });
  });
});
