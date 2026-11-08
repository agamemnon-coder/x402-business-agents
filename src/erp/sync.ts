// The ERP sync runner (ERP connectors design, 8 November). It sends what changed, in dependency order (vendors,
// then invoices, then payments, then journal entries), and keeps per connector and object the ERP's id, the hash of
// what was sent and a status in `erp_sync`:
//   - unchanged since it was sent: skipped;
//   - changed after it was sent: never overwritten, marked needs_correction; `correct` then sends a credit note (or a
//     reversing entry) and the new version, as accounting rules ask; a vendor or a payment goes to a person;
//   - an answer that never came (a network error, a server error), or a row a crashed run left 'pending': the ERP is
//     asked first whether it already holds the object, so nothing is ever posted twice;
//   - retryable errors (rate limit, server, network) are retried with back-off, honouring Retry-After.
// Every result goes into the audit log. A dry run writes nothing.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { ErpError, type ErpConnector, type RefResolver } from "./connector.js";
import { contentHash, validate, type CanonicalObject, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type Vendor } from "./model.js";

export interface SyncItem { kind: ObjectKind; object: CanonicalObject }
export type SyncOutcome = "pushed" | "found_existing" | "unchanged" | "waiting" | "needs_correction" | "failed" | "invalid" | "corrected";
export interface SyncResult { kind: ObjectKind; id: string; outcome: SyncOutcome; externalId?: string; detail?: string }
export interface SyncOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  dryRun?: boolean;
}

