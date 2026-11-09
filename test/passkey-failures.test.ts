// Refused passkey submissions are counted, never logged: anyone can post to the relay, so the hash-chained audit log
// stays closed to unverified text, but a burst of failures must still be visible to an operator. The counter holds a
// fixed reason code and a number per hour, nothing the sender wrote.
import { describe, expect, it } from "vitest";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { health, prometheus } from "../src/ops/health.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { BENIGN_FAILURES, countFailure, failureCounts, PASSKEY_FAILURE_SPIKE } from "../src/passkey/failures.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-10-30T14:00:00Z");
let tickets = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: typeof body === "string" ? body : JSON.stringify(body), received_at: t0.toISOString() });
const approval = (id: string, hash: string, credential: AuthenticationResponseJSON) => item("assertion", { proposal_id: id, terms_sha256: hash, credential }, id);

async function world() {
  const auth = new FakeAuthenticator();
  const db = openDb(":memory:");
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  await processRegistration(db, item("registration", { code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "cfo" }, t0);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), t0);
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T14:10:00Z", total: "0.60" };
  createProposal(db, { terms, createdBy: "support" }, t0);
  return { db, auth, hash: termsHash(terms) };
}
const auditRows = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;

describe("passkey failure counter", () => {
  it("counts each refusal under a fixed code and writes nothing to the audit log for unverified ones", async () => {
    const { db, hash } = await world();
    const before = auditRows(db);
    const stranger = new FakeAuthenticator();
    await processAssertion(db, item("assertion", "not json <script>", "P-0001"), t0);
    await processAssertion(db, approval("P-0404", hash, stranger.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    await processAssertion(db, approval("P-0001", hash, stranger.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    expect(auditRows(db)).toBe(before);
    const c = failureCounts(db, t0);
    expect(c.lastHour).toBe(3);
    expect(c.byCode).toEqual({ malformed: 1, unknown_proposal: 1, unknown_passkey: 1 });
    // Only codes and numbers are stored: nothing the sender sent.
    expect(JSON.stringify(db.prepare("SELECT * FROM passkey_failures").all())).not.toMatch(/script|P-0404/);
  });

  it("counts a bad signature from the enrolled passkey and a wrong enrolment code", async () => {
    const { db, auth, hash } = await world();
    await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: "https://evil.example", rpId: RP, counter: 1 })), t0);
    const { window } = openEnrolment(db, { rpId: RP, origin: ORIGIN, replace: true }, t0);
    await processRegistration(db, item("registration", { code: "000000", credential: new FakeAuthenticator().register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "x" }, t0);
    expect(failureCounts(db, t0).byCode).toMatchObject({ bad_signature: 1, wrong_enrol_code: 1 });
  });

  it("does not count an approval that went through", async () => {
    const { db, auth, hash } = await world();
    expect((await processAssertion(db, approval("P-0001", hash, auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0)).status).toBe("approved");
    expect(failureCounts(db, t0).lastHour).toBe(0);
  });

  it("shows the counts as metrics and raises an alert on a burst, which ages out after an hour", async () => {
    const { db, hash } = await world();
    const stranger = new FakeAuthenticator();
    for (let i = 0; i < PASSKEY_FAILURE_SPIKE; i++) {
      await processAssertion(db, approval("P-0001", hash, stranger.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: i + 1 })), t0);
    }
    const h = health(db, t0);
    expect(h.metrics).toMatchObject({ passkey_failures_1h: PASSKEY_FAILURE_SPIKE, passkey_failures_24h: PASSKEY_FAILURE_SPIKE, passkey_failures_24h_unknown_passkey: PASSKEY_FAILURE_SPIKE });
    expect(h.alerts.map((a) => a.code)).toContain("passkey_failures_spike");
    expect(prometheus(h)).toContain(`purser_passkey_failures_1h ${PASSKEY_FAILURE_SPIKE}`);
    const later = new Date(t0.getTime() + 2 * 3_600_000);
    expect(health(db, later).alerts.map((a) => a.code)).not.toContain("passkey_failures_spike");
    expect(health(db, later).metrics.passkey_failures_24h).toBe(PASSKEY_FAILURE_SPIKE);
  });

  it("keeps the table small: hours older than 30 days are dropped on the next write", async () => {
    const { db, hash } = await world();
    const stranger = new FakeAuthenticator();
    await processAssertion(db, approval("P-0001", hash, stranger.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 })), t0);
    const month = new Date(t0.getTime() + 31 * 86_400_000);
    await processAssertion(db, approval("P-0001", hash, stranger.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 2 })), month);
    expect((db.prepare("SELECT COUNT(*) AS n FROM passkey_failures").get() as { n: number }).n).toBe(1);
  });
});

describe("passkey failure thresholds per type", () => {
  const db0 = () => openDb(":memory:");
  const codes = (db: DB, at = t0) => health(db, at).alerts.filter((a) => a.code.startsWith("passkey_")).map((a) => [a.code, a.severity]);

  it("stored terms that no longer match their hash are critical on the first one, for a day", () => {
    const db = db0();
    countFailure(db, "terms_tampered", t0);
    expect(codes(db)).toEqual([["passkey_terms_tampered", "critical"]]);
    expect(codes(db, new Date(t0.getTime() + 20 * 3_600_000))).toEqual([["passkey_terms_tampered", "critical"]]);
    expect(codes(db, new Date(t0.getTime() + 25 * 3_600_000))).toEqual([]);
  });

  it("three enrolment failures in an hour raise their own alert", () => {
    const db = db0();
    countFailure(db, "wrong_enrol_code", t0);
    countFailure(db, "wrong_enrol_code", t0);
    expect(codes(db)).toEqual([]);
    countFailure(db, "enrol_verify_failed", t0);
    expect(codes(db)).toEqual([["passkey_enrol_attempts", "warning"]]);
  });

  it("three errors storing or verifying an enrolled passkey's signature raise their own alert", () => {
    const db = db0();
    for (const c of ["verify_error", "store_error", "enrol_store_error"] as const) countFailure(db, c, t0);
    expect(codes(db)).toEqual([["passkey_errors", "warning"]]);
  });

  it("benign refusals (a double tap, an already-decided option, a looser phone change) never count toward the spike", () => {
    const db = db0();
    for (let i = 0; i < 20; i++) for (const c of BENIGN_FAILURES) countFailure(db, c, t0);
    expect(codes(db)).toEqual([]);
    expect(health(db, t0).metrics.passkey_failures_1h).toBe(20 * BENIGN_FAILURES.length);
    for (let i = 0; i < PASSKEY_FAILURE_SPIKE - 1; i++) countFailure(db, "bad_signature", t0);
    expect(codes(db)).toEqual([]);
    countFailure(db, "bad_signature", t0);
    expect(codes(db)).toEqual([["passkey_failures_spike", "warning"]]);
  });
});
