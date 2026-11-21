// The top of /alta since 21 Nov (the owner, Max: "We must show the strongest points. Our Kit 11 point is: a supplier
// raises its price, and you see it refused on chain. That has to go at the top, not so much text."). One scene, played
// once: the Sourcing agent's mandate on chain (cap a payment), its last purchases paid under the cap, the supplier's
// price rise, and the next purchase refused on chain by Alta, with its transaction on the testnet explorer. Under
// prefers-reduced-motion nothing moves and the scene is its final frame. Then the architecture in four boxes.
//
// Every figure is read from the main run's record (docs/demo/main-run.json, through metalStory) and its trace
// (docs/demo/main-run-trace.json, through mandateRows and the payments): the cap and budget at the time (the first
// bind), the purchases paid before the refusal, the price before (the last paid purchase) and after (the refused one),
// the refusal's code and transaction, and whether Purser's own check was off for it (the record's upstream.let_through
// row: it was, for this one purchase, to prove the chain holds the cap). Without those rows the scene is not drawn.

import { readFileSync } from "node:fs";
import { EXPLORER, metalStory } from "./metalStory.js";
import { MAIN_RUN_TRACE, mandateRows } from "./metalMandates.js";
import type { RunRecord } from "./run.js";
import { esc, icon } from "./ui.js";

export const ALTA_SCENE_ID = "alta-scene";
export const ALTA_ARCH_ID = "alta-arch";

interface TracePayment { kind: string; ref: string; amount: string; rail: string; rail_id: string | null; at: string }
const TX = /^0x[0-9a-f]{64}$/i;
const cents = (s: string) => Math.round(Number(s) * 100);
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const txOf = (href: string | null | undefined) => (href ?? "").split("/").pop() ?? "";

export interface AltaScene {
  /** The agent whose mandate it is, and the supplier it pays. */
  agent: string; supplier: string;
  /** The mandate in force at the refusal (the first bind), and its transaction. */
  cap: string; budget: string; bindTx: string;
  /** The agent's last purchases paid under that mandate, oldest first (the trace's purchases numbered below the refusal). */
  paid: { ref: string; amount: string; tx: string }[];
  /** The supplier's price before (the last paid purchase) and after (the refused one). */
  before: string; after: string;
  refused: { seq: string; amount: string; code: string; tx: string };
  /** Purser's own check was off for this one purchase (the record's upstream.let_through row names what it would have refused). */
  ownCheckOff: boolean;
  /** After the refusal: the cap the CFO approved with Face ID, its proposal and the replace's transaction. */
  raised: { cap: string; proposal: string; tx: string } | null;
}

/** The scene from the main run's record and trace; null when the record does not show a refusal over the cap after a price rise. */
export function altaScene(record: RunRecord, trace: { mandates: never[]; payments: TracePayment[] } = JSON.parse(readFileSync(new URL(`../../${MAIN_RUN_TRACE}`, import.meta.url), "utf8"))): AltaScene | null {
  const st = metalStory(record), r = st.refusal;
  if (!r || r.code !== "mandate_cap_exceeded" || !TX.test(txOf(r.proof.href))) return null;
  const rows = mandateRows(record, trace as never), m = rows.find((x) => x.agent === r.agent);
  const at = m?.first ?? (m ? { cap: m.cap, budget: m.budget, tx: m.tx } : null);
  if (!m || !at || cents(r.amount) <= cents(at.cap)) return null;
  const paid = trace.payments.filter((p) => p.rail === "metal" && p.kind === "purchase" && /^\d+$/.test(p.ref) && Number(p.ref) < Number(r.seq) && typeof p.rail_id === "string" && TX.test(p.rail_id))
    .sort((a, b) => Number(a.ref) - Number(b.ref)).slice(-4).map((p) => ({ ref: p.ref, amount: p.amount, tx: p.rail_id! }));
  const last = paid.at(-1);
  // A price rise: the last purchase paid within the cap, at a lower price than the one refused.
  if (!last || paid.some((p) => cents(p.amount) > cents(at.cap)) || cents(last.amount) >= cents(r.amount)) return null;
  const events = record.ledger?.events ?? [];
  const ownCheckOff = events.some((e) => e.event === "upstream.let_through" && String(e.subject) === r.seq && /^mandate_cap_exceeded\b/.test(String(e.payload.purser_would_refuse ?? "")));
  const step = st.replace?.steps.find((s) => s.agent === r.agent);
  const raised = step && st.replace && TX.test(txOf(step.proof.href)) ? { cap: step.cap, proposal: st.replace.proposal, tx: txOf(step.proof.href) } : null;
  return { agent: `${r.agent[0]!.toUpperCase()}${r.agent.slice(1)} agent`, supplier: m.payee, cap: at.cap, budget: at.budget, bindTx: at.tx, paid, before: last.amount, after: r.amount,
    refused: { seq: r.seq, amount: r.amount, code: r.code, tx: txOf(r.proof.href) }, ownCheckOff, raised };
}

