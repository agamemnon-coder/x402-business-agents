// Staged exports (go-live): a company's export built into the document store (R2) in parts, not returned in one
// response a Worker could not hold for a large company. Each part is one table's rows, at most `partRows` of them, as
// JSON with its SHA-256; a manifest lists the parts. The owner fetches the manifest and the parts with signed links that
// hold for 15 minutes and need no key (a browser can download them). One export at a time per company, a size limit,
// kept a day, and every export and download recorded in the security events.

import { hmacB64u, hmacValid, randomToken, sha256Hex } from "./crypto.js";
import { SECRET_COLUMNS } from "./privacy.js";
import type { Blobs, Sql } from "./store.js";
import { TENANT_TABLES, TenantDb, WriteConflict } from "./tenant.js";

export const EXPORT_FORMAT = "purser-cloud-export/v3-staged";
export const EXPORT_KEEP_HOURS = 24;
export const LINK_MINUTES = 15;
/** A build that has not finished after this long is taken as dead (its Worker stopped): it no longer blocks the next. */
const BUILD_MINUTES = 15;
export const DEFAULT_PART_ROWS = 2000;
export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

export class ExportRefused extends Error {
  constructor(readonly status: 404 | 409 | 413, message: string) { super(message); }
}

export interface Part { table: string; n: number; rows: number; bytes: number; sha256: string }
interface ExportRow { id: string; status: string; created_at: string; expires_at: string; created_by: string; parts_json: string; bytes: number; downloaded_at: string | null }

const prefix = (tenantId: string, id: string) => `exports/${tenantId}/${id}/`;
const partKey = (tenantId: string, id: string, name: string) => `${prefix(tenantId, id)}${name}.json`;
const enc = new TextEncoder();

async function removeParts(blobs: Blobs, tenantId: string, id: string): Promise<void> {
  for (const k of await blobs.list(prefix(tenantId, id))) await blobs.delete(k);
}

/** Exports past their day (and builds that died) lose their parts; their status says so. Every company or one. */
export async function sweepExports(sql: Sql, blobs: Blobs, now: Date, tenantId?: string): Promise<number> {
  const iso = now.toISOString();
  const stale = new Date(now.getTime() - BUILD_MINUTES * 60_000).toISOString();
  const rows = await sql.all<{ tenant_id: string; id: string; status: string }>(
    `SELECT tenant_id, id, status FROM exports WHERE ((status = 'ready' AND expires_at <= ?) OR (status = 'building' AND created_at <= ?))${tenantId ? " AND tenant_id = ?" : ""}`,
    tenantId ? [iso, stale, tenantId] : [iso, stale]);
  for (const r of rows) {
    await removeParts(blobs, r.tenant_id, r.id);
    await sql.run("UPDATE exports SET status = ? WHERE tenant_id = ? AND id = ? AND status = ?", [r.status === "ready" ? "expired" : "failed", r.tenant_id, r.id, r.status]);
  }
  return rows.length;
}

function event(t: TenantDb, at: string, kind: string, actor: string, detail: Record<string, unknown>) {
  return t.insert("security_events", { id: `se_${at}_${randomToken(6).replace(/[^A-Za-z0-9]/g, "x")}`, at, kind, actor, detail_json: JSON.stringify(detail) });
}

