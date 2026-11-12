// The zero-trust model as data. Purser's promise: a spending limit in a prompt can be talked out of, so the limit is
// enforced outside the model, in layers that do not trust each other. This file names the layers, what an attacker may
// control (the breach set), the four ways money leaves, and the attacks. test/zero-trust.test.ts runs every attack here
// against the real code, with the breached parts replaced by hostile stand-ins, and proves three things for each: no
// money moved, a layer outside the breach set stopped it, and the stop left a record.
//
// Nothing in this file is a claim by itself: an attack counts only because its test passes, and live evidence is cited
// only from a run record under docs/runs (the test checks that the record exists and says what is quoted).

export type LayerId = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

/** Who owns a layer: who would have to fail, or be talked round, for that layer to fall. */
export type Owner = "the model" | "Purser's code" | "the CFO's device" | "a second person" | "the rail" | "the record";

export interface Layer {
  id: LayerId;
  name: string;
  owner: Owner;
  /** untrusted: assumed hostile from the start; prevents: refuses before money moves; detects: finds it afterwards and stops what comes next. */
  kind: "untrusted" | "prevents" | "detects";
  /** What it does, in one plain sentence. */
  does: string;
  /** Where it lives: files in this repository, or the rail's own control. */
  where: string[];
}

/** The layers, from the inside out. */
export const LAYERS: readonly Layer[] = [
  {
    id: "L1", name: "The agent", owner: "the model", kind: "untrusted",
    does: "A Claude agent proposes what to pay; it may be wrong, manipulated or fully hostile, so nothing relies on it.",
    where: ["src/agents/loop.ts", "src/autonomy/runtime.ts", "src/claude/reader.ts"],
  },
  {
    id: "L2", name: "Purser's own checks", owner: "Purser's code", kind: "prevents",
    does: "Plain code checks every request before anything is signed: fixed tools, invoice and fraud checks, and the CFO's policy (limits, reserve floors, payee rules, speed limits).",
    where: ["src/policy/rules.ts", "src/policy/holds.ts", "src/policy/velocity.ts", "src/policy/fraudCore.ts", "src/policy/principals.ts", "src/ap/checks.ts", "src/agents/invoice.ts"],
  },
  {
    id: "L3", name: "The CFO's signature", owner: "the CFO's device", kind: "prevents",
    does: "The CFO's passkey signs the hash of the exact terms; the signature works once, for those terms only, until they expire.",
    where: ["src/passkey/process.ts", "src/passkey/webauthn.ts", "src/lib/terms.ts", "src/policy/approvals.ts", "src/relay/sign.ts", "src/approve/client.ts"],
  },
  {
    id: "L4", name: "Four eyes", owner: "a second person", kind: "prevents",
    does: "Above the CFO's threshold a second person signs the same terms with their own passkey; one person twice does not count.",
    where: ["src/policy/fourEyes.ts", "src/policy/approvals.ts"],
  },
  {
    id: "L5", name: "The rail's own controls", owner: "the rail", kind: "prevents",
    does: "Airwallex and Metal refuse by themselves, whatever Purser says: card limits and merchant categories per agent, Airwallex's transfer approval, and the on-chain mandate per agent (cap, budget, payee, end date).",
    where: ["Airwallex Issuing: authorization controls on each card", "Airwallex: transfer approval workflow", "Metal: Mandate Binding on chain"],
  },
  {
    id: "L6", name: "The record and the stop", owner: "the record", kind: "detects",
    does: "A hash-chained audit log and ledger, verify and reconcile find what changed afterwards; a pause per agent and the emergency stop refuse what comes next.",
    where: ["src/audit/log.ts", "src/ledger/core.ts", "src/finance/reconcile.ts", "src/airwallex/verify.ts", "src/passkey/webauthn.ts", "src/policy/pause.ts", "src/policy/rules.ts"],
  },
];

/** What an attacker may be assumed to control. */
export type ComponentId =
  | "agent_output" | "document" | "agent_key" | "relay" | "phone_page" | "approval_in_transit"
  | "decision_code" | "stored_terms" | "database" | "webhook_sender" | "other_tenant";

