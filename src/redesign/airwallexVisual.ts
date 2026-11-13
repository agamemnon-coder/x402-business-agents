// /airwallex as pictures first (owner, 13 Nov: "it can be overwhelming with all the numbers; it should look more clear
// with data and graphs and visuals"). Four drawings, each read from the run records the tiles already read, nothing typed:
//
// 1. The path: one payment's way through Airwallex, the products as stops (agent card, FX quote, payee check, payout or
//    batch, transfer approval, payment acceptance, ledger reconciliation), each with its icon, a dot and the day it ran
//    live. A product built but not yet switched on says so under its name.
// 2. The runs on one time axis (the first run's day to the last's): one row per product, a dot on the day it ran live;
//    filled for a product in use, a ring for one not yet switched on (shape and a legend, never colour alone).
// 3. One payment, as a bar: the Bergtex invoice of the Airwallex-only run (docs/demo/airwallex-run.json): what Purser
//    needed (the amount plus the fee ceiling) split into the EUR already free and the shortfall bought by FX; the fee
//    Airwallex charged beside it. The same figures as a table under it.
// 4. Two meters: the ledger reconciliation (movements that agree) and the payee check (name checks stopped before the
//    CFO is asked), each with its count in words.
//
// Inline SVG and HTML only, in the page's one stylesheet (its CSP hashes it); the site's tokens, light and dark.

import { readFileSync } from "node:fs";
import { AWX_RUN_FILE } from "./awxRun.js";
import type { ProductTile } from "./airwallexProducts.js";
import { esc, icon } from "./ui.js";

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const eur = (v: number) => `EUR ${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "")) * 100);

/** The stops of the path, in a payment's order: the product keys and the icon each wears. */
export const PATH_STOPS: { keys: string[]; label: string; icon: string }[] = [
  { keys: ["issuing"], label: "Agent card", icon: "credit-card" },
  { keys: ["fx"], label: "FX quote", icon: "arrow-left-right" },
  { keys: ["payee-check"], label: "Payee check", icon: "shield-check" },
  { keys: ["payouts", "batch"], label: "Payout or batch", icon: "landmark" },
  { keys: ["approvals"], label: "Transfer approval", icon: "scan-face" },
  { keys: ["acceptance"], label: "Payment acceptance", icon: "wallet" },
  { keys: ["ledger"], label: "Ledger reconciliation", icon: "database" },
];

/** The path, from the tiles in use and those not yet switched on. A stop without a tile is left out. */
export function pathHtml(inUse: ProductTile[], flagged: ProductTile[]): string {
  const all = [...inUse.map((t) => ({ t, on: true })), ...flagged.map((t) => ({ t, on: false }))];
  const stops = PATH_STOPS.flatMap((s) => {
    const hit = all.filter((x) => s.keys.includes(x.t.key));
    if (!hit.length) return [];
    const days = [...new Set(hit.map((x) => dayShort(x.t.iso)))];
    const on = hit.some((x) => x.on);
    return [{ ...s, days, on, href: `#p-${hit[0]!.t.key}` }];
  });
  if (stops.length < 2) return "";
  return `<ol class="awpath" aria-label="A payment's path through Airwallex: each stop ran live">${stops.map((s) => `<li class="${s.on ? "on" : "off"}"><a href="${s.href}"><span class="pi">${icon(s.icon, 18)}</span><span class="pt"><b>${esc(s.label)}</b><span class="ps"><span class="dot" aria-hidden="true"></span>${esc(`Live ${s.days.join(", ")}`)}</span>${s.on ? "" : `<span class="pn">${esc("not yet switched on")}</span>`}</span></a></li>`).join("")}</ol>`;
}

