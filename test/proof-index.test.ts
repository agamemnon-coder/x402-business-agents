// docs/evidence/proof-index.md (owner, 20 Nov): one table with every figure on /proof, its value, its record and how to
// check it. Built by `npm run proof:index` from the page as built; this test holds the committed file to a fresh build
// and the table to what the page shows, row by row, read here from the page without the builder's code.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { distinctive, figures, recordsOf } from "../src/proof/figureTrace.js";
import { checkOf, proofIndexMd } from "../src/proof/proofIndex.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";
import { PROOF_INDEX_FILE, PROOF_INDEX_LINK, proofPage } from "../src/redesign/proof.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = proofPage();
const md = read(PROOF_INDEX_FILE);
/** The table's rows, split on unescaped pipes. */
const rows = md.split("\n").filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.slice(2, -2).split(/(?<!\\) \| /).map((c) => c.replace(/\\\|/g, "|")));

describe("docs/evidence/proof-index.md", () => {
  it("is the index of the page as built now (npm run proof:index)", () => {
    expect(md).toBe(proofIndexMd(html));
  });

  it("has one row for each figure the page shows, in the page's order, with its value and its records", () => {
    const figs = figures(html);
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.map((r) => Number(r[0]))).toEqual(rows.map((_, i) => i + 1));
    // Every figure on the page has a row with its value and its records; every row's value is a figure on the page.
    const key = (value: string, recs: string) => `${value} @ ${recs}`;
    const inTable = new Set(rows.map((r) => key(r[2]!, r[4]!)));
    const onPage = figs.map((f) => key(f.token, (recordsOf(f).length ? recordsOf(f) : f.hrefs.filter((h) => /^https:/.test(h)).slice(-1)).join(" ")));
    expect(onPage.filter((k) => !inTable.has(k))).toEqual([]);
    expect([...inTable].filter((k) => !onPage.includes(k))).toEqual([]);
    // The order: the table's values are the page's figures, repeats in one place merged.
    let at = 0;
    for (const r of rows) { const i = figs.findIndex((f, j) => j >= at && f.token === r[2]); expect({ row: r[0], found: i >= 0 }).toEqual({ row: r[0], found: true }); at = i; }
    expect(md).toContain(`**${figs.length} figures on the page, ${figs.length} with a record;**`);
  });

  it("names a record for every row, and no row is untraced", () => {
    for (const r of rows) expect({ row: r[0], record: r[4]!.length > 0 }).toEqual({ row: r[0], record: true });
    expect(md).not.toContain("NOT TRACED");
  });

  it("gives every hash and id the field of its record that holds it, and the command that checks it where one exists", () => {
    const ids = rows.filter((r) => ["hash", "id"].includes(distinctive(r[2]!)?.kind ?? ""));
    expect(ids.length).toBeGreaterThan(20);
    for (const r of ids) {
      expect({ row: r[0], value: r[2], field: /^field \S+: \S/.test(r[5]!) }).toEqual({ row: r[0], value: r[2], field: true });
      for (const rec of r[4]!.split(" ")) { const c = checkOf(rec); if (c) expect(r[5]).toContain(c); }
    }
    // The signed approvals the page shows: their receipts' own verifiers are named.
    expect(rows.some((r) => r[4]!.includes("docs/runs/2026-11-07-awx-1/receipt-P-0002.json") && r[5]!.includes("`npm run verify-approval`"))).toBe(true);
    expect(rows.some((r) => r[4]!.includes("receipt-SANDBOXTEST-P-0002.json") && r[5]!.includes("`npm run verify-receipt -- docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json`"))).toBe(true);
    // The CFO's signed hash carried by Airwallex (main run P-0005): field and the trail's offline re-check.
    const hash = rows.find((r) => r[2] === "797d4483594fc4f6585466f39bb3f9e4ad4200c85b82d5b7dc078527dcababcd")!;
    expect(hash[5]).toMatch(/^field docs\/demo\/main-run\.json: ledger\./);
    expect(hash[5]).toContain("`npm run airwallex-trail`");
  });

  it("is linked from /proof's utility row and from the README's evidence line", () => {
    const util = html.slice(html.indexOf('<nav class="util"'));
    expect(util).toContain(`href="${REPO_BLOB}${PROOF_INDEX_FILE}"`);
    expect(util).toContain(PROOF_INDEX_LINK);
    const line = read("README.md").split("\n").find((l) => l.startsWith("**Evidence wall, from the records:**"))!;
    expect(line).toContain(`](${PROOF_INDEX_FILE})`);
  });
});
