// The CFO policy (tier 2 item 6): limits in code that sit inside the on-chain mandates and are checked before
// anything is signed. The mandates stay the hard outer wall; the policy can only be stricter. Values live in the
// settings table and change only through an approved policy_change proposal (src/executors/policyChange.ts).

import { AGENTS, CARDS, REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS, TASK_CARD_EUR_FALLBACK, type Agent } from "../config/policy.js";
import { agentName } from "../config/brand.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { stopped } from "./velocity.js";
import { agentsOn } from "../config/agents.js";
import { cardLimitsFrom } from "./cardRules.js";
import { airiRailOn, airiRuleDefs } from "../airi/policy.js";

export type PolicyKey = "approval.airi_alone" | "approval.airi_alone_per_day" | `airi.merchant.${string}` | "freeze" | `stop.${string}` | `pause.${string}` | "approval.four_eyes_eur" | `cap.${Agent}` | `card.${string}.per_tx` | `card.${string}.monthly` | "eur_floor" | "usd_floor" | "approval.refund_each" | "approval.refund_per_dispute" | "approval.task_card_eur" | `counterparty:${string}`;

export interface Rule {
  key: PolicyKey;
  label: string;
  unit: "USDZ" | "EUR" | "USD" | "";
  /** money: a decimal amount; optional_money: an amount or "" (no extra limit); choice: one of `choices`. */
  kind: "money" | "optional_money" | "choice";
  min?: number;
  max?: number;
  choices?: string[];
  fallback: string;
  /** The agent this setting belongs to, for the Agents page; company-wide settings have none. */
  agent?: string;
}

export interface PolicyEntry extends Rule {
  value: string;
  /** The value in words, as the editor and the dashboard show it. */
  display: string;
}

const MONEY = /^\d{1,9}\.\d{2}$/;
const MAX_FLOOR = 10_000_000_000;

const STATIC: Rule[] = [
  // The emergency stop (E2): on, every agent payment is refused before signing and every company card is frozen.
  { key: "freeze", label: "Emergency stop: all agent payments and cards", unit: "", kind: "choice", choices: ["off", "on"], fallback: "off" },
  { key: "cap.sourcing", label: "Sourcing agent: most per payment", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "", agent: "sourcing" },
  { key: "cap.support", label: "Support agent: most per refund", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "", agent: "support" },
  { key: "cap.treasury", label: "Treasury agent: most per sweep", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "", agent: "treasury" },
  { key: "approval.refund_each", label: "A refund above this needs a person", unit: "USDZ", kind: "money", min: 0, max: 2000, fallback: fromCents(REFUND_AUTO_EACH_CENTS), agent: "support" },
  { key: "approval.refund_per_dispute", label: "Refunds per dispute above this need a person", unit: "USDZ", kind: "money", min: 0, max: 2000, fallback: fromCents(REFUND_AUTO_PER_DISPUTE_CENTS), agent: "support" },
  // E1, four eyes: above this a payment needs the Face ID of two different people (src/policy/fourEyes.ts). Off when empty.
  // Ask Purser (G): a task card the CFO asks for up to this amount is issued at once; above it, with Face ID.
  { key: "approval.task_card_eur", label: "Task cards up to this are issued without Face ID", unit: "EUR", kind: "money", min: 0, max: 150_000, fallback: TASK_CARD_EUR_FALLBACK, agent: "treasury" },
  { key: "approval.four_eyes_eur", label: "Payments above this need two people (four eyes)", unit: "EUR", kind: "optional_money", min: 0, max: MAX_FLOOR, fallback: "" },
  { key: "eur_floor", label: "EUR reserve floor", unit: "EUR", kind: "money", min: 0, max: MAX_FLOOR, fallback: "", agent: "treasury" },
  { key: "usd_floor", label: "USD reserve floor", unit: "USD", kind: "money", min: 0, max: MAX_FLOOR, fallback: "", agent: "treasury" },
  // Each agent's company card at Airwallex (K2). The card itself is synced to these, so Airwallex declines the rest.
  ...AGENTS.flatMap((a): Rule[] => [
    // Set to on by code when the agent breaks a velocity limit (src/policy/velocity.ts); off again only with Face ID.
    { key: `stop.${a}`, label: `${agentName(a)}: stopped (velocity limit)`, unit: "", kind: "choice", choices: ["off", "on"], fallback: "off", agent: a },
    { key: `card.${a}.per_tx`, label: `${agentName(a)}'s card: most per purchase`, unit: "EUR", kind: "money", min: 100, max: 100_000, fallback: fromCents(CARDS[a].perTxCents), agent: a },
    { key: `card.${a}.monthly`, label: `${agentName(a)}'s card: most per month`, unit: "EUR", kind: "money", min: 100, max: 500_000, fallback: fromCents(CARDS[a].monthlyCents), agent: a },
  ]),
];

