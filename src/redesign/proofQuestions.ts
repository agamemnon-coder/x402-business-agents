// /proof by the questions a judge asks (the owner, 21 Nov: "/proof is now loose numbers, some outdated; organise it"):
// does money only move within limits, is the AI controlled, is it live on the partners, is it engineered well, can I
// verify it myself. Each section: the question, a short answer, the current figures as tiles (each the wall's tile from
// docs/evidence/evidence-wall.json, with its tag, its day and its record), the charts of what has a series, and folds
// for the detail and for the history: figures of earlier or superseded runs, labelled with their day, never shown as
// current. A wall tile on /proof sits in exactly one section (test/proof-structure.test.ts); a tile no section names
// falls into the section of its wall group, so a new tile is never dropped. The eval tile is whichever held-out round
// is newest (an "eval-vN" tile on /proof), never a version typed here.

import { onProof, TAG_WORDS, WALL_FILE, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { shortDay } from "../proof/recordDate.js";
import { esc } from "./ui.js";

export type QuestionId = "q-limits" | "q-ai" | "q-live" | "q-built" | "q-verify";
/** A block of tiles inside a section: its id (an anchor), its heading, the tile keys it shows in order. */
export interface QBlock { id: string; title: string; keys: (string | RegExp)[] }
export interface Question { id: QuestionId; nav: string; title: string; answer: string; blocks: QBlock[] }

export const EVAL_TILE = /^eval-v\d+$/;
export const QUESTIONS: readonly Question[] = [
  {
    id: "q-limits", nav: "Within limits?", title: "Does money only move within limits?",
    answer: "Code checks every proposal against the CFO's limits before anything is signed; the passkey signs a hash of the exact terms, so a payment changed after approval is refused. Below: what was tried on purpose, and what stopped it.",
    blocks: [
      { id: "pq-refused", title: "Refused before money moved", keys: ["red-team", "soak-negatives", "try-cent", "card-cent", "alta-series-refused", "alta-refusal", "visa-refused"] },
      { id: "signed", title: "Signatures cannot be forged", keys: ["tamper-matrix", "try-hash", "passkeys-onchain"] },
    ],
  },
  {
    id: "q-ai", nav: "AI controlled?", title: "Is the AI controlled?",
    answer: "Claude decides; code enforces. The held-out evals stand in a script that always says pay for the AI, so they measure the rules, not the model's good behaviour.",
    blocks: [{ id: "pq-ai", title: "Claude decides, code enforces", keys: [EVAL_TILE, "worst-case", "hostile-model", "claude-main", "try-claude", "try-held"] }],
  },
  {
    id: "q-live", nav: "Live on partners?", title: "Is it live on the partners?",
    answer: "Yes, in their sandboxes and on Alta's testnet, with test money: each figure has its day and its record. A sandbox PAID is the sandbox's simulation.",
    blocks: [
      { id: "pl-airwallex", title: "Airwallex", keys: ["soak-paid", "soak-fx", "try-transfers", "spend-bills", "approval-hash", "two-locks", "awx-statement", "late-failure", "awx-endpoints"] },
      { id: "pl-alta", title: "Alta", keys: ["alta-payments", "alta-series-paid", "alta-merkle", "clearing-load"] },
      { id: "pl-visa", title: "Visa via Airwallex's Airi", keys: ["visa-airi"] },
      { id: "pl-t0", title: "T:0", keys: ["t0-readback"] },
    ],
  },
  {
    id: "q-built", nav: "Engineered well?", title: "Is it engineered well?",
    answer: "Tested, measured, attacked on purpose and partly proved: each figure below is a committed record, with the command that makes it again.",
    blocks: [
      { id: "pq-tested", title: "Tested, proved, released", keys: ["coverage", "formal-dafny", "formal-tla", "assurance", "ci", "supply-chain", "openssf"] },
      { id: "pq-attacked", title: "Attacked and broken on purpose", keys: ["redteam-api", "chaos-money", "fuzzing"] },
      { id: "pq-site", title: "The public site", keys: ["site-quality", "webkit-try"] },
    ],
  },
  {
    id: "q-verify", nav: "Verify it yourself", title: "Can I verify it myself?",
    answer: "Yes: the records are in the repository, a proof file checks offline, and one command re-checks the site's figures against them.",
    blocks: [
      { id: "pq-recheck", title: "Re-checked from the records", keys: ["verify-all", "anchor", "try-proofs"] },
      { id: "pq-try", title: "The public /try, timed", keys: ["try-journeys", "try-sign-paid", "try-autopay", "try-refusal", "try-verify", "try-cost"] },
    ],
  },
];
/** Where a tile no block names goes: its wall group's section. */
/** Tiles told on another page only: the TAP interop run is on /visa (Max's last round, item 2). */
export const NEVER_ON_PROOF: ReadonlySet<string> = new Set(["tap-interop"]);
const GROUP_HOME: Record<string, QuestionId> = { "ev-rails": "q-live", "ev-forged": "q-limits", "ev-ai": "q-ai", "ev-attacked": "q-built", "ev-built": "q-verify", "ev-quality": "q-built", "ev-scale": "q-verify" };

/** The newest held-out eval tile on /proof (the highest N of the eval-vN tiles shown), or null. */
export function newestEvalKey(w: EvidenceWall): string | null {
  const keys = onProof(w).groups.flatMap((g) => g.tiles.map((t) => t.key)).filter((k) => EVAL_TILE.test(k));
  return keys.sort((a, b) => Number(b.slice(6)) - Number(a.slice(6)))[0] ?? null;
}

export interface Placed { q: Question; blocks: { block: QBlock; tiles: WallTile[] }[]; more: WallTile[]; superseded: WallTile[] }

/**
 * Every wall tile placed: the tiles on /proof in their section's blocks (each once); the tiles off /proof in their
 * section's folds, a held-out eval round older than the newest as superseded, any other as more results.
 */
export function placeTiles(w: EvidenceWall): Placed[] {
  const all = w.groups.flatMap((g) => g.tiles.map((t) => ({ t, group: g.id })));
  const shown = all.filter((x) => !x.t.offProof);
  const used = new Set<string>();
  const newestEval = newestEvalKey(w);
  const out = QUESTIONS.map((q) => ({ q, blocks: q.blocks.map((block) => ({ block, tiles: [] as WallTile[] })), more: [] as WallTile[], superseded: [] as WallTile[] }));
  for (const p of out) for (const b of p.blocks) for (const k of b.block.keys) {
    for (const { t } of shown.filter((x) => !used.has(x.t.key) && (typeof k === "string" ? x.t.key === k : k.test(x.t.key)))) { b.tiles.push(t); used.add(t.key); }
  }
  for (const { t, group } of shown.filter((x) => !used.has(x.t.key))) {
    const p = out.find((x) => x.q.id === (GROUP_HOME[group] ?? "q-verify"))!;
    p.blocks.at(-1)!.tiles.push(t);
    used.add(t.key);
  }
  for (const { t, group } of all.filter((x) => x.t.offProof && !NEVER_ON_PROOF.has(x.t.key))) {
    const p = out.find((x) => x.q.id === (EVAL_TILE.test(t.key) ? "q-ai" : group === "ev-forged" ? "q-limits" : GROUP_HOME[group] ?? "q-verify"))!;
    (EVAL_TILE.test(t.key) && newestEval && Number(t.key.slice(6)) < Number(newestEval.slice(6)) ? p.superseded : p.more).push(t);
  }
  for (const p of out) p.superseded.sort((a, b) => Number(b.key.slice(6)) - Number(a.key.slice(6)));
  return out;
}

const isExternal = (h: string) => /^https?:/.test(h);
/** A tile's day: the newest record it names, or "as built" when its record says no day (it is recomputed at each build). */
export const tileDay = (t: WallTile) => (t.asOf ? shortDay(t.asOf) : "as built");

/** One tile, as the wall draws it, with its day beside its tag. */
export function tileHtml(t: WallTile): string {
  return `<li class="ew-t${t.tone ? ` ${t.tone}` : ""}" data-wall="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}" title="${esc(t.note)}"${isExternal(t.href) ? ' target="_blank" rel="noopener"' : ""}><b class="ew-f">${esc(t.fig)}</b><span class="ew-l">${esc(t.label)}</span><span class="ew-k"><span class="ew-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span><time class="ew-d"${t.asOf ? ` datetime="${esc(t.asOf)}"` : ""}>${esc(tileDay(t))}</time><span class="ew-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></span></a></li>`;
}

/** A tile as a line in a fold: its figure, its words, its note, its day and its record. */
export function tileLine(t: WallTile, prefix = ""): string {
  return `<li${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}>${prefix ? `<span class="pq-was">${esc(prefix)}</span> ` : ""}<b>${esc(t.fig)}</b> ${esc(t.label)}: ${esc(t.note)} <span class="pq-day">${esc(tileDay(t))}</span> <a class="pf" href="${esc(t.href)}"${isExternal(t.href) ? ' target="_blank" rel="noopener"' : ""}>${esc("record")}${isExternal(t.href) ? "&nbsp;↗" : ""}</a></li>`;
}

/** What each section adds around its tiles: figures in a strip, charts, folds of detail, folds of history. */
export interface QExtras { lead?: string; charts?: string[]; after?: string; folds?: string[]; history?: string[] }

const fold = (id: string | null, summary: string, inner: string, cls = "pq-fold") => (inner.trim() ? `<details class="sumd ${cls}"${id ? ` id="${esc(id)}"` : ""}><summary>${esc(summary)}</summary>${inner}</details>` : "");

/** One section of /proof. */
export function questionHtml(p: Placed, x: QExtras = {}): string {
  const blocks = p.blocks.filter((b) => b.tiles.length).map((b) => `<div class="pq-b" id="${esc(b.block.id)}"><div class="pq-bh"><h3>${esc(b.block.title)}</h3><details class="ew-more"><summary>${esc("What each counts")}</summary><ul>${b.tiles.map((t) => tileLine(t)).join("")}</ul></details></div><ul class="ew-ts">${b.tiles.map(tileHtml).join("")}</ul></div>`).join("\n");
  const charts = (x.charts ?? []).filter(Boolean);
  const more = p.more.length ? fold(null, "More results from the records", `<ul class="pq-list">${p.more.map((t) => tileLine(t)).join("")}</ul>`) : "";
  const newest = p.q.id === "q-ai" ? p.blocks.flatMap((b) => b.tiles).find((t) => EVAL_TILE.test(t.key)) : undefined;
  const superseded = p.superseded.length ? `<ul class="pq-list">${p.superseded.map((t) => tileLine(t, `Superseded${newest ? ` by eval ${newest.key.slice(5)}` : ""}:`)).join("")}</ul>` : "";
  const history = [superseded, ...(x.history ?? [])].filter((h) => h.trim()).join("\n");
  return `<section class="ewall pq" id="${p.q.id}" aria-labelledby="h-${p.q.id}" data-rec="${esc(WALL_FILE)}">
<div class="pq-h"><span class="pq-n" aria-hidden="true"></span><h2 id="h-${p.q.id}">${esc(p.q.title)}</h2></div>
<p class="pq-a">${esc(p.q.answer)}</p>
${x.lead ?? ""}
${blocks}
${charts.length ? `<div class="pcharts${charts.length === 1 ? " one" : ""}">${charts.join("\n")}</div>` : ""}
${x.after ?? ""}
${(x.folds ?? []).join("\n")}
${more}
${fold(`${p.q.id}-history`, "History: earlier and superseded runs", history, "pq-fold pq-hist")}
</section>`;
}

/** The questions as a row of links under the drawing. */
export function questionNavHtml(): string {
  return `<nav class="pq-nav" aria-label="${esc("The questions this page answers")}">${QUESTIONS.map((q) => `<a href="#${q.id}"><span class="pq-nn" aria-hidden="true"></span>${esc(q.nav)}</a>`).join("")}</nav>`;
}

export const PROOF_QUESTIONS_CSS = `
.pq-nav { position: sticky; top: 64px; z-index: 30; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 0 10px; padding: 6px 0; background: var(--bg); }
.pq-nav::-webkit-scrollbar { display: none; }
.pq-nav a { flex: none; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px 0 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font-size: 14px; font-weight: 650; text-decoration: none; white-space: nowrap; }
.pq-nav a:hover, .pq-nav a:focus-visible { border-color: var(--accent); color: var(--accent); }
.pq-nav .pq-nn, .pq .pq-n { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 13px; font-weight: 750; flex: none; }
section.pq { margin: 0; padding: 26px 0 18px; border-top: 1px solid var(--border); scroll-margin-top: 120px; }
section.pq .pq-h { display: flex; align-items: center; gap: 10px; }
section.pq .pq-n { width: 32px; height: 32px; font-size: 15px; }
/* The questions' numbers are counters (CSS), not text: a figure in the page would need a record. */
.pq-nav { counter-reset: pqn; } .pq-nav .pq-nn::before { counter-increment: pqn; content: counter(pqn); }
.pqs { counter-reset: pqs; } section.pq .pq-n::before { counter-increment: pqs; content: counter(pqs); }
section.pq h2 { font-size: clamp(22px, 2.4vw, 30px); font-weight: 760; letter-spacing: -.015em; margin: 0; }
section.pq .pq-a { margin: 8px 0 14px; font-size: 16px; line-height: 1.5; color: var(--muted); max-width: 52em; }
section.pq .pq-b { padding: 10px 0 6px; scroll-margin-top: 120px; }
section.pq .pq-bh { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 12px; }
section.pq .pq-bh h3 { font-size: 16px; font-weight: 720; margin: 0; }
section.pq ul.ew-ts { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
section.pq .ew-k { flex-wrap: wrap; }
section.pq .ew-d { font-size: 12px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; margin-right: auto; }
section.pq details.pq-fold { margin: 10px 0 0; }
section.pq details.pq-fold > summary { font-size: 15.5px; }
section.pq ul.pq-list { list-style: none; margin: 6px 0 10px; padding: 0; display: grid; gap: 8px; font-size: 14px; line-height: 1.45; color: var(--muted); max-width: 64em; }
section.pq ul.pq-list li { border-left: 3px solid var(--border); padding-left: 10px; }
section.pq ul.pq-list b { color: var(--text); font-variant-numeric: tabular-nums; }
section.pq .pq-was { font-weight: 700; color: var(--text); }
section.pq .pq-day { white-space: nowrap; font-weight: 650; color: var(--text); }
section.pq ul.scale { margin: 6px 0 12px; }
@media (max-width: 760px) { section.pq ul.ew-ts { grid-template-columns: repeat(2, minmax(0, 1fr)); } section.pq .pq-a { font-size: 15px; } }
`;