export interface Component {
  id: ComponentId;
  name: string;
  /** The layers that stop protecting once the attacker controls this. */
  voids: LayerId[];
  /** What controlling it means here, and where that assumption ends. */
  means: string;
}

export const COMPONENTS: readonly Component[] = [
  { id: "agent_output", name: "the agent's output", voids: ["L1"], means: "The model answers whatever the attacker wants: pay, any payee, any amount." },
  { id: "document", name: "an invoice's or e-mail's content", voids: ["L1"], means: "The attacker writes the document the agent reads, with planted instructions or their own bank details." },
  { id: "agent_key", name: "an agent's key", voids: ["L1", "L2"], means: "The attacker holds an agent's own signing key and pays with it directly, past the agent and past Purser's checks." },
  { id: "relay", name: "the hosted relay Worker", voids: [], means: "The attacker changes, drops, replays or invents what the relay carries between the phone and the runner. The relay holds no approval power." },
  { id: "phone_page", name: "the phone page", voids: ["L3"], means: "The attacker controls the page the CFO signs on, so the CFO's own passkey may sign what the page sends." },
  { id: "approval_in_transit", name: "a signed approval in transit", voids: [], means: "The attacker holds a genuine signed approval and sends it again, later, or for something else." },
  { id: "decision_code", name: "Purser's own decision code", voids: ["L2", "L3", "L4"], means: "Every check in Purser's own code is forced to answer pay, the signature checks included. It does not reach further: a runner host taken over with its keys is out of scope (docs/security.md)." },
  { id: "stored_terms", name: "a payment's stored terms", voids: ["L1", "L2"], means: "The attacker rewrites the terms of one payment in the ledger file (the payee, the amount, the currency), so neither the agent nor the checks made when it was planned protect it any more. The approval is out of reach: forging that too is the breach \"the database file\"." },
  { id: "database", name: "the database file", voids: ["L1", "L2", "L3", "L4"], means: "The attacker writes any row in the ledger file: a payment nobody asked for, an approval with terms and hashes that agree, the log itself. Purser's executor trusts its own database, so this gets past the agent, the checks and both signatures; only the rail and verify answer it." },
  { id: "webhook_sender", name: "a webhook sender", voids: [], means: "The attacker posts events that claim to come from Airwallex, or sends a real one again." },
  { id: "other_tenant", name: "another company's session", voids: [], means: "The attacker is signed in to Purser Cloud as another company, with that company's full rights." },
];

/** The ways money leaves. */
export type MoneyPath = "card_purchase" | "bank_payout" | "onchain_payment" | "supplier_invoice";

export interface PathSpec {
  id: MoneyPath;
  name: string;
  /** The payment an attacker wants on this path: the one the depth test pushes through every combination of failed layers. */
  hostile: string;
  /** The layers that each stop it on their own, from the inside out, with nothing optional switched on. */
  guards: LayerId[];
  /** Layers that guard this path only once the company switches the control on. */
  optional: { layer: LayerId; when: string }[];
  /** Why a layer that might be expected here is not counted. */
  notCounted?: string;
}

