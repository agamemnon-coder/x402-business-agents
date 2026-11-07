// Security task A1 (6 Nov): proofs that the passkey (WebAuthn) checks hold, in all three places that verify one:
// the runner (src/passkey, @simplewebauthn/server: every approval), the relay Worker's own verifier
// (worker/src/webauthn.ts: D20 sign-in, and /try/sign) and the public /try/sign desk (worker/src/trySign.ts).
// Each block is one claim; each test fails if the check behind it is dropped or loosened.
//   1. Challenges: random where they are random (sign-in, enrolment, a test world's passkey), 32 bytes from the CSPRNG,
//      used once, short-lived. An approval's challenge is the terms hash itself (by design: the signature is a
//      statement about those terms); its terms carry the proposal id and the expiry, and a proposal is decided once.
//   2. Origin and RP id compared exactly (no prefix, suffix, case, port or parent-domain match); user presence and user
//      verification both required; a cross-origin (iframed) ceremony or the wrong ceremony type refused.
//   3. The signature counter: once an authenticator reports one, it must grow; 0 and 0 is accepted (synced passkeys,
//      iCloud and Google, always report 0), and then the one-time challenge, or the decided-once proposal, stops a replay.
//   4. The signature is bound to the hash of the exact terms: one test per field of the terms.
//   5. /try/sign's endpoints: a strict schema, size caps, rate limits, and answers without internal details.
import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import Database from "better-sqlite3";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { jcs } from "@metalntwx/metal-pay/mandates";
import type { InvoicePaymentTerms } from "../src/agents/euroBill.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { ENROLMENT_TTL_MS, openEnrolment, passkeyById, recordPasskey } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { verifyApprovalSignature } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { Relay, viewKeyForWeek } from "../worker/src/core.js";
import { FIXED_PROPOSALS, proposalTerms, TRY_SIGN_PER_MINUTE, TRY_SIGN_UNCLAIMED_MS, TrySignDesk, wellFormed } from "../worker/src/trySign.js";
import { verifyAssertion } from "../worker/src/webauthn.js";
import { BASE, call, challengeOf, desk, newWorld, RP, signBody, sqlOver, t0, withPasskey } from "./support/trySign.js";

afterEach(() => { vi.restoreAllMocks(); });

const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest();
const shaHex = (d: string) => sha(d).toString("hex");
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10;
const ORIGIN = BASE;

/** One ceremony, every byte of it settable: what the browser puts in clientDataJSON and the authenticator signs. */
interface Ceremony { challenge: string; origin?: string; rpId?: string; type?: string; crossOrigin?: boolean; flags?: number; counter?: number }

/** A P-256 key that signs any assertion it is asked to, right or wrong: the attacker's (or the CFO's) authenticator. */
function rawKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = b64u(randomBytes(16));
  const cose = b64u(isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]])));
  const assert = (c: Ceremony) => {
    const authData = Buffer.concat([sha(c.rpId ?? RP), Buffer.from([c.flags ?? (UP | UV)]), u32(c.counter ?? 0)]);
    const clientData = Buffer.from(JSON.stringify({ type: c.type ?? "webauthn.get", challenge: c.challenge, origin: c.origin ?? ORIGIN, crossOrigin: c.crossOrigin ?? false }));
    const signature = nodeSign("sha256", Buffer.concat([authData, sha(clientData)]), privateKey);
    return { authenticatorData: b64u(authData), clientDataJSON: b64u(clientData), signature: b64u(signature) };
  };
  const json = (c: Ceremony): AuthenticationResponseJSON => ({ id, rawId: id, type: "public-key", response: assert(c), clientExtensionResults: {} });
  return { id, xy: { x: jwk.x!, y: jwk.y! }, cose, assert, json };
}
type RawKey = ReturnType<typeof rawKey>;

/** Stands in for the CSPRNG: every byte asked of crypto.getRandomValues is `byte`. */
const csprngGives = (byte: number) => vi.spyOn(globalThis.crypto, "getRandomValues")
  .mockImplementation(((a: ArrayBufferView) => { new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(byte); return a; }) as typeof crypto.getRandomValues);

// ── The runner's side ──

