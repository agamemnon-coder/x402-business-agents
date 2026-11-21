// Privacy and retention. A company may take out everything the cloud holds for it (export). A person's personal data
// is erased on request: name and e-mail replaced, passkeys removed, keys they created revoked. Bookkeeping records
// (invoices, documents, ledger, payments, the audit log) are not personal data of that person and must be kept for
// seven years (Dutch law, Article 52 AWR); a closed company's records are purged only after that, by the scheduled job.
// Offboarding (offboardTenant) closes a company after its export and minimises the personal data around the books at
// once. The inventory of what is held and the rules per category: docs/privacy/data-inventory.md, docs/privacy/retention.md.

import type { EngineApi } from "./engine/api.js";
import { logEvent } from "./log.js";
import { ensureRecoveryTable } from "./recovery.js";
import { ensureSessionsTable } from "./sessions.js";
import type { Blobs, Sql, SqlValue } from "./store.js";
import { TENANT_TABLES, TenantDb, WriteConflict } from "./tenant.js";

export class PrivacyRefused extends Error {}

/** Columns that hold a secret's hash: they never leave, not even in an export. */
export const SECRET_COLUMNS: Record<string, string> = { api_keys: "secret_sha256", enrolments: "token_sha256", webhooks: "secret", alert_targets: "target", chat_hooks: "url" };

/**
 * Everything the cloud holds for the company, as rows. The documents themselves are not inlined (a large company's would
 * not fit one response in a Worker's memory): `documents_to_fetch` lists each one's path, /v1/documents/{sha256}.
 */
export async function exportTenant(sql: Sql, tenantId: string): Promise<Record<string, unknown>> {
  const db = new TenantDb(sql, tenantId);
  const tenant = await sql.first("SELECT id, slug, name, created_at, closed_at, purge_after FROM tenants WHERE id = ?", [tenantId]);
  const out: Record<string, unknown> = { format: "purser-cloud-export/v2", tenant };
  for (const t of TENANT_TABLES) {
    const rows = await db.select<Record<string, unknown>>(t);
    const secret = SECRET_COLUMNS[t];
    out[t] = secret ? rows.map((r) => { const copy = { ...r }; delete copy[secret]; return copy; }) : rows;
  }
  const docs = await db.select<{ sha256: string; filename: string; mime: string; size: number }>("documents", {}, { order: ["sha256"] });
  out.documents_to_fetch = docs.map((d) => ({ sha256: d.sha256, filename: d.filename, mime: d.mime, size: d.size, path: `/v1/documents/${d.sha256}` }));
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
  // Every key behind this person: the ones they made, and the ones those keys made (created_by_user is inherited).
  const keys = (await db.count("api_keys", { created_by_user: userId, revoked_at: null })) + (await db.count("api_keys", { created_by: userId, created_by_user: { op: "<>", v: userId }, revoked_at: null }));
  const iso = now.toISOString();
  const gen = (await db.one<{ session_gen: number }>("users", { id: userId }))?.session_gen ?? 0;
  const openExports = await db.count("exports", { status: { in: ["ready", "building"] } });
  // The erasures row goes first and is the guard: written only if, at commit time, the person is not erased yet and is
  // not the last owner. Two owners erasing each other at once: the second to commit fails as a whole.
  try {
    await db.apply([
      db.erasureGuard({ id: `e_${iso}_${userId}`, subject: userId, done_at: iso, done_by: by, detail: `name and e-mail erased; ${creds} passkey(s) removed; ${keys} key(s) revoked; bookkeeping records kept (7-year retention)` }),
      db.update("users", { id: userId }, { display_name: "[erased]", email: null, erased_at: iso, session_gen: gen + 1 }),
      db.delete("credentials", { user_id: userId }),
      // Their linked sign-in identities (Google, Microsoft, Apple) go with their passkeys.
      db.delete("identity_links", { user_id: userId }),
      db.update("api_keys", { created_by_user: userId, revoked_at: null }, { revoked_at: iso }),
      db.update("api_keys", { created_by: userId, revoked_at: null }, { revoked_at: iso }),
      // Their unused invites, and the ones they started for others, go too (red team round 5).
      db.update("enrolments", { user_id: userId, used_at: null, cancelled_at: null }, { cancelled_at: iso }),
      db.update("enrolments", { created_by_user: userId, used_at: null, cancelled_at: null }, { cancelled_at: iso }),
      // A staged export made before this holds the person's data as it was (red team 6): it ends now, and one still
      // being built is never kept (its parts leave the store right after, purgeEndedExportParts).
      db.update("exports", { status: "ready" }, { status: "expired", expires_at: iso }),
      db.update("exports", { status: "building" }, { status: "failed" }),
      ...(openExports ? [db.insert("security_events", { id: `se_${iso}_erase_${userId}`.replace(/[^A-Za-z0-9_]/g, "x").slice(0, 80), at: iso, kind: "export.ended_by_erasure", actor: by, detail_json: JSON.stringify({ subject: userId, exports: openExports }) })] : []),
    ]);
  } catch (e) {
    if (!(e instanceof WriteConflict)) throw e;
    const now = await db.one<{ erased_at: string | null }>("users", { id: userId });
    if (now?.erased_at) throw new PrivacyRefused(`${userId} was already erased`);
    throw new PrivacyRefused("the last owner cannot be erased: add another owner first, or close the company's account (another owner was erased at the same time)");
  }
  return { erased: userId, credentials_removed: creds, keys_revoked: keys };
}

