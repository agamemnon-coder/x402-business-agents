// "Try as guest" (13 Nov, owner): one button on the console's sign-in opens a demo company, read-only, with no passkey and
// no e-mail. The company is made from the batches in ./seed.gen.ts (npm run cloud:guest-seed: the runner's own code on
// stand-ins, no network, no model), applied through the same sync a runner's push goes through. It is labelled demo
// data everywhere: no real money, no real company, nothing it shows moved on a real rail.
//
// What a guest can do: read. The guest is a person with the viewer role (read scope only), so every write route
// answers 403 by the same check that guards any company (cloud/src/auth.ts need). The company has no keys, no
// connections, no Airwallex account and no engine: nothing in it can reach a rail. All guests share one viewer; signing
// out does not end the others' sessions (app.ts /v1/auth/logout), and a session lasts its 15 minutes.

import { applySync, SyncBatch } from "../sync.js";
import { sessionToken } from "../auth.js";
import type { Blobs, Sql } from "../store.js";
import { TENANT_TABLES, TenantDb } from "../tenant.js";
import { DEMO_END, SEED_BATCHES } from "./seed.gen.js";

export const DEMO_TENANT = "t_demo_company";
export const DEMO_SLUG = "purser-demo";
export const DEMO_NAME = "Northwind Outdoor (demo company)";
export const GUEST_USER = "u_guest";
export const GUEST_NAME = "Guest (demo)";
export { DEMO_END };
export const isDemoTenant = (tenantId: string): boolean => tenantId === DEMO_TENANT;

/** The seed's own fingerprint: the newest audit row's hash in its batches. The company is current when its chain ends there. */
export function seedHead(): string {
  let head = "";
  for (const b of SEED_BATCHES) for (const r of ((b as { audit_rows?: { row_hash: string }[] }).audit_rows ?? [])) head = r.row_hash;
  return head;
}

/**
 * The demo company, made once per deployment (and again when the seed changes): the tenant, the guest viewer, then the
 * seed's batches through applySync. Safe to call on every guest sign-in: a current company is left as it is.
 */
export async function ensureDemoCompany(sql: Sql, blobs: Blobs, now: Date): Promise<void> {
  const want = seedHead();
  const head = async () => (await sql.first<{ row_hash: string }>("SELECT row_hash FROM audit_rows WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1", [DEMO_TENANT]))?.row_hash ?? null;
  const t = await sql.first<{ id: string }>("SELECT id FROM tenants WHERE id = ?", [DEMO_TENANT]);
  if (t && (await head()) === want) return;
  const iso = now.toISOString();
  if (!t) {
    await sql.batch([
      { sql: "INSERT OR IGNORE INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, 'en', ?)", params: [DEMO_TENANT, DEMO_SLUG, DEMO_NAME, iso] },
      { sql: "INSERT OR IGNORE INTO users (tenant_id, id, display_name, role, language, created_at) VALUES (?, ?, ?, 'viewer', 'en', ?)", params: [DEMO_TENANT, GUEST_USER, GUEST_NAME, iso] },
    ]);
  } else {
    // An older seed: its rows go, the guest stays, and the new seed is applied from the start.
    await sql.batch(TENANT_TABLES.filter((x) => x !== "users").map((x) => ({ sql: `DELETE FROM ${x} WHERE tenant_id = ?`, params: [DEMO_TENANT] })));
  }
  const db = new TenantDb(sql, DEMO_TENANT);
  try {
    for (const b of SEED_BATCHES) await applySync(db, blobs, SyncBatch.parse(b), now, { kind: "key", principal: "" });
  } catch (e) {
    // Two first guests at once: the other one's seed won. Anything else is a real failure.
    if ((await head()) !== want) throw e;
  }
}

/** A guest's session: the shared viewer of the demo company, read only, 15 minutes. */
export async function guestSession(sql: Sql, blobs: Blobs, secret: string, now: Date): Promise<{ session: string; role: "viewer"; user_id: string; tenant: string; expires_in: number }> {
  await ensureDemoCompany(sql, blobs, now);
  const u = await sql.first<{ session_gen: number }>("SELECT session_gen FROM users WHERE tenant_id = ? AND id = ?", [DEMO_TENANT, GUEST_USER]);
  const token = await sessionToken(secret, { tenantId: DEMO_TENANT, userId: GUEST_USER, role: "viewer", gen: u?.session_gen ?? 0 }, now);
  return { session: token, role: "viewer", user_id: GUEST_USER, tenant: DEMO_SLUG, expires_in: 900 };
}
