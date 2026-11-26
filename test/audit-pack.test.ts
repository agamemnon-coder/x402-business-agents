// The signed audit pack (src/audit/pack.ts): a pack of November from a seeded ledger (rows in October before it and in
// December after it) verifies offline; one changed byte, a removed row, a changed manifest or another key fails, each
// with a reason that names the section, the row and what differs.
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { beforeAll, describe, expect, it } from "vitest";
import { rawPublicKey, keyIdOf } from "../src/audit/checkpoint.js";
import { audit } from "../src/audit/log.js";
import { buildAuditPack, verifyAuditPack, type AuditPack, type PackResult } from "../src/audit/pack.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { TERMS_SCHEMA } from "../src/lib/terms.js";
import { createProposal, decide, nextProposalId } from "../src/policy/approvals.js";
import { approveSigned, testPasskey } from "./support/signedApproval.js";

const OCT = new Date("2026-10-20T09:00:00Z");
const NOV = (day: number, h = 9, min = 0) => new Date(`2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`);
const DEC = new Date("2026-12-02T09:00:00Z");
const key = generateKeyPairSync("ed25519").privateKey;
const pub = rawPublicKey(key);

function invoice(db: DB, amount: string, now: Date) {
  const expires = new Date(now.getTime() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: nextProposalId(db), expires_at: expires, amount, currency: "EUR", vendor: "Bergtex Textil GmbH" }, createdBy: "treasury" }, now);
}

/** October: one payment approved. November: the CFO turns segregation of duties on, two people loosen the policy, a
 *  payment is approved and one rejected, a refund is refused, a sweep held, the books reconciled with a difference.
 *  December: one more reconciliation, outside the period. */
function seededWorld(): { db: DB; ids: Record<string, string> } {
  const db = openDb(":memory:");
  testPasskey(db, "max", OCT);
  testPasskey(db, "anna", OCT);
  const oct = invoice(db, "400.00", OCT);
  approveSigned(db, oct.proposal_id, OCT, "max");
  const sodOn = proposePolicyChange(db, { changes: [{ key: "approval.policy_sod_eur", to: "1000.00" }], reason: "segregation of duties" }, "human", NOV(2));
  approveSigned(db, sodOn.proposal_id, NOV(2), "max");
  executePolicyChange(db, sodOn.proposal_id, NOV(2));
  const loosen = proposePolicyChange(db, { changes: [{ key: "ap.alone_eur", to: "2500.00" }], reason: "month-end volume" }, "human", NOV(3));
  approveSigned(db, loosen.proposal_id, NOV(3), "max");
  approveSigned(db, loosen.proposal_id, NOV(3, 9, 5), "anna");
  executePolicyChange(db, loosen.proposal_id, NOV(3, 9, 6));
  const paid = invoice(db, "1850.00", NOV(10));
  approveSigned(db, paid.proposal_id, NOV(10), "anna");
  const no = invoice(db, "990.00", NOV(11));
  decide(db, { proposalId: no.proposal_id, decision: "REJECTED", typedPrefix: no.terms_sha256.slice(0, 8), approver: "max", method: "cli", note: "not ours" }, NOV(11));
  audit(db, "support", "refund.refused", "R-7", { reason: "policy_cap_exceeded: 60.00 is over the Support agent's limit of 50.00" }, NOV(12));
  audit(db, "treasury", "sweep.held", "S-3", { reason: "EUR floor" }, NOV(13));
  audit(db, "system", "reconcile.done", null, { checked: "12", differences: "1" }, NOV(28));
  audit(db, "system", "reconcile.difference", "AP-3", { ledger: "1850.00", bank: "1805.00" }, NOV(28, 10));
  audit(db, "system", "reconcile.done", null, { checked: "4", differences: "0" }, DEC);
  return { db, ids: { oct: oct.proposal_id, sodOn: sodOn.proposal_id, loosen: loosen.proposal_id, paid: paid.proposal_id, no: no.proposal_id } };
}

const copy = (p: AuditPack): AuditPack => JSON.parse(JSON.stringify(p)) as AuditPack;
const failed = (r: PackResult) => Object.fromEntries(r.checks.filter((c) => !c.ok).map((c) => [c.check, c.detail]));
const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

