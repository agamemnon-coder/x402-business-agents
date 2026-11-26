// The control map (src/compliance/controls.ts, rendered to docs/compliance/controls.md): every framework requirement
// names Purser controls that exist, every control's evidence names audit events Purser's code writes and tables it
// creates, every status is honest (a requirement with evidence in the ledger has a control that leaves records; a gap
// says what is missing), and the wording maps and gives evidence; it never claims compliance or a certificate.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROLS, FRAMEWORKS, HONEST_LINE, REQUIREMENTS, STATUSES, controlsMarkdown } from "../src/compliance/controls.js";
import { schemaTables } from "./support/schemaTables.js";

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out); else if (p.endsWith(".ts") && !/\.gen\./.test(p)) out.push(p);
  }
  return out;
}
/** Purser's code, without the control map itself (an event it names must be written somewhere else). */
const CODE = files("src").filter((f) => !f.startsWith(join("src", "compliance"))).map((f) => readFileSync(f, "utf8")).join("\n");
const byId = new Map(CONTROLS.map((c) => [c.id, c]));

describe("the control map", () => {
  it("covers the four frameworks, each requirement once, each with an id, words and a status", () => {
    expect(FRAMEWORKS.map((f) => f.id)).toEqual(["eu-ai-act", "iso-42001", "soc2", "dora"]);
    expect([...STATUSES]).toEqual(["evidence-in-ledger", "documented", "gap"]);
    const keys = REQUIREMENTS.map((r) => `${r.framework} ${r.clause} ${r.scope ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of REQUIREMENTS) {
      expect(FRAMEWORKS.map((f) => f.id), r.clause).toContain(r.framework);
      expect(r.requirement.length, r.clause).toBeGreaterThan(20);
      expect(STATUSES, r.clause).toContain(r.status);
    }
    // The clauses asked for, by their exact ids.
    const clauses = (f: string) => REQUIREMENTS.filter((r) => r.framework === f).map((r) => r.clause);
    expect(clauses("eu-ai-act")).toEqual(expect.arrayContaining(["Art. 9(2)", "Art. 12(1)", "Art. 12(2)", "Art. 13(1)", "Art. 14(4)(d)", "Art. 14(4)(e)", "Art. 15(1)", "Art. 15(5)"]));
    expect(clauses("iso-42001")).toEqual(expect.arrayContaining(["A.6.2.8", "A.9.2", "A.5.2", "A.10.3"]));
    expect(clauses("soc2")).toEqual(expect.arrayContaining(["CC6.1", "CC6.2", "CC6.3", "CC7.2", "CC7.3", "CC7.4", "CC8.1"]));
    expect(clauses("dora")).toEqual(expect.arrayContaining(["Art. 9(4)(c)", "Art. 10(1)", "Art. 17(2)", "Art. 18(1)", "Art. 28(3)"]));
    for (const r of REQUIREMENTS) {
      if (r.framework === "eu-ai-act" || r.framework === "dora") expect(r.clause, r.clause).toMatch(/^Art\. \d+(\(\d+\))?(\([a-z]\))?$/);
      if (r.framework === "iso-42001") expect(r.clause).toMatch(/^A\.\d+\.\d+(\.\d+)?$/);
      if (r.framework === "soc2") expect(r.clause).toMatch(/^CC\d\.\d$/);
    }
  });

  it("names controls that exist, and uses every control", () => {
    expect(new Set(CONTROLS.map((c) => c.id)).size).toBe(CONTROLS.length);
    for (const r of REQUIREMENTS) for (const id of r.controls) expect(byId.has(id), `${r.framework} ${r.clause}: ${id}`).toBe(true);
    const used = new Set(REQUIREMENTS.flatMap((r) => r.controls));
    for (const c of CONTROLS) expect(used.has(c.id), `${c.id} is mapped to no requirement`).toBe(true);
  });

  it("is honest about each status", () => {
    for (const r of REQUIREMENTS) {
      const controls = r.controls.map((id) => byId.get(id)!);
      if (r.status === "evidence-in-ledger") expect(controls.some((c) => c.evidence !== null), `${r.framework} ${r.clause} has no control that leaves records`).toBe(true);
      if (r.status === "documented") expect(controls.length, `${r.framework} ${r.clause}`).toBeGreaterThan(0);
      if (r.status === "gap") expect(r.gap ?? "", `${r.framework} ${r.clause} says no gap`).toMatch(/\w{4,}/);
    }
    // Gaps are shown, not hidden: each framework has at least one.
    for (const f of FRAMEWORKS) expect(REQUIREMENTS.some((r) => r.framework === f.id && r.status === "gap"), f.id).toBe(true);
  });

  it("derives evidence only from audit events Purser's code writes and tables it creates", () => {
    const tables = schemaTables();
    for (const c of CONTROLS) {
      for (const p of [...c.code, ...c.docs]) expect(existsSync(p), `${c.id}: ${p}`).toBe(true);
      if (!c.evidence) { expect(c.docs.length + c.code.length, c.id).toBeGreaterThan(0); continue; }
      const e = c.evidence;
      expect(e.events.length + e.patterns.length + e.scoped.length + e.tables.length + (e.chain ? 1 : 0), c.id).toBeGreaterThan(0);
      for (const ev of [...e.events, ...e.scoped.map((s) => s.event)]) expect(CODE.includes(`"${ev}"`), `${c.id}: the event ${ev} is written nowhere in src`).toBe(true);
      for (const p of [...e.patterns, ...e.scoped.map((s) => s.subject)]) expect(() => new RegExp(p), `${c.id}: ${p}`).not.toThrow();
      for (const t of e.tables) {
        const known = tables.get(t.table);
        expect(known, `${c.id}: the table ${t.table} is created nowhere`).toBeDefined();
        for (const col of [t.at, ...t.cite]) expect(known!.columns.has(col), `${c.id}: ${t.table}.${col}`).toBe(true);
      }
    }
  });

  it("cites no column that holds a secret, a card number or a person's name", () => {
    for (const c of CONTROLS) for (const t of c.evidence?.tables ?? []) for (const col of t.cite) {
      expect(col, `${c.id}: ${t.table}.${col}`).not.toMatch(/secret|token_sha256|key_sha256|private|pan|card_number|cvv|label|person|approver|email|name|iban|amount|cents|payload|json|note|reason/);
    }
  });

  it("is rendered to docs/compliance/controls.md (npm run compliance:controls)", () => {
    expect(readFileSync("docs/compliance/controls.md", "utf8")).toBe(controlsMarkdown());
  });
});

describe("the wording", () => {
  const DOCS = ["docs/compliance/README.md", "docs/compliance/controls.md"];

  it("maps and gives evidence; it never claims compliance or a certificate", () => {
    expect(HONEST_LINE).toMatch(/independent auditor/);
    expect(HONEST_LINE).toMatch(/test money/);
    expect(HONEST_LINE).toMatch(/sandbox/);
    const texts = [...DOCS.map((f) => [f, readFileSync(f, "utf8")] as const), ["src/compliance/controls.ts", readFileSync("src/compliance/controls.ts", "utf8")] as const];
    for (const [f, text] of texts) {
      if (f.endsWith(".md")) expect(text, f).toContain(HONEST_LINE);
      // The line itself is the one place the words may stand (in the source, its definition).
      const rest = text.split(HONEST_LINE).join(" ").replace(/export const HONEST_LINE = [^;]*;/, "");
      expect(rest, f).not.toMatch(/\b(compliant|compliance-ready|certified|certifies|certificate|certification|conforms?|conformant|guarantees?)\b/i);
    }
  });

  it("says how to run and verify it, and is linked from the compliance and governance pages", () => {
    const readme = readFileSync("docs/compliance/README.md", "utf8");
    for (const cmd of ["npm run compliance-evidence -- --from", "npm run verify-compliance-evidence --", "npm run audit-pack -- --from", "--audit-pack", "--trust"]) expect(readme, cmd).toContain(cmd);
    expect(readme).toContain("(controls.md)");
    expect(readFileSync("docs/compliance.md", "utf8")).toContain("(compliance/README.md)");
    expect(readFileSync("docs/governance.md", "utf8")).toContain("(compliance/README.md)");
    const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["compliance-evidence"]).toBe("tsx src/cli/complianceEvidence.ts");
    expect(scripts["verify-compliance-evidence"]).toBe("tsx src/cli/verifyComplianceEvidence.ts");
    expect(scripts["compliance:controls"]).toBe("tsx src/cli/complianceControls.ts");
  });
});
