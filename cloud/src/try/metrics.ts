// The hands-on deployment's request figures for the owner's admin page (./adminPage.ts): per minute and route pattern,
// how many answers of each status class, and how long they took in fixed buckets. Nothing else: no address, no token,
// no company id, no body. The router calls noteRequest once per /v1 request while the deployment runs the hands-on
// demo (cloud/src/app.ts handle). Rows older than two days are deleted by the same call, now and then.
//
// p50 and p95 are read from the buckets, so they are upper bounds ("at most 400 ms"), and the page says so.
// Who read each invoice (Claude or Purser's code) is noted from the engine's own answer (InvoiceView.read_by).
import type { Sql } from "../store.js";

/** Upper bounds of the latency buckets in ms; the last bucket is everything slower. */
export const BUCKETS_MS = [25, 50, 100, 200, 400, 800, 1_600, 3_200, 6_400] as const;
const COLS = BUCKETS_MS.map((_, i) => `b${i}`).concat("b9");

export const METRICS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS try_metrics (minute INTEGER NOT NULL, route TEXT NOT NULL, class TEXT NOT NULL, n INTEGER NOT NULL, ${COLS.map((c) => `${c} INTEGER NOT NULL DEFAULT 0`).join(", ")}, PRIMARY KEY (minute, route, class))`,
  "CREATE TABLE IF NOT EXISTS try_status (key TEXT PRIMARY KEY, at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0)",
];

const ready = new WeakMap<Sql, Promise<void>>();
export function metricsTables(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = (async () => { for (const s of METRICS_SCHEMA) await sql.run(s); })().catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

export const bucketOf = (ms: number): number => { const i = BUCKETS_MS.findIndex((b) => ms <= b); return i < 0 ? BUCKETS_MS.length : i; };
/** 2xx, 3xx, 4xx by its common causes, 5xx: the "errors by kind" the page shows. */
export function classOf(status: number): string {
  if (status === 429) return "429 busy or limit";
  if (status === 401 || status === 403) return "401/403 refused";
  if (status === 404) return "404";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx other";
  return `${Math.floor(status / 100)}xx`;
}

/** One request, counted. Never throws: a figure must not break a visitor's request. */
export async function noteRequest(sql: Sql, route: string, status: number, ms: number, now: Date): Promise<void> {
  try {
    await metricsTables(sql);
    const minute = Math.floor(now.getTime() / 60_000);
    const b = COLS[bucketOf(Math.max(0, ms))]!;
    await sql.run(`INSERT INTO try_metrics (minute, route, class, n, ${b}) VALUES (?, ?, ?, 1, 1) ON CONFLICT(minute, route, class) DO UPDATE SET n = n + 1, ${b} = ${b} + 1`, [minute, route.slice(0, 80), classOf(status)]);
    // Now and then (about one request in 200), the rows older than two days go.
    if (minute % 7 === 0 && Math.random() < 0.005) await sql.run("DELETE FROM try_metrics WHERE minute < ?", [minute - 2 * 24 * 60]);
  } catch { /* the figure misses one; the request goes on */ }
}

/** Who read an invoice, from the engine's answer: "claude" for any claude:<model> or claude-scan:<model>, else "code". */
export async function noteReader(sql: Sql, readBy: string | null | undefined, now: Date): Promise<void> {
  if (!readBy) return;
  try {
    await metricsTables(sql);
    const key = readBy.startsWith("claude") ? "read:claude" : "read:code";
    await sql.run("INSERT INTO try_status (key, at, n) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET at = excluded.at, n = n + 1", [key, now.toISOString()]);
  } catch { /* as above */ }
}

/** A bucket bound in ms, or SLOWER for past the last bucket (JSON has no Infinity). */
export const SLOWER = `slower than ${BUCKETS_MS[BUCKETS_MS.length - 1]} ms`;
export interface Window { requests: number; by_class: Record<string, number>; p50_ms_at_most: number | string | null; p95_ms_at_most: number | string | null }

/** A percentile from bucket counts: the upper bound of the bucket it falls in (null for no requests; "slower" past the last). */
export function percentile(buckets: number[], q: number): number | string | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const want = Math.ceil(q * total);
  let run = 0;
  for (let i = 0; i < buckets.length; i++) {
    run += buckets[i]!;
    if (run >= want) return i < BUCKETS_MS.length ? BUCKETS_MS[i]! : SLOWER;
  }
  return SLOWER;
}

/** The requests since a moment, every route together. */
export async function windowSince(sql: Sql, since: Date): Promise<Window> {
  await metricsTables(sql);
  const minute = Math.floor(since.getTime() / 60_000);
  const rows = await sql.all<Record<string, number | string>>(`SELECT class, SUM(n) AS n, ${COLS.map((c) => `SUM(${c}) AS ${c}`).join(", ")} FROM try_metrics WHERE minute >= ? GROUP BY class`, [minute]);
  const buckets = COLS.map((c) => rows.reduce((a, r) => a + Number(r[c] ?? 0), 0));
  return {
    requests: rows.reduce((a, r) => a + Number(r.n ?? 0), 0),
    by_class: Object.fromEntries(rows.map((r) => [String(r.class), Number(r.n)])),
    p50_ms_at_most: percentile(buckets, 0.5),
    p95_ms_at_most: percentile(buckets, 0.95),
  };
}

export interface ReaderStatus { claude_reads: number; code_reads: number; last_claude_read: string | null; last_code_read: string | null }
export async function readerStatus(sql: Sql): Promise<ReaderStatus> {
  await metricsTables(sql);
  const rows = await sql.all<{ key: string; at: string; n: number }>("SELECT key, at, n FROM try_status WHERE key IN ('read:claude', 'read:code')");
  const c = rows.find((r) => r.key === "read:claude"), p = rows.find((r) => r.key === "read:code");
  return { claude_reads: Number(c?.n ?? 0), code_reads: Number(p?.n ?? 0), last_claude_read: c?.at ?? null, last_code_read: p?.at ?? null };
}
