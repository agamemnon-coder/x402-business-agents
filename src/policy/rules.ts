// The CFO policy (tier 2 item 6): limits in code that sit inside the on-chain mandates and are checked before
// anything is signed. The mandates stay the hard outer wall; the policy can only be stricter. Values live in the
// settings table and change only through an approved policy_change proposal (src/executors/policyChange.ts).

import { AGENTS, CARDS, REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS, type Agent } from "../config/policy.js";
import { agentName } from "../config/brand.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { stopped } from "./velocity.js";

export type PolicyKey = "freeze" | `stop.${string}` | "approval.four_eyes_eur" | `cap.${Agent}` | `card.${string}.per_tx` | `card.${string}.monthly` | "eur_floor" | "usd_floor" | "approval.refund_each" | "approval.refund_per_dispute" | `counterparty:${string}`;

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
  { key: "cap.sourcing", label: "Operations agent: most per payment", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "" },
  { key: "cap.support", label: "Sales agent: most per refund", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "" },
  { key: "cap.treasury", label: "Finance agent: most per sweep", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "" },
  { key: "approval.refund_each", label: "A refund above this needs a person", unit: "USDZ", kind: "money", min: 0, max: 2000, fallback: fromCents(REFUND_AUTO_EACH_CENTS) },
  { key: "approval.refund_per_dispute", label: "Refunds per dispute above this need a person", unit: "USDZ", kind: "money", min: 0, max: 2000, fallback: fromCents(REFUND_AUTO_PER_DISPUTE_CENTS) },
  // E1, four eyes: above this a payment needs the Face ID of two different people (src/policy/fourEyes.ts). Off when empty.
  { key: "approval.four_eyes_eur", label: "Payments above this need two people (four eyes)", unit: "EUR", kind: "optional_money", min: 0, max: MAX_FLOOR, fallback: "" },
  { key: "eur_floor", label: "EUR reserve floor", unit: "EUR", kind: "money", min: 0, max: MAX_FLOOR, fallback: "" },
  { key: "usd_floor", label: "USD reserve floor", unit: "USD", kind: "money", min: 0, max: MAX_FLOOR, fallback: "" },
  // Each agent's company card at Airwallex (K2). The card itself is synced to these, so Airwallex declines the rest.
  ...AGENTS.flatMap((a): Rule[] => [
    // Set to on by code when the agent breaks a velocity limit (src/policy/velocity.ts); off again only with Face ID.
    { key: `stop.${a}`, label: `${agentName(a)}: stopped (velocity limit)`, unit: "", kind: "choice", choices: ["off", "on"], fallback: "off" },
    { key: `card.${a}.per_tx`, label: `${agentName(a)}'s card: most per purchase`, unit: "EUR", kind: "money", min: 100, max: 100_000, fallback: fromCents(CARDS[a].perTxCents) },
    { key: `card.${a}.monthly`, label: `${agentName(a)}'s card: most per month`, unit: "EUR", kind: "money", min: 100, max: 500_000, fallback: fromCents(CARDS[a].monthlyCents) },
  ]),
];

/** Every rule, the allowed counterparties (Airwallex beneficiaries) and outside agents' cards (P1) included. */
export function rules(db: DB): Rule[] {
  // An outside agent's card, once the CFO approved it: the same limits as our own agents', starting from what was approved.
  const outside = (db.prepare("SELECT agent_id, display_name, per_tx_cents, monthly_cents FROM external_agents WHERE status = 'ACTIVE' ORDER BY agent_id").all() as
    { agent_id: string; display_name: string; per_tx_cents: number; monthly_cents: number }[]).flatMap((x): Rule[] => [
    { key: `stop.${x.agent_id}`, label: `${x.display_name} (outside agent): stopped (velocity limit)`, unit: "", kind: "choice", choices: ["off", "on"], fallback: "off" },
    { key: `card.${x.agent_id}.per_tx`, label: `${x.display_name} (outside agent)'s card: most per purchase`, unit: "EUR", kind: "money", min: 100, max: 100_000, fallback: fromCents(x.per_tx_cents) },
    { key: `card.${x.agent_id}.monthly`, label: `${x.display_name} (outside agent)'s card: most per month`, unit: "EUR", kind: "money", min: 100, max: 500_000, fallback: fromCents(x.monthly_cents) },
  ]);
  const payees = (db.prepare("SELECT DISTINCT name FROM beneficiaries ORDER BY name").all() as { name: string }[]).map((b): Rule => ({
    key: `counterparty:${b.name}`, label: `${b.name} (Airwallex payee)`, unit: "", kind: "choice", choices: ["allowed", "blocked"], fallback: "allowed",
  }));
  return [...STATIC, ...outside, ...payees];
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
  if (r.kind === "choice") return r.choices!.includes(c.to) ? null : `${r.label} must be allowed or blocked`;
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
  if (frozen(db)) return `frozen_by_cfo: the CFO stopped every agent payment (emergency stop); the ${agent} agent signs nothing`;
  if (stopped(db, agent)) return `stopped_by_velocity: the ${agent} agent was stopped automatically (velocity limit); the CFO lifts it with Face ID`;
  const cap = policyCapCents(db, agent);
  return cap !== null && cents > cap ? `policy_cap_exceeded: ${fromCents(cents)} is over the ${agent} limit of ${fromCents(cap)}` : null;
}

/** The limits the agent's card should have at Airwallex, from the policy. */
export function cardLimits(db: DB, agent: string): { currency: "EUR"; perTxCents: number; monthlyCents: number } {
  return { currency: "EUR", perTxCents: toCents(policyValue(db, `card.${agent}.per_tx`)), monthlyCents: toCents(policyValue(db, `card.${agent}.monthly`)) };
}

export function refundThresholds(db: DB): { eachCents: number; perDisputeCents: number } {
  return { eachCents: toCents(policyValue(db, "approval.refund_each")), perDisputeCents: toCents(policyValue(db, "approval.refund_per_dispute")) };
}

export function counterpartyAllowed(db: DB, name: string): boolean {
  return policyValue(db, `counterparty:${name}`) !== "blocked";
}

/**
 * Whether a change makes the policy less strict: a higher or removed agent limit, a higher approval threshold, a
 * lower reserve floor, or a payee unblocked. The phone may only tighten (review N2); loosening is proposed on the
 * runner (npm run policy -- set) and then approved with Face ID like any proposal.
 */
export function loosens(c: { key: string; from: string; to: string }): boolean {
  const cents = (v: string) => (/^\d+\.\d{2}$/.test(v) ? Number(v.replace(".", "")) : null);
  const [from, to] = [cents(c.from), cents(c.to)];
  if (c.key.startsWith("cap.")) return from !== null && (to === null || to > from);
  if (c.key.startsWith("card.")) return from !== null && (to === null || to > from);
  // Four eyes: turning it off or raising the threshold loosens; turning it on or lowering it tightens.
  if (c.key === "approval.four_eyes_eur") return from !== null && (to === null || to > from);
  if (c.key.startsWith("approval.")) return from !== null && to !== null && to > from;
  if (c.key.endsWith("_floor")) return from !== null && (to === null || to < from);
  if (c.key.startsWith("counterparty:")) return c.from === "blocked" && c.to === "allowed";
  if (c.key === "freeze" || c.key.startsWith("stop.")) return c.from === "on" && c.to !== "on";
  return true;
}
