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

  it("is on /proof, above the partners", () => {
    const proof = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).proof!;
    expect(proof).toContain(guaranteesHtml());
    expect(proof.indexOf(`id="${GUARANTEES_ID}"`)).toBeLessThan(proof.indexOf("The partners"));
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
