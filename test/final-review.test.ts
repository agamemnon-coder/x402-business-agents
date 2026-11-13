// The final review of 13 November ("enterprise level"), held in place: one version, the vic-4 page's credential
// section filled from its record, no working files at the docs root, and no internal asides in public files.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the final review (13 Nov)", () => {
  it("states one version: package.json's is the MCP server's serverInfo", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const served = /export const SERVER_VERSION = "([^"]+)"/.exec(read("cloud/src/claude/mcp.ts"))?.[1];
    expect(served).toBeDefined();
    expect(pkg.version).toBe(served);
    expect((JSON.parse(read("package-lock.json")) as { version: string }).version).toBe(pkg.version);
  });

  it("fills vic-4's credential section from its record: F1 and F2, each with its refusal code", () => {
    const md = read("docs/runs/2026-11-13-vic-4.md");
    const section = md.slice(md.indexOf("## Credential misuse (F1, F2)"), md.indexOf("## Checks"));
    const rec = JSON.parse(read("docs/runs/2026-11-13-vic-4.json")) as { purchases: { step: string; mandate_id: string; outcome: { code: string } }[] };
    for (const step of ["F1", "F2"]) {
      const p = rec.purchases.find((x) => x.step === step)!;
      expect(section).toContain(`**${step}**`);
      expect(section).toContain(p.outcome.code);
      expect(section).toContain(p.mandate_id);
    }
  });

  it("keeps the docs root to public documents: working files in docs/archive/, screenshots in docs/screens/", () => {
    const root = readdirSync(new URL("../docs/", import.meta.url));
    expect(root.filter((f) => f.endsWith(".png"))).toEqual([]);
    for (const gone of ["internal", "superpowers", "readme-v2-draft.md"]) expect({ gone, there: root.includes(gone) }).toEqual({ gone, there: false });
    for (const f of ["dry-run-acceptatie.md", "testgeld-recycling.md"]) expect(existsSync(new URL(`../docs/runs/${f}`, import.meta.url))).toBe(false);
    for (const kept of ["docs/archive/internal/spiekkaart-demo.html", "docs/archive/superpowers/specs", "docs/archive/readme-v2-draft.md", "docs/archive/runs/testgeld-recycling.md", "docs/screens/approve-view.png"])
      expect({ kept, there: existsSync(new URL(`../${kept}`, import.meta.url)) }).toEqual({ kept, there: true });
  });

  it("has no internal asides in public files: the project name on /docs, people or phases in .env.example", () => {
    expect(read("src/redesign/docs.ts")).not.toMatch(/internal project name/i);
    expect(read(".env.example")).not.toMatch(/Cardputer|Phase [A-Z]\b|Max's/);
  });

  it("names both sets of agents in the README, as the site does", () => {
    const readme = read("README.md");
    for (const a of ["Sourcing", "Support", "Treasury", "Reader", "Checker", "Coder", "Payer"]) expect({ a, named: readme.includes(a) }).toEqual({ a, named: true });
    expect(read("src/redesign/home.ts")).toMatch(/Checker agent \(Claude\)[\s\S]*Coder agent \(Claude\)[\s\S]*Payer agent \(Claude\)/);
  });
});
