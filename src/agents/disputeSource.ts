// Which customer dispute a settlement may decide (blind holdout H9, dry-173). Live, the settlement used to handle only
// the fixture's dispute (fixtures/summit-dispute-email.txt, D-2f8a03a4): a new dispute that really came in
// (D-3b1e004f) was refused, and Support refunded nothing and told no one but Treasury. Now any dispute that opened in
// this world (a dispute.opened event the world recorded, keyed D- and the first 8 hex of its email's sha256) can be
// decided, once (dispute_decisions); a dispute id no event names is never settled (the night batch's live-14 lesson:
// Support settled a dispute that had not opened). A dispute that came in but that code cannot settle goes to the CFO
// as a visible handover (dispute.escalated: the dashboard and /health show it until it is decided), never silence.
// Agents cannot publish world events: only the world (a person's command) opens a dispute.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { carryOut, cfoResolution, decisionOf, finished, legacyDecision, recordDecision, type DecisionAudit, type DisputeDecision } from "./disputeDecision.js";

export { cfoResolution };

/** A dispute's id, from its email as received: D- and the first 8 hex of the email's sha256 (as s2 has always keyed it). */
export const disputeKey = (email: string): string => `D-${sha256Hex(email).slice(0, 8)}`;
/** The live key of a dispute.opened payload's email, or null when it carries no email text (nothing to settle from). */
export const liveDisputeId = (email: string): string | null => (email.trim() ? disputeKey(email) : null);

export interface OpenedDispute { id: string; customer: string; email: string; eventId: number | null }

/** A dispute.opened payload as a dispute, keyed by `idOf`; null when it names none. */
export function asOpened(payload: Record<string, unknown>, idOf: (email: string) => string | null, eventId: number | null = null): OpenedDispute | null {
  const email = typeof payload.email === "string" ? payload.email : "";
  const id = idOf(email);
  return id ? { id, customer: typeof payload.customer === "string" ? payload.customer.slice(0, 80) : "a customer", email, eventId } : null;
}

/** Every dispute that opened in this world, newest first (one entry per id, its newest event). */
export function openedDisputes(db: DB, idOf: (email: string) => string | null = liveDisputeId): OpenedDispute[] {
  const rows = db.prepare("SELECT id, payload_json FROM world_events WHERE kind = 'dispute.opened' ORDER BY id DESC").all() as { id: number; payload_json: string }[];
  const out: OpenedDispute[] = [];
  for (const r of rows) {
    let p: unknown;
    try { p = JSON.parse(r.payload_json); } catch { continue; }
    if (!p || typeof p !== "object") continue;
    const d = asOpened(p as Record<string, unknown>, idOf, r.id);
    if (d && !out.some((x) => x.id === d.id)) out.push(d);
  }
  return out;
}

/** The dispute with this id, if one opened in this world (its newest dispute.opened event); else null. */
export function openedDispute(db: DB, id: string, idOf: (email: string) => string | null = liveDisputeId): OpenedDispute | null {
  return openedDisputes(db, idOf).find((d) => d.id === id) ?? null;
}

/** Whether the dispute is decided and carried out (or was settled before decisions were recorded). */
export function disputeDecided(db: DB, id: string): boolean {
  const d = decisionOf(db, id);
  return (d !== null && finished(d)) || legacyDecision(db, id) !== null;
}

/** When the dispute was last handed to the CFO, or null. */
export function escalatedAt(db: DB, id: string): string | null {
  return (db.prepare("SELECT ts FROM audit_log WHERE event = 'dispute.escalated' AND subject = ? ORDER BY seq DESC LIMIT 1").get(id) as { ts: string } | undefined)?.ts ?? null;
}

/**
 * Whether code may carry out this recorded decision on its own (the Support agent's tool, the runner's start): not
 * once its dispute went to the CFO (dispute.escalated) while the decision still has a refund to pay or a proposal to
 * make (review 2, LOW 4: code carried it out again half an hour later, maybe while the CFO was deciding it). A person
 * carries it out (npm run s2 -- --dispute <id>). A decision that is done but for its settlement row, or that pays and
 * proposes nothing, is finished by code as before.
 */
