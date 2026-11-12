// Purser's visual system as code (12 Nov): inline SVG drawn from the site's design tokens, light and dark, no images,
// no partner logos or brand marks (rails are named in text). Three visuals:
//
// - architecture: agents → Purser's checks → the CFO's Face ID → the rail's own controls → ledger and books → archive,
//   the three layers that do not trust each other marked as such;
// - lifecycle: one payment's life, invoice → read → checked → terms → Face ID → rail's own control → paid → booked,
//   animated in CSS. The first frame is the whole picture (every step drawn), so a viewer that shows no animation, or
//   prefers reduced motion, sees it complete; the animation only moves a highlight along it;
// - refusals: the rail itself holding a payment, one card per rail, from the run records (src/visuals/facts.ts).
//
// Each comes in two layouts: "wide" (README, desktop) and "tall" (phones). Standalone files carry their own palette
// (src/cli/visuals.ts writes a light and a dark file of each); on the site the SVG takes the page's tokens and its
// class rules go into the page's one stylesheet (VISUAL_CSS), so the pages keep their hash-based CSP.

import { esc } from "../redesign/ui.js";
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
const LIFE_WIDE = { w: 1200, x0: 60, gap: (1200 - 120) / (LIFE_N - 1) };
const LIFE_TALL = { w: 400, y0: 40, row: 66 };
const LIFE_LEN = { wide: Math.round(LIFE_WIDE.gap * (LIFE_N - 1)), tall: LIFE_TALL.row * (LIFE_N - 1) };

