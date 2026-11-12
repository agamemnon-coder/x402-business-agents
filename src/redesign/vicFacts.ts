// What the sandbox could not show, purchase B side by side, and the attempts that failed first: /visa's candour, lifted
// from the run log onto the page (jury panel, 12 Nov). Three small blocks, each read from the Airi run's record
// (docs/demo/airi-run.json) and, for what was charged, from Airwallex's own record of the payment
// (docs/runs/airwallex-vic-payment-intents-<date>.json):
//
//   vicFacts     five short lines right under the drawing, outside any fold: the credential is a test credential from
//                Airi's test card; one person played both the CFO and the cardholder; the attempt of the day that
//                passed; a headless browser typed the single-use number into the hosted page because the sandbox
//                refuses a direct confirm; the merchant is Purser's own. A line is only said when the record says it:
//                a live record that lacks one of the five stops the page build (as the drawing does). The ordinal is
//                where this record's own attempt stands among the day's.
//   vicCompare   purchase B in three columns: what the CFO signed, what went to Airi, what was charged. "Sent to Airi"
//                is the mandate, which Purser builds from the signed terms and nothing else (src/airi/purchase.ts,
//                mandateFromTerms; held by test/airi-purchase.test.ts); the record of 7 November holds the mandate's id,
//                not Airi's own copy of its amount: the cell's note says "from the signed terms", the mark compares only the
//                signed and the charged amount ("signed = charged"), and the note says so. "Charged" is Airwallex's own
//                answer. A record whose mandate carries the terms hash, read back from Airi (mandate_terms_sha256, the
//                rail does that since 12 Nov), gets a third row; the record of 7 November has none, and nothing is said.
//   vicAttempts  the day's attempts that did not pass, folded: time, outcome, the codes of its cause, each in plain
//                words (VIC_CODE_WORDS). The causes in full (they name people) stay in the run log. The series is
//                counted, "N of M attempts paid" (vicAttemptCount), wherever a failure falls.
//
// test/vic-facts.test.ts holds every line and value to the records.

import { type IntentsRecord } from "../airwallex/intentReadback.js";
import { AIRI_RUN_FILE, AIRI_RUN_LOG, type AiriRunRecord } from "./airiRun.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const VIC_FACTS_ID = "vic-facts";
export const VIC_COMPARE_ID = "vic-compare";
export const VIC_ATTEMPTS_ID = "vic-attempts";
export const VIC_COMPARE_COLUMNS = ["Signed by the CFO", "Sent to Airi", "Charged"] as const;

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const short = (h: string) => `${h.slice(0, 8)}…`;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const missing = (what: string): never => { throw new Error(`"What the sandbox could not show" on /visa needs ${what} in ${AIRI_RUN_FILE}`); };

/**
 * The attempts of the run's day, counted: all of them, how many passed (paid), where the attempt this record describes
 * stands (1-based), and every one that did not pass, wherever it falls. Throws when the record's own attempt is not
 * among the day's, or did not pass.
 */
export function vicAttemptCount(rec: AiriRunRecord): { all: number; paid: number; passedAt: number; failed: AiriRunRecord["attempts"]; failedFirst: boolean } {
  const sameDay = rec.attempts.filter((a) => a.at.slice(0, 10) === rec.started_at.slice(0, 10));
  const at = sameDay.findIndex((a) => a.world === rec.world && (a.attempt ?? 1) === rec.attempt);
  if (at < 0 || sameDay[at]!.outcome !== "passed") missing("this record's own attempt among the day's attempts, passed");
  const failed = sameDay.filter((a) => a.outcome !== "passed");
  return { all: sameDay.length, paid: sameDay.length - failed.length, passedAt: at + 1, failed, failedFirst: failed.every((a) => sameDay.indexOf(a) < at) };
}

