import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";

export type SettingKey = "sell_price" | "upstream_price";

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
