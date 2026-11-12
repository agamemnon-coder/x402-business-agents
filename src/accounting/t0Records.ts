// T:0 records (master list 655): Purser's suppliers, bills and payments written to T:0 with POST /v1/records, each
// write under the CFO's signed approval. Built and tested against a fake T:0 only (test/t0-records.test.ts): no live
// write has been made, and one needs the owner's go and budget (master list 552).
//
// The request shapes are ASSUMED: T:0's OpenAPI 1.12.1 operations Purser uses (src/accounting/t0.ts) do not include
// /v1/records, and this stream made no call to read T:0's docs. docs/t0.md, "Records (assumed shapes)", lists them.
// Before a live write, check them against T:0's current OpenAPI and change only this file.
//
// - Approval: every write carries the hash the CFO signed (`approval_sha256`), and a batch is written only when an
//   approved proposal's terms name the batch's own hash. Without that the client refuses and sends nothing.
// - Idempotent: each record's key is the SHA-256 of its content; it goes as X-Idempotency-Key, and what was written is
//   kept in the ledger's t0_records table, so a re-run makes 0 writes.
// - A 429 waits (Retry-After, else a short backoff) and tries again with the same key; a lost answer (a timeout, a
//   dropped connection, a 5xx) is resolved by looking the record up by its key before any second write.
// - The key is only ever sent as the bearer token, never logged or put in an error.

import { createHash } from "node:crypto";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import type { DB } from "../db/open.js";
import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { T0_BASE_URL } from "./t0.js";

export type T0RecordKind = "supplier" | "bill" | "payment";

export interface T0RecordData {
  supplier: { name: string };
  bill: { supplier: string; number: string; issue_date: string; due_date: string; currency: string; total: string; document_sha256: string };
  payment: { supplier: string; bill_number: string; date: string; currency: string; amount: string; rail_ref: string };
}

/** One record as POST /v1/records takes it (assumed shape; see docs/t0.md). */
export interface T0RecordRequest<K extends T0RecordKind = T0RecordKind> {
  record_type: K;
  /** Purser's own id for the record: T:0 keeps it, and Purser finds the record by it. */
  external_ref: string;
  data: T0RecordData[K];
  /** The CFO's signed approval of the batch this record is in. */
  approval_sha256: string;
}

export interface T0Record { id: string; record_type: T0RecordKind; external_ref: string }

/** Why nothing was written: no approval, or an approval of other records. Never sent to T:0. */
export class RecordsRefused extends Error {
  constructor(message: string) { super(message); this.name = "RecordsRefused"; }
}

export class T0RecordsError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "T0RecordsError"; }
}

export interface PlannedRecord { key: string; request: Omit<T0RecordRequest, "approval_sha256"> }

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const recordKey = (r: Omit<T0RecordRequest, "approval_sha256">): string => sha(jcs(r as unknown as Json));

/** The batch's hash: what the CFO's approval must name. Order does not matter. */
export const batchSha256 = (records: PlannedRecord[]): string => sha(jcs([...records.map((r) => r.key)].sort() as unknown as Json));

// ---- What Purser holds: suppliers, bills and payments from the payables inbox ----

