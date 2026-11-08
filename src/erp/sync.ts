// The ERP sync runner (ERP connectors design, 8 November). It sends what changed, in dependency order (vendors,
// then invoices, then payments, then journal entries), and keeps per connector and object the ERP's id, the hash of
// what was sent and a status in `erp_sync`:
//   - unchanged since it was sent: skipped;
//   - changed after it was sent: never overwritten, marked needs_correction; `correct` then sends a credit note (or a
//     reversing entry) and the new version, as accounting rules ask; a vendor or a payment goes to a person;
//   - a push made of several requests records each step that succeeded (progress_json): a retry or the next run
//     resumes from the first step not done, so a rate limit on a later request never repeats an earlier one;
//   - an answer that never came, or a row an earlier run left pending or failed with no step recorded: the ERP is
//     asked first whether it already holds the object, so nothing is ever posted twice; a lookup that fails is retried
//     as a lookup, never answered by sending blind; an object found only in part goes to a person (needs_review);
//   - the ERP holding an object in a state a person must look at (a draft whose total differs): needs_review, which
//     only a person clears (`npm run erp -- resolve`); a payment against such an invoice waits;
//   - retryable errors (rate limit, server, network) are retried with back-off, honouring Retry-After up to two minutes.
// Every result goes into the audit log. A dry run writes nothing.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { ErpError, scoped, step, type ErpConnector, type PushProgress, type RefResolver } from "./connector.js";
import { contentHash, validate, type CanonicalObject, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type Vendor } from "./model.js";

export interface SyncItem { kind: ObjectKind; object: CanonicalObject }
export type SyncOutcome = "pushed" | "found_existing" | "unchanged" | "waiting" | "needs_correction" | "needs_review" | "failed" | "invalid" | "corrected";
export interface SyncResult { kind: ObjectKind; id: string; outcome: SyncOutcome; externalId?: string; detail?: string }
export interface SyncOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  dryRun?: boolean;
}

/** The longest Retry-After the runner waits for; an ERP that asks for more fails the push with that wait named. */
export const MAX_RETRY_AFTER_MS = 120_000;

export type SyncStatus = "pending" | "synced" | "failed" | "needs_correction" | "needs_review";

export interface SyncRow {
  connector: string;
  kind: ObjectKind;
  object_id: string;
  external_id: string | null;
  pushed_hash: string | null;
  pushed_json: string | null;
  pending_hash: string | null;
  status: SyncStatus;
  attempts: number;
  last_error: string | null;
  updated_at: string;
  /** The steps of a push in progress that already succeeded (step name → what it returned), or null. */
  progress_json: string | null;
}

const ORDER: ObjectKind[] = ["vendor", "invoice", "payment", "journal"];
const STATUSES = "'pending', 'synced', 'failed', 'needs_correction', 'needs_review'";

const CREATE = `CREATE TABLE IF NOT EXISTS erp_sync (
    connector TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('vendor', 'invoice', 'payment', 'journal')),
    object_id TEXT NOT NULL,
    external_id TEXT,
    pushed_hash TEXT,
    pushed_json TEXT,
    pending_hash TEXT,
    status TEXT NOT NULL CHECK (status IN (${STATUSES})),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT NOT NULL,
    progress_json TEXT,
    PRIMARY KEY (connector, kind, object_id)
  )`;

export function ensureErpSchema(db: DB): void {
  db.exec(CREATE);
  // A table from before needs_review and progress_json: rebuilt once, its rows kept (SQLite cannot widen a CHECK).
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'erp_sync'").get() as { sql: string }).sql;
  if (!sql.includes("needs_review") || !sql.includes("progress_json")) {
    db.transaction(() => {
      db.exec("ALTER TABLE erp_sync RENAME TO erp_sync_old");
      db.exec(CREATE);
      db.exec(`INSERT INTO erp_sync (connector, kind, object_id, external_id, pushed_hash, pushed_json, pending_hash, status, attempts, last_error, updated_at)
        SELECT connector, kind, object_id, external_id, pushed_hash, pushed_json, pending_hash, status, attempts, last_error, updated_at FROM erp_sync_old`);
      db.exec("DROP TABLE erp_sync_old");
    }).immediate();
  }
}

/** Where the runner keeps its rows: the ledger, or (dry run) a map that disappears with the run. */
interface Store {
  get(kind: ObjectKind, id: string): SyncRow | undefined;
  put(row: SyncRow): void;
  setProgress(kind: ObjectKind, id: string, progressJson: string | null): void;
  log(event: string, subject: string, payload: Record<string, string | number | null>): void;
}

