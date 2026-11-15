// Stage mode for the finals (docs/finals/stage-mode.md): the presenter's screen at /try/stage shows what the room does
// on its own phones, read from GET /v1/try/stage/stats. Counts only, for the event pool only, from the engine's own
// answers as they happen; no company id, no company name, no address, no token, no browser is kept or shown.
//
// What is kept: one row per step in try_stage, written only for a company in the event pool (try_companies.pool):
//   read      an invoice Claude read (the engine's own InvoiceView.read_by starts with "claude")
//   signed    an approval the engine accepted with the visitor's passkey (POST /v1/engine/proposals/{id}/approve)
//   paid      a payment the pay route ran on the simulated bank (outcome "paid"): its amount, its currency, and the
//             seconds since the company started, rounded to the second
//   refused   a pay request with changed terms that both layers refused: which of the three fields changed
// "started" is counted from try_companies itself (pool 'event', created_at), never copied.
//
// The wall answers zeros and an empty ticker while the event pool is off: the switch `starts` off, or no event token
// that is still live (./switches.ts). Nothing here sets a switch, a cap or a ceiling.
//
// About 2 seconds of cache per isolate, keyed by the minute `since` falls in; at most 120 requests a minute per address
// per isolate, counted in memory under a hash that changes every minute (no address is stored anywhere).
import { sha256Hex } from "../crypto.js";
import type { Sql } from "../store.js";
import { on, readSwitches, tokensOf, type Switches } from "./switches.js";

/** The table, made on first use like the other extras' tables, and in migration 0005_try_stage.sql. */
export const STAGE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS try_stage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('read', 'signed', 'paid', 'refused')), amount TEXT, currency TEXT, secs INTEGER, detail TEXT)",
  "CREATE INDEX IF NOT EXISTS try_stage_by_at ON try_stage (at)",
];

export const STAGE_KINDS = ["read", "signed", "paid", "refused"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];
/** The fields a visitor may change on the pay screen (src/engine/host.ts CHANGEABLE_TERMS), in the ticker's words. */
const CHANGED_WORDS: Record<string, string> = { amount: "the amount", currency: "the currency", beneficiary_name: "the payee", iban_last4: "the account", bic: "the BIC", invoice_no: "the invoice number" };

