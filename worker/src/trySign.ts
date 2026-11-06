// /try/sign (TRY_SIGN_ENABLED): a visitor signs with their own passkey in a test world of their own. The world lives
// one hour in its own Durable Object instance ("try-sign"), in its own tables (ts_*), with its own passkeys: nothing
// here reads or writes the relay's state, its enrolled passkeys, its sessions or its queue. No Metal or relay token is
// handed to this desk. The Treasury agent's sentence on the waiting payment comes from one Claude Haiku call (worker/
// src/agentLine.ts, when the Worker has the Anthropic key), given the test world's facts only and never a visitor's
// words; it proposes, nothing more. The one outside call is a read-only FX quote from the Airwallex sandbox (worker/src/
// fxQuote.ts, when the Worker has the sandbox key): its quote goes into the terms, so the signature binds to the quote
// id, and an expired quote is refused even with a good signature; nothing is converted or paid. The agent's two
// proposals are fixed text, the checks are code, and "executed" is a stand-in that only records in the world's own
// table, as the Scenario Lab does.
//
// The signature itself is the real thing: the passkey is made with WebAuthn (user verification required, a random user
// id, no name or e-mail), the challenge is the SHA-256 of the exact terms (canonical JSON, as the real approvals), and
// the Worker checks the assertion with the D20 verifier (worker/src/webauthn.ts) against the public key this world
// registered. A proposal that fails a check has nothing to sign, and the server refuses a signature for it anyway.

import { COMMON_HEADERS, rateKey, type Sql } from "./core.js";
import { verifyAssertion, type PublicKeyXY } from "./webauthn.js";
import { QuoteUnavailable, type FxQuote, type FxSource } from "./fxQuote.js";
import { AGENTS, type Agent } from "../../src/config/policy.js";
import { PAID_ALONE, exposurePolicyOfWorld } from "../../src/try/policy.js";
import { exposureOf, exposureWords, type RecordedRate } from "../../src/policy/exposure.js";
export { PAID_ALONE };
import { defaultPolicy, FIELD_WORDS, policyBounds, policyChanges, readSet, threeLocks, withSet, type Locks, type PolicyChange, type WorldPolicy } from "../../src/try/policy.js";
import { AGENT_LINE_ALL_PER_MINUTE, AGENT_LINE_DAILY_USD, AGENT_LINE_PER_HOUR, AGENT_LINE_RESERVE_USD, AGENT_LINE_SYSTEM, agentLineFacts, agentLineGiven, checkLine, moneyForPeople, type SentenceSource, type Voice } from "./agentLine.js";

/** A test world lives one hour, then everything in it is deleted. */
export const TRY_SIGN_TTL_MS = 60 * 60 * 1000;
/** A world with no passkey yet is deleted after ten minutes, and is the first to go when the store is full. */
export const TRY_SIGN_UNCLAIMED_MS = 10 * 60 * 1000;
/** At most this many live test worlds for everyone together; when full, the oldest world without a passkey makes room,
 * and only when every world has one does a new visitor wait. */
export const TRY_SIGN_MAX_WORLDS = 2000;
/** New test worlds per address (IPv6 by its /64) per hour. */
export const TRY_SIGN_WORLDS_PER_HOUR = 6;
/** New test worlds per network (IPv4 /24, IPv6 /48) per hour: one provider's block cannot open them all. */
export const TRY_SIGN_WORLDS_PER_NETWORK_HOUR = 20;
/** Requests per address per minute, every kind together. */
export const TRY_SIGN_PER_MINUTE = 30;
/** Requests per network (IPv4 /24, IPv6 /48) per minute: one provider's block of addresses cannot fill the ceiling
 * for everyone below on its own (20 /64s of one /48 at 30 a minute each would). */
export const TRY_SIGN_NET_PER_MINUTE = 60;
/** Requests a minute from everyone together: many addresses at once cannot make the instance (or its table) grow. */
export const TRY_SIGN_ALL_PER_MINUTE = 600;
/** Failed signatures or passkeys per address per hour before it is refused. */
export const TRY_SIGN_FAILS_PER_HOUR = 30;
const MAX_BODY = 16_384;
const MAX_TERMS = 4096;
// v2 (6 Nov): the payee's IBAN is in the terms, so the visitor can tamper with it as with the amount or the currency.
// v3 (6 Nov, P2): an `fx` block, the live Airwallex sandbox quote for the waiting payment (null when there is none).
export const TRY_TERMS_SCHEMA = "kit11.try-terms/v3";
/** Live FX quotes per address an hour (a world's first quote and every "Get a new quote"). */
export const TRY_SIGN_FX_PER_HOUR = 12;
/** Live FX quotes a minute, and an hour, from everyone together: the sandbox is asked at most this often. */
export const TRY_SIGN_FX_ALL_PER_MINUTE = 20;
export const TRY_SIGN_FX_ALL_PER_HOUR = 300;
/** A quote shared after a limit or a failure only while it has at least this long left. */
const FX_REUSE_MIN_MS = 2 * 60_000;
/** The story's pair: the Treasury agent holds USD and the invoice is in EUR, so it would buy EUR and sell USD. */
export const FX_PAIR = { buy: "EUR", sell: "USD" } as const;
/** What the page is told about the quote in the terms. */
export type FxStatus = { status: "live" | "reused"; quote: FxQuote } | { status: "unavailable"; reason: string };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

const headers = { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" };
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

/** The paths this desk answers; with the feature off the Worker answers 404 on every one of them. */
export const isTrySignPath = (path: string) => path === "/api/try-sign" || path.startsWith("/api/try-sign/");
export const trySignNotFound = () => answer(404, { error: "not found" });
/** Where the Worker sends one of these paths: the try-sign instance when the bundle carries the page, else a 404. */
export const trySignRoute = (path: string, pages: { trySign?: string }): "desk" | "not-found" | null =>
  !isTrySignPath(path) ? null : pages.trySign ? "desk" : "not-found";

// ── Bytes ──

const enc = new TextEncoder();
const toB64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64u(s: string): Uint8Array {
  if (!B64URL.test(s)) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const hexToB64u = (h: string) => toB64u(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : new Uint8Array(data)));
}
const sha256Hex = async (text: string) => hex(await sha256(text));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── Canonical JSON (RFC 8785 for terms without numbers, as src/lib/terms.ts: money is a decimal string) ──

export type TermsValue = string | boolean | null | TermsValue[] | { [k: string]: TermsValue };
export function canonical(v: TermsValue): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    // RFC 8785 sorts keys by their UTF-16 code units, which is what a plain sort compares.
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k]!)}`).join(",")}}`;
  }
  throw new Error("terms carry no numbers: money is a decimal string");
}

// ── A minimal CBOR reader, enough for a WebAuthn attestation object and its COSE key ──

