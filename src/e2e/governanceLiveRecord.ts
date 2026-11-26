// What each governance live run's record says beyond its tables (docs/runs/2026-11-26-<record>.md): the simulated
// parts, what it shows when every step passed, what it does not show, and a summary computed from the steps.

import type { DrillRecord } from "./drillRecord.js";
import type { GovRun } from "./governanceLive.js";

type Step = DrillRecord["passes"][number]["steps"][number];

const PASSKEY = "The approver is a labelled virtual test passkey (\"governance-live virtual test passkey (no person's Face ID)\", src/redteam/authenticator.ts), enrolled as the only passkey of the run's own fresh ledger. Its signatures go through the same verification as a phone's (WebAuthn assertion over the exact terms hash); no person's Face ID was used.";
const RUNNER = "The runner's steps after an approval (executePolicyChange, then syncCardsAfterPolicy) are called by the run once, in order, not by a running `npm run relay` and its every-few-seconds loop.";
const PREP = "Before the runs, 14 read-only calls checked the sandbox (10 in three probes: the platform's and the connected account's balances, GET /account, which answered `acct_op0_QItiOyWKsYb5pwQihA`, and the connected account's beneficiaries; 4 in the entities run's two stopped attempts, described in docs/runs/2026-11-26-entities-live.md). None moved money or changed anything; they are not in this record's call table. The runs (11:27 to 11:32 UTC) ran on the code committed right after them as `86d7f6b93`; between the runs and that commit only the records' wording, the stand-in's call counter and two unused imports changed.";

/** The steps' outcomes in one line each, verdict first. */
const lines = (steps: Step[], ids: string[]) => steps.filter((s) => ids.includes(s.id)).map((s) => `${s.pass === true ? "pass" : s.pass === false ? "FAIL" : "not judged"}, \`${s.id}\`: ${s.outcome}`);
const allPassed = (r: DrillRecord) => r.totals.fail === 0 && r.totals.not_judged === 0 && !r.passes.some((p) => p.stopped);

export interface GovRecordMeta {
  title: string; intro: string; note: string; simulated: string[]; notShown: string[];
  /** What the run shows when every step passed (said only then). */
  shows: string[];
  keySteps: string[];
  summary: (r: DrillRecord) => string[];
}

export const summaryOf = (m: Pick<GovRecordMeta, "shows" | "keySteps">) => (r: DrillRecord): string[] => {
  const steps = r.passes.flatMap((p) => p.steps);
  const out = lines(steps, m.keySteps);
  if (allPassed(r)) out.push(...m.shows.map((s) => `Shown: ${s}`));
  else out.push(`Not every step passed (${r.totals.fail} failed, ${r.totals.not_judged} not judged${r.passes[0]?.stopped ? `; stopped at ${r.passes[0].stopped}` : ""}): nothing beyond the steps above is claimed.`);
  return out;
};

