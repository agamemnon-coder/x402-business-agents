// The live, read-only Metal mandate inspector: GET /api/metal/mandates (jury panel, 12 Nov: "nothing on /metal can be
// checked against the chain now"). It reads each agent's mandate on Northwind's account from Metal testnet, the same
// way the check of 12 November did (docs/runs/2026-11-12-metal-inspector.md): one eth_blockNumber, then one eth_call of
// the Mandate Binding's mandates(ref) per agent, all at that block. Reads only: nothing is signed or sent.
//
// It must stay cheap and safe:
// - one answer for everyone, kept INSPECTOR_TTL_SECONDS in the Durable Object's own SQL storage (a restarted object
//   reuses it); a failed refresh is kept the same way, so a dead RPC is not asked again on every visit;
// - a hard ceiling of INSPECTOR_DAILY_CEILING JSON-RPC calls a UTC day, counted in SQL and checked and counted before
//   each call is sent (the SQL API is synchronous, so no other request runs between the check and the count; an await
//   on the RPC would let them in, so nothing is checked after one); concurrent visits share the one refresh in flight;
// - a switch: the Worker variable METAL_INSPECTOR set to "off" (any case, trimmed) stops every call;
// - the RPC URL only from the Worker secret METAL_RPC_URL, held by this desk alone and never in an answer, a header,
//   an error or a log: every failure is told in fixed words.
// When the switch is off, the ceiling is reached, the secret is missing or the RPC fails, the answer is the record's own
// read (block 26003049, 12 November), with source "recorded", the reason and the day it was recorded: never "chain".

import { COMMON_HEADERS, type Sql } from "./core.js";

export const METAL_INSPECTOR_PATH = "/api/metal/mandates";
/** How long one answer serves everyone: 96 refreshes of 4 calls a day at most, 384 calls, under the ceiling. */
export const INSPECTOR_TTL_SECONDS = 900;
/** JSON-RPC calls a UTC day, all visitors together. */
export const INSPECTOR_DAILY_CEILING = 500;
/** The Worker variable that stops every call when it says "off". */
export const INSPECTOR_SWITCH = "METAL_INSPECTOR";
/** The Mandate Binding's mandates(bytes32 ref) view, its 4-byte selector (Metal's mandateBindingAbi). */
export const MANDATES_SELECTOR = "0x01e07972";
/** The reason a local server gives: it never calls the chain. */
export const LOCAL_REASON = "a local copy makes no chain calls";

/** One agent's mandate as the chain reports it: bound on the account, revoked or not, its spend and payments. */
export interface InspectorMandate { agent: string; ref: string; bound: boolean; revoked: boolean; spent: string; payments: number; bound_block: number }
/** The record's read, carried in the bundle (the Worker cannot read the repository). */
export interface MetalRecorded { account: string; recorded_on: string; block: number; read_at: string; mandates: InspectorMandate[] }
export interface InspectorAnswer {
  source: "chain" | "recorded";
  reason: string | null;
  network: "Metal testnet";
  account: string;
  block: number;
  read_at: string;
  recorded_on?: string;
  mandates: InspectorMandate[];
  cache_seconds: number;
  calls_today: number;
  ceiling: number;
  /** The exact read, so anyone with a Metal testnet RPC can make it: eth_call to the account at the block. */
  check: { method: "eth_call"; to: string; block: string; data: Record<string, string> };
}

/** "off" in any case, with spaces around it, turns the inspector off; anything else, or nothing, leaves it on. */
export const inspectorOff = (v: string | undefined): boolean => (v ?? "").trim().toLowerCase() === "off";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The calldata of mandates(ref). */
export function mandatesCalldata(ref: string): string {
  if (!HEX32.test(ref)) throw new Error("a mandate reference is 32 bytes of hex");
  return `${MANDATES_SELECTOR}${ref.slice(2).toLowerCase()}`;
}

