// The Airi run on the site (7 Nov): the Sourcing agent pays with a Visa credential (bound by Purser to one purchase) from Airwallex's Airi
// wallet (Visa Intelligent Commerce, VIC), in a separate world on the Airwallex sandbox with Airi's test card and test
// money. Shown on /airwallex below awx-1 (in full, its ids folded), on /visa (in full, under the page's heading, drawing
// and overview, above the TAP section) and on /proof under the partners (short, linking to the ids on /airwallex). Everything
// here is read from its record, docs/demo/airi-run.json (the conductor's record, sanitised: no passkey credential, no
// payment method id, never an Airi link); the run log is docs/runs/2026-11-07-vic-1.md. Nothing is typed in: the ids,
// amounts, codes, counts and the date come from the record, and the block shows only when the record is a live run's
// with test money and the test card. test/airi-run-page.test.ts holds every figure to the record.
//
// Who paid (jury panel, 12 Nov): the run of 7 Nov was scripted. Purser's code asked for each purchase and no Claude call
// chose the rail, so every sentence about it says "scripted, no Claude call" (airiSummaryLine), counted from the record:
// a purchase asked for inside the Sourcing agent's Claude call carries rail_choice with that call's request id
// (src/airi/purchase.ts), and only that purchase names Claude (airiAsker). It read "Agents paid with a single-use Visa
// (VIC) credential".
//
// Wording: the owner's copy of 7 Nov (AIRI_HEADING, AIRI_SUMMARY from "each purchase" on, AIRI_A_SENTENCE, AIRI_BADGES): the
// programme is named, Visa Intelligent Commerce via Airwallex's Airi (until then the plan, docs/runs/vic-1-plan.md, kept
// it unnamed). The cardholder and the CFO are roles, never a person's name; the run's working name stays off the pages
// (the anchor is "airi-run").

