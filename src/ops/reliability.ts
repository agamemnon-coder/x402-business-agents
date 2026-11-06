// Reliability runs (Phase 1A, 6 November): the full Kit 11 flow again, each time in a fresh world rel-N, to show Purser
// works every time and not once. This module measures one finished world from its ledger (read-only) and keeps the
// public list of runs, docs/demo/reliability.json. The main run (main-1) is never read or written here: a reliability
// world is named rel-<n>[letter], and nothing else is accepted.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { verifyAuditChain } from "../audit/log.js";
import { agentStats } from "../dashboard/agentStats.js";
import type { DB } from "../db/open.js";

export const RELIABILITY_KIND = "reliability run";

/** rel-1, rel-2, rel-1b (a re-run after a fix keeps its own name, so a failed attempt is never overwritten). */
export function reliabilityWorldOk(name: string): boolean {
  return /^rel-\d+[a-z]?$/.test(name);
}

/** Who signed, in words for the record: a labelled virtual test passkey is never called a person's Face ID. */
export function signerLabel(approver: string): string {
  const person = approver.replace(/\s*\(passkey [^)]*\)\s*$/, "").trim();
  if (person === "test-cfo") return "virtual test passkey (CFO role)";
  if (person === "test-controller") return "virtual test passkey (second approver role)";
  if (person === "max") return "Max's own passkey, Face ID on his phone (CFO, live)";
  return `${person} (passkey)`;
}

export interface Signature { proposal: string; kind: string | null; decision: "approved" | "rejected" | "1 of 2"; signed_by: string[]; at: string }
export interface Measured {
  sales: { queries: number; sold: number; refused: number; upstream_paid: number; upstream_refused: number; upstream_cached: number };
  decisions: { total: number; by_claude: number; fallback: number; fallback_pct: number; per_agent: Record<string, { decisions: number; fallback: number; cost_usd: number; models: string[] }> };
  claude: { calls: number; calls_without_request_id: number; cost_usd: number };
  metal: { transactions: number; by_event: Record<string, number> };
  airwallex: {
    cards: { agent: string; card_id: string; last4: string }[];
    conversions: { conversion_id: string; buy: string; sell: string; status: string }[];
    transfers: { transfer_id: string; amount: string; currency: string; status: string; fee: string | null }[];
    deposits: { deposit_id: string; amount: string; reference: string | null }[];
    card_transactions: { transaction_id: string; agent: string; merchant: string; amount: string; approved: boolean; failure_reason: string | null }[];
  };
  refusals: Record<string, number>;
  signatures: Signature[];
  flow: Record<string, unknown>;
  audit: { rows: number; chain_intact: boolean; head: string | null; problem: string | null };
}

type Row = { seq: number; ts: string; event: string; actor: string; subject: string | null; payload_json: string };
const j = (s: string): Record<string, unknown> => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; } };
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const TX = /^0x[0-9a-fA-F]{64}$/;

