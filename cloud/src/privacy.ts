// Privacy and retention. A company may take out everything the cloud holds for it (export). A person's personal data
// is erased on request: name and e-mail replaced, passkeys removed, keys they created revoked. Bookkeeping records
// (invoices, documents, ledger, payments, the audit log) are not personal data of that person and must be kept for
// seven years (Dutch law, Article 52 AWR); a closed company's records are purged only after that, by the scheduled job.

import { toB64u } from "./crypto.js";
import type { Blobs, Sql } from "./store.js";
import { TENANT_TABLES, TenantDb } from "./tenant.js";

export class PrivacyRefused extends Error {}

export async function exportTenant(sql: Sql, blobs: Blobs, tenantId: string): Promise<Record<string, unknown>> {
  const db = new TenantDb(sql, tenantId);
  const tenant = await sql.first("SELECT id, slug, name, created_at, closed_at, purge_after FROM tenants WHERE id = ?", [tenantId]);
  const out: Record<string, unknown> = { format: "purser-cloud-export/v1", tenant };
  for (const t of TENANT_TABLES) {
    const rows = await db.select<Record<string, unknown>>(t);
    // Secrets never leave, not even their hashes.
    out[t] = t === "api_keys" ? rows.map((r) => { const copy = { ...r }; delete copy.secret_sha256; return copy; }) : rows;
  }
  const docs = await db.select<{ sha256: string; blob_key: string; filename: string; mime: string }>("documents");
  out.document_bytes = await Promise.all(docs.map(async (d) => ({ sha256: d.sha256, filename: d.filename, mime: d.mime, base64: toB64u((await blobs.get(d.blob_key)) ?? new Uint8Array()) })));
  return out;
}

export async function eraseUser(sql: Sql, tenantId: string, userId: string, by: string, now: Date): Promise<{ erased: string; credentials_removed: number; keys_revoked: number }> {
  const db = new TenantDb(sql, tenantId);
  const user = await db.one<{ role: string; erased_at: string | null }>("users", { id: userId });
  if (!user) throw new PrivacyRefused(`no person ${userId}`);
  if (user.erased_at) throw new PrivacyRefused(`${userId} was already erased`);
  if (user.role === "owner" && (await db.count("users", { role: "owner", erased_at: null })) <= 1) {
    throw new PrivacyRefused("the last owner cannot be erased: add another owner first, or close the company's account");
  }
  const creds = await db.count("credentials", { user_id: userId });
  const keys = await db.count("api_keys", { created_by: userId, revoked_at: null });
  const iso = now.toISOString();
  await db.apply([
    db.update("users", { id: userId }, { display_name: "[erased]", email: null, erased_at: iso }),
    db.delete("credentials", { user_id: userId }),
    db.update("api_keys", { created_by: userId, revoked_at: null }, { revoked_at: iso }),
    db.insert("erasures", { id: `e_${iso}_${userId}`, subject: userId, done_at: iso, done_by: by, detail: `name and e-mail erased; ${creds} passkey(s) removed; ${keys} key(s) revoked; bookkeeping records kept (7-year retention)` }),
  ]);
  return { erased: userId, credentials_removed: creds, keys_revoked: keys };
}

/** Seven full years after the end of the year of the company's last record. */
export function purgeDay(lastRecordDay: string): string {
  return `${Number(lastRecordDay.slice(0, 4)) + 7}-12-31`;
}

export async function closeTenant(sql: Sql, tenantId: string, now: Date): Promise<{ closed_at: string; purge_after: string }> {
  const t = await sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [tenantId]);
  if (!t) throw new PrivacyRefused("no such company");
  if (t.closed_at) throw new PrivacyRefused("this company's account is already closed");
  const last = await sql.first<{ d: string | null }>(`SELECT MAX(d) AS d FROM (
    SELECT MAX(posting_date) AS d FROM ledger_entries WHERE tenant_id = ? UNION ALL SELECT MAX(received_at) FROM invoices WHERE tenant_id = ?)`, [tenantId, tenantId]);
  const today = now.toISOString().slice(0, 10);
  const lastDay = [last?.d?.slice(0, 10) ?? today, today].sort().pop()!;
  const purge_after = purgeDay(lastDay);
  const iso = now.toISOString();
  await sql.batch([
    { sql: "UPDATE tenants SET closed_at = ?, purge_after = ? WHERE id = ?", params: [iso, purge_after, tenantId] },
    { sql: "UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL", params: [iso, tenantId] },
  ]);
  return { closed_at: iso, purge_after };
}

/** The scheduled job: closed companies past their retention day are removed, rows and documents; a tombstone stays. */
export async function purgeExpired(sql: Sql, blobs: Blobs, now: Date): Promise<string[]> {
  const today = now.toISOString().slice(0, 10);
  const due = await sql.all<{ id: string }>("SELECT id FROM tenants WHERE closed_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after < ? AND name <> '[purged]'", [today]);
  for (const t of due) {
    for (const key of await blobs.list(`t/${t.id}/`)) await blobs.delete(key);
    await sql.batch([
      ...TENANT_TABLES.map((table) => ({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, params: [t.id] })),
      { sql: "DELETE FROM api_keys WHERE tenant_id = ?", params: [t.id] },
      { sql: "DELETE FROM challenges WHERE tenant_id = ?", params: [t.id] },
      { sql: "UPDATE tenants SET name = '[purged]', slug = id WHERE id = ?", params: [t.id] },
    ]);
  }
  // Housekeeping: spent challenges and old rate windows.
  await sql.run("DELETE FROM challenges WHERE expires_at < ?", [new Date(now.getTime() - 86_400_000).toISOString()]);
  await sql.run("DELETE FROM rate_hits WHERE window_start < ?", [Math.floor(now.getTime() / 1000) - 86_400]);
  return due.map((t) => t.id);
}
