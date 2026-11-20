// `npm run verify`'s passkey check (reverifyPasskeyApprovals, src/passkey/webauthn.ts) on a ledger edited after the
// fact: an approval whose recorded hash is not the signed one, a signature dated before its passkey was enrolled, one
// by a passkey the ledger no longer holds, and a two-person approval with one person's signature each fail, naming
// why. And registering a security key (src/passkey/securityKey.ts) is refused with no open window, after it ran out,
// for a malformed credential, and for one over another challenge, writing nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { finishSecurityKey, startSecurityKey } from "../src/passkey/securityKey.js";
import { challengeFor, reverifyPasskeyApprovals } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-11-13T14:00:00Z");
let tickets = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: t0.toISOString() });

let db: DB, faceId: FakeAuthenticator;
beforeEach(async () => {
  db = openDb(":memory:");
  faceId = new FakeAuthenticator("platform");
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  await processRegistration(db, item("registration", { code, credential: faceId.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, t0);
  confirmPasskey(db, fingerprintOf(faceId.spkiSha256), t0);
});

/** A payment approved with max's passkey: the reverification passes before anything is edited. */
async function approved(): Promise<{ id: string; hash: string }> {
  const id = "P-0001";
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-13T15:00:00Z", amount: "120.00", currency: "EUR",
    vendor: "Bergtex Textil GmbH", beneficiary_id: "ben-bergtex", iban_last4: "3000", bic: "COBADEFFXXX", invoice_no: "BTX-1" };
  createProposal(db, { terms, createdBy: "treasury" }, t0);
  const hash = termsHash(terms);
  const r = await processAssertion(db, item("assertion", { proposal_id: id, terms_sha256: hash, credential: faceId.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 }) }, id), t0);
  expect(r.status).toBe("approved");
  expect(await reverifyPasskeyApprovals(db)).toEqual([{ ok: true, what: `passkey approval ${id}`, detail: expect.stringContaining("max's passkey") }]);
  return { id, hash };
}
const detail = async () => { const [c] = await reverifyPasskeyApprovals(db); expect(c!.ok).toBe(false); return c!.detail; };

describe("npm run verify on an edited ledger", () => {
  it("fails an approval whose recorded hash is not the hash the passkey signed", async () => {
    const { id } = await approved();
    db.prepare("UPDATE approvals SET approved_sha256 = ? WHERE proposal_id = ?").run("ab".repeat(32), id);
    expect(await detail()).toBe("the signed hash is not the approved hash");
  });

  it("fails a signature dated before its passkey was enrolled", async () => {
    const { id } = await approved();
    db.prepare("UPDATE passkey_assertions SET verified_at = ? WHERE proposal_id = ?").run("2026-11-01T00:00:00.000Z", id);
    expect(await detail()).toBe("signed before the passkey was enrolled");
  });

  it("fails a signature by a passkey the ledger does not hold", async () => {
    const { id } = await approved();
    db.pragma("foreign_keys = OFF");
    db.prepare("UPDATE passkey_assertions SET credential_id = ? WHERE proposal_id = ?").run("Zm9yZ2VkLWNyZWRlbnRpYWw", id);
    expect(await detail()).toBe("signed by an unknown passkey Zm9yZ2Vk");
  });

  it("fails a two-person approval that holds one person's signature", async () => {
    const { id } = await approved();
    db.prepare("UPDATE approvals SET approver = ? WHERE proposal_id = ?").run(`max (passkey ${faceId.credentialId.slice(0, 8)}) + anna (passkey 00000000)`, id);
    expect(await detail()).toBe("needs 2 different people's signatures, has 1");
  });

  it("fails an approval with no stored signature at all", async () => {
    const { id } = await approved();
    db.prepare("DELETE FROM passkey_assertions WHERE proposal_id = ?").run(id);
    expect(await detail()).toBe("no stored signature");
  });
});

describe("registering a security key", () => {
  const yubi = () => new FakeAuthenticator("cross-platform");
  const keys = () => db.prepare("SELECT COUNT(*) AS n FROM security_keys").get() as { n: number };

  it("is refused with no registration open", async () => {
    const k = yubi();
    expect(await finishSecurityKey(db, { label: "max", credential: k.register({ challenge: "x".repeat(43), origin: ORIGIN, rpId: RP }) }, t0))
      .toEqual({ ok: false, reason: "no security key registration is open; start again" });
  });

  it("is refused once the window ran out (ten minutes)", async () => {
    const s = startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    const k = yubi();
    expect(await finishSecurityKey(db, { label: "max", credential: k.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }) }, new Date(t0.getTime() + 10 * 60_000)))
      .toEqual({ ok: false, reason: "no security key registration is open; start again" });
    expect(keys()).toEqual({ n: 0 });
  });

  it("is refused for a malformed credential", async () => {
    startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    for (const credential of [null, "a string", {}, { id: 7 }]) {
      expect(await finishSecurityKey(db, { label: "max", credential }, t0), JSON.stringify(credential)).toEqual({ ok: false, reason: "malformed credential" });
    }
    expect(keys()).toEqual({ n: 0 });
  });

  it("is refused for a credential made over another challenge or for another site", async () => {
    startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    const k = yubi();
    const other = await finishSecurityKey(db, { label: "max", credential: k.register({ challenge: Buffer.from("another challenge").toString("base64url"), origin: ORIGIN, rpId: RP }) }, t0);
    expect(other).toMatchObject({ ok: false, reason: expect.stringMatching(/^the security key did not verify \(/) });
    const s = startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    const site = await finishSecurityKey(db, { label: "max", credential: yubi().register({ challenge: s.challenge, origin: "https://evil.example", rpId: "evil.example" }) }, t0);
    expect(site).toMatchObject({ ok: false, reason: expect.stringMatching(/^the security key did not verify \(/) });
    expect(keys()).toEqual({ n: 0 });
  });

  it("a newer start closes the older window: only the latest challenge registers", async () => {
    const first = startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    expect((await finishSecurityKey(db, { label: "max", credential: yubi().register({ challenge: first.challenge, origin: ORIGIN, rpId: RP }) }, t0)).ok).toBe(false);
    expect(keys()).toEqual({ n: 0 });
  });
});
