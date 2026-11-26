// Task mandates in the ledger (governance, 26 Nov: "grant authority explicitly; enforce in infrastructure, not prompts").
// What a mandate says and how it is written: src/policy/taskMandateCore.ts. Here:
//   - in force: a mandate counts only when the record puts it there, as the limit to pay alone does
//     (src/policy/aloneLimit.ts): its grant or last widening is a policy change the CFO signed with the passkey
//     (policy.changed from an EXECUTED policy_change approved by passkey), and every change after it is a narrowing
//     recorded here (task_mandate.narrowed, task_mandate.revoked). A mandate written into the settings any other way,
//     or widened without the CFO, counts for nothing.
//   - scope: once an agent has been granted a task mandate (even one revoked or expired since), every payment it makes
//     alone must fall inside a mandate in force: the right kind of payment, an invoice of the right month, a payee it
//     names, its currency, before it ends and within what is left of its total. Anything else is refused with the
//     reason and a task_mandate.refused record, and the payment waits for the CFO's Face ID; it never executes alone.
//     An agent never granted one pays alone as before, within the CFO's limit to pay alone (ap.alone_eur).
//   - narrowing and revoking: at once, without Face ID (a restriction, like the emergency stop); widening is refused here.
// Enforced in approveWithinLimit (src/policy/approvals.ts), the one place code approves a payment without a person, and
// again from the record by the execution guard and verify (src/policy/signedApproval.ts policyApprovalCheck).

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { passkeySignedChange } from "./aloneLimit.js";
import { plainCents } from "./withinLimit.js";
import { checkTaskToken, revokeTaskTokens, TASK_TOKEN_REFUSED } from "./taskTokens.js";
import { installAloneGate } from "./aloneGate.js";
import {
  canonicalMandate, mandateIdOf, mandateKey, mandateWords, parseMandate, payeeKey, principalOfActor, widens, type TaskMandate,
} from "./taskMandateCore.js";

export const MANDATE_NARROWED = "task_mandate.narrowed";
export const MANDATE_REVOKED = "task_mandate.revoked";
export const MANDATE_REFUSED = "task_mandate.refused";
/** The record of the payment approved alone (src/policy/signedApproval.ts WITHIN_LIMIT), which names its mandate. */
const WITHIN_LIMIT = "proposal.within_limit";

export type MandateRefusal = "mandate_none" | "mandate_unsigned" | "mandate_revoked" | "mandate_not_started" | "mandate_expired" | "mandate_purpose" | "mandate_payee" | "mandate_currency" | "mandate_total";

/** A mandate the record puts in force: its value as signed or narrowed since, and the policy change that granted it. */
export interface MandateRecord { id: string; mandate: TaskMandate; value: string; granted_by: string; seq: number }

const parsed = (v: unknown): TaskMandate | null => {
  if (typeof v !== "string") return null;
  const m = parseMandate(v);
  return m.ok && canonicalMandate(m.mandate) === v ? m.mandate : null;
};
const payloadOf = (json: string): Record<string, unknown> => { try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; } };

/**
 * The mandate `id` as the record puts it in force just before audit row `beforeSeq` (now, when omitted): granted or last
 * widened by a passkey-signed policy change, then only narrowed. Null when there is none, or when any write to it does
 * not follow from the one before (a hand-written setting, a widening without the CFO). Reads the ledger only.
 */
export function mandateRecord(db: DB, id: string, beforeSeq = Number.MAX_SAFE_INTEGER): MandateRecord | null {
  const key = mandateKey(id);
  if (!key) return null;
  const rows = db.prepare(`SELECT seq, event, payload_json FROM audit_log WHERE subject = ? AND event IN ('policy.changed', 'setting.changed', ?, ?) AND seq < ? ORDER BY seq`)
    .all(key, MANDATE_NARROWED, MANDATE_REVOKED, beforeSeq) as { seq: number; event: string; payload_json: string }[];
  let now: MandateRecord | null = null;
  for (const r of rows) {
    const p = payloadOf(r.payload_json);
    const to = parsed(p.to);
    if (r.event === "policy.changed") {
      const signed = to ? passkeySignedChange(db, key, p) : null;
      now = signed && to ? { id, mandate: to, value: p.to as string, granted_by: signed, seq: r.seq } : null;
    } else if (r.event === MANDATE_NARROWED || r.event === MANDATE_REVOKED) {
      const was = now as MandateRecord | null;
      now = was && to && p.from === was.value && !widens(was.mandate, to) ? { id, granted_by: was.granted_by, mandate: to, value: p.to as string, seq: r.seq } : null;
    } else {
      now = null;
    }
  }
  return now;
}