type Cbor = number | bigint | string | boolean | null | Uint8Array | Cbor[] | Map<Cbor, Cbor>;
export function readCbor(b: Uint8Array, at = 0, depth = 0): { v: Cbor; end: number } {
  if (depth > 8) throw new Error("CBOR too deep");
  if (at >= b.length) throw new Error("CBOR truncated");
  const head = b[at]!, major = head >> 5, info = head & 31;
  let i = at + 1;
  let n: number;
  if (info < 24) n = info;
  else if (info === 24) n = b[i++]!;
  else if (info === 25) { n = (b[i]! << 8) | b[i + 1]!; i += 2; }
  else if (info === 26) { n = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0; i += 4; }
  else throw new Error("CBOR length not supported");
  if (i > b.length) throw new Error("CBOR truncated");
  switch (major) {
    case 0: return { v: n, end: i };
    case 1: return { v: -1 - n, end: i };
    case 2: case 3: {
      if (i + n > b.length) throw new Error("CBOR truncated");
      const s = b.slice(i, i + n);
      return { v: major === 2 ? s : new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(s), end: i + n };
    }
    case 4: {
      if (n > 64) throw new Error("CBOR array too long");
      const out: Cbor[] = [];
      for (let k = 0; k < n; k++) { const r = readCbor(b, i, depth + 1); out.push(r.v); i = r.end; }
      return { v: out, end: i };
    }
    case 5: {
      if (n > 64) throw new Error("CBOR map too long");
      const m = new Map<Cbor, Cbor>();
      for (let k = 0; k < n; k++) { const key = readCbor(b, i, depth + 1); const val = readCbor(b, key.end, depth + 1); m.set(key.v, val.v); i = val.end; }
      return { v: m, end: i };
    }
    case 7: if (info === 20) return { v: false, end: i }; if (info === 21) return { v: true, end: i }; if (info === 22) return { v: null, end: i };
  }
  throw new Error("CBOR item not supported");
}

/** A new passkey, checked: what navigator.credentials.create() gave, against this world's one-time challenge. */
export async function verifyRegistration(
  cred: { id: string; response: { clientDataJSON: string; attestationObject: string } },
  exp: { challenge: string; origin: string; rpId: string },
): Promise<{ ok: true; key: PublicKeyXY; counter: number } | { ok: false; why: string }> {
  try {
    const c = JSON.parse(new TextDecoder().decode(fromB64u(cred.response.clientDataJSON))) as { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
    if (c.type !== "webauthn.create") return { ok: false, why: "type" };
    if (c.challenge !== exp.challenge) return { ok: false, why: "challenge" };
    if (c.origin !== exp.origin || c.crossOrigin === true) return { ok: false, why: "origin" };
    const att = readCbor(fromB64u(cred.response.attestationObject)).v;
    const auth = att instanceof Map ? att.get("authData") : null;
    if (!(auth instanceof Uint8Array) || auth.length < 55) return { ok: false, why: "authenticator data" };
    if (!same(auth.slice(0, 32), await sha256(exp.rpId))) return { ok: false, why: "rp id" };
    const flags = auth[32]!;
    if (!(flags & 0x01)) return { ok: false, why: "user presence" };
    if (!(flags & 0x04)) return { ok: false, why: "user verification" };
    if (!(flags & 0x40)) return { ok: false, why: "no credential in the authenticator data" };
    const counter = ((auth[33]! << 24) | (auth[34]! << 16) | (auth[35]! << 8) | auth[36]!) >>> 0;
    const idLen = (auth[53]! << 8) | auth[54]!;
    const credId = auth.slice(55, 55 + idLen);
    if (credId.length !== idLen || idLen === 0 || toB64u(credId) !== cred.id) return { ok: false, why: "credential id" };
    const cose = readCbor(auth, 55 + idLen).v;
    if (!(cose instanceof Map)) return { ok: false, why: "public key" };
    // ES256 only, the one kind the D20 verifier checks: EC2 (1: 2), ES256 (3: -7), P-256 (-1: 1).
    const x = cose.get(-2), y = cose.get(-3);
    if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
      return { ok: false, why: "this passkey is not ES256 (P-256)" };
    }
    const key = { x: toB64u(x), y: toB64u(y) };
    // A point not on the curve is refused now, not at the first signature.
    await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { ok: true, key, counter };
  } catch {
    return { ok: false, why: "malformed" };
  }
}

// ── The test world: one balance, a reserve floor, a limit an agent may pay alone, two fixed proposals ──

export const TEST_WORLD = {
  company: "Northwind Outdoor (test world)", currency: "EUR", balance: "30000.00", reserve_floor: "25000.00", alone_limit: "500.00",
} as const;
const cents = (s: string) => { if (!/^\d+\.\d{2}$/.test(s)) throw new Error("not a decimal amount"); return Number(s.replace(".", "")); };
const money = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
/** For people, as the page writes it: EUR 25,000.00. */
const eur = (s: string) => moneyForPeople("EUR", s);

interface FixedProposal { id: string; agent: string; says: string; payee: string; iban: string; amount: string; reference: string }
/**
 * The test payees' IBANs. Check digits 00 are never valid (ISO 13616: they run from 02 to 98), so no bank account
 * anywhere has these numbers: they are shaped like a German IBAN and can pay nothing.
 */
export const TEST_IBAN = { stockline: "DE00000000000000004471", alpine: "DE00000000000000000118" } as const;
/** What the agent proposes: the amounts and payees are fixed; the waiting payment's sentence may come from Claude Haiku
 * (worker/src/agentLine.ts), and this fixed sentence is shown, labelled, whenever it does not. */
export const FIXED_PROPOSALS: FixedProposal[] = [
  { id: "T-0001", agent: "Treasury agent", says: "Stockline's spring order is ready; I would pay it now to keep the price.", payee: "Stockline GmbH (test payee)", iban: TEST_IBAN.stockline, amount: "6500.00", reference: "Stock order SO-4471" },
  { id: "T-0002", agent: "Treasury agent", says: "Alpine Packaging's invoice is due Friday. It is more than I may pay alone, so I ask you.", payee: "Alpine Packaging (test payee)", iban: TEST_IBAN.alpine, amount: "1850.00", reference: "Invoice INV-2026-118" },
];

export type Check = { check: "fail"; rule: string } | { check: "pass"; waits: string };
/** The two rules a payment is checked against: the world's at the start, or the policy the visitor set (step 0). */
export interface PaymentRules { reserve_floor: string; alone_limit: string }
/** The rules, in code: the reserve floor first, then the amount an agent may pay without a person. */
export function checkPayment(amount: string, balance: string, rules: PaymentRules = TEST_WORLD): Check {
  const after = cents(balance) - cents(amount);
  if (after < cents(rules.reserve_floor)) {
    return { check: "fail", rule: `Reserve floor: the balance may not go below ${eur(rules.reserve_floor)}; after this payment it would be ${eur(money(after))}.` };
  }
  if (cents(amount) > cents(rules.alone_limit)) return { check: "pass", waits: `Above the ${eur(rules.alone_limit)} an agent may pay alone, so it waits for a person's signature.` };
  return { check: "pass", waits: "" };
}
/** The payment rules a policy sets: the company's reserve floor and what the Treasury agent (the one that pays here) may pay alone. */
export const rulesOf = (p: WorldPolicy): PaymentRules => ({ reserve_floor: p.reserve_floor, alone_limit: p.agents.treasury.alone });
/** The payment that waits for a person when a world opens, and carries the live quote (T-0002). */
const QUOTED = FIXED_PROPOSALS.find((p) => checkPayment(p.amount, TEST_WORLD.balance).check === "pass")!;

/** Step 0 (Max, item 1): a change to the test world's policy, as the visitor signs it when it loosens the policy. */
export const TRY_POLICY_SCHEMA = "kit11.try-policy/v1";
export function policyTerms(worldId: string, agent: Agent, version: number, changes: PolicyChange[], next: WorldPolicy, expiresAt: string): { [k: string]: TermsValue } {
  const a = next.agents[agent];
  return {
    schema: TRY_POLICY_SCHEMA, test_world: worldId, kind: "policy_change", agent, policy_version: String(version),
    changes: changes.map((c) => ({ field: c.field, key: c.key, from: c.from, to: c.to, looser: c.looser })),
    policy: { ...a, mccs: [...a.mccs], currencies: [...a.currencies], reserve_floor: next.reserve_floor },
    expires_at: expiresAt, nothing_real_moves: true,
  };
}

