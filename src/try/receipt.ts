// /try/sign's receipt (Max, 6 Nov): after signing, the page hands the visitor receipt.json: the exact terms, their
// SHA-256, the passkey's assertion (authenticator data, client data, signature), the public key and the algorithm.
// Anyone can check it offline with one command, `npm run verify-receipt -- receipt.json`: no network, no server, only
// Node's own crypto. What it proves: the holder of this public key signed exactly these terms, with the authenticator
// reporting user verification, for this site. What it cannot prove: who holds the key, or that it was Face ID (the
// server checks no attestation), and nothing real moved: the terms are a test world's.

import { createHash, createPublicKey, verify } from "node:crypto";
import { verifyE2e } from "../e2e/receiptChain.js";

/** The receipt's format name: a field the page writes and the verifier requires. */
export const RECEIPT_FORMAT = "purser.try-sign-receipt/v1";

export interface TryReceipt {
  receipt: typeof RECEIPT_FORMAT;
  note: string;
  terms: Record<string, unknown>;
  terms_sha256: string;
  algorithm: "ES256";
  public_key: { kty: "EC"; crv: "P-256"; x: string; y: string };
  credential_id: string;
  rp_id: string;
  origin: string;
  assertion: { authenticatorData: string; clientDataJSON: string; signature: string };
  verified_by_server_at?: string;
  verify?: string;
  /** The platform end-to-end's steps (src/e2e/receiptChain.ts); checked when present. */
  e2e?: unknown;
  /** 6c: the test world's hash chain when it was signed (worker/src/worldChain.ts); checked when present. */
  chain?: { length: number; head: string | null; rows: ChainRowOf[] };
}
/** One row of a world's hash chain: hash = SHA-256 of the canonical JSON of the other five fields. */
export interface ChainRowOf { seq: number; at: string; kind: string; data_sha256: string; prev: string; hash: string }
/** The prev of a chain's first row. */
export const CHAIN_START = "0".repeat(64);
/** A chain row without its hash, as canonical JSON (RFC 8785: keys sorted; seq the one number, a whole one). */
export const chainRowCanonical = (r: Omit<ChainRowOf, "hash">) =>
  `{"at":${JSON.stringify(r.at)},"data_sha256":${JSON.stringify(r.data_sha256)},"kind":${JSON.stringify(r.kind)},"prev":${JSON.stringify(r.prev)},"seq":${String(r.seq)}}`;

export interface ReceiptCheck { check: string; ok: boolean; detail: string }
export interface ReceiptResult { ok: boolean; checks: ReceiptCheck[] }

const B64URL = /^[A-Za-z0-9_-]+$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const b64u = (s: string) => Buffer.from(s, "base64url");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

/** Canonical JSON (RFC 8785 for terms without numbers: money is a decimal string), as the page and the server hash it. */
export function canonicalTerms(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalTerms).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalTerms(v[k])}`).join(",")}}`;
  throw new Error("the terms carry a number or another type the terms never have (money is a decimal string)");
}

/**
 * Checks a receipt, every step on its own line: the terms hash to terms_sha256; the passkey's challenge is that hash;
 * the client data is a WebAuthn assertion for the receipt's origin; the authenticator data is for its RP id, with user
 * presence and user verification; and the ES256 signature over the authenticator data and the client data's hash
 * verifies with the public key. ok only when every check passes. Never throws.
 */
