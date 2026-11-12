// The sweep (the hands-on deployment's scheduled job, hourly): every visitor's company past its 24 hours is wiped, at
// most 50 a run. Its engine forgets everything (its ledger, documents and simulated bank), its rows leave every tenant
// table of the cloud, its documents and archive leave the document store (t/<id>/), and the company is marked swept,
// so its visitor token and any session it gave answer 410 from then on. Address salts older than 48 hours are deleted.
//
// A company whose engine will not wipe is logged and left for the next run; the others are swept all the same.
import type { EngineApi } from "../engine/api.js";
import { logEvent } from "../log.js";
import type { Blobs, Sql } from "../store.js";
import { TENANT_TABLES } from "../tenant.js";
import { dropOldSalts } from "./start.js";

export const SWEEP_BATCH = 50;

export async function sweepTry(a: {
  sql: Sql; blobs: Blobs; engine?: (tenantId: string) => Pick<EngineApi, "wipe">; now: Date; batch?: number;
  /** Lane A's spend ledger: reservations older than 10 minutes settled at their full amount (cloud/src/engine/spend.ts). */
  settle?: (sql: Sql, now: Date) => Promise<unknown>;
}): Promise<{ swept: string[]; salts_dropped: number }> {
  const { sql, blobs, now } = a;
  const due = await sql.all<{ tenant_id: string }>("SELECT tenant_id FROM try_companies WHERE wiped_at IS NULL AND expires_at <= ? ORDER BY expires_at LIMIT ?", [now.toISOString(), a.batch ?? SWEEP_BATCH]);
  const swept: string[] = [];
  for (const { tenant_id: id } of due) {
    if (a.engine) {
      try { await a.engine(id).wipe(); } catch (e) {
        logEvent("error", "try_sweep_wipe_failed", { tenant: id, error: e instanceof Error ? e.message : String(e) }, now);
        continue;
      }
    }
    try {
      for (const key of await blobs.list(`t/${id}/`)) await blobs.delete(key);
      for (const key of await blobs.list(`exports/${id}/`)) await blobs.delete(key);
      await sql.batch([
        ...TENANT_TABLES.filter((t) => t !== "users").map((t) => ({ sql: `DELETE FROM ${t} WHERE tenant_id = ?`, params: [id] })),
        { sql: "DELETE FROM challenges WHERE tenant_id = ?", params: [id] },
        { sql: "DELETE FROM users WHERE tenant_id = ?", params: [id] },
        { sql: "UPDATE tenants SET name = '[swept]', closed_at = ? WHERE id = ?", params: [now.toISOString(), id] },
        { sql: "UPDATE try_companies SET wiped_at = ? WHERE tenant_id = ?", params: [now.toISOString(), id] },
      ]);
      swept.push(id);
    } catch (e) {
      logEvent("error", "try_sweep_failed", { tenant: id, error: e instanceof Error ? e.message : String(e) }, now);
    }
  }
  const salts = await dropOldSalts(sql, now);
  if (a.settle) {
    try { await a.settle(sql, now); } catch (e) { logEvent("error", "try_sweep_settle_failed", { error: e instanceof Error ? e.message : String(e) }, now); }
  }
  return { swept, salts_dropped: salts };
}
