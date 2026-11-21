// Home's hero in the owner's concept (21 Nov: "dark violet premium enterprise fintech"): an obsidian ground with a slow
// wave of violet light points flowing from the bottom left to the top right, three layers at three speeds, that only
// leans aside a little where the pointer is; three figures from the records under the idea; and, on the right, a glass
// card "Workflow" whose four steps light up one after another.
//
// Honesty: the three figures are read from the evidence wall (docs/evidence/evidence-wall.json, each tile's own records
// in data-rec); a figure the wall lacks is left out, never typed in. The Workflow card is a schematic of how a payment
// runs, labelled "Sample flow · sandbox": its lights are an illustration on a loop, no activity, no amount, no time.
//
// Motion: the wave is one Canvas 2D in the page's one hashed script, its pixel ratio that of the screen, capped at 2,, with
// fewer points on a phone, paused off screen (IntersectionObserver) and in a hidden tab; under prefers-reduced-motion
// the canvas is not drawn at all and a still violet gradient stands in. The card's lights are CSS (opacity and
// transform), still and all lit under reduced motion.

import { readFileSync } from "node:fs";
import { committedWall, type EvidenceWall } from "./evidenceWall.js";
import { FLOW, READER_CHIP, TRY_SAMPLE_RECORD } from "./heroFlow.js";
import { esc, icon } from "./ui.js";

/** The hero's three figures (Max: tests passing, sandbox and testnet runs, policy blocks), each a wall tile by key. */
export const HERO_STATS: readonly { key: string; words: string }[] = [
  { key: "verify-all", words: "verification checks passed" },
  { key: "try-transfers", words: "sandbox transfers on Airwallex" },
  { key: "red-team", words: "attacks stopped before money moved" },
];
export interface HeroStat { value: string; words: string; rec: string; href: string; source: string }
/**
 * The figures as the wall holds them ("All 48" reads "48"); a tile the wall lacks drops out. Each links to its group of
 * the wall on /proof, and says where it comes from on hover (Max, 21 Nov: "show its provenance, link each to /proof").
 */
export function heroStats(w: EvidenceWall | null = committedWall()): HeroStat[] {
  const tiles = new Map((w?.groups ?? []).flatMap((g) => g.tiles.map((t) => [t.key, { t, group: g.id }] as const)));
  return HERO_STATS.flatMap((s) => {
    const hit = tiles.get(s.key);
    const value = hit?.t.fig.replace(/^All\s+/, "").trim();
    if (!hit || !value || !/^\d[\d,]*$/.test(value)) return [];
    const { t, group } = hit;
    return [{ value, words: s.words, rec: t.rec, href: `proof#${group}`, source: `${t.fig} ${t.label}${t.asOf ? ` (${t.asOf})` : ""}. Record: ${t.rec}` }];
  });
}
export function heroStatsHtml(stats: HeroStat[] = heroStats()): string {
  return stats.length ? `<ul class="hstats">${stats.map((s) => `<li data-rec="${esc(s.rec)}"><a href="${esc(s.href)}" title="${esc(s.source)}"><b>${esc(s.value)}</b><span>${esc(s.words)}</span></a></li>`).join("")}</ul>` : "";
}

/**
 * The Workflow card, Home's one demo (Max, 21 Nov: "merge the two demos into one"; "proposed, held, approved, paid and
 * refused told apart"; "way more details, more flow"). /try's sample invoice (src/config/trySample.ts: Bergtex Textil
 * GmbH, BTX-2026-21, EUR 1,850.00) through Purser, each step with its state from a recorded run and one line of detail:
 *   - the invoice, Claude's reading of it, its checks and its booking: the /try run of 13 Nov with Claude on
 *     (TRY_SAMPLE_RECORD, through src/redesign/heroFlow.ts FLOW and BOOKED, the VAT line as the engine books it now);
 *   - why it was held for the CFO, the signature, the payment at Airwallex and the one-cent change refused: run 1 of
 *     docs/runs/2026-11-21-phone-try (an iPhone profile, a software test passkey, the Airwallex sandbox), whose signed
 *     amount must equal the invoice's, or the payment's details are left out.
 * No figure is typed in. The record's run script changes the signed EUR 1,850.00 to 1,850.01 (scripts/try-live-record.ts);
 * the summary keeps that the amount changed, both hashes and that no transfer was added.
 */
