// v1.5.1, the documents that close or narrow the control map's gaps (PC-37, PC-38): the AI technical documentation
// after EU AI Act Annex IV, the quality management outline, the AI literacy note, the DORA Art. 30 clause checklist, the
// GDPR Art. 28 data processing agreement template and the transfers note. Each is held here to what it is drawn from:
// the model ids to the code, every path it cites to a file, the per-provider tables to the third-party register and the
// record of processing, the figures to the instructions for use; and each template says it is one, signed by nobody.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blockOf, REQUIREMENTS } from "../src/compliance/controls.js";
import { ictProvidersBlock, personalDataRecipients, subprocessorsBlock, transferClass, transfersBlock } from "../src/compliance/templates.js";
import { loadRegister } from "../src/compliance/thirdParties.js";

const read = (f: string) => readFileSync(f, "utf8");
const TECH = "docs/compliance/ai-technical-documentation.md", QMS = "docs/compliance/qms.md", LIT = "docs/compliance/ai-literacy.md";
const ICT = "docs/compliance/templates/ict-contract-clauses.md", DPA = "docs/compliance/templates/dpa.md", TRANSFERS = "docs/compliance/transfers.md";
const row = (framework: string, clause: string) => REQUIREMENTS.find((r) => r.framework === framework && r.clause === clause)!;

describe("the generated per-provider tables", () => {
  it("are what the register and the record of processing give (npm run compliance:controls)", () => {
    expect(blockOf(read(ICT), "ict-providers")).toBe(ictProvidersBlock());
    expect(blockOf(read(DPA), "subprocessors")).toBe(subprocessorsBlock());
    expect(blockOf(read(TRANSFERS), "transfers")).toBe(transfersBlock());
  });

  it("name every provider of the register, every recipient of personal data, and each one's contract as the register has it", () => {
    const r = loadRegister(), ict = blockOf(read(ICT), "ict-providers"), sub = blockOf(read(DPA), "subprocessors"), tr = blockOf(read(TRANSFERS), "transfers");
    for (const p of r.providers) expect(ict, p.id).toContain(`| **${p.name}** | ${p.criticality} |`);
    for (const p of r.providers) expect(ict, p.id).toContain(p.contract);
    const recipients = personalDataRecipients(r);
    expect(recipients.length).toBeGreaterThan(10);
    for (const p of recipients) { expect(sub, p.id).toContain(`| **${p.name}** |`); expect(tr, p.id).toContain(`| **${p.name}** |`); }
    // The three providers the register places in the United States are outside the EU, and no mechanism is recorded.
    expect(recipients.filter((p) => transferClass(p) === "third-country").map((p) => p.id).sort()).toEqual(["anthropic", "resend", "twilio"]);
    for (const line of tr.split("\n").filter((l) => l.startsWith("| **"))) expect(line.endsWith("| none |"), line).toBe(true);
  });

  it("claim no contract while the register records none, and DORA Art. 30(1) and GDPR Art. 44 stay gaps", () => {
    const r = loadRegister();
    // When a provider's contract stops being "none…", this test is the reminder to revisit both rows and the templates.
    for (const p of r.providers) expect(p.contract, p.id).toMatch(/^none\b/);
    expect(row("dora", "Art. 30(1)").status).toBe("gap");
    expect(row("gdpr", "Art. 44").status).toBe("gap");
  });
});

describe("the templates", () => {
  it("say they are templates, not legal advice, not reviewed by counsel, and signed by nobody", () => {
    for (const f of [ICT, DPA]) {
      const md = read(f);
      expect(md, f).toContain("Template, not legal advice; not reviewed by counsel.");
      expect(md, f).toMatch(/\| No \|/);
    }
    expect(read(DPA)).toContain("| With nobody |");
    expect(read(ICT)).toContain("**No contract exists today.**");
    expect(read(TRANSFERS)).toContain("Not legal advice; not reviewed by counsel.");
  });

  it("the clause checklist has every clause of DORA Art. 30(1), (2)(a) to (i) and (3)(a) to (f)", () => {
    const md = read(ICT);
    expect(md).toMatch(/^\| 30\(1\) \|/m);
    for (const x of "abcdefghi") expect(md, `30(2)(${x})`).toMatch(new RegExp(`^\\| 30\\(2\\)\\(${x}\\) \\|`, "m"));
    for (const x of "abcdef") expect(md, `30(3)(${x})`).toMatch(new RegExp(`^\\| 30\\(3\\)\\(${x}\\) \\|`, "m"));
  });

  it("the data processing agreement covers each item of GDPR Art. 28(3), and its routes are Purser Cloud's", () => {
    const md = read(DPA);
    for (const x of "abcefgh") expect(md, `28(3)(${x})`).toMatch(new RegExp(`^\\| 28\\(3\\)\\(${x}\\) \\|`, "m"));
    expect(md).toMatch(/^\| 28\(2\), \(4\) and 28\(3\)\(d\) \|/m);
    const routes = read("cloud/src/privacy.ts") + read("cloud/src/exports.ts") + read("cloud/src/app.ts");
    for (const route of ["/v1/me", "/v1/export/staged", "/v1/offboarding", "/erase"]) { expect(md, route).toContain(route); expect(routes, route).toContain(route); }
  });
});