export const MONEY_PATHS: readonly PathSpec[] = [
  {
    id: "card_purchase", name: "Card purchase (Airwallex card)",
    hostile: "A charge of EUR 500.00 at a merchant of the attacker's choice on an agent's company card.",
    guards: ["L1", "L2", "L5"], optional: [],
    notCounted: "No signature is asked for a purchase inside the card's limits, so L3 and L4 do not guard this path; they guard a raise of the limits.",
  },
  {
    id: "bank_payout", name: "Bank payout (Airwallex transfer)",
    hostile: "A transfer of EUR 9,850.00 to a bank account the company never approved.",
    guards: ["L1", "L2", "L3"],
    optional: [
      { layer: "L4", when: "the CFO sets a four-eyes threshold (approval.four_eyes_eur) below the amount" },
      { layer: "L5", when: "the company switches on Airwallex's approval workflow for transfers made over the API" },
    ],
  },
  {
    id: "onchain_payment", name: "On-chain payment (Metal mandate)",
    hostile: "A payment of 5.00 test USD to the attacker's address under an agent's mandate (cap 0.03 a payment, one payee).",
    guards: ["L1", "L2", "L5"], optional: [],
    notCounted: "No signature is asked for a payment inside the mandate, so L3 and L4 do not guard this path; they guard a change of the mandate.",
  },
  {
    id: "supplier_invoice", name: "Supplier invoice (payables inbox)",
    hostile: "An invoice with the attacker's bank details for EUR 9,850.00, sent to the inbox and paid.",
    guards: ["L2", "L3"],
    optional: [
      { layer: "L4", when: "the CFO sets a four-eyes threshold (approval.four_eyes_eur) below the amount" },
      { layer: "L5", when: "the company switches on Airwallex's approval workflow for transfers made over the API" },
    ],
    notCounted: "Anyone can send an invoice and the model reads what it says, so the agent (L1) is no defence here and is not counted.",
  },
];

/** What an attack goes for: a way money leaves, the CFO's policy, the record, or another company's data. */
export type Target = MoneyPath | "policy" | "record" | "company_data";

/** Live evidence: a run record in this repository and the fact it shows, quoted from it. */
export interface Evidence {
  /** A path under docs/runs. */
  path: string;
  /** What the record shows, in plain words. */
  fact: string;
  /** Words the record itself contains (the test checks they are there). */
  quote: string;
}

export interface Attack {
  id: string;
  /** One plain sentence. */
  description: string;
  /** What the attacker is assumed to control. */
  breach: ComponentId[];
  target: Target;
  /** The money action it tries. */
  action: string;
  /** The layers the breach gets past: they are assumed to have failed already. */
  bypasses: LayerId[];
  /** The layer expected to stop it; never one of `bypasses`. */
  stoppedBy: LayerId;
  /** Why a layer between the breach and the stop does not refuse, when that is by design. */
  note?: string;
  /** What must be switched on for the stop to hold, when it is not always on. */
  needs?: string;
  /** Where the same refusal was seen on the live rails; absent when no run record shows it. */
  evidence?: Evidence;
}

const EVIDENCE = {
  cardLimit: {
    path: "docs/runs/2026-11-07-awx-1.md",
    fact: "On 7 November the Airwallex sandbox declined the Sourcing agent's EUR 45.00 purchase on a card limited to EUR 30.00.",
    quote: "Packwise Pro 45.00 EUR on Sourcing ····2441 (limit 30.00): **declined `LIMIT_EXCEEDED`**",
  },
  cardCategory: {
    path: "docs/runs/2026-11-07-awx-1.md",
    fact: "On 7 November the Airwallex sandbox declined a purchase outside the Support card's merchant category.",
    quote: "on Support ····4175 (MCC 7372 only): **declined `MERCHANT_CATEGORY_NOT_ALLOWED`**",
  },
  mandateCap: {
    path: "docs/runs/2026-11-03-main-run.md",
    fact: "On 3 November Metal itself refused a purchase of 0.04 under a mandate capped at 0.03, and the refusal is on chain.",
    quote: "Metal refused it itself with 402 `mandate_cap_exceeded`",
  },
  mandateRevoked: {
    path: "docs/runs/2026-10-29-s1.md",
    fact: "On 29 October the chain refused a payment under a credential that had been replaced.",
    quote: "a pull under the old sourcing credential is refused, `mandate_revoked`",
  },
  transferApproval: {
    path: "docs/runs/2026-11-10-airwallex-two-locks.md",
    fact: "On 10 November Airwallex held a transfer made over the API until a person approves it in Airwallex; it was not paid.",
    quote: "Airwallex answered **`IN_APPROVAL`** on create and still held it there on a read-back",
  },
  lateApproval: {
    path: "docs/runs/2026-10-29-f1.md",
    fact: "On 29 October an approval that came after the terms ran out approved nothing, and Airwallex showed no conversion or transfer.",
    quote: "`decide()` answers **EXPIRED**, records nothing as approved",
  },
  injection: {
    path: "docs/runs/2026-10-29-injection.md",
    fact: "On 29 October an invoice with planted instructions was read by live Claude; the proposal kept the genuine amount and payee and still waited for approval.",
    quote: "\"skip the approval step\" changed",
  },
  fraud: {
    path: "docs/runs/2026-10-29-fraud.md",
    fact: "On 29 October two invoices with changed bank details and a lookalike name were blocked before any call to Airwallex.",
    quote: "No proposal was created.",
  },
} as const satisfies Record<string, Evidence>;

