// The runner's push: everything Purser records, into the cloud, so the company's data lives in one place. Idempotent:
// the same object again changes nothing. Ledger entries and audit rows are append-only and must continue the cloud's
// chain; a posted one that comes back changed is refused. Vendors, invoices and payments are versioned: a new version
// replaces the current one and the earlier one is kept. A document is stored under the SHA-256 of its own bytes.
// All rows of a push are written in one transaction.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { z } from "zod";
import { auditRowHash, continues, GENESIS, ledgerEntryHash, type AuditRowIn, type LedgerEntryIn } from "./chains.js";
import { fromB64, sha256Hex } from "./crypto.js";
import type { Blobs } from "./store.js";
import type { Stmt, Table, TenantDb } from "./tenant.js";

export class SyncRefused extends Error {
  constructor(readonly status: 409 | 422, message: string) { super(message); }
}

const ID = z.string().min(1).max(120);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}/);
const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Body = z.record(z.string(), z.unknown());
const Line = z.object({
  line_no: z.number().int(), account: z.string().regex(/^\d{4}$/), debit_cents: z.number().int().min(0), credit_cents: z.number().int().min(0), currency: z.string().regex(/^[A-Z]{3,4}$/),
  cost_centre: z.string().nullable(), vat_code: z.string().nullable(), vat_cents: z.number().int().nullable(), party: z.string().nullable(), due_date: z.string().nullable(), doc_ref: z.string().nullable(), memo: z.string().nullable(),
}).strict();

export const SyncBatch = z.object({
  vendors: z.array(z.object({ id: ID, name: z.string().min(1).max(200), status: z.string().max(40), updated_at: z.string(), body: Body }).strict()).max(5000).default([]),
  invoices: z.array(z.object({
    id: ID, vendor: z.string().max(200), invoice_no: z.string().max(120), due_date: z.string().max(10), currency: z.string().max(4), total: z.string().max(24),
    status: z.string().max(40), doc_sha256: SHA, received_at: z.string(), updated_at: z.string(), body: Body,
  }).strict()).max(5000).default([]),
  payments: z.array(z.object({ id: ID, invoice_id: ID.nullable(), status: z.string().max(40), updated_at: z.string(), body: Body }).strict()).max(5000).default([]),
  documents: z.array(z.object({ sha256: SHA, filename: z.string().min(1).max(200), mime: z.string().max(100), base64: z.string() }).strict()).max(200).default([]),
  ledger_entries: z.array(z.object({
    entry_id: z.number().int().positive(), posting_date: DAY, doc_date: DAY, description: z.string().max(500), source_key: z.string().nullable(), doc_ref: z.string().nullable(),
    doc_sha256: z.string().nullable(), created_by: z.string(), reverses: z.number().int().nullable(), created_at: z.string(), prev_hash: SHA, entry_hash: SHA, lines: z.array(Line).min(2),
  }).strict()).max(5000).default([]),
  audit_rows: z.array(z.object({ seq: z.number().int().positive(), ts: z.string(), actor: z.string(), event: z.string(), subject: z.string().nullable(), payload_json: z.string(), prev_hash: SHA, row_hash: SHA }).strict()).max(20000).default([]),
  credentials: z.array(z.object({ credential_id: z.string().min(8).max(400), user_id: ID, x: z.string().min(40).max(50), y: z.string().min(40).max(50), counter: z.number().int().min(0) }).strict()).max(50).default([]),
}).strict();
export type SyncBatch = z.infer<typeof SyncBatch>;

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export interface SyncResult { [kind: string]: { added: number; changed: number; unchanged: number } }

const tally = () => ({ added: 0, changed: 0, unchanged: 0 });

export function docBlobKey(tenantId: string, sha: string): string { return `t/${tenantId}/docs/${sha}`; }

