// Payables, part 3: paying a ready invoice. A supplier added through the inbox (payee_add, any country and currency)
// is paid in the invoice's own currency on its route (supplier_payment, src/payouts/plan.ts); a Kit 11 payee on file
// in EUR still goes through the existing invoice payment (src/agents/euroBill.ts). Either way the plan keeps the reserve
// floors, buys only the shortfall, holds a fee reserve and guards against paying twice, and the CFO approves the terms
// with Face ID before an executor pays. Nothing here moves money or approves anything. syncPayments follows each
// proposal: paid once the ledger's transfer is PAID.

import type Anthropic from "@anthropic-ai/sdk";
import { apAgentsOn } from "../config/agents.js";
import { followPayouts } from "../payouts/follow.js";
import type { AirwallexRail, PayoutRail } from "../airwallex/port.js";
import type { BillsRail } from "../airwallex/bills.js";
import { proposeInvoicePayment, type InvoiceOutcome } from "../agents/euroBill.js";
import type { DB } from "../db/open.js";
import type { InboxDeps } from "./inbox.js";
import { accrualEntries, accrualPushed, paymentEntries, pushOnce, returnedPayout, returnEntries, reversalEntries, SINK_TOOK, type BookkeepingSink } from "./books.js";
import { audit } from "../audit/log.js";
import type { Terms } from "../lib/terms.js";
import { ensureCoded } from "./coderAgent.js";
import { approveWithinLimit, expireDue, signedTerms } from "../policy/approvals.js";
import { eurInFlightCents } from "../policy/available.js";
import { fromCents } from "../lib/money.js";
import { cashCheck } from "./cashCheck.js";
import { aloneLimit } from "../world/settings.js";
import { invoiceCase } from "./checks.js";
import { codeRequires } from "./checkerCore.js";
import { CHECKER_DECISION } from "./checkerAgent.js";
import { readDoc } from "./docStore.js";
import { PAY_LATER, paymentCase, payerGate, runPayer, type EarlyPayer } from "./payerAgent.js";
import { pdfText } from "./pdfText.js";
import type { Asker } from "./read.js";
import { writeReviewNote } from "./review.js";
import { ledgerInvoiceNo } from "./ledgerKey.js";
import { cleanText, totalLine, totalLineCurrency } from "./reading.js";
import { scanTotalLine, scanView } from "./detail.js";
import { apInvoice, apInvoices, setStatus, type ApInvoiceRow, type Finding } from "./store.js";
import { payoutBeneficiary, proposeSupplierPayment, type SupplierPaymentOutcome } from "../payouts/plan.js";
import type { PlanGate, PlannedPayment } from "../payouts/planGate.js";
import { readOnlyLedger, quoteFreeRail } from "../payouts/probe.js";
import { MAX_REFERENCE, payableCurrency, referenceProblem } from "../payouts/routes.js";

export type PayOutcome = InvoiceOutcome | SupplierPaymentOutcome;

/**
 * The payout's reason code, from the invoice's expense account (screenshot pass S6: goods were sent as professional
 * services): goods bought (6200 Goods from the manufacturer) go as goods_purchased, anything else as
 * professional_business_services, the code Kit 11's recorded sandbox payouts were accepted with. goods_purchased is the
 * code the supplier payments already sent. Both values were accepted by the Airwallex sandbox's transfer validation
 * (POST /api/v1/transfers/validate, 200) on 9 November 2026.
 */
export function transferReason(glAccount: string): string {
  return glAccount === "6200" ? "goods_purchased" : "professional_business_services";
}

/** The longest payment reference Purser sends (src/payouts/routes.ts). */
export { MAX_REFERENCE };

/**
 * The Payer agent's client (null: no key, so code's plan stands; default: the runner's own), and whether it runs (the
 * cloud engine says so, task A6; absent: KIT11_AP_AGENTS decides). `early`: what the Payer already proposed on this
 * invoice while it was filed (earlyPayer), used only when the plan at Pay is the same case.
 */
export interface PayAgents { claude?: Anthropic | null; on?: boolean; planStands?: boolean; early?: EarlyPayer }

/**
 * An invoice checked for payment, and how its payment is planned: the supplier's route (supplier_payment) or the EUR
 * invoice payment, on the given ledger and rails, with the gate shown the plan before it is filed. Throws what keeps it
 * from being paid at all (not ready, a credit note, a currency Purser does not pay, a reference the rails refuse).
 */
