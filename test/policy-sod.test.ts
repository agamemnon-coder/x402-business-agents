// Segregation of duties for the CFO policy (src/policy/policySod.ts): with approval.policy_sod_eur set, a change that
// loosens the policy above it needs the passkeys of two different people, the same person twice never counts, and whoever
// proposed a policy change never approves it. Tightening stays one person and runs at once. Off by default.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { POLICY_SOD_KEY, sodChanges } from "../src/policy/policySod.js";
import { currentPolicy, loosens, policyValue } from "../src/policy/rules.js";
import { approveSigned, testPasskey } from "./support/signedApproval.js";

const now = new Date("2026-11-20T10:00:00Z");
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const rows = (db: DB, event: string, subject: string) =>
  (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, subject) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const propose = (db: DB, key: string, to: string, proposedBy?: string) =>
  proposePolicyChange(db, { changes: [{ key, to }], reason: "test", ...(proposedBy ? { proposedBy } : {}) }, "human", now);

/** Sets the threshold the way the CFO does: a tightening, one passkey, applied at once. */
function turnOn(db: DB, eur: string) {
  const p = propose(db, POLICY_SOD_KEY, eur);
  expect(approveSigned(db, p.proposal_id, now, "max")).toBe("APPROVED");
  executePolicyChange(db, p.proposal_id, now);
  expect(policyValue(db, POLICY_SOD_KEY)).toBe(eur);
}

