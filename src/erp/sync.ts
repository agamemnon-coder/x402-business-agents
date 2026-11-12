// The ERP sync runner (ERP connectors design, 8 November). It sends what changed, in dependency order (vendors,
// then invoices, then payments, then journal entries), and keeps per connector and object the ERP's id, the hash of
// what was sent and a status in `erp_sync`:
//   - unchanged since it was sent: skipped;
//   - changed after it was sent: never overwritten, marked needs_correction; `correct` then sends a credit note (or a
//     reversing entry) and the new version, as accounting rules ask; a vendor or a payment goes to a person. Whether an
//     invoice's PDF is on this machine is not a change (the hash holds the document's own hash, not the file);
//   - a correction part (the credit note, the new version) whose answer never came, with none of its steps recorded:
//     the ERP may hold it, and no lookup tells the two versions of one invoice apart, so it is not sent again: it goes
//     to a person (needs_review), who looks in the ERP and says which it is (`resolve`);
//   - an object that cannot be sent as it is (an invoice whose stored PDF is gone or differs): failed with that
//     reason, nothing sent;
//   - a push made of several requests records each step that succeeded (progress_json): a retry or the next run
//     resumes from the first step not done, so a rate limit on a later request never repeats an earlier one;
//   - an answer that never came, or a row an earlier run left pending or failed with no step recorded: the ERP is
//     asked first whether it already holds the object, so nothing is ever posted twice; a lookup that fails is retried
//     as a lookup, never answered by sending blind; an object found only in part goes to a person (needs_review);
//   - the ERP holding an object in a state a person must look at (a draft whose total differs): needs_review, which
//     only a person clears (`npm run erp -- resolve`); a payment against such an invoice waits;
//   - retryable errors (rate limit, server, network) are retried with back-off, honouring Retry-After up to two minutes;
//   - the approved call budget of a live run reached (src/erp/callBudget.ts): the run stops there. The request was not
//     sent, so nothing is looked up, retried or left for a person because of it; what follows is not tried.
// Every result goes into the audit log. A dry run writes nothing.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { ErpBudgetSpent } from "./callBudget.js";
import { ErpError, scoped, step, type ErpConnector, type PushProgress, type RefResolver } from "./connector.js";
import { contentHash, contentHashBefore, validate, type CanonicalObject, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type Vendor } from "./model.js";

export interface SyncItem {
  kind: ObjectKind;
  object: CanonicalObject;
  /** Why this object cannot be sent as it is (an invoice whose stored PDF is gone); one already sent is left alone. */
  blocked?: string;
}
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
function progressOf(store: Store, kind: ObjectKind, id: string): PushProgress & { empty(): boolean; any(prefix: string): boolean } {
  const steps: Record<string, string> = JSON.parse(store.get(kind, id)?.progress_json ?? "{}") as Record<string, string>;
  return {
    get: (s) => steps[s],
    set: (s, v) => { steps[s] = v; store.setProgress(kind, id, JSON.stringify(steps)); },
    empty: () => Object.keys(steps).length === 0,
    any: (prefix) => Object.keys(steps).some((s) => s.startsWith(prefix)),
  };
}

/** In a row's progress: the part of a correction ("counter" or "next") whose answer never came; a person settles it. */
const UNSURE = "correction:unsure";

/**
 * True when `row` was sent under the hash of before 12 November 2026, which held whether the invoice's PDF went along,
 * and nothing else changed since: the same invoice, whatever files this machine holds now.
 */
