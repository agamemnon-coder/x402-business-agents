// /try/sign after Max's review (7 Nov): each lock shows its channel; the worst case is the argument for the signature;
// a calmer trick screen with the IBANs side by side; a thin band at the top. The browser checks
// (test/browser/trysign.check.ts) measure the band and read the lines in sight; this reads the page as served.
import { describe, expect, it } from "vitest";
import { LOCK_CHANNELS, TRY_SIGN_SCREENS, trySignCss, trySignPage } from "../src/try/sign.js";

const page = trySignPage();
const css = trySignCss();

describe("/try/sign after Max's review", () => {
  it("each lock shows its channel: Purser the invoices and proposals, the Airwallex card the card spend, Alta on chain", () => {
    expect(LOCK_CHANNELS).toEqual({
      purser: { short: "Invoices", long: "Invoices and proposals" },
      airwallex: { short: "Card spend", long: "Card spend" },
      metal: { short: "On-chain", long: "On-chain payments" },
    });
    // Screen 5's three lines, the diagram and the full policy's three panels.
    for (const [id, k] of [["rl-purser", "purser"], ["rl-awx", "airwallex"], ["rl-metal", "metal"]] as const) expect(page).toMatch(new RegExp(`<li id="${id}"><svg[^>]*>.*?</svg><span class="ch">${LOCK_CHANNELS[k].short}</span><span></span></li>`));
    for (const k of ["purser", "airwallex", "metal"] as const) {
      expect(page).toContain(`<small class="ch">${LOCK_CHANNELS[k].long}</small>`);
      expect(page).toContain(`</b><span class="ch">${LOCK_CHANNELS[k].long}</span><span class="pill state"></span>`);
    }
    // The blocked payment's locks name theirs from the same words.
    expect(page).toContain('el("span", "ch", [D.channels[l.id] ? D.channels[l.id].long : ""])');
  });

  it("the worst case is the argument: the reason a looser rule needs a signature sits right under the figure", () => {
    expect(page).toMatch(/<div class="argue" id="s4-argue"><p class="worst" id="s4-worst">[^<]+<\/p>\s*<p class="note" id="s4-note" aria-live="polite"><\/p><\/div>/);
    expect(TRY_SIGN_SCREENS.rule.looser).toBe("That risk needs your Face ID.");
    expect(TRY_SIGN_SCREENS.rule.worst).toBe("Worst case:");
  });

  it("a calmer trick screen: a plain card, red only where it differs and for the block; the IBANs side by side", () => {
    expect(css).toMatch(/\.tricked \{ display: grid; gap: 10px; padding: 14px 16px; border-radius: 16px; background: var\(--sunken\);/);
    expect(page).toContain('<div class="ibans" id="k-ibans"></div>');
    expect(page.indexOf('id="k-ibans"')).toBeGreaterThan(page.indexOf('id="k-doc"'));
    expect(page.indexOf('id="k-ibans"')).toBeLessThan(page.indexOf('id="k-out"'));
  });

  it("a thin band at the top: one line of 16 px, 3 px above and below", () => {
    expect(css).toMatch(/^\.testband \{[^}]*font: 700 12px\/16px [^}]*padding: 3px 10px;/);
  });

  it("no stray \"null\" in sight when the agent gave no advice", () => {
    expect(page).toContain('$("s1-ask").replaceChildren.apply($("s1-ask"), [askLine(p), el("p", "says", [p.says]), advice].filter(Boolean));');
  });
});