/** Versioned objects: same body, nothing; a new body, the old one to history and the new one in place. */
async function versioned(db: TenantDb, table: Extract<Table, "vendors" | "invoices" | "payments">, kind: string, rows: { id: string; body: Record<string, unknown> }[], cols: (r: never) => Record<string, string | number | null>, now: string, out: Stmt[], t: { added: number; changed: number; unchanged: number }): Promise<void> {
  for (const r of rows) {
    const bodyJson = jcs(r.body as Json);
    const sha = await sha256Hex(bodyJson);
    const cur = await db.one<{ version: number; body_json: string; body_sha256: string }>(table, { id: r.id });
    if (cur && cur.body_sha256 === sha) { t.unchanged += 1; continue; }
    const extra = cols(r as never);
    if (!cur) {
      out.push(db.insert(table, { id: r.id, ...extra, version: 1, body_json: bodyJson, body_sha256: sha }));
      t.added += 1;
      continue;
    }
    out.push(db.insert("object_history", { kind, id: r.id, version: cur.version, body_json: cur.body_json, body_sha256: cur.body_sha256, replaced_at: now }));
    out.push(db.update(table, { id: r.id }, { ...extra, version: cur.version + 1, body_json: bodyJson, body_sha256: sha }));
    t.changed += 1;
  }
}

/** Splits a pushed chain into the part the cloud already holds (it must match) and the part that continues it. */
async function chainPart<T extends { prev_hash: string }>(rows: T[], n: (r: T) => number, own: (r: T) => string, stored: (num: number) => Promise<string | null>, head: { n: number; hash: string }, recompute: (r: T) => Promise<string>, what: string): Promise<{ fresh: T[]; unchanged: number }> {
  const sorted = [...rows].sort((a, b) => n(a) - n(b));
  let unchanged = 0;
  const fresh: T[] = [];
  for (const r of sorted) {
    if (n(r) <= head.n) {
      const h = await stored(n(r));
      if (h !== own(r)) throw new SyncRefused(409, `${what} ${n(r)} changed after it was pushed; a posted record is corrected with a new, reversing one, never edited`);
      unchanged += 1;
    } else fresh.push(r);
  }
  const broken = await continues(fresh, head, n, own, recompute);
  if (broken) throw new SyncRefused(409, `${what}s do not continue the cloud's chain: ${broken}`);
  return { fresh, unchanged };
}

