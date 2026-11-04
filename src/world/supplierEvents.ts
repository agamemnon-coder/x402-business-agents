// Two supplier changes the world can make for Thursday's run (Max, 2 November), both opt-in; the default world is as before.
//
// A silent price rise (npm run world -- price-rise 0.04 --silent). Stockline raises its price without warning: the
// world serve loop applies the new price just before its next customer query, so the first purchase after it meets
// the new price in Stockline's own 402 offer. Stockline's notice (the same email as `price-rise`) follows that first
// purchase attempt there, or 5 minutes after the rise when no purchase reaches Stockline. The order is fixed by the
// one loop that runs the queries, not by timing: no notice is sent before the first attempt has been recorded.
//
// Ridgeline Data offline for maintenance (npm run world -- ridgeline-maintenance [hours|off]). Ridgeline's whole API
// answers 503 before any offer (nothing can be quoted, bought or charged) until the time it announced, and its notice
// tells the Sourcing agent so. (Ridgeline's data is 900 s old in every world, over the 300 s cache limit; unchanged.)
//
// Nothing here decides for an agent: the world only changes prices and availability and sends suppliers' notices.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publish } from "../autonomy/bus.js";
import type { DB } from "../db/open.js";
import { getSetting, setSetting } from "./settings.js";

const NOTICE = resolve(import.meta.dirname, "../../fixtures/stockline-price-notice.txt");
/** When no purchase reaches Stockline after a silent rise, its notice still comes this long after it. */
export const NOTICE_AT_LATEST_MS = 5 * 60_000;

/** Stockline's price notice to the Sourcing agent (the same event `price-rise` sends at once). Review, 2 November: the
 *  notice carries the real date it is sent, the moment the price changed and the price passed, never the fixture's
 *  30 October or a fixed 0.04, so a silent rise is not told to the agent as if it had been announced days ahead. */
export function noticeText(price: string, sentAt: Date, effectiveAt: Date): string {
  const when = `${effectiveAt.toISOString().slice(0, 10)}, ${effectiveAt.toISOString().slice(11, 16)} UTC`;
  return readFileSync(NOTICE, "utf8")
    .replace(/^Date: .*$/m, `Date: ${sentAt.toUTCString().replace("GMT", "+0000")}`)
    .replace(/From [^,]+, \d{2}:\d{2} UTC/, `From ${when}`)
    .replace(/costs [0-9.]+ \*USDZ instead/, `costs ${price} *USDZ instead`)
    .slice(0, 1500);
}
export function stocklineNotice(db: DB, price: string, now = new Date(), effectiveAt = now): number {
  return publish(db, "supplier.notice", { supplier: "Stockline", new_price: price, notice: noticeText(price, now, effectiveAt) }, "sourcing", "system", now);
}

/** A silent price rise as the ledger keeps it: waiting for the next query, applied, or its notice sent. */
export interface SilentRise {
  price: string;
  stage: "pending" | "applied" | "noticed";
  scheduled_at: string;
  /** Applied: the last purchase row before the new price, the time and the query it was applied before. */
  from_id?: number;
  applied_at?: string;
  seq?: number;
  /** Noticed: the first purchase attempt at Stockline after the rise (absent if the notice came by time), and the notice's event. */
  first_attempt_id?: number;
  notice_event?: number;
  notice_after?: "first_attempt" | "time";
}

export function silentRise(db: DB): SilentRise | null {
  const v = getSetting(db, "stockline_price_rise", "");
  try { return v ? (JSON.parse(v) as SilentRise) : null; } catch { return null; }
}

const save = (db: DB, r: SilentRise | null, now: Date) => setSetting(db, "system", "stockline_price_rise", r ? JSON.stringify(r) : "", now);

/** Schedules a silent rise; refused while another is under way (pending, or applied with its notice not yet sent). */
export function scheduleSilentRise(db: DB, price: string, now = new Date()): SilentRise {
  if (!/^\d+\.\d{2}$/.test(price)) throw new Error(`not a price: ${price}`);
  return db.transaction(() => {
    const r = silentRise(db);
    if (r && r.stage !== "noticed") throw new Error(`a silent price rise to ${r.price} is already under way (${r.stage})`);
    const next: SilentRise = { price, stage: "pending", scheduled_at: now.toISOString() };
    save(db, next, now);
    return next;
  }).immediate();
}

