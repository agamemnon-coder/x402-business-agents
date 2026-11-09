import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";

import type { PolicyKey } from "../policy/rules.js";

export type SettingKey = "sell_price" | "upstream_price" | "ridgeline_price" | "stockline_price_rise" | "ridgeline_maintenance_until" | "sourcing.buy_policy" | "usd_floor" | "eur_floor" | "eur_obligations" | "payout.funding_currency" | PlatformSettingKey | `floor.${string}` | `fee_reserve.${"LOCAL" | "SWIFT"}.${string}` | WorldOptionKey | PolicyKey;

/** A world's own options, set once on a fresh world (npm run world -- setup), read by code; no agent tool writes them. */
/** Purser as an Airwallex platform (docs/airwallex-platform.md). */
export type PlatformSettingKey = "platform.paying_account" | "platform.paying_account_name" | "platform.fee_bps" | "platform.fee_account";
export type WorldOptionKey = "world.upstream_cache" | "world.free_eur_target" | "world.tap_rail" | "world.let_one_through";

export function getSetting(db: DB, key: SettingKey, fallback: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(db: DB, actor: Actor, key: SettingKey, value: string, now = new Date()): void {
  db.transaction(() => {
    const before = getSetting(db, key, "");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, value, now.toISOString());
    audit(db, actor, "setting.changed", key, { before: before || null, after: value }, now);
  }).immediate();
}
