// /try/sign (TRY_SIGN_ENABLED): a visitor signs with their own passkey in a test world of their own. The world lives
// one hour in its own Durable Object instance ("try-sign"), in its own tables (ts_*), with its own passkeys: nothing
// here reads or writes the relay's state, its enrolled passkeys, its sessions or its queue, and no key of any kind is
// handed to this desk (no Airwallex, Metal, Claude or relay token). The agent's two proposals are fixed text, the
// checks are code, and "executed" is a stand-in that only records in the world's own table, as the Scenario Lab does.
//
// The signature itself is the real thing: the passkey is made with WebAuthn (user verification required, a random user
// id, no name or e-mail), the challenge is the SHA-256 of the exact terms (canonical JSON, as the real approvals), and
// the Worker checks the assertion with the D20 verifier (worker/src/webauthn.ts) against the public key this world
// registered. A proposal that fails a check has nothing to sign, and the server refuses a signature for it anyway.

import { COMMON_HEADERS, rateKey, type Sql } from "./core.js";
import { verifyAssertion, type PublicKeyXY } from "./webauthn.js";

/** A test world lives one hour, then everything in it is deleted. */
export const TRY_SIGN_TTL_MS = 60 * 60 * 1000;
/** At most this many live test worlds for everyone together; past it, a new one waits. */
export const TRY_SIGN_MAX_WORLDS = 300;
/** New test worlds per address (IPv6 by its /64) per hour. */
export const TRY_SIGN_WORLDS_PER_HOUR = 6;
/** Requests per address per minute, every kind together. */
export const TRY_SIGN_PER_MINUTE = 30;
/** Failed signatures or passkeys per address per hour before it is refused. */
export const TRY_SIGN_FAILS_PER_HOUR = 30;
const MAX_BODY = 16_384;
const MAX_TERMS = 4096;
export const TRY_TERMS_SCHEMA = "kit11.try-terms/v1";
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
/** For people: EUR 25,000.00. */
const eur = (s: string) => `EUR ${s.replace(/\B(?=(\d{3})+\.)/g, ",")}`;

interface FixedProposal { id: string; agent: string; says: string; payee: string; amount: string; reference: string }
/** What the agent proposes: fixed text, the same for every visitor; no model is asked on this page. */
export const FIXED_PROPOSALS: FixedProposal[] = [
  { id: "T-0001", agent: "Treasury agent", says: "Stockline's spring order is ready; I would pay it now to keep the price.", payee: "Stockline GmbH (test payee)", amount: "6500.00", reference: "Stock order SO-4471" },
  { id: "T-0002", agent: "Treasury agent", says: "Alpine Packaging's invoice is due Friday. It is more than I may pay alone, so I ask you.", payee: "Alpine Packaging (test payee)", amount: "1850.00", reference: "Invoice INV-2026-118" },
];

export type Check = { check: "fail"; rule: string } | { check: "pass"; waits: string };
/** The rules, in code: the reserve floor first, then the amount an agent may pay without a person. */
export function checkPayment(amount: string, balance: string): Check {
  const after = cents(balance) - cents(amount);
  if (after < cents(TEST_WORLD.reserve_floor)) {
    return { check: "fail", rule: `Reserve floor: the balance may not go below ${eur(TEST_WORLD.reserve_floor)}; after this payment it would be ${eur(money(after))}.` };
  }
  if (cents(amount) > cents(TEST_WORLD.alone_limit)) return { check: "pass", waits: `Above the ${eur(TEST_WORLD.alone_limit)} an agent may pay alone, so it waits for a person's signature.` };
  return { check: "pass", waits: "" };
}

/** A proposal's terms: bound to this world (its public id) and its expiry, so a signature is good here only. */
export function proposalTerms(p: FixedProposal, worldId: string, expiresAt: string): { [k: string]: TermsValue } {
  return {
    schema: TRY_TERMS_SCHEMA, test_world: worldId, kind: "payment", proposal_id: p.id, proposed_by: `${p.agent} (fixed text)`,
    payee: p.payee, amount: p.amount, currency: TEST_WORLD.currency, reference: p.reference, expires_at: expiresAt,
    nothing_real_moves: true,
  };
}

interface WorldRow { id: string; expires: number; reg_challenge: string | null; balance: string }
interface ProposalRow { id: string; canonical: string; sha: string; check_json: string; status: string; execution: string | null }
interface CredRow { id: string; x: string; y: string; counter: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class TrySignDesk {
  private readonly now: () => Date;

