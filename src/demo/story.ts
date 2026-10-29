// The demo story (K5 replay): the steps of one recorded live run, read from its ledger, for the public demo page.
// Only public facts go in: amounts, outcomes, on-chain tx hashes, Airwallex sandbox ids, proposal ids and the first
// characters of hashes. No address of ours beyond what the chain shows, no key, no URL with a credential.
// A step whose events are missing from the ledger is left out, so the page never shows something that did not run.

import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { approverName, modelName } from "../dashboard/snapshot.js";
import { verifyAuditChain } from "../audit/log.js";

export const EXPLORER = "https://testnet.metalntwx.com/tx/";

export interface StoryFact {
  label: string;
  value: string;
  /** A public link (the Metal explorer) or null. */
  href: string | null;
}

export interface StoryStep {
  id: string;
  title: string;
  /** Plain words, one or two sentences. */
  text: string;
  tone: "ok" | "refusal" | "approval" | "info";
  /** Where the money or the decision lives. */
  rail: "Metal" | "Airwallex" | "CFO" | "Audit";
  facts: StoryFact[];
  /** A person's decision in this step, if any. */
  approval: { who: string; proposal: string; what: string } | null;
  at: string;
}

export interface Story {
  recorded_at: string;
  /** Which run this is (a name, never a path). */
  run: string;
  steps: StoryStep[];
  audit: { rows: number; head: string };
}

