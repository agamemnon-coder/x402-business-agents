// The site's shared helpers (src/ui/), the edges the page tests leave: a message key missing from a catalogue, the
// register's data in English or empty, amounts and days that are not in their form, the language a request reads; the
// navigation replaced in a page that has none; an icon that does not exist; a page without a <head>; the "More" menu
// with no page of its own marked; and the payables kit's count-up between 0 and 1.
import { describe, expect, it } from "vitest";
import { dataText, fmtAmount, fmtDay, fmtMoney, keysUsedIn, pickLang, t } from "../src/ui/i18n.js";
import { navHtml, withNav } from "../src/ui/nav.js";
import { svg } from "../src/ui/payablesKit.js";
import { withMeta } from "../src/ui/meta.js";
import { moreHtml } from "../src/ui/more.js";
import { formerlyMetal } from "../src/ui/formerly.js";

describe("the language helpers", () => {
  it("a key missing from both catalogues is shown as the key; placeholders are filled as given", () => {
    expect(t("nl", "no.such.key" as never)).toBe("no.such.key");
    expect(t("en", "no.such.key" as never, { n: 3 })).toBe("no.such.key");
  });
  it("the register's data stays as it is in English, when empty, or when no pattern fits", () => {
    expect(dataText("en", "category" as never, "Software")).toBe("Software");
    expect(dataText("nl", "category" as never, "")).toBe("");
    expect(dataText("nl", "no_such_field" as never, "Software")).toBe("Software");
  });
  it("amounts and days not in their form are left as they are, or empty", () => {
    expect(fmtAmount("nl", "1850.00")).toBe("1.850,00");
    expect(fmtAmount("en", "-1234567.89")).toBe("-1,234,567.89");
    expect(fmtAmount("nl", "about 5")).toBe("about 5");
    expect(fmtMoney("nl", "EUR", "5.00")).toBe("€ 5,00");
    expect(fmtMoney("nl", "USD", "5.00")).toBe("USD 5,00");
    expect(fmtDay("en", "not a day")).toBe("");
    expect(fmtDay("nl", "2026-03-16T10:00:00Z")).toBe("16 mrt 2026");
  });
  it("the language a request reads: the first that is a language, else Dutch", () => {
    expect(pickLang(undefined, "fr", "en", "nl")).toBe("en");
    expect(pickLang(null, 5)).toBe("nl");
  });
  it("the keys a page's source asks for: t, tk, tn's two forms and data-t", () => {
    expect([...keysUsedIn(`t('a.b');tk('c.d',x);tn('e.f',2);<b data-t="g.h">`)].sort()).toEqual(["a.b", "c.d", "e.f_one", "e.f_other", "g.h"]);
  });
});

describe("the navigation, the icons and the head", () => {
  it("a page without a navigation of its own cannot have it replaced", () => {
    expect(() => withNav("<html><body><main>x</main></body></html>", "home")).toThrow("the page has no navigation to replace");
  });
  it("marks no tab when the page belongs to none, and keeps a page's own id and class", () => {
    expect(navHtml(null)).not.toContain('aria-current="page"');
    expect(navHtml("proof", "top-nav", "wide")).toMatch(/^<nav class="wide pnav" id="top-nav" aria-label="Main">/);
    expect(withNav(`<html><head></head><body><nav id="n1" class="c1"><a>old</a></nav></body></html>`, "home")).toMatch(/<nav class="c1 pnav" id="n1"/);
  });
  it("an icon that does not exist is an error, never an empty drawing", () => {
    expect(() => svg("no-such-icon")).toThrow("no icon no-such-icon");
    expect(svg("copy", 12)).toMatch(/^<svg class="i" viewBox="0 0 24 24" width="12" height="12"/);
  });
  it("a page without a <head> gets no tags, only Alta's former name said once in its <main>", () => {
    const out = withMeta("<main><p>Alta pays.</p></main>");
    expect(out).not.toContain("<meta");
    expect(out).toBe("<main><p>Alta (formerly Metal) pays.</p></main>");
  });
  it("the More menu with no page of its own marked", () => {
    const html = moreHtml();
    expect(html).toMatch(/^<details class="pmore"><summary>/);
    expect(html).not.toContain('aria-current="page"');
  });
  it("Alta's former name is not added inside a script, a style or a hidden element, and void tags close nothing", () => {
    const html = `<main><p><img src="x"><br/>text</p></i><script>var a = "Alta";</script><span aria-hidden="true">Alta</span><svg><title>Alta</title></svg><p>Alta pays</p></main>`;
    const out = formerlyMetal(html);
    expect(out).toContain('var a = "Alta";');
    expect(out).toContain("<p>Alta (formerly Metal) pays</p>");
    expect(out.match(/formerly Metal/g)).toHaveLength(1);
    // Outside <main>, or with no Alta in it, the page is as it was.
    expect(formerlyMetal("<p>Alta</p>")).toBe("<p>Alta</p>");
    expect(formerlyMetal("<main><p>none here</p></main>")).toBe("<main><p>none here</p></main>");
  });
});
