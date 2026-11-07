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

/** The policy rules this rail adds (the shape of src/policy/rules.ts's Rule; no import, to keep this module a leaf). */
export function airiRuleDefs(): { key: string; label: string; unit: "EUR" | ""; kind: "money" | "choice"; min?: number; max?: number; choices?: string[]; fallback: string; agent?: string }[] {
  return [
    { key: ALONE_KEY, label: "Airi purchases up to this run without Face ID", unit: "EUR", kind: "money", min: 0, max: AIRI_HARD_CAP_CENTS, fallback: "20.00", agent: "sourcing" },
    { key: PER_DAY_KEY, label: "Airi purchases without Face ID, most per day", unit: "", kind: "choice", choices: [...PER_DAY_CHOICES], fallback: "3", agent: "sourcing" },
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

export function airiPolicy(db: DB): AiriPolicy {
  const value = (key: string, fallback: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? fallback;
  const defs = airiRuleDefs();
  const fb = (key: string) => defs.find((d) => d.key === key)!.fallback;
  const perDay = Number(value(PER_DAY_KEY, fb(PER_DAY_KEY)));
  return {
    aloneMaxCents: toCents(value(ALONE_KEY, fb(ALONE_KEY))),
    alonePerDay: Number.isInteger(perDay) && perDay >= 0 ? perDay : 0,
    hardCapCents: AIRI_HARD_CAP_CENTS,
    currencies: [AIRI_CURRENCY],
    merchants: AIRI_MERCHANTS.filter((m) => value(`${MERCHANT_KEY_PREFIX}${m.id}`, "blocked") === "allowed").map((m) => new URL(m.url).origin),
  };
}