/** The runs on one time axis: a row per product, a dot on the day it ran live (filled: in use; ring: not yet switched on). */
export function timelineSvg(inUse: ProductTile[], flagged: ProductTile[], layout: "wide" | "narrow" = "wide"): string {
  const rows = [...inUse.map((t) => ({ t, on: true })), ...flagged.map((t) => ({ t, on: false }))];
  if (rows.length < 2) return "";
  const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  const t0 = Math.min(...rows.map((r) => day(r.t.iso))), t1 = Math.max(...rows.map((r) => day(r.t.iso)));
  // Drawn at the size it shows: wide on a laptop (names left of the track), narrow on a phone (each name above its
  // track, the middle days by their number), so its text stays 12.5 to 14 px and nothing is cut. The dots sit inside a
  // padded plot (PAD from the track's ends, more on the right for the last day's label), so none touches an edge; every
  // dot and its day's label sit on that day's gridline, the same x.
  const wide = layout === "wide";
  const W = wide ? 860 : 340, L = wide ? 200 : 14, R = wide ? 8 : 4, TOP = wide ? 8 : 4, ROW = wide ? 30 : 38, H = TOP + rows.length * ROW + 34;
  const PAD_L = wide ? 16 : 20, PAD_R = wide ? 28 : 24;
  const x0 = L + PAD_L, x1 = W - R - PAD_R;
  const x = (iso: string) => t1 === t0 ? x0 : Math.round(x0 + ((day(iso) - t0) / (t1 - t0)) * (x1 - x0));
  const ticks = [...new Set(rows.map((r) => r.t.iso.slice(0, 10)))].sort();
  const grid = ticks.map((d) => `<line class="g" x1="${x(d)}" y1="${TOP}" x2="${x(d)}" y2="${TOP + rows.length * ROW}"/>`).join("");
  const tickText = (d: string, i: number) => wide || i === 0 || i === ticks.length - 1 ? dayShort(`${d}T12:00:00Z`) : String(Number(d.slice(8, 10)));
  const labels = ticks.map((d, i) => `<text class="ax" x="${x(d)}" y="${TOP + rows.length * ROW + 22}" text-anchor="middle">${esc(tickText(d, i))}</text>`).join("");
  // One dot size: both reach DOT from their centre, a filled dot, or a ring whose stroke ends at the same radius.
  // The wide drawing shows at about 1.09x (860 wide in a ~940 px card), the narrow one at 0.86 to 0.95x (340 wide on a
  // 360 to 390 px phone): radii chosen so a dot is about 12 px across on screen in both, the size of the legend swatch.
  const DOT = wide ? 5.5 : 6.5, RING = 2.5;
  const marks = rows.map((r, i) => {
    const y = TOP + i * ROW + (wide ? ROW / 2 : ROW - 10);
    const name = wide ? `<text class="rl" x="${L - 12}" y="${y + 5}" text-anchor="end">${esc(r.t.name)}</text>` : `<text class="rl n" x="${L}" y="${y - 10}">${esc(r.t.name)}</text>`;
    const dot = r.on ? `<circle class="on" cx="${x(r.t.iso)}" cy="${y}" r="${DOT}"/>` : `<circle class="off" cx="${x(r.t.iso)}" cy="${y}" r="${DOT - RING / 2}" stroke-width="${RING}"/>`;
    return `<g><title>${esc(`${r.t.name}: ran live ${dayShort(r.t.iso)}${r.on ? ", in use" : ", not yet switched on"}`)}</title>${name}<line class="rr" x1="${L}" y1="${y}" x2="${W - R}" y2="${y}"/>${dot}</g>`;
  }).join("");
  const id = `awtl-${layout}`;
  return `<svg class="awtl ${layout}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}"><title id="${id}">${esc(`When each Airwallex product ran live, ${dayShort(new Date(t0).toISOString())} to ${dayShort(new Date(t1).toISOString())}`)}</title>${grid}${marks}${labels}</svg>`;
}

export interface OnePayment { invoice: string; amount: number; need: number; free: number; fx: number; fxSell: string; feeMax: number; fee: number; status: string; paidAt: string }
/** The Airwallex-only run's FX payment, from its record: the one invoice whose plan bought the shortfall. */
export function onePayment(json: string | null = read(AWX_RUN_FILE)): OnePayment | null {
  if (!json) return null;
  const rec = JSON.parse(json) as { invoices: { invoice_no: string; plan: string; amount: string; need_eur: string; free_eur: string; fee_max: string; fee: string; status: string; paid_at?: string; quote: { buy_eur: string; sell_usd: string } | null }[] };
  const i = rec.invoices.find((x) => x.plan === "convert_shortfall" && x.quote && x.status === "PAID");
  if (!i?.quote || !i.paid_at) return null;
  const p = { invoice: i.invoice_no, amount: cents(i.amount), need: cents(i.need_eur), free: cents(i.free_eur), fx: cents(i.quote.buy_eur), fxSell: `USD ${i.quote.sell_usd}`, feeMax: cents(i.fee_max), fee: cents(i.fee), status: i.status, paidAt: i.paid_at };
  // The record's own sums must hold: needed = amount + fee ceiling = already free + bought by FX.
  return p.need === p.amount + p.feeMax && p.need === p.free + p.fx ? p : null;
}

