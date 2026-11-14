// The hands-on deployment's switches and caps (purser-try): one table, try_switches, that the admin sets through
// POST /v1/try/admin and every part of the demo reads through readSwitches. They fail closed: a missing row is OFF for
// an on/off switch and 0 for a cap, so nothing runs, spends or calls out until the owner sets it. The start limits are
// the one exception: a missing row takes a default, because they only ever narrow what "starts" (off when missing) allows.
//
// Lane A's spend ledger (cloud/src/engine/spend.ts) reads the Claude caps from here; the rail (C8) reads its limits.
import type { Sql } from "../store.js";
import { EXTRA_SWITCHES } from "./extraSwitches.js";

export type Switches = Record<string, string>;

/** On or off; a missing row is off. */
export const ON_OFF = ["starts", "claude", "agents", "rail_awx", "rail_metal", "own_upload", ...EXTRA_SWITCHES] as const;

/** Whole numbers with a ceiling no `set` may pass; a missing row is 0 unless it has a default here. */
export const NUMBERS: Record<string, { ceiling: number; fallback: number }> = {
  // Claude, in micro-dollars (USD 1 = 1,000,000).
  cap_all_micros: { ceiling: 78_000_000, fallback: 0 },
  cap_day_micros_public: { ceiling: 30_000_000, fallback: 0 },
  cap_day_micros_event: { ceiling: 30_000_000, fallback: 0 },
  cap_day_micros_jury: { ceiling: 30_000_000, fallback: 0 },
  cap_day_micros_smoke: { ceiling: 5_000_000, fallback: 0 },
  cap_company_micros: { ceiling: 1_000_000, fallback: 0 },
  cap_addr_micros: { ceiling: 3_000_000, fallback: 0 },
  cap_action_micros: { ceiling: 500_000, fallback: 0 },
  max_inflight: { ceiling: 20, fallback: 0 },
  // Starts.
  starts_per_address_hour: { ceiling: 50, fallback: 5 },
  starts_per_day_public: { ceiling: 2_000, fallback: 300 },
  starts_per_day_event: { ceiling: 2_000, fallback: 300 },
  starts_per_day_jury: { ceiling: 500, fallback: 100 },
  // The Airwallex sandbox and Alta testnet legs (a missing row is 0: no calls).
  awx_calls_day: { ceiling: 1_500, fallback: 0 },
  awx_eur_day: { ceiling: 10_000, fallback: 0 },
  metal_calls_day: { ceiling: 1_000, fallback: 0 },
};

export type Pool = "public" | "event" | "jury";
/** A token that puts a company in the event or jury pool until a moment; only its SHA-256 is stored. */
export interface PoolToken { sha256: string; pool: "event" | "jury"; until: string }
export const MAX_TOKENS = 8;

export class SwitchRefused extends Error {}

/** Every switch row, by key. A table that cannot be read throws: the caller fails closed. */
export async function readSwitches(sql: Sql): Promise<Switches> {
  const rows = await sql.all<{ key: string; value: string }>("SELECT key, value FROM try_switches");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Only the value "on" is on. */
export function on(s: Switches, key: string): boolean {
  return s[key] === "on";
}

/** A number switch: its row as a whole number in range, else its fallback (0 for the caps). A bad row is the fallback, never more. */
export function num(s: Switches, key: string): number {
  const spec = NUMBERS[key];
  if (!spec) return 0;
  const raw = s[key];
  if (raw === undefined || !/^\d{1,12}$/.test(raw)) return spec.fallback;
  return Math.min(Number(raw), spec.ceiling);
}

const TOKEN = /^[0-9a-f]{64}$/;
/** The stored tokens; a row that does not parse holds none (no token works, so the pools close, not open). */
export function tokensOf(s: Switches): PoolToken[] {
  try {
    const v = JSON.parse(s.tokens ?? "[]") as unknown;
    return parseTokens(v) ?? [];
  } catch { return []; }
}

function parseTokens(v: unknown): PoolToken[] | null {
  if (!Array.isArray(v) || v.length > MAX_TOKENS) return null;
  const out: PoolToken[] = [];
  for (const t of v) {
    if (!t || typeof t !== "object") return null;
    const { sha256, pool, until } = t as Record<string, unknown>;
    if (typeof sha256 !== "string" || !TOKEN.test(sha256) || (pool !== "event" && pool !== "jury") || typeof until !== "string" || Number.isNaN(Date.parse(until))) return null;
    out.push({ sha256, pool, until: new Date(until).toISOString() });
  }
  return out;
}

/** A value the admin may set for a key, normalized; a key that is not a switch, or a value past its ceiling, is refused. */
export function checkSwitch(key: string, value: string): string {
  if ((ON_OFF as readonly string[]).includes(key)) {
    if (value !== "on" && value !== "off") throw new SwitchRefused(`${key} is "on" or "off"`);
    return value;
  }
  const spec = NUMBERS[key];
  if (spec) {
    if (!/^\d{1,12}$/.test(value)) throw new SwitchRefused(`${key} is a whole number from 0 to ${spec.ceiling}`);
    if (Number(value) > spec.ceiling) throw new SwitchRefused(`${key} may be at most ${spec.ceiling}; ${value} is past its ceiling`);
    return String(Number(value));
  }
  if (key === "tokens") {
    let v: unknown;
    try { v = JSON.parse(value); } catch { throw new SwitchRefused("tokens is a JSON list of {sha256, pool, until}"); }
    const t = parseTokens(v);
    if (!t) throw new SwitchRefused(`tokens is a JSON list of at most ${MAX_TOKENS} {sha256 (hex), pool (event or jury), until (a date)}`);
    return JSON.stringify(t);
  }
  throw new SwitchRefused(`${key} is not a switch of this deployment`);
}

/**
 * Sets a switch only if it still holds `old` (null: no row yet), in one statement; false when another write came
 * first. The admin's token op uses it, so two tokens made at once are both kept.
 */
export async function setSwitchIf(sql: Sql, key: string, value: string, old: string | null, now: Date): Promise<boolean> {
  const v = checkSwitch(key, value);
  const iso = now.toISOString();
  const done = old === null
    ? await sql.run("INSERT INTO try_switches (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING", [key, v, iso])
    : await sql.run("UPDATE try_switches SET value = ?, updated_at = ? WHERE key = ? AND value = ?", [v, iso, key, old]);
  if (done.changes !== 1) return false;
  await sql.run("INSERT INTO try_admin_log (at, key, old, new) VALUES (?, ?, ?, ?)", [iso, key, key === "tokens" ? tokenCount(old) : old, key === "tokens" ? tokenCount(v) : v]);
  return true;
}

/** The tokens row in the admin log: how many, never their hashes. */
const tokenCount = (v: string | null) => (v === null ? null : `[${tokensOf({ tokens: v }).length} tokens]`);

/** Sets a switch and writes the admin log (the key, the old and the new value; never who or with which token). */
export async function setSwitch(sql: Sql, key: string, value: string, now: Date): Promise<{ key: string; old: string | null; value: string }> {
  const v = checkSwitch(key, value);
  const iso = now.toISOString();
  const old = (await sql.first<{ value: string }>("SELECT value FROM try_switches WHERE key = ?", [key]))?.value ?? null;
  await sql.batch([
    { sql: "INSERT INTO try_switches (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", params: [key, v, iso] },
    { sql: "INSERT INTO try_admin_log (at, key, old, new) VALUES (?, ?, ?, ?)", params: [iso, key, key === "tokens" ? tokenCount(old) : old, key === "tokens" ? tokenCount(v) : v] },
  ]);
  return { key, old: key === "tokens" ? null : old, value: v };
}
