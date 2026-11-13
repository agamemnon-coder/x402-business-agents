// Jury review, 13 Nov: the demo company's console said three things about money (the footer "payments go through the
// Airwallex sandbox", the ribbon "nothing here moved on a real rail", the label "test money"). A guest now reads one line,
// in the ribbon, the label and the footer alike: made-up data, simulated bank, test money, and the console never pays.
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { MESSAGES } from "../src/ui/i18n.js";

const LINE = "Demo company: made-up data, simulated bank, test money. The console never pays.";

describe("the demo company's one line", () => {
  it("is the ribbon's and the label's words, in English and in Dutch", () => {
    expect(MESSAGES.en["cs.demo.line"]).toBe(LINE);
    expect(MESSAGES.en["cs.demo.ribbon"]).toBe(LINE);
    expect(MESSAGES.en["cs.demo.label"]).toBe(LINE);
    expect(MESSAGES.nl["cs.demo.ribbon"]).toBe(MESSAGES.nl["cs.demo.line"]);
    expect(MESSAGES.nl["cs.demo.label"]).toBe(MESSAGES.nl["cs.demo.line"]);
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
