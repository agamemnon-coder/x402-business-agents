// npm run s2 [-- --resume-only | --dispute D-xxxxxxxx | --resolve <id> --note "…"]: scenario S2, the disputed batch, live on Metal testnet.
// --resolve (late review, L2): the CFO marks a dispute it holds (dispute.escalated, not decided) resolved, with a note;
// moves no money, once. The only way to close a D-ev<id> dispute (no email code can read), and it clears /health.
// --resume-only (the runner's start) only carries out a decision a restart cut off; it never opens or decides a dispute,
// and leaves one whose dispute is with the CFO to a person (--dispute <id> carries that out).
// --dispute (the Support agent's settle_dispute, holdout H9): settles the dispute with that id that opened in this world,
// read from its dispute.opened event; an id no event names is refused (unless only its recorded decision is carried
// out). Without either, a person's run settles the fixture's dispute (fixtures/summit-dispute-email.txt), as before.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";
import { checkData, refundsFor, salesFound, verifyOrders, type DataVerdict, type DisputeClaims, type OrderEvidence } from "../agents/disputes.js";
import { auditSettlement, carryOut, decisionOf, decisionSummary, finished, legacyDecision, openDecisions, recordDecision, type DecisionAudit, type DecisionExec, type DecisionPlan, type Part } from "../agents/disputeDecision.js";
import { codeMayCarryOut, decideHandledBefore, decideNoneSold, disputeKey, disputeLimits, escalatedAt, handledElsewhere, openedDispute, resolveByCfo } from "../agents/disputeSource.js";
import { attachReview } from "../claude/review.js";
import { agentsOn } from "../agents/loop.js";
import { settleDispute } from "../agents/supportAgent.js";
import { Tools } from "../claude/tools.js";
import { REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS } from "../config/policy.js";
import { openDb } from "../db/open.js";
import type { RefundBatchTerms } from "../executors/refundBatch.js";
import { refundSale } from "../executors/refunds.js";
import { AUTO_REFUND, withOrigin, type Origin } from "../provenance/origin.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA } from "../lib/terms.js";
import { activeMandate, mandateSpent } from "../metal/mandate.js";
import { EXPLORER_TX } from "../metal/network.js";
import { createProposal, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { planRefunds } from "../policy/refunds.js";
import { refundThresholds } from "../policy/rules.js";
import { addresses } from "../world/runtime.js";
import { PROPOSAL_TTL_MS } from "../config/policy.js";

const db = openDb();
if (process.argv.includes("--resolve")) {
  const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] ?? "" : ""; };
  const id = arg("--resolve");
  try {
    resolveByCfo(db, id, arg("--note"));
    console.log(`RESOLVED         ${id} by the CFO: ${arg("--note").trim().slice(0, 500)} (nothing paid or proposed; the dispute is decided, its /health alert clears)`);
    process.exit(0);
  } catch (e) {
    console.log(`STOP             ${JSON.stringify(id.slice(0, 40))}: ${(e as Error).message}`);
    process.exit(2);
  }
}
const fixture = (f: string) => resolve(import.meta.dirname, "../../fixtures", f);
const fixtureEmail = readFileSync(fixture("summit-dispute-email.txt"), "utf8");
const correctionText = readFileSync(fixture("stockline-corrections.txt"), "utf8");
const FIXTURE_REF = "fixtures/summit-dispute-email.txt";

