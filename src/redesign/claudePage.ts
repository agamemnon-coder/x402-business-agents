// /claude, redesigned (Max, 13 Nov: "people need to know where to look and it should be impressive, more visuals and
// data"). One visual of the split under the title: payment requests go to code (routine) or to Claude (the exceptions),
// and the high-risk ones on to the CFO's Face ID; then the three agents as cards with a bar of their decisions; then
// "Measured, not asserted" as five proof tiles, each with its record; then each agent on each model as a bar chart of
// its pass rate, from the sweep the page already reads. Every figure comes from the main run's record or from a record
// src/redesign/claudeEvidence.ts reads; nothing new is counted here. Inline SVG only, no script (the page's CSP hashes
// its one style block), so every width is an SVG attribute, never a style attribute. The colours of the marks are the
// page's own: Claude and Face ID validated as a pair in both themes (dataviz validator, 13 Nov), code in neutral grey.

import { AGENT_EVALS, HOLDOUTS_RECORD, INJECTION_LINE, SWEEP_RECORD, VARIATION_RECORD, ZERO_TRUST_REPORT, HOSTILE_EVAL, modelLines, passedWords, type ClaudeEvidence, type ModelLine } from "./claudeEvidence.js";
import { REPO_BLOB } from "./metalStory.js";
import { countOf, esc, icon } from "./ui.js";
import { hostileSplit, hostileWords } from "./partners.js";

export const CLAUDE_CSS = `:root { --cv-code: #646d7e; --cv-claude: #a84d2b; --cv-face: #4f46e5; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --cv-code: #858fa1; --cv-claude: #d27650; --cv-face: #7a73f0; } }
:root[data-theme="dark"] { --cv-code: #858fa1; --cv-claude: #d27650; --cv-face: #7a73f0; }
.csplit { margin: 0; padding: 18px 20px 14px; display: grid; gap: 10px; }
.csplit svg { display: block; width: 100%; height: auto; overflow: visible; }
.csplit .nar { display: none; }
.sbars ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 12px; }
.sbars li { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: baseline; }
.sbars .sb-n { color: var(--text); font: 780 26px/1.1 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.sbars .sb-l { color: var(--text); font-size: 15.5px; line-height: 1.35; }
.sbars .sb-tot { margin: 0; }
.sbars svg { grid-column: 1 / -1; display: block; width: 100%; height: 10px; margin-top: 4px; }
.sbars .sb-trk { fill: var(--border); }
@media (max-width: 860px) { .csplit { padding: 14px 14px 12px; } .csplit .wid { display: none; } .csplit .nar { display: block; max-width: 420px; } }
.csplit figcaption { font-size: 15px; color: var(--muted); line-height: 1.45; border-top: 1px solid var(--border); padding-top: 10px; font-variant-numeric: tabular-nums; }
.csplit figcaption b { color: var(--text); }
.sk-code { fill: var(--cv-code); } .sk-claude { fill: var(--cv-claude); } .sk-face { fill: var(--cv-face); }
.sk-rib { fill-opacity: .22; } .sk-rib:hover { fill-opacity: .4; }
.sk-src { fill: var(--muted); }
.sk-t { fill: var(--muted); font: 600 15px Inter, system-ui, sans-serif; }
.sk-n { fill: var(--text); font: 780 34px Inter, system-ui, sans-serif; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.sk-l { fill: var(--text); font: 600 16px Inter, system-ui, sans-serif; }
h2.csec { font-size: clamp(21px, 2.1vw, 26px); font-weight: 750; letter-spacing: -.01em; margin: 10px 0 -6px; scroll-margin-top: 80px; }
.cagents { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 760px) { .cagents { grid-template-columns: minmax(0, 1fr); } }
.cag { padding: 16px 18px; display: grid; gap: 8px; align-content: start; }
.cag .top { display: flex; align-items: center; gap: 10px; }
.cag .ic { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; background: var(--claude-soft); color: var(--claude); flex: none; }
.cag h3 { margin: 0; font-size: 17px; font-weight: 720; }
.cag .fam { margin-left: auto; }
.cag .v { font-size: clamp(30px, 3vw, 40px); font-weight: 780; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.cag .v small { font-size: 15px; font-weight: 650; color: var(--muted); letter-spacing: 0; margin-left: 6px; }
.cag .s { font-size: 14.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
svg.bar { display: block; width: 100%; height: 10px; }
.bar .trk { fill: var(--sunken); } .bar .fil { fill: var(--cv-claude); } .bar .fil.alt { fill: var(--cv-code); }
.cev.tiles { padding: 18px 20px; display: grid; gap: 12px; }
.cev.tiles h2 { font-size: clamp(21px, 2.1vw, 26px); font-weight: 750; margin: 0; }
.ctiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.ctiles .ctile { padding: 14px; border-top: 0; border-radius: 16px; background: var(--sunken); display: grid; gap: 4px; align-content: start; min-width: 0; }
.ctile .ic { color: var(--claude); display: flex; }
.ctile .tv { font-size: clamp(28px, 2.8vw, 36px); font-weight: 780; letter-spacing: -.03em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.ctile .tl { font-size: 15px; line-height: 1.4; overflow-wrap: anywhere; }
.ctile .r { display: flex; flex-wrap: wrap; gap: 0 12px; }
.ctile .r a.pf { min-height: 44px; display: inline-flex; align-items: center; }
.cmodels { padding: 18px 20px; display: grid; gap: 14px; }
.cmodels h3 { margin: 0; font-size: 16px; font-weight: 700; }
.cmg { display: grid; gap: 6px; }
.cmr { display: grid; grid-template-columns: 64px minmax(0, 1fr) minmax(0, 250px); align-items: center; gap: 4px 12px; font-size: 15px; font-variant-numeric: tabular-nums; }
.cmr .m { font-weight: 650; } .cmr .n { color: var(--muted); } .cmr .n b { color: var(--text); }
.cmr .use { color: var(--claude); font-weight: 700; }
@media (max-width: 640px) { .cmr { grid-template-columns: 64px minmax(0, 1fr); } .cmr .n { grid-column: 2; } }
.cmodels .key { margin: 0; font-size: 14.5px; color: var(--muted); line-height: 1.45; }
.cmodels .key a.pf { min-height: 44px; display: inline-flex; align-items: center; }`;

