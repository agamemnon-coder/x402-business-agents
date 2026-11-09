// The runner's push: everything Purser records, into the cloud, so the company's data lives in one place. Idempotent:
// the same object again changes nothing. Ledger entries and audit rows are append-only and must continue the cloud's
// chain; a posted one that comes back changed is refused. Vendors, invoices and payments are versioned: a new version
// replaces the current one and the earlier one is kept; so are the rows of the transactions register. A document is stored under the SHA-256 of its own bytes.
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
/** A real calendar day (2027-02-31 is refused), alone or at the start of a timestamp. */
const isRealDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return !!m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === m[0];
};
const DAY = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}/, "a date is YYYY-MM-DD").refine(isRealDay, "not a real day");
/** An ISO timestamp (or a bare day): a real day, and a time Date can read. */
const STAMP = DAY.refine((s) => !Number.isNaN(Date.parse(s)), "not a timestamp");
const SHA = z.string().regex(/^[0-9a-f]{64}$/);
const Body = z.record(z.string(), z.unknown());
/** Cents: whole, and far below 2^53, so a sum of a few thousand lines stays exact; the balance is summed as BigInt anyway. */
const MAX_CENTS = 10_000_000_000_000;
const CENTS = z.number().int().min(0).max(MAX_CENTS);
const Line = z.object({
  line_no: z.number().int().min(1).max(10_000), account: z.string().regex(/^\d{4}$/), debit_cents: CENTS, credit_cents: CENTS, currency: z.string().regex(/^[A-Z]{3,4}$/),
  cost_centre: z.string().nullable(), vat_code: z.string().nullable(), vat_cents: z.number().int().min(-MAX_CENTS).max(MAX_CENTS).nullable(), party: z.string().nullable(), due_date: DAY.nullable(), doc_ref: z.string().nullable(), memo: z.string().nullable(),
}).strict();
const JSON_TEXT = z.string().refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, "not JSON");

// Passkeys are never part of a push (security review of 8 November): a sync key that could bring a credential could
// sign in as anyone, the owner included. People enrol in the cloud itself (POST /v1/auth/enrol).
export const SyncBatch = z.object({
  vendors: z.array(z.object({ id: ID, name: z.string().min(1).max(200), status: z.string().max(40), updated_at: STAMP, body: Body }).strict()).max(5000).default([]),
  invoices: z.array(z.object({
    id: ID, vendor: z.string().max(200), invoice_no: z.string().max(120), due_date: z.union([z.literal(""), DAY]), currency: z.string().max(4), total: z.string().max(24),
    status: z.string().max(40), doc_sha256: SHA, received_at: STAMP, updated_at: STAMP, body: Body,
  }).strict()).max(5000).default([]),
  payments: z.array(z.object({ id: ID, invoice_id: ID.nullable(), status: z.string().max(40), updated_at: STAMP, body: Body }).strict()).max(5000).default([]),
  // The transactions register (src/money/register.ts): derived on the runner, kept here as versioned rows.
  transactions: z.array(z.object({
    id: ID, at: STAMP, rail: z.string().regex(/^[a-z_]{2,40}$/), direction: z.enum(["in", "out", "internal"]), currency: z.string().regex(/^[A-Z]{3,4}$/),
    moved: z.boolean(), reconciliation: z.enum(["matched", "missing_booking", "missing_rail_record", "amount_mismatch", "not_applicable"]), body: Body,
  }).strict()).max(5000).default([]),
  documents: z.array(z.object({ sha256: SHA, filename: z.string().min(1).max(200), mime: z.string().max(100), base64: z.string() }).strict()).max(200).default([]),
  ledger_entries: z.array(z.object({
    entry_id: z.number().int().positive(), posting_date: DAY, doc_date: DAY, description: z.string().max(500), source_key: z.string().nullable(), doc_ref: z.string().nullable(),
    doc_sha256: z.string().nullable(), created_by: z.string(), reverses: z.number().int().nullable(), created_at: STAMP, prev_hash: SHA, entry_hash: SHA, lines: z.array(Line).min(2).max(1000),
  }).strict()).max(5000).default([]),
  audit_rows: z.array(z.object({ seq: z.number().int().positive(), ts: STAMP, actor: z.string(), event: z.string(), subject: z.string().nullable(), payload_json: JSON_TEXT, prev_hash: SHA, row_hash: SHA }).strict()).max(20000).default([]),
}).strict();
export type SyncBatch = z.infer<typeof SyncBatch>;

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export interface SyncResult { [kind: string]: { added: number; changed: number; unchanged: number } }

const tally = () => ({ added: 0, changed: 0, unchanged: 0 });

export function docBlobKey(tenantId: string, sha: string): string { return `t/${tenantId}/docs/${sha}`; }

/** Versioned objects: same body, nothing; a new body, the old one to history and the new one in place. */
async function versioned(db: TenantDb, table: Extract<Table, "vendors" | "invoices" | "payments" | "transactions">, kind: string, rows: { id: string; body: Record<string, unknown> }[], cols: (r: never) => Record<string, string | number | null>, now: string, out: Stmt[], t: { added: number; changed: number; unchanged: number }): Promise<void> {
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
      // The hash it comes with must be the stored one, and its content must still hash to it: a row whose content
      // changed under its old hash is refused, never counted as unchanged.
      if (h !== own(r) || (await recompute(r)) !== own(r)) throw new SyncRefused(409, `${what} ${n(r)} changed after it was pushed; a posted record is corrected with a new, reversing one, never edited`);
      unchanged += 1;
    } else fresh.push(r);
  }
  const broken = await continues(fresh, head, n, own, recompute);
  if (broken) throw new SyncRefused(409, `${what}s do not continue the cloud's chain: ${broken}`);
  return { fresh, unchanged };
}

