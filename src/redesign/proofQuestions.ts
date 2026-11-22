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
import { picon } from "./proofIcons.js";
import { PROOF_SECTION_OF_GROUP } from "./proofSections.js";

export type QuestionId = "q-live" | "q-approvals" | "q-limits" | "q-books" | "q-ai" | "q-security" | "q-built" | "q-verify";
/** A block of tiles inside a section: its id (an anchor), its heading, the tile keys it shows in order. */
export interface QBlock { id: string; title: string; keys: (string | RegExp)[] }
export interface Question { id: QuestionId; nav: string; title: string; answer: string; icon: string; blocks: QBlock[] }

export const EVAL_TILE = /^eval-v\d+$/;
// 21 Nov (Max, his mockup: "because we have so much, divide it nicely per category, the numbers in a nice visual"): the
// sections by category, in this order (before: by the question a judge asks, five sections). The block ids stay, so the
// partner pages' strips and the stages still land.
export const QUESTIONS: readonly Question[] = [
  {
    id: "q-live", nav: "Payments", title: "Payments and rails", icon: "arrow-left-right",
    answer: "Live in the partners' sandboxes and on Alta's testnet, with test money; each figure has its day and its record. A sandbox PAID is the sandbox's simulation.",
    blocks: [
      { id: "pl-airwallex", title: "Airwallex", keys: ["soak-paid", "soak-fx", "try-transfers", "late-failure", "awx-endpoints"] },
      { id: "pl-alta", title: "Alta", keys: ["alta-payments", "alta-series-paid", "alta-merkle", "clearing-load"] },
      { id: "pl-visa", title: "Visa via Airwallex's Airi", keys: ["visa-airi"] },
      { id: "pq-try", title: "The public /try, timed", keys: ["try-journeys", "try-sign-paid", "try-autopay", "try-refusal"] },
      // 21 Nov, later (owner: show what competitors advertise): performance and concurrency, each from its record.
      { id: "pq-load", title: "Under load", keys: ["try-at-once", "try-at-once-poll", "clearing-rate", "soak-latency", "holds-at-once", "try-load-local"] },
    ],
  },
  {
    id: "q-approvals", nav: "Approvals", title: "Approvals and passkeys", icon: "scan-face",
    answer: "Above the limit the CFO's passkey signs a hash of the exact terms; the hash travels with the payment, and a copy changed after the signature is refused.",
    blocks: [
      { id: "signed", title: "Signatures cannot be forged", keys: ["tamper-matrix", "try-hash", "approval-hash", "two-locks", "passkeys-onchain"] },
      { id: "pq-cent", title: "One cent changed after approval", keys: ["try-cent", "soak-negatives"] },
    ],
  },
  {
    id: "q-limits", nav: "Policy", title: "Policy and limits", icon: "shield",
    answer: "Code checks every proposal against the CFO's limits before anything is signed; what is over a limit is refused before money moves. Below: what was tried on purpose, and what stopped it.",
    blocks: [{ id: "pq-refused", title: "Refused before money moved", keys: ["alta-series-refused", "alta-refusal", "visa-refused", "card-cent", "try-held"] }],
  },
  {
    id: "q-books", nav: "Books", title: "Books and T:0", icon: "book-open",
    answer: "Each payment is posted to the books as journal entries and matched to the partner's own statement, to the cent.",
    blocks: [
      { id: "pl-t0", title: "T:0", keys: ["t0-readback"] },
      { id: "pq-statement", title: "Matched to the partner's records", keys: ["awx-statement", "spend-bills"] },
    ],
  },
  {
    id: "q-ai", nav: "AI", title: "AI and evals", icon: "bot",
    answer: "Claude decides; code enforces. The held-out evals stand in a script that always says pay for the AI, so they measure the rules, not the model's good behaviour.",
    blocks: [{ id: "pq-ai", title: "Claude decides, code enforces", keys: [EVAL_TILE, "worst-case", "hostile-model", "claude-main", "try-claude", "try-cost"] }],
  },
  {
    id: "q-security", nav: "Security", title: "Security and red team", icon: "shield-check",
    answer: "Attacked and broken on purpose: our own red team, the public API, chaos and fuzzing. Internal tests, each a committed record with the command that makes it again.",
    blocks: [
      { id: "pq-attacked", title: "Attacked and broken on purpose", keys: ["red-team", "redteam-api", "chaos-money", "fuzzing"] },
      { id: "pq-site", title: "The public site", keys: ["site-quality", "webkit-try"] },
    ],
  },
  {
    id: "q-built", nav: "CI and proofs", title: "CI and formal methods", icon: "git-branch",
    answer: "Tested, measured and partly proved: each figure below is a committed record, with the command that makes it again.",
    blocks: [{ id: "pq-tested", title: "Tested, proved, released", keys: ["coverage", "formal-dafny", "formal-tla", "assurance", "ci", "supply-chain", "openssf"] }],
  },
  {
    id: "q-verify", nav: "Verify", title: "Verify it yourself", icon: "badge-check",
    answer: "The records are in the repository, a proof file checks offline, and one command re-checks the site's figures against them.",
    blocks: [{ id: "pq-recheck", title: "Re-checked from the records", keys: ["verify-all", "anchor", "try-proofs", "try-verify"] }],
  },
];
/**
 * The /proof anchor where a wall tile is shown: the block that names it (a tile can sit in another section than its wall
 * group's: the red team's tile is in group ev-ai but shown under "Attacked and broken on purpose", #pq-attacked), else its
 * wall group's section. Outside audit, 22 November: Home's "48 attacks stopped" linked to #q-ai, which does not show 48.
 */