const link = (file: string, label = "record") => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface SplitFigures { routine: number; decisions: number; byClaude: number; fallbacks: number; calls: number; faceId: number;
  /** The main run's payments on Alta (metalStory), to say how they relate to the split (jury review, 13 Nov). */
  onChain?: { total: number; sales: number; purchases: number; refunds: number; sweeps: number } }

/** The split as one sentence (both drawings say it; the figure carries it for readers who do not see them). */
export const splitSentence = (f: SplitFigures) =>
  `Payment requests: ${f.routine} routine payments by code; ${f.decisions} exceptions decided by Claude; ${f.faceId} high-risk ones on to the CFO's Face ID.`;

/** A ribbon from a slice of one bar to a slice of another, left to right (a) or top to bottom (b). */
const ribbonH = (x0: number, y0: number, x1: number, y1: number, h0: number, h1: number) => {
  const m = r1((x0 + x1) / 2);
  return `M${x0},${r1(y0)} C${m},${r1(y0)} ${m},${r1(y1)} ${x1},${r1(y1)} L${x1},${r1(y1 + h1)} C${m},${r1(y1 + h1)} ${m},${r1(y0 + h0)} ${x0},${r1(y0 + h0)} Z`;
};
const tip = (t: string) => `<title>${esc(t)}</title>`;

