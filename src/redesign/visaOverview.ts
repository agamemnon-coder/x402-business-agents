// /visa's overview (Max, 10 Nov: "more Visa", fewer words): how a Visa purchase runs through Purser, as four nodes,
// and the three Visa runs as cards with a few big numbers, their key ids and their honest labels. Every figure is read
// from the runs' own records (docs/demo/airi-run.json, docs/demo/vic-2-run.json, docs/runs/visa-tap-live-*.json):
// nothing is typed in, and a card shows only when its record does. Each card links to the run's full block lower on
// the page. No motion; at phone width the nodes and the cards stack.

import { airiRun, AIRI_RUN_ID, type AiriRunRecord } from "./airiRun.js";
import { tapRun } from "./run.js";
import { vic2Run, VIC2_RUN_ID, type Vic2Record } from "./vic2Run.js";
import { esc, icon } from "./ui.js";

/** The TAP run's anchor on /visa: the page's own flow and h1 below the overview. */
export const VISA_TAP_ID = "visa-tap";
export const VISA_OVERVIEW_ID = "visa-runs";
export const VISA_OVERVIEW_HEADING = "Visa in Purser: three live runs";

type Tap = NonNullable<ReturnType<typeof tapRun>>;
interface Stat { v: string; l: string }
interface RunCard { tag: string; title: string; stats: Stat[]; ids: [string, string][]; label: string; href: string }

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 12)}…` : s);
const okOf = (c: Record<string, { ok: boolean }>) => { const v = Object.values(c); return `${v.filter((x) => x.ok).length}/${v.length}`; };

/** The VIC run's card: what was paid, what Purser refused, its checks and purchase B's ids. Null when a fact is missing. */
export function airiCard(rec: AiriRunRecord): RunCard | null {
  const paid = rec.purchases.filter((p) => p.outcome === "SUCCEEDED");
  const refused = rec.purchases.filter((p) => p.route === "refused" && p.by === "purser");
  const b = rec.purchases.find((p) => p.route === "cfo" && p.outcome === "SUCCEEDED");
  if (!b?.payment_intent_id || !b.mandate_id) return null;
  return {
    tag: `VIC via Airi · ${day(rec.started_at)}`, title: "Single-use Visa credential",
    stats: [{ v: String(paid.length), l: "paid" }, { v: String(refused.length), l: "refused by Purser" }, { v: okOf(rec.checks), l: "checks" }],
    ids: [["Mandate", b.mandate_id], ["Payment", b.payment_intent_id]],
    label: "Airwallex sandbox · test card · cardholder confirmed each purchase in Airi", href: `#${AIRI_RUN_ID}`,
  };
}

/** The second Airi run's card: the tamper and the lock refused, no outside call, its checks. */
export function vic2Card(rec: Vic2Record): RunCard {
  const refused = (rec.steps.D.executor.refused ? 1 : 0) + (rec.steps.E.purchase.outcome.status === "refused" ? 1 : 0);
  return {
    tag: `Around Airi · ${day(rec.started_at)}`, title: "Changed or locked: refused",
    stats: [{ v: String(refused), l: "refused" }, { v: String(rec.outside_calls.airi + rec.outside_calls.airwallex), l: "outside calls" }, { v: okOf(rec.checks), l: "checks" }],
    ids: [["Face ID proposal", rec.steps.D.outcome.proposalId]],
    label: "Nothing bought · test only", href: `#${VIC2_RUN_ID}`,
  };
}

/** The TAP run's card: signed checkouts the reference proxy accepted, and what Airwallex did with each. */
export function tapCard(tap: Tap): RunCard {
  const ok = tap.steps.filter((s) => s.proxyStatus === 200).length;
  const approved = tap.steps.filter((s) => s.approved), declined = tap.steps.filter((s) => !s.approved);
  return {
    tag: `Visa TAP · ${day(tap.ranAt)}`, title: "The agent signs its checkout",
    stats: [{ v: `${ok}/${tap.steps.length}`, l: "signatures accepted" }, ...(approved[0] ? [{ v: `€${approved[0].amount}`, l: "approved" }] : []), ...(declined[0] ? [{ v: `€${declined[0].amount}`, l: `declined (${declined[0].reason ?? "by Airwallex"})` }] : [])],
    ids: [["Visa reference verifier", `commit ${tap.commit}`]],
    label: "Our merchant (simulated) · Airwallex sandbox authorisations", href: `#${VISA_TAP_ID}`,
  };
}

