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
});
