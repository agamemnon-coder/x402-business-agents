// Ask Purser's limits and costs, on the hands-on deployment's own tables and switches (cloud/src/try/switches.ts), the
// same pattern as /try's Claude caps (cloud/src/engine/spend.ts):
//   - per address: ASK_PER_MINUTE a minute (fixed) and ask_per_address_hour an hour (a switch with a default), on the
//     address keyed with the day's salt (cloud/src/try/start.ts addressKey): no address is stored;
//   - for everyone: ask_per_day questions a UTC day (a switch with a default);
//   - Claude: only while both switches `claude` (the demo's kill switch) and `ask` are on, and each live answer first
//     reserves its worst case under three caps, in micro-dollars: cap_day_micros_ask (the chat's day), cap_ask_addr_micros
//     (one address's day) and cap_all_micros (the demo key's all time, shared with /try), with the actions in flight
//     counted against max_inflight. A missing cap is 0: nothing is spent until the owner sets it. Settled at its real cost.
// What is kept: hourly counts by kind (ask_tally), nothing else. No question, answer or address is stored or logged.
import { bump, withinRate } from "../auth.js";
import { expireStale } from "../engine/spend.js";
import { addressKey, addressPrefix48 } from "../try/start.js";
import { num, on, readSwitches, type Switches } from "../try/switches.js";
import type { Sql } from "../store.js";

export const ASK_PER_MINUTE = 6;
/** The most one live answer may cost (micro-USD at list price): Haiku, about 6,000 tokens in and ASK_MAX_TOKENS out is under 1,000. */
export const ASK_ACTION_MICROS = 2_500;
/** The tenant id an answer's reservation is held under in try_resv (no company is involved). */
export const ASK_RESV = "ask";

export type LimitRefusal = { limited: true; message: string };

/** The address limits: a minute and an hour per keyed address (an IPv6 /48 counts its /64s together, at five times). */
export async function askRate(sql: Sql, ip: string, s: Switches, now: Date): Promise<LimitRefusal | null> {
  const key = await addressKey(sql, ip, now);
  if (!(await withinRate(sql, `ask-min:${key}`, now, { windowSec: 60, max: ASK_PER_MINUTE }))) return { limited: true, message: "That's a lot of questions in a minute. Wait a minute and ask again." };
  const hourMax = num(s, "ask_per_address_hour");
  if (!(await withinRate(sql, `ask-hour:${key}`, now, { windowSec: 3600, max: hourMax }))) return { limited: true, message: "You've reached this hour's questions. Come back in an hour, or read the docs linked here." };
  const wide = addressPrefix48(ip);
  if (wide && !(await withinRate(sql, `ask-hour48:${await addressKey(sql, wide, now)}`, now, { windowSec: 3600, max: hourMax * 5 }))) return { limited: true, message: "You've reached this hour's questions. Come back in an hour, or read the docs linked here." };
  return null;
}

/** The day's questions for everyone, counted; over the switch's number the answer comes from the docs alone. */
export async function askDayOpen(sql: Sql, s: Switches, now: Date): Promise<boolean> {
  const day = Math.floor(now.getTime() / 86_400_000) * 86_400;
  return (await bump(sql, "ask-day", day, 1)) <= num(s, "ask_per_day");
}

/** The switches, or none when the table cannot be read (fail closed: no Claude, the default limits). */
export const askSwitches = async (sql: Sql): Promise<Switches> => { try { return await readSwitches(sql); } catch { return {}; } };

export interface AskReservation { micros: number; settle(actual: number): Promise<void> }
export type Reserved = { ok: true; reservation: AskReservation } | { ok: false; reason: "switch_off" | "budget" | "busy" };

