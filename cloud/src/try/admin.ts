// POST /v1/try/admin: the owner's controls of the hands-on deployment, with the platform admin's token (only its
// SHA-256 is configured; the router checks it, and a wrong one is a plain 401 that never locks out a right one).
//   {op: "get"}                     the switches and today's counters
//   {op: "set", key, value}         one switch, within its ceiling; written to the admin log (never the token)
//   {op: "token", pool, until}      a new event or jury token, returned once; only its SHA-256 is stored
import { z } from "zod";
import { randomToken, sha256Hex } from "../crypto.js";
import type { Sql } from "../store.js";
import { MAX_TOKENS, readSwitches, setSwitch, setSwitchIf, SwitchRefused, tokensOf, type Switches } from "./switches.js";

export const AdminOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("get") }).strict(),
  z.object({ op: z.literal("set"), key: z.string().min(1).max(64), value: z.union([z.string().max(4000), z.number().int().nonnegative()]) }).strict(),
  z.object({ op: z.literal("token"), pool: z.enum(["event", "jury"]), until: z.string().max(40) }).strict(),
]);
export type AdminOp = z.infer<typeof AdminOp>;

const POOLS = ["public", "event", "jury", "smoke"] as const;

/** A number from a table that may not exist yet (lane A's spend ledger, the rail's day ledger): 0 when it does not. */
async function maybe(sql: Sql, query: string, params: (string | number)[]): Promise<number> {
  try { return Number((await sql.first<{ v: number | null }>(query, params))?.v ?? 0); } catch { return 0; }
}

/** The switches as the admin sees them: the tokens by pool and end only, never their hashes. */
function shown(s: Switches): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s };
  if ("tokens" in s) out.tokens = tokensOf(s).map((t) => ({ pool: t.pool, until: t.until }));
  return out;
}

export async function adminOp(sql: Sql, op: AdminOp, now: Date): Promise<Record<string, unknown>> {
  if (op.op === "set") return { set: await setSwitch(sql, op.key, String(op.value), now) };
  if (op.op === "token") {
    const until = Date.parse(op.until);
    if (Number.isNaN(until) || until <= now.getTime()) throw new SwitchRefused("until is a moment in the future (ISO 8601)");
    const token = randomToken(32);
    const mine = { sha256: await sha256Hex(token), pool: op.pool, until: new Date(until).toISOString() };
    // Written only over the list it read: a token made at the same moment is never lost (read again and retried).
    for (let attempt = 0; attempt < 20; attempt++) {
      const s = await readSwitches(sql);
      // Tokens past their end make room; at most eight live ones at once.
      const live = tokensOf(s).filter((t) => Date.parse(t.until) > now.getTime());
      if (live.length >= MAX_TOKENS) throw new SwitchRefused(`there are already ${MAX_TOKENS} live tokens; let one end or set tokens to fewer`);
      if (await setSwitchIf(sql, "tokens", JSON.stringify([...live, mine]), s.tokens ?? null, now)) {
        return { token, pool: op.pool, until: mine.until, note: "shown once; only its hash is kept" };
      }
    }
    throw new SwitchRefused("the tokens changed too often at the same moment; try again");
  }
  const s = await readSwitches(sql);
  const d = now.toISOString().slice(0, 10);
  const starts = await sql.all<{ pool: string; n: number }>("SELECT pool, COUNT(*) AS n FROM try_companies WHERE created_at >= ? GROUP BY pool", [`${d}T00:00:00.000Z`]);
  const open = await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies WHERE wiped_at IS NULL AND expires_at > ?", [now.toISOString()]);
  const spent: Record<string, number> = {};
  for (const p of POOLS) spent[p] = await maybe(sql, "SELECT micros AS v FROM try_spend WHERE scope = ?", [`day:${p}:${d}`]);
  return {
    switches: shown(s),
    today: {
      day: d,
      starts_by_pool: Object.fromEntries(["public", "event", "jury"].map((p) => [p, Number(starts.find((x) => x.pool === p)?.n ?? 0)])),
      open_companies: Number(open?.n ?? 0),
      spent_micros_by_pool: spent,
      awx_calls: await maybe(sql, "SELECT n AS v FROM try_rail_day WHERE day = ?", [d]),
      metal_calls: await maybe(sql, "SELECT n AS v FROM try_metal_day WHERE day = ?", [d]),
    },
    all_time: { spent_micros: await maybe(sql, "SELECT micros AS v FROM try_spend WHERE scope = 'all'", []) },
  };
}
