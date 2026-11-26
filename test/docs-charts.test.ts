// The charts and figure badges on the Markdown pages (26 Nov 2026, the owner: "graphs", from committed records only):
// each figure is counted again here from its record, so a chart cannot drift from what it plots.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** The ✅ count per status column of docs/controls.md's control tables, and the number of controls. */
export function controlCounts(md = read("docs/controls.md")): { controls: number; yes: Record<string, number>; na: Record<string, number> } {
  const cols = ["Implemented", "Tested", "Deployed", "Independently verified"];
  const yes = Object.fromEntries(cols.map((c) => [c, 0])), na = Object.fromEntries(cols.map((c) => [c, 0]));
  let header: string[] | null = null, controls = 0;
  for (const line of md.split("\n")) {
    if (line.startsWith("| # | Control | How it works | Implemented")) { header = line.slice(1, -1).split("|").map((c) => c.trim()); continue; }
    if (!header) continue;
    if (!line.startsWith("|")) { header = null; continue; }
    if (line.startsWith("|---")) continue;
    const cells = line.trim().slice(1, -1).split(" | ").map((c) => c.trim());
    expect({ line: line.slice(0, 40), cells: cells.length }).toEqual({ line: line.slice(0, 40), cells: header.length });
    controls++;
    for (const c of cols) {
      const v = cells[header.indexOf(c)]!;
      if (v.startsWith("✅")) yes[c]!++;
      else if (v.startsWith("n/a")) na[c]!++;
      else expect({ line: line.slice(0, 40), c, mark: v.slice(0, 2) }).toEqual({ line: line.slice(0, 40), c, mark: "🟠" });
    }
  }
  return { controls, yes, na };
}

