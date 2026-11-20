// /proof's charts (the owner, 21 Nov: "charts where numbers have a series"): the red team's runs over time, why code
// did not pay in the newest held-out eval, the held-out eval rounds, the live runs by day and test coverage, before and
// after. Each is read from its committed records when the page is built (never typed), drawn as plain SVG (no script, so
// the page's CSP holds), coloured from the site's theme tokens (light and dark), and carries its numbers twice more: a
// native tooltip on every bar (<title>) and a table in a fold under it, for a screen reader or a reader who wants the
// figures. Every chart names its records (data-rec), so test/proof-trace.test.ts holds its figures to them.

import { readdirSync, readFileSync } from "node:fs";
import { newestDate, shortDay } from "../proof/recordDate.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

const ROOT = new URL("../../", import.meta.url);
type J = Record<string, unknown>;
const json = <T = J>(p: string): T | null => { try { return JSON.parse(readFileSync(new URL(p, ROOT), "utf8")) as T; } catch { return null; } };
const files = (dir: string, re: RegExp) => { try { return readdirSync(new URL(dir, ROOT)).filter((f) => re.test(f)).map((f) => `${dir}/${f}`); } catch { return []; } };

/** One series of a chart: its words and its colour class (pc-* in PROOF_CHARTS_CSS). */
export interface ChartSeries { key: string; label: string; cls: "accent" | "awx" | "metal" | "claude" | "bad" | "base" | "visa" | "ink" }
/** One column (or bar) of a chart: its label under it, a second line, and a value per series. */
export interface ChartRow { cat: string; sub?: string; values: Record<string, number> }
export interface Chart {
  id: string; title: string; sub: string; series: ChartSeries[]; rows: ChartRow[];
  /** Stacked columns (parts of one whole), grouped columns side by side, or horizontal bars (one series, labels on the left). */
  kind: "stacked" | "grouped" | "bars";
  /** A suffix on the axis and the values ("%"); the axis's top, when it is fixed (100 for a percentage). */
  unit?: string; max?: number;
  /** The table under the chart: its head and rows, the chart's numbers and what they leave out. */
  table: { head: string[]; rows: (string | number)[][] };
  /** The records the chart is read from (data-rec), and the one its link opens. */
  rec: string[]; href: string;
  /** One line under the chart: how to read it, what it does not say. */
  note?: string;
}

const blob = (p: string) => `${REPO_BLOB}${p}`;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** A round top for the value axis and its step: 1, 2 or 5 times a power of ten, about four ticks. */
function niceMax(v: number): { top: number; step: number } {
  if (v <= 0) return { top: 1, step: 1 };
  const raw = v / 4, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  return { top: Math.ceil(v / step) * step, step };
}

// ── The data, each from its records ─────────────────────────────────────────────────────────────────────────────────

type RedTeam = { ran_at?: string; attempts?: number; blocked?: number; caught_after?: number; inconclusive?: number; not_blocked?: number; model?: string | null };
/** Every run of the full red-team suite (docs/redteam/report.json, then each re-run), oldest first. */
export function redTeamChart(): Chart | null {
  const recs = ["docs/redteam/report.json", ...files("docs/redteam", /^rerun-.*\.json$/)];
  const runs = recs.map((f) => ({ f, r: json<RedTeam>(f) })).filter((x): x is { f: string; r: RedTeam } => !!x.r?.attempts && !!x.r.ran_at).sort((a, b) => a.r.ran_at!.localeCompare(b.r.ran_at!));
  if (runs.length < 2) return null;
  const rows = runs.map(({ r }) => {
    const after = r.caught_after ?? 0, before = (r.blocked ?? 0) - after, not = (r.not_blocked ?? 0) + (r.inconclusive ?? 0);
    return { cat: shortDay(r.ran_at!), sub: `${r.attempts} attacks`, values: { before, after, not } };
  });
  // Two runs on one day: the later one says "later" under its day.
  rows.forEach((x, i) => { if (i && rows[i - 1]!.cat === x.cat) x.sub = `${(x.sub ?? "").replace(" attacks", "")} · later`; });
  const last = runs.at(-1)!;
  return {
    id: "chart-redteam", kind: "stacked", title: "The red team, every full run", sub: `Attacks stopped before money moved, found only afterwards, or not stopped; newest ${shortDay(last.r.ran_at!)}`,
    series: [{ key: "before", label: "stopped before money moved", cls: "accent" }, { key: "after", label: "found afterwards", cls: "awx" }, { key: "not", label: "not stopped or inconclusive", cls: "bad" }],
    rows,
    table: { head: ["Run", "Attacks", "Stopped before", "Found afterwards", "Not stopped or inconclusive", "Attacker"], rows: runs.map(({ r }, i) => [`${rows[i]!.cat}${rows[i]!.sub?.endsWith("later") ? " (later)" : ""}`, r.attempts!, rows[i]!.values.before!, rows[i]!.values.after!, rows[i]!.values.not!, r.model ? "Claude wrote the documents" : "scripted"]) },
    rec: runs.map((x) => x.f), href: blob(last.f),
    note: "The first run had Claude write some of the attack documents; the re-runs are scripted, and the newest also replays earlier attempts as attacks of their own. A throwaway test world, test money.",
  };
}

