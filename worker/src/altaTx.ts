// "Check it on chain" on /proof (26 Nov): GET /api/alta/tx/<hash> reads one transaction and its receipt from Alta
// testnet and answers what the chain returns: status, block, from, to, the calldata and the logs. The page compares them
// with what the repo says (the anchor head recomputed from the committed records, the mandate the record names).
//
// Why a read on the site and not in the visitor's browser: Alta testnet's RPC allows any origin (CORS *), but its
// address carries an access key in its path, the one the Worker holds as the secret METAL_RPC_URL. Putting it in a page
// would publish it, and the page's CSP would have to allow that host. So the page asks this site (connect-src 'self',
// unchanged) and the Worker reads the chain, under the same rules as /metal's inspector (./metalInspector.ts):
// - only transactions named in Purser's committed records, built into the bundle (PAGES.altaTxTargets): any other hash
//   is a 404 and no call;
// - read-only JSON-RPC (eth_getTransactionByHash, eth_getTransactionReceipt), nothing signed or sent;
// - one answer per transaction for everyone, kept ALTA_TX_TTL_SECONDS in the Durable Object's SQL (a failed read is
//   kept too, ALTA_TX_RETRY_SECONDS, so a dead RPC is not asked on every click); concurrent clicks share one read;
// - a ceiling of ALTA_TX_DAILY_CEILING calls a UTC day, checked and counted before each call;
// - a switch: ALTA_TX_CHECK (or the inspector's METAL_INSPECTOR) set to "off" stops every call;
// - the RPC URL never in an answer, a header, an error or a log: every failure is told in fixed words.
// When no call may be made, the answer says so (source "unavailable") and carries no chain data: nothing is made up.

import { COMMON_HEADERS, type Sql } from "./core.js";

export const ALTA_TX_PATH = "/api/alta/tx";
export const ALTA_TX_TTL_SECONDS = 3600;
export const ALTA_TX_RETRY_SECONDS = 300;
export const ALTA_TX_DAILY_CEILING = 300;
export const ALTA_TX_SWITCH = "ALTA_TX_CHECK";
/** Alta testnet's chain id (src/metal/network.ts CHAIN_ID). */
export const ALTA_CHAIN_ID = 63825;
export const LOCAL_TX_REASON = "a local copy makes no chain calls";

/** One transaction the site may read: from a committed record, with the label and record the page shows. */
export interface AltaTxTarget { hash: string; label: string; kind: "anchor" | "refusal"; record: string }

export interface AltaTxLog { address: string; topics: string[]; data: string | null; data_bytes: number }
export interface AltaTxRead { chain_id: number | null; status: "success" | "reverted" | "pending"; block: number | null; from: string; to: string | null; input: string | null; input_bytes: number; logs: AltaTxLog[] }

