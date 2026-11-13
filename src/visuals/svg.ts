// Purser's visual system as code (12 Nov): inline SVG drawn from the site's design tokens, light and dark, no images.
// The diagrams carry no partner logos or brand marks: rails are named in text (the logos are a separate "Built with"
// row, src/visuals/logos.ts). Each partner keeps one colour (Airwallex, Metal, Airi, Claude); Purser is the accent.
// Three visuals:
//
// - architecture: agents → Purser's checks → the CFO's Face ID → the rail's own controls → ledger and books → archive,
//   the three layers that do not trust each other marked as such;
// - lifecycle: one payment's life, invoice → read → checked → terms → Face ID → rail's own control → paid → booked,
//   animated in CSS. The first frame is the whole picture (every step drawn), so a viewer that shows no animation, or
//   prefers reduced motion, sees it complete; the animation only moves a highlight along it;
// - rails: the rail itself holding a payment, one card per rail, from the run records (src/visuals/facts.ts).
//
// Each comes in two layouts: "wide" (README, desktop) and "tall" (phones). Standalone files carry their own palette
// (src/cli/visuals.ts writes a light and a dark file of each); on the site the SVG takes the page's tokens and its
// class rules go into the page's one stylesheet (VISUAL_CSS), so the pages keep their hash-based CSP.

import { esc, icon } from "../redesign/ui.js";
import { paletteCss, type Theme } from "./tokens.js";
import type { RailRefusal } from "./facts.js";

export type Layout = "wide" | "tall";
export const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Wraps text into lines of at most `max` characters, at spaces. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** A text block: one <text> with a <tspan> per line. */
function text(x: number, y: number, lines: string[], cls: string, lh: number, anchor: "start" | "middle" = "start"): string {
  const a = anchor === "middle" ? ' text-anchor="middle"' : "";
  return `<text class="${cls}" x="${x}" y="${y}"${a}>${lines.map((l, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join("")}</text>`;
}
const rect = (x: number, y: number, w: number, h: number, cls: string, r = 14) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const arrow = (x1: number, y1: number, x2: number, y2: number, cls = "pv-flow") => `<path class="${cls}" d="M${x1} ${y1} L${x2} ${y2}" marker-end="url(#pv-arrow)"/>`;
const defs = `<defs><marker id="pv-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="pv-tip" d="M0 0 L10 5 L0 10 z"/></marker></defs>`;

/**
 * The class rules every visual uses, against the site's token names. On the site they join the page's stylesheet;
 * a standalone file carries them with its palette. Motion only where the viewer allows it.
 */
/** One payment's life: seconds per step, the loop (the steps plus a pause), and the length of its line in each layout. */
export const LIFE_STEP_S = 1.75;
const LIFE_N = 8;
const LIFE_CYCLE = +(LIFE_N * LIFE_STEP_S / 0.88).toFixed(2);
const LIFE_WIDE = { w: 1200, x0: 84, gap: (1200 - 168) / (LIFE_N - 1) };
const LIFE_TALL = { w: 400, y0: 40, row: 66 };
const LIFE_LEN = { wide: Math.round(LIFE_WIDE.gap * (LIFE_N - 1)), tall: LIFE_TALL.row * (LIFE_N - 1) };