const hasTable = (db: DB, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/** The records Purser would write: each supplier once, each bookable bill, each paid payment. Not yet filtered by what was written. */
export function plannedRecords(db: DB): PlannedRecord[] {
  if (!hasTable(db, "ap_invoices")) return [];
  const invoices = db.prepare(`SELECT id, vendor, invoice_no, issue_date, due_date, currency, total, doc_sha256, status FROM ap_invoices
    WHERE status IN ('ready', 'waiting_cfo', 'paid') AND (doc_kind IS NULL OR doc_kind <> 'credit_note') ORDER BY id`).all() as
    { id: string; vendor: string; invoice_no: string; issue_date: string | null; due_date: string | null; currency: string; total: string; doc_sha256: string; status: string }[];
  const out: Omit<T0RecordRequest, "approval_sha256">[] = [];
  for (const v of [...new Set(invoices.map((i) => i.vendor).filter(Boolean))].sort()) out.push({ record_type: "supplier", external_ref: `purser:supplier:${v}`, data: { name: v } });
  for (const i of invoices) {
    out.push({ record_type: "bill", external_ref: `purser:bill:${i.id}`, data: { supplier: i.vendor, number: i.invoice_no, issue_date: i.issue_date ?? "", due_date: i.due_date ?? "", currency: i.currency, total: i.total, document_sha256: i.doc_sha256 } });
  }
  if (hasTable(db, "transfers")) {
    const paid = db.prepare("SELECT transfer_id, request_id, invoice_no, amount, currency, updated_at FROM transfers WHERE status = 'PAID' ORDER BY request_id").all() as
      { transfer_id: string | null; request_id: string; invoice_no: string; amount: string; currency: string; updated_at: string }[];
    // A payment of a bill in the inbox: the payout's invoice key is the bill's ledger key (src/ap/ledgerKey.ts).
    for (const t of paid) {
      const inv = invoices.find((i) => ledgerInvoiceNo(i.invoice_no, i.vendor) === t.invoice_no);
      if (!inv) continue;
      out.push({ record_type: "payment", external_ref: `purser:payment:${t.request_id}`, data: { supplier: inv.vendor, bill_number: inv.invoice_no, date: t.updated_at.slice(0, 10), currency: t.currency, amount: t.amount, rail_ref: t.transfer_id ?? t.request_id } });
    }
  }
  return out.map((request) => ({ key: recordKey(request), request }));
}

function ensureTable(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS t0_records (
    record_key TEXT PRIMARY KEY, record_type TEXT NOT NULL, external_ref TEXT NOT NULL, t0_id TEXT NOT NULL,
    approval_sha256 TEXT NOT NULL, written_at TEXT NOT NULL)`);
}

/** What still has to be written: the planned records whose key the ledger has not recorded as written. */
export function pendingRecords(db: DB, planned = plannedRecords(db)): PlannedRecord[] {
  ensureTable(db);
  const done = db.prepare("SELECT 1 FROM t0_records WHERE record_key = ?");
  return planned.filter((r) => !done.get(r.key));
}

/**
 * The approval for a batch, or a refusal: an APPROVED proposal of kind t0_records whose stored terms still hash to the
 * signed hash and name exactly this batch's hash. Returns the signed hash.
 */
export function approvalFor(db: DB, batch: string): string {
  const rows = hasTable(db, "proposals") ? db.prepare(`SELECT p.proposal_id, p.terms_json, p.terms_sha256, a.approved_sha256, a.decision FROM proposals p
    JOIN approvals a ON a.proposal_id = p.proposal_id WHERE p.kind = 't0_records'`).all() as { proposal_id: string; terms_json: string; terms_sha256: string; approved_sha256: string; decision: string }[] : [];
  for (const r of rows) {
    const terms = JSON.parse(r.terms_json) as { batch_sha256?: string };
    if (terms.batch_sha256 !== batch || r.decision !== "APPROVED") continue;
    if (termsHash(terms as Terms) !== r.approved_sha256 || r.terms_sha256 !== r.approved_sha256) throw new RecordsRefused(`Not written to T:0: the terms of ${r.proposal_id} no longer hash to the signed hash ${r.approved_sha256}.`);
    return r.approved_sha256;
  }
  throw new RecordsRefused(`Not written to T:0: no signed approval names this batch (${batch}). The CFO approves the batch first.`);
}

// ---- The client ----

export interface T0RecordsOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  entity?: string;
  timeoutMs?: number;
  /** Tries per record, the first included (default 4). */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class T0RecordsClient {
  readonly #key: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #entity: string | undefined;
  readonly #timeoutMs: number;
  readonly attempts: number;
  readonly sleep: (ms: number) => Promise<void>;

  constructor(o: T0RecordsOptions) {
    if (!o.apiKey) throw new Error("T0RecordsClient needs an API key");
    this.#key = o.apiKey;
    this.#base = (o.baseUrl ?? T0_BASE_URL).replace(/\/+$/, "");
    this.#fetch = o.fetch ?? globalThis.fetch;
    this.#entity = o.entity;
    this.#timeoutMs = o.timeoutMs ?? 30_000;
    this.attempts = o.attempts ?? 4;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  #url(path: string, q: Record<string, string> = {}): string {
    const u = new URL(this.#base + path);
    for (const [k, v] of Object.entries({ ...q, ...(this.#entity ? { entity: this.#entity } : {}) })) u.searchParams.set(k, v);
    return u.toString();
  }

  /** One POST. Returns the response; a thrown error is a lost answer (timeout, dropped connection). */
  async post(req: T0RecordRequest, idempotencyKey: string): Promise<Response> {
    if (!/^[0-9a-f]{64}$/.test(req.approval_sha256 ?? "")) throw new RecordsRefused("Not written to T:0: a record is written only with the CFO's signed approval hash.");
    return this.#fetch(this.#url("/v1/records"), {
      method: "POST",
      headers: { authorization: `Bearer ${this.#key}`, accept: "application/json", "content-type": "application/json", "x-idempotency-key": idempotencyKey },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
  }

  /** The record T:0 holds under Purser's external_ref, or null. */
  async find(externalRef: string): Promise<T0Record | null> {
    const res = await this.#fetch(this.#url("/v1/records", { external_ref: externalRef }), { method: "GET", headers: { authorization: `Bearer ${this.#key}`, accept: "application/json" }, signal: AbortSignal.timeout(this.#timeoutMs) });
    if (!res.ok) throw new T0RecordsError(res.status, `T:0 GET /v1/records: ${res.status}`);
    const body = (await res.json()) as { data?: T0Record[] };
    return body.data?.find((r) => r.external_ref === externalRef) ?? null;
  }
}

export interface WriteResult { written: number; already: number; records: { key: string; external_ref: string; t0_id: string; how: "written" | "found" }[] }

const retryAfter = (res: Response, attempt: number) => {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? Math.min(s, 60) * 1000 : 500 * 2 ** attempt;
};

/** Writes one record: at most one record in T:0 per key, whatever the network does. */
async function writeOne(client: T0RecordsClient, r: PlannedRecord, approval: string): Promise<{ t0_id: string; how: "written" | "found" }> {
  let lost = false;
  for (let attempt = 0; attempt < client.attempts; attempt++) {
    // After a lost answer the record may be there already: look before writing again.
    if (lost) {
      const had = await client.find(r.request.external_ref);
      if (had) return { t0_id: had.id, how: "found" };
      lost = false;
    }
    let res: Response;
    try {
      res = await client.post({ ...r.request, approval_sha256: approval }, r.key);
    } catch (e) {
      if (e instanceof RecordsRefused) throw e;
      lost = true;
      await client.sleep(500 * 2 ** attempt);
      continue;
    }
    if (res.ok) return { t0_id: ((await res.json()) as T0Record).id, how: "written" };
    if (res.status === 409) {
      const had = await client.find(r.request.external_ref);
      if (had) return { t0_id: had.id, how: "found" };
      throw new T0RecordsError(409, `T:0 refused ${r.request.external_ref} as a duplicate, and it cannot be found`);
    }
    if (res.status === 429) { await client.sleep(retryAfter(res, attempt)); continue; }
    if (res.status >= 500) { lost = true; await client.sleep(500 * 2 ** attempt); continue; }
    throw new T0RecordsError(res.status, `T:0 POST /v1/records refused ${r.request.external_ref}: ${res.status}`);
  }
  throw new T0RecordsError(0, `T:0 did not take ${r.request.external_ref} after ${client.attempts} tries; a later run tries again`);
}

/**
 * Writes what is pending, under the CFO's approval of exactly this batch. Refuses before any request without one.
 * Each record written is recorded in t0_records at once, so a run cut short resumes where it stopped.
 */
export async function writeRecords(db: DB, client: T0RecordsClient, now = () => new Date()): Promise<WriteResult> {
  const pending = pendingRecords(db);
  if (!pending.length) return { written: 0, already: 0, records: [] };
  const approval = approvalFor(db, batchSha256(pending));
  const out: WriteResult = { written: 0, already: 0, records: [] };
  const keep = db.prepare("INSERT OR IGNORE INTO t0_records (record_key, record_type, external_ref, t0_id, approval_sha256, written_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const r of pending) {
    const done = await writeOne(client, r, approval);
    keep.run(r.key, r.request.record_type, r.request.external_ref, done.t0_id, approval, now().toISOString());
    if (done.how === "written") out.written += 1;
    else out.already += 1;
    out.records.push({ key: r.key, external_ref: r.request.external_ref, ...done });
  }
  return out;
}
