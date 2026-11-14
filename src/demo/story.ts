// The demo story (K5 replay): the steps of one recorded live run, read from its ledger, for the public demo page.
// Only public facts go in: amounts, outcomes, on-chain tx hashes, Airwallex sandbox ids, proposal ids and the first
// characters of hashes. No address of ours beyond what the chain shows, no key, no URL with a credential.
// A step whose events are missing from the ledger is left out, so the page never shows something that did not run.

import { agentName, COMPANY } from "../config/brand.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { approverName, modelName } from "../dashboard/snapshot.js";
import { verifyAuditChain } from "../audit/log.js";

export const EXPLORER = "https://testnet.metalntwx.com/tx/";

export interface StoryFact {
  label: string;
  value: string;
  /** A public link (the Alta explorer) or null. */
  href: string | null;
}

export interface StoryStep {
  id: string;
  title: string;
  /** Plain words, one or two sentences, no jargon. */
  text: string;
  /** The technical detail, for whoever opens "How it works". */
  details?: string;
  /** A short label for the step's tab. */
  tab?: string;
  tone: "ok" | "refusal" | "approval" | "info";
  /** Where the money or the decision lives. */
  rail: "Alta" | "Airwallex" | "CFO" | "Audit";
  facts: StoryFact[];
  /** A person's decision in this step, if any. */
  approval: { who: string; proposal: string; what: string } | null;
  at: string;
}

export interface Story {
  recorded_at: string;
  /** Which run this is (a name, never a path). */
  run: string;
  /** The example company the run was recorded with (absent in recordings made before Purser's rename). */
  company?: string;
  steps: StoryStep[];
  audit: { rows: number; head: string };
}