const NODES: [string, string, string][] = [
  ["package", "Agent", "asks to buy"],
  ["shield-check", "Purser", "policy · CFO passkey on the exact terms"],
  ["credit-card", "Visa", "VIC credential via Airi · TAP signature"],
  ["receipt", "Merchant", "Airwallex checkout"],
];

export function visaOverviewHtml(cards: RunCard[]): string {
  if (!cards.length) return "";
  const flow = `<ol class="vo-flow" role="list">${NODES.map(([i, h, s]) => `<li>${icon(i, 18)}<b>${esc(h)}</b><span>${esc(s)}</span></li>`).join("")}</ol>`;
  const card = (c: RunCard) => `<a class="vo-run" href="${esc(c.href)}"><span class="vo-tag">${esc(c.tag)}</span><b class="vo-t">${esc(c.title)}</b>
<span class="vo-stats">${c.stats.map((s) => `<span><b>${esc(s.v)}</b><small>${esc(s.l)}</small></span>`).join("")}</span>
<span class="vo-ids">${c.ids.map(([k, v]) => `<span><small>${esc(k)}</small><code title="${esc(v)}">${esc(short(v))}</code></span>`).join("")}</span>
<span class="vo-label">${esc(c.label)}</span></a>`;
  return `<section class="card vo" id="${VISA_OVERVIEW_ID}" aria-labelledby="${VISA_OVERVIEW_ID}-h"><h2 id="${VISA_OVERVIEW_ID}-h">${esc(VISA_OVERVIEW_HEADING)}</h2>
${flow}
<div class="vo-runs">${cards.map(card).join("")}</div></section>`;
}

/** The overview from the committed records: only the runs whose records are there. */
export function visaOverviewBlock(): string {
  const a = airiRun(), v = vic2Run(), t = tapRun();
  const cards = [a ? airiCard(a) : null, v ? vic2Card(v) : null, t ? tapCard(t) : null].filter((c): c is RunCard => !!c);
  return visaOverviewHtml(cards);
}

export const VISA_OVERVIEW_CSS = `.vo { padding: 18px 20px; display: grid; gap: 14px; min-width: 0; }
.vo h2 { font-size: 20px; margin: 0; }
ol.vo-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
ol.vo-flow li { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; padding: 10px 12px; border-radius: 14px; background: var(--sunken); position: relative; min-width: 0; }
ol.vo-flow li svg { grid-row: span 2; color: var(--accent); }
ol.vo-flow li b { font-size: 15px; } ol.vo-flow li span { font-size: 13.5px; color: var(--muted); line-height: 1.3; }
.vo-runs { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
a.vo-run { display: grid; gap: 8px; align-content: start; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); color: var(--text); text-decoration: none; min-width: 0; }
a.vo-run:hover { border-color: var(--accent); }
.vo-tag { font-size: 12.5px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; color: var(--accent); }
.vo-t { font-size: 16px; line-height: 1.3; }
.vo-stats { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.vo-stats > span { display: grid; } .vo-stats b { font-size: 22px; line-height: 1.1; } .vo-stats small { font-size: 12.5px; color: var(--muted); }
.vo-ids { display: grid; gap: 4px; } .vo-ids > span { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; min-width: 0; }
.vo-ids small { font-size: 12.5px; color: var(--muted); } .vo-ids code { font: 650 12.5px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 1px 6px; border-radius: 6px; background: var(--sunken); overflow-wrap: anywhere; }
.vo-label { font-size: 12.5px; color: var(--muted); line-height: 1.35; }
@media (min-width: 900px) {
  ol.vo-flow { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
  ol.vo-flow li:not(:last-child)::after { content: ""; position: absolute; right: -13px; top: 50%; width: 8px; height: 8px; border-right: 2px solid var(--faint); border-top: 2px solid var(--faint); transform: translateY(-50%) rotate(45deg); }
  .vo-runs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}`;