export const WORKFLOW_RECORD = "docs/runs/2026-11-21-phone-try/summary.json";
export const WORKFLOW_HEAD = "Workflow";
export const WORKFLOW_TAG = "Recorded /try runs · sandbox";
export const WORKFLOW_NOTE = "Two recorded /try runs of its sample invoice.";
export const WORKFLOW_STEPS: readonly { icon: string; title: string }[] = [
  { icon: "bot", title: "Agent proposes a payment" },
  { icon: "shield-check", title: "Purser checks policy & risk" },
  { icon: "scan-face", title: "CFO authorizes with Face ID" },
  { icon: "landmark", title: "Payment executed via Airwallex" },
  { icon: "database", title: "Booked in the ledger" },
];
interface TryRun { ok?: boolean; airwallex?: { amount: string; approval_sha256: string; path: { status: string }[] }[]; approval?: { approval_sha256: string; equals_transfer_metadata?: boolean }; refusal?: { outcome: string; changed?: string[]; signed_sha256?: string; sent_sha256?: string; transfers_before?: number; transfers_after?: number } }
/** One step as its record has it: its state (a chip in its own colour) and its detail. */
export type WorkflowState = "proposed" | "held" | "approved" | "paid" | "booked" | "refused";
export interface WorkflowStep { state: WorkflowState; chip: string; detail: string; rows?: readonly { code: string; name: string; amount: string; side: "Dr" | "Cr" }[] }
export interface WorkflowFacts { invoice: { supplier: string; number: string; amount: string; due: string }; steps: WorkflowStep[]; refused: WorkflowStep | null; recs: string[] }
const money = (a: string) => { const m = /^([A-Z]{3}) (\d+)\.(\d{2})$/.exec(a); return m ? `${m[1]} ${Number(m[2]).toLocaleString("en-GB")}.${m[3]}` : a; };
const short = (h: string) => `${h.slice(0, 8)}…`;
export function workflowFacts(rec: { runs?: TryRun[] } | null = (() => { try { return JSON.parse(readFileSync(new URL(`../../${WORKFLOW_RECORD}`, import.meta.url), "utf8")) as { runs?: TryRun[] }; } catch { return null; } })()): WorkflowFacts | null {
  const f = FLOW;
  const read: WorkflowStep = { state: "proposed", chip: "Proposed by agent", detail: `${READER_CHIP}: payee, amount, due date and account ${f.account} checked` };
  const booked: WorkflowStep = { state: "booked", chip: "Booked", detail: "Three lines, debit equals credit", rows: f.ledger.map((l) => ({ code: l.code, name: l.name, amount: l.debit || l.credit, side: l.debit ? "Dr" as const : "Cr" as const })) };
  const base = { invoice: { supplier: f.supplier, number: f.number, amount: f.amount, due: f.due }, recs: [TRY_SAMPLE_RECORD] };
  const run = rec?.runs?.find((r) => r.ok && r.approval && r.airwallex?.length);
  const signed = run?.airwallex?.find((t) => t.approval_sha256 === run.approval?.approval_sha256);
  const path = signed?.path.map((p) => p.status) ?? [];
  if (!run || !signed || !run.approval?.equals_transfer_metadata || path[path.length - 1] !== "PAID" || money(signed.amount) !== f.amount) return { ...base, steps: [read, booked], refused: null };
  const alone = run.airwallex!.find((t) => t !== signed && t.path.some((p) => p.status === "PAID"));
  const r = run.refusal;
  const refused: WorkflowStep | null = r?.outcome === "refused" && r.changed?.includes("amount") && r.transfers_before === r.transfers_after && r.signed_sha256 && r.sent_sha256
    ? { state: "refused", chip: "Refused · nothing paid", detail: `+EUR 0.01 after signing: signed ${short(r.signed_sha256)} ≠ sent ${short(r.sent_sha256)}` } : null;
  return {
    ...base, recs: [TRY_SAMPLE_RECORD, WORKFLOW_RECORD], refused,
    steps: [
      read,
      { state: "held", chip: "Held → sent to the CFO", detail: alone ? `Over the agent's limit (it paid ${money(alone.amount)} on its own)` : "Over the agent's limit" },
      { state: "approved", chip: "Approved with a passkey", detail: `Exact terms signed · sha256 ${short(signed.approval_sha256)} · test passkey` },
      { state: "paid", chip: "Paid · Airwallex sandbox", detail: `${path.join(" → ")} · the signed hash in Airwallex's record` },
      booked,
    ],
  };
}
/** The card. Each step is a fold, open: on a phone the script closes them to one line each, a tap opens one. */
export function workflowHtml(f: WorkflowFacts | null = workflowFacts()): string {
  if (!f) return "";
  const chip = (st: WorkflowStep) => `<span class="wf-c wf-${st.state}">${esc(st.chip)}</span>`;
  const titled = f.steps.length === WORKFLOW_STEPS.length ? WORKFLOW_STEPS : [WORKFLOW_STEPS[0]!, WORKFLOW_STEPS[4]!];
  const rows = (st: WorkflowStep) => (st.rows ? `<table class="wf-led"><tbody>${st.rows.map((l) => `<tr><th>${esc(l.code)}</th><td>${esc(l.name)}</td><td>${esc(l.amount)}<small>${l.side}</small></td></tr>`).join("")}</tbody></table>` : "");
  return `<div class="wf" role="group" aria-labelledby="wf-k" data-rec="${esc(f.recs.join(" "))}">
  <div class="wf-head"><p class="wf-k" id="wf-k">${esc(WORKFLOW_HEAD)}</p><span class="wf-tag">${esc(WORKFLOW_TAG)}</span></div>
  <div class="wf-inv">${icon("file-check", 16)}<span><b>${esc(f.invoice.supplier)}</b><small>${esc(`Invoice ${f.invoice.number} · due ${f.invoice.due}`)}</small></span><b class="wf-amt">${esc(f.invoice.amount)}</b></div>
  <ol class="wf-steps">${f.steps.map((st, i) => `<li class="wf-s wf-s${i}"><details open><summary><span class="wf-i">${icon(titled[i]!.icon, 18)}</span><span class="wf-t"><b>${esc(titled[i]!.title)}</b>${chip(st)}</span><span class="wf-ok">${icon("check", 14)}</span></summary><div class="wf-d"><small>${esc(st.detail)}</small>${rows(st)}</div></details></li>`).join("")}</ol>
  ${f.refused ? `<div class="wf-no"><span class="wf-x">${icon("ban", 16)}</span><span class="wf-t">${chip(f.refused)}<small>${esc(f.refused.detail)}</small></span></div>` : ""}
  <p class="wf-note">${esc(WORKFLOW_NOTE)} <a href="#real" data-real>${esc("What's real?")}</a></p>
</div>`;
}

