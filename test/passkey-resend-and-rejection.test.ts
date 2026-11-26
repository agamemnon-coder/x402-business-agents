// A passkey signature the runner has handled before (a restart, the relay or the phone sending it again) is answered
// with what came of it the first time, and nothing runs again (src/passkey/process.ts processAssertion): approved,
// executed, failed, rejected or too late, as the proposal stands now. A rejection is checked as strictly as an approval
// (an enrolled, active passkey, a signature over the rejection hash) but never needs the terms intact, and a late or
// repeated one changes nothing. Taking a line out of something that is not a waiting batch is refused before any check.
import { describe, expect, it } from "vitest";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { openDb, type DB } from "../src/db/open.js";
import { rejectionSha256, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, RATIONALE_NOT_VIEWED, RATIONALE_VIEWED, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-10-30T14:00:00Z");
let tickets = 0;
let counter = 0;
const item = (body: unknown, proposalId: string): InboxItem => ({ ticket: `t-${++tickets}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify(body), received_at: t0.toISOString() });

function propose(db: DB, id: string, expires = "2026-10-30T14:10:00Z"): string {
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: id, expires_at: expires, total: "0.60" };
  createProposal(db, { terms, createdBy: "support" }, t0);
  return termsHash(terms);
}
async function enrolled() {
  const auth = new FakeAuthenticator();
  const db = openDb(":memory:");
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  await processRegistration(db, { ticket: "reg", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: t0.toISOString() }, { label: "max" }, t0);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), t0);
  return { db, auth };
}
const signed = (auth: FakeAuthenticator, hash: string): AuthenticationResponseJSON => auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
const approve = (db: DB, id: string, hash: string, credential: AuthenticationResponseJSON, at = t0) => processAssertion(db, item({ proposal_id: id, terms_sha256: hash, credential }, id), at);
const reject = (db: DB, id: string, hash: string, credential: AuthenticationResponseJSON, at = t0) => processAssertion(db, item({ proposal_id: id, terms_sha256: hash, decision: "REJECTED", credential }, id), at);
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const setStatus = (db: DB, id: string, s: string) => db.prepare("UPDATE proposals SET status = ? WHERE proposal_id = ?").run(s, id);
const approvals = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n;

describe("a signature sent again is answered with what came of it, and nothing runs again", () => {
  it("approved, then executed, then failed: each resend says so", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const sig = signed(auth, hash);
    expect(await approve(db, "P-0001", hash, sig)).toMatchObject({ status: "approved", proposalId: "P-0001" });
    expect(await approve(db, "P-0001", hash, sig)).toEqual({ status: "already", ack: "approved", proposalId: "P-0001", message: "this signature was already handled: P-0001 is APPROVED" });
    setStatus(db, "P-0001", "EXECUTED");
    expect(await approve(db, "P-0001", hash, sig)).toMatchObject({ status: "already", ack: "executed" });
    setStatus(db, "P-0001", "FAILED");
    expect(await approve(db, "P-0001", hash, sig)).toMatchObject({ status: "already", ack: "failed" });
    expect(approvals(db)).toBe(1);
  });

  it("a rejection sent again is still a rejection; a late approval sent again is still too late", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const no = signed(auth, rejectionSha256(hash));
    expect(await reject(db, "P-0001", hash, no)).toMatchObject({ status: "rejected", message: expect.stringContaining("nothing will be paid") });
    expect(await reject(db, "P-0001", hash, no)).toMatchObject({ status: "already", ack: "rejected" });

    const hash2 = propose(db, "P-0002");
    const late = new Date("2026-10-30T14:10:01Z");
    const sig = signed(auth, hash2);
    expect(await approve(db, "P-0002", hash2, sig, late)).toMatchObject({ status: "too_late" });
    expect(await approve(db, "P-0002", hash2, sig, late)).toMatchObject({ status: "already", ack: "too_late" });
    expect(statusOf(db, "P-0002")).toBe("EXPIRED");
  });

  it("another signature on a decided proposal is not a new approval", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    await approve(db, "P-0001", hash, signed(auth, hash));
    expect(await approve(db, "P-0001", hash, signed(auth, hash))).toEqual({ status: "already", proposalId: "P-0001", message: "P-0001 is already APPROVED" });
    for (const s of ["EXECUTING", "EXECUTED", "FAILED"]) {
      setStatus(db, "P-0001", s);
      expect(await approve(db, "P-0001", hash, signed(auth, hash))).toMatchObject({ status: "already", message: `P-0001 is already ${s}` });
    }
    // Neither waiting nor decided (superseded by another plan): refused, not approved.
    setStatus(db, "P-0001", "SUPERSEDED");
    expect(await approve(db, "P-0001", hash, signed(auth, hash))).toMatchObject({ status: "refused", message: "P-0001 is SUPERSEDED, not waiting for approval" });
    expect(approvals(db)).toBe(1);
  });
});

describe("a rejection is checked as strictly as an approval", () => {
  it("nothing to reject once the proposal expired or was decided", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    expect(await reject(db, "P-0001", hash, signed(auth, rejectionSha256(hash)), new Date("2026-10-30T14:10:01Z")))
      .toEqual({ status: "already", proposalId: "P-0001", message: "P-0001 expired at 2026-10-30T14:10:00Z; nothing to reject" });
    const hash2 = propose(db, "P-0002");
    await approve(db, "P-0002", hash2, signed(auth, hash2));
    expect(await reject(db, "P-0002", hash2, signed(auth, rejectionSha256(hash2)))).toEqual({ status: "already", proposalId: "P-0002", message: "P-0002 is already APPROVED; nothing to reject" });
    expect(statusOf(db, "P-0002")).toBe("APPROVED");
  });

  it("refuses a passkey that is not enrolled or was revoked, and an approval's signature sent as a rejection", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const stranger = new FakeAuthenticator();
    expect(await reject(db, "P-0001", hash, signed(stranger, rejectionSha256(hash)))).toMatchObject({ status: "refused", message: "this passkey is not enrolled" });
    // The approval's signature cannot reject: it signed the terms hash, not the rejection hash.
    const r = await reject(db, "P-0001", hash, signed(auth, hash));
    expect(r.status).toBe("refused");
    db.prepare("UPDATE passkeys SET status = 'REVOKED'").run();
    expect(await reject(db, "P-0001", hash, signed(auth, rejectionSha256(hash)))).toMatchObject({ status: "refused", message: "this passkey was revoked" });
    expect(statusOf(db, "P-0001")).toBe("PENDING_APPROVAL");
  });

  it("does not need the stored terms intact: rejecting is always safe", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = 'P-0001'").run(JSON.stringify({ tampered: true }));
    expect(await approve(db, "P-0001", hash, signed(auth, hash))).toMatchObject({ status: "refused", message: "the stored terms of P-0001 no longer match their hash" });
    expect(await reject(db, "P-0001", hash, signed(auth, rejectionSha256(hash)))).toMatchObject({ status: "rejected" });
    expect(statusOf(db, "P-0001")).toBe("REJECTED");
  });
});

describe("taking a line out", () => {
  it("is refused for what is not a batch, without a line, or for a batch no longer waiting", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    const remove = (line?: string) => processAssertion(db, item({ proposal_id: "P-0001", terms_sha256: hash, decision: "REMOVE_LINE", ...(line ? { line } : {}), credential: signed(auth, hash) }, "P-0001"), t0);
    expect(await remove("P-0009")).toMatchObject({ status: "refused", message: "P-0001 is not a batch; only a line of a batch can be taken out" });
    db.prepare("UPDATE proposals SET kind = 'payment_batch' WHERE proposal_id = 'P-0001'").run();
    expect(await remove()).toMatchObject({ status: "refused", message: "say which line to take out" });
    setStatus(db, "P-0001", "EXPIRED");
    expect(await remove("P-0009")).toMatchObject({ status: "refused", message: "P-0001 is EXPIRED, not waiting for approval" });
  });
});

describe("a submission that names no proposal the runner has", () => {
  it("is refused, and a malformed one too", async () => {
    const { db, auth } = await enrolled();
    const hash = propose(db, "P-0001");
    expect(await approve(db, "P-0404", hash, signed(auth, hash))).toMatchObject({ status: "refused", proposalId: null, message: "no proposal P-0404" });
    expect(await processAssertion(db, { ticket: "x", kind: "assertion", proposal_id: "P-0001", body: "{not json", received_at: t0.toISOString() }, t0)).toEqual({ status: "refused", proposalId: null, message: "malformed submission" });
  });
});

// Automation bias (EU AI Act Art. 14(4)(b), 26 Nov): the approval page reports whether Details was opened before
// signing; once the signature is verified the runner records it just before the approval, in the same transaction.
// It decides nothing: the same signature approves the same proposal with the field true, false or absent.
describe("the approval page's automation-bias signal (rationale_viewed)", () => {
  const events = (db: DB) => (db.prepare("SELECT event, subject, payload_json FROM audit_log WHERE event LIKE 'approval.rationale%' OR event IN ('proposal.approved', 'proposal.rejected') ORDER BY seq").all() as { event: string; subject: string; payload_json: string }[]);
  const send = (db: DB, id: string, hash: string, credential: AuthenticationResponseJSON, extra: Record<string, unknown>) => processAssertion(db, item({ proposal_id: id, terms_sha256: hash, credential, ...extra }, id), t0);

  it("records viewed or not viewed just before proposal.approved; absent, nothing; a rejection, nothing", async () => {
    const { db, auth } = await enrolled();
    const h1 = propose(db, "P-0001");
    const h2 = propose(db, "P-0002");
    const h3 = propose(db, "P-0003");
    const h4 = propose(db, "P-0004");
    expect(await send(db, "P-0001", h1, signed(auth, h1), { rationale_viewed: true })).toMatchObject({ status: "approved" });
    expect(await send(db, "P-0002", h2, signed(auth, h2), { rationale_viewed: false })).toMatchObject({ status: "approved" });
    expect(await send(db, "P-0003", h3, signed(auth, h3), {})).toMatchObject({ status: "approved" });
    expect(await send(db, "P-0004", h4, signed(auth, rejectionSha256(h4)), { decision: "REJECTED", rationale_viewed: true })).toMatchObject({ status: "rejected" });
    expect(events(db).map((e) => `${e.event} ${e.subject}`)).toEqual([
      `${RATIONALE_VIEWED} P-0001`, "proposal.approved P-0001",
      `${RATIONALE_NOT_VIEWED} P-0002`, "proposal.approved P-0002",
      "proposal.approved P-0003",
      "proposal.rejected P-0004",
    ]);
    expect(JSON.parse(events(db)[0]!.payload_json)).toEqual({ terms_sha256: h1, credential: auth.credentialId.slice(0, 8), reported_by: "the approval page, not signed" });
  });

  it("records nothing for a signature that does not verify, and refuses a field that is not true or false", async () => {
    const { db, auth } = await enrolled();
    const h1 = propose(db, "P-0001");
    const h2 = propose(db, "P-0002");
    expect(await send(db, "P-0001", h1, signed(auth, h2), { rationale_viewed: true })).toMatchObject({ status: "refused" });
    expect(await send(db, "P-0001", h1, signed(auth, h1), { rationale_viewed: "yes" })).toEqual({ status: "refused", proposalId: null, message: "malformed submission" });
    expect(events(db)).toEqual([]);
    expect(statusOf(db, "P-0001")).toBe("PENDING_APPROVAL");
  });
});
