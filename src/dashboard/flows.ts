// D23: the money flow for the control tower's animation, read from the ledger's audit log only. Each movement is one
// recorded event (or a run of sales folded into one) with its own proof: a Metal transaction (a *USDZ stablecoin
// payment on chain) or an Airwallex id. "Decided" names who made the move, from evidence in the ledger only: the
// agent's own Claude run (its model) when the movement happened during that run, through the tool behind it, and the
// agent's decision after the run says Claude made it; the CFO's Face ID; or code following a policy. When the ledger
// holds no such evidence it says so rather than naming anyone.

import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";

const EXPLORER = "https://testnet.metalntwx.com/tx/";
export type FlowNode = "customer" | "retailer" | "northwind" | "sourcing" | "support" | "treasury" | "suppliers" | "airwallex" | "payee" | "merchant";
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
const TOOLS: Partial<Record<FlowEvent["kind"], string[]>> = { refund: ["settle_dispute", "refund"], sweep: ["sweep_earnings"], licence: ["plan_invoice"], card: ["buy_software", "buy_report"], upstream: ["set_buy_policy"] };
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const txProof = (tx: string | undefined | null) => (tx ? { label: `tx ${short(tx)}`, href: `${EXPLORER}${tx}`, full: tx } : { label: "no tx recorded", href: null, full: null });
const awxProof = (id: string | null | undefined) => (id ? { label: `Airwallex ${id.length > 18 ? `${id.slice(0, 8)}…` : id}`, href: null, full: id } : { label: "no Airwallex id recorded", href: null, full: null });
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