/** Everything the record says about a world, from its ledger alone (nothing is written). */
export function measureRun(db: DB): Measured {
  const rows = db.prepare("SELECT seq, ts, event, actor, subject, payload_json FROM audit_log ORDER BY seq").all() as Row[];
  const of = (event: string) => rows.filter((r) => r.event === event);
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  // Sales: one query per customer request; each sold one with its own upstream purchase (cache off).
  const answered = of("query.answered");
  const sales = {
    queries: answered.length,
    sold: of("sale.delivered").length,
    refused: of("sale.refused").length,
    upstream_paid: of("upstream.paid").length,
    upstream_refused: of("upstream.refused").length,
    upstream_cached: of("upstream.cached").length,
  };

  // Claude: decisions and fallbacks per agent, calls, cost (the same numbers as npm run agent-summary).
  const stats = agentStats(db);
  const per: Measured["decisions"]["per_agent"] = {};
  for (const s of stats) per[s.agent] = { decisions: s.decisions, fallback: s.fallback, cost_usd: s.cost_usd_micros / 1e6, models: s.models };
  const total = stats.reduce((a, s) => a + s.decisions, 0);
  const fallback = stats.reduce((a, s) => a + s.fallback, 0);
  const decisions = { total, by_claude: stats.reduce((a, s) => a + s.by_claude, 0), fallback, fallback_pct: total ? Math.round((fallback / total) * 1000) / 10 : 0, per_agent: per };
  const claude = {
    calls: stats.reduce((a, s) => a + s.claude_calls, 0),
    calls_without_request_id: stats.reduce((a, s) => a + s.calls_without_request_id, 0),
    cost_usd: Math.round(stats.reduce((a, s) => a + s.cost_usd_micros, 0)) / 1e6,
  };

  // Metal: every distinct transaction hash the ledger names under a `tx` key, plus the accounts' creation.
  const txs = new Map<string, string>();
  for (const r of rows) {
    const tx = j(r.payload_json).tx;
    if (typeof tx === "string" && TX.test(tx) && !txs.has(tx.toLowerCase())) txs.set(tx.toLowerCase(), r.event);
  }
  for (const r of db.prepare("SELECT created_tx FROM metal_accounts WHERE created_tx IS NOT NULL").all() as { created_tx: string }[]) {
    if (TX.test(r.created_tx) && !txs.has(r.created_tx.toLowerCase())) txs.set(r.created_tx.toLowerCase(), "account.created");
  }
  const byEvent: Record<string, number> = {};
  for (const ev of txs.values()) byEvent[ev] = (byEvent[ev] ?? 0) + 1;

  // Airwallex: the ids this world created (sandbox ids, safe to publish as the main run does).
  const airwallex: Measured["airwallex"] = {
    cards: db.prepare("SELECT agent, card_id, last4 FROM cards ORDER BY agent").all() as Measured["airwallex"]["cards"],
    conversions: (db.prepare("SELECT conversion_id, buy_amount, sell_amount, status FROM fx_conversions ORDER BY rowid").all() as { conversion_id: string; buy_amount: string; sell_amount: string; status: string }[])
      .map((c) => ({ conversion_id: c.conversion_id, buy: c.buy_amount, sell: c.sell_amount, status: c.status })),
    transfers: (db.prepare("SELECT transfer_id, amount, currency, status, fee_actual FROM transfers ORDER BY rowid").all() as { transfer_id: string; amount: string; currency: string; status: string; fee_actual: string | null }[])
      .map((t) => ({ transfer_id: t.transfer_id, amount: t.amount, currency: t.currency, status: t.status, fee: t.fee_actual })),
    deposits: of("credit.deposited").map((r) => { const p = j(r.payload_json); return { deposit_id: str(p.deposit_id) ?? "", amount: str(p.amount) ?? "", reference: str(p.reference) }; }),
    card_transactions: (db.prepare("SELECT transaction_id, agent, merchant, amount_cents, currency, approved, failure_reason FROM card_transactions ORDER BY rowid").all() as { transaction_id: string; agent: string; merchant: string; amount_cents: number; currency: string; approved: number; failure_reason: string | null }[])
      .map((t) => ({ transaction_id: t.transaction_id, agent: t.agent, merchant: t.merchant, amount: `${t.currency} ${(t.amount_cents / 100).toFixed(2)}`, approved: t.approved === 1, failure_reason: t.failure_reason })),
  };

  // Refusals, per layer. Purser refuses before signing; Metal refuses on the rail (and records it on chain); the Sourcing
  // agent's own buy policy refuses a purchase it chose not to make; Airwallex declines a card charge; code refuses a
  // tool call an agent made; the CFO rejects a proposal; the customer is answered with an error and not charged.
  const refusedBy = (by: string) => of("upstream.refused").filter((r) => j(r.payload_json).refused_by === by).length;
  const refusals: Record<string, number> = {
    purser_before_signing: refusedBy("purser"),
    metal_on_the_rail: refusedBy("metal"),
    metal_refusals_recorded_on_chain: of("upstream.refused_on_chain").length,
    sourcing_buy_policy: refusedBy("buy_policy"),
    supplier: of("upstream.refused").length - refusedBy("purser") - refusedBy("metal") - refusedBy("buy_policy"),
    airwallex_card_declines: of("card.charge_declined").length,
    code_refused_agent_tool_calls: of("agent.tool").filter((r) => j(r.payload_json).blocked_by !== undefined).length,
    cfo_rejections: of("proposal.rejected").length,
    customer_answered_error_not_settled: of("sale.refused").filter((r) => j(r.payload_json).settled === false).length,
  };

  // Signatures: every passkey decision, with who signed in words.
  const kinds = new Map((db.prepare("SELECT proposal_id, kind FROM proposals").all() as { proposal_id: string; kind: string }[]).map((p) => [p.proposal_id, p.kind]));
  const signatures: Signature[] = [];
  for (const r of rows.filter((x) => x.event === "proposal.cosigned" || x.event === "proposal.approved" || x.event === "proposal.rejected")) {
    const approver = str(j(r.payload_json).approver) ?? "";
    signatures.push({
      proposal: r.subject ?? "",
      kind: kinds.get(r.subject ?? "") ?? null,
      decision: r.event === "proposal.cosigned" ? "1 of 2" : r.event === "proposal.approved" ? "approved" : "rejected",
      signed_by: approver.split(" + ").filter(Boolean).map(signerLabel),
      at: r.ts,
    });
  }

  // The Kit 11 flow, step by step, as the ledger shows it.
  const one = (event: string) => of(event)[0];
  const lt = one("upstream.let_through_refused");
  const onChain = one("upstream.refused_on_chain");
  const dispute = one("dispute.settled_by_agent");
  const sweep = db.prepare("SELECT payment_id, amount_cents, tx_hash, outcome FROM sweeps ORDER BY created_at").all() as { payment_id: string; amount_cents: number; tx_hash: string | null; outcome: string }[];
  const proposals = db.prepare("SELECT proposal_id, kind, status, created_by FROM proposals ORDER BY rowid").all() as { proposal_id: string; kind: string; status: string; created_by: string }[];
  const replaced = of("mandate.replaced").map((r) => str(j(r.payload_json).tx)).filter(Boolean);
  const software = of("sourcing.software_bought").map((r) => j(r.payload_json));
  const tap = one("tap.checkout_verified");
  const flow: Record<string, unknown> = {
    let_through_refused_by_metal: lt ? { reason: j(lt.payload_json).metal_reason ?? null, status: j(lt.payload_json).metal_status ?? null, label: j(lt.payload_json).label ?? null } : null,
    refusal_on_chain_tx: onChain ? str(j(onChain.payload_json).tx) : null,
    options_from_treasury: proposals.filter((p) => p.kind === "mandate_replace" && p.created_by === "treasury").map((p) => `${p.proposal_id} ${p.status}`),
    replace_txs: replaced,
    dispute: dispute ? { refunded: (j(dispute.payload_json).refunded as unknown[]) ?? [], escalated: j(dispute.payload_json).escalated ?? null } : null,
    refunds_paid: of("refund.paid").map((r) => ({ payment_id: str(j(r.payload_json).payment_id), tx: str(j(r.payload_json).tx) })),
    sweeps: sweep.map((s) => ({ payment_id: s.payment_id, amount: (s.amount_cents / 100).toFixed(2), tx: s.tx_hash, outcome: s.outcome })),
    finality_locked: of("credit.locked").length,
    licence: proposals.filter((p) => p.kind === "invoice_payment").map((p) => `${p.proposal_id} ${p.status} (by ${p.created_by})`),
    software_bought: software.map((p) => ({ plan: p.plan ?? null, rail: p.rail ?? null, approved: p.approved ?? null, ref: p.ref ?? null })),
    tap_checkout_verified: tap ? { key_id: j(tap.payload_json).key_id ?? null } : null,
    injection_flagged: of("document.injection_flagged").length,
    proposals: proposals.map((p) => `${p.proposal_id} ${p.kind} ${p.status} (by ${p.created_by})`),
  };

  const chain = verifyAuditChain(db);
  return {
    sales, decisions, claude,
    metal: { transactions: txs.size, by_event: byEvent },
    airwallex, refusals, signatures, flow,
    audit: { rows: n("SELECT COUNT(*) AS n FROM audit_log"), chain_intact: chain.ok, head: chain.ok ? chain.head : null, problem: chain.ok ? null : `seq ${chain.seq}: ${chain.reason}` },
  };
}

