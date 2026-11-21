// "Claude in the product today" on /claude (review, 21 Nov; src/redesign/claudePage.ts inProductItems): only what is
// built, each with its label and its record or code, and the long run's 111 decisions said as its own run, beside the
// main run's figures, never in their place.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inProductItems } from "../src/redesign/claudePage.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { liveTryRecords, liveTryTotals } from "../src/redesign/liveTry.js";
import { LONG_RUN_LOG, longRun } from "../src/redesign/run.js";
import { buildPages } from "../src/relay/assets.js";

describe("Claude in the product today", () => {
  const items = inProductItems();
  it("is the /try reader, the negotiation agents, Ask Purser, the read-only MCP server and the long run, each with a label and a record or code", () => {
    expect(items.map((x) => x.id)).toEqual(["reader", "negotiate", "ask", "mcp", "long-run"]);
    for (const x of items) {
      expect(x.label, x.id).toMatch(/test money|read only|reads only/i);
      expect(x.href.startsWith(REPO_BLOB), x.id).toBe(true);
      expect(existsSync(new URL(`../${x.href.slice(REPO_BLOB.length)}`, import.meta.url)), x.id).toBe(true);
    }
  });
  it("reads its figures from the records: the /try walks and the long run of 20 Nov", () => {
    const t = liveTryTotals(liveTryRecords())!, lr = longRun()!;
    expect(items[0]!.line).toContain(`${t.claude.entries} Claude entries, ${t.claude.fallbacks} fallbacks`);
    expect(items[4]!.href).toBe(`${REPO_BLOB}${LONG_RUN_LOG}`);
    expect(items[4]!.line).toMatch(new RegExp(`^All ${lr.decisions} decisions by Claude \\(Sourcing \\d+, Support \\d+, Treasury \\d+\\), ${lr.fallbacks} fallbacks: its own run, not the main run's figures above\\.$`));
    expect(lr.decisions).toBe(111);
  });
  it("is on /claude, under the main run's split and agents", () => {
    const html = buildPages().claude!;
    expect(html).toContain('<section class="cinp card" id="in-product"');
    expect(html.indexOf('id="in-product"')).toBeGreaterThan(html.indexOf('id="agents"'));
  });
});