const ext = (href: string, text: string) => `<a class="pf" href="${esc(href)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`;

/** The chart: the purchases as bars on one price scale, the cap as a dashed line; the refused one crosses it. */
function sceneChart(s: AltaScene): string {
  const W = 360, H = 230, top = 34, base = 188, left = 8, right = 8;
  const max = Math.max(cents(s.after), cents(s.cap)) * 1.3;
  const y = (c: number) => Math.round((base - (c / max) * (base - top)) * 10) / 10;
  const bars = [...s.paid.map((p) => ({ ref: p.ref, amount: p.amount, ok: true })), { ref: s.refused.seq, amount: s.refused.amount, ok: false }];
  const slot = (W - left - right) / bars.length, bw = Math.min(46, slot * 0.56);
  const capY = y(cents(s.cap)), divX = Math.round((left + slot * s.paid.length) * 10) / 10;
  const g = bars.map((b, i) => {
    const cx = Math.round((left + slot * i + slot / 2) * 10) / 10, by = y(cents(b.amount)), x = Math.round((cx - bw / 2) * 10) / 10;
    const title = b.ok ? `#${b.ref}: ${b.amount}, within the ${s.cap} cap: paid` : `#${b.ref}: ${b.amount}, over the ${s.cap} cap: refused on chain`;
    return `<g class="as-b ${b.ok ? "ok" : "no"} b${i + 1}"><title>${esc(title)}</title><rect class="as-bar" x="${x}" y="${by}" width="${Math.round(bw * 10) / 10}" height="${Math.round((base - by) * 10) / 10}" rx="5"/>`
      + `<text class="as-v" x="${cx}" y="${by - 8}" text-anchor="middle">${esc(b.amount)}</text><text class="as-r" x="${cx}" y="${base + 20}" text-anchor="middle">#${esc(b.ref)}</text>`
      + (b.ok ? `<path class="as-tick" d="M${cx - 6},${base - 16} l4,4 l8,-9"/>` : `<path class="as-x" d="M${cx - 7},${base - 22} l14,14 M${cx + 7},${base - 22} l-14,14"/>`) + `</g>`;
  }).join("");
  const label = `${s.supplier}'s price per purchase: ${s.paid.map((p) => `#${p.ref} ${p.amount} paid`).join(", ")}; #${s.refused.seq} ${s.refused.amount}, over the mandate's ${s.cap} cap, refused on chain.`;
  return `<svg class="as-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
<line class="as-base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>${g}
<line class="as-cap" x1="0" y1="${capY}" x2="${W}" y2="${capY}"/><text class="as-capl" x="${left}" y="${capY - 7}">${esc(`mandate cap ${s.cap}`)}</text>
<g class="as-rise"><line x1="${divX}" y1="10" x2="${divX}" y2="${base}"/><text x="${divX}" y="6" text-anchor="middle">${esc("price rise")}</text></g>
</svg>`;
}

