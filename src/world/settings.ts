import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { aloneLimitInForce } from "../policy/aloneLimit.js";

import { WINDOW_MAX_DAYS, WINDOW_MIN_DAYS } from "../config/checkNumbers.js";
import { FX_QUOTE_MAX_MARKUP_BPS } from "../config/policy.js";
import type { PolicyKey } from "../policy/rules.js";

export type SettingKey = "sell_price" | "upstream_price" | "ridgeline_price" | "stockline_price_rise" | "ridgeline_maintenance_until" | "sourcing.buy_policy" | "usd_floor" | "eur_floor" | "eur_obligations" | "payout.funding_currency" | "fx.max_markup_bps" | "ap.alone_eur" | "ap.split_days" | "ap.twin_days" | "ap.near_twin_days" | PlatformSettingKey | `floor.${string}` | `fee_reserve.${"LOCAL" | "SWIFT"}.${string}` | WorldOptionKey | PolicyKey;

/** A world's own options, set once on a fresh world (npm run world -- setup), read by code; no agent tool writes them. */
/** Purser as an Airwallex platform (docs/airwallex-platform.md). */
/** The binding Purser Cloud signed (src/airwallex/binding.ts); the fee itself is CFO policy (platform.fee_bps). */
export type PlatformSettingKey = "platform.binding";
export type WorldOptionKey = "world.upstream_cache" | "world.free_eur_target" | "world.tap_rail" | "world.let_one_through";

export function getSetting(db: DB, key: SettingKey, fallback: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

/**
 * How far (basis points) a locked FX quote may cost above the market's current rate before it escalates: the company's
 * own setting fx.max_markup_bps when one is set (a whole number from 1 to 1,000), else FX_QUOTE_MAX_MARKUP_BPS.
 */
export function fxMarkupLimitBps(db: DB): number {
  const v = Number(getSetting(db, "fx.max_markup_bps", ""));
  return Number.isInteger(v) && v >= 1 && v <= 1000 ? v : FX_QUOTE_MAX_MARKUP_BPS;
}

/**
 * The CFO's limit an agent may pay a supplier invoice alone up to (a plain amount in EUR above zero), only while it is in
 * force (src/policy/aloneLimit.ts, security review of 20 November): set by a policy change the CFO signed with the
 * passkey, or a /try test company's default, labelled as one (TRY_ALONE_LIMIT). A setting written any other way counts
 * for nothing: then there is none, and the CFO signs every invoice. No agent tool writes it.
 */
export function aloneLimit(db: DB): { currency: "EUR"; amount: string } | null {
  const r = aloneLimitInForce(db);
  return r ? { currency: "EUR", amount: r.amount } : null;
}

/**
 * The company's own windows for the payables duplicate and split checks (19 Nov, second round): the settings
 * ap.split_days, ap.twin_days and ap.near_twin_days where set to a whole number of days in range
 * (src/config/checkNumbers.ts WINDOW_MIN_DAYS to WINDOW_MAX_DAYS); a window not set, or out of range, is left out and the
 * check's default stands (src/ap/checkerCore.ts windowsOf).
 */
export function checkWindows(db: DB): { splitDays?: number; twinDays?: number; nearTwinDays?: number } {
  const days = (key: SettingKey) => {
    const v = getSetting(db, key, "");
    return /^\d{1,3}$/.test(v) && Number(v) >= WINDOW_MIN_DAYS && Number(v) <= WINDOW_MAX_DAYS ? Number(v) : undefined;
  };
  const out: { splitDays?: number; twinDays?: number; nearTwinDays?: number } = {};
  const split = days("ap.split_days"), twin = days("ap.twin_days"), near = days("ap.near_twin_days");
  if (split !== undefined) out.splitDays = split;
  if (twin !== undefined) out.twinDays = twin;
  if (near !== undefined) out.nearTwinDays = near;
  return out;
}

export function setSetting(db: DB, actor: Actor, key: SettingKey, value: string, now = new Date()): void {
  db.transaction(() => {
    const before = getSetting(db, key, "");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, value, now.toISOString());
    audit(db, actor, "setting.changed", key, { before: before || null, after: value }, now);
  }).immediate();
}
