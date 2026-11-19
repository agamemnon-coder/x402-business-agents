// The dashboard's feed (src/dashboard/snapshot.ts describe): each ledger row in the CFO's words, with the tone that
// colours it. A refusal must read as a refusal, money that moved as done, and a row with missing fields must say less,
// never something false (no invented transaction, no Airwallex id from an empty subject, no "approved" without a key).
import { describe as group, expect, it } from "vitest";
import { describe } from "../src/dashboard/snapshot.js";

const TX = `0x${"ab".repeat(32)}`;
let seq = 0;
const row = (event: string, subject: string | null, payload: Record<string, unknown> = {}, actor = "system") =>
  ({ seq: ++seq, ts: "2026-11-19T10:00:00Z", actor, event, subject, payload_json: JSON.stringify(payload), row_hash: "h" });
const noSale = () => undefined;
const words = (event: string, subject: string | null, payload: Record<string, unknown> = {}, actor = "system") => describe(row(event, subject, payload, actor), noSale);

group("purchases from the supplier", () => {
  it("a paid purchase without its amount names no price; a purchase found by lookup says it was not paid twice", () => {
    expect(words("upstream.paid", null, { seq: 7 })).toMatchObject({ text: "Bought stock check #7 from Stockline", tone: "ok" });
    expect(words("upstream.paid_after_lookup", null, { seq: 8, amount_units: String(4n * 10n ** 16n) }).text).toMatch(/^Bought stock check #8 from Stockline for .* USDZ \(found by lookup, not paid twice\)$/);
  });

  it("says which check refused a purchase: the agent's buy policy, no offer, a pending replace, the CFO policy, Purser or the chain", () => {
    expect(words("upstream.refused", null, { seq: 3, reason: "buy_policy: margin too thin" })).toEqual(expect.objectContaining({ text: "Stock check #3 not bought: the Sourcing agent's own buy policy (margin too thin); nothing was signed", tone: "refusal" }));
    expect(words("upstream.refused", null, { seq: 3, reason: "supplier_unavailable: 503" }).text).toBe("Stock check #3 not bought: the supplier made no offer (503); nothing was signed");
    expect(words("upstream.refused", null, { seq: 3, reason: "replace_pending: P-0007 changes the mandate" }).text).toBe("Purchase of stock check #3 held by Purser before signing: P-0007 changes the mandate");
    expect(words("upstream.refused", null, { seq: 3, reason: "policy_cap_exceeded: 0.04 over 0.03" }).text).toBe("Purchase of stock check #3 refused by the CFO policy before signing: 0.04 USDZ over 0.03 USDZ");
    expect(words("upstream.refused", null, { seq: 3, reason: "mandate_cap_exceeded: x", refused_by: "purser" }).text).toMatch(/^Purchase of stock check #3 refused by Purser before signing, against the mandate: /);
    expect(words("upstream.refused", null, { seq: 3, reason: "mandate_cap_exceeded: x" }).text).toMatch(/^Purchase of stock check #3 refused on chain: /);
  });

  it("links the chain's own refusal only with a real transaction hash", () => {
    expect(words("upstream.refused_on_chain", null, { amount: "0.04", metal_reason: "cap", tx: TX })).toMatchObject({ tone: "refusal", tx: TX });
    expect(words("upstream.refused_on_chain", null, { amount: "0.04", metal_reason: "cap", tx: "0x12" }).tx).toBeNull();
  });

  it("states the defense-in-depth purchase, its refusal and the incident that stops the agent", () => {
    expect(words("upstream.let_through", null, { seq: 4, amount: "0.04", bound_cap: "0.03" })).toMatchObject({ tone: "info", text: "Defense in depth: purchase of stock check #4 at 0.04 USDZ, over the 0.03 cap, let through to Alta once (Purser would have refused it before signing)" });
    expect(words("upstream.let_through_refused", null, { label: "Alta refused it" })).toMatchObject({ text: "Alta refused it", tone: "refusal" });
    expect(words("upstream.let_through_incident", null, { what: "paid over the cap" }).text).toBe("INCIDENT: paid over the cap; the Sourcing agent is stopped until the CFO lifts it with Face ID");
    expect(words("upstream.in_doubt", null, { seq: 9 })).toMatchObject({ tone: "refusal", text: "Purchase of stock check #9 unconfirmed; it is looked up before any retry" });
  });
});

group("sales and settlements", () => {
  it("names the sale by its number and price when the ledger has it, by its id otherwise, and says when Alta clearing paid", () => {
    const sale = describe(row("sale.delivered", "12", { scheme: "bajillion" }), () => ({ seq: 5, price: 5 }));
    expect(sale).toMatchObject({ text: "Sold stock check #5 to Summit Outfitters for 0.05 USDZ by Alta clearing (a receipt, no transaction)", tone: "ok" });
    expect(words("sale.delivered", "12").text).toBe("Sale 12 delivered");
  });

  it("a charged payment without a delivery is owed back; a closed settlement and one that did not move say so", () => {
    expect(words("sale.settlement_resolved", null, { outcome: "CHARGED", amount: "0.05", tx: TX })).toMatchObject({ tone: "refusal", text: `A customer payment of 0.05 USDZ was charged with no delivery recorded (tx ${TX.slice(0, 10)}…): owed back unless a person finds it was delivered` });
    expect(words("sale.settlement_resolved", null, { outcome: "CHARGED", amount: "0.05" }).text).toContain("(no tx)");
    expect(words("sale.settlement_resolved", null, { outcome: "DONE", sale_id: 4 }).text).toBe("A sale's settlement was closed by the reconciliation (sale 4)");
    expect(words("sale.settlement_resolved", null, { outcome: "NONE", detail: "no transfer" })).toMatchObject({ tone: "info", text: "A customer payment left being settled did not move: no transfer" });
    expect(words("sale.settlement_left_open", "S1", { error: "busy" }).text).toBe("Sale S1 is recorded; its settlement row is left for the reconciliation to close (busy)");
    expect(words("sale.settle_failed", null, { error: "x" }).tone).toBe("refusal");
    expect(words("sale.refused", null, { seq: 2, status: 402 }).text).toMatch(/^Customer query #2 answered 402: .*not charged$/);
  });

  it("a query's answer: settled is ok; not settled, unknown or unanswered is a refusal", () => {
    expect(words("query.answered", null, { seq: 1, status: 200, settled: true })).toMatchObject({ tone: "ok", text: "Customer query #1: Summit Outfitters got HTTP 200; its payment settled" });
    expect(words("query.answered", null, { seq: 1, status: 502, settled: false })).toMatchObject({ tone: "refusal", text: "Customer query #1: Summit Outfitters got HTTP 502; its payment did not settle (not charged)" });
    expect(words("query.answered", null, { seq: 1, status: null })).toMatchObject({ tone: "refusal", text: "Customer query #1: Summit Outfitters got no answer; settlement unknown" });
  });

  it("prepaid clearing: deposited and withdrawn with a transaction only when it is one, not offered, and paid but undelivered", () => {
    expect(words("clearing.deposited", null, { amount: "1.00", tx: TX })).toMatchObject({ tone: "ok", tx: TX });
    expect(words("clearing.deposited", null, { amount: "1.00", tx: "nope" }).tx).toBeNull();
    expect(words("clearing.withdrawn", null, { amount: "1.00" })).toMatchObject({ tone: "ok", tx: null, text: "Our clearing earnings of 1.00 USDZ went to the business account" });
    expect(words("sale.prepaid_not_offered", "6", { reason: "no_budget: Summit's budget is spent" }).text).toBe("Prepaid clearing not offered for stock check #6: Summit's budget is spent; the buyer uses the mandate route");
    expect(words("sale.prepaid_undelivered", "6", { reason: "timeout" })).toMatchObject({ tone: "refusal", text: "Stock check #6 was paid by clearing but not delivered (timeout); it is owed and refunded" });
  });
});

group("policy, settings and restarts", () => {
  it("a policy change shows amounts with their unit, and an empty side as no extra limit", () => {
    const d = words("policy.changed", null, { key: "cap.sourcing", label: "Sourcing cap", from: "", to: "0.03", proposal_id: "C-1" });
    expect(d.tone).toBe("approval");
    expect(d.text).toMatch(/^CFO policy: Sourcing cap changed from no extra limit to 0\.03/);
    expect(d.text).toMatch(/\(C-1\)$/);
  });

  it("a restart: a resumed proposal, recovered holds", () => {
    expect(words("proposal.resumed", "P-0003").text).toBe("P-0003 resumed after a restart, from its last finished step; nothing done twice");
    expect(words("holds.recovered", null, { settled: 1, released: 2, open: 0 }).text).toBe("After a restart: 1 hold(s) settled, 2 released, 0 still counted until resolved");
  });

  it("a setting: the new value, and the old one only when there was one", () => {
    expect(words("setting.changed", "eur_floor_x", { after: "5" }).text).toBe("eur floor x set to 5");
    expect(words("setting.changed", "eur_floor_x", { after: "5", before: "4" }).text).toBe("eur floor x set to 5 (was 4)");
  });
});

group("Claude and the agents", () => {
  it("a Claude read names the task, the class of a document, and an advisory review without a recommendation", () => {
    expect(words("claude.read", "classify_document", { output: { kind: "supplier_invoice" }, model: "claude-sonnet-4-5" }).text).toBe("Claude classified an incoming document as supplier invoice");
    expect(words("claude.read", "explain_invoice_fraud", { output: {} }).text).toBe("Claude explained the blocked invoice to the CFO: see the ledger (advisory)");
    expect(words("claude.read", "review_mandate_replace", { output: { recommendation: "approve_with_care" } }).text).toBe("Claude reviewed a mandate replace proposal: approve with care (advisory)");
    expect(words("claude.read", "review_refund_batch", {}).text).toBe("Claude reviewed a refund batch proposal: see the approval page (advisory)");
    expect(words("claude.read", "some_new_task", {}).text).toBe("Claude some new task");
  });

  it("a refused agent tool says whether Alta, the mandate's cap or another check refused it", () => {
    expect(words("agent.tool", null, { agent: "sourcing", blocked_by: "Metal mandate" })).toMatchObject({ tone: "refusal", text: expect.stringMatching(/^Alta refused .*'s purchase against its on-chain mandate$/) });
    expect(words("agent.tool", null, { agent: "sourcing", blocked_by: "mandate cap 0.03" }).text).toMatch(/'s purchase was refused before signing: over its mandate's cap$/);
    expect(words("agent.tool", null, { agent: "sourcing", tool: "buy_stock_check", blocked_by: "frozen" }).text).toMatch(/^Code refused .*'s buy stock check: frozen$/);
  });

  it("the payables Checker: its decision, code's fallback, and an override that is a refusal", () => {
    const claude = words("ap.checker_decided", "INV-1", { source: "claude", action: "hold", reason: "dup", outcome: "held", model: "claude-haiku-4-5" });
    expect(claude.tone).toBe("info");
    expect(claude.text).toMatch(/^The Checker agent decided .* INV-1: "dup" Outcome: .*\.$/);
    expect(claude.model).not.toBeNull();
    const code = words("ap.checker_decided", "INV-1", { source: "code", action: "pay", reason: "clean", outcome: "filed" });
    expect(code.text).toMatch(/^Code's checks decided .* INV-1 \(the fallback: the Checker agent did not decide\): "clean" Outcome: /);
    expect(code.model).toBeNull();
    const over = words("ap.checker_decided", "INV-1", { source: "claude", action: "pay", reason: "fine", outcome: "held", overridden: true, why: "the IBAN changed" });
    expect(over.tone).toBe("refusal");
    expect(over.text).toMatch(/Code's checks overrode it: /);
  });

  it("the Payer: a plan held by code is a refusal; a plan for later files nothing; code's own plan when the agent did not propose", () => {
    const held = words("ap.payer_proposed", "INV-2", { source: "claude", invoice_no: "F-2", pay_on: "2026-11-20", rail: "x", pay_currency: "EUR", reason: "r", next: "hold", why: "over the floor" });
    expect(held.tone).toBe("refusal");
    expect(held.text).toMatch(/^The Payer agent proposed paying F-2 on 2026-11-20 by x, from EUR: "r" Code held it: /);
    const later = words("ap.payer_proposed", "INV-2", { source: "code", pay_on: "2026-11-20", pay_currency: "EUR", reason: "r", next: "pay_later" });
    expect(later.text).toBe("Code's own plan stands (the fallback: the Payer agent did not propose): paying INV-2 on 2026-11-20 by no rail, from EUR: \"r\" Nothing is filed until that day.");
    expect(later.model).toBeNull();
    expect(words("ap.payer_proposed", "INV-2", { source: "claude", next: "file" }).text).toMatch(/Filed for the CFO's Face ID\.$/);
  });

  it("the Sourcing agent's answer to a price rise, or code when its model was not there", () => {
    expect(words("price_rise.met", null, { source: "claude", message: "I stop buying" }).text).toBe("The Sourcing agent told the Treasury agent: \"I stop buying\"");
    expect(words("price_rise.met", null, { source: "code" }).text).toBe("The Sourcing agent's model was not available; code served the next query as before");
  });

  it("a rail chosen per purchase: who chose, the transaction or card id it carries, and a failed payment as a refusal", () => {
    const x402 = words("purchase.rail_chosen", "stockline", { rail: "metal_x402", by: "claude", reason: "cheaper", result: "paid", ref: TX });
    expect(x402).toMatchObject({ tone: "ok", tx: TX, text: "The Sourcing agent paid Stockline on x402 on Alta (\"cheaper\"): paid" });
    const card = words("purchase.rail_chosen", "ridgeline", { rail: "airwallex_card", by: "code", result: "declined", ref: "iss_1", ok: false });
    expect(card).toMatchObject({ tone: "refusal", awx_id: "iss_1", text: "Code (the agent did not decide) paid Ridgeline on its Airwallex card: declined" });
    expect(words("purchase.rail_chosen", "stockline", { rail: "metal_x402", by: "claude", result: "paid", ref: "0x1" }).tx).toBeNull();
  });

  it("the rails per purchase, the refusal of one, and the Treasury plan or its fallback", () => {
    expect(words("purchase.rails_chosen", null, { source: "claude", purchases: [{ supplier: "stockline", rail: "metal_x402" }, { supplier: "ridgeline", rail: "card" }] }).text)
      .toBe("The Sourcing agent picked the rail per purchase: Stockline on x402 on Alta, Ridgeline on the card; code checked each supplier accepts it");
    expect(words("purchase.rails_chosen", null, { source: "code" }).text).toBe("Code paid on the rail each supplier accepts (); the Sourcing agent's choice was not used");
    expect(words("purchase.rail_refused", "stockline", { why: "no card rail" })).toMatchObject({ tone: "refusal", text: "Code refused the Sourcing agent's payment to Stockline: no card rail; nothing was charged" });
    expect(words("price_rise.plan", null, { source: "claude", budgets: ["sourcing 12.00 (cap 0.04)", "treasury 4.00"], attempts: 2, advice: "raise" }).text)
      .toBe("The Treasury agent planned sourcing 12.00 / treasury 4.00, accepted by code after 2 tries: \"raise\"");
    expect(words("price_rise.plan", null, { source: "claude", budgets: [], attempts: 1, advice: "a" }).text).toBe("The Treasury agent planned , accepted by code: \"a\"");
    expect(words("price_rise.plan", null, { source: "code", note: "over 20.00" }).text).toBe("The Treasury agent's plan was not used (over 20.00); code's fixed plan went to the CFO");
  });

  it("the Support agent's settlement, with what it sent to the CFO, or code's", () => {
    expect(words("dispute.settled_by_agent", null, { source: "claude", refunded: ["#1", "#2"], escalated: { sales: [3, 4], proposal: "P-9" }, said: "ok" }).text)
      .toBe("The Support agent refunded #1, #2 itself and sent 2 to the CFO (P-9): \"ok\"");
    expect(words("dispute.settled_by_agent", null, { source: "claude", said: "none" }).text).toBe("The Support agent refunded nothing itself: \"none\"");
    expect(words("dispute.settled_by_agent", null, {}).text).toBe("The Support agent's model was not available; code settled the dispute as before");
  });

  it("the autonomous agents: the world, a decision or its fallback, a message, idling, the cost warning and timing advice", () => {
    expect(words("world.event", null, { kind: "supplier.price_rise", for_agent: "sourcing" }).text).toMatch(/^The world changed: supplier price rise \(for .+\)$/);
    expect(words("world.event", null, { kind: "x" }).text).toBe("The world changed: x");
    expect(words("agent.decision", null, { source: "claude", tick: true, summary: "nothing new" }, "treasury").text).toMatch(/ decided \(routine check\): nothing new$/);
    expect(words("agent.decision", null, { source: "code", summary: "s" }, "treasury").text).toMatch(/^Fallback \(code\) for .*: s$/);
    expect(words("agent.message", null, { from: "sourcing", to: "treasury", text: "hi" }).text).toMatch(/ → .*: "hi"$/);
    expect(words("agent.idle", null, { agent: "support", why: "no disputes" }).text).toMatch(/ does nothing: no disputes$/);
    expect(words("agent.cost_warning", null, { agent: "treasury", spent_usd_micros: 1_600_000, cap_usd_micros: 2_000_000 })).toMatchObject({ tone: "refusal", text: expect.stringMatching(/used 80% of its hourly Claude budget \(1\.6000 of 2\.00 USD\)$/) });
    expect(words("licence.timing_advised", "P-2", { timing: "pay_now", invoice_no: "SLL-1", reason: "r" }).text).toBe("The Treasury agent advised paying SLL-1 (P-2), advisory: \"r\"");
    expect(words("licence.timing_advised", "P-2", { timing: "wait", date: "2026-12-01", invoice_no: "SLL-1", reason: "r" }).text).toBe("The Treasury agent advised waiting until 2026-12-01 to pay SLL-1 (P-2), advisory: \"r\"");
    expect(words("agent.nudged", null, { agent: "treasury", reason: "no finish" }).text).toMatch(/^Code sent .* back, not finished: no finish$/);
    expect(words("claude.fallback", "parse_invoice", { note: "timeout" }).text).toBe("Claude was not used for parse invoice; the deterministic parser decided (timeout)");
    expect(words("claude.rejected", "parse_invoice").tone).toBe("refusal");
  });

  it("a card decline met by the agent or by code, with or without a raise", () => {
    expect(words("card.decline_met", null, { agent: "sourcing", source: "claude", reason: "x", proposal_id: "P-5", said: "raise it" }).text).toMatch(/ and proposed a higher limit, P-5, for the CFO's Face ID: "raise it"$/);
    expect(words("card.decline_met", null, { agent: "sourcing", source: "claude", reason: "x" }).text).toMatch(/ and proposed no raise$/);
    expect(words("card.decline_met", null, { agent: "sourcing", reason: "x" }).text).toMatch(/^Code met the decline \(.*\) and proposed no raise; the agent did not decide$/);
  });
});

group("the passkey account on chain", () => {
  it("names two passkey owners, or the virtual one by its owner, threshold 2", () => {
    expect(words("owners.account_created", null, { account: "0x1111111111111111111111111111111111111111", owners: ["Max", "Anna"] }).text).toMatch(/created with two owners, Max's and Anna's passkeys \(threshold 2\): no server key can change its mandates$/);
    expect(words("owners.account_created", null, { account: "0x1", owners: "not a list" }).text).toMatch(/created with two owners, 's passkeys \(threshold 2\)/);
  });

  it("an executed change links its transaction only when it is one; sent, reverted, paid, refused and not paid read as they are", () => {
    const action = { what: "bind", agent: "sourcing", cap: "0.04", budget: "12.00" };
    expect(words("owners.executed", "P-3", { action, tx: TX })).toMatchObject({ tone: "ok", tx: TX, text: "Both passkeys signed P-3 on chain and the account ran it: bind the sourcing mandate (up to 0.04 a payment, 12.00 in total); the runner only relayed it" });
    expect(words("owners.executed", "P-3", { action }).tx).toBeNull();
    expect(words("owners.sent", "P-3").text).toBe("P-3, signed by both passkeys, was sent to the business account on chain");
    expect(words("owners.reverted", "P-3", { reason: "bad sig" })).toMatchObject({ tone: "refusal", text: "The account refused P-3 on chain: bad sig" });
    expect(words("owners.paid", null, { amount: "0.04", payee_name: "Stockline" }).tone).toBe("ok");
    expect(words("owners.refused_on_chain", null, { amount: "0.05", payee_name: "Stockline", cap: "0.04" }).text).toBe("Alta refused 0.05 USDZ to Stockline, over the mandate's 0.04 cap, and recorded the refusal on chain");
    expect(words("owners.pay_not_paid", null, { amount: "0.04", payee_name: "Stockline", outcome: "TIMEOUT" }).text).toBe("The Sourcing agent's 0.04 USDZ to Stockline on the passkey account was not paid: timeout");
    expect(words("owners.pay_not_paid", null, { amount: "0.04", payee_name: "Stockline", reason: "no gas" }).text).toMatch(/was not paid: no gas$/);
    expect(words("owners.over_cap_not_refused", null, { amount: "0.05", cap: "0.04" }).tone).toBe("refusal");
  });
});

group("proposals and approvals", () => {
  it("who proposed: the CFO's command, code's rule, a person, a known agent or another", () => {
    expect(words("proposal.created", "P-1", { kind: "policy_change", origin: { actor: "cfo-command", command: "npm run policy", moves_money: false } }).text).toMatch(/^Max started P-1 \(.*\) with npm run policy$/);
    expect(words("proposal.created", "P-1", { kind: "refund_batch", origin: { actor: "code", rule: "refunds over 0.10" } }).text).toMatch(/^Code proposed P-1 \(.*\) by its rule: refunds over 0\.10$/);
    expect(words("proposal.created", "P-1", { kind: "dev_test" }, "human").text).toMatch(/^Max proposed P-1 /);
    expect(words("proposal.created", "P-1", { kind: "dev_test" }, "outsider").text).toMatch(/^Agent outsider proposed P-1 /);
  });

  it("priced options, with pausing named without a price", () => {
    expect(words("price_rise.options", null, { options: [{ id: "A", sell: "0.05", margin: "0.01" }, { id: "C", label: "pause sales", sell: null }] }).text).toBe("Priced the options: A sell 0.05 (margin 0.01), C pause sales");
    expect(words("price_rise.options", null, {}).text).toBe("Priced the options: ");
  });

  it("an approval without a passkey is said to be by typed hash; nobody named reads 'A person'", () => {
    expect(words("proposal.approved", "P-1", { approver: "", method: "" }).text).toBe("A person approved P-1 by typed hash");
    expect(words("proposal.approved", "P-1", { passkey: { credential_id: "abcdef123456" } }).text).toBe("A person approved P-1");
    expect(words("proposal.rejected", "P-1", {})).toMatchObject({ text: "A person rejected P-1", tone: "refusal" });
    expect(words("approval.too_late", "P-1", {}).text).toBe("A person approved P-1 after it expired; nothing ran");
    expect(words("approval.too_late", "P-1", { approver: "Max" }).text).toBe("Max approved P-1 after it expired; nothing ran");
  });

  it("execution: running, done, failed with or without a reason, a guard refusal and a closed proposal", () => {
    expect(words("proposal.executing", "P-1").text).toBe("Running P-1, after checking its terms are exactly what was approved");
    expect(words("proposal.executed", "P-1").tone).toBe("ok");
    expect(words("proposal.failed", "P-1", {}).text).toBe("P-1 failed: see the ledger");
    expect(words("proposal.failed", "P-1", { error: "timeout" }).text).toBe("P-1 failed: timeout");
    expect(words("proposal.guard_refused", "P-1", { inconclusive: "yes", error: "stale" }).text).toBe("P-1: its execution was refused on a chain read that may be stale: stale; it stays open and can run again");
    expect(words("proposal.guard_refused", "P-1", { steps_started: 1, error: "e", status: "EXECUTING" }).text).toBe("P-1: its execution was refused after 1 of its steps had started: e; it stays executing until a person resolves it");
    expect(words("proposal.needs_reapproval", "P-2", { sibling_of: "P-1", error: "the facts changed" }).text).toBe("P-2 is closed: the facts changed. A new proposal is needed");
    expect(words("proposal.needs_reapproval", "P-2", { stopped: "yes", error: "e" }).text).toBe("P-2 was approved, but code did not run it: e. It is closed; a new proposal is needed");
    expect(words("proposal.needs_reapproval", "P-2", { error: "e" }).text).toBe("P-2 needs a new approval: e");
    expect(words("proposal.superseded", "P-2", { by: "P-1" }).text).toBe("P-2 closed: another option (P-1) was approved");
    expect(words("proposal.expired", "P-2").tone).toBe("refusal");
  });

  it("a held spend names the sweep, the dispute settlement, or the path as it is", () => {
    expect(words("spend.held", "treasury", { path: "sweep_earnings", reason: "x" }).text).toMatch(/'s sweep waits: /);
    expect(words("spend.held", "support", { path: "settle_dispute", reason: "x" }).text).toMatch(/'s dispute settlement \(its refunds\) waits: /);
    expect(words("spend.held", "sourcing", { path: "buy", reason: "x" }).text).toMatch(/'s buy waits: /);
  });
});

group("disputes and refunds", () => {
  it("a dispute opened by the customer's wallet reads as its name; one sale is singular", () => {
    expect(words("dispute.opened", "D-1", { sales: "4", claim: "something", customer: "0x1111111111111111111111111111111111111111" }).text).toMatch(/ disputes 1 sale: "something" \(case D-1\)$/);
    expect(words("dispute.opened", "D-1", { sales: "4,5", claim: "x", customer: "Acme" }).text).toBe("Acme disputes 2 sales: \"x\" (case D-1)");
  });

  it("decided by code: rejected, to the CFO, within the automatic limits, or neither", () => {
    expect(words("dispute.decided", "D-1", { outcome: "rejected" }).text).toBe("Dispute D-1 handled by code: not refunded, every order signed and paid inside the customer's mandate");
    expect(words("dispute.decided", "D-1", { refund: "0.10", route: "approval", proposal_id: "P-4" }).text).toBe("Dispute D-1 handled by code: refund 0.10 test USD, waiting for your Face ID (P-4)");
    expect(words("dispute.decided", "D-1", { refund: "0.10", route: "auto" }).text).toBe("Dispute D-1 handled by code: refund 0.10 test USD, within the automatic limits");
    expect(words("dispute.decided", "D-1", { refund: "0.10" }).text).toBe("Dispute D-1 handled by code: refund 0.10 test USD");
  });

  it("the decision recorded once, by the agent or code, with what goes to the CFO", () => {
    expect(words("dispute.decision_recorded", "D-1", { source: "claude", refunds: ["1"], escalate: ["2"], approval: ["3"] }).text)
      .toBe("Dispute D-1 decided once, by the Support agent, before anything was paid: refund 1; 2 to the CFO; 3 above the automatic limits to the CFO");
    expect(words("dispute.decision_recorded", "D-1", {}).text).toBe("Dispute D-1 decided once, by code, before anything was paid: refund none");
  });

  it("refunds: automatic, paid, already paid or held, refused; sweeps and the credit", () => {
    expect(words("refund.auto_approved", null, { sales: [1, 2] }).text).toBe("Refunds for sales #1, #2 are within the automatic limits");
    expect(words("refund.auto_approved", null, {}).text).toBe("Refunds for sales  are within the automatic limits");
    expect(words("refund.paid", "4", { amount: "0.05", payment_id: "pay_1" }).text).toBe("Refunded 0.05 to Summit Outfitters for sale #4 (pay_1)");
    expect(words("refund.already_paid", null, { payment_id: "pay_1" }).text).toBe("Retry of pay_1: already paid, nothing sent");
    expect(words("refund.already_held", null, { payment_id: "pay_1" }).tone).toBe("info");
    expect(words("refund.refused", null, { payment_id: "pay_1", reason: "x" }).text).toMatch(/^Refund pay_1 refused: /);
    expect(words("refund.held", null, { payment_id: "pay_1", reason: "x" }).text).toMatch(/^Refund pay_1 held: /);
    expect(words("sweep.paid", "S-1", { amount: "1.00" }).text).toBe("Swept 1.00 USDZ of earnings to the sweep wallet (S-1)");
    for (const e of ["sweep.refused", "sweep.held", "sweep.pending"]) expect(words(e, "S-1", { reason: "x" }).text).toMatch(new RegExp(`^Sweep S-1 ${e.split(".")[1]}: `));
    expect(words("credit.locked", null, { block: 10, finalized_block: 12 }).text).toBe("Sweep final on chain (block 10 <= finalized 12); credit locked once");
    expect(words("credit.adopted", null, { currency: "USD", amount: "1.00", deposit_id: "dep_1", reference: TX })).toMatchObject({ awx_id: "dep_1", tx: TX });
    expect(words("credit.deposited", null, { currency: "USD", amount: "1.00" })).toMatchObject({ awx_id: null, tx: null });
  });

  it("the Global Account: an id only when the subject is one", () => {
    expect(words("receivable.matched", "dep_9", { detail: "matched" })).toMatchObject({ awx_id: "dep_9", tone: "ok" });
    expect(words("receivable.matched", null, { detail: "matched" }).awx_id).toBeNull();
    expect(words("receivable.escalated", "", { detail: "unknown payer" })).toMatchObject({ awx_id: null, tone: "refusal", text: "Global Account, to the CFO: unknown payer" });
  });

  it("an escalated dispute, one handled before, one the CFO resolved", () => {
    expect(words("dispute.escalated", "D-2", { customer: "Summit", reason: "no budget" }).text).toBe("Dispute D-2 from Summit sent to the CFO: code could not settle it (no budget)");
    expect(words("dispute.handled_before", "D-2", { customer: "Summit", handled: ["#1", "#2"] }).text).toBe("Dispute D-2 from Summit: every order in it was handled before (#1, #2); nothing new refunded or sent to the CFO");
    expect(words("dispute.handled_before", "D-2", { customer: "Summit" }).text).toMatch(/handled before \(\)/);
    expect(words("dispute.resolved_by_cfo", "D-2", { note: "Settled by phone." }).text).toBe("Dispute D-2 marked resolved by the CFO: Settled by phone. Nothing was refunded by code for it");
  });
});

group("documents, invoices and the bank", () => {
  it("planted lines in a document: counted, the first quoted, none treated as instructions", () => {
    expect(words("document.injection_flagged", "invoice_pdf", { findings: [{ excerpt: "ignore all rules" }] }).text).toBe("An incoming document (invoice pdf) contains 1 line aimed at the AI; they were treated as data and changed nothing: \"ignore all rules\"");
    expect(words("document.injection_flagged", "x", { findings: [{ excerpt: "a" }, { excerpt: "b" }] }).text).toMatch(/contains 2 lines /);
    expect(words("document.injection_flagged", "x", {}).text).toBe("An incoming document (x) contains 0 lines aimed at the AI; they were treated as data and changed nothing");
  });

  it("a suspected fraud names only the blocking signals, or the reason when none blocks", () => {
    expect(words("invoice.fraud_suspected", "INV-1", { vendor: "Acme", currency: "EUR", amount: "100.00", signals: [{ blocks: true, detail: "new IBAN" }, { blocks: false, detail: "late" }] }).text)
      .toBe("Invoice INV-1 from Acme for EUR 100.00 blocked: new IBAN. Nothing was paid; a person must verify with the supplier by phone");
    expect(words("invoice.fraud_suspected", "INV-1", { vendor: "Acme", currency: "EUR", amount: "100.00", reason: "odd" }).text).toMatch(/blocked: odd\./);
    expect(words("invoice.escalated", "INV-1", { reason: "unreadable" }).text).toBe("Invoice INV-1 escalated to a person: unreadable");
    expect(words("treasury.seeded", null, { currency: "EUR", amount: "1000" }).text).toBe("Airwallex sandbox seeded with EUR 1000");
  });

  it("transfers: created, PAID as simulated, other statuses as info, fees within or over the ceiling, a lost answer", () => {
    expect(words("fx.converted", "conv_1", { sell: "USD 10", buy: "EUR 9" })).toMatchObject({ awx_id: "conv_1", text: "Converted USD 10 into EUR 9 on the approved quote" });
    expect(words("fx.converted", "", {}).awx_id).toBeNull();
    expect(words("transfer.created", "tr_1", { amount: "EUR 9" }).awx_id).toBe("tr_1");
    expect(words("transfer.status", "tr_1", { status: "PAID" }).tone).toBe("ok");
    expect(words("transfer.status", "tr_1", { status: "PROCESSING" })).toMatchObject({ tone: "info", text: "Transfer PROCESSING" });
    expect(words("transfer.fee", "tr_1", { fee: "5", fee_max: "20" }).tone).toBe("ok");
    expect(words("transfer.fee_over_ceiling", "", { fee: "25", fee_max: "20" })).toMatchObject({ tone: "refusal", awx_id: null });
    expect(words("transfer.ambiguous", null, { resolved: "found it" }).text).toBe("Transfer answer lost; found it");
  });

  it("the fee retry: the next attempt, or why there is none; refused, left open, stopped and closed", () => {
    expect(words("transfer.retry", null, { attempt: 1, amount: "EUR 9", code: "fee_config", trace_id: "t1", next_attempt_in_s: 30 }).text)
      .toBe("Airwallex refused attempt 1 of the EUR 9 payout (fee_config, trace t1). Retried in 30 s under the same request_id; Airwallex refused each attempt so far");
    expect(words("transfer.retry", null, { attempt: 3, amount: "EUR 9", code: "fee_config", next_attempt_in_s: null, stopped: "three attempts" }).text)
      .toBe("Airwallex refused attempt 3 of the EUR 9 payout (fee_config). No further attempt: three attempts");
    expect(words("transfer.refused", null, { amount: "EUR 9", code: "c", attempts: 3 }).text).toBe("Airwallex refused the EUR 9 payout (c) after 3 attempts; nothing was paid and the payout is closed. A new proposal with Face ID pays the invoice");
    expect(words("transfer.refused", null, { amount: "EUR 9", code: "c", trace_id: "t", attempts: 1 }).text).toMatch(/payout \(c, trace t\); nothing was paid/);
    expect(words("transfer.left_open", null, { amount: "EUR 9", attempts: 2, reason: "r" }).tone).toBe("refusal");
    expect(words("transfer.retry_stopped", null, { after_attempt: 2, reason: "r" }).text).toBe("The payout's retries stopped after attempt 2: r; nothing was paid");
    expect(words("transfer.closed_unsent", null, { invoice_no: "F-1", amount: "EUR 9", proposal_id: "P-1" }).tone).toBe("approval");
  });

  it("the alarms after a payout name the transfer, and an empty subject gives no Airwallex id", () => {
    expect(words("transfer.row_conflict", "tr_1", { amount: "EUR 9", request_id: "rq", row_status: "FAILED" })).toMatchObject({ awx_id: "tr_1", tone: "refusal" });
    expect(words("transfer.payee_unconfirmed", "", { amount: "EUR 9" }).awx_id).toBeNull();
    expect(words("transfer.found_after_close", "tr_2", { amount: "EUR 9", status: "PAID", request_id: "rq", invoice_no: "F-1" }).text)
      .toBe("Alarm: Airwallex holds transfer tr_2 (EUR 9, PAID) under the closed payout rq of invoice F-1; it is not proposed again, a person checks it now");
  });

  it("reconciliation: a difference against the chain or Airwallex; done with or without differences", () => {
    expect(words("reconcile.difference", "x", { area: "metal", ledger: "1", outside: "2" }).text).toBe("Reconciliation: metal x: the ledger says 1; the chain says 2. A person looks; nothing was changed");
    expect(words("reconcile.difference", "x", { area: "airwallex", ledger: "1", outside: "2" }).text).toMatch(/; Airwallex says 2\./);
    expect(words("reconcile.done", null, { checked: 10, differences: 0 })).toMatchObject({ tone: "ok", text: "Reconciled 10 money flows against Airwallex and Alta: no differences" });
    expect(words("reconcile.done", null, { checked: 10, differences: 2 })).toMatchObject({ tone: "refusal", text: "Reconciled 10 money flows against Airwallex and Alta: 2 difference(s)" });
  });

  it("an FX rate check states the gap and the limit, the default when none is recorded", () => {
    expect(words("fx.rate_checked", null, { buy: "EUR 100", market_cost: "USD 110", quote_cost: "USD 111", markup_bps: 90, limit_bps: 150 }).text).toMatch(/\(0\.90% apart; above 1\.50% it goes to the CFO\)$/);
    expect(words("fx.rate_checked", null, { buy: "EUR 100", markup_bps: 10, limit_bps: 0 }).text).toMatch(/0\.10% apart; above \d+\.\d{2}% it goes to the CFO\)$/);
  });
});

group("cards, payees, quarantine and passkeys", () => {
  it("a frozen card says whether the velocity limit or the emergency stop froze it; a thawed one is active again", () => {
    expect(words("card.frozen", null, { why: "velocity limit", agent: "sourcing", last4: "4242" }).text).toMatch(/^Velocity limit: Airwallex froze .*'s card •••• 4242$/);
    expect(words("card.frozen", null, { why: "stop", agent: "sourcing", last4: "4242" }).text).toMatch(/^Emergency stop: /);
    expect(words("card.thawed", null, { agent: "sourcing", last4: "4242" }).text).toMatch(/'s card •••• 4242 is active again$/);
    expect(words("velocity.tripped", null, { reason: "5 payments in a minute" }).tone).toBe("refusal");
  });

  it("bank-detail changes: requested, verified, changed", () => {
    expect(words("payee.change_requested", "PC-1", { vendor: "Acme", to_country: "DE", to_last4: "3000" }).text).toMatch(/^Acme's bank details: a change to a DE account ending 3000 was requested \(PC-1\)/);
    expect(words("payee.change_verified", "PC-1", { by: "Max", vendor: "Acme", how: "phone" }).text).toBe("Max verified PC-1 with Acme: phone");
    expect(words("payee.changed", null, { vendor: "Acme", to_last4: "3000", from_last4: "1111", proposal_id: "P-1" }).text).toBe("Acme is now paid to the account ending 3000 (was …1111), after verification and approval (P-1)");
  });

  it("quarantine: the receive policy's first transaction, a held payment and its return or acceptance", () => {
    expect(words("receive_policy.set", null, { txs: "0xa,0xb" }).tx).toBe("0xa");
    expect(words("receive_policy.set", null, {}).tx).toBeNull();
    expect(words("quarantine.held", null, { amount: "5", from: "0x1111111111111111111111111111111111111111", reason: "unknown", tx: "0xc" })).toMatchObject({ tone: "refusal", tx: "0xc" });
    expect(words("quarantine.held", null, { amount: "5", from: "x" }).tx).toBeNull();
    expect(words("quarantine.returned", null, { amount: "5", to: "x", proposal_id: "P-1" })).toMatchObject({ tone: "approval", tx: null });
    expect(words("quarantine.accepted", null, { amount: "5", proposal_id: "P-1", tx: "0xd" })).toMatchObject({ tone: "approval", tx: "0xd", text: "The held 5 test USD was accepted into the sweep wallet (P-1)" });
  });

  it("cards: a task card's single use, an agent's card, adoption, synced limits and an outside agent's request", () => {
    expect(words("card.issued", null, { agent: "task:T-1", task: "train", last4: "1111", limits: "120.00 / x", valid_until: "2026-11-30T00:00:00Z" }).text)
      .toBe("Airwallex issued a single-use train card •••• 1111 for task T-1: at most 120.00 EUR, once, until 2026-11-30");
    expect(words("card.issued", null, { agent: "sourcing", last4: "2222", limits: "" }).text).toMatch(/a virtual Visa card •••• 2222: /);
    expect(words("card.adopted", null, { agent: "sourcing", last4: "2222" }).text).toMatch(/'s Visa card •••• 2222 now follows the CFO policy$/);
    expect(words("card.limits_synced", null, { agent: "sourcing", last4: "2222", from: "", to: "" }).tone).toBe("approval");
    expect(words("agent.card_requested", null, { name: "Bot", per_tx: "50", monthly: "500", purpose: "ads", proposal_id: "P-1" }).text).toMatch(/^Bot, an outside agent .*approves P-1$/);
  });

  it("a card purchase: a task booking, a subscription by plan or description; approved, declined, merged, reversed", () => {
    expect(words("card.purchase_started", null, { agent: "task:T-1", merchant: "NS", amount: "120", last4: "1111" }).text).toMatch(/^Booking at NS for 120 EUR /);
    expect(words("card.purchase_started", null, { agent: "sourcing", merchant: "Data Co", plan: "pro", amount: "10", last4: "2" }).text).toBe("Subscribing to Data Co (pro) for 10 EUR on its card •••• 2");
    expect(words("card.purchase_started", null, { agent: "sourcing", merchant: "Data Co", description: "basic", amount: "10", last4: "2" }).text).toBe("Subscribing to Data Co (basic) for 10 EUR on its card •••• 2");
    expect(words("card.charge_approved", "auth_1", { amount: "10", merchant: "Data Co", agent: "sourcing", last4: "2" })).toMatchObject({ tone: "ok", awx_id: "auth_1" });
    expect(words("card.charge_declined", "", { amount: "10", merchant: "Data Co", agent: "sourcing", last4: "2", reason: "x" })).toMatchObject({ tone: "refusal", awx_id: null });
    expect(words("card.duplicate_merged", null, { amount: "10", currency: "EUR" }).text).toBe("A card authorisation recorded twice (Airwallex names it by two ids) was merged into one: 10 EUR");
    expect(words("card.charge_reversed", "auth_1", { amount: "10", merchant: "M", agent: "sourcing", last4: "2" })).toMatchObject({ tone: "refusal", awx_id: "auth_1" });
  });

  it("passkeys: an enrolment code, an enrolment by an unnamed person, a revoke, refusals with and without a subject", () => {
    expect(words("passkey.enrolment_opened", null).text).toBe("A one-time code to enrol a passkey was issued (valid 10 minutes)");
    expect(words("passkey.enrolled", "abcdef1234567890", { label: "" })).toMatchObject({ tone: "ok", text: "A person enrolled passkey abcdef12; approvals now need it" });
    expect(words("passkey.revoked", "abcdef1234567890", { replaced_by: "99999999aaaa" }).text).toBe("Passkey abcdef12 revoked: replaced by 99999999");
    expect(words("passkey.refused", "P-1", { reason: "counter" }).text).toBe("Passkey approval of P-1 refused: counter");
    expect(words("passkey.refused", "", { reason: "counter" }).text).toBe("Passkey approval refused: counter");
    expect(words("passkey.enrol_refused", null, { reason: "expired" })).toMatchObject({ tone: "refusal", text: "Passkey enrolment refused: expired" });
  });

  it("an event the feed does not know is shown by its name and subject, never dropped", () => {
    expect(words("brand.new_event", "X-1")).toMatchObject({ text: "brand.new_event X-1", tone: "info" });
    expect(words("brand.new_event", null).text).toBe("brand.new_event");
  });
});
