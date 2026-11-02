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
import { decisionOf, finished, legacyDecision } from "./disputeDecision.js";

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
 * Hands a dispute that came in, and that code could not settle, to the CFO: recorded once per dispute
 * (dispute.escalated), shown on the dashboard's refusals and on /health while it is undecided. It moves no money and
 * makes no refund proposal: the CFO settles it (npm run s2 -- --dispute <id>, or a refund proposal with Face ID).
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