describe("the docs' charts plot their records", () => {
  it("docs/controls.md: the bar chart, its record line and the badges are the tables' own counts", () => {
    const md = read("docs/controls.md"), { controls, yes, na } = controlCounts(md);
    expect(controls).toBeGreaterThan(30);
    const bars = [yes.Implemented, yes.Tested, yes.Deployed, yes["Independently verified"]];
    expect(md).toContain(`title "Controls marked yes, of the ${controls} in the tables below"`);
    expect(md).toContain(`y-axis "Controls" 0 --> ${controls}`);
    expect(md).toContain(`bar [${bars.join(", ")}]`);
    expect(md).toContain(`of ${controls} controls, ✅ Implemented ${bars[0]}, Tested ${bars[1]}, Deployed ${bars[2]}, Independently verified ${bars[3]}; the rest 🟠, or n/a (Tested ${na.Tested}, Deployed ${na.Deployed}).`);
    for (const [label, n] of [["implemented", bars[0]], ["tested", bars[1]], ["deployed, recorded", bars[2]], ["independently verified", bars[3]]] as const)
      expect(md).toContain(`/badge/${encodeURIComponent(label).replace(/%20/g, "_")}-${n}_of_${controls}-`);
    expect(md).toContain(`/badge/controls-${controls}_in_the_tables-`);
  });

  it("docs/controls-matrix.md: who enforces, counted from the rows' Enforced by column", () => {
    const md = read("docs/controls-matrix.md");
    const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Risk")).map((l) => l.trim().slice(1, -1).split(" | ").map((c) => c.trim()));
    for (const r of rows) expect({ row: r[0]!.slice(0, 30), cells: r.length }).toEqual({ row: r[0]!.slice(0, 30), cells: 5 });
    const by = (re: RegExp) => rows.filter((r) => re.test(r[2]!)).length;
    const n = { Code: by(/\bcode\b/i), Person: by(/\b(person|people)\b/i), Chain: by(/\bchain\b/i), Airwallex: by(/\bAirwallex\b/) };
    expect(md).toContain(`title "Who enforces: rows each takes part in, of ${rows.length}"`);
    expect(md).toContain(`y-axis "Rows" 0 --> ${rows.length}`);
    expect(md).toContain(`bar [${n.Code}, ${n.Person}, ${n.Chain}, ${n.Airwallex}]`);
    expect(md).toContain(`of ${rows.length} rows, Code ${n.Code}, Person ${n.Person} (one person or two), Chain ${n.Chain}, Airwallex ${n.Airwallex}; a row can name several.`);
    expect(md).toContain(`/badge/risks-${rows.length}_%C2%B7_each_with_a_control_and_a_test-`);
  });

  it("docs/go-live.md: the items by status, counted from its table", () => {
    const md = read("docs/go-live.md");
    const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Item")).map((l) => l.trim().slice(1, -1).split(" | ").map((c) => c.trim()));
    for (const r of rows) expect({ item: r[0], cells: r.length }).toEqual({ item: r[0], cells: 4 });
    const n = (s: string) => rows.filter((r) => r[1] === s).length;
    expect(n("Done") + n("Done (not exercised)") + n("Partly") + n("Open")).toBe(rows.length);
    expect(md).toContain(`  "Partly" : ${n("Partly")}\n  "Done" : ${n("Done")}\n  "Open" : ${n("Open")}\n  "Done, not exercised" : ${n("Done (not exercised)")}\n`);
    expect(md).toContain(`${rows.length} items; Done ${n("Done")}, Done (not exercised) ${n("Done (not exercised)")}, Partly ${n("Partly")}, Open ${n("Open")}.`);
    expect(md).toContain(`/badge/items-${rows.length}_%C2%B7_${n("Done") + n("Done (not exercised)")}_done%2C_${n("Partly")}_partly%2C_${n("Open")}_open-`);
  });

  it("docs/connections.md: the connections by label, counted from its table", () => {
    const md = read("docs/connections.md"), lines = md.split("\n");
    const at = lines.indexOf("| Connection | Label | Direction | Where |");
    const rows = lines.slice(at + 2, lines.findIndex((l, i) => i > at + 1 && !l.startsWith("|"))).map((l) => l.split(" | ")[1]!);
    const n = (s: string) => rows.filter((r) => r === s).length;
    expect(n("live") + n("format export") + n("built, not tested live") + n("built, run once in a sandbox")).toBe(rows.length);
    for (const s of ["live", "format export", "built, not tested live", "built, run once in a sandbox"]) expect(md).toContain(`  "${s}" : ${n(s)}\n`);
    expect(md).toContain(`/badge/connections-${rows.length}_%C2%B7_${n("live")}_live-`);
  });

  it("docs/connect-claude.md: how each client was checked, counted from its table", () => {
    const md = read("docs/connect-claude.md"), lines = md.split("\n");
    const at = lines.indexOf("| Client | How it was checked (13 Nov 2026) |");
    const rows = lines.slice(at + 2, lines.findIndex((l, i) => i > at + 1 && !l.startsWith("|"))).map((l) => l.split(" | ")[1]!);
    const run = rows.filter((r) => r.startsWith("**Run**")).length, docs = rows.filter((r) => r.startsWith("From ")).length;
    expect(run + docs).toBe(rows.length);
    expect(md).toContain(`  "From its own documentation" : ${docs}\n  "Run" : ${run}\n`);
    expect(md).toContain(`${rows.length} clients; ${run} run (one of them, the Claude iOS app, against a deployed cloud), ${docs} from their own documentation.`);
  });

  it("docs/cards-and-clearing.md: the card limits chart is the card table's", () => {
    const md = read("docs/cards-and-clearing.md");
    const rows = md.split("\n").filter((l) => /^\| (sourcing|support|treasury) \| virtual Visa \|/.test(l)).map((l) => l.slice(1, -1).split("|").map((c) => c.trim()));
    expect(rows.map((r) => r[0])).toEqual(["sourcing", "support", "treasury"]);
    const eur = (s: string) => Number(/^([\d.]+) EUR$/.exec(s)![1]);
    const perTx = rows.map((r) => eur(r[2]!)), monthly = rows.map((r) => eur(r[3]!));
    expect(md).toContain(`  bar [${monthly.join(", ")}]\n  bar [${perTx.join(", ")}]\n`);
    expect(md).toContain(`per month ${monthly.map((n) => n.toFixed(2)).join(", ").replace(/, ([^,]+)$/, " and $1")} EUR; per purchase ${perTx.map((n) => n.toFixed(2)).join(", ").replace(/, ([^,]+)$/, " and $1")} EUR`);
  });

  it("docs/kit11.md: the mandates chart is the table's first row", () => {
    const md = read("docs/kit11.md");
    const m = /a mandate each for Sourcing \(0\.03 a purchase, ([\d.]+) in all\), Support \(([\d.]+)\) and Treasury \(([\d.]+)\)/.exec(md)!;
    const [s, u, t] = [m[1]!, m[2]!, m[3]!];
    expect(md).toContain(`  bar [${[s, u, t].map(Number).join(", ")}]\n`);
    expect(md).toContain(`Sourcing ${s} in all (0.03 a purchase), Support ${u}, Treasury ${t}.`);
  });

  it("docs/idea-vs-build.md: the promises badge counts the promise rows and their marks", () => {
    const md = read("docs/idea-vs-build.md");
    const rows = md.split("\n").filter((l) => /^\| (\*\*[^*]+\*\* )?"/.test(l)).map((l) => l.trim().slice(1, -1).split(" | ").map((c) => c.trim()));
    for (const r of rows) expect({ row: r[0]!.slice(0, 30), cells: r.length }).toEqual({ row: r[0]!.slice(0, 30), cells: 3 });
    const built = rows.filter((r) => r[1]!.startsWith("✅")).length;
    expect(md).toContain(`/badge/promises_in_the_idea-${rows.length}_%C2%B7_${built}_built-`);
  });

  it("docs/assurance.md: the invariants badge and diagram count the table's rows", () => {
    const md = read("docs/assurance.md");
    const rows = md.split("\n").filter((l) => l.startsWith("| **"));
    expect(md).toContain(`/badge/money_invariants-${rows.length}_%C2%B7_code%2C_tests%2C_CI_job%2C_record-`);
    expect(md).toContain(`  G --> I${rows.length}[`);
    expect(md).not.toContain(`  G --> I${rows.length + 1}[`);
  });

  it("docs/learning.md: the precedent chart is the eval records'", () => {
    const md = read("docs/learning.md");
    type S = { summary: { without: { cases: number; right_after: number }; with: { cases: number; right_after: number } } };
    const one = JSON.parse(read("docs/evals/precedent.json")) as S, two = JSON.parse(read("docs/evals/precedent-run2-wording.json")) as S;
    const bars = [one.summary.without.right_after, one.summary.with.right_after, two.summary.with.right_after];
    expect(md).toContain(`of ${one.summary.without.cases} cases"`);
    expect(md).toContain(`  bar [${bars.join(", ")}]\n`);
    expect(md).toContain(`\`summary.without.right_after\` ${bars[0]}, \`summary.with.right_after\` ${bars[1]} and, reworded, ${bars[2]}.`);
    expect(md).toContain(`/badge/precedent_eval%2C_14_Nov-${bars[0]}_%E2%86%92_${bars[1]}_of_${one.summary.with.cases}_%C2%B7_no_gain-`);
  });

  it("docs/finance-value.md: the worst-case chart is the table's", () => {
    const md = read("docs/finance-value.md");
    const row = (label: string) => /^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/.exec(md.split("\n").find((l) => l.startsWith(`| ${label} |`))!)!;
    const wrong = row("Wrong payments"), past = row("Paid past the CFO");
    expect(md).toContain(`  bar [${[wrong[2], wrong[3], past[2], past[3]].map((s) => Number(s!.trim())).join(", ")}]\n`);
    expect(md).toContain(`wrong payments ${wrong[2]!.trim()} and ${wrong[3]!.trim()}, paid past the CFO ${past[2]!.trim()} and ${past[3]!.trim()}.`);
    expect(md).toContain(`/badge/wrong_payments%2C_worst_case-${wrong[2]!.trim()}_%E2%86%92_${wrong[3]!.trim()}-`);
  });

  it("docs/security/openssf-gold.md: the criteria chart counts the criteria headings", () => {
    const md = read("docs/security/openssf-gold.md");
    const crit = [...md.matchAll(/^#### `([a-z0-9_A-Z]+)` \((MUST|SHOULD|SUGGESTED)\): \*\*(Met|Unmet|N\/A)\*\*/gm)].map((m) => ({ id: m[1]!, status: m[3]! }));
    const n = (s: string) => crit.filter((c) => c.status === s).length;
    const unmet = crit.filter((c) => c.status === "Unmet").map((c) => `\`${c.id}\``);
    expect(crit.length).toBe(23);
    expect(md).toContain(`  "Met" : ${n("Met")}\n  "Unmet" : ${n("Unmet")}\n`);
    expect(md).toContain(`${n("Met")} Met, ${n("Unmet")} Unmet (${unmet.join(", ")}), ${n("N/A")} N/A.`);
    expect(md).toContain(`/badge/gold_criteria-${n("Met")}_Met_%C2%B7_${n("Unmet")}_Unmet_%C2%B7_${n("N/A")}_N%2FA-`);
  });

  it("docs/security/SECURITY-MAPPING.md: the status chart counts the three framework tables, and the badge the controls", () => {
    const md = read("docs/security/SECURITY-MAPPING.md");
    const status: string[] = [];
    let section = "";
    for (const l of md.split("\n")) {
      if (l.startsWith("## ")) section = l;
      if (!/^## (NIST|OWASP|EU DORA)/.test(section) || !l.startsWith("| ") || /^\| (Practice|Risk|Area) \|/.test(l)) continue;
      status.push(l.trim().slice(1, -1).split(" | ").at(-1)!.trim());
    }
    const n = { mapped: status.filter((s) => s.startsWith("mapped")).length, partial: status.filter((s) => s.startsWith("partial")).length, gap: status.filter((s) => s.startsWith("**gap**")).length, na: status.filter((s) => s === "not applicable").length };
    expect(n.mapped + n.partial + n.gap + n.na).toBe(status.length);
    expect(md).toContain(`  "mapped" : ${n.mapped}\n  "partial" : ${n.partial}\n  "gap" : ${n.gap}\n  "not applicable" : ${n.na}\n`);
    expect(md).toContain(`${status.length} rows; mapped ${n.mapped}, partial ${n.partial}, gap ${n.gap}, not applicable ${n.na}.`);
    expect(md).toContain(`/badge/controls_mapped-${(md.match(/^\| C\d+ \|/gm) ?? []).length}-`);
  });

  it("docs/security/agent-permissions.md: the tools-per-agent chart counts the tables' Kind column", () => {
    const md = read("docs/security/agent-permissions.md");
    const per = new Map<string, string[]>();
    let agent = "";
    for (const l of md.split("\n")) {
      if (l.startsWith("## ")) agent = l.slice(3).trim();
      if (agent && l.startsWith("| `")) per.set(agent, [...(per.get(agent) ?? []), l.split(" | ")[1]!.trim()]);
    }
    const agents = [...per.keys()], total = agents.map((a) => per.get(a)!.length), money = agents.map((a) => per.get(a)!.filter((k) => k === "pay" || k === "action").length);
    expect(md).toContain(`  x-axis [${agents.map((a) => `"${a}"`).join(", ")}]\n`);
    expect(md).toContain(`  bar [${total.join(", ")}]\n  bar [${money.join(", ")}]\n`);
    expect(md).toContain(`${agents[0]} ${total[0]} (${money[0]} pay or action), ${agents.slice(1).map((a, i) => `${a} ${total[i + 1]} (${money[i + 1]})`).join(", ")}.`);
  });

  it("docs/hardening.md: the findings by severity, counted from its two findings tables", () => {
    const md = read("docs/hardening.md");
    const rows = md.split("\n").filter((l) => /^\| (HF|R)\d+ \|/.test(l)).map((l) => l.trim().slice(1, -1).split(" | ").map((c) => c.trim()));
    for (const r of rows) expect({ id: r[0], cells: r.length }).toEqual({ id: r[0], cells: 4 });
    const sev = (s: string) => rows.filter((r) => r[2]!.split(" ")[0] === s).length;
    const fixed = rows.filter((r) => r[3]!.startsWith("fixed")).length, accepted = rows.filter((r) => r[3]!.startsWith("checked, accepted")).map((r) => r[0]);
    expect(sev("low") + sev("medium") + sev("info") + sev("high")).toBe(rows.length);
    for (const s of ["low", "medium", "info", "high"]) expect(md).toContain(`  "${s}" : ${sev(s)}\n`);
    expect(md).toContain(`${rows.length} findings, HF1 to HF14 and R1 to R6; ${fixed} fixed, ${accepted.length} checked and accepted (${accepted.join(", ")}).`);
    expect(md).toContain(`/badge/findings-${rows.length}_%C2%B7_${fixed}_fixed%2C_${accepted.length}_accepted-`);
    expect(md).toContain(`/badge/high-${sev("high")}-`);
    expect(md).toContain(`/badge/medium-${sev("medium")}-`);
  });
});