export function tileAnchor(key: string, group: string): string {
  const block = QUESTIONS.flatMap((q) => q.blocks).find((b) => b.keys.some((k) => (typeof k === "string" ? k === key : k.test(key))));
  return block?.id ?? PROOF_SECTION_OF_GROUP[group] ?? group;
}
/** Where a tile no block names goes: its wall group's section. */
/** Tiles told on another page only: the TAP interop run is on /visa (Max's last round, item 2). */
export const NEVER_ON_PROOF: ReadonlySet<string> = new Set(["tap-interop"]);
export const GROUP_HOME: Record<string, QuestionId> = PROOF_SECTION_OF_GROUP as Record<string, QuestionId>;

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
    const p = out.find((x) => x.q.id === (EVAL_TILE.test(t.key) ? "q-ai" : GROUP_HOME[group] ?? "q-verify"))!;
    (EVAL_TILE.test(t.key) && newestEval && Number(t.key.slice(6)) < Number(newestEval.slice(6)) ? p.superseded : p.more).push(t);
  }
  for (const p of out) p.superseded.sort((a, b) => Number(b.key.slice(6)) - Number(a.key.slice(6)));
  return out;
}

const isExternal = (h: string) => /^https?:/.test(h);
/** A tile's day: the newest record it names, or "as built" when its record says no day (it is recomputed at each build). */
export const tileDay = (t: WallTile) => (t.asOf ? shortDay(t.asOf) : "as built");

/**
 * A tile's figure as a small drawing (Max, 21 Nov: "the numbers in a nice visual"), read from the figure itself and
 * never from a number typed here: a whole ("All 60", "Both") a closed ring; "65 of 67", or a count whose words say
 * "of 72", a ring that far round; a percentage a meter; "11 vs 72" two bars; anything else an icon of its kind.
 */
