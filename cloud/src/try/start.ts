// A visitor's test company on the hands-on deployment (purser-try): POST /v1/try/start makes one, POST /v1/try/session
// renews its session with the visitor's token. Each company is a tenant of its own (t_try_<16 hex>) with one owner,
// "You (visitor)", and an engine of its own on test money (a simulated bank). It lives 24 hours, then the sweep wipes it
// (./sweep.ts).
//
// What is kept of the visitor: nothing personal. The start address is never stored: it is keyed (an IPv6 address cut to
// its /64, an IPv4 address whole) as a SHA-256 with a random salt that changes each UTC day, and the salt is deleted
// after 48 hours. The visitor's token is kept as its SHA-256 only.
//
// Limits that one script or one sleepy phone cannot use to lock others out: public starts per keyed address per hour
// and per day for the pool; event and jury starts (a token the admin made) skip the address limit and count against
// their own pool's day. A session is renewed per company (30 a minute), never per address, so a room on one Wi-Fi is
// never turned away because of one device in it.
import { sessionToken } from "../auth.js";
import { randomToken, sameString, sha256Hex } from "../crypto.js";
import type { EngineApi } from "../engine/api.js";
import { bump } from "../auth.js";
import type { Sql } from "../store.js";
import { num, on, readSwitches, tokensOf, type Pool, type Switches } from "./switches.js";

/** The hands-on deployment's configuration (HANDS_ON=on); absent, the /v1/try routes answer 404. */
export interface TryConfig {
  /** How long a company lives (default 24). */
  hours?: number;
  /** Whether the deployment can call Claude at all (ENGINE_CLAUDE=on and a key): the switch alone never says "live". */
  claude?: boolean;
  /** Whether the Airwallex sandbox leg is wired and its key set (C9): the switch alone never says "on". */
  railAwx?: boolean;
  /** The bot check's HMAC secret (TRY_BOTCHECK_SECRET, a Worker secret); with the switch bot_check on and no secret, starts are refused. */
  botSecret?: string;
}

export const TRY_PREFIX = "t_try_";
export const isTryTenant = (tenantId: string): boolean => tenantId.startsWith(TRY_PREFIX);
const TRY_ID = /^t_try_[0-9a-f]{16}$/;
export const VISITOR_NAME = "You (visitor)";
/** Every company says what it is in its name. */
const NAMES = ["Harbour Linen (test)", "Polder Print (test)", "Dune Coffee Roasters (test)", "Canal Bikes (test)", "Tulip Tiles (test)", "North Sea Ropes (test)"];
/** A session renewal per company and minute. */
export const SESSIONS_PER_MINUTE = 30;
/** Above this many wrong visitor tokens or old sessions of one company in a minute, its session renewals wait a minute. */
const FAILS_PER_MINUTE = 60;

/** A refusal of the try routes: a status, a stable code and a sentence a person can read. */
export class TryRefused extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** The part of an address that keys it: an IPv6 address's first 64 bits (its /64), an IPv4 address whole. */
export function addressPrefix(ip: string): string {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined);
  s = s.split("%")[0]!;
  if (!s.includes(":")) return s;
  // An IPv4 address in its IPv6 form is that IPv4 address.
  const mapped = /^(?:0{0,4}:){0,4}:?(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1]!;
  // A trailing dotted part is two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    s = s.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(0, fill)).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

const day = (now: Date) => now.toISOString().slice(0, 10);

/** The day's salt, made by the first start of the day (two at once keep the one that landed first). */
async function saltOf(sql: Sql, now: Date): Promise<string> {
  const d = day(now);
  await sql.run("INSERT INTO try_salts (day, salt) VALUES (?, ?) ON CONFLICT(day) DO NOTHING", [d, randomToken(32)]);
  return (await sql.first<{ salt: string }>("SELECT salt FROM try_salts WHERE day = ?", [d]))!.salt;
}