export async function applySync(db: TenantDb, blobs: Blobs, batch: SyncBatch, now: Date): Promise<SyncResult> {
  const iso = now.toISOString();
  const out: Stmt[] = [];
  const res: SyncResult = { documents: tally(), vendors: tally(), invoices: tally(), payments: tally(), ledger_entries: tally(), audit_rows: tally(), credentials: tally() };

  // Documents: the bytes must hash to the name they are sent under.
  const docs = new Set<string>();
  for (const d of batch.documents) {
    const bytes = fromB64(d.base64);
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new SyncRefused(422, `document ${d.sha256} is larger than 16 MB`);
    if ((await sha256Hex(bytes)) !== d.sha256) throw new SyncRefused(422, `document ${d.filename}: its bytes do not hash to ${d.sha256}`);
    docs.add(d.sha256);
    if (await db.one("documents", { sha256: d.sha256 })) { res.documents!.unchanged += 1; continue; }
    const key = docBlobKey(db.tenantId, d.sha256);
    await blobs.put(key, bytes, { filename: d.filename.slice(0, 200), mime: d.mime });
    out.push(db.insert("documents", { sha256: d.sha256, filename: d.filename, mime: d.mime, size: bytes.length, blob_key: key, received_at: iso }));
    res.documents!.added += 1;
  }

  for (const inv of batch.invoices) {
    if (!docs.has(inv.doc_sha256) && !(await db.one("documents", { sha256: inv.doc_sha256 }))) throw new SyncRefused(422, `invoice ${inv.id} names document ${inv.doc_sha256}, which the cloud does not hold; push the document with it`);
  }
  await versioned(db, "vendors", "vendor", batch.vendors, (r: SyncBatch["vendors"][number]) => ({ name: r.name, status: r.status, updated_at: r.updated_at }), iso, out, res.vendors!);
  await versioned(db, "invoices", "invoice", batch.invoices, (r: SyncBatch["invoices"][number]) => ({
    vendor: r.vendor, invoice_no: r.invoice_no, due_date: r.due_date, currency: r.currency, total: r.total, status: r.status, doc_sha256: r.doc_sha256, received_at: r.received_at, updated_at: r.updated_at,
  }), iso, out, res.invoices!);
  await versioned(db, "payments", "payment", batch.payments, (r: SyncBatch["payments"][number]) => ({ invoice_id: r.invoice_id, status: r.status, updated_at: r.updated_at }), iso, out, res.payments!);

  // The audit log: append-only, continuing the cloud's chain.
  const lastAudit = (await db.select<{ seq: number; row_hash: string }>("audit_rows", {}, { order: ["seq"], desc: true, limit: 1 }))[0];
  const audit = await chainPart<AuditRowIn>(batch.audit_rows, (r) => r.seq, (r) => r.row_hash,
    async (seq) => (await db.one<{ row_hash: string }>("audit_rows", { seq }))?.row_hash ?? null,
    { n: lastAudit?.seq ?? 0, hash: lastAudit?.row_hash ?? GENESIS }, auditRowHash, "audit row");
  for (const r of audit.fresh) out.push(db.insert("audit_rows", { seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload_json: r.payload_json, prev_hash: r.prev_hash, row_hash: r.row_hash }));
  res.audit_rows = { added: audit.fresh.length, changed: 0, unchanged: audit.unchanged };

  // The ledger: the same, and every entry must balance per currency.
  const lastEntry = (await db.select<{ entry_id: number; entry_hash: string }>("ledger_entries", {}, { order: ["entry_id"], desc: true, limit: 1 }))[0];
  const ledger = await chainPart<LedgerEntryIn>(batch.ledger_entries, (e) => e.entry_id, (e) => e.entry_hash,
    async (id) => (await db.one<{ entry_hash: string }>("ledger_entries", { entry_id: id }))?.entry_hash ?? null,
    { n: lastEntry?.entry_id ?? 0, hash: lastEntry?.entry_hash ?? GENESIS }, ledgerEntryHash, "ledger entry");
  for (const e of ledger.fresh) {
    const net = new Map<string, number>();
    for (const l of e.lines) net.set(l.currency, (net.get(l.currency) ?? 0) + l.debit_cents - l.credit_cents);
    if ([...net.values()].some((v) => v !== 0)) throw new SyncRefused(422, `ledger entry ${e.entry_id} does not balance`);
    out.push(db.insert("ledger_entries", { entry_id: e.entry_id, posting_date: e.posting_date, doc_date: e.doc_date, description: e.description, entry_json: JSON.stringify(e), prev_hash: e.prev_hash, entry_hash: e.entry_hash }));
    for (const l of e.lines) {
      out.push(db.insert("ledger_lines", {
        entry_id: e.entry_id, line_no: l.line_no, posting_date: e.posting_date, account: l.account, currency: l.currency, debit_cents: l.debit_cents, credit_cents: l.credit_cents,
        vat_code: l.vat_code, vat_cents: l.vat_cents, party: l.party, doc_ref: l.doc_ref, due_date: l.due_date,
      }));
    }
  }
  res.ledger_entries = { added: ledger.fresh.length, changed: 0, unchanged: ledger.unchanged };

  // Passkeys the runner enrolled (it verified each enrolment itself): only for people the company added, and a
  // credential's key never changes once pushed.
  for (const c of batch.credentials) {
    const user = await db.one<{ erased_at: string | null }>("users", { id: c.user_id });
    if (!user || user.erased_at) throw new SyncRefused(422, `credential ${c.credential_id.slice(0, 12)}…: no person ${c.user_id} in this company`);
    const cur = await db.one<{ x: string; y: string; counter: number }>("credentials", { credential_id: c.credential_id });
    if (cur && (cur.x !== c.x || cur.y !== c.y)) throw new SyncRefused(409, `credential ${c.credential_id.slice(0, 12)}… was pushed before with another public key`);
    if (cur) { res.credentials!.unchanged += 1; continue; }
    out.push(db.insert("credentials", { credential_id: c.credential_id, user_id: c.user_id, x: c.x, y: c.y, counter: c.counter, created_at: iso }));
    res.credentials!.added += 1;
  }

  await db.apply(out);
  return res;
}