export function flowEvents(db: DB, limit = 80): FlowEvent[] {
  if (!has(db, "audit_log")) return [];
  const rows = db.prepare(`SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event IN
    ('sale.delivered', 'upstream.paid', 'upstream.refused', 'upstream.refused_on_chain', 'refund.paid', 'sweep.paid', 'credit.deposited',
     'transfer.created', 'transfer.status', 'card.charge_approved', 'card.charge_declined', 'receivable.matched', 'receivable.escalated', 'agent.decision',
     'dispute.settled_by_agent', 'sourcing.policy_set', 'licence.timing_advised', 'agent.run', 'refund.auto_approved', 'refund.refused', 'sweep.refused')
    ORDER BY seq`).all() as Row[];
  const json = (r: Row) => JSON.parse(r.payload_json) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  // An agent's run is written when it ends and records from_seq, the last row before it began: a movement whose row
  // lies between the two happened during that run.
  const runs = rows.filter((r) => r.event === "agent.run").map((r) => { const p = json(r); return { seq: r.seq, actor: r.actor, from: Number(p.from_seq ?? r.seq), status: String(p.status ?? ""), model: typeof p.model === "string" ? p.model : null, tools: list(p.tools), blocked: list(p.blocked) }; });
  // The agent's decision recorded after a run: who made it, Claude or a fallback by code (and, for a dispute, which
  // refunds that run made itself).
  const verdicts = rows.filter((r) => r.actor !== "system" && (r.event === "agent.decision" || r.event === "dispute.settled_by_agent")).map((r) => { const p = json(r); return { seq: r.seq, actor: r.actor, source: String(p.source ?? ""), refundedNow: Array.isArray(p.refunded_now) ? list(p.refunded_now) : null }; });
  const advised = rows.filter((r) => r.event === "licence.timing_advised").map((r) => { const p = json(r); return { seq: r.seq, proposal: typeof p.proposal_id === "string" ? p.proposal_id : null, source: String(p.source ?? ""), model: typeof p.model === "string" ? p.model : null }; });
  const autoRefunded = rows.filter((r) => r.event === "refund.auto_approved").map((r) => ({ seq: r.seq, sales: list(json(r).sales) }));
  const policies = rows.filter((r) => r.event === "sourcing.policy_set").map((r) => r.seq);

  /** The agent's own Claude run that made this move, or null: the move lies inside a finished run with a model, which
   *  used a tool behind this kind of movement (not every call of it blocked), and whose decision says Claude made it. */
  const claudeMade = (actor: string, seq: number, kind: FlowEvent["kind"], order?: string): { model: string; decided: string } | null => {
    const tools = TOOLS[kind];
    if (!tools || !AGENT_WORDS[actor]) return null;
    for (const r of runs) {
      if (r.actor !== actor || !(r.from < seq && seq < r.seq) || r.status !== "done" || !r.model) continue;
      const used = tools.some((t) => r.tools.filter((x) => x === t).length > r.blocked.filter((b) => b.startsWith(`${t}:`)).length);
      if (!used) continue;
      const v = verdicts.find((x) => x.actor === actor && x.seq > r.seq);
      if (!v || v.source !== "claude") continue;
      if (order && v.refundedNow && !v.refundedNow.includes(order)) continue;
      return { model: r.model, decided: `${AGENT_WORDS[actor]} (${MODEL_WORDS[r.model] ?? r.model}) decided` };
    }
    return null;
  };
  // The buy policy in force at a purchase: the last one set before it, and the Sourcing agent's Claude run that set it.
  const policyAt = (seq: number): string | null => {
    const set = policies.filter((x) => x < seq).at(-1);
    return set ? claudeMade("sourcing", set, "upstream")?.decided.replace(" decided", "") ?? null : null;
  };
  const salePrice = has(db, "sales") ? db.prepare("SELECT price_cents FROM sales WHERE sale_id = ?") : null;
  const refundRow = has(db, "refunds") ? db.prepare("SELECT r.proposal_id, p.status FROM refunds r LEFT JOIN proposals p ON p.proposal_id = r.proposal_id WHERE r.payment_id = ?") : null;
  const proposalBySha = has(db, "proposals") ? db.prepare("SELECT proposal_id FROM proposals WHERE terms_sha256 = ?") : null;
  const orderOf = has(db, "sales") ? db.prepare("SELECT CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq FROM sales WHERE sale_id = ?") : null;
  const created = new Map<string, { amount: string; sha: string | null }>();
  const out: FlowEvent[] = [];

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
        // A sale through clearing (D-clearing) has no transaction of its own: its batch settles later on Metal.
        const cleared = str("scheme") === "bajillion";
        push({ at: r.ts, kind: "sale", from: "customer", to: "northwind", amount: fromCents(cents), unit: "*USDZ", rail: "metal", agent: null, model: null, decided: "Summit's agent paid (the simulated customer)", what: cleared ? "stock checks sold, settled later by clearing" : "stock checks sold", proof: cleared ? { label: "settled later in a clearing batch on Metal", href: null, full: null } : txProof(str("tx")) });
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
        const amount = str("amount");
        if (!amount) break;
        // Refunds name the sale; the agent's own record names the order (the sale's seq).
        const paymentId = str("payment_id") ?? "";
        const saleId = /^refund-(\d+)$/.exec(paymentId)?.[1] ?? r.subject ?? "";
        const order = (orderOf?.get(Number(saleId)) as { seq: number | null } | undefined)?.seq ?? Number(saleId);
        const d = claudeMade("support", r.seq, "refund", `#${order}`);
        const row = refundRow?.get(paymentId) as { proposal_id: string | null; status: string | null } | undefined;
        const decided = d?.decided
          ?? (row?.proposal_id && row.status === "EXECUTED" ? "refunded after the CFO's Face ID"
            : autoRefunded.some((x) => x.seq < r.seq && x.sales.includes(saleId)) ? "code refunded it, within the CFO's automatic limits"
            : "who decided is not recorded");
        push({ at: r.ts, kind: "refund", from: "support", to: "customer", amount, unit: "*USDZ", rail: "metal", agent: "support", model: d?.model ?? null, decided, what: `refund for order #${order}`, proof: txProof(str("tx")) });
        break;
      }
      case "refund.refused":
      case "sweep.refused": {
        // Purser's own refusal before anything is signed (a budget, a limit, the velocity rule): nothing moved.
        const amount = str("amount");
        if (!amount) break;
        const refund = r.event === "refund.refused";
        push({ at: r.ts, kind: refund ? "refund" : "sweep", from: refund ? "support" : "treasury", to: refund ? "customer" : "airwallex", amount, unit: "*USDZ", rail: "purser", agent: refund ? "support" : "treasury", model: null, decided: refund ? "the refund was put to Purser" : "the sweep was put to Purser", what: refund ? `refund of sale ${r.subject ?? "?"}` : "net earnings to the sweep wallet", proof: { label: "Purser refused it before signing", href: null, full: null }, refused: { by: "purser", reason: str("reason") ?? "refused" } });
        break;
      }
      case "sweep.paid": {
        const amount = str("amount");
        if (!amount) break;
        const d = claudeMade("treasury", r.seq, "sweep");
        push({ at: r.ts, kind: "sweep", from: "treasury", to: "airwallex", amount, unit: "*USDZ", rail: "metal", agent: "treasury", model: d?.model ?? null, decided: d?.decided ?? "code swept the net earnings", what: "net earnings to the sweep wallet", proof: txProof(str("tx")) });
        break;
      }
      case "credit.deposited":
        if (!str("amount") || !str("currency")) break;
        push({ at: r.ts, kind: "booked", from: "treasury", to: "airwallex", amount: str("amount")!, unit: str("currency") as FlowEvent["unit"], rail: "airwallex_deposit", agent: "treasury", model: null, decided: "booked at Airwallex after finality (sandbox deposit)", what: "the sweep, credited at Airwallex", proof: awxProof(str("deposit_id")) });
        break;
      case "transfer.created":
        if (r.subject) created.set(r.subject, { amount: str("amount") ?? "", sha: str("approval_sha256") });
        break;
      case "transfer.status": {
        if (str("status") !== "PAID" || !r.subject) break;
        const c = created.get(r.subject);
        const m = /^([A-Z]{3}) (\d+\.\d{2})$/.exec(c?.amount ?? "");
        if (!m) break;
        // Planned before the CFO's Face ID: the Treasury agent's own Claude advice on this transfer's proposal (found
        // by the approval hash the transfer carries), if there was one.
        const pid = c?.sha ? (proposalBySha?.get(c.sha) as { proposal_id: string } | undefined)?.proposal_id ?? null : null;
        const plan = pid ? advised.filter((x) => x.seq < r.seq && x.proposal === pid && x.source === "claude" && x.model).at(-1) : undefined;
        const d = plan?.model ? { model: plan.model, decided: `the Treasury agent (${MODEL_WORDS[plan.model] ?? plan.model}) decided` } : null;
        push({ at: r.ts, kind: "licence", from: "treasury", to: "payee", amount: m[2]!, unit: m[1] as FlowEvent["unit"], rail: "airwallex_swift", agent: "treasury", model: d?.model ?? null, decided: `${d ? `planned by ${d.decided.replace(" decided", "")}, ` : ""}paid after the CFO's Face ID`, what: "the euro invoice, by SWIFT", proof: awxProof(r.subject) });
        break;
      }
      case "card.charge_approved":
      case "card.charge_declined": {
        const agent = str("agent") ?? r.actor;
        if (!str("amount") || !str("currency")) break;
        const d = claudeMade(agent, r.seq, "card");
        const declined = r.event === "card.charge_declined";
        push({ at: r.ts, kind: "card", from: (AGENT_WORDS[agent] ? agent : "sourcing") as FlowNode, to: "merchant", amount: str("amount")!, unit: str("currency") as FlowEvent["unit"], rail: "airwallex_card", agent, model: d?.model ?? null, decided: d?.decided ?? (agent.startsWith("task:") ? "a single-use card the CFO approved" : str("source") === "simulation" ? "a test charge the Airwallex sandbox simulated" : "a charge on the agent's card"), what: `${str("merchant") ?? "a merchant"} on card ····${str("last4") ?? "?"}`, proof: awxProof(r.subject), ...(declined ? { refused: { by: "airwallex" as const, reason: str("reason") ?? "declined" } } : {}) });
        break;
      }
      case "receivable.matched":
      case "receivable.escalated":
        if (!str("amount") || !str("currency")) break;
        push({ at: r.ts, kind: "deposit", from: "retailer", to: "airwallex", amount: str("amount")!, unit: str("currency") as FlowEvent["unit"], rail: "airwallex_deposit", agent: null, model: null, decided: r.event === "receivable.matched" ? "a retailer paid its invoice; code matched it" : "a retailer paid; code held it for the CFO", what: str("invoice_no") ? `invoice ${str("invoice_no")}` : "a payment with no invoice", proof: awxProof(r.subject) });
        break;
    }
  }
  return out.slice(-limit);
}