/** The same id twice in one push is refused before anything is read or written. */
function noDuplicates(batch: SyncBatch): void {
  const twice = (what: string, ids: (string | number)[]) => {
    const seen = new Set<string | number>();
    for (const id of ids) {
      if (seen.has(id)) throw new SyncRefused(422, `${what} ${id} is in this push twice`);
      seen.add(id);
    }
  };
  twice("vendor", batch.vendors.map((v) => v.id));
  twice("invoice", batch.invoices.map((i) => i.id));
  twice("payment", batch.payments.map((p) => p.id));
  twice("transaction", batch.transactions.map((t) => t.id));
  twice("document", batch.documents.map((d) => d.sha256));
  twice("ledger entry", batch.ledger_entries.map((e) => e.entry_id));
  twice("audit row", batch.audit_rows.map((r) => r.seq));
  for (const e of batch.ledger_entries) {
    const lines = new Set<number>();
    for (const l of e.lines) {
      if (lines.has(l.line_no)) throw new SyncRefused(422, `ledger entry ${e.entry_id} has line ${l.line_no} twice`);
      lines.add(l.line_no);
    }
  }
}

/** Balanced per currency, summed exactly (BigInt), so no amount can tip a sum past what floats hold. */
function balances(e: LedgerEntryIn): boolean {
  const net = new Map<string, bigint>();
  for (const l of e.lines) net.set(l.currency, (net.get(l.currency) ?? 0n) + BigInt(l.debit_cents) - BigInt(l.credit_cents));
  return [...net.values()].every((v) => v === 0n);
}

export async function applySync(db: TenantDb, blobs: Blobs, batch: SyncBatch, now: Date): Promise<SyncResult> {
  const iso = now.toISOString();
  const out: Stmt[] = [];
  const res: SyncResult = { documents: tally(), vendors: tally(), invoices: tally(), payments: tally(), transactions: tally(), ledger_entries: tally(), audit_rows: tally() };
  noDuplicates(batch);

  // Documents: the bytes must hash to the name they are sent under. They are stored only once the whole push has
  // passed every check (a refused push leaves no bytes behind), and removed again if the database write fails.
  const docs = new Set<string>();
  const toStore: { key: string; bytes: Uint8Array; meta: Record<string, string> }[] = [];
  for (const d of batch.documents) {
    const bytes = fromB64(d.base64);
    if (bytes.length > MAX_DOCUMENT_BYTES) throw new SyncRefused(422, `document ${d.sha256} is larger than 16 MB`);
    if ((await sha256Hex(bytes)) !== d.sha256) throw new SyncRefused(422, `document ${d.filename}: its bytes do not hash to ${d.sha256}`);
    docs.add(d.sha256);
    if (await db.one("documents", { sha256: d.sha256 })) { res.documents!.unchanged += 1; continue; }
    const key = docBlobKey(db.tenantId, d.sha256);
    toStore.push({ key, bytes, meta: { filename: d.filename.slice(0, 200), mime: d.mime } });
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
  await versioned(db, "transactions", "transaction", batch.transactions, (r: SyncBatch["transactions"][number]) => ({
    sort_key: `${r.at}|${r.id}`, at: r.at, rail: r.rail, direction: r.direction, currency: r.currency, moved: r.moved ? 1 : 0, reconciliation: r.reconciliation,
  }), iso, out, res.transactions!);

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
    if (!balances(e)) throw new SyncRefused(422, `ledger entry ${e.entry_id} does not balance`);
    out.push(db.insert("ledger_entries", { entry_id: e.entry_id, posting_date: e.posting_date, doc_date: e.doc_date, description: e.description, entry_json: JSON.stringify(e), prev_hash: e.prev_hash, entry_hash: e.entry_hash }));
    for (const l of e.lines) {
      out.push(db.insert("ledger_lines", {
        entry_id: e.entry_id, line_no: l.line_no, posting_date: e.posting_date, account: l.account, currency: l.currency, debit_cents: l.debit_cents, credit_cents: l.credit_cents,
        vat_code: l.vat_code, vat_cents: l.vat_cents, party: l.party, doc_ref: l.doc_ref, due_date: l.due_date,
      }));
    }
  }
  res.ledger_entries = { added: ledger.fresh.length, changed: 0, unchanged: ledger.unchanged };

  // Every check passed: the bytes first (a row never points at bytes that are not there), then the rows in one
  // transaction; if that fails, the bytes stored for this push are removed again.
  const stored: { key: string; sha: string }[] = [];
  try {
    for (const b of toStore) { await blobs.put(b.key, b.bytes, b.meta); stored.push({ key: b.key, sha: b.key.slice(b.key.lastIndexOf("/") + 1) }); }
    await db.apply(out);
  } catch (e) {
    // Bytes a concurrent push has meanwhile committed a row for (same content, same key) are kept.
    for (const s of stored) if (!(await db.one("documents", { sha256: s.sha }).catch(() => null))) await blobs.delete(s.key).catch(() => undefined);
    throw e;
  }
  return res;
}
