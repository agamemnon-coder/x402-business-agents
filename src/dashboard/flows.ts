// D23: the money flow for the control tower's animation, read from the ledger's audit log only. Each movement is one
// recorded event (or a run of sales folded into one) with its own proof: an Alta transaction (a *USDZ stablecoin
// payment on chain) or an Airwallex id. "Decided" is read from the origin recorded with the movement when it started
// (D24: an agent's own Claude run, the CFO's approval, code's named rule, or an outside party), never from timing or a
// decision nearby; without one it says "who decided is not recorded", which the origins check counts as an error.

import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";
import { describeOrigin, NOT_RECORDED } from "../provenance/describe.js";
import { MONEY_EVENTS, parseOrigin, type Origin } from "../provenance/origin.js";

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
  /** The Claude API request id of the answer that asked for the tool behind this move (D24), when Claude decided. */
  request?: string;
  /** For a ledger recorded before origins existed (D24): "decided" read from an explicit record, not from an origin. */
  derived?: true;
  /** Folded runs of sales or purchases. */
  count?: number;
}

type Row = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string };
const MODEL_WORDS: Record<string, string> = { "claude-haiku-5-5": "Claude Haiku", "claude-sonnet-5-5": "Claude Sonnet", "claude-opus-5-5": "Claude Opus" };
const AGENT_WORDS: Record<string, string> = { sourcing: "the Sourcing agent", support: "the Support agent", treasury: "the Treasury agent" };
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const txProof = (tx: string | undefined | null) => (tx ? { label: `tx ${short(tx)}`, href: `${EXPLORER}${tx}`, full: tx } : { label: "no tx recorded", href: null, full: null });
const awxProof = (id: string | null | undefined) => (id ? { label: `Airwallex ${id.length > 18 ? `${id.slice(0, 8)}…` : id}`, href: null, full: id } : { label: "no Airwallex id recorded", href: null, full: null });
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

