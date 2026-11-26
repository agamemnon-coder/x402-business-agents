// Per-agent card governance (Airwallex, "Agentic banking starts with governance": each agent its own card with "budget
// limits, permitted currencies, merchant category codes, and time windows", and every transaction connected back to
// the agent, the task and the policy behind it). The limits, merchant categories and currencies are Airwallex controls
// on the card; the hours are Purser's own (Airwallex Issuing has no recurring time window), enforced by refusing
// Purser's purchases outside them and by freezing the card at Airwallex when they end. Loosening any of them needs the
// CFO's passkey signature, checked again at the card; tightening takes effect at once. The issuing rail is the
// in-memory stand-in (src/redteam/issuing.ts); the passkey is a virtual test authenticator. 0 network, test money.
import { beforeEach, describe, expect, it } from "vitest";
import { buyPlan } from "../src/agents/cardBuyer.js";
import { openDb, type DB } from "../src/db/open.js";
import { applyPolicyChanges, executePolicyChange, proposePolicyChange, type PolicyChangeTerms } from "../src/executors/policyChange.js";
import { cardOf, chargeInWindow, ingestCardTransaction, openCardWindow, setupCards, syncCards, syncCardsAfterPolicy, syncCardsIfChanged, wantCardStatus } from "../src/policy/cards.js";
import { cardHoursRefusal, effectiveCardHours } from "../src/policy/cardHoursGate.js";
import { issueToken, payWithToken } from "../src/policy/agentTokens.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { IssuingRest } from "../src/airwallex/issuing.js";
import { cardMetadata } from "../src/airwallex/cardBody.js";

