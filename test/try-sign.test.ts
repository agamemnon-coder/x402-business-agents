// /try/sign (TRY_SIGN_ENABLED): a visitor's own test world, their own passkey, a signature the Worker verifies with
// the D20 verifier. The red team: a replay, a passkey from another world, a signature on a proposal a rule blocks,
// changed terms, an expired world, a wrong origin or RP id, no user verification; and the abuse limits. Signatures
// come from a software authenticator (src/redteam/authenticator.ts).
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jcs } from "@metalntwx/metal-pay/mandates";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import {
  canonical, FIXED_PROPOSALS, TRY_SIGN_ALL_PER_MINUTE, TRY_SIGN_MAX_WORLDS, TRY_SIGN_NET_PER_MINUTE, TRY_SIGN_PER_MINUTE, TRY_SIGN_TTL_MS, TRY_SIGN_UNCLAIMED_MS, TRY_SIGN_WORLDS_PER_HOUR, TRY_SIGN_WORLDS_PER_NETWORK_HOUR, TrySignDesk, networkKey, readCbor, trySignRoute,
} from "../worker/src/trySign.js";

import { BASE, call, challengeOf, desk, newWorld, RP, signBody, sqlOver, t0, withPasskey } from "./support/trySign.js";

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
      expect(terms).toMatchObject({ schema: "kit11.try-terms/v2", test_world: w.world.id, nothing_real_moves: true, expires_at: w.world.expires_at });
    }
    // The payee's IBAN is in the terms (v2), and it is a test one: check digits 00, which ISO 13616's mod 97 never gives.
    for (const p of w.proposals) {
      const iban = (JSON.parse(p.canonical) as { payee_iban: string }).payee_iban;
      expect(iban).toMatch(/^DE00\d{18}$/);
      const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
      expect(BigInt(digits) % 97n).not.toBe(1n);
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

  it("abuse: worlds per address and per network an hour, requests a minute, body size, methods", async () => {
    const { d, at } = desk();
    for (let i = 0; i < TRY_SIGN_WORLDS_PER_HOUR; i++) expect((await call(d, "world", {}, { ip: "192.0.2.1" })).status).toBe(201);
    expect((await call(d, "world", {}, { ip: "192.0.2.1" })).status).toBe(429);
    // IPv6 counts by its /64.
    for (let i = 0; i < TRY_SIGN_WORLDS_PER_HOUR; i++) expect((await call(d, "world", {}, { ip: `2001:db8::${i + 1}` })).status).toBe(201);
    expect((await call(d, "world", {}, { ip: "2001:db8::ffff" })).status).toBe(429);
    at(new Date(t0.getTime() + 61 * 60_000));
    expect((await call(d, "world", {}, { ip: "192.0.2.1" })).status).toBe(201);

    // One network (an IPv4 /24, an IPv6 /48) opens at most TRY_SIGN_WORLDS_PER_NETWORK_HOUR worlds an hour.
    const net = desk();
    let made = 0;
    for (let a = 1; a <= 4; a++) for (let i = 0; i < TRY_SIGN_WORLDS_PER_HOUR; i++) if ((await call(net.d, "world", {}, { ip: `2001:db8:7:${a}::1` })).status === 201) made++;
    expect(made).toBe(TRY_SIGN_WORLDS_PER_NETWORK_HOUR);
    expect((await call(net.d, "world", {}, { ip: "2001:db8:8::1" })).status).toBe(201);

    const busy = desk();
    for (let i = 0; i < TRY_SIGN_PER_MINUTE; i++) await call(busy.d, "sign", {}, { ip: "192.0.2.2" });
    expect((await call(busy.d, "sign", {}, { ip: "192.0.2.2" })).status).toBe(429);
    // Everyone together: past the ceiling a minute, every address waits; a minute later it is open again.
    const crowd = desk();
    // Each from its own network (/24), so the per-network limit does not stop them first.
    for (let i = 0; i < TRY_SIGN_ALL_PER_MINUTE; i++) await call(crowd.d, "sign", {}, { ip: `10.${i >> 8}.${i & 255}.1` });
    expect((await call(crowd.d, "sign", {}, { ip: "172.31.0.1" })).status).toBe(503);
    crowd.at(new Date(t0.getTime() + 61_000));
    expect((await call(crowd.d, "sign", {}, { ip: "172.31.0.1" })).status).toBe(410);
    // Only the last request's two counts (its address and its network) are left.
    expect(count(crowd.db, "ts_hits")).toBe(2);
    expect((await call(desk().d, "sign", { token: "x".repeat(20_000) })).status).toBe(413);
    // A body sent without a length (chunked) is counted as it arrives and stopped past the limit.
    const chunks = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(1024).fill(32)); c.close(); } });
    const chunked = new Request(`${BASE}/api/try-sign/sign`, { method: "POST", headers: { origin: BASE, "content-type": "application/json" }, body: chunks, duplex: "half" } as RequestInit);
    expect(chunked.headers.get("content-length")).toBeNull();
    expect((await desk().d.fetch(chunked)).status).toBe(413);
    expect((await call(desk().d, "world", {}, { method: "GET" })).status).toBe(405);
    expect((await call(desk().d, "admin", {})).status).toBe(404);
  });

  it("abuse: a cap on live worlds for everyone, which an idle world gives way to", async () => {
    // Cap on live worlds: when full, the oldest world nobody made a passkey for makes room; when every world has a
    // passkey, a new visitor waits; worlds without a passkey go after ten minutes, the rest after an hour.
    const many = desk();
    for (let i = 0; i < TRY_SIGN_MAX_WORLDS; i++) {
      if (i % 500 === 0) many.at(new Date(t0.getTime() + (i / 500) * 61_000));
      expect((await call(many.d, "world", {}, { ip: `10.${i >> 8}.${i & 255}.1` })).status).toBe(201);
    }
    expect(count(many.db, "ts_worlds")).toBe(TRY_SIGN_MAX_WORLDS);
    const oldest = (many.db.prepare("SELECT id FROM ts_worlds ORDER BY created LIMIT 1").get() as { id: string }).id;
    expect((await call(many.d, "world", {}, { ip: "10.200.0.1" })).status).toBe(201);
    expect(count(many.db, "ts_worlds")).toBe(TRY_SIGN_MAX_WORLDS);
    expect(many.db.prepare("SELECT id FROM ts_worlds WHERE id = ?").get(oldest)).toBeUndefined();
    many.db.prepare("INSERT INTO ts_creds (world, id, x, y, counter) SELECT id, 'c', 'x', 'y', 0 FROM ts_worlds").run();
    expect((await call(many.d, "world", {}, { ip: "10.200.0.2" })).status).toBe(503);
    many.at(new Date(t0.getTime() + TRY_SIGN_TTL_MS + 5 * 61_000));
    expect((await call(many.d, "world", {}, { ip: "10.200.0.1" })).status).toBe(201);
    // Each request deletes at most 500 expired worlds (bounded work); a few requests later only the new one is left.
    for (let i = 0; i < 3; i++) await call(many.d, "sign", {}, { ip: "10.200.0.3" });
    expect(count(many.db, "ts_worlds")).toBe(1);
  }, 60_000);

  it("a world nobody made a passkey for is deleted after ten minutes; one with a passkey lives its hour", async () => {
    const { d, at } = desk();
    const idle = await newWorld(d);
    const used = await withPasskey(d);
    at(new Date(t0.getTime() + TRY_SIGN_UNCLAIMED_MS + 1));
    expect((await call(d, "passkey", { token: idle.world.token, credential: new FakeAuthenticator().register({ challenge: idle.passkey_options.challenge, origin: BASE, rpId: RP }) })).status).toBe(410);
    const res = await call(d, "sign", signBody(used.w.world.token, used.b, used.auth.sign({ challenge: challengeOf(used.b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })));
    expect(res.status).toBe(200);
  });

  it("abuse: one IPv6 /48 cannot fill the ceiling for everyone by itself", async () => {
    // The review's attack: 20 /64s of one /48 at 30 requests a minute each made 600, the ceiling, and locked everyone out.
    const { d } = desk();
    let passed = 0;
    for (let i = 0; i < 20; i++) for (let k = 0; k < TRY_SIGN_PER_MINUTE; k++) if ((await call(d, "sign", {}, { ip: `2001:db8:7:${i.toString(16)}::1` })).status !== 429) passed++;
    expect(passed).toBe(TRY_SIGN_NET_PER_MINUTE);
    expect(TRY_SIGN_NET_PER_MINUTE * 2).toBeLessThan(TRY_SIGN_ALL_PER_MINUTE);
    // Another network is not touched by it.
    expect((await call(d, "world", {}, { ip: "192.0.2.77" })).status).toBe(201);
    // An IPv4 /24 counts as one network too.
    const v4 = desk();
    let ok4 = 0;
    for (let i = 1; i <= 3; i++) for (let k = 0; k < TRY_SIGN_PER_MINUTE; k++) if ((await call(v4.d, "sign", {}, { ip: `198.51.100.${i}` })).status !== 429) ok4++;
    expect(ok4).toBe(TRY_SIGN_NET_PER_MINUTE);
  });

  it("a world that goes while its passkey is checked leaves no passkey row behind", async () => {
    // Stand-in for the race: the world is dropped right after its challenge is used, as an eviction during the await would.
    const db = new Database(":memory:");
    const base = sqlOver(db);
    const d = new TrySignDesk({ exec(q, ...b) {
      const r = base.exec(q, ...b);
      if (q.startsWith("UPDATE ts_worlds SET reg_challenge = NULL")) db.prepare("DELETE FROM ts_worlds WHERE id = ?").run(b[0]);
      return r;
    } }, { now: () => t0 });
    const w = await newWorld(d);
    const res = await call(d, "passkey", { token: w.world.token, credential: new FakeAuthenticator().register({ challenge: w.passkey_options.challenge, origin: BASE, rpId: RP }) });
    expect(res.status).toBe(410);
    expect(count(db, "ts_creds")).toBe(0);
  });

  it("groups addresses by network for the second world limit", () => {
    expect(networkKey("203.0.113.77")).toBe("203.0.113.0/24");
    expect(networkKey("2001:db8:aa:bb:1::2")).toBe("2001:db8:aa::/48");
    expect(networkKey("2001:db8::1")).toBe("2001:db8:0::/48");
    expect(networkKey("unknown")).toBe("unknown");
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