/** One payment as a bar, with the same figures as a table under it. */
export function paymentChart(p: OnePayment | null = onePayment()): string {
  if (!p) return "";
  const W = 640, BAR = 22, gap = 2;
  const wFree = Math.round((p.free / p.need) * W), wFx = W - wFree - gap;
  const e = (c: number) => eur(c / 100);
  return `<svg class="awpay" viewBox="0 0 ${W} ${BAR}" role="img" aria-labelledby="awpay-t"><title id="awpay-t">${esc(`Invoice ${p.invoice}: ${e(p.need)} needed, ${e(p.free)} already free, ${e(p.fx)} bought by FX`)}</title><rect class="free" x="0" y="0" width="${wFree}" height="${BAR}" rx="4"/><rect class="fx" x="${wFree + gap}" y="0" width="${wFx}" height="${BAR}" rx="4"/></svg>
<ul class="awkey"><li><span class="sw free" aria-hidden="true"></span>${esc(`Already free in EUR: ${e(p.free)}`)}</li><li><span class="sw fx" aria-hidden="true"></span>${esc(`Bought by FX: ${e(p.fx)} for ${p.fxSell}`)}</li></ul>
<details class="fold awtab"><summary>As a table</summary><table><tbody>
<tr><th scope="row">Invoice ${esc(p.invoice)}</th><td>${esc(e(p.amount))}</td></tr>
<tr><th scope="row">Fee ceiling, signed</th><td>${esc(e(p.feeMax))}</td></tr>
<tr><th scope="row">Needed</th><td>${esc(e(p.need))}</td></tr>
<tr><th scope="row">Already free in EUR</th><td>${esc(e(p.free))}</td></tr>
<tr><th scope="row">Bought by FX</th><td>${esc(`${e(p.fx)} for ${p.fxSell}`)}</td></tr>
<tr><th scope="row">Fee Airwallex charged</th><td>${esc(e(p.fee))}</td></tr>
<tr><th scope="row">Status</th><td>${esc(`${p.status}, ${dayShort(p.paidAt)}`)}</td></tr>
</tbody></table></details>`;
}

export interface Meter { done: number; of: number; words: string; tone: "ok" | "acc" }
/** A meter: a thin bar, its count in words beside it. */
export function meterHtml(m: Meter): string {
  const W = 200, H = 10, w = m.of ? Math.round((m.done / m.of) * W) : 0;
  return `<div class="awm2"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect class="bg" x="0" y="0" width="${W}" height="${H}" rx="5"/><rect class="${m.tone}" x="0" y="0" width="${Math.max(w, 0)}" height="${H}" rx="5"/></svg><p><b>${m.done} of ${m.of}</b> ${esc(m.words)}</p></div>`;
}

/** The two meters, from the tiles' values ("3 of 3", "3 of 4"), which the tiles read from their records; in use or not
 *  yet switched on alike, so a product that is switched on keeps its meter. */
export function metersHtml(tiles: ProductTile[]): string {
  const of = (t: ProductTile | undefined) => { const m = /^(\d+) of (\d+)$/.exec(t?.value ?? ""); return m ? { done: Number(m[1]), of: Number(m[2]) } : null; };
  const ledger = of(tiles.find((t) => t.key === "ledger")), payee = of(tiles.find((t) => t.key === "payee-check"));
  const out = [
    ...(ledger ? [meterHtml({ ...ledger, words: "movements agree with Airwallex's own ledger, to the cent", tone: "ok" })] : []),
    ...(payee ? [meterHtml({ ...payee, words: "payee name checks stopped before the CFO is asked", tone: "acc" })] : []),
  ];
  return out.join("");
}

/** The drawings in one block, under the heading; each names its record (data-rec). */
export function visualsHtml(inUse: ProductTile[], flagged: ProductTile[]): string {
  const files = (keys: string[]) => [...new Set([...inUse, ...flagged].filter((t) => keys.includes(t.key)).flatMap((t) => t.files))].join(" ");
  const tl = timelineSvg(inUse, flagged), pay = paymentChart(), meters = metersHtml([...inUse, ...flagged]);
  return `${pathHtml(inUse, flagged)}
<div class="awviz">
${tl ? `<article class="awv card wide" data-rec="${esc(files([...inUse, ...flagged].map((t) => t.key)))}"><h2>When each product ran live</h2>${tl}${timelineSvg(inUse, flagged, "narrow")}<ul class="awkey"><li><span class="sw on" aria-hidden="true"></span>In use</li><li><span class="sw off" aria-hidden="true"></span>Built, not yet switched on</li></ul></article>` : ""}
${pay ? `<article class="awv card" data-rec="${AWX_RUN_FILE}"><h2>One payment, paid after Face ID</h2>${pay}</article>` : ""}
${meters ? `<article class="awv card" data-rec="${esc(files(["ledger", "payee-check"]))}"><h2>Checks that ran live</h2>${meters}</article>` : ""}
</div>`;
}