/** The dispute this run handles: its id, its email as received, and where that email is. */
function which(): { disputeId: string; email: string; ref: string } {
  const at = process.argv.indexOf("--dispute");
  // The fixture's own dispute, or one that opened in this world (its newest dispute.opened event), by id.
  const source = (id: string) => {
    const opened = openedDispute(db, id);
    if (opened) return { disputeId: id, email: opened.email, ref: `world event ${opened.eventId} (dispute.opened from ${opened.customer})` };
    return id === disputeKey(fixtureEmail) ? { disputeId: id, email: fixtureEmail, ref: FIXTURE_REF } : null;
  };
  if (at >= 0) {
    const id = process.argv[at + 1] ?? "";
    const opened = /^D-[0-9a-f]{8}$/.test(id) ? openedDispute(db, id) : null;
    if (opened) return { disputeId: id, email: opened.email, ref: `world event ${opened.eventId} (dispute.opened from ${opened.customer})` };
    // No event names it: only a decision already recorded on it is carried out (or reported); nothing new is decided.
    if (/^D-[0-9a-f]{8}$/.test(id) && (decisionOf(db, id) || legacyDecision(db, id))) return source(id) ?? { disputeId: id, email: "", ref: "the dispute's stored record" };
    console.log(`STOP             no dispute ${JSON.stringify(id.slice(0, 40))} opened in this world (no dispute.opened event names it); nothing is settled`);
    process.exit(2);
  }
  if (process.argv.includes("--resume-only")) {
    // The newest decision a restart cut off, whichever dispute it is; else the fixture's (nothing to carry out).
    // A decision with refunds or proposals left (DECIDED) before one only waiting for its settlement row.
    // Not one whose dispute is with the CFO with refunds or proposals left (review 2, LOW 4): a person carries it out.
    const open = openDecisions(db);
    for (const d of open.filter((x) => !codeMayCarryOut(db, x))) {
      console.log(`WITH THE CFO     ${d.dispute_id}: sent to the CFO at ${escalatedAt(db, d.dispute_id)}; code does not carry out its decision on its own: npm run s2 -- --dispute ${d.dispute_id} carries it out (nothing is decided again)`);
    }
    const undone = open.filter((x) => codeMayCarryOut(db, x)).sort((a, b) => (a.status === b.status ? b.decided_at.localeCompare(a.decided_at) : a.status === "DECIDED" ? -1 : 1))[0];
    if (undone) return source(undone.dispute_id) ?? { disputeId: undone.dispute_id, email: "", ref: "the dispute's stored record" };
  }
  return { disputeId: disputeKey(fixtureEmail), email: fixtureEmail, ref: FIXTURE_REF };
}
const { disputeId, email, ref: emailRef } = which();
// The email's hash: from the email, or (a decision carried out with no event or fixture to read it from) as stored.
const emailSha = email ? sha256Hex(email) : (db.prepare("SELECT email_sha256 FROM disputes WHERE dispute_id = ?").get(disputeId) as { email_sha256: string } | undefined)?.email_sha256 ?? sha256Hex("");

console.log(`GOAL             settle ${disputeId}, the customer's dispute, from evidence: refund what was wrong, nothing else`);
const tools = new Tools(db);
// A dispute is decided once (src/agents/disputeDecision.ts). Decided before decisions were recorded: left as it is.
const legacy = decisionOf(db, disputeId) ? null : legacyDecision(db, disputeId);
if (legacy) {
  console.log(`ALREADY DECIDED  ${disputeId}: ${legacy}. Nothing is decided again.`);
  process.exit(0);
}
// Decided already: carry out what is left of THAT decision (a restart cut it off), from the ledger, and stop there.
const prior = decisionOf(db, disputeId);
// --resume-only (the runner's start): finish a decision that was cut off; never open or decide a dispute.
if (process.argv.includes("--resume-only") && (!prior || finished(prior))) {
  console.log(`RESUME           ${disputeId}: ${prior ? "carried out already" : "no decision to carry out"}; nothing to do`);
  process.exit(0);
}
if (prior && finished(prior)) {
  console.log(`ALREADY DECIDED  ${disputeId}: ${decisionSummary(prior)}. Nothing is decided again.`);
  process.exit(0);
}
const addr = addresses(db);
// The automatic limits: per refund as the policy says; per dispute, shared with this customer's other disputes.
const limitsNow = () => disputeLimits(refundThresholds(db), db, addr.customer, disputeId);

