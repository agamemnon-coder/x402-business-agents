// "The CFO's policy next to Visa's VIC rules" on /visa (12 Nov): a small, sourced table, one folded row under the two
// Airi runs. Left: Purser's own rule, its values read from the Airi run's record, the control test's record and the
// code's constants, with where it ran (a block on the page) and where it is enforced (a source file; a test holds it).
// Right: Visa's published rule for Visa Intelligent Commerce (v2), first in plain words, then in Visa's own.
//
// Honesty: this is a comparison with Visa's documentation, not an implementation of it. Nothing here calls Visa, builds
// a Visa request or stands in for Visa's service: it is static text beside Purser's own figures. Purser reached Visa
// Intelligent Commerce through Airwallex's Airi only; the checks on the left are Purser's, and whether Airi or Visa
// enforce the rules on the right for this credential was not tested. The block says all of that.
//
// Every quote is word for word from one page, https://developer.visa.com/docs/visa-intelligent-commerce/concepts, read
// on 12 November 2026 (the page and its raw .md copy; sections Foundations, Purchase types, Lifecycles, Controls and
// rules). Nothing is cited that was not read there. test/vic-rules.test.ts holds the values and the quotes.

import { AIRI_HARD_CAP_CENTS } from "../airi/policy.js";
import { AIRI_TERMS_TTL_MS } from "../airi/purchase.js";
import { fromCents } from "../lib/money.js";
import { AIRI_RUN_ID, type AiriRunRecord } from "./airiRun.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";
import { VIC2_RUN_ID, type Vic2Record } from "./vic2Run.js";

export const VIC_RULES_ID = "vic-rules";
export const VIC_RULES_SUMMARY = "The CFO's policy next to Visa's VIC rules";
/** The one page Visa's rules are quoted from, and the day it was read. */
export const VIC_DOCS = { url: "https://developer.visa.com/docs/visa-intelligent-commerce/concepts", title: "Visa Intelligent Commerce: Concepts", read: "2026-11-12" } as const;

export type VicDocSection = "Foundations" | "Purchase types" | "Lifecycles" | "Controls and rules";

export interface VicRuleRow {
  topic: string;
  /** Purser's rule, its values from the records and the code. */
  purser: string;
  /** Where it ran: a line, and that run's block on the page. */
  ran?: { text: string; anchor: string };
  /** Where it is enforced, and the test that holds it. */
  source: string;
  test: string;
  /** Visa's rule in plain words, then in Visa's own (each quote may carry a label). */
  visa: string;
  quotes: string[];
  labels?: string[];
  section: VicDocSection;
  /** A field of a VIC mandate as Visa documents it, and the field of the terms the CFO signs that plays its part. */
  mandate: { visa: string; purser: string }[];
}

/** The rows, from the Airi run's record, the control test's record (when there is one) and the code's constants. */
export function vicRules(run: AiriRunRecord, controls: Vic2Record | null): VicRuleRow[] {
  const buy = (s: string) => run.purchases.find((p) => p.step === s);
  const b = buy("B"), c = buy("C");
  const cur = b?.currency ?? run.purchases[0]?.currency ?? "EUR";
  const confirmed = run.purchases.filter((p) => /passkey in Airi/.test(p.tap ?? "")).map((p) => p.step);
  const d = controls?.steps.D;
  const code = "src/airi/purchase.ts", held = "test/airi-purchase.test.ts";
  return [
    {
      topic: "Amount",
      purser: `Up to ${cur} ${run.policy.alone_max_eur} with no Purser approval. Above it the CFO signs the exact amount with Face ID. Never above ${cur} ${fromCents(AIRI_HARD_CAP_CENTS)}.`,
      ...(b?.proposal_id ? { ran: { text: `Ran: purchase ${b.step}, ${b.proposal_id}`, anchor: AIRI_RUN_ID } } : {}),
      source: code, test: held,
      visa: "Each mandate carries a limit, its decline threshold.", quotes: ["the transactionAmount alone does not exceed the mandate's declineThreshold"],
      section: "Controls and rules", mandate: [{ visa: "declineThreshold", purser: "amount, currency" }],
    },
    {
      topic: "Merchant",
      purser: "Only merchants the CFO allows. Any other is refused before Airi is asked.",
      ...(c?.code && c.airi_calls !== undefined ? { ran: { text: `Ran: purchase ${c.step}, ${c.code}, ${c.airi_calls} Airi calls`, anchor: AIRI_RUN_ID } } : {}),
      source: code, test: held,
      visa: "A mandate can name the merchant.", quotes: ["the transaction's merchant name matches any preferred merchant name set on that mandate"],
      section: "Controls and rules", mandate: [{ visa: "preferred merchant name", purser: "merchant.name" }],
    },
    {
      topic: "How long an approval lasts",
      purser: `An approval lapses after ${AIRI_TERMS_TTL_MS / 60_000} minutes.`,
      source: "src/policy/approvals.ts", test: "test/approvals.test.ts",
      visa: "A mandate has an end time, and an instruction expires.", quotes: ["Instructions default to a 30-day (US) intent expiration."],
      section: "Lifecycles", mandate: [{ visa: "effectiveUntilTime", purser: "expires_at" }],
    },
    {
      topic: "A change after approval",
      purser: "The CFO signs a hash of the exact terms. Changed terms no longer match it and are refused; a change needs a new approval.",
      ...(d?.executor.refused ? { ran: { text: `Ran: the control test, ${d.request.currency} ${d.alteration.changed.amount.from} changed to ${d.request.currency} ${d.alteration.changed.amount.to}, refused`, anchor: VIC2_RUN_ID } } : {}),
      source: "src/policy/approvals.ts", test: held,
      visa: "No edits: cancel it and create a new one.", quotes: ["There is no endpoint to modify an existing instruction or mandate."],
      section: "Controls and rules", mandate: [],
    },
    {
      topic: "Total spend",
      purser: `One approval covers one purchase. Without Face ID, at most ${run.policy.alone_per_day} purchases a day.`,
      source: code, test: held,
      visa: "Visa adds up every purchase made under an instruction.", quotes: ["it sums all transactions and mandates on the instructionId (including prior transactions) and confirms the total does not exceed the decline threshold"],
      section: "Controls and rules", mandate: [],
    },
    {
      topic: "Who approves",
      purser: "Above the limit the CFO approves each purchase with Face ID. In the run the cardholder also confirmed every purchase in Airi.",
      ...(confirmed.length ? { ran: { text: `Ran: ${confirmed.length > 1 ? "purchases" : "purchase"} ${confirmed.join(" and ")}, each confirmed in Airi`, anchor: AIRI_RUN_ID } } : {}),
      source: code, test: held,
      visa: "A person approves each purchase, or the agent buys within approved bounds.", quotes: ["cardholder authorizes a specific transaction", "Agent, within approved bounds"], labels: ["Human-in-the-loop", "Autonomous"],
      section: "Purchase types", mandate: [],
    },
  ];
}

