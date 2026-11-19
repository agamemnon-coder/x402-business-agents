// The pause's bookkeeping (src/policy/pause.ts): which revoked mandate a retried revoke found, which pauses were never
// revoked on chain, the credential a resume restores, what a resume carried off chain (and a row it cannot read), and
// the rules a rebalance after a resume keeps: the giver keeps more than it spent, two different agents, a positive
// amount, and a budget on chain above what was spent since.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { carriedCents, chainBudgetCents, checkCarried, latestRevoked, moveTargets, pausedCredential, pausesNotRevoked, resumedSince } from "../src/policy/pause.js";

const t = (m: number) => new Date(Date.parse("2026-11-19T10:00:00Z") + m * 60_000);

describe("the pause's bookkeeping", () => {
  it("the revoked mandate bound last, or none", () => {
    const all = [
      { id: "a", bound: true, revoked: true, boundBlock: 10n },
      { id: "b", bound: true, revoked: true, boundBlock: 30n },
      { id: "c", bound: true, revoked: false, boundBlock: 40n },
      { id: "d", bound: false, revoked: true, boundBlock: 50n },
    ];
    expect(latestRevoked(all)?.id).toBe("b");
    expect(latestRevoked([...all].reverse())?.id).toBe("b");
    expect(latestRevoked([all[2]!])).toBeNull();
  });

  it("pauses switched on with no revoke on chain since, and the credential the last pause revoked", () => {
    const db = openDb(":memory:");
    for (const k of ["pause.sourcing", "pause.support", "pause.treasury"]) db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 'x')").run(k, k === "pause.treasury" ? "off" : "on");
    audit(db, "human", "policy.changed", "pause.sourcing", { from: "off", to: "on" }, t(0));
    audit(db, "owner-signer", "mandate.revoked", "sourcing", { credential_hash: "0xabc" }, t(1));
    audit(db, "human", "policy.changed", "pause.support", { from: "off", to: "on" }, t(2));
    expect(pausesNotRevoked(db)).toEqual(["support"]);
    expect(pausedCredential(db, "sourcing")).toBe("0xabc");
    expect(pausedCredential(db, "support")).toBeNull();
    audit(db, "owner-signer", "mandate.revoked", "support", { credential_hash: "" }, t(3));
    expect(pausedCredential(db, "support")).toBeNull();
    expect(pausesNotRevoked(db)).toEqual([]);
  });

  it("what resumes carried off chain; a resume row without a readable amount stops a rebalance", () => {
    const db = openDb(":memory:");
    expect(carriedCents(db, "sourcing")).toBe(0);
    expect(resumedSince(db, "sourcing")).toBe(false);
    audit(db, "owner-signer", "mandate.resumed", "sourcing", { spent_before: "1.25" }, t(0));
    audit(db, "owner-signer", "mandate.resumed", "sourcing", { spent_before: "0.75" }, t(1));
    expect(carriedCents(db, "sourcing")).toBe(200);
    expect(resumedSince(db, "sourcing")).toBe(true);
    expect(() => checkCarried(db, [{ agent: "sourcing", spent_before_pause: "2.00" }])).not.toThrow();
    expect(() => checkCarried(db, [{ agent: "sourcing" }])).toThrow("sourcing was resumed since this proposal: its budgets on chain would be wrong; a new proposal is needed");
    audit(db, "owner-signer", "mandate.resumed", "support", { spent_before: 5 }, t(2));
    expect(() => carriedCents(db, "support")).toThrow("support: a mandate.resumed row has no readable spent_before; a rebalance cannot count it");
  });

  it("a budget on chain must stay above what was spent since the resume", () => {
    expect(chainBudgetCents(1200, 200, 300)).toBe(1000);
    expect(() => chainBudgetCents(1200, 200, 1000)).toThrow("the budget on chain (10.00 = 12.00 − 2.00 spent before a pause) must stay above the 10.00 spent since");
  });

  it("a move between budgets: positive, two different agents with mandates, the giver keeping more than it spent; its cap comes down with it", () => {
    const now = [
      { agent: "sourcing" as const, capCents: 4, budgetCents: 1000, spentCents: 100 },
      { agent: "treasury" as const, capCents: 400, budgetCents: 400, spentCents: 0 },
      { agent: "support" as const, capCents: 10, budgetCents: 600, spentCents: 50 },
    ];
    expect(moveTargets(now, { from: "treasury", to: "sourcing", cents: 100 })).toEqual([
      { agent: "sourcing", capCents: 4, budgetCents: 1100 },
      { agent: "treasury", capCents: 300, budgetCents: 300 },
      { agent: "support", capCents: 10, budgetCents: 600 },
    ]);
    expect(() => moveTargets(now, { from: "treasury", to: "sourcing", cents: 0 })).toThrow("the amount to move must be a positive whole number of cents");
    expect(() => moveTargets(now, { from: "treasury", to: "sourcing", cents: 1.5 })).toThrow(/positive whole number/);
    expect(() => moveTargets(now, { from: "support", to: "support", cents: 1 })).toThrow("a move needs two different agents");
    expect(() => moveTargets(now.slice(0, 2), { from: "support", to: "sourcing", cents: 1 })).toThrow("no mandate for support");
    expect(() => moveTargets(now.slice(0, 2), { from: "sourcing", to: "support", cents: 1 })).toThrow("no mandate for support");
    expect(() => moveTargets(now, { from: "sourcing", to: "support", cents: 900 })).toThrow("sourcing must keep a budget above what it spent (1.00)");
  });
});
