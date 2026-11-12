// The hands-on demo's bot check (purser-try, master list line 260): a proof of work, with no third party and no
// account anywhere. The server hands out a stateless challenge signed with an HMAC under a Worker secret
// (TRY_BOTCHECK_SECRET, set by the owner at deploy; never in a file). It carries the moment it was made and how hard it
// is: 12 to 20 leading zero bits of SHA-256, chosen by how many companies were started in the last ten minutes. The
// browser finds a nonce so that SHA-256("<challenge>:<nonce>") starts with that many zero bits, synchronously, before
// it calls POST /v1/try/start. The start route checks the answer before the visitor's Durable Object is touched, and
// refuses an expired, reused or wrong answer with a sentence a person can read.
//
// Behind the switch `bot_check` (off when missing). With the switch on and no secret configured, starts are refused:
// the check fails closed, it never waves a start through.
//
// What is kept: for each answer used, one counter row (rate_hits, bucket "botcheck:<the challenge's random part>") so
// the same answer cannot start a second company. Nothing about the visitor.
import { bump } from "../auth.js";
import { hmacB64u, randomToken, sameString } from "../crypto.js";
import type { Sql } from "../store.js";
import { TryRefused } from "./start.js";

export const BOT_MIN_BITS = 12;
export const BOT_MAX_BITS = 20;
/** How long a challenge may be answered. */
export const BOT_TTL_MS = 5 * 60_000;
/** A challenge "from the future" by more than this is refused (clock skew between Worker instances is small). */
const SKEW_MS = 30_000;

/** Difficulty from load: 12 bits when quiet, one more bit each time the starts of the last ten minutes double, at most 20. */
export function difficultyFor(recentStarts: number): number {
  const n = Math.max(0, Math.floor(recentStarts));
  return Math.min(BOT_MAX_BITS, BOT_MIN_BITS + Math.floor(Math.log2(n + 1)));
}