async function preparePayment(db: DB, id: string, now: Date): Promise<{ inv: ApInvoiceRow; text: string; plan(on: DB, rail: AirwallexRail & PayoutRail, gate?: PlanGate): Promise<PayOutcome> }> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  // A credit note is money the supplier owes back: it is set against its invoices, never paid out (whatever its status).
  if (inv.doc_kind === "credit_note") throw new Error(`${id} is a credit note: it is never paid; it lowers what is open to ${inv.vendor || "the supplier"}`);
  if (inv.status !== "ready") {
    const why = inv.findings.filter((f) => f.level !== "warn").map((f) => f.detail).join("; ");
    throw new Error(`${id} is ${inv.status.replace(/_/g, " ")}, not ready to pay${why ? `: ${why}` : ""}`);
  }
  if (!payableCurrency(inv.currency)) throw new Error(`${id} is in ${inv.currency}; Purser does not pay that currency (pays EUR only in two-decimal currencies SWIFT carries), so a person pays it`);
  const doc = db.prepare("SELECT path FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string } | undefined;
  if (!doc) throw new Error(`${id}: its document is missing`);
  const text = (await pdfText(readDoc(db, doc.path))).text;
  const r = inv.reading;
  const invoiceNo = ledgerInvoiceNo(r.invoice_no, r.vendor);
  const due = r.due_date || now.toISOString().slice(0, 10);
  const reference = r.reference || r.invoice_no;
  const refWrong = referenceProblem(reference);
  if (refWrong) throw new Error(`${id}: ${refWrong}`);
  // The supplier's own total line and its currency go with the terms, so the CFO sees them beside the amount.
  // A scan has no text line: the terms carry what was read from it, and say so (the phone shows it beside the amount).
  const scan = text ? null : scanView(db, id);
  const document = scan
    ? { total_line: scanTotalLine(inv, scan), currency: inv.currency, reason: transferReason(inv.gl_account) }
    : { total_line: totalLine(text), currency: totalLineCurrency(text), reason: transferReason(inv.gl_account) };
  // A supplier added through the inbox carries its route; a Kit 11 payee on file is paid in EUR as before.
  const plan = (on: DB, rail: AirwallexRail & PayoutRail, gate?: PlanGate): Promise<PayOutcome> => payoutBeneficiary(on, r.vendor) || r.currency !== "EUR"
    ? proposeSupplierPayment(on, rail, { invoice_no: invoiceNo, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: due, reference, reason: document.reason }, text, now, document, gate)
    : proposeInvoicePayment(on, rail, { invoice_no: invoiceNo, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: due, iban: r.iban, bic: r.bic, reference }, text, now, "MIN_15", document, gate);
  return { inv, text, plan };
}

/** A payment approved by code within the CFO's limit to pay alone (payAlone): who decided, and code's rule in words. */
export interface PaidAlone { limit: string; by: "agents" | "code"; why: string }

/**
 * Whether the payment just filed for this invoice is one the agent pays alone, and if so approves it (owner, 16 Nov).
 * Only when the company sets a limit to pay alone (src/world/settings.ts aloneLimit: a test company of /try), and every
 * one who decides says pay: code's own requirement on the invoice now (codeRequires: no finding that stops it, within
 * the limit, the amount its contract says); where the agents ran, the Checker's enforced decision on the invoice and
 * the Payer's enforced proposal, filed as proposed; no text in the document that tries to steer its reader; then code
 * checks the filed terms against the limit once more (approveWithinLimit). Anything short of that leaves the payment waiting for the CFO's Face ID, as before.
 */
function payAlone(db: DB, inv: ApInvoiceRow, text: string, proposalId: string, payer: { alone(): boolean } | null, now: Date): PaidAlone | null {
  const limit = aloneLimit(db);
  if (!limit) return null;
  // Text in the document that tries to steer its reader is only a warning to code's checks (src/ap/checkerCore.ts), but an
  // invoice that carries it is never paid without a person: the CFO signs it, whatever the agents said.
  if (inv.findings.some((f) => f.code === "instructions_in_document")) return null;
  const c = invoiceCase(db, inv.reading, text, { docSha: inv.doc_sha256, now, selfId: inv.id });
  const need = codeRequires(c, inv.findings);
  if (need.action !== "pay") return null;
  if (payer) {
    const checked = db.prepare("SELECT json_extract(payload_json, '$.outcome') AS outcome FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq DESC LIMIT 1").get(CHECKER_DECISION, inv.id) as { outcome: string | null } | undefined;
    if (checked?.outcome !== "pay" || !payer.alone()) return null;
  }
  // The cash check (src/ap/cashCheck.ts): the agent pays alone only from the invoice's own currency, and only when that
  // balance stays at or above its floor once this payment and what is spoken for are out. The filed terms carry the
  // plan's own figures; a plan that converts another currency is the CFO's to sign, never the agent's alone.
  if (cashHoldsFiled(db, proposalId, inv, now)) return null;
  const top = `${limit.currency} ${limit.amount}`;
  const why = `within the ${top} the CFO lets the agent pay alone: ${payer ? "the Checker agent decided pay and the Payer agent proposed it, and code's checks agree" : "code's checks found nothing that stops it"}`;
  const ok = approveWithinLimit(db, { proposalId, limit, rule: why, agent: "payer" }, now);
  return ok.ok ? { limit: top, by: payer ? "agents" : "code", why } : null;
}

