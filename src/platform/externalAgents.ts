// Outside AI agents (P1): any agent, ours or not, can connect through the agent API (src/cli/mcp.ts) and work under
// the same CFO policy as our own three. What it can do:
//   - ask for a company card: a proposal; the card is issued only after the CFO approves it with Face ID;
//   - pay on that card: the merchant's charge goes to Airwallex, which declines anything over the card's limits;
//   - ask for a higher limit: a policy change, approved with Face ID like any other;
//   - see its card, its limits and its spend.
// What it cannot do: approve anything, set a limit, or reach any other agent's card or money. The emergency stop
// freezes its card with the rest. Each outside agent is named ext:<name>; that name is its identity in the ledger.

import { audit, type Actor } from "../audit/log.js";
import type { CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import { CARD_RAISE_TTL_MS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { fromCents, toCents } from "../lib/money.js";
import { TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { cardOf, cardSpendCents, ingestCardTransaction, storeCard } from "../policy/cards.js";
import { cardLimits, frozen } from "../policy/rules.js";

/** A card request waits an hour for the CFO, like a card raise. */
const ONBOARD_TTL_MS = 60 * 60 * 1000;
/** The same ranges the policy allows for our own agents' cards. */
const PER_TX = { min: 100, max: 100_000 };
const MONTHLY = { min: 100, max: 500_000 };
/** The merchant category the sandbox charge carries: computer software and services. */
const MCC = "5734";
const OWN = new Set(["sourcing", "support", "treasury", "customer", "system", "human", "claude"]);

export type ExternalAgentId = `ext:${string}`;

export interface AgentOnboardTerms extends Terms {
  kind: "agent_onboard";
  agent_id: ExternalAgentId;
  display_name: string;
  purpose: string;
  card: { currency: "EUR"; per_tx: string; monthly: string };
}

interface Row { agent_id: string; display_name: string; purpose: string; per_tx_cents: number; monthly_cents: number; status: "REQUESTED" | "ACTIVE"; proposal_id: string | null }

/** "acme-research" -> "ext:acme-research". Lower-case letters, digits and dashes, 2 to 32 long; never one of ours. */
export function agentId(name: string): ExternalAgentId {
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(name) || OWN.has(name)) throw new Error(`not an agent name: ${JSON.stringify(name)} (lower-case letters, digits and dashes, 2 to 32 long)`);
  return `ext:${name}`;
}

const row = (db: DB, id: string) => db.prepare("SELECT * FROM external_agents WHERE agent_id = ?").get(id) as Row | undefined;

function cents(label: string, v: string, range: { min: number; max: number }): number {
  let c: number;
  try {
    c = toCents(v);
  } catch {
    throw new Error(`${label}: write an amount with two decimals, like 25.00`);
  }
  if (c < range.min) throw new Error(`${label} must be at least ${fromCents(range.min)} EUR`);
  if (c > range.max) throw new Error(`${label} must be at most ${fromCents(range.max)} EUR`);
  return c;
}

/** The agent asks for a company card. Nothing is issued: it is a proposal for the CFO. */
export function requestCompanyCard(db: DB, id: ExternalAgentId, a: { displayName: string; purpose: string; perTx: string; monthly: string }, now = new Date()): ProposalRow {
  const name = a.displayName.trim();
  const purpose = a.purpose.trim();
  if (name === "" || name.length > 60) throw new Error("give the agent a name of at most 60 characters");
  if (purpose === "" || purpose.length > 300) throw new Error("say what the card is for (the purpose), in at most 300 characters");
  const perTx = cents("Most per purchase", a.perTx, PER_TX);
  const monthly = cents("Most per month", a.monthly, MONTHLY);
  if (monthly < perTx) throw new Error("Most per month must be at least the per-purchase limit");
  const known = row(db, id);
  if (known?.status === "ACTIVE") throw new Error(`${id} already has a company card; ask for a higher limit instead`);
  if (known?.proposal_id) {
    const p = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(known.proposal_id) as { status: string } | undefined;
    if (p && ["PENDING_APPROVAL", "APPROVED", "EXECUTING", "FAILED"].includes(p.status)) throw new Error(`${known.proposal_id} is already waiting for the CFO`);
  }
  const terms: AgentOnboardTerms = {
    schema: TERMS_SCHEMA, kind: "agent_onboard", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + ONBOARD_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    agent_id: id, display_name: name, purpose, card: { currency: "EUR", per_tx: fromCents(perTx), monthly: fromCents(monthly) },
  };
  return db.transaction(() => {
    const p = createProposal(db, { terms, createdBy: id as Actor }, now);
    db.prepare(`INSERT INTO external_agents (agent_id, display_name, purpose, per_tx_cents, monthly_cents, status, proposal_id, created_at) VALUES (?, ?, ?, ?, ?, 'REQUESTED', ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET display_name = excluded.display_name, purpose = excluded.purpose, per_tx_cents = excluded.per_tx_cents,
        monthly_cents = excluded.monthly_cents, proposal_id = excluded.proposal_id`).run(id, name, purpose, perTx, monthly, p.proposal_id, now.toISOString());
    audit(db, id as Actor, "agent.card_requested", id, { agent_id: id, name, purpose, per_tx: fromCents(perTx), monthly: fromCents(monthly), currency: "EUR", proposal_id: p.proposal_id }, now);
    return p;
  }).immediate();
}

/** After the CFO's approval: the card is issued at Airwallex with exactly the approved limits. */
export async function executeAgentOnboard(db: DB, rail: IssuingRail, proposalId: string, now = new Date()): Promise<void> {
  const t = beginExecution<AgentOnboardTerms>(db, proposalId, (terms) => {
    if (terms.kind !== "agent_onboard") throw new Error(`${proposalId} is not an agent's card request`);
    if (row(db, terms.agent_id)?.status === "ACTIVE") throw new Error(`${terms.agent_id} already has a company card`);
  }, now);
  try {
    const slug = t.agent_id.slice(4);
    const limits = { currency: "EUR" as const, perTxCents: toCents(t.card.per_tx), monthlyCents: toCents(t.card.monthly) };
    const email = `agents+ext-${slug}@tidemark-data.example`;
    const firstName = t.display_name.replace(/[^A-Za-z ]/g, "").trim().slice(0, 40) || "Outside";
    const holder = (await rail.findCardholderByEmail(email)) ?? (await rail.createCardholder({ email, firstName, lastName: "Agent" }));
    const business = db.prepare("SELECT address FROM metal_accounts WHERE role = 'business'").get() as { address: string } | undefined;
    const nickname = `${t.display_name.slice(0, 40)}: outside agent${business ? ` (${business.address.slice(-6).toLowerCase()})` : ""}`;
    const card = (await rail.findCard(holder.id, nickname)) ?? (await rail.createCard({ cardholderId: holder.id, nickname, createdBy: "Tidemark CFO policy", limits }));
    // Trust what Airwallex says the card has, not what we asked for.
    if (!card.limits || card.limits.perTxCents !== limits.perTxCents || card.limits.monthlyCents !== limits.monthlyCents) {
      throw new Error(`the card at Airwallex has other limits than the approved ${t.card.per_tx} / ${t.card.monthly} EUR`);
    }
    db.transaction(() => {
      db.prepare("UPDATE external_agents SET status = 'ACTIVE', per_tx_cents = ?, monthly_cents = ? WHERE agent_id = ?").run(limits.perTxCents, limits.monthlyCents, t.agent_id);
      storeCard(db, t.agent_id, card, now);
      audit(db, "awx-executor", "card.issued", t.agent_id, { agent: t.agent_id, last4: card.last4, nickname, limits: `${t.card.per_tx} / ${t.card.monthly}`, currency: "EUR", proposal_id: proposalId }, now);
      finishExecution(db, proposalId, "EXECUTED", { card_last4: card.last4 }, now);
    }).immediate();
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now);
    throw e;
  }
}

export interface CardStatus {
  agent_id: string;
  status: "NONE" | "REQUESTED" | "ACTIVE";
  proposal_id: string | null;
  proposal_status: string | null;
  card: { last4: string; per_tx: string; monthly: string; spent_this_month: string; frozen: boolean; currency: "EUR" } | null;
  recent: { merchant: string; amount: string; approved: boolean; reason: string | null; at: string }[];
}

export function cardStatus(db: DB, id: ExternalAgentId, now = new Date()): CardStatus {
  const r = row(db, id);
  const card = cardOf(db, id);
  const proposalStatus = r?.proposal_id ? ((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(r.proposal_id) as { status: string } | undefined)?.status ?? null) : null;
  const limits = card ? cardLimits(db, id) : null;
  return {
    agent_id: id, status: r?.status ?? "NONE", proposal_id: r?.proposal_id ?? null, proposal_status: proposalStatus,
    card: card && limits ? {
      last4: card.last4, per_tx: fromCents(limits.perTxCents), monthly: fromCents(limits.monthlyCents),
      spent_this_month: fromCents(cardSpendCents(db, id, now)), frozen: frozen(db) || card.status === "INACTIVE", currency: "EUR",
    } : null,
    recent: (db.prepare("SELECT merchant, amount_cents, approved, failure_reason, occurred_at FROM card_transactions WHERE agent = ? ORDER BY occurred_at DESC, rowid DESC LIMIT 10").all(id) as
      { merchant: string; amount_cents: number; approved: number; failure_reason: string | null; occurred_at: string }[])
      .map((x) => ({ merchant: x.merchant, amount: fromCents(x.amount_cents), approved: x.approved === 1, reason: x.failure_reason, at: x.occurred_at })),
  };
}

/**
 * The agent pays a merchant on its card. In the sandbox the merchant's charge is Airwallex's simulation endpoint (an
 * honest stand-in for a checkout); whether it is approved or declined is Airwallex's own decision on the card.
 */
export async function payWithCard(db: DB, sim: IssuingSim, id: ExternalAgentId, a: { merchant: string; amount: string; description: string }, now = new Date()): Promise<CardTransaction> {
  const card = cardOf(db, id);
  if (!card || row(db, id)?.status !== "ACTIVE") throw new Error(`${id} has no company card yet; ask for one and wait for the CFO's approval`);
  const merchant = a.merchant.trim();
  if (merchant === "" || merchant.length > 60) throw new Error("name the merchant, in at most 60 characters");
  let amountCents: number;
  try {
    amountCents = toCents(a.amount);
  } catch {
    throw new Error("write the amount with two decimals, like 19.00");
  }
  if (amountCents <= 0) throw new Error("the amount must be more than 0.00");
  const purpose = `${merchant}, ${a.description.trim().slice(0, 120)}`;
  audit(db, id as Actor, "card.purchase_started", id, { agent: id, last4: card.last4, merchant, amount: fromCents(amountCents), currency: "EUR", description: a.description.trim().slice(0, 120) }, now);
  const t = await sim.simulateCardCharge({ cardId: card.card_id, amountCents, currency: "EUR", merchant, mcc: MCC });
  ingestCardTransaction(db, t, "simulation", now, purpose);
  return t;
}

/** The agent asks for a higher limit on its card: a policy change for the CFO. Nothing changes until approved. */
export function requestCardRaise(db: DB, id: ExternalAgentId, to: { perTx?: string; monthly?: string }, reason: string, now = new Date()): ProposalRow {
  if (row(db, id)?.status !== "ACTIVE") throw new Error(`${id} has no company card yet`);
  if (reason.trim() === "" || reason.length > 300) throw new Error("say why, in at most 300 characters");
  const changes = [
    ...(to.perTx ? [{ key: `card.${id}.per_tx`, to: to.perTx }] : []),
    ...(to.monthly ? [{ key: `card.${id}.monthly`, to: to.monthly }] : []),
  ];
  if (changes.length === 0) throw new Error("say which limit to raise: per purchase, per month, or both");
  return proposePolicyChange(db, { changes, reason: `${id}: ${reason.trim()}`, ttlMs: CARD_RAISE_TTL_MS }, id as Actor, now);
}