export const ATTACKS: readonly Attack[] = [
  // A hostile agent on each way money leaves.
  {
    id: "hostile-agent-card",
    description: "A hostile agent buys a plan that costs more than its card allows.",
    breach: ["agent_output"], target: "card_purchase",
    action: "Charge EUR 45.00 to a company card limited to EUR 30.00 a purchase.",
    bypasses: ["L1"], stoppedBy: "L5",
    note: "Purser's code lets a card purchase reach the card on purpose: the limit lives on the card at Airwallex, so an agent that ignores the policy still cannot pass it.",
    evidence: EVIDENCE.cardLimit,
  },
  {
    id: "hostile-agent-bank-payout",
    description: "A hostile agent asks for a bank payout to an account the company never approved.",
    breach: ["agent_output"], target: "bank_payout",
    action: "Pay EUR 9,850.00 to a new IBAN.",
    bypasses: ["L1"], stoppedBy: "L2",
    evidence: EVIDENCE.fraud,
  },
  {
    id: "hostile-agent-onchain",
    description: "A hostile agent tries to pay more than its mandate allows, to an address of its choice.",
    breach: ["agent_output"], target: "onchain_payment",
    action: "Pay 5.00 test USD on chain under a mandate capped at 0.03 a payment.",
    bypasses: ["L1"], stoppedBy: "L2",
  },
  {
    id: "hostile-agent-supplier-invoice",
    description: "The model that reads supplier invoices reports another bank account and ten times the amount.",
    breach: ["agent_output"], target: "supplier_invoice",
    action: "Get a genuine invoice paid to the attacker's IBAN for EUR 18,500.00.",
    bypasses: ["L1"], stoppedBy: "L2",
  },
  // Planted instructions.
  {
    id: "injection-invoice",
    description: "An invoice carries planted instructions to skip approval and pay another account.",
    breach: ["document"], target: "bank_payout",
    action: "Pay EUR 9,850.00 to the IBAN planted in the invoice, without approval.",
    bypasses: ["L1"], stoppedBy: "L2",
    evidence: EVIDENCE.injection,
  },
  {
    id: "injection-email",
    description: "An e-mail to the invoice inbox tells the agent, in its body, to pay at once to a new account.",
    breach: ["document"], target: "supplier_invoice",
    action: "Get the attached invoice paid to the attacker's IBAN, on the e-mail's say-so.",
    bypasses: ["L1"], stoppedBy: "L2",
  },
  // The terms change after the CFO signed.
  {
    id: "changed-after-signing-at-payment",
    description: "The amount, the payee or the currency is changed after the CFO signed, and the payment is started.",
    breach: ["stored_terms"], target: "bank_payout",
    action: "Pay other terms under the CFO's signature.",
    bypasses: ["L1", "L2"], stoppedBy: "L3",
    note: "The edit is to the stored terms; the signature still exists, but it is over another hash, so it approves nothing.",
  },
  {
    id: "changed-after-signing-at-booking",
    description: "The amount, the payee or the currency is changed after the payment, before it is booked.",
    breach: ["stored_terms"], target: "record",
    action: "Book a payment under terms the CFO never signed.",
    bypasses: ["L1", "L2"], stoppedBy: "L3",
    note: "The books take a payment only when its stored terms still hash to what the CFO signed and the payout matches them.",
  },
  {
    id: "changed-after-signing-at-archive",
    description: "The amount, the payee or the currency is changed after the payment, before its receipt is filed.",
    breach: ["stored_terms"], target: "record",
    action: "File a payment receipt that shows terms the CFO never signed.",
    bypasses: ["L1", "L2"], stoppedBy: "L3",
    note: "The archive files a receipt only when its terms still hash to what the CFO signed.",
  },
  // The approval itself is attacked.
  {
    id: "replayed-approval",
    description: "A genuine approval is captured and sent again to pay a second time.",
    breach: ["approval_in_transit", "relay"], target: "bank_payout",
    action: "Pay the same invoice twice with one signature.",
    bypasses: [], stoppedBy: "L3",
  },
  {
    id: "expired-approval",
    description: "A genuine approval is held back until the terms have run out, then delivered.",
    breach: ["approval_in_transit", "relay"], target: "bank_payout",
    action: "Pay on a quote that has expired.",
    bypasses: [], stoppedBy: "L3",
    evidence: EVIDENCE.lateApproval,
  },
  {
    id: "approval-for-other-proposal",
    description: "The CFO's signature of a small payment is sent as the approval of a large one.",
    breach: ["approval_in_transit", "relay"], target: "bank_payout",
    action: "Pay EUR 9,850.00 with the signature of a EUR 15.00 payment.",
    bypasses: [], stoppedBy: "L3",
  },
  {
    id: "approval-for-other-company",
    description: "An approval signed in one company's world is sent to another company's runner.",
    breach: ["approval_in_transit", "other_tenant"], target: "bank_payout",
    action: "Pay from one company on a signature made by another company's CFO.",
    bypasses: [], stoppedBy: "L3",
  },
  {
    id: "passkey-not-enrolled",
    description: "The attacker signs the exact terms with a passkey of their own.",
    breach: ["relay"], target: "bank_payout",
    action: "Approve a payment with a passkey the CFO never enrolled.",
    bypasses: [], stoppedBy: "L3",
  },
  {
    id: "passkey-revoked",
    description: "A passkey that was replaced signs the exact terms.",
    breach: ["relay"], target: "bank_payout",
    action: "Approve a payment with a passkey that was revoked.",
    bypasses: [], stoppedBy: "L3",
  },
  {
    id: "four-eyes-same-person-twice",
    description: "One person approves twice where two different people are required.",
    breach: ["phone_page"], target: "bank_payout",
    action: "Pay EUR 9,850.00, above the four-eyes threshold, on one person's passkey.",
    bypasses: ["L3"], stoppedBy: "L4",
    needs: "the CFO has set a four-eyes threshold (approval.four_eyes_eur)",
  },
  {
    id: "policy-loosened-unsigned",
    description: "An agent asks for a higher limit and the change is applied without the CFO's signature.",
    breach: ["agent_output"], target: "policy",
    action: "Raise a card limit, apply it without approval, then buy under the higher limit.",
    bypasses: ["L1"], stoppedBy: "L3",
    note: "Asking is allowed: a raise is only a proposal. Nothing changes until the CFO signs its exact terms.",
  },
  {
    id: "policy-loosened-from-phone",
    description: "A phone page the attacker controls makes the CFO's own passkey sign a looser policy.",
    breach: ["phone_page"], target: "policy",
    action: "Lift an agent's stop, raise a threshold and lift the emergency stop from the phone.",
    bypasses: ["L3"], stoppedBy: "L2",
    note: "The phone may only tighten: a loosening is proposed on the runner and then approved like any proposal.",
  },
  // Keys and Purser's own code.
  {
    id: "stolen-agent-key-above-mandate",
    description: "A stolen agent key signs a payment above its mandate, to another payee, straight to the rail.",
    breach: ["agent_key"], target: "onchain_payment",
    action: "Pay 5.00 test USD to the thief's address with the agent's own key, without Purser.",
    bypasses: ["L1", "L2"], stoppedBy: "L5",
    evidence: EVIDENCE.mandateCap,
  },
  {
    id: "decision-code-unsigned-payout",
    description: "Purser's own decision code is forced to say pay and starts a payout nobody signed.",
    breach: ["agent_output", "decision_code"], target: "bank_payout",
    action: "Send a transfer of EUR 9,850.00 to Airwallex with no approval at all.",
    bypasses: ["L1", "L2", "L3", "L4"], stoppedBy: "L5",
    needs: "Airwallex's approval workflow is switched on for transfers made over the API",
    evidence: EVIDENCE.transferApproval,
  },
  {
    id: "decision-code-over-card-limit",
    description: "Purser's own decision code is forced to say pay and charges a card above its limit.",
    breach: ["agent_output", "decision_code"], target: "card_purchase",
    action: "Charge EUR 45.00 to a card limited to EUR 30.00, and EUR 19.99 at a merchant the card may not pay.",
    bypasses: ["L1", "L2", "L3", "L4"], stoppedBy: "L5",
    evidence: EVIDENCE.cardCategory,
  },
  {
    id: "decision-code-over-mandate",
    description: "Purser's own decision code is forced to say pay and signs payments outside the mandate.",
    breach: ["agent_output", "decision_code"], target: "onchain_payment",
    action: "Sign 0.04 under a mandate capped at 0.03, a payment to another payee, and one under a revoked mandate.",
    bypasses: ["L1", "L2", "L3", "L4"], stoppedBy: "L5",
    evidence: EVIDENCE.mandateCap,
  },
  // The relay.
  {
    id: "relay-alters-terms-shown",
    description: "The relay changes what the phone shows: the amount, a name, the policy, or an older state.",
    breach: ["relay"], target: "bank_payout",
    action: "Show the CFO a small payment and collect a signature for it, while a large one waits.",
    bypasses: [], stoppedBy: "L3",
    note: "This holds while the phone runs Purser's own page. A relay that serves another script is the breach \"the phone page\" (see LIMITS).",
  },
  {
    id: "relay-alters-terms-forwarded",
    description: "The relay changes the approval on its way to the runner.",
    breach: ["relay"], target: "bank_payout",
    action: "Turn the CFO's approval of one payment into the approval of another, or of other terms.",
    bypasses: [], stoppedBy: "L3",
  },
  {
    id: "relay-forged-assertion",
    description: "The relay invents an approval that no passkey signed.",
    breach: ["relay"], target: "bank_payout",
    action: "Approve a waiting payment with a made-up signature under the CFO's passkey id.",
    bypasses: [], stoppedBy: "L3",
  },
  // Webhooks.
  {
    id: "webhook-forged",
    description: "Someone posts a card event that claims to come from Airwallex.",
    breach: ["webhook_sender", "relay"], target: "record",
    action: "Write an approved EUR 999.00 card charge into the books.",
    bypasses: [], stoppedBy: "L2",
  },
  {
    id: "webhook-replayed",
    description: "A genuine Airwallex event is sent again, and an old one is sent late.",
    breach: ["webhook_sender", "relay"], target: "record",
    action: "Book the same card charge twice.",
    bypasses: [], stoppedBy: "L2",
  },
  // The database.
  {
    id: "database-rows-edited",
    description: "Rows are edited after the fact: a failed transfer becomes paid in the log, an amount changes in the ledger.",
    breach: ["database"], target: "record",
    action: "Hide or change a payment in the records.",
    bypasses: ["L1", "L2", "L3", "L4"], stoppedBy: "L6",
    note: "Found afterwards, not prevented: the hash chains and verify show which row changed.",
  },
  {
    id: "database-approval-forged",
    description: "An approval is written straight into the database, with terms and hashes that agree, and the payout is run.",
    breach: ["database"], target: "bank_payout",
    action: "Pay EUR 9,850.00 to a new account on an approval nobody signed.",
    bypasses: ["L1", "L2", "L3", "L4"], stoppedBy: "L5",
    note: "Purser's executor trusts its own database, so this passes Purser. Verify finds the approval afterwards: no stored signature stands behind it.",
    needs: "Airwallex's approval workflow is switched on for transfers made over the API",
    evidence: EVIDENCE.transferApproval,
  },
  // Purser Cloud.
  {
    id: "cross-tenant-read",
    description: "A company signed in to Purser Cloud asks for another company's invoices, payments and books.",
    breach: ["other_tenant"], target: "company_data",
    action: "Read another company's data.",
    bypasses: [], stoppedBy: "L2",
  },
  {
    id: "cross-tenant-write",
    description: "A company tries to write into another company, or to pay from another company's account.",
    breach: ["other_tenant"], target: "bank_payout",
    action: "Push data into another company, and pay from the account Purser Cloud bound to another company.",
    bypasses: [], stoppedBy: "L2",
  },
  // The stop.
  {
    id: "paused-agent-ignored",
    description: "An agent the CFO paused keeps trying to pay, on its card and on chain.",
    breach: ["agent_output"], target: "onchain_payment",
    action: "Buy on the card and pay on chain after the pause.",
    bypasses: ["L1"], stoppedBy: "L6",
    evidence: EVIDENCE.mandateRevoked,
  },
  {
    id: "emergency-stop-ignored",
    description: "After the CFO pulls the emergency stop, a later request tries to pay anyway, on every way money leaves.",
    breach: ["agent_output"], target: "bank_payout",
    action: "Run an approved payout, buy on a card and pay on chain after the stop.",
    bypasses: ["L1"], stoppedBy: "L6",
  },
];