export const VISUAL_CSS = `
/* The path: a connected line of stops; down the page on a phone, across it from 900 px. */
.awpath { list-style: none; margin: 18px 0 10px; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.awpath li { position: relative; }
.awpath li:not(:last-child)::after { content: ""; position: absolute; left: 17px; top: 46px; bottom: -4px; width: 2px; background: var(--border); }
.awpath li a { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 0; color: var(--text); text-decoration: none; border-radius: 10px; }
.awpath li a:hover b { color: var(--awx); } .awpath li a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.awpath .pi { position: relative; z-index: 1; flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--awx-soft); color: var(--awx); }
.awpath .pt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.awpath b { font-size: 15px; font-weight: 650; line-height: 1.25; }
.awpath .ps { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--muted); white-space: nowrap; }
.awpath .pn { font-size: 13px; color: var(--muted); font-style: italic; padding-left: 14px; }
.awpath .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
.awpath li.off .dot { background: none; box-shadow: inset 0 0 0 2px var(--ok); }
@media (min-width: 900px) {
  .awpath { grid-template-columns: repeat(7, minmax(0, 1fr)); margin: 24px 0 14px; }
  .awpath li:not(:last-child)::after { left: calc(50% + 24px); right: calc(-50% + 24px); top: 23px; bottom: auto; width: auto; height: 2px; }
  .awpath li a { flex-direction: column; text-align: center; gap: 8px; padding: 4px 4px 8px; }
  .awpath .pi { width: 44px; height: 44px; border-radius: 12px; }
  .awpath .pt { align-items: center; gap: 4px; } .awpath .pn { padding-left: 0; }
  /* Every name gets two lines, its text at the bottom, so the status dots and captions of all stops share one row. */
  .awpath b { font-size: 14px; min-height: 2.5em; display: flex; align-items: flex-end; justify-content: center; } }
.awviz { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); margin: 14px 0 20px; }
@media (min-width: 900px) { .awviz { grid-template-columns: repeat(2, minmax(0, 1fr)); } .awviz .wide { grid-column: 1 / -1; } }
.awv { padding: 16px 18px; min-width: 0; } .awv h2 { font-size: 15px; font-weight: 650; margin: 0 0 12px; }
.awv svg { display: block; width: 100%; height: auto; }
.awtl.narrow { display: none; } @media (max-width: 699px) { .awtl.wide { display: none; } .awtl.narrow { display: block; } }
.awtl .g { stroke: var(--border); stroke-width: 1; } .awtl .rr { stroke: var(--sunken); stroke-width: 1; }
.awtl .rl { fill: var(--text); font: 500 14px Inter, system-ui, sans-serif; } .awtl .rl.n { font-size: 12.5px; }
.awtl .ax { fill: var(--muted); font: 600 13px Inter, system-ui, sans-serif; }
.awtl circle.on { fill: var(--awx); } .awtl circle.off { fill: var(--surface); stroke: var(--awx); }
.awtl line { shape-rendering: crispEdges; }
.awpay .free { fill: color-mix(in srgb, var(--awx) 35%, var(--surface)); } .awpay .fx { fill: var(--awx); }
.awkey { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13.5px; color: var(--muted); }
.awkey li { display: inline-flex; align-items: center; gap: 6px; }
.awkey .sw { width: 12px; height: 12px; border-radius: 3px; flex: none; }
.awkey .sw.free { background: color-mix(in srgb, var(--awx) 35%, var(--surface)); } .awkey .sw.fx { background: var(--awx); }
.awkey .sw.on { border-radius: 50%; background: var(--awx); } .awkey .sw.off { border-radius: 50%; box-shadow: inset 0 0 0 2px var(--awx); }
.awtab table { border-collapse: collapse; width: 100%; font-size: 14px; } .awtab th { text-align: left; font-weight: 500; color: var(--muted); padding: 6px 0; }
.awtab td { text-align: right; font-variant-numeric: tabular-nums; padding: 6px 0; } .awtab tr + tr th, .awtab tr + tr td { border-top: 1px solid var(--border); }
.awm2 { display: grid; gap: 6px; margin: 4px 0 14px; } .awm2:last-child { margin-bottom: 0; }
.awm2 svg { max-width: 260px; } .awm2 .bg { fill: var(--sunken); } .awm2 .ok { fill: var(--ok); } .awm2 .acc { fill: var(--accent); }
.awm2 p { margin: 0; font-size: 14.5px; color: var(--muted); line-height: 1.4; } .awm2 b { color: var(--text); font-variant-numeric: tabular-nums; }
.awgroup { display: grid; gap: 8px; margin: 22px 0 6px; } .awgroup > h2 { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0; display: flex; align-items: center; gap: 8px; }
.awgroup > h2 .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; } .awgroup.off > h2 .dot { background: none; box-shadow: inset 0 0 0 2px var(--ok); }
.awgroup.off .awt { background: var(--sunken); }
@media (prefers-reduced-motion: no-preference) { .awpath li { animation: aw-in .35s ease-out both; } ${[1, 2, 3, 4, 5, 6, 7].map((n) => `.awpath li:nth-child(${n}) { animation-delay: ${((n - 1) * 0.06).toFixed(2)}s; }`).join(" ")} }
@keyframes aw-in { from { transform: translateY(8px); } to { transform: none; } }`;