export function codeMayCarryOut(db: DB, d: DisputeDecision): boolean {
  const left = d.status === "DECIDED" && (d.plan.refunds.length > 0 || !!d.plan.escalate || !!d.plan.approval);
  return !left || !escalatedAt(db, d.dispute_id);
}

/**
 * Hands a dispute that came in, and that code could not settle, to the CFO: recorded once per dispute
 * (dispute.escalated), shown on the dashboard's refusals and on /health while it is undecided. It moves no money and
 * makes no refund proposal: the CFO settles it (npm run s2 -- --dispute <id>, or a refund proposal with Face ID) and,
 * once handled, marks it resolved (npm run s2 -- --resolve <id> --note "…"; the only way for a D-ev<id> dispute).
 */
export function escalateDispute(db: DB, d: { id: string; customer: string }, reason: string, now = new Date()): { fresh: boolean; at: string } {
  const before = escalatedAt(db, d.id);
  if (before) return { fresh: false, at: before };
  audit(db, "support", "dispute.escalated", d.id, {
    customer: d.customer, reason: reason.slice(0, 500),
    origin: { actor: "code", rule: "a dispute that came in and that code could not settle goes to the CFO", agent: "support" },
  }, now);
  return { fresh: true, at: now.toISOString() };
}

/** Disputes handed to the CFO and not decided since: for /health and Support's own view. */
export function escalatedUndecided(db: DB): { id: string; at: string; reason: string }[] {
  const rows = db.prepare("SELECT subject, ts, payload_json FROM audit_log WHERE event = 'dispute.escalated' ORDER BY seq").all() as { subject: string; ts: string; payload_json: string }[];
  const seen = new Set<string>();
  const out: { id: string; at: string; reason: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.subject)) continue;
    seen.add(r.subject);
    if (decisionOf(db, r.subject) || legacyDecision(db, r.subject)) continue;
    let reason = "";
    try { reason = String((JSON.parse(r.payload_json) as { reason?: unknown }).reason ?? ""); } catch { /* the reason is words only */ }
    out.push({ id: r.subject, at: r.ts, reason });
  }
  return out;
}

/** A refund_batch proposal that can still run or that a person decided: an order in it is put to the CFO once. Not one
 *  that can no longer run (EXPIRED, FAILED, SUPERSEDED, NEEDS_REAPPROVAL, or pending past its expiry): a sale covered
 *  only by such a proposal is decided again, so the refund that is due comes back to the CFO (late review, MEDIUM 1). */
const LIVE_PROPOSAL = "status IN ('APPROVED', 'EXECUTING', 'EXECUTED', 'REJECTED') OR (status = 'PENDING_APPROVAL' AND expires_at > ?)";
/** A refund row that was paid, is under way or is held (a REFUSED one alone handles nothing: late review, MEDIUM 2). */
const REFUND_WORDS: Record<string, string> = {
  PAID: "refunded under", PENDING: "refund sent under", HELD: "refund held at Metal under", PROPOSED: "refund started under",
};
const REFUND_TAIL: Record<string, string> = { PENDING: ", not yet confirmed", PROPOSED: ", not yet sent" };

/**
 * Sales another dispute already handled (holdouts, dispute-repeated: an angrier second email about the same orders is
 * a new dispute id): refunded, being refunded or held (PAID, PENDING, HELD, PROPOSED), or named in a live refund
 * proposal for the CFO (LIVE_PROPOSAL). One order is refunded, or put to the CFO, once across disputes; a new dispute
 * decides only the orders no earlier one handled. A refund that was refused, or a proposal that can no longer run,
 * handles nothing: the sale is decided again. Returns each such sale with what handled it, worded by its outcome.
 */