export interface AltaTxAnswer {
  source: "chain" | "unavailable";
  /** In plain words what this answer is: read live (when, which block), or not read and why. */
  says: string;
  reason: string | null;
  network: "Alta testnet";
  hash: string;
  label: string;
  kind: AltaTxTarget["kind"];
  record: string;
  /** What the chain returned; null when not read, or when the chain does not know the hash (found: false). */
  tx: AltaTxRead | null;
  found: boolean | null;
  read_at: string | null;
  cache_seconds: number;
  calls_today: number;
  ceiling: number;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QTY = /^0x[0-9a-fA-F]{1,16}$/;
const HEX = /^0x([0-9a-fA-F]{2})*$/;
/** The largest calldata or log data kept in an answer, in hex digits (4 KiB); longer is told by its size only. */
const MAX_HEX = 8192;
const MAX_LOGS = 16;

export const altaTxOff = (...vs: (string | undefined)[]): boolean => vs.some((v) => (v ?? "").trim().toLowerCase() === "off");
/** The transaction hash an address asks for, lower-cased; null when the path is not /api/alta/tx/<32-byte hash>. */
export function altaTxHashOf(path: string): string | null {
  if (!path.startsWith(`${ALTA_TX_PATH}/`)) return null;
  const h = path.slice(ALTA_TX_PATH.length + 1);
  return HASH.test(h) ? h.toLowerCase() : null;
}
export const isAltaTxPath = (path: string) => path === ALTA_TX_PATH || path.startsWith(`${ALTA_TX_PATH}/`);

class Stop extends Error {}
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const hexOrNull = (h: unknown) => (typeof h === "string" && HEX.test(h) ? (h.length - 2 <= MAX_HEX ? h.toLowerCase() : null) : null);
const bytesOf = (h: unknown) => (typeof h === "string" && HEX.test(h) ? (h.length - 2) / 2 : 0);

/** The transaction and its receipt, as the chain returned them, checked field by field; anything malformed: Stop. */
export function readOf(hash: string, tx: unknown, receipt: unknown): AltaTxRead {
  const t = tx as Record<string, unknown>, r = receipt as Record<string, unknown> | null;
  const bad = () => new Stop("the RPC answered with something else");
  if (!t || typeof t !== "object" || String(t.hash).toLowerCase() !== hash || !ADDRESS.test(String(t.from)) || !(t.to === null || t.to === undefined || ADDRESS.test(String(t.to))) || typeof t.input !== "string" || !HEX.test(t.input)) throw bad();
  if (t.chainId !== undefined && !QTY.test(String(t.chainId))) throw bad();
  let status: AltaTxRead["status"] = "pending", block: number | null = null, logs: AltaTxLog[] = [];
  if (r) {
    if (!QTY.test(String(r.blockNumber)) || !["0x1", "0x0"].includes(String(r.status)) || !Array.isArray(r.logs)) throw bad();
    status = r.status === "0x1" ? "success" : "reverted";
    block = Number(BigInt(String(r.blockNumber)));
    logs = (r.logs as Record<string, unknown>[]).slice(0, MAX_LOGS).map((l) => {
      if (!ADDRESS.test(String(l.address)) || !Array.isArray(l.topics) || !l.topics.every((x) => HASH.test(String(x))) || typeof l.data !== "string" || !HEX.test(l.data)) throw bad();
      return { address: String(l.address).toLowerCase(), topics: (l.topics as string[]).map((x) => x.toLowerCase()), data: hexOrNull(l.data), data_bytes: bytesOf(l.data) };
    });
  }
  return {
    chain_id: t.chainId === undefined ? null : Number(BigInt(String(t.chainId))), status, block,
    from: String(t.from).toLowerCase(), to: t.to ? String(t.to).toLowerCase() : null, input: hexOrNull(t.input), input_bytes: bytesOf(t.input), logs,
  };
}

export interface AltaTxOptions {
  rpcUrl?: string;
  /** Why no call is made, when none may be: the switch ("switched off") or a local copy (LOCAL_TX_REASON). */
  off?: string | null;
  targets: AltaTxTarget[];
  fetcher?: typeof fetch;
  now?: () => Date;
  ttlSeconds?: number;
  retrySeconds?: number;
  ceiling?: number;
}

export class AltaTxDesk {
  private readonly inflight = new Map<string, Promise<AltaTxAnswer>>();
  private readonly targets: Map<string, AltaTxTarget>;

  constructor(private readonly sql: Sql, private readonly opts: AltaTxOptions) {
    sql.exec("CREATE TABLE IF NOT EXISTS alta_tx_calls (day TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS alta_tx_cache (k TEXT PRIMARY KEY, at INTEGER NOT NULL, ttl INTEGER NOT NULL, body TEXT NOT NULL)");
    this.targets = new Map(opts.targets.filter((t) => HASH.test(t.hash)).map((t) => [t.hash.toLowerCase(), t]));
  }

  private now(): Date { return this.opts.now?.() ?? new Date(); }
  private get ceiling(): number { return this.opts.ceiling ?? ALTA_TX_DAILY_CEILING; }

  callsToday(now = this.now()): number {
    const rows = this.sql.exec("SELECT n FROM alta_tx_calls WHERE day = ?", utcDay(now)).toArray() as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return this.json(405, { error: "GET only" }, { allow: "GET, HEAD" });
    const hash = altaTxHashOf(new URL(req.url).pathname);
    const target = hash ? this.targets.get(hash) : undefined;
    if (!hash || !target) return this.json(404, { error: "not a transaction from Purser's committed records" });
    return this.json(200, await this.answer(target));
  }

  async answer(target: AltaTxTarget): Promise<AltaTxAnswer> {
    const now = this.now(), hash = target.hash.toLowerCase();
    if (this.opts.off) return this.unavailable(target, this.opts.off, now);
    if (!this.opts.rpcUrl) return this.unavailable(target, "no RPC configured", now);
    const cached = this.cached(hash, now);
    if (cached) return { ...cached, calls_today: this.callsToday(now) };
    let p = this.inflight.get(hash);
    if (!p) {
      p = this.refresh(target).finally(() => { this.inflight.delete(hash); });
      this.inflight.set(hash, p);
    }
    return p;
  }