export interface RunRecord { run: string; kind: string; [k: string]: unknown }

/** Adds one run to the public list. A run name is never overwritten: a re-run after a fix gets its own (rel-1b). */
export function appendRunRecord(file: string, record: RunRecord): RunRecord[] {
  if (!reliabilityWorldOk(record.run)) throw new Error(`refused: ${record.run} is not a reliability world (rel-<n>[letter])`);
  if (record.kind !== RELIABILITY_KIND && !record.kind.startsWith(`${RELIABILITY_KIND},`)) throw new Error(`refused: the kind must say "${RELIABILITY_KIND}"`);
  const list = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RunRecord[]) : [];
  if (!Array.isArray(list)) throw new Error(`${file} is not a list of runs`);
  if (list.some((r) => r.run === record.run)) throw new Error(`refused: ${record.run} is already in ${file}; a new attempt gets a new name (e.g. ${record.run}b)`);
  const next = [...list, record];
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export interface AcceptanceRow { item: string; ok: boolean; evidence: string }

/** The main run's acceptance list (docs/runs/dry-run-acceptatie.md §1, the Kit 11 flow, §2), row by row, from the record. */
export function acceptance(m: Measured, x: { checks: Record<string, number | null>; secondApproverLabel: boolean }): AcceptanceRow[] {
  const rows: AcceptanceRow[] = [];
  const add = (item: string, ok: boolean, evidence: string) => rows.push({ item, ok, evidence });
  const s = m.sales;
  add("4 Upstream bought per query (cache off)", s.queries > 0 && s.queries === s.upstream_paid + s.upstream_refused && s.upstream_cached === 0 && s.sold === s.upstream_paid,
    `${s.queries} queries, ${s.upstream_paid} upstream paid, ${s.upstream_refused} refused, ${s.upstream_cached} cached, ${s.sold} sold`);
  const lt = m.flow.let_through_refused_by_metal as { reason?: unknown; label?: unknown } | null;
  add("5 The refusal at 0.04: let through once, refused by Metal itself, recorded on chain", !!lt && String(lt.reason ?? "").startsWith("mandate_cap_exceeded") && !!m.flow.refusal_on_chain_tx && typeof lt.label === "string",
    lt ? `Metal: ${String(lt.reason)}; on chain ${String(m.flow.refusal_on_chain_tx)}` : "no let-through refused by Metal");
  add("6 Error status for the customer, not settled", s.refused > 0 && m.refusals.customer_answered_error_not_settled === s.refused,
    `${m.refusals.customer_answered_error_not_settled} of ${s.refused} refused queries answered with an error, settled false`);
  const twoOfTwo = m.signatures.find((g) => g.kind === "mandate_replace" && g.decision === "approved" && g.signed_by.length === 2);
  const oneOfTwo = twoOfTwo && m.signatures.find((g) => g.proposal === twoOfTwo.proposal && g.decision === "1 of 2");
  add("9 Four eyes, labelled honestly", !!twoOfTwo && !!oneOfTwo && x.secondApproverLabel,
    twoOfTwo ? `${twoOfTwo.proposal}: 1 of 2 by ${oneOfTwo?.signed_by.join(", ") ?? "?"}, then 2 of 2 by ${twoOfTwo.signed_by.join(" + ")}; second-approver label on the page: ${x.secondApproverLabel}` : "no mandate replace signed 2 of 2");
  const options = (m.flow.options_from_treasury as string[]) ?? [];
  add("Flow: Treasury's options within 20.00, the replace on chain", options.length >= 2 && options.some((o) => o.endsWith("EXECUTED")) && ((m.flow.replace_txs as unknown[]) ?? []).length >= 1,
    `options ${options.join(", ") || "none"}; replace txs ${((m.flow.replace_txs as unknown[]) ?? []).length}`);
  const d = m.flow.dispute as { refunded?: unknown[] } | null;
  const refunded = (d?.refunded ?? []).map(String).sort();
  const refundAll = ((m.flow.proposals as string[]) ?? []).filter((p) => p.includes("refund_batch"));
  add("Flow: dispute, only the wrong data refunded (#7, #10, #13); refund the rest rejected by the CFO", JSON.stringify(refunded) === JSON.stringify(["#10", "#13", "#7"]) && refundAll.length > 0 && refundAll.every((p) => p.includes("REJECTED")),
    `refunded ${refunded.join(", ") || "none"}; ${refundAll.join("; ") || "no refund-all proposal"}`);
  const sweeps = (m.flow.sweeps as { tx: string | null; outcome: string }[]) ?? [];
  const paidSweep = sweeps.find((w) => w.outcome === "PAID");
  add("Flow: sweep after finality, the tx as the deposit reference", !!paidSweep && (m.flow.finality_locked as number) > 0 && m.airwallex.deposits.some((dep) => dep.reference === paidSweep.tx),
    paidSweep ? `sweep ${paidSweep.tx}; deposit ${m.airwallex.deposits.map((dep) => dep.deposit_id).join(", ") || "none"}` : "no sweep paid");
  const licence = ((m.flow.licence as string[]) ?? []);
  const paid = m.airwallex.transfers.find((t) => t.status === "PAID" && t.currency === "EUR");
  add("17 EUR licence, planned by Treasury itself, PAID", licence.some((l) => l.includes("EXECUTED (by treasury)")) && !!paid, `${licence.join("; ") || "no licence proposal"}; transfer ${paid ? `${paid.transfer_id} PAID, fee ${paid.fee ?? "?"}` : "not PAID"}`);
  add("18/25 FX for the shortfall", m.airwallex.conversions.length > 0, m.airwallex.conversions.map((c) => `${c.conversion_id}: EUR ${c.buy} for USD ${c.sell}`).join("; ") || "no conversion");
  const card = m.airwallex.card_transactions.find((t) => t.approved);
  add("20 TAP card purchase in this world", !!m.flow.tap_checkout_verified && !!card, card ? `${card.transaction_id} ${card.amount} approved by Airwallex` : "no approved card purchase");
  const bad = Object.entries(x.checks).filter(([, c]) => c !== 0).map(([k]) => k);
  add("§2 verify, reconcile, data-qa, origins, dashboard-vs-chain, stop all exit 0", bad.length === 0 && Object.keys(x.checks).length > 0, bad.length ? `non-zero: ${bad.join(", ")}` : Object.keys(x.checks).join(", "));
  add("§2 Fallbacks under 10%, every Claude call with a request id", m.decisions.fallback_pct < 10 && m.claude.calls_without_request_id === 0,
    `${m.decisions.total} decisions, ${m.decisions.fallback} fallbacks (${m.decisions.fallback_pct}%), ${m.claude.calls} calls, ${m.claude.calls_without_request_id} without a request id`);
  add("§2 Audit chain intact", m.audit.chain_intact, `${m.audit.rows} rows${m.audit.problem ? `; ${m.audit.problem}` : ""}`);
  return rows;
}