export const VISUAL_CSS = `.pv { display: block; width: 100%; height: auto; font-family: ${FONT}; }
.pv .pv-bg { fill: var(--bg); }
.pv .pv-box { fill: var(--surface); stroke: var(--border); stroke-width: 1.5; }
.pv .pv-sunk { fill: var(--sunken); stroke: none; }
.pv .pv-layer { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-dasharray: 6 5; }
.pv .pv-trust { fill: var(--accent-soft); stroke: none; }
.pv .pv-awx { fill: var(--awx-soft); stroke: none; } .pv .pv-metal { fill: var(--metal-soft); stroke: none; } .pv .pv-airi { fill: var(--accent-soft); stroke: none; }
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
.pv .t-awx { fill: var(--awx); } .pv .t-metal { fill: var(--metal); } .pv .t-airi { fill: var(--accent); } .pv .t-claude { fill: var(--claude); } .pv .t-ok { fill: var(--ok); }
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
${style}${defs}${bg}
${o.body}
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. The architecture: who can stop a payment, in order, and the three layers that do not trust each other.

export const ARCH_TITLE = "Purser: how a payment is allowed";
export const ARCH_DESC = "AI agents propose payments. Three layers that do not trust each other must each say yes: Purser's checks in code, the CFO's Face ID over the exact terms, and the rail's own controls (Airwallex, Metal, Visa Intelligent Commerce via Airi). Then the payment is written to the ledger and the books, and archived.";
export const LAYERS_LINE = "Three layers that do not trust each other: each one checks again, on its own.";

const AGENT_NAMES = ["Sourcing", "Support", "Treasury"] as const;
const LAYERS = [
  { n: "LAYER 1 · CODE", h: "Purser's checks", body: ["Limits and budgets per agent", "Allowed payees and merchants", "The invoice adds up", "Hashes the exact terms"], refuses: "Refuses over a limit or an unknown payee" },
  { n: "LAYER 2 · SIGNATURE", h: "The CFO's Face ID", body: ["A passkey signs the hash of the exact terms", "Before paying, Purser hashes the terms again"], refuses: "Refuses terms changed after signing" },
] as const;
const RAILS = [
  { cls: "awx", name: "Airwallex", line: "Transfer approvals, card limits" },
  { cls: "metal", name: "Metal", line: "Mandate cap, on chain" },
  { cls: "airi", name: "Visa via Airi", line: "Cardholder's passkey" },
] as const;
const RAIL_REFUSES = ["Refuses on its own limits,", "even after Purser's yes"];
const BOOKS = { h: "Ledger and books", body: ["Hash-chained audit log", "Books posted to the accounting"] } as const;
const ARCHIVE = { h: "Archive", body: ["Invoice, terms, signature and receipt, every version kept"] } as const;

function archWide(): { w: number; h: number; body: string } {
  const W = 1200, H = 540, top = 78, bh = 400, mid = top + bh / 2;
  const out: string[] = [];
  // The bracket over the three layers.
  out.push(`<path class="pv-still" d="M244 52 L244 40 L960 40 L960 52"/>`, text(602, 30, [LAYERS_LINE], "t-cap", 18, "middle"));
  // Agents.
  out.push(rect(16, top, 188, bh, "pv-box", 18), rect(16, top, 188, bh, "pv-claude", 18).replace("pv-claude", "pv-claude"),
    text(36, top + 34, ["AGENTS"], "t-eye", 16), text(36, top + 62, ["AI agents"], "t-h", 22), text(36, top + 92, wrap("Claude reads invoices and proposes payments", 21), "t-b", 21));
  AGENT_NAMES.forEach((a, i) => out.push(rect(36, top + 168 + i * 50, 148, 38, "pv-box", 19), text(110, top + 192 + i * 50, [a], "t-h2", 18, "middle")));
  out.push(text(36, top + 350, wrap("Cannot change its own limits", 20), "t-bad", 18));
  // Layers 1 and 2.
  LAYERS.forEach((l, i) => {
    const x = 244 + i * 244, w = 220;
    out.push(rect(x, top, w, bh, "pv-box", 18), rect(x - 6, top - 6, w + 12, bh + 12, "pv-layer", 22),
      text(x + 20, top + 34, [l.n], "t-eye", 16), text(x + 20, top + 62, wrap(l.h, 20), "t-h", 22));
    let y = top + 104;
    for (const b of l.body) { const ls = wrap(b, 24); out.push(text(x + 20, y, ls, "t-b", 20)); y += ls.length * 20 + 12; }
    out.push(rect(x + 14, top + bh - 74, w - 28, 58, "pv-badbg", 12), text(x + 26, top + bh - 50, wrap(l.refuses, 25), "t-bad", 18));
  });
  // Layer 3: the rails.
  { const x = 732, w = 228;
    out.push(rect(x, top, w, bh, "pv-box", 18), rect(x - 6, top - 6, w + 12, bh + 12, "pv-layer", 22),
      text(x + 20, top + 34, ["LAYER 3 · THE RAIL"], "t-eye", 16), text(x + 20, top + 62, ["The rail's own controls"], "t-h", 22));
    RAILS.forEach((r, i) => {
      const y = top + 86 + i * 78;
      out.push(rect(x + 14, y, w - 28, 66, `pv-${r.cls}`, 12), text(x + 28, y + 26, [r.name], `t-h2 t-${r.cls}`, 18), text(x + 28, y + 48, [r.line], "t-s", 18));
    });
    out.push(rect(x + 14, top + bh - 74, w - 28, 58, "pv-badbg", 12), text(x + 26, top + bh - 50, RAIL_REFUSES, "t-bad", 18));
  }
  // Ledger and books, then the archive.
  const rx = 996, rw = 188;
  out.push(rect(rx, top, rw, 220, "pv-box", 18), text(rx + 18, top + 34, ["RECORD"], "t-eye", 16), text(rx + 18, top + 62, wrap(BOOKS.h, 16), "t-h", 22));
  let y = top + 118;
  for (const b of BOOKS.body) { const ls = wrap(b, 20); out.push(text(rx + 18, y, ls, "t-b", 20)); y += ls.length * 20 + 10; }
  out.push(rect(rx, top + 260, rw, 140, "pv-box", 18), text(rx + 18, top + 294, [ARCHIVE.h], "t-h", 22), text(rx + 18, top + 322, wrap(ARCHIVE.body[0], 20), "t-b", 20));
  out.push(arrow(rx + rw / 2, top + 222, rx + rw / 2, top + 256));
  // The flow between the columns.
  out.push(arrow(206, mid, 236, mid), arrow(466, mid, 482, mid), arrow(710, mid, 724, mid), arrow(968, mid - 90, 992, mid - 90));
  out.push(text(W / 2, H - 22, ["A payment moves only when all three layers say yes. Sandbox and testnet runs, test money."], "t-f", 16, "middle"));
  return { w: W, h: H, body: out.join("\n") };
}

function archTall(): { w: number; h: number; body: string } {
  const W = 400, x = 16, w = W - 32, out: string[] = [];
  let y = 16;
  const box = (h: number, cls = "pv-box") => { out.push(rect(x, y, w, h, cls, 18)); };
  const down = () => { out.push(arrow(W / 2, y + 2, W / 2, y + 26)); y += 30; };
  // Agents.
  box(170, "pv-claude");
  out.push(text(x + 18, y + 30, ["AGENTS"], "t-eye", 16), text(x + 18, y + 56, ["AI agents"], "t-h", 22), text(x + 18, y + 82, wrap("Claude reads invoices and proposes payments", 36), "t-b", 20));
  AGENT_NAMES.forEach((a, i) => out.push(rect(x + 14 + i * 114, y + 120, 106, 34, "pv-box", 17), text(x + 67 + i * 114, y + 142, [a], "t-s", 18, "middle")));
  y += 170; down();
  // The three layers inside one dashed bracket.
  const y0 = y;
  out.push(text(W / 2, y + 16, wrap(LAYERS_LINE, 44), "t-cap", 19, "middle"));
  y += 60;
  LAYERS.forEach((l) => {
    const lines = l.body.flatMap((b) => wrap(b, 40));
    const h = 92 + lines.length * 20 + 44;
    box(h);
    out.push(text(x + 18, y + 28, [l.n], "t-eye", 16), text(x + 18, y + 54, [l.h], "t-h", 22), text(x + 18, y + 82, lines, "t-b", 20),
      rect(x + 12, y + h - 46, w - 24, 34, "pv-badbg", 10), text(x + 24, y + h - 24, [l.refuses], "t-bad", 18));
    y += h; down();
  });
  { const h = 92 + 3 * 52 + 46; box(h);
    out.push(text(x + 18, y + 28, ["LAYER 3 · THE RAIL"], "t-eye", 16), text(x + 18, y + 54, ["The rail's own controls"], "t-h", 22));
    RAILS.forEach((r, i) => { const ry = y + 70 + i * 52; out.push(rect(x + 12, ry, w - 24, 44, `pv-${r.cls}`, 10), text(x + 26, ry + 27, [r.name], `t-h2 t-${r.cls}`, 18), text(x + w - 26, ry + 27, [r.line], "t-s", 18).replace('<text class="t-s"', '<text class="t-s" text-anchor="end"')); });
    out.push(rect(x + 12, y + h - 66, w - 24, 54, "pv-badbg", 10), text(x + 24, y + h - 44, RAIL_REFUSES, "t-bad", 18));
    y += h; }
  out.push(rect(x - 6, y0 + 48, w + 12, y - y0 - 42, "pv-layer", 22));
  y += 8; down();
  box(112);
  out.push(text(x + 18, y + 28, ["RECORD"], "t-eye", 16), text(x + 18, y + 54, [BOOKS.h], "t-h", 22), text(x + 18, y + 80, BOOKS.body.slice(), "t-b", 20));
  y += 112; down();
  box(92);
  out.push(text(x + 18, y + 32, [ARCHIVE.h], "t-h", 22), text(x + 18, y + 58, wrap(ARCHIVE.body[0], 42), "t-b", 20));
  y += 92 + 16;
  out.push(text(W / 2, y + 8, wrap("A payment moves only when all three layers say yes. Sandbox and testnet runs, test money.", 48), "t-f", 16, "middle"));
  return { w: W, h: y + 30, body: out.join("\n") };
}

export function architectureSvg(layout: Layout = "wide", standalone?: Theme): string {
  const b = layout === "wide" ? archWide() : archTall();
  return svg({ ...b, id: `arch-${layout}`, title: ARCH_TITLE, desc: ARCH_DESC, standalone });
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. One payment's life, animated.

export const LIFE_TITLE = "One payment's life";
export const LIFE_DESC = "Eight steps: an invoice arrives; Claude reads it; Purser's code checks it; the exact terms are hashed; the CFO signs that hash with Face ID; the rail checks with its own controls; the payment is made; it is booked and archived.";
export const LIFE_STEPS = [
  { h: "Invoice", who: "Supplier", s: "Arrives by e-mail or upload", cls: "" },
  { h: "Read", who: "Claude", s: "Payee, amount, account", cls: "t-claude" },
  { h: "Checked", who: "Purser's code", s: "Limits, payee, totals", cls: "t-airi" },
  { h: "Terms", who: "Purser's code", s: "The exact terms, hashed", cls: "t-airi" },
  { h: "Face ID", who: "The CFO", s: "A passkey signs that hash", cls: "t-ok" },
  { h: "Rail's control", who: "The rail", s: "Its own limits and approvals", cls: "t-awx" },
  { h: "Paid", who: "The rail", s: "Only after every yes", cls: "t-awx" },
  { h: "Booked", who: "Ledger", s: "Books, audit log, archive", cls: "t-metal" },
] as const;

function lifeWide(): { w: number; h: number; body: string } {
  const { w: W, x0, gap } = LIFE_WIDE, H = 250, cy = 104, len = LIFE_LEN.wide, x1 = x0 + len, out: string[] = [];
  out.push(`<path class="pv-line" d="M${x0} ${cy} H${x1}"/>`, `<path class="pv-prog" d="M${x0} ${cy} H${x1}" stroke-dasharray="${len}" stroke-dashoffset="0"/>`);
  LIFE_STEPS.forEach((s, i) => {
    const x = Math.round(x0 + gap * i), d = `pv-d${i}`;
    out.push(`<rect class="pv-step-hl ${d}" x="${x - 70}" y="${cy - 74}" width="140" height="196" rx="16"/>`,
      text(x, cy - 44, [s.who.toUpperCase()], `t-eye ${s.cls}`, 16, "middle"),
      `<circle class="pv-dot" cx="${x}" cy="${cy}" r="20"/>`, `<circle class="pv-ring ${d}" cx="${x}" cy="${cy}" r="27"/>`,
      text(x, cy + 5, [String(i + 1)], "pv-num", 16, "middle"),
      text(x, cy + 50, [s.h], "t-h2", 18, "middle"), text(x, cy + 72, wrap(s.s, 17), "t-s", 17, "middle"));
  });
  out.push(text(W / 2, H - 14, ["Any layer can stop it; none can be skipped. Sandbox and testnet runs, test money."], "t-f", 16, "middle"));
  return { w: W, h: H, body: out.join("\n") };
}

function lifeTall(): { w: number; h: number; body: string } {
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
  out.push(text(W / 2, h - 2, ["Any layer can stop it; none can be skipped."], "t-f", 16, "middle"));
  return { w: W, h: h + 14, body: out.join("\n") };
}

export function lifecycleSvg(layout: Layout = "wide", standalone?: Theme): string {
  const b = layout === "wide" ? lifeWide() : lifeTall();
  return svg({ ...b, id: `life-${layout}`, title: LIFE_TITLE, desc: LIFE_DESC, standalone });
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Refused by the rail itself: one card per rail, each linking to its run record.

export const REFUSALS_TITLE = "Refused by the rail itself";
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

const cardLines = (r: RailRefusal, chars: number) => ({ what: wrap(r.what, chars), note: r.note ? wrap(r.note, chars + 2) : [] });
const cardHeight = (r: RailRefusal, chars: number) => { const c = cardLines(r, chars); return 150 + c.what.length * 20 + (c.note.length ? c.note.length * 18 + 12 : 0) + 64; };

function refusalCard(r: RailRefusal, x: number, y: number, w: number, h: number, href: (path: string) => string, chars: number): string {
  const { what, note } = cardLines(r, chars);
  const cls = r.rail === "airwallex" ? "awx" : r.rail;
  const body = [
    rect(x, y, w, h, "pv-box", 18), rect(x, y, w, 70, `pv-${cls}`, 18), `<rect class="pv-${cls}" x="${x}" y="${y + 40}" width="${w}" height="30"/>`,
    text(x + 20, y + 30, [r.name], `t-h2 t-${cls}`, 18), text(x + 20, y + 54, [r.control], "t-s", 18),
    rect(x + 20, y + 86, w - 40, 36, "pv-badbg", 10), text(x + 34, y + 110, [r.code], "t-code", 18),
    text(x + 20, y + 150, what, "t-b", 20),
    ...(note.length ? [text(x + 20, y + 150 + what.length * 20 + 10, note, "t-f", 18)] : []),
    text(x + 20, y + h - 44, [`${dayLabel(r.date)} · ${r.label}`], "t-f", 16),
    text(x + 20, y + h - 20, ["Open the run record ↗"], "t-link", 16),
  ];
  return `<a href="${esc(href(r.record))}" target="_blank" rel="noopener"><title>${esc(`${r.name}: the run record`)}</title>${body.join("")}</a>`;
}

export function refusalsSvg(items: RailRefusal[], href: (path: string) => string, layout: Layout = "wide", standalone?: Theme): string {
  const desc = items.map((r) => `${r.name}: ${r.code}. ${r.what}${r.note ? ` ${r.note}` : ""}`).join(" ");
  if (layout === "wide") {
    const W = 1200, gap = 20, w = (W - 32 - gap * (items.length - 1)) / items.length, chars = Math.floor(w / 8.1);
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

export const SOCIAL_SIZE = { width: 1280, height: 640 } as const;
export const SOCIAL_SENTENCE = "AI agents spend company money only within limits the CFO signs with Face ID.";
export const SOCIAL_FOOT = "Airwallex · Metal · Visa Intelligent Commerce via Airi · sandbox and testnet runs, test money only";

export function socialSvg(site: string): string {
  const { width: W, height: H } = SOCIAL_SIZE, out: string[] = [];
  out.push(`<rect class="s-bar" x="0" y="0" width="${W}" height="6"/>`);
  out.push(text(80, 104, ["Purser"], "s-brand", 30), text(80, 186, wrap(SOCIAL_SENTENCE, 30), "s-hero", 66));
  const chips = [
    { t: "AI agents", s: "propose", cls: "pv-claude", tc: "t-claude" },
    { t: "Purser's checks", s: "code", cls: "pv-box", tc: "" },
    { t: "CFO's Face ID", s: "signature", cls: "pv-box", tc: "" },
    { t: "The rail", s: "its own controls", cls: "pv-box", tc: "" },
    { t: "Books", s: "booked, archived", cls: "pv-metal", tc: "t-metal" },
  ];
  const y = 430, w = 190, gap = 28;
  chips.forEach((c, i) => {
    const x = 80 + i * (w + gap);
    out.push(rect(x, y, w, 86, c.cls, 18), text(x + 20, y + 38, [c.t], `s-chip ${c.tc}`, 24), text(x + 20, y + 66, [c.s], "s-sub", 20));
    if (i < chips.length - 1) out.push(arrow(x + w + 4, y + 43, x + w + gap - 4, y + 43, "pv-still"));
  });
  const bx = 80 + (w + gap) - 10, bw = 3 * w + 2 * gap + 20;
  out.push(rect(bx, y - 14, bw, 114, "pv-layer", 24), text(bx + bw / 2, y - 26, ["three layers that do not trust each other"], "s-cap", 20, "middle"));
  out.push(text(80, H - 50, [SOCIAL_FOOT], "s-foot", 20), text(W - 80, H - 50, [site], "s-site", 20).replace('<text class', '<text text-anchor="end" class'));
  const css = `.pv .s-bar { fill: var(--accent); }
.pv .s-brand { font-size: 30px; font-weight: 800; letter-spacing: -.02em; }
.pv .s-hero { font-size: 56px; font-weight: 780; letter-spacing: -.03em; }
.pv .s-chip { font-size: 20px; font-weight: 720; } .pv .s-sub { font-size: 17px; fill: var(--muted); }
.pv .s-cap { font-size: 17px; font-weight: 650; fill: var(--accent); letter-spacing: .02em; }
.pv .s-foot { font-size: 17px; fill: var(--faint); } .pv .s-site { font-size: 17px; font-weight: 650; fill: var(--accent); }`;
  return svg({ w: W, h: H, id: "social", title: "Purser", desc: SOCIAL_SENTENCE, body: out.join("\n"), standalone: "dark" }).replace("</style>", `\n${css}</style>`);
}