/**
 * Whether the cash check holds the payment just filed (an invoice payment's terms: its balances before, its floor and
 * commitments, its fee reserve, with the payouts in flight now): true when paying it from its own currency alone would
 * take that balance below its floor. Terms of another kind, or terms code cannot read, are never paid alone either.
 */
function cashHoldsFiled(db: DB, proposalId: string, inv: ApInvoiceRow, now: Date): boolean {
  const row = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string } | undefined;
  if (!row) return true;
  if (row.kind !== "invoice_payment") return false;
  let t: { amount?: unknown; currency?: unknown; fee_max?: unknown; balances_before?: { eur_available?: unknown }; floors?: { eur_floor?: unknown; eur_obligations?: unknown } };
  try { t = JSON.parse(row.terms_json) as typeof t; } catch { return true; }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const view = cashCheck({
    invoice: { id: inv.id, invoiceNo: inv.invoice_no, payee: inv.vendor, iban: "", amount: str(t.amount), currency: str(t.currency), dueDate: inv.due_date ?? "" },
    position: { currency: str(t.currency), balance: str(t.balances_before?.eur_available), committed: str(t.floors?.eur_obligations), inFlight: fromCents(eurInFlightCents(db, undefined, proposalId)), floor: str(t.floors?.eur_floor) },
    feeReserve: str(t.fee_max), aloneLimit: aloneLimit(db), today: now.toISOString().slice(0, 10),
  });
  return view.outcome === "hold";
}

export async function payApInvoice(db: DB, rail: AirwallexRail & PayoutRail, id: string, now = new Date(), reader?: Asker, agents: PayAgents = {}): Promise<PayOutcome & { alone?: PaidAlone }> {
  const { inv, text, plan } = await preparePayment(db, id, now);
  // KIT11_AP_AGENTS=on: the engine plans as always, then the Payer agent proposes the rail, the day and the currency on
  // that plan, and code enforces it (src/ap/payerAgent.ts). The plan is filed only when the enforced proposal pays today
  // on the plan's own terms; the CFO signs those exact terms as before. Off: no gate, and nothing here changes.
  const payer = (agents.on ?? apAgentsOn()) ? payerGate(db, {
    invoiceId: id, invoiceNo: inv.reading.invoice_no, now, ...(agents.claude !== undefined ? { claude: agents.claude } : {}), ...(agents.planStands ? { planStands: true } : {}), ...(agents.early ? { early: agents.early } : {}),
  }) : null;
  const out = await plan(db, rail, payer?.gate);
  if (out.kind === "proposed") {
    // An earlier "planned for a later day" no longer describes it once it is filed.
    const later = inv.findings.some((f) => f.code === PAY_LATER);
    // Within the CFO's limit, approved by code for the agent to pay alone (the caller runs it); else filed for the CFO.
    const alone = payAlone(db, inv, text, out.proposal.proposal_id, payer, now);
    setStatus(db, id, "waiting_cfo", "treasury", { proposal_id: out.proposal.proposal_id, reason: alone ? `approved by code ${alone.why}; the agent pays it, no signature` : "payment filed for the CFO's Face ID", ...(later ? { findings: inv.findings.filter((f) => f.code !== PAY_LATER) } : {}) }, now);
    if (alone) return { ...out, alone };
    // Opus's advisory note goes with the proposal the CFO sees (its explanation; never part of the signed terms).
    const noted = await writeReviewNote(db, reader, id, now);
    // Stored as every review is ("[model] RECOMMENDATION: text"), so the phone names its real source: the model, or
    // Purser's code when no model wrote it (screenshot pass S3).
    const source = noted.review_by?.startsWith("claude:") ? noted.review_by.slice("claude:".length) : "no model";
    db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = ? AND explanation IS NULL").run(`[${source}] NOTE: ${noted.review_note ?? ""}`, out.proposal.proposal_id);
    return out;
  }
  // Not planned (the reserve is short, a quote refused, a duplicate found late): the invoice stays as it is, with the reason.
  // Only over the status this call read (red team round 4: of two "pay" calls at once, the loser wrote its stale "ready"
  // over the winner's "waiting_cfo", and the paid invoice stayed open for good).
  const now_ = apInvoice(db, id);
  if (!now_ || now_.status !== inv.status || now_.proposal_id !== inv.proposal_id) return out;
  // The Payer agent named a later day within the due date: nothing is wrong, it is simply not filed today.
  const waits = payer?.last()?.next === "pay_later";
  const findings: Finding[] = [...inv.findings.filter((f) => f.code !== "payment_not_planned" && f.code !== PAY_LATER),
    waits ? { code: PAY_LATER, level: "warn", detail: out.reason } : { code: "payment_not_planned", level: "warn", detail: `the payment could not be planned: ${out.reason}` }];
  setStatus(db, id, "fraud" in out && out.fraud?.suspicious ? "blocked" : inv.status, "treasury", { findings, reason: out.reason }, now);
  return out;
}

