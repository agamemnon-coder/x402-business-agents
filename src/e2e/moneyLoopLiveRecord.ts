// What each money-loop live run's record says beyond its tables (docs/runs/2026-11-26-<record>.md): the simulated
// parts, what it shows when every step passed, what it does not show, and a summary computed from the steps.

import { summaryOf, type GovRecordMeta } from "./governanceLiveRecord.js";
import type { LoopRun } from "./moneyLoopLive.js";

/** The record each run writes (docs/runs/<date>-<name>.md). */
export const LOOP_RECORD_NAME: Record<LoopRun, string> = { "fx-convert": "fx-conversion-live", receivables: "receivables-live", "negotiated-pay": "negotiated-payout-live" };

const PASSKEY = "The approver is a labelled virtual test passkey (\"money-loop virtual test passkey (no person's Face ID)\", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.";
const PREP = "Before the runs, 6 read-only calls looked at the sandbox (two probes, logins included: the balances twice, the beneficiaries and the Global Accounts); none moved money or changed anything, and they are not in this record's call table. The three runs (19:53 to 19:54 UTC) ran one after the other on the code committed as `9abc1b24b`.";
const REVIEW = "The code that ran includes the review fixes of 26 Nov: the FX executor judges the floor on free money under the payout lock and holds the signed maximum, and checks the stop, pause and the agent's identity again right before the create; a payment reference names an invoice only as a whole word.";

const FX: Omit<GovRecordMeta, "summary"> = {
  title: "Cash and FX, live",
  intro: "The Treasury advisor against the real sandbox: the balances read, a 13-week forecast from them and the ledger, the advisor's suggested conversion from Airwallex's indicative rates over the CFO's threshold, the passkey's approval, and the executor's real quote and conversion; a change to the signed terms refused before any call.",
  note: `A fresh ledger of its own. The sandbox holds no CHF, so a test payable of CHF 100.00 due in 10 days makes the forecast fall CHF 100.00 short; the CFO's threshold is EUR 50.00. ${PREP} ${REVIEW}`,
  simulated: [
    PASSKEY,
    "The CHF payable (AGZ-1126, \"Alpenglas Zuerich AG (test supplier)\") is a test invoice entered in the run's ledger: no supplier sent it, and it is not paid by this run. The balances, the rates, the quote and the conversion are the sandbox's own (test money).",
    "The change after signing (buy_amount 100.00 to 100.01 in the stored terms) is made by the run in its own ledger, as someone with write access to the ledger would; the refused proposal is then closed.",
  ],
  shows: [
    "The advisor's suggestion is computed from Airwallex's real available balances and indicative rates, and is filed only because it is at or above the CFO's threshold.",
    "Terms changed after the passkey signed them reach nothing outside Purser: the executor refused before any Airwallex call.",
    "The signed conversion is one real sandbox quote and one real conversion, for exactly the signed buy amount, within the signed maximum, under the signed request id; asked again, nothing is converted twice.",
  ],
  keySteps: ["fx.balances", "fx.advice", "fx.changed_after_signing", "fx.signed", "fx.convert", "fx.readback", "fx.again"],
  notShown: [
    "The CHF payable being paid: the run converts for it and stops there.",
    "A person's Face ID on a real phone; Purser Cloud's screens. The runner's every-few-seconds loop did not run: each step was called once, in order.",
    "A rate that moves past the signed maximum, or a stop pulled during the quote, live: both are covered by test/treasury-fx-proposal.test.ts on stand-ins, not run against the sandbox.",
  ],
};

