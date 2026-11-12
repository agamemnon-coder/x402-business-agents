// The autopilot (npm run autopilot, docs/autopilot.md): takes every pending payables item one step forward by itself,
// until nothing can move without a person. It decides nothing that the functions it calls do not already decide: it
// files new documents (ingestDocument), books what is checked (bookAccrual), asks for a new supplier, plans a ready
// invoice's payment for the CFO (payApInvoice), executes what the CFO approved (the executors), follows the payments
// (syncPayments), and keeps the ledger, the vault and the outside books up to date (syncLedger, syncVault, syncAll).
//
// It works from the ledger's own state, so a restart simply carries on: every pass looks at what is pending and takes
// each item one step. Each step is safe to run twice (the document hash, pushOnce, the ledger's source keys, the
// executor's approval check, the vault's index) and one process per ledger runs it (a lease). People keep exactly
// their own acts: a person verifies a new supplier's account, the CFO signs each payment with Face ID. A payment runs
// without the CFO only through an AloneGate, and only within its limit; the CLI passes none, so every payment waits.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import type { AirwallexRail, PayoutRail } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { ErpConnector } from "../erp/connector.js";
import { ledgerItems } from "../erp/source.js";
import { syncAll } from "../erp/sync.js";
import { syncLedger } from "../ledger/feed.js";
import { redactSecrets } from "../lib/redact.js";
import { toCents } from "../lib/money.js";
import { resuming } from "../policy/approvals.js";
import { checkpoint } from "../policy/saga.js";
import { withOrigin } from "../provenance/origin.js";
import { syncVault } from "../vault/build.js";
import type { VaultSink } from "../vault/sink.js";
import { suppliersOnFile } from "./bank.js";
import { accrualEntries, accrualPushed, bookable, paymentEntries, pushOnce, reversalEntries, type BookkeepingSink } from "./books.js";
import { apAgentsOn, ensureCoded } from "./coderAgent.js";
import { bookAccrual, ingestDocument, MAX_DOCUMENT_BYTES, recheck, type InboxDeps, type IngestResult, type Source } from "./inbox.js";
import { payApInvoice, syncPayments } from "./pay.js";
import { apInvoice, apInvoices, type ApInvoiceRow } from "./store.js";
import { proposePayeeAdd, requestPayeeAddForInvoice } from "./vendors.js";

/**
 * What lets a payment run without the CFO's signature. limit: the most one payment may be, in one currency, or null
 * (none: every payment waits for the CFO). approve: records the approval of exactly this proposal's terms. The
 * autopilot, not the gate, decides whether a payment is within the limit; the executor still checks that the terms it
 * runs are the approved ones. This runner's policy has no limit for paying supplier invoices alone, so the CLI passes
 * no gate.
 */
export interface AloneGate {
  readonly name: string;
  limit(db: DB): { currency: string; amount: string } | null;
  approve(db: DB, proposalId: string, now: Date): void;
}

export interface AutopilotDeps {
  /** The payables inbox: its folder, reader, sink, clock and Coder client. */
  inbox: InboxDeps;
  /** Folders whose PDFs, photos and saved e-mails are taken in (nothing in them is moved or deleted). */
  folders: string[];
  /** Airwallex (sandbox), or null: payments are then not planned, and say so once. */
  rail: (AirwallexRail & PayoutRail) | null;
  /** Runs an approved proposal (src/executors/index.ts execute). */
  execute: (db: DB, proposalId: string) => Promise<void>;
  vault?: VaultSink | null;
  company?: string;
  /** The outside books (an ERP connector), or none: the bookkeeping sync runs only when one is given. */
  erp?: ErpConnector | null;
  gate?: AloneGate | null;
  now?: () => Date;
  /** This process, for the lease. */
  owner?: { id: string; pid: number; host: string };
  /** Whether the lease's holder is still running (on this host): false lets another process take the lease over. */
  alive?: (pid: number, host: string) => boolean;
  /** A document filed but never read is read again once it is this old (a reading still running is never doubled). */
  orphanGraceMs?: number;
  /** How often a running step renews the lease (tests make it short). */
  heartbeatMs?: number;
}

/** The words a step's outcome is told in. */
export type StepOutcome = "done" | "waiting for the CFO" | "waiting for a person" | "executed" | "refused" | "failed";

