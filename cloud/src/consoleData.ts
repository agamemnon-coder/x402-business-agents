// The console's newer reads (Purser Cloud, enterprise pass, 13 Nov), every figure from the company's own rows or a
// record in docs/runs:
//   agents        each agent the company's records name: its job, its Claude model as its own runs recorded it, what it
//                 may and may not do, its card limits as issued, the rails its money moved on, its status, and its newest
//                 decisions with who decided (Claude, or Purser's code when no model answered)
//   tokenisation  the invoice token on Metal testnet (mint, finance, settle), the agents' Airwallex cards and the Visa
//                 credential via Airi, each labelled exactly as its record labels it, with record and explorer links
//   bookings      which ledger entries book each supplier invoice (its accrual, and the payment that settled it)
// Read only. Nothing here pauses, revokes, approves or writes.

import { agentName, AGENT_DISPLAY, AP_AGENT_DISPLAY } from "../../src/config/brand.js";
import { agentOf, feedLine } from "./dashboard.js";
import type { TenantDb } from "./tenant.js";
import TOKENIZE from "../../docs/runs/2026-11-12-tokenize.json" with { type: "json" };
import CARDS from "../../docs/runs/airwallex-cards-2026-11-06.json" with { type: "json" };
import VIC from "../../docs/runs/2026-11-13-vic-4.json" with { type: "json" };

type Json = Record<string, unknown>;
interface Audit { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string }
const payload = (r: Audit): Json => { try { return JSON.parse(r.payload_json) as Json; } catch { return {}; } };
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";

/** What each agent may and may not do, as Purser's code enforces it (src/policy, src/agents). */
const CAN: Record<string, { may: string[]; may_not: string[] }> = {
  sourcing: { may: ["Buy upstream data and the warehouse software on its own card, within its limits", "Ask the CFO for a higher limit"], may_not: ["Raise its own limit", "Pay a supplier invoice", "Pay a merchant outside its card's categories"] },
  support: { may: ["Refund customers when a dispute holds", "Pay the helpdesk software on its own card, within its limits"], may_not: ["Raise its own limit", "Pay a supplier invoice", "Pay a merchant outside its card's categories"] },
  treasury: { may: ["Watch spending and sweep final earnings to Airwallex", "Propose a supplier invoice's payment for the CFO", "Pay small software costs on its own card, within its limits"], may_not: ["Pay any supplier invoice without the CFO's Face ID over its exact terms", "Change a limit or the policy", "Add a supplier"] },
  checker: { may: ["Decide what happens to each supplier invoice: pay, ask the CFO, hold or reject"], may_not: ["Loosen code's own checks (it can only make them stricter)", "Pay anything"] },
  payer: { may: ["Propose how and when a checked invoice is paid: rail, day and currency"], may_not: ["Pay without the CFO's Face ID over the exact terms", "Break a treasury floor"] },
};
const ROLE: Record<string, string> = { sourcing: "Sourcing", support: "Support", treasury: "Treasury", checker: "Payables (checker)", payer: "Payables (payer)" };
const KNOWN = new Set([...Object.keys(AGENT_DISPLAY), ...Object.keys(AP_AGENT_DISPLAY)]);

interface Tx { at: string; direction: string; rail: string; rail_label?: string; amount: string; currency: string; moved: boolean; description: string; approval: { authority: string; required: boolean }; invoice: { ap_id: string | null } | null; booking: { entry_ids: number[] } | null }

/**
 * What a decision came to, for a badge a CFO reads at a glance (Agents, 14 Nov): paid within the card's limit, declined
 * by Airwallex, the CFO asked (a proposal), or a plain note.
 */
export function outcomeOf(r: Pick<Audit, "event" | "payload_json">): "paid" | "declined" | "asked" | "note" {
  if (r.event === "card.charge_approved") return "paid";
  if (r.event === "card.charge_declined") return "declined";
  if (r.event === "proposal.created" || (r.event === "card.decline_met" && typeof payload(r as Audit).proposal_id === "string") || (r.event === "ap.status" && payload(r as Audit).to === "waiting_cfo")) return "asked";
  return "note";
}

