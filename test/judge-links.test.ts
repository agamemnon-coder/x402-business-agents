// A juror's offline copy (`npm run judge`) has no dead links: every page it serves is fetched, and every same-site
// link and asset in its HTML must answer 200. The CFO's own pages (the policy page and the approval page) need the
// runner and a passkey; offline they answer with a page that says so, never a bare 404.
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startJudge } from "../src/cli/judge.js";

const PAGES = ["/", "/metal", "/metal/report", "/visa", "/pricing", "/security", "/docs", "/status", "/?recorded", "/demo", "/live", "/film", "/try", "/month", "/lab"];
let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, url: base } = await startJudge(0));
});
afterAll(() => server?.close());

/** The same-site hrefs and srcs written into a page's HTML (not the ones its script builds later). */
function links(html: string, page: URL): URL[] {
  const out: URL[] = [];
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = m[1]!;
    if (/^(#|mailto:|tel:|data:|javascript:)/i.test(raw) || raw.includes("__")) continue;
    const u = new URL(raw, page);
    if (u.origin === page.origin) out.push(u);
  }
  return out;
}

describe("npm run judge: no dead links", () => {
  it("serves every page, and every same-site link and asset on them answers 200", async () => {
    const dead: string[] = [];
    const seen = new Set<string>();
    for (const p of PAGES) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      for (const u of links(await res.text(), new URL(`${base}${p}`))) {
        const key = u.pathname + u.search;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = await fetch(u);
        if (r.status !== 200) dead.push(`${p} → ${key} (${r.status})`);
      }
    }
    expect(dead).toEqual([]);
    expect(seen.size).toBeGreaterThan(10);
  });

  it("answers the CFO's live-only pages with a page that says so, and the emergency stop's link too", async () => {
    for (const p of ["/policy", "/policy?freeze=on", "/approve"]) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      const body = await res.text();
      expect(body, p).toContain("Live only");
      expect(body, p).toContain('href="/?recorded"');
    }
  });
});