export interface SyncRow {
  connector: string;
  kind: ObjectKind;
  object_id: string;
  external_id: string | null;
  pushed_hash: string | null;
  pushed_json: string | null;
  pending_hash: string | null;
  status: "pending" | "synced" | "failed" | "needs_correction";
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

const ORDER: ObjectKind[] = ["vendor", "invoice", "payment", "journal"];

export function ensureErpSchema(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS erp_sync (
    connector TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vendor', 'invoice', 'payment', 'journal')),
    object_id TEXT NOT NULL,
    external_id TEXT,
    pushed_hash TEXT,
    pushed_json TEXT,
    pending_hash TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'synced', 'failed', 'needs_correction')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (connector, kind, object_id)
  )`);
}

/** Where the runner keeps its rows: the ledger, or (dry run) a map that disappears with the run. */
interface Store {
  get(kind: ObjectKind, id: string): SyncRow | undefined;
  put(row: SyncRow): void;
  log(event: string, subject: string, payload: Record<string, string | number | null>): void;
}

function dbStore(db: DB, connector: string, now: () => Date): Store {
  ensureErpSchema(db);
  return {
    get: (kind, id) => db.prepare("SELECT * FROM erp_sync WHERE connector = ? AND kind = ? AND object_id = ?").get(connector, kind, id) as SyncRow | undefined,
    put: (r) => {
      db.prepare(`INSERT INTO erp_sync (connector, kind, object_id, external_id, pushed_hash, pushed_json, pending_hash, status, attempts, last_error, updated_at)
        VALUES (@connector, @kind, @object_id, @external_id, @pushed_hash, @pushed_json, @pending_hash, @status, @attempts, @last_error, @updated_at)
        ON CONFLICT (connector, kind, object_id) DO UPDATE SET external_id = excluded.external_id, pushed_hash = excluded.pushed_hash,
          pushed_json = excluded.pushed_json, pending_hash = excluded.pending_hash, status = excluded.status, attempts = excluded.attempts,
          last_error = excluded.last_error, updated_at = excluded.updated_at`).run(r);
    },
    log: (event, subject, payload) => { audit(db, "system", event, subject, { connector, ...payload }, now()); },
  };
}

function memoryStore(): Store {
  const rows = new Map<string, SyncRow>();
  return { get: (k, id) => rows.get(`${k}:${id}`), put: (r) => { rows.set(`${r.kind}:${r.object_id}`, r); }, log: () => {} };
}

/** The object as it was sent, for a later correction: without the PDF bytes or the full IBAN. */
function sentJson(kind: ObjectKind, o: CanonicalObject): string {
  if (kind === "invoice") { const { pdf, ...rest } = o as PurchaseInvoice; return JSON.stringify({ ...rest, pdf: pdf ? { fileName: pdf.fileName } : null }); }
  if (kind === "vendor") { const { iban: _iban, ...rest } = o as Vendor; return JSON.stringify(rest); }
  return JSON.stringify(o);
}

function resolver(store: Store): RefResolver {
  const ext = (kind: ObjectKind, id: string) => {
    const r = store.get(kind, id);
    return r && (r.status === "synced" || r.status === "needs_correction") ? r.external_id : null;
  };
  return { vendor: (id) => ext("vendor", id), invoice: (id) => ext("invoice", id) };
}

/** What `object` still waits for in the ERP, or null. */
function missingDependency(kind: ObjectKind, o: CanonicalObject, refs: RefResolver): string | null {
  if (kind === "invoice" && !refs.vendor((o as PurchaseInvoice).vendorId)) return `vendor ${(o as PurchaseInvoice).vendorId} is not in the ERP yet`;
  if (kind === "payment") {
    const p = o as Payment;
    if (!refs.invoice(p.invoiceId)) return `invoice ${p.invoiceId} is not in the ERP yet`;
    if (!refs.vendor(p.vendorId)) return `vendor ${p.vendorId} is not in the ERP yet`;
  }
  return null;
}

function push(c: ErpConnector, kind: ObjectKind, o: CanonicalObject, refs: RefResolver): Promise<string> {
  switch (kind) {
    case "vendor": return c.pushVendor(o as Vendor);
    case "invoice": return c.pushPurchaseInvoice(o as PurchaseInvoice, refs);
    case "payment": return c.pushPayment(o as Payment, refs);
    case "journal": return c.pushJournalEntry(o as JournalEntry);
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Sends one object with retries. Before a retry that follows an answer that never came, and before the first try when
 * an earlier run left the object pending or failed, it asks the ERP whether the object is already there.
 */
async function sendOnce(c: ErpConnector, item: SyncItem, refs: RefResolver, lookFirst: boolean, o: Required<Pick<SyncOptions, "maxAttempts" | "baseDelayMs" | "sleep">>):
  Promise<{ ok: true; externalId: string; found: boolean; attempts: number } | { ok: false; error: string; attempts: number }> {
  let attempts = 0;
  let look = lookFirst;
  for (;;) {
    if (look) {
      const found = await c.findExisting(item.kind, item.object, refs);
      if (found) return { ok: true, externalId: found, found: true, attempts };
    }
    attempts++;
    try {
      return { ok: true, externalId: await push(c, item.kind, item.object, refs), found: false, attempts };
    } catch (e) {
      const err = e instanceof ErpError ? e : new ErpError("unexpected", message(e));
      if (!err.retryable || attempts >= o.maxAttempts) {
        // An answer that never came on the last attempt: one more look, so a created object is still recorded.
        if (err.ambiguous) {
          const found = await c.findExisting(item.kind, item.object, refs).catch(() => null);
          if (found) return { ok: true, externalId: found, found: true, attempts };
        }
        return { ok: false, error: `${err.kind}: ${err.message}`, attempts };
      }
      look = err.ambiguous;
      await o.sleep(err.retryAfterMs ?? o.baseDelayMs * 2 ** (attempts - 1));
    }
  }
}

export async function syncAll(db: DB, c: ErpConnector, items: SyncItem[], opts: SyncOptions = {}): Promise<SyncResult[]> {
  const now = opts.now ?? (() => new Date());
  const store = opts.dryRun ? memoryStore() : dbStore(db, c.name, now);
  const o = { maxAttempts: opts.maxAttempts ?? 3, baseDelayMs: opts.baseDelayMs ?? 1000, sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))) };
  const refs = resolver(store);
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const results: SyncResult[] = [];
  for (const item of sorted) {
    const id = item.object.id;
    const subject = `${c.name}:${item.kind}:${id}`;
    const errs = validate(item.kind, item.object);
    if (errs.length) {
      store.log("erp.invalid", subject, { reason: errs.join("; ") });
      results.push({ kind: item.kind, id, outcome: "invalid", detail: errs.join("; ") });
      continue;
    }
    const hash = contentHash(item.kind, item.object);
    const row = store.get(item.kind, id);
    const base: SyncRow = row ?? { connector: c.name, kind: item.kind, object_id: id, external_id: null, pushed_hash: null, pushed_json: null, pending_hash: null, status: "pending", attempts: 0, last_error: null, updated_at: now().toISOString() };
    if (row && (row.status === "synced" || row.status === "needs_correction")) {
      if (row.pushed_hash === hash) {
        if (row.status === "needs_correction") store.put({ ...row, status: "synced", pending_hash: null, updated_at: now().toISOString() });
        results.push({ kind: item.kind, id, outcome: "unchanged", externalId: row.external_id ?? undefined });
        continue;
      }
      const detail = `changed after it was sent to ${c.name}; it is not overwritten: ${item.kind === "vendor" || item.kind === "payment" ? "a person checks it" : "correct it with a credit note or reversal (npm run erp -- correct)"}`;
      if (row.status !== "needs_correction" || row.pending_hash !== hash) {
        store.put({ ...row, status: "needs_correction", pending_hash: hash, updated_at: now().toISOString() });
        store.log("erp.needs_correction", subject, { external_id: row.external_id, sent_hash: row.pushed_hash, new_hash: hash });
      }
      results.push({ kind: item.kind, id, outcome: "needs_correction", externalId: row.external_id ?? undefined, detail });
      continue;
    }
    const waits = missingDependency(item.kind, item.object, refs);
    if (waits) {
      results.push({ kind: item.kind, id, outcome: "waiting", detail: waits });
      continue;
    }
    // Recorded as pending before anything is sent: a crash after sending leaves a trace the next run looks up.
    const lookFirst = !!row && row.attempts > 0;
    store.put({ ...base, status: "pending", updated_at: now().toISOString() });
    const r = await sendOnce(c, item, refs, lookFirst, o);
    const attempts = base.attempts + r.attempts;
    if (r.ok) {
      store.put({ ...base, external_id: r.externalId, pushed_hash: hash, pushed_json: sentJson(item.kind, item.object), pending_hash: null, status: "synced", attempts, last_error: null, updated_at: now().toISOString() });
      store.log(r.found ? "erp.found_existing" : "erp.pushed", subject, { external_id: r.externalId, hash });
      results.push({ kind: item.kind, id, outcome: r.found ? "found_existing" : "pushed", externalId: r.externalId });
    } else {
      store.put({ ...base, status: "failed", attempts, last_error: r.error, updated_at: now().toISOString() });
      store.log("erp.push_failed", subject, { error: r.error, attempts });
      results.push({ kind: item.kind, id, outcome: "failed", detail: r.error });
    }
  }
  return results;
}

/** A journal entry with debits and credits swapped: the reversal of `j`. */
function reversal(j: JournalEntry): JournalEntry {
  return { ...j, id: `${j.id}-reversal`, memo: `Reversal of ${j.memo}`, lines: j.lines.map((l) => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents })) };
}

/**
 * Corrects an object that changed after it was sent: an invoice gets a credit note against the version that was sent,
 * then the new version; a journal entry gets a reversing entry, then the new one. A vendor or a payment that changed
 * is a person's call (new bank details, a payment that differs from what the bank paid), never automatic.
 */
export async function correct(db: DB, c: ErpConnector, item: SyncItem, now: () => Date = () => new Date()): Promise<SyncResult> {
  const store = dbStore(db, c.name, now);
  const row = store.get(item.kind, item.object.id);
  if (!row || row.status !== "needs_correction" || !row.external_id || !row.pushed_json) throw new Error(`${item.kind} ${item.object.id} does not need a correction in ${c.name}`);
  if (item.kind === "vendor" || item.kind === "payment") throw new Error(`a changed ${item.kind} is not corrected automatically: a person checks it in ${c.name} first`);
  const errs = validate(item.kind, item.object);
  if (errs.length) throw new Error(errs.join("; "));
  const refs = resolver(store);
  const subject = `${c.name}:${item.kind}:${item.object.id}`;
  let counter: string;
  let next: string;
  if (item.kind === "invoice") {
    const sent = JSON.parse(row.pushed_json) as PurchaseInvoice;
    counter = await c.pushCreditNote({ ...sent, pdf: undefined }, row.external_id, refs);
    next = await c.pushPurchaseInvoice(item.object as PurchaseInvoice, refs);
  } else {
    const sent = JSON.parse(row.pushed_json) as JournalEntry;
    counter = await c.pushJournalEntry(reversal(sent));
    next = await c.pushJournalEntry(item.object as JournalEntry);
  }
  const hash = contentHash(item.kind, item.object);
  store.put({ ...row, external_id: next, pushed_hash: hash, pushed_json: sentJson(item.kind, item.object), pending_hash: null, status: "synced", updated_at: now().toISOString() });
  store.log("erp.corrected", subject, { credit_note: counter, replaced: row.external_id, external_id: next, hash });
  return { kind: item.kind, id: item.object.id, outcome: "corrected", externalId: next };
}

export function syncStatus(db: DB, connector?: string): SyncRow[] {
  ensureErpSchema(db);
  return (connector
    ? db.prepare("SELECT * FROM erp_sync WHERE connector = ? ORDER BY kind, object_id").all(connector)
    : db.prepare("SELECT * FROM erp_sync ORDER BY connector, kind, object_id").all()) as SyncRow[];
}
