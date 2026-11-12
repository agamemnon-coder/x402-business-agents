// /visa's overview (Max, 10 Nov: "more Visa", fewer words; 12 Nov: VIC first): what ran, as cards with a few big
// numbers, their key ids and their honest labels. Two kinds of run count here: a paid VIC run (the Airi run, where the
// agent paid with a single-use Visa credential) and a controls run (the second Airi run: 0 Airi and 0 Airwallex calls,
// nothing bought). The heading counts them from the cards, never typed. Every figure is read from the runs' own records
// (docs/demo/airi-run.json, docs/demo/vic-2-run.json): a card shows only when its record does, and each links to the
// run's full block lower on the page.
//
// The TAP run's card (docs/runs/visa-tap-live-*.json) is not part of the overview: TAP is not eligible Visa tooling for
// this hackathon (Visa, 5 Nov), so its card sits in the TAP section at the foot of the page, under that status
// (tapCardHtml). visaOverviewHtml refuses a TAP card. No motion; at phone width the cards stack.

import { airiRun, AIRI_RUN_ID, type AiriRunRecord } from "./airiRun.js";
import { tapRun } from "./run.js";
import { vic2Run, VIC2_RUN_ID, type Vic2Record } from "./vic2Run.js";
import { esc } from "./ui.js";

/** The TAP section's anchor on /visa: below every VIC block (src/redesign/partners.ts). */
export const VISA_TAP_ID = "visa-tap";
export const VISA_OVERVIEW_ID = "visa-runs";

type Tap = NonNullable<ReturnType<typeof tapRun>>;
interface Stat { v: string; l: string }
/** paid: an agent paid with a VIC credential. controls: Purser's controls only, nothing bought. tap: the TAP extra. */
export type RunKind = "paid" | "controls" | "tap";
export interface RunCard { kind: RunKind; tag: string; title: string; stats: Stat[]; ids: [string, string][]; label: string; href?: string }

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
    kind: "paid", tag: `VIC via Airi · ${day(rec.started_at)}`, title: "Single-use Visa credential",
    stats: [{ v: String(paid.length), l: "paid" }, { v: String(refused.length), l: "refused by Purser" }, { v: okOf(rec.checks), l: "checks" }],
    ids: [["Mandate", b.mandate_id], ["Payment", b.payment_intent_id]],
    label: "Airwallex sandbox · test card · cardholder confirmed each purchase in Airi", href: `#${AIRI_RUN_ID}`,
  };
}

/** The second Airi run's card: the tamper and the lock refused, no outside call, its checks. */
export function vic2Card(rec: Vic2Record): RunCard {
  const refused = (rec.steps.D.executor.refused ? 1 : 0) + (rec.steps.E.purchase.outcome.status === "refused" ? 1 : 0);
  return {
    kind: "controls", tag: `Controls run · ${day(rec.started_at)}`, title: "Changed or locked: refused",
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
    kind: "tap", tag: `Visa TAP · ${day(tap.ranAt)}`, title: "The agent signs its checkout",
    stats: [{ v: `${ok}/${tap.steps.length}`, l: "signatures accepted" }, ...(approved[0] ? [{ v: `€${approved[0].amount}`, l: "approved" }] : []), ...(declined[0] ? [{ v: `€${declined[0].amount}`, l: `declined (${declined[0].reason ?? "by Airwallex"})` }] : [])],
    ids: [["Visa reference verifier", `commit ${tap.commit}`]],
    label: "Our merchant (simulated) · Airwallex sandbox authorisations",
  };
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number, what: string) => `${WORDS[n] ?? String(n)} ${what}${n === 1 ? "" : "s"}`;

/** What ran, counted from the cards: "one paid VIC run and one controls run (nothing bought)". */
export function visaOverviewHeading(cards: RunCard[]): string {
  const paid = cards.filter((c) => c.kind === "paid").length, controls = cards.filter((c) => c.kind === "controls").length;
  return `What ran: ${[...(paid ? [count(paid, "paid VIC run")] : []), ...(controls ? [`${count(controls, "controls run")} (nothing bought)`] : [])].join(" and ")}`;
}

/** A run's card: a link to its block when it has one (the overview), a plain block otherwise (the TAP section). */
function cardHtml(c: RunCard): string {
  const inner = `<span class="vo-tag">${esc(c.tag)}</span><b class="vo-t">${esc(c.title)}</b>
<span class="vo-stats">${c.stats.map((s) => `<span><b>${esc(s.v)}</b><small>${esc(s.l)}</small></span>`).join("")}</span>
<span class="vo-ids">${c.ids.map(([k, v]) => `<span><small>${esc(k)}</small><code title="${esc(v)}">${esc(short(v))}</code></span>`).join("")}</span>
<span class="vo-label">${esc(c.label)}</span>`;
  return c.href ? `<a class="vo-run" href="${esc(c.href)}">${inner}</a>` : `<div class="vo-run ${esc(c.kind)}">${inner}</div>`;
}

export function visaOverviewHtml(cards: RunCard[]): string {
  if (!cards.length) return "";
  if (cards.some((c) => c.kind === "tap")) throw new Error("/visa's overview counts VIC runs only: the TAP run is not eligible Visa tooling (Visa, 5 Nov) and has its own section below");
  return `<section class="card vo" id="${VISA_OVERVIEW_ID}" aria-labelledby="${VISA_OVERVIEW_ID}-h"><h2 id="${VISA_OVERVIEW_ID}-h">${esc(visaOverviewHeading(cards))}</h2>
<div class="vo-runs">${cards.map(cardHtml).join("")}</div></section>`;
}

/** The overview from the committed records: only the VIC runs whose records are there. */
export function visaOverviewBlock(): string {
  const a = airiRun(), v = vic2Run();
  return visaOverviewHtml([a ? airiCard(a) : null, v ? vic2Card(v) : null].filter((c): c is RunCard => !!c));
}

/** The TAP run's card for the TAP section: not a link, the section is its place. "" without a TAP record. */
export function tapCardHtml(tap: Tap | null = tapRun()): string {
  return tap ? cardHtml(tapCard(tap)) : "";
}

export const VISA_OVERVIEW_CSS = `.vo { padding: 18px 20px; display: grid; gap: 14px; min-width: 0; scroll-margin-top: 80px; }
.vo h2 { font-size: 20px; margin: 0; }
.vo-runs { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.vo-run { display: grid; gap: 8px; align-content: start; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); color: var(--text); text-decoration: none; min-width: 0; }
a.vo-run:hover { border-color: var(--accent); }
.vo-tag { font-size: 12.5px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; color: var(--accent); }
.vo-t { font-size: 16px; line-height: 1.3; }
.vo-stats { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.vo-stats > span { display: grid; } .vo-stats b { font-size: 22px; line-height: 1.1; } .vo-stats small { font-size: 12.5px; color: var(--muted); }
.vo-ids { display: grid; gap: 4px; } .vo-ids > span { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; min-width: 0; }
.vo-ids small { font-size: 12.5px; color: var(--muted); } .vo-ids code { font: 650 12.5px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 1px 6px; border-radius: 6px; background: var(--sunken); overflow-wrap: anywhere; }
.vo-label { font-size: 12.5px; color: var(--muted); line-height: 1.35; }
@media (min-width: 900px) { .vo-runs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }`;
