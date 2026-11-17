// The judge job's /try load timed out twice in a week (17 Nov): the page's "Built on Airwallex" badge loaded its logo
// from the live site (kit11.max-31b.workers.dev), so the page's load waited on another host. /try now loads every image,
// font and script from its own origin, and that origin serves the logo, byte for byte the official file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
afterEach(() => c.close());

describe("/try loads nothing from another host", () => {
  it("has no image, script, stylesheet or font with an absolute address", async () => {
    c = testCloud({ engine: true, tryIt: {} });
    for (const path of ["/try", "/try?present=1&phone=0"]) {
      const html = await (await c.req("GET", path)).res.text();
      const external = [...html.matchAll(/<(img|script|link)\b[^>]*\b(src|href)="(https?:)?\/\/[^"]+"[^>]*>/g)]
        .map((m) => m[0]).filter((t) => !/<link\b[^>]*\brel="(canonical|alternate)"/.test(t) && !/^<a\b/.test(t));
      expect(external, path).toEqual([]);
    }
  });

  it("serves the Airwallex logo itself, the official file unaltered", async () => {
    c = testCloud({ engine: true, tryIt: {} });
    const r = await c.req("GET", "/assets/logo-airwallex.png");
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toBe("image/png");
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
    expect(sha(new Uint8Array(await r.res.arrayBuffer()))).toBe(sha(readFileSync("src/ui/logos/airwallex.png")));
  });
});
