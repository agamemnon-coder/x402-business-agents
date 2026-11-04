// /try/sign (TRY_SIGN_ENABLED): a visitor's own test world, their own passkey, a signature the Worker verifies with
// the D20 verifier. The red team: a replay, a passkey from another world, a signature on a proposal a rule blocks,
// changed terms, an expired world, a wrong origin or RP id, no user verification; and the abuse limits. Signatures
// come from a software authenticator (src/redteam/authenticator.ts).
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jcs } from "@metalntwx/metal-pay/mandates";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import {
  canonical, FIXED_PROPOSALS, TRY_SIGN_ALL_PER_MINUTE, TRY_SIGN_MAX_WORLDS, TRY_SIGN_PER_MINUTE, TRY_SIGN_TTL_MS, TRY_SIGN_WORLDS_PER_HOUR, readCbor, trySignRoute,
} from "../worker/src/trySign.js";

import { BASE, call, challengeOf, desk, newWorld, RP, signBody, t0, withPasskey } from "./support/trySign.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const count = (db: Database.Database, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

afterEach(() => { vi.restoreAllMocks(); });

describe("/try/sign: the visitor's test world", () => {
  it("opens a world with two fixed proposals: one a rule blocks, one waiting for a person; terms hashed as the real approvals", async () => {
    const { d } = desk();
    const w = await newWorld(d);
    expect(w.world.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(w.world.expires_at) - t0.getTime()).toBe(TRY_SIGN_TTL_MS);
    expect(w.proposals.map((p) => [p.proposal_id, p.check, p.status])).toEqual([["T-0001", "fail", "blocked"], ["T-0002", "pass", "waiting"]]);
    expect(w.proposals[0]!.rule).toBe("Reserve floor: the balance may not go below EUR 25,000.00; after this payment it would be EUR 23,500.00.");
    for (const p of w.proposals) {
      const terms = JSON.parse(p.canonical) as Record<string, string>;
      // The same canonical JSON (RFC 8785) the real terms use, and the hash is its SHA-256.
      expect(p.canonical).toBe(jcs(terms));
      expect(p.terms_sha256).toBe(sha(p.canonical));
      expect(terms).toMatchObject({ schema: "kit11.try-terms/v1", test_world: w.world.id, nothing_real_moves: true, expires_at: w.world.expires_at });
    }
    // The agent's words are fixed text, the same for everyone.
    expect(FIXED_PROPOSALS.map((p) => p.says).every((s) => s.length > 20)).toBe(true);
  });

  it("asks for a passkey with user verification required, a random user id, no name or e-mail, and any authenticator", async () => {
    const { d } = desk();
    const [one, two] = [await newWorld(d), await newWorld(d)];
    const o = one.passkey_options;
    expect(o.authenticatorSelection).toEqual({ residentKey: "discouraged", userVerification: "required" });
    expect(o.authenticatorSelection).not.toHaveProperty("authenticatorAttachment");
    expect(o.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(o.rp).toEqual({ id: RP, name: "Purser test world" });
    expect(o.user.name).toBe("Purser test passkey");
    expect(o.user.name).not.toMatch(/@/);
    expect(Buffer.from(o.user.id, "base64url")).toHaveLength(16);
    expect(o.user.id).not.toBe(two.passkey_options.user.id);
    expect(o.challenge).not.toBe(two.passkey_options.challenge);
  });

  it("signs (b): verified by the server with the D20 verifier, executed by the stand-in in this world only", async () => {
    const { d, db } = desk();
    const { w, auth, b } = await withPasskey(d);
    const res = await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(res.status).toBe(200);
    const out = (await res.json()) as { verified: boolean; terms_sha256: string; executed: { id: string; amount: string; balance_after: string; by: string } };
    expect(out).toMatchObject({ verified: true, terms_sha256: b.terms_sha256, executed: { amount: "1850.00", balance_after: "28150.00" } });
    expect(out.executed.id).toMatch(/^test-[0-9a-f]{12}$/);
    expect(out.executed.by).toMatch(/stand-in.*no Airwallex or Metal call/);
    expect(db.prepare("SELECT status FROM ts_proposals WHERE id = 'T-0002'").get()).toEqual({ status: "executed" });
  });

  it("red team, tamper: the same signature with the amount changed by 0.01 is refused by the verifier", async () => {
    const { d, db } = desk();
    const { w, auth, b } = await withPasskey(d);
    const assertion = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    expect((await call(d, "sign", signBody(w.world.token, b, assertion))).status).toBe(200);
    const changed = canonical({ ...(JSON.parse(b.canonical) as Record<string, string>), amount: "1850.01" });
    const res = await call(d, "sign", signBody(w.world.token, b, assertion, changed));
    expect(res.status).toBe(400);
    const out = (await res.json()) as { verified: boolean; why: string; error: string; terms_sha256: string; signed_sha256: string };
    expect(out).toMatchObject({ verified: false, why: "challenge", terms_sha256: sha(changed), signed_sha256: b.terms_sha256 });
    expect(out.error).toContain(`hash ${b.terms_sha256.slice(0, 12)}`);
    // And before it was signed: tampered terms never run, however they are sent.
    const fresh = await withPasskey(d);
    const tampered = canonical({ ...(JSON.parse(fresh.b.canonical) as Record<string, string>), amount: "1850.01" });
    const r2 = await call(d, "sign", signBody(fresh.w.world.token, fresh.b, fresh.auth.sign({ challenge: challengeOf(fresh.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 }), tampered));
    expect(r2.status).toBe(400);
    // Signed over the tampered terms themselves: the signature verifies, but they are not the proposal's terms.
    const r3 = await call(d, "sign", signBody(fresh.w.world.token, fresh.b, fresh.auth.sign({ challenge: challengeOf(sha(tampered)), origin: BASE, rpId: RP, counter: 2 }), tampered));
    expect(r3.status).toBe(409);
    expect(await r3.json()).toMatchObject({ verified: false, why: "terms" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ts_proposals WHERE status = 'executed'").get()).toEqual({ n: 1 });
  });

  it("red team, replay: a signature that ran once runs nothing again (counter or not)", async () => {
    const { d, db } = desk();
    const { w, auth, b } = await withPasskey(d);
    const once = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 5 });
    expect((await call(d, "sign", signBody(w.world.token, b, once))).status).toBe(200);
    const again = await call(d, "sign", signBody(w.world.token, b, once));
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ verified: false, why: "counter" });
    // An authenticator that keeps no counter (iCloud passkeys: 0 and 0): the proposal ran, so the replay is refused.
    const icloud = await withPasskey(d);
    const zero = icloud.auth.sign({ challenge: challengeOf(icloud.b.terms_sha256), origin: BASE, rpId: RP, counter: 0 });
    expect((await call(d, "sign", signBody(icloud.w.world.token, icloud.b, zero))).status).toBe(200);
    const r = await call(d, "sign", signBody(icloud.w.world.token, icloud.b, zero));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ why: "replay" });
    // Two at once: only one runs.
    const race = await withPasskey(d);
    const s = race.auth.sign({ challenge: challengeOf(race.b.terms_sha256), origin: BASE, rpId: RP, counter: 0 });
    const both = await Promise.all([call(d, "sign", signBody(race.w.world.token, race.b, s)), call(d, "sign", signBody(race.w.world.token, race.b, s))]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(db.prepare("SELECT balance FROM ts_worlds WHERE id = ?").get(race.w.world.id)).toEqual({ balance: "28150.00" });
  });

  it("red team, a passkey from another world: refused, whatever it signs", async () => {
    const { d } = desk();
    const A = await withPasskey(d);
    const B = await withPasskey(d);
    // B's passkey signs A's exact hash and sends it to A's world.
    const r1 = await call(d, "sign", signBody(A.w.world.token, A.b, B.auth.sign({ challenge: challengeOf(A.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(r1.status).toBe(403);
    expect(await r1.json()).toMatchObject({ verified: false, why: "unknown passkey" });
    // B's own valid signature over B's proposal, sent to A's world.
    const r2 = await call(d, "sign", signBody(A.w.world.token, B.b, B.auth.sign({ challenge: challengeOf(B.b.terms_sha256), origin: BASE, rpId: RP, counter: 2 })));
    expect(r2.status).toBe(403);
    // A's passkey signs B's terms (bound to B's world id) and sends them as A's proposal: not A's terms.
    expect(A.b.terms_sha256).not.toBe(B.b.terms_sha256);
    const r3 = await call(d, "sign", signBody(A.w.world.token, A.b, A.auth.sign({ challenge: challengeOf(B.b.terms_sha256), origin: BASE, rpId: RP, counter: 3 }), B.b.canonical));
    expect(r3.status).toBe(409);
    expect(await r3.json()).toMatchObject({ why: "terms" });
  });

  it("red team, signing the proposal a rule blocks: no signature runs it, not even a valid one over its exact hash", async () => {
    const { d, db } = desk();
    const { w, auth, a } = await withPasskey(d);
    const res = await call(d, "sign", signBody(w.world.token, a, auth.sign({ challenge: challengeOf(a.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(res.status).toBe(409);
    const out = (await res.json()) as { blocked: boolean; rule: string; verified: boolean };
    expect(out).toMatchObject({ blocked: true, verified: false });
    expect(out.rule).toMatch(/Reserve floor/);
    expect(db.prepare("SELECT status, execution FROM ts_proposals WHERE id = 'T-0001'").get()).toEqual({ status: "blocked", execution: null });
    expect(db.prepare("SELECT balance FROM ts_worlds").get()).toEqual({ balance: "30000.00" });
  });

  it("red team, an expired world: after one hour it answers nothing and is deleted with its passkey and proposals", async () => {
    const { d, db, at } = desk();
    const { w, auth, b } = await withPasskey(d);
    const assertion = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    at(new Date(t0.getTime() + TRY_SIGN_TTL_MS));
    const res = await call(d, "sign", signBody(w.world.token, b, assertion));
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ expired: true });
    expect([count(db, "ts_worlds"), count(db, "ts_creds"), count(db, "ts_proposals")]).toEqual([0, 0, 0]);
    expect((await call(d, "passkey", { token: w.world.token, credential: auth.register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) })).status).toBe(410);
  });

  it("red team, wrong origin or RP id, or no user verification: refused at the passkey and at the signature", async () => {
    const { d } = desk();
    for (const [bad, why] of [[{ origin: "https://evil.example" }, "origin"], [{ rpId: "evil.example" }, "rp id"], [{ userVerified: false }, "user verification"]] as const) {
      const w = await newWorld(d);
      const res = await call(d, "passkey", { token: w.world.token, credential: new FakeAuthenticator().register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP, ...bad }) });
      expect({ bad, status: res.status, why: ((await res.json()) as { why: string }).why }).toEqual({ bad, status: 400, why });
    }
    for (const [bad, why] of [[{ origin: "https://evil.example" }, "origin"], [{ rpId: "evil.example" }, "rp id"], [{ userVerified: false }, "user verification"]] as const) {
      const { w, auth, b } = await withPasskey(d);
      const res = await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1, ...bad })));
      expect({ bad, status: res.status, why: ((await res.json()) as { why: string }).why }).toEqual({ bad, status: 400, why });
    }
    // Another site's page, or no Origin at all, gets nothing.
    expect((await call(d, "world", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(d, "world", {}, { origin: null })).status).toBe(403);
  });

  it("takes one passkey per world: the registration challenge is used once", async () => {
    const { d } = desk();
    const { w } = await withPasskey(d);
    const res = await call(d, "passkey", { token: w.world.token, credential: new FakeAuthenticator().register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) });
    expect(res.status).toBe(409);
    // A world with a refused passkey cannot try again with the same challenge either.
    const w2 = await newWorld(d);
    expect((await call(d, "passkey", { token: w2.world.token, credential: new FakeAuthenticator().register({ challenge: "wrong", origin: BASE, rpId: RP }) })).status).toBe(400);
    expect((await call(d, "passkey", { token: w2.world.token, credential: new FakeAuthenticator().register({ challenge: w2.passkey_options.challenge, origin: BASE, rpId: RP }) })).status).toBe(409);
  });

  it("abuse: worlds per address an hour, live worlds for everyone, requests a minute, body size, methods", async () => {
    const { d, at } = desk();
    for (let i = 0; i < TRY_SIGN_WORLDS_PER_HOUR; i++) expect((await call(d, "world", {}, { ip: "192.0.2.1" })).status).toBe(201);
    expect((await call(d, "world", {}, { ip: "192.0.2.1" })).status).toBe(429);
    // IPv6 counts by its /64.
    for (let i = 0; i < TRY_SIGN_WORLDS_PER_HOUR; i++) expect((await call(d, "world", {}, { ip: `2001:db8::${i + 1}` })).status).toBe(201);
    expect((await call(d, "world", {}, { ip: "2001:db8::ffff" })).status).toBe(429);
    at(new Date(t0.getTime() + 61 * 60_000));
    expect((await call(d, "world", {}, { ip: "192.0.2.1" })).status).toBe(201);

    const many = desk();
    for (let i = 0; i < TRY_SIGN_MAX_WORLDS; i++) await call(many.d, "world", {}, { ip: `10.${i >> 8}.${i & 255}.1` });
    expect(count(many.db, "ts_worlds")).toBe(TRY_SIGN_MAX_WORLDS);
    expect((await call(many.d, "world", {}, { ip: "10.200.0.1" })).status).toBe(503);
    // Worlds expire, and then there is room again.
    many.at(new Date(t0.getTime() + TRY_SIGN_TTL_MS + 1));
    expect((await call(many.d, "world", {}, { ip: "10.200.0.1" })).status).toBe(201);

    const busy = desk();
    for (let i = 0; i < TRY_SIGN_PER_MINUTE; i++) await call(busy.d, "sign", {}, { ip: "192.0.2.2" });
    expect((await call(busy.d, "sign", {}, { ip: "192.0.2.2" })).status).toBe(429);
    // Everyone together: past the ceiling a minute, every address waits; a minute later it is open again.
    const crowd = desk();
    for (let i = 0; i < TRY_SIGN_ALL_PER_MINUTE; i++) await call(crowd.d, "sign", {}, { ip: `172.16.${i >> 8}.${i & 255}` });
    expect((await call(crowd.d, "sign", {}, { ip: "172.31.0.1" })).status).toBe(503);
    crowd.at(new Date(t0.getTime() + 61_000));
    expect((await call(crowd.d, "sign", {}, { ip: "172.31.0.1" })).status).toBe(410);
    expect(count(crowd.db, "ts_hits")).toBe(1);
    expect((await call(desk().d, "sign", { token: "x".repeat(20_000) })).status).toBe(413);
    expect((await call(desk().d, "world", {}, { method: "GET" })).status).toBe(405);
    expect((await call(desk().d, "admin", {})).status).toBe(404);
  });

  it("holds no key and calls nothing outside: no fetch during a whole visit", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { d } = desk();
    const { w, auth, b } = await withPasskey(d);
    expect((await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })))).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it("routes: with the feature off in the bundle every path is a 404; on, only its own paths go to its desk", () => {
    expect(trySignRoute("/api/try-sign/world", {})).toBe("not-found");
    expect(trySignRoute("/api/try-sign", {})).toBe("not-found");
    expect(trySignRoute("/api/try-sign/world", { trySign: "<html>" })).toBe("desk");
    expect(trySignRoute("/api/try", { trySign: "<html>" })).toBeNull();
    expect(trySignRoute("/api/try-signx", { trySign: "<html>" })).toBeNull();
    expect(trySignRoute("/api/approvals", { trySign: "<html>" })).toBeNull();
  });

  it("reads CBOR as WebAuthn needs and refuses what it does not know", () => {
    expect(readCbor(Uint8Array.from([0xa1, 0x01, 0x02])).v).toEqual(new Map([[1, 2]]));
    expect(readCbor(Uint8Array.from([0x26])).v).toBe(-7);
    expect(() => readCbor(Uint8Array.from([0x5a, 0, 0, 0, 9, 1]))).toThrow(/truncated/);
    expect(() => readCbor(Uint8Array.from([0xfb, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow();
    expect(() => canonical({ amount: 1 as unknown as string })).toThrow(/no numbers/);
  });
});