/** The scene: the steps beside the chart, the refusal's transaction, one honest line. Empty without a scene. */
export function altaSceneHtml(s: AltaScene | null): string {
  if (!s) return "";
  const steps = [
    `<li class="as-s s1"><span class="as-k">${icon("link-2", 16)}${esc("The mandate")}</span><b>${esc(`${s.agent} may pay ${s.supplier} up to ${s.cap} a purchase`)}</b><small>${esc(`budget ${s.budget}, on chain`)} ${ext(`${EXPLORER}/tx/${s.bindTx}`, "bind")}</small></li>`,
    `<li class="as-s s2"><span class="as-k">${icon("trending-up", 16)}${esc("The price rise")}</span><b>${esc(`${s.supplier}: ${s.before} → ${s.after} a stock check`)}</b></li>`,
    `<li class="as-s s3"><span class="as-k">${icon("ban", 16)}${esc("Refused on chain")}</span><b>${esc(`#${s.refused.seq}: ${s.refused.amount} over the ${s.cap} cap`)}</b><small>${esc(`${s.refused.code}; nothing moved.`)} ${ext(`${EXPLORER}/tx/${s.refused.tx}`, `tx ${short(s.refused.tx)}`)}</small></li>`,
  ].join("");
  const then = s.raised ? `<p class="as-then">${esc(`Then the CFO raised the cap to ${s.raised.cap} with Face ID (${s.raised.proposal}).`)} ${ext(`${EXPLORER}/tx/${s.raised.tx}`, "new mandate")}</p>` : "";
  const note = s.ownCheckOff ? `Purser refuses this before signing; for #${s.refused.seq} its check was off, to show the chain holds the cap. ` : "";
  return `<section class="ascene card" id="${ALTA_SCENE_ID}" aria-labelledby="as-h"><h2 class="as-h" id="as-h">${esc("A supplier raised its price")}</h2>
<div class="as-grid"><ol class="as-steps">${steps}</ol><figure class="as-fig">${sceneChart(s)}</figure></div>${then}
<p class="as-note">${esc(`${note}Alta testnet, test money (*USDZ).`)}</p></section>`;
}

/** Agent → Purser policy → Alta mandate contract → testnet: the two locks, in four boxes. */
export function altaArchHtml(): string {
  const box = (n: number, ic: string, t: string, sub: string, cls = "") => `<li class="aa-n${cls}" data-n="${n}"><span class="aa-ic">${icon(ic, 20)}</span><b>${esc(t)}</b><span>${esc(sub)}</span></li>`;
  return `<section class="aarch card" id="${ALTA_ARCH_ID}" aria-labelledby="aa-h"><h2 class="as-h" id="aa-h">${esc("Two locks on every payment")}</h2>
<ol class="aa-flow">${box(1, "bot", "Agent", "asks to pay, over x402")}${box(2, "shield-check", "Purser policy", "the CFO's rules, before signing", " lock")}${box(3, "link-2", "Alta mandate", "cap, budget, payee, expiry", " lock")}${box(4, "database", "Alta testnet", "pays, or records MandateRefused")}</ol></section>`;
}


