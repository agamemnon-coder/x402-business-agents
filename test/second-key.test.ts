// A second key for high-risk payments (src/policy/secondKey.ts, src/passkey/securityKey.ts), on the runner's own code
// with software authenticators: one playing the CFO's platform passkey (Face ID), one a cross-platform security key.
// It holds: off by default, a passkey alone approves; with a trigger on, a high-risk payment needs both keys of the
// same person over the same terms hash: one alone leaves it waiting (and says why and what to touch), the same key
// twice is refused, a signature over other terms is refused, a security key never approves alone or anything not
// high-risk; each trigger (amount, new payee, bank details changed, new country) finds what it should; a security key
// is registered only as cross-platform and only as a new credential; and switching a trigger off loosens the policy.
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { finishSecurityKey, securityKeysOf, startSecurityKey } from "../src/passkey/securityKey.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { loosens } from "../src/policy/loosens.js";
import { secondKeyReasons } from "../src/policy/secondKey.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-11-13T14:00:00Z");
let tickets = 0, counter = 0, n = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: t0.toISOString() });
const setting = (db: DB, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, t0.toISOString());
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

let db: DB, faceId: FakeAuthenticator, yubi: FakeAuthenticator;

/** An invoice payment to a payee, with its bank details. */
function pay(amount: string, o: { vendor?: string; beneficiary?: string; iban?: string; bic?: string } = {}): { id: string; hash: string } {
  const id = `P-${String(++n).padStart(4, "0")}`;
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-13T15:00:00Z", amount, currency: "EUR",
    vendor: o.vendor ?? "Bergtex Textil GmbH", beneficiary_id: o.beneficiary ?? "ben-bergtex", iban_last4: o.iban ?? "3000", bic: o.bic ?? "COBADEFFXXX", invoice_no: `BTX-${n}` };
  createProposal(db, { terms, createdBy: "treasury" }, t0);
  return { id, hash: termsHash(terms) };
}
/** A payment made earlier: paid (EXECUTED), approved `daysAgo` days ago. */
function paidEarlier(daysAgo: number, o: Parameters<typeof pay>[1] = {}) {
  const p = pay("100.00", o);
  const at = new Date(t0.getTime() - daysAgo * 86_400_000).toISOString();
  db.prepare("UPDATE proposals SET status = 'EXECUTED', created_at = ? WHERE proposal_id = ?").run(at, p.id);
}
const signWith = (a: FakeAuthenticator, hash: string): AuthenticationResponseJSON => a.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
const approve = (p: { id: string; hash: string }, a: FakeAuthenticator, signedHash = p.hash) => processAssertion(db, item("assertion", { proposal_id: p.id, terms_sha256: p.hash, credential: signWith(a, signedHash) }, p.id), t0);

beforeEach(async () => {
  db = openDb(":memory:");
  faceId = new FakeAuthenticator("platform");
  yubi = new FakeAuthenticator("cross-platform");
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  await processRegistration(db, item("registration", { code, credential: faceId.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, t0);
  confirmPasskey(db, fingerprintOf(faceId.spkiSha256), t0);
  const s = startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
  expect(await finishSecurityKey(db, { label: "max", credential: yubi.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }) }, t0)).toEqual({ ok: true, credential_id: yubi.credentialId });
});

