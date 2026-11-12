// The Airi rail's switch, its merchants and its CFO policy keys (docs/plans/vic-airi.md, step 1).
//
// Off unless KIT11_AIRI_RAIL=on: then the CFO policy gains three kinds of setting, changed only through an approved
// policy_change like every other limit:
//   approval.airi_alone            an Airi purchase up to this amount (EUR) runs without the CFO;
//   approval.airi_alone_per_day    at most this many of those a day (UTC); the next one asks the CFO;
//   airi.merchant.<id>             a merchant of the registry below is allowed or blocked (blocked until the CFO allows it).
// Above AIRI_HARD_CAP_CENTS a purchase is refused even with Face ID. A merchant outside the registry is always refused.

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function airiRailOn(env: Env = process.env): boolean {
  return env.KIT11_AIRI_RAIL === "on";
}

/** The rail's currency: the mandate's, the checkout's and the policy's. */
export const AIRI_CURRENCY = "EUR";
/** Refused above this even with Face ID. */
export const AIRI_HARD_CAP_CENTS = 200_00;
export const ALONE_KEY = "approval.airi_alone";
export const PER_DAY_KEY = "approval.airi_alone_per_day";
export const MERCHANT_KEY_PREFIX = "airi.merchant.";
export const PER_DAY_CHOICES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

export interface AiriMerchant {
  id: string;
  name: string;
  /** https origin plus path, as the mandate names it. */
  url: string;
  country: string;
  /** Which checkout adapter pays it. */
  checkout: "airwallex-sandbox";
}

/**
 * The merchants this rail knows. One: Northwind's own test shop, whose checkout is a PaymentIntent on our Airwallex
 * sandbox account (src/airi/checkout.ts); its URL is our public site. Nothing here is a real merchant.
 */
export const AIRI_MERCHANTS: readonly AiriMerchant[] = [
  { id: "northwind-sandbox", name: "Northwind Outdoor test shop (Airwallex sandbox)", url: "https://kit11.max-31b.workers.dev/", country: "NL", checkout: "airwallex-sandbox" },
];

export function merchantById(id: string): AiriMerchant | undefined {
  return AIRI_MERCHANTS.find((m) => m.id === id);
}

/**
 * The agents that may buy on this rail, each with its own limit in the CFO policy (Visa #4b, 12 November): the Sourcing
 * agent keeps the first keys (approval.airi_alone, approval.airi_alone_per_day); every other agent has its own keys with
 * its name after them, and its own count of purchases without Face ID per day. One agent's purchases never use up
 * another's room. A key changes only through an approved policy_change, like every limit.
 */
export const AIRI_AGENTS = ["sourcing", "support"] as const;
export type AiriAgent = (typeof AIRI_AGENTS)[number];
const DEFAULTS: Record<AiriAgent, { alone: string; perDay: string }> = { sourcing: { alone: "20.00", perDay: "3" }, support: { alone: "10.00", perDay: "2" } };
const isAiriAgent = (a: string): a is AiriAgent => (AIRI_AGENTS as readonly string[]).includes(a);
/** The policy key of an agent's limit alone, and of its count per day. */
export const aloneKeyOf = (agent: AiriAgent) => (agent === "sourcing" ? ALONE_KEY : `${ALONE_KEY}.${agent}`);
export const perDayKeyOf = (agent: AiriAgent) => (agent === "sourcing" ? PER_DAY_KEY : `${PER_DAY_KEY}.${agent}`);

/** The policy rules this rail adds (the shape of src/policy/rules.ts's Rule; no import, to keep this module a leaf). */
export function airiRuleDefs(): { key: string; label: string; unit: "EUR" | ""; kind: "money" | "choice"; min?: number; max?: number; choices?: string[]; fallback: string; agent?: string }[] {
  return [
    ...AIRI_AGENTS.flatMap((agent) => {
      const who = agent === "sourcing" ? "" : ` (${agent} agent)`;
      return [
        { key: aloneKeyOf(agent), label: `Airi purchases up to this run without Face ID${who}`, unit: "EUR" as const, kind: "money" as const, min: 0, max: AIRI_HARD_CAP_CENTS, fallback: DEFAULTS[agent].alone, agent },
        { key: perDayKeyOf(agent), label: `Airi purchases without Face ID, most per day${who}`, unit: "" as const, kind: "choice" as const, choices: [...PER_DAY_CHOICES], fallback: DEFAULTS[agent].perDay, agent },
      ];
    }),
    ...AIRI_MERCHANTS.map((m) => ({ key: `${MERCHANT_KEY_PREFIX}${m.id}`, label: `${m.name}: Airi purchases`, unit: "" as const, kind: "choice" as const, choices: ["allowed", "blocked"], fallback: "blocked" })),
  ];
}

/** The rail's policy now, read from the settings table (with the fallbacks above). */
export interface AiriPolicy {
  aloneMaxCents: number;
  alonePerDay: number;
  hardCapCents: number;
  currencies: readonly string[];
  /** Allowed merchants as https origins. */
  merchants: readonly string[];
}

/**
 * The rail's policy for one agent (the Sourcing agent's when none is named). An agent the rail does not list may buy
 * nothing alone: its limit is 0, so every purchase of its asks the CFO.
 */
export function airiPolicy(db: DB, agent: string = "sourcing"): AiriPolicy {
  const value = (key: string, fallback: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? fallback;
  const defs = airiRuleDefs();
  const fb = (key: string) => defs.find((d) => d.key === key)!.fallback;
  const listed = isAiriAgent(agent);
  const perDay = listed ? Number(value(perDayKeyOf(agent), fb(perDayKeyOf(agent)))) : 0;
  return {
    aloneMaxCents: listed ? toCents(value(aloneKeyOf(agent), fb(aloneKeyOf(agent)))) : 0,
    alonePerDay: Number.isInteger(perDay) && perDay >= 0 ? perDay : 0,
    hardCapCents: AIRI_HARD_CAP_CENTS,
    currencies: [AIRI_CURRENCY],
    merchants: AIRI_MERCHANTS.filter((m) => value(`${MERCHANT_KEY_PREFIX}${m.id}`, "blocked") === "allowed").map((m) => new URL(m.url).origin),
  };
}