  private cached(hash: string, now: Date): AltaTxAnswer | null {
    const row = (this.sql.exec("SELECT at, ttl, body FROM alta_tx_cache WHERE k = ?", hash).toArray() as { at: number; ttl: number; body: string }[])[0];
    if (!row || now.getTime() - row.at >= row.ttl * 1000) return null;
    try { return JSON.parse(row.body) as AltaTxAnswer; } catch { return null; }
  }

  private keep(hash: string, a: AltaTxAnswer, ttl: number, now: Date): void {
    this.sql.exec("INSERT INTO alta_tx_cache (k, at, ttl, body) VALUES (?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET at = excluded.at, ttl = excluded.ttl, body = excluded.body", hash, now.getTime(), ttl, JSON.stringify(a));
    this.sql.exec("DELETE FROM alta_tx_calls WHERE day < ?", utcDay(now));
  }

  private base(t: AltaTxTarget, ttl: number, now: Date) {
    return { network: "Alta testnet" as const, hash: t.hash.toLowerCase(), label: t.label, kind: t.kind, record: t.record, cache_seconds: ttl, calls_today: this.callsToday(now), ceiling: this.ceiling };
  }

  private unavailable(t: AltaTxTarget, reason: string, now: Date): AltaTxAnswer {
    return { source: "unavailable", says: `Not read from the chain: ${reason}.`, reason, tx: null, found: null, read_at: null, ...this.base(t, this.opts.retrySeconds ?? ALTA_TX_RETRY_SECONDS, now) };
  }

  private async refresh(t: AltaTxTarget): Promise<AltaTxAnswer> {
    const hash = t.hash.toLowerCase(), started = this.now();
    let answer: AltaTxAnswer, ttl: number;
    try {
      const tx = await this.call("eth_getTransactionByHash", [hash]);
      if (tx === null) {
        ttl = this.opts.retrySeconds ?? ALTA_TX_RETRY_SECONDS;
        answer = { source: "chain", says: `Read live from Alta testnet at ${started.toISOString().slice(11, 16)} UTC: the chain does not know this transaction.`, reason: null, tx: null, found: false, read_at: started.toISOString(), ...this.base(t, ttl, started) };
      } else {
        const receipt = await this.call("eth_getTransactionReceipt", [hash]);
        const read = readOf(hash, tx, receipt);
        if (read.chain_id !== null && read.chain_id !== ALTA_CHAIN_ID) throw new Stop("the RPC is not Alta testnet's");
        ttl = read.status === "pending" ? (this.opts.retrySeconds ?? ALTA_TX_RETRY_SECONDS) : (this.opts.ttlSeconds ?? ALTA_TX_TTL_SECONDS);
        answer = { source: "chain", says: `Read live from Alta testnet at ${started.toISOString().slice(11, 16)} UTC${read.block === null ? ", not yet in a block" : `, block ${read.block}`}.`, reason: null, tx: read, found: true, read_at: started.toISOString(), ...this.base(t, ttl, started) };
      }
    } catch (e) {
      ttl = this.opts.retrySeconds ?? ALTA_TX_RETRY_SECONDS;
      answer = this.unavailable(t, e instanceof Stop ? e.message : "the RPC answered with an error", started);
    }
    const now = this.now();
    this.keep(hash, answer, ttl, now);
    return { ...answer, calls_today: this.callsToday(now) };
  }

  /** One JSON-RPC call: the ceiling checked and the call counted before it is sent. Its result, which may be null. */
  private async call(method: "eth_getTransactionByHash" | "eth_getTransactionReceipt", params: unknown[]): Promise<unknown> {
    if (this.callsToday() >= this.ceiling) throw new Stop("today's call ceiling is reached");
    this.sql.exec("INSERT INTO alta_tx_calls (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1", utcDay(this.now()));
    let res: Response;
    try {
      res = await (this.opts.fetcher ?? fetch)(this.opts.rpcUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new Stop("the RPC did not answer");
    }
    if (!res.ok) throw new Stop("the RPC answered with an error");
    let body: { result?: unknown; error?: unknown };
    try { body = (await res.json()) as { result?: unknown; error?: unknown }; } catch { throw new Stop("the RPC answered with an error"); }
    if (body.error !== undefined || body.result === undefined) throw new Stop("the RPC answered with an error");
    return body.result;
  }

  private json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", ...extra } });
  }
}

/** A store that keeps nothing, for a local copy: it never calls the chain. */
const NO_STORE: Sql = { exec: () => ({ toArray: () => [] }) };
/** The desk of a local copy (the judge's server, the local relay, the dashboard): it says no chain call is made. */
export const localAltaTx = (targets: AltaTxTarget[]): AltaTxDesk => new AltaTxDesk(NO_STORE, { off: LOCAL_TX_REASON, targets });