/** Withdraws a rise the world has not applied yet; false when it was applied in the meantime. */
export function cancelSilentRise(db: DB, now = new Date()): boolean {
  return db.transaction(() => {
    if (silentRise(db)?.stage !== "pending") return false;
    save(db, null, now);
    return true;
  }).immediate();
}

/** Before query `seq`: applies a pending rise (Stockline's price changes now, nothing is announced). */
export function applySilentRise(db: DB, seq: number, now = new Date()): SilentRise | null {
  return db.transaction(() => {
    const r = silentRise(db);
    if (r?.stage !== "pending") return null;
    const from = (db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM upstream_purchases").get() as { n: number }).n;
    setSetting(db, "system", "upstream_price", r.price, now);
    const next: SilentRise = { ...r, stage: "applied", from_id: from, applied_at: now.toISOString(), seq };
    save(db, next, now);
    return next;
  }).immediate();
}

/** After a query: sends Stockline's notice once a purchase attempt there met the new price, or once 5 minutes passed. */
export function noticeIfDue(db: DB, now = new Date()): SilentRise | null {
  return db.transaction(() => {
    const r = silentRise(db);
    if (r?.stage !== "applied") return null;
    const first = db.prepare("SELECT id FROM upstream_purchases WHERE id > ? AND supplier = 'stockline' ORDER BY id LIMIT 1").get(r.from_id ?? 0) as { id: number } | undefined;
    if (!first && now.getTime() - Date.parse(r.applied_at ?? r.scheduled_at) < NOTICE_AT_LATEST_MS) return null;
    const ev = stocklineNotice(db, r.price, now, new Date(r.applied_at ?? r.scheduled_at));
    const next: SilentRise = { ...r, stage: "noticed", notice_event: ev, notice_after: first ? "first_attempt" : "time", ...(first ? { first_attempt_id: first.id } : {}) };
    save(db, next, now);
    return next;
  }).immediate();
}

/**
 * One customer query of the world's serve loop, with the silent rise around it: applied before the query, the notice
 * checked after it (also when the query failed). `say` gets one line for each change.
 */
export async function worldQuery<T>(db: DB, seq: number, buy: () => Promise<T>, say: (line: string) => void = () => {}): Promise<T> {
  const rise = applySilentRise(db, seq);
  if (rise) say(`Stockline now asks ${rise.price} a stock check, from query #${seq}; no notice sent`);
  try {
    return await buy();
  } finally {
    const n = noticeIfDue(db);
    if (n) say(`Stockline's price notice reached the Sourcing agent, ${n.notice_after === "first_attempt" ? "after the first purchase attempt at the new price" : `${NOTICE_AT_LATEST_MS / 60_000} minutes after the rise (no purchase reached Stockline)`}`);
  }
}

const hhmm = (d: Date) => `${d.toISOString().slice(11, 16)} UTC`;

/** Ridgeline Data offline for maintenance until `until` (null: back now), with its notice to the Sourcing agent. */
export function ridgelineMaintenance(db: DB, until: Date | null, now = new Date()): number {
  setSetting(db, "system", "ridgeline_maintenance_until", until ? until.toISOString() : "", now);
  const text = until
    ? `Ridgeline Data: planned maintenance. Our stock-check API is offline from ${hhmm(now)} until ${hhmm(until)}${until.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? " today" : ` on ${until.toISOString().slice(0, 10)}`}. In that time it answers every request with 503 before any offer: no quotes, no stock checks, nothing charged.`
    : "Ridgeline Data: our maintenance is over. The stock-check API is online again at our usual terms.";
  return publish(db, "supplier.notice", { supplier: "Ridgeline Data", ...(until ? { offline_until: until.toISOString() } : { online: true }), text }, "sourcing", "system", now);
}

/** Why Ridgeline Data answers nothing now (its maintenance), or null when it is open. */
export function ridgelineDown(db: DB, now = new Date()): string | null {
  const until = getSetting(db, "ridgeline_maintenance_until", "");
  if (!until || !(Date.parse(until) > now.getTime())) return null;
  return `Ridgeline Data is offline for planned maintenance until ${hhmm(new Date(until))}; nothing was offered`;
}
