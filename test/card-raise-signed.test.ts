// A card's limit goes UP at Airwallex only on a verified passkey signature over the exact new limit (security hardening,
// 19 November; before, docs/zero-trust.md listed it as an open risk: whoever controlled Purser's own decision code or
// the database file could raise it with Purser's own key and nobody's signature). Lowering stays free. The issuing rail
// is the in-memory stand-in; the passkeys are virtual test authenticators enrolled through the real enrolment. 0 network.
import { beforeEach, describe, expect, it } from "vitest";
import { proposeCardRaise } from "../src/agents/cardBuyer.js";
import { openDb, type DB } from "../src/db/open.js";
import { applyPolicyChanges, executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { cardOf, setupCards, syncCards, syncCardsAfterPolicy, syncCardsIfChanged } from "../src/policy/cards.js";
import { cardRaiseRefusal } from "../src/policy/cardRaise.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import type { PolicyChangeTerms } from "../src/executors/policyChange.js";

const now = new Date("2026-11-19T10:00:00Z");
const RP = "purser.example";
const ORIGIN = `https://${RP}`;
let n = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null): InboxItem =>
  ({ ticket: `raise-${++n}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: now.toISOString() });

async function enrol(db: DB): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const reg = await processRegistration(db, item("registration", { code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }, null), { label: "max" }, now);
  if (reg.status !== "pending") throw new Error(`could not enrol: ${reg.message}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}
const hashOf = (db: DB, id: string) => (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }).terms_sha256;
async function sign(db: DB, auth: FakeAuthenticator, id: string): Promise<void> {
  const out = await processAssertion(db, item("assertion", { proposal_id: id, terms_sha256: hashOf(db, id), credential: auth.sign({ challenge: challengeFor(hashOf(db, id)), origin: ORIGIN, rpId: RP, counter: ++n }) }, id), now);
  if (out.status !== "approved") throw new Error(`not approved: ${out.message}`);
}
/** A policy change the CFO signs with the passkey, executed and pushed to the card as the runner does it. */
async function signedChange(db: DB, awx: FakeIssuing, auth: FakeAuthenticator, changes: { key: string; to: string }[]): Promise<string> {
  const p = proposePolicyChange(db, { changes, reason: "test" }, "human", now);
  await sign(db, auth, p.proposal_id);
  executePolicyChange(db, p.proposal_id, now);
  await syncCardsAfterPolicy(db, p.proposal_id, awx, now);
  return p.proposal_id;
}
const setRow = (db: DB, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());
const sourcing = (awx: FakeIssuing, db: DB) => awx.cards.find((c) => c.cardId === cardOf(db, "sourcing")!.card_id)!.limits!;
const refusals = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'card.raise_refused' ORDER BY seq").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, string>);