  /** It takes a SQL handle and a clock, nothing else: no key, no fetch, no reach outside its own tables. */
  constructor(private readonly sql: Sql, opts: { now?: () => Date } = {}) {
    this.now = opts.now ?? (() => new Date());
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_worlds (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, ip TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, reg_challenge TEXT, balance TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_creds (world TEXT NOT NULL, id TEXT NOT NULL, x TEXT NOT NULL, y TEXT NOT NULL, counter INTEGER NOT NULL, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_proposals (world TEXT NOT NULL, id TEXT NOT NULL, canonical TEXT NOT NULL, sha TEXT NOT NULL, check_json TEXT NOT NULL, status TEXT NOT NULL, execution TEXT, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_hits (ip TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!isTrySignPath(path)) return trySignNotFound();
    const sub = path.slice("/api/try-sign".length);
    if (!["/world", "/passkey", "/sign"].includes(sub)) return trySignNotFound();
    if (req.method !== "POST") return answer(405, { error: "use POST" });
    // Only this site's own page may ask: a browser on another site sends its own origin, or none on a form post.
    if (req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") === "cross-site") return answer(403, { error: "ask from the /try/sign page on this site" });

    const nowMs = this.now().getTime();
    this.purge(nowMs);
    const ip = rateKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    if (this.hits(ip, "fail", nowMs - 3_600_000) >= TRY_SIGN_FAILS_PER_HOUR) return answer(429, { error: "too many refused signatures from this address; wait an hour" });
    if (this.hits(ip, "req", nowMs - 60_000) >= TRY_SIGN_PER_MINUTE) return answer(429, { error: "a few requests a minute; wait a moment" });
    this.hit(ip, "req", nowMs);

    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) return answer(413, { error: "too large" });
    const raw = await req.text();
    if (enc.encode(raw).length > MAX_BODY) return answer(413, { error: "too large" });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return answer(400, { error: "send JSON" }); }
    if (!isObj(body)) return answer(400, { error: "send a JSON object" });

    if (sub === "/world") return this.newWorld(url, ip, nowMs);
    const world = await this.worldOf(body.token);
    if (!world || world.expires <= this.now().getTime()) return answer(410, { error: "no such test world: it expired (a world lasts one hour) or never existed; start a new one", expired: true });
    if (sub === "/passkey") return this.registerPasskey(url, ip, world, body);
    return this.sign(url, ip, world, body);
  }

  private hits(ip: string, kind: string, since: number): number {
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_hits WHERE ip = ? AND kind = ? AND at > ?", ip, kind, since).toArray() as [{ n: number }];
    return n;
  }
  private hit(ip: string, kind: string, at: number): void {
    this.sql.exec("INSERT INTO ts_hits (ip, kind, at) VALUES (?, ?, ?)", ip, kind, at);
  }

  /** Expired worlds go, with their passkeys and proposals; old hits go too. */
  private purge(nowMs: number): void {
    const gone = (this.sql.exec("SELECT id FROM ts_worlds WHERE expires <= ?", nowMs).toArray() as { id: string }[]).map((r) => r.id);
    for (const id of gone) {
      this.sql.exec("DELETE FROM ts_creds WHERE world = ?", id);
      this.sql.exec("DELETE FROM ts_proposals WHERE world = ?", id);
      this.sql.exec("DELETE FROM ts_worlds WHERE id = ?", id);
    }
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

  private async newWorld(url: URL, ip: string, nowMs: number): Promise<Response> {
    const id = hex(random(8));
    const token = toB64u(random(32));
    const tokenHash = await sha256Hex(token);
    const challenge = toB64u(random(32));
    const expires = nowMs + TRY_SIGN_TTL_MS;
    const expiresAt = new Date(expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    const rows: [string, string, string, Check][] = [];
    for (const p of FIXED_PROPOSALS) {
      const c = canonical(proposalTerms(p, id, expiresAt));
      rows.push([p.id, c, await sha256Hex(c), checkPayment(p.amount, TEST_WORLD.balance)]);
    }
    // No await from here on: the limits are checked and the world written together, so tries at once cannot pass both.
    if (this.hits(ip, "world", nowMs - 3_600_000) >= TRY_SIGN_WORLDS_PER_HOUR) return answer(429, { error: `${TRY_SIGN_WORLDS_PER_HOUR} test worlds an hour from one address; use the one you have, or wait` });
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_worlds").toArray() as [{ n: number }];
    if (n >= TRY_SIGN_MAX_WORLDS) return answer(503, { error: "many test worlds are open right now; try again in a few minutes" });
    this.hit(ip, "world", nowMs);
    this.sql.exec("INSERT INTO ts_worlds (id, token_hash, ip, created, expires, reg_challenge, balance) VALUES (?, ?, ?, ?, ?, ?, ?)", id, tokenHash, ip, nowMs, expires, challenge, TEST_WORLD.balance);
    for (const [pid, c, sha, check] of rows) {
      this.sql.exec("INSERT INTO ts_proposals (world, id, canonical, sha, check_json, status, execution) VALUES (?, ?, ?, ?, ?, ?, NULL)", id, pid, c, sha, JSON.stringify(check), check.check === "fail" ? "blocked" : "waiting");
    }
    return answer(201, {
      world: { id, token, expires_at: expiresAt, ...TEST_WORLD },
      proposals: this.proposals(id).map((p) => {
        const f = FIXED_PROPOSALS.find((x) => x.id === p.id)!;
        return { proposal_id: p.id, agent: f.agent, says: f.says, canonical: p.canonical, terms_sha256: p.sha, status: p.status, ...p.checked };
      }),
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
    this.sql.exec("INSERT INTO ts_creds (world, id, x, y, counter) VALUES (?, ?, ?, ?, ?)", world.id, c.id, v.key.x, v.key.y, v.counter);
    return answer(201, { passkey: { id: c.id }, world: { id: world.id } });
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
      return answer(400, { error: `refused: the server's verifier did not accept this signature (${why})`, verified: false, why: v.why, terms_sha256: sha, signed_sha256: signed });
    }
    if (terms !== p.canonical) {
      this.hit(ip, "fail", this.now().getTime());
      return answer(409, { error: "refused: these are not this proposal's terms", verified: false, why: "terms", terms_sha256: sha });
    }
    // Read again after the awaits above, then write with no await between: a replay racing this one finds it done.
    const now = this.now().getTime();
    const fresh = (this.sql.exec("SELECT status FROM ts_proposals WHERE world = ? AND id = ?", world.id, p.id).toArray() as { status: string }[])[0];
    const w = (this.sql.exec("SELECT balance, expires FROM ts_worlds WHERE id = ?", world.id).toArray() as { balance: string; expires: number }[])[0];
    if (!fresh || !w || w.expires <= now) return answer(410, { error: "this test world expired while signing; start a new one", expired: true, verified: false });
    if (fresh.status !== "waiting") return answer(409, { error: `refused: ${p.id} already ran once; a replayed signature runs nothing`, verified: true, why: "replay", terms_sha256: sha });
    const latest = (this.sql.exec("SELECT counter FROM ts_creds WHERE world = ? AND id = ?", world.id, cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    if ((v.counter !== 0 || latest !== 0) && v.counter <= latest) return answer(400, { error: "refused: the signature counter did not move forward (a replay)", verified: false, why: "counter" });
    const amount = (p.terms as { amount: string }).amount;
    const again = checkPayment(amount, w.balance);
    if (again.check === "fail") return answer(409, { error: `blocked by a rule: ${again.rule}`, blocked: true, verified: true });
    const execution = {
      id: `test-${hex(random(6))}`, at: new Date(now).toISOString(), amount, currency: TEST_WORLD.currency, payee: (p.terms as { payee: string }).payee,
      balance_after: money(cents(w.balance) - cents(amount)), by: "stand-in executor: recorded in this test world only, no Airwallex or Metal call",
    };
    this.sql.exec("UPDATE ts_creds SET counter = ? WHERE world = ? AND id = ?", v.counter, world.id, cred.id);
    this.sql.exec("UPDATE ts_proposals SET status = 'executed', execution = ? WHERE world = ? AND id = ?", JSON.stringify(execution), world.id, p.id);
    this.sql.exec("UPDATE ts_worlds SET balance = ? WHERE id = ?", execution.balance_after, world.id);
    return answer(200, { verified: true, checks: ["signature (ES256)", "challenge = the terms' SHA-256", "origin", "RP id", "user present", "user verified", "counter"], terms_sha256: sha, executed: execution });
  }
}
