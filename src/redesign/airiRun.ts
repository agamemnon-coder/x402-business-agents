// The Airi run on the site (7 Nov): the Sourcing agent pays with a single-use card credential from Airwallex's Airi
// wallet, in a separate world on the Airwallex sandbox with Airi's test card and test money. Shown on /airwallex below
// awx-1 (in full, its steps folded) and in Proof's "Airwallex, read back" (one short line linking there). Everything
// here is read from its record, docs/demo/airi-run.json (the conductor's record, sanitised: no passkey credential, no
// payment method id, never an Airi link); the run log is docs/runs/2026-11-07-vic-1.md. Nothing is typed in: the ids,
// amounts, codes, counts and the date come from the record, and the block shows only when the record is a live run's
// with test money and the test card. test/airi-run-page.test.ts holds every figure to the record.
//
// Wording (docs/runs/vic-1-plan.md): "a single-use card credential from Airwallex's Airi wallet"; no card-network
// programme is named, and the run's working name is kept off the pages (the anchor is "airi-run").

import { existsSync, readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const AIRI_RUN_FILE = "docs/demo/airi-run.json";
export const AIRI_RUN_LOG = "docs/runs/2026-11-07-vic-1.md";
/** The block's anchor on /airwallex and /proof. */
export const AIRI_RUN_ID = "airi-run";
/** The fold with every step on /airwallex: Proof links here, and the page opens it on arrival (OPEN_TARGET_JS). */
export const AIRI_RUN_STEPS_ID = "airi-run-steps";
/** The label every showing of the run carries: a date, and sandbox, test card, test money. */
export const AIRI_RUN_LABEL = "Airwallex sandbox, test card, test money";
/** The credential, in the plan's words. */
export const AIRI_CREDENTIAL = "a single-use card credential from Airwallex's Airi wallet";

export interface AiriPurchase {
  step: "A" | "B" | "C";
  route: "alone" | "cfo" | "refused";
  agent: string;
  amount: string;
  currency: string;
  merchant: string;
  action_id?: string;
  proposal_id?: string;
  terms_sha256?: string;
  order_sha256?: string;
  approved_at?: string;
  method?: string;
  payment_intent_id?: string;
  mandate_id?: string;
  credential_type?: string;
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

const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
const short = (h: string) => `${h.slice(0, 8)}…`;

export interface AiriRunSummary {
  date: string; checksOk: number; checksAll: number; lines: string[]; source: string;
  /** Proof's one line, from the record. */
  short: string;
}

/** The run in a few lines, each from the record; null when a fact the lines need is missing from it. */
export function airiRunSummary(rec: AiriRunRecord): AiriRunSummary | null {
  const p = (s: string) => rec.purchases.find((x) => x.step === s);
  const a = p("A"), b = p("B"), c = p("C");
  if (!a?.payment_intent_id || !a.mandate_id || !a.outcome || !b?.proposal_id || !b.terms_sha256 || !b.payment_intent_id || !b.mandate_id || !b.outcome || !b.proposal_end
    || !c?.code || c.airi_calls === undefined || !rec.started_at) return null;
  const faceId = b.method === "passkey" ? "the CFO's Face ID" : "the CFO's approval";
  const checks = Object.values(rec.checks);
  const earlier = rec.attempts.filter((x) => x.world === rec.world && (x.attempt ?? 0) < rec.attempt);
  const lines = [
    `${a.currency} ${a.amount} at ${a.merchant}, within the CFO's limit of ${a.currency} ${rec.policy.alone_max_eur} for this rail: the Sourcing agent alone, no CFO. Max confirmed it once in Airi with his passkey, and the agent received ${AIRI_CREDENTIAL} (Airi's test card; mandate ${a.mandate_id}). The agent paid on Airwallex's hosted checkout page: PaymentIntent ${a.payment_intent_id} ${a.outcome}, reported to Airi.`,
    `${b.currency} ${b.amount}, above that limit: ${b.proposal_id} waited for ${faceId} on its exact terms (${short(b.terms_sha256)}). Only then did the runner ask Airi for mandate ${b.mandate_id}; Max confirmed it in Airi, and PaymentIntent ${b.payment_intent_id} ${b.outcome}: ${b.proposal_id} ${b.proposal_end}.`,
    `${c.currency} ${c.amount} at a merchant the CFO does not allow: refused by Purser, ${c.code}, with ${c.airi_calls} Airi calls.`,
    `The record and the run log hold ids, order hashes and codes only: no one-time Airi link, no card number, no credential.`,
    ...(earlier.length ? [`The second attempt in this world: the first stopped on a missed tap and a reused order reference before any card was used. The reference is fixed; both are in the run log.`] : []),
  ];
  return {
    date: dayLong(rec.started_at), checksOk: checks.filter((x) => x.ok).length, checksAll: checks.length, lines,
    short: `The Sourcing agent paid with ${AIRI_CREDENTIAL}: ${a.currency} ${a.amount} within the CFO's limit alone, ${b.currency} ${b.amount} only after ${faceId}; a merchant the CFO does not allow was refused by Purser before Airi.`,
    source: `${rec.calls.airwallex.this_attempt} Airwallex API calls · our own sandbox merchant on Airwallex's hosted checkout page · ${AIRI_RUN_FILE}`,
  };
}

const badge = (ok: boolean, text: string) => `<span class="awm ${ok ? "ok" : "bad"}">${icon(ok ? "circle-check" : "octagon-x", 16)}${esc(text)}</span>`;
const heading = (s: AiriRunSummary) => `<h3>${icon("wallet", 18)}${esc(`${s.date}, the Airi run: a separate run · ${AIRI_RUN_LABEL}`)}</h3>`;

/** The block: its date, name and label, the checks passed, and (folded) every step with its id. */
export function airiRunHtml(s: AiriRunSummary | null): string {
  if (!s) return "";
  return `<div class="card" id="${AIRI_RUN_ID}">${heading(s)}
${badge(s.checksOk === s.checksAll, `${s.checksOk} of ${s.checksAll} checks pass`)}
<details class="fold" id="${AIRI_RUN_STEPS_ID}"><summary>${esc("Every step and id")}</summary><ul class="awc">${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p class="src">${esc(s.source)} · <a class="pf" href="${esc(`${REPO_BLOB}${AIRI_RUN_LOG}`)}" target="_blank" rel="noopener">${esc("run log")} ↗</a></p></details></div>`;
}

/** Proof's short version: the date, name and label, the checks passed, one line, and a link to every step on /airwallex. */
export function airiRunShortHtml(s: AiriRunSummary | null): string {
  if (!s) return "";
  return `<div class="card" id="${AIRI_RUN_ID}">${heading(s)}
${badge(s.checksOk === s.checksAll, `${s.checksOk} of ${s.checksAll} checks pass`)}
<p>${esc(s.short)}</p>
<p class="src">${esc(s.source)}</p>
<a class="open" href="airwallex#${AIRI_RUN_STEPS_ID}">${esc("Every step and id")} ${icon("arrow-right", 14)}</a></div>`;
}

/** The block as /airwallex shows it (full) and /proof (short), from the committed record (empty without a live record). */
export function airiRunBlock(rec: AiriRunRecord | null = airiRun(), o: { short?: boolean } = {}): string {
  if (!rec) return "";
  const s = airiRunSummary(rec);
  return o.short ? airiRunShortHtml(s) : airiRunHtml(s);
}