/** On a phone the Workflow's steps start closed, one line each (state chip in sight); a tap opens one. */
export const WORKFLOW_JS = `
(function () {
  if (!window.matchMedia || !matchMedia("(max-width: 640px)").matches) return;
  [].forEach.call(document.querySelectorAll(".wf-s > details"), function (d) { d.open = false; });
})();`;

export const HERO_WAVE_HTML = `<canvas class="h-wave" aria-hidden="true"></canvas>`;

const LOOP = 10;
export const HERO_WAVE_CSS = `
/* The hero's ground (src/redesign/heroWave.ts): a still violet light, the wave drawn over it where motion is allowed. */
main.ent section.e-hero { isolation: isolate; }
.e-hero::before { content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none; background:
  radial-gradient(60% 55% at 78% 30%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
  radial-gradient(45% 40% at 18% 92%, color-mix(in srgb, var(--accent-ink) 22%, transparent), transparent 70%),
  radial-gradient(30% 30% at 95% 0%, color-mix(in srgb, #e879f9 14%, transparent), transparent 70%); }
canvas.h-wave { position: absolute; left: 0; top: 0; z-index: -1; width: 100%; height: min(100%, 900px); pointer-events: none;
  -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent), linear-gradient(90deg, rgba(0,0,0,.45), #000 55%); mask-image: linear-gradient(180deg, #000 70%, transparent), linear-gradient(90deg, rgba(0,0,0,.45), #000 55%);
  -webkit-mask-composite: source-in; mask-composite: intersect; }
@media (max-width: 1039px) { canvas.h-wave { height: min(100%, 760px); } }
/* A phone: the wave runs below the words, behind the buttons and the card, never through the figures. */
@media (max-width: 640px) { canvas.h-wave { top: 420px; height: 620px; -webkit-mask-image: linear-gradient(180deg, transparent, #000 22%, #000 70%, transparent); mask-image: linear-gradient(180deg, transparent, #000 22%, #000 70%, transparent); } }
@media (prefers-reduced-motion: reduce) { canvas.h-wave { display: none; } }

/* Three figures from the records. */
ul.hstats { list-style: none; margin: 28px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; max-width: 34em; }
ul.hstats li { padding: 0 18px; border-left: 1px solid var(--glass-line); }
ul.hstats a { display: grid; gap: 4px; align-content: start; min-height: 44px; padding: 2px 0; color: inherit; text-decoration: none; border-radius: 8px; }
ul.hstats a:hover span, ul.hstats a:focus-visible span { color: var(--text); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--accent) 60%, transparent); }
ul.hstats li:first-child { padding-left: 0; border-left: 0; }
ul.hstats b { font-size: clamp(26px, 2.6vw, 34px); line-height: 1.05; font-weight: 760; letter-spacing: -.03em; font-variant-numeric: tabular-nums; background: var(--grad-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
ul.hstats span { font-size: 13.5px; line-height: 1.35; color: var(--muted); }
@media (max-width: 420px) { ul.hstats li { padding: 0 10px; } ul.hstats span { font-size: 12.5px; } }

/* The Workflow card: glass over the wave, the invoice on top, five steps lit in turn, the refusal last. */
.wf { position: relative; padding: 16px 16px 4px; border-radius: var(--r-lg); background: linear-gradient(160deg, color-mix(in srgb, var(--surface) 46%, transparent), color-mix(in srgb, var(--surface) 20%, transparent)); border: 1px solid var(--glass-line); box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 40px 90px -40px var(--glow), 0 20px 50px -30px rgba(0, 0, 0, .55); -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4); }
.wf::before { content: ""; position: absolute; left: 14%; right: 14%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
@media (min-width: 1040px) { .wf { -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); } }
.wf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.wf-k { margin: 0; font: 600 12.5px/1.3 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
.wf-tag { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--glass-line); font-size: 12.5px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.wf-inv { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 10px; align-items: center; margin-bottom: 10px; padding: 8px 12px; border-radius: 14px; background: color-mix(in srgb, var(--text) 4%, transparent); border: 1px solid var(--glass-line); color: var(--muted); }
.wf-inv span { display: grid; min-width: 0; } .wf-inv b { color: var(--text); font-size: 14px; } .wf-inv small { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wf-inv .wf-amt { font-size: 17px; font-weight: 750; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
ol.wf-steps { position: relative; list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ol.wf-steps::before, ol.wf-steps::after { content: ""; position: absolute; left: 30px; top: 26px; bottom: 26px; width: 2px; border-radius: 2px; }
ol.wf-steps::before { background: color-mix(in srgb, var(--text) 10%, transparent); }
ol.wf-steps::after { background: linear-gradient(180deg, var(--accent), var(--ok)); box-shadow: 0 0 12px var(--accent); transform-origin: top; }
.wf-s { position: relative; z-index: 1; border-radius: 14px; border: 1px solid var(--glass-line); background: color-mix(in srgb, var(--surface) 40%, transparent); }
.wf-s summary { list-style: none; display: grid; grid-template-columns: 32px minmax(0, 1fr) 20px; gap: 10px; align-items: center; min-height: 44px; padding: 5px 10px; cursor: pointer; border-radius: 14px; }
.wf-s summary::-webkit-details-marker { display: none; }
.wf-s summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.wf-i { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; color: #fff; background: var(--grad); box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 8px 22px -8px var(--glow); }
.wf-t { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; }
.wf-t b { font-size: 14px; font-weight: 650; letter-spacing: -.01em; line-height: 1.3; }
.wf-d { padding: 0 10px 7px 52px; margin-top: -4px; display: grid; gap: 4px; }
.wf-d small, .wf-no small { font-size: 12px; color: var(--muted); line-height: 1.4; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.wf-no small { flex-basis: 100%; }
.wf-ok { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--ok); }
table.wf-led { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
table.wf-led th, table.wf-led td { padding: 2px 0; border-top: 1px solid var(--glass-line); text-align: left; font-weight: 500; }
table.wf-led th { font-family: var(--mono); color: var(--muted); width: 3.6em; } table.wf-led td:last-child { text-align: right; white-space: nowrap; } table.wf-led td small { margin-left: 5px; color: var(--faint); font-size: 11px; }
/* The state chips: proposed neutral, held amber, approved violet, paid green, booked green, refused red. */
.wf-c { padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; letter-spacing: .01em; line-height: 1.5; border: 1px solid; white-space: nowrap; }
.wf-proposed { color: var(--muted); border-color: var(--glass-line); background: color-mix(in srgb, var(--text) 5%, transparent); }
.wf-held { color: #fbbf24; border-color: color-mix(in srgb, #fbbf24 40%, transparent); background: color-mix(in srgb, #fbbf24 10%, transparent); }
.wf-approved { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.wf-paid, .wf-booked { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); background: color-mix(in srgb, var(--ok) 10%, transparent); }
.wf-refused { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); background: color-mix(in srgb, var(--bad) 10%, transparent); }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) .wf-held { color: #92400e; } }
:root[data-theme="light"] .wf-held { color: #92400e; }
.wf-no { margin: 6px 0 0; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; align-items: center; padding: 7px 10px; border-radius: 14px; border: 1px dashed color-mix(in srgb, var(--bad) 55%, var(--glass-line)); background: color-mix(in srgb, var(--bad) 9%, transparent); }
.wf-x { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, transparent); }
p.wf-note { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); }
p.wf-note a { color: var(--accent); font-weight: 650; display: inline-flex; align-items: center; min-height: 44px; }
/* The pulse that runs from one step into the next. */
.wf-s + .wf-s::after { content: ""; position: absolute; left: 28px; top: -8px; width: 4px; height: 4px; border-radius: 50%; background: #fff; box-shadow: 0 0 8px 2px var(--accent); opacity: 0; }
@media (max-width: 640px) { .wf { padding: 16px 14px 6px; } .wf-d { padding-left: 12px; } .wf-head { flex-wrap: wrap; } }
/* Each step lights in turn: its icon, the pulse into it, its tick, its chip and detail (wiped in, never faded, so the
   words keep their contrast in every frame); the rail fills; the refusal last. Still and all lit under reduced motion. */
@media (prefers-reduced-motion: no-preference) {
${Array.from({ length: 5 }, (_, i) => `  .wf-s${i} .wf-i { animation: wf-lit${i} ${LOOP}s ease-in-out infinite; } .wf-s${i} .wf-ok { animation: wf-ok${i} ${LOOP}s ease-in-out infinite; } .wf-s${i} .wf-c, .wf-s${i} .wf-d { animation: wf-in${i} ${LOOP}s ease-out infinite; }${i ? ` .wf-s${i}::after { animation: wf-pulse${i} ${LOOP}s ease-in-out infinite; }` : ""}`).join("\n")}
  .wf-no .wf-t, .wf-no .wf-x { animation: wf-no ${LOOP}s ease-out infinite; }
  ol.wf-steps::after { animation: wf-rail ${LOOP}s ease-in-out infinite; }
}
${Array.from({ length: 5 }, (_, i) => { const a = 3 + i * 14; return `@keyframes wf-lit${i} { 0%, ${a}% { opacity: .35; filter: saturate(.2); } ${a + 4}%, 94% { opacity: 1; filter: none; } 100% { opacity: .35; filter: saturate(.2); } }
@keyframes wf-ok${i} { 0%, ${a + 3}% { opacity: 0; transform: scale(.6); } ${a + 8}%, 94% { opacity: 1; transform: none; } 100% { opacity: 0; transform: scale(.6); } }
@keyframes wf-in${i} { 0%, ${a + 1}% { clip-path: inset(0 100% 0 0); } ${a + 8}%, 94% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
@keyframes wf-pulse${i} { 0%, ${a - 4}% { opacity: 0; transform: translateY(-14px); } ${a - 3}% { opacity: 1; } ${a}% { opacity: 1; transform: translateY(6px); } ${a + 1}%, 100% { opacity: 0; transform: translateY(6px); } }`; }).join("\n")}
@keyframes wf-rail { 0%, 3% { transform: scaleY(0); } 64%, 94% { transform: scaleY(1); } 100% { transform: scaleY(0); } }
@keyframes wf-no { 0%, 76% { clip-path: inset(0 100% 0 0); } 82%, 94% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
`;

/**
 * The wave: soft glowing points on two ribbons, the main one rising from the bottom left to the top right on three
 * layers at three speeds, a fainter counter-flow above it; a few brighter sparks that twinkle. Each point is one small
 * glow sprite drawn additively (dark) or plainly (light). The pointer, or a finger dragging over the hero, pushes the
 * points gently aside with a smooth falloff; a tap or click sends a ripple through them. The canvas never takes a click
 * (pointer-events: none): the listeners sit on the window and the hero, passive.
 */
export const HERO_WAVE_JS = `
(function () {
  var c = document.querySelector("canvas.h-wave"), mm = window.matchMedia;
  if (!c || !c.getContext || !mm || mm("(prefers-reduced-motion: reduce)").matches) return;
  var g = c.getContext("2d");
  if (!g) return;
  var host = c.parentElement, W = 0, H = 0, dpr = 1, z = 1, raf = 0, seen = true, t0 = performance.now();
  var ribbons = [], sprites = {}, ripples = [];
  var mx = -1e4, my = -1e4, px = -1e4, py = -1e4, box = null;
  var darkQ = mm("(prefers-color-scheme: dark)");
  function dark() { var a = document.documentElement.getAttribute("data-theme"); return a ? a === "dark" : darkQ.matches; }
  // One glow sprite per colour: a bright core and a soft halo, drawn once.
  function sprite(col) {
    var s = document.createElement("canvas"), n = 32; s.width = s.height = n;
    var x = s.getContext("2d"), gr = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, col); gr.addColorStop(0.18, col); gr.addColorStop(0.42, col.replace(/[\\d.]+\\)$/, "0.28)")); gr.addColorStop(1, col.replace(/[\\d.]+\\)$/, "0)"));
    x.fillStyle = gr; x.fillRect(0, 0, n, n); return s;
  }
  function rnd(i) { var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); }
  function scale() { var r = c.getBoundingClientRect(); return c.clientWidth ? r.width / c.clientWidth : 1; }
  function build() {
    W = c.clientWidth; H = c.clientHeight; z = scale() || 1;
    var phone = W < 700;
    dpr = Math.min((window.devicePixelRatio || 1) * z, 2 * Math.max(1, z));
    c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
    var k = phone ? 0.42 : 1, d = dark();
    sprites = d ? { a: sprite("rgba(139,92,246,1)"), b: sprite("rgba(196,181,253,1)"), c: sprite("rgba(245,243,255,1)"), d: sprite("rgba(232,121,249,1)") }
      : { a: sprite("rgba(167,139,250,1)"), b: sprite("rgba(139,92,246,1)"), c: sprite("rgba(109,40,217,1)"), d: sprite("rgba(192,132,252,1)") };
    // base: the ribbon's line (y at u = 0 and at u = 1, as shares of the height), its sway and thickness; dir: -1 flows back.
    ribbons = [
      { y0: 1.02, y1: 0.22, thick: 0.3, dir: 1, layers: [
        { rows: 16, cols: Math.round(150 * k), amp: 0.06, speed: 0.007, size: 2.2, a: 0.42, ph: 0, z: 0.75, s: "a" },
        { rows: 12, cols: Math.round(120 * k), amp: 0.08, speed: 0.012, size: 3, a: 0.6, ph: 1.7, z: 0.9, s: "b" },
        { rows: 7, cols: Math.round(90 * k), amp: 0.1, speed: 0.018, size: 3.8, a: 0.85, ph: 3.1, z: 1, s: "c" } ] },
      { y0: 0.5, y1: 0.02, thick: 0.16, dir: -1, layers: [
        { rows: 8, cols: Math.round(110 * k), amp: 0.05, speed: 0.006, size: 2.2, a: 0.3, ph: 4.2, z: 0.7, s: "d" },
        { rows: 5, cols: Math.round(80 * k), amp: 0.07, speed: 0.01, size: 3, a: 0.45, ph: 5.3, z: 0.85, s: "b" } ] }
    ];
    var id = 0;
    ribbons.forEach(function (R) { R.layers.forEach(function (L) { var n = L.rows * L.cols; L.vary = new Float32Array(n); L.spark = new Uint8Array(n);
      for (var i = 0; i < n; i++, id++) { L.vary[i] = 0.55 + rnd(id) * 0.9; L.spark[i] = rnd(id * 7.3) > 0.985 ? 1 : 0; } }); });
  }
  function frame(now) {
    raf = 0;
    var t = (now - t0) / 1000, d = dark();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = d ? "lighter" : "source-over";
    px += (mx - px) * 0.1; py += (my - py) * 0.1;
    ripples = ripples.filter(function (r) { return t - r.t < 2.2; });
    for (var q = 0; q < ribbons.length; q++) {
      var R = ribbons[q];
      for (var l = 0; l < R.layers.length; l++) {
        var L = R.layers[l], img = sprites[L.s], idx = 0;
        for (var r = 0; r < L.rows; r++) {
          var v = r / (L.rows - 1) - 0.5;
          for (var i = 0; i < L.cols; i++, idx++) {
            var u = ((i / L.cols + R.dir * t * L.speed + r * 0.013) % 1 + 1) % 1;
            var X = (-0.08 + u * 1.16) * W;
            var Y = H * (R.y0 + (R.y1 - R.y0) * u) + H * L.amp * (Math.sin(u * 6.2 + t * 0.45 + L.ph) + 0.3 * Math.sin(u * 13 - t * 0.3 + L.ph))
              + v * H * R.thick * L.z * (0.5 + 0.5 * Math.sin(u * 4.1 + t * 0.28 + L.ph)) * Math.cos(u * 3 + t * 0.35 + r * 0.15);
            // The pointer or a finger: a gentle push aside, smooth to nothing at 160 px.
            var dx = X - px, dy = Y - py, dd = dx * dx + dy * dy;
            if (dd < 25600) { var e = Math.sqrt(dd) + 1, f = 1 - e / 160; f = f * f * 26 * L.z; X += dx / e * f; Y += dy / e * f; }
            // A ripple: a ring that pushes the points outward as it passes.
            for (var w = 0; w < ripples.length; w++) { var rp = ripples[w], age = t - rp.t, rad = age * 420, ex = X - rp.x, ey = Y - rp.y, de = Math.sqrt(ex * ex + ey * ey) + 1, band = 1 - Math.abs(de - rad) / 70;
              if (band > 0) { var p = band * band * 16 * (1 - age / 2.2) * L.z; X += ex / de * p; Y += ey / de * p; } }
            var tw = L.spark[idx] ? 1.4 + 0.9 * Math.sin(t * 3 + idx) : 1;
            var a = L.a * L.vary[idx] * Math.min(1, u * 6, (1 - u) * 6) * (0.35 + 0.65 * Math.abs(Math.sin(u * 14 - t * 0.9 + r * 1.3 + L.ph))) * (1 - Math.abs(v) * 1.2) * (d ? 1 : 0.7) * (tw > 1 ? 1.6 : 1);
            if (a < 0.03) continue;
            var sz = L.size * L.vary[idx] * tw * (L.spark[idx] ? 1.8 : 1);
            g.globalAlpha = a > 1 ? 1 : a;
            g.drawImage(img, X - sz, Y - sz, sz * 2, sz * 2);
          }
        }
      }
    }
    g.globalAlpha = 1;
    go();
  }
  function go() { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  build(); go();
  if ("ResizeObserver" in window) new ResizeObserver(function () { build(); }).observe(c); else addEventListener("resize", build);
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { seen = es[0].isIntersecting; if (seen) go(); else stop(); }).observe(c);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else go(); });
  darkQ.addEventListener && darkQ.addEventListener("change", build);
  // Where the pointer or a finger is, in the canvas's own pixels; nothing here prevents a click, a tap or a scroll.
  function at(x, y) { if (!box) box = c.getBoundingClientRect(); var s = box.width / (c.clientWidth || 1) || 1; return [(x - box.left) / s, (y - box.top) / s]; }
  function move(x, y) { var p = at(x, y); if (p[1] < 0 || p[1] > H) { mx = my = -1e4; return; } mx = p[0]; my = p[1]; if (px < -1e3) { px = mx; py = my; } }
  function ripple(x, y) { var p = at(x, y); if (p[1] >= 0 && p[1] <= H && ripples.length < 4) ripples.push({ x: p[0], y: p[1], t: (performance.now() - t0) / 1000 }); }
  addEventListener("pointermove", function (e) { if (e.pointerType === "mouse" || e.pointerType === "pen") move(e.clientX, e.clientY); }, { passive: true });
  addEventListener("pointerdown", function (e) { ripple(e.clientX, e.clientY); }, { passive: true });
  if (host) {
    host.addEventListener("touchmove", function (e) { var p = e.touches[0]; if (p) move(p.clientX, p.clientY); }, { passive: true });
    host.addEventListener("touchend", function () { mx = my = -1e4; px = py = -1e4; }, { passive: true });
    host.addEventListener("mouseleave", function () { mx = my = -1e4; px = py = -1e4; });
  }
  addEventListener("scroll", function () { box = null; }, { passive: true });
  addEventListener("resize", function () { box = null; }, { passive: true });
})();`;