const CARD_HOURS: Omit<GovRecordMeta, "summary"> = {
  title: "Card governance, live",
  intro: "Per-agent card governance in Airwallex Issuing: one agent card issued through Purser's Issuing adapter and read back (metadata, merchant categories, currencies, limits, end date); the card's hours, Purser's own control, set so that the run's moment is outside them; a purchase window opened inside the hours, then the hours ended, with Purser's clock injected; the card sync freezing the card at Airwallex; a charge on the frozen card.",
  note: `A fresh ledger of its own (no card drill card adopted: a new card was issued, nickname suffix \`governance-1126\`). The hours are \`Mon-Fri 18:00-20:00 Europe/Amsterdam\`; the run ran at 12:27 in Amsterdam, outside them. For \`hours.thaw_inside\` Purser's clock was set to 26 Nov 19:59:30 Amsterdam (18:59:30 UTC) and for \`hours.end_sync\` and \`hours.no_window_after\` to 20:00:30 (19:00:30 UTC); every Airwallex call happened at the run's real time (the table's times). ${PREP}`,
  simulated: [
    PASSKEY,
    "The CFO's phone is played by the run: the hours are set with the phone's own path (a signed policy change, processPolicyRequest; setting hours is a tightening, which the phone may sign). " + RUNNER,
    "Purser's clock is injected for the end of the hours (as test/card-governance.test.ts does): Purser judged the window and the hours at 19:59:30 and 20:00:30 Amsterdam, while the thaw, the authorisation, the freeze and the read-backs reached Airwallex at 11:27 UTC. Nothing waited for real hours.",
    "Every merchant charge is the sandbox's simulation endpoint (`POST /simulation/issuing/create`); the approve or decline is Airwallex's own.",
  ],
  shows: [
    "Airwallex holds the card with `metadata` `agent_id` and `policy_version` as Purser wrote them at issue, and its authorization controls (merchant category 5734, EUR only, EUR 30.00 per purchase and EUR 100.00 a month, an end date 90 days after issue) as the CFO policy says.",
    "Outside the card's hours a purchase Purser would start is refused before any Airwallex call, audited (`card.purchase_refused`), and no purchase window opens.",
    "Purser's thaw for one purchase writes the agent, the task and the policy version into the card's metadata at Airwallex, and Airwallex approved the purchase's authorisation on the thawed card.",
    "When the hours end with a purchase window still open, the card sync closes the window and freezes the card at Airwallex: `card_status` INACTIVE read back; a charge on it is declined `CARD_INACTIVE` by Airwallex.",
  ],
  keySteps: ["card.issue", "card.readback", "hours.refused_now", "hours.thaw_inside", "hours.purchase_auth", "hours.end_sync", "hours.charge_frozen"],
  notShown: [
    "Airwallex still has no recurring time window: the hours are Purser's control. Airwallex declines on the card's status, limits, merchant categories and currencies; inside a window Purser opened, a second charge within those is approved (the card drill's finding of 20 Nov stands).",
    "Real time passing: the end of the hours is Purser's injected clock, not a wait until 20:00; the runner's every-few-seconds loop did not run (the sync was called once).",
    "The authorisation approved inside the window was not written to this run's ledger: the window was opened under the injected clock and Airwallex dates the authorisation at the real time, so the ledger's window match would not have applied. Its answer is in the step's facts and the call table.",
    "Whether Airwallex copies a card's metadata onto its transactions: not looked at (Purser ties each transaction to agent, task and policy in its own ledger).",
    "A person's Face ID on a real phone; Purser Cloud's screens. One run: the times are single measurements.",
  ],
};