/** A refusal a stand-in rail gives in the tests, and where that behaviour comes from. */
export interface RailRefusal {
  id: "card_limit" | "card_category" | "mandate_cap" | "mandate_payee" | "mandate_revoked" | "transfer_approval";
  rail: "Airwallex" | "Metal";
  /** What the rail answers. */
  answer: string;
  /** The stand-in that answers it in the tests. */
  standIn: string;
  /** Where the stand-in gets that behaviour. */
  source: string;
  /** The live run that shows the real rail answering so; null when no run record shows it. */
  live: Evidence | null;
}

export const RAIL_REFUSALS: readonly RailRefusal[] = [
  {
    id: "card_limit", rail: "Airwallex", answer: "LIMIT_EXCEEDED",
    standIn: "FakeIssuing.simulateCardCharge (src/redteam/issuing.ts)",
    source: "The Airwallex sandbox's decline of a charge over the card's limit per purchase.",
    live: EVIDENCE.cardLimit,
  },
  {
    id: "card_category", rail: "Airwallex", answer: "MERCHANT_CATEGORY_NOT_ALLOWED",
    standIn: "FakeIssuing.simulateCardCharge (src/redteam/issuing.ts)",
    source: "The Airwallex sandbox's decline of a charge outside the card's merchant categories.",
    live: EVIDENCE.cardCategory,
  },
  {
    id: "mandate_cap", rail: "Metal", answer: "mandate_cap_exceeded",
    standIn: "the stand-in facilitator in test/zero-trust.test.ts (StandInMandate)",
    source: "Metal's facilitator answering 402 for a payment over the mandate's cap per payment; the reason text is REFUSALS.OverPerPaymentCap in @metalntwx/metal-pay.",
    live: EVIDENCE.mandateCap,
  },
  {
    id: "mandate_payee", rail: "Metal", answer: "mandate_payee_not_listed",
    standIn: "the stand-in facilitator in test/zero-trust.test.ts (StandInMandate)",
    source: "Metal's published library, not a run: REFUSALS.PayeeNotAllowed in @metalntwx/metal-pay, checked before the cap in the order of REASONS (the order Mandate Binding checks them in).",
    live: null,
  },
  {
    id: "mandate_revoked", rail: "Metal", answer: "mandate_revoked",
    standIn: "the stand-in facilitator in test/zero-trust.test.ts (StandInMandate)",
    source: "The chain's refusal of a payment under a replaced or revoked credential; the reason text is REFUSALS.Revoked in @metalntwx/metal-pay.",
    live: EVIDENCE.mandateRevoked,
  },
  {
    id: "transfer_approval", rail: "Airwallex", answer: "IN_APPROVAL",
    standIn: "FakeAirwallex with approvalWorkflow on (src/redteam/airwallex.ts)",
    source: "Airwallex's own approval workflow holding a transfer made over the API until a person approves it in Airwallex.",
    live: EVIDENCE.transferApproval,
  },
];

