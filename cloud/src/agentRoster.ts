// Every agent Purser has, for the console's Agents page (22 Nov, the owner: "I don't see the negotiation agents and other
// features we have"). One entry per agent in the code, each with the model its code sets, the limit its code holds it to,
// the switch that turns it on in the runner (null: always on) and the files it lives in. The company's own records (GET
// /v1/agents, cloud/src/consoleData.ts) add what it did: its card, what it spent, its status and its newest decisions; an
// agent the records do not name is shown as code only, never with figures. test/cloud-agent-roster.test.ts holds each
// model to its code's constant and each path to a file in this repository.

export interface RosterAgent {
  /** The id the company's records use (actor in the audit chain), or the roster's own for a desk that runs as code. */
  id: string;
  name: string;
  /** The team on the page: who it works for. */
  team: "sourcing" | "payables" | "treasury" | "customers" | "books";
  role: string;
  job: string;
  /** The Claude model its code sets; null when code alone decides. */
  model: string | null;
  /** What the model does and what code keeps for itself. */
  model_note: string;
  /** The limit as its code holds it. */
  limit: string;
  /** The runner's switch that turns it on; null when it always runs. */
  switch: string | null;
  /** The files it lives in, from the repository's root. */
  code: string[];
  /** A page where it can be seen at work, on this site. */
  see?: { href: string; label: string };
}

export const REPO_BLOB = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";

export const ROSTER: readonly RosterAgent[] = [
  {
    id: "sourcing", name: "Sourcing agent", team: "sourcing", role: "Sourcing and negotiation",
    job: "Buys live stock checks from Stockline per query over x402, picks the rail for each purchase and meets a supplier's price rise. It also negotiates early-payment discounts with a supplier's agent.",
    model: "claude-haiku-5-5", model_note: "Haiku proposes; code checks every term, rail and amount before anything is paid",
    limit: "Its mandate on Alta caps each purchase and its budget; its Airwallex card carries the CFO's limits",
    switch: null, code: ["src/agents/sourcing.ts", "src/agents/sourcingAgent.ts", "src/agents/railChoice.ts", "src/negotiate/negotiate.ts", "src/negotiate/rails.ts"],
    see: { href: "/try/negotiate", label: "Watch a negotiation" },
  },
  {
    id: "checker", name: "Checker agent", team: "payables", role: "Payables: the check",
    job: "Decides what happens to each supplier invoice: pay, ask the CFO, hold or reject. Code's own checks can only make that stricter.",
    model: "claude-haiku-5-5", model_note: "Haiku decides with its tools; a finding of code's checks holds the invoice whatever it says",
    limit: "Pays nothing; above the CFO's limits an invoice waits for Face ID",
    switch: "KIT11_AP_AGENTS", code: ["src/ap/checkerAgent.ts", "src/ap/checkerCore.ts"],
  },
  {
    id: "payer", name: "Payer agent", team: "payables", role: "Payables: the payment plan",
    job: "Proposes how and when a checked invoice is paid: the rail, the day and the currency it is paid from.",
    model: "claude-haiku-5-5", model_note: "Haiku proposes on the engine's own plan; code holds what breaks a treasury floor",
    limit: "Never pays alone: the CFO signs the exact terms with Face ID",
    switch: "KIT11_AP_AGENTS", code: ["src/ap/payerAgent.ts", "src/ap/payerCore.ts"],
  },
  {
    id: "treasury", name: "Treasury agent", team: "treasury", role: "Treasury",
    job: "Watches spending, rebalances the agents' mandates after a price rise, sweeps final earnings to Airwallex and pays the EUR licence fee, advising when to pay.",
    model: "claude-opus-5-5", model_note: "Opus designs the plan and the timing; code checks it and its fixed plan takes over on a refusal",
    limit: "Nothing changes on chain or at Airwallex until the CFO approves with Face ID",
    switch: null, code: ["src/agents/treasury.ts", "src/agents/treasuryAgent.ts", "src/agents/timingAgent.ts", "src/agents/sweep.ts"],
  },
  {
    id: "support", name: "Support agent", team: "customers", role: "Customer disputes",
    job: "Settles a customer's dispute: checks each order on chain and each delivered stock check against the supplier's correction, refunds the wrong ones and sends the rest to the CFO with its advice.",
    model: "claude-sonnet-5-5", model_note: "Sonnet reads and advises; code gates every refund and pays only to the customer's own account",
    limit: "Refunds within the CFO's automatic limits; above them the refund waits for Face ID",
    switch: null, code: ["src/agents/supportAgent.ts", "src/agents/disputes.ts", "src/agents/disputeDecision.ts"],
  },
  {
    id: "dispute_desk", name: "Dispute desk", team: "customers", role: "Seller's dispute desk",
    job: "When a customer questions an agent's purchase, decides from what Northwind can prove: the signed order, the payment checked on chain against the mandate, the settlement and the data delivered.",
    model: "claude-opus-5-5", model_note: "Code decides; Opus explains the decision from the evidence",
    limit: "A refund above the CFO's limits waits for Face ID like any other",
    switch: null, code: ["src/seller/desk.ts", "src/seller/disputeDesk.ts", "src/seller/evidence.ts", "examples/metal-dispute-desk/src/index.ts"],
  },
  {
    id: "x402_desk", name: "Data desk over x402", team: "customers", role: "Data seller and buyer",
    job: "Sells one live stock check per x402 payment to other companies' agents, each with a signed order, and buys the same check upstream from Stockline through the Sourcing agent's mandate. A refused upstream purchase means the customer is not charged.",
    model: null, model_note: "Code only: no model decides a sale",
    limit: "A sale counts only when the payment settles; the upstream purchase stays within the Sourcing mandate",
    switch: null, code: ["src/servers/seller.ts", "src/servers/supplier.ts", "src/data/stock.ts"],
  },
  {
    id: "controller", name: "Controller agent", team: "books", role: "Month-end review",
    job: "Reviews the month's supplier invoices in the stored ledger and proposes reversals or VAT adjustments, each computed by code.",
    model: "claude-sonnet-5-5", model_note: "Sonnet proposes with read-only tools; only a person's approval posts anything",
    limit: "USD 0.40 and three minutes a run; posts nothing on its own",
    switch: "KIT11_CONTROLLER_AGENT", code: ["src/agents/controllerAgent.ts", "src/agents/controllerCore.ts"],
  },
  {
    id: "books", name: "Books agent", team: "books", role: "Ask the books",
    job: "Answers the CFO's questions about the books in words, with figures code checks against the ledger lines it cites.",
    model: "claude-sonnet-5-5", model_note: "Sonnet searches with read-only tools; code checks every figure it cites",
    limit: "USD 0.25 and two minutes a question; posts, pays and proposes nothing",
    switch: "KIT11_BOOKS_AGENT", code: ["src/agents/booksAgent.ts", "src/agents/booksCore.ts"],
  },
];
