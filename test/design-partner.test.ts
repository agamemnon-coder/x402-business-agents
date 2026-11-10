// The design-partner call to action (review 9 Nov, founder: no call to action anywhere). One constant, DESIGN_PARTNER_URL;
// while it is empty nothing shows, once it is set the link shows on Home, on /try/sign's closing card and in the README.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL, designPartnerHtml } from "../src/config/brand.js";
import { homePage } from "../src/redesign/home.js";
import { trySignPage } from "../src/try/sign.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("the design-partner link", () => {
  it("renders nothing without a valid address, and a link with one", () => {
    expect(designPartnerHtml("")).toBe("");
    expect(designPartnerHtml("javascript:alert(1)")).toBe("");
    expect(designPartnerHtml('https://x.example/"><script>')).toBe("");
    expect(designPartnerHtml("mailto:partners@example.com")).toBe(`<p class="partner"><a href="mailto:partners@example.com">${DESIGN_PARTNER_LABEL} →</a></p>`);
  });

  it("shows on Home and on /try/sign's closing card once set, and nowhere while empty", () => {
    const url = "https://partners.example/purser";
    expect(homePage(undefined, { trySign: true, partnerUrl: url })).toContain(`<a href="${url}">${DESIGN_PARTNER_LABEL} →</a>`);
    expect(homePage(undefined, { trySign: true, partnerUrl: "" })).not.toContain(DESIGN_PARTNER_LABEL);
    const end = (html: string) => html.slice(html.indexOf('<nav class="end"'), html.indexOf("</nav>", html.indexOf('<nav class="end"')));
    expect(end(trySignPage(url))).toContain(`<a href="${url}">${DESIGN_PARTNER_LABEL} →</a>`);
    expect(end(trySignPage(""))).not.toContain(DESIGN_PARTNER_LABEL);
  });

  it("is in the README exactly when the constant is set", () => {
    if (DESIGN_PARTNER_URL) expect(README).toContain(`**[${DESIGN_PARTNER_LABEL} →](${DESIGN_PARTNER_URL})**`);
    else expect(README).not.toContain(DESIGN_PARTNER_LABEL);
  });
});
