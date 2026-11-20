// /proof's architecture, animated (the owner, 21 Nov: "an animated architecture at the top: the real system"): the
// agents decide with Claude, Purser's rails (code) hold them to the CFO's limits, the CFO's passkey signs the exact terms,
// and the money moves on Airwallex, Alta or Visa via Airi, the books posted to T:0; every step writes the audit log, whose
// head is sealed on Alta and re-checked by verify-all. Each box is a link to the section of /proof that proves it, with
// one figure of that proof from docs/evidence/evidence-wall.json (the wall's record-read figures) and its day; only the
// words around the figures are written here.
// Motion (CSS keyframes on SVG strokes, no script, so the page's CSP holds): a green dot carries a payment from the
// agents to each rail in turn, an indigo one the signature from the passkey, a red one ends at Purser (refused, nothing
// moves), and grey ticks fall from each step to the audit log. Under prefers-reduced-motion nothing moves: the still
// drawing. Two drawings of the same system: left to right on a wide screen, top to bottom on a phone (CSS shows one).

import { committedWall, type EvidenceWall, type WallTile } from "./evidenceWall.js";
import { wrap } from "./evidenceMap.js";
import { shortDay } from "../proof/recordDate.js";
import { esc } from "./ui.js";

export const ARCH_ID = "architecture";
export const ARCH_CAPTION = "How Purser works, and where each part is proved: Claude decides, code enforces the CFO's limits, the CFO's passkey signs the exact terms, the partners move the money. Tap a part for its proof. Sandbox and testnet, test money; a sandbox PAID is simulated.";

type Tone = "claude" | "ok" | "accent" | "awx" | "metal" | "visa" | "ink" | "bad";
export interface ArchNode { id: string; title: string; sub: string; href: string; tone: Tone; badge: string | null; rec: string }
export interface Arch { agents: ArchNode; purser: ArchNode; passkey: ArchNode; rails: ArchNode[]; audit: ArchNode; checks: ArchNode; refused: ArchNode; built: ArchNode }