/** The start address keyed with the day's salt: equal for one /64 on one day, and unlinkable once the salt is gone. */
export async function addressKey(sql: Sql, ip: string, now: Date): Promise<string> {
  return sha256Hex(`${await saltOf(sql, now)}:${addressPrefix(ip)}`);
}

/** Salts older than 48 hours are deleted (the sweep calls this). */
export async function dropOldSalts(sql: Sql, now: Date): Promise<number> {
  return (await sql.run("DELETE FROM try_salts WHERE day < ?", [day(new Date(now.getTime() - 48 * 3_600_000))])).changes;
}

/** The pool a start token puts a company in: a stored token's hash, not past its `until`; anything else is public. */
export async function poolOf(s: Switches, token: string | undefined, now: Date): Promise<Pool> {
  if (!token) return "public";
  const h = await sha256Hex(token);
  const t = tokensOf(s).find((x) => sameString(x.sha256, h));
  return t && Date.parse(t.until) > now.getTime() ? t.pool : "public";
}

/** What lane A's spend ledger needs of a company: its pool and keyed address; an admin-made company is "smoke"; unknown is null. */
export async function tryScopes(sql: Sql, tenantId: string): Promise<{ pool: Pool | "smoke"; addr: string | null } | null> {
  const row = await sql.first<{ pool: Pool; addr: string | null }>("SELECT pool, addr FROM try_companies WHERE tenant_id = ?", [tenantId]);
  if (row) return { pool: row.pool, addr: row.addr };
  return (await sql.first("SELECT 1 AS x FROM tenants WHERE id = ?", [tenantId])) ? { pool: "smoke", addr: null } : null;
}

export interface StartAnswer {
  tenant: string; session: string; visitor_token: string; expires_at: string; session_expires_at: string;
  company: { name: string }; pool: Pool; mode: { claude: "live" | "code"; agents: "live" | "code"; rail_awx: "on" | "off" };
}

/** The switches, or a pause when they cannot be read: fail closed. */
async function switchesOrPaused(sql: Sql): Promise<Switches> {
  try { return await readSwitches(sql); } catch { throw new TryRefused(503, "paused", "The hands-on demo is paused right now. Please try again later."); }
}

export async function startCompany(a: { sql: Sql; engine: (tenantId: string) => EngineApi; config: TryConfig; secret: string; ip: string; token?: string; now: Date }): Promise<StartAnswer> {
  const { sql, now } = a;
  const s = await switchesOrPaused(sql);
  if (!on(s, "starts")) throw new TryRefused(503, "paused", "The hands-on demo is paused right now. Please try again later.");
  const pool = await poolOf(s, a.token, now);
  let addr: string | null = null;
  if (pool === "public") {
    addr = await addressKey(sql, a.ip, now);
    const hour = Math.floor(now.getTime() / 3_600_000) * 3_600;
    if ((await bump(sql, `trystart-addr:${addr}`, hour, 1)) > num(s, "starts_per_address_hour")) {
      throw new TryRefused(429, "limit", "Enough test companies were started from this network in the last hour. Please try again in an hour.");
    }
  }
  const dayStart = Math.floor(now.getTime() / 86_400_000) * 86_400;
  if ((await bump(sql, `trystart-day:${pool}`, dayStart, 1)) > num(s, `starts_per_day_${pool}`)) {
    throw new TryRefused(429, "limit", "Today's test companies are all taken. Please try again tomorrow.");
  }

  const hex = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tenant = `${TRY_PREFIX}${hex}`;
  const user = `u_visitor_${hex}`;
  const name = NAMES[crypto.getRandomValues(new Uint8Array(1))[0]! % NAMES.length]!;
  const visitorToken = randomToken(32);
  const iso = now.toISOString();
  const expiresAt = new Date(now.getTime() + (a.config.hours ?? 24) * 3_600_000).toISOString();
  // Its address (slug) is its id: the sign-in and enrolment routes take only addresses of letters, digits and dashes,
  // so nobody can sign in to, enrol in or mail a try company.
  await sql.batch([
    { sql: "INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, 'en', ?)", params: [tenant, tenant, name, iso] },
    { sql: "INSERT INTO users (tenant_id, id, display_name, email, role, created_at) VALUES (?, ?, ?, NULL, 'owner', ?)", params: [tenant, user, VISITOR_NAME, iso] },
    { sql: "INSERT INTO try_companies (tenant_id, created_at, expires_at, pool, addr, visitor_sha256) VALUES (?, ?, ?, ?, ?, ?)", params: [tenant, iso, expiresAt, pool, addr, await sha256Hex(visitorToken)] },
  ]);
  // The engine's treasury of test money and its suppliers on file (safe to repeat; the engine also seeds itself once).
  await a.engine(tenant).seed();
  const session = await sessionToken(a.secret, { tenantId: tenant, userId: user, role: "owner", gen: 0 }, now);
  const live = on(s, "claude") && a.config.claude === true;
  return {
    tenant, session, visitor_token: visitorToken, expires_at: expiresAt, session_expires_at: sessionEnd(now), company: { name }, pool,
    mode: { claude: live ? "live" : "code", agents: live && on(s, "agents") ? "live" : "code", rail_awx: on(s, "rail_awx") && a.config.railAwx === true ? "on" : "off" },
  };
}