describe("segregation of duties for policy changes", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    testPasskey(db, "max", now);
    testPasskey(db, "anna", now);
  });

  it("is a policy setting, off by default; turning it on or lowering it tightens, the reverse loosens", () => {
    expect(policyValue(db, POLICY_SOD_KEY)).toBe("");
    expect(currentPolicy(db).some((r) => r.key === POLICY_SOD_KEY)).toBe(false); // not shown until set: the policy hash stays
    for (const [from, to, looser] of [["", "1000.00", false], ["1000.00", "", true], ["1000.00", "2000.00", true], ["1000.00", "500.00", false]] as const) {
      const c = { key: POLICY_SOD_KEY, from, to };
      expect(loosens(c)).toBe(looser);
    }
    // Off: a loosening is one person's, as before.
    const p = propose(db, "ap.alone_eur", "5000.00");
    expect(fourEyes(db, p)).toBe(false);
    expect(approveSigned(db, p.proposal_id, now, "max")).toBe("APPROVED");
  });

  it("tightening needs one passkey and runs at once, also with the threshold on", () => {
    turnOn(db, "1000.00");
    expect(currentPolicy(db).find((r) => r.key === POLICY_SOD_KEY)?.display).toBe("1000.00 EUR");
    const p = propose(db, "approval.four_eyes_eur", "200.00"); // switching four eyes on tightens
    expect(sodChanges(db, p.terms_json)).toEqual([]);
    expect(approveSigned(db, p.proposal_id, now, "anna")).toBe("APPROVED");
    executePolicyChange(db, p.proposal_id, now);
    expect(policyValue(db, "approval.four_eyes_eur")).toBe("200.00");
    expect(rows(db, "proposal.cosigned", p.proposal_id)).toEqual([]);
  });

  it("weighs a loosening against the threshold: a limit raised above it, a floor lowered by more, anything without a euro amount", () => {
    turnOn(db, "1000.00");
    const why = (key: string, to: string) => sodChanges(db, propose(db, key, to).terms_json).map((c) => c.why);
    expect(why("ap.alone_eur", "400.00")).toEqual([]); // set below the threshold: one person
    expect(why("ap.alone_eur", "1500.00")).toEqual(["raised to 1500.00 EUR, above 1000.00 EUR"]);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('eur_floor', '5000.00', ?)").run(now.toISOString());
    expect(why("eur_floor", "4500.00")).toEqual([]);
    expect(why("eur_floor", "3000.00")).toEqual(["lowered by 2000.00 EUR, more than 1000.00 EUR"]);
    expect(why(POLICY_SOD_KEY, "")).toEqual(["removed or switched off: no limit left to weigh"]);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.second_key_new_payee', 'on', ?)").run(now.toISOString());
    expect(why("approval.second_key_new_payee", "off")).toEqual(["no euro amount to weigh, so it counts as above the threshold"]);
  });

  it("refuses the same person twice and approves with a second, different person's passkey; the audit log says why", () => {
    turnOn(db, "1000.00");
    const p = propose(db, "ap.alone_eur", "2500.00");
    expect(fourEyes(db, p)).toBe(true);
    expect(approveSigned(db, p.proposal_id, now, "max")).toBe("PENDING_APPROVAL");
    expect(status(db, p.proposal_id)).toBe("PENDING_APPROVAL");
    expect(() => approveSigned(db, p.proposal_id, now, "max")).toThrow(/max already approved .*a second person .*segregation of duties/);
    expect(() => executePolicyChange(db, p.proposal_id, now)).toThrow(/not approved/);
    expect(policyValue(db, "ap.alone_eur")).toBe("");
    expect(approveSigned(db, p.proposal_id, now, "anna")).toBe("APPROVED");
    executePolicyChange(db, p.proposal_id, now);
    expect(policyValue(db, "ap.alone_eur")).toBe("2500.00");
    expect(db.prepare("SELECT approver, method FROM approvals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ approver: "max + anna", method: "passkey" });
    const sod = { threshold_eur: "1000.00", loosens: [{ key: "ap.alone_eur", from: "", to: "2500.00", why: "raised to 2500.00 EUR, above 1000.00 EUR" }] };
    const [cosigned] = rows(db, "proposal.cosigned", p.proposal_id);
    expect(cosigned).toMatchObject({ person: "max", of: "1 of 2", method: "passkey", segregation_of_duties: sod, terms_sha256: p.terms_sha256 });
    const [approved] = rows(db, "proposal.approved", p.proposal_id);
    expect(approved).toMatchObject({ approver: "max + anna", method: "passkey", segregation_of_duties: sod, terms_sha256: p.terms_sha256 });
    expect(rows(db, "policy.changed", "ap.alone_eur")).toMatchObject([{ from: "", to: "2500.00", proposal_id: p.proposal_id }]);
  });

  it("never lets the proposer approve, loosening or tightening", () => {
    turnOn(db, "1000.00");
    const loose = propose(db, "ap.alone_eur", "2500.00", "anna");
    expect(JSON.parse(loose.terms_json)).toMatchObject({ proposed_by: "anna" }); // signed into the terms
    expect(() => approveSigned(db, loose.proposal_id, now, "anna")).toThrow(/anna proposed .* cannot approve it \(segregation of duties\)/);
    expect(approveSigned(db, loose.proposal_id, now, "max")).toBe("PENDING_APPROVAL");
    expect(() => approveSigned(db, loose.proposal_id, now, "anna")).toThrow(/anna proposed/); // nor as the second person
    const tight = propose(db, "approval.four_eyes_eur", "300.00", "anna");
    expect(() => approveSigned(db, tight.proposal_id, now, "anna")).toThrow(/anna proposed .* cannot approve it/);
    expect(approveSigned(db, tight.proposal_id, now, "max")).toBe("APPROVED");
    expect(() => propose(db, "approval.four_eyes_eur", "100.00", "Not A Person")).toThrow(/not a person's name/);
  });

  it("turning the threshold off or raising it needs two people under the threshold in force", () => {
    turnOn(db, "1000.00");
    const off = propose(db, POLICY_SOD_KEY, "");
    expect(approveSigned(db, off.proposal_id, now, "max")).toBe("PENDING_APPROVAL");
    expect(approveSigned(db, off.proposal_id, now, "anna")).toBe("APPROVED");
    executePolicyChange(db, off.proposal_id, now);
    expect(policyValue(db, POLICY_SOD_KEY)).toBe("");
    // Off again: one person loosens, as before.
    const p = propose(db, "ap.alone_eur", "2500.00");
    expect(approveSigned(db, p.proposal_id, now, "max")).toBe("APPROVED");
  });
});
