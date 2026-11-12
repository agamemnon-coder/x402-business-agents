// What Claude may cost a company's engine, kept in the cloud's database (D1): the hard ceilings of src/engine/budget.ts
// on the cloud's side. An action that may ask Claude reserves its ceiling first: the smaller of the action cap and what
// the company, the visitor's address (public pool only), the pool's day and all time still allow. The reservation is
// one batch: the reservation row is written only when every cap and the number of actions in flight allow it, and each
// scope's spend grows by the whole ceiling at once. Settling gives back what the action did not use. A reservation is
// in flight until it is settled; one older than ten minutes (longer than any action runs) is closed at its full amount.
//
// The caps come from switches the owner sets (lane C's readSwitches); a missing one is off or 0, so nothing is spent
// until they are set. Amounts are micro-USD at list price (src/claude/pricing.ts). Nothing here moves money.
import type { CappedReason, Reservation } from "../../../src/engine/budget.js";
import type { Sql } from "../store.js";

/** Whose action this is: the company, its pool (public, event, jury or smoke) and, in the public pool, its visitor's address hash. */
export interface SpendScope { tenantId: string; pool: string; address: string | null }

/** A reservation older than this is closed at its full amount. */
export const STALE_MS = 10 * 60_000;

const isOn = (v: unknown) => v === "on" || v === true || v === 1 || v === "1";
const amount = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0;
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

/** Closes every open reservation older than ten minutes at its full amount; the number closed. */
export async function expireStale(sql: Sql, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_MS).toISOString();
  return (await sql.run("UPDATE try_resv SET state = 'expired' WHERE state = 'open' AND started_at < ?", [cutoff])).changes;
}

export function d1Spend(sql: Sql, switches: Record<string, unknown>, who: SpendScope, now: () => Date = () => new Date()) {
  const capsAt = (day: string): { scope: string; cap: number; reason: CappedReason }[] => [
    { scope: `co:${who.tenantId}`, cap: amount(switches.cap_company_micros), reason: "company_cap" },
    ...(who.pool === "public" && who.address ? [{ scope: `addr:${who.address}:${day}`, cap: amount(switches.cap_addr_micros), reason: "address_cap" as const }] : []),
    { scope: `day:${who.pool}:${day}`, cap: amount(switches[`cap_day_micros_${who.pool}`]), reason: "pool_day_cap" },
    { scope: "all", cap: amount(switches.cap_all_micros), reason: "all_time_cap" },
  ];
  const spentOn = async (scopes: string[]): Promise<Map<string, number>> =>
    new Map((await sql.all<{ scope: string; micros: number }>(`SELECT scope, micros FROM try_spend WHERE scope IN (${scopes.map(() => "?").join(", ")})`, scopes)).map((r) => [r.scope, r.micros]));

  return {
    async reserve(): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: CappedReason }> {
      if (!isOn(switches.claude)) return { ok: false, reason: "switch_off" };
      const t = now();
      await expireStale(sql, t);
      const caps = capsAt(t.toISOString().slice(0, 10));
      const maxInflight = amount(switches.max_inflight);
      const spent = await spentOn(caps.map((c) => c.scope));
      const left = caps.map((c) => ({ ...c, left: c.cap - (spent.get(c.scope) ?? 0) }));
      const out = left.find((c) => c.left <= 0);
      if (out) return { ok: false, reason: out.reason };
      const micros = Math.min(amount(switches.cap_action_micros), ...left.map((c) => c.left));
      if (micros <= 0) return { ok: false, reason: "action_budget" };

      const id = crypto.randomUUID();
      // One batch, one transaction: the row only when every cap and the actions in flight allow it; each scope grows
      // only when the row is there. Two reservations racing cannot both pass a cap only one fits.
      await sql.batch([
        {
          sql: `INSERT INTO try_resv (id, tenant_id, micros, started_at, state) SELECT ?, ?, ?, ?, 'open'
                WHERE (SELECT COUNT(*) FROM try_resv WHERE state = 'open') < ?
                ${caps.map(() => "AND COALESCE((SELECT micros FROM try_spend WHERE scope = ?), 0) + ? <= ?").join(" ")}`,
          params: [id, who.tenantId, micros, t.toISOString(), maxInflight, ...caps.flatMap((c) => [c.scope, micros, c.cap])],
        },
        ...caps.map((c) => ({
          sql: "INSERT INTO try_spend (scope, micros) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM try_resv WHERE id = ?) ON CONFLICT(scope) DO UPDATE SET micros = micros + excluded.micros",
          params: [c.scope, micros, id],
        })),
      ]);
      if (!(await sql.first("SELECT 1 AS ok FROM try_resv WHERE id = ?", [id]))) {
        // Another action got there first: say which limit it was.
        const open = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_resv WHERE state = 'open'"))?.n ?? 0;
        if (open >= maxInflight) return { ok: false, reason: "busy" };
        const now2 = await spentOn(caps.map((c) => c.scope));
        return { ok: false, reason: caps.find((c) => (now2.get(c.scope) ?? 0) + micros > c.cap)?.reason ?? "busy" };
      }
      return {
        ok: true,
        reservation: {
          micros,
          async settle(actualMicros: number) {
            const used = Math.min(micros, Math.max(0, Math.ceil(actualMicros)));
            // Only an open reservation gives back what it did not use; an expired one was closed at its full amount.
            await sql.batch([
              ...caps.map((c) => ({ sql: "UPDATE try_spend SET micros = micros - ? WHERE scope = ? AND EXISTS (SELECT 1 FROM try_resv WHERE id = ? AND state = 'open')", params: [micros - used, c.scope, id] })),
              { sql: "UPDATE try_resv SET state = 'settled', micros = ? WHERE id = ? AND state = 'open'", params: [used, id] },
            ]);
          },
        },
      };
    },
    /** Whether the next action may ask Claude (the switch on and the company's cap not used up), its cap, and what it has spent or holds reserved. */
    async status(): Promise<{ on: boolean; cap_micros: number | null; spent_micros: number }> {
      const scope = `co:${who.tenantId}`;
      const spent = (await spentOn([scope])).get(scope) ?? 0;
      const cap = isOn(switches.claude) ? amount(switches.cap_company_micros) || null : null;
      return { on: cap !== null && spent < cap, cap_micros: cap, spent_micros: spent };
    },
  };
}