let tickets = 0;
const item = (body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `a1-${++tickets}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify(body), received_at: t0.toISOString() });

/** A runner ledger with this key enrolled for "max" (pinned to the relay's origin and RP id), counter as given. */
function runner(key: RawKey = rawKey(), counter = 0): { db: DB; key: RawKey } {
  const db = openDb(":memory:");
  const { window } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  recordPasskey(db, { window, credentialId: key.id, publicKey: key.cose, counter, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
  return { db, key };
}
const refund = (id: string, expires = "2026-11-04T10:10:00Z"): Terms => ({ schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: expires, total: "0.60" });
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

// ── The relay's D20 sign-in ──

const TOKEN = "t".repeat(64);
function relay() {
  let clock = t0;
  const r = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => clock, mfa: true });
  return { r, at: (d: Date) => { clock = d; } };
}
let ipN = 0;
const relayPost = async (r: Relay, path: string, body: unknown) => r.fetch(new Request(`${BASE}${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": await viewKeyForWeek(TOKEN, t0), "cf-connecting-ip": `192.0.2.${++ipN % 250}` },
}));

describe("1. challenges: random, single-use, short-lived; an approval's is its terms hash", () => {
  it("D20 sign-in: 32 bytes from the CSPRNG, different every time, two minutes, used once", async () => {
    const { r, at } = relay();
    const spy = csprngGives(0xab);
    const fixed = (await (await relayPost(r, "/api/session/options", {})).json()) as { challenge: string; timeout_ms: number };
    // It is the CSPRNG's output, all 32 bytes of it: replace the CSPRNG and the challenge follows it.
    expect(fixed.challenge).toBe(b64u(Buffer.alloc(32, 0xab)));
    expect(spy.mock.calls.some(([a]) => a.byteLength === 32)).toBe(true);
    spy.mockRestore();
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const o = (await (await relayPost(r, "/api/session/options", {})).json()) as { challenge: string; timeout_ms: number };
      expect(Buffer.from(o.challenge, "base64url")).toHaveLength(32);
      expect(o.timeout_ms).toBe(2 * 60_000);
      seen.add(o.challenge);
    }
    expect(seen.size).toBe(40);
    // Used once: an unknown challenge (never issued) is refused before any signature is looked at; and two minutes on,
    // an issued one that was never used is refused too.
    const { challenge } = (await (await relayPost(r, "/api/session/options", {})).json()) as { challenge: string };
    const never = await relayPost(r, "/api/session", { challenge: b64u(randomBytes(32)), credential: { id: "cred-1", response: {} } });
    expect(never.status).toBe(401);
    at(new Date(t0.getTime() + 2 * 60_000));
    const late = await relayPost(r, "/api/session", { challenge, credential: { id: "cred-1", response: {} } });
    expect([late.status, ((await late.json()) as { error: string }).error]).toEqual([401, "this sign-in has expired or was used; start again"]);
  });

  it("/try/sign: each world's passkey challenge is 32 CSPRNG bytes of its own; another world's is refused", async () => {
    const { d } = desk();
    const spy = csprngGives(0x5a);
    expect((await newWorld(d)).passkey_options.challenge).toBe(b64u(Buffer.alloc(32, 0x5a)));
    spy.mockRestore();
    const worlds = await Promise.all(Array.from({ length: 15 }, () => newWorld(desk().d)));
    expect(new Set(worlds.map((w) => w.passkey_options.challenge)).size).toBe(15);
    for (const w of worlds) expect(Buffer.from(w.passkey_options.challenge, "base64url")).toHaveLength(32);
    // World B's passkey made against world A's challenge: refused, and B's own challenge is spent with it.
    const A = await newWorld(d), B = await newWorld(d);
    const res = await call(d, "passkey", { token: B.world.token, credential: new FakeAuthenticator().register({ challenge: A.passkey_options.challenge, origin: BASE, rpId: RP }) });
    expect([res.status, ((await res.json()) as { why: string }).why]).toEqual([400, "challenge"]);
    expect((await call(d, "passkey", { token: B.world.token, credential: new FakeAuthenticator().register({ challenge: B.passkey_options.challenge, origin: BASE, rpId: RP }) })).status).toBe(409);
  });

  it("/try/sign: a world's passkey challenge lives ten minutes; the world (and its challenge) is gone after", async () => {
    const { d, at } = desk();
    const w = await newWorld(d);
    at(new Date(t0.getTime() + TRY_SIGN_UNCLAIMED_MS + 1));
    expect((await call(d, "passkey", { token: w.world.token, credential: new FakeAuthenticator().register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) })).status).toBe(410);
  });

  it("/try/sign: a valid signature over the same fixed proposal in an earlier world is refused in a new one (the world id is in the terms)", async () => {
    const { d } = desk();
    const auth = new FakeAuthenticator();
    const A = await withPasskey(d, auth);
    const B = await withPasskey(d, auth); // the same authenticator, a passkey in each world
    expect(A.b.proposal_id).toBe(B.b.proposal_id);
    expect(A.b.terms_sha256).not.toBe(B.b.terms_sha256);
    const old = auth.sign({ challenge: challengeOf(A.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    const r1 = await call(d, "sign", signBody(B.w.world.token, B.b, old));
    expect([r1.status, ((await r1.json()) as { why: string }).why]).toEqual([200, "challenge"]);
    const r2 = await call(d, "sign", signBody(B.w.world.token, B.b, old, A.b.canonical));
    expect([r2.status, ((await r2.json()) as { why: string }).why]).toEqual([200, "terms"]);
  });

  it("the runner's enrolment challenge: 32 random bytes per window, ten minutes, then no window to enrol against", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { window } = openEnrolment(openDb(":memory:"), { rpId: RP, origin: ORIGIN }, t0);
      expect(Buffer.from(window.challenge, "base64url")).toHaveLength(32);
      expect(Date.parse(window.expires_at) - t0.getTime()).toBe(ENROLMENT_TTL_MS);
      seen.add(window.challenge);
    }
    expect(seen.size).toBe(10);
    expect(ENROLMENT_TTL_MS).toBeLessThanOrEqual(10 * 60_000);
    const db = openDb(":memory:");
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
    const credential = new FakeAuthenticator().register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
    const late = await processRegistration(db, { ticket: "late", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: t0.toISOString() }, { label: "max" }, new Date(t0.getTime() + ENROLMENT_TTL_MS));
    expect(late).toMatchObject({ status: "refused", message: expect.stringMatching(/no enrolment window is open/) });
  });

  it("the runner: an approval for P-0001 does not approve P-0002 with otherwise the same terms (the id is hashed)", async () => {
    const { db, key } = runner();
    createProposal(db, { terms: refund("P-0001"), createdBy: "support" }, t0);
    createProposal(db, { terms: refund("P-0002"), createdBy: "support" }, t0);
    const h1 = termsHash(refund("P-0001"));
    const s1 = key.json({ challenge: challengeOf(h1), counter: 0 });
    const out = await processAssertion(db, item({ proposal_id: "P-0002", terms_sha256: h1, credential: s1 }, "P-0002"), t0);
    expect(out.status).toBe("refused");
    expect(statusOf(db, "P-0002")).toBe("PENDING_APPROVAL");
    // Decided once: the same signature, where it belongs, approves P-0001; sent again it changes nothing.
    expect((await processAssertion(db, item({ proposal_id: "P-0001", terms_sha256: h1, credential: s1 }, "P-0001"), t0)).status).toBe("approved");
    expect((await processAssertion(db, item({ proposal_id: "P-0001", terms_sha256: h1, credential: s1 }, "P-0001"), t0)).status).toBe("already");
    expect((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n).toBe(1);
  });

  it("the runner: a valid signature that arrives after the terms' expiry approves nothing", async () => {
    const { db, key } = runner();
    const terms = refund("P-0003", "2026-11-04T10:05:00Z");
    createProposal(db, { terms, createdBy: "support" }, t0);
    const h = termsHash(terms);
    const out = await processAssertion(db, item({ proposal_id: "P-0003", terms_sha256: h, credential: key.json({ challenge: challengeOf(h) }) }, "P-0003"), new Date("2026-11-04T10:05:00Z"));
    expect(out.status).toBe("too_late");
    expect((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n).toBe(0);
  });
});

// Origins a browser could never send for this page, but a loose comparison (prefix, suffix, case, port) would let in.
const WRONG_ORIGINS = [
  `http://${RP}`, `https://${RP}:443`, `https://${RP}:8443`, `${ORIGIN}/`, `https://${RP.toUpperCase()}`, `https://evil.${RP}`,
  `${ORIGIN}.evil.example`, "https://example.workers.dev", "null", "",
];
// RP ids that are not this site's: its parent (a valid RP id for a subdomain page elsewhere), case, a trailing dot.
const WRONG_RP_IDS = ["example.workers.dev", "workers.dev", `evil.${RP}`, RP.toUpperCase(), `${RP}.`, ""];
const WRONG_FLAGS: [number, string][] = [[UP, "user verification"], [UV, "user presence"], [0, "user presence"], [UP | BE | BS, "user verification"]];

describe("2. origin and RP id exact; user presence and verification required", () => {
  const CH = b64u(Buffer.alloc(32, 7));
  const exp = (lastCounter = 0) => ({ challenge: CH, origin: ORIGIN, rpId: RP, lastCounter });

  it("the Worker's verifier (D20 sign-in and /try/sign) accepts the right ceremony, and refuses every near miss", async () => {
    const k = rawKey();
    expect(await verifyAssertion(k.assert({ challenge: CH }), k.xy, exp())).toEqual({ ok: true, counter: 0 });
    expect(await verifyAssertion(k.assert({ challenge: CH, flags: UP | UV | BE | BS }), k.xy, exp())).toEqual({ ok: true, counter: 0 });
    for (const origin of WRONG_ORIGINS) expect({ origin, v: await verifyAssertion(k.assert({ challenge: CH, origin }), k.xy, exp()) }).toEqual({ origin, v: { ok: false, why: "origin" } });
    for (const rpId of WRONG_RP_IDS) expect({ rpId, v: await verifyAssertion(k.assert({ challenge: CH, rpId }), k.xy, exp()) }).toEqual({ rpId, v: { ok: false, why: "rp id" } });
    for (const [flags, why] of WRONG_FLAGS) expect({ flags, v: await verifyAssertion(k.assert({ challenge: CH, flags }), k.xy, exp()) }).toEqual({ flags, v: { ok: false, why } });
    expect(await verifyAssertion(k.assert({ challenge: CH, crossOrigin: true }), k.xy, exp())).toEqual({ ok: false, why: "origin" });
    for (const type of ["webauthn.create", "webauthn.get ", "payment.get"]) expect(await verifyAssertion(k.assert({ challenge: CH, type }), k.xy, exp())).toEqual({ ok: false, why: "type" });
  });

  it("the runner's verifier (every approval) accepts the right ceremony, and refuses every near miss", async () => {
    const { db, key } = runner();
    const pk = passkeyById(db, key.id)!;
    const hash = "ab".repeat(32);
    const ch = challengeOf(hash);
    const v = (c: Partial<Ceremony>) => verifyApprovalSignature(key.json({ challenge: ch, ...c }), hash, pk);
    expect(await v({})).toEqual({ ok: true, newCounter: 0 });
    for (const origin of WRONG_ORIGINS) expect({ origin, ok: (await v({ origin })).ok }).toEqual({ origin, ok: false });
    for (const rpId of WRONG_RP_IDS) expect({ rpId, ok: (await v({ rpId })).ok }).toEqual({ rpId, ok: false });
    for (const [flags] of WRONG_FLAGS) expect({ flags, ok: (await v({ flags })).ok }).toEqual({ flags, ok: false });
    // A ceremony in a frame on another site (@simplewebauthn alone accepts one without topOrigin): refused.
    expect(await v({ crossOrigin: true })).toEqual({ ok: false, reason: "the passkey was used inside a frame on another site (cross-origin)" });
    expect((await v({ type: "webauthn.create" })).ok).toBe(false);
    // And through the whole path: a proposal is not approved by any of them.
    const terms = refund("P-0010");
    createProposal(db, { terms, createdBy: "support" }, t0);
    const h = termsHash(terms);
    for (const bad of [{ origin: `https://evil.${RP}` }, { rpId: "example.workers.dev" }, { flags: UP }, { crossOrigin: true }]) {
      const out = await processAssertion(db, item({ proposal_id: "P-0010", terms_sha256: h, credential: key.json({ challenge: challengeOf(h), ...bad }) }, "P-0010"), t0);
      expect({ bad, status: out.status }).toEqual({ bad, status: "refused" });
    }
    expect(statusOf(db, "P-0010")).toBe("PENDING_APPROVAL");
    // Enrolment too: a new passkey made in a frame on another site is not pinned.
    const fresh = openDb(":memory:");
    const { window, code } = openEnrolment(fresh, { rpId: RP, origin: ORIGIN }, t0);
    const reg = new FakeAuthenticator().register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
    const cd = JSON.parse(Buffer.from(reg.response.clientDataJSON, "base64url").toString()) as Record<string, unknown>;
    const framedReg = { ...reg, response: { ...reg.response, clientDataJSON: b64u(Buffer.from(JSON.stringify({ ...cd, crossOrigin: true }))) } };
    const enrol = (credential: unknown) => processRegistration(fresh, { ticket: `e-${++tickets}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: t0.toISOString() }, { label: "max" }, t0);
    expect(await enrol(framedReg)).toMatchObject({ status: "refused", message: expect.stringMatching(/cross-origin/) });
    expect((await enrol(reg)).status).toBe("pending");
  });

  it("/try/sign refuses a near-miss origin or RP id, or no user verification, both for the new passkey and for the signature", async () => {
    for (const [bad, why] of [[{ origin: `https://evil.${RP}` }, "origin"], [{ origin: `http://${RP}` }, "origin"], [{ rpId: "example.workers.dev" }, "rp id"], [{ rpId: RP.toUpperCase() }, "rp id"]] as const) {
      const { d } = desk();
      const w = await newWorld(d);
      const res = await call(d, "passkey", { token: w.world.token, credential: new FakeAuthenticator().register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP, ...bad }) });
      expect({ bad, status: res.status, why: ((await res.json()) as { why: string }).why }).toEqual({ bad, status: 400, why });
      const s = await withPasskey(d);
      const r2 = await call(d, "sign", signBody(s.w.world.token, s.b, s.auth.sign({ challenge: challengeOf(s.b.terms_sha256), origin: BASE, rpId: RP, counter: 1, ...bad })));
      expect({ bad, status: r2.status, why: ((await r2.json()) as { why: string }).why }).toEqual({ bad, status: 200, why });
    }
    const { d } = desk();
    const w = await newWorld(d);
    const noUv = await call(d, "passkey", { token: w.world.token, credential: new FakeAuthenticator().register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP, userVerified: false }) });
    expect(((await noUv.json()) as { why: string }).why).toBe("user verification");
    // The options the page passes to the browser ask for it too.
    expect(w.passkey_options.authenticatorSelection).toMatchObject({ userVerification: "required" });
  });
});

