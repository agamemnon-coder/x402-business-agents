// GET /v1/dashboard: the console's start screen in one answer, every figure counted here from the company's own rows
// (the transactions register, the invoices and the audit chain the runner pushed). Nothing is estimated or typed:
//   cash      money in minus money out, day by day, in the main currency (moved rows only; fees count as out)
//   spend     what moved out, by who started it: each agent's own card purchases (the register's authority names the
//             agent), and supplier invoices paid with the CFO's approval
//   approvals per week: what moved out with the CFO's approval of the exact terms, and what moved within an agent's own
//             limits; what waits for the CFO now
//   invoices  the payables by state, count and amount
//   feed      the newest decisions in the audit chain, in words, each with who made it and how (Claude, Purser's code,
//             or code's fallback when no model answered)
// The main currency is the one most rows moved in; other currencies are listed with their totals only.

import { agentName } from "../../src/config/brand.js";
import type { TenantDb } from "./tenant.js";

const cents = (a: unknown): number => (typeof a === "string" && /^-?\d+(\.\d{1,2})?$/.test(a) ? Math.round(Number(a) * 100) : 0);
const money = (c: number) => (c / 100).toFixed(2);
const dayOf = (iso: string) => iso.slice(0, 10);
/** The Monday of an ISO date's week (UTC). */
function weekOf(iso: string): string {
  const d = new Date(`${dayOf(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

interface Tx { at: string; direction: "in" | "out" | "internal"; flow: "in" | "out"; rail: string; currency: string; amount: string; moved: boolean; description: string; fee: { amount: string; currency: string } | null; approval: { required: boolean; authority: string; approved_at?: string | null }; invoice: { vendor: string } | null; counterparty: string }
interface Audit { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string }

const AGENTS = new Set(["sourcing", "support", "treasury", "checker", "coder", "payer", "reader", "claude"]);
export const agentOf = (t: Pick<Tx, "approval" | "description">): string | null => /\bthe (\w+) agent\b/i.exec(`${t.approval.authority} ${t.description}`)?.[1]?.toLowerCase() ?? null;
const reasonWords: Record<string, string> = { LIMIT_EXCEEDED: "over the card's limit", MERCHANT_CATEGORY_NOT_ALLOWED: "a merchant category this card may not pay" };
const who = (actor: string) => (actor === "human" ? "The CFO" : AGENTS.has(actor) && actor !== "claude" ? agentName(actor) : actor === "awx-executor" ? "Purser (Airwallex)" : "Purser's code");

export interface FeedItem { at: string; who: string; text: string; tone: "ok" | "bad" | "info" | "wait"; by: "agent" | "cfo" | "code" }

/** One audit row in words, or null when it is plumbing (a step marker, a read-back, a setting). */
export function feedLine(r: Audit): FeedItem | null {
  let p: Record<string, unknown> = {};
  try { p = JSON.parse(r.payload_json) as Record<string, unknown>; } catch { /* words without details */ }
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const base = { at: r.ts, who: who(r.actor), by: (r.actor === "human" ? "cfo" : AGENTS.has(r.actor) ? "agent" : "code") as FeedItem["by"] };
  switch (r.event) {
    case "card.charge_approved": return { ...base, text: `Paid ${s("amount")} ${s("currency")} at ${s("merchant")} on its own card, within its limit`, tone: "ok" };
    case "card.charge_declined": return { ...base, text: `Airwallex declined ${s("amount")} ${s("currency")} at ${s("merchant")}: ${reasonWords[s("reason")] ?? s("reason")}`, tone: "bad" };
    case "card.decline_met": return { ...base, text: `${p.proposal_id ? `Read the decline and asked the CFO for a higher limit (${s("proposal_id")})` : "Read the decline and asked for nothing: a higher limit would not help"}${s("source") === "fallback" ? " (code's fallback, no model)" : ""}`, tone: "info" };
    case "receivable.matched": return { ...base, text: `Matched a payment in: ${s("detail")}`, tone: "ok" };
    case "proposal.created": return { ...base, text: `Proposed ${s("kind").replace(/_/g, " ")} ${r.subject ?? ""} for the CFO`.trim(), tone: "wait" };
    case "proposal.approved": return { ...base, text: `Approved ${r.subject ?? ""} by signing its exact terms with a passkey`, tone: "ok" };
    case "proposal.executed": return { ...base, text: `${r.subject ?? "A proposal"} carried out${s("status") ? `: ${s("status")}` : ""}`, tone: "ok" };
    case "proposal.expired": return { ...base, text: `${r.subject ?? "A proposal"} expired without a decision; nothing moved`, tone: "info" };
    case "ap.received": return { ...base, text: `Invoice ${s("invoice_no")} received and read by ${s("read_by") === "claude" ? "Claude" : "Purser's code"}`, tone: "info" };
    case "ap.status": {
      const to = s("to");
      if (to === "waiting_cfo") return { ...base, text: `${r.subject} filed for the CFO's Face ID`, tone: "wait" };
      if (to === "paid") return { ...base, text: `${r.subject} paid`, tone: "ok" };
      if (to === "needs_vendor") return { ...base, text: `${r.subject} waits: its supplier is new`, tone: "wait" };
      return null;
    }
    case "ap.duplicate_document": return { ...base, text: `A second copy of an invoice (${s("filename")}) was stopped as a duplicate`, tone: "bad" };
    case "payee.add_requested": return { ...base, text: `Asked to add a new supplier, ${s("vendor")} (${s("account")})`, tone: "wait" };
    case "payee.add_verified": return { ...base, text: `Verified ${s("vendor")}'s account out of band: ${s("how")}`, tone: "ok" };
    case "payee.added": return { ...base, text: `Added ${s("vendor")} as a payee after the CFO's approval`, tone: "ok" };
    default: return null;
  }
}

