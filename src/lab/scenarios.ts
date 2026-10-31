// The Scenario Lab (E): the CFO's own test script. Each scenario runs in a fresh throwaway world with stand-ins for
// Airwallex and Metal (src/redteam/world.ts) and checks what the CFO would expect: what should happen, what did, and
// the evidence in the ledger. Nothing here reaches Airwallex, Metal or a phone. The live versions of the same stories
// are the run logs in docs/runs/. `npm run lab` runs them all; CI runs them on every push.

import { readFileSync } from "node:fs";
import { askPurser, bookOnTaskCard } from "../agents/askPurser.js";
import { buyPlan, proposeCardRaise } from "../agents/cardBuyer.js";
import { invoiceAlreadyHandled } from "../agents/euroBill.js";
import { checkInvoice, parseInvoiceFallback } from "../agents/invoice.js";
import { ClaudeReader } from "../claude/reader.js";
import { Tools } from "../claude/tools.js";
import { ALT_SELL_PRICE_CENTS, RAISED_UPSTREAM_PRICE_CENTS, SELL_PRICE_CENTS, TOTAL_BUDGET_CENTS } from "../config/policy.js";
import { executePolicyChange, proposePolicyChange } from "../executors/policyChange.js";
import { reconcile } from "../finance/reconcile.js";
import { processAssertion } from "../passkey/process.js";
import { agentId, executeAgentOnboard, payWithCard, requestCompanyCard } from "../platform/externalAgents.js";
import { syncCards } from "../policy/cards.js";
import { priceRiseOptions } from "../policy/mandates.js";
import { pollQuarantine, setupReceivePolicy } from "../policy/quarantine.js";
import { capRefusal } from "../policy/rules.js";
import { priceRiseTargets } from "../agents/treasury.js";
import { ATTACKS, runAttack } from "../redteam/attacks.js";
import { FakeReceivePolicy } from "../redteam/receivePolicy.js";
import { redTeamWorld, type World } from "../redteam/world.js";
import type { DisputeClaim } from "../seller/disputeDesk.js";
import { openDisputeCase } from "../seller/desk.js";
import { LAB_CUSTOMER, LAB_MANDATE_REF, labChain, labOrder, labRefund, labSale } from "../seller/standIns.js";
import { confirmationChallenge, mandatePasskey, recordMandateConfirmation, registerCustomerPasskey } from "../seller/humanProof.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";