export const VISUAL_CSS = `.pv { display: block; width: 100%; height: auto; font-family: ${FONT}; }
.pv .pv-bg { fill: var(--bg); }
.pv .pv-box { fill: var(--surface); stroke: var(--border); stroke-width: 1.5; }
.pv .pv-sunk { fill: var(--sunken); stroke: none; }
.pv .pv-layer { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 5; }
.pv .pv-trust { fill: var(--accent-soft); stroke: none; }
.pv .pv-awx { fill: var(--awx-soft); stroke: none; } .pv .pv-metal { fill: var(--metal-soft); stroke: none; } .pv .pv-airi { fill: color-mix(in srgb, var(--a-sourcing) 13%, var(--surface)); stroke: none; }
.pv .pv-claude { fill: var(--claude-soft); stroke: none; } .pv .pv-ok { fill: var(--ok-soft); stroke: none; } .pv .pv-badbg { fill: var(--bad-soft); stroke: none; }
.pv text { fill: var(--text); font-family: ${FONT}; }
.pv .t-eye { font-size: 12.5px; font-weight: 700; letter-spacing: .08em; fill: var(--faint); }
.pv .t-h { font-size: 19px; font-weight: 750; letter-spacing: -.01em; }
.pv .t-h2 { font-size: 16px; font-weight: 700; }
.pv .t-b { font-size: 14.5px; fill: var(--muted); }
.pv .t-s { font-size: 13px; fill: var(--muted); }
.pv .t-f { font-size: 12.5px; fill: var(--faint); }
.pv .t-cap { font-size: 15px; font-weight: 650; fill: var(--accent); }
.pv .t-bad { font-size: 13px; font-weight: 650; fill: var(--bad); }
.pv .t-code { font-family: ${MONO}; font-size: 15px; font-weight: 700; fill: var(--bad); }
.pv .t-awx { fill: var(--awx); } .pv .t-metal { fill: var(--metal); } .pv .t-airi { fill: var(--a-sourcing); } .pv .t-acc { fill: var(--accent); } .pv .t-rail { fill: var(--text); } .pv .t-claude { fill: var(--claude); } .pv .t-ok { fill: var(--ok); }
.pv .t-link { font-size: 13.5px; font-weight: 650; fill: var(--accent); }
.pv a:hover .t-link, .pv a:focus .t-link { text-decoration: underline; }
.pv a:focus-visible .pv-box { stroke: var(--accent); stroke-width: 3; }
.pv .pv-flow, .pv .pv-still { fill: none; stroke: var(--faint); stroke-width: 2; stroke-dasharray: 5 5; }
.pv .pv-tip { fill: var(--faint); }
.pv .pv-line { fill: none; stroke: var(--border); stroke-width: 3; stroke-linecap: round; }
.pv .pv-prog { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; }
.pv .pv-dot { fill: var(--surface); stroke: var(--border); stroke-width: 2; }
.pv .pv-num { font-size: 15px; font-weight: 750; fill: var(--text); }
.pv .pv-ring { fill: none; stroke: var(--accent); stroke-width: 3; opacity: 0; }
.pv .pv-step-hl { fill: var(--accent-soft); opacity: 0; }
.pv-life-wide { --pv-len: ${LIFE_LEN.wide}; } .pv-life-tall { --pv-len: ${LIFE_LEN.tall}; }
@media (prefers-reduced-motion: no-preference) {
  .pv .pv-flow { animation: pv-dash 1.6s linear infinite; }
  .pv .pv-prog { animation: pv-prog ${LIFE_CYCLE}s linear infinite; }
  .pv .pv-ring, .pv .pv-step-hl { animation: pv-step ${LIFE_CYCLE}s linear infinite; }
${Array.from({ length: LIFE_N }, (_, i) => `  .pv .pv-d${i} { animation-delay: ${(i * LIFE_STEP_S).toFixed(2)}s; }`).join("\n")}
}
@keyframes pv-dash { to { stroke-dashoffset: -20; } }
@keyframes pv-prog { 0% { stroke-dashoffset: var(--pv-len); } 88% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 0; } }
@keyframes pv-step { 0% { opacity: 0; } 1.5% { opacity: 1; } 11% { opacity: 1; } 13% { opacity: 0; } 100% { opacity: 0; } }
`;

