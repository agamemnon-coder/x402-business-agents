// The CFO policy (tier 2 item 6): limits in code that sit inside the on-chain mandates and are checked before
// anything is signed. The mandates stay the hard outer wall; the policy can only be stricter. Values live in the
// settings table and change only through an approved policy_change proposal (src/executors/policyChange.ts).

import { REFUND_AUTO_EACH_CENTS, REFUND_AUTO_PER_DISPUTE_CENTS, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";

export type PolicyKey = `cap.${Agent}` | "eur_floor" | "usd_floor" | "approval.refund_each" | "approval.refund_per_dispute" | `counterparty:${string}`;

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
  { key: "cap.sourcing", label: "Sourcing agent: most per payment", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "" },
  { key: "cap.support", label: "Support agent: most per refund", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "" },
  { key: "cap.treasury", label: "Treasury agent: most per sweep", unit: "USDZ", kind: "optional_money", min: 1, max: 2000, fallback: "" },
  { key: "approval.refund_each", label: "A refund above this needs a person", unit: "USDZ", kind: "money", min: 0, max: 2000, fallback: fromCents(REFUND_AUTO_EACH_CENTS) },
  { key: "approval.refund_per_dispute", label: "Refunds per dispute above this need a person", unit: "USDZ", kind: "money", min: 0, max: 2000, fallback: fromCents(REFUND_AUTO_PER_DISPUTE_CENTS) },
  { key: "eur_floor", label: "EUR reserve floor", unit: "EUR", kind: "money", min: 0, max: MAX_FLOOR, fallback: "" },
  { key: "usd_floor", label: "USD reserve floor", unit: "USD", kind: "money", min: 0, max: MAX_FLOOR, fallback: "" },
];

/** Every rule, the allowed counterparties (Airwallex beneficiaries) included. */
export function rules(db: DB): Rule[] {
  const payees = (db.prepare("SELECT name FROM beneficiaries ORDER BY name").all() as { name: string }[]).map((b): Rule => ({
    key: `counterparty:${b.name}`, label: `${b.name} (Airwallex payee)`, unit: "", kind: "choice", choices: ["allowed", "blocked"], fallback: "allowed",
  }));
  return [...STATIC, ...payees];
}

export function policyValue(db: DB, key: string): string {
  const rule = rules(db).find((r) => r.key === key);
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? rule?.fallback ?? "";
}

function display(r: Rule, value: string): string {
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

/** Why a payment of this size must not be signed, or null if the policy allows it. */
export function capRefusal(db: DB, agent: Agent, cents: number): string | null {
  const cap = policyCapCents(db, agent);
  return cap !== null && cents > cap ? `policy_cap_exceeded: ${fromCents(cents)} is over the ${agent} limit of ${fromCents(cap)}` : null;
}

export function refundThresholds(db: DB): { eachCents: number; perDisputeCents: number } {
  return { eachCents: toCents(policyValue(db, "approval.refund_each")), perDisputeCents: toCents(policyValue(db, "approval.refund_per_dispute")) };
}

export function counterpartyAllowed(db: DB, name: string): boolean {
  return policyValue(db, `counterparty:${name}`) !== "blocked";
}