/** One live answer's worst case reserved under the chat's day, the address's day and all time, in one batch. */
export async function reserveAnswer(sql: Sql, s: Switches, ip: string, now: Date): Promise<Reserved> {
  if (!on(s, "claude") || !on(s, "ask")) return { ok: false, reason: "switch_off" };
  const day = now.toISOString().slice(0, 10);
  const addr = await addressKey(sql, ip, now);
  const caps = [
    { scope: `ask:day:${day}`, cap: num(s, "cap_day_micros_ask") },
    { scope: `ask:addr:${addr}:${day}`, cap: num(s, "cap_ask_addr_micros") },
    { scope: "all", cap: num(s, "cap_all_micros") },
  ];
  if (caps.some((c) => c.cap <= 0)) return { ok: false, reason: "budget" };
  await expireStale(sql, now);
  const micros = ASK_ACTION_MICROS;
  const id = crypto.randomUUID();
  await sql.batch([
    {
      sql: `INSERT INTO try_resv (id, tenant_id, micros, started_at, state) SELECT ?, ?, ?, ?, 'open'
            WHERE (SELECT COUNT(*) FROM try_resv WHERE state = 'open') < ?
            ${caps.map(() => "AND COALESCE((SELECT micros FROM try_spend WHERE scope = ?), 0) + ? <= ?").join(" ")}`,
      params: [id, ASK_RESV, micros, now.toISOString(), num(s, "max_inflight"), ...caps.flatMap((c) => [c.scope, micros, c.cap])],
    },
    ...caps.map((c) => ({
      sql: "INSERT INTO try_spend (scope, micros) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM try_resv WHERE id = ?) ON CONFLICT(scope) DO UPDATE SET micros = micros + excluded.micros",
      params: [c.scope, micros, id],
    })),
  ]);
  if (!(await sql.first("SELECT 1 AS ok FROM try_resv WHERE id = ?", [id]))) {
    const open = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_resv WHERE state = 'open'"))?.n ?? 0;
    return { ok: false, reason: open >= num(s, "max_inflight") ? "busy" : "budget" };
  }
  return {
    ok: true,
    reservation: {
      micros,
      async settle(actual: number) {
        const used = Math.min(micros, Math.max(0, Math.ceil(actual)));
        await sql.batch([
          ...caps.map((c) => ({ sql: "UPDATE try_spend SET micros = micros - ? WHERE scope = ? AND EXISTS (SELECT 1 FROM try_resv WHERE id = ? AND state = 'open')", params: [micros - used, c.scope, id] })),
          { sql: "UPDATE try_resv SET state = 'settled', micros = ? WHERE id = ? AND state = 'open'", params: [used, id] },
        ]);
      },
    },
  };
}

// ---- Counts only ----

export const ASK_TALLY_SCHEMA = "CREATE TABLE IF NOT EXISTS ask_tally (hour TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (hour, kind))";
/** asked: a question reached the route. live: Claude answered. docs: the docs answered (Claude off, capped, failing).
 *  refused_money, refused_data, refused_injection: code answered. limited: an address limit. trimmed: a sentence was
 *  left out by the checks. stopped: an answer was stopped whole. */
export const ASK_KINDS = ["asked", "live", "docs", "refused_money", "refused_data", "refused_injection", "limited", "trimmed", "stopped"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

const ready = new WeakMap<Sql, Promise<void>>();
/** Adds to a kind for the hour (UTC). Never throws: a count must not fail a visitor's question. */
export async function askTally(sql: Sql, kind: AskKind, now: Date, n = 1): Promise<void> {
  try {
    let p = ready.get(sql);
    if (!p) { p = sql.run(ASK_TALLY_SCHEMA).then(() => undefined); ready.set(sql, p); }
    await p;
    await sql.run("INSERT INTO ask_tally (hour, kind, n) VALUES (?, ?, ?) ON CONFLICT(hour, kind) DO UPDATE SET n = n + excluded.n", [now.toISOString().slice(0, 13), kind, n]);
  } catch { ready.delete(sql); }
}

/** The counts since an hour (YYYY-MM-DDTHH), by kind. */
export async function askCounts(sql: Sql, sinceHour: string): Promise<Record<AskKind, number>> {
  const out = Object.fromEntries(ASK_KINDS.map((k) => [k, 0])) as Record<AskKind, number>;
  try {
    for (const r of await sql.all<{ kind: AskKind; n: number }>("SELECT kind, SUM(n) AS n FROM ask_tally WHERE hour >= ? GROUP BY kind", [sinceHour])) if (r.kind in out) out[r.kind] = r.n;
  } catch { /* no table yet: zeros */ }
  return out;
}
