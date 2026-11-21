// /proof's head and its architecture (Max, 21 Nov, his mockup: "for proof page because we have so much maybe divide it
// nicely per category and then the numbers in a nice visual and architecture"): the heading over the site's wave
// (src/ui/wave.ts, subtle), one line, four figures as tiles with an icon; and one drawing of how it fits together,
// agent → Purser (policy, exact terms, passkey) → the rails (Airwallex, Alta, Visa via Airi) → the books (T:0), with the
// evidence of each part attached as chips. Every figure here is a tile of docs/evidence/evidence-wall.json, drawn as the
// wall has it, with its record (data-rec) and a link to that record: nothing typed in. The drawing moves only where
// motion is allowed (packets along the wires, a glow running through the parts); without it, it stands still and whole.
// No style attribute anywhere (the CSP); the wave's script is in the page's one script.

import { WALL_FILE, committedWall, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { recordHref } from "./proofFlow.js";
import { waveScript } from "../ui/wave.js";
import { esc } from "./ui.js";
import { picon } from "./proofIcons.js";

const tilesOf = (w: EvidenceWall | null) => new Map<string, WallTile>((w?.groups ?? []).flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
const ext = (h: string) => (/^https?:/.test(h) ? ' target="_blank" rel="noopener"' : "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** The sentence of a tile's note that says how many walks stopped before a step (the review, 21 Nov), or "". */
export const stoppedLine = (t: WallTile): string => /(?:^|[.;] )(\d[\d,]* walks? stopped before (?:that|this) step\.)/.exec(t.note)?.[1] ?? "";

/** The four figures under the heading: the wall's tiles, in this order, each with its icon. */
export const HERO_STATS: readonly { key: string; icon: string }[] = [
  { key: "verify-all", icon: "check" },
  { key: "soak-paid", icon: "arrow-left-right" },
  { key: "try-cent", icon: "shield" },
  { key: "tamper-matrix", icon: "layers" },
];
export const PROOF_H1 = "Proof";

/** The head of /proof: the wave behind it, the heading, its one line, the four figures. */
export function proofHeroHtml(lead: string, w: EvidenceWall | null = committedWall(), aside = ""): string {
  const all = tilesOf(w);
  const stats = HERO_STATS.flatMap((s) => (all.has(s.key) ? [{ ...s, t: all.get(s.key)! }] : []));
  const li = ({ key, icon: ic, t }: { key: string; icon: string; t: WallTile }) => {
    const sub = stoppedLine(t);
    return `<li data-stat="${esc(key)}" data-rec="${esc(t.rec || WALL_FILE)}"><a href="${esc(recordHref(t))}" title="${esc(t.note)}"${ext(t.href)}><span class="pst-ic" aria-hidden="true">${picon(ic, 22)}</span><span class="pst-t"><b class="pst-f">${esc(t.fig)}</b><span class="pst-l">${esc(cap(t.label))}</span>${sub ? `<small class="pst-s">${esc(sub)}</small>` : ""}</span></a></li>`;
  };
  return `<section class="pxh" aria-labelledby="pxh-h">
<canvas class="px-wave" aria-hidden="true"></canvas>
<div class="wrap">
<div class="pxh-top"><h1 id="pxh-h">${esc(PROOF_H1)}</h1>${aside}</div>
<p class="plead">${esc(lead)}</p>
${stats.length ? `<ul class="pstats" aria-label="${esc("Four figures from the records")}">${stats.map(li).join("")}</ul>` : ""}
</div>
</section>`;
}

/** The wave in the head: few points, quiet, calm behind the heading (placement "hero"). */
export const PROOF_WAVE_JS = waveScript({ selector: "canvas.px-wave", placement: "hero", density: 0.5, intensity: 0.7 });

// ── The architecture ────────────────────────────────────────────────────────────────────────────────────────────────

export interface ArchNode { id: string; title: string; who: string; icon: string; parts: readonly (readonly [string, string])[]; keys: readonly (string | RegExp)[]; href: string; tone: "claude" | "accent" | "awx" | "ink" }
export const ARCH_ID = "architecture";
export const ARCH_TITLE = "How it fits together";
export const ARCH_NODES: readonly ArchNode[] = [
  { id: "pa-agent", title: "Agent", who: "Reads the invoice with Claude and proposes", icon: "bot", parts: [["Claude", "claude"]], keys: ["claude-main", /^eval-v\d+$/], href: "#q-ai", tone: "claude" },
  { id: "pa-purser", title: "Purser", who: "Its rules check what may move", icon: "feather", parts: [["Policy", "#pf-policy"], ["Exact terms", "#signed"], ["Passkey", "#pf-passkey"]], keys: ["alta-series-refused", "tamper-matrix", "try-cent"], href: "#q-approvals", tone: "accent" },
  { id: "pa-rails", title: "Rails", who: "Move the signed payment", icon: "arrow-left-right", parts: [["Airwallex", "#pl-airwallex"], ["Alta", "#pl-alta"], ["Visa via Airi", "#pl-visa"]], keys: ["soak-paid", "alta-payments", "visa-airi"], href: "#q-live", tone: "awx" },
  { id: "pa-books", title: "Books", who: "Journal entries, matched to the cent", icon: "book-open", parts: [["T:0", "#pl-t0"]], keys: ["t0-readback", "awx-statement"], href: "#q-books", tone: "ink" },
];
/** Under the drawing: what re-checks all of it. */
export const ARCH_BASE = { title: "Anyone can re-check it", keys: ["verify-all", "anchor"], href: "#q-verify" } as const;
export const ARCH_REFUSED = "Refused here: nothing moves";

/** A key's tile: a name, or the newest tile on /proof whose key matches (the newest held-out eval). */
function pick(all: Map<string, WallTile>, k: string | RegExp): WallTile | null {
  if (typeof k === "string") return all.get(k) ?? null;
  const m = [...all.values()].filter((t) => k.test(t.key) && !t.offProof).sort((a, b) => Number(b.key.replace(/\D/g, "")) - Number(a.key.replace(/\D/g, "")));
  return m[0] ?? null;
}
export function archTiles(n: { keys: readonly (string | RegExp)[] }, w: EvidenceWall | null = committedWall()): WallTile[] {
  const all = tilesOf(w);
  return n.keys.flatMap((k) => { const t = pick(all, k); return t ? [t] : []; });
}
const chip = (t: WallTile) => `<li data-arch="${esc(t.key)}" data-rec="${esc(t.rec || WALL_FILE)}"><a href="${esc(recordHref(t))}" title="${esc(t.note)}"${ext(t.href)}><b>${esc(t.fig)}</b> <span>${esc(t.label)}</span></a></li>`;

export function archHtml(w: EvidenceWall | null = committedWall()): string {
  if (!w?.groups.length) return "";
  const node = (n: ArchNode, i: number) => `${i ? `<div class="pa-wire" aria-hidden="true"><span></span><span></span><span></span></div>` : ""}<div class="pa-node ${n.tone}" id="${esc(n.id)}">
<a class="pa-head" href="${esc(n.href)}"><span class="pa-ic" aria-hidden="true">${picon(n.icon, 22)}</span><span class="pa-tt"><b>${esc(n.title)}</b><small>${esc(n.who)}</small></span></a>
<ul class="pa-parts">${n.parts.map(([p, h]) => `<li><a href="${esc(h)}">${esc(p)}</a></li>`).join("")}</ul>
${n.id === "pa-purser" ? `<p class="pa-ref"><span aria-hidden="true">${picon("ban", 14)}</span>${esc(ARCH_REFUSED)}</p>` : ""}
<ul class="pa-ev">${archTiles(n, w).map(chip).join("")}</ul>
</div>`;
  const base = archTiles(ARCH_BASE, w);
  return `<figure class="parch" id="${ARCH_ID}" aria-labelledby="pa-cap" data-rec="${WALL_FILE}">
<figcaption id="pa-cap"><b>${esc(ARCH_TITLE)}</b> <span>${esc("Each part with the evidence it rests on. Tap a figure for its record.")}</span></figcaption>
<div class="pa-flow">${ARCH_NODES.map(node).join("")}</div>
${base.length ? `<div class="pa-base"><a class="pa-bh" href="${ARCH_BASE.href}">${picon("badge-check", 18)}${esc(ARCH_BASE.title)}</a><ul class="pa-ev">${base.map(chip).join("")}</ul></div>` : ""}
</figure>`;
}

export const PROOF_TOP_CSS = `
/* The head: the wave behind the heading, quiet; four figures as tiles. */
main.proofp { padding-top: 0; }
.proofp > section.pxh { position: relative; isolation: isolate; overflow: hidden; padding: 30px 0 26px; }
.pxh-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 18px; }
.pxh-top .pwatch { margin: 0; }
.pxh::before { content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none; -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent); mask-image: linear-gradient(180deg, #000 60%, transparent); background:
  radial-gradient(50% 70% at 82% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 70%),
  radial-gradient(35% 60% at 8% 100%, color-mix(in srgb, var(--accent-ink) 12%, transparent), transparent 70%); }
canvas.px-wave { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; pointer-events: none; opacity: .55;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%); mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%); }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) canvas.px-wave { opacity: .3; } }
:root[data-theme="light"] canvas.px-wave { opacity: .3; }
.pxh h1 { font-size: clamp(38px, 4.4vw, 60px); font-weight: 780; letter-spacing: -.03em; line-height: 1.02; margin: 6px 0 8px; }
.pxh .plead { margin: 0 0 22px; font-size: clamp(16px, 1.4vw, 19px); line-height: 1.5; color: var(--muted); max-width: 46em; }
ul.pstats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
ul.pstats a { display: flex; align-items: center; gap: 16px; min-height: 44px; height: 100%; padding: 18px 20px; border: 1px solid var(--glass-line, var(--border)); border-radius: 18px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 86%, transparent), color-mix(in srgb, var(--surface) 70%, transparent)); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  color: inherit; text-decoration: none; box-shadow: var(--hi, none); transition: border-color .2s, transform .2s; }
ul.pstats a:hover, ul.pstats a:focus-visible { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); transform: translateY(-1px); }
.pst-ic { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); }
.pst-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pst-f { font-size: clamp(26px, 2.3vw, 34px); font-weight: 780; letter-spacing: -.025em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.pst-l { font-size: 14.5px; line-height: 1.35; color: var(--muted); }
.pst-s { font-size: 12.5px; line-height: 1.35; color: var(--faint); }
@media (max-width: 1100px) { ul.pstats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) {
  .proofp > section.pxh { padding: 18px 0 16px; }
  ul.pstats { gap: 8px; }
  ul.pstats a { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px; border-radius: 14px; }
  .pst-ic { width: 38px; height: 38px; border-radius: 11px; } .pst-ic svg { width: 18px; height: 18px; }
  .pst-f { font-size: 24px; } .pst-l { font-size: 13px; }
}
@media (min-width: 2000px) { .pxh h1 { font-size: 68px; } .pst-f { font-size: 38px; } .pst-l { font-size: 15.5px; } }

/* The architecture: four parts joined by wires that packets run along; under each part, its evidence. */
.parch { margin: 8px 0 22px; padding: 20px 20px 16px; border: 1px solid var(--border); border-radius: 22px; background:
  radial-gradient(70% 90% at 50% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--surface); }
.parch figcaption { margin: 0 0 14px; font-size: 14px; color: var(--muted); }
.parch figcaption b { display: block; font-size: clamp(20px, 1.9vw, 24px); font-weight: 760; letter-spacing: -.015em; color: var(--text); margin-bottom: 2px; }
.pa-flow { display: grid; grid-template-columns: minmax(0, 1fr) 56px minmax(0, 1.25fr) 56px minmax(0, 1.15fr) 56px minmax(0, 1fr); align-items: stretch; }
.pa-node { --pc: var(--accent); --ps: var(--accent-soft); position: relative; display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid color-mix(in srgb, var(--pc) 30%, var(--border)); border-radius: 18px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ps) 55%, var(--surface)), var(--surface) 75%); min-width: 0; }
.pa-node.claude { --pc: var(--claude); --ps: var(--claude-soft); } .pa-node.awx { --pc: var(--awx); --ps: var(--awx-soft); } .pa-node.ink { --pc: var(--ok); --ps: var(--ok-soft); }
.pa-node.accent { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); box-shadow: 0 18px 50px -28px var(--glow, color-mix(in srgb, var(--accent) 60%, transparent)); }
.pa-head { display: flex; align-items: center; gap: 12px; min-height: 44px; color: inherit; text-decoration: none; }
.pa-head:hover b, .pa-head:focus-visible b { color: var(--pc); }
.pa-ic { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 13px; background: var(--ps); color: var(--pc); }
.pa-tt { display: flex; flex-direction: column; min-width: 0; }
.pa-tt b { font-size: 18px; font-weight: 760; letter-spacing: -.01em; } .pa-tt small { font-size: 13px; line-height: 1.3; color: var(--muted); }
ul.pa-parts { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
ul.pa-parts a { display: inline-flex; align-items: center; min-height: 44px; box-sizing: border-box; font-size: 12.5px; font-weight: 650; padding: 0 12px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--pc) 35%, var(--border)); color: var(--text); background: var(--surface); text-decoration: none; }
ul.pa-parts a:hover, ul.pa-parts a:focus-visible { border-color: var(--pc); color: var(--pc); }
.pa-ref { margin: 0; display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; font-size: 12.5px; font-weight: 700; color: var(--bad); padding: 3px 10px; border-radius: 999px; border: 1px dashed color-mix(in srgb, var(--bad) 60%, transparent); background: var(--bad-soft); }
ul.pa-ev { list-style: none; margin: auto 0 0; padding: 0; display: grid; gap: 6px; }
ul.pa-ev a { display: flex; align-items: baseline; text-align: left; gap: 6px; min-height: 44px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border); background: color-mix(in srgb, var(--sunken) 55%, var(--surface)); color: var(--muted); font-size: 12.5px; line-height: 1.3; text-decoration: none; box-sizing: border-box; }
ul.pa-ev a b { flex: none; color: var(--text); font-size: 15px; font-weight: 760; font-variant-numeric: tabular-nums; }
ul.pa-ev a span { min-width: 0; overflow-wrap: anywhere; }
ul.pa-ev a:hover, ul.pa-ev a:focus-visible { border-color: var(--pc, var(--accent)); color: var(--text); }
/* A wire: a line, and three packets that run along it, one after another. */
.pa-wire { position: relative; align-self: center; height: 2px; margin: 0 6px; border-radius: 2px; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 25%, var(--border)), color-mix(in srgb, var(--accent) 70%, var(--border))); }
.pa-wire::after { content: ""; position: absolute; right: -2px; top: 50%; width: 8px; height: 8px; border-top: 2px solid var(--accent); border-right: 2px solid var(--accent); transform: translateY(-50%) rotate(45deg); }
.pa-wire span { position: absolute; top: 50%; left: 0; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px 2px color-mix(in srgb, var(--accent) 70%, transparent); opacity: 0; }
.pa-base { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); }
.pa-bh { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-weight: 700; font-size: 14.5px; color: var(--ok); text-decoration: none; }
.pa-base ul.pa-ev { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; flex: 1 1 520px; }
.pa-base ul.pa-ev li { flex: 1 1 260px; }
@media (max-width: 999px) {
  .pa-flow { grid-template-columns: minmax(0, 1fr); }
  .pa-wire { justify-self: center; width: 2px; height: 30px; margin: 4px 0; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 25%, var(--border)), color-mix(in srgb, var(--accent) 70%, var(--border))); }
  .pa-wire::after { right: auto; left: 50%; top: auto; bottom: -2px; transform: translateX(-50%) rotate(135deg); }
  .pa-wire span { left: 50%; top: 0; }
  ul.pa-ev { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
}
@media (max-width: 560px) { .parch { padding: 14px 12px 12px; border-radius: 18px; } }
@media (prefers-reduced-motion: no-preference) {
  .pa-wire span { animation: pa-run 2.4s cubic-bezier(.45,.05,.55,.95) infinite; }
  .pa-wire span:nth-child(2) { animation-delay: .8s; } .pa-wire span:nth-child(3) { animation-delay: 1.6s; }
  .pa-flow > .pa-wire:nth-of-type(2) span { animation-duration: 2.6s; } .pa-flow > .pa-wire:nth-of-type(3) span { animation-duration: 2.8s; }
  .pa-node .pa-ic { animation: pa-glow 6s ease-in-out infinite; }
  .pa-flow > .pa-node:nth-child(3) .pa-ic { animation-delay: 1.5s; } .pa-flow > .pa-node:nth-child(5) .pa-ic { animation-delay: 3s; } .pa-flow > .pa-node:nth-child(7) .pa-ic { animation-delay: 4.5s; }
  .pa-ref span { display: inline-flex; animation: pa-stop 3s ease-in-out infinite; }
}
@keyframes pa-run { 0% { left: 0; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
@media (max-width: 999px) { @keyframes pa-run { 0% { top: 0; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { top: 100%; opacity: 0; } } }
@keyframes pa-glow { 0%, 18%, 100% { box-shadow: 0 0 0 0 transparent; } 8% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--pc) 22%, transparent), 0 0 24px color-mix(in srgb, var(--pc) 50%, transparent); } }
@keyframes pa-stop { 0%, 60%, 100% { transform: none; } 70% { transform: scale(1.25); } 80% { transform: none; } }
@media (prefers-reduced-motion: reduce) { .parch *, .pxh * { animation: none !important; transition: none !important; } }
`;