export function verifyReceipt(input: unknown): ReceiptResult {
  const checks: ReceiptCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => { checks.push({ check, ok, detail }); return ok; };
  const done = () => ({ ok: checks.length > 0 && checks.every((c) => c.ok), checks });

  const r = input as Partial<TryReceipt>;
  const a = isObj(r) ? r.assertion : undefined;
  const pk = isObj(r) ? r.public_key : undefined;
  const shaped = isObj(r) && r.receipt === RECEIPT_FORMAT && isObj(r.terms) && typeof r.terms_sha256 === "string" && /^[0-9a-f]{64}$/.test(r.terms_sha256)
    && typeof r.rp_id === "string" && typeof r.origin === "string" && isObj(a)
    && [a.authenticatorData, a.clientDataJSON, a.signature].every((x) => typeof x === "string" && B64URL.test(x))
    && isObj(pk) && pk.kty === "EC" && pk.crv === "P-256" && typeof pk.x === "string" && typeof pk.y === "string";
  if (!add("format", shaped, shaped ? RECEIPT_FORMAT : `not a ${RECEIPT_FORMAT} receipt (a field is missing or of the wrong type)`)) return done();
  const R = r as TryReceipt;

  add("algorithm", R.algorithm === "ES256", R.algorithm === "ES256" ? "ES256 (ECDSA on P-256 with SHA-256)" : `ES256 expected, not ${String(R.algorithm)}`);

  // 1. The terms: their canonical JSON, and its SHA-256.
  let canonical: string | null = null;
  try { canonical = canonicalTerms(R.terms); } catch (e) { add("terms", false, (e as Error).message); }
  if (canonical !== null) {
    const h = sha256(canonical).toString("hex");
    add("terms hash", h === R.terms_sha256, h === R.terms_sha256 ? `SHA-256 of the canonical terms is ${h}` : `the terms hash to ${h}, not to the receipt's ${R.terms_sha256}: the terms were changed`);
  }

  // 2. The client data: a WebAuthn assertion whose challenge is the terms hash, for this origin, not in a frame.
  type Client = { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  const client = ((): Client | null => {
    try { const c = JSON.parse(b64u(R.assertion.clientDataJSON).toString("utf8")) as unknown; return isObj(c) ? c : null; } catch { return null; }
  })();
  if (!client) add("client data", false, "the client data is not a JSON object");
  else {
    add("ceremony", client.type === "webauthn.get", client.type === "webauthn.get" ? "a passkey assertion (webauthn.get)" : `not an assertion (${String(client.type)})`);
    const want = Buffer.from(R.terms_sha256, "hex").toString("base64url");
    add("challenge", client.challenge === want, client.challenge === want ? "the passkey signed a challenge equal to the terms hash"
      : `the passkey signed challenge ${String(client.challenge).slice(0, 16)}…, not the terms hash (${want.slice(0, 16)}…)`);
    const origin = client.origin === R.origin && client.crossOrigin !== true;
    add("origin", origin, origin ? `made on ${R.origin}` : `made on ${String(client.origin)}${client.crossOrigin === true ? " inside a frame" : ""}, not ${R.origin}`);
  }

  // 3. The authenticator data: this site's RP id, user present, user verified.
  const auth = b64u(R.assertion.authenticatorData);
  if (add("authenticator data", auth.length >= 37, auth.length >= 37 ? `${auth.length} bytes` : "too short")) {
    const rp = sha256(R.rp_id).equals(auth.subarray(0, 32));
    add("RP id", rp, rp ? `for ${R.rp_id}` : `not for ${R.rp_id}`);
    const flags = auth[32]!;
    add("user present", (flags & 0x01) !== 0, (flags & 0x01) ? "the authenticator reports a person present" : "no user presence");
    add("user verified", (flags & 0x04) !== 0, (flags & 0x04) ? "the authenticator reports user verification (Face ID, a fingerprint or a PIN; which one is not in the signature)" : "no user verification");
  }

  // The FX quote, when the terms carry one: reported, not checked with Airwallex (no network). A good signature over
  // these terms covers this quote id; whether Airwallex issued it is not something a receipt can show offline.
  const fx = isObj(R.terms.fx) ? R.terms.fx : null;
  if (fx) {
    const shaped = typeof fx.quote_id === "string" && typeof fx.valid_to_at === "string" && typeof fx.client_rate === "string";
    add("fx quote", shaped, shaped ? `quote ${String(fx.quote_id)}, ${String(fx.buy_currency)} ${String(fx.buy_amount)} for ${String(fx.sell_currency)} ${String(fx.sell_amount)} at ${String(fx.client_rate)}, valid to ${String(fx.valid_to_at)}: in the signed terms (that Airwallex issued it is not checked offline)` : "the terms' fx block is not a quote");
  }

  // 4. The signature: ES256 over the authenticator data followed by the SHA-256 of the client data.
  try {
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: R.public_key.x, y: R.public_key.y }, format: "jwk" });
    const signed = Buffer.concat([auth, sha256(b64u(R.assertion.clientDataJSON))]);
    const ok = verify("sha256", signed, { key, dsaEncoding: "der" }, b64u(R.assertion.signature));
    add("signature", ok, ok ? "the ES256 signature verifies with the receipt's public key" : "the signature does not verify with the receipt's public key");
  } catch {
    add("signature", false, "the public key or the signature is malformed");
  }

  // 5. The world's hash chain (6c), when the receipt carries one: every row's hash recomputed, each prev the row
  // before's, the length and head as stated; and one signature row whose data is this signature (its proposal and the
  // hash signed), so the chain records it.
  if (R.chain !== undefined) {
    const c = R.chain as unknown;
    const rows = isObj(c) && Array.isArray(c.rows) ? (c.rows as unknown[]) : null;
    let bad: string | null = rows ? null : "the chain has no rows";
    let prev = CHAIN_START;
    for (let i = 0; rows && !bad && i < rows.length; i++) {
      const r = rows[i] as Partial<ChainRowOf>;
      if (!isObj(r) || r.seq !== i + 1 || typeof r.at !== "string" || typeof r.kind !== "string" || typeof r.data_sha256 !== "string" || typeof r.hash !== "string") bad = `row ${i + 1} is not a chain row`;
      else if (r.prev !== prev) bad = `row ${i + 1} does not follow the row before (its prev is not that row's hash)`;
      else if (sha256(chainRowCanonical({ seq: r.seq, at: r.at, kind: r.kind, data_sha256: r.data_sha256, prev: r.prev })).toString("hex") !== r.hash) bad = `row ${i + 1}'s hash is not the SHA-256 of the row: it was changed`;
      else prev = r.hash;
    }
    if (rows && !bad && (!isObj(c) || c.length !== rows.length || c.head !== (rows.length ? prev : null))) bad = "the chain's length or head is not its rows'";
    add("chain", !bad, bad ?? `${rows!.length} rows, each covering the one before; head ${prev}`);
    if (!bad) {
      let want: string | null = null;
      try { want = sha256(canonicalTerms({ proposal_id: R.terms.proposal_id, terms_sha256: R.terms_sha256 })).toString("hex"); } catch { want = null; }
      const row = (rows as ChainRowOf[]).find((r) => r.kind === "signature" && r.data_sha256 === want);
      add("chain signature", !!row, row ? `row ${row.seq} records this signature (${String(R.terms.proposal_id)}, the terms hash signed)` : "no row of the chain records this signature");
    }
  }
  // 6. The platform end-to-end's steps (invoice to T:0), when the receipt carries them.
  if (R.e2e !== undefined) checks.push(...verifyE2e(R.e2e, R.terms_sha256));
  return done();
}

