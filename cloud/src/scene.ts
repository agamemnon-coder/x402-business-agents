// The illustration both front doors show (the console's sign-in at / and /try's start): how Purser pays an invoice, as
// one small scene in inline SVG and CSS. An agent reads an invoice (its rows light one by one), a Face ID ring completes
// over the exact terms, and a "Paid" stamp carries the terms' hash; then the variant beat: the amount is changed, its row
// turns red and the stamp says "Refused: terms changed". One slow CSS loop (no script, no timer); with reduced motion the
// still picture is the paid frame, complete.
//
// Every number in it is read or computed here, never typed: the invoice is the try samples' clean one
// (src/config/trySample.ts CLEAN, which src/engine/tryWorld.ts re-exports: supplier, number, due date, IBAN, amount), the changed amount is that amount plus one
// cent, and the stamp's hash is the SHA-256 of the canonical terms the scene shows (RFC 8785 JCS: for an object of
// strings, its keys sorted), shortened to 10 characters. test/scene.test.ts holds both to their source.
//
// The scene is an image with one accessible name (SCENE_NAME); its own text is aria-hidden. The pages put the markup
// in their HTML as it is (built from these constants only) and the CSS in their nonce style.
import { createHash } from "node:crypto";
import { CLEAN } from "../../src/config/trySample.js";
import { ICONS } from "../../src/ui/icons.js";