const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** The folded row: what it is and is not, the table, whose checks these are, and the source of Visa's words. */
export function vicRulesHtml(rows: VicRuleRow[]): string {
  if (rows.length === 0) return "";
  const where = (r: VicRuleRow) => `<small>${r.ran ? `<a class="pf" href="#${esc(r.ran.anchor)}">${esc(r.ran.text)}</a> · ` : ""}<a class="pf" href="${esc(`${REPO_BLOB}${r.source}`)}" target="_blank" rel="noopener">${esc("code")} ↗</a></small>`;
  const quoted = (r: VicRuleRow) => `<small>${r.quotes.map((q, i) => esc(`${r.labels?.[i] ? `${r.labels[i]}: ` : ""}“${q}”`)).join(" · ")}</small>`;
  const row = (r: VicRuleRow) => `<div class="awrow"><span class="k">${esc(r.topic)}</span><span><b class="lbl">${esc("Purser")}</b>${esc(r.purser)}${where(r)}</span><span><b class="lbl">${esc("Visa")}</b>${esc(r.visa)}${quoted(r)}</span></div>`;
  const sections = [...new Set(rows.map((r) => r.section))];
  return `<details class="fold" id="${VIC_RULES_ID}"><summary>${esc(VIC_RULES_SUMMARY)}</summary>
<p>${esc("A comparison with Visa's published rules, not an implementation of them: Purser does not call Visa's API. It reached Visa Intelligent Commerce through Airwallex's Airi.")}</p>
<div class="awcard vr"><div class="awhead"><span>${esc("Rule")}</span><span>${esc("The CFO's policy in Purser")}</span><span>${esc("Visa Intelligent Commerce (v2), in Visa's words")}</span></div>
${rows.map(row).join("\n")}</div>
<p>${esc("The checks on the left are Purser's own. Whether Airi or Visa enforce the rules on the right for this credential was not tested.")}</p>
<p class="src">${esc("Visa's rules: ")}<a class="pf" href="${esc(VIC_DOCS.url)}" target="_blank" rel="noopener">${esc(VIC_DOCS.title)} ↗</a>${esc(` (${sections.join(", ")}), developer.visa.com, read ${dayLong(VIC_DOCS.read)}.`)}</p></details>`;
}

/** The row for /visa: "" without the Airi run's record. */
export function vicRulesBlock(run: AiriRunRecord | null, controls: Vic2Record | null): string {
  return run ? vicRulesHtml(vicRules(run, controls)) : "";
}

/** The table's columns from 701 px (a short first column); below, the shared rows stack with their labels. */
export const VIC_RULES_CSS = `@media (min-width: 701px) { .vr .awrow, .vr .awhead { grid-template-columns: 9em minmax(0, 1fr) minmax(0, 1fr); } }
.vr .awrow small { font-size: 14px; line-height: 1.4; margin-top: 2px; }`;