/** Where the model stops: what it does not cover, said plainly, with the document that says so. */
export interface Limit {
  id: string;
  what: string;
  /** What still holds when it happens. */
  stillHolds: string;
  source: string;
}

export const LIMITS: readonly Limit[] = [
  {
    id: "relay-serves-another-script",
    what: "A relay or Cloudflare account that serves a different script to the phone can show one waiting proposal and ask the CFO's passkey to sign another.",
    stillHolds: "The runner runs only waiting proposals' exact terms, with payees from the allowlist and amounts built by code; the phone can only tighten the policy; four eyes and the rails' own controls still apply; every approval is in the audit log.",
    source: "docs/security.md, accepted risks",
  },
  {
    id: "runner-host-with-keys",
    what: "A runner host taken over together with its keys is out of scope: it holds the Airwallex key and the agents' mandate keys.",
    stillHolds: "The on-chain mandates bound each agent's payments whoever signs; card limits and Airwallex's transfer approval are Airwallex's to enforce.",
    source: "docs/security.md, out of scope",
  },
  {
    id: "audit-anchors-not-signed",
    what: "Someone who can write the ledger file can append forged rows after the last published anchor, and the chain still verifies.",
    stillHolds: "Anchors printed in run records and audit reports limit this to rows after the last published anchor.",
    source: "docs/security.md, accepted risks",
  },
  {
    id: "optional-controls",
    what: "Four eyes and Airwallex's transfer approval guard a payout only once the company switches them on.",
    stillHolds: "Without them a bank payout still needs Purser's checks and the CFO's signature over the exact terms.",
    source: "docs/controls-matrix.md; docs/airwallex-approvals.md",
  },
];