/** The drawing's parts, each with the wall figure it carries (null when the wall has none). */
export function archNodes(w: EvidenceWall | null = committedWall()): Arch | null {
  if (!w?.groups.length) return null;
  const tiles = new Map<string, WallTile>(w.groups.flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  const fig = (key: string, words: string) => {
    const t = tiles.get(key);
    return t ? { badge: `${t.fig} ${words}${t.asOf ? ` · ${shortDay(t.asOf)}` : ""}`, rec: t.rec } : { badge: null, rec: "" };
  };
  const node = (id: string, title: string, sub: string, href: string, tone: Tone, f: { badge: string | null; rec: string }): ArchNode => ({ id, title, sub, href, tone, ...f });
  return {
    agents: node("agents", "Agents", "decide with Claude: read, match, propose", "#q-ai", "claude", fig("claude-main", "decisions by Claude")),
    purser: node("purser", "Purser's rails", "code holds every proposal to the CFO's limits", "#q-limits", "ok", fig("red-team", "known attacks stopped")),
    passkey: node("passkey", "CFO's passkey", "Face ID signs the hash of the exact terms", "#signed", "accent", fig("tamper-matrix", "forged copies refused")),
    rails: [
      node("airwallex", "Airwallex", "payouts, FX, cards, bills", "#pl-airwallex", "awx", fig("soak-paid", "paid, hash read back")),
      node("alta", "Alta", "on-chain mandates", "#pl-alta", "metal", fig("alta-payments", "payments in mandate")),
      node("visa", "Visa via Airi", "agent card purchases", "#pl-visa", "visa", fig("visa-airi", "after Face ID")),
      node("t0", "T:0", "outside general ledger", "#pl-t0", "ink", fig("t0-readback", "entries agree")),
    ],
    audit: node("audit", "Audit log", "every step, hash-chained", "#q-verify", "ink", fig("anchor", "records sealed in one Alta anchor")),
    checks: node("checks", "Checkpoints", "anyone re-checks offline", "#q-verify", "ok", fig("verify-all", "checks passed by verify-all")),
    refused: node("refused", "Refused", "nothing moves", "#q-limits", "bad", fig("try-cent", "one-cent changes refused")),
    built: node("built", "Built and checked", "tests, coverage, formal proofs, CI, a signed release", "#q-built", "ink", fig("formal-dafny", "proof obligations verified")),
  };
}

// ── Layout ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Box { n: ArchNode; x: number; y: number; w: number; h: number; title: string[]; sub: string[]; badge: string[] }
interface Layout { variant: "wide" | "tall"; vw: number; vh: number; boxes: Box[]; lines: { cls: string; d: string }[]; dots: { cls: string; d: string; delay: number }[]; glows: { id: string; at: number }[] }

const M = { pad: 10, lt: 18, ls: 14.5, lb: 14.5, st: 14.5, ss: 11.5, sb: 11.5, cw: 0.5 };
const T = 8; // seconds a loop
const chars = (w: number, size: number) => Math.max(8, Math.floor((w - 2 * M.pad) / (size * M.cw)));
function mk(n: ArchNode, w: number, withSub = true): Box {
  const title = wrap(n.title, chars(w, M.st * 1.04)), sub = withSub ? wrap(n.sub, chars(w, M.ss)) : [], badge = n.badge ? wrap(n.badge, chars(w - 8, M.sb)) : [];
  return { n, x: 0, y: 0, w, h: M.pad + title.length * M.lt + sub.length * M.ls + (badge.length ? 8 + badge.length * M.lb + 6 : 0) + M.pad, title, sub, badge };
}
const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2;

function wide(a: Arch): Layout {
  const mw = 176, gap = 52, rw = 206, rg = 10;
  const [agents, purser, passkey] = [a.agents, a.purser, a.passkey].map((n) => mk(n, mw)) as [Box, Box, Box];
  const rails = a.rails.map((n) => mk(n, rw));
  const refused = mk(a.refused, mw, false);
  const top = 2;
  refused.y = top;
  const railTop = top + 10, colH = rails.reduce((s, b) => s + b.h, 0) + (rails.length - 1) * rg;
  const mid = railTop + colH / 2;
  const mainH = Math.max(agents.h, purser.h, passkey.h);
  [agents, purser, passkey].forEach((b, i) => Object.assign(b, { x: i * (mw + gap), h: mainH, y: Math.max(refused.y + refused.h + 26, mid - mainH / 2) }));
  const rx = 3 * (mw + gap);
  let y = Math.max(railTop, cy(passkey) - colH / 2);
  rails.forEach((b) => { Object.assign(b, { x: rx, y }); y += b.h + rg; });
  refused.x = purser.x;
  const W = rx + rw + 2;
  const below = Math.max(y - rg, passkey.y + passkey.h) + 40;
  const audit = mk(a.audit, 2 * mw + gap + 60), checks = mk(a.checks, rw);
  const lowH = Math.max(audit.h, checks.h);
  // Under the three steps, from the agents' left edge to the passkey's right: each step's dotted line lands on it.
  Object.assign(audit, { x: 0, y: below, h: lowH, w: passkey.x + mw });
  Object.assign(checks, { x: rx, y: below, h: lowH });
  const built = mk(a.built, W - 2, true);
  Object.assign(built, { x: 0, y: below + lowH + 22 });
  // A one-line footer box: its title and its sub on one line when it fits.
  built.sub = wrap(`${a.built.sub}`, chars(W - 2, M.ss) - 20);
  built.h = M.pad + M.lt + built.sub.length * M.ls + (built.badge.length ? 8 + built.badge.length * M.lb + 6 : 0) + M.pad;
  const vh = Math.ceil(built.y + built.h + 2);
  const yM = cy(passkey);
  const fork = (r: Box) => `M${passkey.x + mw} ${yM} C${passkey.x + mw + 26} ${yM} ${r.x - 26} ${cy(r)} ${r.x} ${cy(r)}`;
  const route = (r: Box) => `M${cx(agents)} ${yM} H${passkey.x + mw} C${passkey.x + mw + 26} ${yM} ${r.x - 26} ${cy(r)} ${r.x + 10} ${cy(r)}`;
  const down = (b: Box) => `M${cx(b)} ${b.y + b.h} V${audit.y}`;
  const auditToChecks = `M${audit.x + audit.w} ${cy(audit)} H${checks.x}`;
  return {
    variant: "wide", vw: W, vh, boxes: [refused, agents, purser, passkey, ...rails, audit, checks, built],
    lines: [
      { cls: "money", d: `M${agents.x + mw} ${yM} H${passkey.x}` },
      ...rails.map((r) => ({ cls: "signed", d: fork(r) })),
      { cls: "bad", d: `M${cx(purser)} ${purser.y} V${refused.y + refused.h}` },
      ...[agents, purser, passkey].map((b) => ({ cls: "log", d: down(b) })),
      { cls: "log", d: auditToChecks },
    ],
    dots: [
      ...rails.map((r, i) => ({ cls: "ok", d: route(r), delay: i * (T / rails.length) })),
      ...rails.map((r, i) => ({ cls: "sig", d: `M${passkey.x + mw / 2} ${yM} H${passkey.x + mw} C${passkey.x + mw + 26} ${yM} ${r.x - 26} ${cy(r)} ${r.x + 10} ${cy(r)}`, delay: i * (T / rails.length) + T * 0.3 })),
      { cls: "bad", d: `M${cx(agents)} ${yM} H${cx(purser)} V${refused.y + refused.h - 6}`, delay: T * 0.55 },
      ...[agents, purser, passkey].map((b, i) => ({ cls: "log", d: down(b), delay: T * (0.1 + i * 0.12) })),
      { cls: "log", d: auditToChecks, delay: T * 0.6 },
    ],
    glows: [{ id: "agents", at: 0 }, { id: "purser", at: 0.14 }, { id: "passkey", at: 0.3 }, ...rails.map((r, i) => ({ id: r.n.id, at: 0.62 + i / rails.length }))],
  };
}

/** Top to bottom (a phone): one column, the rails two by two, the refusal to the right of Purser. */
function tall(a: Arch): Layout {
  const W = 340, x0 = 22, w = W - x0, gap = 26, rg = 8;
  const order = [a.agents, a.purser, a.passkey].map((n) => mk(n, w - 96));
  const refused = mk(a.refused, 88, false);
  let y = 2;
  order.forEach((b) => { b.x = x0; b.y = y; y += b.h + gap; });
  const [, purser, passkey] = order as [Box, Box, Box];
  refused.x = W - 88; refused.y = cy(purser) - refused.h / 2;
  const half = (w - rg) / 2;
  const rails = a.rails.map((n) => mk(n, half));
  const rowH = [Math.max(rails[0]!.h, rails[1]!.h), Math.max(rails[2]?.h ?? 0, rails[3]?.h ?? 0)];
  rails.forEach((b, i) => { b.x = x0 + (i % 2) * (half + rg); b.y = y + (i < 2 ? 0 : rowH[0]! + rg); b.h = rowH[i < 2 ? 0 : 1]!; });
  y += rowH[0]! + rg + rowH[1]! + gap;
  const audit = mk(a.audit, w), checks = mk(a.checks, w), built = mk(a.built, w);
  for (const b of [audit, checks, built]) { b.x = x0; b.y = y; y += b.h + (b === checks ? gap : 12); }
  const vh = Math.ceil(y - 12 + 2);
  const sx = 8;
  const tick = (b: Box) => `M${sx} ${cy(b)} H${b.x}`;
  const spineEnd = cy(rails[2]!);
  return {
    variant: "tall", vw: W, vh, boxes: [...order, refused, ...rails, audit, checks, built],
    lines: [
      { cls: "money", d: `M${sx} ${cy(order[0]!)} V${cy(passkey)}` },
      { cls: "signed", d: `M${sx} ${cy(passkey)} V${spineEnd}` },
      ...[...order, rails[0]!, rails[2]!].map((b) => ({ cls: "money", d: tick(b) })),
      { cls: "bad", d: `M${purser.x + purser.w} ${cy(purser)} H${refused.x}` },
      { cls: "log", d: `M${sx} ${spineEnd} V${cy(checks)}` }, { cls: "log", d: tick(audit) }, { cls: "log", d: tick(checks) },
    ],
    dots: [
      { cls: "ok", d: `M${sx} ${cy(order[0]!)} V${spineEnd}`, delay: 0 },
      { cls: "sig", d: `M${sx} ${cy(passkey)} V${spineEnd}`, delay: T * 0.35 },
      { cls: "bad", d: `M${sx} ${cy(order[0]!)} V${cy(purser)} H${refused.x - 4}`, delay: T * 0.55 },
      { cls: "log", d: `M${sx} ${spineEnd} V${cy(checks)}`, delay: T * 0.7 },
    ],
    glows: [{ id: "agents", at: 0 }, { id: "purser", at: 0.2 }, { id: "passkey", at: 0.4 }, { id: "airwallex", at: 0.75 }, { id: "alta", at: 0.75 }, { id: "visa", at: 0.8 }, { id: "t0", at: 0.8 }],
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const asc = (size: number) => Math.round(size * 0.93);

function svg(l: Layout): string {
  const text = (x: number, y: number, cls: string, s: string) => `<text class="${cls}" x="${r1(x)}" y="${r1(y)}">${esc(s)}</text>`;
  const box = (b: Box) => {
    const label = [b.n.title, b.n.sub, b.n.badge].filter(Boolean).join(". ");
    const parts = [`<rect class="pa-box" x="${r1(b.x + 0.5)}" y="${r1(b.y + 0.5)}" width="${r1(b.w - 1)}" height="${r1(b.h - 1)}" rx="12"/>`];
    let y = b.y + M.pad + asc(M.st);
    for (const t of b.title) { parts.push(text(b.x + M.pad, y, "pa-t", t)); y += M.lt; }
    y += asc(M.ss) - asc(M.st) + (M.ls - M.lt);
    for (const s of b.sub) { y += 0; parts.push(text(b.x + M.pad, y + 2, "pa-s", s)); y += M.ls; }
    if (b.badge.length) {
      const top = y - asc(M.ss) + 8, h = b.badge.length * M.lb + 7;
      parts.push(`<rect class="pa-bg" x="${r1(b.x + M.pad - 4)}" y="${r1(top)}" width="${r1(b.w - 2 * M.pad + 8)}" height="${r1(h)}" rx="7"/>`);
      b.badge.forEach((s, i) => parts.push(text(b.x + M.pad, top + 4 + asc(M.sb) - 1 + i * M.lb, "pa-v", s)));
    }
    return `<a class="pa-n ${b.n.tone} pa-h-${b.n.id}" href="${esc(b.n.href)}" aria-label="${esc(label)}"${b.n.rec ? ` data-rec="${esc(b.n.rec)}"` : ""}>${parts.join("")}</a>`;
  };
  return `<svg class="pa-${l.variant}" viewBox="0 0 ${l.vw} ${l.vh}" width="${l.vw}" height="${l.vh}" role="group" aria-label="${esc("Purser's architecture: each part links to its proof")}">
${l.lines.map((x) => `<path class="pa-line ${x.cls}" d="${x.d}"/>`).join("")}
${l.dots.map((d, i) => `<path class="pa-dot halo ${d.cls} pa-d${i}" d="${d.d}" pathLength="100"/><path class="pa-dot ${d.cls} pa-d${i}" d="${d.d}" pathLength="100"/>`).join("")}
${l.boxes.map(box).join("\n")}
</svg>`;
}

/** The legend under the drawing: what each moving dot is. */
const LEGEND: [string, string][] = [["ok", "a payment within the limits"], ["sig", "the CFO's signature over its terms"], ["bad", "a proposal refused: nothing moves"], ["log", "every step written to the audit log"]];

export function archHtml(w: EvidenceWall | null = committedWall()): string {
  const a = archNodes(w);
  if (!a) return "";
  return `<figure class="parch" id="${ARCH_ID}" aria-labelledby="pa-cap" data-rec="docs/evidence/evidence-wall.json">${svg(wide(a))}${svg(tall(a))}
<ul class="pa-leg" aria-label="${esc("What moves in the drawing")}">${LEGEND.map(([c, t]) => `<li><span class="pa-sw pa-sw-${c}" aria-hidden="true"></span>${esc(t)}</li>`).join("")}</ul>
<figcaption id="pa-cap">${esc(ARCH_CAPTION)}</figcaption></figure>`;
}

/** The drawing's style: colours from the theme, each box's glow timed to its dot. Only with motion allowed does anything move. */
export function archCss(w: EvidenceWall | null = committedWall()): string {
  const a = archNodes(w);
  const layouts = a ? [wide(a), tall(a)] : [];
  // Each dot's start in its loop (a class each: the page's CSP allows no style attribute), then each box's glow.
  const glows = layouts.flatMap((l) => [
    ...l.dots.map((d, i) => `.parch svg.pa-${l.variant} .pa-d${i} { animation-delay: ${r1(d.delay)}s; }`),
    ...l.glows.map((g) => `.parch svg.pa-${l.variant} .pa-h-${g.id} .pa-box { animation: pa-glow ${T}s linear ${r1(g.at * T * 0.4)}s infinite; }`),
  ]);
  return `
.parch { margin: 4px 0 18px; padding: 16px 16px 12px; border: 1px solid var(--border); border-radius: 18px; background: linear-gradient(180deg, color-mix(in srgb, var(--sunken) 55%, var(--surface)), var(--surface) 75%); --visa: var(--accent); --sig: var(--accent); }
.parch svg { display: block; width: 100%; height: auto; overflow: visible; font-family: inherit; }
.parch svg.pa-tall { display: none; max-width: 420px; margin: 0 auto; }
@media (max-width: 760px) { .parch { padding: 12px 10px 10px; } .parch svg.pa-wide { display: none; } .parch svg.pa-tall { display: block; } }
.parch .pa-n { --pc: var(--accent); --ps: var(--accent-soft); }
.parch .pa-n.claude { --pc: var(--claude); --ps: var(--claude-soft); } .parch .pa-n.ok { --pc: var(--ok); --ps: var(--ok-soft); }
.parch .pa-n.awx { --pc: var(--awx); --ps: var(--awx-soft); } .parch .pa-n.metal { --pc: var(--metal); --ps: var(--metal-soft); }
.parch .pa-n.ink { --pc: var(--text); --ps: var(--sunken); } .parch .pa-n.bad { --pc: var(--bad); --ps: var(--bad-soft); }
.parch .pa-box { fill: var(--surface); stroke: color-mix(in srgb, var(--pc) 45%, var(--border)); stroke-width: 1.4; }
.parch .pa-n.bad .pa-box { stroke-dasharray: 5 4; stroke: var(--bad); }
.parch .pa-t { fill: var(--text); font-size: ${M.st}px; font-weight: 750; }
.parch .pa-s { fill: var(--muted); font-size: ${M.ss}px; }
.parch .pa-bg { fill: var(--ps); }
.parch .pa-v { fill: var(--pc); font-size: ${M.sb}px; font-weight: 700; font-variant-numeric: tabular-nums; }
.parch .pa-n:hover .pa-box, .parch .pa-n:focus-visible .pa-box { stroke: var(--pc); stroke-width: 2.6; }
.parch a:focus-visible { outline: none; }
.parch .pa-line { fill: none; stroke-width: 2; stroke: var(--border); }
.parch .pa-line.money { stroke: color-mix(in srgb, var(--ok) 55%, var(--border)); }
.parch .pa-line.signed { stroke: color-mix(in srgb, var(--sig) 55%, var(--border)); }
.parch .pa-line.bad { stroke: var(--bad); stroke-dasharray: 5 4; }
.parch .pa-line.log { stroke: var(--border); stroke-dasharray: 2 4; }
.parch .pa-dot { fill: none; stroke-width: 10; stroke-linecap: round; stroke-dasharray: 0 1000; opacity: 0; pointer-events: none; }
.parch .pa-dot.ok { stroke: var(--ok); } .parch .pa-dot.sig { stroke: var(--sig); stroke-width: 7; } .parch .pa-dot.bad { stroke: var(--bad); } .parch .pa-dot.log { stroke: var(--muted); stroke-width: 6; }
.parch .pa-dot.halo { stroke: var(--surface); stroke-width: 16; } .parch .pa-dot.halo.sig { stroke-width: 12; } .parch .pa-dot.halo.log { stroke-width: 10; }
.parch ul.pa-leg { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--muted); }
.parch ul.pa-leg li { display: inline-flex; align-items: center; gap: 6px; }
.parch .pa-sw { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.parch .pa-sw-ok { background: var(--ok); } .parch .pa-sw-sig { background: var(--sig); } .parch .pa-sw-bad { background: var(--bad); } .parch .pa-sw-log { background: var(--muted); }
.parch figcaption { margin: 8px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--muted); }
@media (prefers-reduced-motion: no-preference) {
  .parch .pa-dot { animation: pa-move ${T}s linear infinite; }
  ${glows.join("\n  ")}
}
@media (prefers-reduced-motion: reduce) { .parch .pa-dot, .parch .pa-box { animation: none; } }
@keyframes pa-move { 0% { stroke-dashoffset: 0; opacity: 0; } 3% { opacity: 1; } 40% { stroke-dashoffset: -100; opacity: 1; } 46%, 100% { stroke-dashoffset: -100; opacity: 0; } }
@keyframes pa-glow { 0% { stroke: var(--pc); stroke-width: 3; } 10%, 100% { stroke: color-mix(in srgb, var(--pc) 45%, var(--border)); stroke-width: 1.4; } }
`;
}
