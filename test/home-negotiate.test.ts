// Max, 15 Nov: "Agents negotiate" out of the More menu (it read as unprofessional there); /try/negotiate gets a card on
// Home under the features, with its page's own headline and one button, and stays linked at the end of /try.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEGOTIATE_BUTTON, NEGOTIATE_HEAD, homePage, negotiateCardHtml } from "../src/redesign/home.js";
import { MORE_LINKS, NEGOTIATE_URL } from "../src/ui/more.js";

describe("/try/negotiate on Home, not in the menu", () => {
  it("is out of the More menu", () => {
    expect(MORE_LINKS.map((l) => l.label)).not.toContain("Agents negotiate");
    expect(MORE_LINKS.map((l) => l.href)).not.toContain(NEGOTIATE_URL);
  });

  it("has a card under Home's features, its page's headline word for word, and one button to the page", () => {
    const home = homePage();
    const feat = home.indexOf('<ul class="feat">'), card = home.indexOf('<div class="negf');
    expect(card).toBeGreaterThan(feat);
    expect(card).toBeLessThan(home.indexOf('<section class="e-flow"'));
    expect(negotiateCardHtml()).toContain(`<a class="btn big ghost" href="${NEGOTIATE_URL}">${NEGOTIATE_BUTTON}`);
    expect(readFileSync(new URL("../cloud/src/try/negotiatePage.ts", import.meta.url), "utf8")).toContain(`head: "${NEGOTIATE_HEAD}"`);
  });

  it("stays linked at the end of /try", () => {
    expect(readFileSync(new URL("../cloud/src/tryPage.ts", import.meta.url), "utf8")).toMatch(/negotiate/);
  });
});
