// The approval key's life in the engine host (review finding 2, 20 Nov): the first key of a company is enrolled as
// before; any key added while one is active needs an active key's signature over the new key's id and public-key hash,
// or the host's word that a second owner co-signed or that the account was recovered by two platform admins. Such a key
// then waits a cooling-off before it approves (72 hours unless the host says otherwise; a /try test company: 0). Every
// refusal is said in plain words and written to the audit log.
import { describe, expect, it } from "vitest";
import { useDocStore, type DocStore } from "../src/ap/docStore.js";
import { openDb, type DB } from "../src/db/open.js";
import { APPROVAL_KEY_COOLING_OFF_MS, EngineHost, endorsementChallenge, parserOnly } from "../src/engine/host.js";
import { bankToText, standInBank } from "../src/engine/standInBank.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const RP = "engine.test";
const ORIGIN = `https://${RP}`;

function memoryDocs(): DocStore {
  const kept = new Map<string, Buffer>();
  return {
    put: (sha, bytes) => { if (!kept.has(`mem:${sha}`)) kept.set(`mem:${sha}`, Buffer.from(bytes)); return `mem:${sha}`; },
    get: (path) => { const b = kept.get(path); if (!b) throw new Error(`no document at ${path}`); return b; },
  };
}

interface World { db: DB; host: EngineHost; clock: { now: Date }; owner: FakeAuthenticator }

function world(): World {
  const db = openDb(":memory:");
  useDocStore(db, memoryDocs());
  const store = { text: null as string | null, load() { return this.text; }, save(text: string) { this.text = text; } };
  const bank = standInBank(store);
  const clock = { now: new Date("2026-11-10T09:00:00Z") };
  const host = new EngineHost({ db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: () => store.save(bankToText(bank)),
    rp: { rpId: RP, origin: ORIGIN }, company: { name: "Key Life Co", lang: "en" }, vault: null, feed: null, now: () => clock.now });
  return { db, host, clock, owner: new FakeAuthenticator() };
}

const audits = (db: DB, event: string) => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { subject: string | null; payload_json: string }[];
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM passkeys WHERE credential_id = ?").get(id) as { status: string } | undefined)?.status ?? null;

/** The first key, as a new company enrols it. */
async function firstKey(w: World) {
  const s = await w.host.passkeyStart();
  const out = await w.host.passkeyFinish({ code: s.code, credential: w.owner.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }), label: "Owner", person: "u_owner" });
  if (!out.ok) throw new Error(out.reason);
  return out;
}

/** A filed payment waiting for its approval. */
async function waiting(w: World) {
  await w.host.seed();
  const up = await w.host.upload({ bytes: await pdfOf(EN), filename: "bergtex.pdf" });
  const p = await w.host.propose(up.invoice!.id);
  if (!p.ok) throw new Error(p.reason);
  return p.proposal;
}

const approveWith = (w: World, phone: FakeAuthenticator, p: { id: string; terms_sha256: string; challenge: string }, counter = 1) =>
  w.host.approve({ proposal_id: p.id, terms_sha256: p.terms_sha256, credential: phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter }) });

describe("the first approval key of a company", () => {
  it("is enrolled as before: no endorsement, no cooling-off, and it approves at once", async () => {
    const w = world();
    const out = await firstKey(w);
    expect(out).toMatchObject({ ok: true, credential_id: w.owner.credentialId, how: "first", cooling_until: null });
    const p = await waiting(w);
    expect((await approveWith(w, w.owner, p)).status).toBe("approved");
  });
});