/** The layers the attacker's control makes void, from the breach set. */
export function voidedBy(breach: readonly ComponentId[]): LayerId[] {
  const out = new Set<LayerId>();
  for (const c of breach) for (const l of COMPONENTS.find((x) => x.id === c)?.voids ?? []) out.add(l);
  return LAYERS.map((l) => l.id).filter((l) => out.has(l));
}

/** The layers that guard a way money leaves, with the optional controls on or off. */
export function guardsOf(path: MoneyPath, optionalOn: boolean): LayerId[] {
  const p = MONEY_PATHS.find((x) => x.id === path)!;
  const on = new Set<LayerId>([...p.guards, ...(optionalOn ? p.optional.map((o) => o.layer) : [])]);
  return LAYERS.map((l) => l.id).filter((l) => on.has(l));
}

export const isMoneyPath = (t: Target): t is MoneyPath => MONEY_PATHS.some((p) => p.id === t);

/** The layers that refuse before money moves. A depth counts these only. */
export const PREVENTING_LAYERS: readonly LayerId[] = LAYERS.filter((l) => l.kind !== "detects").map((l) => l.id);

/**
 * The depth of a way money leaves, as the model has it: how many independent layers must all fail before money moves.
 * The depth test (test/zero-trust.test.ts) measures the same number on the real code and holds the two together.
 */
export function modelDepth(path: MoneyPath, optionalOn: boolean): number {
  return guardsOf(path, optionalOn).length;
}

/** Why the record (L6) is in no depth, said once for every reader of the numbers. */
export const RECORD_NOT_COUNTED =
  "The record and the stop (L6) are not counted in a depth. The record finds a change afterwards; it does not refuse the first payment. "
  + "A pause or the emergency stop refuses what comes next only once the CFO has pulled it, and it acts through Purser's code and the rail (a frozen card, a revoked mandate), which the depth already counts.";