/**
 * The Payer, early (speed, 13 Nov): once an invoice is ready, the engine works out its payment plan without filing or
 * locking anything (a read-only ledger and rails that only read: no audit row, no balance snapshot, no quote locked;
 * the quote is the market's current rate, src/payouts/probe.ts), and the Payer proposes on that case. Pay then reads
 * the finished answer, and uses it only when its own plan is the same case (payerGate: the locked quote's id and
 * expiry aside); code enforces the proposal on Pay's own plan, as always. null: nothing to propose on (not payable, the
 * plan stopped), no client, or the agent did not propose; Pay then runs the Payer as before. Moves nothing.
 */
export async function earlyPayer(db: DB, rail: AirwallexRail & PayoutRail, id: string, now: Date, claude: Anthropic | null, log: (line: string) => void = (l) => console.warn(l)): Promise<EarlyPayer | null> {
  if (!claude) return null;
  let planned: PlannedPayment | null = null;
  let invoiceNo: string;
  try {
    const p = await preparePayment(db, id, now);
    invoiceNo = p.inv.reading.invoice_no;
    await p.plan(readOnlyLedger(db), quoteFreeRail(rail), async (plan) => {
      planned = plan;
      return { go: false, reason: "only the plan was read (the Payer, early)" };
    });
  } catch (e) {
    // Pay runs the Payer as before; why the early plan stopped is said, never dropped (code review 13 Nov).
    log(`early Payer for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (!planned) return null;
  const c = paymentCase(planned, { invoiceId: id, invoiceNo, today: now.toISOString().slice(0, 10) }, aloneLimit(db));
  const out = await runPayer(db, c, { task: `ap.pay.${id}`, claude });
  return out.source === "claude" ? { case: c, out, at: now.toISOString() } : null;
}

/**
 * The note written while the invoice waited for the CFO no longer describes it once paid, rejected or ready again
 * (screenshot pass S3: a paid invoice still said "Waits for the CFO's Face ID"): it is taken away; the audit log keeps it.
 */
function clearStaleNote(db: DB, id: string): void {
  db.prepare("UPDATE ap_invoices SET review_note = NULL, review_by = NULL WHERE id = ?").run(id);
}

interface PaidPayout { amount: string; currency: string; approval_sha256: string }

/**
 * Why a paid payout may not be booked, or null: the proposal's stored terms no longer hash to what the CFO approved
 * (changed after signing), or the payout's own row is not the payment those terms describe (another approval hash,
 * amount or currency). The executor checks the same hash before it pays; the books check it again before they book.
 */
function bookingProblem(db: DB, proposalId: string, paid: PaidPayout): string | null {
  const signed = signedTerms<Terms & { amount?: string; currency?: string }>(db, proposalId);
  if (!signed.ok) return signed.reason;
  if (paid.approval_sha256 !== signed.sha256) return `the payout carries another approval hash than ${proposalId}'s`;
  if (paid.amount !== signed.terms.amount || paid.currency !== signed.terms.currency) {
    return `the payout on record (${paid.currency} ${paid.amount}) is not the ${String(signed.terms.currency)} ${String(signed.terms.amount)} the CFO signed in ${proposalId}`;
  }
  return null;
}

/**
 * Follows each invoice waiting for the CFO: paid when its transfer is PAID; rejected; or ready again when its terms ran out.
 * `bills`: Airwallex Spend Bills (src/ap/billSync.ts). Left out, it follows AIRWALLEX_BILLS (off by default: nothing is
 * called); null turns it off for this sync.
 */
export async function syncPayments(db: DB, opts: { now?: () => Date; sink?: BookkeepingSink; rail?: PayoutRail; bills?: BillsRail | null } = {}): Promise<ApInvoiceRow[]> {
  const now = (opts.now ?? (() => new Date()))();
  // With Airwallex at hand: each sent supplier payout is read again, and a PAID one's Purser fee taken (red team 6).
  if (opts.rail) await followPayouts(db, opts.rail, now);
  // A proposal past its time that nothing has marked yet is expired first, so its invoice is not left waiting forever.
  expireDue(db, now);
  const changed: ApInvoiceRow[] = [];
  for (const inv of apInvoices(db, { status: "waiting_cfo" })) {
    const p = inv.proposal_id ? db.prepare("SELECT status, json_extract(terms_json, '$.transfer_request_id') AS request_id FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { status: string; request_id: string | null } | undefined : undefined;
    if (!p) continue;
    // A proposal that failed with its payout still open at Airwallex (a lost answer, not resolved yet) or already paid
    // is not over: the invoice is never offered for payment again while that payout may be live (red team, 8 November).
    const payout = p.request_id ? db.prepare("SELECT status FROM transfers WHERE request_id = ?").get(p.request_id) as { status: string } | undefined : undefined;
    if (p.status !== "EXECUTED" && payout && payout.status !== "CANCELLED" && payout.status !== "PAID") continue;
    if (p.status !== "EXECUTED" && payout?.status === "PAID") p.status = "EXECUTED";
    if (p.status === "REJECTED") {
      const next = setStatus(db, inv.id, "rejected", "human", { reason: `the CFO rejected ${inv.proposal_id}` }, now);
      clearStaleNote(db, inv.id);
      // The accrual a sink already holds is taken back there, so the payable is closed in the books too.
      if (opts.sink && accrualPushed(db, next, opts.sink)) await pushOnce(db, opts.sink, "reversal", reversalEntries(next, now.toISOString().slice(0, 10)), next, now);
      changed.push(next);
    } else if (["EXPIRED", "FAILED", "NEEDS_REAPPROVAL", "SUPERSEDED"].includes(p.status)) {
      changed.push(setStatus(db, inv.id, "ready", "system", { proposal_id: null, reason: `${inv.proposal_id} ${p.status.toLowerCase()}; it can be filed again` }, now));
      clearStaleNote(db, inv.id);
    } else if (p.status === "EXECUTED") {
      // The payout the signed proposal names, by its request id: never another payout under the same invoice number.
      const paid = p.request_id ? db.prepare("SELECT amount, currency, approval_sha256 FROM transfers WHERE request_id = ? AND status = 'PAID'").get(p.request_id) as PaidPayout | undefined : undefined;
      if (!paid) {
        // Sent, then failed at Airwallex before it was paid (a follow-up read it: src/payouts/follow.ts). The invoice
        // was waiting for good; it goes to a person, and nothing is sent again under this approval.
        if (payout && (payout.status === "FAILED" || payout.status === "CANCELLED")) {
          changed.push(setStatus(db, inv.id, "needs_review", "awx-executor", { reason: failedPayoutReason(db, p.request_id!, inv.proposal_id!, "failed at Airwallex after it was sent") }, now));
          clearStaleNote(db, inv.id);
        }
        continue;
      }
      // Booked only as the CFO signed it: the same hash the executor checked before the payment is checked again here.
      const wrong = bookingProblem(db, inv.proposal_id!, paid);
      if (wrong) {
        if (!db.prepare("SELECT 1 FROM audit_log WHERE event = 'ap.booking_refused' AND subject = ? AND json_extract(payload_json, '$.reason') = ?").get(inv.id, wrong)) {
          audit(db, "system", "ap.booking_refused", inv.id, { proposal_id: inv.proposal_id, reason: wrong, note: "not booked as paid; a person checks the payout against what the CFO signed" }, now);
        }
        continue;
      }
      const next = setStatus(db, inv.id, "paid", "awx-executor", { paid_at: now.toISOString(), reason: `paid under ${inv.proposal_id}` }, now);
      clearStaleNote(db, inv.id);
      // The accrual first if the sink never got it (a supplier added by the executor, a sink that was down), then the payment.
      // With KIT11_AP_AGENTS=on an accrual nothing has booked yet is coded by the Coder agent first (src/ap/coderAgent.ts).
      const coded = await ensureCoded(db, next, { now: () => now });
      await pushOnce(db, opts.sink, "accrual", accrualEntries(coded), coded, now);
      await pushOnce(db, opts.sink, "payment", paymentEntries(db, next), next, now);
      changed.push(next);
    }
  }
  // A paid invoice whose payout came back after PAID (Airwallex: PAID is not always final): it goes to a person, the
  // books take the payment back, and the payable is open again. Nothing is sent again under the old approval: paying
  // it again is a new proposal, which the CFO signs again.
  for (const inv of apInvoices(db, { status: "paid" })) {
    const back = returnedPayout(db, inv);
    if (!back) continue;
    changed.push(setStatus(db, inv.id, "needs_review", "awx-executor", { reason: failedPayoutReason(db, null, inv.proposal_id!, "came back after Airwallex had it PAID", back.failure_type) }, now));
    clearStaleNote(db, inv.id);
  }
  // The sink holds the payment only if it took it; then the return goes too, so its books match. Tried on every sync
  // until the sink takes it (independent review, 17 Nov: a sink down at that moment never got it).
  if (opts.sink) {
    for (const inv of apInvoices(db, { status: "needs_review" })) {
      const back = returnedPayout(db, inv);
      if (!back) continue;
      const took = (event: string) => !!db.prepare(`SELECT 1 FROM ap_sink_events WHERE invoice_id = ? AND event = ? AND sink = ? AND ${SINK_TOOK}`).get(inv.id, event, opts.sink!.name);
      if (took("payment") && !took("return")) await pushOnce(db, opts.sink, "return", returnEntries(inv, back), inv, now);
    }
  }
  // Each invoice paid as a bill in Airwallex's own accounts payable, marked paid once its transfer is PAID (off by
  // default). It never fails the sync: an error is recorded per invoice and tried again on the next one.
  const bills = opts.bills !== undefined ? opts.bills : await (await import("../airwallex/bills.js")).billsFromEnv();
  if (bills) await (await import("./billSync.js")).syncBills(db, bills, { now: () => now });
  return changed;
}

/** Why a payout that was sent did not stay paid: Airwallex's own failure type when it gave one. */
function failedPayoutReason(db: DB, requestId: string | null, proposalId: string, what: string, failureType: string | null = null): string {
  const type = failureType ?? (requestId ? (db.prepare("SELECT failure_type FROM transfers WHERE request_id = ?").get(requestId) as { failure_type: string | null } | undefined)?.failure_type ?? null : null);
  return `the payout under ${proposalId} ${what}${type ? ` (${type})` : ""}; Purser sends nothing again for this invoice: a person checks the supplier's bank details with the supplier and decides what happens next`;
}

/** The states a person may reject an invoice from on the page: never one filed for the CFO, paid or rejected. */
const REJECTABLE = new Set(["blocked", "needs_review", "needs_vendor", "ready"]);

/**
 * A person rejects an invoice on the payables page: it is never paid, with the reason in the audit log. One filed for
 * the CFO is approved or rejected on the phone only; a paid one is never undone here. The accrual a sink already holds
 * is taken back there, as when the CFO rejects (the stored ledger reverses it on its next sync, src/ledger/feed.ts).
 */
export async function rejectApInvoice(db: DB, id: string, reason: string, deps: Pick<InboxDeps, "sink">, now = new Date()): Promise<ApInvoiceRow> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  const why = cleanText(reason, 300);
  if (!why) throw new Error("say why it is rejected: the reason is kept with the invoice");
  if (inv.status === "waiting_cfo") throw new Error(`${id} waits for the CFO's Face ID: approve or reject it on the phone`);
  if (!REJECTABLE.has(inv.status)) throw new Error(`${id} is ${inv.status.replace(/_/g, " ")} already; it cannot be rejected`);
  const next = setStatus(db, id, "rejected", "human", { reason: `rejected on the payables page: ${why}` }, now);
  clearStaleNote(db, id);
  if (deps.sink && accrualPushed(db, next, deps.sink)) await pushOnce(db, deps.sink, "reversal", reversalEntries(next, now.toISOString().slice(0, 10), "a person rejected the invoice"), next, now);
  return next;
}
