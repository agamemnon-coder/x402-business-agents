// The runner's side of Purser Cloud (cloud/): it pushes what this ledger records (suppliers, payables invoices with
// their documents, payments, the transactions register, ledger entries, the audit log) and pulls the e-mail the cloud received for this company,
// filing it through the inbox. The cloud never moves money and holds no payment keys. Passkeys are never pushed: people
// enrol their passkey in the cloud itself, with an enrolment an owner starts (docs/cloud.md).
// The API key comes from the environment (PURSER_CLOUD_KEY), never from code, git or a log.

import { readFileSync } from "node:fs";
import type { DB } from "../db/open.js";
import { publicInvoice } from "../ap/public.js";
import { apInvoices } from "../ap/store.js";
import { ingestEmail, type InboxDeps } from "../ap/inbox.js";
import { ledgerRows } from "../ledger/core.js";
import { syncLedger } from "../ledger/feed.js";
import { transactionRegister } from "../money/register.js";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CloudTarget {
  url: string;
  key: string;
  fetch?: Fetch;
}

export interface CloudState { audit: { seq: number; hash: string | null }; ledger: { entry_id: number; hash: string | null }; documents: string[] }

async function call(t: CloudTarget, method: string, path: string, body?: unknown): Promise<Response> {
  const f = t.fetch ?? ((i, init) => fetch(i, init));
  const res = await f(`${t.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: { authorization: `Bearer ${t.key}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

async function ok(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`Purser Cloud refused ${what}: ${res.status} ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? ""}`.trim());
  return res.json();
}

const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

/** Everything the cloud does not hold yet, in batches small enough for one request each. */
export function batchesFor(db: DB, state: CloudState, opts: { now?: Date; maxDocBytes?: number } = {}): Record<string, unknown>[] {
  const now = (opts.now ?? new Date()).toISOString();
  const held = new Set(state.documents);
  const out: Record<string, unknown>[] = [];

  // Documents first, a few at a time (each request stays well under the cloud's limit).
  const invoices = has(db, "ap_invoices") ? apInvoices(db) : [];
  const docs = has(db, "ap_documents") ? (db.prepare("SELECT sha256, filename, mime, path FROM ap_documents ORDER BY received_at").all() as { sha256: string; filename: string; mime: string; path: string }[]) : [];
  let chunk: { sha256: string; filename: string; mime: string; base64: string }[] = [];
  let size = 0;
  const limit = opts.maxDocBytes ?? 20_000_000;
  for (const d of docs.filter((x) => !held.has(x.sha256))) {
    const b64 = readFileSync(d.path).toString("base64");
    if (chunk.length && size + b64.length > limit) { out.push({ documents: chunk }); chunk = []; size = 0; }
    chunk.push({ sha256: d.sha256, filename: d.filename, mime: d.mime, base64: b64 });
    size += b64.length;
  }
  if (chunk.length) out.push({ documents: chunk });

  const vendors = (db.prepare("SELECT beneficiary_id, name, iban_last4, bic, currency, method, status FROM beneficiaries ORDER BY name").all() as Record<string, string>[])
    .map((b) => ({ id: b.beneficiary_id!, name: b.name!, status: b.status!.toLowerCase(), updated_at: now, body: { name: b.name, iban_last4: b.iban_last4, bic: b.bic, currency: b.currency, method: b.method, status: b.status } }));
  const inv = invoices.map((i) => ({
    id: i.id, vendor: i.vendor, invoice_no: i.invoice_no, due_date: i.due_date, currency: i.currency, total: i.total, status: i.status, doc_sha256: i.doc_sha256,
    // The reading masked (last four and the account hash): the full account never leaves the runner (seam review L2).
    received_at: i.received_at, updated_at: i.updated_at, body: publicInvoice(i) as unknown as Record<string, unknown>,
  }));
  const payments = (db.prepare("SELECT request_id, transfer_id, invoice_no, amount, currency, method, fee_actual, status, updated_at FROM transfers ORDER BY updated_at").all() as Record<string, string | null>[])
    .map((p) => ({ id: p.request_id!, invoice_id: invoices.find((i) => p.invoice_no === `${i.invoice_no} · ${i.vendor}`)?.id ?? null, status: p.status!.toLowerCase(), updated_at: p.updated_at!, body: p }));
  const entries = has(db, "ledger_entries") ? ledgerRows(db).filter((e) => e.entry_id > state.ledger.entry_id) : [];
  // The transactions register, derived here from the rail tables; the cloud keeps each row versioned.
  const transactions = transactionRegister(db).rows.map((r) => ({ id: r.id, at: r.at, rail: r.rail, direction: r.direction, currency: r.currency, moved: r.moved, reconciliation: r.reconciliation, body: r as unknown as Record<string, unknown> }));
  const audit = (db.prepare("SELECT seq, ts, actor, event, subject, payload_json, prev_hash, row_hash FROM audit_log WHERE seq > ? ORDER BY seq").all(state.audit.seq) as Record<string, unknown>[]);

  // The chains in order, in slices the cloud accepts; everything else rides with the first slice.
  const slices = Math.max(1, Math.ceil(entries.length / 2000), Math.ceil(audit.length / 5000), Math.ceil(transactions.length / 2000));
  for (let i = 0; i < slices; i++) {
    out.push({
      ...(i === 0 ? { vendors, invoices: inv, payments } : {}),
      transactions: transactions.slice(i * 2000, (i + 1) * 2000),
      ledger_entries: entries.slice(i * 2000, (i + 1) * 2000),
      audit_rows: audit.slice(i * 5000, (i + 1) * 5000),
    });
  }
  return out;
}

/** Pushes everything new; returns what the cloud applied, batch by batch. */
export async function pushToCloud(db: DB, t: CloudTarget, now = new Date()): Promise<unknown[]> {
  // The ledger first brings in what Purser recorded since the last sync (the inbox invoices' accruals, payouts, card
  // charges): only posted entries travel, and the feed posts each source once, so this is safe to repeat (backend demo
  // of 9 November: a push right after ingest carried no accrual).
  if (has(db, "ledger_entries")) syncLedger(db, now);
  const state = (await ok(await call(t, "GET", "/v1/sync/state"), "the state request")) as CloudState;
  const results: unknown[] = [];
  for (const b of batchesFor(db, state, { now })) results.push(await ok(await call(t, "POST", "/v1/sync", b), "a push"));
  return results;
}

/** Files the e-mail the cloud received for this company through the inbox, and marks each one done or refused. */
export async function pullMail(db: DB, deps: InboxDeps, t: CloudTarget): Promise<{ id: string; status: "done" | "refused"; note?: string }[]> {
  // Every page of the queue (the list is paginated): mail filed here leaves the queue, so the next run starts afresh.
  const items: { id: string }[] = [];
  for (let cursor: string | null = null, pages = 0; pages < 50; pages++) {
    const page = (await ok(await call(t, "GET", `/v1/mail?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`), "the mail list")) as { items: { id: string }[]; next_cursor?: string | null };
    items.push(...page.items);
    cursor = page.next_cursor ?? null;
    if (!cursor) break;
  }
  const out: { id: string; status: "done" | "refused"; note?: string }[] = [];
  for (const m of items) {
    const raw = await call(t, "GET", `/v1/mail/${encodeURIComponent(m.id)}/raw`);
    if (!raw.ok) continue;
    let status: "done" | "refused" = "done";
    let note: string | undefined;
    try {
      const results = await ingestEmail(db, deps, Buffer.from(await raw.arrayBuffer()), { cloud_mail: m.id }, "email");
      note = results.length ? `${results.length} attachment(s) filed` : "no PDF attached";
    } catch (e) {
      status = "refused";
      note = (e as Error).message.slice(0, 300);
    }
    await ok(await call(t, "POST", `/v1/mail/${encodeURIComponent(m.id)}/done`, { status, ...(note ? { note } : {}) }), "marking mail done");
    out.push({ id: m.id, status, ...(note ? { note } : {}) });
  }
  return out;
}