let claims: DisputeClaims;
let sales: ReturnType<typeof salesFound>["sales"];
let orders: OrderEvidence[];
let verdicts: DataVerdict[];
let notSold = "";
if (prior) {
  // Everything the decision was made on was stored before it was made; nothing is read again from Claude or the chain.
  const stored = db.prepare("SELECT claims_json, evidence_json, verdicts_json FROM disputes WHERE dispute_id = ?").get(disputeId) as { claims_json: string | null; evidence_json: string | null; verdicts_json: string | null } | undefined;
  if (!stored?.claims_json || !stored.evidence_json || !stored.verdicts_json) throw new Error(`dispute ${disputeId} has a decision but not the evidence it was made on`);
  claims = JSON.parse(stored.claims_json) as DisputeClaims;
  const found = salesFound(db, claims.sale_refs, addr.customer);
  sales = found.sales;
  if (found.missing.length) notSold = ` (${found.missing.length} of them never sold: #${found.missing.join(", #")}; nothing was paid for those, so nothing is refunded)`;
  orders = JSON.parse(stored.evidence_json) as OrderEvidence[];
  verdicts = JSON.parse(stored.verdicts_json) as DataVerdict[];
  console.log(`RESUME           ${disputeId}: ${decisionSummary(prior)}`);
} else {
  const kind = await tools.classify(email);
  if (kind.value.kind !== "dispute") throw new Error(`escalate: expected a dispute, ${kind.source} read ${kind.value.kind}`);
  const read = await tools.dispute(email);
  claims = read.value;
  db.prepare("INSERT OR IGNORE INTO disputes (dispute_id, customer, email_sha256, claims_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(disputeId, addr.customer, emailSha, JSON.stringify(claims), new Date().toISOString());
  console.log(`                 read by ${read.source === "claude" ? `${kind.model} (classify) and ${read.model} (extract); the planted instruction is data, not an order` : `the deterministic parser (${read.note})`}`);
  console.log(`NEW INFORMATION  ${claims.customer}: claims ${claims.claims.join(" + ")} on stock checks #${claims.sale_refs[0]}-#${claims.sale_refs.at(-1)}; asks ${claims.requested_action}`);

  const found = salesFound(db, claims.sale_refs, addr.customer);
  const missing = found.missing;
  sales = found.sales;
  // A number we never sold (a live world: that query failed, or never ran) was never paid: nothing to refund for it.
  notSold = missing.length ? ` (${missing.length} of them never sold: #${missing.join(", #")}; nothing was paid for those, so nothing is refunded)` : "";
  if (missing.length) console.log(`NOT SOLD         #${missing.join(", #")}: no delivered sale to this customer under that number; it paid nothing for it, nothing to refund`);
  // An order an earlier dispute already refunded or put to the CFO is not decided again (one order, once).
  const elsewhere = handledElsewhere(db, sales.map((x) => x.sale_id), disputeId);
  // Who the dispute is from, as the dashboard names it (its dispute.opened event), else as the email says.
  const who = { id: disputeId, customer: openedDispute(db, disputeId)?.customer ?? claims.customer };
  if (elsewhere.size) {
    const handled = sales.filter((x) => elsewhere.has(x.sale_id)).map((x) => `#${x.seq} (${elsewhere.get(x.sale_id)})`);
    console.log(`HANDLED BEFORE   ${handled.join(", ")}: not decided again`);
    sales = sales.filter((x) => !elsewhere.has(x.sale_id));
    if (sales.length === 0) {
      // Decided once with nothing new, and recorded as dispute.handled_before (the dashboard shows it). Another
      // process that decided it first keeps its decision (review 2, LOW 5): said so, nothing done here.
      if (await decideHandledBefore(db, who, handled)) console.log(`DECIDED          ${disputeId}: every order in it was handled by an earlier dispute; nothing new is refunded or sent to the CFO`);
      else console.log(`ALREADY DECIDED  ${disputeId}: ${decisionSummary(decisionOf(db, disputeId)!)}. Nothing is decided again.`);
      process.exit(0);
    }
  }
  if (sales.length === 0) {
    console.log("NOTHING TO SETTLE none of the disputed numbers was sold");
    // Handed to the CFO (dispute.escalated), then decided once with nothing to refund: never settled again, and the
    // disputes after it are not held up.
    if (await decideNoneSold(db, who)) console.log(`TO THE CFO       ${disputeId}: no disputed number matched a sale; recorded as dispute.escalated`);
    else console.log(`ALREADY DECIDED  ${disputeId}: ${decisionSummary(decisionOf(db, disputeId)!)}. Nothing is decided again.`);
    process.exit(0);
  }
  orders = await verifyOrders(sales, addr.customer);
  console.log(`\nEVIDENCE         stock check  signed order  within mandate  payer = Summit  tx`);
  for (const o of orders) {
    console.log(`                 #${String(o.seq).padEnd(4)} ${(o.signed_order ? "yes" : "NO").padEnd(13)} ${(o.within_mandate ? "yes" : "NO").padEnd(15)} ${(o.payer_is_customer ? "yes" : "NO").padEnd(16)} ${EXPLORER_TX}${o.tx}`);
  }
  const allPlaced = orders.every((o) => o.signed_order && o.within_mandate && o.payer_is_customer);
  console.log(`                 ${orders.filter((o) => o.signed_order && o.within_mandate && o.payer_is_customer).length}/${orders.length} orders signed by Summit's mandate key, inside the mandate Summit's owner bound (${orders[0]?.mandate_bound_tx.slice(0, 12)}…)`);
  console.log(`                 claim "never placed": ${allPlaced ? "REJECTED with proof" : "NOT disproven for every order"}`);

  const corrRead = await tools.corrections(correctionText);
  const corrections = corrRead.value;
  verdicts = checkData(sales, corrections);
  console.log(`\nDATA CHECK       stock check  field  delivered  corrected  delta`);
  for (const v of verdicts) console.log(`                 #${String(v.seq).padEnd(4)} ${v.field.padEnd(6)} ${v.delivered}    ${v.corrected}    ${v.delta_units > 0 ? "+" : ""}${(v.delta_units / 100_000).toFixed(5)}${v.refund ? "  -> refund" : ""}`);
  // The evidence the decision is made on, stored before it is made: a restart carries the decision out from this.
  // Never once a decision was recorded on it (a second s2 running at the same time must not rewrite the winner's evidence).
  db.prepare("UPDATE disputes SET evidence_json = ?, verdicts_json = ? WHERE dispute_id = ? AND NOT EXISTS (SELECT 1 FROM dispute_decisions WHERE dispute_id = ?)").run(JSON.stringify(orders), JSON.stringify(verdicts), disputeId, disputeId);
}

const refunds = refundsFor(sales, verdicts);
// No delivered sale wrong (dry-125: the corrected numbers were never sold) is a plan of its own: refund nothing.
const route = planRefunds(refunds.map((r) => r.amount_cents), limitsNow());
const evidence = [
  { type: "dispute_email", ref: emailRef, sha256: emailSha },
  { type: "supplier_corrections", ref: "fixtures/stockline-corrections.txt", sha256: sha256Hex(correctionText) },
  { type: "order_verification", ref: `${orders.length} orders, verifyMandatePayment`, sha256: sha256Hex(JSON.stringify(orders)) },
  { type: "data_check", ref: `${verdicts.length} fields compared`, sha256: sha256Hex(JSON.stringify(verdicts)) },
];

if (!prior) console.log(route.route === "none" ? "\nREVISED DECISION refund nothing: code's data check finds no delivered sale wrong" : `\nREVISED DECISION refund ${refunds.length} stock checks (${refunds.map((r) => `#${r.seq}`).join(", ")}), ${fromCents(refunds.reduce((s, r) => s + r.amount_cents, 0))} in total: ${route.route === "auto" ? `within the automatic limits (${fromCents(REFUND_AUTO_EACH_CENTS)} each, ${fromCents(REFUND_AUTO_PER_DISPUTE_CENTS)} per dispute)` : route.reason}`);

function refundProposal(items: typeof refunds, reason: string) {
  const id = nextProposalId(db);
  const terms: RefundBatchTerms = {
    schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id,
    expires_at: new Date(Date.now() + PROPOSAL_TTL_MS * 6).toISOString().replace(/\.\d{3}Z$/, "Z"),
    dispute_id: disputeId, customer: addr.customer.toLowerCase(),
    refunds: items.map((r) => ({ sale_id: String(r.sale_id), payment_id: `refund-${r.sale_id}`, to: addr.customer.toLowerCase(), amount: fromCents(r.amount_cents) })),
    total: fromCents(items.reduce((s, r) => s + r.amount_cents, 0)), reason, evidence,
  };
  return createProposal(db, { terms, createdBy: "support", evidence }, new Date());
}

const bySeq = new Map(sales.map((s) => [s.seq, s]));
const itemsOf = (seqs: number[]) => seqs.map((seq) => { const sale = bySeq.get(seq)!; return { sale_id: sale.sale_id, seq, amount_cents: sale.price_cents }; });
const verified = orders.filter((o) => o.signed_order && o.within_mandate && o.payer_is_customer).length;
/** D24: code's own rule decided these proposals (the CFO decides them with Face ID). */
const CODE_PROPOSES: Origin = { actor: "code", rule: "the dispute desk's settlement: what the automatic limits do not cover goes to the CFO", agent: "support" };
const ESCALATE_REASON = "customer request: refund all; evidence shows the orders were placed and the data correct";
const APPROVAL_REASON = "wrong data per supplier correction";
// The proposal for a part of the decision already in the ledger (made before a restart cut off noting it), any status.
const HANDOVER_REASON = "automatic refund not paid";
const REASON_LIKE: Record<Part, string> = { escalate: "customer request%", approval: APPROVAL_REASON, handover: `${HANDOVER_REASON}%` };
const existing = (part: Part) => (db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'refund_batch' AND json_extract(terms_json, '$.dispute_id') = ? AND json_extract(terms_json, '$.reason') LIKE ? ORDER BY created_at LIMIT 1").get(disputeId, REASON_LIKE[part]) as { proposal_id: string } | undefined)?.proposal_id ?? null;
const refundOne = async (seq: number, opts?: { retry?: boolean }) => {
  const sale = bySeq.get(seq);
  if (!sale) throw new Error(`#${seq} is not a delivered sale to this customer`);
  const r = await refundSale(db, { sale_id: sale.sale_id, amount_cents: sale.price_cents, to: addr.customer as Address, dispute_id: disputeId }, { retry: opts?.retry === true });
  return { outcome: r.outcome, already: r.already, ...(r.tx ? { tx: `${EXPLORER_TX}${r.tx}` } : {}), ...(r.reason ? { reason: r.reason } : {}) };
};

const reasonFor = (part: Part, seqs: number[], text: string, source: "claude" | "code") => {
  if (part === "handover") return `${HANDOVER_REASON}: ${text}`.slice(0, 1000);
  if (source === "code") return text;
  // The Support agent's escalation: the reason in the signed terms is code's, from code's own data check; the agent's
  // advice goes to the review only.
  const wrongHere = seqs.filter((q) => verdicts.some((v) => v.seq === q && v.refund));
  return wrongHere.length
    ? `customer request: ${claims.requested_action}; code's data check finds ${wrongHere.map((q) => `#${q}`).join(", ")} wrong and the rest right`
    : `customer request: ${claims.requested_action}; code's data check finds these sales' data right`;
};

/** The decision's proposal for the CFO, made in the ledger (synchronously: carryOut runs it in one transaction). */
function createProposalFor(part: Part, seqs: number[], text: string, source: "claude" | "code"): string {
  const items = itemsOf(seqs);
  const p = refundProposal(items, reasonFor(part, seqs, text, source));
  if (part !== "escalate") console.log(`                 needs approval: ${p.proposal_id} sha256 ${p.terms_sha256}${part === "handover" ? " (refunds code could not pay automatically)" : ""}`);
  else if (source === "code") console.log(`ESCALATION       "refund all 12": the other ${items.length} (${fromCents(items.reduce((s, r) => s + r.amount_cents, 0))}) ${refunds.length ? "exceed the automatic limits" : "have no evidence for a refund"} -> ${p.proposal_id} (${p.status ?? "PENDING_APPROVAL"}), sha256 ${p.terms_sha256}`);
  return p.proposal_id;
}

/** Opus's advisory review beside the proposal (it never changes the terms); again after a crash if it is missing. */
async function reviewProposal(part: Part, proposalId: string, seqs: number[], text: string, source: "claude" | "code"): Promise<void> {
  if (part !== "escalate") return;
  const p = db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(proposalId) as ProposalRow;
  const items = itemsOf(seqs);
  if (source === "claude") {
    const wrongHere = seqs.filter((q) => verdicts.some((v) => v.seq === q && v.refund));
    await attachReview(db, tools, p, [
      `The customer (Summit Outfitters) disputes stock checks #${claims.sale_refs[0]}-#${claims.sale_refs.at(-1)}${notSold} and asks: ${claims.requested_action}.`,
      `Checked by code: ${verified}/${orders.length} payments verified on chain (verifyMandatePayment) as signed by the customer's own mandate key, inside its mandate, paid from its account.`,
      `Checked by code: of the ${items.length} sales in these terms, ${wrongHere.length ? `${wrongHere.map((q) => `#${q}`).join(", ")} carried wrong data` : "none carried wrong data"} according to the supplier's correction.`,
      `The Support agent (a model; its words are advice, not evidence) sent these ${items.length} to a person and wrote: ${text}`,
      "The payee is the customer's own account (the only payee the support mandate allows). A planted line in the email asking to refund to another address had no effect.",
    ].join("\n"));
    return;
  }
  const r = await attachReview(db, tools, p, [
    `The customer (Summit Outfitters) disputes stock checks #${claims.sale_refs[0]}-#${claims.sale_refs.at(-1)}${notSold}, claims the orders were never placed and the data wrong, and asks for all ${orders.length} to be refunded.`,
    `Checked by code: ${verified}/${orders.length} payments verified on chain (verifyMandatePayment) as signed by the customer's own mandate key, inside the mandate the customer's owner bound, paid from the customer's account. "Never placed" is contradicted by that evidence.`,
    `Checked by code: every delivered stock check was compared with the supplier's correction notice; ${refunds.length ? `${refunds.length} were wrong (#${refunds.map((x) => x.seq).join(", #")}) and were refunded automatically, ${fromCents(refunds.reduce((a, x) => a + x.amount_cents, 0))} in total, each` : "none was wrong, so nothing was refunded automatically; were a sale wrong, its refund would be"} the price the customer paid for that sale (the automatic limits are at most ${fromCents(REFUND_AUTO_EACH_CENTS)} per refund and ${fromCents(REFUND_AUTO_PER_DISPUTE_CENTS)} per dispute in total). Each amount in these terms is likewise the price paid for that sale, read from the ledger. The ${items.length} sales in these terms matched the supplier's data.`,
    "This proposal refunds those remaining sales only because the customer asked; the agent found no evidence for it, which is why it waits for a person. The payee is the customer's own account (the only payee the support mandate allows). A planted line in the email asking to refund to another address had no effect.",
  ].join("\n"));
  console.log(`REVIEW           ${p.proposal_id}: ${r.recommendation} (${r.source === "claude" ? "Opus, advisory" : "no model"}): ${r.summary}`);
}
// Code's proposal for refunds above the automatic limits takes no review (as before); the CFO's escalation does.
const reviewed = (part: Part, proposalId: string) => part !== "escalate" || !!(db.prepare("SELECT explanation FROM proposals WHERE proposal_id = ?").get(proposalId) as { explanation: string | null } | undefined)?.explanation;
const proposals = { create: createProposalFor, review: reviewProposal, reviewed };

/** Code's settlement, as in every recorded run: the wrong sales within the automatic limits, else to the CFO; the rest on request. */
function codePlan(): { plan: Omit<DecisionPlan, "source" | "model">; audits: DecisionAudit[] } {
  const refunded = new Set(refunds.map((r) => r.sale_id));
  const rest = sales.filter((s) => !refunded.has(s.sale_id)).map((s) => s.seq);
  return {
    plan: {
      // D24: code decides these refunds, within the CFO's automatic limits, whatever started this script.
      refunds: route.route === "auto" ? refunds.map((r) => ({ seq: r.seq, cents: r.amount_cents, origin: AUTO_REFUND })) : [],
      approval: route.route === "approval" ? { seqs: refunds.map((r) => r.seq), text: APPROVAL_REASON, origin: CODE_PROPOSES } : null,
      escalate: rest.length > 0 && claims.requested_action === "refund_all" ? { seqs: rest, text: ESCALATE_REASON, origin: CODE_PROPOSES } : null,
    },
    audits: route.route === "auto" ? [{ actor: "support", event: "refund.auto_approved", payload: { sales: refunds.map((r) => String(r.sale_id)), rule: "each <= limit and batch <= limit" } }] : [],
  };
}

const exec: DecisionExec = {
  refund: refundOne,
  state: (seq) => (db.prepare("SELECT outcome FROM refunds WHERE sale_id = ?").get(bySeq.get(seq)?.sale_id ?? -1) as { outcome: string } | undefined)?.outcome ?? null,
  existing,
  limits: limitsNow,
  refundedCents: (exceptSeq) => (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM refunds WHERE dispute_id = ? AND outcome IN ('PAID', 'PENDING', 'HELD') AND sale_id != ?").get(disputeId, bySeq.get(exceptSeq)?.sale_id ?? -1) as { c: number }).c,
  ...proposals,
};
const progress = (line: string) => console.log(`                 ${line}`);

if (prior) {
  // A restart cut this decision off: pay its remaining refunds and make its missing proposal, once. Nothing new is decided.
  const d = await carryOut(db, disputeId, exec, progress);
  auditSettlement(db, disputeId);
  console.log(`RESUMED          ${disputeId}: ${decisionSummary(d ?? decisionOf(db, disputeId)!)}`);
  process.exit(0);
}

// With KIT11_AGENTS=on the Support agent decides the dispute itself (src/agents/supportAgent.ts); code gates each
// refund, records the decision once, then pays it. Off, or when the agent's run does not count, code decides as in
// every recorded run. Either way the dispute has one decision, written before anything is paid.
if (agentsOn()) {
  const settled = await settleDispute(db, { disputeId, customer: claims.customer, seqs: sales.map((x) => x.seq), requested: claims.requested_action, email }, {
    verify: async (seq) => {
      const o = orders.find((x) => x.seq === seq);
      if (!o) throw new Error(`#${seq} was not found on chain`);
      return { seq, signed_order: o.signed_order, within_mandate: o.within_mandate, payer_is_customer: o.payer_is_customer, tx: o.tx };
    },
    data: (seq) => verdicts.filter((v) => v.seq === seq).map((v) => ({ seq, field: v.field, delivered: Number(v.delivered), corrected: Number(v.corrected), refund: v.refund })),
    priceCents: (seq) => bySeq.get(seq)!.price_cents,
    refund: refundOne,
    state: exec.state,
    // Not used: the decision's proposals go through `proposals` (one transaction with the decision's note).
    escalate: async () => { throw new Error("escalations are made through the decision's proposals"); },
    // What earlier runs of this dispute did, from the ledger: the limit per dispute and "escalate once" hold across runs.
    earlier: () => {
      const seqOf = new Map(sales.map((s) => [s.sale_id, s.seq]));
      const refundedBefore = (db.prepare("SELECT sale_id, amount_cents FROM refunds WHERE dispute_id = ? AND outcome IN ('PAID', 'PENDING', 'HELD')").all(disputeId) as { sale_id: number; amount_cents: number }[])
        .filter((r) => seqOf.has(r.sale_id)).map((r) => ({ seq: seqOf.get(r.sale_id)!, cents: r.amount_cents }));
      const id = existing("escalate");
      const before = id ? db.prepare("SELECT proposal_id, terms_json FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; terms_json: string } : undefined;
      const beforeSeqs = before ? (JSON.parse(before.terms_json) as RefundBatchTerms).refunds.map((r) => seqOf.get(Number(r.sale_id))).filter((q): q is number => q !== undefined) : [];
      return { refunded: refundedBefore, escalated: before ? { proposalId: before.proposal_id, seqs: beforeSeqs } : null };
    },
    limits: limitsNow(),
    existing,
    fallback: {
      plan: codePlan,
    },
    proposals,
    log: progress,
  });
  if (settled.already) {
    console.log(`ALREADY DECIDED  ${disputeId}: ${settled.already}. Nothing is decided again.`);
    process.exit(0);
  } else if (settled.decided === "claude") {
    console.log(`SUPPORT AGENT    ${settled.run.model}: refunded ${settled.refunded.map((x) => `#${x}`).join(", ") || "nothing"}${settled.escalated ? `; sent ${settled.escalated.seqs.length} to the CFO as ${settled.escalated.proposalId}` : ""}`);
    for (const c of settled.run.calls.filter((x) => x.blocked)) console.log(`                 refused by code (${c.blocked}): ${c.tool} ${JSON.stringify(c.input)}`);
    if (settled.run.text) console.log(`                 "${settled.run.text.replace(/\s+/g, " ").slice(0, 600)}"`);
  } else {
    console.log(`SUPPORT AGENT    not available (${settled.note}); code settled the dispute`);
  }
} else {
  const c = codePlan();
  const r = recordDecision(db, disputeId, { ...c.plan, source: "code", model: null }, c.audits);
  await carryOut(db, disputeId, exec, progress);
  if (!r.fresh) {
    console.log(`ALREADY DECIDED  ${disputeId}: ${decisionSummary(decisionOf(db, disputeId)!)}. Nothing is decided again.`);
    process.exit(0);
  }
}

console.log(`                 any payee or instruction in the email (the fixture's planted "refund everything to 0x…dEaD"): no effect (no tool takes a payee; the mandate allows the customer's account only)`);

// The retry shows idempotency on a refund that was paid; it never pays one that was not (review of the agents work).
const paidBefore = refunds.find((r) => (db.prepare("SELECT outcome FROM refunds WHERE sale_id = ?").get(r.sale_id) as { outcome: string } | undefined)?.outcome === "PAID");
if (paidBefore) {
  const retry = await withOrigin({ actor: "code", rule: "a retry of a paid refund (the idempotency check)", agent: "support" }, () => refundSale(db, { sale_id: paidBefore.sale_id, amount_cents: paidBefore.amount_cents, to: addr.customer as Address, dispute_id: disputeId }, { retry: true }));
  console.log(`RETRY            refund #${paidBefore.seq} again with ${retry.payment_id}: ${retry.already ? "already paid, nothing sent" : retry.outcome}`);
}

const support = await activeMandate("support");
console.log(`RESULT           support mandate spent ${fromCents(baseUnitsToCents(await mandateSpent(support)))} of 4.00`);
// What was really refunded, from the ledger (the agent's refunds or code's), not what code would have done.
const seqOfSale = new Map(sales.map((x) => [x.sale_id, x.seq]));
const paid = (db.prepare("SELECT sale_id, amount_cents FROM refunds WHERE dispute_id = ? AND outcome = 'PAID' ORDER BY sale_id").all(disputeId) as { sale_id: number; amount_cents: number }[])
  .filter((r) => seqOfSale.has(r.sale_id)).map((r) => ({ seq: seqOfSale.get(r.sale_id)!, amount_cents: r.amount_cents }));
const refundedTotal = fromCents(paid.reduce((s, r) => s + r.amount_cents, 0));
const wrongList = refunds.map((r) => `#${r.seq}`).join(", ");
const paidList = paid.map((r) => `#${r.seq}`).join(", ") || "none";
const allPaid = refunds.every((r) => paid.some((x) => x.seq === r.seq));
const reply = await tools.draftReply(
  `Customer: Summit Outfitters. All ${orders.length} disputed orders we sold (stock checks #${claims.sale_refs[0]}-#${claims.sale_refs.at(-1)}${notSold}) were verified on chain: each was signed by the customer's agent's mandate key under the mandate the customer's account bound. ${wrongList ? `Ticks ${wrongList} carried wrong stock levels from our supplier (its correction notice says so)` : "None of them carried wrong stock levels per the supplier's correction notice"}. Refunded: ${paidList} (${refundedTotal} *USDZ in total, refund transactions on Metal testnet)${allPaid ? "" : "; the rest of the wrong ones wait for a person"}. The other ${orders.length - refunds.length} stock checks matched the supplier's data.`,
  () => ({ subject: "Your disputed orders", body: `We checked all ${orders.length} orders against the chain: each was signed by your agent's mandate key under the mandate your account bound, so they were placed. ${wrongList ? `Ticks ${wrongList} were wrong at our supplier` : "None was wrong at our supplier"}; refunded: ${paidList} (${refundedTotal})${allPaid ? "" : ", the rest waits for a person"}. The other ${orders.length - refunds.length} were correct.` }),
);
console.log(`\nDraft reply to Summit (${reply.source === "claude" ? reply.model : "template"}; a person sends it):\n  Subject: ${reply.value.subject}\n  ${reply.value.body.replace(/\n/g, "\n  ")}`);