describe("a card's limit goes up only on a verified passkey signature over the new limit", () => {
  let db: DB;
  let awx: FakeIssuing;
  let cfo: FakeAuthenticator;
  beforeEach(async () => {
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    cfo = await enrol(db);
    await setupCards(db, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000, monthlyCents: 10_000 });
  });

  it("pushes a raise the CFO signed with the passkey, exactly as signed", async () => {
    await signedChange(db, awx, cfo, [{ key: "card.sourcing.per_tx", to: "50.00" }, { key: "card.sourcing.monthly", to: "200.00" }]);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 5000, monthlyCents: 20_000 });
    expect(refusals(db)).toEqual([]);
  });

  it("refuses a raise written straight into the settings: the card keeps its limit, and the refusal is recorded once", async () => {
    setRow(db, "card.sourcing.per_tx", "1000.00");
    awx.calls = [];
    expect(await syncCardsIfChanged(db, awx, now)).toEqual([]);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000 });
    expect(awx.calls.filter((c) => c.startsWith("setCardLimits"))).toEqual([]);
    expect(refusals(db)).toMatchObject([{ agent: "sourcing", key: "card.sourcing.per_tx", wanted: "1000.00", kept: "30.00" }]);
    // The runner's check every few seconds: no call to Airwallex, and no second record of the same refusal.
    awx.calls = [];
    expect(await syncCardsIfChanged(db, awx, now)).toEqual([]);
    expect(awx.calls).toEqual([]);
    await syncCards(db, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000 });
    expect(refusals(db)).toHaveLength(1);
    // A charge over the signed limit is still declined at Airwallex.
    const t = await awx.simulateCardCharge({ cardId: cardOf(db, "sourcing")!.card_id, amountCents: 50_000, currency: "EUR", merchant: "Packwise", mcc: "5734" });
    expect(t).toMatchObject({ approved: false, failureReason: "LIMIT_EXCEEDED" });
  });

  it("refuses a raise applied as a policy change nobody signed (the decision code forced to apply it)", async () => {
    const p = proposePolicyChange(db, { changes: [{ key: "card.sourcing.per_tx", to: "1000.00" }], reason: "forced" }, "human", now);
    // As the forced guard does it (test/zero-trust.test.ts): EXECUTING with no approval, then applied.
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p.proposal_id);
    applyPolicyChanges(db, p.proposal_id, JSON.parse(p.terms_json) as PolicyChangeTerms, now);
    await syncCardsAfterPolicy(db, p.proposal_id, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000 });
    expect(refusals(db)[0]).toMatchObject({ key: "card.sourcing.per_tx", wanted: "1000.00", proposal_id: p.proposal_id });
  });

  it("refuses a raise whose approval is on record as a passkey's but carries no signature that verifies", async () => {
    const p = proposePolicyChange(db, { changes: [{ key: "card.sourcing.per_tx", to: "1000.00" }], reason: "forged" }, "human", now);
    // An approval row with no stored signature, then one whose stored signature is the CFO's over other terms.
    db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'max (passkey)', 'passkey', '', ?)").run(p.proposal_id, p.terms_sha256, now.toISOString());
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(p.proposal_id);
    executePolicyChange(db, p.proposal_id, now);
    await syncCardsAfterPolicy(db, p.proposal_id, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000 });
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 100_000)).toMatch(/no passkey signature that verifies/);
    const other = proposePolicyChange(db, { changes: [{ key: "card.sourcing.per_tx", to: "40.00" }], reason: "small" }, "human", now);
    const resp = cfo.sign({ challenge: challengeFor(other.terms_sha256), origin: ORIGIN, rpId: RP, counter: ++n });
    db.prepare("INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?)")
      .run("f".repeat(64), p.proposal_id, resp.id, p.terms_sha256, JSON.stringify(resp), n, now.toISOString());
    expect(await cardRaiseRefusal(db, "sourcing", "per_tx", 100_000)).toMatch(/no passkey signature that verifies/);
  });

  it("refuses a replay: a raise signed earlier does not count once a later change set another value", async () => {
    await signedChange(db, awx, cfo, [{ key: "card.sourcing.per_tx", to: "50.00" }]);
    await signedChange(db, awx, cfo, [{ key: "card.sourcing.per_tx", to: "20.00" }]);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 2000 });
    setRow(db, "card.sourcing.per_tx", "50.00");
    await syncCardsIfChanged(db, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 2000 });
    expect(refusals(db)).toMatchObject([{ key: "card.sourcing.per_tx", wanted: "50.00", kept: "20.00" }]);
  });

  it("lowers freely, also unsigned, and lowers one limit while refusing to raise the other", async () => {
    setRow(db, "card.sourcing.per_tx", "10.00");
    expect(await syncCardsIfChanged(db, awx, now)).toEqual(["sourcing"]);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 1000, monthlyCents: 10_000 });
    setRow(db, "card.sourcing.per_tx", "5.00");
    setRow(db, "card.sourcing.monthly", "9000.00");
    await syncCardsIfChanged(db, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 500, monthlyCents: 10_000 });
    expect(refusals(db)).toMatchObject([{ key: "card.sourcing.monthly", wanted: "9000.00", kept: "100.00" }]);
  });

  it("brings a card lowered at Airwallex back up to the limits in the code, unsigned, and no higher", async () => {
    awx.cards.find((c) => c.cardId === cardOf(db, "sourcing")!.card_id)!.limits = { currency: "EUR", perTxCents: 100, monthlyCents: 100 };
    await syncCards(db, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000, monthlyCents: 10_000 });
    expect(refusals(db)).toEqual([]);
  });

  it("issues a new card at no more than the signed limits", async () => {
    const fresh = openDb(":memory:");
    await enrol(fresh);
    setRow(fresh, "card.support.per_tx", "900.00");
    const other = new FakeIssuing();
    other.clock = () => now.getTime();
    await setupCards(fresh, other, now);
    const support = other.cards.find((c) => c.cardId === cardOf(fresh, "support")!.card_id)!;
    expect(support.limits!.perTxCents).toBeLessThan(90_000);
    expect(refusals(fresh)).toMatchObject([{ agent: "support", key: "card.support.per_tx", wanted: "900.00" }]);
  });
});

describe("before any passkey is enrolled (local dev: approvals by typed hash prefix)", () => {
  it("pushes a raise approved on record for its exact terms, and refuses one applied with no approval", async () => {
    const db = openDb(":memory:");
    const awx = new FakeIssuing();
    awx.clock = () => now.getTime();
    await setupCards(db, awx, now);
    const forced = proposePolicyChange(db, { changes: [{ key: "card.sourcing.per_tx", to: "1000.00" }], reason: "forced" }, "human", now);
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(forced.proposal_id);
    applyPolicyChanges(db, forced.proposal_id, JSON.parse(forced.terms_json) as PolicyChangeTerms, now);
    await syncCardsAfterPolicy(db, forced.proposal_id, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 3000 });
    const p = proposeCardRaise(db, "sourcing", { perTx: "50.00" }, "the Pro plan costs 45.00 EUR", now);
    decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
    executePolicyChange(db, p.proposal_id, now);
    await syncCardsAfterPolicy(db, p.proposal_id, awx, now);
    expect(sourcing(awx, db)).toMatchObject({ perTxCents: 5000 });
  });
});
