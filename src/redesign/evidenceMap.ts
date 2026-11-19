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
export interface EvidenceMap { main: MapNode[]; rails: MapNode[]; held: MapNode | null; refused: MapNode | null; checks: MapNode[] }
/** The row under the path (19 Nov): the attacks and checks made on purpose, each with its wall figure. */
export const CHECKS_TITLE = "Attacked and checked on purpose";

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
    node("invoice", "Invoice in", "a PDF in the inbox", "ev-scale", "", badge(["try-journeys", "/try walks passed"])),
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
  // The row under the path: only a check whose figure is on the wall.
  const checks = [
    node("c-redteam", "Red team", "the /try API, on this computer", "ev-attacked", "ok", badge(["redteam-api", "attacks held"])),
    node("c-chaos", "Chaos", "faults and crashes, money path", "ev-attacked", "ok", badge(["chaos-money", "invariants broken"])),
    node("c-fuzz", "Fuzzing", "properties at high run counts", "ev-attacked", "ok", badge(["fuzzing", "properties held"])),
    node("c-eval", "Held-out eval", "100 invoices, written first", "ev-ai", "claude", badge(["eval-v3", "wrong payments"])),
    node("c-site", "The public site", "Lighthouse, axe, WebKit", "ev-quality", "ok", badge(["site-quality", "accessibility"], ["webkit-try", "WebKit walks passed"])),
  ].filter((n) => n.badge);
  return { main, rails, held, refused, checks };
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

interface Box { n: MapNode; x: number; y: number; w: number; h: number; title?: string[]; sub: string[]; badge: string[] }
interface Layout { variant: "wide" | "tall"; vw: number; vh: number; boxes: Box[]; pills: Box[]; labels: { x: number; y: number; text: string }[]; lines: string[]; branch: { cls: string; d: string }[]; dots: { cls: string; d: string }[]; hits: { id: string; at: number }[]; pillHits: { id: string; at: number }[] }

const T = 6; // seconds a loop
const MOVE = 0.8; // the share of a loop the dot moves (then it fades)
const DELAY = { ok: 0, bad: 2, hold: 4 } as const;
/** The drawing's sizes: /proof's (PAGE), or the README's larger type (README_MAP), from which every box is laid out. */
export interface Metrics { titleCharW: number; pad: number; lh: { title: number; sub: number; badge: number }; size: { title: number; sub: number; badge: number }; mw: number; rw: number; gap: number; pillMin: number; railGap: number; charW: number; dot: number; halo: number }
const PAGE: Metrics = { titleCharW: 0.5, pad: 10, lh: { title: 18, sub: 14, badge: 14 }, size: { title: 14, sub: 11.5, badge: 11.5 }, mw: 128, rw: 170, gap: 30, pillMin: 50, railGap: 8, charW: 0.49, dot: 10, halo: 16 };
/** The README's drawing: about 1,250 units wide, shown at GitHub's ~900 px, so its smallest text (20 units, with the 12-unit margin) reads at 14 px or more. */
export const README_MAP: Metrics = { titleCharW: 0.55, pad: 13, lh: { title: 28, sub: 25, badge: 25 }, size: { title: 22, sub: 20, badge: 20 }, mw: 150, rw: 200, gap: 24, pillMin: 62, railGap: 10, charW: 0.5, dot: 14, halo: 22 };
const PAD = PAGE.pad;

/** A box's height: its title, its sub-line(s), its badge pill. */
const heightOf = (M: Metrics, sub: string[], badge: string[], title = 1) => M.pad + title * M.lh.title + sub.length * M.lh.sub + (badge.length ? 6 + badge.length * M.lh.badge + 8 : 0) + M.pad;
const pillHeight = (M: Metrics, lines: string[]) => Math.max(M.pillMin, 10 + lines.length * M.lh.badge + 8);