/** Each agent the company's records name, newest decisions first. */
export async function agentsOf(db: TenantDb): Promise<Json> {
  const audit = await db.select<Audit>("audit_rows", {}, { order: ["seq"] });
  const txs = (await db.select<{ body_json: string }>("transactions", {}, { order: ["sort_key"] })).map((r) => JSON.parse(r.body_json) as Tx);
  // The month the records stand at: the newest movement's (the demo company's simulated month ends in November).
  const asOfMonth = txs.reduce((m, t) => (t.at > m ? t.at : m), "").slice(0, 7);
  const ids = new Set<string>();
  for (const r of audit) {
    if (KNOWN.has(r.actor)) ids.add(r.actor);
    const a = payload(r).agent;
    if (r.event === "card.issued" && typeof a === "string" && KNOWN.has(a)) ids.add(a);
  }
  const order = [...Object.keys(AGENT_DISPLAY), ...Object.keys(AP_AGENT_DISPLAY)];
  const agents = [...ids].sort((x, y) => order.indexOf(x) - order.indexOf(y)).map((id) => {
    const mine = audit.filter((r) => r.actor === id || payload(r).agent === id || (r.event.startsWith("card.") && r.subject === id));
    const issued = [...mine].reverse().find((r) => r.event === "card.issued");
    const ip = issued ? payload(issued) : {};
    const [perPurchase, perMonth] = String(ip.limits ?? "").split("/").map((s) => s.trim());
    const raised = [...mine].reverse().find((r) => r.event === "card.limit_changed");
    const statusRow = [...mine].reverse().find((r) => ["card.frozen", "card.thawed", "card.closed"].includes(r.event));
    const status = statusRow?.event === "card.closed" ? "revoked" : statusRow?.event === "card.frozen" ? "paused" : "active";
    const models = new Set<string>();
    for (const r of mine) { const m = payload(r).model; if (typeof m === "string" && m.startsWith("claude-")) models.add(m); }
    const moved = txs.filter((t) => t.direction === "out" && !t.invoice && agentOf(t) === id);
    const rails = [...new Set(moved.map((t) => t.rail_label ?? t.rail))];
    const decisions = mine.map((r) => ({ r, f: feedLine(r) })).filter((x) => x.f !== null).reverse().slice(0, 5).map(({ r, f }) => {
      const p = payload(r);
      const by = p.source === "fallback" ? "Purser's code (fallback: no model answered)" : p.source === "claude" ? `Claude${typeof p.model === "string" ? ` (${p.model})` : ""}` : null;
      return { at: r.ts, text: f!.text, decided_by: by, seq: r.seq, outcome: outcomeOf(r) };
    });
    // Spent on its own card in the month the company's records stand at (its newest movement), against the monthly limit.
    const spentMonth = moved.filter((t) => t.moved && t.at.slice(0, 7) === asOfMonth && t.currency === String(ip.currency ?? "EUR")).reduce((n, t) => n + Math.round(Number(t.amount) * 100), 0);
    const runs = mine.filter((r) => r.event === "agent.run").map(payload);
    const fallbackRuns = runs.filter((p) => Array.isArray(p.claude_calls) && (p.claude_calls as unknown[]).length === 0).length;
    return {
      id, name: agentName(id), role: ROLE[id] ?? id,
      job: (AGENT_DISPLAY as Record<string, { job: string }>)[id]?.job ?? (AP_AGENT_DISPLAY as Record<string, { job: string }>)[id]?.job ?? "",
      models: [...models].sort(),
      may: CAN[id]?.may ?? [], may_not: CAN[id]?.may_not ?? [],
      card: issued ? { last4: String(ip.last4 ?? ""), currency: String(ip.currency ?? "EUR"), per_purchase: (raised && typeof payload(raised).per_purchase === "string" ? String(payload(raised).per_purchase) : perPurchase) ?? null, per_month: perMonth ?? null, pays_for: String(ip.nickname ?? "").replace(/^[a-z]+ agent:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, ""), issued_at: issued.ts, month: asOfMonth || null, spent_month: asOfMonth ? (spentMonth / 100).toFixed(2) : null } : null,
      rails, spent: moved.filter((t) => t.moved).length, declined: moved.filter((t) => !t.moved).length,
      status, status_since: statusRow?.ts ?? issued?.ts ?? null,
      runs: { total: runs.length, without_model: fallbackRuns },
      decisions,
    };
  });
  return { agents, controls: "Pausing or revoking an agent is the CFO's decision, signed with Face ID on the company's runner; this view shows the state its records report." };
}

