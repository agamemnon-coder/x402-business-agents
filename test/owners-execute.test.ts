// Block 1 with the phone's own passkey: an owners_execute proposal is approved by the account's Execute digest, signed
// by the CFO's and the controller's passkeys, which are the account's only owners. Breaks if a passkey approval of the
// terms hash (not the digest) counts, if a digest that does not follow from the terms is signed, if a passkey that is
// not an owner counts, if one person counts twice, or if the quorum built from the two approvals would not verify.
// Software authenticators (the WebAuthn format a phone produces).
import { createHash, createPublicKey, verify } from "node:crypto";
import { decodeAbiParameters, parseAbiParameters, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { openDb, type DB } from "../src/db/open.js";
import { termsHash } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor, reverifyPasskeyApprovals } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { approvalHashOf, coseP256, ownersExecuteTerms, quorumOf, type OwnersExecuteTerms } from "../src/metal/ownersExecute.js";
import { passkeySigner } from "../src/metal/passkeyOwner.js";
import { executeOwnersExecute, signedCallOf } from "../src/executors/ownersExecute.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-11-01T10:00:00Z");
const VERIFIER = "0xd4c84c2bea087053691623bc463da61b528755ab" as Address;
const ACCOUNT = "0x44aF42d8f16981932Aa6CEC7668b8FAeF3f037e8" as Address;
let tickets = 0;
const item = (body: unknown, id: string): InboxItem => ({ ticket: `t-${++tickets}`, kind: "assertion", proposal_id: id, body: JSON.stringify(body), received_at: t0.toISOString() });