const DESK_OFFLINE = "The chain check and the refund are stand-ins; live with verifyMandatePayment: docs/runs/2026-10-30-dispute-desk.md";
/** A Dispute desk case in the lab world: the stand-in chain, a refund that only records, no model. */
async function deskCase(w: World, claim: DisputeClaim, saleIds: number[], dataWrong: number[] = []) {
  const c = await openDisputeCase(w.db, tools(w), { claim, saleIds, customer: LAB_CUSTOMER }, { verify: labChain, refund: labRefund, dataWrong: new Set(dataWrong), passkey: mandatePasskey(w.db) }, w.now());
  const said = c.decision.per_sale.map((x) => `sale ${x.sale_id}: refund ${(x.refund_cents / 100).toFixed(2)}`).join("; ");
  return { c, said, evidence: [c.case_id, ...rows(w, "dispute.decided")] };
}
/** F2, the Dispute desk: Northwind as the seller settles a questioned agent purchase on its own terms (Metal jury input). */
const DISPUTES: Scenario[] = [
  {
    id: "dispute-never-ordered", title: "Dispute: \"our agent never ordered this\"",
    expected: "Each payment has a valid signed order from the customer's agent, inside the mandate its owner bound: the claim is rejected with that evidence, nothing is refunded.",
    offline: DESK_OFFLINE,
    run: async (w) => {
      const { c, said, evidence } = await deskCase(w, "never_ordered", [labSale(w.db, 5), labSale(w.db, 6)]);
      return { happened: `${c.decision.outcome}; ${said}`, passed: c.decision.outcome === "rejected" && c.refunds.length === 0, evidence };
    },
  },
  {
    id: "dispute-wrong-price", title: "Dispute: \"the price was not what our agent agreed\"",
    expected: "The agent signed for 0.05 but was charged 0.07: the 0.02 difference is refunded at once, within the CFO's limits; a sale charged as signed is not.",
    offline: DESK_OFFLINE,
    run: async (w) => {
      const over = labSale(w.db, 1, { order: labOrder("lab-price", 5), cents: 7 });
      const { c, said, evidence } = await deskCase(w, "wrong_price", [over, labSale(w.db, 2)]);
      return { happened: `${c.decision.outcome} (${c.route}); ${said}`, passed: c.decision.refund_cents === 2 && c.route === "auto", evidence };
    },
  },
  {
    id: "dispute-not-authorised", title: "Dispute: \"our agent was not authorised\"",
    expected: "The payment is inside the mandate the customer's owner bound on chain, and the chain refuses anything outside it; the owner also confirmed that mandate with a passkey (Purser's addition): the claim is rejected with both as evidence.",
    offline: `${DESK_OFFLINE}; the customer's passkey is a software stand-in`,
    run: async (w) => {
      // The customer's owner registered a passkey with Northwind and confirmed the mandate with it (Face ID, user verified).
      const auth = new FakeAuthenticator();
      const origin = "https://summit.example";
      await registerCustomerPasskey(w.db, { label: "Summit Outfitters owner", rpId: "summit.example", origin, challenge: "bGFi" }, auth.register({ challenge: "bGFi", origin, rpId: "summit.example" }));
      await recordMandateConfirmation(w.db, LAB_MANDATE_REF, auth.sign({ challenge: Buffer.from(confirmationChallenge(LAB_MANDATE_REF), "hex").toString("base64url"), origin, rpId: "summit.example", counter: 1 }));
      const { c, said, evidence } = await deskCase(w, "not_authorised", [labSale(w.db, 3)]);
      const h = c.packs[0]!.human;
      return { happened: `${c.decision.outcome}; ${said}; owner bound: ${h.owner_bound ? "yes" : "no"}; passkey confirmation: ${h.passkey?.verified ? `verified (${h.passkey.label})` : "none"}`,
        passed: c.decision.outcome === "rejected" && h.owner_bound && !!h.passkey?.verified, evidence };
    },
  },
  {
    id: "dispute-wrong-data", title: "Dispute: \"the data you delivered was wrong\"",
    expected: "Only the sale the supplier's correction shows was wrong is refunded; the other is not.",
    offline: DESK_OFFLINE,
    run: async (w) => {
      const wrong = labSale(w.db, 7);
      const { c, said, evidence } = await deskCase(w, "wrong_data", [wrong, labSale(w.db, 8)], [wrong]);
      return { happened: `${c.decision.outcome}; ${said}`, passed: c.decision.refund_cents === 5 && c.refunds.map((r) => r.sale_id).join() === String(wrong), evidence };
    },
  },
  {
    id: "dispute-forged-order", title: "Dispute: a forged or reused order",
    expected: "An order that does not verify, and the second payment on a reused order, are refunded: the seller cannot stand behind them. The first use of a good order is not.",
    offline: DESK_OFFLINE,
    run: async (w) => {
      const order = labOrder("lab-reused");
      const first = labSale(w.db, 9, { order });
      const replay = labSale(w.db, 10, { order });
      const forged = labSale(w.db, 11, { forged: true });
      const { c, said, evidence } = await deskCase(w, "forged_order", [first, replay, forged]);
      const refunded = c.decision.per_sale.filter((x) => x.refund_cents > 0).map((x) => x.sale_id).sort((a, b) => a - b).join();
      return { happened: `${c.decision.outcome}; ${said}`, passed: refunded === [replay, forged].sort((a, b) => a - b).join(), evidence };
    },
  },
  {
    id: "dispute-double-charged", title: "Dispute: \"we were charged twice\"",
    expected: "Two charges for the same request: the second is refunded, the first kept.",
    offline: DESK_OFFLINE,
    run: async (w) => {
      const a = labSale(w.db, 12);
      const b = labSale(w.db, 12);
      const { c, said, evidence } = await deskCase(w, "double_charged", [a, b]);
      return { happened: `${c.decision.outcome}; ${said}`, passed: c.decision.per_sale.map((x) => x.refund_cents).join() === "0,5", evidence };
    },
  },
];