/** A real calendar day YYYY-MM-DD at the start of the text (2027-02-31 is not one). */
export function realDay(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null;
}

/** Seven full years after the end of the year of the company's last record. */
export function purgeDay(lastRecordDay: string): string {
  const day = realDay(lastRecordDay);
  if (!day) throw new PrivacyRefused(`not a day: ${JSON.stringify(lastRecordDay)}`);
  return `${Number(day.slice(0, 4)) + 7}-12-31`;
}

/** The company's retention day: seven full years after the year of its latest record (or of today, when later). */
async function retentionDay(sql: Sql, tenantId: string, now: Date): Promise<string> {
  // The latest real day among the records (a malformed date, which the push refuses anyway, is skipped, never the max).
  const dates = await sql.all<{ d: string | null }>(`SELECT DISTINCT substr(posting_date, 1, 10) AS d FROM ledger_entries WHERE tenant_id = ?
    UNION SELECT DISTINCT substr(received_at, 1, 10) FROM invoices WHERE tenant_id = ?`, [tenantId, tenantId]);
  const today = now.toISOString().slice(0, 10);
  const lastDay = [...dates.map((r) => realDay(r.d)).filter((d): d is string => !!d), today].sort().pop()!;
  return purgeDay(lastDay);
}

/** What closing a company does to access: every key revoked, every session ended, every provider token gone. */
function closeStatements(tenantId: string, iso: string, purgeAfter: string): { sql: string; params: SqlValue[] }[] {
  return [
    { sql: "UPDATE tenants SET closed_at = ?, purge_after = ? WHERE id = ?", params: [iso, purgeAfter, tenantId] },
    { sql: "UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL", params: [iso, tenantId] },
    // Every session ends at once (fromSession also refuses a closed company).
    { sql: "UPDATE users SET session_gen = session_gen + 1 WHERE tenant_id = ?", params: [tenantId] },
    // The company's OAuth tokens go at once (docs/real-customers.md): a closed company calls no provider again.
    { sql: "DELETE FROM oauth_connections WHERE tenant_id = ?", params: [tenantId] },
    { sql: "DELETE FROM oauth_states WHERE tenant_id = ?", params: [tenantId] },
    { sql: "DELETE FROM books_connections WHERE tenant_id = ?", params: [tenantId] },
    { sql: "DELETE FROM oidc_states WHERE tenant_id = ?", params: [tenantId] },
  ];
}

export async function closeTenant(sql: Sql, tenantId: string, now: Date): Promise<{ closed_at: string; purge_after: string }> {
  const t = await sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [tenantId]);
  if (!t) throw new PrivacyRefused("no such company");
  if (t.closed_at) throw new PrivacyRefused("this company's account is already closed");
  const purge_after = await retentionDay(sql, tenantId, now);
  const iso = now.toISOString();
  await sql.batch(closeStatements(tenantId, iso, purge_after));
  return { closed_at: iso, purge_after };
}

/**
 * The bookkeeping an offboarding keeps, untouched, until the retention day (docs/privacy/retention.md): every row of
 * these tables, and the documents and e-mails in R2 (t/<id>/docs/, t/<id>/mail/, t/<id>/vault/). The audit rows and the
 * ledger entries are hash-chained: one changed byte breaks the chain, so they are never rewritten, only purged whole.
 */