/** A proposal's terms: bound to this world (its public id) and its expiry, so a signature is good here only. */
export function proposalTerms(p: FixedProposal, worldId: string, expiresAt: string, fx: FxQuote | null = null, proposedBy = `${p.agent} (fixed text)`): { [k: string]: TermsValue } {
  return {
    schema: TRY_TERMS_SCHEMA, test_world: worldId, kind: "payment", proposal_id: p.id, proposed_by: proposedBy,
    payee: p.payee, payee_iban: p.iban, amount: p.amount, currency: TEST_WORLD.currency, reference: p.reference, expires_at: expiresAt,
    fx: fx ? { ...fx } : null, nothing_real_moves: true,
  };
}

interface WorldRow { id: string; expires: number; reg_challenge: string | null; balance: string }
interface ProposalRow { id: string; canonical: string; sha: string; check_json: string; status: string; execution: string | null }
interface CredRow { id: string; x: string; y: string; counter: number }

/** The network an address belongs to, for the second world limit: IPv4 by its /24, IPv6 by its /48. */
export function networkKey(ip: string): string {
  const k = rateKey(ip);
  if (k.endsWith("::/64")) return `${k.slice(0, -"::/64".length).split(":").slice(0, 3).join(":")}::/48`;
  const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(k);
  return v4 ? `${v4[1]}.0/24` : k;
}