describe("3. the signature counter", () => {
  // [stored, reported, accepted]: once a counter is used it must grow; 0 and 0 is an authenticator that keeps none.
  const CASES: [number, number, boolean][] = [[0, 0, true], [0, 1, true], [5, 6, true], [5, 5, false], [5, 4, false], [5, 0, false], [0xfffffffe, 0xffffffff, true]];
  const CH = b64u(Buffer.alloc(32, 9));

  it("the Worker's verifier: a counter that does not grow is refused", async () => {
    const k = rawKey();
    for (const [stored, reported, ok] of CASES) {
      const v = await verifyAssertion(k.assert({ challenge: CH, counter: reported }), k.xy, { challenge: CH, origin: ORIGIN, rpId: RP, lastCounter: stored });
      expect({ stored, reported, v }).toEqual({ stored, reported, v: ok ? { ok: true, counter: reported } : { ok: false, why: "counter" } });
    }
  });

  it("the runner: a counter that does not grow is refused, and the stored one only moves forward", async () => {
    for (const [stored, reported, ok] of CASES) {
      const { db, key } = runner(rawKey(), stored);
      const terms = refund("P-0020");
      createProposal(db, { terms, createdBy: "support" }, t0);
      const h = termsHash(terms);
      const out = await processAssertion(db, item({ proposal_id: "P-0020", terms_sha256: h, credential: key.json({ challenge: challengeOf(h), counter: reported }) }, "P-0020"), t0);
      expect({ stored, reported, status: out.status }).toEqual({ stored, reported, status: ok ? "approved" : "refused" });
      expect(passkeyById(db, key.id)!.counter).toBe(ok ? reported : stored);
    }
  });

  it("/try/sign: the counter the new passkey reported is the floor; a signature at or below it is refused", async () => {
    const { d } = desk();
    const auth = new FakeAuthenticator();
    const w = await newWorld(d);
    expect((await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP, counter: 7 }) })).status).toBe(201);
    const b = w.proposals.find((p) => p.check === "pass")!;
    for (const counter of [7, 6, 0]) {
      const r = await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter })));
      expect({ counter, status: r.status, why: ((await r.json()) as { why: string }).why }).toEqual({ counter, status: 200, why: "counter" });
    }
    expect((await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 8 })))).status).toBe(200);
  });
});