/** The split, drawn wide (from 861 px) and tall (phones): each band's thickness is its count. */
export function splitFigure(f: SplitFigures): string {
  const total = f.routine + f.decisions;
  if (!total || !f.decisions) return "";
  const tCode = `${f.routine} routine payments by code`, tClaude = `${f.decisions} exceptions decided by Claude`, tFace = `${f.faceId} high-risk decisions signed with the CFO's Face ID`;
  // Wide: left to right.
  const H = 200, hc = H * f.routine / total, hl = H * f.decisions / total, hf = Math.max(6, hl * f.faceId / f.decisions);
  const sy = 40, cy = 30, ly = cy + hc + 56, fy = ly + hl + 22, nx = 380, fx = 640, vh = Math.ceil(fy + Math.max(hf, 30) + 12);
  const wide = `<svg class="wid" viewBox="0 0 960 ${vh}" role="img" aria-label="${esc(splitSentence(f))}">
<text class="sk-t" x="0" y="24">Payment requests</text>
<rect class="sk-src" x="0" y="${sy}" width="12" height="${H}" rx="3"/>
<path class="sk-code sk-rib" d="${ribbonH(12, sy, nx, cy, hc, hc)}">${tip(tCode)}</path>
<path class="sk-claude sk-rib" d="${ribbonH(12, sy + hc, nx, ly, hl, hl)}">${tip(tClaude)}</path>
<path class="sk-face sk-rib" d="${ribbonH(nx + 12, ly + hl - hf, fx, fy, hf, hf)}">${tip(tFace)}</path>
<rect class="sk-code" x="${nx}" y="${cy}" width="12" height="${r1(hc)}" rx="3">${tip(tCode)}</rect>
<rect class="sk-claude" x="${nx}" y="${r1(ly)}" width="12" height="${r1(hl)}" rx="3">${tip(tClaude)}</rect>
<rect class="sk-face" x="${fx}" y="${r1(fy)}" width="12" height="${r1(hf)}" rx="3">${tip(tFace)}</rect>
<text x="${nx + 28}" y="${r1(cy + hc / 2 + 2)}"><tspan class="sk-n">${f.routine}</tspan><tspan class="sk-l" x="${nx + 28}" dy="28">routine payments by code</tspan></text>
<text x="${nx + 28}" y="${r1(ly - 14)}"><tspan class="sk-n">${f.decisions}</tspan><tspan class="sk-l" dx="12">exceptions, decided by Claude</tspan></text>
<text x="${fx + 28}" y="${r1(fy + hf / 2 + 12)}"><tspan class="sk-n">${f.faceId}</tspan><tspan class="sk-l" dx="12">high-risk: the CFO's Face ID</tspan></text>
</svg>`;
  // Phones (final jury, 13 Nov: the tall flow was unreadable at 390 px, dark mode the worst): plain figures, the total
  // first, then one bar per part on the same scale (of all requests), each with its count and words in the text colour.
  const pct = (n: number) => String(Math.round((n / total) * 1000) / 10);
  const bar = (cls: string, n: number, words: string) => `<li><span class="sb-n">${n}</span> <span class="sb-l">${esc(words)}</span><svg viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="sb-trk" width="100" height="8"/><rect class="${cls}" width="${pct(n)}" height="8"/></svg></li>`;
  const nar = `<div class="nar sbars" role="img" aria-label="${esc(splitSentence(f))}"><p class="sb-tot"><span class="sb-n">${total}</span> <span class="sb-l">payment requests</span></p><ul>
${bar("sk-code", f.routine, "routine payments by code")}
${bar("sk-claude", f.decisions, "exceptions, decided by Claude")}
${bar("sk-face", f.faceId, "of those, high-risk: the CFO's Face ID")}
</ul></div>`;
  // What a decision is here (jury review, 7 Nov, #19): holding and doing nothing count, as the record's own rows show.
  const cap = `${f.byClaude === f.decisions ? `<b>All ${f.decisions}</b>` : `<b>${f.byClaude} of ${f.decisions}</b>`} decisions by Claude, holds included; <b>${f.fallbacks}</b> fallbacks · <b>${f.calls}</b> Claude calls, each logged`;
  // How the split relates to Alta's and x402's counts (jury review, 13 Nov), said only when the record's figures add up:
  // the routine payments are the x402 sales and code's purchases; the refunds and the sweep are among the exceptions.
  const oc = f.onChain;
  const rel = oc && oc.sales + oc.purchases === f.routine && oc.total === f.routine + oc.refunds + oc.sweeps
    ? `<br>${esc(`On Alta: ${oc.total} payments, the ${f.routine} routine ones (${oc.sales} x402 sales, ${oc.purchases} purchases) and ${oc.refunds} refunds and ${oc.sweeps} sweep, decided among the ${f.decisions} exceptions.`)}` : "";
  return `<figure class="csplit card" id="split">${wide}${nar}<figcaption>${cap}${rel}</figcaption></figure>`;
}

/** A bar of n out of of, as SVG (its width an attribute: the page's CSP allows no style attribute). */
export const bar = (n: number, of: number, label: string, alt = false) => {
  const pct = of ? Math.max(0, Math.min(100, Math.round(n / of * 1000) / 10)) : 0;
  return `<svg class="bar" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><rect class="trk" width="100%" height="10" rx="5"/>${pct ? `<rect class="fil${alt ? " alt" : ""}" width="${pct}%" height="10" rx="5"/>` : ""}</svg>`;
};

export interface AgentFigures { id: string; short: string; family: string; decisions: number; calls: number }
const AGENT_ICON: Record<string, string> = { sourcing: "package", support: "headphones", treasury: "landmark" };