export function handledElsewhere(db: DB, saleIds: number[], disputeId: string, now = new Date()): Map<number, string> {
  const want = new Set(saleIds);
  const out = new Map<number, string>();
  const at = now.toISOString();
  const live = new Map((db.prepare(`SELECT proposal_id, status, terms_json FROM proposals WHERE kind = 'refund_batch' AND (${LIVE_PROPOSAL})`).all(at) as { proposal_id: string; status: string; terms_json: string }[])
    .map((p) => [p.proposal_id, p]));
  const sentAs = (p: { proposal_id: string; status: string }) => `sent to the CFO as ${p.proposal_id} (${p.status})`;
  // The live proposals of other disputes, by the sales they name.
  const coveredBy = new Map<number, { proposal_id: string; status: string }>();
  for (const p of live.values()) {
    let terms: { dispute_id?: unknown; refunds?: { sale_id?: unknown }[] };
    try { terms = JSON.parse(p.terms_json) as typeof terms; } catch { continue; }
    if ((typeof terms.dispute_id === "string" ? terms.dispute_id : "") === disputeId) continue;
    for (const r of terms.refunds ?? []) { const id = Number(r.sale_id); if (want.has(id) && !coveredBy.has(id)) coveredBy.set(id, p); }
  }
  for (const r of db.prepare("SELECT sale_id, outcome, dispute_id, proposal_id FROM refunds WHERE dispute_id IS NULL OR dispute_id <> ?").all(disputeId) as { sale_id: number; outcome: string; dispute_id: string | null; proposal_id: string | null }[]) {
    if (!want.has(r.sale_id)) continue;
    const under = r.dispute_id ?? r.proposal_id ?? "an earlier refund";
    if (REFUND_WORDS[r.outcome]) { out.set(r.sale_id, `${REFUND_WORDS[r.outcome]} ${under}${REFUND_TAIL[r.outcome] ?? ""}`); continue; }
    // REFUSED: handled only while a live proposal covers its sale (its own, or another dispute's).
    const cover = (r.proposal_id ? live.get(r.proposal_id) : undefined) ?? coveredBy.get(r.sale_id);
    if (cover) out.set(r.sale_id, `refund refused under ${under}; ${sentAs(cover)}`);
  }
  for (const [id, p] of coveredBy) if (!out.has(id)) out.set(id, sentAs(p));
  return out;
}

/** A dispute with nothing to decide (its orders were all handled by earlier disputes, or none was sold): decided once,
 *  by code, with nothing new (no refund, no proposal), so it is never settled again nor blocks the disputes after it.
 *  `audits` are written in the decision's own transaction (decided once: a rerun writes none). Callers use
 *  decideHandledBefore or decideNoneSold, which say so where a person looks. Returns whether this call decided it. */
export async function decideNothingNew(db: DB, disputeId: string, note = "every order in it was handled by an earlier dispute", audits: DecisionAudit[] = []): Promise<boolean> {
  const r = recordDecision(db, disputeId, { source: "code", model: null, refunds: [], escalate: null, approval: null, agent_note: note }, audits);
  // Only a decision this call recorded is carried out here (review 2, LOW 5): when another process recorded the
  // dispute's real decision first, that decision is its own to carry out, with its refunds and proposals; carrying it
  // out here, with a refund that throws, would count a try against it and note failures that are not its own.
  if (r.fresh) await carryOut(db, disputeId, { refund: async () => { throw new Error("nothing to refund"); }, existing: () => null });
  return r.fresh;
}

/** Every order in the dispute was handled before (`handled`: "#7 (refunded under D-…)" each): decided once with
 *  nothing new, and recorded as dispute.handled_before, which the dashboard shows (late review, LOW-MEDIUM 3). */
export async function decideHandledBefore(db: DB, d: { id: string; customer: string }, handled: string[]): Promise<boolean> {
  return decideNothingNew(db, d.id, "every order in it was handled by an earlier dispute", [
    { actor: "support", event: "dispute.handled_before", payload: { customer: d.customer.slice(0, 80), handled: handled.slice(0, 50).map((h) => h.slice(0, 200)) } },
  ]);
}

/** None of the disputed numbers was sold to this customer: handed to the CFO (dispute.escalated, on the dashboard), then
 *  decided once with nothing to refund, so it is not settled again (late review, LOW-MEDIUM 3: never closed silently). */
