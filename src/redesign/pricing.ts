// /pricing, "Pilot pricing" (12 Nov): pilot prices, nothing on sale yet. Three cards. Every price
// comes from src/config/pricing.ts; the platform fee's test amounts are read from the run record of the sandbox run
// (docs/runs/2026-11-10-connected-accounts-sandbox.md) and labelled test values, not prices. No script.
//
// One model (the panel's review, 12 Nov): a monthly plan by supplier invoices plus a small fee per payout, the same
// sentence on the README, in docs/business/model.md and in docs/after-the-kit.md (PRICING_STATEMENT). How the fee is
// set, and how the fixed test fees of the two sandbox runs fit the percentage, is one line (feeLine), folded in the
// fee's card here and said word for word in those two docs.
//
// Not shown, on purpose: "What an invoice costs us in Claude calls". No eval or run record in the repository holds a
// measured Claude cost per invoice (the end-to-end run of 10 November counted its Claude calls, not their cost; the model
// benchmark prices a set of mixed documents per run). The block comes back when a record holds the figure.
// (docs/business/model.md has an estimate, labelled as one; an estimate is not shown on this page.)

import { PRICING, euro, percentOfBps } from "../config/pricing.js";
import { foldHtml, outLink, productPage, repoHref, repoText } from "./productPage.js";
import { esc, icon } from "./ui.js";

/** The one lead line: what these prices are. */
export const PRICING_LEAD = "Pilot prices. Nothing is on sale yet.";
/** The one "Not yet" line. */
export const PRICING_NOT_YET = "no real-money go-live. Everything so far ran in the sandbox, with test money.";
export const TEST_VALUES = "Test values, not prices";

export interface FeeRun { day: string; payout: string; fee: string; record: string }

/**
 * The connected-accounts run in the Airwallex sandbox: the payout made on a test company's behalf and the fee Airwallex
 * accepted with it, as its run record has them. Read from the record's own lines: its day from the heading, the two
 * amounts from the row of the payout call. A record that no longer says them is an error, never a guess.
 */
export function feeRun(text: string = repoText(PRICING.platformFee.runRecord)): FeeRun {
  const day = /^# [^\n]*\((\d{1,2} [A-Z][a-z]+) \d{4}\)/.exec(text)?.[1];
  // The payout's own row: "POST /transfers/create with x-on-behalf-of: EUR 5.00 … | … application_fees: EUR 0.05 (TRANSFER)".
  const row = /`POST \/transfers\/create` with `x-on-behalf-of`: (EUR \d+\.\d{2}),[^|\n]*application_fee_options[^|\n]*\|[^|\n]*`application_fees`: (EUR \d+\.\d{2}) \(TRANSFER\)/.exec(text);
  if (!day || !row || !/\*\*`PAID`\*\*/.test(text)) throw new Error(`${PRICING.platformFee.runRecord}: the payout, its fee or its day is not in the record as expected`);
  return { day, payout: row[1]!, fee: row[2]!, record: PRICING.platformFee.runRecord };
}

/**
 * The end-to-end run in the Airwallex sandbox later that day (three test companies): the one payout that went PAID and
 * the fee taken with it, read from that payout's row in the record's own table. Never a guess.
 */
export function e2eFeeRun(text: string = repoText(PRICING.platformFee.e2eRecord)): FeeRun {
  const day = /^# [^\n]*\((\d{1,2} [A-Z][a-z]+) \d{4}\)/.exec(text)?.[1];
  // "| SANDBOXTEST | `593c…`, EUR 4.84 | **PAID** (sandbox simulation SENT, PAID) | EUR 0.02, SETTLED, to `acct_…` | EUR 2.69 |"
  const row = /^\| [A-Z]+ \| `[0-9a-f-]+`, (EUR \d+\.\d{2}) \| \*\*PAID\*\*[^|\n]*\| (EUR \d+\.\d{2}), SETTLED,/m.exec(text);
  if (!day || !row) throw new Error(`${PRICING.platformFee.e2eRecord}: the paid payout, its fee or its day is not in the record as expected`);
  return { day, payout: row[1]!, fee: row[2]!, record: PRICING.platformFee.e2eRecord };
}

const centsOf = (eur: string) => Math.round(Number(eur.replace("EUR ", "")) * 100);

export interface FeeFacts { cap: string; fixed: FeeRun & { percent: string }; policy: FeeRun & { percent: string } }