function dbStore(db: DB, connector: string, now: () => Date): Store {
  ensureErpSchema(db);
  return {
    get: (kind, id) => db.prepare("SELECT * FROM erp_sync WHERE connector = ? AND kind = ? AND object_id = ?").get(connector, kind, id) as SyncRow | undefined,
    put: (r) => {
      db.prepare(`INSERT INTO erp_sync (connector, kind, object_id, external_id, pushed_hash, pushed_json, pending_hash, status, attempts, last_error, updated_at, progress_json)
        VALUES (@connector, @kind, @object_id, @external_id, @pushed_hash, @pushed_json, @pending_hash, @status, @attempts, @last_error, @updated_at, @progress_json)
        ON CONFLICT (connector, kind, object_id) DO UPDATE SET external_id = excluded.external_id, pushed_hash = excluded.pushed_hash,
          pushed_json = excluded.pushed_json, pending_hash = excluded.pending_hash, status = excluded.status, attempts = excluded.attempts,
          last_error = excluded.last_error, updated_at = excluded.updated_at, progress_json = excluded.progress_json`).run(r);
    },
    setProgress: (kind, id, json) => {
      db.prepare("UPDATE erp_sync SET progress_json = ?, updated_at = ? WHERE connector = ? AND kind = ? AND object_id = ?").run(json, now().toISOString(), connector, kind, id);
    },
    log: (event, subject, payload) => { audit(db, "system", event, subject, { connector, ...payload }, now()); },
  };
}

function memoryStore(): Store {
  const rows = new Map<string, SyncRow>();
  return {
    get: (k, id) => rows.get(`${k}:${id}`),
    put: (r) => { rows.set(`${r.kind}:${r.object_id}`, r); },
    setProgress: (k, id, json) => { const r = rows.get(`${k}:${id}`); if (r) rows.set(`${k}:${id}`, { ...r, progress_json: json }); },
    log: () => {},
  };
}

/** The progress of one object's push, written to its row after every step that succeeds. */
function progressOf(store: Store, kind: ObjectKind, id: string): PushProgress & { empty(): boolean } {
  const steps: Record<string, string> = JSON.parse(store.get(kind, id)?.progress_json ?? "{}") as Record<string, string>;
  return {
    get: (s) => steps[s],
    set: (s, v) => { steps[s] = v; store.setProgress(kind, id, JSON.stringify(steps)); },
    empty: () => Object.keys(steps).length === 0,
  };
}

/** The object as it was sent, for a later correction: without the PDF bytes or the full IBAN. */
function sentJson(kind: ObjectKind, o: CanonicalObject): string {
  if (kind === "invoice") { const { pdf, ...rest } = o as PurchaseInvoice; return JSON.stringify({ ...rest, pdf: pdf ? { fileName: pdf.fileName } : null }); }
  if (kind === "vendor") { const { iban: _iban, ...rest } = o as Vendor; return JSON.stringify(rest); }
  return JSON.stringify(o);
}

function resolver(store: Store): RefResolver {
  // Only an object the ERP holds as sent counts: one waiting for a person (needs_review) is not paid against.
  const ext = (kind: ObjectKind, id: string) => {
    const r = store.get(kind, id);
    return r && (r.status === "synced" || r.status === "needs_correction") ? r.external_id : null;
  };
  return { vendor: (id) => ext("vendor", id), invoice: (id) => ext("invoice", id) };
}

/** What `object` still waits for in the ERP, or null. */
function missingDependency(kind: ObjectKind, o: CanonicalObject, refs: RefResolver, store: Store): string | null {
  const review = (k: ObjectKind, id: string) => store.get(k, id)?.status === "needs_review";
  if (kind === "invoice" && !refs.vendor((o as PurchaseInvoice).vendorId)) return `vendor ${(o as PurchaseInvoice).vendorId} is not in the ERP yet`;
  if (kind === "payment") {
    const p = o as Payment;
    if (!refs.invoice(p.invoiceId)) return review("invoice", p.invoiceId) ? `invoice ${p.invoiceId} waits for a person in the ERP; it is not paid against until then` : `invoice ${p.invoiceId} is not in the ERP yet`;
    if (!refs.vendor(p.vendorId)) return `vendor ${p.vendorId} is not in the ERP yet`;
  }
  return null;
}