export interface PassResult {
  lease: "held" | "busy";
  /** Steps that changed something. */
  moved: number;
  /** Who holds the lease when this process may not run. */
  holder?: { owner: string; pid: number; host: string; heartbeat: string };
}

/**
 * A lease not renewed for this long is taken over. A running step renews it every HEARTBEAT_MS, so only a holder that
 * stopped (or hangs) loses it, however long one step takes.
 */
export const LEASE_MS = 15 * 60_000;
export const HEARTBEAT_MS = 60_000;
/**
 * A document filed this long ago and still unread was left by a process that stopped. Longer than one reading can
 * take: up to three Claude calls (classify, read, a review note), each at most three tries of 180 seconds
 * (src/claude/reader.ts), so about 27 minutes. A document may be filed by another process than the autopilot (the
 * payables page, npm run payables -- add), which holds no lease.
 */
export const ORPHAN_GRACE_MS = 60 * 60_000;
/** The waits after the first and the second failure of an item; the third failure parks it for a person. */
export const BACKOFF_MS = [60_000, 5 * 60_000] as const;
export const MAX_ATTEMPTS = 3;

/** The proposals of payables the autopilot moves; any other kind is left to the runner that owns it. */
const KINDS = ["invoice_payment", "supplier_payment", "payee_add"] as const;
const PAYMENT_KINDS = new Set(["invoice_payment", "supplier_payment"]);
const MONEY = /^\d+\.\d{2}$/;
const TAKEN_IN = /\.(pdf|eml|jpe?g|png)$/i;
const RUNNING = "running:";

class LeaseLost extends Error {
  constructor() { super("another process took the autopilot's lease; this one stops"); this.name = "LeaseLost"; }
}

/** Whether a payment's terms are within the gate's limit: the same currency and a plain amount at or below it. */
export function withinAloneLimit(terms: { kind?: unknown; amount?: unknown; currency?: unknown }, limit: { currency: string; amount: string } | null): boolean {
  if (!limit || !MONEY.test(limit.amount) || !/^[A-Z]{3}$/.test(limit.currency)) return false;
  if (typeof terms.kind !== "string" || !PAYMENT_KINDS.has(terms.kind)) return false;
  if (typeof terms.amount !== "string" || !MONEY.test(terms.amount) || terms.currency !== limit.currency) return false;
  return toCents(terms.amount) <= toCents(limit.amount);
}