type AdvTotals = { cases: number; wrong_payments: number; false_holds: number; clean_truths: number; by_rule?: Record<string, number> };
type Adv = { held_out?: boolean; ran_at?: string; cases_commit?: string; totals?: { purser_script?: AdvTotals; no_rules?: AdvTotals } };
/** The held-out eval rounds (docs/evals/adversarial-vN.json, held_out true), oldest first, each with the run after its fixes. */
export function evalRounds(): { n: number; file: string; rec: Adv; after: { file: string; rec: Adv } | null }[] {
  return files("docs/evals", /^adversarial-v\d+\.json$/)
    .map((file) => ({ file, n: Number(/-v(\d+)\.json$/.exec(file)![1]), rec: json<Adv>(file) }))
    .filter((x): x is { file: string; n: number; rec: Adv } => !!x.rec?.held_out && !!x.rec.totals?.purser_script && !!x.rec.totals.no_rules)
    .sort((a, b) => a.n - b.n)
    .map((x) => {
      const af = x.file.replace(/\.json$/, "-after.json"), a = json<Adv>(af);
      return { ...x, after: a && !a.held_out && a.totals?.purser_script ? { file: af, rec: a } : null };
    });
}

export function evalChart(): Chart | null {
  const rounds = evalRounds();
  if (rounds.length < 2) return null;
  const newest = rounds.at(-1)!;
  return {
    id: "chart-evals", kind: "grouped", title: "Held-out eval rounds: wrong payments", sub: `Purser's rules against no rules, each round a new set of invoices written before its run; newest eval v${newest.n}, ${shortDay(newest.rec.ran_at!)}`,
    series: [{ key: "purser", label: "Purser's rules", cls: "accent" }, { key: "none", label: "no rules", cls: "base" }],
    rows: rounds.map((x) => ({ cat: `v${x.n}`, sub: shortDay(x.rec.ran_at!), values: { purser: x.rec.totals!.purser_script!.wrong_payments, none: x.rec.totals!.no_rules!.wrong_payments } })),
    table: {
      head: ["Round", "Run", "Invoices", "Wrong payments, Purser", "Wrong payments, no rules", "False holds, Purser", "After the fixes that followed (not held out)"],
      rows: rounds.map((x) => { const p = x.rec.totals!.purser_script!, a = x.after?.rec.totals?.purser_script; return [`v${x.n}`, shortDay(x.rec.ran_at!), p.cases, p.wrong_payments, x.rec.totals!.no_rules!.wrong_payments, `${p.false_holds} of ${p.clean_truths}`, a ? `${a.wrong_payments} wrong, ${a.false_holds} false holds` : "not run"]; }),
    },
    rec: rounds.flatMap((x) => [x.file, ...(x.after ? [x.after.file] : [])]), href: blob(newest.file.replace(/\.json$/, ".md")),
    note: "A script that always says pay stands in for the AI: the worst case. The sets differ in size and difficulty, so a round is read against its own no-rules figure, not against the round before. The runs after each round's fixes were written against its misses, so they are not held out and are only in the table.",
  };
}

/** Why the newest held-out round's invoices were not paid, by the rule that decided (its by_rule). */
export function refusalsChart(): Chart | null {
  const newest = evalRounds().at(-1);
  const by = newest?.rec.totals?.purser_script?.by_rule;
  if (!newest || !by || !Object.keys(by).length) return null;
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => ({ cat: k.replace(/_/g, " "), values: { n: v } }));
  const total = rows.reduce((s, r) => s + r.values.n, 0), cases = newest.rec.totals!.purser_script!.cases;
  return {
    id: "chart-refusals", kind: "bars", title: "Refusals by reason", sub: `Why code did not pay: ${total} of ${cases} held-out invoices, eval v${newest.n}, ${shortDay(newest.rec.ran_at!)}`,
    series: [{ key: "n", label: "invoices not paid", cls: "accent" }], rows,
    table: { head: ["Rule that decided", "Invoices not paid"], rows: rows.map((r) => [r.cat, r.values.n]) },
    rec: [newest.file], href: blob(newest.file.replace(/\.json$/, ".md")),
    note: "Held, refused or sent to the CFO: the rule that decided each invoice that was not paid. Offline, test data.",
  };
}

