// The hands-on demo's live counter (master list line 329): "N scenarios played, X frauds caught, Y signed with a
// passkey, Z payments without a signature". Every number is counted by code from one D1 table, try_tally, that holds
// hourly totals by kind and nothing else: no company id, no address, no visitor. The engine routes add to it as things
// happen (./engineRoutes.ts calls tallyFiled and tallyPay), and never fail a visitor's request because of it.
//
// "Payments without a signature" is a count, never a typed 0: a payment is tallied with whether the product's verifier
// accepted the visitor's own signature for it, and the counter shows how many were not. If that is ever above 0, the
// counter shows that number.
//
// GET /v1/try/counter answers it behind the switch `counter` (off when missing), cached for about 60 seconds.
import type { Sql } from "../store.js";

/** The table, made on first use like the cloud's other lazy tables (cloud/src/blobsSql.ts) and in migration 0002. */
export const TALLY_SCHEMA = "CREATE TABLE IF NOT EXISTS try_tally (hour TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (hour, kind))";

/** What is counted. played: an invoice filed (a sample, a scenario or one the visitor wrote). caught: an invoice the
 *  engine stopped as a possible fraud or duplicate, or a pay request with changed terms that was refused. signed: a
 *  payment the verifier accepted the visitor's signature for. unsigned: a payment it did not. */
export const TALLY_KINDS = ["played", "caught", "signed", "unsigned"] as const;
export type TallyKind = (typeof TALLY_KINDS)[number];

const ready = new WeakMap<Sql, Promise<void>>();
export function tallyTable(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = sql.run(TALLY_SCHEMA).then(() => undefined).catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

/** Adds one to a kind for the hour (YYYY-MM-DDTHH, UTC). Never throws: a counter must not break the visitor's request. */
export async function tally(sql: Sql, kind: TallyKind, now: Date): Promise<void> {
  try {
    await tallyTable(sql);
    await sql.run("INSERT INTO try_tally (hour, kind, n) VALUES (?, ?, 1) ON CONFLICT(hour, kind) DO UPDATE SET n = n + 1", [now.toISOString().slice(0, 13), kind]);
  } catch { /* the counter misses one; the request goes on */ }
}

/** Findings that mean the engine stopped an invoice someone could have been fooled by. */
const CAUGHT_FINDINGS = new Set(["possible_fraud", "possible_duplicate", "duplicate_document", "bank_details_changed", "prompt_injection"]);

/** An invoice was filed (a sample, a scenario, "write your own"): played, and caught when the engine stopped it. */
export async function tallyFiled(sql: Sql, out: { kind: string; invoice: { status: string; findings: { code: string }[] } | null } | { refused: unknown } | null, now: Date): Promise<void> {
  if (!out || "refused" in out) return;
  await tally(sql, "played", now);
  const stopped = out.kind === "duplicate_document" || (out.invoice !== null && (out.invoice.status === "blocked" || out.invoice.findings.some((f) => CAUGHT_FINDINGS.has(f.code))));
  if (stopped) await tally(sql, "caught", now);
}

/** A pay request was answered: a refused change is caught; a payment counts as signed or unsigned by the verifier's own answer. */
export async function tallyPay(sql: Sql, out: { outcome: string; changed: string[]; layers: { signature: { verified: boolean | null } } } | { bad: string } | null, now: Date): Promise<void> {
  if (!out || "bad" in out) return;
  if (out.outcome === "refused" && out.changed.length > 0) await tally(sql, "caught", now);
  if (out.outcome === "paid") await tally(sql, out.layers.signature.verified === true ? "signed" : "unsigned", now);
}

export interface Counter { played: number; caught: number; signed: number; without_signature: number; since: string | null; counted_at: string }

/** The totals of each kind since an hour (YYYY-MM-DDTHH), for the admin page's last hour and last day. */
export async function tallySince(sql: Sql, since: Date): Promise<Record<TallyKind, number>> {
  await tallyTable(sql);
  const rows = await sql.all<{ kind: string; n: number }>("SELECT kind, SUM(n) AS n FROM try_tally WHERE hour >= ? GROUP BY kind", [since.toISOString().slice(0, 13)]);
  return Object.fromEntries(TALLY_KINDS.map((k) => [k, Number(rows.find((r) => r.kind === k)?.n ?? 0)])) as Record<TallyKind, number>;
}

/** The totals over every hour kept, computed from the rows. */
export async function readCounter(sql: Sql, now: Date): Promise<Counter> {
  await tallyTable(sql);
  const rows = await sql.all<{ kind: string; n: number; since: string | null }>("SELECT kind, SUM(n) AS n, MIN(hour) AS since FROM try_tally GROUP BY kind");
  const of = (k: TallyKind) => Number(rows.find((r) => r.kind === k)?.n ?? 0);
  const since = rows.map((r) => r.since).filter((d): d is string => typeof d === "string").sort()[0] ?? null;
  return { played: of("played"), caught: of("caught"), signed: of("signed"), without_signature: of("unsigned"), since, counted_at: now.toISOString() };
}

/** The sentence the page shows, from the numbers. The last part is the counted number, whatever it is. */
export function counterLine(c: Counter): string {
  const n = (x: number, one: string, many: string) => `${x.toLocaleString("en-US")} ${x === 1 ? one : many}`;
  return `${n(c.played, "scenario played", "scenarios played")}, ${n(c.caught, "fraud caught", "frauds caught")}, ${n(c.signed, "payment signed with a passkey", "payments signed with a passkey")}, ${n(c.without_signature, "payment without a signature", "payments without a signature")}.`;
}

/** About 60 seconds per isolate: a crowd reading the counter makes one query a minute per Worker instance. */
export const COUNTER_TTL_MS = 60_000;
const cache = new WeakMap<Sql, { at: number; value: Counter }>();
export async function cachedCounter(sql: Sql, now: Date): Promise<Counter> {
  const hit = cache.get(sql);
  if (hit && now.getTime() - hit.at < COUNTER_TTL_MS && now.getTime() >= hit.at) return hit.value;
  const value = await readCounter(sql, now);
  cache.set(sql, { at: now.getTime(), value });
  return value;
}