describe("a second key for high-risk payments", () => {
  it("is off by default: the passkey alone approves, and a security key alone approves nothing", async () => {
    const a = pay("50000.00");
    expect(secondKeyReasons(db, db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(a.id) as never, t0)).toEqual([]);
    expect(await approve(a, yubi)).toMatchObject({ status: "refused", message: expect.stringMatching(/security key alone never approves/) });
    expect(status(db, a.id)).toBe("PENDING_APPROVAL");
    expect((await approve(a, faceId)).status).toBe("approved");
  });

  it("keeps a high-risk payment waiting on the passkey alone, says why, and approves with the security key too", async () => {
    setting(db, "approval.second_key_eur", "1000.00");
    const a = pay("1850.00");
    const first = await approve(a, faceId);
    expect(first).toEqual({ status: "second_key", proposalId: a.id, message: "High-risk: amount at or above EUR 1000.00. Touch your security key." });
    expect(status(db, a.id)).toBe("PENDING_APPROVAL");
    expect((await approve(a, yubi)).status).toBe("approved");
    expect(status(db, a.id)).toBe("APPROVED");
    const row = db.prepare("SELECT approver FROM approvals WHERE proposal_id = ?").get(a.id) as { approver: string };
    expect(row.approver).toBe("max (passkey and security key)");
    // Under the amount: Face ID alone, as before.
    expect((await approve(pay("999.99"), faceId)).status).toBe("approved");
  });

  it("takes the keys in either order, but never the same key twice", async () => {
    setting(db, "approval.second_key_eur", "1000.00");
    const a = pay("1850.00");
    expect(await approve(a, yubi)).toMatchObject({ status: "second_key", message: expect.stringMatching(/Approve with Face ID too\.$/) });
    expect(await approve(a, yubi)).toMatchObject({ status: "refused", message: expect.stringMatching(/already signed/) });
    expect(status(db, a.id)).toBe("PENDING_APPROVAL");
    expect((await approve(a, faceId)).status).toBe("approved");
    const b = pay("2000.00");
    expect((await approve(b, faceId)).status).toBe("second_key");
    expect(await approve(b, faceId)).toMatchObject({ status: "refused", message: expect.stringMatching(/already signed/) });
    expect(status(db, b.id)).toBe("PENDING_APPROVAL");
  });

  it("refuses a key's signature over other terms", async () => {
    setting(db, "approval.second_key_eur", "1000.00");
    const a = pay("1850.00");
    const other = pay("1900.00");
    expect((await approve(a, faceId)).status).toBe("second_key");
    expect((await approve(a, yubi, other.hash)).status).toBe("refused");
    expect(status(db, a.id)).toBe("PENDING_APPROVAL");
  });

  it("finds each trigger: a new payee, bank details changed, a new country", async () => {
    const reasons = (p: { id: string }) => secondKeyReasons(db, db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(p.id) as never, t0);
    paidEarlier(90, { vendor: "Bergtex Textil GmbH", beneficiary: "ben-bergtex", iban: "3000", bic: "COBADEFFXXX" });
    paidEarlier(10, { vendor: "Zeeland Verpakking", beneficiary: "ben-zeeland", iban: "4471", bic: "RABONL2UXXX" });
    setting(db, "approval.second_key_new_payee", "on");
    expect(reasons(pay("10.00"))).toEqual([]);
    expect(reasons(pay("10.00", { vendor: "Zeeland Verpakking", beneficiary: "ben-zeeland", iban: "4471", bic: "RABONL2UXXX" }))).toEqual(["new payee (first paid less than 30 days ago)"]);
    expect(reasons(pay("10.00", { vendor: "Lagerhaus Nord", beneficiary: "ben-lager", bic: "DEUTDEFFXXX" }))).toEqual(["new payee (never paid before)"]);
    setting(db, "approval.second_key_new_payee", "off");
    setting(db, "approval.second_key_bank_changed", "on");
    expect(reasons(pay("10.00", { iban: "9999" }))).toEqual(["bank details changed"]);
    expect(reasons(pay("10.00"))).toEqual([]);
    setting(db, "approval.second_key_bank_changed", "off");
    setting(db, "approval.second_key_new_country", "on");
    expect(reasons(pay("10.00", { vendor: "Atelier Lyon", beneficiary: "ben-lyon", bic: "BNPAFRPPXXX" }))).toEqual(["new country (FR)"]);
    expect(reasons(pay("10.00", { vendor: "Lagerhaus Nord", beneficiary: "ben-lager", bic: "DEUTDEFFXXX" }))).toEqual([]);
  });

  it("registers a security key only as cross-platform, only as a new credential, and only for someone with a passkey", async () => {
    const s = startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    const phone = new FakeAuthenticator("platform");
    expect(await finishSecurityKey(db, { label: "max", credential: phone.register({ challenge: s.challenge, origin: ORIGIN, rpId: RP }) }, t0)).toMatchObject({ ok: false, reason: expect.stringMatching(/not a security key/) });
    const s2 = startSecurityKey(db, { label: "max", rpId: RP, origin: ORIGIN }, t0);
    expect(await finishSecurityKey(db, { label: "max", credential: yubi.register({ challenge: s2.challenge, origin: ORIGIN, rpId: RP }) }, t0)).toMatchObject({ ok: false, reason: expect.stringMatching(/already registered/) });
    expect(() => startSecurityKey(db, { label: "anna", rpId: RP, origin: ORIGIN }, t0)).toThrow(/passkey \(Face ID\) first/);
    expect(securityKeysOf(db, "max")).toEqual([yubi.credentialId]);
  });

  it("is CFO policy: switching a trigger on tightens, switching it off loosens (that takes Face ID on the runner)", () => {
    expect(loosens({ key: "approval.second_key_new_payee", from: "off", to: "on" })).toBe(false);
    expect(loosens({ key: "approval.second_key_new_payee", from: "on", to: "off" })).toBe(true);
    expect(loosens({ key: "approval.second_key_eur", from: "", to: "1000.00" })).toBe(false);
    expect(loosens({ key: "approval.second_key_eur", from: "1000.00", to: "" })).toBe(true);
    expect(loosens({ key: "approval.second_key_eur", from: "1000.00", to: "500.00" })).toBe(false);
  });
});