/** Every rule, the allowed counterparties (Airwallex beneficiaries) and outside agents' cards (P1) included. */
export function rules(db: DB): Rule[] {
  // An outside agent's card, once the CFO approved it: the same limits as our own agents', starting from what was approved.
  const outside = (db.prepare("SELECT agent_id, display_name, per_tx_cents, monthly_cents FROM external_agents WHERE status = 'ACTIVE' ORDER BY agent_id").all() as
    { agent_id: string; display_name: string; per_tx_cents: number; monthly_cents: number }[]).flatMap((x): Rule[] => [
    { key: `stop.${x.agent_id}`, label: `${x.display_name} (outside agent): stopped (velocity limit)`, unit: "", kind: "choice", choices: ["off", "on"], fallback: "off", agent: x.agent_id },
    { key: `card.${x.agent_id}.per_tx`, label: `${x.display_name} (outside agent)'s card: most per purchase`, unit: "EUR", kind: "money", min: 100, max: 100_000, fallback: fromCents(x.per_tx_cents), agent: x.agent_id },
    { key: `card.${x.agent_id}.monthly`, label: `${x.display_name} (outside agent)'s card: most per month`, unit: "EUR", kind: "money", min: 100, max: 500_000, fallback: fromCents(x.monthly_cents), agent: x.agent_id },
  ]);
  // A task card (Ask Purser): its limit is the approved amount, per purchase and in all; like any card it can be stopped.
  const tasks = (db.prepare("SELECT task_id, kind, amount_cents FROM task_cards ORDER BY task_id").all() as
    { task_id: string; kind: string; amount_cents: number }[]).flatMap((x): Rule[] => [
    { key: `stop.${x.task_id}`, label: `${x.kind} task card (${x.task_id.slice(5)}): stopped`, unit: "", kind: "choice", choices: ["off", "on"], fallback: "off" },
    { key: `card.${x.task_id}.per_tx`, label: `${x.kind} task card (${x.task_id.slice(5)}): most per purchase`, unit: "EUR", kind: "money", min: 1, max: x.amount_cents, fallback: fromCents(x.amount_cents) },
    { key: `card.${x.task_id}.monthly`, label: `${x.kind} task card (${x.task_id.slice(5)}): most in all`, unit: "EUR", kind: "money", min: 1, max: x.amount_cents, fallback: fromCents(x.amount_cents) },
  ]);
  const payees = (db.prepare("SELECT DISTINCT name FROM beneficiaries ORDER BY name").all() as { name: string }[]).map((b): Rule => ({
    key: `counterparty:${b.name}`, label: `${b.name} (Airwallex payee)`, unit: "", kind: "choice", choices: ["allowed", "blocked"], fallback: "allowed",
  }));
  // The Airi rail's keys (src/airi/policy.ts): only with KIT11_AIRI_RAIL=on, or once the CFO has set one of them.
  const airi = airiRailOn() || db.prepare("SELECT 1 FROM settings WHERE key LIKE 'approval.airi_%' OR key LIKE 'airi.merchant.%'").get() ? airiRuleDefs() as Rule[] : [];
  return [...STATIC, ...pauseRules(db), ...outside, ...tasks, ...payees, ...airi];
}

/**
 * 4.2 The CFO pauses one agent with Face ID: its Metal mandate is revoked on chain and its card frozen at Airwallex
 * (src/policy/pause.ts); here, Purser refuses its payments before signing. Only with the agents switch on.
 */
function pauseRules(db: DB): Rule[] {
  // A paused agent keeps its rule even with the switch off, so it can still be resumed (review of 4.2).
  return AGENTS.filter((a) => agentsOn() || paused(db, a)).map((a): Rule => ({ key: `pause.${a}`, label: `${agentName(a)}: paused by the CFO (Metal mandate revoked, card frozen)`, unit: "", kind: "choice", choices: ["off", "on"], fallback: "off", agent: a }));
}

