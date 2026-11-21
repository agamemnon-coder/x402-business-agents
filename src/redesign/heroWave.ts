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
// it is drawn once, a still frame, over the still violet gradient. The card's lights are CSS (opacity and
// transform), still and all lit under reduced motion.

import { readFileSync } from "node:fs";
import { committedWall, type EvidenceWall } from "./evidenceWall.js";
import { waveScript } from "../ui/wave.js";
import { FLOW, READER_CHIP, TRY_SAMPLE_RECORD } from "./heroFlow.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";
import { proofSection } from "./proofSections.js";
// 21 Nov (jury check): the sample card names the run its figures come from, since /try's sample today has a later due date.
const RUN_DAY = (/(\d{4})-(\d{2})-(\d{2})/.exec(TRY_SAMPLE_RECORD) ?? []).slice(2, 4).reverse().map(Number).join(" ").replace(/ 11$/, " Nov");

/** The hero's three figures (Max: tests passing, sandbox and testnet runs, policy blocks), each a wall tile by key. */
export const HERO_STATS: readonly { key: string; words: string }[] = [
  { key: "verify-all", words: "checks passed" },
  { key: "try-transfers", words: "sandbox transfers" },
  { key: "red-team", words: "attacks stopped" },
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
    return [{ value, words: s.words, rec: t.rec, href: `proof#${proofSection(group)}`, source: `${t.fig} ${t.label}${t.asOf ? ` (${t.asOf})` : ""}. Record: ${t.rec}` }];
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
/** 21 Nov, later (owner: say what competitors advertise): the label says /try needs no account; the note under the card
 * still says these are two recorded /try runs. */
export const WORKFLOW_TAG = "Sandbox · no account needed";
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
export interface WorkflowStep { state: WorkflowState; chip: string; detail: string; rec?: string; rows?: readonly { code: string; name: string; amount: string; side: "Dr" | "Cr" }[] }
export interface WorkflowFacts { invoice: { supplier: string; number: string; amount: string; due: string }; steps: WorkflowStep[]; refused: WorkflowStep | null; recs: string[] }
const money = (a: string) => { const m = /^([A-Z]{3}) (\d+)\.(\d{2})$/.exec(a); return m ? `${m[1]} ${Number(m[2]).toLocaleString("en-GB")}.${m[3]}` : a; };
const short = (h: string) => `${h.slice(0, 8)}…`;
export function workflowFacts(rec: { runs?: TryRun[] } | null = (() => { try { return JSON.parse(readFileSync(new URL(`../../${WORKFLOW_RECORD}`, import.meta.url), "utf8")) as { runs?: TryRun[] }; } catch { return null; } })()): WorkflowFacts | null {
  const f = FLOW;
  const read: WorkflowStep = { state: "proposed", rec: TRY_SAMPLE_RECORD, chip: "Proposed by agent", detail: `${READER_CHIP}: payee, amount, due date and account ${f.account} checked` };
  const booked: WorkflowStep = { state: "booked", rec: TRY_SAMPLE_RECORD, chip: "Booked", detail: "Three lines, debit equals credit", rows: f.ledger.map((l) => ({ code: l.code, name: l.name, amount: l.debit || l.credit, side: l.debit ? "Dr" as const : "Cr" as const })) };
  const base = { invoice: { supplier: f.supplier, number: f.number, amount: f.amount, due: f.due }, recs: [TRY_SAMPLE_RECORD] };
  const run = rec?.runs?.find((r) => r.ok && r.approval && r.airwallex?.length);
  const signed = run?.airwallex?.find((t) => t.approval_sha256 === run.approval?.approval_sha256);
  const path = signed?.path.map((p) => p.status) ?? [];
  if (!run || !signed || !run.approval?.equals_transfer_metadata || path[path.length - 1] !== "PAID" || money(signed.amount) !== f.amount) return { ...base, steps: [read, booked], refused: null };
  const alone = run.airwallex!.find((t) => t !== signed && t.path.some((p) => p.status === "PAID"));
  const r = run.refusal;
  const refused: WorkflowStep | null = r?.outcome === "refused" && r.changed?.includes("amount") && r.transfers_before === r.transfers_after && r.signed_sha256 && r.sent_sha256
    ? { state: "refused", rec: WORKFLOW_RECORD, chip: "Refused · nothing paid", detail: `+EUR 0.01 after signing: signed ${short(r.signed_sha256)} ≠ sent ${short(r.sent_sha256)}` } : null;
  return {
    ...base, recs: [TRY_SAMPLE_RECORD, WORKFLOW_RECORD], refused,
    steps: [
      read,
      { state: "held", rec: WORKFLOW_RECORD, chip: "Held → sent to the CFO", detail: alone ? `Over the agent's limit (it paid ${money(alone.amount)} on its own)` : "Over the agent's limit" },
      { state: "approved", rec: WORKFLOW_RECORD, chip: "Approved with a passkey", detail: `Exact terms signed · sha256 ${short(signed.approval_sha256)} · test passkey` },
      { state: "paid", rec: WORKFLOW_RECORD, chip: "Paid · Airwallex sandbox, test money", detail: `${path.join(" → ")} · the signed hash in Airwallex's record` },
      booked,
    ],
  };
}
/** The card. Each step is a fold, open: on a phone the script closes them to one line each, a tap opens one. */
export function workflowHtml(f: WorkflowFacts | null = workflowFacts()): string {
  if (!f) return "";
  const chip = (st: WorkflowStep) => `<span class="wf-c wf-${st.state}">${esc(st.chip)}</span>`;
  const titled = f.steps.length === WORKFLOW_STEPS.length ? WORKFLOW_STEPS : [WORKFLOW_STEPS[0]!, WORKFLOW_STEPS[4]!];
  // Every figure to the record it comes from (Max, 21 Nov: "every figure links to where it comes from").
  const recA = (rec: string | undefined, label = "record") => (rec ? ` <a class="wf-rec" href="${esc(REPO_BLOB + rec)}" target="_blank" rel="noopener" title="${esc(rec)}">${esc(label)}</a>` : "");
  const rows = (st: WorkflowStep) => (st.rows ? `<table class="wf-led"><tbody>${st.rows.map((l) => `<tr><th>${esc(l.code)}</th><td>${esc(l.name)}</td><td>${esc(l.amount)}<small>${l.side}</small></td></tr>`).join("")}</tbody></table>` : "");
  return `<div class="wf" role="group" aria-labelledby="wf-k" data-rec="${esc(f.recs.join(" "))}">
  <div class="wf-head"><p class="wf-k" id="wf-k">${esc(WORKFLOW_HEAD)}</p><span class="wf-tag">${esc(WORKFLOW_TAG)}</span></div>
  <div class="wf-inv">${icon("file-check", 16)}<span><b>${esc(f.invoice.supplier)}</b><small>${esc(`Invoice ${f.invoice.number} · due ${f.invoice.due} · as in the run of ${RUN_DAY}`)}</small></span><a class="wf-amt" href="${esc(REPO_BLOB + TRY_SAMPLE_RECORD)}" target="_blank" rel="noopener" title="${esc(TRY_SAMPLE_RECORD)}">${esc(f.invoice.amount)}</a></div>
  <ol class="wf-steps">${f.steps.map((st, i) => `<li class="wf-s wf-s${i}"><details open><summary><span class="wf-i">${icon(titled[i]!.icon, 18)}</span><span class="wf-t"><b>${esc(titled[i]!.title)}</b>${chip(st)}</span><span class="wf-ok">${icon("check", 14)}</span></summary><div class="wf-d"><small>${esc(st.detail)}${recA(st.rec)}</small>${rows(st)}</div></details></li>`).join("")}</ol>
  ${f.refused ? `<div class="wf-no"><span class="wf-x">${icon("ban", 16)}</span><span class="wf-t">${chip(f.refused)}<small>${esc(f.refused.detail)}${recA(f.refused.rec)}</small></span></div>` : ""}
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
canvas.h-wave { position: absolute; left: 0; top: 0; z-index: -1; width: 100%; height: min(100%, 940px); pointer-events: none;
  -webkit-mask-image: linear-gradient(180deg, #000 78%, transparent); mask-image: linear-gradient(180deg, #000 78%, transparent); }
@media (max-width: 1039px) { canvas.h-wave { height: min(100%, 760px); } }
/* A phone: the wave runs below the words, behind the buttons and the card, never through the figures. */
@media (max-width: 640px) { canvas.h-wave { top: 0; height: min(100%, 1100px); -webkit-mask-image: linear-gradient(180deg, #000 80%, transparent); mask-image: linear-gradient(180deg, #000 80%, transparent); } }

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
.wf-rec { padding: 15px 2px; color: var(--accent); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); text-underline-offset: 2px; white-space: nowrap; } a.wf-amt { display: inline-flex; align-items: center; min-height: 44px; margin: -9px 0; color: inherit; text-decoration: none; font-weight: 700; } a.wf-amt:hover { text-decoration: underline; }
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
@media (max-width: 640px) { .wf { padding: 16px 14px 6px; } .wf-d { padding-left: 12px; } .wf-head { flex-wrap: wrap; } .wf-inv small { white-space: normal; } }
/* Each step lights in turn: its icon, the pulse into it, its tick, its chip and detail (wiped in, never faded, so the
   words keep their contrast in every frame); the rail fills; the refusal last. Still and all lit under reduced motion. */
@media (prefers-reduced-motion: no-preference) {
${Array.from({ length: 5 }, (_, i) => `  .wf-s${i} .wf-i { animation: wf-lit${i} ${LOOP}s ease-in-out infinite; } .wf-s${i} .wf-ok { animation: wf-ok${i} ${LOOP}s ease-in-out infinite; } .wf-s${i} .wf-c, .wf-s${i} .wf-d { animation: wf-in${i} ${LOOP}s ease-out infinite; }${i ? ` .wf-s${i}::after { animation: wf-pulse${i} ${LOOP}s ease-in-out infinite; }` : ""}`).join("\n")}
  .wf-no { animation: wf-no ${LOOP}s ease-out infinite; }
  ol.wf-steps::after { animation: wf-rail ${LOOP}s ease-in-out infinite; }
}
${Array.from({ length: 5 }, (_, i) => { const a = 3 + i * 14; return `@keyframes wf-lit${i} { 0%, ${a}% { opacity: .35; filter: saturate(.2); } ${a + 4}%, 94% { opacity: 1; filter: none; } 100% { opacity: .35; filter: saturate(.2); } }
@keyframes wf-ok${i} { 0%, ${a + 3}% { opacity: 0; transform: scale(.6); } ${a + 8}%, 94% { opacity: 1; transform: none; } 100% { opacity: 0; transform: scale(.6); } }
@keyframes wf-in${i} { 0%, ${a + 1}% { clip-path: inset(0 100% 0 0); } ${a + 8}%, 94% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
@keyframes wf-pulse${i} { 0%, ${a - 4}% { opacity: 0; transform: translateY(-14px); } ${a - 3}% { opacity: 1; } ${a}% { opacity: 1; transform: translateY(6px); } ${a + 1}%, 100% { opacity: 0; transform: translateY(6px); } }`; }).join("\n")}
@keyframes wf-rail { 0%, 3% { transform: scaleY(0); } 64%, 94% { transform: scaleY(1); } 100% { transform: scaleY(0); } }
@keyframes wf-no { 0%, 76% { clip-path: inset(0 100% 0 0); } 82%, 94% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(0 100% 0 0); } }
`;

/** Home's hero mounts the site's wave (src/ui/wave.ts) on its canvas, calm behind the headline. */
export const HERO_WAVE_JS = waveScript({ selector: "canvas.h-wave", placement: "hero" });