/** The live runs, by day and by partner group (src/redesign/proofRuns.ts proofRuns: the rows /proof lists). */
export function liveRunsChart(groups: { group: string; runs: { iso: string }[] }[], rec: string[]): Chart | null {
  const CLS: Record<string, ChartSeries["cls"]> = { "The main run": "ink", Airwallex: "awx", "Visa via Airwallex's Airi": "accent", Alta: "metal", "The books": "base" };
  const LABEL: Record<string, string> = { "Visa via Airwallex's Airi": "Visa via Airi" };
  const days = [...new Set(groups.flatMap((g) => g.runs.map((r) => r.iso.slice(0, 10))))].sort();
  if (days.length < 2) return null;
  const series = groups.map((g, i) => ({ key: `g${i}`, label: LABEL[g.group] ?? g.group, cls: CLS[g.group] ?? "base" }));
  const rows = days.map((d) => ({ cat: shortDay(d), values: Object.fromEntries(groups.map((g, i) => [`g${i}`, g.runs.filter((r) => r.iso.startsWith(d)).length])) }));
  const total = groups.reduce((n, g) => n + g.runs.length, 0);
  return {
    id: "chart-runs", kind: "stacked", title: "Live runs, by day", sub: `${total} runs listed in this section, ${shortDay(days[0]!)} to ${shortDay(days.at(-1)!)}, by the partner each shows first`,
    series, rows,
    table: { head: ["Day", ...series.map((s) => s.label), "All"], rows: rows.map((r) => [r.cat, ...series.map((s) => r.values[s.key]!), Object.values(r.values).reduce((a, b) => a + b, 0)]) },
    rec, href: `${REPO_BLOB.replace("/blob/", "/tree/")}docs/runs`,
    note: "Sandboxes and Alta's testnet, test money; a day with no run is left out.",
  };
}