describe("signed audit pack", () => {
  let world: ReturnType<typeof seededWorld>;
  let pack: AuditPack;
  beforeAll(() => {
    world = seededWorld();
    pack = buildAuditPack(world.db, NOVEMBER, { key }, new Date("2026-12-03T08:00:00Z"));
  });

  it("verifies, from the file's text alone, with the signer's key pinned", () => {
    const r = verifyAuditPack(JSON.parse(JSON.stringify(pack)), { trusted: [pub] });
    expect(failed(r)).toEqual({});
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.check)).toEqual(expect.arrayContaining(["signature", "key", "sections", "audit chain", "approvals", "proposals", "policy versions", "hash audit_rows"]));
    // Unpinned it still verifies, and says whose key it cannot vouch for.
    const loose = verifyAuditPack(pack);
    expect(loose.ok).toBe(true);
    expect(loose.checks.find((c) => c.check === "key")?.detail).toMatch(/is not pinned here/);
  });

  it("holds the period's rows only, linked to the genesis hash, and sorts them for the auditor", () => {
    const m = pack.manifest;
    expect(m.audit.first_seq).toBeGreaterThan(1); // October's rows are links only
    expect(pack.sections.chain_before).toHaveLength(m.audit.first_seq - 1);
    expect(m.audit.last_seq).toBe(m.audit.log_rows - 1); // December's row is not in it
    expect(pack.sections.audit_rows.every((r) => r.ts.startsWith("2026-11-"))).toBe(true);
    const events = (s: keyof AuditPack["sections"]) => (pack.sections[s] as { event: string; subject: string | null }[]).map((e) => `${e.event} ${e.subject ?? ""}`.trim());
    const { ids } = world;
    // Approvals: who, how, with which passkey, over which terms hash; the two people of the loosening and why.
    expect(events("approvals")).toEqual(expect.arrayContaining([`proposal.approved ${ids.sodOn}`, `proposal.cosigned ${ids.loosen}`, `proposal.approved ${ids.loosen}`, `proposal.approved ${ids.paid}`, `proposal.rejected ${ids.no}`]));
    expect(events("approvals")).not.toContain(`proposal.approved ${ids.oct}`);
    const two = pack.sections.approvals.find((e) => e.event === "proposal.approved" && e.subject === ids.loosen)!.payload as Record<string, unknown>;
    expect(two).toMatchObject({ approver: "max + anna", method: "passkey", segregation_of_duties: { threshold_eur: "1000.00" } });
    expect(two.passkey).toMatchObject({ credential_id: expect.any(String), assertion_sha256: expect.any(String) });
    const paid = pack.sections.proposals.find((p) => p.proposal_id === ids.paid)!;
    expect(paid).toMatchObject({ kind: "invoice_payment", approval: { decision: "APPROVED", method: "passkey", approved_sha256: paid.terms_sha256 } });
    expect(pack.sections.proposals.find((p) => p.proposal_id === ids.loosen)!.cosignatures.map((c) => c.person)).toEqual(["max", "anna"]);
    // Policy: the version in force on 1 November and each one recorded since, with the change rows.
    expect(pack.sections.policy_versions[0]!.created_at < "2026-11-01").toBe(true);
    expect(pack.sections.policy_versions.length).toBeGreaterThan(1);
    expect(events("policy_changes")).toEqual(expect.arrayContaining(["policy.changed approval.policy_sod_eur", "policy.changed ap.alone_eur"]));
    expect(events("refusals_holds")).toEqual(expect.arrayContaining(["refund.refused R-7", "sweep.held S-3", `proposal.rejected ${ids.no}`]));
    expect(events("reconciliation")).toEqual(["reconcile.done", "reconcile.difference AP-3"]);
    expect(events("decisions")).toEqual(expect.arrayContaining([`proposal.created ${ids.paid}`, `proposal.executed ${ids.loosen}`, "refund.refused R-7"]));
  });

  it("fails on one changed byte in the terms of an approved payment, naming the proposal", () => {
    const text = JSON.stringify(pack);
    expect(text.split('"amount":"1850.00"')).toHaveLength(2);
    const r = verifyAuditPack(JSON.parse(text.replace('"amount":"1850.00"', '"amount":"1350.00"')), { trusted: [pub] });
    expect(r.ok).toBe(false);
    const f = failed(r);
    expect(Object.keys(f).sort()).toEqual(["hash proposals", "proposals"]);
    expect(f["hash proposals"]).toMatch(new RegExp(`^proposals: row \\d+ \\(${world.ids.paid}\\) hashes to .*, the manifest says .*: it was changed$`));
    expect(f.proposals).toMatch(new RegExp(`^${world.ids.paid}: its terms hash to .*, the pack says`));
  });

  it("fails on one changed byte in an approval row", () => {
    const p = copy(pack);
    const row = p.sections.approvals.find((e) => e.event === "proposal.approved" && e.subject === world.ids.paid)!;
    (row.payload as Record<string, unknown>).approver = "anne";
    const f = failed(verifyAuditPack(p, { trusted: [pub] }));
    expect(Object.keys(f).sort()).toEqual(["approvals", "hash approvals"]);
    expect(f["hash approvals"]).toMatch(new RegExp(`row \\d+ \\(audit row ${row.seq} proposal.approved ${world.ids.paid}\\) hashes to .*: it was changed`));
    expect(f.approvals).toBe(`approvals: its row for audit row ${row.seq} (proposal.approved ${world.ids.paid}) is not what that row says`);
  });

  it("fails on one changed byte in an audit row: the chain breaks at that row", () => {
    const p = copy(pack);
    const row = p.sections.audit_rows.find((r) => r.event === "reconcile.done")!;
    row.payload_json = row.payload_json.replace('"12"', '"13"');
    const f = failed(verifyAuditPack(p, { trusted: [pub] }));
    expect(f["audit chain"]).toBe(`audit row ${row.seq}: row_hash does not match the row`);
    expect(f["hash audit_rows"]).toMatch(new RegExp(`\\(audit row ${row.seq} reconcile.done\\) hashes to .*: it was changed`));
    expect(f.reconciliation).toMatch(new RegExp(`its row for audit row ${row.seq} \\(reconcile.done\\) is not what that row says`));
  });

  it("fails on a removed row: a refusal taken out of its section, or a row cut out of the chain", () => {
    const p = copy(pack);
    const i = p.sections.refusals_holds.findIndex((e) => e.event === "refund.refused");
    const [gone] = p.sections.refusals_holds.splice(i, 1);
    const f = failed(verifyAuditPack(p, { trusted: [pub] }));
    expect(Object.keys(f).sort()).toEqual(["hash refusals_holds", "refusals_holds"]);
    expect(f["hash refusals_holds"]).toMatch(new RegExp(`^refusals_holds: ${pack.sections.refusals_holds.length - 1} rows, the manifest lists ${pack.sections.refusals_holds.length}; the manifest's row ${i + 1} \\(sha256 .*\\) is not in the file$`));
    expect(f.refusals_holds).toBe(`refusals_holds: audit row ${gone!.seq} (refund.refused R-7) is not in it`);

    const q = copy(pack);
    const [cut] = q.sections.audit_rows.splice(3, 1);
    const g = failed(verifyAuditPack(q, { trusted: [pub] }));
    expect(g["audit chain"]).toBe(`audit row ${cut!.seq + 1}: gap: expected seq ${cut!.seq}`);
    expect(g["hash audit_rows"]).toMatch(/the manifest's row 4 \(sha256 .*\) is not in the file/);

    const r = copy(pack);
    r.sections.chain_before.splice(0, 1);
    expect(failed(verifyAuditPack(r, { trusted: [pub] }))["audit chain"]).toMatch(/^the links before the period break at row 2: gap: expected seq 1$/);
  });

  it("fails on a changed manifest, and on a pack signed again with a key that is not pinned", () => {
    const p = copy(pack);
    p.manifest.period.to = "2026-11-29";
    expect(failed(verifyAuditPack(p, { trusted: [pub] })).signature).toMatch(/does not verify over the manifest/);

    const other = generateKeyPairSync("ed25519").privateKey;
    const q = copy(pack);
    q.manifest.public_key = rawPublicKey(other);
    q.manifest.key_id = keyIdOf(q.manifest.public_key);
    q.signature = edSign(null, Buffer.from(jcs(q.manifest as unknown as Json), "utf8"), other).toString("base64url");
    const f = failed(verifyAuditPack(q, { trusted: [pub] }));
    expect(Object.keys(f)).toEqual(["key"]);
    expect(f.key).toBe(`signed by key ${q.manifest.key_id}, which is not a pinned key (${keyIdOf(pub)})`);
  });

  it("answers anything else with a failed check, never a throw", () => {
    expect(verifyAuditPack(null).ok).toBe(false);
    expect(verifyAuditPack({ format: "purser.audit-pack/v1" }).checks[0]).toMatchObject({ check: "format", ok: false });
  });

  it("refuses a period that is not one, and a ledger whose audit log does not verify", () => {
    expect(() => buildAuditPack(world.db, { from: "2026-02-30", to: "2026-03-01" }, { key })).toThrow(/is not a day/);
    expect(() => buildAuditPack(world.db, { from: "2026-11-30", to: "2026-11-01" }, { key })).toThrow(/ends .* before it starts/);
    const { db } = seededWorld();
    db.exec("DROP TRIGGER IF EXISTS audit_log_no_update");
    db.prepare("UPDATE audit_log SET subject = 'R-8' WHERE subject = 'R-7'").run();
    expect(() => buildAuditPack(db, NOVEMBER, { key })).toThrow(/the audit log does not verify at row \d+ \(row_hash does not match the row\)/);
  });

  it("an empty period verifies too: no rows, the whole chain as links", () => {
    const empty = buildAuditPack(world.db, { from: "2027-01-01", to: "2027-01-31" }, { key });
    expect(empty.sections.audit_rows).toEqual([]);
    expect(empty.sections.chain_before).toHaveLength(empty.manifest.audit.log_rows);
    expect(failed(verifyAuditPack(copy(empty), { trusted: [pub] }))).toEqual({});
  });
});
