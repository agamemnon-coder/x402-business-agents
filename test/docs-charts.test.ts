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
