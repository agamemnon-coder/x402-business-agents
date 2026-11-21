// Ask Purser's limits and costs, on the hands-on deployment's own tables and switches (cloud/src/try/switches.ts), the
// same pattern as /try's Claude caps (cloud/src/engine/spend.ts):
//   - per address: ASK_PER_MINUTE a minute (fixed) and ask_per_address_hour an hour (a switch with a default), on the
//     address keyed with the day's salt (cloud/src/try/start.ts addressKey): no address is stored;
//   - for everyone: ask_per_day questions a UTC day (a switch with a default);
//   - Claude: only while both switches `claude` (the demo's kill switch) and `ask` are on, and each live answer first
//     reserves its worst case (every round of the agent at its longest prompt and its full output, ./model.ts) under
//     three caps, in micro-dollars: cap_day_micros_ask (the chat's day), cap_ask_addr_micros (one address's day) and
//     cap_all_micros (the demo key's all time, shared with /try), with the actions in flight counted against
//     max_inflight. A missing cap is 0: nothing is spent until the owner sets it. Settled at its real cost.
// What is kept: hourly counts by kind (ask_tally), nothing else. No question, answer or address is stored or logged.
import { bump, withinRate } from "../auth.js";
import { expireStale } from "../engine/spend.js";
import { addressKey, addressPrefix48 } from "../try/start.js";
import { num, on, readSwitches, type Switches } from "../try/switches.js";
import type { Sql } from "../store.js";
import { HISTORY_TURN_MAX, HISTORY_TURNS, QUESTION_MAX, SYSTEM, TOP_K } from "./core.js";
import { ASK_LONG_PROMPT, ASK_MAX_ROUNDS, ASK_MAX_ROUNDS_FILE, ASK_MAX_TOKENS, askCostMicros } from "./model.js";
import { ASK_TOOLS, TOOL_RESULT_MAX, TOOLS_PER_QUESTION } from "./tools.js";

export const ASK_PER_MINUTE = 6;
/** A file's share of the prompt at most, in tokens (counted by the API before the question is asked). */
export const ASK_FILE_TOKENS_MAX = 40_000;
/**
 * The longest prompt a round can have without a file, in tokens, counted generously (3 characters a token): the rules,
 * the tools, the conversation's turns, the passages, the question, every tool result a question may read, and what
 * Claude wrote in the rounds before.
 */
export const ASK_PROMPT_MAX_TOKENS = Math.ceil((SYSTEM.length + JSON.stringify(ASK_TOOLS).length + HISTORY_TURNS * HISTORY_TURN_MAX + TOP_K * 1_300 + QUESTION_MAX + TOOLS_PER_QUESTION * (TOOL_RESULT_MAX + 200)) / 3) + ASK_MAX_ROUNDS * ASK_MAX_TOKENS;
/** One round's worst case: its whole prompt written to the cache (the dearest input) and its full output. */
export const roundWorstMicros = (promptTokens: number) => askCostMicros({ input: 0, cache_read: 0, cache_write: promptTokens, output: ASK_MAX_TOKENS });
/** A question's worst case: every round at its longest. `fileTokens`: a file's tokens on top. */
export const questionWorstMicros = (fileTokens = 0) => (fileTokens ? ASK_MAX_ROUNDS_FILE : ASK_MAX_ROUNDS) * roundWorstMicros(ASK_PROMPT_MAX_TOKENS + fileTokens);
/** The most one live answer without a file may cost (micro-USD at list price), reserved before it starts. */
export const ASK_ACTION_MICROS = questionWorstMicros(0);
// Every prompt stays under the price step for long prompts, so the worst case above holds.
if (ASK_PROMPT_MAX_TOKENS + ASK_FILE_TOKENS_MAX >= ASK_LONG_PROMPT) throw new Error("Ask Purser's prompt could pass the long-prompt price");
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

/** Whether Claude answers on this deployment now: its model is set and the switches claude and ask are on (caps aside). */
export async function askLive(env: { sql: Sql; askModel?: unknown }): Promise<boolean> {
  if (!env.askModel) return false;
  const s = await askSwitches(env.sql);
  return on(s, "claude") && on(s, "ask");
}

/** The switches, or none when the table cannot be read (fail closed: no Claude, the default limits). */
export const askSwitches = async (sql: Sql): Promise<Switches> => { try { return await readSwitches(sql); } catch { return {}; } };

export interface AskReservation { micros: number; settle(actual: number): Promise<void> }
export type Reserved = { ok: true; reservation: AskReservation } | { ok: false; reason: "switch_off" | "budget" | "busy" };

/** One live answer's worst case (`micros`) reserved under the chat's day, the address's day and all time, in one batch. */
export async function reserveAnswer(sql: Sql, s: Switches, ip: string, now: Date, micros = ASK_ACTION_MICROS): Promise<Reserved> {
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
      // Settled at what it cost, even past the reservation (the route stops a question before that can happen).
      async settle(actual: number) {
        const used = Math.max(0, Math.ceil(actual));
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
 *  refused_money, refused_data (before 21 Nov), refused_injection: code answered. limited: an address limit. trimmed: a
 *  sentence was left out by the checks. stopped: an answer was stopped whole. records: code answered from the demo
 *  company's records (no model). tool_calls: the agent's reads. files: questions with a file attached (never the file). */
export const ASK_KINDS = ["asked", "live", "docs", "refused_money", "refused_data", "refused_injection", "limited", "trimmed", "stopped", "records", "tool_calls", "files"] as const;
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