type Pct = { statements: { pct: number }; branches: { pct: number } };
/** Test coverage of the product, the previous coverage run and the newest (docs/evidence/coverage.json). */
export function coverageChart(): Chart | null {
  const F = "docs/evidence/coverage.json";
  const c = json<{ measured_on?: string; scopes?: { product?: { before?: Pct; after?: Pct } } }>(F);
  const p = c?.scopes?.product;
  if (!p?.before || !p.after || !c?.measured_on) return null;
  const now = shortDay(c.measured_on);
  return {
    id: "chart-coverage", kind: "grouped", unit: "%", max: 100, title: "Test coverage of the product", sub: `Statements and branches covered, the previous coverage run and ${now}`,
    series: [{ key: "before", label: "previous run", cls: "base" }, { key: "after", label: now, cls: "accent" }],
    rows: [{ cat: "statements", values: { before: p.before.statements.pct, after: p.after.statements.pct } }, { cat: "branches", values: { before: p.before.branches.pct, after: p.after.branches.pct } }],
    table: { head: ["", "Previous run", now], rows: [["Statements", `${p.before.statements.pct}%`, `${p.after.statements.pct}%`], ["Branches", `${p.before.branches.pct}%`, `${p.after.branches.pct}%`]] },
    rec: [F], href: blob("docs/evidence/coverage.md"),
    note: "V8 coverage over src, cloud/src and worker/src, without the command-line entry points and generated files.",
  };
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const W = 360;
const FONT = { tick: 12, cat: 12.5, val: 12.5 };

function columns(c: Chart): { svg: string; h: number } {
  const H = 236, L = 34, R = 4, T = 18, B = 42, pw = W - L - R, ph = H - T - B;
  const sum = (r: ChartRow) => c.series.reduce((n, s) => n + (r.values[s.key] ?? 0), 0);
  const peak = c.kind === "stacked" ? Math.max(...c.rows.map(sum)) : Math.max(...c.rows.flatMap((r) => c.series.map((s) => r.values[s.key] ?? 0)));
  const { top, step } = c.max ? { top: c.max, step: c.max / 4 } : niceMax(peak);
  const y = (v: number) => T + ph - (v / top) * ph;
  const out: string[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(`<line class="pc-grid" x1="${L}" x2="${W - R}" y1="${r1(y(v))}" y2="${r1(y(v))}"/><text class="pc-tick" x="${L - 5}" y="${r1(y(v) + 4)}" text-anchor="end">${esc(`${r1(v)}${c.unit ?? ""}`)}</text>`);
  const slot = pw / c.rows.length, many = c.rows.length > 8;
  const gap = Math.min(18, slot * 0.28), bw = slot - gap;
  c.rows.forEach((r, i) => {
    const x0 = L + i * slot + gap / 2, cx = x0 + bw / 2;
    if (c.kind === "stacked") {
      let base = 0;
      const parts = c.series.filter((s) => (r.values[s.key] ?? 0) > 0);
      parts.forEach((s, j) => {
        const v = r.values[s.key]!, yTop = y(base + v), yBot = y(base);
        // A 2 px surface gap between stacked parts; the top part keeps rounded corners.
        const h = Math.max(0, yBot - yTop - (j ? 2 : 0));
        out.push(`<rect class="pc-m pc-${s.cls}" x="${r1(x0)}" y="${r1(yTop)}" width="${r1(bw)}" height="${r1(h)}" rx="${j === parts.length - 1 ? Math.min(4, bw / 4) : 0}"><title>${esc(`${r.cat}${r.sub ? `, ${r.sub}` : ""}: ${v} ${s.label}`)}</title></rect>`);
        base += v;
      });
      const total = sum(r);
      if (!many || c.rows.length <= 16) out.push(`<text class="pc-val" x="${r1(cx)}" y="${r1(y(total) - 4)}" text-anchor="middle">${esc(String(total))}</text>`);
    } else {
      const n = c.series.length, w = (bw - (n - 1) * 2) / n;
      c.series.forEach((s, j) => {
        const v = r.values[s.key] ?? 0, x = x0 + j * (w + 2);
        out.push(`<rect class="pc-m pc-${s.cls}" x="${r1(x)}" y="${r1(y(v))}" width="${r1(w)}" height="${r1(Math.max(0, y(0) - y(v)))}" rx="${Math.min(4, w / 4)}"><title>${esc(`${r.cat}${r.sub ? `, ${r.sub}` : ""}: ${v}${c.unit ?? ""} ${s.label}`)}</title></rect>`);
        if (w >= 12) out.push(`<text class="pc-val" x="${r1(x + w / 2)}" y="${r1(y(v) - 4)}" text-anchor="middle">${esc(`${v}${c.unit && c.unit !== "%" ? c.unit : ""}`)}</text>`);
      });
    }
    // Under each column its label; with many columns, the day's number only and the month at its first day.
    const cat = many ? r.cat.split(" ")[0]! : r.cat;
    out.push(`<text class="pc-cat" x="${r1(cx)}" y="${H - B + 15}" text-anchor="middle">${esc(cat)}</text>`);
    const sub = many ? (i === 0 || c.rows[i - 1]!.cat.split(" ")[1] !== r.cat.split(" ")[1] ? r.cat.split(" ")[1] : "") : r.sub;
    if (sub) out.push(`<text class="pc-sub" x="${r1(many ? x0 : cx)}" y="${H - B + 30}" text-anchor="${many ? "start" : "middle"}">${esc(sub)}</text>`);
  });
  out.push(`<line class="pc-axis" x1="${L}" x2="${W - R}" y1="${r1(y(0))}" y2="${r1(y(0))}"/>`);
  return { svg: out.join(""), h: H };
}

function bars(c: Chart): { svg: string; h: number } {
  const s = c.series[0]!, LW = 172, R = 28, row = 24, T = 4;
  const peak = Math.max(...c.rows.map((r) => r.values[s.key] ?? 0));
  const H = T + c.rows.length * row + 4, pw = W - LW - R;
  const out = c.rows.map((r, i) => {
    const v = r.values[s.key] ?? 0, w = Math.max(2, (v / peak) * pw), yy = T + i * row;
    return `<text class="pc-cat" x="${LW - 8}" y="${yy + 15}" text-anchor="end">${esc(r.cat)}</text><rect class="pc-m pc-${s.cls}" x="${LW}" y="${yy + 4}" width="${r1(w)}" height="${row - 8}" rx="4"><title>${esc(`${r.cat}: ${v} ${s.label}`)}</title></rect><text class="pc-val" x="${r1(LW + w + 5)}" y="${yy + 15}">${esc(String(v))}</text>`;
  });
  return { svg: out.join(""), h: H };
}

/** One chart: its heading, the drawing, its legend, a line on how to read it, its numbers as a table (folded), its record. */
export function chartHtml(c: Chart | null): string {
  if (!c) return "";
  const d = c.kind === "bars" ? bars(c) : columns(c);
  const desc = c.table.rows.map((r) => r.map(String).join(" ").trim()).join("; ");
  const legend = c.series.length > 1 ? `<ul class="pc-leg">${c.series.map((s) => `<li><span class="pc-sw pc-${s.cls}" aria-hidden="true"></span>${esc(s.label)}</li>`).join("")}</ul>` : "";
  return `<figure class="pchart" id="${esc(c.id)}" data-rec="${esc(c.rec.join(" "))}">
<figcaption><b id="${esc(c.id)}-t">${esc(c.title)}</b><span id="${esc(c.id)}-d">${esc(c.sub)}</span></figcaption>
<svg viewBox="0 0 ${W} ${d.h}" width="${W}" height="${d.h}" role="img" aria-labelledby="${esc(c.id)}-t ${esc(c.id)}-d"><desc>${esc(desc)}</desc>${d.svg}</svg>
${legend}
<details class="pc-tab"><summary>${esc("The numbers, and how to read them")}</summary>${c.note ? `<p class="pc-note">${esc(c.note)}</p>` : ""}<div class="pc-scroll"><table><thead><tr>${c.table.head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${c.table.rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${esc(String(x))}</td>` : `<th scope="row">${esc(String(x))}</th>`)).join("")}</tr>`).join("")}</tbody></table></div></details>
<a class="pc-rec" href="${esc(c.href)}" target="_blank" rel="noopener">${esc("Record")}&nbsp;↗</a>
</figure>`;
}