const AR: Omit<GovRecordMeta, "summary"> = {
  title: "Receivables, live",
  intro: "Money in against the real sandbox: two customer invoices booked, one with a real single-use Airwallex payment link; two incoming payments made by the sandbox's deposit simulation on the EUR Global Account, read back from Airwallex and matched by Purser (one pays its invoice, one names nothing and goes to review); the paid invoice's link switched off at Airwallex; a reminder drafted for the overdue invoice and never sent.",
  note: `A fresh ledger of its own. ${PREP} ${REVIEW}`,
  simulated: [
    "The customers are made up (\"Alpenhof Sport AG (test customer)\", \"Fjordline Outdoor AS (test customer)\", \"Unknown Test Payer GmbH\"). Their payments are the sandbox's deposit simulation (`POST /simulation/deposit/create`): no bank transfer and no card payment took place. Once made, each deposit is Airwallex's own record, read back with `GET /deposits` and matched from what Airwallex answered.",
    "The overdue invoice is dated 30 days back by the run (issued then, due 6 days ago): nothing waited, and the reminder is drafted for that due date.",
    "No passkey: money in needs no CFO approval in Purser; nothing here pays anything.",
  ],
  shows: [
    "A payment link at Airwallex for exactly one invoice (amount, currency, reference, single use), read back, and switched off once the invoice is paid.",
    "A deposit read back from Airwallex is matched to its open invoice by its reference and booked once; a second sight of it books nothing.",
    "A deposit that names no invoice and fits none goes to the review queue and to suspense (2900), never to revenue.",
    "Reminders are drafts for a person: one drafted for the overdue invoice, stored as DRAFT, sent by nobody.",
  ],
  keySteps: ["ar.issue_linked", "ar.deposits", "ar.readback", "ar.match", "ar.once", "ar.link_off", "ar.dunning"],
  notShown: [
    "A customer paying through the link's hosted checkout page (a card payment): not done; the link is made, read back and switched off.",
    "A real bank transfer from a customer: the deposits are the sandbox's simulation.",
    "Partial, short and overpaid payments live: covered by test/receivables-ar.test.ts, not run against the sandbox.",
  ],
};

const NEG: Omit<GovRecordMeta, "summary"> = {
  title: "Negotiated early-payment discount, paid live",
  intro: "Purser's Sourcing agent and a simulated supplier agree an early-payment discount in a chain of signed offers (the recorded negotiation); the agreement is checked, the supplier's invoice for the agreed terms is planned, signed with the passkey and paid to the sandbox beneficiary through the normal executor, and Airwallex's transfer is read back: the agreed amount, with the agreement's hash in its metadata beside the approval hash.",
  note: `A fresh ledger of its own; the payee is the beneficiary on file at the sandbox (Bergtex Textil GmbH), not created by the run. ${PREP} ${REVIEW}`,
  simulated: [
    PASSKEY,
    "The negotiation is the recorded one (src/negotiate/negotiate.ts recordedTurns: written in advance, labelled \"Recorded negotiation\", no model call): the supplier and its agent are simulated, and its agent's signing key was made by the simulation. Purser's rails and the CFO's negotiation policy judge every turn live, and every offer is signed and chained live.",
    "The supplier's invoice for the agreed terms is composed by the run (as /try's engine composes it); no supplier sent it. The transfer's settlement is not simulated: it stays as Airwallex answered.",
  ],
  shows: [
    "The rails refused the supplier's mid-negotiation bank change, and the deal agreed is within the CFO's policy.",
    "Each offer's signature verifies with its agent's key, the offers form one chain, and the agreement's SHA-256 recomputes and holds the chain's head.",
    "An invoice under the agreement for the original amount is refused before any Airwallex call: only the agreed amount is planned.",
    "The transfer Airwallex holds is for exactly the agreed amount, under the signed request_id, with approval_sha256 and agreement_sha256 in its metadata and the agreement's first 8 hex in its reference.",
  ],
  keySteps: ["neg.agree", "neg.verify", "neg.original_refused", "neg.signed", "neg.pay", "neg.readback"],
  notShown: [
    "A live negotiation between two Claude models: the turns are the recorded ones (no model call).",
    "The transfer's settlement to PAID: not simulated in this run (Airwallex answered SCHEDULED at create and PROCESSING at the read-back).",
    "A person's Face ID on a real phone. One run.",
  ],
};

const meta = (m: Omit<GovRecordMeta, "summary">): GovRecordMeta => ({ ...m, summary: summaryOf(m) });
export const LOOP_RECORD: Record<LoopRun, GovRecordMeta> = { "fx-convert": meta(FX), receivables: meta(AR), "negotiated-pay": meta(NEG) };