const settingOf = (db: DB, key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;

/** The mandate in force now: the record's, and only while the setting still holds exactly that value. */
export function mandateInForce(db: DB, id: string): MandateRecord | null {
  const r = mandateRecord(db, id);
  const key = mandateKey(id);
  return r && key && settingOf(db, key) === r.value ? r : null;
}

/** Every task mandate written in the settings, in id order, with what the record says of it. */
export function listTaskMandates(db: DB): { id: string; value: string; mandate: TaskMandate | null; in_force: boolean; granted_by: string | null; spent: string }[] {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'task\\_mandate.%' ESCAPE '\\' ORDER BY key").all() as { key: string; value: string }[];
  return rows.flatMap((r) => {
    const id = mandateIdOf(r.key);
    if (!id) return [];
    const rec = mandateInForce(db, id);
    return [{ id, value: r.value, mandate: parsed(r.value), in_force: !!rec, granted_by: rec?.granted_by ?? null, spent: fromCents(mandateSpentCents(db, id)) }];
  });
}

/**
 * Whether the agent's authority to pay alone is scoped by task mandates: it was ever granted one (the record), or any
 * mandate in the settings names it or cannot be read (both only make it stricter). Before `beforeSeq`, from the record alone.
 */
export function underMandates(db: DB, agent: string, beforeSeq?: number): boolean {
  const principal = principalOfActor(agent);
  const granted = db.prepare(`SELECT payload_json FROM audit_log WHERE event IN ('policy.changed', ?, ?) AND subject LIKE 'task\\_mandate.%' ESCAPE '\\' AND seq < ?`)
    .all(MANDATE_NARROWED, MANDATE_REVOKED, beforeSeq ?? Number.MAX_SAFE_INTEGER) as { payload_json: string }[];
  if (granted.some((g) => parsed(payloadOf(g.payload_json).to)?.agent === principal)) return true;
  if (beforeSeq !== undefined) return false;
  return listTaskMandates(db).some((m) => !m.mandate || m.mandate.agent === principal);
}

/**
 * What the payments approved alone under mandate `id` add up to, in cents: every one still standing (waiting to run,
 * running, paid, or failed and perhaps retried); a rejected, expired or replaced one no longer counts.
 */
export function mandateSpentCents(db: DB, id: string, exceptProposal?: string): number {
  const rows = db.prepare(`SELECT a.subject, a.payload_json FROM audit_log a JOIN proposals p ON p.proposal_id = a.subject
    WHERE a.event = ? AND json_extract(a.payload_json, '$.mandate') = ? AND p.status IN ('APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED')`).all(WITHIN_LIMIT, id) as { subject: string; payload_json: string }[];
  const seen = new Set<string>();
  let sum = 0;
  for (const r of rows) {
    if (r.subject === exceptProposal || seen.has(r.subject)) continue;
    seen.add(r.subject);
    sum += plainCents(String(payloadOf(r.payload_json).amount ?? "")) ?? 0;
  }
  return sum;
}

/** A payment as a mandate judges it: from its stored terms, and the invoice's issue date from code (never the agent). */
export interface MandatePayment {
  /** The acting agent (approveWithinLimit's `agent`: "payer" pays as treasury). */
  agent: string;
  kind: string;
  terms: { amount?: unknown; currency?: unknown; vendor?: unknown; beneficiary_name?: unknown };
  /** The invoice's issue date (YYYY-MM-DD) as the payables inbox read it; null or absent: unknown. */
  issueDate?: string | null;
  /** The one mandate the payment may stand on: the one its task token carries (src/policy/taskTokens.ts). */
  only?: string;
}

export type MandateCheck = { ok: true; mandate: string | null } | { ok: false; code: MandateRefusal; reason: string; mandate: string | null };

/** The payee a mandate judges: the account holder the money goes to (the beneficiary on file), else the invoice's vendor. */
const payeeOf = (t: MandatePayment["terms"]) => (typeof t.beneficiary_name === "string" && t.beneficiary_name.trim() ? t.beneficiary_name : typeof t.vendor === "string" ? t.vendor : "");

/** Why mandate `rec` does not cover this payment, or null when it does. */
function outside(db: DB, rec: MandateRecord, pay: MandatePayment, now: Date, proposalId?: string): { code: MandateRefusal; why: string } | null {
  const m = rec.mandate;
  const name = `task mandate ${rec.id} (${m.purpose})`;
  if (m.status === "revoked") return { code: "mandate_revoked", why: `${name} was revoked` };
  const today = now.toISOString().slice(0, 10);
  if (today < m.from) return { code: "mandate_not_started", why: `${name} starts ${m.from}` };
  if (today > m.until) return { code: "mandate_expired", why: `${name} expired at the end of ${m.until}` };
  if (!(m.kinds as string[]).includes(pay.kind)) return { code: "mandate_purpose", why: `a ${pay.kind.replace(/_/g, " ")} is not what ${name} is for (${m.kinds.join(", ").replace(/_/g, " ")})` };
  if (m.invoice_month) {
    const issued = typeof pay.issueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pay.issueDate) ? pay.issueDate : null;
    if (!issued) return { code: "mandate_purpose", why: `${name} covers invoices of ${m.invoice_month}, and this invoice's date is not known` };
    if (issued.slice(0, 7) !== m.invoice_month) return { code: "mandate_purpose", why: `the invoice is dated ${issued}; ${name} covers invoices of ${m.invoice_month} only` };
  }
  const payee = payeeOf(pay.terms);
  if (!payee || !m.payees.some((p) => payeeKey(p) === payeeKey(payee))) return { code: "mandate_payee", why: `${payee ? JSON.stringify(payee.slice(0, 80)) : "a payee with no name"} is not a payee of ${name}` };
  if (pay.terms.currency !== m.currency) return { code: "mandate_currency", why: `the payment is in ${String(pay.terms.currency).slice(0, 8)}; ${name} is in ${m.currency}` };
  const amount = typeof pay.terms.amount === "string" ? plainCents(pay.terms.amount) : null;
  if (amount === null) return { code: "mandate_total", why: "the payment's amount is not a plain amount" };
  const spent = mandateSpentCents(db, rec.id, proposalId);
  const total = plainCents(m.total)!;
  if (spent + amount > total) {
    return { code: "mandate_total", why: `${m.currency} ${fromCents(amount)} would take ${name} to ${m.currency} ${fromCents(spent + amount)}, over its total of ${m.currency} ${m.total} (${m.currency} ${fromCents(Math.max(0, total - spent))} left)` };
  }
  return null;
}

