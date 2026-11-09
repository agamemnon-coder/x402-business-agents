// Restore: a company's export (GET /v1/export plus each document from /v1/documents/{sha256}) imported into a company
// that holds nothing yet, in this database or a fresh one. Both hash chains are checked before anything is written and
// every document is checked against its SHA-256. Secrets do not travel: API keys, enrolments and the webhook's secret
// are not in an export, so the restored company's owners make new keys and set the webhook again.

import { auditRowHash, continues, GENESIS, ledgerEntryHash, type AuditRowIn, type LedgerEntryIn } from "./chains.js";
import { sha256Hex } from "./crypto.js";
import type { Blobs, Sql, SqlValue } from "./store.js";
import { docBlobKey } from "./sync.js";
import { TENANT_TABLES, TenantDb, type Table } from "./tenant.js";

export class RestoreRefused extends Error {}

/** Tables a restore does not write: their rows carry secrets the export leaves out, the target already has its own, or (exports) they point at parts that were not restored. */
const NOT_RESTORED = new Set<Table>(["api_keys", "enrolments", "webhooks", "exports"]);
/** The bookkeeping tables: the target must hold none of these yet. */
const BOOKS: Table[] = ["vendors", "invoices", "payments", "transactions", "documents", "ledger_entries", "audit_rows"];

/** Null when both chains in an export verify from their genesis; otherwise what is wrong. */
export async function verifyChains(data: Record<string, unknown>): Promise<string | null> {
  const audit = [...((data.audit_rows ?? []) as AuditRowIn[])].sort((x, y) => x.seq - y.seq);
  const a = await continues(audit, { n: 0, hash: GENESIS }, (r) => r.seq, (r) => r.row_hash, auditRowHash);
  if (a) return `audit chain: ${a}`;
  const rows = [...((data.ledger_entries ?? []) as { entry_id: number; entry_json: string; prev_hash: string; entry_hash: string }[])].sort((x, y) => x.entry_id - y.entry_id);
  const entries: LedgerEntryIn[] = [];
  for (const r of rows) {
    const e = JSON.parse(r.entry_json) as LedgerEntryIn;
    if (e.entry_id !== r.entry_id || e.prev_hash !== r.prev_hash || e.entry_hash !== r.entry_hash) return `ledger entry ${r.entry_id}: its columns differ from its body`;
    entries.push(e);
  }
  const l = await continues(entries, { n: 0, hash: GENESIS }, (e) => e.entry_id, (e) => e.entry_hash, ledgerEntryHash);
  return l ? `ledger chain: ${l}` : null;
}

/**
 * A staged export (POST /v1/export/staged: a manifest and its parts) joined back into the one-object form importTenant
 * reads: each table's parts in order. `partOf` gives a part's rows by its name (`<table>-<n>`).
 */
export function joinStagedExport(manifest: { format: string; tenant: unknown; parts: { table: string; n: number }[]; documents_to_fetch: unknown[] }, partOf: (name: string) => unknown[]): Record<string, unknown> {
  if (manifest.format !== "purser-cloud-export/v3-staged") throw new RestoreRefused(`not a staged Purser Cloud export (format ${JSON.stringify(manifest.format)})`);
  const out: Record<string, unknown> = { format: "purser-cloud-export/v2", tenant: manifest.tenant };
  for (const p of [...manifest.parts].sort((a, b) => a.n - b.n)) out[p.table] = [...((out[p.table] as unknown[] | undefined) ?? []), ...partOf(`${p.table}-${p.n}`)];
  out.documents_to_fetch = manifest.documents_to_fetch;
  return out;
}

export async function importTenant(sql: Sql, blobs: Blobs, data: Record<string, unknown>, docs: Record<string, Uint8Array>, target: { tenantId: string; now: Date }): Promise<{ rows: number; documents: number }> {
  if (data.format !== "purser-cloud-export/v2") throw new RestoreRefused(`not a Purser Cloud export (format ${JSON.stringify(data.format)})`);
  const broken = await verifyChains(data);
  if (broken) throw new RestoreRefused(`the backup's ${broken}; nothing was restored`);
  const db = new TenantDb(sql, target.tenantId);
  for (const t of BOOKS) if ((await db.count(t)) > 0) throw new RestoreRefused("this company already holds data; restore into a new, empty company");
  // Every document is there and is what its hash says, before a single row is written.
  const documents = (data.documents ?? []) as { sha256: string }[];
  for (const d of documents) {
    const bytes = docs[d.sha256];
    if (!bytes) throw new RestoreRefused(`document ${d.sha256} is missing from the backup`);
    if ((await sha256Hex(bytes)) !== d.sha256) throw new RestoreRefused(`document ${d.sha256}: its bytes do not match its hash`);
  }
  const haveUsers = new Set((await db.select<{ id: string }>("users")).map((u) => u.id));
  const stmts = [];
  for (const table of TENANT_TABLES) {
    if (NOT_RESTORED.has(table)) continue;
    for (const raw of (data[table] ?? []) as Record<string, SqlValue>[]) {
      const row = { ...raw };
      delete row.tenant_id;
      if (table === "users" && haveUsers.has(String(row.id))) continue;
      if (table === "documents") row.blob_key = docBlobKey(target.tenantId, String(row.sha256));
      // Raw mail is not in an export; its row is kept (what came in and what was done with it) and points at the new
      // company's place, where nothing is stored: mail still queued at the time of the backup must be sent again.
      if (table === "inbound_mail" && typeof row.blob_key === "string") row.blob_key = row.blob_key.replace(/^t\/[^/]+\//, `t/${target.tenantId}/`);
      stmts.push(db.insert(table, row));
    }
  }
  for (const d of documents) await blobs.put(docBlobKey(target.tenantId, d.sha256), docs[d.sha256]!, { kind: "document" });
  // In parts (D1 limits a batch's size); each part is a transaction. A failure part-way leaves a company that is
  // not empty, so a second attempt is refused: restore again into a new company.
  for (let i = 0; i < stmts.length; i += 50) await db.apply(stmts.slice(i, i + 50));
  return { rows: stmts.length, documents: documents.length };
}
