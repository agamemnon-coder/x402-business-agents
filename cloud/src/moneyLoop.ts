// Cash & FX and Receivables in Purser Cloud (v1.5.1): the money loop in short, as the runner reads it from its own ledger
// (src/treasury/cloudSnapshot.ts moneyLoopSnapshot: cash per currency against the CFO's floors, the 13-week forecast,
// the FX exposure with the advisor's decision and the conversions it filed for the CFO's passkey; the receivables by
// invoice number and amount, the payments matched to them, the review queue and the reminder steps). The cloud holds
// no receivables, floors or FX threshold of its own, so the runner sends the snapshot with its sync (the first batch),
// as it sends the authority map and the compliance summary. It is checked here against a strict schema (every field
// named, each text bounded, no customer or payer name, no reminder text), kept per company as one row ('latest') and
// read by GET /v1/treasury and GET /v1/receivables. The same figures again change nothing; an older snapshot never
// replaces a newer one. Read only: a conversion is approved with the CFO's passkey on the runner's approval flow, never
// here.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { z } from "zod";
import { sha256Hex } from "./crypto.js";
import type { Stmt, TenantDb } from "./tenant.js";

export const MONEY_LOOP_MAX_BYTES = 256 * 1024;
const STAMP = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CUR = z.string().regex(/^[A-Z]{3}$/);
const C = z.number().int().min(-1e13).max(1e13);
const N = z.number().int().min(0).max(1e13);
const WEEK = z.number().int().min(0).max(53);
const TEXT = (n: number) => z.string().max(n);
const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$/);
const BUCKET = z.enum(["0-30", "31-60", "61-90", "90+"]);

export const MoneyLoopSnapshot = z.object({
  generated_at: STAMP,
  as_of: DAY,
  money: TEXT(80),
  cash: z.array(z.object({ currency: CUR, cents: C, floor_cents: N }).strict()).max(20),
  forecast: z.object({
    opening_source: TEXT(120),
    weeks: z.array(z.object({ week: WEEK, from: DAY, to: DAY, rows: z.array(z.object({ currency: CUR, in_cents: N, out_cents: N, closing_cents: C, below_floor: z.boolean() }).strict()).max(20) }).strict()).max(26),
    currencies: z.array(z.object({ currency: CUR, opening_cents: C, in_cents: N, out_cents: N, closing_cents: C, min_closing_cents: C, min_week: WEEK, floor_cents: N, below_floor_weeks: z.array(WEEK).max(26) }).strict()).max(20),
    excluded: z.array(z.object({ ref: TEXT(80), currency: CUR, cents: N, why: TEXT(200) }).strict()).max(100),
  }).strict(),
  fx: z.object({
    threshold_eur_cents: N.nullable(),
    exposures: z.array(z.object({
      currency: CUR, min_closing_cents: C, min_week: WEEK, floor_cents: N, shortfall_cents: N, spare_cents: N, eur_cents: N.nullable(),
      decision: z.enum(["none", "proposal", "below_threshold", "no_threshold", "no_rate", "no_source", "not_priced"]),
    }).strict()).max(20),
    proposals: z.array(z.object({
      proposal_id: ID, status: z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED", "EXECUTING", "EXECUTED", "FAILED", "NEEDS_REAPPROVAL"]),
      buy_currency: CUR, buy_cents: N, sell_currency: CUR, sell_max_cents: N, indicative_sell_cents: N, rate: TEXT(24), rate_at: TEXT(40), created_at: TEXT(40), expires_at: TEXT(40), week: WEEK.nullable(),
    }).strict()).max(20),
  }).strict(),
  receivables: z.object({
    invoices: z.array(z.object({
      invoice_no: ID, currency: CUR, amount_cents: N, paid_cents: N, issue_date: DAY, due_date: DAY, status: z.enum(["OPEN", "PARTIAL", "PAID", "OVERPAID"]), days_overdue: N, bucket: BUCKET, pay_link: z.boolean(),
    }).strict()).max(200),
    aged: z.array(z.object({ currency: CUR, buckets: z.object({ "0-30": N, "31-60": N, "61-90": N, "90+": N }).strict(), not_due_cents: N }).strict()).max(20),
    payments: z.array(z.object({
      payment_id: ID, currency: CUR, amount_cents: N, invoice_no: ID.nullable(), outcome: z.enum(["MATCHED", "MATCHED_TOLERANCE", "PARTIAL", "OVERPAID", "REVIEW"]),
      applied_cents: N, written_off_cents: N, suspense_cents: N, received_at: TEXT(40),
    }).strict()).max(200),
    review: z.array(z.object({ payment_id: ID, currency: CUR, amount_cents: N, reference: TEXT(140), reason: TEXT(300), created_at: TEXT(40) }).strict()).max(100),
    dunning: z.array(z.object({ invoice_no: ID, stage: z.number().int().min(1).max(3), due_on: DAY }).strict()).max(300),
  }).strict(),
}).strict().refine((s) => JSON.stringify(s).length <= MONEY_LOOP_MAX_BYTES, `the money loop snapshot is larger than ${MONEY_LOOP_MAX_BYTES} bytes`);
export type MoneyLoopSnapshot = z.infer<typeof MoneyLoopSnapshot>;

