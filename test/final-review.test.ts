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

  it("quotes Airwallex's AgentOS word for word, with its URL, and says Purser's part without naming anyone else", () => {
    const readme = read("README.md");
    // Read on 13 Nov 2026 from https://www.airwallex.com/docs/developer-tools/ai/agentos ("Before you deploy").
    expect(readme).toContain('"components do not initiate money-out actions (transfers, FX conversions, or payouts) on\nyour behalf" ([docs](https://www.airwallex.com/docs/developer-tools/ai/agentos), read 13 November 2026)');
  });

  it("has a Visa Award and a Metal Award section, each with its live dates and records", () => {
    const readme = read("README.md");
    const sec = (h: string) => readme.slice(readme.indexOf(`## ${h}`), readme.indexOf("\n## ", readme.indexOf(`## ${h}`) + 5));
    for (const f of ["docs/runs/2026-11-07-vic-1.md", "docs/runs/2026-11-13-vic-4.md"]) expect(sec("Visa Award")).toContain(`](${f})`);
    for (const f of ["docs/runs/2026-11-03-main-run.md", "docs/runs/2026-11-12-faceid-onchain.md"]) expect(sec("Metal Award")).toContain(`](${f})`);
    expect(sec("Metal Award")).toContain("testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871");
    expect(read("docs/demo/main-run.json")).toContain("0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871");
    expect(sec("Visa Award")).toContain("Visa TAP is an extra, not part of the entry.");
  });

  it("shows only screenshots npm run readme:shots writes from a local build, and names T:0 and the anchor run from their records", () => {
    const readme = read("README.md");
    const shots = [...readme.matchAll(/(?:src|srcset)="docs\/assets\/readme\/([\w-]+\.(?:webp|gif))"/g)].map((m) => m[1]!);
    const script = read("scripts/readme-shots.ts");
    expect(shots.length).toBeGreaterThanOrEqual(9);
    for (const f of shots) {
      expect({ f, there: existsSync(new URL(`../docs/assets/readme/${f}`, import.meta.url)) }).toEqual({ f, there: true });
      expect({ f, written: script.includes(`file: "${f}"`) }).toEqual({ f, written: true });
    }
    expect(readdirSync(new URL("../docs/assets/readme/", import.meta.url)).sort()).toEqual([...new Set(shots)].sort());
    // T:0: the run record's own figures.
    expect(read("docs/runs/2026-11-10-t0-journal-sandbox.md")).toContain("95 journal entries posted to T:0's shared sandbox entity");
    expect(readme).toContain("95 journal entries, debits equal to credits, matched line by line ([record](docs/runs/2026-11-10-t0-journal-sandbox.md))");
    // The anchor run: its record and the package script it names.
    expect(read("docs/runs/2026-11-13-anchor.md")).toContain("npm run verify-anchor");
    expect(readme).toContain("[record](docs/runs/2026-11-13-anchor.md)");
    expect((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts["verify-anchor"]).toBeDefined();
  });
});
