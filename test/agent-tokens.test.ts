// Each agent's payment credential as a token bound to its mandate (src/policy/agentTokens.ts): within the mandate the
// card's purchase window opens for that one charge and Airwallex decides; outside it, or once the agent is revoked,
// Purser refuses before any call to Airwallex, and the card itself is frozen at Airwallex for anyone holding its
// number. Against the in-memory Issuing stand-in (src/redteam/issuing.ts); no network.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { cardOf, setupCards } from "../src/policy/cards.js";
import { checkToken, issueToken, mandateHash, payWithToken, tokenView } from "../src/policy/agentTokens.js";
import { revokePrincipal } from "../src/policy/principals.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const at = new Date("2026-11-21T10:00:00Z");
const helpdesk = { amountCents: 125, currency: "EUR", merchant: "Replyhub", mcc: "7372" };
let db: DB;
let awx: FakeIssuing;
const events = (e: string) => db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as Record<string, unknown>);

beforeEach(async () => {
  db = openDb(":memory:");
  awx = new FakeIssuing();
  awx.clock = () => at.getTime();
  await setupCards(db, awx, at);
});

describe("an agent's token", () => {
  it("is bound to a mandate made from the CFO's policy for that agent and its own card; the ledger keeps only its hash", () => {
    const t = issueToken(db, "support", at, "max");
    expect(t.token).toMatch(/^ptok_[0-9a-f]{40}$/);
    expect(t.mandate).toMatchObject({ agent: "support", card_id: cardOf(db, "support")!.card_id, currency: "EUR", per_purchase_cents: 6000, monthly_cents: 15000, mccs: ["7372"] });
    expect(t.mandate_sha256).toBe(mandateHash(t.mandate));
    expect(Date.parse(t.mandate.expires_at) - at.getTime()).toBe(30 * 86_400_000);
    // The token itself is nowhere in the ledger: not in the token table, not in the audit log.
    const dump = JSON.stringify([db.prepare("SELECT * FROM agent_tokens").all(), db.prepare("SELECT * FROM audit_log").all()]);
    expect(dump).not.toContain(t.token);
    expect(events("agent_token.issued")).toEqual([expect.objectContaining({ token_id: t.token_id, token_last4: t.token.slice(-4), mandate_sha256: t.mandate_sha256 })]);
    expect(tokenView(db, "support")).toEqual([expect.objectContaining({ token_id: t.token_id, status: "active", card_last4: cardOf(db, "support")!.last4 })]);
  });

  it("pays within its mandate: the card is thawed for that one charge, Airwallex approves, and the card is frozen again", async () => {
    const t = issueToken(db, "support", at);
    const r = await payWithToken(db, awx, t.token, helpdesk, at);
    expect(r).toMatchObject({ ok: true, agent: "support", token_id: t.token_id });
    expect(r.ok && r.tx.approved).toBe(true);
    expect(awx.calls.slice(-3)).toEqual(["setCardStatus", "charge", "setCardStatus"]);
    expect(cardOf(db, "support")!.status).toBe("INACTIVE");
    expect(events("agent_token.used")).toEqual([expect.objectContaining({ token_id: t.token_id, approved: true, amount: "1.25", mandate_sha256: t.mandate_sha256 })]);
    expect(events("card.charge_approved")).toHaveLength(1);
  });

  it("is refused outside its mandate before any call to Airwallex: too much, another category, another currency, past the month", async () => {
    const t = issueToken(db, "support", at);
    const before = awx.calls.length;
    const cases: [typeof helpdesk, string][] = [
      [{ ...helpdesk, amountCents: 6001 }, "OVER_PER_PURCHASE"],
      [{ ...helpdesk, mcc: "5734", merchant: "Packwise" }, "MCC_NOT_ALLOWED"],
      [{ ...helpdesk, currency: "USD" }, "CURRENCY_NOT_ALLOWED"],
      [{ ...helpdesk, amountCents: 0 }, "OVER_PER_PURCHASE"],
    ];
    for (const [p, code] of cases) expect(await payWithToken(db, awx, t.token, p, at)).toMatchObject({ ok: false, code });
    expect(await payWithToken(db, awx, `ptok_${"0".repeat(40)}`, helpdesk, at)).toMatchObject({ ok: false, code: "TOKEN_UNKNOWN", token_id: null });
    expect(await payWithToken(db, awx, "a card number, not a token", helpdesk, at)).toMatchObject({ ok: false, code: "TOKEN_UNKNOWN" });
    expect(awx.calls.length).toBe(before);
    expect(events("agent_token.refused").map((e) => [e.code, e.airwallex_calls])).toEqual([["OVER_PER_PURCHASE", 0], ["MCC_NOT_ALLOWED", 0], ["CURRENCY_NOT_ALLOWED", 0], ["OVER_PER_PURCHASE", 0], ["TOKEN_UNKNOWN", 0], ["TOKEN_UNKNOWN", 0]]);
    // The month: 15,000 cents; two purchases of 60.00 leave 30.00, so a third of 60.00 is refused.
    expect((await payWithToken(db, awx, t.token, { ...helpdesk, amountCents: 6000 }, at)).ok).toBe(true);
    expect((await payWithToken(db, awx, t.token, { ...helpdesk, amountCents: 6000 }, at)).ok).toBe(true);
    expect(await payWithToken(db, awx, t.token, { ...helpdesk, amountCents: 6000 }, at)).toMatchObject({ ok: false, code: "OVER_MONTH" });
    expect(checkToken(db, t.token, { ...helpdesk, amountCents: 3000 }, at).ok).toBe(true);
  });

  it("follows the CFO's policy as it stands now: a limit lowered after issue is the one that holds", () => {
    const t = issueToken(db, "support", at);
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('card.support.per_tx', '10.00', ?)").run(at.toISOString());
    expect(checkToken(db, t.token, { ...helpdesk, amountCents: 1001 }, at)).toMatchObject({ ok: false, code: "OVER_PER_PURCHASE" });
    expect(checkToken(db, t.token, { ...helpdesk, amountCents: 1000 }, at).ok).toBe(true);
  });

  it("expires, and is useless once its card is replaced", () => {
    const t = issueToken(db, "support", at);
    expect(checkToken(db, t.token, helpdesk, new Date(at.getTime() + 31 * 86_400_000))).toMatchObject({ ok: false, code: "TOKEN_EXPIRED" });
    db.prepare("UPDATE cards SET card_id = 'another-card' WHERE agent = 'support'").run();
    expect(checkToken(db, t.token, helpdesk, at)).toMatchObject({ ok: false, code: "CARD_NOT_MANDATES" });
  });

  it("dies with its agent: revoking the agent revokes the token at once, and the card refuses a thief too", async () => {
    const t = issueToken(db, "support", at);
    const other = issueToken(db, "sourcing", at);
    revokePrincipal(db, "support", "machine reported lost", "max", at);
    expect(tokenView(db, "support")[0]).toMatchObject({ status: "revoked" });
    expect(events("agent_token.revoked")).toEqual([expect.objectContaining({ token_id: t.token_id, by: "max", why: "the agent was revoked: machine reported lost" })]);
    const before = awx.calls.length;
    expect(await payWithToken(db, awx, t.token, helpdesk, at)).toMatchObject({ ok: false, code: "TOKEN_REVOKED" });
    expect(awx.calls.length).toBe(before);
    // Whoever holds the card's number instead meets a frozen card at Airwallex.
    const leaked = await awx.simulateCardCharge({ cardId: cardOf(db, "support")!.card_id, ...helpdesk, currency: "EUR" });
    expect(leaked).toMatchObject({ approved: false, failureReason: "CARD_INACTIVE" });
    // The other agents carry on.
    expect((await payWithToken(db, awx, other.token, { amountCents: 100, currency: "EUR", merchant: "Packwise", mcc: "5734" }, at)).ok).toBe(true);
    // A revoked agent gets no new token.
    expect(() => issueToken(db, "support", at)).toThrow(/may not pay now/);
  });

  it("is refused while the agent is paused, without revoking it", async () => {
    const t = issueToken(db, "support", at);
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('pause.support', 'on', ?)").run(at.toISOString());
    const c = checkToken(db, t.token, helpdesk, at);
    if (c.ok) throw new Error("a paused agent's token paid");
    expect(c.code).toBe("AGENT_NOT_ALLOWED");
    expect(tokenView(db, "support")[0]!.status).toBe("active");
  });
});