/**
 * How the two test fees fit the percentage, worked out from the records and the code's own figures, never typed:
 * - the ceiling is the paying code's (PRICING.platformFee.capBps: FEE_BPS_CAP in src/airwallex/platform.ts);
 * - the first run passed a fixed fee straight to the payout code: its share of the payout is worked out here, and must
 *   be a whole number of basis points at or under the ceiling;
 * - the end-to-end run took the rate from its test policy (PRICING.platformFee.testPolicyBps, which src/e2e/setup.ts
 *   sets): that rate of the payout, rounded to the cent as the paying code rounds it (platformFeeCents in
 *   src/airwallex/binding.ts), must be the fee in the record.
 * A record or a rate that no longer fits is an error, so the line below is never wrong in silence.
 */
export function feeFacts(first: FeeRun = feeRun(), second: FeeRun = e2eFeeRun()): FeeFacts {
  const { capBps, testPolicyBps } = PRICING.platformFee;
  const fixedBps = (centsOf(first.fee) * 10_000) / centsOf(first.payout);
  if (!Number.isInteger(fixedBps) || fixedBps > capBps) throw new Error(`${first.record}: ${first.fee} on ${first.payout} is not a whole rate at or under the ceiling`);
  if (Math.round((centsOf(second.payout) * testPolicyBps) / 10_000) !== centsOf(second.fee)) throw new Error(`${second.record}: ${second.fee} is not ${percentOfBps(testPolicyBps)} of ${second.payout}, rounded to the cent`);
  return { cap: percentOfBps(capBps), fixed: { ...first, percent: percentOfBps(fixedBps) }, policy: { ...second, percent: percentOfBps(testPolicyBps) } };
}

/**
 * The one line that reconciles the fixed test fees with the percentage (the panel's review, 12 Nov). The same words on
 * /pricing (folded in the fee's card), in docs/business/model.md and in docs/after-the-kit.md.
 */
export function feeLine(f: FeeFacts = feeFacts()): string {
  return `The fee is a percentage of each payout: the CFO signs the rate in the policy, and code keeps it at or under ${f.cap}, rounds it to the cent and sends it to Airwallex as a fixed amount. The two sandbox runs used test values, not prices: ${f.fixed.fee} on ${f.fixed.payout} (${f.fixed.percent}, a fixed test fee set for that run) and ${f.policy.fee} on ${f.policy.payout} (the test policy's ${f.policy.percent}, rounded to the cent).`;
}
/** The fold's summary in the fee's card. */
export const FEE_FOLD = "How the fee is set";

const ticks = (lines: readonly string[]) => `<ul class="ticks">${lines.map((l) => `<li>${icon("check", 16)}<span>${esc(l)}</span></li>`).join("")}</ul>`;

export function pricingPage(): string {
  const { starter, business, platformFee } = PRICING, run = feeRun(), fees = feeFacts(run);
  const body = `<div class="cols c3">
  <article class="pc card" id="starter"><h2>${esc(starter.name)}</h2><p class="v">${esc(euro(starter.monthlyCents))} <small>a month</small></p>
    ${ticks([`${starter.invoicesIncluded} invoices included`, `${euro(starter.extraInvoiceCents)} per extra invoice`])}</article>
  <article class="pc card" id="business"><h2>${esc(business.name)}</h2><p class="v"><small>from</small> ${esc(euro(business.fromMonthlyCents))} <small>a month</small></p>
    ${ticks(business.includes)}</article>
  <article class="pc card fd" id="platform-fee"><h2>${esc(platformFee.name)}</h2><p class="v words">A small fee per payout</p>
    ${ticks(["Collected through Airwallex connected accounts", `Already ran in the Airwallex sandbox (${run.day})`])}
    <p class="sub">In that run: a ${esc(run.fee)} test fee on a ${esc(run.payout)} test payout.</p>
    <div class="links"><span class="pill">${esc(TEST_VALUES)}</span>${outLink(repoHref(run.record), "The run record")}</div>
    ${foldHtml(FEE_FOLD, [esc(feeLine(fees)), outLink(repoHref(fees.policy.record), "The end-to-end run record")])}</article>
</div>
<p class="notyet"><b>Not yet:</b> ${esc(PRICING_NOT_YET)}</p>`;
  return productPage({
    key: "pricing", title: "Pilot pricing", h1: "Pilot pricing", label: "Sandbox and test money only", lead: PRICING_LEAD, body,
    description: "Pilot prices; nothing is on sale yet. Starter, Business and a small platform fee per payout through Airwallex connected accounts.",
    source: `Source: Purser's price list in its code and ${run.record} (the fee's sandbox run).`,
    real: [
      "Pilot prices. Nothing is on sale yet.",
      `The platform fee ran in the Airwallex sandbox on ${run.day}, with test money: ${run.fee} on a ${run.payout} payout are test values, not prices.`,
      "No real-money go-live yet: sandbox and test money only.",
    ],
  });
}