/** The companies started in the last ten minutes: the load the difficulty follows. */
export async function recentStarts(sql: Sql, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 10 * 60_000).toISOString();
  return Number((await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM try_companies WHERE created_at >= ?", [since]))?.n ?? 0);
}

export interface Challenge { challenge: string; difficulty: number; expires_at: string }

const body = (ts: number, bits: number, rand: string) => `pc1.${ts}.${bits}.${rand}`;

/** A new challenge: "pc1.<ms>.<bits>.<random>.<hmac>". Stateless: nothing is stored until it is used. */
export async function issueChallenge(secret: string, now: Date, bits: number): Promise<Challenge> {
  const d = Math.min(BOT_MAX_BITS, Math.max(BOT_MIN_BITS, Math.floor(bits)));
  const b = body(now.getTime(), d, randomToken(12));
  const mac = await hmacB64u(secret, `botcheck:${b}`);
  return { challenge: `${b}.${mac}`, difficulty: d, expires_at: new Date(now.getTime() + BOT_TTL_MS).toISOString() };
}

/** Leading zero bits of a digest. */
export function zeroBits(d: Uint8Array): number {
  let n = 0;
  for (const byte of d) {
    if (byte === 0) { n += 8; continue; }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

export type BotVerdict = { ok: true; rand: string; ts: number; bits: number } | { ok: false; why: "shape" | "signature" | "expired" | "future" | "work" };

/** Checks an answer without storing anything: shape, signature, age and the work. (Reuse is checked by useProof.) */
export async function checkProof(secret: string, challenge: string, nonce: string, now: Date): Promise<BotVerdict> {
  const m = /^pc1\.(\d{13})\.(\d{1,2})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(challenge);
  if (!m || !/^[0-9]{1,12}$/.test(nonce)) return { ok: false, why: "shape" };
  const ts = Number(m[1]), bits = Number(m[2]), rand = m[3]!;
  if (bits < BOT_MIN_BITS || bits > BOT_MAX_BITS) return { ok: false, why: "shape" };
  const mac = await hmacB64u(secret, `botcheck:${body(ts, bits, rand)}`);
  if (!sameString(mac, m[4]!)) return { ok: false, why: "signature" };
  if (ts > now.getTime() + SKEW_MS) return { ok: false, why: "future" };
  if (now.getTime() - ts > BOT_TTL_MS) return { ok: false, why: "expired" };
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${challenge}:${nonce}`)));
  if (zeroBits(d) < bits) return { ok: false, why: "work" };
  return { ok: true, rand, ts, bits };
}

const SENTENCE: Record<Exclude<BotVerdict, { ok: true }>["why"] | "reused" | "missing", string> = {
  missing: "Your browser's quick check did not arrive. Please reload the page and press Start again.",
  shape: "Your browser's quick check did not arrive in one piece. Please reload the page and press Start again.",
  signature: "This check was not made by this page. Please reload the page and press Start again.",
  expired: "This check is more than five minutes old. Please press Start again.",
  future: "This check is not valid yet. Please press Start again.",
  work: "Your browser's quick check did not add up. Please reload the page and press Start again.",
  reused: "This check was already used for a test company. Please press Start again for a new one.",
};

/** Checks an answer and spends it, so the same answer never starts a second company. Throws a 403 with a sentence. */
export async function useProof(sql: Sql, secret: string, proof: { challenge: string; nonce: string } | undefined, now: Date): Promise<void> {
  if (!proof) throw new TryRefused(403, "bot_check", SENTENCE.missing);
  const v = await checkProof(secret, proof.challenge, proof.nonce, now);
  if (!v.ok) throw new TryRefused(403, "bot_check", SENTENCE[v.why]);
  // One counter row per challenge, in the window of its own moment: the first use counts 1, any later use more.
  if ((await bump(sql, `botcheck:${v.rand}`, Math.floor(v.ts / 1000), 1)) > 1) throw new TryRefused(403, "bot_check", SENTENCE.reused);
}

/** The switch is on but the deployment holds no secret: starts are refused (fail closed). */
export function noSecret(): never {
  throw new TryRefused(503, "paused", "The hands-on demo is paused right now. Please try again later.");
}

/**
 * The browser's solver (plain ES5-style JavaScript, no backticks and no "${", so it lives inside a page's template
 * string). It defines solveProof(challenge, bits) → { nonce, tries, ms }, synchronous. SHA-256 is computed here, not
 * with WebCrypto (which is asynchronous and slow per call): the blocks of "<challenge>:" before the nonce are hashed
 * once, and each try hashes only the last one or two blocks. test/try-botcheck.test.ts checks it against node:crypto.
 */
export const BOT_SOLVER_JS = `
var POW_K = new Int32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
var POW_W = new Int32Array(64);
var POW_H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
function powBlock(h, b, o) {
  var w = POW_W, i, a, bb, c, d, e, f, g, hh, t1, t2, x, y;
  for (i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
  for (i = 16; i < 64; i++) {
    x = w[i - 15]; y = w[i - 2];
    w[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + w[i - 16] | 0;
  }
  a = h[0]; bb = h[1]; c = h[2]; d = h[3]; e = h[4]; f = h[5]; g = h[6]; hh = h[7];
  for (i = 0; i < 64; i++) {
    t1 = hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + POW_K[i] + w[i] | 0;
    t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & bb) ^ (a & c) ^ (bb & c)) | 0;
    hh = g; g = f; f = e; e = d + t1 | 0; d = c; c = bb; bb = a; a = t1 + t2 | 0;
  }
  h[0] = h[0] + a | 0; h[1] = h[1] + bb | 0; h[2] = h[2] + c | 0; h[3] = h[3] + d | 0;
  h[4] = h[4] + e | 0; h[5] = h[5] + f | 0; h[6] = h[6] + g | 0; h[7] = h[7] + hh | 0;
}
function powAscii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0x7f; return u; }
// SHA-256 of prefix + tail, with the prefix's whole blocks already hashed into mid (an Int32Array of 8).
function powFinish(mid, rest, tail, total) {
  var n = rest.length + tail.length, len = n + 9 <= 64 ? 64 : 128, buf = new Uint8Array(len), h = new Int32Array(mid), i, bits = total * 8;
  buf.set(rest, 0); buf.set(tail, rest.length); buf[n] = 0x80;
  buf[len - 4] = (bits >>> 24) & 255; buf[len - 3] = (bits >>> 16) & 255; buf[len - 2] = (bits >>> 8) & 255; buf[len - 1] = bits & 255;
  buf[len - 5] = Math.floor(bits / 4294967296) & 255;
  for (i = 0; i < len; i += 64) powBlock(h, buf, i);
  return h;
}
function powZeroBits(h) { for (var i = 0, n = 0; i < 8; i++) { if (h[i] === 0) { n += 32; continue; } return n + Math.clz32(h[i]); } return n; }
function powSha256Hex(s) {
  var u = powAscii(s), whole = u.length - (u.length % 64), mid = new Int32Array(POW_H);
  for (var i = 0; i < whole; i += 64) powBlock(mid, u, i);
  var h = powFinish(mid, u.subarray(whole), new Uint8Array(0), u.length), out = "";
  for (i = 0; i < 8; i++) out += ("00000000" + (h[i] >>> 0).toString(16)).slice(-8);
  return out;
}
function solveProof(challenge, bits) {
  var started = Date.now(), pre = powAscii(challenge + ":"), whole = pre.length - (pre.length % 64);
  var mid = new Int32Array(POW_H);
  for (var i = 0; i < whole; i += 64) powBlock(mid, pre, i);
  var rest = pre.subarray(whole);
  for (var nonce = 0; nonce < 1e9; nonce++) {
    var tail = powAscii(String(nonce));
    if (powZeroBits(powFinish(mid, rest, tail, pre.length + tail.length)) >= bits) return { nonce: String(nonce), tries: nonce + 1, ms: Date.now() - started };
  }
  return null;
}
`;

/** What POST /v1/try/challenge answers: no check while the switch is off; a challenge sized to the load while it is on. */
export async function challengeAnswer(a: { sql: Sql; secret: string | undefined; switchOn: boolean; now: Date }): Promise<{ required: false } | ({ required: true } & Challenge)> {
  if (!a.switchOn) return { required: false };
  if (!a.secret) noSecret();
  return { required: true, ...(await issueChallenge(a.secret, a.now, difficultyFor(await recentStarts(a.sql, a.now)))) };
}

/** The start's gate, before any company or Durable Object exists: nothing while the switch is off. */
export async function gateStart(a: { sql: Sql; secret: string | undefined; switchOn: boolean; proof: { challenge: string; nonce: string } | undefined; now: Date }): Promise<void> {
  if (!a.switchOn) return;
  if (!a.secret) noSecret();
  await useProof(a.sql, a.secret, a.proof, a.now);
}