const sessionEnd = (now: Date) => new Date(now.getTime() + 15 * 60_000).toISOString();

/** Counts a wrong visitor token or a dead session of one company, against that company only (never its address). */
export async function noteTryFail(sql: Sql, tenantId: string, now: Date): Promise<void> {
  await bump(sql, `authfail-tenant:${tenantId}`, Math.floor(now.getTime() / 60_000) * 60, 1);
}

/** A fresh 15-minute session for the visitor's company, with the visitor's token; 410 once the company is gone. */
export async function renewSession(a: { sql: Sql; secret: string; tenantId: string; visitorToken: string; now: Date }): Promise<{ session: string; expires_at: string; company_expires_at: string }> {
  const { sql, now } = a;
  if (!TRY_ID.test(a.tenantId)) throw new TryRefused(401, "unauthorized", "This test company or its visitor token is not known here.");
  const row = await sql.first<{ expires_at: string; wiped_at: string | null; visitor_sha256: string }>("SELECT expires_at, wiped_at, visitor_sha256 FROM try_companies WHERE tenant_id = ?", [a.tenantId]);
  if (!row) throw new TryRefused(401, "unauthorized", "This test company or its visitor token is not known here.");
  const minute = Math.floor(now.getTime() / 60_000) * 60;
  if ((await bump(sql, `trysession:${a.tenantId}`, minute, 1)) > SESSIONS_PER_MINUTE) throw new TryRefused(429, "limit", "Too many renewals for this test company; wait a minute.");
  if (row.wiped_at || row.expires_at <= now.toISOString()) throw new TryRefused(410, "gone", "Your test company was deleted after 24 hours.");
  const fails = await sql.first<{ count: number }>("SELECT count FROM rate_hits WHERE bucket = ? AND window_start = ?", [`authfail-tenant:${a.tenantId}`, minute]);
  if ((fails?.count ?? 0) >= FAILS_PER_MINUTE) throw new TryRefused(429, "limit", "Too many failed renewals for this test company; wait a minute.");
  if (!sameString(await sha256Hex(a.visitorToken), row.visitor_sha256)) {
    await noteTryFail(sql, a.tenantId, now);
    throw new TryRefused(401, "unauthorized", "This test company or its visitor token is not known here.");
  }
  const u = await sql.first<{ id: string; session_gen: number }>("SELECT id, session_gen FROM users WHERE tenant_id = ? AND role = 'owner' AND erased_at IS NULL ORDER BY created_at LIMIT 1", [a.tenantId]);
  if (!u) throw new TryRefused(410, "gone", "Your test company was deleted after 24 hours.");
  return { session: await sessionToken(a.secret, { tenantId: a.tenantId, userId: u.id, role: "owner", gen: u.session_gen }, now), expires_at: sessionEnd(now), company_expires_at: row.expires_at };
}