type Row = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string };
type P = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const TX = /^0x[0-9a-fA-F]{64}$/;
const txFact = (label: string, tx: unknown): StoryFact | null => (TX.test(str(tx)) ? { label, value: `${str(tx).slice(0, 10)}…${str(tx).slice(-4)}`, href: `${EXPLORER}${str(tx)}` } : null);
const fact = (label: string, value: unknown): StoryFact => ({ label, value: str(value), href: null });
const facts = (...f: (StoryFact | null)[]) => f.filter((x): x is StoryFact => x !== null);

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
      id: "buy", rail: "Metal", tone: "ok", at: bought.ts, approval: null,
      title: "Agents pay per request, each inside its own mandate",
      text: "Kestrel Quant's agent buys a EUR/USD tick from us over x402 and signs the order. Our sourcing agent buys the raw tick from Feedstock Labs, under a mandate that caps each payment and allows only that supplier.",
      facts: facts(
        fact("Sales in this run", `${sales} ticks at 0.05, then 0.07 *USDZ (testnet dollars)`),
        txFact("Kestrel's first payment to us", p(sold).tx),
        txFact("Our first purchase from the supplier", p(bought).tx),
        fact("Sourcing mandate", `${str(m.cap)} a payment, ${str(m.budget)} in total, Feedstock Labs only`),
      ),
    });
  }

  // 2. The chain refuses.
  const refused = first("upstream.refused", (_r, pl) => str(pl.reason) === "mandate_cap_exceeded");
  if (refused) {
    const options = (p(first("price_rise.options")).options as P[] | undefined) ?? [];
    steps.push({
      id: "refused", rail: "Metal", tone: "refusal", at: refused.ts, approval: null,
      title: "The supplier raises its price: the chain says no",
      text: "Feedstock Labs now asks 0.04 for a tick. The sourcing agent's payment is refused by the account itself, because the mandate's cap is 0.03. Our seller answers 503, so Kestrel is not charged. The treasury agent prices the options for the CFO.",
      facts: facts(
        fact("Refusal", "mandate_cap_exceeded (on chain, nothing moved)"),
        fact("Customer charged", "no"),
        ...options.filter((o) => o.sell !== null).map((o) => fact(`Option ${str(o.id)}`, `sell at ${str(o.sell)}, margin ${str(o.margin)} (${str(o.margin_percent)}%)`)),
      ),
    });
  }

  // 3. The CFO decides with Face ID; the mandates are replaced on chain.
  const replaced = all("mandate.replaced");
  const replacedBy = str(p(replaced[0]).proposal_id);
  if (replaced.length && approvals.has(replacedBy)) {
    steps.push({
      id: "faceid", rail: "CFO", tone: "approval", at: replaced[0]!.ts,
      approval: { who: approvals.get(replacedBy)!, proposal: replacedBy, what: replaced.map((r) => `${str(r.subject)} ${str(p(r).cap)} a payment, ${str(p(r).budget)} in total`).join("; ") },
      title: "The CFO approves the exact terms with Face ID",
      text: "Max reads the terms on his phone. Face ID signs their SHA-256 hash, and the runner checks that signature itself. Then the mandates are replaced in a safe order: treasury shrinks first, sourcing grows second. The old credential is refused from then on.",
      facts: facts(
        review(replacedBy) ? fact("Advice (not a decision)", review(replacedBy)) : null,
        ...replaced.map((r) => txFact(`${str(r.subject)} mandate replaced`, p(r).tx)),
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
      title: "One CFO policy, stricter than any mandate",
      text: "On his phone, the CFO sets the sourcing agent's limit to 0.03, below the mandate's 0.04. The next purchase is refused before anything is signed. The phone can only tighten the policy; loosening it needs a proposal and Face ID.",
      facts: facts(
        fact("Changed", `${str(p(policy).label)}: ${str(p(policy).from) || "no extra limit"} → ${str(p(policy).to)}`),
        policyRefusal ? fact("Next purchase", "refused before signing (policy_cap_exceeded)") : null,
      ),
    });
  }

  // 5. Company cards at Airwallex.
  const declined = first("card.charge_declined", (_r, pl) => str(pl.reason) === "LIMIT_EXCEEDED");
  const approvedCard = first("card.charge_approved");
  if (declined) {
    const synced = first("card.limits_synced", (_r, pl) => str(pl.agent) === str(p(declined).agent));
    const after = synced ? first("card.charge_approved", (r, pl) => r.seq > synced.seq && str(pl.agent) === str(p(declined).agent)) : undefined;
    // The raise: the policy change on this agent's card limit, and who approved it.
    const raised = synced ? [...rows].reverse().find((r) => r.seq < synced.seq && r.event === "policy.changed" && str(r.subject).startsWith(`card.${str(p(declined).agent)}.`)) : undefined;
    const raisedBy = raised ? approvals.get(str(p(raised).proposal_id)) : undefined;
    steps.push({
      id: "card", rail: "Airwallex", tone: after ? "approval" : "refusal", at: declined.ts,
      approval: raised && raisedBy ? { who: raisedBy, proposal: str(p(raised).proposal_id), what: `${str(p(raised).label)}: ${str(p(raised).from)} → ${str(p(raised).to)} EUR` } : null,
      title: "Every agent has its own company card, and the card holds the line",
      text: "Each agent has a virtual Visa card from Airwallex Issuing, with the limits the CFO policy sets. The sourcing agent tries a 45.00 plan on a card that allows 30.00 a purchase, and Airwallex itself declines it. A higher limit is a proposal the CFO approves with Face ID; then the card follows.",
      facts: facts(
        approvedCard ? fact("Approved by Airwallex", `${str(p(approvedCard).amount)} EUR at ${str(p(approvedCard).merchant)} (card •••• ${str(p(approvedCard).last4)})`) : null,
        fact("Declined by Airwallex", `${str(p(declined).amount)} EUR at ${str(p(declined).merchant)}: LIMIT_EXCEEDED`),
        synced ? fact("Limit raised after Face ID", `${str(p(synced).from)} → ${str(p(synced).to)} EUR`) : fact("Raise", "a proposal for the CFO (Face ID)"),
        after ? fact("Same purchase after the raise", `${str(p(after).amount)} EUR approved`) : null,
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
      text: "The earnings are swept on Metal and wait until the chain is final. Then they are booked in Airwallex as a deposit that names the transaction. Only the EUR shortfall is converted, on a locked quote above the USD floor. One Face ID approval covers the quote, the rate, both request ids, the payee, the fee ceiling and the floors. The SWIFT transfer carries the approval hash in its metadata.",
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
      text: "A fake invoice with changed bank details is blocked before Airwallex is called, and Opus explains how to verify it by phone. A planted 'pre-approved, skip the approval' line is treated as data. 'Refund all 12' becomes a proposal; only the 3 ticks proven wrong are refunded.",
      facts: facts(
        fraud ? fact("Invoice blocked", `${str(p(fraud).currency)} ${str(p(fraud).amount)} to IBAN …${str(p(fraud).iban_last4)}: bank details changed`) : null,
        findings[0] ? fact("Planted instruction ignored", `"${str(findings[0].excerpt).slice(0, 90)}"`) : null,
        refundAll ? fact("Refund all", `${refundAll} escalated${review(refundAll) ? `; ${review(refundAll)}` : ""}; never paid`) : null,
        refunds[0] ? txFact(`Refunds paid (${refunds.length}, each under its own payment id)`, p(refunds[0]).tx) : null,
      ),
    });
  }

  // Metal clearing (new on testnet): sales paid from a prepaid deposit, a receipt each, no transaction per query.
  const clearingSales = rows.filter((r) => r.event === "sale.delivered" && str(p(r).scheme) === "bajillion");
  const deposit = first("clearing.deposited");
  if (clearingSales.length && deposit) {
    steps.push({
      id: "clearing", rail: "Metal", tone: "ok", at: clearingSales[0]!.ts, approval: null,
      title: "Prepaid by Metal clearing: no transaction per query",
      text: "Kestrel deposits *USDZ into Metal's new pay-per-call clearing once, then pays each 0.07 query with a signed receipt. Our seller offers clearing only when it can deliver (a clearing payment counts before the seller can refuse), and the mandate route stays the fallback. Each receipt is checked again with Metal's clearing service.",
      facts: facts(
        txFact(`Kestrel's deposit (${str(p(deposit).amount)} *USDZ)`, p(deposit).tx),
        fact("Ticks sold by clearing", `${clearingSales.length}, a receipt each, no transaction per query`),
        fact("Note", "Metal's pay-per-call clearing is new on testnet (October 2026)"),
      ),
    });
  }

  // 8. The audit.
  const head = rows.at(-1);
  if (head) {
    const passkeyApprovals = [...approvals.values()].filter((v) => v.endsWith("Face ID")).length;
    steps.push({
      id: "audit", rail: "Audit", tone: "info", at: head.ts, approval: null,
      title: "Everything is in an audit log you can check yourself",
      text: "Every step is a row in a hash-chained, append-only log. npm run verify checks it again from public sources: the chain, every credential and payment, every Face ID signature against the pinned passkey, and every Airwallex booking.",
      facts: facts(
        fact("Audit rows", `${rows.length}, chain ${verifyAuditChain(db).ok ? "intact" : "BROKEN"}, head ${head.row_hash.slice(0, 12)}…`),
        fact("Approvals with Face ID", String(passkeyApprovals)),
        fact("Models", "Haiku classifies, Sonnet reads, Opus advises; code decides, a person approves"),
      ),
    });
  }

  return { recorded_at: now.toISOString(), run, steps, audit: { rows: rows.length, head: head?.row_hash ?? "" } };
}

/** The money figures a guest might ask about, for the page header. */
export const storyMoney = (cents: number) => fromCents(cents);
