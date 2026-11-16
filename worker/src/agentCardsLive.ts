// /airwallex's live block (15 Nov): each agent's live card at the Airwallex sandbox and its older test cards, from one
// read of GET /issuing/cards through the card desk (./awxCards.ts, last four digits only), sorted by the same function
// Purser Cloud's Agents tab uses (src/airwallex/agentCardSet.ts) against the CFO policy (src/config/policy.ts CARDS).
// Read only, public, one answer a minute for everyone. Never a full card number, a CVV or a cardholder.
import { CARDS as POLICY_CARDS } from "../../src/config/policy.js";
import { CARD_AGENTS, cardSetSummary, classifyAgentCards, type CardAgentId, type CardLite, type PolicyLimits } from "../../src/airwallex/agentCardSet.js";
import type { CardsAnswer, CardsAsk, SafeCard } from "../../src/airwallex/cardGate.js";

export const AGENT_CARDS_PATH = "/api/awx/agent-cards";
const TTL_MS = 60_000;

export const POLICY_LIMITS = Object.fromEntries(CARD_AGENTS.map((a) => [a, { per_tx_cents: POLICY_CARDS[a].perTxCents, monthly_cents: POLICY_CARDS[a].monthlyCents }])) as Record<CardAgentId, PolicyLimits>;

export const liteOf = (c: SafeCard): CardLite => ({ id: c.card_id, last4: c.last4, status: c.status, nickname: c.nickname, created_at: c.created_at, per_tx_cents: c.limits?.per_tx_cents ?? null, monthly_cents: c.limits?.monthly_cents ?? null });
/** A card as a public page may show it: last four, the card id's last four, status and limits. */
const shown = (c: CardLite) => ({ last4: c.last4, card_id_last4: c.id.slice(-4), status: c.status, per_tx_cents: c.per_tx_cents, monthly_cents: c.monthly_cents, created_at: c.created_at });

export type AgentCardsAnswer =
  | { source: "airwallex-sandbox"; read_at: string; cut: boolean; summary: { ok: boolean; text: string }; agents: unknown[] }
  | { source: "unavailable"; reason: string; checked_at: string };

let cache: { at: number; body: AgentCardsAnswer } | null = null;
/** The list under way, if any: reads at the same moment share it (security review, 16 Nov). */
let inflight: Promise<AgentCardsAnswer> | null = null;

/** The live answer, cached a minute. `ask` is the card desk's one method. */
export async function agentCardsLive(ask: (a: CardsAsk) => Promise<CardsAnswer>, opts: { off?: boolean; now?: () => number } = {}): Promise<AgentCardsAnswer> {
  const now = opts.now ?? Date.now;
  if (opts.off) return { source: "unavailable", reason: "live reads are switched off", checked_at: new Date(now()).toISOString() };
  if (cache && now() - cache.at < TTL_MS) return cache.body;
  inflight ??= readOnce(ask, now).finally(() => { inflight = null; });
  return inflight;
}

async function readOnce(ask: (a: CardsAsk) => Promise<CardsAnswer>, now: () => number): Promise<AgentCardsAnswer> {
  const a = await ask({ op: "list" });
  let body: AgentCardsAnswer;
  if (!a.ok || a.op !== "list") body = { source: "unavailable", reason: a.ok ? "an unexpected answer" : a.reason, checked_at: new Date(now()).toISOString() };
  else {
    const sets = classifyAgentCards(a.cards.map(liteOf), POLICY_LIMITS);
    body = {
      source: "airwallex-sandbox", read_at: new Date(now()).toISOString(), cut: a.cut, summary: cardSetSummary(sets),
      agents: sets.map((s) => ({ agent: s.agent, policy: s.policy, in_sync: s.in_sync, live: s.live ? shown(s.live) : null, older: s.older.map((o) => ({ ...shown(o.card), frozen: o.frozen })) })),
    };
  }
  cache = { at: now(), body };
  return body;
}
export const resetAgentCardsCache = () => { cache = null; inflight = null; };