/**
 * Whether the agent may pay this alone as far as task mandates go: ok with no mandate when the agent was never granted
 * one; ok with the mandate that covers it; otherwise refused, with the reason the closest mandate gives (one naming this
 * payee first). Writes nothing: approveWithinLimit records the refusal (recordRefusal) in its own transaction.
 */
export function mandateCheck(db: DB, pay: MandatePayment, now = new Date(), proposalId?: string): MandateCheck {
  const principal = principalOfActor(pay.agent);
  if (pay.only === undefined && !underMandates(db, pay.agent)) return { ok: true, mandate: null };
  const mine = listTaskMandates(db).filter((m) => m.mandate?.agent === principal && (pay.only === undefined || m.id === pay.only));
  if (pay.only !== undefined && !mine.some((m) => m.in_force)) {
    return { ok: false, code: "mandate_unsigned", reason: `mandate_unsigned: task mandate ${pay.only.slice(0, 40)}, the one its token carries, is not in force for the ${principal} agent`, mandate: pay.only };
  }
  const inForce = mine.map((m) => mandateInForce(db, m.id)).filter((r): r is MandateRecord => r !== null);
  const misses: { rec: MandateRecord; code: MandateRefusal; why: string }[] = [];
  for (const rec of inForce) {
    const miss = outside(db, rec, pay, now, proposalId);
    if (!miss) return { ok: true, mandate: rec.id };
    misses.push({ rec, ...miss });
  }
  const unsigned = mine.filter((m) => !m.in_force);
  if (!misses.length) {
    return unsigned.length
      ? { ok: false, code: "mandate_unsigned", reason: `mandate_unsigned: task mandate ${unsigned.map((m) => m.id).join(", ")} is not in force (not granted by a policy change the CFO signed with the passkey, or changed since without it); the ${principal} agent pays nothing alone until the CFO grants one`, mandate: unsigned[0]!.id }
      : { ok: false, code: "mandate_none", reason: `mandate_none: the ${principal} agent pays alone only under a task mandate, and none is in force`, mandate: null };
  }
  // The most telling miss: one about a mandate that names this payee (expired, over its total, another month), else the first.
  const payee = payeeKey(payeeOf(pay.terms));
  const best = misses.find((x) => x.code !== "mandate_payee" && x.rec.mandate.payees.some((p) => payeeKey(p) === payee)) ?? misses[0]!;
  return { ok: false, code: best.code, reason: `${best.code}: ${best.why}; the ${principal} agent may not pay it alone`, mandate: best.rec.id };
}