export function flowEvents(db: DB, limit = 80): FlowEvent[] {
  if (!has(db, "audit_log")) return [];
  const rows = db.prepare(`SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event IN
    ('sale.delivered', 'upstream.paid', 'upstream.refused', 'upstream.refused_on_chain', 'refund.paid', 'sweep.paid', 'credit.deposited',
     'transfer.created', 'transfer.adopted', 'credit.adopted', 'transfer.status', 'card.charge_approved', 'card.charge_declined', 'receivable.matched', 'receivable.escalated',
     'licence.timing_advised', 'refund.auto_approved', 'refund.refused', 'sweep.refused')
    ORDER BY seq`).all() as Row[];
  const json = (r: Row) => JSON.parse(r.payload_json) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  // D24: who decided each movement is read from the origin recorded with it when it started, and from nothing else.
  // A ledger recorded before origins existed (no money event carries the field) shows only what an explicit record
  // says (an executed batch, an automatic-limit row), and each such movement is labelled as derived.
  const recorded = rows.some((r) => MONEY_EVENTS.has(r.event) && "origin" in json(r));
  const advised = rows.filter((r) => r.event === "licence.timing_advised").map((r) => { const p = json(r); return { seq: r.seq, proposal: typeof p.proposal_id === "string" ? p.proposal_id : null, source: String(p.source ?? ""), model: typeof p.model === "string" ? p.model : null }; });
  const autoRefunded = rows.filter((r) => r.event === "refund.auto_approved").map((r) => ({ seq: r.seq, sales: list(json(r).sales) }));
  const describe = describeOrigin;
  /** Who decided: the recorded origin; for a ledger from before D24, the explicit record legacy() reads, marked derived. */
  const who = (p: Record<string, unknown>, legacy: () => { model: string | null; decided: string }): { model: string | null; decided: string; request?: string; derived?: true } =>
    recorded ? describe(parseOrigin(JSON.stringify(p.origin ?? null))) : { ...legacy(), derived: true };
  const withAsker = <T extends { decided: string }>(d: T, asker: string | null): T => (asker ? { ...d, decided: `${d.decided}, asked for by ${asker}` } : d);
  const hasAgents = !!db.prepare("SELECT 1 FROM audit_log WHERE event = 'agent.run' LIMIT 1").get();
  const salePrice = has(db, "sales") ? db.prepare("SELECT price_cents FROM sales WHERE sale_id = ?") : null;
  const refundRow = has(db, "refunds") ? db.prepare("SELECT r.proposal_id, p.status FROM refunds r LEFT JOIN proposals p ON p.proposal_id = r.proposal_id WHERE r.payment_id = ?") : null;
  const proposalBySha = has(db, "proposals") ? db.prepare("SELECT proposal_id FROM proposals WHERE terms_sha256 = ?") : null;
  // Who started a proposal: the origin its proposal.created recorded (review, 2 November). A ledger from before that
  // has no such field (undefined), and the plan is then read from the Treasury agent's advice as before.
  const createdRow = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.created' AND subject = ? ORDER BY seq LIMIT 1");
  const startedBy = (pid: string): Origin | null | undefined => {
    const row = createdRow.get(pid) as { payload_json: string } | undefined;
    let p: Record<string, unknown> | undefined;
    // A payload that does not parse is read as "not recorded" (null), never a broken flow view.
    try { p = row ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined; } catch { return null; }
    return p && typeof p === "object" && "origin" in p ? parseOrigin(JSON.stringify(p.origin)) : undefined;
  };
  const askedByRow = has(db, "proposals") ? db.prepare("SELECT json_extract(terms_json, '$.asked_by') AS a FROM proposals WHERE proposal_id = ?") : null;
  const askedBy = (pid: string): string | null => { const a = (askedByRow?.get(pid) as { a: string | null } | undefined)?.a ?? null; return a?.startsWith("agent:") ? AGENT_WORDS[a.slice(6)] ?? null : null; };
  const orderOf = has(db, "sales") ? db.prepare("SELECT CAST(json_extract(request_params_json, '$.seq') AS INTEGER) AS seq FROM sales WHERE sale_id = ?") : null;
  const created = new Map<string, { amount: string; sha: string | null; p: Record<string, unknown> }>();
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
        // A sale through clearing (D-clearing) has no transaction of its own: its batch settles later on Alta.
        const cleared = str("scheme") === "bajillion";
        push({ at: r.ts, kind: "sale", from: "customer", to: "northwind", amount: fromCents(cents), unit: "*USDZ", rail: "metal", agent: null, ...who(p, () => ({ model: null, decided: "Summit's agent paid (the simulated customer)" })), what: cleared ? "stock checks sold, settled later by clearing" : "stock checks sold", proof: cleared ? { label: "settled later in a clearing batch on Alta", href: null, full: null } : txProof(str("tx")) });
        break;
      }
      case "upstream.paid": {
        const units = str("amount_units");
        if (!units) break;
        push({ at: r.ts, kind: "upstream", from: "sourcing", to: "suppliers", amount: fromCents(baseUnitsToCents(BigInt(units))), unit: "*USDZ", rail: "metal", agent: "sourcing", ...who(p, () => ({ model: null, decided: "code, following the buy policy" })), what: str("supplier") === "ridgeline" ? "Ridgeline Data" : "Stockline", proof: txProof(str("tx")) });
        break;
      }
      case "upstream.refused": {
        const reason = str("reason") ?? "";
        if (!/^mandate_/.test(reason)) break; // an unavailable supplier is not a limit
        // Who refused: refused_by when recorded; an older row has a bare code from Alta's facilitator (a 402, no
        // transaction), while Purser's own refusal always carries its detail after a colon (the tower's rule).
        const metal = str("refused_by") === "metal" || (!str("refused_by") && !reason.includes(":"));
        const m = /(\d+\.\d{2}) is over/.exec(reason);
        push({ at: r.ts, kind: "upstream", from: "sourcing", to: "suppliers", amount: m?.[1] ?? "", unit: "*USDZ", rail: metal ? "metal" : "purser", agent: "sourcing", ...who(p, () => ({ model: null, decided: "code, following the buy policy" })), what: str("supplier") === "ridgeline" ? "Ridgeline Data" : "Stockline",
          proof: metal ? { label: "Alta's facilitator refused it (a 402: nothing moves, so no transaction)", href: null, full: null } : { label: "Purser refused it before signing", href: null, full: null },
          refused: { by: metal ? "metal" : "purser", reason } });
        break;
      }
      case "upstream.refused_on_chain":
        push({ at: r.ts, kind: "upstream", from: "sourcing", to: "suppliers", amount: str("amount") ?? "", unit: "*USDZ", rail: "metal", agent: "sourcing", ...who(p, () => ({ model: null, decided: "the same payment put to Alta" })), what: "Stockline", proof: txProof(str("tx")), refused: { by: "metal", reason: str("metal_reason") ?? "refused against the mandate" } });
        break;
      case "refund.paid": {
        const amount = str("amount");
        if (!amount) break;
        // Refunds name the sale; the agent's own record names the order (the sale's seq).
        const paymentId = str("payment_id") ?? "";
        const saleId = /^refund-(\d+)$/.exec(paymentId)?.[1] ?? r.subject ?? "";
        const order = (orderOf?.get(Number(saleId)) as { seq: number | null } | undefined)?.seq ?? Number(saleId);
        // Before origins existed only an explicit record says who decided: the CFO's executed batch, or code's
        // automatic-limit row naming this sale.
        const legacy = () => {
          const row = refundRow?.get(paymentId) as { proposal_id: string | null; status: string | null } | undefined;
          if (row?.proposal_id && row.status === "EXECUTED") return { model: null, decided: "refunded after the CFO's Face ID" };
          return { model: null, decided: autoRefunded.some((x) => x.seq < r.seq && x.sales.includes(saleId)) ? "code refunded it, within the CFO's automatic limits" : NOT_RECORDED };
        };
        push({ at: r.ts, kind: "refund", from: "support", to: "customer", amount, unit: "*USDZ", rail: "metal", agent: "support", ...who(p, legacy), what: `refund for order #${order}`, proof: txProof(str("tx")) });
        break;
      }
      case "refund.refused":
      case "sweep.refused": {
        // Purser's own refusal before anything is signed (a budget, a limit, the velocity rule): nothing moved.
        const amount = str("amount");
        if (!amount) break;
        const refund = r.event === "refund.refused";
        push({ at: r.ts, kind: refund ? "refund" : "sweep", from: refund ? "support" : "treasury", to: refund ? "customer" : "airwallex", amount, unit: "*USDZ", rail: "purser", agent: refund ? "support" : "treasury", ...who(p, () => ({ model: null, decided: refund ? "the refund was put to Purser" : "the sweep was put to Purser" })), what: refund ? `refund of sale ${r.subject ?? "?"}` : "net earnings to the sweep wallet", proof: { label: "Purser refused it before signing", href: null, full: null }, refused: { by: "purser", reason: str("reason") ?? "refused" } });
        break;
      }
      case "sweep.paid": {
        const amount = str("amount");
        if (!amount) break;
        // Before origins existed: a ledger without agents swept by code only; with agents, it is not recorded who did.
        push({ at: r.ts, kind: "sweep", from: "treasury", to: "airwallex", amount, unit: "*USDZ", rail: "metal", agent: "treasury", ...who(p, () => ({ model: null, decided: hasAgents ? NOT_RECORDED : "code swept the net earnings" })), what: "net earnings to the sweep wallet", proof: txProof(str("tx")) });
        break;
      }
      case "credit.deposited":
      case "credit.adopted":
        if (!str("amount") || !str("currency")) break;
        push({ at: r.ts, kind: "booked", from: "treasury", to: "airwallex", amount: str("amount")!, unit: str("currency") as FlowEvent["unit"], rail: "airwallex_deposit", agent: "treasury", ...who(p, () => ({ model: null, decided: "booked at Airwallex after finality (sandbox deposit)" })), what: "the sweep, credited at Airwallex", proof: awxProof(str("deposit_id")) });
        break;
      case "transfer.created":
      case "transfer.adopted":
        if (r.subject) created.set(r.subject, { amount: str("amount") ?? "", sha: str("approval_sha256"), p });
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
        // Who decided the payment is the transfer's own origin (the CFO's approval). Who planned it is the origin the
        // proposal recorded when it was created: the CFO's command, or an agent's own Claude run. Only a ledger from
        // before proposals recorded it falls back to the Treasury agent's advice on the same proposal, linked by its id.
        const paid = who(c!.p, () => ({ model: null, decided: "paid after the CFO's Face ID" }));
        const start = pid ? startedBy(pid) : undefined;
        const advice = plan?.model ? `; the Treasury agent (${MODEL_WORDS[plan.model] ?? plan.model}) advised on its timing` : "";
        const planned: { model: string | null; before: string; after: string } =
          start === undefined ? { model: plan?.model ?? null, before: plan?.model ? `planned by the Treasury agent (${MODEL_WORDS[plan.model] ?? plan.model}), ` : "", after: "" }
          : start === null ? { model: null, before: "who planned it is not recorded, ", after: advice }
          : start.actor === "cfo-command" ? { model: null, before: `payment started by the CFO (${start.command}), `, after: advice }
          : start.actor === "agent" ? { model: start.model, before: `planned by ${AGENT_WORDS[start.agent] ?? start.agent} (${MODEL_WORDS[start.model] ?? start.model}), `, after: "" }
          : start.actor === "code" ? { model: null, before: `planned by code (${start.rule}), `, after: advice }
          : { model: null, before: `planned as recorded: ${describe(start).decided}, `, after: advice };
        push({ at: r.ts, kind: "licence", from: "treasury", to: "payee", amount: m[2]!, unit: m[1] as FlowEvent["unit"], rail: "airwallex_swift", agent: "treasury", ...paid, model: planned.model, decided: `${planned.before}${paid.decided}${planned.after}`, what: "the euro invoice, by SWIFT", proof: awxProof(r.subject) });
        break;
      }
      case "card.charge_approved":
      case "card.charge_declined": {
        const agent = str("agent") ?? r.actor;
        if (!str("amount") || !str("currency")) break;
        const asker = agent.startsWith("task:") ? askedBy(agent.slice(5)) : null;
        const declined = r.event === "card.charge_declined";
        push({ at: r.ts, kind: "card", from: (AGENT_WORDS[agent] ? agent : "sourcing") as FlowNode, to: "merchant", amount: str("amount")!, unit: str("currency") as FlowEvent["unit"], rail: "airwallex_card", agent, ...withAsker(who(p, () => ({ model: null, decided: agent.startsWith("task:") ? "a single-use card the CFO approved" : str("source") === "simulation" ? "a test charge the Airwallex sandbox simulated" : "a charge on the agent's card" })), asker), what: `${str("merchant") ?? "a merchant"} on card ····${str("last4") ?? "?"}`, proof: awxProof(r.subject), ...(declined ? { refused: { by: "airwallex" as const, reason: str("reason") ?? "declined" } } : {}) });
        break;
      }
      case "receivable.matched":
      case "receivable.escalated":
        if (!str("amount") || !str("currency")) break;
        push({ at: r.ts, kind: "deposit", from: "retailer", to: "airwallex", amount: str("amount")!, unit: str("currency") as FlowEvent["unit"], rail: "airwallex_deposit", agent: null, ...(() => { const d = who(p, () => ({ model: null, decided: "a retailer paid" })); return { ...d, decided: `${d.decided}; code ${r.event === "receivable.matched" ? "matched it to its invoice" : "held it for the CFO"}` }; })(), what: str("invoice_no") ? `invoice ${str("invoice_no")}` : "a payment with no invoice", proof: awxProof(r.subject) });
        break;
    }
  }
  return out.slice(-limit);
}