describe("the AI technical documentation, the quality management outline and the literacy note", () => {
  it("name the model each role uses as the code sets it", () => {
    const md = read(TECH);
    const constant = (file: string, re: RegExp) => { const m = re.exec(read(file)); expect(m, `${file} ${re}`).not.toBeNull(); return m![1]!; };
    const rows: [string, string, RegExp][] = [
      ["MODELS.classify", "src/claude/reader.ts", /classify: "([^"]+)"/],
      ["MODELS.act", "src/claude/reader.ts", /act: "([^"]+)"/],
      ["MODELS.review", "src/claude/reader.ts", /review: "([^"]+)"/],
      ["TIMING_MODEL", "src/agents/timingCore.ts", /TIMING_MODEL = "([^"]+)"/],
      ["SOURCING_MODEL", "src/autonomy/sourcingCore.ts", /SOURCING_MODEL = "([^"]+)"/],
      ["NEGOTIATE_MODEL", "src/negotiate/claude.ts", /NEGOTIATE_MODEL = "([^"]+)"/],
      ["ASK_MODEL", "cloud/src/ask/model.ts", /ASK_MODEL = "([^"]+)"/],
    ];
    for (const [name, file, re] of rows) {
      const line = md.split("\n").find((l) => l.includes(`(\`${name}\`)`));
      expect(line, name).toBeDefined();
      expect(line, name).toContain(`\`${constant(file, re)}\``);
      expect(line, name).toContain(`\`${file}\``);
    }
  });

  it("cite only files that exist", () => {
    for (const f of [TECH, QMS, LIT, ICT, DPA, TRANSFERS]) {
      const cited = [...read(f).matchAll(/`((?:src|cloud|docs|test|worker|\.github)\/[^`\s]+)`/g)].map((m) => m[1]!.replace(/\/$/, ""));
      expect(cited.length, f).toBeGreaterThan(f === LIT ? -1 : 0);
      for (const p of cited) expect(existsSync(p), `${f}: ${p}`).toBe(true);
    }
  });

  it("follow Annex IV's nine sections and Art. 17(1)(a) to (m)", () => {
    const tech = read(TECH);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(tech, `Annex IV ${n}`).toMatch(new RegExp(`^## ${n}\\. `, "m"));
    for (const x of "abcdefgh") expect(tech, `Annex IV 1(${x})`).toMatch(new RegExp(`^\\| \\(${x}\\) `, "m"));
    for (const x of "abcdefgh") expect(tech, `Annex IV 2(${x})`).toMatch(new RegExp(`^### \\(${x}\\) `, "m"));
    const qms = read(QMS);
    for (const x of "abcdefghijklm") expect(qms, `Art. 17(1)(${x})`).toMatch(new RegExp(`^\\| \\(${x}\\) \\|`, "m"));
  });

  it("the literacy note quotes the figures the instructions for use declare, and records no reader it does not have", () => {
    const lit = read(LIT), ifu = read("docs/compliance/instructions-for-use.md");
    for (const [inLit, inIfu] of [["68.6% of the time on Haiku and 91.4% on", "VAT code 68.6% (haiku), 91.4% (sonnet)"], ["`support-outside` attack case\n  in all 10 runs", "failed `support-outside` 0 of 10"]]) {
      expect(lit).toContain(inLit);
      expect(ifu).toContain(inIfu);
    }
    expect(lit).toContain("| None recorded yet | | | |");
  });
});

describe("the rows they move", () => {
  it("documented, pointing at the new evidence, with what is still missing said", () => {
    for (const [f, c] of [["eu-ai-act", "Art. 4"], ["eu-ai-act", "Art. 11(1)"], ["eu-ai-act", "Art. 17(1)"], ["gdpr", "Art. 28"]] as const) {
      const r = row(f, c);
      expect(r.status, `${f} ${c}`).toBe("documented");
      expect(r.controls.some((id) => id === "PC-37" || id === "PC-38"), `${f} ${c}`).toBe(true);
      expect((r.gap ?? "").length, `${f} ${c}`).toBeGreaterThan(40);
    }
    // Training needs someone trained: the material alone leaves these gaps open.
    for (const [f, c] of [["iso-42001", "A.4.6"], ["nis2", "Art. 21(2)(g)"], ["iso-27001", "A.6.3"]] as const) expect(row(f, c).status, `${f} ${c}`).toBe("gap");
  });
});
