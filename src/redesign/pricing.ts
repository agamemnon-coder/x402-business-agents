// /pricing, "Pilot pricing" (12 Nov): pilot prices for design partners, nothing on sale yet. Three cards. Every price
// comes from src/config/pricing.ts; the platform fee's test amounts are read from the run record of the sandbox run
// (docs/runs/2026-11-10-connected-accounts-sandbox.md) and labelled test values, not prices. No script.
//
// Not shown, on purpose: "What an invoice costs us in Claude calls". No eval or run record in the repository holds a
// measured Claude cost per invoice (the end-to-end run of 10 November counted its Claude calls, not their cost; the model
// benchmark prices a set of mixed documents per run). The block comes back when a record holds the figure.

import { PRICING, euro } from "../config/pricing.js";
import { outLink, productPage, repoHref, repoText } from "./productPage.js";
import { esc, icon } from "./ui.js";

/** The one lead line: what these prices are. */
export const PRICING_LEAD = "These are pilot prices for design partners. Nothing is on sale yet.";
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

const ticks = (lines: readonly string[]) => `<ul class="ticks">${lines.map((l) => `<li>${icon("check", 16)}<span>${esc(l)}</span></li>`).join("")}</ul>`;

export function pricingPage(): string {
  const { starter, business, platformFee } = PRICING, run = feeRun();
  const body = `<div class="cols c3">
  <article class="pc card" id="starter"><h2>${esc(starter.name)}</h2><p class="v">${esc(euro(starter.monthlyCents))} <small>a month</small></p>
    ${ticks([`${starter.invoicesIncluded} invoices included`, `${euro(starter.extraInvoiceCents)} per extra invoice`])}</article>
  <article class="pc card" id="business"><h2>${esc(business.name)}</h2><p class="v"><small>from</small> ${esc(euro(business.fromMonthlyCents))} <small>a month</small></p>
    ${ticks(business.includes)}</article>
  <article class="pc card" id="platform-fee"><h2>${esc(platformFee.name)}</h2><p class="v words">A small fee per payout</p>
    ${ticks(["Collected through Airwallex connected accounts", `Already ran in the Airwallex sandbox (${run.day})`])}
    <p class="sub">In that run: a ${esc(run.fee)} test fee on a ${esc(run.payout)} test payout.</p>
    <div class="links"><span class="pill">${esc(TEST_VALUES)}</span>${outLink(repoHref(run.record), "The run record")}</div></article>
</div>
<p class="notyet"><b>Not yet:</b> ${esc(PRICING_NOT_YET)}</p>`;
  return productPage({
    key: "pricing", title: "Pilot pricing", h1: "Pilot pricing", label: "Sandbox and test money only", lead: PRICING_LEAD, body,
    description: "Pilot prices for design partners; nothing is on sale yet. Starter, Business and a small platform fee per payout through Airwallex connected accounts.",
    source: `Source: src/config/pricing.ts (the prices) and ${run.record} (the fee's sandbox run).`,
    real: [
      "Pilot prices for design partners. Nothing is on sale yet.",
      `The platform fee ran in the Airwallex sandbox on ${run.day}, with test money: ${run.fee} on a ${run.payout} payout are test values, not prices.`,
      "No real-money go-live yet: sandbox and test money only.",
    ],
  });
}