/** Whether the CFO has paused this agent (4.2). */
export function paused(db: DB, agent: string): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`pause.${agent}`) as { value: string } | undefined;
  return row?.value === "on";
}

export function policyValue(db: DB, key: string): string {
  const rule = rules(db).find((r) => r.key === key);
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? rule?.fallback ?? "";
}

function display(r: Rule, value: string): string {
  if (r.key === "approval.four_eyes_eur" && value === "") return "off (one person approves)";
  if (r.kind === "optional_money" && value === "") return "no extra limit (the mandate's cap applies)";
  if (r.kind === "money" && value === "") return "not set yet";
  return r.unit ? `${value} ${r.unit}` : value;
}

export function currentPolicy(db: DB): PolicyEntry[] {
  return rules(db).map((r) => {
    const value = policyValue(db, r.key);
    return { ...r, value, display: display(r, value) };
  });
}

/** Null if the change is acceptable now; otherwise why not. `from` must be the value it replaces. */
export function validateChange(db: DB, c: { key: string; from: string; to: string }): string | null {
  const r = rules(db).find((x) => x.key === c.key);
  if (!r) return `unknown policy setting ${c.key}`;
  const now = policyValue(db, c.key);
  if (c.from !== now) return `${r.label} is now ${now || "not set"}, not ${c.from || "not set"}`;
  if (c.to === now) return `no change to ${r.label}`;
  if (r.kind === "choice") {
    if (r.choices!.includes(c.to)) return null;
    return r.choices!.join() === "allowed,blocked" ? `${r.label} must be allowed or blocked` : `${r.label} must be one of ${r.choices!.join(", ")}`;
  }
  if (r.kind === "optional_money" && c.to === "") return null;
  if (!MONEY.test(c.to)) return `${r.label}: bad format ${JSON.stringify(c.to)}; write an amount like 0.03`;
  const cents = toCents(c.to);
  if (r.min !== undefined && cents < r.min) return `${r.label} must be at least ${fromCents(r.min)}`;
  if (r.max !== undefined && cents > r.max) return `${r.label} must be at most ${fromCents(r.max)}`;
  return null;
}

/** The agent's policy limit per payment in cents, or null when only the mandate's cap applies. */
export function policyCapCents(db: DB, agent: Agent): number | null {
  const v = policyValue(db, `cap.${agent}`);
  return v === "" ? null : toCents(v);
}

/** Whether the CFO has pulled the emergency stop. */
export function frozen(db: DB): boolean {
  return policyValue(db, "freeze") === "on";
}

/** Why a payment of this size must not be signed, or null if the policy allows it. */
export function capRefusal(db: DB, agent: Agent, cents: number): string | null {
  if (frozen(db)) return `frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the ${agentName(agent)} signs nothing`;
  if (paused(db, agent)) return `paused_by_cfo: the CFO paused the ${agentName(agent)}; its Metal mandate is revoked and its card frozen, so it signs nothing`;
  if (stopped(db, agent)) return `stopped_by_velocity: the ${agentName(agent)} was stopped automatically (velocity limit); the CFO lifts it with Face ID`;
  const cap = policyCapCents(db, agent);
  return cap !== null && cents > cap ? `policy_cap_exceeded: ${fromCents(cents)} is over the ${agentName(agent)}'s limit of ${fromCents(cap)}` : null;
}

/** The limits the agent's card should have at Airwallex, from the policy. */
export function cardLimits(db: DB, agent: string): { currency: "EUR"; perTxCents: number; monthlyCents: number } {
  return cardLimitsFrom((key) => policyValue(db, key), agent);
}

export function refundThresholds(db: DB): { eachCents: number; perDisputeCents: number } {
  return { eachCents: toCents(policyValue(db, "approval.refund_each")), perDisputeCents: toCents(policyValue(db, "approval.refund_per_dispute")) };
}

export function counterpartyAllowed(db: DB, name: string): boolean {
  return policyValue(db, `counterparty:${name}`) !== "blocked";
}

/** Whether a change loosens the policy (src/policy/loosens.ts, shared with /try/sign's policy step). */
export { loosens } from "./loosens.js";