/** asOf: the day the figures stand at (the demo company's own end); otherwise the newest movement or decision. */
/**
 * The audit trail in words, and its counts, once (review, 13 Nov: the Overview said 33 decisions while the MCP tool
 * said 25, its default page of entries): `entries`, every line newest first (agents, the CFO and Purser's code);
 * `agent_decisions`, the lines an agent made; `by_fallback`, how many of those code answered with no model. The
 * Overview and the MCP tools (company_overview, agent_decisions) all read these numbers from here.
 */
export function decisionLog(rows: Audit[]): { entries: FeedItem[]; agent_decisions: number; by_fallback: number } {
  return {
    entries: rows.map(feedLine).filter((x): x is FeedItem => x !== null).reverse(),
    agent_decisions: rows.filter((r) => AGENTS.has(r.actor) && feedLine(r) !== null).length,
    by_fallback: rows.filter((r) => r.event === "card.decline_met" && /"source":"fallback"/.test(r.payload_json)).length + rows.filter((r) => r.event === "claude.fallback").length,
  };
}

export async function dashboard(db: TenantDb, o: { asOf?: string } = {}): Promise<unknown> {
  const txs = (await db.select<{ body_json: string }>("transactions", {}, { order: ["sort_key"] })).map((r) => JSON.parse(r.body_json) as Tx);
  const inv = await db.select<{ status: string; currency: string; total: string; vendor: string; due_date: string }>("invoices", {}, { order: ["id"] });
  const audit = await db.select<Audit>("audit_rows", {}, { order: ["seq"] });

  const moved = txs.filter((t) => t.moved && t.direction !== "internal");
  const byCur = new Map<string, number>();
  for (const t of moved) byCur.set(t.currency, (byCur.get(t.currency) ?? 0) + 1);
  const currency = [...byCur.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
  const main = moved.filter((t) => t.currency === currency).sort((a, b) => a.at.localeCompare(b.at));

  // Cash: the net of what moved, day by day, from the first movement to the last.
  const days: { day: string; in: number; out: number; net: number }[] = [];
  let run = 0;
  if (main.length) {
    const first = new Date(`${dayOf(main[0]!.at)}T00:00:00Z`), last = new Date(`${dayOf(main.at(-1)!.at)}T00:00:00Z`);
    for (let d = first; d <= last; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10);
      const today = main.filter((t) => dayOf(t.at) === k);
      const inC = today.filter((t) => t.direction === "in").reduce((n, t) => n + cents(t.amount), 0);
      const outC = today.filter((t) => t.direction === "out").reduce((n, t) => n + cents(t.amount) + (t.fee && t.fee.currency === currency ? cents(t.fee.amount) : 0), 0);
      run += inC - outC;
      days.push({ day: k, in: inC, out: outC, net: run });
    }
  }
  const totalIn = days.reduce((n, d) => n + d.in, 0), totalOut = days.reduce((n, d) => n + d.out, 0);

  // Spend by who started it.
  const spend = new Map<string, { key: string; label: string; cents: number; count: number; declined: number }>();
  const bump = (key: string, label: string, c: number, ok: boolean) => {
    const s = spend.get(key) ?? { key, label, cents: 0, count: 0, declined: 0 };
    if (ok) { s.cents += c; s.count++; } else s.declined++;
    spend.set(key, s);
  };
  for (const t of txs.filter((x) => x.direction === "out" && x.currency === currency)) {
    const fee = t.fee && t.fee.currency === currency ? cents(t.fee.amount) : 0;
    if (t.invoice) bump("invoices", "Supplier invoices, CFO-approved", cents(t.amount) + fee, t.moved);
    else { const a = agentOf(t); bump(a ?? "other", a ? `${agentName(a)}, own card` : "Other", cents(t.amount) + fee, t.moved); }
  }

  // Approvals per week.
  const weeks = new Map<string, { week: string; cfo: number; cfo_cents: number; alone: number; alone_cents: number }>();
  for (const t of main.filter((x) => x.direction === "out")) {
    const w = weeks.get(weekOf(t.at)) ?? { week: weekOf(t.at), cfo: 0, cfo_cents: 0, alone: 0, alone_cents: 0 };
    if (t.approval.required) { w.cfo++; w.cfo_cents += cents(t.amount); } else { w.alone++; w.alone_cents += cents(t.amount); }
    weeks.set(w.week, w);
  }

  // Invoices by state.
  const state = (s: string) => (s === "paid" ? "paid" : s === "waiting_cfo" ? "waiting_cfo" : s === "needs_vendor" ? "needs_vendor" : ["blocked", "rejected"].includes(s) ? "stopped" : "open");
  const invoices: Record<string, { count: number; amount: string }> = {};
  for (const k of ["paid", "waiting_cfo", "needs_vendor", "open", "stopped"]) invoices[k] = { count: 0, amount: "0.00" };
  for (const r of inv.filter((x) => x.currency === currency)) { const k = state(r.status); invoices[k]!.count++; invoices[k]!.amount = money(cents(invoices[k]!.amount) + cents(r.total)); }
  const duplicates = audit.filter((r) => r.event === "ap.duplicate_document").length;

  // The feed: the newest decisions, newest first; the counts from decisionLog, the one source the MCP tools use too.
  const log = decisionLog(audit);
  const feed = log.entries.slice(0, 14);
  const decisions = log.agent_decisions, byFallback = log.by_fallback;
  const approvedByCfo = audit.filter((r) => r.event === "proposal.approved").length;

  return {
    currency,
    as_of: o.asOf ?? ([main.at(-1)?.at, audit.at(-1)?.ts].filter((x): x is string => !!x).sort().at(-1) ?? null),
    since: main[0]?.at ?? null,
    money: { in: money(totalIn), out: money(totalOut), net: money(totalIn - totalOut), movements: main.length, other_currencies: [...byCur.keys()].filter((c) => c !== currency) },
    cash: days.map((d) => ({ day: d.day, in: money(d.in), out: money(d.out), net: money(d.net) })),
    spend: [...spend.values()].sort((a, b) => b.cents - a.cents).map((s) => ({ key: s.key, label: s.label, amount: money(s.cents), count: s.count, declined: s.declined })),
    approvals: { weeks: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ week: w.week, cfo: w.cfo, cfo_amount: money(w.cfo_cents), alone: w.alone, alone_amount: money(w.alone_cents) })),
      approved_by_cfo: approvedByCfo, waiting: invoices.waiting_cfo!.count },
    invoices: { ...invoices, duplicates_stopped: duplicates },
    agents: { decisions, by_fallback: byFallback },
    feed,
  };
}
