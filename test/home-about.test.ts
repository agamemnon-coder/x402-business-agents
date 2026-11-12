// "About Purser" on Home (the owner's decision of 12 November, for the Founder's award): one closed fold at the end of
// Home, no new page and no menu item. The problem, what Purser does, what ran (a link to /runs) and the business model,
// in plain words, with no customers, pilots or revenue claimed. Every number in it is read from the run records by code;
// no design-partner call, no quotes, no founder sentences.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL } from "../src/config/brand.js";
import { ABOUT_HEAD, aboutFacts, homePage } from "../src/redesign/home.js";
import { liveRuns, RUNS_URL } from "../src/redesign/runs.js";
import { textOutsideTags } from "./support/scriptBlocks.js";

const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const text = (html: string) => textOutsideTags(html).replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!).replace(/\s+/g, " ").trim();
const about = (html: string) => /<details class="about" id="about">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
const RUN_LOG = readFileSync(new URL("../docs/runs/2026-11-10-platform-e2e.md", import.meta.url), "utf8");

describe("About Purser on Home", () => {
  it("is one closed fold after the last button, inside Home's content", () => {
    expect(ABOUT_HEAD).toBe("About Purser");
    for (const html of [ON, OFF]) {
      const main = /<main[\s\S]*<\/main>/.exec(html)![0];
      expect(main.match(/<details class="about" id="about">/g)).toHaveLength(1);
      expect(about(html)).toContain(`<summary>${ABOUT_HEAD}</summary>`);
      expect(about(html)).not.toMatch(/<details[^>]*\bopen\b/);
      expect(main.indexOf('class="about"')).toBeGreaterThan(main.indexOf('class="btn big more"'));
    }
  });

  it("says the problem, what Purser does, what ran and the business, in that order", () => {
    const t = text(about(ON));
    const parts = ["The problem:", "What Purser does:", "What ran:", "The business:", "No customers, pilots or revenue yet."];
    for (const p of parts) expect(t).toContain(p);
    expect(parts.map((p) => t.indexOf(p))).toEqual([...parts.map((p) => t.indexOf(p))].sort((a, b) => a - b));
    expect(t).toContain("the CFO signs the exact terms with Face ID");
    expect(t).toContain("Claude agents decide within those limits");
    expect(t).toMatch(/pilot pricing is a monthly plan by number of invoices, plus a small fee per payout through Airwallex connected accounts/);
    expect(about(ON)).toContain('<a class="go" href="pricing">');
    expect(t).toContain("with Airwallex's KYC: built, switched off");
    expect(about(ON)).toContain(`<a class="go" href="${RUNS_URL}">`);
    expect(text(about(ON))).toBe(text(about(OFF)));
  });

  it("reads every number from the run records", () => {
    const f = aboutFacts();
    expect(f.runs).toBe(liveRuns().length);
    // The payout and Purser's fee: the run's own line on /runs, and the run log it comes from.
    const row = liveRuns().find((r) => r.key === "platform-e2e-1")!;
    expect(row.line).toContain(`one EUR ${f.payout} payout PAID, Purser's fee EUR ${f.fee}`);
    expect(RUN_LOG).toContain(`EUR ${f.payout}`);
    expect(RUN_LOG).toContain(`EUR ${f.fee}`);
    const t = text(about(ON));
    expect(t.match(/\d+(?:[.,]\d+)*/g)).toEqual([String(f.runs), f.payout, f.fee]);
    expect(t).toContain(`${f.runs} runs in sandboxes and on testnet`);
    expect(t).toContain(`in Airwallex's sandbox a EUR ${f.payout} payout was paid with Purser's EUR ${f.fee} fee`);
  });

  it("claims no customer, quotes no one, asks for no design partner and names no person", () => {
    expect(DESIGN_PARTNER_URL).toBe("");
    for (const html of [ON, OFF]) {
      expect(html).not.toContain(DESIGN_PARTNER_LABEL);
      expect(html).not.toMatch(/design partner|Looking for/i);
    }
    const t = text(about(ON));
    expect(t).not.toMatch(/[“”"«»]/);
    expect(t).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
    expect(t).not.toMatch(/\bMax\b|Geurtsen|founder/i);
    expect(t).not.toMatch(/revolution|seamless|world-class|game.?chang|cutting.edge|best-in-class|unique|effortless/i);
    // Short: about a minute's reading, closed by default.
    expect(t.split(" ").length).toBeLessThanOrEqual(130);
  });
});