// ── 4. One test per field of the terms ──

type Json = string | boolean | null | Json[] | { [k: string]: Json };
/** Every leaf of a terms object, as a path. */
function leaves(v: Json, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, [...path, i]));
  if (v !== null && typeof v === "object") return Object.keys(v).flatMap((k) => leaves(v[k]!, [...path, k]));
  return [path];
}
/** The smallest change to one value: a cent, a second, one character, the other boolean. */
function nudge(v: Json): Json {
  if (typeof v === "boolean") return !v;
  if (v === null) return "0";
  if (typeof v !== "string") throw new Error("a leaf");
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)) return new Date(Date.parse(v) + 1000).toISOString().replace(/\.000Z$/, "Z");
  return v.slice(0, -1) + (v.endsWith("1") ? "2" : "1");
}
function withChange<T extends Json>(terms: T, path: (string | number)[]): T {
  const copy = structuredClone(terms) as Record<string | number, Json>;
  let at = copy;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, Json>;
  at[path.at(-1)!] = nudge(at[path.at(-1)!]!);
  return copy as T;
}
const label = (p: (string | number)[]) => p.join(".");

/** A full invoice payment (EUR to a SWIFT payee, with an FX conversion): typed by the real interface, so a field added there must be added here. */
const INVOICE: InvoicePaymentTerms = {
  schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0042", expires_at: "2026-11-04T10:15:00Z",
  invoice_no: "INV-2026-118", vendor: "Alpine Packaging GmbH", amount: "1850.00", currency: "EUR", fee_max: "25.00",
  beneficiary_id: "ben_test_0001", beneficiary_name: "Alpine Packaging GmbH", iban_last4: "4470", bic: "TESTDEFFXXX", method: "SWIFT",
  reference: "Invoice INV-2026-118", reason: "due Friday", transfer_request_id: "tr_test_0001",
  conversion: {
    request_id: "cv_test_0001", quote_id: "q_test_0001", client_rate: "0.9214", valid_to: "2026-11-04T10:14:00Z",
    buy_currency: "EUR", buy_amount: "1850.00", sell_currency: "USD", sell_amount: "2007.80",
  },
  balances_before: { eur_available: "30000.00", usd_available: "12000.00" },
  floors: { eur_floor: "25000.00", eur_obligations: "0.00", usd_floor: "0.00" },
  after: { eur_free: "3150.00", usd_available: "9992.20" },
  evidence: [{ type: "invoice_pdf", ref: "inbox/INV-2026-118.pdf", sha256: "ab".repeat(32) }],
};
const INVOICE_FIELDS = leaves(INVOICE as unknown as Json);

