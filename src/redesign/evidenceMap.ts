// /proof's evidence map (the owner, 19 Nov: "clearer and tighter, more visuals, an animated architecture of all the
// evidence"): the money path in one drawing, invoice to an offline check, each step a link to its group of the evidence
// wall below and a badge with that group's headline figures. Every figure in a badge is a tile's figure from
// docs/evidence/evidence-wall.json (the wall's own record-read numbers); only the words around them are written here.
// Two drawings of the same map: left to right on a wide screen, top to bottom on a phone (CSS shows one). A dot travels the
// path every 6 s (CSS keyframes on an SVG stroke, no script), a red one ends at the signature (one cent changed: refused),
// an amber one at the rules (held at the cash floor). Under prefers-reduced-motion nothing moves: the still map, branches
// drawn. Test money only, said under the map.

import { committedWall, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { esc } from "./ui.js";

export const MAP_ID = "evidence-map";
// It names Alta as "Alta (formerly Metal)": the page's first mention in text (src/ui/formerly.ts).
export const MAP_CAPTION = "How a payment is checked, each step with its evidence, on Airwallex, Alta (formerly Metal) and Visa via Airi. Tap a step for its figures. Test money; sandbox PAID is simulated.";

type Tone = "" | "awx" | "metal" | "visa" | "claude" | "ok";
/** One step of the path: its words, the wall group it links to, its badge (null when a figure is missing). */
export interface MapNode { id: string; title: string; sub: string; group: string; tone: Tone; badge: string | null }
export interface EvidenceMap { main: MapNode[]; rails: MapNode[]; held: MapNode | null; refused: MapNode | null }

/** The map's steps and badges, from the wall's file. */
export function evidenceMap(w: EvidenceWall | null = committedWall()): EvidenceMap | null {
  if (!w?.groups.length) return null;
  const tiles = new Map<string, WallTile>(w.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  const fig = (k: string) => tiles.get(k)?.fig ?? null;
  // A badge from one or more figures, each with its words; null when none of its figures is on the wall.
  const badge = (...parts: [string, string][]) => {
    const got = parts.filter(([k]) => fig(k) !== null).map(([k, words]) => `${fig(k)} ${words}`);
    return got.length ? got.join(" · ") : null;
  };
  const node = (id: string, title: string, sub: string, group: string, tone: Tone, b: string | null): MapNode => ({ id, title, sub, group, tone, badge: b });
  const main = [
    node("invoice", "Invoice in", "a PDF in the inbox", "ev-scale", "", badge(["try-journeys", "/try walks"])),
    node("claude", "Claude reads", "Haiku; each call's request id", "ev-ai", "claude", badge(["claude-main", "decisions"], ["try-claude", "fallbacks"])),
    node("rules", "Purser's rules", "limit, bank details, duplicates, cash floor", "ev-ai", "ok", badge(["worst-case", "wrong payments"])),
    node("passkey", "Passkey signs", "SHA-256 of the exact terms", "ev-forged", "ok", badge(["tamper-matrix", "forgeries refused"])),
    node("bundle", "Proof bundle", "the signed terms and receipts", "ev-forged", "ok", badge(["try-proofs", "proofs VALID"])),
    node("verify", "Anyone verifies", "offline: /verify or npm run verify-bundle", "ev-built", "ok", badge(["verify-all", "checks passed"])),
  ];
  const rails = [
    node("alta", "Alta", "on-chain mandate", "ev-rails", "metal", badge(["alta-refusal", "refused on chain"])),
    node("airwallex", "Airwallex", "transfer with the hash, Spend Bills, cards", "ev-rails", "awx", badge(["try-transfers", "PAID"], ["awx-endpoints", "endpoints live"])),
    node("visa", "Visa via Airi", "test card", "ev-rails", "visa", badge(["visa-airi", "after Face ID"])),
  ];
  const held = fig("try-held") ? node("held", "Held", "", "ev-ai", "", badge(["try-held", "held at the cash floor"])) : null;
  const refused = fig("try-cent") ? node("refused", "Refused", "", "ev-forged", "", badge(["try-cent", "one-cent changes refused"])) : null;
  return { main, rails, held, refused };
}

/** Words into lines of at most `max` characters (a long word keeps its own line). */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = out[out.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= max) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

interface Box { n: MapNode; x: number; y: number; w: number; h: number; sub: string[]; badge: string[] }
interface Layout { variant: "wide" | "tall"; vw: number; vh: number; boxes: Box[]; pills: Box[]; lines: string[]; branch: { cls: string; d: string }[]; dots: { cls: string; d: string }[]; hits: { id: string; at: number }[]; pillHits: { id: string; at: number }[] }

const T = 6; // seconds a loop
const MOVE = 0.8; // the share of a loop the dot moves (then it fades)
const DELAY = { ok: 0, bad: 2, hold: 4 } as const;
const LH = { title: 18, sub: 14, badge: 14 };
const PAD = 10;

/** A box's height: its title, its sub-line(s), its badge pill. */
const heightOf = (sub: string[], badge: string[]) => PAD + LH.title + sub.length * LH.sub + (badge.length ? 6 + badge.length * LH.badge + 8 : 0) + PAD;
const pillHeight = (lines: string[]) => Math.max(50, 10 + lines.length * LH.badge + 8);

function wide(m: EvidenceMap): Layout {
  const W = 1120, mw = 128, rw = 170, gap = 30;
  const chars = (w: number, size: number) => Math.floor((w - 2 * PAD) / (size * 0.49));
  const mk = (n: MapNode, w: number, withSub = true): Box => ({ n, x: 0, y: 0, w, h: 0, sub: withSub ? wrap(n.sub, chars(w, 11.5)) : [], badge: n.badge ? wrap(n.badge, chars(w - 8, 11.5)) : [] });
  const main = m.main.map((n) => mk(n, mw)), rails = m.rails.map((n) => mk(n, rw, false));
  const H = Math.max(...main.map((b) => heightOf(b.sub, b.badge))), RH = Math.max(...rails.map((b) => heightOf(b.sub, b.badge)));
  const top = 4, colH = 3 * RH + 16, cy = top + colH / 2;
  // x of each column: the four steps, the rails, the last two.
  const xs = [0, 1, 2, 3].map((i) => i * (mw + gap)), rx = 4 * (mw + gap), after = [rx + rw + gap, rx + rw + gap + mw + gap];
  [...main.slice(0, 4).map((b, i) => [b, xs[i]!] as const), [main[4]!, after[0]!] as const, [main[5]!, after[1]!] as const].forEach(([b, x]) => Object.assign(b, { x, y: cy - H / 2, h: H }));
  rails.forEach((b, i) => Object.assign(b, { x: rx, y: top + i * (RH + 8), h: RH }));
  const c = (b: Box) => b.x + b.w / 2, mid = (b: Box) => b.y + b.h / 2;
  const [, , rules, passkey] = main as [Box, Box, Box, Box];
  const x0 = c(main[0]!), x1 = c(main[5]!), bottom = cy + H / 2, pillTop = bottom + 28;
  const pill = (n: MapNode | null, b: Box): Box[] => {
    if (!n?.badge) return [];
    const lines = wrap(n.badge, chars(mw, 11.5));
    return [{ n, x: b.x, y: pillTop, w: mw, h: pillHeight(lines), sub: [], badge: lines }];
  };
  const pills = [...pill(m.held, rules), ...pill(m.refused, passkey)];
  const vh = Math.ceil(Math.max(top + colH, ...pills.map((p) => p.y + p.h)) + 4);
  const [alta, , visa] = rails as [Box, Box, Box];
  const fork = (r: Box) => `M${passkey.x + mw} ${cy} C${passkey.x + mw + 18} ${cy} ${r.x - 18} ${mid(r)} ${r.x} ${mid(r)}`;
  const merge = (r: Box) => `M${r.x + rw} ${mid(r)} C${r.x + rw + 18} ${mid(r)} ${after[0]! - 18} ${cy} ${after[0]!} ${cy}`;
  const heldPill = pills.find((p) => p.n.id === "held"), badPill = pills.find((p) => p.n.id === "refused");
  return {
    variant: "wide", vw: W, vh, boxes: [...main, ...rails], pills,
    lines: [`M${x0} ${cy} H${x1}`, fork(alta), fork(visa), merge(alta), merge(visa)],
    branch: [...(heldPill ? [{ cls: "held", d: `M${c(rules)} ${bottom} V${heldPill.y}` }] : []), ...(badPill ? [{ cls: "bad", d: `M${c(passkey)} ${bottom} V${badPill.y}` }] : [])],
    dots: [{ cls: "ok", d: `M${x0} ${cy} H${main[5]!.x}` }, ...(badPill ? [{ cls: "bad", d: `M${x0} ${cy} H${c(passkey)} V${badPill.y}` }] : []), ...(heldPill ? [{ cls: "hold", d: `M${x0} ${cy} H${c(rules)} V${heldPill.y}` }] : [])],
    hits: [...main, rails[1]!].map((b) => ({ id: b.n.id, at: Math.min(1, (b.x - x0) / (main[5]!.x - x0)) })),
    pillHits: pills.map((p) => ({ id: p.n.id, at: 1 })),
  };
}

function tall(m: EvidenceMap): Layout {
  const W = 340, nw = 232, px = 248, pw = 92, gap = 26;
  const chars = (w: number, size: number) => Math.floor((w - 2 * PAD) / (size * 0.49));
  const mk = (n: MapNode): Box => ({ n, x: 0, y: 0, w: nw, h: 0, sub: wrap(n.sub, chars(nw, 11.5)), badge: n.badge ? wrap(n.badge, chars(nw - 8, 11.5)) : [] });
  // The steps in order, the rails between the signature and the bundle, Airwallex first.
  const order = [...m.main.slice(0, 4), m.rails[1]!, m.rails[0]!, m.rails[2]!, ...m.main.slice(4)].map(mk);
  let y = 4;
  order.forEach((b, i) => { b.h = heightOf(b.sub, b.badge); b.y = y; y += b.h + (i >= 4 && i < 6 ? 8 : gap); });
  const end = y - gap;
  const cx = nw / 2, mid = (b: Box) => b.y + b.h / 2, by = (id: string) => order.find((b) => b.n.id === id)!;
  const pill = (n: MapNode | null, at: Box): Box[] => {
    if (!n?.badge) return [];
    const lines = wrap(n.badge, chars(pw, 11.5)), h = pillHeight(lines);
    return [{ n, x: px, y: mid(at) - h / 2, w: pw, h, sub: [], badge: lines }];
  };
  const rules = by("rules"), passkey = by("passkey");
  const pills = [...pill(m.held, rules), ...pill(m.refused, passkey)];
  const heldPill = pills.find((p) => p.n.id === "held"), badPill = pills.find((p) => p.n.id === "refused");
  const y0 = mid(order[0]!), y1 = mid(order[order.length - 1]!);
  const railsTop = by("airwallex").y - 6, railsBottom = by("visa").y + by("visa").h + 6;
  return {
    variant: "tall", vw: W, vh: Math.ceil(end + 4), boxes: order, pills,
    lines: [`M${cx} ${y0} V${y1}`, `M${nw + 6} ${railsTop} H${nw + 10} V${railsBottom} H${nw + 6}`],
    branch: [...(heldPill ? [{ cls: "held", d: `M${nw} ${mid(rules)} H${px}` }] : []), ...(badPill ? [{ cls: "bad", d: `M${nw} ${mid(passkey)} H${px}` }] : [])],
    dots: [{ cls: "ok", d: `M${cx} ${y0} V${order[order.length - 1]!.y}` }, ...(badPill ? [{ cls: "bad", d: `M${cx} ${y0} V${mid(passkey)} H${px}` }] : []), ...(heldPill ? [{ cls: "hold", d: `M${cx} ${y0} V${mid(rules)} H${px}` }] : [])],
    hits: order.map((b) => ({ id: b.n.id, at: Math.max(0, Math.min(1, (b.y - y0) / (order[order.length - 1]!.y - y0))) })),
    pillHits: pills.map((p) => ({ id: p.n.id, at: 1 })),
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function svg(l: Layout): string {
  const text = (x: number, y: number, cls: string, s: string) => `<text class="${cls}" x="${r1(x)}" y="${r1(y)}">${esc(s)}</text>`;
  const box = (b: Box) => {
    const label = [b.n.title, b.n.sub, b.n.badge].filter(Boolean).join(". ");
    let y = b.y + PAD + 13;
    const parts = [`<rect class="em-box" x="${r1(b.x + 0.5)}" y="${r1(b.y + 0.5)}" width="${b.w - 1}" height="${r1(b.h - 1)}" rx="10"/>`, text(b.x + PAD, y, "em-t", b.n.title)];
    y += LH.title - 13 + 11;
    for (const s of b.sub) { parts.push(text(b.x + PAD, y, "em-s", s)); y += LH.sub; }
    if (b.badge.length) {
      const top = y - 11 + 6, h = b.badge.length * LH.badge + 8;
      parts.push(`<rect class="em-bg" x="${r1(b.x + PAD - 4)}" y="${r1(top)}" width="${b.w - 2 * PAD + 8}" height="${h}" rx="7"/>`);
      b.badge.forEach((s, i) => parts.push(text(b.x + PAD, top + 4 + 11 + i * LH.badge, "em-v", s)));
    }
    return `<a class="em-n${b.n.tone ? ` ${b.n.tone}` : ""} em-h-${b.n.id}" href="#${esc(b.n.group)}" aria-label="${esc(label)}">${parts.join("")}</a>`;
  };
  const pill = (p: Box) => `<a class="em-p ${p.n.id} em-h-${p.n.id}" href="#${esc(p.n.group)}" aria-label="${esc(`${p.n.title}: ${p.n.badge}`)}"><rect class="em-pb" x="${r1(p.x + 0.5)}" y="${r1(p.y + 0.5)}" width="${p.w - 1}" height="${r1(p.h - 1)}" rx="10"/>${p.badge.map((s, i) => text(p.x + 8, p.y + 10 + 11 + i * LH.badge, "em-v", s)).join("")}</a>`;
  return `<svg class="em-${l.variant}" viewBox="0 0 ${l.vw} ${l.vh}" width="${l.vw}" height="${l.vh}" role="group" aria-label="${esc("The money path, with the evidence for each step")}">
${l.lines.map((d) => `<path class="em-line" d="${d}"/>`).join("")}${l.branch.map((b) => `<path class="em-br ${b.cls}" d="${b.d}"/>`).join("")}
${l.boxes.map(box).join("\n")}
${l.pills.map(pill).join("\n")}
${l.dots.map((d) => `<path class="em-dot halo ${d.cls}" d="${d.d}" pathLength="100"/><path class="em-dot ${d.cls}" d="${d.d}" pathLength="100"/>`).join("")}
</svg>`;
}

/** The map: both drawings and the caption; "" without the wall's file. */
export function evidenceMapHtml(w: EvidenceWall | null = committedWall()): string {
  const m = evidenceMap(w);
  if (!m) return "";
  return `<figure class="emap" id="${MAP_ID}" aria-labelledby="em-cap" data-rec="docs/evidence/evidence-wall.json">${svg(wide(m))}${svg(tall(m))}<figcaption id="em-cap">${esc(MAP_CAPTION)}</figcaption></figure>`;
}

/**
 * The map's style, with each step's glow timed to the dot's arrival (computed from the layout, so the moment a box lights
 * up is where the dot is). Only under prefers-reduced-motion: no-preference does anything move.
 */
export function evidenceMapCss(w: EvidenceWall | null = committedWall()): string {
  const m = evidenceMap(w);
  const timing = m ? [wide(m), tall(m)].flatMap((l) => [
    ...l.hits.map((h) => `.emap svg.em-${l.variant} .em-h-${h.id} .em-box { animation: em-glow ${T}s linear ${(h.at * MOVE * T).toFixed(2)}s infinite; }`),
    ...l.pillHits.map((h) => `.emap svg.em-${l.variant} .em-h-${h.id} .em-pb { animation: em-glow-${h.id === "held" ? "held" : "bad"} ${T}s linear ${(DELAY[h.id === "held" ? "hold" : "bad"] + h.at * MOVE * T).toFixed(2)}s infinite; }`),
  ]) : [];
  return `
.emap { margin: 6px 0 22px; --held: #b45309; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .emap { --held: #fbbf24; } }
:root[data-theme="dark"] .emap { --held: #fbbf24; }
.emap svg { display: block; width: 100%; height: auto; overflow: visible; font-family: inherit; }
.emap svg.em-tall { display: none; max-width: 420px; }
@media (max-width: 760px) { .emap svg.em-wide { display: none; } .emap svg.em-tall { display: block; } }
.emap figcaption { margin: 8px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--muted); }
.emap .em-line { fill: none; stroke: var(--border); stroke-width: 2; }
.emap .em-br { fill: none; stroke-width: 2; stroke-dasharray: 5 4; }
.emap .em-br.held { stroke: var(--held); } .emap .em-br.bad { stroke: var(--bad); }
.emap .em-n { --pc: var(--accent); --ps: var(--accent-soft); }
.emap .em-n.awx { --pc: var(--awx); --ps: var(--awx-soft); } .emap .em-n.metal { --pc: var(--metal); --ps: var(--metal-soft); }
.emap .em-n.claude { --pc: var(--claude); --ps: var(--claude-soft); } .emap .em-n.ok { --pc: var(--ok); --ps: var(--ok-soft); }
.emap .em-box { fill: var(--surface); stroke: var(--border); stroke-width: 1.2; }
.emap .em-n:hover .em-box, .emap .em-n:focus-visible .em-box { stroke: var(--pc); stroke-width: 2.5; }
.emap .em-t { fill: var(--text); font-size: 14px; font-weight: 740; }
.emap .em-s { fill: var(--muted); font-size: 11.5px; }
.emap .em-bg { fill: var(--ps); }
.emap .em-v { fill: var(--pc); font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.emap .em-p.held { --pc: var(--held); } .emap .em-p.refused { --pc: var(--bad); }
.emap .em-pb { fill: var(--surface); stroke: var(--pc); stroke-width: 1.5; stroke-dasharray: 5 4; }
.emap .em-p:hover .em-pb, .emap .em-p:focus-visible .em-pb { stroke-width: 2.5; stroke-dasharray: none; }
.emap a:focus-visible { outline: none; }
/* The dots: a zero-length dash with a round cap, moved along the path by its offset. Hidden when still. */
.emap .em-dot { fill: none; stroke-width: 10; stroke-linecap: round; stroke-dasharray: 0 1000; opacity: 0; pointer-events: none; }
.emap .em-dot.ok { stroke: var(--ok); } .emap .em-dot.bad { stroke: var(--bad); } .emap .em-dot.hold { stroke: var(--held); }
.emap .em-dot.halo { stroke: var(--surface); stroke-width: 16; }
@media (prefers-reduced-motion: no-preference) {
  .emap .em-dot { animation: em-move ${T}s linear infinite; }
  .emap .em-dot.bad { animation-delay: ${DELAY.bad}s; } .emap .em-dot.hold { animation-delay: ${DELAY.hold}s; }
  ${timing.join("\n  ")}
}
@keyframes em-move { 0% { stroke-dashoffset: 0; opacity: 0; } 3% { opacity: 1; } ${MOVE * 100}% { stroke-dashoffset: -100; opacity: 1; } ${MOVE * 100 + 6}%, 100% { stroke-dashoffset: -100; opacity: 0; } }
@keyframes em-glow { 0% { stroke: var(--pc); stroke-width: 3; } 12%, 100% { stroke: var(--border); stroke-width: 1.2; } }
@keyframes em-glow-held { 0% { stroke-width: 3.5; stroke-dasharray: none; } 15%, 100% { stroke-width: 1.5; stroke-dasharray: 5 4; } }
@keyframes em-glow-bad { 0% { stroke-width: 3.5; stroke-dasharray: none; } 15%, 100% { stroke-width: 1.5; stroke-dasharray: 5 4; } }
`;
}
