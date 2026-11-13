// "What Purser guarantees" on /proof (competitive review, 10 Nov): each promise names a source file and a test that
// exist, its evidence links somewhere real, and /llms.txt serves the repository's plain-text summary.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { GUARANTEES, GUARANTEES_ID, guaranteesHtml } from "../src/redesign/guarantees.js";
import { pageResponse } from "../worker/src/core.js";

const root = (p: string) => new URL(`../${p}`, import.meta.url);

describe("What Purser guarantees", () => {
  it("names a source file and a test that exist, for every promise", () => {
    expect(GUARANTEES.length).toBeGreaterThanOrEqual(6);
    for (const g of GUARANTEES) expect({ id: g.id, src: existsSync(root(g.source)), test: existsSync(root(g.test)) }).toEqual({ id: g.id, src: true, test: true });
  });

  it("links each promise's evidence to a page of the site, the repository or the explorer", () => {
    const pages = ["proof#faceid", "airwallex#awx-1-steps", "visa", "metal", "claude"];
    for (const g of GUARANTEES) expect({ id: g.id, ok: pages.includes(g.evidence.href) || g.evidence.href.startsWith("https://github.com/agamemnon-coder/x402-business-agents/") }).toEqual({ id: g.id, ok: true });
  });

  it("gives the Visa entry its own promise, from the Airi run, and keeps the chain test honest", () => {
    const visa = GUARANTEES.find((g) => g.id === "g-visa")!;
    expect(visa.evidence.href).toBe("visa");
    expect(visa.how).toContain("Visa Intelligent Commerce through Airwallex's Airi");
    expect(GUARANTEES.find((g) => g.id === "g-chain")!.evidence.label).toContain("our own check switched off once");
  });

  // Jury pass, 13 Nov: the four summary cards come first; the guarantees open the one details fold under them.
  // Jury, 13 Nov (second round): the first screen was too thin; the guarantees are in sight again, under the four cards.
  it("is in sight under the band and the four cards, above the fold with the partners and the numbers", () => {
    const proof = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).proof!;
    expect(proof).toContain(guaranteesHtml());
    expect(proof.indexOf(`id="${GUARANTEES_ID}"`)).toBeLessThan(proof.indexOf("The partners"));
    expect(proof.indexOf(`id="${GUARANTEES_ID}"`)).toBeLessThan(proof.indexOf('<div class="nums">'));
    const between = proof.slice(proof.indexOf("<h1>Proof</h1>") + "<h1>Proof</h1>".length, proof.indexOf(guaranteesHtml())).trim();
    expect(between).toMatch(/^<ul class="scale"[\s\S]*<\/ul>\s*<ul class="sumc"[\s\S]*<\/ul>$/);
    expect(proof.slice(proof.indexOf(guaranteesHtml()) + guaranteesHtml().length).trim()).toMatch(/^<details class="sumd" id="details"><summary>All the proof: partners, numbers and every check<\/summary>/);
  });

  it("keeps its seven promises, numbered in this order, each with who enforces it and its evidence in sight, how folded", () => {
    const html = guaranteesHtml();
    expect(GUARANTEES.map((g) => g.id)).toEqual(["g-terms", "g-cards", "g-visa", "g-chain", "g-once", "g-keys", "g-log"]);
    expect([...html.matchAll(/<li id="([a-z-]+)" data-by="(airwallex|metal|purser)"><b>[^<]+<\/b><span class="by">[^<]+<\/span><span class="ev"><a href="[^"]+"[^>]*>[^<]+<\/a><\/span>\s*<details><summary>How<\/summary>/g)].map((m) => m[1])).toEqual(GUARANTEES.map((g) => g.id));
    expect(html).not.toMatch(/<details[^>]* open/);
  });
});

describe("/llms.txt", () => {
  it("serves the repository's llms.txt as plain text", async () => {
    const pages = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv);
    expect(pages.llms).toBe(readFileSync(root("llms.txt"), "utf8"));
    const r = (await pageResponse(new Request("https://example.test/llms.txt"), pages))!;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await r.text()).toContain("# Purser");
  });

  it("says what is simulated and links the Visa run's log", () => {
    const t = readFileSync(root("llms.txt"), "utf8");
    expect(t).toContain("Simulated: the customer, the supplier, the merchants' charges, the settlement");
    expect(t).toContain("docs/runs/2026-11-07-vic-1.md");
    expect(t).toContain("entered for the Metal Award and the Visa Award");
  });
});