/** What a passing receipt proves, and what it does not, for the command's last lines. */
export const RECEIPT_MEANS = [
  "Proves: the holder of this public key signed exactly these terms, with the authenticator reporting user verification, on this site.",
  "Does not prove: who holds the key, or that it was Face ID (no attestation is checked).",
];

/** The line for a /try/sign receipt: its terms name the test world they were signed in (terms.test_world). */
export const RECEIPT_TRY_WORLD = "A test world's terms: nothing real moved.";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * What the receipt is, read from the receipt itself (judge run, 13 Nov: `npm run verify-approval` on the real P-0002
 * said "test world"). A /try/sign receipt's terms carry test_world; an Airwallex sandbox approval says so in its note,
 * dated by the server's verification when it has one. Null when the receipt says neither: nothing is guessed.
 */
export function receiptOrigin(input: unknown): string | null {
  const r = (input ?? {}) as Partial<TryReceipt>;
  if (r.terms && typeof r.terms === "object" && typeof (r.terms as Record<string, unknown>).test_world === "string") return RECEIPT_TRY_WORLD;
  if (typeof r.note === "string" && /Airwallex sandbox/.test(r.note) && /test money/.test(r.note)) {
    const at = typeof r.verified_by_server_at === "string" ? /^(\d{4})-(\d{2})-(\d{2})T/.exec(r.verified_by_server_at) : null;
    return at ? `Airwallex sandbox approval of ${Number(at[3])} ${MONTHS[Number(at[2]) - 1]}, test money.` : "Airwallex sandbox approval, test money.";
  }
  return null;
}
/** The extra line when the terms carry an FX quote. */
/** The extra line when the receipt carries the world's hash chain. */
export const RECEIPT_CHAIN_MEANS = "The hash chain: every row covers the one before and one records this signature; the server kept it, so it shows the order and that no row changed after the next, not who wrote them.";
export const RECEIPT_FX_MEANS = "The FX quote: the signature covers this quote id and its expiry; the receipt cannot show offline that Airwallex issued it.";