const STOP_RAIL: Omit<GovRecordMeta, "summary"> = {
  title: "Emergency stop at the rail, live",
  intro: "The CFO's emergency stop at the rail (src/policy/emergencyStop.ts `railStop`, asked by src/airwallex/routedRail.ts immediately before every create), with signed supplier payouts on the Airwallex sandbox: the stop landing at the rail after the executor's own last check; the executor and the routed rail refusing with the stop on; Airwallex read back by request_id; the stop lifted with the passkey and the same payment then paid.",
  note: `A fresh ledger of its own, on the platform account's own balance (no x-on-behalf-of). Both payouts go to the beneficiary Bergtex Textil GmbH already on file at Airwallex (none created). The routed rail is Purser Cloud's \`RoutedRail\` with the Airwallex sandbox adapter as its Airwallex bank, an in-memory stand-in as its simulated bank (never used: every action ran \`within("airwallex")\`), a permissive cap guard, and \`railStop\` on this ledger. ${PREP}`,
  simulated: [
    PASSKEY,
    "The CFO's phone is played by the run: the stop is signed with the phone's own path (processPolicyRequest). The lift is a proposal on the runner approved with the passkey (the phone may not lift it). " + RUNNER,
    "In `stop.lands_at_rail` the run chooses the moment the signed stop is applied: inside the rail's last ask before the transfer create, after the executor's own check let the payment through. The stop itself is the CFO's signed change, applied by executePolicyChange.",
    "The settlement of the paid payout (SENT, then PAID) is the sandbox's simulation endpoint (`POST /simulation/transfers/{id}/transition`).",
  ],
  shows: [
    "With a signed stop landing at the rail after the executor's last check, nothing reached Airwallex: no POST was sent, the payout row was closed CANCELLED (`held_by_purser`), the payment FAILED, and the refusal is audited `transfer.held_before_create` with `checked: rail`.",
    "With the stop on, the executor refuses a signed payment when its execution begins (no POST; one balance read), and the routed rail asked directly refuses the same request_id with no call at all.",
    "Airwallex holds no transfer under either request_id while the stop is on.",
    "Lifted with the passkey, the same signed payment (its own request_id) is created at Airwallex and followed to PAID; the payout held at the rail is not sent again under its request_id.",
  ],
  keySteps: ["stop.lands_at_rail", "blocked.executor", "blocked.rail", "readback.none", "lift.passkey", "paid.payout1", "readback.paid", "after.payout2"],
  notShown: [
    "Purser Cloud's own engine and its routes: the rail, the stop and the executor are Purser's code, wired by the run as Cloud wires them (cloud/src/engine/awxWire.ts), not a request to a running Cloud.",
    "The `after.payout2` refusal reads \"was refused by Airwallex and closed\": the payout was held by Purser at the rail, not refused by Airwallex. The outcome (nothing sent again under that request_id) is right; the words are the executor's general ones for a closed row (src/executors/invoicePayment.ts submitTransfer).",
    "A conversion held at the rail: both payouts were in euros from euros, so no conversion was asked for.",
    "A person's Face ID on a real phone. One run: the times are single measurements.",
  ],
};

const ENTITIES: Omit<GovRecordMeta, "summary"> = {
  title: "Entities and their funding accounts, live",
  intro: "Two legal entities, each with its own Airwallex account: entity A is the sandbox's connected account `acct_SC-QD89fOneAeqaRFgOymw` (ACTIVE since 10 Nov, docs/runs/2026-11-10-connected-accounts-sandbox.md), entity B the platform account `acct_op0_QItiOyWKsYb5pwQihA`, the API key's own. A payment from entity A's own account, paid; payments set to fund from entity B's account refused before any create.",
  note: `Both funding accounts were usable: A's EUR balance was 54.06 before the run (read in a probe), B's the platform's. The payee is the test beneficiary already on file at A (\`f8678483-2718-4393-a328-d78261b5d5a4\`, "Zeeland Verpakkingen BV (test)", made on 10 Nov); the run created no beneficiary. Airwallex's record of it holds no SWIFT code, so the run put ABN AMRO's BIC (ABNANL2A, its bank's) on Purser's allowlist row and in the test invoice. **Two earlier attempts stopped at \`pay.plan_a\`** (11:28:24 and 11:29:01 UTC, 2 read-only calls each: login and GET /beneficiaries at A): the run's own invoice text had an empty BIC line, so Purser's invoice check read the next line as the BIC and refused the payment as possible fraud (nothing planned, nothing sent); the second attempt ran before the fix was saved. The fix was to the run's invoice text, not to Purser's code. ${PREP}`,
  simulated: [
    PASSKEY,
    "Opening entity A to the treasury agent (`pay_from.nl-test-sole.treasury` allowed) is a proposal on the runner approved with the passkey. " + RUNNER,
    "The invoices are test documents written by the run; the entities' names are labels for the two sandbox accounts.",
    "The settlement of the paid payout (SENT, then PAID) is the sandbox's simulation endpoint, called with x-on-behalf-of A.",
  ],
  shows: [
    "A payment from entity A carries `paying_entity` and `funding_account` (A's own account) in the terms the passkey signed, and is paid from A's own account (x-on-behalf-of A): created, PAID, read back PAID at A, and not found under its request_id at B.",
    "A payment for entity A on a rail acting for B's account is refused `funding_account_mismatch` before any Airwallex call; a payment from entity B, which the CFO has not opened to the agent, is refused `entity_not_permitted` before any call; terms naming A funded from B's account are refused by the same check.",
    "A's signed payment executed on the client's default account (B's own) is refused before any create (no POST; one balance read at B), and Airwallex holds no transfer under its request_id at A or B.",
  ],
  keySteps: ["pay.plan_a", "pay.exec_a", "readback.a", "refuse.plan_rail_b", "refuse.plan_entity_b", "refuse.terms_b", "refuse.exec_rail_b", "readback.none"],
  notShown: [
    "A payment from entity B's own account: B was left closed to the agent on purpose; only refusals ran against B.",
    "Several real legal entities: A is a connected account of the platform B, so the two are not independent companies; Purser's check is the same either way (the account the terms name and the account the rail acts for).",
    "The executor refusal on B's account is Purser's `checkPayingAccount` (the terms were signed for A's account, the rail acts for the client's own account). Purser does not know that the default account is B's; the refusal does not depend on it.",
    "A screen in Purser Cloud to choose the entity: none yet. A person's Face ID on a real phone. One run.",
  ],
};

