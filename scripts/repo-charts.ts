// The README's charts, as SVG files drawn from the records (nothing typed by hand):
//   - live runs per rail: the completed runs in docs/runs/README.md (its table is generated from the run records);
//   - the main run of 3 November: Claude's decisions per agent, with their cost, from docs/demo/main-run.json;
//   - the main run's refusals by kind, from the same record;
//   - tests over time: the README's own "N tests in M files" line, at each commit that changed it (git history).
//   npm run charts            writes docs/assets/charts/*.svg
// Each SVG follows the viewer's light or dark mode. test/repo-charts.test.ts redraws the record-based charts and
// compares them with the committed files; the git-history chart needs the full history, so CI only checks it exists.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
export const CHART_DIR = join(ROOT, "docs/assets/charts");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const STYLE = `<style>
  .bg{fill:#ffffff}.t{fill:#1f2328;font:600 15px system-ui,-apple-system,Segoe UI,sans-serif}.l{fill:#1f2328;font:13px system-ui,-apple-system,Segoe UI,sans-serif}
  .s{fill:#59636e;font:12px system-ui,-apple-system,Segoe UI,sans-serif}.a{fill:#0969da}.b{fill:#bf8700}.g{stroke:#d1d9e0}.ln{stroke:#0969da;fill:none;stroke-width:2.5}
  @media (prefers-color-scheme: dark){.bg{fill:#0d1117}.t,.l{fill:#e6edf3}.s{fill:#9198a1}.a{fill:#4493f8}.b{fill:#d29922}.g{stroke:#3d444d}.ln{stroke:#4493f8}}
</style>`;
const svg = (w: number, h: number, title: string, body: string, note: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">\n${STYLE}\n` +
  `<rect class="bg" width="${w}" height="${h}" rx="8"/>\n<text class="t" x="20" y="30">${esc(title)}</text>\n${body}\n` +
  `<text class="s" x="20" y="${h - 14}">${esc(note)}</text>\n</svg>\n`;

/** A horizontal bar chart: one bar per row, its value at the end; an optional second bar stacked after the first. */
export function bars(title: string, rows: { label: string; value: number; extra?: number; suffix?: string }[], note: string, legend?: [string, string]): string {
  const w = 720, top = legend ? 62 : 48, rowH = 30, h = top + rows.length * rowH + 40, x0 = 260, max = Math.max(1, ...rows.map((r) => r.value + (r.extra ?? 0))), span = w - x0 - 170;
  const body = rows.map((r, i) => {
    const y = top + i * rowH, a = (r.value / max) * span, b = ((r.extra ?? 0) / max) * span;
    return `<text class="l" x="20" y="${y + 18}">${esc(r.label)}</text>` +
      `<rect class="a" x="${x0}" y="${y + 5}" width="${a.toFixed(1)}" height="18" rx="3"/>` +
      (r.extra ? `<rect class="b" x="${(x0 + a).toFixed(1)}" y="${y + 5}" width="${b.toFixed(1)}" height="18" rx="3"/>` : "") +
      `<text class="l" x="${(x0 + a + b + 8).toFixed(1)}" y="${y + 18}">${r.value + (r.extra ?? 0)}${r.suffix ? esc(r.suffix) : ""}</text>`;
  }).join("\n");
  const leg = legend ? `<rect class="a" x="20" y="40" width="12" height="12" rx="2"/><text class="s" x="38" y="50">${esc(legend[0])}</text><rect class="b" x="200" y="40" width="12" height="12" rx="2"/><text class="s" x="218" y="50">${esc(legend[1])}</text>` : "";
  return svg(w, h, title, leg + body, note);
}

/** A line chart of (date, value) points, one label per point at the start, the end and the largest jump. */
export function line(title: string, pts: { date: string; value: number }[], note: string): string {
  const w = 720, h = 300, x0 = 60, y0 = 240, x1 = w - 30, y1 = 55;
  const max = Math.max(1, ...pts.map((p) => p.value));
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const tMin = t(pts[0]!.date), tMax = Math.max(tMin + 86_400_000, t(pts.at(-1)!.date));
  const X = (d: string) => x0 + ((t(d) - tMin) / (tMax - tMin)) * (x1 - x0), Y = (v: number) => y0 - (v / max) * (y0 - y1);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ");
  const grid = [0, 0.5, 1].map((f) => `<line class="g" x1="${x0}" x2="${x1}" y1="${Y(max * f).toFixed(1)}" y2="${Y(max * f).toFixed(1)}"/><text class="s" x="${x0 - 8}" y="${(Y(max * f) + 4).toFixed(1)}" text-anchor="end">${Math.round(max * f)}</text>`).join("\n");
  const label = (p: { date: string; value: number }, anchor: string) => `<text class="l" x="${X(p.date).toFixed(1)}" y="${(Y(p.value) - 8).toFixed(1)}" text-anchor="${anchor}">${p.value} (${p.date.slice(5)})</text>`;
  const axis = `<text class="s" x="${x0}" y="${y0 + 20}">${pts[0]!.date}</text><text class="s" x="${x1}" y="${y0 + 20}" text-anchor="end">${pts.at(-1)!.date}</text>`;
  return svg(w, h, title, `${grid}\n<path class="ln" d="${path}"/>\n${label(pts[0]!, "start")}\n${label(pts.at(-1)!, "end")}\n${axis}`, note);
}

const RAILS: [string, RegExp][] = [["Airwallex sandbox", /airwallex/i], ["Metal testnet", /metal/i], ["Claude (live calls)", /claude/i], ["Visa (Airi, TAP)", /airi|visa|tap/i], ["T:0 sandbox", /t:0/i], ["Moneybird sandbox", /moneybird/i]];

/** The completed runs in docs/runs/README.md, counted per rail named in their Rails column. */
export function runsPerRail(readme: string): { label: string; value: number }[] {
  const table = readme.slice(readme.indexOf("| Date | Run | Rails |"), readme.indexOf("\n\n", readme.indexOf("| Date | Run | Rails |")));
  const rails = table.split("\n").filter((l) => /^\| \d/.test(l)).map((l) => l.split("|")[3] ?? "");
  return RAILS.map(([label, re]) => ({ label, value: rails.filter((r) => re.test(r)).length })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
}

interface Stat { agent: string; decisions: number; by_claude: number; fallback: number; cost_usd_micros: number; models: string[] }
interface Refusal { agent: string; what: string }
export function mainRun(record: { snapshot: { agent_stats: Stat[]; refusals: Refusal[] } }) {
  const stats = record.snapshot.agent_stats;
  const claude = stats.map((s) => ({ label: `${s.agent[0]!.toUpperCase()}${s.agent.slice(1)} (${s.models.map((m) => m.replace(/^claude-/, "").replace(/-\d.*$/, "")).join(", ")})`, value: s.by_claude, extra: s.fallback, suffix: ` · USD ${(s.cost_usd_micros / 1e6).toFixed(4)}` }));
  const kinds = new Map<string, number>();
  for (const r of record.snapshot.refusals) { const k = `${r.what} (${r.agent})`; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  const refusals = [...kinds].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const total = { decisions: stats.reduce((n, s) => n + s.decisions, 0), byClaude: stats.reduce((n, s) => n + s.by_claude, 0), costMicros: stats.reduce((n, s) => n + s.cost_usd_micros, 0) };
  return { claude, refusals, total };
}

/** The charts drawn from the committed records alone (no git history): name to SVG. */
export function recordCharts(root = ROOT): Record<string, string> {
  const runs = runsPerRail(readFileSync(join(root, "docs/runs/README.md"), "utf8"));
  const m = mainRun(JSON.parse(readFileSync(join(root, "docs/demo/main-run.json"), "utf8")));
  return {
    "live-runs-per-rail.svg": bars("Live runs per rail (sandbox and testnet, test money)", runs,
      "From docs/runs/README.md: the completed runs, each counted once per rail it used. Partial runs are not counted."),
    "main-run-claude.svg": bars(`Main run, 3 Nov: ${m.total.byClaude} of ${m.total.decisions} decisions by Claude, USD ${(m.total.costMicros / 1e6).toFixed(4)} in all`, m.claude,
      "From docs/demo/main-run.json, agent_stats: decisions per agent, and Claude's cost per agent.", ["by Claude", "fallback to the plain parser"]),
    "main-run-refusals.svg": bars("Main run, 3 Nov: what was refused", m.refusals,
      "From docs/demo/main-run.json, refusals: each kind with the actor the record names. Test money."),
  };
}

/** The README's test line ("N tests in M files") at each commit that changed it, oldest first, one point per day. */
export function testsOverTime(): { date: string; value: number }[] {
  const commits = execFileSync("git", ["log", "--reverse", "--format=%H %cs", "--", "README.md"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const byDay = new Map<string, number>();
  for (const c of commits) {
    const [sha, date] = c.split(" ") as [string, string];
    const text = execFileSync("git", ["show", `${sha}:README.md`], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 << 20 });
    const m = /\*\*([\d,]+) tests (?:in \d+ files|passing\*\*)/.exec(text);
    if (m) byDay.set(date, Number(m[1]!.replace(/,/g, "")));
  }
  return [...byDay].map(([date, value]) => ({ date, value }));
}

function main(): void {
  mkdirSync(CHART_DIR, { recursive: true });
  const charts = recordCharts();
  const pts = testsOverTime();
  if (pts.length >= 2) charts["tests-over-time.svg"] = line("Tests in the suite, as the README stated them", pts,
    "From git history: the README's \"N tests in M files\" line at each commit that changed it, the last value of each day.");
  for (const [name, body] of Object.entries(charts)) writeFileSync(join(CHART_DIR, name), body);
  console.log(`wrote ${Object.keys(charts).join(", ")} to docs/assets/charts/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
