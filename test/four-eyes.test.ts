// E1, four eyes: above the CFO's threshold a payment needs the Face ID of two different people, each with their own
// passkey; whoever proposed it can never approve it; one person's "no" is enough to stop it. Off by default.
import { beforeEach, describe, expect, it } from "vitest";
import { policyLoosens } from "../src/approve/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA } from "../src/lib/terms.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal, decide, nextProposalId } from "../src/policy/approvals.js";
import { fourEyes } from "../src/policy/fourEyes.js";
import { loosens, policyValue } from "../src/policy/rules.js";

const now = new Date("2026-11-03T10:00:00Z");
const RP = { rpId: "kit11.example.workers.dev", origin: "https://kit11.example.workers.dev" };

function enrol(db: DB, label: string, id: string, add: boolean) {
  const { window } = openEnrolment(db, { ...RP, ...(add ? { addPerson: label } : { replace: true }) }, now);
  recordPasskey(db, { window, credentialId: id, publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label }, now);
}
const setting = (db: DB, key: string, value: string) =>
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());
function invoice(db: DB, amount: string, createdBy = "treasury") {
  return createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: nextProposalId(db), expires_at: "2026-11-03T11:00:00Z", amount, vendor: "Bergtex Textil GmbH" }, createdBy: createdBy as never }, now);
}
const sign = (db: DB, id: string, who: string, cred: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  return decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: `${who} (passkey ${cred.padEnd(8, "x").slice(0, 8)})`, method: "passkey", signedSha256: p.terms_sha256, passkey: { credentialId: cred, assertionSha256: `a-${cred}-${id}` } }, now);
};
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

describe("four eyes (E1)", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    enrol(db, "max", "cred-max", false);
    enrol(db, "anna", "cred-anna", true);
  });

  it("is a CFO policy setting, off by default; turning it on or lowering it tightens, the reverse loosens", () => {
    expect(policyValue(db, "approval.four_eyes_eur")).toBe("");
    for (const [from, to, looser] of [["", "500.00", false], ["500.00", "", true], ["500.00", "800.00", true], ["500.00", "200.00", false]] as const) {
      const c = { key: "approval.four_eyes_eur", from, to };
      expect(loosens(c)).toBe(looser);
      expect(policyLoosens(c)).toBe(looser);
    }
  });

  it("enrols a second person beside the first; one active passkey per person", () => {
    const active = db.prepare("SELECT label FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all();
    expect(active).toEqual([{ label: "anna" }, { label: "max" }]);
    expect(() => openEnrolment(db, { ...RP, addPerson: "max" }, now)).toThrow(/already has a passkey/);
    expect(() => openEnrolment(db, { ...RP, addPerson: "Bad Name" }, now)).toThrow(/name/);
    expect(() => openEnrolment(db, { ...RP, addPerson: "treasury" }, now)).toThrow(/agent or a part of the system/);
    // Replacing max's passkey leaves anna's alone.
    enrol(db, "max", "cred-max-2", false);
    expect(db.prepare("SELECT credential_id FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all()).toEqual([{ credential_id: "cred-anna" }, { credential_id: "cred-max-2" }]);
  });

  it("asks only above the threshold, for payments and bank-detail changes", () => {
    const small = invoice(db, "400.00");
    const big = invoice(db, "1850.00");
    expect(fourEyes(db, big)).toBe(false);
    setting(db, "approval.four_eyes_eur", "500.00");
    expect(fourEyes(db, small)).toBe(false);
    expect(fourEyes(db, big)).toBe(true);
    expect(sign(db, small.proposal_id, "max", "cred-max")).toBe("APPROVED");
  });

  // Breaks if the CFO alone can change the agents' on-chain limits while four eyes is on (Kit 11: the agents'
  // budgets are rebalanced only with two people's Face ID).
  it("asks for a change of the agents' mandates at any amount, once four eyes is on", () => {
    const replace = createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: nextProposalId(db), expires_at: "2026-11-03T11:00:00Z", option: "B" }, createdBy: "treasury" }, now);
    expect(fourEyes(db, replace)).toBe(false);
    setting(db, "approval.four_eyes_eur", "1000.00");
    expect(fourEyes(db, replace)).toBe(true);
    expect(sign(db, replace.proposal_id, "max", "cred-max")).toBe("PENDING_APPROVAL");
    expect(sign(db, replace.proposal_id, "anna", "cred-anna")).toBe("APPROVED");
  });

  it("needs two different people; the same person twice does not count", () => {
    setting(db, "approval.four_eyes_eur", "500.00");
    const p = invoice(db, "1850.00");
    expect(sign(db, p.proposal_id, "max", "cred-max")).toBe("PENDING_APPROVAL");
    expect(status(db, p.proposal_id)).toBe("PENDING_APPROVAL");
    expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    expect(() => sign(db, p.proposal_id, "max", "cred-max")).toThrow(/max already approved .*a second person/);
    expect(sign(db, p.proposal_id, "anna", "cred-anna")).toBe("APPROVED");
    expect(status(db, p.proposal_id)).toBe("APPROVED");
    expect(db.prepare("SELECT approver, method FROM approvals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ approver: "max (passkey cred-max) + anna (passkey cred-ann)", method: "passkey" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'proposal.cosigned'").get() as { n: number }).n).toBe(1);
  });

  it("never lets the proposer approve, and one 'no' stops it", () => {
    setting(db, "approval.four_eyes_eur", "500.00");
    const p = invoice(db, "1850.00", "anna");
    expect(() => sign(db, p.proposal_id, "anna", "cred-anna")).toThrow(/anna proposed .* cannot approve it/);
    expect(sign(db, p.proposal_id, "max", "cred-max")).toBe("PENDING_APPROVAL");
    const q = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(p.proposal_id) as { terms_sha256: string };
    expect(decide(db, { proposalId: p.proposal_id, decision: "REJECTED", typedPrefix: q.terms_sha256.slice(0, 8), approver: "anna (passkey cred-ann)", method: "cli" }, now)).toBe("REJECTED");
    expect(status(db, p.proposal_id)).toBe("REJECTED");
  });

  it("cannot be met by a typed hash prefix", () => {
    setting(db, "approval.four_eyes_eur", "500.00");
    const p = invoice(db, "1850.00");
    expect(() => decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: "x", approver: "max", method: "cli" }, now)).toThrow(/approve with it|passkey/);
  });
});
