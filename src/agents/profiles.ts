// F, the Agents page: what each agent does, with which model, within which limits, and what waits for the CFO. Every
// number comes from the CFO policy (rules.ts), the mandates and the config the agents themselves are held to; the
// page keeps no copy. Changing a setting is the policy editor's job: tightening on the phone with Face ID, loosening
// as a proposal from the runner, approved with Face ID.

import { AGENT_DISPLAY } from "../config/brand.js";
import { AGENTS, MCC_WORDS, VELOCITY, type Agent } from "../config/policy.js";
import { MODELS } from "../claude/reader.js";
import { CLAUDE_JOBS } from "../claude/tools.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { cardControls } from "../policy/cards.js";
import { currentPolicy, frozen, paused, policyValue, type PolicyEntry } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";
import { spendLimits } from "../policy/holds.js";

export interface AgentProfile {
  id: string;
  name: string;
  job: string;
  /** working; stopped (its own stop, e.g. a velocity limit); frozen (the emergency stop). */
  status: "working" | "stopped" | "paused" | "frozen";
  models: { model: string; job: string }[];
  /** What it does on its own, within the limits below. */
  alone: string[];
  /** What waits for the CFO's Face ID. */
  asks: string[];
  card: { per_tx: string; monthly: string; currency: "EUR"; merchants: string[] };
  /** Its bound Metal mandate (the hard outer wall, on chain) and the policy's own limit per payment inside it. */
  mandate: { cap: string; budget: string; policy_cap: string | null } | null;
  velocity: { per_minute: number; usdz_per_hour: string; eur_per_hour: string };
  /** The CFO policy settings that belong to this agent, as the policy editor shows them. */
  settings: PolicyEntry[];
}

const modelWords = (id: string) => id.replace(/^claude-([a-z]+)-(\d+)-(\d+)$/, (_m, n: string, a: string, b: string) => `Claude ${n[0]!.toUpperCase()}${n.slice(1)} ${a}.${b}`);
const merchants = (mccs: string[]) => mccs.map((m) => `${MCC_WORDS[m] ?? "Category"} (MCC ${m})`);

function models(actor: string): AgentProfile["models"] {
  const sorts = CLAUDE_JOBS.filter((j) => j.role === "classify").map((j) => ({ model: modelWords(MODELS.classify), job: j.job }));
  const own = CLAUDE_JOBS.filter((j) => j.actor === actor).map((j) => ({ model: modelWords(MODELS[j.role]), job: j.job }));
  return [...sorts, ...own, { model: modelWords(MODELS.review), job: "reviews its mandate changes, invoice payments, refund batches and task-card requests for the CFO (advice only); a card-limit change goes to the CFO without a review" }];
}

/** The agent's mandate as bound on chain: the last bind or replacement in the audit log, as the holds read it. */
function mandateOf(db: DB, agent: string): AgentProfile["mandate"] {
  const { capCents, budgetCents } = spendLimits(db, agent);
  if (capCents === null || budgetCents === null) return null;
  return { cap: fromCents(capCents), budget: fromCents(budgetCents), policy_cap: policyValue(db, `cap.${agent}`) || null };
}

/** The Agents page: Purser's three agents, then outside agents with an approved card. */
export function agentProfiles(db: DB, now = new Date()): AgentProfile[] {
  const policy = currentPolicy(db);
  const v = (key: string) => policyValue(db, key);
  const status = (id: string): AgentProfile["status"] => (frozen(db) ? "frozen" : paused(db, id) ? "paused" : stopped(db, id) ? "stopped" : "working");
  const velocity = (k: Agent | "outside") => ({ per_minute: VELOCITY[k].perMinute, usdz_per_hour: fromCents(VELOCITY[k].usdzPerHourCents), eur_per_hour: fromCents(VELOCITY[k].eurPerHourCents) });
  const card = (id: string) => ({ per_tx: v(`card.${id}.per_tx`), monthly: v(`card.${id}.monthly`), currency: "EUR" as const, merchants: merchants(cardControls(id, now, db).mccs) });
  const onCard = (id: string, what: string) => `Buys ${what} on its card: up to ${v(`card.${id}.per_tx`)} EUR a purchase, ${v(`card.${id}.monthly`)} EUR a month`;
  const fourEyes = v("approval.four_eyes_eur");
  const always = ["A higher card limit", "Starting again after a stop"];

  const own = AGENTS.map((id): AgentProfile => {
    const cap = (m: AgentProfile["mandate"]) => (m ? `${m.policy_cap ?? m.cap} test USD a payment` : "its mandate's cap");
    const mandate = mandateOf(db, id);
    const words: Record<Agent, { alone: string[]; asks: string[] }> = {
      sourcing: {
        alone: [`Pays the warehouse for live stock checks on chain (x402), up to ${cap(mandate)}`, onCard(id, "warehouse software")],
        asks: ["A supplier price above its limit: it stops, proposes options and waits", ...always],
      },
      support: {
        alone: [`Refunds customers when a dispute holds: refunds up to ${v("approval.refund_each")} test USD each and ${v("approval.refund_per_dispute")} per dispute`, onCard(id, "helpdesk software")],
        asks: [`A refund above ${v("approval.refund_each")} each or ${v("approval.refund_per_dispute")} per dispute`, ...always],
      },
      treasury: {
        alone: [`Sweeps earnings to Airwallex, up to ${cap(mandate)}`, onCard(id, "bookkeeping software"),
          `Issues a single-use task card up to ${v("approval.task_card_eur")} EUR when you ask at the runner (3 a day)`],
        asks: ["Every invoice paid by SWIFT, with its FX quote", "A supplier's new bank details",
          `A task card above ${v("approval.task_card_eur")} EUR, or asked from the phone or by an agent`,
          ...(fourEyes ? [`Above ${fourEyes} EUR: two people`] : []), ...always],
      },
    };
    return {
      id, name: AGENT_DISPLAY[id].name, job: AGENT_DISPLAY[id].job, status: status(id), models: models(id),
      ...words[id], card: card(id), mandate, velocity: velocity(id), settings: policy.filter((e) => e.agent === id),
    };
  });

  const outside = (db.prepare("SELECT agent_id, display_name, purpose FROM external_agents WHERE status = 'ACTIVE' ORDER BY agent_id").all() as
    { agent_id: string; display_name: string; purpose: string }[]).map((x): AgentProfile => ({
    id: x.agent_id, name: `${x.display_name} (outside agent)`, job: x.purpose, status: status(x.agent_id),
    models: [{ model: modelWords(MODELS.review), job: "reviews each of its requests for the CFO (advice only)" }],
    alone: [`Pays on its card, through the agent API: up to ${v(`card.${x.agent_id}.per_tx`)} EUR a purchase, ${v(`card.${x.agent_id}.monthly`)} EUR a month`],
    asks: ["A task card (always a proposal)", ...always],
    card: card(x.agent_id), mandate: null, velocity: velocity("outside"), settings: policy.filter((e) => e.agent === x.agent_id),
  }));
  return [...own, ...outside];
}
