// The connector's newer reads (Connect any AI, 13 Nov): cash and its projection, what waits for approval, the CFO's policy
// in plain words, spend by agent or supplier, a payment's audit trail and one payment explained. Every figure is counted
// here from the company's own rows (the transactions register, the invoices, the ledger and the audit chain the runner
// pushed). Nothing is estimated beyond what each answer says it is, and nothing here writes.

import { agentName } from "../../../src/config/brand.js";
import { agentOf, feedLine } from "../dashboard.js";
import { report } from "../read.js";
import type { TenantDb } from "../tenant.js";

type Json = Record<string, unknown>;
const cents = (a: unknown): number => (typeof a === "string" && /^-?\d+(\.\d{1,2})?$/.test(a) ? Math.round(Number(a) * 100) : 0);
const money = (c: number) => (c / 100).toFixed(2);
const dayOf = (iso: string) => iso.slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface TxBody {
  id: string; at: string; direction: "in" | "out" | "internal"; rail: string; rail_label?: string; description: string; counterparty: string;
  counterparty_account?: string | null; amount: string; currency: string; fee: { amount: string; currency: string } | null; moved: boolean;
  status: string; status_words?: string; proof?: string | null; flags?: string[]; reconciliation?: string; reconciliation_words?: string;
  invoice: { ap_id: string | null; supplier_no?: string | null; vendor: string } | null;
  approval: { required: boolean; authority: string; proposal_id: string | null; decision: string | null; method: string | null; approved_at: string | null; terms_sha256: string | null };
  booking: { entry_ids: number[]; accounts: string[]; booked: string | null } | null;
}
interface Audit { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string }

const txs = async (db: TenantDb) => (await db.select<{ body_json: string }>("transactions", {}, { order: ["sort_key"] })).map((r) => JSON.parse(r.body_json) as TxBody);
const auditRows = (db: TenantDb) => db.select<Audit>("audit_rows", {}, { order: ["seq"] });
const payload = (r: Audit): Json => { try { return JSON.parse(r.payload_json) as Json; } catch { return {}; } };

