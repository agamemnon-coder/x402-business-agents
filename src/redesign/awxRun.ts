// awx-1 on the site (7 Nov): the Airwallex-only run, a separate world on the Airwallex sandbox with test money, shown on
// /airwallex and in Proof's "Airwallex, read back" beside the main run's read-backs. Everything here is read from its
// record, docs/demo/airwallex-run.json (npm run awx-1 -- record, from the world's ledger); the run log is
// docs/runs/2026-11-07-awx-1.md. Nothing is typed in: the ids, amounts, decline codes, counts and the date come from
// the record, and the line shows only when the record is the live run's. test/awx-run-page.test.ts holds every figure
// to the record.

import { existsSync, readFileSync } from "node:fs";
import type { Awx1Record } from "../awx/scenario.js";
import { moneyForPeople } from "../../worker/src/agentLine.js";
import { REPO_BLOB } from "./metalStory.js";
import { family } from "./run.js";
import { esc, icon } from "./ui.js";

export const AWX_RUN_FILE = "docs/demo/airwallex-run.json";
export const AWX_RUN_LOG = "docs/runs/2026-11-07-awx-1.md";
/** The block's anchor on /airwallex and /proof. */
export const AWX_RUN_ID = "awx-1";
/** The fold with every step on /airwallex: Proof links here, and the page opens it on arrival (OPEN_TARGET_JS). */
export const AWX_RUN_STEPS_ID = "awx-1-steps";
/** The label every showing of the run carries (Max, 7 Nov: a date and "sandbox, test money"). */
export const AWX_RUN_LABEL = "Airwallex sandbox, test money";

/** The live run's record, or null when there is none (or it is not a live run's). */
export function awxRun(file = AWX_RUN_FILE): Awx1Record | null {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return null;
  const rec = JSON.parse(readFileSync(url, "utf8")) as Awx1Record;
  return rec.mode === "live" && rec.test_money === true ? rec : null;
}

const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
const AGENT = (a: string) => `${a[0]!.toUpperCase()}${a.slice(1)}`;
/** Amounts as people read them, thousands grouped (jury review, 7 Nov, #23): "EUR 1,500.00"; num() the figure alone. */
const eur = (a: string) => moneyForPeople("EUR", a), usd = (a: string) => moneyForPeople("USD", a), num = (a: string) => moneyForPeople("EUR", a).slice(4);

export interface AwxRunSummary {
  run: string; date: string; checksOk: number; checksAll: number; lines: string[]; source: string;
  /** Proof's one line, counted from the record. */
  short: string;
}