const ready = new WeakMap<Sql, Promise<void>>();
export function stageTable(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = (async () => { for (const s of STAGE_SCHEMA) await sql.run(s); })().catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

/** The company's start, when it is in the event pool; null for any other pool or a company that is not a try company. */
async function eventCompany(sql: Sql, tenantId: string): Promise<{ created_at: string } | null> {
  const row = await sql.first<{ pool: string; created_at: string }>("SELECT pool, created_at FROM try_companies WHERE tenant_id = ?", [tenantId]);
  return row && row.pool === "event" ? { created_at: row.created_at } : null;
}

async function note(sql: Sql, tenantId: string, now: Date, kind: StageKind, extra: { amount?: string; currency?: string; detail?: string; timed?: boolean } = {}): Promise<void> {
  try {
    const co = await eventCompany(sql, tenantId);
    if (!co) return;
    await stageTable(sql);
    const secs = extra.timed ? Math.max(0, Math.round((now.getTime() - Date.parse(co.created_at)) / 1000)) : null;
    await sql.run("INSERT INTO try_stage (at, kind, amount, currency, secs, detail) VALUES (?, ?, ?, ?, ?, ?)", [now.toISOString(), kind, extra.amount ?? null, extra.currency ?? null, Number.isFinite(secs) ? secs : null, extra.detail ?? null]);
    // Now and then, the rows older than two days go.
    if (Math.random() < 0.01) await sql.run("DELETE FROM try_stage WHERE at < ?", [new Date(now.getTime() - 2 * 86_400_000).toISOString()]);
  } catch { /* the wall misses one; the visitor's request goes on */ }
}

/** An invoice was filed: noted when Claude read it (the engine's own answer says who read it). Never throws. */
export async function stageFiled(sql: Sql, tenantId: string, readBy: string | null | undefined, now: Date): Promise<void> {
  if (typeof readBy === "string" && readBy.startsWith("claude")) await note(sql, tenantId, now, "read");
}

/** An approval was answered: noted when the engine accepted the passkey's signature (status approved). Never throws. */
export async function stageApproved(sql: Sql, tenantId: string, out: { status: string } | null | undefined, now: Date): Promise<void> {
  if (out?.status === "approved") await note(sql, tenantId, now, "signed");
}

const AMOUNT = /^\d{1,9}\.\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
/** A pay request was answered: a payment on the simulated bank, or a change both layers refused. Never throws. */
export async function stagePay(sql: Sql, tenantId: string, sent: Record<string, unknown>, out: { outcome: string; changed: string[] } | { bad: string } | null, now: Date): Promise<void> {
  if (!out || "bad" in out) return;
  if (out.outcome === "paid") {
    // The pay route runs only terms equal to the signed ones, so the sent amount is the paid amount.
    const amount = typeof sent.amount === "string" && AMOUNT.test(sent.amount) ? sent.amount : undefined;
    const currency = typeof sent.currency === "string" && CURRENCY.test(sent.currency) ? sent.currency : undefined;
    await note(sql, tenantId, now, "paid", { ...(amount && currency ? { amount, currency } : {}), timed: true });
  } else if (out.outcome === "refused" && out.changed.length > 0) {
    const detail = out.changed.filter((k) => k in CHANGED_WORDS).slice(0, 3).join(",");
    await note(sql, tenantId, now, "refused", { detail });
  }
}

export interface StageCounts { started: number; read_by_claude: number; signed: number; paid: number; refused: number }
export interface StageTick { at: string; kind: "started" | StageKind; text: string }
export interface StageStats { live: boolean; test_money: true; since: string; counted_at: string; counts: StageCounts; ticker: StageTick[] }

export const ZERO: StageCounts = { started: 0, read_by_claude: 0, signed: 0, paid: 0, refused: 0 };
export const TICKER_MAX = 12;

/** The event pool is open: starts are on and an event token is still live. */
export function eventPoolOn(s: Switches, now: Date): boolean {
  return on(s, "starts") && tokensOf(s).some((t) => t.pool === "event" && Date.parse(t.until) > now.getTime());
}

/** EUR 1,850.00, as the /try page writes amounts. */
export function money(amount: string, currency: string): string {
  const [w, d] = amount.split(".");
  return `${currency} ${w!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`;
}

/** 72 → "1 min 12 s"; 40 → "40 s"; 3720 → "1 h 2 min". */
export function duration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 1) return "under 1 s";
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  const m = Math.floor((s % 3600) / 60);
  return `${Math.floor(s / 3600)} h${m ? ` ${m} min` : ""}`;
}

/** One row of the ticker, in plain words; never a name, an id or a place. */
export function tickText(kind: StageTick["kind"], row: { amount?: string | null; currency?: string | null; secs?: number | null; detail?: string | null }): string {
  switch (kind) {
    case "started": return "Someone started a test company";
    case "read": return "Claude read someone's invoice";
    case "signed": return "Someone signed the exact terms with their passkey";
    case "paid": {
      const what = row.amount && row.currency ? money(row.amount, row.currency) : "a test invoice";
      return `Someone paid ${what} in ${typeof row.secs === "number" ? duration(row.secs) : "one go"}, signed with their passkey`;
    }
    case "refused": {
      const ks = (row.detail ?? "").split(",").filter((k) => k in CHANGED_WORDS);
      if (ks.length === 1 && ks[0] === "amount") return "Someone changed the amount after signing: refused";
      return `Someone changed ${ks.length ? ks.map((k) => CHANGED_WORDS[k]).join(" and ") : "the terms"} after signing: refused`;
    }
  }
}

