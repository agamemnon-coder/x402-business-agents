// Security review, 20 November, finding 7 (MEDIUM): the limit an agent may pay alone up to sat outside the signed
// policy. A /try test company's seed wrote ap.alone_eur as a plain setting the CFO never signed, any setting in the
// ledger counted, and `npm run verify` flagged every payment code approved within it once a passkey was enrolled (a false
// alarm). Now the limit counts only when a policy change the CFO signed with the passkey set it, or as a test company's
// default labelled as such (src/policy/aloneLimit.ts); a payment approved within it runs only on its within_limit record
// and a limit in force then (src/policy/signedApproval.ts); and verify accepts exactly those, naming the source.
// Breaks if a setting written by hand lets an agent pay alone, if the labelled default or a signed limit stops working,
// or if verify raises the alarm on a genuine payment within the limit or stops raising it on a forged one.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { approvalMethodChecks, challengeFor } from "../src/passkey/webauthn.js";
import { approveWithinLimit, beginExecution, createProposal, nextProposalId } from "../src/policy/approvals.js";
import { aloneLimitInForce, setSystemDefaultAloneLimit, SYSTEM_DEFAULT_LABEL } from "../src/policy/aloneLimit.js";
import { loosens } from "../src/policy/rules.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { aloneLimit, setSetting } from "../src/world/settings.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const NOW = new Date("2026-11-20T10:00:00Z");
const LIMIT = { currency: "EUR", amount: "500.00" };
let tickets = 0;
let counter = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: NOW.toISOString() });

async function enrol(db: DB): Promise<FakeAuthenticator> {
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, NOW);
  expect((await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, NOW)).status).toBe("pending");
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), NOW);
  return phone;
}
const signWith = (phone: FakeAuthenticator, id: string, hash: string) =>
  item("assertion", { proposal_id: id, terms_sha256: hash, credential: phone.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter }) }, id);
function invoice(db: DB, amount: string): { id: string; hash: string } {
  const id = nextProposalId(db);
  const terms = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: "2026-11-20T11:00:00Z", amount, currency: "EUR", vendor: "Bergtex Textil GmbH" } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return { id, hash: termsHash(terms) };
}
const alone = (db: DB, id: string) => approveWithinLimit(db, { proposalId: id, limit: LIMIT, rule: "within the EUR 500.00 limit", agent: "payer" }, NOW);
const message = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as Error).message; } };

describe("the limit to pay alone is signed policy, or a labelled system default (finding 7)", () => {
  it("a setting written into the ledger by hand is no limit: nothing is paid alone on it", () => {
    const db = openDb(":memory:");
    setSetting(db, "system", "ap.alone_eur", "500.00", NOW);
    expect(aloneLimit(db)).toBeNull();
    const p = invoice(db, "120.00");
    expect(alone(db, p.id)).toMatchObject({ ok: false, reason: expect.stringMatching(/no limit to pay alone is in force/) });
  });

  it("a test company's default counts, labelled as one in the record, and its payments run", () => {
    const db = openDb(":memory:");
    expect(setSystemDefaultAloneLimit(db, "500.00", NOW)).toBe(true);
    expect(setSystemDefaultAloneLimit(db, "500.00", NOW)).toBe(false); // once
    expect(aloneLimit(db)).toEqual(LIMIT);
    expect(aloneLimitInForce(db)?.source).toEqual({ kind: "system_default", label: SYSTEM_DEFAULT_LABEL });
    const p = invoice(db, "120.00");
    expect(alone(db, p.id)).toEqual({ ok: true });
    const row = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'proposal.within_limit'").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(row).toMatchObject({ limit: "EUR 500.00", limit_source: SYSTEM_DEFAULT_LABEL });
    expect(beginExecution<Terms & { amount: string }>(db, p.id, () => {}, NOW).amount).toBe("120.00");
    // Changed by hand afterwards, the default no longer counts.
    setSetting(db, "human", "ap.alone_eur", "5000.00", NOW);
    expect(aloneLimit(db)).toBeNull();
  });

  it("the CFO sets it with a policy change signed with the passkey; raising it loosens the policy", async () => {
    expect(loosens({ key: "ap.alone_eur", from: "", to: "500.00" })).toBe(true);
    expect(loosens({ key: "ap.alone_eur", from: "500.00", to: "800.00" })).toBe(true);
    expect(loosens({ key: "ap.alone_eur", from: "500.00", to: "100.00" })).toBe(false);
    expect(loosens({ key: "ap.alone_eur", from: "500.00", to: "" })).toBe(false);
    const db = openDb(":memory:");
    const max = await enrol(db);
    const change = proposePolicyChange(db, { changes: [{ key: "ap.alone_eur", to: "500.00" }], reason: "the agent pays small invoices alone" }, "human", NOW);
    expect((await processAssertion(db, signWith(max, change.proposal_id, change.terms_sha256), NOW)).status).toBe("approved");
    executePolicyChange(db, change.proposal_id, NOW);
    expect(aloneLimitInForce(db)?.source).toEqual({ kind: "signed", proposal_id: change.proposal_id });
    const p = invoice(db, "500.00");
    expect(alone(db, p.id)).toEqual({ ok: true });
    expect(beginExecution<Terms & { amount: string }>(db, p.id, () => {}, NOW).amount).toBe("500.00");
    // verify: the payment within the limit is no alarm; it names the signed source.
    const checks = approvalMethodChecks(db);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.what === `approval ${p.id}`)?.detail).toMatch(new RegExp(`within EUR 500.00, signed by the CFO with the passkey \\(${change.proposal_id}\\)`));
  });

  it("verify: no false alarm for a payment within a system default after a passkey is enrolled; a forged policy approval still fails", async () => {
    const db = openDb(":memory:");
    setSystemDefaultAloneLimit(db, "500.00", NOW);
    await enrol(db);
    const good = invoice(db, "120.00");
    expect(alone(db, good.id)).toEqual({ ok: true });
    const forged = invoice(db, "9999.00");
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'Purser''s code', 'policy', ?, ?)").run(forged.id, forged.hash, forged.hash.slice(0, 8), NOW.toISOString());
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(forged.id);
    const checks = approvalMethodChecks(db);
    expect(checks.find((c) => c.what === `approval ${good.id}`)).toMatchObject({ ok: true, detail: expect.stringContaining(SYSTEM_DEFAULT_LABEL) });
    expect(checks.find((c) => c.what === `approval ${forged.id}`)).toMatchObject({ ok: false, detail: expect.stringMatching(/no proposal.within_limit record/) });
    expect(message(() => beginExecution(db, forged.id, () => {}, NOW))).toMatch(/no proposal.within_limit record/);
    expect(beginExecution<Terms & { amount: string }>(db, good.id, () => {}, NOW).amount).toBe("120.00");
  });

  it("a policy approval whose limit was a hand-written setting is refused at execution", () => {
    const db = openDb(":memory:");
    const p = invoice(db, "120.00");
    // As the code wrote it before: within the limit given, on a setting nobody signed.
    setSetting(db, "system", "ap.alone_eur", "500.00", NOW);
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'Purser''s code', 'policy', ?, ?)").run(p.id, p.hash, p.hash.slice(0, 8), NOW.toISOString());
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(p.id);
    audit(db, "system", "proposal.within_limit", p.id, { terms_sha256: p.hash, limit: "EUR 500.00" }, NOW);
    expect(message(() => beginExecution(db, p.id, () => {}, NOW))).toMatch(/no limit to pay alone was in force then/);
  });
});