import { existsSync, readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const AIRI_RUN_FILE = "docs/demo/airi-run.json";
export const AIRI_RUN_LOG = "docs/runs/2026-11-07-vic-1.md";
/** The block's anchor on /airwallex and /proof. */
export const AIRI_RUN_ID = "airi-run";
/** The VIC flow on /visa (src/redesign/vicFlow.ts, VIC_FLOW_ID): Proof's short block links to it ("How it works"). */
export const VIC_FLOW_ANCHOR = "vic-flow";
/** The fold with every step on /airwallex: Proof links here, and the page opens it on arrival (OPEN_TARGET_JS). */
export const AIRI_RUN_STEPS_ID = "airi-run-steps";
/** The label every showing of the run carries: a date, and sandbox, test card, test money. */
export const AIRI_RUN_LABEL = "Airwallex sandbox, test card, test money";
/** The credential, in the plan's words. */
export const AIRI_CREDENTIAL = "a card credential from Airwallex's Airi wallet, bound by Purser to one purchase";
/** The run log's checks section on GitHub, where the record's five checks are listed with their results. */
export const AIRI_CHECKS_URL = `${REPO_BLOB}${AIRI_RUN_LOG}#checks-the-records-checks`;
/** The heading (owner's copy, 7 Nov), with the run's date from the record ("7 Nov"). */
export const airiHeading = (day: string) => `Visa Intelligent Commerce via Airwallex's Airi: a live run (${day})`;
/** The 7 November run in three words, wherever it is named: Purser's code asked for each purchase; no Claude call chose the rail. */
export const AIRI_SCRIPTED = "scripted, no Claude call";
/** Its second half, where "scripted" is already said (the drawing's step 1). */
export const AIRI_NO_CLAUDE = AIRI_SCRIPTED.replace(/^scripted, /, "");
/**
 * What was paid and how, after who asked (airiSummaryLine). Within the limit "with no Purser approval" (12 Nov; it read
 * "without the CFO", but the person who was the CFO still confirmed it in Airi, as the cardholder).
 */
export const AIRI_SUMMARY = "paid with a Visa (VIC) credential from Airi that Purser binds to one purchase, each purchase confirmed by the cardholder's passkey: within Purser's limit with no Purser approval, above it only after the CFO's Face ID; a disallowed merchant was refused by Purser first.";
/** The Claude request ids of the rail choices in a record: one per purchase asked for inside an agent's Claude call that returned an id. */
export const airiClaudeChoices = (rec: AiriRunRecord): string[] => rec.purchases.flatMap((p) => (p.rail_choice?.by === "claude" && p.rail_choice.request_id ? [p.rail_choice.request_id] : []));

/**
 * Who asked for the run's purchases, per purchase, from rail_choice.by (12 Nov): a purchase asked for inside an agent's
 * Claude call says so, with the call's request id or "no request id returned"; every other purchase is scripted. The
 * words are what the record proves: the purchase was asked for inside that Claude call. The Sourcing agent's prompt
 * names the Airi rail for the Airi merchant (src/agents/railChoice.ts), so nothing here says Claude "chose" it. Every
 * place that says who asked (the summary line, the card's tag, /visa's description and its "What's real?" line) reads
 * this one function.
 */
export interface AiriAsker { scripted: boolean; short: string; sentence: string }
export function airiAsker(rec: AiriRunRecord): AiriAsker {
  const claude = rec.purchases.filter((p) => p.rail_choice?.by === "claude");
  if (claude.length === 0) return { scripted: true, short: AIRI_SCRIPTED, sentence: "A scripted run, no Claude call" };
  const rest = rec.purchases.filter((p) => p.rail_choice?.by !== "claude").map((p) => p.step);
  const each = claude.map((p) => `purchase ${p.step} was asked for inside the ${capital(p.agent)} agent's Claude call (${p.rail_choice!.request_id ? `request ${p.rail_choice!.request_id}` : "no request id returned"})`);
  const scripted = rest.length ? [`purchase${rest.length > 1 ? "s" : ""} ${rest.join(" and ")} scripted, no Claude call`] : [];
  return {
    scripted: false,
    short: rest.length ? `${claude.length} of ${rec.purchases.length} purchases asked for in a Claude call` : "asked for in a Claude call",
    sentence: capital([...each, ...scripted].join("; ")),
  };
}
/**
 * The summary as the published film shows it (scene 13c, rendered 7 to 13 Nov): its words stay as recorded, so the film's
 * script and subtitles in docs/video describe the film as it is. The site says AIRI_SUMMARY (final jury, 13 Nov: the
 * credential is bound to one purchase by Purser; the sandbox did not refuse a reuse, vic-3).
 */
export const AIRI_SUMMARY_FILM = "paid with a single-use Visa (VIC) credential from Airi, each purchase confirmed by the cardholder's passkey: within Purser's limit with no Purser approval, above it only after the CFO's Face ID; a disallowed merchant was refused by Purser first.";

/** The one summary sentence: who asked (airiAsker), then AIRI_SUMMARY (the film: AIRI_SUMMARY_FILM). */
export function airiSummaryLine(rec: AiriRunRecord, o: { film?: boolean } = {}): string {
  return `${airiAsker(rec).sentence}: ${o.film ? AIRI_SUMMARY_FILM : AIRI_SUMMARY}`;
}
/** Purchase A's two sentences (owner's copy, 7 Nov): within Purser's limit no Purser approval, Airi's own passkey step. */
export const AIRI_A_SENTENCE = "Within Purser's limit, no Purser approval is needed. Airi itself asks the cardholder to confirm each purchase with a passkey.";
/** The outcome badge of each purchase (owner's copy, 7 Nov), shown only when the record says so. */
export const AIRI_BADGES = { A: "✓ Within the limit", B: "✓ Paid after Face ID", C: "✕ Refused by Purser" } as const;

export interface AiriPurchase {
  step: "A" | "B" | "C";
  route: "alone" | "cfo" | "refused";
  agent: string;
  amount: string;
  currency: string;
  merchant: string;
  item?: string;
  action_id?: string;
  proposal_id?: string;
  terms_sha256?: string;
  order_sha256?: string;
  approved_at?: string;
  method?: string;
  payment_intent_id?: string;
  mandate_id?: string;
  credential_type?: string;
  /** Who confirmed the mandate in Airi, and how (the record's words). */
  tap?: string;
  /** Who chose the Airi rail (src/airi/purchase.ts): an agent's Claude call with its request id, or code. Absent in the record of 7 Nov (scripted). */
  rail_choice?: { by: "claude" | "code"; model?: string; request_id?: string | null };
  /** The terms hash in the mandate's description, as read back from Airi (the rail does that since 12 Nov). Absent in the record of 7 Nov. */
  mandate_terms_sha256?: string;
  outcome?: string;
  reported_to_airi?: string;
  proposal_end?: string;
  by?: string;
  code?: string;
  airi_calls?: number;
}

export interface AiriRunRecord {
  run: string;
  world: string;
  attempt: number;
  mode: "live" | "dry";
  test_money: boolean;
  test_card: boolean;
  label: string;
  started_at: string;
  ended_at: string;
  client: string;
  credential: string;
  checkout: { kind: string; what: string; merchant: string };
  policy: { alone_max_eur: string; alone_per_day: number; merchants_allowed: string[] };
  purchases: AiriPurchase[];
  checks: Record<string, { ok: boolean; detail: string }>;
  calls: { airwallex: { this_attempt: number; world_total: number; budget: number; hosted_page_loads: number } };
  attempts: { world: string; attempt?: number; at: string; outcome: string; cause: string | null }[];
}

/** The live run's record, or null when there is none (or it is not a live run's with test money and the test card). */
export function airiRun(file = AIRI_RUN_FILE): AiriRunRecord | null {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return null;
  const rec = JSON.parse(readFileSync(url, "utf8")) as AiriRunRecord;
  return rec.mode === "live" && rec.test_money === true && rec.test_card === true ? rec : null;
}

const short = (h: string) => `${h.slice(0, 8)}…`;

export interface AiriLine { badge: string; ok: boolean; text: string }

export interface AiriRunSummary {
  date: string; checksOk: number; checksAll: number;
  /** The heading, with the run's date. */
  heading: string;
  /** The one summary sentence: who asked (scripted, or Claude with its request id), then what was paid and how. */
  summary: string;
  /** The three purchases, each with its outcome badge (owner's copy). */
  outcomes: AiriLine[];
  /** The record's checks, each named, for the fold. */
  checks: { name: string; ok: boolean; detail: string }[];
  /** Every step with its ids, for the fold. */
  lines: string[];
  source: string;
}

const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const capital = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/** The run in a few lines, each from the record; null when a fact the lines need is missing from it. */
export function airiRunSummary(rec: AiriRunRecord): AiriRunSummary | null {
  const p = (s: string) => rec.purchases.find((x) => x.step === s);
  const a = p("A"), b = p("B"), c = p("C");
  if (!a?.payment_intent_id || !a.mandate_id || !a.outcome || !b?.proposal_id || !b.terms_sha256 || !b.payment_intent_id || !b.mandate_id || !b.outcome || !b.proposal_end
    || !c?.code || c.airi_calls === undefined || !rec.started_at) return null;
  const faceId = b.method === "passkey" ? "the CFO's Face ID" : "the CFO's approval";
  // The record's own words for each check, but for one: "A ran without the CFO" reads as if the person was absent, and
  // the same person confirmed A in Airi as the cardholder. The page says what the check tested: no Purser approval.
  const checks = Object.entries(rec.checks).map(([name, x]) => ({ name, ok: x.ok, detail: capital(x.detail).replace(/\bwithout the CFO\b/, "with no Purser approval") }));
  const earlier = rec.attempts.filter((x) => x.world === rec.world && (x.attempt ?? 0) < rec.attempt);
  const limit = `${a.currency} ${rec.policy.alone_max_eur}`;
  // Each badge only as the record has it: paid alone, paid after the Face ID, refused by Purser before any Airi call.
  const aPaid = a.route === "alone" && a.outcome === "SUCCEEDED", bPaid = b.route === "cfo" && b.outcome === "SUCCEEDED" && b.proposal_end === "EXECUTED" && b.method === "passkey";
  const cRefused = c.route === "refused" && c.by === "purser" && c.airi_calls === 0;
  const outcomes: AiriLine[] = [
    { badge: aPaid ? AIRI_BADGES.A : `✕ ${a.outcome}`, ok: aPaid, text: `${a.currency} ${a.amount} (Purser's limit: ${limit}). ${AIRI_A_SENTENCE}` },
    { badge: bPaid ? AIRI_BADGES.B : `✕ ${b.outcome}`, ok: bPaid, text: `${b.currency} ${b.amount}, above the limit: Purser asked Airi only after ${faceId} on the exact terms.` },
    { badge: cRefused ? AIRI_BADGES.C : "✕ Not refused before Airi", ok: false, text: `${c.currency} ${c.amount} at a merchant the CFO does not allow: refused before Airi was asked (${c.airi_calls} Airi calls).` },
  ];
  // Purchase A (12 Nov): "no CFO approval", and the cardholder's own step said right after it. It read "the Sourcing agent
  // alone", which a reader took as nobody confirming it; Airi asks the cardholder for every purchase.
  const lines = [
    `${a.currency} ${a.amount} at ${a.merchant}, within Purser's limit of ${limit} for this rail: no CFO approval. The cardholder still confirmed it once in Airi with a passkey, and the Sourcing agent received ${AIRI_CREDENTIAL} (Airi's test card; mandate ${a.mandate_id}). The agent paid on Airwallex's hosted checkout page: PaymentIntent ${a.payment_intent_id} ${a.outcome}, reported to Airi.`,
    `${b.currency} ${b.amount}, above that limit: ${b.proposal_id} waited for ${faceId} on its exact terms (terms hash ${short(b.terms_sha256)}). Only then did the runner ask Airi for mandate ${b.mandate_id}; the cardholder confirmed it in Airi with a passkey, and PaymentIntent ${b.payment_intent_id} ${b.outcome}: ${b.proposal_id} ${b.proposal_end}.`,
    `${c.currency} ${c.amount} at a merchant the CFO does not allow: refused by Purser, ${c.code}, with ${c.airi_calls} Airi calls.`,
    `The record and the run log hold ids, order hashes and codes only: no one-time Airi link, no card number, no credential.`,
    ...(earlier.length ? [`The second attempt in this world: the first stopped on a purchase not confirmed in Airi in time and a reused order reference before any card was used. The reference is fixed; both are in the run log.`] : []),
  ];
  return {
    date: dayShort(rec.started_at), heading: airiHeading(dayShort(rec.started_at)), summary: airiSummaryLine(rec), checksOk: checks.filter((x) => x.ok).length, checksAll: checks.length, outcomes, checks, lines,
    source: `${rec.calls.airwallex.this_attempt} Airwallex API calls · our own sandbox merchant on Airwallex's hosted checkout page · ${AIRI_RUN_FILE}`,
  };
}

const heading = (s: AiriRunSummary, h: "h2" | "h3") => `<${h} class="airi-h">${icon("wallet", 18)}${esc(s.heading)}</${h}>
<p class="airi-label">${esc(`A separate run · ${AIRI_RUN_LABEL}`)}</p>
<p class="airi-sum">${esc(s.summary)}</p>`;
const outcomes = (s: AiriRunSummary) => `<ul class="airi-out">${s.outcomes.map((o) => `<li class="${o.ok ? "ok" : "no"}"><span class="awm ${o.ok ? "ok" : "bad"}">${esc(o.badge)}</span> ${esc(o.text)}</li>`).join("")}</ul>`;
/** "Every check passes", a link to the run log's checks section (named there and in the fold); no pass-rate fraction (judge run, 13 Nov). */
const checksLink = (s: AiriRunSummary) => {
  const ok = s.checksOk === s.checksAll;
  return `<a class="awm ${ok ? "ok" : "bad"}" href="${esc(AIRI_CHECKS_URL)}" target="_blank" rel="noopener">${icon(ok ? "circle-check" : "octagon-x", 16)}${esc(ok ? "Every check passes" : "The checks, not every one passes")} ↗</a>`;
};

/** The block: heading, label, summary, the three outcomes, the checks; every check, step and id folded. */
export function airiRunHtml(s: AiriRunSummary | null, o: { h?: "h2" | "h3" } = {}): string {
  if (!s) return "";
  return `<div class="card airi" id="${AIRI_RUN_ID}">${heading(s, o.h ?? "h3")}
${outcomes(s)}
${checksLink(s)}
<details class="fold" id="${AIRI_RUN_STEPS_ID}"><summary>${esc("Details")}</summary>
<p><b>${esc("The five checks")}</b></p><ul class="awc">${s.checks.map((c) => `<li class="${c.ok ? "" : "no"}" title="${esc(c.name)}">${esc(c.ok ? "✓" : "✕")} ${esc(c.detail)}</li>`).join("")}</ul>
<p><b>${esc("Every step and id")}</b></p><ul class="awc">${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p class="src">${esc(s.source)} · <a class="pf" href="${esc(`${REPO_BLOB}${AIRI_RUN_LOG}`)}" target="_blank" rel="noopener">run\u00a0log\u00a0↗</a></p></details></div>`;
}

/** Proof's version: the same heading, label, summary, outcomes and checks, then a link to every id on /airwallex and one to the VIC flow on /visa. */
export function airiRunShortHtml(s: AiriRunSummary | null): string {
  if (!s) return "";
  return `<div class="card airi" id="${AIRI_RUN_ID}">${heading(s, "h3")}
${outcomes(s)}
${checksLink(s)}
<p class="src">${esc(s.source)}</p>
<a class="open" href="airwallex#${AIRI_RUN_STEPS_ID}">${esc("Details: every step and id")} ${icon("arrow-right", 14)}</a>
<a class="open" href="visa#${VIC_FLOW_ANCHOR}">${esc("How it works")} ${icon("arrow-right", 14)}</a></div>`;
}

/** The block's own styles, for the pages that show it (with READBACK_CSS). */
export const AIRI_CSS = `.airi .airi-label { color: var(--muted); font-size: 14.5px; font-weight: 600; }
.airi .airi-sum { font-size: 16.5px; font-weight: 600; line-height: 1.45; }
ul.airi-out { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
ul.airi-out li { font-size: 15.5px; line-height: 1.45; overflow-wrap: anywhere; }
ul.airi-out .awm { font-size: 14px; padding: 2px 10px; margin-right: 4px; white-space: nowrap; }
@media (max-width: 640px) { ul.airi-out .awm { display: table; margin: 0 0 4px; white-space: normal; } }
.airi a.awm { text-decoration: none; }
.airi details.fold > ul.awc { margin-bottom: 12px; }
.airi h2.airi-h { font-size: 20px; margin: 0; display: flex; align-items: center; gap: 8px; }`;

/** The block as /airwallex and /visa show it (full) and /proof (short), from the committed record (empty without a live record). */
export function airiRunBlock(rec: AiriRunRecord | null = airiRun(), o: { short?: boolean; h?: "h2" | "h3" } = {}): string {
  if (!rec) return "";
  const s = airiRunSummary(rec);
  return o.short ? airiRunShortHtml(s) : airiRunHtml(s, { h: o.h });
}