describe("4. the signature is bound to the hash of the exact terms, field by field", () => {
  it("the runner's invoice payment has every field the plan names: amount, currency, payee, FX quote and rate, expiry", () => {
    const names = INVOICE_FIELDS.map(label);
    for (const f of ["amount", "currency", "beneficiary_id", "beneficiary_name", "iban_last4", "bic", "conversion.quote_id", "conversion.client_rate", "conversion.valid_to", "expires_at"]) expect(names).toContain(f);
    expect(INVOICE_FIELDS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(INVOICE_FIELDS.map((p) => [label(p), p] as const))("the runner: changing %s changes the hash, and the signature over the old terms is refused", async (_, path) => {
    const key = rawKey();
    const signed = termsHash(INVOICE);
    const credential = key.json({ challenge: challengeOf(signed) });
    const changed = withChange(INVOICE as unknown as Json, path) as unknown as InvoicePaymentTerms;
    expect(shaHex(jcs(changed))).not.toBe(signed);

    // The proposal now carries the changed terms with their own, consistent hash (as if rewritten whole).
    const { db } = runner(key);
    if (changed.proposal_id === INVOICE.proposal_id) {
      createProposal(db, { terms: INVOICE, createdBy: "treasury" }, t0);
      db.prepare("UPDATE proposals SET terms_json = ?, terms_sha256 = ? WHERE proposal_id = ?").run(JSON.stringify(changed), shaHex(jcs(changed)), INVOICE.proposal_id);
    } else {
      createProposal(db, { terms: changed, createdBy: "treasury" }, t0);
    }
    const out = await processAssertion(db, item({ proposal_id: changed.proposal_id, terms_sha256: signed, credential }, changed.proposal_id), t0);
    expect(out.status).toBe("refused");
    expect(statusOf(db, changed.proposal_id)).toBe("PENDING_APPROVAL");
    expect((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n).toBe(0);

    // The same signature on the unchanged terms is accepted: the field is what made the difference.
    const control = runner(key);
    createProposal(control.db, { terms: INVOICE, createdBy: "treasury" }, t0);
    expect(["approved", "cosigned"]).toContain((await processAssertion(control.db, item({ proposal_id: INVOICE.proposal_id, terms_sha256: signed, credential }, INVOICE.proposal_id), t0)).status);
  });

  const TRY_FIELDS = Object.keys(proposalTerms(FIXED_PROPOSALS[1]!, "0123456789abcdef", "2026-11-04T11:00:00Z"));
  it("/try/sign's terms: the fields are the ones each per-field test below changes", () => {
    expect(TRY_FIELDS.sort()).toEqual(["agent_advice", "amount", "currency", "expires_at", "fx", "kind", "nothing_real_moves", "payee", "payee_iban", "proposal_id", "proposed_by", "reference", "schema", "test_world"]);
  });

  it.each(TRY_FIELDS)("/try/sign: changing %s changes the hash, and the same signature is refused for it", async (field) => {
    const { d, db } = desk();
    const { w, auth, b } = await withPasskey(d);
    const assertion = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    const terms = JSON.parse(b.canonical) as { [k: string]: Json };
    const changed = jcs(withChange(terms, [field]));
    expect(shaHex(changed)).not.toBe(b.terms_sha256);
    const r = await call(d, "sign", signBody(w.world.token, b, assertion, changed));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ verified: false, why: "challenge", terms_sha256: shaHex(changed), signed_sha256: b.terms_sha256 });
    expect(db.prepare("SELECT status FROM ts_proposals WHERE world = ? AND id = ?").get(w.world.id, b.proposal_id)).toEqual({ status: "waiting" });
    // Control: the same signature with the exact terms runs.
    expect((await call(d, "sign", signBody(w.world.token, b, assertion))).status).toBe(200);
  });
});

// ── 5. /try/sign's endpoints ──

/** What no answer may carry: a stack frame, a file path, an exception's name or a SQL error. */
const INTERNAL = /\bat \S+ \(|\.ts:\d+|\.js:\d+|\/home\/|\/src\/|\/worker\/|node_modules|stack|TypeError|RangeError|SyntaxError|ReferenceError|SqliteError|SQLITE_|Error:/;

describe("5. /try/sign's endpoints: schema, size, rate, and no internal details", () => {
  it("refuses a field it does not know, at every level, before anything is checked or written", async () => {
    const { d, db } = desk();
    const w = await newWorld(d);
    const auth = new FakeAuthenticator();
    const reg = auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP });
    const b = w.proposals.find((p) => p.check === "pass")!;
    const bodies: [string, unknown][] = [
      ["world", { extra: 1 }],
      ["passkey", { token: w.world.token, credential: reg, admin: true }],
      ["passkey", { token: w.world.token, credential: { ...reg, extra: "x" } }],
      ["passkey", { token: w.world.token, credential: { ...reg, response: { ...reg.response, publicKey: "AAAA" } } }],
      ["sign", { ...signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })), balance: "999999.00" }],
      ["sign", signBody(w.world.token, b, { ...auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 }), counter: 0 })],
    ];
    for (const [sub, body] of bodies) expect({ sub, body, status: (await call(d, sub, body)).status }).toEqual({ sub, body, status: 400 });
    // Nothing was registered: the challenge is still there for the right body.
    expect((db.prepare("SELECT COUNT(*) AS n FROM ts_creds").get() as { n: number }).n).toBe(0);
    expect((await call(d, "passkey", { token: w.world.token, credential: reg })).status).toBe(201);
  });

  it("refuses wrong types with 400, not a crash or a coerced value", async () => {
    const { d } = desk();
    const { w, auth, b } = await withPasskey(d);
    const good = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    const bad: unknown[] = [
      { ...signBody(w.world.token, b, good), token: 42 },
      { ...signBody(w.world.token, b, good), proposal_id: 2 },
      { ...signBody(w.world.token, b, good), proposal_id: "T-0002' OR 1=1" },
      { ...signBody(w.world.token, b, good), canonical: JSON.parse(b.canonical) },
      { ...signBody(w.world.token, b, good), canonical: "x".repeat(5000) },
      signBody(w.world.token, b, "a string"),
      signBody(w.world.token, b, { ...good, id: 7 }),
      signBody(w.world.token, b, { ...good, id: "not base64url!" }),
      signBody(w.world.token, b, { ...good, type: "password" }),
      signBody(w.world.token, b, { ...good, response: [good.response] }),
      signBody(w.world.token, b, { ...good, response: { ...good.response, signature: 12345 } }),
      signBody(w.world.token, b, { ...good, response: { ...good.response, clientDataJSON: { type: "webauthn.get" } } }),
      signBody(w.world.token, b, { ...good, response: { ...good.response, authenticatorData: ["AAAA"] } }),
      signBody(w.world.token, b, { ...good, response: { ...good.response, signature: "x".repeat(3000) } }),
    ];
    for (const body of bad) {
      const r = await call(d, "sign", body);
      expect({ body, status: r.status }).toEqual({ body, status: 400 });
      expect(await r.json()).toEqual({ error: "malformed signature" });
    }
    expect((await call(d, "passkey", { token: w.world.token, credential: { id: "abc", response: { clientDataJSON: 1, attestationObject: "AA" } } })).status).toBe(400);
    expect((await call(d, "world", [])).status).toBe(400);
    expect((await call(d, "world", "{}")).status).toBe(400);
    // The well-formed signature still runs.
    expect((await call(d, "sign", signBody(w.world.token, b, good))).status).toBe(200);
  });

  it("the schema is the page's own: what the page sends passes it, field for field", () => {
    const id = b64u(randomBytes(16));
    // As src/try/sign.ts builds them (credential: id, rawId, type, response).
    expect(wellFormed("/world", {})).toBe(true);
    expect(wellFormed("/passkey", { token: "t", credential: { id, rawId: id, type: "public-key", response: { clientDataJSON: "eyJ9", attestationObject: "o2Nm" } } })).toBe(true);
    expect(wellFormed("/sign", { token: "t", proposal_id: "T-0002", canonical: "{}", credential: { id, rawId: id, type: "public-key", response: { clientDataJSON: "eyJ9", authenticatorData: "AA", signature: "MEU" } } })).toBe(true);
    expect(wellFormed("/admin", {})).toBe(false);
  });

  it("caps every body at 16 KiB and every address at its requests a minute, on each endpoint", async () => {
    for (const sub of ["world", "passkey", "sign"]) {
      expect({ sub, status: (await call(desk().d, sub, { token: "x".repeat(17_000) })).status }).toEqual({ sub, status: 413 });
      const { d } = desk();
      for (let i = 0; i < TRY_SIGN_PER_MINUTE; i++) await call(d, sub, {}, { ip: "192.0.2.50" });
      expect({ sub, status: (await call(d, sub, {}, { ip: "192.0.2.50" })).status }).toEqual({ sub, status: 429 });
    }
  });

  it("fuzz: whatever JSON arrives, the answer is JSON, never a 5xx, never a stack, path or exception name", async () => {
    const { d } = desk();
    const w = await newWorld(d);
    let n = 0;
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("world", "passkey", "sign"),
      fc.oneof(
        fc.jsonValue(),
        fc.record({ token: fc.oneof(fc.constant(w.world.token), fc.string()), proposal_id: fc.oneof(fc.constant("T-0002"), fc.jsonValue()), canonical: fc.jsonValue(), credential: fc.jsonValue() }, { requiredKeys: [] }),
        fc.record({ token: fc.constant(w.world.token), credential: fc.record({ id: fc.base64String(), response: fc.dictionary(fc.constantFrom("clientDataJSON", "attestationObject", "authenticatorData", "signature"), fc.oneof(fc.base64String(), fc.jsonValue())) }) }),
      ),
      async (sub, body) => {
        const res = await call(d, sub, body, { ip: `10.${(++n >> 8) & 255}.${n & 255}.1` });
        const text = await res.text();
        expect(res.status).toBeLessThan(500);
        expect(res.headers.get("content-type")).toMatch(/^application\/json/);
        expect(() => JSON.parse(text) as unknown).not.toThrow();
        expect(text).not.toMatch(INTERNAL);
      },
    ), { numRuns: 300, seed: 6112026 });
  });

  it("an internal failure answers a fixed 500 with no exception text, stack or path, and never throws to the Worker", async () => {
    const db = new Database(":memory:");
    const base = sqlOver(db);
    let broken = false;
    const d = new TrySignDesk({ exec(q, ...b) {
      if (broken && q.startsWith("SELECT id, canonical")) throw new Error("SqliteError: no such table ts_proposals at /home/user/worker/src/trySign.ts:315:12");
      return base.exec(q, ...b);
    } }, { now: () => t0 });
    const w = await newWorld(d);
    broken = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call(d, "sign", { token: w.world.token, proposal_id: "T-0002", canonical: "{}", credential: { id: "abc", response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" } } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "the test world could not answer this; nothing was signed or run. Try again" });
    expect(text).not.toMatch(INTERNAL);
    // The log says what kind of error it was, never its text.
    expect(err).toHaveBeenCalledWith("try-sign: unexpected error", "Error");
  });
});
