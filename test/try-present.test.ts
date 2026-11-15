// Recording mode (/try?present=1, cloud/src/try/presentMode.ts): a flag. Every /try has the app shell and "How Purser
// works" (one more style block and one more script under the same nonce, which read the page's own API answers and call
// nothing); ?present=1 adds the recording mode's cards, keys and zoom. The browser run is test/browser/present.check.ts.
import { readFileSync } from "node:fs";
import { SYSTEM_MAP_DATA_URL } from "../cloud/src/try/systemMap.gen.js";
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

  it("leaves the phone lane out with ?phone=0, and R keeps that switch", () => {
    const { script } = presentExtra();
    expect(script).toContain("get('phone')==='0'");
    expect(script).toContain("if(!NOPHONE)document.body.append(mk('aside','pv-lane'");
    expect(script).toContain("'?present=1'+(NOPHONE?'&phone=0':'')+POOLTAG");
  });

  it("frames the run as the product: a sidebar, the sections, Claude's usage call by call, the proof download; no negotiation unless &neg=1", () => {
    const { script, css } = presentExtra();
    expect(script).toContain("get('shell')!=='0'");
    expect(script).toContain("get('neg')!=='1'");
    expect(script).toContain("e.event==='claude.read'||e.event==='agent.run'");
        expect(css).toContain("body.pv-shell .acts.pdfl { display: flex !important; }");
    expect(css).toContain("body.pv-noneg .negcard { display: none !important; }");
    for (const w of ["Inbox", "Approvals", "Payments", "Books", "Agents", "Claude · this run"]) expect(script).toContain(w);
  });

  it("explains Purser in plain words with the partners' own logos and the README's system map, byte for byte", () => {
    const { script } = presentExtra("public");
    for (const w of ["AI agents pay the invoices. You approve the exceptions with Face ID.", "Changed by one cent after you approved?", "The whole system"]) expect(script).toContain(w);
    expect(SYSTEM_MAP_DATA_URL).toBe("data:image/svg+xml;base64," + readFileSync("docs/assets/readme/system-map-dark.svg").toString("base64"));
    expect(script).not.toContain("document.body.classList.add('present');");
  });

  it("shows the partners' proof from recorded runs: Alta's refusal on chain, Airwallex's record of the CFO's hash, Visa via Airi's reused credential", () => {
    const { script } = presentExtra("public");
    expect(script).toContain("https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871");
    expect(script).toContain("797d4483");
    expect(script).toContain("Visa Intelligent Commerce · via Airwallex Airi");
    expect(script).toContain("No endorsement implied.");
  });

  it("is served by /try?present=1 and only then", async () => {
    const c = testCloud({ engine: true, tryIt: {} });
    try {
      expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
      const on = await (await c.fetch(`${ORIGIN}/try?present=1`)).text();
      const off = await (await c.fetch(`${ORIGIN}/try?present=0`)).text();
      // Recording mode only with ?present=1; the app shell and "How Purser works" on both.
      expect(on).toContain("document.body.classList.add('present');");
      expect(off).not.toContain("document.body.classList.add('present');");
      const v2 = await (await c.fetch(`${ORIGIN}/try?v=2`)).text();
      // The product frame and its words on ?present=1 and ?v=2; plain /try stays the release's page, negotiation included.
      for (const page of [on, v2]) { expect(page).toContain("pv-side"); expect(page).toContain("How Purser works"); expect(page).toContain("AI agents prepare the transfer. Your Face ID releases the funds."); }
      expect(v2).not.toContain("document.body.classList.add('present');");
      expect(off).not.toContain("pv-side");
      expect(off).not.toContain("AI agents prepare the transfer.");
    } finally { c.close(); }
  });
});
