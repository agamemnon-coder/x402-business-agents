// Red team (runner, 27 Nov, finding 4): segregation of duties for loosening the CFO policy (approval.policy_sod_eur) weighed
// a floor's lowering only from its value just before (from) to the new one (to). With the threshold at EUR 1,000.00,
// lowering the EUR floor from 5,000.00 to 0.00 in one change needed two people; in five changes of EUR 1,000.00 each,
// one person did it. Now a lowering is weighed against the floor's value as last approved by two people, or, when no
// two people ever approved it, against its highest value within SOD_FLOOR_WINDOW_DAYS: as for a limit, once below by more
// than the threshold, every further lowering needs two. Test money only, no network.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { POLICY_SOD_KEY, SOD_FLOOR_WINDOW_DAYS, sodChanges } from "../src/policy/policySod.js";
import { policyValue } from "../src/policy/rules.js";
import { decide } from "../src/policy/approvals.js";
import { approveSigned, testPasskey } from "./support/signedApproval.js";

const NOW = new Date("2026-11-27T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("a reserve floor walked down in steps (runner finding 4)", () => {
  it("the PoC: one person no longer removes the EUR floor of 5,000.00 in five steps of 1,000.00", () => {
    // As the red team ran it: a person's change at the command line with nobody named, approved by typing the hash.
    const cliOf = (db: DB) => (to: string) => {
      const p = proposePolicyChange(db, { changes: [{ key: "eur_floor", to }], reason: "poc step" }, "human", NOW);
      decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, NOW);
      executePolicyChange(db, p.proposal_id, NOW);
    };
    // No passkey enrolled: the command line's typed hash approves, as in the red team's world.
    const db = openDb(":memory:");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, '1000.00', ?)").run(POLICY_SOD_KEY, NOW.toISOString());
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('eur_floor', '5000.00', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(NOW.toISOString());
    const cli = cliOf(db);
    const out: string[] = [];
    for (const to of ["4000.00", "3000.00", "2000.00", "1000.00", "0.00"]) {
      try { cli(to); out.push(`${to}: one person`); } catch (e) { out.push(`${to}: refused: ${(e as Error).message.slice(0, 60)}`); break; }
    }
    expect(out[0]).toBe("4000.00: one person");
    expect(out[1]).toMatch(/^3000\.00: refused: segregation of duties applies/);
    expect(policyValue(db, "eur_floor")).toBe("4000.00");
  });

  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    testPasskey(db, "max", day(-365));
    testPasskey(db, "anna", day(-365));
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, '1000.00', ?)").run(POLICY_SOD_KEY, NOW.toISOString());
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('eur_floor', '5000.00', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(NOW.toISOString());
  });
  const step = (to: string, at = NOW, by = "lena") => proposePolicyChange(db, { changes: [{ key: "eur_floor", to }], reason: "step", proposedBy: by }, "human", at);
  const oneStep = (to: string, at = NOW) => {
    const p = step(to, at);
    expect(fourEyes(db, p, undefined, at), to).toBe(false);
    expect(approveSigned(db, p.proposal_id, at, "max")).toBe("APPROVED");
    executePolicyChange(db, p.proposal_id, at);
    return p;
  };

  it("weighs a lowering against the highest value within the window when no two people approved the floor", () => {
    expect(SOD_FLOOR_WINDOW_DAYS).toBe(90);
    oneStep("4000.00");
    const p = step("3000.00");
    expect(sodChanges(db, p.terms_json, NOW).map((c) => c.why)).toEqual(["lowered to 3000.00 EUR, 2000.00 EUR below 5000.00 EUR, its highest in the last 90 days, more than 1000.00 EUR"]);
    expect(fourEyes(db, p, undefined, NOW)).toBe(true);
    expect(approveSigned(db, p.proposal_id, NOW, "max")).toBe("PENDING_APPROVAL");
    expect(approveSigned(db, p.proposal_id, NOW, "anna")).toBe("APPROVED");
    executePolicyChange(db, p.proposal_id, NOW);
    expect(policyValue(db, "eur_floor")).toBe("3000.00");
  });

  it("weighs against the floor as last approved by two people: within the threshold of it one person, past it two", () => {
    const two = step("3500.00");
    expect(approveSigned(db, two.proposal_id, NOW, "max")).toBe("PENDING_APPROVAL");
    expect(approveSigned(db, two.proposal_id, NOW, "anna")).toBe("APPROVED");
    executePolicyChange(db, two.proposal_id, NOW);
    oneStep("3000.00", day(1));
    const p = step("2400.00", day(2));
    expect(sodChanges(db, p.terms_json, day(2)).map((c) => c.why)).toEqual(["lowered to 2400.00 EUR, 1100.00 EUR below 3500.00 EUR, its value as last approved by two people, more than 1000.00 EUR"]);
    // Within EUR 1,000.00 of what two people approved, one person still lowers it.
    oneStep("2500.00", day(2));
  });

  it("forgets one person's earlier values after the window", () => {
    oneStep("4000.00", day(-SOD_FLOOR_WINDOW_DAYS - 1));
    expect(fourEyes(db, step("3000.00"), undefined, NOW)).toBe(false);
  });
});