/** The scene's accessible name. */
export const SCENE_NAME = "How Purser pays an invoice: an illustration";
/** The scene's own words (aria-hidden: the image is named by SCENE_NAME). */
export const SCENE_WORDS = { reading: "Reading", paid: "Paid", refused: "Refused: terms changed", terms: "terms" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Cents as the scene shows them: "EUR 1,850.00". */
export const eurOf = (cents: number): string => `EUR ${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
const dayOf = (iso: string) => { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return `${d} ${MONTHS[m - 1]} ${y}`; };

/** The terms the scene's invoice is paid on, as strings (terms carry no JSON numbers). */
export const SCENE_TERMS: Record<string, string> = {
  amount: (CLEAN.amountCents / 100).toFixed(2),
  currency: "EUR",
  due_date: CLEAN.dueDate,
  iban_last4: CLEAN.iban.slice(-4),
  invoice_no: CLEAN.invoiceNo,
  payee: CLEAN.supplier.name,
};
/** JCS of an object of strings: its keys sorted, no spaces. */
export const canonicalOf = (o: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
/** The SHA-256 of the scene's canonical terms, in hex. */
export const SCENE_TERMS_SHA256 = createHash("sha256").update(canonicalOf(SCENE_TERMS)).digest("hex");
/** What the stamp shows of it. */
export const SCENE_HASH = SCENE_TERMS_SHA256.slice(0, 10);
/** The amounts the scene shows: the invoice's, and the changed one (one cent more). */
export const SCENE_AMOUNT = eurOf(CLEAN.amountCents);
export const SCENE_CHANGED = eurOf(CLEAN.amountCents + 1);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const attrs = (a: Record<string, string | number>) => Object.entries(a).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join("");
const shape = (tag: string, a: Record<string, string | number>, kids = "") => `<${tag}${attrs(a)}>${kids}</${tag}>`;
const text = (x: number, y: number, cls: string, words: string) => shape("text", { x, y, class: cls }, esc(words));
/** An icon of src/ui/icons.ts at (x, y), size s. */
const icon = (name: string, x: number, y: number, s: number, cls: string) =>
  shape("g", { class: cls, transform: `translate(${x} ${y}) scale(${s / 24})` }, (ICONS[name] ?? []).map(([t, a]) => shape(t, a)).join(""));

/** A row of the invoice: its highlight, label and value (i: its place in the reading order). */
const row = (i: number, y: number, label: string, value: string, extra = "") =>
  shape("g", { class: `sc-row sc-r${i}` }, shape("rect", { class: "sc-hl", x: 34, y: y - 15, width: 212, height: 23, rx: 7 }) +
    text(46, y, "sc-l", label) + extra + (value ? text(234, y, "sc-v", value) : ""));

/** The scene's SVG markup. */
export function sceneSvg(): string {
  const body = [
    // The invoice card.
    shape("rect", { class: "sc-shadow", x: 26, y: 34, width: 228, height: 210, rx: 16 }),
    shape("rect", { class: "sc-card", x: 22, y: 26, width: 236, height: 212, rx: 16 }),
    text(42, 60, "sc-sup", CLEAN.supplier.name),
    text(42, 78, "sc-sub", `INVOICE ${CLEAN.invoiceNo}`),
    shape("line", { class: "sc-rule", x1: 42, y1: 94, x2: 238, y2: 94 }),
    row(1, 120, "Invoice", CLEAN.invoiceNo),
    row(2, 148, "Due", dayOf(CLEAN.dueDate)),
    row(3, 176, "IBAN", `···· ${CLEAN.iban.slice(-4)}`),
    row(4, 212, "Amount", "", text(234, 212, "sc-v sc-amt sc-was", SCENE_AMOUNT) + text(234, 212, "sc-v sc-amt sc-now", SCENE_CHANGED)),
    // The agent reading it.
    shape("g", { class: "sc-agent" }, shape("rect", { class: "sc-chip", x: 168, y: 10, width: 104, height: 30, rx: 15 }) +
      icon("bot", 178, 15, 20, "sc-bot") + text(204, 30, "sc-chipt", SCENE_WORDS.reading)),
    // The Face ID ring over the terms.
    shape("g", { class: "sc-face" }, shape("circle", { class: "sc-disc", cx: 318, cy: 92, r: 40 }) +
      shape("circle", { class: "sc-track", cx: 318, cy: 92, r: 32 }) +
      shape("circle", { class: "sc-ring", cx: 318, cy: 92, r: 32, pathLength: 100, transform: "rotate(-90 318 92)" }) +
      icon("scan-face", 302, 76, 32, "sc-fid")),
    // The stamps.
    // (The tilt on an outer group: the stamp's own transform is the animation's.)
    shape("g", { transform: "rotate(-6 316 222)" }, shape("g", { class: "sc-stamp sc-paid" }, shape("rect", { x: 254, y: 196, width: 124, height: 52, rx: 12 }) +
      text(316, 218, "sc-st", SCENE_WORDS.paid.toUpperCase()) + text(316, 237, "sc-hash", `${SCENE_WORDS.terms} ${SCENE_HASH}`))),
    shape("g", { transform: "rotate(-6 316 228)" }, shape("g", { class: "sc-stamp sc-refused" }, shape("rect", { x: 240, y: 210, width: 152, height: 36, rx: 10 }) +
      text(316, 233, "sc-rt", SCENE_WORDS.refused))),
  ].join("");
  return `<svg class="scene" viewBox="0 0 400 260" role="img" aria-label="${esc(SCENE_NAME)}" xmlns="http://www.w3.org/2000/svg"><g aria-hidden="true">${body}</g></svg>`;
}

/**
 * The scene's CSS, and the two-zone layout's band (each page shows it, display: grid, where it wants it): a soft mesh of the brand's tokens (--accent, --accent-soft, --bg,
 * --surface). One loop of 16 s: the first half pays, the second half refuses the changed amount.
 */
export const SCENE_CSS = `
.hero { position: relative; place-items: center; overflow: hidden; padding: 20px 16px;
  background: radial-gradient(90% 70% at 15% 10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%),
    radial-gradient(80% 70% at 95% 95%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    linear-gradient(160deg, var(--accent-soft), var(--bg)); }
.hero::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(60% 50% at 50% 50%, color-mix(in srgb, var(--surface) 40%, transparent), transparent 70%); }
.scene { position: relative; z-index: 1; display: block; width: 100%; max-width: 600px; height: auto; max-height: 100%; overflow: visible; font-family: Inter, system-ui, sans-serif; }
.scene text { font-size: 12px; fill: var(--text); }
.sc-shadow { fill: var(--accent); opacity: .12; filter: blur(10px); }
.sc-card { fill: var(--surface); stroke: var(--border); }
.scene .sc-sup { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
.scene .sc-sub { font-size: 10.5px; font-weight: 600; letter-spacing: .08em; fill: var(--muted); }
.sc-rule { stroke: var(--border); }
.scene .sc-l { fill: var(--muted); }
.scene .sc-v { text-anchor: end; font-weight: 600; font-variant-numeric: tabular-nums; }
.scene .sc-amt { font-size: 15px; font-weight: 750; }
.sc-hl { fill: var(--accent-soft); opacity: 0; }
.sc-r4 .sc-hl { opacity: 1; }
.scene .sc-now { fill: var(--bad); opacity: 0; }
.sc-chip { fill: var(--surface); stroke: var(--border); }
.sc-bot, .sc-fid { fill: none; stroke: var(--accent); stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.scene .sc-chipt { font-size: 12px; font-weight: 650; fill: var(--accent); }
.sc-disc { fill: var(--surface); stroke: var(--border); }
.sc-track { fill: none; stroke: var(--accent-soft); stroke-width: 4; }
.sc-ring { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; stroke-dasharray: 100 100; stroke-dashoffset: 0; }
.sc-stamp rect { fill: color-mix(in srgb, var(--surface) 88%, transparent); stroke-width: 2.5; }
.sc-paid rect { stroke: var(--ok); }
.sc-refused rect { stroke: var(--bad); }
.scene .sc-st { text-anchor: middle; font-size: 17px; font-weight: 800; letter-spacing: .16em; fill: var(--ok); }
.scene .sc-hash { text-anchor: middle; font: 600 10.5px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--ok); }
.scene .sc-rt { text-anchor: middle; font-size: 12.5px; font-weight: 750; fill: var(--bad); }
.sc-refused { opacity: 0; }
.sc-stamp, .sc-agent { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .sc-hl, .sc-ring, .sc-paid, .sc-refused, .sc-was, .sc-now, .sc-agent { animation: 16s ease-in-out infinite both; }
  .sc-r1 .sc-hl { animation-name: sc-r1; } .sc-r2 .sc-hl { animation-name: sc-r2; } .sc-r3 .sc-hl { animation-name: sc-r3; } .sc-r4 .sc-hl { animation-name: sc-r4; }
  .sc-ring { animation-name: sc-ring; } .sc-paid { animation-name: sc-paid; } .sc-refused { animation-name: sc-refused; }
  .scene .sc-was { animation-name: sc-was; } .scene .sc-now { animation-name: sc-now; } .sc-agent { animation-name: sc-agent; }
}
@keyframes sc-r1 { 0%, 3%, 12%, 100% { opacity: 0; } 5%, 9% { opacity: 1; } }
@keyframes sc-r2 { 0%, 9%, 18%, 100% { opacity: 0; } 11%, 15% { opacity: 1; } }
@keyframes sc-r3 { 0%, 15%, 24%, 100% { opacity: 0; } 17%, 21% { opacity: 1; } }
@keyframes sc-r4 { 0%, 21% { opacity: 0; fill: var(--accent-soft); } 23%, 50% { opacity: 1; fill: var(--accent-soft); } 55%, 94% { opacity: 1; fill: var(--bad-soft); } 98%, 100% { opacity: 0; fill: var(--accent-soft); } }
@keyframes sc-agent { 0%, 26% { opacity: 1; } 30%, 96% { opacity: .45; } 100% { opacity: 1; } }
@keyframes sc-ring { 0%, 27% { stroke-dashoffset: 100; } 36%, 94% { stroke-dashoffset: 0; } 98%, 100% { stroke-dashoffset: 100; } }
@keyframes sc-paid { 0%, 37% { opacity: 0; transform: scale(1.25); } 40% { opacity: 1; transform: scale(1); } 49% { opacity: 1; transform: scale(1); } 52%, 100% { opacity: 0; transform: scale(1); } }
@keyframes sc-was { 0%, 54% { opacity: 1; } 56%, 94% { opacity: 0; } 97%, 100% { opacity: 1; } }
@keyframes sc-now { 0%, 54% { opacity: 0; } 56%, 94% { opacity: 1; } 97%, 100% { opacity: 0; } }
@keyframes sc-refused { 0%, 60% { opacity: 0; transform: scale(1.25); } 63% { opacity: 1; transform: scale(1); } 93% { opacity: 1; transform: scale(1); } 96%, 100% { opacity: 0; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .scene, .scene * { animation: none !important; } }
`;
