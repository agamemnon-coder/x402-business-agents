// The governance and compliance documents (docs/compliance/, 26 Nov): each in the house style (a centred header with
// the mark, one title, one bold line, badges), with an owner, a version and a review date, labelled test money and
// "adopt and adapt"; their Mermaid diagrams are types GitHub draws; the generated blocks (the dashboard, the per-framework
// tables of docs/governance.md and docs/compliance.md) are what src/compliance/controls.ts gives; every audit event the
// incident classes name is one Purser writes; and Ask Purser's AI labels, which the AI Act classification cites for
// Art. 50(1), are on the page.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blockOf, dashboardMarkdown, frameworksBlock, HONEST_LINE, statusCounts } from "../src/compliance/controls.js";

// v1.5.1: the technical documentation, the quality management outline, the literacy note, the transfers note and the
// two templates (one folder down, so their header's paths go one level further up).
const NEW = ["ai-policy.md", "ai-impact-assessment.md", "instructions-for-use.md", "incident-response.md", "exit-plans.md", "retention.md", "psd2-sca.md", "gdpr.md", "ai-act-classification.md", "third-parties.md", "README.md",
  "ai-technical-documentation.md", "qms.md", "ai-literacy.md", "transfers.md", "templates/dpa.md", "templates/ict-contract-clauses.md"]
  .map((f) => `docs/compliance/${f}`);
const up = (f: string) => "../".repeat(f.split("/").length - 2);
const read = (f: string) => readFileSync(f, "utf8");
const DIAGRAMS = /^(flowchart (LR|TB|TD|RL|BT)|sequenceDiagram|stateDiagram-v2|pie( showData)?( title .*)?|quadrantChart)\s*$/;

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "compliance") files(p, out); } else if (p.endsWith(".ts") && !/\.gen\./.test(p)) out.push(p);
  }
  return out;
}