/** Build a company's export into the store. Refused while another is open, and over the size limit (nothing is left). */
export async function stageExport(sql: Sql, blobs: Blobs, tenantId: string, by: string, now: Date, opts: { partRows?: number; maxBytes?: number } = {}): Promise<{ id: string; expires_at: string; parts: Part[]; bytes: number }> {
  const t = new TenantDb(sql, tenantId);
  await sweepExports(sql, blobs, now, tenantId);
  const iso = now.toISOString();
  const id = `x_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
  const expires_at = new Date(now.getTime() + EXPORT_KEEP_HOURS * 3_600_000).toISOString();
  // The guard goes first and is checked at commit: no other export is open (ready and unexpired, or still building).
  const guard = {
    sql: `INSERT INTO push_log (tenant_id, id, by_key, at) VALUES (?, ?, (SELECT 'no-open-export' WHERE (SELECT COUNT(*) FROM exports
        WHERE tenant_id = ? AND ((status = 'ready' AND expires_at > ?) OR (status = 'building' AND created_at > ?))) = 0), ?)`,
    params: [tenantId, `xg_${iso}_${crypto.randomUUID()}`, tenantId, iso, new Date(now.getTime() - BUILD_MINUTES * 60_000).toISOString(), iso],
  };
  try {
    await t.apply([guard, t.insert("exports", { id, status: "building", created_at: iso, expires_at, created_by: by, parts_json: "[]", bytes: 0, downloaded_at: null })]);
  } catch (e) {
    if (e instanceof WriteConflict) {
      const open = await t.select<{ id: string }>("exports", { status: { in: ["ready", "building"] } }, { order: ["created_at"], desc: true, limit: 1 });
      throw new ExportRefused(409, `an export of this company is already open${open[0] ? ` (${open[0].id}: GET /v1/export/staged/${open[0].id} gives fresh links)` : ""}; wait until it expires, a day after it was made`);
    }
    throw e;
  }
  const partRows = Math.max(1, Math.floor(opts.partRows ?? DEFAULT_PART_ROWS));
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const parts: Part[] = [];
  let total = 0;
  const fail = async (): Promise<never> => {
    await removeParts(blobs, tenantId, id);
    await t.apply([t.update("exports", { id }, { status: "failed" })]);
    throw new ExportRefused(413, `the export is larger than ${maxBytes} bytes; nothing was kept`);
  };
  // One table in memory at a time, written in parts; secrets stay out, as in GET /v1/export.
  for (const table of TENANT_TABLES) {
    const secret = SECRET_COLUMNS[table];
    const rows = (await t.select<Record<string, unknown>>(table)).map((r) => { if (!secret) return r; const copy = { ...r }; delete copy[secret]; return copy; });
    for (let n = 0, i = 0; i < rows.length || n === 0; n++, i += partRows) {
      const slice = rows.slice(i, i + partRows);
      const bytes = enc.encode(JSON.stringify(slice));
      total += bytes.byteLength;
      if (total > maxBytes) return fail();
      await blobs.put(partKey(tenantId, id, `${table}-${n}`), bytes, { kind: "export" });
      parts.push({ table, n, rows: slice.length, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) });
    }
  }
  const tenant = await sql.first("SELECT id, slug, name, created_at, closed_at, purge_after FROM tenants WHERE id = ?", [tenantId]);
  const docs = await t.select<{ sha256: string; filename: string; mime: string; size: number }>("documents", {}, { order: ["sha256"] });
  const manifest = { format: EXPORT_FORMAT, tenant, export_id: id, created_at: iso, parts,
    documents_to_fetch: docs.map((d) => ({ sha256: d.sha256, filename: d.filename, mime: d.mime, size: d.size, path: `/v1/documents/${d.sha256}` })) };
  const mbytes = enc.encode(JSON.stringify(manifest));
  if (total + mbytes.byteLength > maxBytes) return fail();
  await blobs.put(partKey(tenantId, id, "manifest"), mbytes, { kind: "export" });
  total += mbytes.byteLength;
  const made = await t.change(t.update("exports", { id, status: "building" }, { status: "ready", parts_json: JSON.stringify(parts), bytes: total }));
  if (made !== 1) {
    // A person was erased while this was built (red team 6): its rows may hold what was erased; nothing is kept.
    await removeParts(blobs, tenantId, id);
    throw new ExportRefused(409, "a person's data was erased while the export was being built; nothing was kept, ask for a new export");
  }
  await t.apply([event(t, iso, "export.staged", by, { export_id: id, parts: parts.length, bytes: total, expires_at })]);
  return { id, expires_at, parts, bytes: total };
}

const signed = (tenantId: string, id: string, part: string, exp: number) => `export|${tenantId}|${id}|${part}|${exp}`;

/** A link to one part (or "manifest") that holds for 15 minutes and fits only that part of that export of that company. */
export async function signedLink(origin: string, secret: string, tenantId: string, id: string, part: string, now: Date): Promise<{ url: string; expires_at: string }> {
  const exp = Math.floor(now.getTime() / 1000) + LINK_MINUTES * 60;
  const sig = await hmacB64u(secret, signed(tenantId, id, part, exp));
  return { url: `${origin}/v1/export/download/${id}/${part}?${new URLSearchParams({ t: tenantId, exp: String(exp), sig }).toString()}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** The export's state for its company, with fresh links while it is ready; an expired one is swept first. */
export async function exportStatus(sql: Sql, blobs: Blobs, origin: string, secret: string, tenantId: string, id: string, now: Date): Promise<Record<string, unknown>> {
  await sweepExports(sql, blobs, now, tenantId);
  const row = await new TenantDb(sql, tenantId).one<ExportRow>("exports", { id });
  if (!row) throw new ExportRefused(404, "no export");
  const out: Record<string, unknown> = { id, status: row.status, created_at: row.created_at, expires_at: row.expires_at, bytes: row.bytes, parts: (JSON.parse(row.parts_json) as Part[]).length, downloaded_at: row.downloaded_at };
  if (row.status === "ready") {
    const l = await signedLink(origin, secret, tenantId, id, "manifest", now);
    out.manifest_url = l.url;
    out.link_expires_at = l.expires_at;
  }
  return out;
}

/**
 * A signed download: the link must be unchanged and unexpired, and the export ready. The manifest comes with a fresh link
 * per part (same 15 minutes); fetching it is recorded as a download.
 */
export async function download(sql: Sql, blobs: Blobs, origin: string, secret: string, id: string, part: string, q: URLSearchParams, now: Date): Promise<{ status: number; body: Uint8Array | string; json: boolean }> {
  const tenantId = q.get("t") ?? "";
  const exp = Number(q.get("exp") ?? "");
  const sig = q.get("sig") ?? "";
  const refused = { status: 403, body: JSON.stringify({ error: "this link is not valid or has expired; ask for a fresh one (GET /v1/export/staged/{id})", code: "forbidden" }), json: true };
  if (!/^t_[A-Za-z0-9_-]{6,64}$/.test(tenantId) || !Number.isSafeInteger(exp) || !sig) return refused;
  if (exp * 1000 <= now.getTime() || exp * 1000 > now.getTime() + (LINK_MINUTES + 1) * 60_000) return refused;
  if (!(await hmacValid(secret, signed(tenantId, id, part, exp), sig))) return refused;
  // A closed company's access has ended, its links with it.
  const company = await sql.first<{ closed_at: string | null }>("SELECT closed_at FROM tenants WHERE id = ?", [tenantId]);
  if (!company || company.closed_at) return refused;
  const t = new TenantDb(sql, tenantId);
  const row = await t.one<ExportRow>("exports", { id });
  if (!row || row.status !== "ready" || row.expires_at <= now.toISOString()) return { status: 404, body: JSON.stringify({ error: "no such export (it may have expired)", code: "not_found" }), json: true };
  const bytes = await blobs.get(partKey(tenantId, id, part));
  if (!bytes) return { status: 404, body: JSON.stringify({ error: "no such part", code: "not_found" }), json: true };
  // Every part fetched is on record for the owners (red team 6: only the manifest was), with the part it was.
  if (part !== "manifest") {
    await t.apply([event(t, now.toISOString(), "export.part_downloaded", "signed link", { export_id: id, part })]);
    return { status: 200, body: bytes, json: true };
  }
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as { parts: (Part & { url?: string })[] };
  for (const p of manifest.parts) p.url = (await signedLink(origin, secret, tenantId, id, `${p.table}-${p.n}`, now)).url;
  const iso = now.toISOString();
  await t.apply([t.update("exports", { id }, { downloaded_at: iso }), event(t, iso, "export.downloaded", "signed link", { export_id: id })]);
  return { status: 200, body: JSON.stringify(manifest), json: true };
}

/**
 * After an erasure (red team 6): the company's open exports hold the erased person's data as it was, so they end now.
 * Their status is set in the erasure's own write (src/privacy.ts); here their parts leave the store.
 */
export async function purgeEndedExportParts(sql: Sql, blobs: Blobs, tenantId: string): Promise<number> {
  const rows = await new TenantDb(sql, tenantId).select<{ id: string }>("exports", { status: { in: ["expired", "failed"] } });
  for (const r of rows) await removeParts(blobs, tenantId, r.id);
  return rows.length;
}