/** The five facts, each one line, each only as the record has it. */
export function vicFacts(rec: AiriRunRecord): string[] {
  const paid = rec.purchases.filter((p) => p.outcome === "SUCCEEDED");
  if (!rec.test_card || !/single-use/.test(rec.credential ?? "")) missing("a single-use credential from the test card");
  // Who tapped in Airi: the record names the CFO for every paid purchase, so the cardholder and the CFO were one person.
  if (paid.length === 0 || !paid.every((p) => /^the CFO\b[^.]*passkey in Airi/.test(p.tap ?? ""))) missing("who confirmed each paid purchase in Airi (the CFO, with a passkey)");
  const n = vicAttemptCount(rec);
  void (ORDINALS[n.passedAt - 1] ?? missing("an attempt count the page has a word for"));
  // The hosted page, and why: an earlier attempt's direct confirm was refused by the sandbox.
  if (rec.checkout?.kind !== "airwallex-sandbox-hosted" || !/types the card/.test(rec.checkout.what ?? "")) missing("the checkout: the card typed into Airwallex's hosted page");
  if (!rec.attempts.some((a) => /refused the API confirm/.test(a.cause ?? ""))) missing("the attempt in which the sandbox refused the direct confirm");
  if (!/our own Airwallex sandbox merchant/.test(rec.checkout.what)) missing("the merchant: our own Airwallex sandbox account");
  return [
    "The credential is a test credential, from Airi's test card.",
    "One person played both the CFO and the cardholder.",
    // The attempt history is folded (vicAttempts, "The N attempts that failed first"); in sight, how the card number
    // travelled here and how it would in production (the jury check, 12 Nov).
    "Sandbox only: a headless browser in the agent's process typed the number into Airwallex's hosted page; the sandbox refuses a direct confirm.",
    "In production no card number would enter the agent's process: the merchant would get a network token via the Connect access above.",
    "The merchant is Purser's own sandbox account.",
  ];
}

export function vicFactsHtml(facts: string[]): string {
  return facts.length ? `<ul class="pl vfacts" id="${VIC_FACTS_ID}" aria-label="${esc("What the sandbox could not show")}">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
}

export interface VicCompare {
  step: string;
  heading: string;
  /** equal: what the mark says; mark: what was compared, when not all three columns (the amount: signed and charged). */
  /** sub: a cell's own small note under its value (the middle amount: "from the signed terms"). */
  rows: { name: string; values: [string, string, string]; sub?: [string | null, string | null, string | null]; equal?: boolean; mark?: string }[];
  note: string;
  file: string;
}

/**
 * Purchase B in three columns, or null without Airwallex's record of its payment. The amounts: the terms the CFO
 * signed, the mandate built from them, and the amount in Airwallex's own answer.
 */
export function vicCompare(rec: AiriRunRecord, net: { file: string; rec: IntentsRecord } | null): VicCompare | null {
  const b = rec.purchases.find((p) => p.route === "cfo" && p.outcome === "SUCCEEDED");
  if (!b?.proposal_id || !b.terms_sha256 || !b.mandate_id || !b.payment_intent_id || !net) return null;
  const charged = net.rec.payment_intents.find((p) => p.purchase === b.step && p.id === b.payment_intent_id);
  const amount = Number(charged?.intent.amount);
  if (!charged || !Number.isFinite(amount) || typeof charged.intent.currency !== "string") return null;
  const signed = `${b.currency} ${b.amount}`, paid = `${charged.intent.currency} ${amount.toFixed(2)}`;
  const back = b.mandate_terms_sha256;
  return {
    step: b.step,
    heading: `Purchase ${b.step}: signed, sent, charged`,
    rows: [
      { name: "Amount", values: [signed, signed, paid], sub: [null, "from the signed terms", null], equal: signed === paid, mark: signed === paid ? "signed = charged" : "signed ≠ charged" },
      { name: "Record", values: [`${b.proposal_id} · terms ${short(b.terms_sha256)}`, b.mandate_id, b.payment_intent_id] },
      ...(back ? [{ name: "Terms hash", values: [short(b.terms_sha256), `${short(back)} read back from Airi`, "not sent to Airwallex"] as [string, string, string], equal: back === b.terms_sha256 }] : []),
    ],
    note: `Purser builds the mandate from the signed terms only${back ? "" : "; this record holds the mandate's id, not Airi's copy of the amount"}. Charged: Airwallex's own record, read ${day(net.rec.read_at)}.`,
    file: net.file,
  };
}

