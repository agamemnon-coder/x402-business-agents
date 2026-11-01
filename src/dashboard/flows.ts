// D23: the money flow for the control tower's animation, read from the ledger's audit log only. Each movement is one
// recorded event (or a run of sales folded into one) with its own proof: a Metal transaction (a *USDZ stablecoin
// payment on chain) or an Airwallex id. "Decided" names who made the move: the agent's own Claude decision (its model)
// only when that decision used the tool behind this movement, the CFO's approval, or code following a policy.

import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";

const EXPLORER = "https://testnet.metalntwx.com/tx/";
export type FlowNode = "customer" | "northwind" | "sourcing" | "support" | "treasury" | "suppliers" | "airwallex" | "payee" | "merchant";
export type FlowRail = "metal" | "purser" | "airwallex_card" | "airwallex_swift" | "airwallex_deposit";
export interface FlowEvent {
  at: string;
  kind: "sale" | "upstream" | "refund" | "sweep" | "booked" | "licence" | "card" | "deposit";
  from: FlowNode;
  to: FlowNode;
  amount: string;
  unit: "*USDZ" | "EUR" | "USD" | "GBP";
  rail: FlowRail;
  /** Who moved it (an agent), or null for the customer's own payment. */
  agent: string | null;
  /** The Claude model whose decision made this move, or null. */
  model: string | null;
  decided: string;
  /** What it was, in a few words (merchant, supplier, invoice). */
  what: string;
  proof: { label: string; href: string | null; full: string | null };
  refused?: { by: "purser" | "metal" | "airwallex"; reason: string };
  /** Folded runs of sales or purchases. */
  count?: number;
}

type Row = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string };
const MODEL_WORDS: Record<string, string> = { "claude-haiku-5-5": "Claude Haiku", "claude-sonnet-5-5": "Claude Sonnet", "claude-opus-5-5": "Claude Opus" };
const AGENT_WORDS: Record<string, string> = { sourcing: "the Sourcing agent", support: "the Support agent", treasury: "the Treasury agent" };
/** The agent's tools behind each kind of movement: a decision that used none of them made no such move. */
const TOOLS: Partial<Record<FlowEvent["kind"], string[]>> = { refund: ["settle_dispute"], sweep: ["sweep_earnings"], licence: ["plan_invoice"], card: ["buy_software", "buy_report"], upstream: ["set_buy_policy"] };
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const txProof = (tx: string | undefined | null) => (tx ? { label: `tx ${short(tx)}`, href: `${EXPLORER}${tx}`, full: tx } : { label: "no tx recorded", href: null, full: null });
const awxProof = (id: string | null | undefined) => (id ? { label: `Airwallex ${id.length > 18 ? `${id.slice(0, 8)}…` : id}`, href: null, full: id } : { label: "no Airwallex id recorded", href: null, full: null });
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