export type FigShape = { kind: "ring"; f: number } | { kind: "meter"; f: number } | { kind: "pair"; a: number; b: number } | { kind: "drop"; a: number; b: number } | { kind: "icon"; name: string };
const num = (s: string) => Number(s.replace(/,/g, ""));
export function figShape(t: Pick<WallTile, "fig" | "label" | "tag">): FigShape {
  const f = t.fig.trim();
  if (/^(?:All [\d,]+|Both)$/.test(f)) return { kind: "ring", f: 1 };
  let m = /^([\d,]+) of ([\d,]+)$/.exec(f);
  if (m && num(m[2]!) > 0) return { kind: "ring", f: Math.min(1, num(m[1]!) / num(m[2]!)) };
  m = /^([\d,]+)$/.exec(f);
  const of = /,? of ([\d,]+)$/.exec(t.label);
  if (m && of && num(of[1]!) >= num(m[1]!) && num(of[1]!) > 0) return { kind: "ring", f: num(m[1]!) / num(of[1]!) };
  m = /^([\d.]+)%$/.exec(f);
  if (m) return { kind: "meter", f: Math.min(1, Number(m[1]) / 100) };
  m = /^([\d,]+) vs ([\d,]+)$/.exec(f);
  if (m) return { kind: "pair", a: num(m[1]!), b: num(m[2]!) };
  // 22 Nov: a blind run → the rerun after its fixes (the newest held-out eval).
  m = /^([\d,]+) → ([\d,]+)$/.exec(f);
  if (m) return { kind: "drop", a: num(m[1]!), b: num(m[2]!) };
  if (/\d s$/.test(f)) return { kind: "icon", name: "clock" };
  if (/^(?:EUR|USD|GBP) /.test(f)) return { kind: "icon", name: "coins" };
  if (/^#/.test(f)) return { kind: "icon", name: "hash" };
  return { kind: "icon", name: ({ testnet: "link-2", ci: "git-branch", check: "circle-check", external: "badge-check", test: "flask-conical", site: "globe", measured: "sliders-horizontal", sandbox: "zap" } as Record<string, string>)[t.tag] ?? "circle-dot" };
}
const R = 15, C = 2 * Math.PI * R;
/** The drawing for a tile (aria-hidden: the figure is the text beside it). */
export function figVisual(t: Pick<WallTile, "fig" | "label" | "tag">): string {
  const s = figShape(t);
  if (s.kind === "ring") {
    const on = Math.round(s.f * C * 100) / 100;
    return `<span class="ew-v ring${s.f >= 1 ? " full" : ""}" aria-hidden="true"><svg viewBox="0 0 40 40" width="40" height="40"><circle class="tr" cx="20" cy="20" r="${R}"/><circle class="ar" cx="20" cy="20" r="${R}" stroke-dasharray="${on} ${Math.round(C * 100) / 100}" transform="rotate(-90 20 20)"/>${s.f >= 1 ? `<path class="ck" d="M14 20.5l4 4 8-8.5"/>` : ""}</svg></span>`;
  }
  if (s.kind === "meter") return `<span class="ew-v bar" aria-hidden="true"><svg viewBox="0 0 100 8" width="100" height="8" preserveAspectRatio="none"><rect class="tr" x="0" y="0" width="100" height="8" rx="4"/><rect class="ar" x="0" y="0" width="${Math.round(s.f * 1000) / 10}" height="8" rx="4"/></svg></span>`;
  if (s.kind === "drop") {
    const top = Math.max(s.a, s.b, 1), w = (n: number) => Math.max(2, Math.round((n / top) * 1000) / 10);
    return `<span class="ew-v pair drop" aria-hidden="true"><svg viewBox="0 0 100 18" width="100" height="18" preserveAspectRatio="none"><rect class="wa" x="0" y="0" width="${w(s.a)}" height="7" rx="3.5"/><rect class="ar" x="0" y="11" width="${w(s.b)}" height="7" rx="3.5"/></svg></span>`;
  }
  if (s.kind === "pair") {
    const top = Math.max(s.a, s.b, 1), w = (n: number) => Math.max(2, Math.round((n / top) * 1000) / 10);
    return `<span class="ew-v pair" aria-hidden="true"><svg viewBox="0 0 100 18" width="100" height="18" preserveAspectRatio="none"><rect class="ar" x="0" y="0" width="${w(s.a)}" height="7" rx="3.5"/><rect class="nb" x="0" y="11" width="${w(s.b)}" height="7" rx="3.5"/></svg></span>`;
  }
  return `<span class="ew-v ic" aria-hidden="true">${picon(s.name, 20)}</span>`;
}

/** A tile's figure as text; "14 → 0" with the blind run's figure in amber and the rerun's in green (22 Nov). */
const figText = (fig: string) => {
  const m = /^([\d,]+) → ([\d,]+)$/.exec(fig.trim());
  return m ? `<span class="ew-was">${esc(m[1]!)}</span> → <span class="ew-now">${esc(m[2]!)}</span>` : esc(fig);
};

/** One tile, as the wall draws it, with its day beside its tag, and its figure as a small drawing. */
export function tileHtml(t: WallTile): string {
  return `<li class="ew-t${t.tone ? ` ${t.tone}` : ""}" data-wall="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}" title="${esc(t.note)}"${isExternal(t.href) ? ' target="_blank" rel="noopener"' : ""}>${figVisual(t)}<b class="ew-f">${figText(t.fig)}</b><span class="ew-l">${esc(t.label)}</span><span class="ew-k"><span class="ew-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span><time class="ew-d"${t.asOf ? ` datetime="${esc(t.asOf)}"` : ""}>${esc(tileDay(t))}</time><span class="ew-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></span></a></li>`;
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
  // 21 Nov (review: fifteen "Superseded" lines crowd the page, and an older round's lower figure next to the newest reads
  // like a regression): one line says what the rounds are; every earlier round stays, as recorded, one fold further in.
  const superseded = p.superseded.length ? `<p class="pq-sup">${esc(`${p.superseded.length + (newest ? 1 : 0)} held-out rounds, each written after the last fixes; the newest is the honest one${newest ? ` (eval ${newest.key.slice(5)}, above)` : ""}. In each, a script that always says pay stands in for the AI: the worst case, not Claude.`)}</p>${fold(null, "Every earlier round, as recorded", `<ul class="pq-list">${p.superseded.map((t) => tileLine(t, `Superseded${newest ? ` by eval ${newest.key.slice(5)}` : ""}:`)).join("")}</ul>`, "pq-fold pq-sups")}` : "";
  const history = [superseded, ...(x.history ?? [])].filter((h) => h.trim()).join("\n");
  return `<section class="ewall pq" id="${p.q.id}" aria-labelledby="h-${p.q.id}" data-rec="${esc(WALL_FILE)}">
<div class="pq-h"><span class="pq-ic" aria-hidden="true">${picon(p.q.icon, 22)}</span><h2 id="h-${p.q.id}">${esc(p.q.title)}</h2></div>
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
  return `<nav class="pq-nav" aria-label="${esc("The evidence, by category")}">${QUESTIONS.map((q) => `<a href="#${q.id}"><span class="pq-nn" aria-hidden="true">${picon(q.icon, 15)}</span>${esc(q.nav)}</a>`).join("")}</nav>`;
}

export const PROOF_QUESTIONS_CSS = `
.pq-nav { position: sticky; top: 65px; z-index: 30; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 0 10px; padding: 6px 0; background: var(--bg); }
.pq-nav::-webkit-scrollbar { display: none; }
.pq-nav a { flex: 1 0 auto; justify-content: center; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px 0 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font-size: 14px; font-weight: 650; text-decoration: none; white-space: nowrap; }
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
section.pq .pq-sup { margin: 6px 0 4px; font-size: 14px; line-height: 1.45; color: var(--muted); max-width: 64em; }
section.pq .pq-day { white-space: nowrap; font-weight: 650; color: var(--text); }
section.pq ul.scale { margin: 6px 0 12px; }
@media (max-width: 760px) { section.pq ul.ew-ts { grid-template-columns: repeat(2, minmax(0, 1fr)); } section.pq .pq-a { font-size: 15px; } }
/* 21 Nov (Max, his mockup): each category a card; its figures a compact grid of tiles, each figure with its drawing. */
.pq-nav .pq-nn { background: var(--accent-soft); color: var(--accent); }
.pq-nav .pq-nn::before { content: none; }
.pqs { display: grid; gap: 18px; margin: 4px 0 18px; }
section.pq { padding: 24px 24px 18px; border: 1px solid var(--border); border-radius: 24px; scroll-margin-top: 120px;
  background: radial-gradient(60% 50% at 100% 0%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%), var(--surface); }
section.pq .pq-h { gap: 14px; }
section.pq .pq-ic { flex: none; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); }
section.pq .pq-a { margin: 10px 0 12px; font-size: 15.5px; }
section.pq .pq-b { padding: 12px 0 4px; }
section.pq .pq-bh h3 { font-size: 14px; font-weight: 720; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
section.pq ul.ew-ts { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
section.pq li.ew-t a { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "v f" "v l" "b b" "k k"; align-content: start; column-gap: 12px; row-gap: 2px; padding: 14px 14px 10px; border: 1px solid var(--border); border-radius: 16px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--sunken) 45%, var(--surface)), var(--surface)); transition: border-color .2s, transform .2s; }
section.pq li.ew-t a:hover, section.pq li.ew-t a:focus-visible { border-color: var(--pc); transform: translateY(-1px); }
section.pq .ew-v { grid-area: v; align-self: start; color: var(--pc); }
section.pq .ew-f { grid-area: f; font-size: 24px; align-self: end; }
section.pq .ew-l { grid-area: l; font-size: 13.5px; font-weight: 550; color: var(--muted); }
section.pq .ew-k { grid-area: k; margin-top: 8px; }
section.pq .ew-v.ring svg { display: block; }
section.pq .ew-v .tr { fill: none; stroke: color-mix(in srgb, var(--pc) 16%, var(--sunken)); stroke-width: 4; }
section.pq .ew-v .ar { fill: none; stroke: var(--pc); stroke-width: 4; stroke-linecap: round; }
section.pq .ew-v .ck { fill: none; stroke: var(--pc); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
section.pq .ew-v.ic { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: color-mix(in srgb, var(--pc) 14%, var(--sunken)); }
section.pq .ew-v.bar, section.pq .ew-v.pair { grid-area: b; margin: 10px 0 2px; }
section.pq li.ew-t a:has(> .ew-v.bar), section.pq li.ew-t a:has(> .ew-v.pair) { grid-template-columns: minmax(0, 1fr); grid-template-areas: "f" "l" "b" "k"; }
section.pq .ew-v.bar svg, section.pq .ew-v.pair svg { display: block; width: 100%; }
section.pq .ew-v.bar svg { height: 8px; } section.pq .ew-v.pair svg { height: 18px; }
section.pq .ew-v.bar .tr { fill: color-mix(in srgb, var(--pc) 16%, var(--sunken)); stroke: none; }
section.pq .ew-v.bar .ar, section.pq .ew-v.pair .ar { fill: var(--pc); stroke: none; }
section.pq { --amb: #a15c00; } @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) section.pq { --amb: #ffb547; } } :root[data-theme="dark"] section.pq { --amb: #ffb547; }
section.pq .ew-v.drop .wa { fill: var(--amb); } section.pq .ew-v.drop .ar { fill: var(--ok); } section.pq .ew-f .ew-was { color: var(--amb); } section.pq .ew-f .ew-now { color: var(--ok); }
section.pq .ew-v.pair .nb { fill: color-mix(in srgb, var(--faint) 55%, transparent); }
html.pq-anim section.pq .ew-v.ring .ar { transition: stroke-dashoffset 1.1s cubic-bezier(.3,.7,.2,1); }
html.pq-anim section.pq:not(.in) .ew-v.ring .ar { stroke-dashoffset: ${Math.round(2 * Math.PI * 15 * 100) / 100}; }
html.pq-anim section.pq .ew-v.bar .ar, html.pq-anim section.pq .ew-v.pair rect { transform-box: fill-box; transform-origin: left center; transition: transform 1s cubic-bezier(.3,.7,.2,1); }
html.pq-anim section.pq:not(.in) .ew-v.bar .ar, html.pq-anim section.pq:not(.in) .ew-v.pair rect { transform: scaleX(0); }
@media (max-width: 760px) {
  section.pq { padding: 18px 14px 12px; border-radius: 18px; }
  section.pq ul.ew-ts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  section.pq li.ew-t a { grid-template-columns: minmax(0, 1fr); grid-template-areas: "v" "f" "l" "b" "k"; padding: 12px 10px 8px; }
  section.pq .ew-v.ring svg { width: 32px; height: 32px; } section.pq .ew-v.ic { width: 32px; height: 32px; border-radius: 10px; }
  section.pq .ew-f { font-size: 20px; margin-top: 6px; }
  section.pq .pq-ic { width: 40px; height: 40px; }
}
@media (min-width: 2000px) { section.pq ul.ew-ts { grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); } section.pq .ew-f { font-size: 28px; } section.pq .ew-l { font-size: 14.5px; } }
/* Charts answer the pointer everywhere (Max, 21 Nov: no dead zones): the bar under it stands out, its <title> tells its number. */
section.pq .pchart svg .pc-m { cursor: help; transition: opacity .15s; }
section.pq .pchart svg:hover .pc-m { opacity: .5; } section.pq .pchart svg .pc-m:hover { opacity: 1; }
@media (prefers-reduced-motion: reduce) { section.pq *, .pq-nav * { animation: none !important; transition: none !important; } }
`;

/** The drawings fill in once their section is in view (only where motion is allowed and the browser can tell). */
export const PROOF_QUESTIONS_JS = `
(function () {
  if (!("IntersectionObserver" in window) || !window.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var ss = [].slice.call(document.querySelectorAll("main section.pq")); if (!ss.length) return;
  document.documentElement.classList.add("pq-anim");
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -15% 0px" });
  ss.forEach(function (s) { io.observe(s); });
})();`;