/** `since` as given (ISO), not before 24 hours ago and not after now; missing or unreadable: 24 hours ago. Floored to the minute. */
export function sinceOf(raw: string | null, now: Date): Date {
  const floor = now.getTime() - 86_400_000;
  const t = raw && raw.length <= 40 ? Date.parse(raw) : NaN;
  const at = Number.isNaN(t) ? floor : Math.min(Math.max(t, floor), now.getTime());
  return new Date(Math.floor(at / 60_000) * 60_000);
}

/** The counts and the ticker since a moment, for the event pool. While the pool is off: zeros. */
export async function stageStats(sql: Sql, since: Date, now: Date, switches: Switches): Promise<StageStats> {
  const base = { test_money: true as const, since: since.toISOString(), counted_at: now.toISOString() };
  if (!eventPoolOn(switches, now)) return { live: false, ...base, counts: { ...ZERO }, ticker: [] };
  await stageTable(sql);
  const iso = since.toISOString();
  const started = Number((await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies WHERE pool = 'event' AND created_at >= ?", [iso]))?.n ?? 0);
  const rows = await sql.all<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM try_stage WHERE at >= ? GROUP BY kind", [iso]);
  const of = (k: StageKind) => Number(rows.find((r) => r.kind === k)?.n ?? 0);
  const steps = await sql.all<{ at: string; kind: StageKind; amount: string | null; currency: string | null; secs: number | null; detail: string | null }>(
    "SELECT at, kind, amount, currency, secs, detail FROM try_stage WHERE at >= ? AND kind IN ('signed', 'paid', 'refused') ORDER BY at DESC, id DESC LIMIT ?", [iso, TICKER_MAX]);
  const starts = await sql.all<{ at: string }>("SELECT created_at AS at FROM try_companies WHERE pool = 'event' AND created_at >= ? ORDER BY created_at DESC LIMIT ?", [iso, TICKER_MAX]);
  const ticker: StageTick[] = [
    ...steps.map((r) => ({ at: r.at, kind: r.kind, text: tickText(r.kind, r) })),
    ...starts.map((r) => ({ at: r.at, kind: "started" as const, text: tickText("started", {}) })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, TICKER_MAX)
    // To the second: the wall needs no finer time, and a coarser one says less about anyone.
    .map((t) => ({ ...t, at: `${t.at.slice(0, 19)}Z` }));
  return { live: true, ...base, counts: { started, read_by_claude: of("read"), signed: of("signed"), paid: of("paid"), refused: of("refused") }, ticker };
}

/** About two seconds per isolate and minute of `since`: a room of projectors and phones makes one query set per two seconds. */
export const STAGE_TTL_MS = 2_000;
const cache = new WeakMap<Sql, Map<string, { at: number; value: StageStats }>>();
export async function cachedStageStats(sql: Sql, since: Date, now: Date): Promise<StageStats> {
  let m = cache.get(sql);
  if (!m) cache.set(sql, (m = new Map()));
  const key = since.toISOString();
  const hit = m.get(key);
  if (hit && now.getTime() - hit.at < STAGE_TTL_MS && now.getTime() >= hit.at) return hit.value;
  let switches: Switches;
  try { switches = await readSwitches(sql); } catch { switches = {}; }
  const value = await stageStats(sql, since, now, switches);
  if (m.size > 200) m.clear();
  m.set(key, { at: now.getTime(), value });
  return value;
}

/** At most this many requests a minute per address per isolate. */
export const STAGE_PER_MINUTE = 120;
const hits = new Map<string, number>();
let hitsMinute = -1;
let pepper = "";
/** In memory only: the address is hashed with a random value that changes each minute, and the counts go with it. */
export async function stageRateOk(ip: string, now: Date): Promise<boolean> {
  const minute = Math.floor(now.getTime() / 60_000);
  if (minute !== hitsMinute) { hits.clear(); hitsMinute = minute; pepper = crypto.randomUUID(); }
  const k = await sha256Hex(`${pepper}:${ip}`);
  const n = (hits.get(k) ?? 0) + 1;
  hits.set(k, n);
  return n <= STAGE_PER_MINUTE;
}