/** One visual: the SVG, for a standalone file (its own palette and rules) or for a page (the page's). */
function svg(o: { w: number; h: number; title: string; desc: string; body: string; id: string; standalone?: Theme }): string {
  const style = o.standalone ? `<style>.pv{${paletteCss(o.standalone)}}\n${VISUAL_CSS}</style>` : "";
  const bg = o.standalone ? `<rect class="pv-bg" width="${o.w}" height="${o.h}"/>` : "";
  const ns = o.standalone ? ' xmlns="http://www.w3.org/2000/svg"' : "";
  return `<svg${ns} class="pv pv-${o.id}" viewBox="0 0 ${o.w} ${o.h}" width="${o.w}" height="${o.h}" role="img" aria-labelledby="pv-${o.id}-t pv-${o.id}-d">
<title id="pv-${o.id}-t">${esc(o.title)}</title><desc id="pv-${o.id}-d">${esc(o.desc)}</desc>
${style}${o.body.includes("url(#pv-arrow)") ? defs : ""}${bg}
${o.body}
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The architecture: who can stop a payment, in order, and the three layers that do not trust each other.
//
// Wording held to the records (review, 12 Nov): the CFO signs above the limits and every change to them, not every
// payment; each layer can stop a payment on its own; the rails' limits are set by Purser's runner with the CFO's
// signature, so they hold against an agent, not against a compromised runner (said in the README draft); books ran in
// sandbox runs (T:0, Moneybird) and the archive is Purser Cloud's, a private preview.

export const ARCH_TITLE = "Purser: who can stop a payment";
export const ARCH_DESC = "AI agents propose payments. Three layers that do not trust each other can each stop one on its own: Purser's checks in code; the CFO's Face ID, a passkey over the exact terms, above the limits and on every change to them; and the rail's own controls (Airwallex, Metal, Visa Intelligent Commerce via Airi). Then the ledger and its hash-chained audit log; the books in sandbox runs; the archive in Purser Cloud, a private preview.";
export const LAYERS_LINE = "Three layers that do not trust each other: each can stop a payment on its own.";
export const FOOT = "Sandbox and testnet runs, test money.";

const AGENT_NAMES = ["Sourcing", "Support", "Treasury"] as const;
const LAYERS = [
  { n: "LAYER 1 · CODE", h: "Purser's checks", body: ["Limits and budgets per agent", "Allowed payees and merchants", "The invoice adds up", "Hashes the exact terms"], refuses: "Refuses over a limit or an unknown payee" },
  { n: "LAYER 2 · SIGNATURE", h: "CFO's Face ID", body: ["Above a limit, a passkey signs the hash of the exact terms", "Every change to a limit is signed too"], refuses: "Refuses terms changed after signing" },
] as const;
const RAILS = [
  { cls: "awx", name: "Airwallex", line: "Approvals, card limits" },
  { cls: "metal", name: "Metal", line: "Mandate cap on chain" },
  { cls: "airi", name: "Visa via Airi", line: "Cardholder's passkey" },
] as const;
const RAIL_REFUSES = "Refuses over its own limits, even after Purser's yes";
const BOOKS = { h: "Ledger", body: ["Hash-chained audit log", "Books: T:0 and Moneybird, sandbox runs"] } as const;
const ARCHIVE = { h: "Archive", body: ["Purser Cloud (private preview): invoices, suppliers, payments, every version kept"] } as const;

function archWide(): { w: number; h: number; body: string } {
  const W = 1200, top = 74, bh = 410, mid = top + 170, out: string[] = [];
  // Agents.
  const ax = 16, aw = 172;
  out.push(rect(ax, top, aw, bh, "pv-claude", 18), text(ax + 18, top + 32, ["AGENTS"], "t-eye", 16), text(ax + 18, top + 58, ["AI agents"], "t-h", 22),
    text(ax + 18, top + 86, wrap("Claude reads invoices and proposes payments", 17), "t-b", 20));
  AGENT_NAMES.forEach((a, i) => out.push(rect(ax + 16, top + 170 + i * 46, aw - 32, 36, "pv-box", 18), text(ax + aw / 2, top + 193 + i * 46, [a], "t-h2", 18, "middle")));
  out.push(text(ax + 18, top + bh - 26, wrap("Cannot change its own limits", 16), "t-bad", 18));
  // The three layers in one dashed group, its line above it.
  const gx = 224, cw = 216, gap = 36, cx = (i: number) => gx + 14 + i * (cw + gap), gw = 3 * cw + 2 * gap + 28;
  out.push(rect(gx, top - 14, gw, bh + 28, "pv-layer", 24), text(gx + gw / 2, top - 26, [LAYERS_LINE], "t-cap", 18, "middle"));
  const card = (x: number, eye: string, h: string) => {
    const hl = wrap(h, 15);
    out.push(rect(x, top, cw, bh, "pv-box", 18), text(x + 18, top + 32, [eye], "t-eye", 16), text(x + 18, top + 58, hl, "t-h", 22));
    return top + 58 + (hl.length - 1) * 22 + 34;
  };
  const refuse = (x: number, y: number, t: string) => { const ls = wrap(t, 20); out.push(rect(x + 12, y, cw - 24, ls.length * 18 + 22, "pv-badbg", 12), text(x + 24, y + 25, ls, "t-bad", 18)); };
  LAYERS.forEach((l, i) => {
    const x = cx(i);
    let y = card(x, l.n, l.h);
    for (const b of l.body) { const ls = wrap(b, 21); out.push(text(x + 18, y, ls, "t-b", 20)); y += ls.length * 20 + 10; }
    refuse(x, y + 4, l.refuses);
  });
  { const x = cx(2); let y = card(x, "LAYER 3 · THE RAIL", "The rail's own controls") - 18;
    for (const r of RAILS) { out.push(rect(x + 12, y, cw - 24, 58, `pv-${r.cls}`, 12), text(x + 26, y + 24, [r.name], `t-h2 t-${r.cls}`, 18), text(x + 26, y + 45, [r.line], "t-s", 18)); y += 66; }
    refuse(x, y + 2, RAIL_REFUSES); }
  // The ledger, then the archive.
  const rx = gx + gw + 30, rw = W - 16 - rx;
  out.push(rect(rx, top, rw, 214, "pv-box", 18), text(rx + 18, top + 32, ["RECORD"], "t-eye", 16), text(rx + 18, top + 58, [BOOKS.h], "t-h", 22));
  let y = top + 90;
  for (const b of BOOKS.body) { const ls = wrap(b, 17); out.push(text(rx + 18, y, ls, "t-b", 20)); y += ls.length * 20 + 8; }
  out.push(rect(rx, top + 244, rw, bh - 244, "pv-box", 18), text(rx + 18, top + 276, [ARCHIVE.h], "t-h", 22), text(rx + 18, top + 302, wrap(ARCHIVE.body[0], 19), "t-s", 17));
  out.push(arrow(rx + rw / 2, top + 216, rx + rw / 2, top + 240));
  // The flow: agents → group, card → card, group → ledger.
  out.push(arrow(ax + aw + 4, mid, gx - 4, mid), arrow(cx(0) + cw + 4, mid, cx(1) - 4, mid), arrow(cx(1) + cw + 4, mid, cx(2) - 4, mid), arrow(gx + gw + 4, top + 85, rx - 4, top + 85));
  const H = top + bh + 56;
  out.push(text(W / 2, H - 18, [FOOT], "t-f", 16, "middle"));
  return { w: W, h: H, body: out.join("\n") };
}

function archTall(): { w: number; h: number; body: string } {
  const W = 400, x = 16, w = W - 32, out: string[] = [];
  let y = 16;
  const box = (h: number, cls = "pv-box") => { out.push(rect(x, y, w, h, cls, 18)); };
  const down = () => { out.push(arrow(W / 2, y + 2, W / 2, y + 26)); y += 30; };
  // Agents.
  box(170, "pv-claude");
  out.push(text(x + 18, y + 30, ["AGENTS"], "t-eye", 16), text(x + 18, y + 56, ["AI agents"], "t-h", 22), text(x + 18, y + 82, wrap("Claude reads invoices and proposes payments", 34), "t-b", 20));
  AGENT_NAMES.forEach((a, i) => out.push(rect(x + 14 + i * 114, y + 120, 106, 34, "pv-box", 17), text(x + 67 + i * 114, y + 142, [a], "t-s", 18, "middle")));
  y += 170; down();
  // The three layers inside one dashed group.
  const y0 = y;
  const cap = wrap(LAYERS_LINE, 40);
  out.push(text(W / 2, y + 16, cap, "t-cap", 19, "middle"));
  y += cap.length * 19 + 42;
  LAYERS.forEach((l) => {
    const lines = l.body.flatMap((b) => wrap(b, 38));
    const h = 92 + lines.length * 20 + 44;
    box(h);
    out.push(text(x + 18, y + 28, [l.n], "t-eye", 16), text(x + 18, y + 54, [l.h], "t-h", 22), text(x + 18, y + 82, lines, "t-b", 20),
      rect(x + 12, y + h - 46, w - 24, 34, "pv-badbg", 10), text(x + 24, y + h - 24, [l.refuses], "t-bad", 18));
    y += h; down();
  });
  { const ref = wrap(RAIL_REFUSES, 36), h = 92 + 3 * 52 + ref.length * 18 + 22; box(h);
    out.push(text(x + 18, y + 28, ["LAYER 3 · THE RAIL"], "t-eye", 16), text(x + 18, y + 54, ["The rail's own controls"], "t-h", 22));
    RAILS.forEach((r, i) => { const ry = y + 70 + i * 52; out.push(rect(x + 12, ry, w - 24, 44, `pv-${r.cls}`, 10), text(x + 26, ry + 27, [r.name], `t-h2 t-${r.cls}`, 18), text(x + w - 26, ry + 27, [r.line], "t-s", 18).replace('<text class="t-s"', '<text class="t-s" text-anchor="end"')); });
    const ry = y + 70 + 3 * 52 + 4;
    out.push(rect(x + 12, ry, w - 24, ref.length * 18 + 22, "pv-badbg", 10), text(x + 24, ry + 25, ref, "t-bad", 18));
    y += h; }
  out.push(rect(x - 6, y0 + cap.length * 19 + 30, w + 12, y - y0 - cap.length * 19 - 24, "pv-layer", 22));
  y += 8; down();
  const bl = BOOKS.body.flatMap((b) => wrap(b, 38)), bh = 64 + bl.length * 20 + 10;
  box(bh);
  out.push(text(x + 18, y + 28, ["RECORD"], "t-eye", 16), text(x + 18, y + 54, [BOOKS.h], "t-h", 22), text(x + 18, y + 80, bl, "t-b", 20));
  y += bh; down();
  const al = wrap(ARCHIVE.body[0], 38), ah = 44 + al.length * 20 + 14;
  box(ah);
  out.push(text(x + 18, y + 32, [ARCHIVE.h], "t-h", 22), text(x + 18, y + 58, al, "t-b", 20));
  y += ah + 16;
  out.push(text(W / 2, y + 8, [FOOT], "t-f", 16, "middle"));
  return { w: W, h: y + 30, body: out.join("\n") };
}

export function architectureSvg(layout: Layout = "wide", standalone?: Theme): string {
  const b = layout === "wide" ? archWide() : archTall();
  return svg({ ...b, id: `arch-${layout}`, title: ARCH_TITLE, desc: ARCH_DESC, standalone });
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. One payment's life, animated. A payment within the limits skips step 5 (the CFO signed those limits); the step is
// drawn as "above a limit".

export const LIFE_TITLE = "One payment's life";
export const LIFE_DESC = "Eight steps: an invoice arrives; Claude reads it; Purser's code checks it; the exact terms are hashed; above a limit, the CFO signs that hash with Face ID; the rail checks with its own controls; the payment is made; it is written to the ledger. Each layer can stop it on its own.";
export const LIFE_FOOT = "Each layer can stop it on its own.";
export const LIFE_STEPS = [
  { h: "Invoice", who: "Supplier", s: "Arrives by e-mail or upload", cls: "" },
  { h: "Read", who: "Claude", s: "Payee, amount, account", cls: "t-claude" },
  { h: "Checked", who: "Purser's code", s: "Limits, payee, totals", cls: "t-acc" },
  { h: "Terms", who: "Purser's code", s: "The exact terms, hashed", cls: "t-acc" },
  { h: "Face ID", who: "The CFO", s: "Above a limit: a passkey signs", cls: "t-ok" },
  { h: "Rail's control", who: "The rail", s: "Its own limits and approvals", cls: "t-rail" },
  { h: "Paid", who: "The rail", s: "When no layer said no", cls: "t-rail" },
  { h: "Booked", who: "Ledger", s: "Ledger and audit log", cls: "t-rail" },
] as const;

function lifeWide(standalone: boolean): { w: number; h: number; body: string } {
  const { w: W, x0, gap } = LIFE_WIDE, H = 250, cy = 104, len = LIFE_LEN.wide, x1 = x0 + len, out: string[] = [];
  out.push(`<path class="pv-line" d="M${x0} ${cy} H${x1}"/>`, `<path class="pv-prog" d="M${x0} ${cy} H${x1}" stroke-dasharray="${len}" stroke-dashoffset="0"/>`);
  LIFE_STEPS.forEach((s, i) => {
    const x = Math.round(x0 + gap * i), d = `pv-d${i}`;
    out.push(`<rect class="pv-step-hl ${d}" x="${x - 68}" y="${cy - 74}" width="136" height="196" rx="16"/>`,
      text(x, cy - 44, [s.who.toUpperCase()], `t-eye ${s.cls}`, 16, "middle"),
      `<circle class="pv-dot" cx="${x}" cy="${cy}" r="20"/>`, `<circle class="pv-ring ${d}" cx="${x}" cy="${cy}" r="27"/>`,
      text(x, cy + 5, [String(i + 1)], "pv-num", 16, "middle"),
      text(x, cy + 50, [s.h], "t-h2", 18, "middle"), text(x, cy + 72, wrap(s.s, 16), "t-s", 17, "middle"));
  });
  out.push(text(W / 2, H - 14, [standalone ? `${LIFE_FOOT} ${FOOT}` : LIFE_FOOT], "t-f", 16, "middle"));
  return { w: W, h: H, body: out.join("\n") };
}

function lifeTall(standalone: boolean): { w: number; h: number; body: string } {
  const { w: W, y0, row } = LIFE_TALL, cx = 42, len = LIFE_LEN.tall, y1 = y0 + len, out: string[] = [];
  out.push(`<path class="pv-line" d="M${cx} ${y0} V${y1}"/>`, `<path class="pv-prog" d="M${cx} ${y0} V${y1}" stroke-dasharray="${len}" stroke-dashoffset="0"/>`);
  LIFE_STEPS.forEach((s, i) => {
    const y = y0 + row * i, d = `pv-d${i}`;
    out.push(`<rect class="pv-step-hl ${d}" x="12" y="${y - 30}" width="${W - 24}" height="60" rx="14"/>`,
      `<circle class="pv-dot" cx="${cx}" cy="${y}" r="18"/>`, `<circle class="pv-ring ${d}" cx="${cx}" cy="${y}" r="24"/>`,
      text(cx, y + 5, [String(i + 1)], "pv-num", 16, "middle"),
      text(78, y - 4, [s.h], "t-h2", 18), text(78, y + 17, [s.s], "t-s", 17),
      text(W - 22, y - 4, [s.who.toUpperCase()], `t-eye ${s.cls}`, 16).replace('<text class', '<text text-anchor="end" class'));
  });
  const h = y1 + 46;
  out.push(text(W / 2, h - 2, standalone ? [LIFE_FOOT, FOOT] : [LIFE_FOOT], "t-f", 17, "middle"));
  return { w: W, h: h + 32, body: out.join("\n") };
}

export function lifecycleSvg(layout: Layout = "wide", standalone?: Theme): string {
  const b = layout === "wide" ? lifeWide(!!standalone) : lifeTall(!!standalone);
  return svg({ ...b, id: `life-${layout}`, title: LIFE_TITLE, desc: LIFE_DESC, standalone });
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Held by the rail itself: one card per rail, each linking to its run record. The red monospace line is the rail's
// own answer (a status or code); a card without one names the step that held, in plain type.

export const REFUSALS_TITLE = "Held by the rail itself";
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

const cardLines = (r: RailRefusal, chars: number) => ({ what: wrap(r.short, chars), note: r.note ? wrap(r.note, chars + 2) : [] });
const cardHeight = (r: RailRefusal, chars: number) => { const c = cardLines(r, chars); return 150 + c.what.length * 20 + (c.note.length ? c.note.length * 18 + 12 : 0) + 64; };

function refusalCard(r: RailRefusal, x: number, y: number, w: number, h: number, href: (path: string) => string, chars: number): string {
  const { what, note } = cardLines(r, chars);
  const cls = r.rail === "airwallex" ? "awx" : r.rail;
  const body = [
    rect(x, y, w, h, "pv-box", 18), rect(x, y, w, 70, `pv-${cls}`, 18), `<rect class="pv-${cls}" x="${x}" y="${y + 40}" width="${w}" height="30"/>`,
    text(x + 20, y + 30, [r.name], `t-h2 t-${cls}`, 18), text(x + 20, y + 54, [r.control], "t-s", 18),
    ...(r.code ? [rect(x + 20, y + 86, w - 40, 36, "pv-badbg", 10), text(x + 34, y + 110, [r.code], "t-code", 18)]
      : [rect(x + 20, y + 86, w - 40, 36, "pv-sunk", 10), text(x + 34, y + 109, [r.held ?? ""], "t-h2", 18)]),
    text(x + 20, y + 150, what, "t-b", 20),
    ...(note.length ? [text(x + 20, y + 150 + what.length * 20 + 10, note, "t-f", 18)] : []),
    text(x + 20, y + h - 44, [`${dayLabel(r.date)} · ${r.label}`], "t-f", 16),
    text(x + 20, y + h - 20, ["Open the run record ↗"], "t-link", 16),
  ];
  return `<a href="${esc(href(r.record))}" target="_blank" rel="noopener"><title>${esc(`${r.name}: the run record`)}</title>${body.join("")}</a>`;
}

export function refusalsSvg(items: RailRefusal[], href: (path: string) => string, layout: Layout = "wide", standalone?: Theme): string {
  const desc = items.map((r) => `${r.name}: ${r.code ?? r.held}. ${r.what}${r.note ? ` ${r.note}` : ""}`).join(" ");
  if (layout === "wide") {
    const W = 1200, gap = 20, w = (W - 32 - gap * (items.length - 1)) / items.length, chars = Math.floor(w / 8.7);
    const h = Math.max(...items.map((r) => cardHeight(r, chars)));
    const cards = items.map((r, i) => refusalCard(r, 16 + i * (w + gap), 16, w, h, href, chars));
    return svg({ w: W, h: h + 32, id: "rails-wide", title: REFUSALS_TITLE, desc, body: cards.join("\n"), standalone });
  }
  let y = 16;
  const cards = items.map((r) => { const h = cardHeight(r, 42), c = refusalCard(r, 16, y, 368, h, href, 42); y += h + 16; return c; });
  return svg({ w: 400, h: y, id: "rails-tall", title: REFUSALS_TITLE, desc, body: cards.join("\n"), standalone });
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. The social preview (GitHub's repository settings, 1280×640), dark: the sentence and the three layers in one strip.

export const SOCIAL_SIZE = { width: 1200, height: 630 } as const;
export const SOCIAL_SENTENCE = "AI agents spend company money only within limits the CFO signs with Face ID.";
/** The one line on the link preview (the owner, 13 Nov: the mark, the name and this line, nothing else). */
export const SOCIAL_LINE = "AI agents spend. You sign off.";
/** Purser's mark (a feather, the favicon's), as 24-unit paths. */
const MARK_PATHS = ["M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z", "M16 8 2 22", "M17.5 15H9"];

/** The small line under it: what the line means, as docs/security.md says it ("nothing above the limits is paid"). */
export const SOCIAL_SUB = ["Every payment above its limit", "waits for your Face ID or a passkey."] as const;
/**
 * The "Built with" line, in words only (the final partner review, 13 Nov: no partner marks on the card, and Visa by the
 * product the build used): the partners' names in the site's ink colours, no logos.
 */
export const SOCIAL_BUILT_WITH = { x: 72, y: 540, label: "Built with", names: ["Airwallex", "Metal", "Visa Intelligent Commerce", "Claude"] } as const;

/**
 * The link preview and the repository's social preview (the owner, 13 Nov: readable at thumbnail size). 1200×630, on
 * the site's light tokens and in its type: the mark and the name, the one line large in two lines, one small line, and
 * on the right a small version of the payment's path (the agent asks, the payment is above its limit, Face ID, then
 * paid or never paid), drawn with the site's own icons, and the "Built with" line in words.
 */
export function socialSvg(_site?: string): string {
  const { width: W, height: H } = SOCIAL_SIZE;
  const ic = (name: string, x: number, y: number, size: number, cls: string) => `<g class="${cls}">${icon(name, size).replace('<svg class="i"', `<svg class="i" x="${x}" y="${y}"`)}</g>`;
  // The path, right: a card with three steps and two endings.
  const cx = 756, cy = 64, cw = 372, ch = 502, nx = cx + 28, nw = cw - 56, nh = 74;
  const step = (y: number, name: string, label: string, sub: string, hot = false) => [
    `<rect class="${hot ? "s-node s-hot" : "s-node"}" x="${nx}" y="${y}" width="${nw}" height="${nh}" rx="18"/>`,
    `<rect class="${hot ? "s-ic s-ic-hot" : "s-ic"}" x="${nx + 16}" y="${y + 16}" width="42" height="42" rx="12"/>`,
    ic(name, nx + 25, y + 25, 24, hot ? "s-g-hot" : "s-g"),
    text(nx + 74, y + 33, [label], "s-n", 0),
    text(nx + 74, y + 58, [sub], "s-ns", 0),
  ].join("");
  const ys = [cy + 30, cy + 30 + nh + 34, cy + 30 + 2 * (nh + 34)];
  const link = (y: number) => `<path class="s-link" d="M${nx + 37} ${y + nh + 4} L${nx + 37} ${y + nh + 30}"/>`;
  const ey = ys[2]! + nh + 34, ew = (nw - 14) / 2, eh = 110;
  const ending = (x: number, ok: boolean) => [
    `<rect class="${ok ? "s-ok" : "s-bad"}" x="${x}" y="${ey}" width="${ew}" height="${eh}" rx="18"/>`,
    ic(ok ? "circle-check" : "octagon-x", x + 16, ey + 14, 26, ok ? "s-g-ok" : "s-g-bad"),
    text(x + 16, ey + 68, [ok ? "Signed" : "Not signed"], ok ? "s-e s-e-ok" : "s-e s-e-bad", 0),
    text(x + 16, ey + 94, [ok ? "Paid" : "Never paid"], "s-es", 0),
  ].join("");
  // Face ID's two endings: down into "Signed", and across, then down into "Not signed".
  const midY = ys[2]! + nh + 17, right = nx + ew + 14 + 37;
  const fork = `<path class="s-link" d="M${nx + 37} ${ys[2]! + nh + 4} L${nx + 37} ${ey - 4}"/><path class="s-link" d="M${nx + 37} ${midY} L${right} ${midY} L${right} ${ey - 4}"/>`;
  const out = [
    `<rect class="s-bg" x="0" y="0" width="${W}" height="${H}"/>`,
    `<rect class="s-glow" x="0" y="0" width="${W}" height="${H}"/>`,
    `<rect class="s-mark" x="72" y="64" width="60" height="60" rx="16"/>`,
    `<g class="s-feather" transform="translate(84 76) scale(1.5)">${MARK_PATHS.map((d) => `<path d="${d}"/>`).join("")}</g>`,
    text(150, 106, ["Purser"], "s-name", 0),
    text(72, 268, ["AI agents spend."], "s-line", 0),
    text(72, 358, ["You sign off."], "s-line s-line2", 0),
    text(72, 428, [...SOCIAL_SUB], "s-sub", 40),
    `<text class="s-bw" x="${SOCIAL_BUILT_WITH.x}" y="${SOCIAL_BUILT_WITH.y}">${esc(SOCIAL_BUILT_WITH.label)} <tspan class="s-bwn">${esc(SOCIAL_BUILT_WITH.names.join(" · "))}</tspan></text>`,
    `<rect class="s-card" x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="28"/>`,
    link(ys[0]!), link(ys[1]!), fork,
    step(ys[0]!, "bot", "The agent asks to pay", "by card or by transfer"),
    step(ys[1]!, "sliders-horizontal", "Above its limit", "checked by code"),
    step(ys[2]!, "scan-face", "Face ID or a passkey", "you sign the exact terms", true),
    ending(nx, true), ending(nx + ew + 14, false),
  ];
  const css = `.pv .s-bg { fill: #f7f8fa; } .pv .s-glow { fill: url(#s-grad); }
.pv .s-mark { fill: #0b1220; }
.pv .s-feather path { fill: none; stroke: #ffffff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pv .s-name { font-size: 38px; font-weight: 760; letter-spacing: -.025em; fill: #0b1220; }
.pv .s-line { font-size: 80px; font-weight: 800; letter-spacing: -.04em; fill: #0b1220; } .pv .s-line2 { fill: #4f46e5; }
.pv .s-sub { font-size: 31px; font-weight: 520; letter-spacing: -.01em; fill: #3b4456; }
.pv .s-bw { font-size: 21px; font-weight: 560; fill: #586174; } .pv .s-bwn { font-weight: 680; fill: #0b1220; }
.pv .s-card { fill: #ffffff; stroke: #e3e6ec; stroke-width: 1.5; filter: drop-shadow(0 18px 40px rgba(16, 24, 40, .10)); }
.pv .s-node { fill: #f1f3f7; } .pv .s-hot { fill: #eef0ff; stroke: #4f46e5; stroke-width: 2.5; }
.pv .s-ic { fill: #ffffff; } .pv .s-ic-hot { fill: #4f46e5; }
.pv .s-g { color: #4f46e5; } .pv .s-g-hot { color: #ffffff; } .pv .s-g-ok { color: #0b7d43; } .pv .s-g-bad { color: #c5363c; }
.pv .s-n { font-size: 21px; font-weight: 700; letter-spacing: -.01em; fill: #0b1220; } .pv .s-ns { font-size: 17px; font-weight: 500; fill: #586174; }
.pv .s-link { fill: none; stroke: #c9cfda; stroke-width: 3; stroke-linecap: round; }
.pv .s-ok { fill: #e6f6ee; stroke: #0b7d43; stroke-width: 2; } .pv .s-bad { fill: #fdecec; stroke: #c5363c; stroke-width: 2; }
.pv .s-e { font-size: 21px; font-weight: 750; } .pv .s-e-ok { fill: #0b7d43; } .pv .s-e-bad { fill: #c5363c; }
.pv .s-es { font-size: 17px; font-weight: 600; fill: #0b1220; }`;
  const grad = `<defs><radialGradient id="s-grad" cx="88%" cy="18%" r="75%"><stop offset="0" stop-color="#e4e7ff" stop-opacity=".9"/><stop offset="1" stop-color="#f7f8fa" stop-opacity="0"/></radialGradient></defs>`;
  return svg({ w: W, h: H, id: "social", title: "Purser", desc: `Purser. ${SOCIAL_LINE} ${SOCIAL_SUB.join(" ")}`, body: `${grad}
${out.join("\n")}`, standalone: "light" }).replace("</style>", `\n${css}</style>`);
}