export const STATUTORY_TABLES = ["vendors", "invoices", "payments", "transactions", "object_history", "documents", "ledger_entries", "ledger_lines", "audit_rows", "inbound_mail", "books_pushes", "awx_accounts"] as const;

export interface OffboardResult {
  closed_at: string;
  purge_after: string;
  export_id: string;
  people_pseudonymised: number;
  passkeys_removed: number;
  sign_in_links_removed: number;
  sessions_removed: number;
  keys_revoked: number;
  hooks_removed: number;
  kept_until_purge: readonly string[];
}

/**
 * Offboarding a company (outside audit, finding 3.4; docs/privacy/retention.md). The owner has made and downloaded the
 * company's export; then, in one transaction, the account closes (as closeTenant) and the personal data that is not
 * bookkeeping is minimised at once: each person's name becomes a pseudonym ("Former member <id>") and their e-mail goes,
 * their passkeys, linked sign-in identities, sessions, open invites and recovery requests go, every key is revoked, and
 * the webhook, alert targets and chat hooks (addresses, phone numbers, URLs) go. The bookkeeping (STATUTORY_TABLES and
 * the documents) stays as it is until the retention day, when the daily job purges the company (purgeExpired).
 * Refused unless `confirm` is the company's address and `exportId` is a staged export of this company, still open and
 * already downloaded. Who may ask (a signed-in owner, passkey fresh) is the route's and the router's (cloud/src/stepUp.ts).
 */