/** The refusal's record: who, which payment, which mandate, why. Runs in the caller's transaction. */
export function recordRefusal(db: DB, proposalId: string, agent: string, check: Extract<MandateCheck, { ok: false }>, now: Date): void {
  audit(db, "system", MANDATE_REFUSED, proposalId, { proposal_id: proposalId, agent, principal: principalOfActor(agent), mandate: check.mandate, code: check.code, reason: check.reason.slice(0, 600) }, now);
}

/**
 * For the execution guard and verify: why a payment approved alone at audit row `seq` (naming `mandate`, or none) did
 * not stand on a mandate then, or null when it did (or the agent was not under mandates then).
 */
export function mandateRecordRefusal(db: DB, agent: string, mandate: unknown, seq: number): string | null {
  if (typeof mandate === "string") return mandateRecord(db, mandate, seq) ? null : `the task mandate it was approved under (${mandate.slice(0, 40)}) was not in force then`;
  return underMandates(db, agent, seq) ? `the ${principalOfActor(agent)} agent was under task mandates then, and the approval names none` : null;
}

function change(db: DB, id: string, to: TaskMandate, event: typeof MANDATE_NARROWED | typeof MANDATE_REVOKED, by: string, now: Date, extra: Record<string, string> = {}): MandateRecord {
  const key = mandateKey(id);
  if (!key) throw new Error(`${JSON.stringify(id)} is not a task mandate id (lower-case letters, digits and dashes)`);
  return db.transaction((): MandateRecord => {
    const rec = mandateInForce(db, id);
    if (!rec) throw new Error(`task mandate ${id} is not in force: nothing to narrow`);
    const value = canonicalMandate(to);
    const ok = parseMandate(value);
    if (!ok.ok) throw new Error(`task mandate ${id}: ${ok.why}`);
    if (value === rec.value) throw new Error(`no change to task mandate ${id}`);
    if (widens(rec.mandate, ok.mandate)) throw new Error(`that widens task mandate ${id}: a wider mandate is a policy change the CFO approves with the passkey (npm run mandates -- grant)`);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, value, now.toISOString());
    audit(db, "human", event, key, { key, from: rec.value, to: value, by: by.slice(0, 80), ...extra }, now);
    return { ...rec, mandate: ok.mandate, value };
  }).immediate();
}