function wide(m: EvidenceMap, M: Metrics = PAGE): Layout {
  const { mw, rw, gap } = M;
  const chars = (w: number, size: number) => Math.floor((w - 2 * M.pad) / (size * M.charW));
  const mk = (n: MapNode, w: number, withSub = true): Box => ({ n, x: 0, y: 0, w, h: 0, title: wrap(n.title, Math.floor((w - 2 * M.pad) / (M.size.title * M.titleCharW))), sub: withSub ? wrap(n.sub, chars(w, M.size.sub)) : [], badge: n.badge ? wrap(n.badge, chars(w - 8, M.size.badge)) : [] });
  const main = m.main.map((n) => mk(n, mw)), rails = m.rails.map((n) => mk(n, rw, false));
  const H = Math.max(...main.map((b) => heightOf(M, b.sub, b.badge, b.title!.length))), RH = Math.max(...rails.map((b) => heightOf(M, b.sub, b.badge, b.title!.length)));
  const top = 4, colH = 3 * RH + 2 * M.railGap, cy = top + colH / 2;
  // x of each column: the four steps, the rails, the last two.
  const xs = [0, 1, 2, 3].map((i) => i * (mw + gap)), rx = 4 * (mw + gap), after = [rx + rw + gap, rx + rw + gap + mw + gap];
  [...main.slice(0, 4).map((b, i) => [b, xs[i]!] as const), [main[4]!, after[0]!] as const, [main[5]!, after[1]!] as const].forEach(([b, x]) => Object.assign(b, { x, y: cy - H / 2, h: H }));
  rails.forEach((b, i) => Object.assign(b, { x: rx, y: top + i * (RH + M.railGap), h: RH }));
  const W = after[1]! + mw + 2;
  const c = (b: Box) => b.x + b.w / 2, mid = (b: Box) => b.y + b.h / 2;
  const [, , rules, passkey] = main as [Box, Box, Box, Box];
  const x0 = c(main[0]!), x1 = c(main[5]!), bottom = cy + H / 2, pillTop = bottom + 28;
  const pill = (n: MapNode | null, b: Box): Box[] => {
    if (!n?.badge) return [];
    const lines = wrap(n.badge, chars(mw, M.size.badge));
    return [{ n, x: b.x, y: pillTop, w: mw, h: pillHeight(M, lines), sub: [], badge: lines }];
  };
  const pills = [...pill(m.held, rules), ...pill(m.refused, passkey)];
  // The checks' row under it all: its name, then one box a check, across the drawing's width.
  const below = Math.max(top + colH, ...pills.map((p) => p.y + p.h));
  const n = m.checks.length, cw = n ? (W - 2 - (n - 1) * gap) / n : 0;
  const checks = m.checks.map((c) => mk(c, cw));
  const labelY = below + 24, rowY = labelY + M.lh.title - 4;
  const CH = checks.length ? Math.max(...checks.map((b) => heightOf(M, b.sub, b.badge, b.title!.length))) : 0;
  checks.forEach((b, i) => Object.assign(b, { x: i * (cw + gap), y: rowY, h: CH }));
  const vh = Math.ceil((checks.length ? rowY + CH : below) + 4);
  const [alta, , visa] = rails as [Box, Box, Box];
  const fork = (r: Box) => `M${passkey.x + mw} ${cy} C${passkey.x + mw + 18} ${cy} ${r.x - 18} ${mid(r)} ${r.x} ${mid(r)}`;
  const merge = (r: Box) => `M${r.x + rw} ${mid(r)} C${r.x + rw + 18} ${mid(r)} ${after[0]! - 18} ${cy} ${after[0]!} ${cy}`;
  const heldPill = pills.find((p) => p.n.id === "held"), badPill = pills.find((p) => p.n.id === "refused");
  return {
    variant: "wide", vw: W, vh, boxes: [...main, ...rails, ...checks], pills,
    labels: checks.length ? [{ x: 0, y: labelY, text: CHECKS_TITLE }] : [],
    lines: [`M${x0} ${cy} H${x1}`, fork(alta), fork(visa), merge(alta), merge(visa)],
    branch: [...(heldPill ? [{ cls: "held", d: `M${c(rules)} ${bottom} V${heldPill.y}` }] : []), ...(badPill ? [{ cls: "bad", d: `M${c(passkey)} ${bottom} V${badPill.y}` }] : [])],
    dots: [{ cls: "ok", d: `M${x0} ${cy} H${main[5]!.x}` }, ...(badPill ? [{ cls: "bad", d: `M${x0} ${cy} H${c(passkey)} V${badPill.y}` }] : []), ...(heldPill ? [{ cls: "hold", d: `M${x0} ${cy} H${c(rules)} V${heldPill.y}` }] : [])],
    hits: [...main, rails[1]!].map((b) => ({ id: b.n.id, at: Math.min(1, (b.x - x0) / (main[5]!.x - x0)) })).concat(checkHits(checks)),
    pillHits: pills.map((p) => ({ id: p.n.id, at: 1 })),
  };
}