export async function offboardTenant(sql: Sql, a: { tenantId: string; by: string; confirm: string; exportId: string; now: Date }): Promise<OffboardResult> {
  const db = new TenantDb(sql, a.tenantId);
  const t = await sql.first<{ slug: string; closed_at: string | null }>("SELECT slug, closed_at FROM tenants WHERE id = ?", [a.tenantId]);
  if (!t) throw new PrivacyRefused("no such company");
  if (t.closed_at) throw new PrivacyRefused("this company's account is already closed");
  if (a.confirm !== t.slug) throw new PrivacyRefused(`to offboard, confirm with the company's address (${t.slug})`);
  const iso = a.now.toISOString();
  const x = await db.one<{ status: string; expires_at: string; downloaded_at: string | null }>("exports", { id: a.exportId });
  if (!x || x.status !== "ready" || x.expires_at <= iso) throw new PrivacyRefused("offboarding needs the company's export first: make one (POST /v1/export/staged), download it, then offboard within its day");
  if (!x.downloaded_at) throw new PrivacyRefused("download the export first (its manifest and parts), then offboard");
  const purge_after = await retentionDay(sql, a.tenantId, a.now);
  await ensureSessionsTable(sql);
  await ensureRecoveryTable(sql);
  const people = await db.count("users");
  const passkeys = await db.count("credentials");
  const links = await db.count("identity_links");
  const keys = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM api_keys WHERE tenant_id = ? AND revoked_at IS NULL", [a.tenantId]))?.n ?? 0;
  const hooks = (await db.count("webhooks")) + (await db.count("alert_targets")) + (await db.count("chat_hooks"));
  const sessions = (await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ?", [a.tenantId]))?.n ?? 0;
  const detail = { export_id: a.exportId, purge_after, people_pseudonymised: people, passkeys_removed: passkeys, sign_in_links_removed: links, sessions_removed: sessions, keys_revoked: keys, hooks_removed: hooks };
  try {
    await db.apply([
      // The guard goes first and is checked at commit: the company is still open, its export still open and downloaded.
      { sql: `INSERT INTO push_log (tenant_id, id, by_key, at) VALUES (?, ?, (SELECT 'offboard' WHERE (SELECT closed_at FROM tenants WHERE id = ?) IS NULL
          AND EXISTS (SELECT 1 FROM exports WHERE tenant_id = ? AND id = ? AND status = 'ready' AND expires_at > ? AND downloaded_at IS NOT NULL)), ?)`,
        params: [a.tenantId, `ob_${iso}_${crypto.randomUUID()}`, a.tenantId, a.tenantId, a.exportId, iso, iso] },
      ...closeStatements(a.tenantId, iso, purge_after),
      // People: a pseudonym for the name, no e-mail. The id stays, so the records that name it still read.
      { sql: "UPDATE users SET display_name = 'Former member ' || id, email = NULL, erased_at = COALESCE(erased_at, ?) WHERE tenant_id = ?", params: [iso, a.tenantId] },
      db.delete("credentials", {}),
      db.delete("identity_links", {}),
      db.update("enrolments", { used_at: null, cancelled_at: null }, { cancelled_at: iso }),
      { sql: "DELETE FROM sessions WHERE tenant_id = ?", params: [a.tenantId] },
      { sql: "DELETE FROM challenges WHERE tenant_id = ?", params: [a.tenantId] },
      { sql: "DELETE FROM recovery_requests WHERE tenant_id = ?", params: [a.tenantId] },
      // Where the company's messages went: addresses, phone numbers, URLs and their secrets.
      db.delete("webhooks", {}),
      db.delete("alert_targets", {}),
      db.delete("chat_hooks", {}),
      { sql: "UPDATE alert_deliveries SET target_mask = '[removed]' WHERE tenant_id = ?", params: [a.tenantId] },
      db.insert("security_events", { id: `se_${iso}_offboard`.replace(/[^A-Za-z0-9_]/g, "x"), at: iso, kind: "company.offboarded", actor: a.by, detail_json: JSON.stringify({ ...detail, kept_until_purge: STATUTORY_TABLES }) }),
    ]);
  } catch (e) {
    if (e instanceof WriteConflict) throw new PrivacyRefused("the company was closed, or its export ended, while this was asked; nothing was changed");
    throw e;
  }
  return { closed_at: iso, ...detail, kept_until_purge: STATUTORY_TABLES };
}

/** Tables made on first use that also hold a company's rows: purged with it (each may not exist yet). */
const LAZY_TENANT_TABLES = ["sessions", "recovery_requests", "export_links_used", "storage_use", "card_designs"] as const;

/**
 * The scheduled job: closed companies past their retention day are removed, rows and documents; a tombstone stays.
 * With an engine wired, the company's engine is wiped first (its ledger, documents and passkey). A company whose wipe
 * fails is logged and left, untouched, for the next run; the others are purged all the same. Returns the purged ones.
 */
export async function purgeExpired(sql: Sql, blobs: Blobs, now: Date, engine?: (tenantId: string) => Pick<EngineApi, "wipe">): Promise<string[]> {
  const today = now.toISOString().slice(0, 10);
  const due = await sql.all<{ id: string }>("SELECT id FROM tenants WHERE closed_at IS NOT NULL AND purge_after IS NOT NULL AND purge_after < ? AND name <> '[purged]'", [today]);
  const purged: string[] = [];
  for (const t of due) {
    if (engine) {
      try { await engine(t.id).wipe(); } catch (e) {
        logEvent("error", "purge_engine_wipe_failed", { tenant: t.id, error: e instanceof Error ? e.message : String(e) }, now);
        continue;
      }
    }
    for (const key of await blobs.list(`t/${t.id}/`)) await blobs.delete(key);
    for (const key of await blobs.list(`exports/${t.id}/`)) await blobs.delete(key);
    await sql.batch([
      ...TENANT_TABLES.map((table) => ({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, params: [t.id] })),
      { sql: "DELETE FROM api_keys WHERE tenant_id = ?", params: [t.id] },
      { sql: "DELETE FROM challenges WHERE tenant_id = ?", params: [t.id] },
      { sql: "DELETE FROM oauth_connections WHERE tenant_id = ?", params: [t.id] },
      { sql: "DELETE FROM oauth_states WHERE tenant_id = ?", params: [t.id] },
      { sql: "DELETE FROM books_connections WHERE tenant_id = ?", params: [t.id] },
      { sql: "DELETE FROM oidc_states WHERE tenant_id = ?", params: [t.id] },
      // The address stays taken (red team round 5): a purged company's inbox address is never given to someone else.
      { sql: "UPDATE tenants SET name = '[purged]' WHERE id = ?", params: [t.id] },
    ]);
    for (const table of LAZY_TENANT_TABLES) {
      try { await sql.run(`DELETE FROM ${table} WHERE tenant_id = ?`, [t.id]); } catch (e) {
        if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
    purged.push(t.id);
  }
  // Housekeeping: spent challenges and old rate windows.
  await sql.run("DELETE FROM challenges WHERE expires_at < ?", [new Date(now.getTime() - 86_400_000).toISOString()]);
  await sql.run("DELETE FROM rate_hits WHERE window_start < ?", [Math.floor(now.getTime() / 1000) - 86_400]);
  return purged;
}
