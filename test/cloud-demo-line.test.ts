// Jury review, 13 Nov: the demo company's console said three things about money (the footer "payments go through the
// Airwallex sandbox", the ribbon "nothing here moved on a real rail", the label "test money"). A guest now reads one line,
// in the ribbon, the label and the footer alike: made-up data, simulated bank, test money, and the console never pays.
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { MESSAGES } from "../src/ui/i18n.js";

const LINE = "Demo company: made-up data, simulated bank, test money. The console never pays.";

describe("the demo company's one line", () => {
  it("is the ribbon's words, in English and in Dutch", () => {
    expect(MESSAGES.en["cs.demo.line"]).toBe(LINE);
    expect(MESSAGES.en["cs.demo.ribbon"]).toBe(LINE);
    expect(MESSAGES.nl["cs.demo.ribbon"]).toBe(MESSAGES.nl["cs.demo.line"]);
  });

  // Jury round 2, 13 Nov: the Overview's card no longer repeats it (ribbon and footer say it), so a guest reads it twice,
  // not three times; the footer shows it from the first paint (a guest session is stored as one), and never the sandbox
  // line first.
  it("is said twice, by the ribbon and the footer, from the first paint", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).not.toContain("cs.demo.label");
    expect(html).not.toContain("demo-label");
    expect(Object.hasOwn(MESSAGES.en, "cs.demo.label")).toBe(false);
    expect(html).toContain("const on=!!(S&&(ME?ME.demo:S.guest));");
    expect(html).toContain("document.querySelector('#foot').textContent='';");
    expect(html).not.toContain("document.querySelector('#foot').textContent=t('cs.foot');");
  });

  it("the spend bar's breakdown is on a line of its own", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain(".sbars .ss.sp { display: block;");
  });

  // The engine's own footer first: when the engine runs it pays (on a stand-in bank), so "the console never pays" would
  // not hold there (console check, engine pass).
  it("is the footer in the demo company, unless the engine runs, whose own line comes first", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain("function footLine(){$('#foot').textContent=ENG_ON?t('cs.eng.foot'):document.body.classList.contains('demo')?t('cs.demo.line'):t('cs.foot')}");
    expect(html).toContain("dm.hidden=!on;document.body.classList.toggle('demo',on);footLine()}");
    expect(html).toContain("var ENG_ON=false;");
    expect(html).toContain("function engineChip(on){ENG_ON=!!on;");
  });
});

describe("the invoices bar says what it holds", () => {
  it("renders the inbox, outside-the-inbox and fee parts under the bar, in both languages", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain("s.parts?el('span','ss sp',t('cs.dash.spend_parts',{inbox:s.parts.inbox.count,");
    for (const l of ["en", "nl"] as const) expect(MESSAGES[l]["cs.dash.spend_parts"]).toMatch(/\{inbox\}[\s\S]*\{inbox_amt\}[\s\S]*\{outside\}[\s\S]*\{outside_amt\}[\s\S]*\{fees\}/);
  });
});

describe("the Overview's figures", () => {
  it("are written final at once, never counted up from zero", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain("function countUp(node,target,fmt){node.textContent=fmt(target)}");
    expect(html).not.toMatch(/node\.textContent=fmt\(0\)/);
  });
});

describe("while a page loads", () => {
  it("shows a skeleton, with 'Loading …' kept for a screen reader, still under reduced motion", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain("view().replaceChildren(el('div','skel',[el('span','vh',t('loading')),");
    expect(html).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{ \.skel i \{ animation:/);
  });
});

describe("the tabs on a phone", () => {
  it("fade at the right edge, so a cut tab reads as a row that scrolls on", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain(".appbar nav.apptabs { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); mask-image:");
  });
});