/** Whether a process is running on this host (a process on another host cannot be seen: it counts as running). */
export function processAlive(pid: number, host: string): boolean {
  if (host !== hostname()) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function defaultOwner(): { id: string; pid: number; host: string } {
  return { id: `${hostname()}:${process.pid}:${Date.now().toString(36)}`, pid: process.pid, host: hostname() };
}

interface Lease { owner: string; pid: number; host: string; heartbeat: string; taken_at: string }

/**
 * Takes the ledger's one autopilot lease, renews it, or says who holds it. Decided in one write transaction, so two
 * processes cannot both take it. A lease whose holder is gone from this host, or whose heartbeat is older than
 * LEASE_MS, is taken over.
 */
export function takeLease(db: DB, me: { id: string; pid: number; host: string }, now: Date, alive: (pid: number, host: string) => boolean = processAlive): { ok: true } | { ok: false; holder: Lease } {
  return db.transaction((): { ok: true } | { ok: false; holder: Lease } => {
    const held = db.prepare("SELECT owner, pid, host, heartbeat, taken_at FROM autopilot_lease WHERE id = 1").get() as Lease | undefined;
    const mine = held?.owner === me.id;
    // A fresh lease of this process is left as it is: a pass with nothing to do writes no row (the lease's heartbeat is
    // renewed once it is a third of LEASE_MS old).
    if (mine && Date.parse(held!.heartbeat) + LEASE_MS / 3 > now.getTime()) return { ok: true };
    const free = !held || mine || (held.host === me.host && !alive(held.pid, held.host)) || Date.parse(held.heartbeat) + LEASE_MS <= now.getTime();
    if (!free) return { ok: false, holder: held! };
    db.prepare(`INSERT INTO autopilot_lease (id, owner, pid, host, heartbeat, taken_at) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, pid = excluded.pid, host = excluded.host, heartbeat = excluded.heartbeat, taken_at = excluded.taken_at`)
      .run(me.id, me.pid, me.host, now.toISOString(), mine ? held!.taken_at : now.toISOString());
    if (held && !mine) audit(db, "system", "autopilot.lease_taken_over", held.owner, { from: { pid: held.pid, host: held.host, heartbeat: held.heartbeat }, to: { pid: me.pid, host: me.host } }, now);
    return { ok: true };
  }).immediate();
}

/** Renews this process's lease while a step runs; false when it is no longer this process's. */
function renewLease(db: DB, ownerId: string, now: Date): boolean {
  return db.prepare("UPDATE autopilot_lease SET heartbeat = ? WHERE id = 1 AND owner = ?").run(now.toISOString(), ownerId).changes === 1;
}

/** Gives the lease back (a clean stop; a killed process gives nothing back). */
export function releaseLease(db: DB, ownerId: string): void {
  db.prepare("DELETE FROM autopilot_lease WHERE id = 1 AND owner = ?").run(ownerId);
}

/** A person puts a parked item back: it is tried again on the next pass. True when it was parked. */
export function retryItem(db: DB, item: string, by: string, now = new Date()): boolean {
  return db.transaction(() => {
    const n = db.prepare("DELETE FROM autopilot_items WHERE item = ? AND state = 'needs_attention'").run(item).changes;
    if (n) audit(db, "human", "autopilot.retry", item, { by }, now);
    return n === 1;
  }).immediate();
}

/** The items parked for a person, with the reason. */
export function parkedItems(db: DB): { item: string; step: string; attempts: number; reason: string | null; updated_at: string }[] {
  return db.prepare("SELECT item, step, attempts, reason, updated_at FROM autopilot_items WHERE state = 'needs_attention' ORDER BY updated_at, item").all() as never;
}

interface Ctx { db: DB; deps: AutopilotDeps; me: { id: string; pid: number; host: string }; now: () => Date }
interface Done { outcome: StepOutcome; detail?: string }

const reasonOf = (e: unknown) => redactSecrets((e as Error)?.message ?? String(e)).replace(/\s+/g, " ").slice(0, 300);

/** Whether an item waits: parked for a person, or failed and not yet due again. */
function waiting(db: DB, item: string, now: Date): boolean {
  const r = db.prepare("SELECT state, next_try FROM autopilot_items WHERE item = ? AND state IN ('retrying', 'needs_attention')").get(item) as { state: string; next_try: string | null } | undefined;
  if (!r) return false;
  return r.state === "needs_attention" || (r.next_try !== null && Date.parse(r.next_try) > now.getTime());
}

function failed(ctx: Ctx, item: string, name: string, e: unknown, ms: number): void {
  const now = ctx.now();
  const reason = reasonOf(e);
  ctx.db.transaction(() => {
    const r = ctx.db.prepare("SELECT attempts FROM autopilot_items WHERE item = ? AND state = 'retrying'").get(item) as { attempts: number } | undefined;
    const attempts = (r?.attempts ?? 0) + 1;
    const parked = attempts >= MAX_ATTEMPTS;
    const next = parked ? null : new Date(now.getTime() + BACKOFF_MS[attempts - 1]!).toISOString();
    ctx.db.prepare(`INSERT INTO autopilot_items (item, step, state, attempts, next_try, reason, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item) DO UPDATE SET step = excluded.step, state = excluded.state, attempts = excluded.attempts, next_try = excluded.next_try, reason = excluded.reason, updated_at = excluded.updated_at`)
      .run(item, name, parked ? "needs_attention" : "retrying", attempts, next, reason, now.toISOString());
    audit(ctx.db, "system", "autopilot.step", item, { step: name, outcome: "failed", ms, attempt: attempts, reason, ...(next ? { next_try: next } : {}) }, now);
    if (parked) audit(ctx.db, "system", "autopilot.parked", item, { step: name, attempts, reason, state: "needs_attention" }, now);
  }).immediate();
}

/**
 * One step of one item: skipped while the item waits (parked, or backing off), otherwise run under the autopilot's
 * own origin. `run` returns null when there was nothing to do (no row is written), else what it did. A failure is
 * recorded and retried later; the third one in a row parks the item.
 */
async function step(ctx: Ctx, item: string, name: string, run: () => Promise<Done | null>): Promise<number> {
  if (waiting(ctx.db, item, ctx.now())) return 0;
  const lease = takeLease(ctx.db, ctx.me, ctx.now(), ctx.deps.alive);
  if (!lease.ok) throw new LeaseLost();
  await checkpoint(`autopilot:${name}`);
  const started = ctx.now().getTime();
  // The lease is renewed while the step runs (a Claude call may take minutes), so no other process takes it over.
  let lost = false;
  const beat = setInterval(() => {
    try { lost ||= !renewLease(ctx.db, ctx.me.id, ctx.now()); } catch { /* the ledger is closed: the process is stopping */ }
  }, ctx.deps.heartbeatMs ?? HEARTBEAT_MS);
  beat.unref?.();
  let done: Done | null;
  try {
    done = await withOrigin({ actor: "code", rule: `autopilot: ${name}` }, run);
  } catch (e) {
    if (e instanceof LeaseLost) throw e;
    failed(ctx, item, name, e, ctx.now().getTime() - started);
    return 0;
  } finally {
    clearInterval(beat);
  }
  if (lost) throw new LeaseLost();
  if (!done) return 0;
  const now = ctx.now();
  ctx.db.transaction(() => {
    ctx.db.prepare("DELETE FROM autopilot_items WHERE item = ? AND state = 'retrying'").run(item);
    audit(ctx.db, "system", "autopilot.step", item, { step: name, outcome: done.outcome, ms: now.getTime() - started, ...(done.detail ? { detail: done.detail } : {}) }, now);
  }).immediate();
  await checkpoint(`autopilot:${name}:done`);
  return 1;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const summary = (r: IngestResult): string =>
  r.kind === "invoice" ? `${r.invoice.id} ${r.invoice.status.replace(/_/g, " ")}`
    : r.kind === "duplicate_document" ? `already filed${r.invoice_id ? ` as ${r.invoice_id}` : ""}`
      : r.results.map(summary).join("; ") || "an e-mail with no PDF attached";

/**
 * Runs an approved proposal, marked so that a restart finishes exactly the executions this autopilot began. Null when
 * another process (the runner) began it first: the executor's approval check refused this one, and it is left to that
 * process, unmarked.
 */
async function execute(ctx: Ctx, proposalId: string, resume: boolean): Promise<Done | null> {
  const db = ctx.db;
  const mark = `${RUNNING}${proposalId}`;
  db.prepare(`INSERT INTO autopilot_items (item, step, state, attempts, updated_at) VALUES (?, 'execute', 'executing', 0, ?)
    ON CONFLICT(item) DO NOTHING`).run(mark, ctx.now().toISOString());
  if (resume) resuming.add(proposalId);
  let othersRun = false;
  try {
    await ctx.deps.execute(db, proposalId);
  } catch (e) {
    // beginExecution's refusal (src/policy/approvals.ts) of a proposal another process moved to EXECUTING after this
    // pass looked at it: this autopilot began nothing.
    othersRun = !resume && String((e as Error)?.message ?? "").includes(`${proposalId} is EXECUTING, not approved`);
    if (!othersRun) throw e;
  } finally {
    if (resume) resuming.delete(proposalId);
    // Still executing (an outside answer that is not known yet): the mark stays, and the next pass finishes it.
    if (othersRun || proposalStatus(db, proposalId) !== "EXECUTING") db.prepare("DELETE FROM autopilot_items WHERE item = ? AND state = 'executing'").run(mark);
  }
  if (othersRun) return null;
  return { outcome: "executed", detail: `${proposalId} ${String(proposalStatus(db, proposalId)).toLowerCase()}` };
}

const proposalStatus = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status ?? null;

/** Executions this autopilot began and a stop interrupted: finished first, before anything new starts. */
async function finishInterrupted(ctx: Ctx): Promise<number> {
  let moved = 0;
  const rows = ctx.db.prepare("SELECT item FROM autopilot_items WHERE state = 'executing' ORDER BY item").all() as { item: string }[];
  for (const { item } of rows) {
    const id = item.slice(RUNNING.length);
    const st = proposalStatus(ctx.db, id);
    if (st !== "EXECUTING" && st !== "APPROVED") {
      ctx.db.prepare("DELETE FROM autopilot_items WHERE item = ? AND state = 'executing'").run(item);
      continue;
    }
    moved += await step(ctx, id, "finish execution", () => execute(ctx, id, st === "EXECUTING"));
  }
  return moved;
}

/** New files in the watched folders, each taken in once (remembered by its hash, so a pass never files one again). */
async function takeIn(ctx: Ctx): Promise<number> {
  let moved = 0;
  const db = ctx.db;
  for (const folder of ctx.deps.folders) {
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const st = statSync(path);
      if (!st.isFile() || !TAKEN_IN.test(name)) continue;
      // The size before the bytes: a huge file is refused without being read (as src/ap/watch.ts does).
      const big = st.size > MAX_DOCUMENT_BYTES;
      // A file is known by its content and its name: a copy under another name is taken in once more, and the inbox
      // says it is already filed (one invoice per document, by the document's hash).
      const key = big ? `size:${name}:${st.size}:${Math.floor(st.mtimeMs)}` : `${sha256(readFileSync(path))}:${name}`;
      if (db.prepare("SELECT 1 FROM autopilot_files WHERE sha256 = ?").get(key)) continue;
      const remember = (outcome: string) => db.prepare("INSERT OR IGNORE INTO autopilot_files (sha256, name, outcome, taken_at) VALUES (?, ?, ?, ?)").run(key, name.slice(0, 200), outcome.slice(0, 300), ctx.now().toISOString());
      moved += await step(ctx, `file:${name.slice(0, 120)}:${key.slice(0, 12)}`, "take in", async () => {
        if (big) {
          remember("refused: too large");
          return { outcome: "refused", detail: `${name} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB; it was not read` };
        }
        let r: IngestResult;
        try {
          r = await ingestDocument(db, ctx.deps.inbox, { bytes: readFileSync(path), filename: name, source: "folder", meta: { folder } });
        } catch (e) {
          // A file the inbox refuses outright (not a PDF, a photo or an e-mail) is refused once, with the reason.
          if (!/nothing was filed/.test((e as Error).message)) throw e;
          remember(`refused: ${reasonOf(e)}`);
          return { outcome: "refused", detail: `${name}: ${reasonOf(e)}` };
        }
        remember(summary(r));
        return { outcome: "done", detail: `${name}: ${summary(r)}` };
      });
    }
  }
  return moved;
}

/** Documents filed but never read: a process stopped between filing one and storing its invoice. */
async function readUnread(ctx: Ctx): Promise<number> {
  let moved = 0;
  const grace = ctx.deps.orphanGraceMs ?? ORPHAN_GRACE_MS;
  const rows = ctx.db.prepare(`SELECT d.sha256, d.path, d.filename, d.source, d.meta_json, d.received_at FROM ap_documents d
    WHERE NOT EXISTS (SELECT 1 FROM ap_invoices i WHERE i.doc_sha256 = d.sha256) ORDER BY d.received_at, d.sha256`).all() as
    { sha256: string; path: string; filename: string; source: string; meta_json: string; received_at: string }[];
  for (const d of rows) {
    if (Date.parse(d.received_at) + grace > ctx.now().getTime()) continue;
    moved += await step(ctx, `doc:${d.sha256.slice(0, 16)}`, "read", async () => {
      const r = await ingestDocument(ctx.db, ctx.deps.inbox, { bytes: readFileSync(d.path), filename: d.filename, source: d.source as Source, meta: JSON.parse(d.meta_json) as Record<string, string> }, 0, { resumeUnread: true });
      return { outcome: "done", detail: summary(r) };
    });
  }
  return moved;
}

/** Whether an invoice still needs its coding (agents on) or its accrual in the sink. */
function needsBooking(ctx: Ctx, inv: ApInvoiceRow): boolean {
  if (!bookable(inv)) return false;
  if (apAgentsOn() && inv.doc_kind === "invoice" && !inv.coding) return true;
  return !!ctx.deps.inbox.sink && !accrualPushed(ctx.db, inv, ctx.deps.inbox.sink);
}

/** Whether the sink took this event of this invoice. */
const pushed = (db: DB, inv: ApInvoiceRow, sink: BookkeepingSink, event: "payment" | "reversal") =>
  !!db.prepare("SELECT 1 FROM ap_sink_events WHERE invoice_id = ? AND event = ? AND sink = ?").get(inv.id, event, sink.name);

/** When and by whom an invoice was rejected (its last ap.status row), for the reversal a sink never took. */
function rejection(db: DB, inv: ApInvoiceRow): { date: string; why: string } {
  const r = db.prepare("SELECT ts, json_extract(payload_json, '$.reason') AS reason FROM audit_log WHERE event = 'ap.status' AND subject = ? AND json_extract(payload_json, '$.to') = 'rejected' ORDER BY seq DESC LIMIT 1")
    .get(inv.id) as { ts: string; reason: string | null } | undefined;
  const date = (r?.ts ?? inv.updated_at).slice(0, 10);
  return { date, why: r?.reason?.startsWith("the CFO rejected") ? "the CFO rejected the payment" : "a person rejected the invoice" };
}

/** The open request to add this invoice's supplier (one per supplier, whichever invoice asked first). */
function openAdd(db: DB, inv: ApInvoiceRow): { add_id: string; status: string; proposal_id: string | null } | undefined {
  return db.prepare("SELECT add_id, status, proposal_id FROM payee_adds WHERE vendor = ? AND status NOT IN ('APPLIED', 'CLOSED') ORDER BY created_at DESC, add_id DESC LIMIT 1")
    .get(inv.vendor.trim()) as { add_id: string; status: string; proposal_id: string | null } | undefined;
}

async function invoices(ctx: Ctx): Promise<number> {
  let moved = 0;
  const db = ctx.db;
  for (const listed of apInvoices(db)) {
    const inv = apInvoice(db, listed.id)!;
    if (needsBooking(ctx, inv)) {
      moved += await step(ctx, inv.id, "book", async () => {
        await bookAccrual(db, ctx.deps.inbox, inv);
        const now = apInvoice(db, inv.id)!;
        if (ctx.deps.inbox.sink && bookable(now) && !accrualPushed(db, now, ctx.deps.inbox.sink)) throw new Error(`the bookkeeping sink (${ctx.deps.inbox.sink.name}) did not take the accrual`);
        return { outcome: "done", detail: now.coding ? `coded by ${now.coding.source}, booked` : "booked" };
      });
    }
    // A payment (or a CFO's rejection) the sink never took: it was down, or a stop came after the invoice moved on.
    const sink = ctx.deps.inbox.sink;
    if (sink && inv.status === "paid" && !pushed(db, inv, sink, "payment") && paymentEntries(db, inv).length) {
      moved += await step(ctx, inv.id, "book the payment", async () => {
        const coded = await ensureCoded(db, inv, { now: ctx.now });
        await pushOnce(db, sink, "accrual", accrualEntries(coded), coded, ctx.now());
        await pushOnce(db, sink, "payment", paymentEntries(db, inv), inv, ctx.now());
        if (!accrualPushed(db, inv, sink) || !pushed(db, inv, sink, "payment")) throw new Error(`the bookkeeping sink (${sink.name}) did not take the payment`);
        return { outcome: "done", detail: "the payment booked" };
      });
    }
    if (sink && inv.status === "rejected" && accrualPushed(db, inv, sink) && !pushed(db, inv, sink, "reversal")) {
      moved += await step(ctx, inv.id, "book the reversal", async () => {
        const r = rejection(db, inv);
        await pushOnce(db, sink, "reversal", reversalEntries(inv, r.date, r.why), inv, ctx.now());
        if (!pushed(db, inv, sink, "reversal")) throw new Error(`the bookkeeping sink (${sink.name}) did not take the reversal`);
        return { outcome: "done", detail: "the accrual taken back" };
      });
    }
    if (inv.status === "needs_vendor" && inv.doc_kind === "invoice") {
      const add = openAdd(db, inv);
      const onFile = suppliersOnFile(db).some((b) => b.name.trim() === inv.vendor.trim());
      if (!add && onFile) {
        // The supplier was added and a stop came before its invoices were checked again (src/ap/vendors.ts).
        moved += await step(ctx, inv.id, "check again", async () => {
          const [next] = await recheck(db, ctx.deps.inbox, [inv.id]);
          if (!next || next.status === "needs_vendor") throw new Error(`${inv.vendor} is on file, and the invoice still waits for a supplier; a person looks at it`);
          return { outcome: "done", detail: `${inv.id} ${next.status.replace(/_/g, " ")}` };
        });
      } else if (!add) {
        moved += await step(ctx, inv.id, "ask for the supplier", async () => {
          const r = requestPayeeAddForInvoice(db, inv.id, "treasury", ctx.now());
          return { outcome: "waiting for a person", detail: `${r.add_id}: a person checks ${r.vendor}'s account with the supplier` };
        });
      } else if (add.status === "VERIFIED") {
        moved += await step(ctx, add.add_id, "file the supplier for the CFO", async () => {
          const p = proposePayeeAdd(db, add.add_id, "treasury", ctx.now());
          return { outcome: "waiting for the CFO", detail: `${p.proposal_id}: the new supplier waits for the CFO's Face ID` };
        });
      }
    }
    if (inv.status === "ready" && inv.doc_kind === "invoice" && ctx.deps.rail) {
      const rail = ctx.deps.rail;
      moved += await step(ctx, inv.id, "plan the payment", async () => {
        const out = await payApInvoice(db, rail, inv.id, ctx.now(), ctx.deps.inbox.reader);
        if (out.kind !== "proposed") {
          // Blocked by the plan (a fraud signal): a person decides; it is not tried again.
          if (apInvoice(db, inv.id)?.status === "blocked") return { outcome: "waiting for a person", detail: out.reason };
          throw new Error(`the payment could not be planned: ${out.reason}`);
        }
        return { outcome: "waiting for the CFO", detail: `${out.proposal.proposal_id}: ${(JSON.parse(out.proposal.terms_json) as { currency: string; amount: string }).currency} ${(JSON.parse(out.proposal.terms_json) as { amount: string }).amount}` };
      });
    }
  }
  return moved;
}

/** Whether an earlier payment proposal of the same invoice failed, or its terms could never run. */
function failedBefore(db: DB, proposalId: string, terms: Record<string, unknown>): boolean {
  if (typeof terms.invoice_no !== "string") return true;
  return !!db.prepare(`SELECT 1 FROM proposals WHERE proposal_id <> ? AND kind IN ('invoice_payment', 'supplier_payment')
    AND json_extract(terms_json, '$.invoice_no') = ? AND status IN ('FAILED', 'NEEDS_REAPPROVAL') LIMIT 1`).get(proposalId, terms.invoice_no);
}

/** Proposals of payables: within the gate's limit approved by the gate; approved ones (by the CFO or the gate) executed. */
async function proposals(ctx: Ctx): Promise<number> {
  let moved = 0;
  const db = ctx.db;
  // A line of a payment batch is the batch's: decided with it by the CFO and run by the runner, never by the autopilot.
  const rows = db.prepare(`SELECT p.proposal_id, p.kind, p.status, p.terms_json FROM proposals p
    WHERE p.kind IN (${KINDS.map(() => "?").join(", ")}) AND p.status IN ('PENDING_APPROVAL', 'APPROVED')
      AND NOT EXISTS (SELECT 1 FROM batch_lines b JOIN proposals bp ON bp.proposal_id = b.batch_id
        WHERE b.proposal_id = p.proposal_id AND bp.status NOT IN ('REJECTED', 'EXPIRED', 'SUPERSEDED', 'NEEDS_REAPPROVAL'))
    ORDER BY p.created_at, p.proposal_id`)
    .all(...KINDS) as { proposal_id: string; kind: string; status: string; terms_json: string }[];
  for (const p of rows) {
    if (p.status === "PENDING_APPROVAL") {
      // A new supplier, and any payment above the limit, waits for the CFO's Face ID.
      const gate = ctx.deps.gate;
      const limit = gate?.limit(db) ?? null;
      const terms = JSON.parse(p.terms_json) as Record<string, unknown>;
      if (!gate || !withinAloneLimit(terms, limit)) continue;
      // A payment of an invoice whose earlier payment failed waits for the CFO: the gate never sends it again.
      if (failedBefore(db, p.proposal_id, terms)) continue;
      moved += await step(ctx, p.proposal_id, "approve within the limit", async () => {
        gate.approve(db, p.proposal_id, ctx.now());
        return { outcome: "done", detail: `${p.proposal_id} is within ${limit!.currency} ${limit!.amount}, approved by ${gate.name}` };
      });
    }
    if (proposalStatus(db, p.proposal_id) === "APPROVED") moved += await step(ctx, p.proposal_id, "execute", () => execute(ctx, p.proposal_id, false));
  }
  return moved;
}

/** The ledger-wide steps: payments followed, the ledger posted, the vault filed, the outside books synced. */
async function books(ctx: Ctx): Promise<number> {
  let moved = 0;
  const db = ctx.db;
  if (apInvoices(db, { status: "waiting_cfo" }).length) {
    moved += await step(ctx, "payments", "follow the payments", async () => {
      const changed = await syncPayments(db, { now: ctx.now, ...(ctx.deps.inbox.sink ? { sink: ctx.deps.inbox.sink } : {}), ...(ctx.deps.rail ? { rail: ctx.deps.rail } : {}) });
      return changed.length ? { outcome: "done", detail: changed.map((i) => `${i.id} ${i.status.replace(/_/g, " ")}`).join(", ") } : null;
    });
  }
  moved += await step(ctx, "ledger", "post the ledger", async () => {
    const r = syncLedger(db, ctx.now());
    return r.posted + r.reversed ? { outcome: "done", detail: `${r.posted} posted, ${r.reversed} reversed` } : null;
  });
  const vault = ctx.deps.vault;
  if (vault) {
    moved += await step(ctx, "vault", "file the vault", async () => {
      const r = await syncVault(db, vault, { now: ctx.now(), ...(ctx.deps.company ? { company: ctx.deps.company } : {}) });
      return r.added.length ? { outcome: "done", detail: `${r.added.length} new file(s)` } : null;
    });
  }
  const erp = ctx.deps.erp;
  if (erp) {
    moved += await step(ctx, `erp:${erp.name}`, "sync the books", async () => {
      // Only when what Purser would send changed since the last sync that went through.
      const items = ledgerItems(db);
      const print = sha256(Buffer.from(JSON.stringify(items.map((i) => [i.kind, i.object.id, JSON.stringify(i.object)]))));
      const key = `erp:${erp.name}`;
      if ((db.prepare("SELECT value FROM autopilot_state WHERE key = ?").get(key) as { value: string } | undefined)?.value === print) return null;
      const results = await syncAll(db, erp, items, { now: ctx.now });
      const bad = results.filter((r) => r.outcome === "failed");
      if (bad.length) throw new Error(`${bad.length} object(s) did not reach ${erp.name}: ${bad.map((r) => `${r.kind} ${r.id}: ${r.detail ?? ""}`).join("; ").slice(0, 200)}`);
      db.prepare("INSERT INTO autopilot_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, print);
      const sent = results.filter((r) => r.outcome !== "unchanged" && r.outcome !== "waiting");
      return { outcome: "done", detail: sent.length ? `${sent.length} object(s): ${[...new Set(sent.map((r) => r.outcome))].join(", ")}` : "nothing new to send" };
    });
  }
  return moved;
}

/**
 * One pass: every pending item one step forward. Returns how many steps moved something; 0 means nothing can move
 * without a person (or a backoff), so --once stops.
 */
export async function autopilotPass(db: DB, deps: AutopilotDeps): Promise<PassResult> {
  const now = deps.now ?? (() => new Date());
  const me = deps.owner ?? defaultOwner();
  const lease = takeLease(db, me, now(), deps.alive);
  if (!lease.ok) return { lease: "busy", moved: 0, holder: { owner: lease.holder.owner, pid: lease.holder.pid, host: lease.holder.host, heartbeat: lease.holder.heartbeat } };
  const ctx: Ctx = { db, deps, me, now };
  try {
    // What a stop left half done comes first: executions this autopilot began, then documents filed but never read.
    let moved = await finishInterrupted(ctx);
    moved += await readUnread(ctx);
    moved += await takeIn(ctx);
    moved += await invoices(ctx);
    moved += await proposals(ctx);
    moved += await books(ctx);
    return { lease: "held", moved };
  } catch (e) {
    if (e instanceof LeaseLost) return { lease: "busy", moved: 0 };
    throw e;
  }
}

/** Passes until one moves nothing (or the lease is another's); at most `maxPasses`. */
export async function drain(db: DB, deps: AutopilotDeps, maxPasses = 50): Promise<{ passes: number; moved: number; lease: PassResult["lease"]; holder?: PassResult["holder"] }> {
  let moved = 0;
  for (let i = 1; i <= maxPasses; i++) {
    const r = await autopilotPass(db, deps);
    moved += r.moved;
    if (r.lease === "busy") return { passes: i, moved, lease: "busy", ...(r.holder ? { holder: r.holder } : {}) };
    if (r.moved === 0) return { passes: i, moved, lease: "held" };
  }
  return { passes: maxPasses, moved, lease: "held" };
}