/** The currency most money moved in: the one the overview and the cash answer speak. */
function mainCurrency(rows: TxBody[]): string {
  const n = new Map<string, number>();
  for (const t of rows.filter((x) => x.moved && x.direction !== "internal")) n.set(t.currency, (n.get(t.currency) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
}

/**
 * Cash: what moved in and out, in the main currency, up to today, and a projection by week from the books' own open items
 * (receivables expected in, payables due out, by their due days). A projection from due days, not a model and not a
 * bank balance: an overdue item counts in the first week, a late payer or a new invoice is not foreseen.
 */
export async function cashPosition(db: TenantDb, now: Date, weeks = 4): Promise<Json> {
  const rows = await txs(db);
  const currency = mainCurrency(rows);
  const today = now.toISOString().slice(0, 10);
  const moved = rows.filter((t) => t.moved && t.direction !== "internal" && t.currency === currency && dayOf(t.at) <= today);
  const inC = moved.filter((t) => t.direction === "in").reduce((n, t) => n + cents(t.amount), 0);
  const outC = moved.filter((t) => t.direction === "out").reduce((n, t) => n + cents(t.amount) + (t.fee && t.fee.currency === currency ? cents(t.fee.amount) : 0), 0);
  const last30 = moved.filter((t) => dayOf(t.at) > addDays(today, -30));
  const flow30 = last30.reduce((n, t) => n + (t.direction === "in" ? cents(t.amount) : -cents(t.amount)), 0);
  type Open = { as_of: string; items: { party: string; doc_ref: string; currency: string; due_date: string; open_cents: number }[] };
  const q = new URLSearchParams({ as_of: today });
  const pay = (await report(db, "payables", q, now)) as Open, rec = (await report(db, "receivables", q, now)) as Open;
  const projection: { week_from: string; week_to: string; expected_in: string; due_out: string; net: string; projected_net_cash: string }[] = [];
  let run = inC - outC;
  for (let w = 0; w < weeks; w++) {
    const from = addDays(today, w * 7 + (w === 0 ? 0 : 1)), to = addDays(today, (w + 1) * 7);
    const inWeek = (d: string) => (w === 0 ? d <= to : d >= from && d <= to);
    const i = rec.items.filter((x) => x.currency === currency && inWeek(x.due_date)).reduce((n, x) => n + x.open_cents, 0);
    const o = pay.items.filter((x) => x.currency === currency && inWeek(x.due_date)).reduce((n, x) => n + x.open_cents, 0);
    run += i - o;
    projection.push({ week_from: w === 0 ? today : from, week_to: to, expected_in: money(i), due_out: money(o), net: money(i - o), projected_net_cash: money(run) });
  }
  return {
    currency, as_of: today, since: moved[0]?.at ?? null,
    net_cash: money(inC - outC), money_in: money(inC), money_out: money(outC), movements: moved.length, net_flow_last_30_days: money(flow30),
    open: { receivables: money(rec.items.filter((x) => x.currency === currency).reduce((n, x) => n + x.open_cents, 0)), payables: money(pay.items.filter((x) => x.currency === currency).reduce((n, x) => n + x.open_cents, 0)) },
    projection,
    basis: "Net cash is money in minus money out (fees included) on every rail since the first movement Purser recorded, not a bank balance. The projection adds the books' open receivables and payables by due day; overdue items fall in the first week.",
  };
}

const ENDS = new Set(["proposal.approved", "proposal.rejected", "proposal.expired", "proposal.executed", "proposal.executing", "proposal.cancelled"]);

/** What waits for the CFO now: invoices filed for the CFO's Face ID, and other proposals with no decision yet. Read only. */
export async function pendingApprovals(db: TenantDb, origin: string): Promise<Json> {
  const inv = await db.select<{ id: string; vendor: string; invoice_no: string; currency: string; total: string; due_date: string; body_json: string }>("invoices", { status: "waiting_cfo" }, { order: ["due_date"] });
  const audit = await auditRows(db);
  const ended = new Set(audit.filter((r) => ENDS.has(r.event) && r.subject).map((r) => r.subject!));
  const invoiceProposals = new Set(inv.map((i) => (JSON.parse(i.body_json) as { proposal_id?: string | null }).proposal_id).filter((x): x is string => !!x));
  const open = audit.filter((r) => r.event === "proposal.created" && r.subject && !ended.has(r.subject) && !invoiceProposals.has(r.subject));
  const approveIn = (what: "invoices" | "overview") => `${origin}/#/${what}`;
  return {
    invoices: inv.map((i) => ({ id: i.id, vendor: i.vendor, invoice_no: i.invoice_no, currency: i.currency, total: i.total, due_date: i.due_date, proposal_id: (JSON.parse(i.body_json) as { proposal_id?: string | null }).proposal_id ?? null, approve_in: approveIn("invoices") })),
    proposals: open.map((r) => { const p = payload(r); return { id: r.subject!, kind: String(p.kind ?? "proposal"), filed_at: r.ts, filed_by: feedLine({ ...r, event: "proposal.created" })?.who ?? r.actor, terms_sha256: typeof p.terms_sha256 === "string" ? p.terms_sha256 : null, approve_in: approveIn("overview") }; }),
    how_to_approve: "Only the CFO approves, in Purser Cloud, by signing the exact terms with Face ID (a passkey). No AI client, token or API call can approve.",
  };
}

/** The CFO's policy in plain words: Purser's fixed rules, then what the company's own records say it set. */
export async function cfoPolicy(db: TenantDb): Promise<Json> {
  const audit = await auditRows(db);
  const versions = audit.filter((r) => r.event === "policy.version").map((r) => { const p = payload(r); return { version: Number(p.version ?? 0), sha256: String(p.sha256 ?? ""), at: r.ts, changed: String(p.changed ?? "") }; });
  const cards = new Map<string, { agent: string; name: string; currency: string; per_purchase: string; per_month: string; last4: string; since: string }>();
  for (const r of audit.filter((x) => x.event === "card.issued" || x.event === "card.limit_changed")) {
    const p = payload(r);
    const agent = String(p.agent ?? r.subject ?? "");
    if (!agent) continue;
    if (r.event === "card.limit_changed") {
      // A raise the CFO approved (src/executors/policyChange.ts): the per-purchase limit only.
      const was = cards.get(agent);
      if (was && typeof p.per_purchase === "string") cards.set(agent, { ...was, per_purchase: p.per_purchase, since: r.ts });
      continue;
    }
    const [per, month] = String(p.limits ?? "").split("/").map((s) => s.trim());
    if (per) cards.set(agent, { agent, name: agentName(agent), currency: String(p.currency ?? "EUR"), per_purchase: per, per_month: month ?? "", last4: String(p.last4 ?? ""), since: r.ts });
  }
  const floors = new Map<string, { setting: string; value: string; at: string; by: string }>();
  for (const r of audit.filter((x) => x.event === "setting.changed" && x.subject)) floors.set(r.subject!, { setting: r.subject!, value: String(payload(r).after ?? ""), at: r.ts, by: feedLine({ ...r, event: "x" })?.who ?? (r.actor === "human" ? "The CFO" : r.actor) });
  const decided = { approved: audit.filter((r) => r.event === "proposal.approved").length, rejected: audit.filter((r) => r.event === "proposal.rejected").length, expired: audit.filter((r) => r.event === "proposal.expired").length };
  return {
    rules: [
      "Every supplier invoice is paid only after the CFO signs its exact terms (payee, account, amount, currency) with Face ID. A changed term needs a new signature.",
      "A new supplier, or a changed bank account, is checked out of band and approved by the CFO before anyone can pay it.",
      "Each agent pays only with its own company card, within that card's per-purchase and monthly limits; Airwallex declines anything over them.",
      "An agent that needs more asks: a higher limit or a policy change is a proposal the CFO approves with Face ID, or it expires.",
      "An AI connected over MCP reads; it cannot approve, pay, change a limit or write to the books.",
    ],
    rules_source: "Purser's own code enforces these (src/policy on the runner); they are not settings a token can change.",
    policy_version: versions.at(-1) ?? null,
    policy_history: versions,
    agent_cards: [...cards.values()],
    settings: [...floors.values()],
    decisions: decided,
  };
}

/** Money out, by agent (each agent's own card; invoices the CFO approved as one line) or by supplier, per currency. */
export async function spendBy(db: TenantDb, by: "agent" | "supplier", from: string | null, to: string | null): Promise<Json> {
  const rows = (await txs(db)).filter((t) => t.direction === "out" && (!from || dayOf(t.at) >= from) && (!to || dayOf(t.at) <= to));
  const groups = new Map<string, { key: string; label: string; currency: string; cents: number; count: number; declined: number; via: Set<string> }>();
  for (const t of rows) {
    let key: string, label: string;
    if (by === "agent") {
      const a = t.invoice ? null : agentOf(t);
      key = t.invoice ? "invoices" : a ?? "other";
      label = t.invoice ? "Supplier invoices, CFO-approved" : a ? `${agentName(a)}, own card` : "Other";
    } else {
      label = t.invoice?.vendor || t.counterparty || "Unknown";
      key = label.toLowerCase();
    }
    const g = groups.get(`${key}|${t.currency}`) ?? { key, label, currency: t.currency, cents: 0, count: 0, declined: 0, via: new Set<string>() };
    if (t.moved) { g.cents += cents(t.amount) + (t.fee && t.fee.currency === t.currency ? cents(t.fee.amount) : 0); g.count++; } else g.declined++;
    g.via.add(t.rail_label ?? t.rail);
    groups.set(`${key}|${t.currency}`, g);
  }
  const items = [...groups.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label)).map((g) => ({ key: g.key, label: g.label, currency: g.currency, amount: money(g.cents), count: g.count, declined: g.declined, rails: [...g.via].sort() }));
  const totals: Record<string, string> = {};
  for (const i of items) totals[i.currency] = money(cents(totals[i.currency] ?? "0") + cents(i.amount));
  return { by, from, to, items, totals, basis: "Money that moved out, fees included; a declined charge is counted, not added." };
}

/** One money movement, found by its own id, its invoice's id (AP-…) or its proposal's id (P-…). */
export async function findPayment(db: TenantDb, id: string): Promise<TxBody | null> {
  const direct = await db.one<{ body_json: string }>("transactions", { id });
  if (direct) return JSON.parse(direct.body_json) as TxBody;
  const all = await txs(db);
  return all.reverse().find((t) => t.invoice?.ap_id === id || t.approval.proposal_id === id || t.proof === id) ?? null;
}

/** A payment's trail: each audit row that names it, its invoice, its proposal or its transfer, in order, with the books. */
export async function auditTrail(db: TenantDb, t: TxBody): Promise<Json> {
  const subjects = new Set([t.id, t.invoice?.ap_id, t.approval.proposal_id, t.proof].filter((x): x is string => !!x));
  const audit = (await auditRows(db)).filter((r) => r.subject && subjects.has(r.subject));
  const steps = audit.map((r) => {
    const words = feedLine(r);
    const p = payload(r);
    const text = words?.text ?? (r.event === "transfer.fee" ? `The bank's fee: ${String(p.fee ?? "")}${p.fee_max ? ` (at most ${String(p.fee_max)} was approved)` : ""}` : r.event === "ap.review_note" ? `Checked by ${p.by === "code" ? "Purser's code" : String(p.by ?? "a person")}; status ${String(p.status ?? "").replace(/_/g, " ")}` : r.event === "transfer.status" ? `Transfer ${r.subject} is ${String(p.status ?? "").toLowerCase()}` : r.event === "transfer.created" ? `Transfer ${r.subject} created at the bank` : r.event === "proposal.executing" ? `${r.subject} being carried out` : r.event.replace(/[._]/g, " "));
    return { seq: r.seq, at: r.ts, who: words?.who ?? (r.actor === "human" ? "The CFO" : r.actor === "awx-executor" ? "Purser (Airwallex)" : "Purser's code"), event: r.event, subject: r.subject, text, row_hash: r.row_hash };
  });
  const entries = t.booking?.entry_ids?.length ? await db.select<{ entry_id: number; posting_date: string; description: string; entry_hash: string }>("ledger_entries", { entry_id: { in: t.booking.entry_ids } }, { order: ["entry_id"] }) : [];
  return {
    payment: { id: t.id, at: t.at, direction: t.direction, amount: t.amount, currency: t.currency, counterparty: t.counterparty, rail: t.rail_label ?? t.rail, status: t.status_words ?? t.status, proof: t.proof ?? null },
    approval: t.approval,
    steps,
    books: entries.map((e) => ({ entry_id: e.entry_id, posting_date: e.posting_date, description: e.description, entry_hash: e.entry_hash })),
    chained: "Each step is a row in the company's audit chain (each row's hash covers the one before); each booking is a ledger entry in its own hash chain.",
  };
}

/** One payment in plain words: who, how much, why, who allowed it and how, where it is booked, and whether it reconciles. */
export function explain(t: TxBody, trail: Json): { sentence: string; lines: string[]; data: Json } {
  const amount = `${t.currency} ${Number(t.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = new Date(t.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const verb = t.direction === "in" ? `${t.counterparty} paid the company ${amount}` : t.direction === "out" ? `The company paid ${t.counterparty} ${amount}` : `${amount} moved between the company's own accounts`;
  const why = t.invoice ? `for invoice ${t.invoice.supplier_no ?? t.invoice.ap_id ?? ""}${t.invoice.ap_id ? ` (${t.invoice.ap_id})` : ""}` : t.description ? `for ${t.description}` : "";
  const ap = t.approval;
  const allowed = ap.required
    ? ap.approved_at ? `The CFO approved ${ap.proposal_id ?? "it"} on ${new Date(ap.approved_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} by signing its exact terms${ap.method === "passkey" || ap.method === "webauthn" ? " with Face ID" : ""}${ap.terms_sha256 ? ` (terms ${ap.terms_sha256.slice(0, 12)}…)` : ""}.` : `It needs the CFO's Face ID and has none yet (${ap.authority}).`
    : `No CFO approval was needed: ${ap.authority}.`;
  const booked = t.booking?.entry_ids?.length ? `Booked in ledger entr${t.booking.entry_ids.length === 1 ? "y" : "ies"} ${t.booking.entry_ids.join(", ")} (accounts ${t.booking.accounts.join(", ")}).` : "Not booked yet.";
  const rec = `Reconciliation: ${t.reconciliation_words ?? t.reconciliation ?? "unknown"}${t.flags?.length ? `; flags: ${t.flags.join(", ")}` : ""}.`;
  const sentence = `${verb} on ${when} ${why}`.trim().replace(/\s+/g, " ") + ` via ${t.rail_label ?? t.rail}; ${t.status_words ?? t.status}.`;
  return { sentence, lines: [allowed, booked, rec, ...(t.proof ? [`Proof at the rail: ${t.proof}.`] : [])], data: { payment: (trail as { payment: Json }).payment, explanation: { what: sentence, allowed_by: allowed, booked, reconciliation: rec }, approval: ap, steps: (trail as { steps: unknown[] }).steps, books: (trail as { books: unknown[] }).books } };
}

/** The quarter a day is in, like 2026Q4. */
export const quarterOf = (iso: string) => `${iso.slice(0, 4)}Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
