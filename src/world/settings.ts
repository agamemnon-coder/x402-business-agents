import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";

import { FX_QUOTE_MAX_MARKUP_BPS } from "../config/policy.js";
import type { PolicyKey } from "../policy/rules.js";

export type SettingKey = "sell_price" | "upstream_price" | "ridgeline_price" | "stockline_price_rise" | "ridgeline_maintenance_until" | "sourcing.buy_policy" | "usd_floor" | "eur_floor" | "eur_obligations" | "payout.funding_currency" | "fx.max_markup_bps" | PlatformSettingKey | `floor.${string}` | `fee_reserve.${"LOCAL" | "SWIFT"}.${string}` | WorldOptionKey | PolicyKey;

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

export function setSetting(db: DB, actor: Actor, key: SettingKey, value: string, now = new Date()): void {
  db.transaction(() => {
    const before = getSetting(db, key, "");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, value, now.toISOString());
    audit(db, actor, "setting.changed", key, { before: before || null, after: value }, now);
  }).immediate();
}
