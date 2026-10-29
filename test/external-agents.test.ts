// P1: an outside AI agent connects through the agent API. It may ask for a company card, but gets one only after the
// CFO approves with Face ID; from then on the CFO policy holds its card's limits, Airwallex declines the rest, a raise
// is a proposal, and the emergency stop freezes its card with all the others.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange } from "../src/executors/policyChange.js";
import { decide } from "../src/policy/approvals.js";
import { cardRows, syncCardsAfterPolicy } from "../src/policy/cards.js";
import { policyValue } from "../src/policy/rules.js";
import { agentId, cardStatus, executeAgentOnboard, payWithCard, requestCardRaise, requestCompanyCard } from "../src/platform/externalAgents.js";
import { FakeIssuing } from "./fakes/issuing.js";

const now = new Date("2026-11-03T10:00:00Z");
const approve = (db: DB, id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
};
const ME = agentId("acme-research");
const ASK = { displayName: "Acme Research agent", purpose: "buys market reports for the research desk", perTx: "25.00", monthly: "100.00" };

describe("outside agents (P1)", () => {
  let db: DB;
  let awx: FakeIssuing;
  beforeEach(() => {
    db = openDb(":memory:");
    awx = new FakeIssuing();
    awx.clock = () => now.getTime();
  });

  it("names an outside agent safely", () => {
    expect(agentId("acme-research")).toBe("ext:acme-research");
    for (const bad of ["", "Acme", "a", "x".repeat(40), "../etc", "acme research", "sourcing"]) expect(() => agentId(bad)).toThrow();
  });

  it("asks for a card; nothing is issued until the CFO approves with Face ID", async () => {
    const p = requestCompanyCard(db, ME, ASK, now);
    expect(p.kind).toBe("agent_onboard");
    expect(p.created_by).toBe(ME);
    expect(JSON.parse(p.terms_json)).toMatchObject({ kind: "agent_onboard", agent_id: ME, display_name: ASK.displayName, purpose: ASK.purpose, card: { currency: "EUR", per_tx: "25.00", monthly: "100.00" } });
    expect(cardStatus(db, ME, now)).toMatchObject({ status: "REQUESTED", proposal_id: p.proposal_id, card: null });
    expect(awx.cards).toHaveLength(0);
    // Asking again while one waits is refused.
    expect(() => requestCompanyCard(db, ME, ASK, now)).toThrow(/already waiting/);
    // Unapproved, the executor refuses.
    await expect(executeAgentOnboard(db, awx, p.proposal_id, now)).rejects.toThrow(/not approved/);
    approve(db, p.proposal_id);
    await executeAgentOnboard(db, awx, p.proposal_id, now);
    expect(awx.cards).toHaveLength(1);
    expect(awx.cards[0]!.limits).toEqual({ currency: "EUR", perTxCents: 2500, monthlyCents: 10000 });
    const s = cardStatus(db, ME, now);
    expect(s).toMatchObject({ status: "ACTIVE", card: { last4: awx.cards[0]!.last4, per_tx: "25.00", monthly: "100.00", spent_this_month: "0.00", frozen: false } });
    // Its limits are now part of the CFO policy.
    expect(policyValue(db, `card.${ME}.per_tx`)).toBe("25.00");
    expect(cardRows(db).map((c) => c.agent)).toContain(ME);
    expect(() => requestCompanyCard(db, ME, ASK, now)).toThrow(/already has a company card/);
  });

  it("refuses limits outside what the policy allows, and empty or overlong words", () => {
    expect(() => requestCompanyCard(db, ME, { ...ASK, perTx: "2000.00" }, now)).toThrow(/at most 1000\.00/);
    expect(() => requestCompanyCard(db, ME, { ...ASK, perTx: "0.50" }, now)).toThrow(/at least 1\.00/);
    expect(() => requestCompanyCard(db, ME, { ...ASK, monthly: "10.00" }, now)).toThrow(/at least the per-purchase/);
    expect(() => requestCompanyCard(db, ME, { ...ASK, perTx: "25" }, now)).toThrow(/two decimals/);
    expect(() => requestCompanyCard(db, ME, { ...ASK, purpose: "" }, now)).toThrow(/purpose/);
    expect(() => requestCompanyCard(db, ME, { ...ASK, displayName: "x".repeat(61) }, now)).toThrow(/name/);
  });

  it("pays on its card; Airwallex declines over the limit; a raise is a proposal; the emergency stop freezes it", async () => {
    const p = requestCompanyCard(db, ME, ASK, now);
    approve(db, p.proposal_id);
    await executeAgentOnboard(db, awx, p.proposal_id, now);
    const ok = await payWithCard(db, awx, ME, { merchant: "Contoso Reports", amount: "19.00", description: "Q4 market report" }, now);
    expect(ok).toMatchObject({ approved: true });
    const no = await payWithCard(db, awx, ME, { merchant: "Contoso Reports", amount: "40.00", description: "Annual bundle" }, now);
    expect(no).toMatchObject({ approved: false });
    expect(cardStatus(db, ME, now).card).toMatchObject({ spent_this_month: "19.00" });
    expect(db.prepare("SELECT actor FROM audit_log WHERE event = 'card.charge_declined'").get()).toEqual({ actor: ME });

    const raise = requestCardRaise(db, ME, { perTx: "40.00" }, "the annual bundle is cheaper per report", now);
    expect(JSON.parse(raise.terms_json).changes).toEqual([expect.objectContaining({ key: `card.${ME}.per_tx`, from: "25.00", to: "40.00" })]);
    approve(db, raise.proposal_id);
    executePolicyChange(db, raise.proposal_id, now);
    await syncCardsAfterPolicy(db, raise.proposal_id, awx, now);
    expect(awx.cards[0]!.limits!.perTxCents).toBe(4000);

    const stop = (await import("../src/executors/policyChange.js")).proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "test" }, "human", now);
    approve(db, stop.proposal_id);
    executePolicyChange(db, stop.proposal_id, now);
    await syncCardsAfterPolicy(db, stop.proposal_id, awx, now);
    expect(awx.cards[0]!.status).toBe("INACTIVE");
    expect(cardStatus(db, ME, now).card).toMatchObject({ frozen: true });
  });

  it("cannot pay without an approved card, or for nothing", async () => {
    await expect(payWithCard(db, awx, ME, { merchant: "X", amount: "1.00", description: "d" }, now)).rejects.toThrow(/no company card/);
    const p = requestCompanyCard(db, ME, ASK, now);
    approve(db, p.proposal_id);
    await executeAgentOnboard(db, awx, p.proposal_id, now);
    await expect(payWithCard(db, awx, ME, { merchant: "X", amount: "0.00", description: "d" }, now)).rejects.toThrow(/more than 0/);
    await expect(payWithCard(db, awx, ME, { merchant: "", amount: "1.00", description: "d" }, now)).rejects.toThrow(/merchant/);
  });
});
