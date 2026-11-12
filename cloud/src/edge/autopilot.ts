// The nightly autopilot: the Worker's Cron Trigger (cloud/wrangler.jsonc triggers.crons, the scheduled job in
// cloud/src/worker.ts) runs each company's engine once a day (UTC), on the trigger's first firing that day (a daily or
// an hourly trigger alike), without anyone asking. For every open company that used its engine it follows the
// payments, books, archives and feeds the read model again (the engine's own sync, safe to
// repeat), then writes the day's digest: the invoices by status, the overdue ones (unpaid past their due date), the
// payments waiting for an approval, and whether the audit and ledger hash chains still verify. GET /v1/autopilot shows
// the company its digests.
//
// It never pays: no approval is made or used here, and the engine pays only with a passkey's signature over a
// proposal's exact terms. Test money only, like the engine itself.
//
// Once per company per day: the day's row is claimed before the run (an INSERT that only a first, failed or stale
// run can take), so a Cron Trigger that fires twice, or two isolates at once, run it once. A run that failed or
// never finished (stale after 30 minutes) is taken again by the next firing that day.
//
// Its tables (cloud/src/edge/schema.ts) are scoped by the caller's company in every read here, as the tenant layer
// does: the route takes the company from the caller only.
import type { EngineApi, EngineStatus, InvoiceView, Settled } from "../engine/api.js";
import { logEvent, redact } from "../log.js";
import type { Sql } from "../store.js";
import { edgeSql } from "./schema.js";

/** An invoice past its due date and not paid (nor rejected). */
export interface OverdueLine { id: string; vendor: string; invoice_no: string; currency: string; total: string; due_date: string; days_overdue: number; status: string }

export interface Digest {
  day: string;
  /** Always test money: the engine pays on a stand-in bank. */
  mode: "test_money";
  invoices: {
    total: number;
    by_status: Record<string, number>;
    /** The most overdue first, at most OVERDUE_LISTED; overdue_count counts them all. */
    overdue: OverdueLine[];
    overdue_count: number;
    /** Unpaid, due today or within the next seven days. */
    due_within_7_days: number;
    /** Payments filed and waiting for a person's passkey. */
    awaiting_approval: number;
  };
  /** What the engine's sync did: the ledger's entries now, the archive's new files, whether the read model was fed. */
  sync: { ledger_entries: number; archived: number; fed: boolean; error: string | null };
  /** Both hash chains recomputed tonight. */
  chains: { audit: boolean; ledger: boolean };
}