/** The checks light up one after another, left to right (top to bottom on a phone), while the dot runs. */
const checkHits = (checks: Box[]) => checks.map((b, i) => ({ id: b.n.id, at: (i + 0.5) / checks.length }));

/**
 * Top to bottom (a phone). The dot never crosses a card's text (the owner's review, 19 Nov: at 390 px it ran through the
 * cards): it runs down a spine in the left gutter, a short tick into each card; a branch leaves the spine in the gap
 * under its card, crosses that gap to the right of the cards and rises to its pill.
 */
function tall(m: EvidenceMap): Layout {
  const W = 340, sx = 7, nx = 20, nw = 220, px = 252, pw = 88, gap = 26;
  const chars = (w: number, size: number) => Math.floor((w - 2 * PAD) / (size * 0.49));
  const mk = (n: MapNode): Box => ({ n, x: nx, y: 0, w: nw, h: 0, sub: wrap(n.sub, chars(nw, 11.5)), badge: n.badge ? wrap(n.badge, chars(nw - 8, 11.5)) : [] });
  // The steps in order, the rails between the signature and the bundle, Airwallex first.
  const order = [...m.main.slice(0, 4), m.rails[1]!, m.rails[0]!, m.rails[2]!, ...m.main.slice(4)].map(mk);
  let y = 4;
  order.forEach((b, i) => { b.h = heightOf(PAGE, b.sub, b.badge); b.y = y; y += b.h + (i >= 4 && i < 6 ? 8 : gap); });
  const end = y - gap;
  const mid = (b: Box) => b.y + b.h / 2, by = (id: string) => order.find((b) => b.n.id === id)!;
  const pill = (n: MapNode | null, at: Box): Box[] => {
    if (!n?.badge) return [];
    const lines = wrap(n.badge, chars(pw, 11.5)), h = pillHeight(PAGE, lines);
    return [{ n, x: px, y: mid(at) - h / 2, w: pw, h, sub: [], badge: lines }];
  };
  const rules = by("rules"), passkey = by("passkey");
  const pills = [...pill(m.held, rules), ...pill(m.refused, passkey)];
  const heldPill = pills.find((p) => p.n.id === "held"), badPill = pills.find((p) => p.n.id === "refused");
  const first = order[0]!, last = order[order.length - 1]!;
  const y0 = mid(first), y1 = mid(last);
  // The checks under the path, off the spine: their name, then one card each.
  const labelY = end + 26;
  let cy = labelY + 8;
  const checks = m.checks.map((n) => { const b = mk(n); b.x = sx - 3; b.w = W - b.x; b.sub = wrap(n.sub, chars(b.w, 11.5)); b.badge = n.badge ? wrap(n.badge, chars(b.w - 8, 11.5)) : []; b.h = heightOf(PAGE, b.sub, b.badge); b.y = cy; cy += b.h + 8; return b; });
  const vh = Math.ceil((checks.length ? cy - 8 : end) + 4);
  // A branch: down the spine to the gap under its card, across it to under the pill, up to the pill's bottom edge.
  const under = (b: Box) => b.y + b.h + gap / 2;
  const toPill = (b: Box, p: Box) => `M${sx} ${y0} V${under(b)} H${p.x + p.w / 2} V${p.y + p.h}`;
  return {
    variant: "tall", vw: W, vh, boxes: [...order, ...checks], pills,
    labels: checks.length ? [{ x: sx - 3, y: labelY, text: CHECKS_TITLE }] : [],
    lines: [`M${sx} ${y0} V${y1}`, ...order.map((b) => `M${sx} ${mid(b)} H${nx}`)],
    branch: [...(heldPill ? [{ cls: "held", d: `M${nx + nw} ${mid(rules)} H${px}` }] : []), ...(badPill ? [{ cls: "bad", d: `M${nx + nw} ${mid(passkey)} H${px}` }] : [])],
    dots: [{ cls: "ok", d: `M${sx} ${y0} V${y1}` }, ...(badPill ? [{ cls: "bad", d: toPill(passkey, badPill) }] : []), ...(heldPill ? [{ cls: "hold", d: toPill(rules, heldPill) }] : [])],
    hits: order.map((b) => ({ id: b.n.id, at: Math.max(0, Math.min(1, (mid(b) - y0) / (y1 - y0))) })).concat(checkHits(checks)),
    pillHits: pills.map((p) => ({ id: p.n.id, at: 1 })),
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The baseline below a line's top, for text of this size (the font's ascent). */
const asc = (size: number) => Math.round(size * 0.93);

function svg(l: Layout, M: Metrics = PAGE, o: { links?: boolean; head?: string; root?: string } = {}): string {
  const links = o.links ?? true;
  const text = (x: number, y: number, cls: string, s: string) => `<text class="${cls}" x="${r1(x)}" y="${r1(y)}">${esc(s)}</text>`;
  // A step: a link to its wall group on /proof; a plain group in a picture (the README's), where links do not work.
  const wrapIn = (cls: string, href: string, label: string, inner: string) => (links ? `<a class="${cls}" href="#${esc(href)}" aria-label="${esc(label)}">${inner}</a>` : `<g class="${cls}">${inner}</g>`);
  const box = (b: Box) => {
    const label = [b.n.title, b.n.sub, b.n.badge].filter(Boolean).join(". ");
    const titles = b.title ?? [b.n.title];
    const parts = [`<rect class="em-box" x="${r1(b.x + 0.5)}" y="${r1(b.y + 0.5)}" width="${b.w - 1}" height="${r1(b.h - 1)}" rx="10"/>`, ...titles.map((t, i) => text(b.x + M.pad, b.y + M.pad + asc(M.size.title) + i * M.lh.title, "em-t", t))];
    let y = b.y + M.pad + titles.length * M.lh.title + asc(M.size.sub) - 1;
    for (const s of b.sub) { parts.push(text(b.x + M.pad, y, "em-s", s)); y += M.lh.sub; }
    if (b.badge.length) {
      const top = y - asc(M.size.sub) + 6, h = b.badge.length * M.lh.badge + 8;
      parts.push(`<rect class="em-bg" x="${r1(b.x + M.pad - 4)}" y="${r1(top)}" width="${b.w - 2 * M.pad + 8}" height="${h}" rx="7"/>`);
      b.badge.forEach((s, i) => parts.push(text(b.x + M.pad, top + 4 + asc(M.size.badge) - 1 + i * M.lh.badge, "em-v", s)));
    }
    return wrapIn(`em-n${b.n.tone ? ` ${b.n.tone}` : ""} em-h-${b.n.id}`, b.n.group, label, parts.join(""));
  };
  const pill = (p: Box) => wrapIn(`em-p ${p.n.id} em-h-${p.n.id}`, p.n.group, `${p.n.title}: ${p.n.badge}`, `<rect class="em-pb" x="${r1(p.x + 0.5)}" y="${r1(p.y + 0.5)}" width="${p.w - 1}" height="${r1(p.h - 1)}" rx="10"/>${p.badge.map((s, i) => text(p.x + 8, p.y + 10 + asc(M.size.badge) - 1 + i * M.lh.badge, "em-v", s)).join("")}`);
  return `<svg class="em-${l.variant}" viewBox="0 0 ${l.vw} ${l.vh}" width="${l.vw}" height="${l.vh}" ${o.root ?? `role="group" aria-label="${esc("The money path, with the evidence for each step")}"`}>${o.head ?? ""}
${l.lines.map((d) => `<path class="em-line" d="${d}"/>`).join("")}${l.branch.map((b) => `<path class="em-br ${b.cls}" d="${b.d}"/>`).join("")}
${l.labels.map((t) => text(t.x, t.y, "em-k", t.text)).join("")}
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
  return `
.emap { margin: 6px 0 22px; --held: #b45309; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .emap { --held: #fbbf24; } }
:root[data-theme="dark"] .emap { --held: #fbbf24; }
.emap svg { display: block; width: 100%; height: auto; overflow: visible; font-family: inherit; }
.emap svg.em-tall { display: none; max-width: 420px; }
@media (max-width: 760px) { .emap svg.em-wide { display: none; } .emap svg.em-tall { display: block; } }
.emap figcaption { margin: 8px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--muted); }
.emap .em-n:hover .em-box, .emap .em-n:focus-visible .em-box { stroke: var(--pc); stroke-width: 2.5; }
.emap .em-p:hover .em-pb, .emap .em-p:focus-visible .em-pb { stroke-width: 2.5; stroke-dasharray: none; }
.emap a:focus-visible { outline: none; }
${m ? mapRules(".emap ", PAGE, [wide(m), tall(m)]) : ""}`;
}

/** The drawing's own rules (colours from the custom properties, sizes from M), each selector after `prefix`. */
function mapRules(prefix: string, M: Metrics, layouts: Layout[]): string {
  const P = prefix;
  const timing = layouts.flatMap((l) => [
    ...l.hits.map((h) => `${P}svg.em-${l.variant} .em-h-${h.id} .em-box { animation: em-glow ${T}s linear ${(h.at * MOVE * T).toFixed(2)}s infinite; }`),
    ...l.pillHits.map((h) => `${P}svg.em-${l.variant} .em-h-${h.id} .em-pb { animation: em-glow-${h.id === "held" ? "held" : "bad"} ${T}s linear ${(DELAY[h.id === "held" ? "hold" : "bad"] + h.at * MOVE * T).toFixed(2)}s infinite; }`),
  ]);
  return `${P}.em-line { fill: none; stroke: var(--border); stroke-width: 2; }
${P}.em-br { fill: none; stroke-width: 2; stroke-dasharray: 5 4; }
${P}.em-br.held { stroke: var(--held); } ${P}.em-br.bad { stroke: var(--bad); }
${P}.em-n { --pc: var(--accent); --ps: var(--accent-soft); }
${P}.em-n.awx { --pc: var(--awx); --ps: var(--awx-soft); } ${P}.em-n.metal { --pc: var(--metal); --ps: var(--metal-soft); }
${P}.em-n.claude { --pc: var(--claude); --ps: var(--claude-soft); } ${P}.em-n.ok { --pc: var(--ok); --ps: var(--ok-soft); }
${P}.em-box { fill: var(--surface); stroke: var(--border); stroke-width: 1.2; }
${P}.em-t { fill: var(--text); font-size: ${M.size.title}px; font-weight: 740; }
${P}.em-s { fill: var(--muted); font-size: ${M.size.sub}px; }
${P}.em-k { fill: var(--muted); font-size: ${M.size.sub}px; font-weight: 700; letter-spacing: .02em; }
${P}.em-bg { fill: var(--ps); }
${P}.em-v { fill: var(--pc); font-size: ${M.size.badge}px; font-weight: 700; font-variant-numeric: tabular-nums; }
${P}.em-p.held { --pc: var(--held); } ${P}.em-p.refused { --pc: var(--bad); }
${P}.em-pb { fill: var(--surface); stroke: var(--pc); stroke-width: 1.5; stroke-dasharray: 5 4; }
/* The dots: a zero-length dash with a round cap, moved along the path by its offset. Hidden when still. */
${P}.em-dot { fill: none; stroke-width: ${M.dot}; stroke-linecap: round; stroke-dasharray: 0 1000; opacity: 0; pointer-events: none; }
${P}.em-dot.ok { stroke: var(--ok); } ${P}.em-dot.bad { stroke: var(--bad); } ${P}.em-dot.hold { stroke: var(--held); }
${P}.em-dot.halo { stroke: var(--surface); stroke-width: ${M.halo}; }
@media (prefers-reduced-motion: no-preference) {
  ${P}.em-dot { animation: em-move ${T}s linear infinite; }
  ${P}.em-dot.bad { animation-delay: ${DELAY.bad}s; } ${P}.em-dot.hold { animation-delay: ${DELAY.hold}s; }
  ${timing.join("\n  ")}
}
@media (prefers-reduced-motion: reduce) { ${P}.em-dot, ${P}.em-box, ${P}.em-pb { animation: none; } }
@keyframes em-move { 0% { stroke-dashoffset: 0; opacity: 0; } 3% { opacity: 1; } ${MOVE * 100}% { stroke-dashoffset: -100; opacity: 1; } ${MOVE * 100 + 6}%, 100% { stroke-dashoffset: -100; opacity: 0; } }
@keyframes em-glow { 0% { stroke: var(--pc); stroke-width: 3; } 12%, 100% { stroke: var(--border); stroke-width: 1.2; } }
@keyframes em-glow-held { 0% { stroke-width: 3.5; stroke-dasharray: none; } 15%, 100% { stroke-width: 1.5; stroke-dasharray: 5 4; } }
@keyframes em-glow-bad { 0% { stroke-width: 3.5; stroke-dasharray: none; } 15%, 100% { stroke-width: 1.5; stroke-dasharray: 5 4; } }
`;
}

/** The colours of the site's two themes (src/redesign/ui.ts TOKENS), for a picture that cannot read them. */
const THEME: Record<"light" | "dark", Record<string, string>> = {
  light: { surface: "#ffffff", border: "#d5d9e1", text: "#0b1220", muted: "#586174", accent: "#4f46e5", "accent-soft": "#eef0ff", ok: "#0b7d43", "ok-soft": "#e6f6ee", bad: "#c5363c", held: "#b45309", awx: "#ad4a0c", "awx-soft": "#fdf0e7", metal: "#0b7a70", "metal-soft": "#e3f5f2", claude: "#a84d2b", "claude-soft": "#fbefe9" },
  dark: { surface: "#12151d", border: "#2f3542", text: "#eef1f6", muted: "#a4adbd", accent: "#8b85ff", "accent-soft": "#23224a", ok: "#3ccf82", "ok-soft": "#12291e", bad: "#ff6b70", held: "#fbbf24", awx: "#ff8a4c", "awx-soft": "#33200f", metal: "#2dd4bf", "metal-soft": "#0f2a28", claude: "#ef9a76", "claude-soft": "#33221b" },
};
export const README_MAP_FILES = { light: "docs/assets/readme/evidence-map-light.svg", dark: "docs/assets/readme/evidence-map-dark.svg" } as const;

/** The README's words for the drawing (its alt text): the path and every figure on it, from the same data. */
export function evidenceMapAlt(w: EvidenceWall | null = committedWall()): string {
  const m = evidenceMap(w);
  if (!m) return "";
  // Short (the README's word budget): each step's title and its badge, the two branches, what is simulated.
  const step = (n: MapNode) => `${n.title}${n.badge ? ` (${n.badge})` : ""}`;
  return `Animated money path: ${[...m.main.slice(0, 4), ...m.rails, ...m.main.slice(4)].map(step).join("; ")}.${m.refused?.badge ? ` Refused: ${m.refused.badge}.` : ""}${m.held?.badge ? ` Held: ${m.held.badge}.` : ""}${m.checks.length ? ` ${CHECKS_TITLE}: ${m.checks.map(step).join("; ")}.` : ""} Test money.`;
}

/** The README's line with the map: light and dark pictures, linked to the wall on /proof, the path and figures as its alt. */
export function readmeMapLine(w: EvidenceWall | null = committedWall()): string {
  const alt = evidenceMapAlt(w);
  if (!alt) return "";
  return `<a href="https://kit11.max-31b.workers.dev/proof#evidence"><picture><source media="(prefers-color-scheme: dark)" srcset="${README_MAP_FILES.dark}"><img src="${README_MAP_FILES.light}" alt="${esc(alt)}" width="100%"></picture></a>`;
}

/**
 * The map as a picture for the README (npm run evidence:wall writes both files): the wide drawing in README_MAP's sizes,
 * the theme's colours and a system font inside, CSS keyframes inside, nothing external; under prefers-reduced-motion the
 * dots stay hidden.
 */
export function evidenceMapSvgFile(theme: "light" | "dark", w: EvidenceWall | null = committedWall()): string {
  const m = evidenceMap(w);
  if (!m) return "";
  const l = wide(m, README_MAP);
  const vars = Object.entries(THEME[theme]).map(([k, v]) => `--${k}: ${v};`).join(" ");
  const style = `<style>
svg.em-wide { ${vars} font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
${mapRules("", README_MAP, [l])}</style>`;
  const head = `<title>${esc("Purser: the money path and its evidence")}</title><desc>${esc(evidenceMapAlt(w))}</desc>${style}`;
  // Cropped to the drawing, with a margin of 12 units (about 9 px at GitHub's width) on every side.
  const M0 = 12, out = svg(l, README_MAP, { links: false, head, root: `xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t d"` })
    .replace(`viewBox="0 0 ${l.vw} ${l.vh}" width="${l.vw}" height="${l.vh}"`, `viewBox="${-M0} ${-M0} ${l.vw + 2 * M0} ${l.vh + 2 * M0}" width="${l.vw + 2 * M0}" height="${l.vh + 2 * M0}"`);
  return `${out.replace("<title>", '<title id="t">').replace("<desc>", '<desc id="d">')}\n`;
}
