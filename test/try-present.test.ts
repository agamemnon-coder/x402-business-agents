// Recording mode (/try?present=1, cloud/src/try/presentMode.ts): a flag only. Without it /try is byte for byte the
// page it was; with it, one more style block and one more script under the same nonce, which reads the page's own API
// answers and calls nothing. The browser run is test/browser/present.check.ts.
import { describe, expect, it } from "vitest";
import { tryPage } from "../cloud/src/tryPage.js";
import { presentExtra, PRESENT_AFTER, PRESENT_BEFORE, PRESENT_MONEY, PRESENT_TRY } from "../cloud/src/try/presentMode.js";
import { ADMIN_TOKEN, ORIGIN, testCloud } from "./support/cloud.js";

const cfg = { origin: "https://x.test", rpId: "x.test" };

describe("recording mode", () => {
  it("adds nothing to /try without the flag", () => {
    const html = tryPage("n0nce", cfg);
    expect(html).not.toContain("pv-card");
    expect(html.match(/<script /g)).toHaveLength(1);
  });

  it("with the flag: one more style and one script, under the page's nonce, before the page's own script", () => {
    const html = tryPage("n0nce", cfg, presentExtra());
    const scripts = [...html.matchAll(/<script type="module" nonce="n0nce">/g)];
    expect(scripts).toHaveLength(2);
    expect(html.indexOf("purser.present")).toBeLessThan(html.indexOf("const KEY='purser.try'"));
    expect(presentExtra().css).not.toContain("<");
  });

  it("its script parses, and reads answers without calling the API itself", () => {
    const { script } = presentExtra();
    expect(() => new Function(script)).not.toThrow();
    // The only fetch is the page's own, passed on: no URL of its own, no method of its own.
    expect(script.match(/real\(/g)).toHaveLength(1);
    expect(script).not.toMatch(/method:\s*'(POST|PUT|DELETE)'/);
    expect(script).not.toContain("innerHTML");
    expect(script).not.toMatch(/\son[a-z]+=/i);
  });

  it("says Before, After, test money and where to try, in plain words", () => {
    const { script } = presentExtra();
    for (const w of [PRESENT_BEFORE, PRESENT_AFTER, PRESENT_MONEY, PRESENT_TRY]) expect(script).toContain(JSON.stringify(w).slice(1, -1));
  });

  it("is served by /try?present=1 and only then", async () => {
    const c = testCloud({ engine: true, tryIt: {} });
    try {
      expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
      const on = await (await c.fetch(`${ORIGIN}/try?present=1`)).text();
      const off = await (await c.fetch(`${ORIGIN}/try?present=0`)).text();
      expect(on).toContain("pv-lane");
      expect(off).not.toContain("pv-lane");
    } finally { c.close(); }
  });
});