export interface ScenarioResult {
  id: string;
  title: string;
  /** What the CFO should see, in plain words. */
  expected: string;
  /** What happened, read from the ledger. */
  happened: string;
  passed: boolean;
  /** Where to look: ids, transaction ids, audit rows. */
  evidence: string[];
  /** What is a stand-in here, and where the live run is. */
  offline: string;
}

export interface Scenario {
  id: string;
  title: string;
  expected: string;
  offline: string;
  run: (w: World) => Promise<{ happened: string; passed: boolean; evidence: string[] }>;
}

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
const n = (w: World, sql: string, ...a: unknown[]) => (w.db.prepare(sql).get(...a) as { n: number }).n;
const tools = (w: World) => new Tools(w.db, new ClaudeReader(w.db, null));
const rows = (w: World, event: string) => (w.db.prepare("SELECT seq FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { seq: number }[]).map((r) => `audit #${r.seq} ${event}`);
/** The CFO approves a policy change with Face ID (the stand-in passkey), and it is applied and synced to the cards. */
async function cfoApprovesPolicy(w: World, changes: { key: string; to: string }[], reason: string): Promise<string> {
  const p = proposePolicyChange(w.db, { changes, reason }, "human", w.now());
  const r = await processAssertion(w.db, w.cfoApproval(p.proposal_id, p.terms_sha256), w.now());
  if (r.status !== "approved") throw new Error(`${p.proposal_id} was not approved: ${r.message}`);
  executePolicyChange(w.db, p.proposal_id, w.now());
  await syncCards(w.db, w.issuing, w.now());
  return p.proposal_id;
}
const viaAttack = (id: string) => async (w: World) => {
  const a = ATTACKS.find((x) => x.id === id);
  if (!a) throw new Error(`no red team attack ${id}`);
  const r = await runAttack(w, a);
  return { happened: `${r.evidence}. Stopped by: ${r.defence}.`, passed: r.blocked, evidence: [`red team attack ${id}`] };
};

export const SCENARIOS: Scenario[] = [
  {
    id: "normal-purchase",
    title: "A purchase inside the limit",
    expected: "The Sourcing agent pays 19.99 EUR for its warehouse software; Airwallex approves it; no one is asked.",
    offline: "Airwallex is a stand-in; live: docs/runs/2026-10-29-cards.md",
    run: async (w) => {
      const t = await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
      return { happened: `Airwallex ${t.approved ? "approved" : `declined (${t.failureReason})`} 19.99 EUR at Packwise; ${n(w, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING_APPROVAL'")} proposals wait`,
        passed: t.approved && n(w, "SELECT COUNT(*) AS n FROM proposals WHERE status = 'PENDING_APPROVAL' AND created_by = 'sourcing'") === 0, evidence: [`card transaction ${t.transactionId}`, ...rows(w, "card.charge_approved")] };
    },
  },
  {
    id: "over-limit-raise",
    title: "Too expensive: declined, then a raise with Face ID",
    expected: "The 45.00 EUR plan is declined by Airwallex (over the 30.00 limit); the agent asks for more; after the CFO's Face ID the card has 50.00 and the same plan goes through.",
    offline: "Airwallex and the phone are stand-ins; live: docs/runs/2026-10-29-cards.md",
    run: async (w) => {
      const first = await buyPlan(w.db, w.issuing, "packwise-pro", w.now());
      const p = proposeCardRaise(w.db, "sourcing", { perTx: "50.00" }, "the Pro plan needs 45.00", w.now());
      const r = await processAssertion(w.db, w.cfoApproval(p.proposal_id, p.terms_sha256), w.now());
      executePolicyChange(w.db, p.proposal_id, w.now());
      await syncCards(w.db, w.issuing, w.now());
      w.advance(60_000);
      const second = await buyPlan(w.db, w.issuing, "packwise-pro", w.now());
      return { happened: `first try ${first.approved ? "APPROVED" : `declined (${first.failureReason})`}; ${p.proposal_id} ${r.status} with Face ID; card now ${(w.issuing.cards.find((c) => c.nickname.includes("sourcing"))?.limits?.perTxCents ?? 0) / 100} EUR per purchase; second try ${second.approved ? "approved" : `declined (${second.failureReason})`}`,
        passed: !first.approved && first.failureReason === "LIMIT_EXCEEDED" && r.status === "approved" && second.approved, evidence: [p.proposal_id, `card transactions ${first.transactionId}, ${second.transactionId}`] };
    },
  },
  {
    id: "price-rise",
    title: "The supplier raises its price: refused, then options",
    expected: "A stock check at 0.04 is refused (the cap is 0.03); Purser offers options that stay inside the 20.00 the business allows, and nothing changes before the CFO approves one.",
    offline: "The refusal here is the CFO policy's, checked before signing; live, the chain itself refuses with mandate_cap_exceeded: docs/runs/2026-10-29-s1.md",
    run: async (w) => {
      const pid = await cfoApprovesPolicy(w, [{ key: "cap.sourcing", to: "0.03" }], "the mandate's cap, mirrored in the policy");
      const refused = capRefusal(w.db, "sourcing", RAISED_UPSTREAM_PRICE_CENTS);
      const options = priceRiseOptions(SELL_PRICE_CENTS, ALT_SELL_PRICE_CENTS, RAISED_UPSTREAM_PRICE_CENTS).filter((o) => o.sellCents !== null);
      const total = priceRiseTargets(RAISED_UPSTREAM_PRICE_CENTS).reduce((s, t) => s + t.budgetCents, 0);
      return { happened: `${refused ?? "not refused"}; ${options.length} options (${options.map((o) => `${o.label}, margin ${o.marginCents} cents`).join("; ")}); new budgets total ${total / 100}`,
        passed: refused !== null && options.length === 2 && total <= TOTAL_BUDGET_CENTS, evidence: [pid] };
    },
  },
  {
    id: "changed-bank-details",
    title: "A fake invoice with changed bank details",
    expected: "An invoice that asks to pay a new IBAN is blocked; the new account counts only after a request, a check by a person and the CFO's approval.",
    offline: "Airwallex is a stand-in; live: docs/runs/2026-10-29-fraud.md",
    run: async (w) => {
      const text = fixture("bergtex-invoice-BTX-2027-01-BANKCHANGE.txt");
      const c = checkInvoice(w.db, parseInvoiceFallback(text), text);
      // Whole reasons, never a cut-off one: the code check's own reason, then the red team's lookalike invoice.
      const r = await runAttack(w, ATTACKS.find((x) => x.id === "bank-detail-change")!);
      return {
        happened: `${c.ok ? "the invoice PASSED" : `the invoice is blocked: ${c.reason}`}. The red team's lookalike invoice: ${r.blocked ? "blocked" : "NOT blocked"}. Stopped by: ${r.defence}.`,
        passed: !c.ok && r.blocked, evidence: ["fixtures/bergtex-invoice-BTX-2027-01-BANKCHANGE.txt", "red team attack bank-detail-change"],
      };
    },
  },
  { id: "ai-trick", title: "An AI trick hidden in an invoice", expected: "A line telling the AI the payment is pre-approved is flagged and changes nothing; nothing is paid without the CFO.", offline: "The model is a stand-in that obeys the trick; live: docs/runs/2026-10-29-injection.md", run: viaAttack("invoice-injection") },
  {
    id: "duplicate-invoice",
    title: "The same invoice twice",
    expected: "The second copy of an invoice already paid is refused before anything moves.",
    offline: "Airwallex is a stand-in; live: the euro bill flow (npm run s3) checks the same",
    run: async (w) => {
      const inv = parseInvoiceFallback(fixture("bergtex-invoice-BTX-2026-11.txt"));
      const first = invoiceAlreadyHandled(w.db, inv.invoice_no, w.now());
      w.db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES (?, ?, ?, 'EUR', ?, 'h', 'b', 'd', 'PAID')").run(inv.invoice_no, inv.vendor, inv.amount, inv.due_date);
      w.db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-1', 'rq-1', ?, ?, 'EUR', 'SWIFT', '20.00', 'PAID', 'h', ?)").run(inv.invoice_no, inv.amount, w.now().toISOString());
      const second = invoiceAlreadyHandled(w.db, inv.invoice_no, w.now());
      return { happened: `first copy: ${first ?? "may be paid"}; second copy: ${second ?? "may be paid"}`, passed: first === null && second !== null, evidence: [`invoice ${inv.invoice_no}`] };
    },
  },
  { id: "velocity-stop", title: "An agent pays too often: stopped by itself", expected: "Past its speed limit the agent is stopped automatically; only the CFO's Face ID lifts the stop.", offline: "Metal is a stand-in; live: docs/runs/2026-10-29-rehearsal-6.md", run: viaAttack("velocity-burst") },
  {
    id: "emergency-stop",
    title: "The emergency stop",
    expected: "One Face ID: every agent payment is refused before signing and every card is frozen at Airwallex; a purchase is declined.",
    offline: "Airwallex and the phone are stand-ins; not yet run live; the stop is covered by test/freeze.test.ts and this scenario",
    run: async (w) => {
      const pid = await cfoApprovesPolicy(w, [{ key: "freeze", to: "on" }], "something looks wrong");
      const card = await buyPlan(w.db, w.issuing, "packwise-starter", w.now()).catch((e: Error) => ({ approved: false, failureReason: e.message.slice(0, 60), transactionId: "-" }));
      const frozenCards = w.issuing.cards.filter((c) => c.status === "INACTIVE").length;
      const chain = capRefusal(w.db, "sourcing", 1);
      return { happened: `${pid} approved; ${frozenCards} of ${w.issuing.cards.length} cards frozen at Airwallex; a purchase: ${card.approved ? "APPROVED" : `declined (${card.failureReason})`}; on chain: ${chain ?? "not refused"}`,
        passed: frozenCards === w.issuing.cards.length && !card.approved && !!chain?.startsWith("frozen_by_cfo"), evidence: [pid, ...rows(w, "card.frozen").slice(0, 3)] };
    },
  },
  {
    id: "outside-agent",
    title: "An outside agent asks for a card",
    expected: "It cannot pay before the CFO approves; after Face ID it gets a card with exactly the approved limits and pays inside them.",
    offline: "Airwallex and the phone are stand-ins; live: docs/runs/2026-10-29-agent-api.md",
    run: async (w) => {
      const id = agentId("lab-buyer");
      const early = await payWithCard(w.db, w.issuing, id, { merchant: "TrailData Reports", amount: "10.00", description: "report" }, w.now()).then(() => "paid", (e: Error) => e.message);
      const p = requestCompanyCard(w.db, id, { displayName: "Lab buyer", purpose: "market reports", perTx: "20.00", monthly: "60.00" }, w.now());
      await processAssertion(w.db, w.cfoApproval(p.proposal_id, p.terms_sha256), w.now());
      await executeAgentOnboard(w.db, w.issuing, p.proposal_id, w.now());
      const paid = await payWithCard(w.db, w.issuing, id, { merchant: "TrailData Reports", amount: "10.00", description: "report" }, w.now());
      return { happened: `before approval: ${early}; ${p.proposal_id} approved with a stand-in passkey; then 10.00: ${paid.approved ? "approved" : `declined (${paid.failureReason})`}`,
        passed: early !== "paid" && paid.approved, evidence: [p.proposal_id, `card transaction ${paid.transactionId}`] };
    },
  },
  {
    id: "reconciliation-difference",
    title: "The bank and the ledger disagree",
    expected: "A card charge at Airwallex that the ledger never saw shows up as a difference in the hourly reconciliation.",
    offline: "Airwallex is a stand-in; live: npm run reconcile",
    run: async (w) => {
      await buyPlan(w.db, w.issuing, "packwise-starter", w.now());
      const card = w.issuing.cards[0]!;
      // A charge only Airwallex knows about, two hours old (as if a webhook and the poll were both lost; a charge of the
      // last minutes may still be on its way and is not a difference yet).
      w.issuing.txs.push({ transactionId: "tx_unseen", cardId: card.cardId, amountCents: 1234, currency: "EUR", status: "APPROVED", approved: true, failureReason: null, merchant: "Unknown merchant", mcc: "5734", type: "AUTHORIZATION", occurredAt: new Date(w.now().getTime() - 2 * 3600_000).toISOString() });
      const r = await reconcile(w.db, { cardTransactions: (id) => w.issuing.listCardTransactions(id) }, w.now());
      return { happened: `${r.checked} checked, ${r.differences.length} difference(s): ${r.differences.map((d) => `${d.area} ${d.ref}: ledger ${d.ledger}, Airwallex ${d.outside}`).join("; ")}`,
        passed: r.differences.some((d) => d.ref.includes("tx_unseen")), evidence: ["card transaction tx_unseen", ...rows(w, "reconcile.done")] };
    },
  },
  {
    id: "ask-purser",
    title: "Ask Purser for a flight",
    expected: "\"Flight to Berlin, at most €250\" gives a single-use airline card at once (within the policy); one booking goes through, the card is closed after it, and a second charge is declined.",
    offline: "Airwallex is a stand-in; the single-use check live in the sandbox follows the Friday runs",
    run: async (w) => {
      const r = await askPurser(w.db, tools(w), "Book a flight to Berlin, at most €250", w.now(), { rail: w.issuing, from: "runner" });
      if (!r.taskId) return { happened: r.reply, passed: false, evidence: [] };
      const booked = await bookOnTaskCard(w.db, w.issuing, r.taskId, { merchant: "Skyline Air", amount: "189.00" }, w.now(), w.issuing);
      const again = await bookOnTaskCard(w.db, w.issuing, r.taskId, { merchant: "Skyline Air", amount: "40.00" }, w.now(), w.issuing);
      return { happened: `${r.reply} Booking 189.00: ${booked.approved ? "approved" : "declined"}; second charge: ${again.approved ? "APPROVED" : `declined (${again.failureReason})`}`,
        passed: booked.approved && !again.approved, evidence: [r.taskId, ...rows(w, "card.closed")] };
    },
  },
  {
    id: "unknown-sender",
    title: "Money from an unknown sender",
    expected: "A payment into the sweep wallet from anyone but the business account is held by Metal in quarantine, shown to the CFO, and never reaches the bank on its own.",
    offline: "Metal's ReceivePolicy is a stand-in; live: docs/metal-award.md, section 5",
    run: async (w) => {
      w.db.prepare("INSERT OR IGNORE INTO metal_accounts (address, role) VALUES ('0x00000000000000000000000000000000000000b1', 'business'), ('0x00000000000000000000000000000000000000e1', 'sweep')").run();
      const rp = new FakeReceivePolicy();
      await setupReceivePolicy(w.db, rp, "sweep.key.json", w.now());
      const credited = rp.receive("0x00000000000000000000000000000000000000f9", "0x00000000000000000000000000000000000000e1", 2n * 10n ** 16n);
      const held = await pollQuarantine(w.db, rp, w.now());
      return { happened: `credited to the wallet: ${credited ? "yes" : "no"}; held and recorded: ${held}; options for the CFO: ${n(w, "SELECT COUNT(*) AS n FROM proposals WHERE kind = 'quarantine_release'")}; bridged: ${n(w, "SELECT COUNT(*) AS n FROM chain_credits")}`,
        passed: !credited && held === 1 && n(w, "SELECT COUNT(*) AS n FROM chain_credits") === 0, evidence: rows(w, "quarantine.held") };
    },
  },
  ...DISPUTES,
];

/** One scenario in a fresh world: the reset is the new world. A crash counts as a failure, with its message. */
export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const base = { id: s.id, title: s.title, expected: s.expected, offline: s.offline };
  try {
    const w = await redTeamWorld();
    return { ...base, ...(await s.run(w)) };
  } catch (e) {
    return { ...base, happened: `the scenario stopped: ${(e as Error).message.slice(0, 300)}`, passed: false, evidence: [] };
  }
}

export async function runAll(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const s of SCENARIOS) out.push(await runScenario(s));
  return out;
}

