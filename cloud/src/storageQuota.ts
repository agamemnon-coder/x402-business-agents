// A storage quota per company for files uploaded through the API (ASVS 4.0.3 V12.1.3): the runner's pushed documents
// (POST /v1/sync) and the invoices uploaded to the company's engine (POST /v1/engine/documents). Each upload reserves
// its bytes and one file in one statement that only adds while the total stays within the quota, so two uploads at once
// cannot both pass the last free bytes; an upload that ends up storing nothing (refused, a duplicate) gives them back.
// Inbound e-mail has its own daily quota (cloud/src/mail.ts). Nothing here runs at import.
import type { Sql } from "./store.js";

export interface StorageQuota { bytes: number; files: number }
/** Per company: 2 GiB and 20,000 files, far above a small company's invoices (16 MB each at most). */
export const DEFAULT_STORAGE_QUOTA: StorageQuota = { bytes: 2 * 1024 ** 3, files: 20_000 };

/** Also cloud/migrations/0008_storage_quota.sql (test/cloud-asvs-controls.test.ts holds the two equal). */
export const STORAGE_QUOTA_SCHEMA = "CREATE TABLE IF NOT EXISTS storage_use (tenant_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL, files INTEGER NOT NULL, updated_at TEXT NOT NULL)";

export class QuotaExceeded extends Error {
  readonly status = 413;
  constructor(message: string) { super(message); }
}

const ready = new WeakMap<Sql, Promise<void>>();
function table(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) { p = sql.run(STORAGE_QUOTA_SCHEMA).then(() => undefined).catch((e: unknown) => { ready.delete(sql); throw e; }); ready.set(sql, p); }
  return p;
}

/**
 * Reserves `bytes` and `files` for one company, or throws QuotaExceeded and reserves nothing. Returns the function that
 * gives the reservation back (for an upload that stored nothing in the end).
 */
export async function reserveStorage(sql: Sql, tenantId: string, bytes: number, files: number, now: Date, quota: StorageQuota = DEFAULT_STORAGE_QUOTA): Promise<() => Promise<void>> {
  const release = async () => {
    await sql.run("UPDATE storage_use SET bytes = MAX(0, bytes - ?), files = MAX(0, files - ?), updated_at = ? WHERE tenant_id = ?", [bytes, files, now.toISOString(), tenantId]);
  };
  if (bytes <= 0 && files <= 0) return async () => undefined;
  await table(sql);
  const over = () => new QuotaExceeded(`this company's file storage is full (${quota.files} files, ${Math.floor(quota.bytes / 1024 ** 2)} MB at most); nothing was stored`);
  if (bytes > quota.bytes || files > quota.files) throw over();
  const row = await sql.first<{ bytes: number }>(
    "INSERT INTO storage_use (tenant_id, bytes, files, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET bytes = bytes + excluded.bytes, files = files + excluded.files, updated_at = excluded.updated_at WHERE storage_use.bytes + excluded.bytes <= ? AND storage_use.files + excluded.files <= ? RETURNING bytes",
    [tenantId, bytes, files, now.toISOString(), quota.bytes, quota.files]);
  if (!row) throw over();
  return release;
}

/** What a company has used, for its status. */
export async function storageUse(sql: Sql, tenantId: string): Promise<{ bytes: number; files: number }> {
  await table(sql);
  return (await sql.first<{ bytes: number; files: number }>("SELECT bytes, files FROM storage_use WHERE tenant_id = ?", [tenantId])) ?? { bytes: 0, files: 0 };
}