type Row = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string };
type P = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const TX = /^0x[0-9a-fA-F]{64}$/;
const txFact = (label: string, tx: unknown): StoryFact | null => (TX.test(str(tx)) ? { label, value: `${str(tx).slice(0, 10)}…${str(tx).slice(-4)}`, href: `${EXPLORER}${str(tx)}` } : null);
const fact = (label: string, value: unknown): StoryFact => ({ label, value: str(value), href: null });
/** Plain amounts as money: "1850.00" reads "1,850.00" (never touches ids, hashes or links). */
const thousands = (t: string) => t.replace(/(?<![\w.])(\d{4,})(\.\d{2})(?!\d)/g, (_m, w: string, d: string) => `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${d}`);
/** Cut at a word boundary, never mid-word. */
const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, t.lastIndexOf(" ", n) > 0 ? t.lastIndexOf(" ", n) : n)}…`);
const facts = (...f: (StoryFact | null)[]) => f.filter((x): x is StoryFact => x !== null);

/** The sales and the prices they were paid at, from the ledger: the price changes only when the CFO approves an option. */
export function salesLine(db: DB, sales: number): string {
  const prices = (db.prepare("SELECT price_cents AS c, COUNT(*) AS n FROM sales GROUP BY price_cents ORDER BY MIN(rowid)").all() as { c: number; n: number }[])
    .filter((p) => p.c > 0).map((p) => `${p.n} at ${(p.c / 100).toFixed(2)}`);
  return prices.length ? `${sales} stock checks: ${prices.join(", then ")} *USDZ (testnet dollars)` : `${sales} stock checks`;
}

export function buildStory(db: DB, run: string, now = new Date()): Story {
  const rows = db.prepare("SELECT seq, ts, actor, event, subject, payload_json, row_hash FROM audit_log ORDER BY seq").all() as Row[];
  const p = (r: Row | undefined): P => (r ? (JSON.parse(r.payload_json) as P) : {});
  const first = (event: string, pred: (r: Row, pl: P) => boolean = () => true) => rows.find((r) => r.event === event && pred(r, p(r)));
  const all = (event: string) => rows.filter((r) => r.event === event);
  const approvals = new Map((db.prepare("SELECT proposal_id, approver, method FROM approvals WHERE decision = 'APPROVED'").all() as { proposal_id: string; approver: string; method: string }[])
    .map((a) => [a.proposal_id, approverName(a.approver, a.method)]));
  const review = (id: string) => {
    const e = (db.prepare("SELECT explanation FROM proposals WHERE proposal_id = ?").get(id) as { explanation: string | null } | undefined)?.explanation ?? "";
    const m = /^\[([^\]]+)\]\s+([A-Z_]+):/.exec(e);
    return m ? `${modelName(m[1]!) ?? m[1]} advised ${m[2]!.toLowerCase().replace(/_/g, " ")}` : null;
  };
  const steps: StoryStep[] = [];

  // 1. Agents pay and earn inside their mandates.
  const bought = first("upstream.paid");
  const sold = first("sale.delivered");
  if (bought && sold) {
    const sales = all("sale.delivered").length;
    const m = p(first("mandate.bound", (r) => r.subject === "sourcing"));
    steps.push({
      id: "buy", rail: "Alta", tone: "ok", at: bought.ts, approval: null,
      title: "Agents also pay per request, each inside its own limits",
      text: "A simulated retailer's agent (we run it) pays us per request for a live stock check, and our agent buys the stock data from the warehouse API. Each payment is a few cents in test dollars, and each agent can only pay within limits that its account enforces itself.",
      details: "Payments run on Alta testnet in *USDZ (test dollars) over x402: Summit Outfitters' agent buys a stock check and signs the order. Our sourcing agent buys the stock check from Stockline under an on-chain mandate: a cap per payment, a total budget, one allowed payee and an expiry.",
      facts: facts(
        fact("Sales in this run", salesLine(db, sales)),
        txFact("Summit's first payment to us", p(sold).tx),
        txFact("Our first purchase from the supplier", p(bought).tx),
        fact("Sourcing agent's mandate", `${str(m.cap)} a payment, ${str(m.budget)} in total, Stockline only`),
      ),
    });
  }

  // 2. The chain refuses.
  const refused = first("upstream.refused", (_r, pl) => /^mandate_cap_exceeded\b/.test(str(pl.reason)));
  if (refused) {
    const options = (p(first("price_rise.options")).options as P[] | undefined) ?? [];
    // With the agents on (src/agents/): the Sourcing agent's own message and the Treasury agent's own plan.
    const met = p(first("price_rise.met"));
    const plan = p(first("price_rise.plan"));
    const agents = str(met.source) === "claude" && str(plan.source) === "claude";
    steps.push({
      id: "refused", rail: "Alta", tone: "refusal", at: refused.ts, approval: null,
      title: "The supplier raises its price, and the payment is refused",
      text: agents
        ? "The supplier asks more than our agent may pay, so Alta refuses it against the on-chain mandate and nothing moves. Our customer is not charged either. The Sourcing agent tells the Treasury agent, which designs the answer inside the same 20.00; code checks the plan before it reaches the CFO."
        : "The supplier asks more than our agent may pay, so Alta refuses it against the on-chain mandate and nothing moves. Our customer is not charged either. Another agent works out the options and puts them to the CFO.",
      details: "Stockline now asks 0.04 for a stock check. The mandate's cap is 0.03, so the payment is refused on chain (mandate_cap_exceeded). Our seller answers 503, so Summit is not charged. The treasury agent prices the options with their margins.",
      facts: facts(
        fact("Refusal", "over the mandate's cap: refused on chain, nothing moved"),
        fact("Customer charged", "no"),
        ...options.filter((o) => o.sell !== null).map((o) => fact(`Option ${str(o.id)}`, `sell at ${str(o.sell)}, margin ${str(o.margin)} (${str(o.margin_percent)}%)`)),
        agents ? fact(`Sourcing agent (${modelName(str(met.model)) ?? "Claude"}) to Treasury`, `"${str(met.message)}"`) : null,
        agents ? fact(`Treasury agent (${modelName(str(plan.model)) ?? "Claude"}) planned`, `${(Array.isArray(plan.budgets) ? (plan.budgets as unknown[]).map((x) => str(x).replace(/ \(cap [^)]*\)/, "")) : []).join(" / ")}, accepted by code; "${str(plan.advice)}"`) : null,
      ),
    });
  }

  // 3. The CFO decides with Face ID; the mandates are replaced on chain.
  const replaced = all("mandate.replaced");
  const replacedBy = str(p(replaced[0]).proposal_id);
  if (replaced.length && approvals.has(replacedBy)) {
    steps.push({
      id: "faceid", rail: "CFO", tone: "approval", at: replaced[0]!.ts,
      approval: { who: approvals.get(replacedBy)!, proposal: replacedBy, what: replaced.map((r) => `${agentName(str(r.subject))} ${str(p(r).cap)} a payment, ${str(p(r).budget)} in total`).join("; ") },
      title: "The CFO approves the exact terms with Face ID",
      text: "The CFO reads the options on their phone and approves one with Face ID. Only exactly those terms can run; the agents' limits change in a safe order, and the old limit stops working at once.",
      details: `Face ID (a passkey) signs the SHA-256 hash of the exact terms, and the runner checks that signature itself. ${replaced.length > 1 ? `The mandates are replaced in a safe order, the shrinking budget first: ${replaced.map((r) => `the ${agentName(str(r.subject))}'s`).join(", then ")}, never over the 20.00 total.` : `Only the ${agentName(str(replaced[0]!.subject))}'s mandate changes; the total stays within 20.00.`} The old credential is refused from then on (mandate_revoked).`,
      facts: facts(
        review(replacedBy) ? fact("Advice (not a decision)", review(replacedBy)) : null,
        ...replaced.map((r) => txFact(`${agentName(str(r.subject))} mandate replaced`, p(r).tx)),
      ),
    });
  }

  // 4. The CFO policy: stricter than the mandate, set on the phone.
  const policy = first("policy.changed");
  const policyRefusal = first("upstream.refused", (_r, pl) => str(pl.reason).startsWith("policy_cap_exceeded"));
  if (policy) {
    const by = approvals.get(str(p(policy).proposal_id));
    steps.push({
      id: "policy", rail: "CFO", tone: "approval", at: policy.ts,
      approval: by ? { who: by, proposal: str(p(policy).proposal_id), what: `${str(p(policy).label)}: ${str(p(policy).to)}` } : null,
      title: "One CFO policy, stricter than any limit on chain",
      // Said the way it went: a raise (the agent asked, the CFO approved with Face ID) or a cut made on the phone.
      text: Number(str(p(policy).to)) > Number(str(p(policy).from) || "0")
        ? "The agent asked for a higher limit; the CFO approved that exact change with Face ID, and the new limit went to the card at Airwallex at once. The CFO policy sets the card limits and an optional stricter cap inside each mandate: loosening it always needs Face ID, tightening it can be done on the phone."
        : "On the phone the CFO lowers an agent's limit, and the next purchase over it is refused before anything is signed. The phone can only make the policy stricter; loosening it needs a proposal and Face ID.",
      details: `The CFO policy sits inside the on-chain mandates and the card limits, and is checked before any signature. Here: ${str(p(policy).label)} goes from ${str(p(policy).from) || "no extra limit"} to ${str(p(policy).to)}${policyRefusal ? ", and the next purchase over it is refused before signing (policy_cap_exceeded)" : ""}.`,
      facts: facts(
        fact("Changed", `${str(p(policy).label)}: ${str(p(policy).from) || "no extra limit"} → ${str(p(policy).to)}`),
        policyRefusal ? fact("Next purchase", "refused before signing (policy_cap_exceeded)") : null,
      ),
    });
  }

  // 5. Company cards at Airwallex.
  const declined = first("card.charge_declined", (_r, pl) => str(pl.reason) === "LIMIT_EXCEEDED");
  const approvedCard = first("card.charge_approved");
  const wrongKind = first("card.charge_declined", (_r, pl) => str(pl.reason) === "MERCHANT_CATEGORY_NOT_ALLOWED");
  if (declined) {
    const synced = first("card.limits_synced", (_r, pl) => str(pl.agent) === str(p(declined).agent));
    const after = synced ? first("card.charge_approved", (r, pl) => r.seq > synced.seq && str(pl.agent) === str(p(declined).agent)) : undefined;
    // The raise: the policy change on this agent's card limit, and who approved it.
    const raised = synced ? [...rows].reverse().find((r) => r.seq < synced.seq && r.event === "policy.changed" && str(r.subject).startsWith(`card.${str(p(declined).agent)}.`)) : undefined;
    const raisedBy = raised ? approvals.get(str(p(raised).proposal_id)) : undefined;
    steps.push({
      id: "card", rail: "Airwallex", tone: after ? "approval" : "refusal", at: declined.ts,
      approval: raised && raisedBy ? { who: raisedBy, proposal: str(p(raised).proposal_id), what: `${str(p(raised).label)}: ${str(p(raised).from)} → ${str(p(raised).to)} EUR` } : null,
      title: "Every AI agent gets its own company card, with limits the CFO sets",
      text: "Our sourcing agent pays for a software plan with its own card: approved. Then it tries a more expensive plan, over its limit, and the card is declined by Airwallex itself. The agent asks for more; the CFO approves with Face ID; the card follows, and the same purchase goes through.",
      details: "Virtual Visa cards from Airwallex Issuing (sandbox), one per agent. The limits come from the CFO policy; they are synced to the card at Airwallex and read back, so Airwallex declines anything over them (LIMIT_EXCEEDED), whatever the agent does. The raise is a policy change approved with Face ID. In the sandbox the merchant's charge is simulated; the approve or decline is Airwallex's own.",
      facts: facts(
        approvedCard ? fact("Approved by Airwallex", `${str(p(approvedCard).amount)} EUR at ${str(p(approvedCard).merchant)} (card •••• ${str(p(approvedCard).last4)})`) : null,
        fact("Declined by Airwallex", `${str(p(declined).amount)} EUR at ${str(p(declined).merchant)}: LIMIT_EXCEEDED`),
        synced ? fact("Limit raised after Face ID", `${str(p(synced).from)} → ${str(p(synced).to)} EUR`) : fact("Raise", "a proposal for the CFO (Face ID)"),
        after ? fact("Same purchase after the raise", `${str(p(after).amount)} EUR approved`) : null,
        wrongKind ? fact("Wrong kind of shop", `${str(p(wrongKind).amount)} EUR at ${str(p(wrongKind).merchant)} on the ${agentName(str(p(wrongKind).agent))}'s card: declined by Airwallex (MERCHANT_CATEGORY_NOT_ALLOWED)`) : null,
        fact("Note", "In the sandbox the merchant's charge is simulated; the approve or decline is Airwallex's own"),
      ),
    });
  }

  // 6. The euro bill: sweep, deposit, conversion, SWIFT.
  const sweep = first("sweep.paid");
  const transfer = first("transfer.created");
  const fee = first("transfer.fee");
  const paidStatus = first("transfer.status", (_r, pl) => str(pl.status) === "PAID");
  const invoiceApproval = (db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'invoice_payment' AND status = 'EXECUTED' ORDER BY created_at LIMIT 1").get() as { proposal_id: string } | undefined)?.proposal_id;
  if (transfer && invoiceApproval) {
    const fx = first("fx.converted");
    steps.push({
      id: "swift", rail: "Airwallex", tone: "ok", at: transfer.ts,
      approval: approvals.has(invoiceApproval) ? { who: approvals.get(invoiceApproval)!, proposal: invoiceApproval, what: `pay ${str(p(transfer).amount)} by SWIFT` } : null,
      title: "A euro bill paid through Airwallex, exactly as approved",
      text: "Earnings are booked at Airwallex as a simulated sandbox deposit (no test USD moves). A supplier's euro invoice is paid by bank transfer: only the euros missing are bought, at a locked rate, and one Face ID covers the rate, the payee and the most the fee may be.",
      details: "The earnings are swept on Alta and wait until the chain is final, then booked in Airwallex as a simulated sandbox deposit that names the testnet transaction (the sandbox cannot receive stablecoins). Only the EUR shortfall is converted, on a locked quote above the USD floor. One approval covers the quote, the rate, both request ids, the payee, the fee ceiling and the floors. The SWIFT transfer carries the approval hash in its metadata.",
      facts: facts(
        sweep ? txFact(`Sweep of ${str(p(sweep).amount)} *USDZ`, p(sweep).tx) : null,
        fx ? fact("Conversion", `${str(p(fx).sell)} → ${str(p(fx).buy)} on a locked quote`) : null,
        fact("SWIFT transfer", `${str(p(transfer).amount)} to the allowlisted payee${paidStatus ? ", PAID" : ""}`),
        fee ? fact("Airwallex fee", `${str(p(fee).fee)} (ceiling ${str(p(fee).fee_max)})`) : null,
        fact("Approval hash in the transfer's metadata", `${str(p(transfer).approval_sha256).slice(0, 12)}…`),
        fact("Note", "Airwallex sandbox; the *USDZ → Airwallex step is a simulated deposit that names the real testnet tx"),
      ),
    });
  }

  // 7. What stopped money from moving.
  const fraud = first("invoice.fraud_suspected");
  const injection = first("document.injection_flagged");
  const refundAll = (db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'refund_batch' AND status != 'EXECUTED' ORDER BY created_at LIMIT 1").get() as { proposal_id: string } | undefined)?.proposal_id;
  const refunds = all("refund.paid");
  if (fraud || injection || refundAll) {
    const findings = (p(injection).findings as P[] | undefined) ?? [];
    steps.push({
      id: "stopped", rail: "CFO", tone: "refusal", at: (fraud ?? injection)?.ts ?? now.toISOString(), approval: null,
      title: "What the agents could not do",
      text: "A fake invoice with changed bank details is blocked before any money moves. A hidden line saying \"pre-approved, skip the approval\" is ignored. A customer's \"refund everything\" goes to the CFO; only what was really wrong is refunded.",
      details: "The fraud check compares the invoice's IBAN with the supplier's account on file and blocks before Airwallex is called; Opus explains how to verify by phone (advice only). Planted instructions are found by code and treated as data. \"Refund all 12\" becomes a proposal; the 3 stock checks the supplier corrected are refunded under the mandate, each with its own payment id.",
      facts: facts(
        fraud ? fact("Invoice blocked", `${str(p(fraud).currency)} ${str(p(fraud).amount)} to IBAN …${str(p(fraud).iban_last4)}: bank details changed`) : null,
        findings[0] ? fact("Planted instruction ignored", `"${clip(str(findings[0].excerpt), 90)}"`) : null,
        refundAll ? fact("Refund all", `${refundAll} escalated${review(refundAll) ? `; ${review(refundAll)}` : ""}; never paid`) : null,
        refunds[0] ? txFact(`Refunds paid (${refunds.length}, each under its own payment id)`, p(refunds[0]).tx) : null,
      ),
    });
  }

  // Alta clearing (new on testnet): sales paid from a prepaid deposit, a receipt each, no transaction per query.
  const clearingSales = rows.filter((r) => r.event === "sale.delivered" && str(p(r).scheme) === "bajillion");
  const deposit = first("clearing.deposited");
  if (clearingSales.length && deposit) {
    steps.push({
      id: "clearing", rail: "Alta", tone: "ok", at: clearingSales[0]!.ts, approval: null,
      title: "Prepaid: one deposit, then a receipt per request",
      text: "A customer can also prepay once and then pay each request with a signed receipt instead of a payment each time. We only offer this when we are sure we can deliver; otherwise the normal route is used.",
      details: "Alta's pay-per-call clearing (scheme bajillion, new on testnet in October 2026): Summit deposits *USDZ once and pays each 0.07 query with a receipt; there is no transaction per query. A clearing payment counts before the seller can refuse, so our seller offers it only after a free check; the mandate route is the fallback. Each receipt is checked again with Alta's clearing service.",
      facts: facts(
        txFact(`Summit's deposit (${str(p(deposit).amount)} *USDZ)`, p(deposit).tx),
        fact("Stock checks sold by clearing", `${clearingSales.length}, a receipt each, no transaction per query`),
        fact("Note", "Alta's pay-per-call clearing is new on testnet (October 2026)"),
      ),
    });
  }

  // An outside agent (P1): it connects over MCP, asks for a card, pays within it, and asks for more.
  const asked = first("agent.card_requested");
  const issued = asked ? first("card.issued", (_r, pl) => str(pl.agent) === str(p(asked).agent_id)) : undefined;
  if (asked && issued) {
    const a = p(asked);
    const id = str(a.agent_id);
    // A charge recorded twice and merged (card.duplicate_merged) counts once.
    const merged = new Set(all("card.duplicate_merged").map((r) => r.subject));
    const charges = rows.filter((r) => r.event === "card.charge_approved" && r.actor === id && !merged.has(r.subject));
    const spent = charges.reduce((c, r) => c + Math.round(Number(str(p(r).amount)) * 100), 0);
    const raise = first("policy.changed", (_r, pl) => str(pl.key) === `card.${id}.per_tx`);
    const cardApproval = approvals.get(str(a.proposal_id));
    steps.push({
      id: "outside", rail: "CFO", tone: "approval", at: asked.ts,
      approval: cardApproval ? { who: cardApproval, proposal: str(a.proposal_id), what: `issue ${str(a.name)} a company card` } : null,
      title: "Any AI agent, under the same CFO policy",
      text: "An AI agent from another company connects to us. It can ask for a card, pay with it and ask for more, and nothing else: it gets a card only after the CFO approves with Face ID, the bank enforces its limits, and more is another Face ID.",
      details: "A Claude agent (Sonnet) playing Acme Research connects through the agent API, an MCP server with four tools: request_company_card, pay_with_card, request_limit_raise, company_card. None of them approves anything.",
      facts: facts(
        fact("Agent", `${str(a.name)} (${id}), connected over MCP`),
        fact("Card", `Visa •••• ${str(p(issued).last4)}: ${str(a.per_tx)} per purchase, ${str(a.monthly)} a month`),
        charges.length ? fact("Paid on its card", `${fromCents(spent)} EUR (${charges.length} charge${charges.length === 1 ? "" : "s"}, approved by Airwallex)`) : null,
        raise ? fact("Raise it asked for", `${str(p(raise).from)} → ${str(p(raise).to)} per purchase, ${str(p(raise).proposal_id)}${approvals.has(str(p(raise).proposal_id)) ? `, ${approvals.get(str(p(raise).proposal_id))}` : ""}`) : null,
      ),
    });
  }

  // 8. The emergency stop, when the run used it: one Face ID froze every agent and every card.
  const stopOn = first("policy.changed", (r, pl) => r.subject === "freeze" && str(pl.to) === "on");
  if (stopOn) {
    const stopOff = first("policy.changed", (r, pl) => r.seq > stopOn.seq && r.subject === "freeze" && str(pl.to) !== "on");
    const by = approvals.get(str(p(stopOn).proposal_id));
    steps.push({
      id: "stop", rail: "CFO", tone: "approval", at: stopOn.ts,
      approval: by ? { who: by, proposal: str(p(stopOn).proposal_id), what: "Emergency stop: on" } : null,
      title: "One Face ID freezes every agent and every card",
      text: "The CFO presses the emergency stop and confirms with Face ID. Every agent payment is refused from then on, and every company card is frozen at Airwallex. Turning it off again is another Face ID.",
      details: "The stop is a CFO policy rule. The runner refuses every agent payment before signing while it is on, and sets each card to INACTIVE at Airwallex. Only an approved change, with Face ID, turns it off.",
      facts: facts(
        fact("Stop on", `${new Date(stopOn.ts).toISOString().slice(11, 16)} UTC${by ? `, ${by}` : ""}`),
        stopOff ? fact("Stop off", `${new Date(stopOff.ts).toISOString().slice(11, 16)} UTC${approvals.has(str(p(stopOff).proposal_id)) ? `, ${approvals.get(str(p(stopOff).proposal_id))}` : ""}`) : null,
      ),
    });
  }

  // 9. The audit.
  const head = rows.at(-1);
  if (head) {
    const passkeyApprovals = [...approvals.values()].filter((v) => v.endsWith("Face ID")).length;
    steps.push({
      id: "audit", rail: "Audit", tone: "info", at: head.ts, approval: null,
      title: "Everything is in an audit log you can check yourself",
      text: "Every step is written to a log that cannot be changed without it showing. One command checks it all again: the payments on chain, every Face ID signature and every Airwallex deposit, conversion and transfer.",
      details: "A hash-chained, append-only audit log. npm run verify re-checks it: the chain, every credential and payment and every passkey signature against the pinned public key from public sources; the Airwallex deposits, conversions and transfers with read-only API keys.",
      facts: facts(
        fact("Audit rows", `${rows.length}, chain ${verifyAuditChain(db).ok ? "intact" : "BROKEN"}, head ${head.row_hash.slice(0, 12)}…`),
        fact("Approvals with Face ID", String(passkeyApprovals)),
        fact("Models", "Haiku classifies, Sonnet reads, Opus advises; Alta and Airwallex enforce the limits, a person approves"),
      ),
    });
  }

  // The story opens with the company card (the product), then the per-request payments on Alta.
  const ORDER = ["card", "buy", "refused", "faceid", "policy", "swift", "stopped", "stop", "clearing", "outside", "audit"];
  steps.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const TABS: Record<string, string> = { card: "Company card", buy: "Pay per request", refused: "Refused", faceid: "Face ID", policy: "CFO policy", swift: "Euro bill", stopped: "Blocked", stop: "Emergency stop", clearing: "Prepaid", outside: "Outside agent", audit: "Audit" };
  for (const st of steps) {
    st.tab = TABS[st.id] ?? st.rail;
    // Amounts read as money: thousands separators on plain amounts (never on ids, hashes or links).
    for (const f of st.facts) if (!f.href) f.value = thousands(f.value);
    if (st.approval) st.approval.what = thousands(st.approval.what);
  }
  return { recorded_at: now.toISOString(), run, company: COMPANY, steps, audit: { rows: rows.length, head: head?.row_hash ?? "" } };
}

/** The money figures a guest might ask about, for the page header. */
export const storyMoney = (cents: number) => fromCents(cents);