/** The newest day among a chart's records, for its caption ("as of"). */
export const chartDay = (c: Chart | null): string | null => (c ? newestDate(c.rec) : null);

export const PROOF_CHARTS_CSS = `
.pcharts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin: 16px 0 6px; }
@media (min-width: 900px) { .pcharts { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pcharts.one { grid-template-columns: minmax(0, 620px); } }
.pchart { margin: 0; padding: 14px 16px 10px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; align-content: start; }
.pchart figcaption { display: grid; gap: 2px; }
.pchart figcaption b { font-size: 16px; font-weight: 720; }
.pchart figcaption span { font-size: 13px; line-height: 1.4; color: var(--muted); }
.pchart svg { display: block; width: 100%; height: auto; max-width: 470px; overflow: visible; font-family: inherit; }
.pchart .pc-grid { stroke: var(--border); stroke-width: 1; opacity: .7; }
.pchart .pc-axis { stroke: var(--muted); stroke-width: 1; }
.pchart .pc-tick, .pchart .pc-sub { fill: var(--muted); font-size: ${FONT.tick}px; font-variant-numeric: tabular-nums; }
.pchart .pc-cat { fill: var(--text); font-size: ${FONT.cat}px; font-weight: 600; }
.pchart .pc-val { fill: var(--text); font-size: ${FONT.val}px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pchart .pc-m { transition: opacity .15s; } .pchart .pc-m:hover { opacity: .75; }
.pchart .pc-accent { fill: var(--accent); background: var(--accent); } .pchart .pc-awx { fill: var(--awx); background: var(--awx); }
.pchart .pc-metal { fill: var(--metal); background: var(--metal); } .pchart .pc-claude { fill: var(--claude); background: var(--claude); }
.pchart .pc-bad { fill: var(--bad); background: var(--bad); } .pchart .pc-base { fill: var(--muted); background: var(--muted); opacity: .55; }
.pchart .pc-visa { fill: var(--accent); background: var(--accent); opacity: .55; } .pchart .pc-ink { fill: var(--text); background: var(--text); }
.pchart ul.pc-leg { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--muted); }
.pchart ul.pc-leg li { display: inline-flex; align-items: center; gap: 6px; }
.pchart .pc-sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.pchart .pc-note { margin: 0 0 8px; font-size: 14px; line-height: 1.45; color: var(--muted); }
.pchart details.pc-tab > summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 44px; font-size: 13.5px; font-weight: 650; color: var(--accent); list-style: none; }
.pchart details.pc-tab > summary::-webkit-details-marker { display: none; }
.pchart details.pc-tab > summary::after { content: " ▾"; } .pchart details.pc-tab[open] > summary::after { content: " ▴"; }
.pchart .pc-scroll { overflow-x: auto; max-width: 100%; }
.pchart table { border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; min-width: 100%; }
.pchart th, .pchart td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.pchart thead th { color: var(--muted); font-weight: 650; }
.pchart a.pc-rec { justify-self: start; display: inline-flex; align-items: center; min-height: 44px; font-size: 13.5px; font-weight: 650; color: var(--accent); text-decoration: none; }
@media (prefers-reduced-motion: reduce) { .pchart .pc-m { transition: none; } }
@media (forced-colors: active) { .pchart .pc-m, .pchart .pc-sw { forced-color-adjust: none; } }
`;