export async function decideNoneSold(db: DB, d: { id: string; customer: string }): Promise<boolean> {
  if (decisionOf(db, d.id)) return false;
  escalateDispute(db, d, "no disputed number matched a sale");
  return decideNothingNew(db, d.id, "none of the disputed numbers was sold to this customer");
}

/**
 * The CFO marks a dispute it holds resolved (late review, L2): npm run s2 -- --resolve <id> --note "…". Only a dispute
 * handed to the CFO (dispute.escalated) and not decided; once (a second call is refused). It moves no money and makes
 * no proposal: it records the CFO's decision (dispute.resolved_by_cfo, outcome resolved_by_cfo, with the note), which
 * clears the /health alert and counts as the dispute's decision (legacyDecision), so code never settles it after.
 * D-ev<id> disputes (no email code can read) can only be closed this way.
 */
export function resolveByCfo(db: DB, id: string, note: string, now = new Date()): { id: string; outcome: "resolved_by_cfo"; at: string } {
  const words = note.trim();
  if (!words) throw new Error("a note is required: say how the dispute was settled");
  const tx = db.transaction(() => {
    if (decisionOf(db, id) || legacyDecision(db, id)) throw new Error(`${id} is already decided; nothing is decided again`);
    if (!escalatedAt(db, id)) throw new Error(`${id} is not with the CFO (no dispute.escalated names it); nothing is resolved`);
    audit(db, "human", "dispute.resolved_by_cfo", id, {
      outcome: "resolved_by_cfo", note: words.slice(0, 500), moves_money: false,
      origin: { actor: "cfo-command", command: "npm run s2 -- --resolve", moves_money: false },
    }, now);
  });
  tx.immediate();
  return { id, outcome: "resolved_by_cfo", at: now.toISOString() };
}

/**
 * What this customer was refunded without the CFO under its other disputes (paid, pending or held; a refund the CFO
 * approved is not counted). The automatic limit per dispute is shared by the customer's disputes (review of H9: else
 * splitting one complaint into several emails would refund past the per-dispute limit without the CFO).
 */
export function autoRefundedElsewhereCents(db: DB, customer: string, disputeId: string): number {
  return (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM refunds WHERE lower(to_address) = lower(?) AND dispute_id IS NOT NULL AND dispute_id <> ? AND proposal_id IS NULL AND outcome IN ('PAID', 'PENDING', 'HELD')")
    .get(customer, disputeId) as { c: number }).c;
}

/** The automatic refund limits for this dispute: each refund as the policy says; per dispute, what the customer's
 *  other disputes left of it (never more than the policy's own limit). */
export function disputeLimits(base: { eachCents: number; perDisputeCents: number }, db: DB, customer: string, disputeId: string): { eachCents: number; perDisputeCents: number } {
  return { eachCents: base.eachCents, perDisputeCents: Math.max(0, base.perDisputeCents - autoRefundedElsewhereCents(db, customer, disputeId)) };
}

/** dispute.opened events code cannot key (no email text): each is a dispute that came in, handed to the CFO as
 *  D-ev<event id>, never settled. `idOf` decides what is keyable. */
export function unreadableOpened(db: DB, idOf: (email: string) => string | null): { id: string; customer: string; email: string; eventId: number }[] {
  const rows = db.prepare("SELECT id, payload_json FROM world_events WHERE kind = 'dispute.opened' ORDER BY id").all() as { id: number; payload_json: string }[];
  const out: { id: string; customer: string; email: string; eventId: number }[] = [];
  for (const r of rows) {
    let p: Record<string, unknown> | null = null;
    try { const v: unknown = JSON.parse(r.payload_json); p = v && typeof v === "object" ? v as Record<string, unknown> : null; } catch { /* unreadable */ }
    if (p && asOpened(p, idOf)) continue;
    out.push({ id: `D-ev${r.id}`, customer: p && typeof p.customer === "string" ? p.customer.slice(0, 80) : "a customer", email: "", eventId: r.id });
  }
  return out;
}
