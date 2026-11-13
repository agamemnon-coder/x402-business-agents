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

  it("is the footer in the demo company, whatever the engine chip says", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toMatch(/dm\.hidden=!on;document\.body\.classList\.toggle\('demo',on\);\$\('#foot'\)\.textContent=on\?t\('cs\.demo\.line'\):t\('cs\.foot'\)/);
    expect(html).toContain("$('#foot').textContent=document.body.classList.contains('demo')?t('cs.demo.line'):on?t('cs.eng.foot'):t('cs.foot')");
  });
});

describe("the invoices bar says what it holds", () => {
  it("renders the inbox, outside-the-inbox and fee parts under the bar, in both languages", () => {
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "in.cloud.test" });
    expect(html).toContain("s.parts?el('span','ss sp',t('cs.dash.spend_parts',{inbox:s.parts.inbox.count,");
    for (const l of ["en", "nl"] as const) expect(MESSAGES[l]["cs.dash.spend_parts"]).toMatch(/\{inbox\}[\s\S]*\{inbox_amt\}[\s\S]*\{outside\}[\s\S]*\{outside_amt\}[\s\S]*\{fees\}/);
  });
});