export function flowEvents(db: DB, limit = 80): FlowEvent[] {
  if (!has(db, "audit_log")) return [];
  const rows = db.prepare(`SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event IN
    ('sale.delivered', 'upstream.paid', 'upstream.refused', 'upstream.refused_on_chain', 'refund.paid', 'sweep.paid', 'credit.deposited',
     'transfer.created', 'transfer.status', 'card.charge_approved', 'card.charge_declined', 'receivable.matched', 'receivable.escalated', 'agent.decision',
     'dispute.settled_by_agent', 'sourcing.policy_set', 'licence.timing_advised')
    ORDER BY seq`).all() as Row[];
  const decisions = rows.filter((r) => r.event === "agent.decision").map((r) => ({ seq: r.seq, ts: r.ts, actor: r.actor, p: JSON.parse(r.payload_json) as { source?: string; model?: string | null; tools?: string[] } }));
  const settled = rows.filter((r) => r.event === "dispute.settled_by_agent").map((r) => ({ seq: r.seq, ts: r.ts, p: JSON.parse(r.payload_json) as { model?: string; refunded?: string[] } }));
  // The buy policy in force at a purchase: the last one the Sourcing agent set before it, and the Claude decision that set it.
  const advised = rows.filter((r) => r.event === "licence.timing_advised").map((r) => ({ seq: r.seq, model: (JSON.parse(r.payload_json) as { model?: string }).model ?? null }));
  const policies = rows.filter((r) => r.event === "sourcing.policy_set").map((r) => ({ seq: r.seq, ts: r.ts }));
  const policyAt = (seq: number): string | null => {
    const set = policies.filter((x) => x.seq < seq).at(-1);
    return set ? decidedBy("sourcing", set.seq, set.ts, "upstream")?.decided.replace(" decided", "") ?? null : null;
  };
  const salePrice = has(db, "sales") ? db.prepare("SELECT price_cents FROM sales WHERE sale_id = ?") : null;
  const orderOf = has(db, "sales") ? db.prepare("SELECT CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq FROM sales WHERE sale_id = ?") : null;
  const created = new Map<string, { amount: string }>();
  const out: FlowEvent[] = [];

  // The agent's Claude decision that made this move. A decision row is written when the wake ends (after its tools
  // ran) but carries the wake's start time, so it is found by order in the log: the agent's first later decision,
  // within 15 minutes, by Claude, that used a tool behind this kind of movement.
  const decidedBy = (actor: string, seq: number, ts: string, kind: FlowEvent["kind"]): { model: string | null; decided: string } | null => {
    const tools = TOOLS[kind];
    if (!tools || !AGENT_WORDS[actor]) return null;
    const t = Date.parse(ts);
    const d = decisions.find((x) => x.actor === actor && x.seq > seq && Math.abs(Date.parse(x.ts) - t) <= 15 * 60_000
      && x.p.source === "claude" && !!x.p.model && (x.p.tools ?? []).some((y) => tools.includes(y)));
    if (!d) return null;
    const model = d.p.model as string;
    return { model, decided: `${AGENT_WORDS[actor]} (${MODEL_WORDS[model] ?? model}) decided` };
  };
  // A run of sales, and the purchases that serve them (they alternate: a query sold, its stock check bought), fold
  // into one movement each, with the latest proof; anything else between them ends the run.
  const foldable = (e: FlowEvent) => !e.refused && (e.kind === "sale" || e.kind === "upstream");
  const push = (e: FlowEvent) => {
    if (foldable(e)) {
      for (let i = out.length - 1; i >= 0; i--) {
        const x = out[i]!;
        if (!foldable(x)) break;
        if (x.kind === e.kind && x.to === e.to && x.what === e.what && x.rail === e.rail && x.decided === e.decided) {
          x.amount = fromCents(toCents(x.amount) + toCents(e.amount));
          x.count = (x.count ?? 1) + 1;
          x.proof = e.proof;
          x.at = e.at;
          return;
        }
      }
    }
    out.push(e);
  };

  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as Record<string, unknown>;
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
    switch (r.event) {
      case "sale.delivered": {
        const cents = (salePrice?.get(Number(r.subject)) as { price_cents: number } | undefined)?.price_cents;
        if (cents === undefined) break;
        push({ at: r.ts, kind: "sale", from: "customer", to: "northwind", amount: fromCents(cents), unit: "*USDZ", rail: "metal", agent: null, model: null, decided: "Summit's agent paid (the simulated customer)", what: "stock checks sold", proof: txProof(str("tx")) });
        break;
      }
      case "upstream.paid": {
        const units = str("amount_units");
        if (!units) break;
        const by = policyAt(r.seq);
        push({ at: r.ts, kind: "upstream", from: "sourcing", to: "suppliers", amount: fromCents(baseUnitsToCents(BigInt(units))), unit: "*USDZ", rail: "metal", agent: "sourcing", model: null, decided: by ? `code, following the buy policy ${by} set` : "code, following the buy policy", what: str("supplier") === "ridgeline" ? "Ridgeline Data" : "Stockline", proof: txProof(str("tx")) });
        break;
      }
      case "upstream.refused": {
        const reason = str("reason") ?? "";
        if (!/^mandate_/.test(reason)) break; // an unavailable supplier is not a limit
        // Who refused: refused_by when recorded; an older row has a bare code from Metal's facilitator (a 402, no
        // transaction), while Purser's own refusal always carries its detail after a colon (the tower's rule).
        const metal = str("refused_by") === "metal" || (!str("refused_by") && !reason.includes(":"));
        const m = /(\d+\.\d{2}) is over/.exec(reason);
        push({ at: r.ts, kind: "upstream", from: "sourcing", to: "suppliers", amount: m?.[1] ?? "", unit: "*USDZ", rail: metal ? "metal" : "purser", agent: "sourcing", model: null, decided: "code, following the buy policy", what: str("supplier") === "ridgeline" ? "Ridgeline Data" : "Stockline",
          proof: metal ? { label: "Metal's facilitator refused it (a 402: nothing moves, so no transaction)", href: null, full: null } : { label: "Purser refused it before signing", href: null, full: null },
          refused: { by: metal ? "metal" : "purser", reason } });
        break;
      }
      case "upstream.refused_on_chain":
        push({ at: r.ts, kind: "upstream", from: "sourcing", to: "suppliers", amount: str("amount") ?? "0.00", unit: "*USDZ", rail: "metal", agent: "sourcing", model: null, decided: "the same payment put to Metal", what: "Stockline", proof: txProof(str("tx")), refused: { by: "metal", reason: str("metal_reason") ?? "refused against the mandate" } });
        break;
      case "refund.paid": {
        // The Support agent settled the dispute itself: its dispute agent's row (written after the refunds) names the
        // model and the orders it refunded, by their order number (the sale's seq), not the sale id the refund names.
        const saleId = /^refund-(\d+)$/.exec(str("payment_id") ?? "")?.[1] ?? r.subject;
        const order = (orderOf?.get(Number(saleId)) as { seq: number | null } | undefined)?.seq ?? Number(saleId);
        const t = Date.parse(r.ts);
        const by = settled.find((x) => x.seq > r.seq && Math.abs(Date.parse(x.ts) - t) <= 15 * 60_000 && (x.p.refunded ?? []).includes(`#${order}`) && x.p.model);
        const d = by ? { model: by.p.model!, decided: `the Support agent (${MODEL_WORDS[by.p.model!] ?? by.p.model}) decided` } : decidedBy("support", r.seq, r.ts, "refund");
        push({ at: r.ts, kind: "refund", from: "support", to: "customer", amount: str("amount") ?? "0.00", unit: "*USDZ", rail: "metal", agent: "support", model: d?.model ?? null, decided: d?.decided ?? "refunded after the CFO's approval", what: `refund for order #${order ?? "?"}`, proof: txProof(str("tx")) });
        break;
      }
      case "sweep.paid": {
        const d = decidedBy("treasury", r.seq, r.ts, "sweep");
        push({ at: r.ts, kind: "sweep", from: "treasury", to: "airwallex", amount: str("amount") ?? "0.00", unit: "*USDZ", rail: "metal", agent: "treasury", model: d?.model ?? null, decided: d?.decided ?? "code swept the net earnings", what: "net earnings to the sweep wallet", proof: txProof(str("tx")) });
        break;
      }
      case "credit.deposited":
        push({ at: r.ts, kind: "booked", from: "treasury", to: "airwallex", amount: str("amount") ?? "0.00", unit: (str("currency") as FlowEvent["unit"]) ?? "USD", rail: "airwallex_deposit", agent: "treasury", model: null, decided: "booked at Airwallex after finality (sandbox deposit)", what: "the sweep, credited at Airwallex", proof: awxProof(str("deposit_id")) });
        break;
      case "transfer.created":
        if (r.subject) created.set(r.subject, { amount: str("amount") ?? "" });
        break;
      case "transfer.status": {
        if (str("status") !== "PAID" || !r.subject) break;
        const c = created.get(r.subject);
        const m = /^([A-Z]{3}) (\d+\.\d{2})$/.exec(c?.amount ?? "");
        if (!m) break;
        // Planned before the CFO's Face ID: the Treasury agent's advice on the invoice (its model), the last one before it.
        const plan = advised.filter((x) => x.seq < r.seq).at(-1);
        const d = plan?.model ? { model: plan.model, decided: `the Treasury agent (${MODEL_WORDS[plan.model] ?? plan.model}) decided` } : decidedBy("treasury", r.seq, r.ts, "licence");
        push({ at: r.ts, kind: "licence", from: "treasury", to: "payee", amount: m[2]!, unit: m[1] as FlowEvent["unit"], rail: "airwallex_swift", agent: "treasury", model: d?.model ?? null, decided: `${d ? `planned by ${d.decided.replace(" decided", "")}, ` : ""}paid after the CFO's Face ID`, what: "the euro invoice, by SWIFT", proof: awxProof(r.subject) });
        break;
      }
      case "card.charge_approved":
      case "card.charge_declined": {
        const agent = str("agent") ?? r.actor;
        const d = decidedBy(agent, r.seq, r.ts, "card");
        const declined = r.event === "card.charge_declined";
        push({ at: r.ts, kind: "card", from: (AGENT_WORDS[agent] ? agent : "sourcing") as FlowNode, to: "merchant", amount: str("amount") ?? "0.00", unit: (str("currency") as FlowEvent["unit"]) ?? "EUR", rail: "airwallex_card", agent, model: d?.model ?? null, decided: d?.decided ?? (agent.startsWith("task:") ? "a single-use card the CFO approved" : str("source") === "simulation" ? "a test charge the Airwallex sandbox simulated" : "a charge on the agent's card"), what: `${str("merchant") ?? "a merchant"} on card ····${str("last4") ?? "?"}`, proof: awxProof(r.subject), ...(declined ? { refused: { by: "airwallex" as const, reason: str("reason") ?? "declined" } } : {}) });
        break;
      }
      case "receivable.matched":
      case "receivable.escalated":
        push({ at: r.ts, kind: "deposit", from: "customer", to: "airwallex", amount: str("amount") ?? "0.00", unit: (str("currency") as FlowEvent["unit"]) ?? "EUR", rail: "airwallex_deposit", agent: null, model: null, decided: r.event === "receivable.matched" ? "a retailer paid its invoice; code matched it" : "a retailer paid; code held it for the CFO", what: str("invoice_no") ? `invoice ${str("invoice_no")}` : "a payment with no invoice", proof: awxProof(r.subject) });
        break;
    }
  }
  return out.slice(-limit);
}