/** The figures' hash, without the moment they were read: the same figures pushed again are unchanged. */
export async function moneyLoopSha(s: MoneyLoopSnapshot): Promise<string> {
  const figures: Partial<MoneyLoopSnapshot> = { ...s };
  delete figures.generated_at;
  return sha256Hex(jcs(figures as unknown as Json));
}

/** The statements that keep the pushed snapshot, and what it did: added, changed (a newer one) or unchanged. */
export async function storeMoneyLoop(db: TenantDb, s: MoneyLoopSnapshot, now: string, out: Stmt[]): Promise<{ added: number; changed: number; unchanged: number }> {
  const sha = await moneyLoopSha(s);
  const cur = await db.one<{ at: string; body_sha256: string }>("money_loops", { id: "latest" });
  if (cur && (cur.body_sha256 === sha || s.generated_at < cur.at)) return { added: 0, changed: 0, unchanged: 1 };
  const row = { at: s.generated_at, body_json: JSON.stringify(s), body_sha256: sha, received_at: now };
  out.push(cur ? db.update("money_loops", { id: "latest" }, row) : db.insert("money_loops", { id: "latest", ...row }));
  return cur ? { added: 0, changed: 1, unchanged: 0 } : { added: 1, changed: 0, unchanged: 0 };
}

/** The company's newest snapshot and when the cloud received it; null before the runner pushed one. */
export async function readMoneyLoop(db: TenantDb): Promise<{ loop: MoneyLoopSnapshot | null; received_at: string | null }> {
  const r = await db.one<{ body_json: string; received_at: string }>("money_loops", { id: "latest" });
  return { loop: r ? (JSON.parse(r.body_json) as MoneyLoopSnapshot) : null, received_at: r?.received_at ?? null };
}

/** GET /v1/treasury: cash, the forecast and FX, as the runner read them; read only. */
export async function treasuryOf(db: TenantDb, demo: boolean): Promise<Record<string, unknown>> {
  const { loop, received_at } = await readMoneyLoop(db);
  const base = { demo, test_money: true, received_at };
  if (!loop) return { ...base, treasury: null };
  return { ...base, treasury: { generated_at: loop.generated_at, as_of: loop.as_of, money: loop.money, cash: loop.cash, forecast: loop.forecast, fx: loop.fx,
    approval: "A conversion is approved with the CFO's passkey, through Purser's approval flow; this page approves nothing." } };
}

/** GET /v1/receivables: open invoices, matched payments, the review queue and the reminder steps; read only. */
export async function receivablesOf(db: TenantDb, demo: boolean): Promise<Record<string, unknown>> {
  const { loop, received_at } = await readMoneyLoop(db);
  const base = { demo, test_money: true, received_at };
  if (!loop) return { ...base, receivables: null };
  return { ...base, receivables: { generated_at: loop.generated_at, as_of: loop.as_of, money: loop.money, ...loop.receivables,
    reminders: "Reminders are drafts on the runner for a person to send; Purser sends nothing." } };
}