/** Records and their labels, word for word as each record carries them. */
export function tokenisation(): Json {
  const t = TOKENIZE as unknown as { labels: Json; recorded_at: string; invoice: { invoice_no: string; amount: string; currency: string; proposal_id: string; terms_sha256: string; approval: { approved_at: string } }; face_value: { amount: string; unit: string }; discount: { bps: number; price: string }; contract: string; token_id: string; transactions: { key: string; what: string; hash: string; explorer?: string; status: string; at: string }[]; verify: { ok: boolean; settled_on_chain?: boolean } };
  const step = (keys: string[]) => t.transactions.filter((x) => keys.includes(x.key)).map((x) => ({ what: x.what, status: x.status, at: x.at, hash: x.hash, explorer: x.explorer ?? null }));
  const c = CARDS as unknown as { read_at: string; method: string; test_money: boolean; cards: { last4: string; nick_name: string; card_status: string; brand: string; form_factor: string; controls: { transaction_limits?: { currency: string; limits: { amount: number; interval: string }[] }; allowed_merchant_categories?: string[] } }[] };
  const v = VIC as unknown as { run: string; mode: string; label: string; started_at: string; credential_deleted: boolean; purchases: { step: string; what: string; request: { amount: string; currency: string }; outcome?: { status?: string; reason?: string; refusal?: string } | null; mandate_id: string | null; payment_intent_id: string | null }[] };
  return {
    invoice_token: {
      label: [t.labels.prototype ? "prototype" : null, String(t.labels.network ?? ""), t.labels.test_money ? "test money" : null, t.labels.financier === "simulated" ? "financier simulated" : null].filter(Boolean).join(" · "),
      recorded_at: t.recorded_at, invoice: { invoice_no: t.invoice.invoice_no, amount: t.invoice.amount, currency: t.invoice.currency, proposal_id: t.invoice.proposal_id, terms_sha256: t.invoice.terms_sha256, approved_at: t.invoice.approval.approved_at },
      face_value: `${t.face_value.amount} ${t.face_value.unit} (the invoice's amount scaled down by ${String(t.labels.face_value_scaled_by ?? "")})`, discount: `${t.discount.bps / 100}% (price ${t.discount.price})`,
      contract: t.contract, token_id: t.token_id,
      steps: [
        { step: "mint", label: "Minted to the creditor", txs: step(["deploy", "mint"]) },
        { step: "finance", label: "Financed: offered, approved and accepted by the financier", txs: step(["offer", "financier-approve", "accept"]) },
        { step: "settle", label: "Settled by the debtor: face value to the holder, token burned", txs: step(["payer-approve", "settle"]) },
      ],
      verified: !!t.verify.ok && !!t.verify.settled_on_chain,
      record: `${REPO}docs/runs/2026-11-12-tokenize.json`, story: `${REPO}docs/runs/2026-11-12-tokenize.md`,
    },
    agent_cards: {
      label: `Airwallex sandbox · ${c.test_money ? "test money" : ""}`.replace(/ · $/, ""), read_at: c.read_at, method: c.method,
      cards: c.cards.map((x) => ({ last4: x.last4, holder: x.nick_name.replace(/\s*\([^)]*\)\s*$/, ""), status: x.card_status, brand: x.brand, form: x.form_factor, limits: (x.controls.transaction_limits?.limits ?? []).map((l) => `${x.controls.transaction_limits!.currency} ${l.amount.toFixed(2)} ${l.interval === "PER_TRANSACTION" ? "a purchase" : l.interval.toLowerCase()}`), merchant_categories: x.controls.allowed_merchant_categories ?? [] })),
      record: `${REPO}docs/runs/airwallex-cards-2026-11-06.json`,
    },
    visa_credential: {
      label: v.label, run: v.run, mode: v.mode, at: v.started_at, credential_deleted: v.credential_deleted,
      purchases: v.purchases.map((p) => ({ step: p.step, what: p.what, amount: `${p.request.currency} ${p.request.amount}`, outcome: p.outcome?.status ?? null, reason: p.outcome?.reason ?? p.outcome?.refusal ?? null, mandate: p.mandate_id, payment_intent: p.payment_intent_id })),
      record: `${REPO}docs/runs/2026-11-13-vic-4.json`, story: `${REPO}docs/runs/2026-11-13-vic-4.md`,
    },
  };
}

/** For each supplier invoice, the ledger entries that book it: its accrual (ap-accrual|<id>) and the payment that settled it. */
export async function bookingsOf(db: TenantDb): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  const add = (id: string, e: number) => { const l = (out[id] ??= []); if (!l.includes(e)) l.push(e); };
  for (const e of await db.select<{ entry_id: number; entry_json: string }>("ledger_entries", {}, { order: ["entry_id"] })) {
    const key = (JSON.parse(e.entry_json) as { source_key?: string | null }).source_key ?? "";
    const m = /^ap-accrual\|([A-Za-z0-9_.:-]+)$/.exec(key);
    if (m) add(m[1]!, e.entry_id);
  }
  for (const r of await db.select<{ body_json: string }>("transactions", {}, { order: ["sort_key"] })) {
    const t = JSON.parse(r.body_json) as Tx;
    if (t.invoice?.ap_id) for (const e of t.booking?.entry_ids ?? []) add(t.invoice.ap_id, e);
  }
  for (const l of Object.values(out)) l.sort((a, b) => a - b);
  return out;
}

/** The ledger entries that book one of the company's invoices, with their lines; null when it has no such invoice. */
export async function journalOf(db: TenantDb, invoiceId: string): Promise<unknown[] | null> {
  if (!(await db.one("invoices", { id: invoiceId }))) return null;
  const ids = (await bookingsOf(db))[invoiceId] ?? [];
  if (!ids.length) return [];
  const rows = await db.select<{ entry_id: number; entry_json: string }>("ledger_entries", { entry_id: { in: ids } }, { order: ["entry_id"] });
  return rows.map((r) => JSON.parse(r.entry_json) as unknown);
}
