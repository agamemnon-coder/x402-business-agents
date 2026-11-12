// SPIKE probe 3: the cryptography the engine uses synchronously, and the engine's own WebAuthn checks
// (src/passkey/webauthn.ts) on a software passkey, inside workerd.
import { DurableObject } from "cloudflare:workers";
import { createHash, createHmac, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, timingSafeEqual, verify } from "node:crypto";
import fx from "../fixtures/passkey.json";
import { sha256Hex, termsHash, rejectionSha256, TERMS_SCHEMA } from "../../../src/lib/terms.js";
import { assertionSha256, challengeFor, verifyApprovalSignature, verifyEnrolmentResponse } from "../../../src/passkey/webauthn.js";
import type { EnrolmentWindow, PasskeyRow } from "../../../src/passkey/ledger.js";
import { FakeAuthenticator } from "../../../src/redteam/authenticator.js";
import { attempt, json } from "./_util.js";

export class Engine extends DurableObject {}

export default {
  async fetch(): Promise<Response> {
    const out: Record<string, unknown> = {};
    // Known answers (FIPS 180-2 "abc"; RFC 4231 test case 2).
    out.createHash_sha256 = await attempt(() => createHash("sha256").update("abc").digest("hex") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    out.createHmac_sha256 = await attempt(() => createHmac("sha256", "Jefe").update("what do ya want for nothing?").digest("hex") === "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    out.randomUUID = await attempt(() => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(randomUUID()) && randomUUID() !== randomUUID());
    out.randomBytes = await attempt(() => randomBytes(32).length === 32 && randomBytes(16).toString("base64url").length === 22);
    out.timingSafeEqual = await attempt(() => {
      const same = timingSafeEqual(Buffer.from("a".repeat(32)), Buffer.from("a".repeat(32))), differ = timingSafeEqual(Buffer.from("a".repeat(32)), Buffer.from("b".repeat(32)));
      let lengthThrows = false;
      try { timingSafeEqual(Buffer.from("a"), Buffer.from("ab")); } catch { lengthThrows = true; }
      return same === true && differ === false && lengthThrows;
    });
    // The engine's own hashing of terms (JCS from @metalntwx/metal-pay + node:crypto), synchronous.
    out.engine_termsHash = await attempt(() => {
      const h = termsHash({ schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0001", expires_at: "2026-11-12T10:00:00.000Z", amount: "4.84", currency: "EUR" });
      return { hash: h, isHex64: /^[0-9a-f]{64}$/.test(h), sha256Hex_abc: sha256Hex("abc").startsWith("ba7816bf"), rejection: rejectionSha256(h).length === 64 };
    });
    // Synchronous P-256 key generation, signing and verifying (what the software passkey and offline re-verification use).
    out.ecdsa_p256_sync = await attempt(() => {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const data = Buffer.from("purser");
      const sig = sign("sha256", data, privateKey);
      const jwk = publicKey.export({ format: "jwk" });
      const again = createPublicKey({ key: jwk, format: "jwk" });
      return { verifies: verify("sha256", data, again, sig), tamperRefused: !verify("sha256", Buffer.from("pursex"), again, sig), spki: publicKey.export({ type: "spki", format: "der" }).length };
    });

    // The engine's WebAuthn checks on what Node's software passkey produced (fixtures/passkey.json).
    const pk = fx.pk as PasskeyRow;
    out.verifyEnrolmentResponse_node_fixture = await attempt(async () => {
      const r = await verifyEnrolmentResponse(fx.registration as never, fx.window as EnrolmentWindow);
      return r.ok ? { ok: true, samePublicKeyAsNode: r.publicKey === pk.public_key, sameCredentialId: r.credentialId === pk.credential_id } : r;
    });
    out.verifyApprovalSignature_node_fixture = await attempt(() => verifyApprovalSignature(fx.assertion as never, fx.termsSha, pk));
    out.node_verdict_was = fx.nodeVerdict;
    out.assertionSha256 = await attempt(() => assertionSha256(fx.assertion as never).length === 64);
    // Refusals must still refuse here: other terms, another origin, a changed signature.
    out.refuses_other_terms = await attempt(async () => (await verifyApprovalSignature(fx.assertion as never, sha256Hex("other terms"), pk)));
    out.refuses_other_origin = await attempt(async () => (await verifyApprovalSignature(fx.assertion as never, fx.termsSha, { ...pk, origin: "https://evil.example" })));
    out.refuses_replayed_counter = await attempt(async () => (await verifyApprovalSignature(fx.assertion as never, fx.termsSha, { ...pk, counter: 5 })));

    // The whole ceremony made here: a software passkey created in workerd, enrolled and approving, all by engine code.
    out.ceremony_inside_workerd = await attempt(async () => {
      const phone = new FakeAuthenticator();
      const window = { ...(fx.window as EnrolmentWindow), challenge: randomBytes(32).toString("base64url") };
      const reg = phone.register({ challenge: window.challenge, origin: window.origin, rpId: window.rp_id });
      const enrolled = await verifyEnrolmentResponse(reg, window);
      if (!enrolled.ok) return enrolled;
      const row: PasskeyRow = { ...pk, credential_id: enrolled.credentialId, public_key: enrolled.publicKey, counter: enrolled.counter, transports: JSON.stringify(enrolled.transports), registration_json: JSON.stringify(reg) };
      const terms = sha256Hex(`terms ${randomUUID()}`);
      const t = performance.now();
      const approved = await verifyApprovalSignature(phone.sign({ challenge: challengeFor(terms), origin: row.origin, rpId: row.rp_id, counter: 1 }), terms, row);
      const tampered = await verifyApprovalSignature(phone.sign({ challenge: challengeFor(terms), origin: row.origin, rpId: row.rp_id, counter: 1 }), sha256Hex("changed"), row);
      return { enrolled: enrolled.ok, approved, tampered, verify_ms: Math.round(performance.now() - t) };
    });
    const ok = Object.entries(out).filter(([k]) => !k.startsWith("refuses_") && k !== "node_verdict_was").every(([, v]) => (v as { ok: boolean }).ok);
    return json({ ok, ...out });
  },
};
