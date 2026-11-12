// The vault's folder tree image (master list 512) is computed from src/vault/layout.ts: the committed SVGs are what the
// code draws now, and their folder names are layout.ts's own (Company/Year/Quarter/Inkoopfacturen|Betalingen|Rapporten).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { invoicePath, monthReportPath, paymentPath } from "../src/vault/layout.js";
import { VAULT_TREE_FILES, treeCompany, treeInvoices, treePaths, vaultTreeSvg } from "../src/vault/treeSvg.js";

const committed = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const names = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

describe("the vault tree image", () => {
  it("the committed files are what the code draws (npm run vault:tree)", () => {
    for (const theme of ["light", "dark"] as const) expect(committed(VAULT_TREE_FILES[theme])).toBe(vaultTreeSvg(theme));
  });

  it("its folders are layout.ts's: company, year, quarter, then the three folders", () => {
    const shown = names(committed(VAULT_TREE_FILES.light));
    const inv = treeInvoices()[0]!;
    const [company, year, quarter, folder] = invoicePath(treeCompany(), { ...inv, blocked: false }).split("/");
    expect(shown.slice(0, 3)).toEqual([company, year, quarter]);
    expect(folder).toBe("Inkoopfacturen");
    expect(paymentPath(treeCompany(), inv).split("/")[3]).toBe("Betalingen");
    expect(monthReportPath(treeCompany(), inv.date.slice(0, 7)).split("/")[3]).toBe("Rapporten");
    for (const f of ["Inkoopfacturen", "Betalingen", "Rapporten"]) expect(shown).toContain(f);
    // Every segment of every path is in the image, and nothing else is.
    const segs = new Set(treePaths().flatMap((p) => p.split("/")));
    expect(new Set(shown)).toEqual(segs);
  });

  it("reads the invoices from the awx-1 run log and the company from the main run's record", () => {
    expect(treeInvoices().map((i) => i.invoice_no)).toEqual(["SLL-2026-11", "BTX-2026-11"]);
    const md = committed("docs/runs/2026-11-07-awx-1.md");
    for (const i of treeInvoices()) expect(md).toContain(`${i.invoice_no}, ${i.vendor}, ${i.currency} `);
    expect(treeCompany()).toBe(JSON.parse(committed("docs/demo/main-run.json")).company);
  });

  it("uses the site's design tokens for its colours", () => {
    const ui = committed("src/redesign/ui.ts");
    for (const hex of committed(VAULT_TREE_FILES.dark).match(/#[0-9a-f]{6}\b/gi) ?? []) expect(ui).toContain(hex);
  });
});