/** The three agents, each a card: its model, its decisions as a bar of all of them, its Claude calls. */
export function agentCards(agents: AgentFigures[]): string {
  const all = agents.reduce((n, a) => n + a.decisions, 0);
  if (!agents.length || !all) return "";
  return `<h2 class="csec" id="agents">Three agents</h2><div class="cagents">${agents.map((a) => `<article class="cag card" data-agent="${esc(a.id)}">
<div class="top"><span class="ic">${icon(AGENT_ICON[a.id] ?? "bot", 20)}</span><h3>${esc(a.short)}</h3><span class="model fam">${esc(a.family)}</span></div>
<span class="v">${a.decisions}<small>decisions</small></span>${bar(a.decisions, all, `${a.short}: ${a.decisions} of ${all} decisions`)}
<span class="s">${a.calls} Claude calls</span></article>`).join("")}</div>`;
}

export interface HostileFigures { calls: number; refused: number; stood: number; unsafe: number; cases: number }
/**
 * The hostile-model eval's tile label, in the one wording of its split (hostileWords, src/redesign/partners.ts; the final
 * review, 13 Nov), read from its record. It names its scope (review round 1, 12 Nov): the payables agents and their
 * test invoices, not the three agents above.
 */
// Judge panel, 13 Nov: the calls not refused are said too (stood); the final review, 13 Nov: in the one wording of the split.
export const hostileTileLabel = (h: HostileFigures) => {
  const s = hostileSplit();
  if (!s || s.calls !== h.calls || s.refused !== h.refused) throw new Error("the hostile-model eval's tile and its record differ");
  return `hostile tool calls on the payables agents' ${h.cases} test invoices: ${hostileWords(s)}`;
};

/**
 * The Haiku-as-Support tile's label: what its "0 of 10" counts (runs passed on the attack case support-outside), what
 * code did, and the model Support runs on instead, with its runs passed. Judge panel, 13 Nov: "failed one attack test"
 * beside "0 of 10" read as a contradiction; the words are docs/claude.md's, from docs/agent-evals.md.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-31" → "31 Oct". */
const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export function supportTileLabel(lines: ModelLine[], used: Record<string, string>, ranAt?: string): string {
  const inUse = lines.find((l) => l.agent === "support" && FAM(l.model) === used.support && !/haiku/.test(l.model));
  return `runs passed by Haiku as Support on one attack case${ranAt ? ` (${shortDay(ranAt.slice(0, 10))})` : ""}: refunds asked outside the dispute; code refused each one, nothing paid.${inUse ? ` So Support runs on ${FAM(inUse.model)} (${passedWords(inUse.passed, inUse.runs)})` : ""}`;
}

