// Recording mode (/try?present=1, cloud/src/try/presentMode.ts): a flag. Every /try has the app shell and "How Purser
// works" (one more style block and one more script under the same nonce, which read the page's own API answers and call
// nothing); ?present=1 adds the recording mode's cards, keys and zoom. The browser run is test/browser/present.check.ts.
import { readFileSync } from "node:fs";
import { SYSTEM_MAP_DATA_URL } from "../cloud/src/try/systemMap.gen.js";
import { describe, expect, it } from "vitest";
import { tryPage } from "../cloud/src/tryPage.js";
import { presentExtra, V2_COPY, PRESENT_AFTER, PRESENT_BEFORE, PRESENT_MONEY, PRESENT_TRY } from "../cloud/src/try/presentMode.js";
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
    for (const w of ["AI agents prepare the payments. You approve the exceptions with Face ID.", "Changed by one cent after you approved?", "The whole system"]) expect(script).toContain(w);
    expect(SYSTEM_MAP_DATA_URL).toBe("data:image/svg+xml;base64," + readFileSync("docs/assets/readme/system-map-dark.svg").toString("base64"));
    expect(script).not.toContain("document.body.classList.add('present');");
  });

  it("shows the partners' proof from recorded runs: Alta's refusal on chain, Airwallex's record of the CFO's hash, Visa via Airi's reused credential", () => {
    const { script } = presentExtra("public");
    expect(script).toContain("https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871");
    expect(script).toContain("797d4483");
    expect(script).toContain("\"word\":\"Visa Intelligent Commerce\",\"label\":\"via Airwallex Airi · sandbox\"");
    expect(script).toContain("no endorsement implied");
  });

  it("says what is happening at every step in one plain sentence (Max, 15 Nov)", () => {
    const { script } = presentExtra("public");
    for (const w of ["Step 1 of 4", "The AI agent read the invoice and checked it.", "You are the CFO. Approve this exact payment.", "Blocked. Not a cent moved."]) expect(script).toContain(w);
  });

  it("defines what its first run reads before the run (a temporal dead zone stopped the whole frame on 16 Nov)", () => {
    const { script } = presentExtra("public");
    expect(script.indexOf("const chip=")).toBeGreaterThan(-1);
    expect(script.indexOf("const chip=")).toBeLessThan(script.indexOf("function v2(){"));
    expect(script.indexOf("const chip=")).toBeLessThan(script.indexOf("drawUse();"));
    // Each script must also parse: run it as a function body in a scope without a DOM, and only the DOM may be missing.
    for (const kind of ["public", "present"] as const) {
      const body = presentExtra(kind).script;
      expect(() => new Function(body)).not.toThrow();
    }
  });

  it("says a note that gives the AI orders out loud, from the engine's own flag", () => {
    const { script } = presentExtra("public");
    expect(script).toContain("e.event==='document.injection_flagged'");
    expect(script).toContain("Hidden instruction found in this invoice, and ignored");
  });

  it("shows the real flow under the hood per step, and no menu that does nothing (16 Nov, Max: only real stuff)", () => {
    const { script } = presentExtra("public");
    for (const w of ["Under the hood", "sha256(canonical(terms))", "signature = faceId.sign(fingerprint)", "findInjections(text)", "approval_sha256: ", "refused · EUR 0.00 moved", "amount <= agent_limit", "ledger.append(entry)", "sessionStorage.getItem('purser.try')"]) expect(script).toContain(w);
    expect(script).not.toContain("mk('ul','pv-nav'");
  });

  it("within the agent's limit: approved by policy, Claude's calls kept to the end, then on to an invoice above the limit (16 Nov, owner)", () => {
    const html = tryPage("n0nce", cfg, presentExtra("public"), V2_COPY as unknown as Record<string, Record<string, unknown>>);
    // The heading says who approved it: the policy within the limit; a person (Face ID) above it.
    expect(html).toContain("Checks passed. Approved by your policy.");
    expect(html).toContain("Checks passed. Waiting for your approval.");
    expect(html).toContain("box.append(el('p','big ok',alone?C.work.readyAlone:C.work.ready));");
    // The agents' calls on Pay are read before the paid screen stays (no poll runs there).
    expect(html).toContain("show('books',{settled:S.settled});catchUp();return}"); // after S.awx (the agent's own Airwallex transfer) is kept
    // The paid screen leads on to an invoice above the limit, which is picked for the visitor.
    expect(html).toContain("Try an invoice above EUR 500 →");
    expect(html).toContain('"limitAmount":"500.00","limitCurrency":"EUR"');
    expect(html).toContain("show('invoice',above?{above:true}:undefined)");
    // A new run clears the kept calls in sessionStorage too, so a reload never shows an earlier run's calls.
    for (const kind of ["public", "present"] as const) expect(presentExtra(kind).script).toMatch(/CALLS\.clear\(\);keepCalls\(\)/);
  });
  it("starts the hidden-instruction watch before the filing request, so a flag that arrives during it stays (16 Nov live run)", () => {
    for (const kind of ["public", "present"] as const) {
      const { script } = presentExtra(kind);
      const wrap = script.slice(script.indexOf("window.fetch=async(input,init)=>{"));
      expect(wrap.indexOf("noteFiling(")).toBeGreaterThan(-1);
      expect(wrap.indexOf("noteFiling(")).toBeLessThan(wrap.indexOf("await real(input,init)"));
      expect(wrap.slice(wrap.indexOf("await real(input,init)"), wrap.indexOf("return res;"))).not.toContain("noteFiling(");
    }
  });

  it("says a transfer waiting in Airwallex's approval workflow is the second lock, and drops the button that cannot move it", () => {
    const { script } = presentExtra("public");
    expect(script).toContain("Second lock: Airwallex's own approval.");
    expect(script).toContain("/^IN APPROVAL$/");
    expect(script).toContain("This invoice had a hidden instruction for the AI");
  });

  it("is /try itself; recording mode only with ?present=1; the release's page at ?v=1", async () => {
    const c = testCloud({ engine: true, tryIt: {} });
    try {
      expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
      const on = await (await c.fetch(`${ORIGIN}/try?present=1`)).text();
      const off = await (await c.fetch(`${ORIGIN}/try?present=0`)).text();
      // Recording mode only with ?present=1; the app shell and "How Purser works" on both.
      expect(on).toContain("document.body.classList.add('present');");
      expect(off).not.toContain("document.body.classList.add('present');");
      const v2 = await (await c.fetch(`${ORIGIN}/try?v=2`)).text();
      const plain = await (await c.fetch(`${ORIGIN}/try`)).text();
      const v1 = await (await c.fetch(`${ORIGIN}/try?v=1`)).text();
      const tour = await (await c.fetch(`${ORIGIN}/try?tour=1`)).text();
      // 16 Nov (Max): the product frame and its words are /try itself (and ?v=2, ?present=0, ?present=1); the release's
      // page, negotiation included, stays at ?v=1 and with the jury tour.
      for (const page of [on, off, v2, plain]) { expect(page).toContain("pv-side"); expect(page).toContain("How Purser works"); expect(page).toContain("AI agents prepare the transfer. Your Face ID releases the funds."); }
      for (const page of [off, v2, plain]) expect(page).not.toContain("document.body.classList.add('present');");
      for (const page of [v1, tour]) { expect(page).not.toContain("pv-side"); expect(page).not.toContain("AI agents prepare the transfer."); }
    } finally { c.close(); }
  });
});
