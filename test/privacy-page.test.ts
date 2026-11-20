// /privacy (20 Nov; outside audit, finding 3.4): a short public page, under "More" and in the footer, that says what is
// kept, for how long and who processes it, links the engineering inventory and its subprocessor list, gives the contact
// the owner asked to publish, says it is not legal advice, carries no founder bio, and stays within its word budget.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INVENTORY_DOC, NOT_LEGAL_ADVICE, PRIVACY_CONTACT, RETENTION_DOC, SUBPROCESSORS, SUBPROCESSORS_ANCHOR, privacyPage } from "../src/redesign/privacy.js";
import { buildPages } from "../src/relay/assets.js";
import { PRIVACY_PAGE } from "../src/servers/dashboard.js";
import { moreLinks } from "../src/ui/more.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { visibleWords } from "./support/visibleWords.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = privacyPage();
const text = (/<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? "").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** A heading's anchor as GitHub makes it: lower case, punctuation out, spaces to hyphens. */
const anchorOf = (heading: string) => `#${heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")}`;

describe("/privacy", () => {
  it("is served by the site, listed under More and in the footer, and built once", () => {
    expect(PRIVACY_PAGE).toBe(html);
    const pages = buildPages() as unknown as Pages;
    const res = pageResponse(new Request("https://x.test/privacy"), pages);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-security-policy")).not.toContain("script-src 'sha");
    expect(moreLinks().find((l) => l.key === "privacy")).toEqual({ key: "privacy", label: "Privacy", href: "privacy", group: "product" });
    expect(html).toMatch(/<footer class="foot">[\s\S]*<a class="flink" href="\/?privacy">Privacy<\/a>/);
  }, 120_000); // building every page of the site takes a few seconds

  it("links the data inventory, its subprocessor list and the retention rules, and every link resolves in the repository", () => {
    expect(html).toContain(`/${INVENTORY_DOC}"`);
    expect(html).toContain(`/${INVENTORY_DOC}${SUBPROCESSORS_ANCHOR}"`);
    expect(html).toContain(`/${RETENTION_DOC}"`);
    const inventory = read(INVENTORY_DOC);
    expect(inventory.split("\n").filter((l) => l.startsWith("## ")).map((l) => anchorOf(l.slice(3)))).toContain(SUBPROCESSORS_ANCHOR);
    for (const s of SUBPROCESSORS) expect(inventory).toContain(`**${s.name}**`);
    for (const s of SUBPROCESSORS) expect(html).toContain(`<b>${s.name}</b>`);
  });

  it("gives the published contact, says it is not legal advice, and holds no founder bio", () => {
    expect(html).toContain(`href="mailto:${PRIVACY_CONTACT}"`);
    expect(PRIVACY_CONTACT).toBe("max.geurtsen@outlook.com");
    expect(text).toContain(`${NOT_LEGAL_ADVICE}.`);
    for (const doc of [INVENTORY_DOC, RETENTION_DOC]) expect(read(doc)).toContain(`**${NOT_LEGAL_ADVICE}.**`);
    expect(text).not.toMatch(/founder|biography|\bbio\b|Geurtsen is|about me/i);
    expect(text).toMatch(/seven years/);
  });

  it("stays within 120 words in sight, the folds closed", () => {
    expect(visibleWords(html)).toBeLessThanOrEqual(120);
    expect((html.match(/<details class="fold"/g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/<details class="fold" open/);
  });
});