/** The run in a few lines, each from the record; null when a fact the lines need is missing from it. */
export function awxRunSummary(rec: Awx1Record): AwxRunSummary | null {
  const tx = (step: string, approved: boolean) => rec.card_transactions.filter((t) => t.step === step && t.approved === approved);
  const [b] = tx("b", true), [cNo] = tx("c", false), [cYes] = tx("c", true), [dNo] = tx("d", false);
  const met = (id: string | undefined) => rec.declines_met.find((m) => m.transaction_id === id);
  const cMet = met(cNo?.id), dMet = met(dNo?.id);
  const card = (agent: string) => rec.cards.find((c) => c.agent === agent);
  const src = card("sourcing"), sup = card("support");
  const [lic, sup2] = [rec.invoices.find((i) => i.plan === "pay_from_eur"), rec.invoices.find((i) => i.plan === "convert_shortfall")];
  const start = rec.attempts[0]?.at;
  if (!b || !cNo || !cYes || !dNo || !cMet || !dMet || !src || !sup || !lic || !sup2?.quote || !start) return null;
  const rb = (c: typeof src, k: string) => String(c.read_back[k] ?? "");
  const faceId = (p: string) => rec.proposals.find((x) => x.proposal_id === p)?.method === "passkey" ? "the CFO's Face ID" : "the CFO's approval";
  const mccs = (c: typeof src) => (c.read_back.mccs as string[] | undefined ?? []).join(", ");
  const checks = Object.values(rec.checks);
  const verifyOk = rec.verify.length > 0 && rec.verify.every((v) => v.level !== "FAIL");
  const lines = [
    `${rec.cards.length} cards issued, one per agent, each with the CFO policy's limits, merchant category, EUR only and an end date, read back from Airwallex: ${rec.cards.map((c) => `····${c.last4}`).join(", ")}.`,
    `${b.merchant} charged ${eur(b.amount)} on the ${AGENT(b.agent)} card ····${b.last4}, within its ${eur(rb(src, "per_tx"))} limit: approved by Airwallex (${b.id}).`,
    `${eur(cNo.amount)}, over that limit: declined by Airwallex, ${cNo.decline_code} (${cNo.id}). The ${AGENT(cMet.agent)} agent (Claude ${family(cMet.model)}) read the code and asked the CFO for a raise, ${cMet.proposal_id}, instead of retrying. After ${faceId(cMet.proposal_id ?? "")} the card was updated at Airwallex to ${eur(String(src.read_back_end?.per_tx ?? ""))} a purchase, and the same charge was approved (${cYes.id}).`,
    `${eur(dNo.amount)} at ${dNo.merchant} (MCC ${dNo.mcc}) on the ${AGENT(dNo.agent)} card ····${dNo.last4}, which may pay MCC ${mccs(sup)} only: declined by Airwallex, ${dNo.decline_code} (${dNo.id}). The ${AGENT(dMet.agent)} agent asked for no raise.`,
    `${rec.webhooks.length} webhooks from Airwallex, each signature checked; all ${rec.card_transactions.length} card transactions recorded from them.`,
    `Invoice ${lic.invoice_no}, ${eur(lic.amount)}: free ${eur(lic.free_eur)} covers the ${num(lic.need_eur)} needed with the fee ceiling, so no FX. After ${faceId(lic.proposal_id)}, SWIFT transfer ${lic.transfer_id}: ${lic.status}, fee ${lic.fee}.`,
    `Invoice ${sup2.invoice_no}, ${eur(sup2.amount)}: free ${eur(sup2.free_eur)}, short of the ${num(sup2.need_eur)} needed, so only ${eur(sup2.quote.buy_eur)} bought for ${usd(sup2.quote.sell_usd)} at ${sup2.quote.rate} (quote ${sup2.quote.quote_id}, conversion ${sup2.conversion_id}). After ${faceId(sup2.proposal_id)}, SWIFT transfer ${sup2.transfer_id}: ${sup2.status}, fee ${sup2.fee}.`,
    `Both payouts carry the hash of the terms the CFO signed (approval_sha256) in Airwallex's own metadata.${verifyOk ? " verify: all checks pass." : ""}${rec.reconcile ? ` reconcile: ${rec.reconcile.differences === 0 ? "no differences" : `${rec.reconcile.differences} differences`}.` : ""}`,
  ];
  // The calls the run made, beside the budget it was given (jury review, 7 Nov, #22: "of the approved" read as approvals).
  const calls = rec.calls ? `${rec.calls.airwallex_total} Airwallex API calls${rec.calls.budget ? ` (run budget: ${rec.calls.budget})` : ""} · ` : "";
  return {
    run: rec.run, date: dayLong(start), checksOk: checks.filter((c) => c.ok).length, checksAll: checks.length, lines,
    short: `${rec.cards.length} agent cards with the CFO policy's controls; ${rec.declines_met.length} declines by Airwallex, each read by its agent and none retried (${rec.declines_met.filter((m) => m.proposal_id).length} raise asked of the CFO); ${rec.invoices.filter((i) => i.status === "PAID").length} invoices paid by SWIFT after the CFO's Face ID, ${rec.invoices.filter((i) => i.quote).length} with FX for the shortfall only.`,
    source: `${calls}merchant charges and SENT/PAID simulated by the sandbox · ${AWX_RUN_FILE}`,
  };
}

const badge = (ok: boolean, text: string) => `<span class="awm ${ok ? "ok" : "bad"}">${icon(ok ? "circle-check" : "octagon-x", 16)}${esc(text)}</span>`;

/** The block: its date, name and label, the checks passed, and (folded) every step with its Airwallex id. */
export function awxRunHtml(s: AwxRunSummary | null): string {
  if (!s) return "";
  return `<div class="card" id="${AWX_RUN_ID}"><h3>${icon("credit-card", 18)}${esc(`${s.date}, ${s.run}: a separate run · ${AWX_RUN_LABEL}`)}</h3>
${badge(s.checksOk === s.checksAll, `${s.checksOk} of ${s.checksAll} checks pass`)}
<details class="fold" id="${AWX_RUN_STEPS_ID}"><summary>${esc("Every step and id")}</summary><ul class="awc">${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p class="src">${esc(s.source)} · <a class="pf" href="${esc(`${REPO_BLOB}${AWX_RUN_LOG}`)}" target="_blank" rel="noopener">${esc("run log")} ↗</a></p></details></div>`;
}

/**
 * Proof's short version: the date, name and label, the checks passed, and a link to every step on /airwallex. The steps
 * stay off /proof, which names no decline code (test/proof-first.test.ts: TAP only in the footer link to /visa).
 */
export function awxRunShortHtml(s: AwxRunSummary | null): string {
  if (!s) return "";
  return `<div class="card" id="${AWX_RUN_ID}"><h3>${icon("credit-card", 18)}${esc(`${s.date}, ${s.run}: a separate run · ${AWX_RUN_LABEL}`)}</h3>
${badge(s.checksOk === s.checksAll, `${s.checksOk} of ${s.checksAll} checks pass`)}
<p>${esc(s.short)}</p>
<p class="src">${esc(s.source)}</p>
<a class="open" href="airwallex#${AWX_RUN_STEPS_ID}">${esc("Every step and id")} ${icon("arrow-right", 14)}</a></div>`;
}

/** The block as /airwallex shows it (full) and /proof (short), from the committed record (empty without a live record). */
export function awxRunBlock(rec: Awx1Record | null = awxRun(), o: { short?: boolean } = {}): string {
  if (!rec) return "";
  const s = awxRunSummary(rec);
  return o.short ? awxRunShortHtml(s) : awxRunHtml(s);
}
