// awx-1: the scenario itself (plan and budget: src/awx/plan.ts). One driver for both ways it runs:
//   - live (npm run awx-1 -- live): the Airwallex sandbox's own adapters; the runner (npm run relay) records the webhooks,
//     starts the agent whose card was declined and executes what the CFO approved with Face ID; the driver waits for
//     each in the ledger;
//   - stand-in (tests, npm run awx-1 -- stand-in): the in-memory Airwallex and Issuing stand-ins, the same steps and the
//     same ledger code, 0 network. Its records say "stand-in" on every line; they are never the run's evidence.
// The driver decides nothing an agent or the CFO decides. A merchant's charge is Airwallex's simulation (sandbox only);
// the approve or decline, and its code, are Airwallex's. It never sets a failure reason on a simulated charge.

import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import type { AirwallexRail, SandboxSim } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import { seedTreasury, snapshot, treasuryState, type InvoicePaymentTerms } from "../agents/euroBill.js";
import { CARD_ACTIVE_DAYS, LICENCE_INVOICE_FIXTURE, PLANS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { cardControls, cardOf, cardRows, pollCardTransactions, setupCards } from "../policy/cards.js";
import { cardLimits } from "../policy/rules.js";
import { planInvoice } from "../cli/s3-airwallex.js";
import { verifyAirwallex, type Get } from "../airwallex/verify.js";
import { verifyAuditChain } from "../audit/log.js";
import { approvalMethodChecks, reverifyPasskeyApprovals } from "../passkey/webauthn.js";
import { policyVersionChecks } from "../policy/versions.js";

export const RUN = "awx-1";
export const STEPS = ["a", "b", "c", "d", "f1", "f2", "close"] as const;
export type Step = (typeof STEPS)[number];
export const BERGTEX_FIXTURE = "bergtex-invoice-BTX-2026-11.txt";

export interface Awx1Deps {
  db: DB;
  issuing: IssuingRail & IssuingSim;
  awx: AirwallexRail & SandboxSim;
  /** Returns once the webhooks for these Airwallex objects are in the ledger (live: the runner records them). */
  awaitWebhooks(ids: { cardTransactions?: string[]; transfers?: string[] }): Promise<void>;
  /** The CFO decides with Face ID (live) or a labelled virtual test passkey (stand-in); returns once it executed. */
  approve(proposalId: string): Promise<void>;
  /** Waits for something the runner or an agent does (the agent's raise after a decline); stand-in: checks once. */
  waitFor<T>(what: string, check: () => T | undefined, timeoutMs: number): Promise<T>;
  /** Claude for the invoice reads, the review and the Treasury agent's timing advice: undefined is the environment's
   *  (live); null is none (code's own parser). The stand-ins always pass null or a scripted client, never undefined. */
  claude?: Anthropic | null;
  /** Whether the Treasury agent advises on timing (live: KIT11_AGENTS=on). */
  agents?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
}

/** A merchant charges an agent's card (sandbox only: Airwallex's simulation endpoint). Nothing is recorded as the
 *  card's transaction here: the webhook brings it, and the runner records it and tells the agent. */
async function merchantCharge(d: Awx1Deps, step: Step, agent: string, plan: keyof typeof PLANS): Promise<CardTransaction> {
  const p = PLANS[plan]!;
  const card = cardOf(d.db, agent);
  if (!card) throw new Error(`the ${agent} agent has no card in this world (step a)`);
  const t = await d.issuing.simulateCardCharge({ cardId: card.card_id, amountCents: p.amountCents, currency: "EUR", merchant: p.merchant, mcc: p.mcc });
  audit(d.db, "system", "awx1.merchant_charged", t.transactionId, {
    run: RUN, step, agent, last4: card.last4, merchant: p.merchant, mcc: p.mcc, amount: fromCents(p.amountCents), currency: "EUR",
    per_tx_limit: fromCents(card.per_tx_cents), allowed_mccs: card.allowed_mccs, approved: t.approved, decline_code: t.failureReason, simulated: "the merchant's charge (Airwallex sandbox simulation); the decision is Airwallex's",
  }, (d.now ?? (() => new Date()))());
  d.log?.(`${step}  ${p.merchant} ${fromCents(p.amountCents)} EUR (MCC ${p.mcc}) on ${agent} ····${card.last4}: Airwallex ${t.approved ? "approved" : `declined ${t.failureReason ?? t.status}`} (${t.transactionId})`);
  return t;
}

const newestProposal = (db: DB, kind: string, createdBy: string, after: string) =>
  db.prepare("SELECT proposal_id FROM proposals WHERE kind = ? AND created_by = ? AND created_at >= ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(kind, createdBy, after) as { proposal_id: string } | undefined;
const invoiceProposal = (db: DB, invoiceNo: string) =>
  db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'invoice_payment' AND json_extract(terms_json, '$.invoice_no') = ? AND status = 'PENDING_APPROVAL' ORDER BY created_at DESC LIMIT 1").get(invoiceNo) as { proposal_id: string } | undefined;
const invoiceNoOf = (fixture: string) => /INVOICE\s+(\S+)/.exec(readFileSync(resolve(import.meta.dirname, "../../fixtures", fixture), "utf8"))?.[1] ?? fixture;

async function stepA(d: Awx1Deps): Promise<void> {
  const now = (d.now ?? (() => new Date()))();
  // The world's own nickname suffix: a world without a Metal account must never adopt an earlier world's card.
  await setupCards(d.db, d.issuing, now, { nicknameSuffix: RUN });
  for (const row of cardRows(d.db)) {
    const c = await d.issuing.getCard(row.card_id);
    const want = { limits: cardLimits(d.db, row.agent), controls: cardControls(row.agent, now) };
    audit(d.db, "system", "awx1.card_read_back", row.agent, {
      run: RUN, agent: row.agent, last4: c.last4, status: c.status,
      per_tx: c.limits ? fromCents(c.limits.perTxCents) : null, monthly: c.limits ? fromCents(c.limits.monthlyCents) : null, currency: c.limits?.currency ?? null,
      mccs: c.controls?.mccs ?? [], currencies: c.controls?.currencies ?? [], active_to: c.controls?.activeTo ?? null,
      policy: { per_tx: fromCents(want.limits.perTxCents), monthly: fromCents(want.limits.monthlyCents), mccs: want.controls.mccs, currencies: want.controls.currencies, active_days: CARD_ACTIVE_DAYS },
    }, now);
    d.log?.(`a  ${row.agent} ····${c.last4}: ${c.limits ? `${fromCents(c.limits.perTxCents)} / ${fromCents(c.limits.monthlyCents)} EUR` : "no limits"}, MCC ${c.controls?.mccs.join(",") || "any"}, ${c.controls?.currencies.join(",") || "any currency"}, until ${c.controls?.activeTo?.slice(0, 10) ?? "no end"}`);
  }
}

async function stepC(d: Awx1Deps): Promise<void> {
  const at = (d.now ?? (() => new Date()))().toISOString();
  const over = await merchantCharge(d, "c", "sourcing", "packwise-pro");
  await d.awaitWebhooks({ cardTransactions: [over.transactionId] });
  // The agent whose card it is reads Airwallex's decline (from the webhook) and asks the CFO; nothing retries it.
  const raise = await d.waitFor("the Sourcing agent's request for a higher limit", () => newestProposal(d.db, "policy_change", "sourcing", at), 3 * 60_000);
  d.log?.(`c  the Sourcing agent asked the CFO: ${raise.proposal_id}`);
  await d.approve(raise.proposal_id);
  const again = await merchantCharge(d, "c", "sourcing", "packwise-pro");
  await d.awaitWebhooks({ cardTransactions: [again.transactionId] });
}

async function stepF(d: Awx1Deps, step: "f1" | "f2", fixture: string): Promise<void> {
  // f1 seeds (once per world: the seed deposit is looked up, the floors calibrated, the payees found); f2 reads the
  // balance as it is now, after f1's payout. Either way the EUR Airwallex holds decides: from EUR, or FX for the shortfall.
  const s = step === "f1" ? await seedTreasury(d.db, d.awx, d.awx) : treasuryState(d.db, await snapshot(d.db, d.awx, `awx1:${step}`));
  await planInvoice(d.db, d.awx, s, fixture, { ...(d.claude === undefined ? {} : { claude: d.claude }), ...(d.agents === undefined ? {} : { agents: d.agents }) });
  const no = invoiceNoOf(fixture);
  const p = invoiceProposal(d.db, no);
  if (!p) throw new Error(`invoice ${no} was not planned (see the ledger's invoice.escalated)`);
  await d.approve(p.proposal_id);
  const t = d.db.prepare("SELECT transfer_id FROM transfers WHERE invoice_no = ? AND status = 'PAID'").get(no) as { transfer_id: string } | undefined;
  if (!t) throw new Error(`invoice ${no}: no PAID transfer after ${p.proposal_id} executed`);
  await d.awaitWebhooks({ transfers: [t.transfer_id] });
}

const RUNS: Record<Step, (d: Awx1Deps) => Promise<void>> = {
  a: stepA,
  b: async (d) => { const t = await merchantCharge(d, "b", "sourcing", "packwise-starter"); await d.awaitWebhooks({ cardTransactions: [t.transactionId] }); },
  c: stepC,
  d: async (d) => { const t = await merchantCharge(d, "d", "support", "packwise-on-support-card"); await d.awaitWebhooks({ cardTransactions: [t.transactionId] }); },
  f1: (d) => stepF(d, "f1", LICENCE_INVOICE_FIXTURE),
  f2: (d) => stepF(d, "f2", BERGTEX_FIXTURE),
  close: async (d) => {
    // One poll of every card: a transaction the webhooks missed is recorded now, and the record says it came by poll.
    const missed = await pollCardTransactions(d.db, d.issuing, (d.now ?? (() => new Date()))());
    audit(d.db, "system", "awx1.closing_poll", RUN, { run: RUN, missed_by_webhooks: missed });
    for (const row of cardRows(d.db)) {
      const c = await d.issuing.getCard(row.card_id);
      audit(d.db, "system", "awx1.card_read_back_end", row.agent, { run: RUN, agent: row.agent, last4: c.last4, per_tx: c.limits ? fromCents(c.limits.perTxCents) : null, monthly: c.limits ? fromCents(c.limits.monthlyCents) : null, status: c.status });
    }
  },
};

/**
 * Runs the steps in order from `from`. A step that fails is recorded with its cause (awx1.step_failed) and the run
 * stops there: nothing is retried by itself (a retry is Max's call, within the approved calls). Run it again from the
 * failed step; the record keeps both attempts.
 */
export async function runAwx1(d: Awx1Deps, o: { from?: Step; to?: Step } = {}): Promise<void> {
  const first = STEPS.indexOf(o.from ?? "a"), last = STEPS.indexOf(o.to ?? "close");
  for (const step of STEPS.slice(first, last + 1)) {
    const now = () => (d.now ?? (() => new Date()))();
    audit(d.db, "system", "awx1.step_started", step, { run: RUN, step }, now());
    try {
      await RUNS[step](d);
    } catch (e) {
      audit(d.db, "system", "awx1.step_failed", step, { run: RUN, step, cause: String((e as Error).message ?? e).slice(0, 400) }, now());
      throw e;
    }
    audit(d.db, "system", "awx1.step_done", step, { run: RUN, step }, now());
  }
}

// ---- The record -------------------------------------------------------------------------------------------------

export interface VerifyLine { level: "ok" | "FAIL" | "note"; what: string; detail: string }
export interface Awx1Record {
  run: string;
  mode: "live" | "stand-in";
  test_money: true;
  note: string;
  cards: { agent: string; last4: string; card_id_last4: string; read_back: Record<string, unknown>; read_back_end: Record<string, unknown> | null }[];
  card_transactions: { id: string; agent: string; last4: string; merchant: string; mcc: string | null; amount: string; currency: string; approved: boolean; decline_code: string | null; source: string; step: string | null; occurred_at: string }[];
  webhooks: { event_id: string; name: string; object: string; object_id: string | null; status: string | null; agrees: boolean | null; outcome: string; received_at: string }[];
  declines_met: { transaction_id: string; agent: string; decline_code: string; by: string; model: string | null; proposal_id: string | null; said: string }[];
  proposals: { proposal_id: string; kind: string; created_by: string; status: string; terms_sha256: string; decided_by: string | null; method: string | null; virtual_test_passkey: boolean }[];
  invoices: {
    invoice_no: string; proposal_id: string; plan: "pay_from_eur" | "convert_shortfall"; eur_available_before: string; eur_floor: string; eur_committed: string;
    free_eur: string; need_eur: string; amount: string; fee_max: string; quote: null | { quote_id: string; buy_eur: string; sell_usd: string; rate: string; valid_from: string | null };
    conversion_id: string | null; transfer_id: string | null; transfer_request_id: string; status: string | null; fee: string | null; approval_sha256: string; planned_at: string; paid_at: string | null;
  }[];
  attempts: { step: string; outcome: "started" | "done" | "failed"; cause: string | null; at: string }[];
  verify: VerifyLine[];
  reconcile: { checked: number; differences: number; skipped: string[] } | null;
  calls: { airwallex: { endpoint: string; calls: number }[]; airwallex_total: number; budget: number | null } | null;
  checks: Record<"a" | "b" | "c" | "d" | "e" | "f" | "g", { ok: boolean; detail: string }>;
}

const j = <T>(s: string) => JSON.parse(s) as T;
const last4 = (id: string) => id.slice(-4);
const cents = (s: string) => Math.round(Number(s) * 100);

/** Builds the record from the ledger, as it stands. `virtualLabels`: approver labels that are virtual test passkeys. */
export function awx1Record(db: DB, o: { mode: "live" | "stand-in"; virtualLabels?: string[]; verify?: VerifyLine[]; reconcile?: Awx1Record["reconcile"]; calls?: Awx1Record["calls"] }): Awx1Record {
  const events = (name: string) => db.prepare("SELECT seq, ts, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(name) as { seq: number; ts: string; subject: string | null; payload_json: string }[];
  const readBack = new Map(events("awx1.card_read_back").map((e) => [e.subject!, j<Record<string, unknown>>(e.payload_json)]));
  const readBackEnd = new Map(events("awx1.card_read_back_end").map((e) => [e.subject!, j<Record<string, unknown>>(e.payload_json)]));
  const charged = new Map(events("awx1.merchant_charged").map((e) => [e.subject!, j<{ step: string }>(e.payload_json).step]));
  const cards = cardRows(db).filter((c) => readBack.has(c.agent)).map((c) => ({ agent: c.agent, last4: c.last4, card_id_last4: last4(c.card_id), read_back: readBack.get(c.agent)!, read_back_end: readBackEnd.get(c.agent) ?? null }));
  const txs = (db.prepare("SELECT t.*, c.last4 FROM card_transactions t JOIN cards c ON c.card_id = t.card_id ORDER BY t.occurred_at, t.transaction_id").all() as
    { transaction_id: string; agent: string; last4: string; merchant: string; mcc: string | null; amount_cents: number; currency: string; approved: number; failure_reason: string | null; source: string; occurred_at: string }[])
    .map((t) => ({ id: t.transaction_id, agent: t.agent, last4: t.last4, merchant: t.merchant, mcc: t.mcc, amount: fromCents(t.amount_cents), currency: t.currency, approved: t.approved === 1, decline_code: t.failure_reason, source: t.source, step: charged.get(t.transaction_id) ?? null, occurred_at: t.occurred_at }));
  const webhooks = (db.prepare("SELECT * FROM airwallex_events ORDER BY received_at, event_id").all() as { event_id: string; name: string; object: string; object_id: string | null; status: string | null; agrees: number | null; outcome: string; received_at: string }[])
    .map((w) => ({ ...w, agrees: w.agrees === null ? null : w.agrees === 1 }));
  const declinesMet = events("card.decline_met").map((e) => {
    const p = j<{ agent: string; source: string; model: string | null; reason: string; proposal_id: string | null; said: string }>(e.payload_json);
    return { transaction_id: e.subject ?? "", agent: p.agent, decline_code: p.reason, by: p.source === "claude" ? "claude" : "code", model: p.model ?? null, proposal_id: p.proposal_id, said: p.said };
  });
  const virtual = new Set(o.virtualLabels ?? []);
  const proposals = (db.prepare("SELECT p.proposal_id, p.kind, p.created_by, p.status, p.terms_sha256, a.approver, a.method FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id ORDER BY p.created_at, p.proposal_id").all() as
    { proposal_id: string; kind: string; created_by: string; status: string; terms_sha256: string; approver: string | null; method: string | null }[])
    .map((p) => ({ proposal_id: p.proposal_id, kind: p.kind, created_by: p.created_by, status: p.status, terms_sha256: p.terms_sha256, decided_by: p.approver, method: p.method, virtual_test_passkey: !!p.approver && [...virtual].some((l) => p.approver!.startsWith(l)) }));
  const paidAt = (id: string | null) => (id ? (db.prepare("SELECT ts FROM audit_log WHERE event = 'transfer.status' AND subject = ? AND json_extract(payload_json, '$.status') = 'PAID' ORDER BY seq LIMIT 1").get(id) as { ts: string } | undefined)?.ts ?? null : null);
  const invoices = (db.prepare("SELECT proposal_id, terms_json, terms_sha256, created_at FROM proposals WHERE kind = 'invoice_payment' AND status = 'EXECUTED' ORDER BY created_at").all() as { proposal_id: string; terms_json: string; terms_sha256: string; created_at: string }[]).map((p) => {
    const t = j<InvoicePaymentTerms>(p.terms_json);
    const tr = db.prepare("SELECT transfer_id, status, fee_actual FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as { transfer_id: string | null; status: string; fee_actual: string | null } | undefined;
    const conv = t.conversion ? (db.prepare("SELECT conversion_id FROM fx_conversions WHERE request_id = ?").get(t.conversion.request_id) as { conversion_id: string } | undefined) : undefined;
    const q = t.conversion ? (db.prepare("SELECT valid_from FROM fx_quotes WHERE quote_id = ?").get(t.conversion.quote_id) as { valid_from: string } | undefined) : undefined;
    const free = cents(t.balances_before.eur_available) - cents(t.floors.eur_floor) - cents(t.floors.eur_obligations);
    return {
      invoice_no: t.invoice_no, proposal_id: p.proposal_id, plan: t.conversion ? "convert_shortfall" as const : "pay_from_eur" as const,
      eur_available_before: t.balances_before.eur_available, eur_floor: t.floors.eur_floor, eur_committed: t.floors.eur_obligations,
      free_eur: fromCents(free), need_eur: fromCents(cents(t.amount) + cents(t.fee_max)), amount: t.amount, fee_max: t.fee_max,
      quote: t.conversion ? { quote_id: t.conversion.quote_id, buy_eur: t.conversion.buy_amount, sell_usd: t.conversion.sell_amount, rate: t.conversion.client_rate, valid_from: q?.valid_from ?? null } : null,
      conversion_id: conv?.conversion_id ?? null, transfer_id: tr?.transfer_id ?? null, transfer_request_id: t.transfer_request_id, status: tr?.status ?? null, fee: tr?.fee_actual ?? null,
      approval_sha256: p.terms_sha256, planned_at: p.created_at, paid_at: paidAt(tr?.transfer_id ?? null),
    };
  });
  const attempts = (db.prepare("SELECT event, ts, payload_json FROM audit_log WHERE event IN ('awx1.step_started', 'awx1.step_done', 'awx1.step_failed') ORDER BY seq").all() as { event: string; ts: string; payload_json: string }[])
    .map((e) => { const p = j<{ step: string; cause?: string }>(e.payload_json); return { step: p.step, outcome: e.event === "awx1.step_failed" ? "failed" as const : e.event === "awx1.step_done" ? "done" as const : "started" as const, cause: p.cause ?? null, at: e.ts }; });
  const base = { run: RUN, mode: o.mode, test_money: true as const, cards, card_transactions: txs, webhooks, declines_met: declinesMet, proposals, invoices, attempts, verify: o.verify ?? [], reconcile: o.reconcile ?? null, calls: o.calls ?? null };
  return {
    ...base,
    note: o.mode === "live"
      ? "Airwallex sandbox, test money only. Merchant charges and SENT/PAID are the sandbox's simulation endpoints; every approve, decline and decline code is Airwallex's own."
      : "STAND-IN, not evidence: the in-memory Airwallex and Issuing stand-ins (src/redteam), 0 network. It shows the code path and the record's shape only.",
    checks: checkAwx1({ ...base, mode: o.mode }),
  };
}

/** a–g, each from the record alone. Live, the decline must be met by the agent itself (Claude), not code's fallback. */
export function checkAwx1(r: Omit<Awx1Record, "checks" | "note">): Awx1Record["checks"] {
  const ok = (cond: boolean, detail: string) => ({ ok: cond, detail });
  const card = (agent: string) => r.cards.find((c) => c.agent === agent);
  const a = (() => {
    if (r.cards.length !== 3) return ok(false, `${r.cards.length} cards read back, not 3`);
    const bad = r.cards.filter((c) => {
      const b = c.read_back as { per_tx: string; monthly: string; currency: string; mccs: string[]; currencies: string[]; active_to: string | null; policy: { per_tx: string; monthly: string; mccs: string[]; currencies: string[] } };
      return b.per_tx !== b.policy.per_tx || b.monthly !== b.policy.monthly || b.currency !== "EUR" || b.mccs.join() !== b.policy.mccs.join() || b.currencies.join() !== b.policy.currencies.join() || !b.active_to;
    });
    return ok(bad.length === 0, bad.length ? `controls differ from the policy on ${bad.map((c) => c.agent).join(", ")}` : "3 cards: Airwallex holds each policy limit, MCC list, EUR only and an end date");
  })();
  const inStep = (s: string) => r.card_transactions.filter((t) => t.step === s);
  const b = (() => {
    const t = inStep("b").find((x) => x.approved);
    const limit = (card("sourcing")?.read_back as { per_tx?: string } | undefined)?.per_tx;
    return ok(!!t && !!limit && cents(t.amount) <= cents(limit), t ? `${t.id}: ${t.amount} EUR within the ${limit} limit, approved by Airwallex` : "no approved charge in step b");
  })();
  const c = (() => {
    const t = inStep("c").find((x) => !x.approved);
    const limit = (card("sourcing")?.read_back as { per_tx?: string } | undefined)?.per_tx;
    return ok(!!t && t.decline_code === "LIMIT_EXCEEDED" && !!limit && cents(t.amount) > cents(limit), t ? `${t.id}: ${t.amount} EUR over the ${limit} limit, declined by Airwallex ${t.decline_code}` : "no declined charge in step c");
  })();
  const d = (() => {
    const t = inStep("d").find((x) => !x.approved);
    const mccs = (card("support")?.read_back as { mccs?: string[] } | undefined)?.mccs ?? [];
    return ok(!!t && t.decline_code === "MERCHANT_CATEGORY_NOT_ALLOWED" && !!t.mcc && !mccs.includes(t.mcc), t ? `${t.id}: MCC ${t.mcc} on a card for MCC ${mccs.join(",")}, declined by Airwallex ${t.decline_code}` : "no declined charge in step d");
  })();
  const e = (() => {
    const steps = ["b", "c", "d"].flatMap(inStep);
    const byHook = steps.filter((t) => t.source === "webhook");
    const declineC = inStep("c").find((x) => !x.approved);
    const met = declineC && r.declines_met.find((m) => m.transaction_id === declineC.id);
    const raise = met?.proposal_id ? r.proposals.find((p) => p.proposal_id === met.proposal_id && p.kind === "policy_change" && p.created_by === "sourcing") : undefined;
    // Instead of retrying: between the decline and the CFO's approval, nothing charged the card again.
    const second = inStep("c").find((x) => x.approved);
    const charges = declineC ? r.card_transactions.filter((t) => t.agent === "sourcing" && t.occurred_at > declineC.occurred_at && (!second || t.occurred_at < second.occurred_at)) : [];
    const byAgent = !!met && (r.mode === "stand-in" || met.by === "claude");
    const why: string[] = [];
    if (byHook.length !== steps.length) why.push(`${steps.length - byHook.length} of ${steps.length} card transactions came without a webhook`);
    if (!raise) why.push("no raise asked by the Sourcing agent after the LIMIT_EXCEEDED decline");
    if (!byAgent) why.push("the decline was met by code's fallback, not the agent");
    if (charges.length) why.push(`${charges.length} charge(s) between the decline and the raise`);
    if (raise && raise.status !== "EXECUTED") why.push(`the raise ${raise.proposal_id} is ${raise.status}`);
    return ok(why.length === 0, why.length ? why.join("; ") : `${byHook.length} card transactions recorded from Airwallex webhooks; ${met!.agent} (${met!.by}) read ${met!.decline_code} and asked the CFO (${raise!.proposal_id}) instead of retrying`);
  })();
  const f = (() => {
    const fromEur = r.invoices.find((i) => i.plan === "pay_from_eur" && cents(i.free_eur) >= cents(i.need_eur) && i.status === "PAID");
    const fx = r.invoices.find((i) => i.plan === "convert_shortfall" && i.quote && cents(i.quote.buy_eur) === cents(i.need_eur) - cents(i.free_eur) && i.status === "PAID" && !!i.conversion_id);
    // A fresh quote: planned (balance read, quote asked for) after the first payout was PAID, on the balance after it.
    const fresh = !!fromEur && !!fx && !!fromEur.paid_at && fx.planned_at >= fromEur.paid_at;
    return ok(!!fromEur && !!fx && fresh, !fromEur ? "no invoice paid from EUR without FX" : !fx ? "no invoice paid after converting exactly its shortfall" : !fresh ? "the shortfall's quote was not asked for after the first payout" :
      `${fromEur.invoice_no}: free EUR ${fromEur.free_eur} ≥ ${fromEur.need_eur}, no FX; ${fx.invoice_no}: free EUR ${fx.free_eur} < ${fx.need_eur}, bought only ${fx.quote!.buy_eur} on quote ${fx.quote!.quote_id}`);
  })();
  const g = (() => {
    const signed = r.invoices.filter((i) => i.status === "PAID" && i.transfer_id && r.proposals.some((p) => p.proposal_id === i.proposal_id && p.method === "passkey" && p.status === "EXECUTED"));
    const readBack = signed.filter((i) => r.verify.some((v) => v.level === "ok" && v.what === `${i.proposal_id} transfer ${i.transfer_id}`));
    return ok(readBack.length > 0 && readBack.length === signed.length, readBack.length ? `${readBack.map((i) => `${i.transfer_id} (${i.proposal_id})`).join(", ")}: SWIFT, Face ID, approval_sha256 in Airwallex's metadata, PAID` : "no PAID SWIFT payout read back with its approval hash");
  })();
  return { a, b, c, d, e, f, g };
}

/** The run passes when a–g hold, every verify line is ok, and reconcile found no difference. */
export function accepted(r: Awx1Record): { ok: boolean; why: string[] } {
  const why = [
    ...Object.entries(r.checks).filter(([, c]) => !c.ok).map(([k, c]) => `${k}: ${c.detail}`),
    ...r.verify.filter((v) => v.level === "FAIL").map((v) => `verify: ${v.what} ${v.detail}`),
    ...(r.reconcile ? (r.reconcile.differences ? [`reconcile: ${r.reconcile.differences} difference(s)`] : []) : ["reconcile: not run"]),
  ];
  return { ok: why.length === 0, why };
}

/**
 * The checks of npm run verify that apply to an Airwallex-only world, as lines for the record: the audit chain, every
 * passkey approval re-verified offline, the approval methods, the policy versions, and Airwallex read back (GET only).
 */
export async function verifyLines(db: DB, get: Get): Promise<VerifyLine[]> {
  const chain = verifyAuditChain(db);
  const out: VerifyLine[] = [{ level: chain.ok ? "ok" : "FAIL", what: "audit log hash chain", detail: chain.ok ? `${chain.rows} rows` : `row ${chain.seq}: ${chain.reason}` }];
  for (const c of [...await reverifyPasskeyApprovals(db), ...approvalMethodChecks(db), ...policyVersionChecks(db)]) out.push({ level: c.ok ? "ok" : "FAIL", what: c.what, detail: c.detail });
  out.push(...await verifyAirwallex(db, get));
  return out;
}