describe("the governance and compliance documents", () => {
  for (const f of NEW) it(`${f}: the house style's header, badges that are flat, and nothing claimed`, () => {
    const md = read(f);
    expect(md.startsWith('<div align="center">\n\n')).toBe(true);
    const head = md.slice(0, md.indexOf("</div>"));
    expect(head).toContain(`<picture><source media="(prefers-color-scheme: dark)" srcset="${up(f)}assets/brand/purser-mark-dark.svg"><img src="${up(f)}assets/brand/purser-mark.svg" alt="Purser"`);
    expect(md.match(/^# /gm) ?? []).toHaveLength(1);
    expect(head).toMatch(/^\*\*[^*\n]+\*\*$/m);
    expect(head).toMatch(/\[!\[[^\]]+\]\(https:\/\/img\.shields\.io\/badge\/[^)]+\)\]\([^)]+\)/);
    for (const u of md.matchAll(/https:\/\/img\.shields\.io\/badge\/[^)\s"]+/g)) expect(u[0], f).toContain("style=flat-square");
    const rest = md.split(HONEST_LINE).join(" ");
    expect(rest, f).not.toMatch(/\b(compliant|compliance-ready|certified|certifies|certification|conforms?|conformant|guarantees?)\b/i);
  });

  for (const f of NEW.filter((x) => !/README|third-parties/.test(x))) it(`${f}: an owner, a version, a review date, and test money said`, () => {
    const md = read(f);
    expect(md).toMatch(/^## Document control$/m);
    expect(md).toMatch(/\| Owner \| Version \|/);
    expect(md).toMatch(/26 May 2027/);
    expect(md).toMatch(/Test money \/ sandbox/);
  });

  for (const f of [...NEW, "docs/governance.md", "GOVERNANCE.md"]) it(`${f}: each Mermaid block is a type GitHub draws, balanced`, () => {
    for (const m of read(f).matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)) {
      const lines = m[1]!.split("\n").filter((l) => l.trim() && !l.trim().startsWith("%%"));
      expect({ f, first: lines[0]!.trim(), known: DIAGRAMS.test(lines[0]!.trim()) }).toEqual({ f, first: lines[0]!.trim(), known: true });
      for (const l of lines) {
        const plain = l.replace(/"[^"]*"/g, '""');
        expect({ f, l, quotes: (l.match(/"/g) ?? []).length % 2 }).toEqual({ f, l, quotes: 0 });
        for (const [o, c] of [["[", "]"], ["(", ")"], ["{", "}"]] as const) expect({ f, l, [o]: plain.split(o).length - plain.split(c).length }).toEqual({ f, l, [o]: 0 });
      }
    }
  });
});

describe("the generated blocks", () => {
  it("the dashboard on docs/compliance/README.md is the map's counts", () => {
    const block = blockOf(read("docs/compliance/README.md"), "dashboard");
    expect(block).toBe(dashboardMarkdown());
    for (const c of statusCounts()) expect(block).toContain(`/badge/gap-${c.gap}-f43f5e`);
    // The palette, as classDef in the who-signs-what diagram and as the pie's colours.
    for (const colour of ["#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9"]) expect(read("docs/compliance/README.md")).toContain(colour);
  });

  it("docs/governance.md and docs/compliance.md carry the per-framework table as the map gives it", () => {
    for (const f of ["docs/governance.md", "docs/compliance.md"]) expect(blockOf(read(f), "frameworks"), f).toBe(frameworksBlock());
    expect(statusCounts().map((c) => c.short)).toEqual(["EU AI Act", "ISO/IEC 42001:2023", "SOC 2", "DORA", "PSD2 SCA", "GDPR", "eIDAS", "NIS2", "ISO/IEC 27001:2022"]);
  });
});

describe("what the documents cite", () => {
  const CODE = [...files("src"), ...files("cloud/src")].map(read).join("\n");

  it("every audit event an incident class names is one Purser's code writes", () => {
    const md = read("docs/compliance/incident-response.md");
    const table = md.slice(md.indexOf("## Severity classes"), md.indexOf("## The runbook"));
    const events = [...table.matchAll(/`([a-z_]+\.[a-z_.]+)`/g)].map((m) => m[1]!);
    expect(events.length).toBeGreaterThan(12);
    for (const e of events) expect(CODE.includes(`"${e}"`) || CODE.includes(`= "${e}"`), e).toBe(true);
  });

  it("Ask Purser's labels, which the AI Act classification cites for Art. 50(1), are on the page", () => {
    const page = read("cloud/src/ask/page.ts");
    const doc = read("docs/compliance/ai-act-classification.md");
    for (const label of ["Answered by Claude (Haiku) from Purser's docs and the demo company's records", "Answered from Purser's docs without AI", "Answered by Purser's own code"]) {
      expect(page, label).toContain(label);
      expect(doc, label).toContain(label);
    }
  });

  it("the instructions for use declare the eval records' figures as those records give them", () => {
    const md = read("docs/compliance/instructions-for-use.md");
    const evals = read("docs/agent-evals.md");
    const rows = evals.slice(evals.indexOf("| Case | Kind"), evals.indexOf("## Cheapest model")).split("\n").filter((l) => /^\| [a-z]/.test(l));
    const passed = rows.filter((l) => /\| pass/.test(l)).length;
    expect(md).toContain(`${passed} of ${rows.length} case-and-model rows passed every run`);
    expect(evals).toMatch(/\| support-outside \| attack \| claude-haiku-5-5 \| 0\/10 \|/);
    expect(md).toContain("380 hostile tool calls, 370 refused by code, 0 unsafe by the ledger verdict");
    expect(evals).toContain("380 hostile tool calls, 370 refused by code, 0 unsafe by the ledger verdict");
    expect(read("docs/evidence/redteam-api.md")).toMatch(/128 attacks: \*\*128 PASS, 0 FAIL, 0 ERROR\*\*/);
  });
});