const OFFICE = "Mon-Fri 08:00-18:00 Europe/Amsterdam";
/** Thursday 26 November 2026, 11:00 in Amsterdam (UTC+1): inside office hours. */
const THU = new Date("2026-11-26T10:00:00Z");
/** The same Thursday, 17:59 and 18:00:30 in Amsterdam: the last minute of the hours, and just after. */
const THU_1759 = new Date("2026-11-26T16:59:00Z");
const THU_1800 = new Date("2026-11-26T17:00:30Z");
/** Saturday 28 November, 11:00 in Amsterdam: outside office hours. */
const SAT = new Date("2026-11-28T10:00:00Z");

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
let n = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null, at: Date): InboxItem =>
  ({ ticket: `gov-${++n}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: at.toISOString() });

async function enrol(db: DB, at: Date): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, at);
  const reg = await processRegistration(db, item("registration", { code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }, null, at), { label: "max" }, at);
  if (reg.status !== "pending") throw new Error(`could not enrol: ${reg.message}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), at);
  return auth;
}
const hashOf = (db: DB, id: string) => (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }).terms_sha256;
/** A policy change the CFO signs with the passkey, executed and pushed to the cards as the runner does it. */
async function signedChange(db: DB, awx: FakeIssuing, auth: FakeAuthenticator, changes: { key: string; to: string }[], at: Date): Promise<string> {
  const p = proposePolicyChange(db, { changes, reason: "test" }, "human", at);
  const out = await processAssertion(db, item("assertion", { proposal_id: p.proposal_id, terms_sha256: hashOf(db, p.proposal_id), credential: auth.sign({ challenge: challengeFor(hashOf(db, p.proposal_id)), origin: ORIGIN, rpId: RP, counter: ++n }) }, p.proposal_id, at), at);
  if (out.status !== "approved") throw new Error(`not approved: ${out.message}`);
  executePolicyChange(db, p.proposal_id, at);
  await syncCardsAfterPolicy(db, p.proposal_id, awx, at);
  return p.proposal_id;
}
/** A policy change applied with nobody's signature, as decision code forced past every guard would apply it. */
async function forcedChange(db: DB, awx: FakeIssuing, changes: { key: string; to: string }[], at: Date): Promise<void> {
  const p = proposePolicyChange(db, { changes, reason: "forced" }, "human", at);
  db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(p.proposal_id);
  applyPolicyChanges(db, p.proposal_id, JSON.parse(p.terms_json) as PolicyChangeTerms, at);
  await syncCardsAfterPolicy(db, p.proposal_id, awx, at);
}
/** A value written straight into the settings table: no proposal, no approval. */
const setRow = (db: DB, key: string, value: string, at: Date) =>
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, at.toISOString());
const events = (db: DB, event: string) =>
  (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const atAwx = (awx: FakeIssuing, db: DB, agent = "sourcing") => awx.cards.find((c) => c.cardId === cardOf(db, agent)!.card_id)!;
const heldHolds = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM holds WHERE status = 'HELD'").get() as { n: number }).n;

describe("per-agent card governance", () => {
  let db: DB;
  let awx: FakeIssuing;
  let cfo: FakeAuthenticator;
  const at = (d: Date) => { awx.clock = () => d.getTime(); return d; };
  beforeEach(async () => {
    db = openDb(":memory:");
    awx = new FakeIssuing();
    at(THU);
    cfo = await enrol(db, THU);
    await setupCards(db, awx, THU);
    expect(atAwx(awx, db).status).toBe("INACTIVE");
  });

  describe("card hours: enforced by Purser (Airwallex has no recurring time window)", () => {
    it("refuses a purchase Purser would start outside the hours, before anything reaches Airwallex; tightening counts at once", async () => {
      // Setting hours where there were none tightens the policy: no signature needed, and no card sync either.
      setRow(db, "card.sourcing.hours", OFFICE, THU);
      expect(effectiveCardHours(db, "sourcing")).toBe(OFFICE);
      awx.calls = [];
      await expect(buyPlan(db, awx, "packwise-starter", at(SAT))).rejects.toThrow(/^outside_card_hours: .*Mon-Fri 08:00-18:00 Europe\/Amsterdam.*Sat 11:00/);
      expect(awx.calls).toEqual([]);
      expect(heldHolds(db)).toBe(0);
      expect(events(db, "card.purchase_started")).toEqual([]);
      expect(events(db, "card.purchase_refused")).toMatchObject([{ agent: "sourcing", reason: expect.stringMatching(/outside_card_hours/), hours: OFFICE, enforced_by: "Purser (Airwallex has no recurring time window)" }]);
      // Every other way Purser starts a card purchase is refused the same way.
      await expect(chargeInWindow(db, awx, "sourcing", { cardId: cardOf(db, "sourcing")!.card_id, amountCents: 100, currency: "EUR", merchant: "Packwise", mcc: "5734" }, SAT)).rejects.toThrow(/outside_card_hours/);
      expect(awx.calls).toEqual([]);
      // Inside the hours the same purchase goes through.
      const t = await buyPlan(db, awx, "packwise-starter", at(THU));
      expect(t).toMatchObject({ approved: true });
    });

    it("leaves the other agents' cards alone, and a task card keeps its own validity", async () => {
      setRow(db, "card.sourcing.hours", OFFICE, THU);
      expect(cardHoursRefusal(db, "sourcing", SAT)).toMatch(/outside_card_hours/);
      expect(cardHoursRefusal(db, "support", SAT)).toBeNull();
      expect(cardHoursRefusal(db, "task:abc", SAT)).toBeNull();
      expect((await buyPlan(db, awx, "replyhub-starter", at(SAT))).approved).toBe(true);
    });

    it("freezes a card thawed for a purchase at Airwallex when the hours end, and opens no window after", async () => {
      setRow(db, "card.sourcing.hours", OFFICE, THU);
      const card = cardOf(db, "sourcing")!;
      expect(await openCardWindow(db, awx, "sourcing", { amountCents: 500, merchant: "Packwise", why: "a purchase in the last minute" }, at(THU_1759))).not.toBeNull();
      expect(atAwx(awx, db).status).toBe("ACTIVE");
      expect(wantCardStatus(db, "sourcing", THU_1759)).toBe("ACTIVE");
      // The runner's check every few seconds, just after 18:00 in Amsterdam: the window is closed and the card frozen.
      expect(wantCardStatus(db, "sourcing", THU_1800)).toBe("INACTIVE");
      expect(await syncCardsIfChanged(db, awx, at(THU_1800))).toEqual(["sourcing"]);
      expect(atAwx(awx, db).status).toBe("INACTIVE");
      expect(events(db, "card.window_closed").at(-1)).toMatchObject({ agent: "sourcing", why: expect.stringMatching(/hours ended/) });
      expect(events(db, "card.frozen").at(-1)).toMatchObject({ agent: "sourcing", why: expect.stringMatching(/outside its hours/) });
      // No window opens outside the hours, and a merchant charging the card by itself meets a frozen card: Airwallex declines.
      expect(await openCardWindow(db, awx, "sourcing", { amountCents: 500, merchant: "Packwise", why: "late" }, THU_1800)).toBeNull();
      expect(atAwx(awx, db).status).toBe("INACTIVE");
      const merchant = await awx.simulateCardCharge({ cardId: card.card_id, amountCents: 500, currency: "EUR", merchant: "Packwise", mcc: "5734" });
      expect(merchant).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
      // The next morning nothing is thawed by the hours alone: the card stays frozen until Purser opens a window for a purchase.
      expect(wantCardStatus(db, "sourcing", new Date("2026-11-27T08:00:00Z"))).toBe("INACTIVE");
    });

    it("widens the hours only on the CFO's passkey: unsigned, the narrower hours stay and the refusal is recorded once", async () => {
      await signedChange(db, awx, cfo, [{ key: "card.sourcing.hours", to: OFFICE }], THU);
      expect(cardOf(db, "sourcing")!.hours).toBe(OFFICE);
      // Written straight into the settings: refused, recorded once, and the card's hours are what was signed.
      setRow(db, "card.sourcing.hours", "", THU);
      expect(effectiveCardHours(db, "sourcing")).toBe(OFFICE);
      awx.calls = [];
      expect(await syncCardsIfChanged(db, awx, THU)).toEqual([]);
      expect(await syncCardsIfChanged(db, awx, THU)).toEqual([]);
      expect(awx.calls).toEqual([]);
      expect(events(db, "card.loosening_refused")).toMatchObject([{ agent: "sourcing", key: "card.sourcing.hours", wanted: "any time (no hours set)", kept: OFFICE }]);
      await expect(buyPlan(db, awx, "packwise-starter", at(SAT))).rejects.toThrow(/outside_card_hours/);
      // Applied as a policy change nobody signed: still refused at the card.
      await forcedChange(db, awx, [{ key: "card.sourcing.hours", to: "Mon-Sun 08:00-18:00 Europe/Amsterdam" }], THU);
      expect(effectiveCardHours(db, "sourcing")).toBe(OFFICE);
      await expect(buyPlan(db, awx, "packwise-starter", at(SAT))).rejects.toThrow(/outside_card_hours/);
      // Signed with the CFO's passkey: the weekend is open. (The settings row still holds the forced value, which the
      // card never took; the CFO first puts back the hours in force, a tightening, then signs the wider ones.)
      setRow(db, "card.sourcing.hours", OFFICE, THU);
      await signedChange(db, awx, cfo, [{ key: "card.sourcing.hours", to: "Mon-Sun 08:00-18:00 Europe/Amsterdam" }], THU);
      expect(effectiveCardHours(db, "sourcing")).toBe("Mon-Sun 08:00-18:00 Europe/Amsterdam");
      expect((await buyPlan(db, awx, "packwise-starter", at(SAT))).approved).toBe(true);
    });

    it("refuses a token purchase outside the hours with its own code, before Airwallex", async () => {
      setRow(db, "card.sourcing.hours", OFFICE, THU);
      const { token } = issueToken(db, "sourcing", THU);
      awx.calls = [];
      const r = await payWithToken(db, awx, token, { amountCents: 1000, currency: "EUR", merchant: "Packwise", mcc: "5734" }, at(SAT));
      expect(r).toMatchObject({ ok: false, code: "OUTSIDE_CARD_HOURS" });
      expect(awx.calls).toEqual([]);
    });
  });

  describe("merchant categories and currencies: Airwallex controls, set from the CFO policy", () => {
    it("adds a merchant category only on the CFO's passkey; removing one reaches the card at once", async () => {
      expect(atAwx(awx, db).controls?.mccs).toEqual(["5734"]);
      setRow(db, "card.sourcing.mccs", "5734,7372", THU);
      awx.calls = [];
      expect(await syncCardsIfChanged(db, awx, THU)).toEqual([]);
      await syncCards(db, awx, THU);
      expect(awx.calls.filter((c) => c === "setCardControls")).toEqual([]);
      expect(atAwx(awx, db).controls?.mccs).toEqual(["5734"]);
      expect(events(db, "card.loosening_refused")).toMatchObject([{ agent: "sourcing", key: "card.sourcing.mccs", wanted: "5734,7372", kept: "5734" }]);
      // Airwallex itself declines the category the CFO did not sign for.
      const declined = await chargeInWindow(db, awx, "sourcing", { cardId: cardOf(db, "sourcing")!.card_id, amountCents: 100, currency: "EUR", merchant: "Replyhub", mcc: "7372" }, THU);
      expect(declined).toMatchObject({ approved: false, failureReason: "MERCHANT_CATEGORY_NOT_ALLOWED" });
      setRow(db, "card.sourcing.mccs", "5734", THU);
      await signedChange(db, awx, cfo, [{ key: "card.sourcing.mccs", to: "5734,7372" }], THU);
      expect(atAwx(awx, db).controls?.mccs).toEqual(["5734", "7372"]);
      const ok = await chargeInWindow(db, awx, "sourcing", { cardId: cardOf(db, "sourcing")!.card_id, amountCents: 100, currency: "EUR", merchant: "Replyhub", mcc: "7372" }, THU);
      expect(ok.approved).toBe(true);
      // Removing one is a tightening: with no signature that verifies, it still reaches the card with the policy change.
      await forcedChange(db, awx, [{ key: "card.sourcing.mccs", to: "7372" }], THU);
      expect(atAwx(awx, db).controls?.mccs).toEqual(["7372"]);
      // The cheap check every few seconds compares limits and status only; the full sync reads the controls back.
      atAwx(awx, db).controls!.mccs = ["5734", "7372"];
      expect(await syncCards(db, awx, THU)).toEqual(["sourcing"]);
      expect(atAwx(awx, db).controls?.mccs).toEqual(["7372"]);
    });

    it("adds a currency only on the CFO's passkey", async () => {
      await forcedChange(db, awx, [{ key: "card.sourcing.currencies", to: "EUR,USD" }], THU);
      expect(atAwx(awx, db).controls?.currencies).toEqual(["EUR"]);
      expect(events(db, "card.loosening_refused")).toMatchObject([{ key: "card.sourcing.currencies", wanted: "EUR,USD", kept: "EUR" }]);
      setRow(db, "card.sourcing.currencies", "EUR", THU);
      await signedChange(db, awx, cfo, [{ key: "card.sourcing.currencies", to: "EUR,USD" }], THU);
      expect(atAwx(awx, db).controls?.currencies).toEqual(["EUR", "USD"]);
    });
  });

  describe("every card transaction carries its agent, its purpose and the policy version that allowed it", () => {
    const row = (id: string) => db.prepare("SELECT agent, purpose, policy_version FROM card_transactions WHERE transaction_id = ?").get(id);
    const latestVersion = () => (db.prepare("SELECT MAX(version) AS v FROM policy_versions").get() as { v: number }).v;

    it("a purchase Purser makes, and the card at Airwallex names agent, task and policy version in its metadata", async () => {
      // Issued with its agent and the policy version it was issued under.
      expect(atAwx(awx, db).metadata).toEqual({ agent_id: "sourcing", policy_version: expect.stringMatching(/^v\d+$/) });
      const t = await buyPlan(db, awx, "packwise-starter", at(THU));
      const v = latestVersion();
      // The thaw for the purchase wrote the task and the policy version it is allowed under.
      expect(atAwx(awx, db).metadata).toEqual({ agent_id: "sourcing", task_id: "Packwise, Starter plan, monthly", policy_version: `v${v}` });
      expect(v).toBeGreaterThan(0);
      expect(row(t.transactionId)).toEqual({ agent: "sourcing", purpose: "Packwise, Starter plan, monthly", policy_version: v });
      expect(events(db, "card.charge_approved").at(-1)).toMatchObject({ agent: "sourcing", purpose: "Packwise, Starter plan, monthly", policy_version: v });
      expect(events(db, "card.window_opened").at(-1)).toMatchObject({ agent: "sourcing", policy_version: v });
    });

    it("an authorisation the webhook brings later keeps the purchase window's purpose and policy version", async () => {
      const card = cardOf(db, "sourcing")!;
      await openCardWindow(db, awx, "sourcing", { amountCents: 700, merchant: "Packwise", why: "Packwise add-on, the CFO's task 42" }, at(THU));
      const v = latestVersion();
      const t = await awx.simulateCardCharge({ cardId: card.card_id, amountCents: 700, currency: "EUR", merchant: "Packwise", mcc: "5734" });
      // The policy changes before the webhook arrives: the charge still names the version its window was opened under.
      setRow(db, "card.sourcing.per_tx", "20.00", THU);
      ingestCardTransaction(db, t, "webhook", new Date(THU.getTime() + 5_000));
      expect(row(t.transactionId)).toEqual({ agent: "sourcing", purpose: "Packwise add-on, the CFO's task 42", policy_version: v });
    });

    it("an authorisation Purser did not expect names no purpose and the version in force when it was seen", async () => {
      const card = cardOf(db, "sourcing")!;
      atAwx(awx, db).status = "ACTIVE";
      const t = await awx.simulateCardCharge({ cardId: card.card_id, amountCents: 300, currency: "EUR", merchant: "Somewhere", mcc: "5734" });
      setRow(db, "card.sourcing.per_tx", "20.00", THU);
      ingestCardTransaction(db, t, "poll", THU);
      expect(row(t.transactionId)).toEqual({ agent: "sourcing", purpose: null, policy_version: latestVersion() });
      expect(events(db, "card.unexpected_authorization")).toHaveLength(1);
    });
  });
});

describe("the Issuing adapter sends the card metadata Airwallex documents (Create a card / Update a card: metadata)", () => {
  it("on create and with the thaw, in the same card update as the status", async () => {
    const sent: { method: string; path: string; body: unknown }[] = [];
    const card = {
      card_id: "c1", cardholder_id: "h1", card_status: "ACTIVE", nick_name: "n", metadata: { agent_id: "sourcing", task_id: "t", policy_version: "v3", other: 1 },
      authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 30, interval: "PER_TRANSACTION" }, { amount: 100, interval: "MONTHLY" }] } },
    };
    const api = { call: async (method: string, path: string, body?: unknown) => { sent.push({ method, path, body }); return card; } };
    const rail = new IssuingRest(api as never, () => {});
    const meta = cardMetadata({ agentId: "sourcing", taskId: "Packwise, Starter plan, monthly", policyVersion: 3 });
    await rail.createCard({ cardholderId: "h1", nickname: "n", createdBy: "x", limits: { currency: "EUR", perTxCents: 3000, monthlyCents: 10_000 }, metadata: meta });
    const thawed = await rail.setCardStatus("c1", "ACTIVE", meta);
    expect((sent[0]!.body as { metadata: unknown }).metadata).toEqual({ agent_id: "sourcing", task_id: "Packwise, Starter plan, monthly", policy_version: "v3" });
    expect(sent[1]).toEqual({ method: "POST", path: "/issuing/cards/c1/update", body: { card_status: "ACTIVE", metadata: meta } });
    // Read back as strings only; a status change without metadata sends none.
    expect(thawed.metadata).toEqual({ agent_id: "sourcing", task_id: "t", policy_version: "v3" });
    await rail.setCardStatus("c1", "INACTIVE");
    expect(sent.at(-2)!.body).toEqual({ card_status: "INACTIVE" });
    // Airwallex's documented bound: values up to 150 characters.
    expect(cardMetadata({ agentId: "sourcing", taskId: "x".repeat(400) }).task_id).toHaveLength(150);
  });
});
