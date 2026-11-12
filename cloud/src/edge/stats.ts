// The cloud's own counters per day (UTC), for GET /v1/stats: what this cloud answered, across every company, and
// nothing about any one of them (no company's id, no route parameter, no amount). Counted after the answer is sent
// (the Worker's ctx.waitUntil, cloud/src/worker.ts), one write of a few upserts per /v1 request.
//
// What is counted is what the cloud itself answered: requests; refused (401, 403: no key, a wrong key, not allowed);
// rate_limited (429); errors (5xx); uploads (an invoice the engine took); payments_filed (a payment filed for
// approval); approvals (a passkey approval the engine accepted, which pays on the stand-in bank, test money); and
// engine_refusals (the engine would not file a payment, 409, or did not accept an approval).
import type { Sql } from "../store.js";
import { ensureEdgeSchema } from "./schema.js";

export const METRICS = ["requests", "refused", "rate_limited", "errors", "uploads", "payments_filed", "approvals", "engine_refusals"] as const;
export type Metric = (typeof METRICS)[number];

const PAY = /^\/v1\/engine\/invoices\/[^/]+\/pay$/;
const APPROVE = /^\/v1\/engine\/proposals\/[^/]+\/approve$/;

/**
 * What one answer counts for. Call it before the answer is sent: an approval's body is read from a copy taken here.
 * Requests outside /v1 (the console's pages) count for nothing.
 */
export function countsOf(req: Request, res: Response): Promise<Metric[]> {
  const path = new URL(req.url).pathname;
  if (!path.startsWith("/v1/")) return Promise.resolve([]);
  const out: Metric[] = ["requests"];
  const s = res.status;
  if (s === 401 || s === 403) out.push("refused");
  else if (s === 429) out.push("rate_limited");
  else if (s >= 500) out.push("errors");
  if (req.method !== "POST") return Promise.resolve(out);
  if (path === "/v1/engine/documents" && s === 200) out.push("uploads");
  if (PAY.test(path) && s === 200) out.push("payments_filed");
  if (PAY.test(path) && s === 409) out.push("engine_refusals");
  if (!(APPROVE.test(path) && s === 200)) return Promise.resolve(out);
  const copy = res.clone();
  return copy.json().then((b: unknown) => {
    out.push((b as { status?: unknown } | null)?.status === "approved" ? "approvals" : "engine_refusals");
    return out;
  }, () => out);
}

/** Adds one to each metric for the day. */
export async function countUp(sql: Sql, metrics: Metric[], now: Date): Promise<void> {
  if (!metrics.length) return;
  await ensureEdgeSchema(sql);
  const day = now.toISOString().slice(0, 10);
  await sql.batch(metrics.map((m) => ({ sql: "INSERT INTO daily_counts (day, metric, n) VALUES (?, ?, 1) ON CONFLICT (day, metric) DO UPDATE SET n = n + 1", params: [day, m] })));
}

export type DayCounts = { day: string } & Record<Metric, number>;

/** The last `days` days, newest first, every metric on every day (0 when nothing was counted). */
export async function dailyCounts(sql: Sql, now: Date, days: number): Promise<DayCounts[]> {
  await ensureEdgeSchema(sql);
  const list = Array.from({ length: days }, (_, i) => new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  const rows = await sql.all<{ day: string; metric: string; n: number }>("SELECT day, metric, n FROM daily_counts WHERE day >= ? AND day <= ?", [list[list.length - 1]!, list[0]!]);
  return list.map((day) => {
    const d = { day } as DayCounts;
    for (const m of METRICS) d[m] = 0;
    for (const r of rows) if (r.day === day && (METRICS as readonly string[]).includes(r.metric)) d[r.metric as Metric] = Number(r.n);
    return d;
  });
}

/** Counters older than `keepDays` go (the daily job). */
export async function pruneCounts(sql: Sql, now: Date, keepDays = 90): Promise<void> {
  await ensureEdgeSchema(sql);
  await sql.run("DELETE FROM daily_counts WHERE day < ?", [new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10)]);
}