/** The body, up to a limit, counted as it arrives (a body sent without a length cannot grow past it); null past it. */
async function readCapped(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// The request schema (security task A1, 6 Nov): each body carries the keys the page sends and nothing else, each of
// its type; a key it does not know is refused, not ignored. A missing token still answers 410 below (no such world).
const PROPOSAL_ID = /^T-\d{4}$/;
const b64u = (max: number) => (v: unknown) => typeof v === "string" && v.length <= max && B64URL.test(v);
const optional = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || ok(v);
const CREDENTIAL = {
  id: b64u(1024), rawId: optional(b64u(1024)), type: optional((v) => v === "public-key"), response: isObj,
  clientExtensionResults: optional(isObj), authenticatorAttachment: optional((v) => v === "platform" || v === "cross-platform"),
};
const RESPONSE = {
  passkey: {
    clientDataJSON: b64u(8192), attestationObject: b64u(MAX_BODY),
    transports: optional((v) => Array.isArray(v) && v.length <= 8 && v.every((t) => typeof t === "string" && t.length <= 32)),
  },
  sign: { clientDataJSON: b64u(8192), authenticatorData: b64u(8192), signature: b64u(2048), userHandle: optional(b64u(512)) },
};
const BODY: Record<string, Record<string, (v: unknown) => boolean>> = {
  "/world": {},
  "/passkey": { token: optional((v) => typeof v === "string"), credential: () => true },
  "/quote": { token: optional((v) => typeof v === "string") },
  "/sign": { token: optional((v) => typeof v === "string"), proposal_id: (v) => typeof v === "string" && PROPOSAL_ID.test(v), canonical: (v) => typeof v === "string" && v.length <= MAX_TERMS, credential: () => true },
  // Step 0: the agent's whole policy (read field by field in src/try/policy.ts); a looser one with its terms and signature.
  "/policy": {
    token: optional((v) => typeof v === "string"), agent: (v) => typeof v === "string" && (AGENTS as readonly string[]).includes(v), set: isObj,
    canonical: optional((v) => typeof v === "string" && v.length <= MAX_TERMS), credential: optional(() => true),
  },
};
const fits = (o: Record<string, unknown>, shape: Record<string, (v: unknown) => boolean>) =>
  Object.keys(o).every((k) => Object.hasOwn(shape, k)) && Object.entries(shape).every(([k, ok]) => ok(o[k]));
/** Whether a body has this endpoint's shape: its own keys only, each of its type (the credential's too). */
export function wellFormed(sub: string, body: Record<string, unknown>): boolean {
  const shape = BODY[sub];
  if (!shape || !fits(body, shape)) return false;
  if (sub === "/world" || sub === "/quote") return true;
  if (sub === "/policy" && body.credential === undefined) return body.canonical === undefined;
  if (sub === "/policy" && body.canonical === undefined) return false;
  const c = body.credential;
  return isObj(c) && fits(c, CREDENTIAL) && fits(c.response as Record<string, unknown>, sub === "/passkey" ? RESPONSE.passkey : RESPONSE.sign);
}

export class TrySignDesk {
  private readonly now: () => Date;

  private readonly fx: FxSource | null;
  /** The sentence's source: Haiku (or a stand-in), "off" (the emergency switch, TRY_SIGN_HAIKU=off), or none (no key). */
  private readonly line: SentenceSource | "off" | null;
  /** 1.1: the main run's recorded EUR/USD rate, for step 0's worst case; null: no EUR total is shown. */
  private readonly rate: RecordedRate | null;
  /** The last live quote, shared only after a limit or a failure while it has time left (FX_REUSE_MIN_MS). */
  private lastQuote: FxQuote | null = null;

  /** It takes a SQL handle, a clock and, when the Worker has the sandbox key, the FX quote source; nothing else. */
  constructor(private readonly sql: Sql, opts: { now?: () => Date; fx?: FxSource | null; agentLine?: SentenceSource | "off" | null; rate?: RecordedRate | null } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.rate = opts.rate ?? null;
    this.fx = opts.fx ?? null;
    this.line = opts.agentLine ?? null;
    // The waiting payment's sentence and where it came from; the model's spend per UTC day.
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_lines (world TEXT NOT NULL, id TEXT NOT NULL, says TEXT NOT NULL, voice TEXT NOT NULL, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_spend (day TEXT PRIMARY KEY, usd REAL NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_worlds (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, ip TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, reg_challenge TEXT, balance TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_creds (world TEXT NOT NULL, id TEXT NOT NULL, x TEXT NOT NULL, y TEXT NOT NULL, counter INTEGER NOT NULL, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_proposals (world TEXT NOT NULL, id TEXT NOT NULL, canonical TEXT NOT NULL, sha TEXT NOT NULL, check_json TEXT NOT NULL, status TEXT NOT NULL, execution TEXT, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_hits (ip TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL)");
    // Step 0: the policy the visitor set in their world, numbered (a signature names the version it changes).
    // signed_sha: the SHA-256 of the last policy change the visitor signed (a payment run alone names it).
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_policy (world TEXT PRIMARY KEY, version INTEGER NOT NULL, json TEXT NOT NULL, signed_sha TEXT)");
    // Every query on a request goes through an index: the counts per address and kind, the purges by time.
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_hits_ip ON ts_hits (ip, kind, at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_hits_kind ON ts_hits (kind, at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_hits_at ON ts_hits (at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_worlds_expires ON ts_worlds (expires)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_worlds_created ON ts_worlds (created)");
  }

  /** Never throws: anything unexpected answers a fixed 500, with no exception text, stack or path in it (A1). */
  async fetch(req: Request): Promise<Response> {
    try {
      return await this.handle(req);
    } catch (e) {
      console.error("try-sign: unexpected error", e instanceof Error ? e.name : typeof e);
      return answer(500, { error: "the test world could not answer this; nothing was signed or run. Try again" });
    }
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!isTrySignPath(path)) return trySignNotFound();
    const sub = path.slice("/api/try-sign".length);
    if (!["/world", "/passkey", "/sign", "/quote", "/policy"].includes(sub)) return trySignNotFound();
    if (req.method !== "POST") return answer(405, { error: "use POST" });
    // Only this site's own page may ask: a browser on another site sends its own origin, or none on a form post.
    if (req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") === "cross-site") return answer(403, { error: "ask from the /try/sign page on this site" });

    const nowMs = this.now().getTime();
    const ip = rateKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    if (this.hits(ip, "fail", nowMs - 3_600_000) >= TRY_SIGN_FAILS_PER_HOUR) return answer(429, { error: "too many refused signatures from this address; wait an hour" });
    if (this.hits(ip, "req", nowMs - 60_000) >= TRY_SIGN_PER_MINUTE) return answer(429, { error: "a few requests a minute; wait a moment" });
    const net = networkKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    if (this.hits(net, "req-net", nowMs - 60_000) >= TRY_SIGN_NET_PER_MINUTE) return answer(429, { error: "many requests a minute from your network; wait a moment" });
    const [{ n: everyone }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_hits WHERE kind = 'req' AND at > ?", nowMs - 60_000).toArray() as [{ n: number }];
    if (everyone >= TRY_SIGN_ALL_PER_MINUTE) return answer(503, { error: "many visitors are trying this right now; try again in a minute" });
    this.hit(ip, "req", nowMs);
    this.hit(net, "req-net", nowMs);
    this.purge(nowMs);

    const raw = await readCapped(req, MAX_BODY);
    if (raw === null) return answer(413, { error: "too large" });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return answer(400, { error: "send JSON" }); }
    if (!isObj(body)) return answer(400, { error: "send a JSON object" });
    const gone = () => answer(410, { error: "no such test world: it expired (a world lasts one hour, ten minutes without a passkey) or never existed; start a new one", expired: true });
    // No token at all is no world (as before); anything else must have the endpoint's shape before it is looked at.
    if (sub !== "/world" && body.token === undefined) return gone();
    if (!wellFormed(sub, body)) {
      return answer(400, { error: sub === "/sign" ? "malformed signature" : sub === "/passkey" ? "malformed passkey" : sub === "/quote" ? "send the world's token only"
        : sub === "/policy" ? "send the world's token, an agent (sourcing, support or treasury) and its policy; a signature only with its terms" : "send an empty JSON object" });
    }

    if (sub === "/world") return this.newWorld(url, req.headers.get("cf-connecting-ip") ?? "unknown", nowMs);
    const world = await this.worldOf(body.token);
    if (!world || world.expires <= this.now().getTime()) return gone();
    if (sub === "/passkey") return this.registerPasskey(url, ip, world, body);
    if (sub === "/quote") return this.newQuote(ip, world);
    if (sub === "/policy") return this.setPolicy(url, ip, world, body);
    return this.sign(url, ip, world, body);
  }

  private hits(ip: string, kind: string, since: number): number {
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_hits WHERE ip = ? AND kind = ? AND at > ?", ip, kind, since).toArray() as [{ n: number }];
    return n;
  }
  private hit(ip: string, kind: string, at: number): void {
    this.sql.exec("INSERT INTO ts_hits (ip, kind, at) VALUES (?, ?, ?)", ip, kind, at);
  }

  private dropWorld(id: string): void {
    this.sql.exec("DELETE FROM ts_creds WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_proposals WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_lines WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_policy WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_worlds WHERE id = ?", id);
  }

  /** Expired worlds go (after an hour, or ten minutes without a passkey), with their passkeys and proposals; old hits too. */
  private purge(nowMs: number): void {
    const gone = this.sql.exec(`SELECT id FROM ts_worlds WHERE expires <= ? UNION SELECT id FROM ts_worlds w WHERE created <= ?
      AND NOT EXISTS (SELECT 1 FROM ts_creds c WHERE c.world = w.id) LIMIT 500`, nowMs, nowMs - TRY_SIGN_UNCLAIMED_MS).toArray() as { id: string }[];
    for (const { id } of gone) this.dropWorld(id);
    // Request counts matter for a minute, worlds and failures for an hour: nothing older is kept.
    this.sql.exec("DELETE FROM ts_hits WHERE kind IN ('req', 'req-net') AND at <= ?", nowMs - 60_000);
    this.sql.exec("DELETE FROM ts_hits WHERE at <= ?", nowMs - 3_600_000);
  }

  private async worldOf(token: unknown): Promise<WorldRow | null> {
    if (typeof token !== "string" || !TOKEN.test(token)) return null;
    const rows = this.sql.exec("SELECT id, expires, reg_challenge, balance FROM ts_worlds WHERE token_hash = ?", await sha256Hex(token)).toArray() as WorldRow[];
    return rows[0] ?? null;
  }

  private proposals(worldId: string): (ProposalRow & { terms: unknown; checked: Check })[] {
    return (this.sql.exec("SELECT id, canonical, sha, check_json, status, execution FROM ts_proposals WHERE world = ? ORDER BY id", worldId).toArray() as ProposalRow[])
      .map((p) => ({ ...p, terms: JSON.parse(p.canonical) as unknown, checked: JSON.parse(p.check_json) as Check }));
  }

  /**
   * A live quote for the waiting payment, within the limits (per address, and for everyone a minute and an hour). Over
   * a limit, or when the sandbox gives none, the last live quote is shared if it still has time; else there is none,
   * and the page shows the main run's recorded quote, labelled as such. Never a made-up quote.
   */
  private async quoteFor(ip: string, buyAmount: string): Promise<FxStatus> {
    const nowMs = this.now().getTime();
    const shared = (): FxStatus | null => this.lastQuote && this.lastQuote.buy_amount === buyAmount && Date.parse(this.lastQuote.valid_to_at) - nowMs >= FX_REUSE_MIN_MS
      ? { status: "reused", quote: this.lastQuote } : null;
    if (!this.fx) return { status: "unavailable", reason: "this server has no Airwallex sandbox key" };
    if (this.hits(ip, "fx", nowMs - 3_600_000) >= TRY_SIGN_FX_PER_HOUR || this.hits("*", "fx-all", nowMs - 60_000) >= TRY_SIGN_FX_ALL_PER_MINUTE
      || this.hits("*", "fx-all", nowMs - 3_600_000) >= TRY_SIGN_FX_ALL_PER_HOUR) {
      return shared() ?? { status: "unavailable", reason: "many live quotes were asked for just now; try again in a minute" };
    }
    this.hit(ip, "fx", nowMs);
    this.hit("*", "fx-all", nowMs);
    try {
      const quote = await this.fx.quote({ buyCurrency: FX_PAIR.buy, sellCurrency: FX_PAIR.sell, buyAmount });
      if (Date.parse(quote.valid_to_at) <= this.now().getTime()) throw new QuoteUnavailable("the quote had already expired");
      this.lastQuote = quote;
      return { status: "live", quote };
    } catch (e) {
      // A fixed reason only: never Airwallex's words, a key or a token (fxQuote.ts makes its reasons so).
      const reason = e instanceof QuoteUnavailable ? e.reason : "the Airwallex sandbox gave no quote";
      console.error("try-sign: no live FX quote:", reason);
      return shared() ?? { status: "unavailable", reason };
    }
  }

  /**
   * The Treasury agent's sentence for the payment it proposes: Claude Haiku, given the test world's facts only (code
   * writes them; nothing the visitor sent), within the day's budget and the limits; else the fixed sentence, labelled.
   */
  private async lineFor(ip: string, p: FixedProposal): Promise<{ says: string; voice: Voice }> {
    const fixed = (reason: "budget" | "unavailable" | "mismatch" | "off", why: string) => ({ says: p.says, voice: { source: "fixed", reason, why } as Voice });
    // The emergency switch first: no request, no rate-limit hit, no budget kept aside.
    if (this.line === "off") return fixed("off", "the live model is switched off on this server");
    if (!this.line) return fixed("unavailable", "this server has no model key");
    const line = this.line;
    const nowMs = this.now().getTime();
    const day = this.now().toISOString().slice(0, 10);
    const spent = () => (this.sql.exec("SELECT usd FROM ts_spend WHERE day = ?", day).toArray() as { usd: number }[])[0]?.usd ?? 0;
    const add = (usd: number) => this.sql.exec("INSERT INTO ts_spend (day, usd) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd", day, usd);
    if (spent() + AGENT_LINE_RESERVE_USD > AGENT_LINE_DAILY_USD) return fixed("budget", `today's USD ${AGENT_LINE_DAILY_USD.toFixed(2)} for model calls on this page is spent`);
    if (this.hits("*", "line-all", nowMs - 60_000) >= AGENT_LINE_ALL_PER_MINUTE || this.hits(ip, "line", nowMs - 3_600_000) >= AGENT_LINE_PER_HOUR) {
      return fixed("budget", "the model's limit for this minute (or for your address this hour) is reached");
    }
    this.hit("*", "line-all", nowMs);
    this.hit(ip, "line", nowMs);
    add(AGENT_LINE_RESERVE_USD);
    try {
      const invoice = { ...p, currency: TEST_WORLD.currency };
      const r = await line({ system: AGENT_LINE_SYSTEM, facts: agentLineFacts(invoice, TEST_WORLD) });
      add(r.costUsd - AGENT_LINE_RESERVE_USD);
      // One plain sentence, and every amount in it one of the four it was given, written exactly as given.
      const c = checkLine(r.text, agentLineGiven(invoice, TEST_WORLD));
      if ("bad" in c) return c.bad === "shape" ? fixed("unavailable", "the model's sentence was not one plain sentence") : fixed("mismatch", "an amount in the model's sentence was not one of the amounts it was given, written exactly as given");
      const says = c.says;
      return { says, voice: { source: "model", model: r.model, request_id: r.requestId && /^[A-Za-z0-9_-]{1,128}$/.test(r.requestId) ? r.requestId : null } };
    } catch {
      // A fixed reason only: never the API's words or the key.
      console.error("try-sign: no model sentence");
      return fixed("unavailable", "the model did not answer in time, or not in the expected shape");
    }
  }
  /** Who proposed it, in the terms: the agent, and whether its sentence was the model's or fixed text. */
  private static by(p: FixedProposal, voice: Voice | null): string {
    return `${p.agent} (${voice?.source === "model" ? "sentence by Claude Haiku; amounts and checks by code" : "fixed text"})`;
  }
  /** A proposal as the page gets it, with its sentence and where that came from (the blocked one: fixed text). */
  private view(worldId: string, p: ProposalRow & { checked: Check }) {
    const f = FIXED_PROPOSALS.find((x) => x.id === p.id)!;
    const line = (this.sql.exec("SELECT says, voice FROM ts_lines WHERE world = ? AND id = ?", worldId, p.id).toArray() as { says: string; voice: string }[])[0];
    return { proposal_id: p.id, agent: f.agent, says: line?.says ?? f.says, voice: line ? (JSON.parse(line.voice) as Voice) : null, canonical: p.canonical, terms_sha256: p.sha, status: p.status, ...p.checked,
      ...(p.execution ? { execution: JSON.parse(p.execution) as unknown } : {}) };
  }

  /** "Get a new quote": new terms for the waiting payment with a new quote, so it must be signed again. */
  private async newQuote(ip: string, world: WorldRow): Promise<Response> {
    const p = this.proposals(world.id).find((x) => x.id === QUOTED.id && x.checked.check === "pass");
    if (!p) return answer(404, { error: "no payment waits for a person in this test world" });
    if (p.status !== "waiting") return answer(409, { error: `${p.id} is already signed and ran; there is nothing to quote again` });
    const f = FIXED_PROPOSALS.find((x) => x.id === p.id)!;
    const fx = await this.quoteFor(ip, f.amount);
    if (fx.status === "unavailable") return answer(503, { error: `no new live quote: ${fx.reason}`, fx });
    const expiresAt = new Date(world.expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    const by = (p.terms as { proposed_by?: unknown }).proposed_by;
    const c = canonical(proposalTerms(f, world.id, expiresAt, fx.quote, typeof by === "string" ? by : undefined));
    const sha = await sha256Hex(c);
    // Written only while it still waits (no await between the read and the write): a signature that ran meanwhile wins.
    const still = (this.sql.exec("SELECT status FROM ts_proposals WHERE world = ? AND id = ?", world.id, p.id).toArray() as { status: string }[])[0];
    if (still?.status !== "waiting") return answer(409, { error: `${p.id} is already signed and ran; there is nothing to quote again` });
    this.sql.exec("UPDATE ts_proposals SET canonical = ?, sha = ? WHERE world = ? AND id = ?", c, sha, world.id, p.id);
    // Within what the agent may pay alone (a limit the visitor signed), the payment runs alone now that its quote is new.
    const alone = this.runAlone(world.id);
    if (alone.length) return answer(200, { proposal: this.view(world.id, this.proposals(world.id).find((x) => x.id === p.id)!), fx, paid_alone: alone, ...this.policyAnswer(world.id, this.now()) });
    return answer(200, { proposal: this.view(world.id, { ...p, canonical: c, sha }), fx });
  }

  private async newWorld(url: URL, address: string, nowMs: number): Promise<Response> {
    const ip = rateKey(address);
    const net = networkKey(address);
    const id = hex(random(8));
    const token = toB64u(random(32));
    const tokenHash = await sha256Hex(token);
    const challenge = toB64u(random(32));
    const expires = nowMs + TRY_SIGN_TTL_MS;
    const expiresAt = new Date(expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    // Over a world limit, no quote is asked for (the limits are checked again, for good, below).
    if (this.hits(ip, "world", nowMs - 3_600_000) >= TRY_SIGN_WORLDS_PER_HOUR) return answer(429, { error: `${TRY_SIGN_WORLDS_PER_HOUR} test worlds an hour from one address; use the one you have, or wait` });
    // The waiting payment carries the live quote (its fx block); the one a rule blocks has none.
    const waiting = FIXED_PROPOSALS.find((p) => checkPayment(p.amount, TEST_WORLD.balance).check === "pass");
    // The quote and the agent's sentence are asked for at once (each with its own limits and timeout).
    const [fx, line] = await Promise.all([
      waiting ? this.quoteFor(ip, waiting.amount) : Promise.resolve<FxStatus>({ status: "unavailable", reason: "no payment waits" }),
      waiting ? this.lineFor(ip, waiting) : Promise.resolve(null),
    ]);
    const rows: [string, string, string, Check][] = [];
    for (const p of FIXED_PROPOSALS) {
      const check = checkPayment(p.amount, TEST_WORLD.balance);
      const mine = check.check === "pass" && p === waiting;
      const c = canonical(proposalTerms(p, id, expiresAt, mine && fx.status !== "unavailable" ? fx.quote : null, TrySignDesk.by(p, mine && line ? line.voice : null)));
      rows.push([p.id, c, await sha256Hex(c), check]);
    }
    // No await from here on: the limits are checked and the world written together, so tries at once cannot pass both.
    if (this.hits(ip, "world", nowMs - 3_600_000) >= TRY_SIGN_WORLDS_PER_HOUR) return answer(429, { error: `${TRY_SIGN_WORLDS_PER_HOUR} test worlds an hour from one address; use the one you have, or wait` });
    if (this.hits(net, "world-net", nowMs - 3_600_000) >= TRY_SIGN_WORLDS_PER_NETWORK_HOUR) return answer(429, { error: "many test worlds this hour from your network; use the one you have, or wait" });
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_worlds WHERE expires > ?", nowMs).toArray() as [{ n: number }];
    if (n >= TRY_SIGN_MAX_WORLDS) {
      // Full: the oldest world nobody made a passkey for makes room; only when every world has one, the visitor waits.
      const idle = (this.sql.exec("SELECT id FROM ts_worlds w WHERE NOT EXISTS (SELECT 1 FROM ts_creds c WHERE c.world = w.id) ORDER BY created LIMIT 1").toArray() as { id: string }[])[0];
      if (!idle) return answer(503, { error: "many test worlds are open right now; try again in a few minutes" });
      this.dropWorld(idle.id);
    }
    this.hit(ip, "world", nowMs);
    this.hit(net, "world-net", nowMs);
    this.sql.exec("INSERT INTO ts_worlds (id, token_hash, ip, created, expires, reg_challenge, balance) VALUES (?, ?, ?, ?, ?, ?, ?)", id, tokenHash, ip, nowMs, expires, challenge, TEST_WORLD.balance);
    for (const [pid, c, sha, check] of rows) {
      this.sql.exec("INSERT INTO ts_proposals (world, id, canonical, sha, check_json, status, execution) VALUES (?, ?, ?, ?, ?, ?, NULL)", id, pid, c, sha, JSON.stringify(check), check.check === "fail" ? "blocked" : "waiting");
    }
    if (waiting && line) this.sql.exec("INSERT INTO ts_lines (world, id, says, voice) VALUES (?, ?, ?, ?)", id, waiting.id, line.says, JSON.stringify(line.voice));
    const policy = defaultPolicy(new Date(nowMs), TEST_WORLD);
    this.sql.exec("INSERT INTO ts_policy (world, version, json) VALUES (?, 1, ?)", id, JSON.stringify(policy));
    return answer(201, {
      world: { id, token, expires_at: expiresAt, ...TEST_WORLD },
      fx,
      ...this.policyState(id, new Date(nowMs)),
      proposals: this.proposals(id).map((p) => this.view(id, p)),
      // WebAuthn options for the visitor's own passkey: a random user id, no name or e-mail of theirs; user verification
      // required; any authenticator (phone, laptop, security key, a phone over QR), so no authenticatorAttachment.
      passkey_options: {
        challenge, rp: { id: url.hostname, name: "Purser test world" },
        user: { id: toB64u(random(16)), name: "Purser test passkey", displayName: "Test passkey" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 120_000, attestation: "none",
        authenticatorSelection: { residentKey: "discouraged", userVerification: "required" },
      },
    });
  }

  private async registerPasskey(url: URL, ip: string, world: WorldRow, body: Record<string, unknown>): Promise<Response> {
    const c = body.credential;
    if (!isObj(c) || typeof c.id !== "string" || !B64URL.test(c.id) || c.id.length > 1024 || !isObj(c.response)
      || typeof c.response.clientDataJSON !== "string" || typeof c.response.attestationObject !== "string") return answer(400, { error: "malformed passkey" });
    if (world.reg_challenge === null) return answer(409, { error: "this test world already has its passkey" });
    // One use, whatever happens next (no await before this): a second create for the same world finds no challenge.
    this.sql.exec("UPDATE ts_worlds SET reg_challenge = NULL WHERE id = ?", world.id);
    const v = await verifyRegistration({ id: c.id, response: { clientDataJSON: c.response.clientDataJSON, attestationObject: c.response.attestationObject } },
      { challenge: world.reg_challenge, origin: url.origin, rpId: url.hostname });
    if (!v.ok) { this.hit(ip, "fail", this.now().getTime()); return answer(400, { error: `the new passkey did not verify (${v.why}); start a new test world`, why: v.why }); }
    // The world may have gone during the await (expired, or made room for a new visitor while it had no passkey yet):
    // then no passkey row is written, so none is left behind without its world.
    const still = this.sql.exec("SELECT 1 FROM ts_worlds WHERE id = ? AND expires > ?", world.id, this.now().getTime()).toArray();
    if (still.length === 0) return answer(410, { error: "this test world is gone (it expired, or made room while it had no passkey); start a new one", expired: true });
    this.sql.exec("INSERT INTO ts_creds (world, id, x, y, counter) VALUES (?, ?, ?, ?, ?)", world.id, c.id, v.key.x, v.key.y, v.counter);
    return answer(201, { passkey: { id: c.id }, world: { id: world.id } });
  }

  // ── Step 0: the world's policy (Max, item 1) ──

  /** 1.1: the worst case a policy allows, by Purser's own code (src/policy/exposure.ts), with the main run's rate. */
  private exposure(p: WorldPolicy) {
    const ep = exposurePolicyOfWorld(p);
    return exposureWords(exposureOf(ep), ep, this.rate);
  }
  /** The policy in force in this world, and its version (1 when the world opened). */
  private policyOf(worldId: string): { version: number; policy: WorldPolicy } {
    const row = (this.sql.exec("SELECT version, json FROM ts_policy WHERE world = ?", worldId).toArray() as { version: number; json: string }[])[0];
    return row ? { version: row.version, policy: JSON.parse(row.json) as WorldPolicy } : { version: 1, policy: defaultPolicy(this.now(), TEST_WORLD) };
  }
  private balanceOf(worldId: string): string {
    return (this.sql.exec("SELECT balance FROM ts_worlds WHERE id = ?", worldId).toArray() as { balance: string }[])[0]?.balance ?? TEST_WORLD.balance;
  }
  /** Each agent's three locks under a policy; the Treasury agent's with the world's two payments checked under it. */
  private locksOf(worldId: string, policy: WorldPolicy, now: Date): Record<string, Locks> {
    const balance = this.balanceOf(worldId);
    const rows = this.proposals(worldId);
    return Object.fromEntries(AGENTS.map((a) => {
      const l = threeLocks(policy, a, now, worldId);
      if (a !== "treasury") return [a, l];
      const payments = FIXED_PROPOSALS.map((f) => rows.find((x) => x.id === f.id)?.status === "executed"
        ? { proposal_id: f.id, amount: f.amount, check: "executed", alone: (JSON.parse(rows.find((x) => x.id === f.id)!.execution ?? "{}") as { alone?: boolean }).alone === true }
        : { proposal_id: f.id, amount: f.amount, ...checkPayment(f.amount, balance, rulesOf(policy)) });
      return [a, { ...l, purser: { ...l.purser, payments } }];
    }));
  }
  /** What the page is told about the policy: the policy in force, its locks, and the world's payments under it. */
  private policyState(worldId: string, now: Date) {
    const { version, policy } = this.policyOf(worldId);
    return { policy, policy_version: String(version), locks: this.locksOf(worldId, policy, now), bounds: policyBounds(now), exposure: this.exposure(policy) };
  }
  private policyAnswer(worldId: string, now: Date) {
    const state = this.policyState(worldId, now);
    const rules = rulesOf(state.policy);
    return { ...state, proposals: this.proposals(worldId).map((p) => this.view(worldId, p)), world: { balance: this.balanceOf(worldId), ...rules } };
  }
  /** Every payment that has not run, checked again against the balance and the policy in force. */
  private recheck(worldId: string): void {
    const rules = rulesOf(this.policyOf(worldId).policy);
    const balance = this.balanceOf(worldId);
    for (const p of this.proposals(worldId)) {
      if (p.status === "executed") continue;
      const c = checkPayment((p.terms as { amount: string }).amount, balance, rules);
      this.sql.exec("UPDATE ts_proposals SET check_json = ?, status = ? WHERE world = ? AND id = ?", JSON.stringify(c), c.check === "fail" ? "blocked" : "waiting", worldId, p.id);
    }
  }
  /** Writes the new policy only if no other change came first (no await from the caller's last read to here). */
  private applyPolicy(worldId: string, version: number, next: WorldPolicy, extra: Record<string, unknown>, signedSha: string | null): Response {
    const now = this.policyOf(worldId).version;
    if (now !== version) return answer(200, { applied: false, why: "stale", reason: "Refused: the policy changed meanwhile, so these are not its terms any more. Nothing changed; try again.", ...this.policyAnswer(worldId, this.now()) });
    this.sql.exec("UPDATE ts_policy SET version = ?, json = ?, signed_sha = COALESCE(?, signed_sha) WHERE world = ? AND version = ?", version + 1, JSON.stringify(next), signedSha, worldId, version);
    this.recheck(worldId);
    const alone = this.runAlone(worldId);
    return answer(200, { ...extra, paid_alone: alone, ...this.policyAnswer(worldId, this.now()) });
  }

  /**
   * Payments within what the agent may pay alone run without a signature (Max, 6 Nov), by the same stand-in executor and
   * after the same checks a signed payment gets at the moment it runs: the world has not expired; it has not run; the
   * reserve floor holds on the balance now; its amount is at or below the "may pay alone" limit in force (which only a
   * policy the visitor signed can raise above the world's EUR 500.00, and no payment here is that small); its quote,
   * if it has one, is still valid (else it waits for a new quote, and runs alone then). It is bound to its terms by their
   * SHA-256 (stored with them) and to the signed policy change that allowed it. One at a time, the balance read again
   * after each; synchronous, with no await between the reads and the writes. Returns the ids it ran.
   */
  private runAlone(worldId: string): string[] {
    const ran: string[] = [];
    for (;;) {
      const nowMs = this.now().getTime();
      const w = (this.sql.exec("SELECT balance, expires FROM ts_worlds WHERE id = ?", worldId).toArray() as { balance: string; expires: number }[])[0];
      if (!w || w.expires <= nowMs) return ran;
      const pol = (this.sql.exec("SELECT version, json, signed_sha FROM ts_policy WHERE world = ?", worldId).toArray() as { version: number; json: string; signed_sha: string | null }[])[0];
      if (!pol) return ran;
      const rules = rulesOf(JSON.parse(pol.json) as WorldPolicy);
      const next = this.proposals(worldId).find((p) => {
        if (p.status !== "waiting") return false;
        const c = checkPayment((p.terms as { amount: string }).amount, w.balance, rules);
        if (c.check !== "pass" || c.waits !== "") return false;
        const quote = (p.terms as { fx?: { valid_to_at?: string } | null }).fx;
        return !quote || Date.parse(String(quote.valid_to_at)) > nowMs;
      });
      if (!next) return ran;
      const t = next.terms as { amount: string; payee: string; fx?: { quote_id?: string } | null };
      const execution = {
        id: `test-${hex(random(6))}`, at: new Date(nowMs).toISOString(), amount: t.amount, currency: TEST_WORLD.currency, payee: t.payee,
        balance_after: money(cents(w.balance) - cents(t.amount)), fx_quote_id: t.fx?.quote_id ?? null,
        by: "stand-in executor: recorded in this test world only; nothing paid or converted at Airwallex, no Metal call",
        alone: true, label: PAID_ALONE, rule: `at or below the ${eur(rules.alone_limit)} the agent may pay alone`,
        terms_sha256: next.sha, policy_version: String(pol.version), policy_change_sha256: pol.signed_sha,
      };
      this.sql.exec("UPDATE ts_proposals SET status = 'executed', execution = ? WHERE world = ? AND id = ? AND status = 'waiting'", JSON.stringify(execution), worldId, next.id);
      this.sql.exec("UPDATE ts_worlds SET balance = ? WHERE id = ?", execution.balance_after, worldId);
      this.recheck(worldId);
      ran.push(next.id);
    }
  }

  /**
   * A change to the world's policy. Read whole and checked (src/try/policy.ts readSet); compared field by field with the
   * policy in force. Only stricter: applied at once. Any field looser: refused, with the exact terms of the change to
   * sign (an answer, 200, not an error); with the visitor's signature over exactly those terms, verified as a payment's
   * is (the D20 verifier, this world's passkey, challenge = their SHA-256), applied. Nothing is sent anywhere.
   */
  private async setPolicy(url: URL, ip: string, world: WorldRow, body: Record<string, unknown>): Promise<Response> {
    const now = this.now();
    const agent = body.agent as Agent;
    const read = readSet(body.set, now);
    if (!read.ok) return answer(400, { error: `${read.error}. Nothing changed.`, applied: false });
    const cur = this.policyOf(world.id);
    const changes = policyChanges(cur.policy, agent, read.set);
    if (changes.length === 0) return answer(200, { applied: false, why: "no_change", reason: "Nothing changed: these are the values in force.", ...this.policyAnswer(world.id, now) });
    const next = withSet(cur.policy, agent, read.set);
    const looser = changes.filter((c) => c.looser).map((c) => c.field);
    const expiresAt = new Date(world.expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    const terms = canonical(policyTerms(world.id, agent, cur.version, changes, next, expiresAt));
    const sha = await sha256Hex(terms);
    if (looser.length === 0) return this.applyPolicy(world.id, cur.version, next, { applied: true, signed: false, changes, reason: "Stricter: applied at once. A stricter policy needs no signature." }, null);
    if (body.credential === undefined) {
      const which = looser.map((f) => FIELD_WORDS[f].toLowerCase()).join(", ");
      return answer(200, {
        applied: false, needs_signature: true, looser, changes, canonical: terms, terms_sha256: sha, proposed: this.locksOf(world.id, next, now), proposed_exposure: this.exposure(next),
        reason: `Refused: this change makes the policy looser (${which}), and a looser policy needs your passkey's signature over its exact terms, as the CFO's does in Purser. Nothing changed.`,
        ...(looser.includes("alone") ? { alone_effect: agent === "treasury"
          ? `Signing lets the Treasury agent pay alone up to ${eur(next.agents.treasury.alone)}: a payment in this test world at or below it then runs without your signature.`
          : `Signing lets this agent pay alone up to ${eur(next.agents[agent].alone)}. This test world's payments are the Treasury agent's, so none of them runs alone because of it.` } : {}),
        ...this.policyAnswer(world.id, now),
      });
    }
    // Signed: this world's passkey, over exactly these terms.
    const sent = String(body.canonical);
    const credential = body.credential as { id: string; response: Record<string, unknown> };
    const cred = (this.sql.exec("SELECT id, x, y, counter FROM ts_creds WHERE world = ? AND id = ?", world.id, credential.id).toArray() as CredRow[])[0];
    if (!cred) {
      this.hit(ip, "fail", now.getTime());
      return answer(403, { error: "this passkey is not this test world's: it signs no policy here", verified: false, why: "unknown passkey", applied: false });
    }
    const r = credential.response;
    const sentSha = await sha256Hex(sent);
    const v = await verifyAssertion({ authenticatorData: String(r.authenticatorData ?? ""), clientDataJSON: String(r.clientDataJSON ?? ""), signature: String(r.signature ?? "") },
      { x: cred.x, y: cred.y }, { challenge: hexToB64u(sentSha), origin: url.origin, rpId: url.hostname, lastCounter: cred.counter });
    const refuse = (why: string, reason: string) => {
      this.hit(ip, "fail", this.now().getTime());
      return answer(200, { applied: false, verified: false, why, reason, error: reason, ...this.policyAnswer(world.id, this.now()) });
    };
    if (!v.ok) return refuse(v.why, `Refused: the server's verifier did not accept this signature (${v.why === "challenge" ? "it was made for other terms" : v.why}). Nothing changed.`);
    if (sent !== terms) return refuse("terms", "Refused: the signature is not over the terms of this change (another change, or the policy has moved since). Nothing changed.");
    const latest = (this.sql.exec("SELECT counter FROM ts_creds WHERE world = ? AND id = ?", world.id, cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    if ((v.counter !== 0 || latest !== 0) && v.counter <= latest) return refuse("counter", "Refused: the signature counter did not move forward (a replay). Nothing changed.");
    const w = (this.sql.exec("SELECT expires FROM ts_worlds WHERE id = ?", world.id).toArray() as { expires: number }[])[0];
    if (!w || w.expires <= this.now().getTime()) return answer(410, { error: "this test world expired while signing; start a new one", expired: true, applied: false });
    if (this.policyOf(world.id).version !== cur.version) return refuse("stale", "Refused: the policy changed meanwhile, so these are not its terms any more. Nothing changed.");
    this.sql.exec("UPDATE ts_creds SET counter = ? WHERE world = ? AND id = ?", v.counter, world.id, cred.id);
    return this.applyPolicy(world.id, cur.version, next, { applied: true, signed: true, verified: true, changes, terms_sha256: sha, reason: "Signed and verified: the looser policy holds in your test world." }, sha);
  }

  private async sign(url: URL, ip: string, world: WorldRow, body: Record<string, unknown>): Promise<Response> {
    const { proposal_id, canonical: terms, credential } = body;
    if (typeof proposal_id !== "string" || typeof terms !== "string" || terms.length > MAX_TERMS || !isObj(credential) || typeof credential.id !== "string" || !isObj(credential.response)) {
      return answer(400, { error: "malformed signature" });
    }
    const p = this.proposals(world.id).find((x) => x.id === proposal_id);
    if (!p) return answer(404, { error: `no proposal ${proposal_id} in this test world` });
    // A proposal that fails a check has nothing to sign: no signature, however good, runs it.
    if (p.checked.check === "fail") return answer(409, { error: `blocked by a rule: ${p.checked.rule} No signature can approve it.`, blocked: true, rule: p.checked.rule, verified: false });
    const cred = (this.sql.exec("SELECT id, x, y, counter FROM ts_creds WHERE world = ? AND id = ?", world.id, credential.id).toArray() as CredRow[])[0];
    if (!cred) {
      this.hit(ip, "fail", this.now().getTime());
      return answer(403, { error: "this passkey is not this test world's: a passkey from another world, or a real one, signs nothing here", verified: false, why: "unknown passkey" });
    }
    const r = credential.response;
    const sha = await sha256Hex(terms);
    let signed: string | null = null;
    try {
      const cd = JSON.parse(new TextDecoder().decode(fromB64u(String(r.clientDataJSON ?? "")))) as { challenge?: unknown };
      signed = typeof cd.challenge === "string" ? hex(fromB64u(cd.challenge)) : null;
    } catch { signed = null; }
    const v = await verifyAssertion({ authenticatorData: String(r.authenticatorData ?? ""), clientDataJSON: String(r.clientDataJSON ?? ""), signature: String(r.signature ?? "") },
      { x: cred.x, y: cred.y }, { challenge: hexToB64u(sha), origin: url.origin, rpId: url.hostname, lastCounter: cred.counter });
    if (!v.ok) {
      this.hit(ip, "fail", this.now().getTime());
      const why = v.why === "challenge" ? `the signature was made for ${signed && /^[0-9a-f]{64}$/.test(signed) ? `hash ${signed.slice(0, 12)}…` : "other terms"}; these terms hash to ${sha.slice(0, 12)}…` : v.why;
      // A refused signature is an answer, not an error (A6): 200 with verified false and the reason, so the page shows
      // it without the browser logging a failed request. Malformed requests and limits stay 4xx.
      const reason = `refused: the server's verifier did not accept this signature (${why})`;
      return answer(200, { verified: false, reason, error: reason, why: v.why, terms_sha256: sha, signed_sha256: signed });
    }
    if (terms !== p.canonical) {
      this.hit(ip, "fail", this.now().getTime());
      const reason = "refused: these are not this proposal's terms";
      return answer(200, { verified: false, reason, error: reason, why: "terms", terms_sha256: sha });
    }
    // Read again after the awaits above, then write with no await between: a replay racing this one finds it done.
    const now = this.now().getTime();
    const fresh = (this.sql.exec("SELECT status FROM ts_proposals WHERE world = ? AND id = ?", world.id, p.id).toArray() as { status: string }[])[0];
    const w = (this.sql.exec("SELECT balance, expires FROM ts_worlds WHERE id = ?", world.id).toArray() as { balance: string; expires: number }[])[0];
    if (!fresh || !w || w.expires <= now) return answer(410, { error: "this test world expired while signing; start a new one", expired: true, verified: false });
    if (fresh.status !== "waiting") return answer(409, { error: `refused: ${p.id} already ran once; a replayed signature runs nothing`, verified: true, why: "replay", terms_sha256: sha });
    // The quote is part of what was signed, and it has an end: after it, even a good signature runs nothing.
    const quote = (p.terms as { fx?: { valid_to_at?: string } | null }).fx;
    if (quote && !(Date.parse(String(quote.valid_to_at)) > now)) {
      return answer(409, { error: "Quote expired. Get a fresh one and sign again.", expired_at: String(quote.valid_to_at), verified: true, why: "quote_expired", quote_expired: true, terms_sha256: sha });
    }
    const latest = (this.sql.exec("SELECT counter FROM ts_creds WHERE world = ? AND id = ?", world.id, cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    if ((v.counter !== 0 || latest !== 0) && v.counter <= latest) {
      const reason = "refused: the signature counter did not move forward (a replay)";
      return answer(200, { verified: false, reason, error: reason, why: "counter" });
    }
    const amount = (p.terms as { amount: string }).amount;
    const again = checkPayment(amount, w.balance, rulesOf(this.policyOf(world.id).policy));
    if (again.check === "fail") return answer(409, { error: `blocked by a rule: ${again.rule}`, blocked: true, verified: true });
    const execution = {
      id: `test-${hex(random(6))}`, at: new Date(now).toISOString(), amount, currency: TEST_WORLD.currency, payee: (p.terms as { payee: string }).payee,
      balance_after: money(cents(w.balance) - cents(amount)), fx_quote_id: (quote as { quote_id?: string } | null | undefined)?.quote_id ?? null, by: "stand-in executor: recorded in this test world only; nothing paid or converted at Airwallex, no Metal call",
    };
    this.sql.exec("UPDATE ts_creds SET counter = ? WHERE world = ? AND id = ?", v.counter, world.id, cred.id);
    this.sql.exec("UPDATE ts_proposals SET status = 'executed', execution = ? WHERE world = ? AND id = ?", JSON.stringify(execution), world.id, p.id);
    this.sql.exec("UPDATE ts_worlds SET balance = ? WHERE id = ?", execution.balance_after, world.id);
    // The other payment is checked again against the new balance (under the world's policy).
    this.recheck(world.id);
    // The public key it verified against (public by nature: it can check signatures, never make one), so the page can
    // hand the visitor a receipt anyone can verify offline (npm run verify-receipt).
    return answer(200, {
      verified: true, checks: ["signature (ES256)", "challenge = the terms' SHA-256", "origin", "RP id", "user present", "user verified", "counter"], terms_sha256: sha, executed: execution,
      public_key: { kty: "EC", crv: "P-256", x: cred.x, y: cred.y }, algorithm: "ES256",
    });
  }
}