/**
 * mandates(ref)'s answer: one tuple (address principal, bool revoked, bytes32 agentX, bytes32 agentY, string kid,
 * bytes32 openSdHash, uint64 boundBlock, uint64 occurrences, uint128 spent). The tuple holds a string, so the answer
 * starts with its offset, then the tuple's nine head words; the kid itself follows and is not needed.
 */
export function decodeMandateState(hex: string): { principal: string; revoked: boolean; boundBlock: bigint; occurrences: bigint; spent: bigint } {
  if (!/^0x[0-9a-fA-F]*$/.test(hex) || (hex.length - 2) % 64 !== 0) throw new Error("not an ABI answer");
  const words = hex.slice(2).match(/.{64}/g) ?? [];
  const at = Number(BigInt(`0x${words[0] ?? "0"}`) / 32n);
  if (!Number.isSafeInteger(at) || at < 1 || words.length < at + 9) throw new Error("not a mandates(ref) answer");
  const w = (i: number) => BigInt(`0x${words[at + i]!}`);
  return { principal: `0x${words[at]!.slice(24)}`, revoked: w(1) !== 0n, boundBlock: w(6), occurrences: w(7), spent: w(8) };
}

/** An amount of 18-decimal base units in words: "1.18"; a part of a cent in full. */
export function amountOf(units: bigint): string {
  const whole = units / 10n ** 18n, frac = (units % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}`;
}

/** The record's read (docs/runs/2026-11-12-metal-inspector.json), checked field by field; anything else: null. */
export function metalRecordedOf(record: unknown): MetalRecorded | null {
  const r = record as { account?: { address?: unknown }; read?: { block?: unknown; read_at?: unknown; mandates?: unknown } } | null;
  const account = r?.account?.address, read = r?.read;
  if (typeof account !== "string" || !ADDRESS.test(account) || !read || typeof read.block !== "number" || typeof read.read_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(read.read_at) || !Array.isArray(read.mandates) || !read.mandates.length) return null;
  const mandates: InspectorMandate[] = [];
  for (const m of read.mandates as Record<string, unknown>[]) {
    if (typeof m.agent !== "string" || typeof m.ref !== "string" || !HEX32.test(m.ref) || typeof m.bound !== "boolean" || typeof m.revoked !== "boolean"
      || typeof m.spent !== "string" || !/^\d+\.\d+$/.test(m.spent) || typeof m.occurrences !== "number" || typeof m.bound_block !== "number") return null;
    mandates.push({ agent: m.agent, ref: m.ref, bound: m.bound, revoked: m.revoked, spent: m.spent, payments: m.occurrences, bound_block: m.bound_block });
  }
  return { account, recorded_on: read.read_at.slice(0, 10), block: read.block, read_at: read.read_at, mandates };
}

/** A store that keeps nothing, for a local copy: it never calls the chain, so it has nothing to count or keep. */
const NO_STORE: Sql = { exec: () => ({ toArray: () => [] }) };
/** The desk of a local copy (the judge's server, the local relay, the dashboard): the record's read, no chain call. */
export const localInspector = (recorded: MetalRecorded | null): MetalInspector => new MetalInspector(NO_STORE, { off: LOCAL_REASON, recorded });

/** One log of MandateRefused (event MandateRefused(bytes32 indexed ref, address indexed to, bytes20 l3aDigest, bytes agentKey, uint256 amount, uint8 reason)). */
export interface RefusalLog { address: string; topics: string[]; data: string }
export const MANDATE_REFUSED_TOPIC = "0x4084f1f1447ac5e65f441c04fd31a9d7e5874a7d4d1d4853f5bb5211b9717116";
/** Metal's refusal reasons, in the order of the contract's enum (@metalntwx/metal-pay). */
export const REFUSAL_REASONS = ["None", "NoMandate", "Revoked", "Expired", "BadSignature", "NonceUsed", "OutsideWindow", "PayeeNotAllowed", "OverPerPaymentCap", "OverBudget", "OutsideRecurrence", "OverOccurrences"] as const;
/** A MandateRefused log decoded: the mandate, the payee, the amount (18 decimals) and the reason; null for any other log. */
export function decodeRefusal(log: RefusalLog): { account: string; ref: string; to: string; l3aDigest: string; agentKey: string; amount: string; reason: number; reason_name: string } | null {
  if (log.topics[0]?.toLowerCase() !== MANDATE_REFUSED_TOPIC || log.topics.length !== 3 || !/^0x([0-9a-fA-F]{64})*$/.test(log.data)) return null;
  const words = log.data.slice(2).match(/.{64}/g) ?? [];
  if (words.length < 5) return null;
  const at = Number(BigInt(`0x${words[1]!}`) / 32n), len = Number(BigInt(`0x${words[at] ?? "0"}`));
  const reason = Number(BigInt(`0x${words[3]!}`));
  // The key's stated length must fit in the data that follows it: a log cut short is no refusal.
  if (!Number.isSafeInteger(at) || at < 4 || at >= words.length || !Number.isSafeInteger(len) || words.length < at + 1 + Math.ceil(len / 32) || reason >= REFUSAL_REASONS.length) return null;
  return {
    account: log.address.toLowerCase(), ref: log.topics[1]!.toLowerCase(), to: `0x${log.topics[2]!.slice(-40)}`.toLowerCase(), l3aDigest: `0x${words[0]!.slice(0, 40)}`,
    agentKey: `0x${words.slice(at + 1).join("").slice(0, len * 2)}`, amount: amountOf(BigInt(`0x${words[2]!}`)), reason, reason_name: REFUSAL_REASONS[reason]!,
  };
}

/** A stop on the way to the chain, in fixed words: no URL, no message of the RPC's, ever reaches an answer. */
class InspectorStop extends Error {}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export interface InspectorOptions {
  /** The RPC URL (the secret METAL_RPC_URL). */
  rpcUrl?: string;
  /** Why no call is made, when none may be: the switch ("switched off") or a local copy (LOCAL_REASON). */
  off?: string | null;
  /** The record's read, from the bundle. */
  recorded: MetalRecorded | null;
  fetcher?: typeof fetch;
  now?: () => Date;
  ttlSeconds?: number;
  ceiling?: number;
}

export class MetalInspector {
  /** The refresh in flight, shared by every visit that comes while it runs. */
  private inflight: Promise<InspectorAnswer> | null = null;

  constructor(private readonly sql: Sql, private readonly opts: InspectorOptions) {
    sql.exec("CREATE TABLE IF NOT EXISTS mi_calls (day TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS mi_cache (k TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL)");
  }

  private now(): Date { return this.opts.now?.() ?? new Date(); }
  private get ttl(): number { return this.opts.ttlSeconds ?? INSPECTOR_TTL_SECONDS; }
  private get ceiling(): number { return this.opts.ceiling ?? INSPECTOR_DAILY_CEILING; }

  /** The JSON-RPC calls made today (UTC), all visitors together. */
  callsToday(now = this.now()): number {
    const rows = this.sql.exec("SELECT n FROM mi_calls WHERE day = ?", utcDay(now)).toArray() as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return this.json(405, { error: "GET only" }, { allow: "GET, HEAD" });
    if (!this.opts.recorded) return this.json(503, { error: "this bundle carries no recorded read" });
    return this.json(200, await this.answer());
  }

  /** The answer: the cached one while it is fresh; else, when calls may be made, one refresh for everyone. */
  async answer(): Promise<InspectorAnswer> {
    const now = this.now();
    if (this.opts.off) return this.recordedAnswer(this.opts.off, now);
    if (!this.opts.rpcUrl) return this.recordedAnswer("no RPC configured", now);
    const cached = this.cached(now);
    if (cached) return { ...cached, calls_today: this.callsToday(now) };
    this.inflight ??= this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private cached(now: Date): InspectorAnswer | null {
    const rows = this.sql.exec("SELECT at, body FROM mi_cache WHERE k = 'answer'").toArray() as { at: number; body: string }[];
    const row = rows[0];
    if (!row || now.getTime() - row.at >= this.ttl * 1000) return null;
    try { return JSON.parse(row.body) as InspectorAnswer; } catch { return null; }
  }

  private keep(answer: InspectorAnswer, now: Date): void {
    this.sql.exec("INSERT INTO mi_cache (k, at, body) VALUES ('answer', ?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at, body = excluded.body", now.getTime(), JSON.stringify(answer));
    this.sql.exec("DELETE FROM mi_calls WHERE day < ?", utcDay(now));
  }

  private check(rec: MetalRecorded, blockHex: string): InspectorAnswer["check"] {
    return { method: "eth_call", to: rec.account, block: blockHex, data: Object.fromEntries(rec.mandates.map((m) => [m.agent, mandatesCalldata(m.ref)])) };
  }

  private recordedAnswer(reason: string, now: Date): InspectorAnswer {
    const rec = this.opts.recorded!;
    return {
      source: "recorded", reason, network: "Metal testnet", account: rec.account, block: rec.block, read_at: rec.read_at, recorded_on: rec.recorded_on,
      mandates: rec.mandates, cache_seconds: this.ttl, calls_today: this.callsToday(now), ceiling: this.ceiling, check: this.check(rec, `0x${rec.block.toString(16)}`),
    };
  }

  private async refresh(): Promise<InspectorAnswer> {
    const rec = this.opts.recorded!, started = this.now();
    let answer: InspectorAnswer;
    try {
      const blockHex = await this.call("eth_blockNumber", []);
      if (!/^0x[0-9a-fA-F]{1,16}$/.test(blockHex)) throw new InspectorStop("the RPC answered with an error");
      const mandates: InspectorMandate[] = [];
      for (const m of rec.mandates) {
        const d = decodeMandateState(await this.call("eth_call", [{ to: rec.account, data: mandatesCalldata(m.ref) }, blockHex]));
        mandates.push({ agent: m.agent, ref: m.ref, bound: d.principal.toLowerCase() === rec.account.toLowerCase(), revoked: d.revoked, spent: amountOf(d.spent), payments: Number(d.occurrences), bound_block: Number(d.boundBlock) });
      }
      answer = {
        source: "chain", reason: null, network: "Metal testnet", account: rec.account, block: Number(BigInt(blockHex)), read_at: started.toISOString(),
        mandates, cache_seconds: this.ttl, calls_today: 0, ceiling: this.ceiling, check: this.check(rec, blockHex.toLowerCase()),
      };
    } catch (e) {
      answer = this.recordedAnswer(e instanceof InspectorStop ? e.message : "the RPC answered with an error", started);
    }
    const now = this.now();
    this.keep(answer, now);
    return { ...answer, calls_today: this.callsToday(now) };
  }

  /** One JSON-RPC call: the ceiling is checked and the call counted before it is sent. */
  private async call(method: "eth_blockNumber" | "eth_call", params: unknown[]): Promise<string> {
    const day = utcDay(this.now());
    if (this.callsToday() >= this.ceiling) throw new InspectorStop("today's call ceiling is reached");
    this.sql.exec("INSERT INTO mi_calls (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1", day);
    let res: Response;
    try {
      res = await (this.opts.fetcher ?? fetch)(this.opts.rpcUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new InspectorStop("the RPC did not answer");
    }
    if (!res.ok) throw new InspectorStop("the RPC answered with an error");
    let body: { result?: unknown; error?: unknown };
    try { body = (await res.json()) as { result?: unknown; error?: unknown }; } catch { throw new InspectorStop("the RPC answered with an error"); }
    if (body.error !== undefined || typeof body.result !== "string") throw new InspectorStop("the RPC answered with an error");
    return body.result;
  }

  private json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", ...extra } });
  }
}