async function enrol(db: DB, label: string, add: boolean) {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, ...(add ? { addPerson: label } : {}) }, t0);
  await processRegistration(db, { ticket: `r-${++tickets}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), received_at: t0.toISOString() }, { label }, t0);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), t0);
  return auth;
}
const pkOf = (db: DB, id: string) => (db.prepare("SELECT public_key FROM passkeys WHERE credential_id = ?").get(id) as { public_key: string }).public_key;

async function world() {
  const db = openDb(":memory:");
  const max = await enrol(db, "max", false);
  const anna = await enrol(db, "anna", true);
  const eve = await enrol(db, "eve", true); // enrolled in Purser, but not an owner of the account
  const terms = ownersExecuteTerms({
    proposal_id: "P-0001", expires_at: "2026-11-01T10:15:00Z", account: ACCOUNT, chain_id: "63825",
    owners: [passkeySigner(VERIFIER, coseP256(pkOf(db, max.credentialId))), passkeySigner(VERIFIER, coseP256(pkOf(db, anna.credentialId)))],
    calls: [{ target: ACCOUNT, value: "0", call_data: "0x12345678" }], nonce: String((123n << 64n) | 0n), valid_until: String(Math.floor(Date.parse("2026-11-01T10:16:00Z") / 1000)),
    action: { what: "bind", agent: "sourcing", cap: "0.05", budget: "0.50", payee: "0x000000000000000000000000000000000000dEaD", payee_name: "Stockline", mandate: `0x${"ab".repeat(32)}` },
  });
  createProposal(db, { terms, createdBy: "treasury" }, t0);
  return { db, max, anna, eve, terms, digest: approvalHashOf({ kind: terms.kind, terms_json: JSON.stringify(terms), terms_sha256: termsHash(terms) }) };
}
const send = (db: DB, auth: FakeAuthenticator, challenge: string, terms: OwnersExecuteTerms, counter = 1) =>
  processAssertion(db, item({ proposal_id: "P-0001", terms_sha256: termsHash(terms), credential: auth.sign({ challenge, origin: ORIGIN, rpId: RP, counter }) }, "P-0001"), t0);
const status = (db: DB) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0001'").get() as { status: string }).status;

describe("an owners_execute proposal, approved by the account's Execute digest", () => {
  it("is approved by both owners' passkeys signing the digest, and needs both", async () => {
    const { db, max, anna, terms, digest } = await world();
    expect(`0x${digest}`).toBe(terms.onchain_digest);
    expect(await send(db, max, challengeFor(digest), terms)).toMatchObject({ status: "cosigned" });
    expect(status(db)).toBe("PENDING_APPROVAL");
    expect(await send(db, anna, challengeFor(digest), terms)).toMatchObject({ status: "approved" });
    expect(status(db)).toBe("APPROVED");
    expect((await reverifyPasskeyApprovals(db)).every((c) => c.ok)).toBe(true);
  });

  it("refuses a passkey that signed the terms hash instead of the digest", async () => {
    const { db, max, terms } = await world();
    expect(await send(db, max, challengeFor(termsHash(terms)), terms)).toMatchObject({ status: "refused" });
    expect(status(db)).toBe("PENDING_APPROVAL");
  });

  it("refuses a passkey that is enrolled in Purser but is not an owner of the account", async () => {
    const { db, eve, terms, digest } = await world();
    expect(await send(db, eve, challengeFor(digest), terms)).toMatchObject({ status: "refused", message: expect.stringMatching(/not an owner/) });
  });

  it("refuses the same person twice (four eyes)", async () => {
    const { db, max, terms, digest } = await world();
    await send(db, max, challengeFor(digest), terms);
    expect(await send(db, max, challengeFor(digest), terms, 2)).toMatchObject({ status: "refused" });
    expect(status(db)).toBe("PENDING_APPROVAL");
  });

  it("refuses terms whose digest does not follow from their calls (tampered after hashing would also break the hash)", () => {
    const t = ownersExecuteTerms({ proposal_id: "P-9", expires_at: "2026-11-01T10:15:00Z", account: ACCOUNT, chain_id: "63825", owners: [], calls: [{ target: ACCOUNT, value: "0", call_data: "0x12" }], nonce: "1", valid_until: "1", action: { what: "bind", agent: "a", cap: "0.05", budget: "0.50", payee: ACCOUNT, payee_name: "x", mandate: `0x${"00".repeat(32)}` } });
    const bad = { ...t, calls: [{ target: ACCOUNT, value: "1", call_data: "0x12" as Hex }] };
    expect(() => approvalHashOf({ kind: "owners_execute", terms_json: JSON.stringify(bad), terms_sha256: "x" })).toThrow(/does not follow/);
  });

  it("builds the account signature from the two approvals: each an owner, each a P-256 signature over authData ‖ sha256(clientData) with the digest as challenge", async () => {
    const { db, max, anna, terms, digest } = await world();
    await send(db, max, challengeFor(digest), terms);
    await send(db, anna, challengeFor(digest), terms);
    const rows = db.prepare("SELECT a.assertion_json, p.public_key FROM passkey_assertions a JOIN passkeys p USING (credential_id) WHERE a.proposal_id = 'P-0001'").all() as { assertion_json: string; public_key: string }[];
    const q = quorumOf(terms, rows.map((r) => ({ publicKey: r.public_key, response: JSON.parse(r.assertion_json) as AuthenticationResponseJSON })));
    const [signers, sigs] = decodeAbiParameters(parseAbiParameters("bytes[], bytes[]"), q);
    expect([...signers].sort()).toEqual([...terms.owners].sort());
    signers.forEach((signer, i) => {
      const [r, s, ci, , ad, json] = decodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, uint256, bytes, string"), sigs[i]!);
      expect(json.slice(Number(ci))).toMatch(new RegExp(`^"challenge":"${challengeFor(digest)}"`));
      const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: Buffer.from(signer.slice(42, 106), "hex").toString("base64url"), y: Buffer.from(signer.slice(106), "hex").toString("base64url") }, format: "jwk" });
      const msg = Buffer.concat([Buffer.from(ad.slice(2), "hex"), createHash("sha256").update(json).digest()]);
      expect(verify("sha256", msg, { key, dsaEncoding: "ieee-p1363" }, Buffer.from(r.slice(2) + s.slice(2), "hex"))).toBe(true);
    });
  });

  it("relays executeSigned built from the two approvals, and records the tx; a revert fails the proposal", async () => {
    const { db, max, anna, terms, digest } = await world();
    await send(db, max, challengeFor(digest), terms);
    await send(db, anna, challengeFor(digest), terms);
    const sent: { to: string; data: string }[] = [];
    const tx = `0x${"cd".repeat(32)}` as Hex;
    const r = await executeOwnersExecute(db, "P-0001", async (to, data) => { sent.push({ to, data }); return { tx, ok: true }; }, t0);
    expect(r.tx).toBe(tx);
    expect(sent).toEqual([{ to: ACCOUNT, data: signedCallOf(db, "P-0001").data }]);
    expect(status(db)).toBe("EXECUTED");
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'owners.executed'").get()).toEqual({ n: 1 });
  });

  it("does not relay with one approval, nor after the signed deadline", async () => {
    const { db, max, anna, terms, digest } = await world();
    await send(db, max, challengeFor(digest), terms);
    expect(() => signedCallOf(db, "P-0001")).toThrow(/needs both owners/);
    await send(db, anna, challengeFor(digest), terms);
    let relayed = false;
    await expect(executeOwnersExecute(db, "P-0001", async () => { relayed = true; return { tx: "0x" as Hex, ok: true }; }, new Date("2026-11-01T10:16:30Z"))).rejects.toThrow(/deadline|expired/);
    expect(relayed).toBe(false);
  });
});

describe("the phone and the feed for an owners_execute", () => {
  it("the phone describes it as signed on chain, and refuses terms without a valid digest", async () => {
    const { describeTerms } = await import("../src/approve/client.js");
    const { terms } = await world();
    const f = describeTerms(terms as never, {});
    expect(f).toMatchObject({ approvable: true, title: "Bind the sourcing mandate, signed on chain" });
    expect(f.sentence).toMatch(/Your Face ID signs this on chain/);
    expect(describeTerms({ ...terms, onchain_digest: "0x12" } as never, {}).approvable).toBe(false);
  });

  it("the feed says both passkeys signed and the runner only relayed", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const { db, max, anna, terms, digest } = await world();
    await send(db, max, challengeFor(digest), terms);
    await send(db, anna, challengeFor(digest), terms);
    await executeOwnersExecute(db, "P-0001", async () => ({ tx: `0x${"cd".repeat(32)}` as Hex, ok: true }), t0);
    const line = buildSnapshot(db).feed.find((x) => x.event === "owners.executed")!;
    expect(line.text).toMatch(/^Both passkeys signed P-0001 on chain/);
    expect(line.tx).toBe(`0x${"cd".repeat(32)}`);
  });
});