const REPLACE: Omit<GovRecordMeta, "summary"> = {
  title: "A failed payout replaced once, live",
  intro: "One failed payout replaced once (src/executors/replaceFailed.ts, behind `KIT11_REPLACE_FAILED_PAYOUT=on`): a signed supplier payout created on the Airwallex sandbox, made to fail after it was sent with the sandbox's simulation, read back final-failed at Airwallex, replaced once through the runner's hook under the request_id derived from the first, and asked again.",
  note: `A fresh ledger of its own, on the platform account's own balance. The payee is Bergtex Textil GmbH, already on file at Airwallex. ${PREP}`,
  simulated: [
    PASSKEY,
    "The failure is the sandbox's simulation endpoint: SENT, then FAILED (never PAID); Airwallex chose the failure type. The replacement's settlement (SENT, PAID) is the same endpoint, called by the run.",
    "The runner's follow-up loop is not running: the run calls its hook (`replaceFailedHook`, the one src/payouts/follow.ts uses) once with the flag unset and once with it on.",
  ],
  shows: [
    "Airwallex moved the first transfer from SENT to FAILED and read it back CANCELLED with a failure type; with `KIT11_REPLACE_FAILED_PAYOUT` unset the runner has no replacement hook; switched on, it sent exactly one replacement (one `POST /transfers/create`) under the request_id derived from the first, for the same EUR 1.02, which the sandbox then settled to PAID.",
    "Asked again, nothing is sent: the hook answers \"asked before\" with no call, and replaceFailedPayout called directly finds the replacement (`already_replaced`) with one read and no POST. Airwallex holds one transfer under each request_id: the first CANCELLED, the replacement PAID.",
  ],
  keySteps: ["pay.create", "fail.simulated", "fail.readback", "replace.off", "replace.once", "replace.settle", "replace.again", "readback.both"],
  notShown: [
    "A replacement that fails too (Purser then stops for a person): not run live.",
    "A payout paid and then returned (no replacement by code): the 17 Nov late-failure run shows such a return; this run's payout never reached PAID.",
    "A real bank's rejection: the failure is the sandbox's simulation. One run.",
  ],
};

const meta = (m: Omit<GovRecordMeta, "summary">): GovRecordMeta => ({ ...m, summary: summaryOf(m) });
export const GOV_RECORD: Record<GovRun, GovRecordMeta> = { "card-hours": meta(CARD_HOURS), "stop-rail": meta(STOP_RAIL), entities: meta(ENTITIES), "replace-failed": meta(REPLACE) };