/** Measured, not asserted: five proof tiles, each an icon, one number, a short label and its record. */
export function proofTiles(e: ClaudeEvidence, used: Record<string, string> = {}): string {
  const lines = e.sweep ? modelLines(e.sweep) : [], haikuSupport = e.sweep?.rows.find((r) => r.agent === "support" && /haiku/.test(r.model) && r.passed === 0);
  const tile = (ic: string, v: string, l: string, rec: string, links: string) => `<li class="ctile" data-rec="${esc(rec)}"><span class="ic">${icon(ic, 20)}</span><span class="tv">${esc(v)}</span><span class="tl">${esc(l)}</span><span class="r">${links}</span></li>`;
  const v = e.variation, h = e.hostile;
  const items = [
    v ? tile("database", String(v.decisions), `decisions in ${v.worlds} simulated worlds, ${v.claudePct === 100 ? "all" : `${v.claudePct}%`} by Claude; ${v.unsafe} unsafe actions${e.fix && e.fix.unsafe === 0 ? ", fixed" : ""}`, VARIATION_RECORD, link(VARIATION_RECORD)) : "",
    e.holdouts ? tile("lock", String(e.holdouts.run), `blind holdouts, ${e.holdouts.safe === e.holdouts.run ? "all" : e.holdouts.safe} safe${e.holdouts.partial ? `; ${e.holdouts.partial} on code's rule only` : ""}`, HOLDOUTS_RECORD, link(HOLDOUTS_RECORD)) : "",
    // The failure says why it matters (13 Nov): code held it, and the sweep is why Support runs on another model.
    haikuSupport ? tile("shield-alert", `${haikuSupport.passed} of ${haikuSupport.runs}`, supportTileLabel(lines, used, (haikuSupport as { ran_at?: string }).ran_at), AGENT_EVALS, link(AGENT_EVALS)) : "",
    lines.length ? tile("sliders-horizontal", String(lines.length), "model and agent pairs, measured", SWEEP_RECORD, link(SWEEP_RECORD)) : "",
    h ? tile("shield-check", String(h.calls), hostileTileLabel(h), HOSTILE_EVAL, link(HOSTILE_EVAL) + (e.zeroTrust ? link(ZERO_TRUST_REPORT, "zero-trust report") : "")) : "",
  ].filter(Boolean);
  return items.length ? `<section class="cev tiles card" aria-labelledby="cev-h"><h2 id="cev-h">Measured, not asserted</h2><ul class="ctiles">${items.join("")}</ul></section>` : "";
}

const FAM = (m: string) => /haiku/.test(m) ? "Haiku" : /sonnet/.test(m) ? "Sonnet" : /opus/.test(m) ? "Opus" : m;
const usd = (n: number) => n >= 0.01 ? n.toFixed(3) : n.toFixed(4);

/** Each agent on each model, as the sweep measured it: a bar of the pass rate per pair, its cost per pass and its time. */
export function modelChart(e: ClaudeEvidence, used: Record<string, string>): string {
  if (!e.sweep) return "";
  const lines = modelLines(e.sweep), agents = [...new Set(lines.map((l) => l.agent))];
  const row = (l: ModelLine) => {
    const inUse = used[l.agent] === FAM(l.model), cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
    const label = `${cap(l.agent)} on ${FAM(l.model)}: passed ${countOf(l.passed, l.runs, true)} runs, ${usd(l.costPerPass)} USD a pass, ${l.medianS.toFixed(1)} s`;
    return `<div class="cmr"><span class="m">${esc(FAM(l.model))}</span>${bar(l.passed, l.runs, label, !inUse)}<span class="n"><b>${esc(passedWords(l.passed, l.runs))}</b> · $${esc(usd(l.costPerPass))} · ${esc(l.medianS.toFixed(1))}s${inUse ? ` · <span class="use">in use</span>` : ""}</span></div>`;
  };
  // Jury review, 13 Nov: each group says what its figures add up (every case run on that model) and when, from the rows,
  // so the chart's Support figures do not read against the one attack case on the tile above.
  const span = (a: string) => {
    const days = [...new Set(e.sweep!.rows.filter((r) => r.agent === a).map((r) => (r as { ran_at?: string }).ran_at?.slice(0, 10)).filter((d): d is string => !!d))].sort();
    return days.length ? days[0] === days.at(-1) ? shortDay(days[0]!) : `${shortDay(days[0]!)}–${shortDay(days.at(-1)!)}` : "";
  };
  return `<h2 class="csec" id="models">Each agent on each model</h2><article class="cmodels card" data-rec="${esc(SWEEP_RECORD)}" aria-label="Each agent on each model: pass rate, cost per pass, time">${agents.map((a) => `<div class="cmg"><h3>${esc(`${a[0]!.toUpperCase()}${a.slice(1)}`)}<small>${esc(` · every case run${span(a) ? `, ${span(a)}` : ""}`)}</small></h3>${lines.filter((l) => l.agent === a).map(row).join("")}</div>`).join("")}<p class="key">Passed · USD a pass · time. ${link(SWEEP_RECORD)}</p></article>`;
}

/** The injection screen as code holds it, in its own fold (13 Nov: the proof tiles carry figures only). */
export const injectionFold = () => `<details class="fold" id="injection"><summary>A line aimed at the AI</summary><ul class="pl"><li>${esc(INJECTION_LINE)}</li></ul></details>`;

export interface ClaudeBody { logo: string; label: string; split: SplitFigures; agents: AgentFigures[]; evidence: ClaudeEvidence; used: Record<string, string>; folds: string; runIcon: string }

/** The page's main: the title, the split, the agents, the proof tiles, the model chart, then the folds. */
export function claudeMain(b: ClaudeBody): string {
  return `<main class="pp"><div class="wrap">
  <div class="phd">${b.logo}<span class="pill run">${b.runIcon}${esc(b.label)}</span><h1>Claude decides the exceptions</h1></div>
  ${splitFigure(b.split)}
  ${agentCards(b.agents)}
  ${proofTiles(b.evidence, b.used)}
  ${modelChart(b.evidence, b.used)}
  <div class="folds card">${b.folds}${injectionFold()}</div>
  <a class="open" href="proof#claude">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
}