/** The four boxes of an architecture with arrows between them (/alta's and /visa's), stacked on phones. */
export const ARCH_CSS = `.aarch { padding: 16px 20px; display: grid; gap: 12px; }
.aa-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 26px; counter-reset: aa; }
.aa-n { position: relative; display: grid; gap: 3px; align-content: start; padding: 12px; border-radius: 14px; background: var(--sunken); min-width: 0; }
.aa-n b { font-size: 15.5px; } .aa-n span:last-child { font-size: 14px; color: var(--muted); line-height: 1.35; }
.aa-n.lock { box-shadow: inset 0 0 0 2px var(--metal); }
.aa-ic { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--surface); color: var(--metal); }
.aa-n + .aa-n::before { content: ""; position: absolute; left: -22px; top: 50%; width: 18px; height: 2px; background: var(--faint); }
.aa-n + .aa-n::after { content: ""; position: absolute; left: -9px; top: calc(50% - 4px); border: 5px solid transparent; border-left-color: var(--faint); border-right: 0; }
@media (max-width: 760px) { .aa-flow { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .aa-n { grid-template-columns: 34px minmax(0, 1fr); column-gap: 10px; align-items: center; } .aa-ic { grid-row: span 2; }
  .aa-n + .aa-n::before { left: 28px; top: -16px; width: 2px; height: 14px; } .aa-n + .aa-n::after { left: 24px; top: -6px; border: 5px solid transparent; border-top-color: var(--faint); border-bottom: 0; } }
`;
export const ALTA_SCENE_CSS = `.ascene { padding: 18px 20px 14px; display: grid; gap: 12px; }
.as-h { margin: 0; font-size: clamp(19px, 2vw, 23px); font-weight: 760; letter-spacing: -.01em; }
.as-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 18px; align-items: center; }
@media (max-width: 760px) { .as-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; } .as-fig { order: -1; } }
.as-rise line { stroke: var(--faint); stroke-width: 1.5; stroke-dasharray: 2 4; } .as-rise text { fill: var(--muted); font: 700 13px Inter, system-ui, sans-serif; }
.as-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.as-s { display: grid; gap: 3px; padding: 10px 12px; border-radius: 14px; background: var(--sunken); border-left: 4px solid var(--border); min-width: 0; }
.as-s.s1 { border-left-color: var(--metal); } .as-s.s2 { border-left-color: var(--faint); } .as-s.s3 { border-left-color: var(--bad); background: var(--bad-soft); }
.as-k { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.as-s.s3 .as-k { color: var(--bad); }
.as-s b { font-size: 16.5px; line-height: 1.3; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.as-s small { font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.as-s a.pf, .as-then a.pf { font-size: 14px; display: inline-flex; align-items: center; min-height: 44px; vertical-align: middle; }
.as-fig { margin: 0; min-width: 0; }
.as-chart { display: block; width: 100%; max-width: 460px; height: auto; margin: 0 auto; overflow: visible; }
.as-base { stroke: var(--border); stroke-width: 2; }
.as-cap { stroke: var(--bad); stroke-width: 2; stroke-dasharray: 6 5; }
.as-capl { fill: var(--bad); font: 700 13px Inter, system-ui, sans-serif; }
.as-b.ok .as-bar { fill: var(--ok); } .as-b.no .as-bar { fill: var(--bad); }
.as-v { fill: var(--text); font: 700 15px Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.as-r { fill: var(--muted); font: 600 14px Inter, system-ui, sans-serif; }
.as-tick, .as-x { fill: none; stroke: #fff; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.as-then { margin: 0; font-size: 15px; color: var(--muted); }
.as-note { margin: 0; font-size: 14px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 10px; }
${ARCH_CSS}
/* Played once (the owner, 21 Nov): the mandate, the paid bars, the price rise, then the refusal. Nothing moves under
   reduced motion: the scene is its final frame. */
@media (prefers-reduced-motion: no-preference) {
  .ascene .as-s, .ascene .as-then { animation: as-in .5s ease-out both; }
  .ascene .s1 { animation-delay: .1s; } .ascene .s2 { animation-delay: 1.5s; } .ascene .s3 { animation-delay: 2.6s; } .ascene .as-then { animation-delay: 3.4s; }
  .ascene .as-bar { transform-box: fill-box; transform-origin: 50% 100%; animation: as-grow .45s ease-out both; }
  .ascene .as-b.b1 .as-bar { animation-delay: .4s; } .ascene .as-b.b2 .as-bar { animation-delay: .6s; } .ascene .as-b.b3 .as-bar { animation-delay: .8s; } .ascene .as-b.b4 .as-bar { animation-delay: 1s; }
  .ascene .as-b.no .as-bar { animation: as-grow .6s ease-out 1.8s both, as-flash .5s ease-out 2.6s 2; }
  .ascene .as-b .as-v, .ascene .as-b .as-r, .ascene .as-tick { animation: as-in .35s ease-out both; }
  .ascene .as-b.b1 .as-v, .ascene .as-b.b1 .as-r, .ascene .as-b.b1 .as-tick { animation-delay: .7s; } .ascene .as-b.b2 .as-v, .ascene .as-b.b2 .as-r, .ascene .as-b.b2 .as-tick { animation-delay: .9s; }
  .ascene .as-b.b3 .as-v, .ascene .as-b.b3 .as-r, .ascene .as-b.b3 .as-tick { animation-delay: 1.1s; } .ascene .as-b.b4 .as-v, .ascene .as-b.b4 .as-r, .ascene .as-b.b4 .as-tick { animation-delay: 1.3s; }
  .ascene .as-b.no .as-v, .ascene .as-b.no .as-r { animation: as-in .35s ease-out 2.2s both; }
  .ascene .as-x { animation: as-in .3s ease-out 2.6s both; }
  .ascene .as-cap, .ascene .as-capl { animation: as-in .5s ease-out .2s both; } .ascene .as-rise { animation: as-in .4s ease-out 1.5s both; }
  .aarch .aa-n { animation: as-in .45s ease-out both; } .aarch .aa-n:nth-child(2) { animation-delay: .12s; } .aarch .aa-n:nth-child(3) { animation-delay: .24s; } .aarch .aa-n:nth-child(4) { animation-delay: .36s; }
}
@keyframes as-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes as-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes as-flash { 50% { opacity: .45; } }`;