export const OVERDUE_LISTED = 20;
const DAY_MS = 86_400_000;
const CLOSED = new Set(["paid", "rejected"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The day's digest from what the engine answered. Pure: the tests hold it to its numbers. */
export function digestOf(day: string, invoices: InvoiceView[], settled: Settled, status: EngineStatus): Digest {
  const by_status: Record<string, number> = {};
  const overdue: OverdueLine[] = [];
  let soon = 0, waiting = 0;
  for (const inv of invoices) {
    by_status[inv.status] = (by_status[inv.status] ?? 0) + 1;
    if (inv.proposal?.status === "PENDING_APPROVAL") waiting++;
    if (CLOSED.has(inv.status) || !ISO_DAY.test(inv.due_date)) continue;
    const late = daysBetween(inv.due_date, day);
    if (late > 0) overdue.push({ id: inv.id, vendor: inv.vendor, invoice_no: inv.invoice_no, currency: inv.currency, total: inv.total, due_date: inv.due_date, days_overdue: late, status: inv.status });
    else if (late >= -7) soon++;
  }
  overdue.sort((a, b) => b.days_overdue - a.days_overdue || a.id.localeCompare(b.id));
  return {
    day, mode: "test_money",
    invoices: { total: invoices.length, by_status, overdue: overdue.slice(0, OVERDUE_LISTED), overdue_count: overdue.length, due_within_7_days: soon, awaiting_approval: waiting },
    sync: { ledger_entries: settled.ledger_entries, archived: settled.vault_added.length, fed: settled.fed, error: settled.error ? redact(settled.error).slice(0, 500) : null },
    chains: { audit: status.chains.audit, ledger: status.chains.ledger },
  };
}

/** A company used its engine (a write to /v1/engine): the autopilot runs for it from tonight. Safe to repeat. */
export async function noteEngineCompany(sql: Sql, tenantId: string, now: Date): Promise<void> {
  sql = edgeSql(sql);
  await sql.run("INSERT OR IGNORE INTO engine_companies (tenant_id, first_at) VALUES (?, ?)", [tenantId, now.toISOString()]);
}

export interface AutopilotOptions {
  now: Date;
  /** Companies per firing (default 100); the rest are first in line the next firing. */
  maxCompanies?: number;
  /** One company's run is given up after this long (default 60 s) and marked failed; the next firing takes it again. */
  timeoutMs?: number;
  /** A run still marked running after this long is taken again (default 30 minutes). */
  staleAfterMs?: number;
  /** Digests older than this many days are removed (default 90). */
  keepDays?: number;
}

export interface AutopilotReport { day: string; done: string[]; failed: string[]; skipped: number }

/** Tonight's runs: every open company that used its engine and has no finished run today. */
export async function runAutopilot(sql: Sql, engine: (tenantId: string) => EngineApi, o: AutopilotOptions): Promise<AutopilotReport> {
  sql = edgeSql(sql);
  const day = dayOf(o.now);
  const staleBefore = new Date(o.now.getTime() - (o.staleAfterMs ?? 30 * 60_000)).toISOString();
  // A purged company keeps nothing here either; old digests go.
  await sql.batch([
    { sql: "DELETE FROM autopilot_runs WHERE tenant_id IN (SELECT id FROM tenants WHERE name = '[purged]')" },
    { sql: "DELETE FROM engine_companies WHERE tenant_id IN (SELECT id FROM tenants WHERE name = '[purged]')" },
    { sql: "DELETE FROM autopilot_runs WHERE day < ?", params: [dayOf(new Date(o.now.getTime() - (o.keepDays ?? 90) * DAY_MS))] },
  ]);
  const due = await sql.all<{ tenant_id: string }>(
    `SELECT e.tenant_id FROM engine_companies e JOIN tenants t ON t.id = e.tenant_id
     WHERE t.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM autopilot_runs r WHERE r.tenant_id = e.tenant_id AND r.day = ? AND r.status = 'done')
     ORDER BY e.first_at, e.tenant_id LIMIT ?`, [day, o.maxCompanies ?? 100]);
  const report: AutopilotReport = { day, done: [], failed: [], skipped: 0 };
  // The firing's time, moved on by the time this run has taken (so a test's clock and the Worker's agree).
  const t0 = Date.now();
  const clock = () => new Date(o.now.getTime() + (Date.now() - t0)).toISOString();
  for (const { tenant_id } of due) {
    const startedAt = clock();
    const claim = await sql.run(
      `INSERT INTO autopilot_runs (tenant_id, day, status, started_at) VALUES (?, ?, 'running', ?)
       ON CONFLICT (tenant_id, day) DO UPDATE SET status = 'running', started_at = excluded.started_at, finished_at = NULL, digest_json = NULL, error = NULL
       WHERE autopilot_runs.status = 'failed' OR (autopilot_runs.status = 'running' AND autopilot_runs.started_at < ?)`,
      [tenant_id, day, startedAt, staleBefore]);
    if (claim.changes !== 1) { report.skipped++; continue; }
    const finish = (status: "done" | "failed", digest: Digest | null, error: string | null) => sql.run(
      "UPDATE autopilot_runs SET status = ?, finished_at = ?, digest_json = ?, error = ? WHERE tenant_id = ? AND day = ? AND status = 'running' AND started_at = ?",
      [status, clock(), digest ? JSON.stringify(digest) : null, error, tenant_id, day, startedAt]);
    try {
      const digest = await within(o.timeoutMs ?? 60_000, async () => {
        const e = engine(tenant_id);
        const settled = await e.sync();
        return digestOf(day, await e.invoices(), settled, await e.status());
      });
      await finish("done", digest, null);
      report.done.push(tenant_id);
    } catch (x) {
      await finish("failed", null, redact(x instanceof Error ? x.message : String(x)).slice(0, 500));
      report.failed.push(tenant_id);
    }
  }
  logEvent(report.failed.length ? "warn" : "info", "autopilot", { day, done: report.done.length, failed: report.failed, skipped: report.skipped }, o.now);
  return report;
}

function within<T>(ms: number, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error(`the engine did not answer within ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([run(), late]).finally(() => clearTimeout(timer));
}

export interface AutopilotRun { day: string; status: string; started_at: string; finished_at: string | null; digest: Digest | null; error: string | null }

/** The company's nightly runs, newest first. */
export async function autopilotRuns(sql: Sql, tenantId: string, limit: number): Promise<AutopilotRun[]> {
  sql = edgeSql(sql);
  const rows = await sql.all<{ day: string; status: string; started_at: string; finished_at: string | null; digest_json: string | null; error: string | null }>(
    "SELECT day, status, started_at, finished_at, digest_json, error FROM autopilot_runs WHERE tenant_id = ? ORDER BY day DESC LIMIT ?", [tenantId, limit]);
  return rows.map((r) => ({ day: r.day, status: r.status, started_at: r.started_at, finished_at: r.finished_at, digest: r.digest_json ? JSON.parse(r.digest_json) as Digest : null, error: r.error }));
}
