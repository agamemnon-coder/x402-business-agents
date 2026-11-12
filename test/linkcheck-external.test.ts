// The external link check's own logic (scripts/linkcheck-external.ts), with a fake fetch: it finds the URLs, skips local
// and placeholder hosts, asks the public surfaces first, never sends more requests than its budget (400 at most), falls
// back to GET where HEAD is refused, and reports a 429 as rate-limited. The real run is `npm run links:external`, once,
// in Phase B; this test never uses the network.
import { describe, expect, it } from "vitest";
import { check, collect, MAX_REQUESTS, plan, priority, report, urlsIn } from "../scripts/linkcheck-external.js";

describe("the external link check", () => {
  it("finds external URLs in Markdown and HTML, cleaned, without local, example or template hosts, and without fragments", () => {
    expect(urlsIn('See [the tx](https://testnet.metalntwx.com/tx/0xabc). And <a href="https://github.com/a/b#readme">x</a>, http://localhost:4311/, https://kit11.example.workers.dev/x, https://x.invalid/, `https://${host}/y`.'))
      .toEqual(["https://testnet.metalntwx.com/tx/0xabc", "https://github.com/a/b"]);
  });

  it("deduplicates across sources and asks the README, llms.txt and the pages first", () => {
    const found = plan(collect([["docs/other.md", "https://b.example.org/ https://z.dev/1"], ["README.md", "https://z.dev/1 https://a.dev/2"], ["docs/submission/qa.md", "https://m.dev/3"]]));
    expect(found.map((f) => [f.url, priority(f)])).toEqual([["https://a.dev/2", 0], ["https://z.dev/1", 0], ["https://m.dev/3", 1]]);
    expect(found.find((f) => f.url === "https://z.dev/1")!.where).toEqual(["README.md", "docs/other.md"]);
  });

  it("never sends more requests than the budget, and never more than 400; the rest is reported as not asked", async () => {
    let n = 0;
    const f = (async () => { n++; return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    const many = Array.from({ length: 450 }, (_, i) => ({ url: `https://h${i}.dev/`, where: ["README.md"] }));
    const r = await check(many, { fetch: f, budget: 10_000 });
    expect(MAX_REQUESTS).toBe(400);
    expect(n).toBe(400);
    expect(r.requests).toBe(400);
    expect(r.results.filter((x) => x.note === "not asked: budget spent")).toHaveLength(50);
    const md = report({ ...r, at: "2026-11-14T09:00:00Z", budget: 400 });
    expect(md).toContain("**Requests:** 400 of a budget of 400");
    expect(md).toContain("**left out by the budget:** 50");
    expect(md).toContain("**Failed:** 0");
  });

  it("falls back to GET where HEAD is refused, counts both, and reports 404 as failed and 429 as rate-limited", async () => {
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url}`);
      const s = url.endsWith("/head-refused") ? (init.method === "HEAD" ? 405 : 200) : url.endsWith("/gone") ? 404 : url.endsWith("/busy") ? 429 : 200;
      return new Response(null, { status: s });
    }) as unknown as typeof fetch;
    const r = await check(["head-refused", "gone", "busy"].map((p) => ({ url: `https://x.dev/${p}`, where: ["README.md"] })), { fetch: f, concurrency: 1 });
    expect(seen).toEqual(["HEAD https://x.dev/head-refused", "GET https://x.dev/head-refused", "HEAD https://x.dev/gone", "HEAD https://x.dev/busy"]);
    expect(r.results.map((x) => [x.status, x.method, x.ok, x.note])).toEqual([[200, "GET", true, ""], [404, "HEAD", false, ""], [429, "HEAD", false, "rate-limited (not a dead link)"]]);
    expect(r.requests).toBe(4);
  });
});