function push(c: ErpConnector, kind: ObjectKind, o: CanonicalObject, refs: RefResolver, progress: PushProgress): Promise<string> {
  switch (kind) {
    case "vendor": return c.pushVendor(o as Vendor, progress);
    case "invoice": return c.pushPurchaseInvoice(o as PurchaseInvoice, refs, progress);
    case "payment": return c.pushPayment(o as Payment, refs, progress);
    case "journal": return c.pushJournalEntry(o as JournalEntry, progress);
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const asErp = (e: unknown) => (e instanceof ErpError ? e : new ErpError("unexpected", message(e)));

type Sent =
  | { ok: true; externalId: string; found: boolean; attempts: number }
  | { ok: false; review: true; externalId: string; error: string; attempts: number }
  | { ok: false; review: false; error: string; attempts: number };

/**
 * Sends one object with retries. When nothing of it is recorded yet and it may already be in the ERP (an earlier run
 * left a row, or an answer never came), it asks the ERP first; once a step is recorded, it resumes from the next one.
 */
async function sendOnce(c: ErpConnector, item: SyncItem, refs: RefResolver, lookFirst: boolean, progress: PushProgress & { empty(): boolean },
  o: Required<Pick<SyncOptions, "maxAttempts" | "baseDelayMs" | "sleep">>): Promise<Sent> {
  let attempts = 0;
  let look = lookFirst;
  const wait = async (err: ErpError): Promise<string | null> => {
    if (err.retryAfterMs !== undefined && err.retryAfterMs > MAX_RETRY_AFTER_MS) {
      return `${err.kind}: ${err.message}; the ERP asks to wait ${Math.round(err.retryAfterMs / 1000)} s, more than the ${MAX_RETRY_AFTER_MS / 1000} s this run waits: try again later`;
    }
    await o.sleep(err.retryAfterMs ?? o.baseDelayMs * 2 ** (attempts - 1));
    return null;
  };
  for (;;) {
    if (look && progress.empty()) {
      let found: string | null;
      try {
        found = await c.findExisting(item.kind, item.object, refs);
      } catch (e) {
        // The ERP could not be asked: never send blind (it may hold the object); ask again, or give up.
        const err = asErp(e);
        attempts++;
        if (!err.retryable || attempts >= o.maxAttempts) return { ok: false, review: false, error: `could not ask ${c.name} whether it already holds this (${err.kind}: ${err.message}); nothing was sent`, attempts };
        const capped = await wait(err);
        if (capped) return { ok: false, review: false, error: capped, attempts };
        continue;
      }
      if (found) {
        const missing = c.incomplete ? await c.incomplete(item.kind, item.object, found, refs).catch((e: unknown) => `could not check it is complete: ${message(e)}`) : null;
        if (missing) return { ok: false, review: true, externalId: found, error: `${c.name} holds ${found} but not all of it: ${missing}; a person completes or removes it`, attempts };
        return { ok: true, externalId: found, found: true, attempts };
      }
    }
    attempts++;
    try {
      return { ok: true, externalId: await push(c, item.kind, item.object, refs, progress), found: false, attempts };
    } catch (e) {
      const err = asErp(e);
      if (err.kind === "needs_review" && err.externalId) return { ok: false, review: true, externalId: err.externalId, error: err.message, attempts };
      if (!err.retryable || attempts >= o.maxAttempts) {
        // An answer that never came on the last attempt, with nothing recorded: one more look, so a created object is still recorded.
        if (err.ambiguous && progress.empty()) {
          const found = await c.findExisting(item.kind, item.object, refs).catch(() => null);
          if (found) {
            const missing = c.incomplete ? await c.incomplete(item.kind, item.object, found, refs).catch((x: unknown) => `could not check it is complete: ${message(x)}`) : null;
            if (missing) return { ok: false, review: true, externalId: found, error: `${c.name} holds ${found} but not all of it: ${missing}; a person completes or removes it`, attempts };
            return { ok: true, externalId: found, found: true, attempts };
          }
        }
        return { ok: false, review: false, error: `${err.kind}: ${err.message}`, attempts };
      }
      // Before any retry: look first if nothing is recorded yet (the first request may have gone through).
      look = true;
      const capped = await wait(err);
      if (capped) return { ok: false, review: false, error: capped, attempts };
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
    if (row?.status === "needs_review") {
      // A person's: not sent, not looked up, not cleared, until they resolve it.
      results.push({ kind: item.kind, id, outcome: "needs_review", ...(row.external_id ? { externalId: row.external_id } : {}), detail: row.last_error ?? "waits for a person in the ERP" });
      continue;
    }
    const base: SyncRow = row ?? { connector: c.name, kind: item.kind, object_id: id, external_id: null, pushed_hash: null, pushed_json: null, pending_hash: null, status: "pending", attempts: 0, last_error: null, updated_at: now().toISOString(), progress_json: null };
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
    const waits = missingDependency(item.kind, item.object, refs, store);
    if (waits) {
      results.push({ kind: item.kind, id, outcome: "waiting", detail: waits });
      continue;
    }
    // Recorded as pending before anything is sent: a crash after sending leaves a trace the next run looks up.
    // Any row an earlier run left (pending or failed) may mean the ERP already holds the object: look first.
    const lookFirst = !!row;
    store.put({ ...base, status: "pending", updated_at: now().toISOString() });
    const progress = progressOf(store, item.kind, id);
    const r = await sendOnce(c, item, refs, lookFirst, progress, o);
    const attempts = base.attempts + r.attempts;
    const latest = store.get(item.kind, id)?.progress_json ?? null;
    if (r.ok) {
      store.put({ ...base, external_id: r.externalId, pushed_hash: hash, pushed_json: sentJson(item.kind, item.object), pending_hash: null, status: "synced", attempts, last_error: null, updated_at: now().toISOString(), progress_json: null });
      store.log(r.found ? "erp.found_existing" : "erp.pushed", subject, { external_id: r.externalId, hash });
      results.push({ kind: item.kind, id, outcome: r.found ? "found_existing" : "pushed", externalId: r.externalId });
    } else if (r.review) {
      store.put({ ...base, external_id: r.externalId, pushed_hash: hash, pushed_json: sentJson(item.kind, item.object), pending_hash: null, status: "needs_review", attempts, last_error: r.error, updated_at: now().toISOString(), progress_json: latest });
      store.log("erp.needs_review", subject, { external_id: r.externalId, reason: r.error });
      results.push({ kind: item.kind, id, outcome: "needs_review", externalId: r.externalId, detail: r.error });
    } else {
      store.put({ ...base, status: "failed", attempts, last_error: r.error, updated_at: now().toISOString(), progress_json: latest });
      store.log("erp.push_failed", subject, { error: r.error, attempts });
      results.push({ kind: item.kind, id, outcome: "failed", detail: r.error });
    }
  }
  return results;
}

/**
 * A person's decision on an object waiting for them in the ERP: "synced" when they finished it there (it counts as
 * sent from now on, so its payment can follow); "retry" to let the next sync try again from where it stopped.
 */
export function resolve(db: DB, connector: string, kind: ObjectKind, objectId: string, as: "synced" | "retry", by: string, now: () => Date = () => new Date()): SyncRow {
  const store = dbStore(db, connector, now);
  const row = store.get(kind, objectId);
  if (!row || row.status !== "needs_review") throw new Error(`${kind} ${objectId} does not wait for a person in ${connector}`);
  if (!by.trim()) throw new Error("say who resolves it");
  const next: SyncRow = as === "synced"
    ? { ...row, status: "synced", last_error: null, progress_json: null, updated_at: now().toISOString() }
    : { ...row, status: "failed", external_id: null, pushed_hash: null, pushed_json: null, last_error: `retried after review by ${by}`, updated_at: now().toISOString() };
  store.put(next);
  store.log("erp.resolved", `${connector}:${kind}:${objectId}`, { by, as, external_id: row.external_id });
  return next;
}

/** A journal entry with debits and credits swapped: the reversal of `j`. */
function reversal(j: JournalEntry): JournalEntry {
  return { ...j, id: `${j.id}-reversal`, memo: `Reversal of ${j.memo}`, lines: j.lines.map((l) => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents })) };
}

/**
 * Corrects an object that changed after it was sent: an invoice gets a credit note against the version that was sent,
 * then the new version; a journal entry gets a reversing entry, then the new one. Each part is recorded as soon as it
 * succeeds, so a correction run again after a failure never posts its credit note or reversal twice. A vendor or a
 * payment that changed is a person's call (new bank details, a payment that differs from what the bank paid).
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
  const progress = progressOf(store, item.kind, item.object.id);
  const original = row.external_id;
  let counter: string;
  let next: string;
  if (item.kind === "invoice") {
    const sent = JSON.parse(row.pushed_json) as PurchaseInvoice;
    counter = await step(progress, "correction:counter", () => c.pushCreditNote({ ...sent, pdf: undefined }, original, refs, scoped(progress, "counter:")));
    next = await step(progress, "correction:next", () => c.pushPurchaseInvoice(item.object as PurchaseInvoice, refs, scoped(progress, "next:")));
  } else {
    const sent = JSON.parse(row.pushed_json) as JournalEntry;
    counter = await step(progress, "correction:counter", () => c.pushJournalEntry(reversal(sent), scoped(progress, "counter:")));
    next = await step(progress, "correction:next", () => c.pushJournalEntry(item.object as JournalEntry, scoped(progress, "next:")));
  }
  const hash = contentHash(item.kind, item.object);
  store.put({ ...row, external_id: next, pushed_hash: hash, pushed_json: sentJson(item.kind, item.object), pending_hash: null, status: "synced", updated_at: now().toISOString(), progress_json: null });
  store.log("erp.corrected", subject, { credit_note: counter, replaced: original, external_id: next, hash });
  return { kind: item.kind, id: item.object.id, outcome: "corrected", externalId: next };
}

export function syncStatus(db: DB, connector?: string): SyncRow[] {
  ensureErpSchema(db);
  return (connector
    ? db.prepare("SELECT * FROM erp_sync WHERE connector = ? ORDER BY kind, object_id").all(connector)
    : db.prepare("SELECT * FROM erp_sync ORDER BY connector, kind, object_id").all()) as SyncRow[];
}
