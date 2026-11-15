// The agents' cards at the Airwallex sandbox, sorted out (15 Nov): which card is each agent's live card, whether it
// matches the CFO policy, and which are older test cards. One pure function, used by every view from the same live
// read (GET /issuing/cards, cut to the last four digits at kit11): Purser Cloud's Agents tab and /airwallex both call it,
// so they cannot disagree.
//
// The sandbox holds cards from several runs (29 Oct, 3 Nov, 14 Nov), two or three per agent, with older limits. An agent's
// card is known by its nickname ("sourcing agent: …"). Its live card is the one Purser Cloud pinned (the card it issued or
// adopted), else the newest ACTIVE card that matches the policy, else the newest ACTIVE card. Every other card of the agent
// is an older test card: frozen (INACTIVE) or still to be frozen.

export const CARD_AGENTS = ["sourcing", "support", "treasury"] as const;
export type CardAgentId = (typeof CARD_AGENTS)[number];

/** One card as the views need it: no card number beyond its last four digits. */
export interface CardLite {
  id: string;
  last4: string | null;
  status: string;
  nickname: string | null;
  created_at: string | null;
  per_tx_cents: number | null;
  monthly_cents: number | null;
}
export interface PolicyLimits { per_tx_cents: number; monthly_cents: number }

export interface AgentCardSet {
  agent: CardAgentId;
  live: CardLite | null;
  /** The live card's limits are the CFO policy's, both of them. */
  in_sync: boolean;
  policy: PolicyLimits;
  /** The agent's other cards, newest first: frozen already, or still active (to be frozen). */
  older: { card: CardLite; frozen: boolean }[];
}

/** The agent a card belongs to, from its nickname ("sourcing agent: warehouse and data software (3efefc)"). */
export function agentOfCard(nickname: string | null | undefined): CardAgentId | null {
  const m = /^\s*(sourcing|support|treasury) agent\b/i.exec(nickname ?? "");
  return m ? (m[1]!.toLowerCase() as CardAgentId) : null;
}

const time = (s: string | null) => {
  const t = s ? Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const newestFirst = (a: CardLite, b: CardLite) => time(b.created_at) - time(a.created_at) || (a.id < b.id ? 1 : -1);
const synced = (c: CardLite, p: PolicyLimits) => c.per_tx_cents === p.per_tx_cents && c.monthly_cents === p.monthly_cents;

/** Each agent's live card and older cards. `pinned`: the card Purser Cloud issued or adopted per agent, by id. */
export function classifyAgentCards(cards: CardLite[], policy: Record<CardAgentId, PolicyLimits>, pinned: Partial<Record<CardAgentId, string>> = {}): AgentCardSet[] {
  return CARD_AGENTS.map((agent) => {
    const p = policy[agent];
    const mine = cards.filter((c) => agentOfCard(c.nickname) === agent && c.status !== "CLOSED").sort(newestFirst);
    const active = mine.filter((c) => c.status === "ACTIVE");
    const pin = pinned[agent] ? mine.find((c) => c.id === pinned[agent]) : undefined;
    const live = pin ?? active.find((c) => synced(c, p)) ?? active[0] ?? null;
    return {
      agent, live, in_sync: !!live && synced(live, p), policy: p,
      older: mine.filter((c) => c !== live).map((card) => ({ card, frozen: card.status !== "ACTIVE" })),
    };
  });
}

/** One honest line for all agents, counted from the sets: never "all match" while an older card is still active. */
export function cardSetSummary(sets: AgentCardSet[]): { ok: boolean; text: string } {
  const synced = sets.filter((s) => s.live && s.in_sync).length;
  const stray = sets.reduce((n, s) => n + s.older.filter((o) => !o.frozen).length, 0);
  const ok = synced === sets.length && stray === 0;
  const parts = [`${synced} of ${sets.length} agents have a live card that matches the CFO policy`];
  if (stray) parts.push(`${stray} older test card${stray === 1 ? " is" : "s are"} still active`);
  return { ok, text: parts.join("; ") };
}