/** Narrows a mandate in force at once (a lower total, fewer payees, an earlier end, ...). Widening is refused here. */
export function narrowTaskMandate(db: DB, id: string, to: TaskMandate, by: string, now = new Date()): MandateRecord {
  return change(db, id, to, MANDATE_NARROWED, by, now);
}

/** Revokes a mandate at once: the agent pays nothing alone under it again. Only a new grant, with Face ID, brings it back. */
export function revokeTaskMandate(db: DB, id: string, reason: string, by: string, now = new Date()): MandateRecord {
  const rec = mandateInForce(db, id);
  if (!rec) throw new Error(`task mandate ${id} is not in force: nothing to revoke`);
  const out = change(db, id, { ...rec.mandate, status: "revoked" }, MANDATE_REVOKED, by, now, { reason: reason.slice(0, 200) });
  // Its task tokens go with it, in the same call (src/policy/taskTokens.ts): a copy an agent kept pays nothing.
  revokeTaskTokens(db, id, `task mandate ${id} was revoked: ${reason}`, now);
  return out;
}

/** The policy change that grants or widens mandate `id`: one change, proposed like any other and signed with the passkey. */
export function grantChange(id: string, m: TaskMandate): { key: string; to: string } {
  const key = mandateKey(id);
  if (!key) throw new Error(`${JSON.stringify(id)} is not a task mandate id (lower-case letters, digits and dashes, 2 to 40)`);
  const value = canonicalMandate(m);
  const ok = parseMandate(value);
  if (!ok.ok) throw new Error(`task mandate ${id}: ${ok.why}`);
  return { key, to: value };
}

/** The mandate in words with what is left of it, for the authority map and the CLI. */
export function mandateSummary(db: DB, rec: MandateRecord, now = new Date()): { id: string; words: string; spent: string; left: string; state: "active" | "revoked" | "expired" | "not started" } {
  const m = rec.mandate;
  const spent = mandateSpentCents(db, rec.id);
  const today = now.toISOString().slice(0, 10);
  const state = m.status === "revoked" ? "revoked" : today > m.until ? "expired" : today < m.from ? "not started" : "active";
  return { id: rec.id, words: mandateWords(m), spent: fromCents(spent), left: fromCents(Math.max(0, plainCents(m.total)! - spent)), state };
}

/**
 * The full gate approveWithinLimit and the execution guard ask (src/policy/aloneGate.ts), installed when this module
 * loads (src/db/open.ts loads it with every ledger the runner opens). A task token first: the agent and the task are the
 * token's, never the caller's; then the agent's task mandates. Each refusal is recorded in the caller's transaction.
 */
installAloneGate({
  check(db, p, terms, a, now) {
    const token = a.taskToken !== undefined ? checkTaskToken(db, a.taskToken, { agent: a.agent }, now) : null;
    if (token && !token.ok) {
      audit(db, "system", TASK_TOKEN_REFUSED, p.proposal_id, { proposal_id: p.proposal_id, agent: a.agent, token_id: token.token_id, code: token.code, reason: token.reason }, now);
      return { ok: false, code: "token", reason: token.reason };
    }
    const scope = mandateCheck(db, { agent: a.agent, kind: p.kind, terms, issueDate: a.issueDate, ...(token?.ok ? { only: token.mandate_id } : {}) }, now, p.proposal_id);
    if (!scope.ok) {
      recordRefusal(db, p.proposal_id, a.agent, scope, now);
      return { ok: false, code: "mandate", reason: scope.reason };
    }
    return { ok: true, mandate: scope.mandate, token: token?.ok ? token.token_id : null };
  },
  executionRefusal: mandateRecordRefusal,
  values: (db) => (db.prepare("SELECT key, value FROM settings WHERE key LIKE 'task\\_mandate.%' ESCAPE '\\' ORDER BY key").all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  validate(value) {
    const m = parseMandate(value);
    if (!m.ok) return m.why;
    return canonicalMandate(m.mandate) === value ? null : `must be written in its one form: ${canonicalMandate(m.mandate)}`;
  },
});