export function vicCompareHtml(c: VicCompare | null): string {
  if (!c) return "";
  const mark = (r: VicCompare["rows"][number]) => (r.equal === undefined ? "" : `<span class="awm ${r.equal ? "ok" : "bad"}">${esc(`${r.equal ? "✓" : "✕"} ${r.mark ?? (r.equal ? "equal" : "differs")}`)}</span>`);
  const row = (r: VicCompare["rows"][number]) => `<div class="awrow"><span class="k">${esc(r.name)}${mark(r)}</span>${r.values.map((v, i) => `<span><b class="lbl">${esc(VIC_COMPARE_COLUMNS[i]!)}</b><code>${esc(v)}</code>${r.sub?.[i] ? `<small>${esc(r.sub[i]!)}</small>` : ""}</span>`).join("")}</div>`;
  return `<section class="card vc" id="${VIC_COMPARE_ID}" aria-labelledby="${VIC_COMPARE_ID}-h"><h2 id="${VIC_COMPARE_ID}-h">${esc(c.heading)}</h2>
<div class="awcard"><div class="awhead"><span></span>${VIC_COMPARE_COLUMNS.map((h) => `<span>${esc(h)}</span>`).join("")}</div>
${c.rows.map(row).join("\n")}</div>
<p class="src">${esc(c.note)} <a class="pf" href="${esc(`${REPO_BLOB}${c.file}`)}" target="_blank" rel="noopener">${esc("record")} ↗</a></p></section>`;
}

/** Each code of a failed attempt in plain words, for a CFO; a code not listed here is shown as it is. */
export const VIC_CODE_WORDS: Record<string, string> = {
  AIRI_OUTPUT_UNRECOGNISED: "Airi's answer came in another spelling",
  validation_error: "the sandbox refused a direct confirm",
  PURSER_NO_TAP: "the cardholder did not confirm in time",
  duplicate_request: "an order reference was reused",
};

/** A failed attempt in one line: its time, its outcome and the codes of its cause in plain words (the cause in full is in the run log). */
export function vicAttemptLines(rec: AiriRunRecord): string[] {
  return vicAttemptCount(rec).failed.map((a) => {
    const codes = [...new Set((a.cause ?? "").match(/\b(?:[A-Z]{2,}(?:_[A-Z]+)+|[a-z]+_[a-z]+)\b/g) ?? [])];
    const said = codes.map((c) => (VIC_CODE_WORDS[c] ? `${VIC_CODE_WORDS[c]} (${c})` : c));
    return `${a.at.slice(11, 16)} UTC, ${a.outcome}${said.length ? `: ${said.join("; ")}` : ""}${/nothing charged/i.test(a.cause ?? "") ? ". Nothing charged." : "."}`;
  });
}

/** The folded row: the day's attempts that did not pass. "" when none failed. */
export function vicAttemptsHtml(rec: AiriRunRecord): string {
  const lines = vicAttemptLines(rec);
  if (lines.length === 0) return "";
  const n = vicAttemptCount(rec), first = n.failedFirst ? " first" : "";
  return `<details class="fold" id="${VIC_ATTEMPTS_ID}"><summary>${esc(lines.length === 1 ? `The attempt that failed${first}` : `The ${lines.length} attempts that failed${first}`)}</summary>
<p>${esc(`${n.paid} of ${n.all} attempts that day paid.`)}</p>
<ul class="awc">${lines.map((l) => `<li class="no">${esc(l)}</li>`).join("")}</ul>
<p class="src">${esc("Each cause in full: ")}<a class="pf" href="${esc(`${REPO_BLOB}${AIRI_RUN_LOG}`)}" target="_blank" rel="noopener">${esc("run log")} ↗</a></p></details>`;
}

/** The table's four columns from 701 px; below, the shared rows stack with their column's name. The facts: plain lines. */
export const VIC_FACTS_CSS = `.vc { padding: 16px 18px; display: grid; gap: 10px; min-width: 0; scroll-margin-top: 80px; }
.vc h2 { font-size: 18px; margin: 0; } .vc p.src { margin: 0; color: var(--faint); font-size: 14px; overflow-wrap: anywhere; }
.vc .awrow code { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; color: var(--text); }
.vc .awrow .k .awm { font-size: 13px; padding: 1px 8px; }
@media (min-width: 701px) { .vc .awrow, .vc .awhead { grid-template-columns: 12.5em repeat(3, minmax(0, 1fr)); } }
ul.pl.vfacts { margin: 0; }`;