function sentUnderEarlierHash(row: SyncRow, item: SyncItem): boolean {
  if (item.kind !== "invoice" || !row.pushed_hash) return false;
  let sent: { fileName: string } | null = null;
  try { sent = (JSON.parse(row.pushed_json ?? "{}") as { pdf?: { fileName: string } | null }).pdf ?? null; } catch { /* a row with no record of what was sent */ }
  const here = (item.object as PurchaseInvoice).pdf ?? null;
  return [null, sent, here].some((pdf) => contentHashBefore("invoice", item.object, pdf) === row.pushed_hash);
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
  // What an object found in the ERP still misses, or null. A check the call budget refused is not an answer: it stops the run.
  const missingOf = async (found: string): Promise<string | null> => {
    if (!c.incomplete) return null;
    try {
      return await c.incomplete(item.kind, item.object, found, refs);
    } catch (e) {
      if (e instanceof ErpBudgetSpent) throw e;
      return `could not check it is complete: ${message(e)}`;
    }
  };
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
        if (e instanceof ErpBudgetSpent) throw e;
        // The ERP could not be asked: never send blind (it may hold the object); ask again, or give up.
        const err = asErp(e);
        attempts++;
        if (!err.retryable || attempts >= o.maxAttempts) return { ok: false, review: false, error: `could not ask ${c.name} whether it already holds this (${err.kind}: ${err.message}); nothing was sent`, attempts };
        const capped = await wait(err);
        if (capped) return { ok: false, review: false, error: capped, attempts };
        continue;
      }
      if (found) {
        const missing = await missingOf(found);
        if (missing) return { ok: false, review: true, externalId: found, error: `${c.name} holds ${found} but not all of it: ${missing}; a person completes or removes it`, attempts };
        return { ok: true, externalId: found, found: true, attempts };
      }
    }
    attempts++;
    try {
      return { ok: true, externalId: await push(c, item.kind, item.object, refs, progress), found: false, attempts };
    } catch (e) {
      if (e instanceof ErpBudgetSpent) throw e;
      const err = asErp(e);
      if (err.kind === "needs_review" && err.externalId) return { ok: false, review: true, externalId: err.externalId, error: err.message, attempts };
      if (!err.retryable || attempts >= o.maxAttempts) {
        // An answer that never came on the last attempt, with nothing recorded: one more look, so a created object is still recorded.
        if (err.ambiguous && progress.empty()) {
          const found = await c.findExisting(item.kind, item.object, refs).catch(() => null);
          if (found) {
            const missing = await missingOf(found);
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
  let stopped = false;
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
      const earlier = row.pushed_hash !== hash && sentUnderEarlierHash(row, item);
      if (row.pushed_hash === hash || earlier) {
        // A row sent under the earlier hash is kept under today's from here on.
        if (row.status === "needs_correction" || earlier) store.put({ ...row, pushed_hash: hash, status: "synced", pending_hash: null, updated_at: now().toISOString() });
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
    if (item.blocked) {
      // Not sent as it is, and nothing is recorded as tried: the next run sends it once the reason is gone.
      store.log("erp.push_failed", subject, { error: item.blocked, attempts: row?.attempts ?? 0 });
      results.push({ kind: item.kind, id, outcome: "failed", detail: item.blocked });
      continue;
    }
    const waits = missingDependency(item.kind, item.object, refs, store);
    if (waits) {
      results.push({ kind: item.kind, id, outcome: "waiting", detail: waits });
      continue;
    }
    if (stopped) {
      results.push({ kind: item.kind, id, outcome: "waiting", detail: "not tried: the approved call budget of this run is spent" });
      continue;
    }
    // Recorded as pending before anything is sent: a crash after sending leaves a trace the next run looks up.
    // Any row an earlier run left (pending or failed) may mean the ERP already holds the object: look first.
    const lookFirst = !!row;
    store.put({ ...base, status: "pending", updated_at: now().toISOString() });
    const progress = progressOf(store, item.kind, id);
    let r: Sent;
    try {
      r = await sendOnce(c, item, refs, lookFirst, progress, o);
    } catch (e) {
      if (!(e instanceof ErpBudgetSpent)) throw e;
      // The run's approved number of requests is reached: this request was not sent. The steps already done stay
      // recorded, so the next run goes on from there; nothing after this object is tried.
      store.put({ ...base, status: "failed", last_error: e.message, updated_at: now().toISOString(), progress_json: store.get(item.kind, id)?.progress_json ?? null });
      store.log("erp.push_failed", subject, { error: e.message, attempts: base.attempts });
      results.push({ kind: item.kind, id, outcome: "failed", detail: e.message });
      stopped = true;
      continue;
    }
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
 *
 * A correction that stopped on an answer that never came waits here too. The person looks in the ERP for that part
 * (the credit note or reversal, or the new version): "retry" when it is not there, so `correct` sends it; "synced"
 * with its id there (`externalId`) when it is, complete, so `correct` goes on from the next part and never sends it
 * again.
 */
export function resolve(db: DB, connector: string, kind: ObjectKind, objectId: string, as: "synced" | "retry", by: string, now: () => Date = () => new Date(), externalId?: string): SyncRow {
  const store = dbStore(db, connector, now);
  const row = store.get(kind, objectId);
  if (!row || row.status !== "needs_review") throw new Error(`${kind} ${objectId} does not wait for a person in ${connector}`);
  if (!by.trim()) throw new Error("say who resolves it");
  const steps = JSON.parse(row.progress_json ?? "{}") as Record<string, string>;
  const part = steps[UNSURE];
  if (part) {
    const found = externalId?.trim();
    if (as === "synced" && !found) throw new Error(`say which document ${connector} holds for it: --external-id <its id there>; or --as retry when ${connector} does not hold it`);
    delete steps[UNSURE];
    if (as === "synced") steps[`correction:${part}`] = found!;
    const next: SyncRow = { ...row, status: "needs_correction", last_error: null, progress_json: JSON.stringify(steps), updated_at: now().toISOString() };
    store.put(next);
    store.log("erp.resolved", `${connector}:${kind}:${objectId}`, { by, as, external_id: row.external_id, correction_part: part, found: as === "synced" ? found! : null });
    return next;
  }
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
 * succeeds, and each step inside a part too, so a correction run again after a failure goes on from there. A part
 * whose answer never came before any of its steps was recorded may be in the ERP: it is not sent again. The object
 * goes to a person (needs_review), who looks in the ERP and settles it with `resolve`. A vendor or a payment that
 * changed is a person's call (new bank details, a payment that differs from what the bank paid).
 */
export async function correct(db: DB, c: ErpConnector, item: SyncItem, now: () => Date = () => new Date()): Promise<SyncResult> {
  const store = dbStore(db, c.name, now);
  const id = item.object.id;
  const row = store.get(item.kind, id);
  if (row?.status === "needs_review" && row.last_error && progressOf(store, item.kind, id).get(UNSURE)) throw new Error(row.last_error);
  if (!row || row.status !== "needs_correction" || !row.external_id || !row.pushed_json) throw new Error(`${item.kind} ${id} does not need a correction in ${c.name}`);
  if (item.kind === "vendor" || item.kind === "payment") throw new Error(`a changed ${item.kind} is not corrected automatically: a person checks it in ${c.name} first`);
  if (item.blocked) throw new Error(`${item.kind} ${id} is not corrected: ${item.blocked}`);
  const errs = validate(item.kind, item.object);
  if (errs.length) throw new Error(errs.join("; "));
  const refs = resolver(store);
  const subject = `${c.name}:${item.kind}:${id}`;
  const progress = progressOf(store, item.kind, id);
  const original = row.external_id;
  // One part of the correction, once. Null when its answer never came and it now waits for a person.
  const part = async (name: "counter" | "next", what: string, run: () => Promise<string>): Promise<string | null> => {
    try {
      return await step(progress, `correction:${name}`, run);
    } catch (e) {
      if (!(e instanceof ErpError) || !e.ambiguous || progress.any(`${name}:`)) throw e;
      progress.set(UNSURE, name);
      const reason = `no answer came to the ${what} (${e.kind}: ${e.message}), so ${c.name} may or may not hold it, and sending it again could post it twice. A person looks in ${c.name} first, then: npm run erp -- resolve --connector ${c.name} --object ${item.kind}:${id} --by <who> with --as retry (it is not there: the next correct sends it) or --as synced --external-id <its id there> (it is there, complete)`;
      store.put({ ...store.get(item.kind, id)!, status: "needs_review", last_error: reason, updated_at: now().toISOString() });
      store.log("erp.needs_review", subject, { external_id: original, reason });
      return null;
    }
  };
  const parked = (): SyncResult => ({ kind: item.kind, id, outcome: "needs_review", externalId: original, detail: store.get(item.kind, id)!.last_error ?? "waits for a person in the ERP" });
  let counter: string | null;
  let next: string | null;
  if (item.kind === "invoice") {
    const sent = JSON.parse(row.pushed_json) as PurchaseInvoice;
    counter = await part("counter", `credit note for invoice ${sent.number}`, () => c.pushCreditNote({ ...sent, pdf: undefined }, original, refs, scoped(progress, "counter:")));
    if (counter === null) return parked();
    next = await part("next", `new version of invoice ${sent.number}`, () => c.pushPurchaseInvoice(item.object as PurchaseInvoice, refs, scoped(progress, "next:")));
  } else {
    const sent = JSON.parse(row.pushed_json) as JournalEntry;
    counter = await part("counter", `reversal of journal entry ${sent.id}`, () => c.pushJournalEntry(reversal(sent), scoped(progress, "counter:")));
    if (counter === null) return parked();
    next = await part("next", `new version of journal entry ${sent.id}`, () => c.pushJournalEntry(item.object as JournalEntry, scoped(progress, "next:")));
  }
  if (next === null) return parked();
  const hash = contentHash(item.kind, item.object);
  store.put({ ...row, external_id: next, pushed_hash: hash, pushed_json: sentJson(item.kind, item.object), pending_hash: null, status: "synced", updated_at: now().toISOString(), progress_json: null });
  // With the totals of the version the credit note cancels (an invoice): a later reconciliation knows what the two
  // documents the ERP still holds were, though the row now carries the new version.
  const credited = item.kind === "invoice" ? (JSON.parse(row.pushed_json) as PurchaseInvoice).totals : null;
  store.log("erp.corrected", subject, { credit_note: counter, replaced: original, external_id: next, hash, ...(credited ? { credited_net_cents: credited.netCents, credited_vat_cents: credited.vatCents, credited_gross_cents: credited.grossCents } : {}) });
  return { kind: item.kind, id, outcome: "corrected", externalId: next };
}

export function syncStatus(db: DB, connector?: string): SyncRow[] {
  ensureErpSchema(db);
  return (connector
    ? db.prepare("SELECT * FROM erp_sync WHERE connector = ? ORDER BY kind, object_id").all(connector)
    : db.prepare("SELECT * FROM erp_sync ORDER BY connector, kind, object_id").all()) as SyncRow[];
}