describe("a key added while one is active", () => {
  it("without an endorsement is not enrolled: the answer names the challenge an active key must sign, and the audit log has it", async () => {
    const w = world();
    await firstKey(w);
    const cfo = new FakeAuthenticator();
    const s = await w.host.passkeyStart();
    expect(s.exclude).toEqual([w.owner.credentialId]);
    const reg = cfo.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP });
    const out = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "CFO", person: "u_cfo" });
    expect(out).toMatchObject({ ok: false, code: "endorsement_required" });
    if (out.ok) throw new Error("enrolled");
    expect(out.reason).toMatch(/already active/);
    expect(out.endorse).toEqual({ credential_id: cfo.credentialId, spki_sha256: cfo.spkiSha256, challenge: endorsementChallenge(cfo.credentialId, cfo.spkiSha256), keys: [w.owner.credentialId] });
    expect(status(w.db, cfo.credentialId)).toBeNull();
    expect(audits(w.db, "passkey.endorsement_required").map((r) => r.subject)).toEqual([cfo.credentialId]);
  });

  it("endorsed by the active key is enrolled, then refused for its cooling-off (audited, in plain words), and approves once it is over", async () => {
    const w = world();
    await firstKey(w);
    const cfo = new FakeAuthenticator();
    const s = await w.host.passkeyStart();
    const reg = cfo.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP });
    const endorsement = w.owner.sign({ challenge: endorsementChallenge(cfo.credentialId, cfo.spkiSha256), origin: ORIGIN, rpId: RP, counter: 1 });
    const t0 = w.clock.now.getTime();
    const out = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "CFO", person: "u_cfo", endorsement, coolingOffMs: 60_000 });
    expect(out).toMatchObject({ ok: true, credential_id: cfo.credentialId, how: "endorsed", cooling_until: new Date(t0 + 60_000).toISOString() });
    // Another person's key: the owner's stays.
    expect(status(w.db, w.owner.credentialId)).toBe("ACTIVE");
    expect(JSON.parse(audits(w.db, "passkey.key_authorised").at(-1)!.payload_json)).toMatchObject({ how: "endorsed", by: w.owner.credentialId.slice(0, 8), cooling_until: new Date(t0 + 60_000).toISOString() });

    const p = await waiting(w);
    const refused = await approveWith(w, cfo, p);
    expect(refused).toMatchObject({ status: "refused", code: "cooling_off", settled: null, cooling_until: new Date(t0 + 60_000).toISOString() });
    expect(refused.message).toMatch(/cooling-off/);
    expect(refused.message).toMatch(/Nothing was paid\.$/);
    expect(w.host.proposal(p.id)!.status).toBe("PENDING_APPROVAL");
    expect(audits(w.db, "passkey.cooling_off_refused").map((r) => r.subject)).toEqual([p.id]);
    // The status says which keys are cooling off, whose they are and until when.
    const keys = (await w.host.status()).passkeys;
    expect(keys).toHaveLength(2);
    expect(keys).toEqual(expect.arrayContaining([
      { credential_id: w.owner.credentialId, label: "Owner", person: "u_owner", how: "first", cooling_until: null },
      { credential_id: cfo.credentialId, label: "CFO", person: "u_cfo", how: "endorsed", cooling_until: new Date(t0 + 60_000).toISOString() },
    ]));

    w.clock.now = new Date(t0 + 61_000);
    expect((await approveWith(w, cfo, p, 2)).status).toBe("approved");
  });

  it("defaults to a 72-hour cooling-off", async () => {
    expect(APPROVAL_KEY_COOLING_OFF_MS).toBe(72 * 3_600_000);
    const w = world();
    await firstKey(w);
    const next = new FakeAuthenticator();
    const s = await w.host.passkeyStart();
    const out = await w.host.passkeyFinish({ code: s.code, credential: next.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }), label: "Owner", person: "u_owner",
      endorsement: w.owner.sign({ challenge: endorsementChallenge(next.credentialId, next.spkiSha256), origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(out).toMatchObject({ ok: true, how: "endorsed", cooling_until: new Date(w.clock.now.getTime() + 72 * 3_600_000).toISOString() });
    // The same person's new key replaced the old one: the old one approves no more, the new one not yet.
    expect(status(w.db, w.owner.credentialId)).toBe("REVOKED");
    const p = await waiting(w);
    expect((await approveWith(w, next, p)).code).toBe("cooling_off");
  });

  it("refuses an endorsement over another key, by an unknown key, or by a key still cooling off; each refusal is audited", async () => {
    const w = world();
    await firstKey(w);
    const cfo = new FakeAuthenticator(), other = new FakeAuthenticator(), stranger = new FakeAuthenticator();
    let s = await w.host.passkeyStart();
    let reg = cfo.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP });
    // Signed over another key's id and public-key hash.
    const wrong = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "CFO", person: "u_cfo", endorsement: w.owner.sign({ challenge: endorsementChallenge(other.credentialId, other.spkiSha256), origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(wrong).toMatchObject({ ok: false, code: "endorsement_refused" });
    // By a key that is not an approval key of this company.
    const unknown = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "CFO", person: "u_cfo", endorsement: stranger.sign({ challenge: endorsementChallenge(cfo.credentialId, cfo.spkiSha256), origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(unknown).toMatchObject({ ok: false, code: "endorsement_refused" });
    // A second owner's co-signature the host checked and refused: refused here too, and audited.
    const cosign = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "CFO", person: "u_cfo", cosignRefused: "a co-signature must come from another owner of this company." });
    expect(cosign).toMatchObject({ ok: false, code: "endorsement_refused", reason: "a co-signature must come from another owner of this company. The new key was not enrolled." });
    expect(status(w.db, cfo.credentialId)).toBeNull();
    expect(audits(w.db, "passkey.endorsement_refused")).toHaveLength(3);
    // The host's word that a second owner co-signed: enrolled, cooling off.
    const ok = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "CFO", person: "u_cfo", cosigned: { by: "u_owner2" } });
    expect(ok).toMatchObject({ ok: true, how: "cosigned" });
    // That key, still cooling off, cannot vouch for the next one.
    s = await w.host.passkeyStart();
    reg = other.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP });
    const vouch = await w.host.passkeyFinish({ code: s.code, credential: reg, label: "Accountant", person: "u_acc", endorsement: cfo.sign({ challenge: endorsementChallenge(other.credentialId, other.spkiSha256), origin: ORIGIN, rpId: RP, counter: 1 }) });
    expect(vouch).toMatchObject({ ok: false, code: "endorsement_refused" });
    if (vouch.ok) throw new Error("enrolled");
    expect(vouch.reason).toMatch(/cooling-off/);
  });

  it("after an account recovery (the host's word): enrolled, and cooling off", async () => {
    const w = world();
    await firstKey(w);
    const next = new FakeAuthenticator();
    const s = await w.host.passkeyStart();
    const out = await w.host.passkeyFinish({ code: s.code, credential: next.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }), label: "Owner", person: "u_owner", recovered: { by: "ops-a, ops-b" } });
    expect(out).toMatchObject({ ok: true, how: "recovery", cooling_until: expect.any(String) as string });
  });

  it("with a cooling-off of 0 (a /try test company) approves at once", async () => {
    const w = world();
    await firstKey(w);
    const next = new FakeAuthenticator();
    const s = await w.host.passkeyStart();
    const out = await w.host.passkeyFinish({ code: s.code, credential: next.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }), label: "Owner", person: "u_owner", cosigned: { by: "u_2" }, coolingOffMs: 0 });
    expect(out).toMatchObject({ ok: true, how: "cosigned", cooling_until: null });
    const p = await waiting(w);
    expect((await approveWith(w, next, p)).status).toBe("approved");
  });
});
