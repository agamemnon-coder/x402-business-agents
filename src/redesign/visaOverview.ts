// /visa's summary of the paid run (jury panel, 12 Nov: one summary of the paid run; it was "three live runs", then a
// paid run beside a controls run): one card with the paid purchase (its amount, after the CFO's Face ID), its ids and the run's
// honest label. Its tag says who asked (airiAsker: scripted, no Claude call, unless a purchase was asked for inside an
// agent's Claude call); the attempts that failed are listed in a fold on the page
// (src/redesign/vicFacts.ts). Every figure is read from the run's own record (docs/demo/airi-run.json); the card links
// to the run's full block lower on the page.
//
// The control test (docs/demo/vic-2-run.json: 0 Airi and 0 Airwallex calls, nothing bought) is not a Visa run and has
// no card here; its block lower on the page says what it is. The TAP run's card (docs/runs/visa-tap-live-*.json) is not
// part of the summary either: TAP is not eligible Visa tooling for this hackathon (Visa, 5 Nov), so its card sits in
// the one closed TAP fold at the foot of the page (tapCardHtml). visaOverviewHtml refuses both. No motion.

import { airiAsker, airiClaudeChoices, airiRun, AIRI_RUN_ID, type AiriRunRecord } from "./airiRun.js";
import { tapRun } from "./run.js";
import { esc } from "./ui.js";

/** The TAP fold's anchor on /visa: the last thing on the page, closed (src/redesign/partners.ts). */
export const VISA_TAP_ID = "visa-tap";
export const VISA_OVERVIEW_ID = "visa-runs";

type Tap = NonNullable<ReturnType<typeof tapRun>>;
interface Stat { v: string; l: string }
/** paid: a purchase was paid with a VIC credential. tap: the TAP work, outside the entry. */
export type RunKind = "paid" | "tap";
export interface RunCard { kind: RunKind; tag: string; title: string; stats: Stat[]; ids: [string, string][]; label: string; href?: string }

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 12)}…` : s);

/**
 * The paid run's card: the attempts of the day as "N of M" (counted), who asked (airiAsker) and purchase B's ids. Null
 * when a fact is missing.
 */
export function airiCard(rec: AiriRunRecord): RunCard | null {
  const b = rec.purchases.find((p) => p.route === "cfo" && p.outcome === "SUCCEEDED");
  if (!b?.payment_intent_id || !b.mandate_id) return null;
  const claude = airiClaudeChoices(rec);
  // The paid purchase leads (the jury check, 12 Nov): purchase B's amount, paid after the CFO's Face ID. The day's
  // attempts, "N of M paid", are counted in their fold lower on the page (vicAttemptsHtml), not on this card.
  return {
    kind: "paid", tag: `VIC via Airi · ${day(rec.started_at)} · ${airiAsker(rec).short}`, title: "Single-use Visa credential",
    stats: [{ v: `${b.currency} ${b.amount}`, l: "paid after the CFO's Face ID" }],
    ids: [["Mandate", b.mandate_id], ["Payment", b.payment_intent_id], ...claude.map((id) => ["Claude request", id] as [string, string])],
    label: "Airwallex sandbox · test card · cardholder confirmed each purchase in Airi", href: `#${AIRI_RUN_ID}`,
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

/** The summary's heading: one paid run, and who asked. */
export const VISA_SUMMARY_HEADING = "The paid run";
export function visaOverviewHeading(cards: RunCard[]): string {
  return cards.some((c) => c.kind === "paid") ? VISA_SUMMARY_HEADING : "";
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
  if (cards.length !== 1 || cards[0]!.kind !== "paid") throw new Error("/visa's summary is the one paid VIC run: the TAP run is not eligible Visa tooling (Visa, 5 Nov) and sits in its own fold, and the control test bought nothing");
  return `<section class="card vo" id="${VISA_OVERVIEW_ID}" aria-labelledby="${VISA_OVERVIEW_ID}-h"><h2 id="${VISA_OVERVIEW_ID}-h">${esc(visaOverviewHeading(cards))}</h2>
<div class="vo-runs">${cards.map(cardHtml).join("")}</div></section>`;
}

/** The summary from the committed record: "" without the Airi run's record. */
export function visaOverviewBlock(rec: AiriRunRecord | null = airiRun()): string {
  const card = rec ? airiCard(rec) : null;
  return card ? visaOverviewHtml([card]) : "";
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
.vo-run.tap { max-width: 420px; }`;
