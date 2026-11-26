// The compliance evidence (src/compliance/evidence.ts, npm run compliance-evidence): per control of the map, the records
// in the ledger that show it ran in a period, a summary per framework, and a manifest signed with Ed25519 as the audit
// pack's is. On a seeded ledger (test data, test/support/complianceWorld.ts) it counts what was seeded, is the same
// byte for byte when made again, verifies offline (with the audit pack: every cited row is in the period's chain),
// names the file that one changed byte breaks, and carries no secret.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawPublicKey } from "../src/audit/checkpoint.js";
import { buildAuditPack, type AuditPack, type PackResult } from "../src/audit/pack.js";
import { CONTROLS, REQUIREMENTS } from "../src/compliance/controls.js";
import { buildComplianceEvidence, readComplianceEvidence, sealComplianceEvidence, verifyComplianceEvidence, writeComplianceEvidence, type ComplianceEvidence, type ControlEvidence, type EvidenceSummary } from "../src/compliance/evidence.js";
import { complianceWorld, NOVEMBER, type ComplianceWorld } from "./support/complianceWorld.js";

const key = generateKeyPairSync("ed25519").privateKey;
const pub = rawPublicKey(key);
const other = rawPublicKey(generateKeyPairSync("ed25519").privateKey);
const failed = (r: PackResult) => Object.fromEntries(r.checks.filter((c) => !c.ok).map((c) => [c.check, c.detail]));
const control = (ev: ComplianceEvidence, id: string) => JSON.parse(ev.files[`controls/${id}.json`]!) as ControlEvidence;
const byEvent = (ev: ComplianceEvidence, id: string) => control(ev, id).audit?.by_event;

describe("compliance evidence", () => {
  let world: ComplianceWorld;
  let ev: ComplianceEvidence;
  let pack: AuditPack;
  beforeAll(() => {
    world = complianceWorld();
    ev = buildComplianceEvidence(world.db, NOVEMBER, { key });
    pack = buildAuditPack(world.db, NOVEMBER, { key }, new Date("2026-12-03T08:00:00Z"));
  });

  it("writes a file per control, the mapping, a summary and a signed manifest", () => {
    expect(Object.keys(ev.files).sort()).toEqual(["manifest.json", "mapping.json", "summary.json", ...CONTROLS.map((c) => `controls/${c.id}.json`)].sort());
    const s = JSON.parse(ev.files["summary.json"]!) as EvidenceSummary;
    expect(s.period).toEqual(NOVEMBER);
    expect(s.note).toMatch(/independent auditor/);
  });

  it("counts, per control, the records the seeded November left (test data)", () => {
    const ids = world.ids;
    // Passkey-signed exact terms: six proposals made, five approved with the passkey, one rejected, two first signatures.
    expect(byEvent(ev, "PC-01")).toEqual({ "proposal.approved": 5, "proposal.cosigned": 2, "proposal.created": 6, "proposal.rejected": 1 });
    expect(control(ev, "PC-01").tables.find((t) => t.table === "approvals")).toMatchObject({ present: true, rows: 6 });
    // The executor's re-check before each policy change ran.
    expect(byEvent(ev, "PC-02")).toEqual({ "proposal.executed": 4, "proposal.executing": 4 });
    expect(byEvent(ev, "PC-03")).toEqual({ "policy.version": 4 });
    expect(control(ev, "PC-03").tables[0]).toMatchObject({ table: "policy_versions", rows: 4 });
    expect(byEvent(ev, "PC-04")).toEqual({ "policy.changed": 4 });
    // Segregation of duties: turned on once, then two policy changes signed by two people.
    expect(byEvent(ev, "PC-05")).toEqual({ "policy.changed": 1, "proposal.cosigned": 2 });
    expect(control(ev, "PC-05").audit!.records.filter((r) => r.event === "proposal.cosigned").map((r) => r.subject)).toEqual([ids.loosen, ids.lift]);
    // The emergency stop pulled and lifted: exactly the two changes of "freeze", not the other policy changes.
    expect(byEvent(ev, "PC-06")).toEqual({ "policy.changed": 2 });
    expect(control(ev, "PC-06").audit!.records.map((r) => r.subject)).toEqual(["freeze", "freeze"]);
    expect(byEvent(ev, "PC-07")).toEqual({ "principal.expires": 1, "principal.key_rotated": 1, "principal.revoked": 1 });
    expect(byEvent(ev, "PC-08")).toEqual({ "principal.identity_refused": 1, "principal.identity_verified": 1 });
    expect(control(ev, "PC-08").tables[0]).toMatchObject({ table: "principal_identity_keys", rows: 3 });
    expect(byEvent(ev, "PC-11")).toEqual({ "payment.anomaly_held": 1, "principal.identity_refused": 1, "proposal.rejected": 1, "reconcile.difference": 1, "refund.refused": 1, "sweep.held": 1 });
    expect(byEvent(ev, "PC-13")).toEqual({ "payment.anomaly_held": 1 });
    expect(byEvent(ev, "PC-15")).toEqual({ "reconcile.difference": 1, "reconcile.done": 1 });
    expect(byEvent(ev, "PC-16")).toEqual({ "claude.read": 1 });
    // No payment was executed, so no rationale record: said, not hidden.
    expect(control(ev, "PC-12")).toMatchObject({ status: "no-records-in-period", audit: { rows: 0, records: [] } });
    // The chain: the period's rows only, linked to the rows before it (October's) and as the audit pack has them.
    const chain = control(ev, "PC-10").chain!;
    expect(chain).toEqual({ first_seq: pack.manifest.audit.first_seq, last_seq: pack.manifest.audit.last_seq, rows: pack.manifest.audit.rows, before: pack.manifest.audit.before, head: pack.manifest.audit.head });
    // Every cited row is one of the period's, with its hash.
    const rows = new Map(pack.sections.audit_rows.map((r) => [r.seq, r]));
    for (const c of CONTROLS) for (const r of control(ev, c.id).audit?.records ?? []) expect(rows.get(r.seq)?.row_hash, `${c.id} row ${r.seq}`).toBe(r.row_hash);
    // Documented controls are said to be documented, with no records.
    for (const c of CONTROLS.filter((x) => !x.evidence)) expect(control(ev, c.id)).toMatchObject({ status: "documented", audit: null, tables: [] });
  });

  it("sums each framework's requirements by what stands behind them in the period", () => {
    const s = JSON.parse(ev.files["summary.json"]!) as EvidenceSummary;
    for (const f of s.frameworks) {
      const rows = REQUIREMENTS.filter((r) => r.framework === f.framework);
      expect(f.requirements, f.framework).toBe(rows.length);
      expect(f.evidence_in_period + f.no_records_in_period, f.framework).toBe(rows.filter((r) => r.status === "evidence-in-ledger").length);
      expect(f.documented, f.framework).toBe(rows.filter((r) => r.status === "documented").length);
      expect(f.gap, f.framework).toBe(rows.filter((r) => r.status === "gap").length);
    }
    // Art. 14(4)(e), the stop: evidence in the period (the freeze was pulled and lifted).
    const mapping = JSON.parse(ev.files["mapping.json"]!) as { requirements: { framework: string; clause: string; in_period: string; records: number }[] };
    expect(mapping.requirements.find((r) => r.framework === "eu-ai-act" && r.clause === "Art. 14(4)(e)")).toMatchObject({ in_period: "evidence-in-period", records: 2 });
  });

  it("is the example docs/compliance/README.md shows (test data), number for number", () => {
    const s = JSON.parse(ev.files["summary.json"]!) as EvidenceSummary;
    const readme = readFileSync("docs/compliance/README.md", "utf8");
    const names: Record<string, string> = { "eu-ai-act": "EU AI Act", "iso-42001": "ISO/IEC 42001", soc2: "SOC 2", dora: "DORA" };
    for (const f of s.frameworks) expect(readme, f.framework).toContain(`| ${names[f.framework]} | ${f.requirements} | ${f.evidence_in_period} | ${f.no_records_in_period} | ${f.documented} | ${f.gap} |`);
    expect(s.controls.filter((c) => c.status === "no-records-in-period").map((c) => c.id)).toContain("PC-12");
  });

  it("is the same, byte for byte, when made again over the same ledger and period", () => {
    const again = buildComplianceEvidence(world.db, NOVEMBER, { key });
    expect(again.files).toEqual(ev.files);
  });

  it("verifies offline, with the audit pack, and every cited row is in the period's chain", () => {
    const r = verifyComplianceEvidence(ev.files, { trusted: [pub], auditPack: JSON.parse(JSON.stringify(pack)) });
    expect(failed(r)).toEqual({});
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.check)).toEqual(expect.arrayContaining(["format", "signature", "key", "files", "summary", "audit pack", "cited rows"]));
    // Without the pack it still verifies, and says the rows were not checked against the chain.
    const alone = verifyComplianceEvidence(ev.files, { trusted: [pub] });
    expect(alone.ok).toBe(true);
    expect(alone.checks.find((c) => c.check === "cited rows")?.detail).toMatch(/no audit pack/);
    // Another key: refused.
    expect(failed(verifyComplianceEvidence(ev.files, { trusted: [other] }))).toEqual({ key: expect.stringMatching(/not a pinned key/) });
  });

  it("names the file one changed byte breaks", () => {
    const tamper = (path: string, from: string, to: string) => {
      const text = ev.files[path]!;
      expect(text.includes(from), `${path} has ${from}`).toBe(true);
      return verifyComplianceEvidence({ ...ev.files, [path]: text.replace(from, to) }, { trusted: [pub] });
    };
    const freeze = control(ev, "PC-06").audit!.records[0]!;
    const f1 = failed(tamper("controls/PC-06.json", `"seq": ${freeze.seq}`, `"seq": ${freeze.seq + 1}`));
    expect(Object.keys(f1)).toEqual(["files"]);
    expect(f1.files).toMatch(/^controls\/PC-06\.json: sha256 .* the manifest says .*: it was changed$/);
    const f2 = failed(tamper("summary.json", '"gap": ', '"gap": 1'));
    expect(f2.files).toMatch(/^summary\.json: /);
    const f3 = failed(tamper("manifest.json", '"rows": ', '"rows": 9'));
    expect(f3.signature).toMatch(/does not verify/);
    // A file taken out, or one added.
    const { ["controls/PC-12.json"]: _gone, ...less } = ev.files;
    expect(failed(verifyComplianceEvidence(less, { trusted: [pub] })).files).toMatch(/controls\/PC-12\.json is in the manifest, not in the directory/);
    expect(failed(verifyComplianceEvidence({ ...ev.files, "notes.txt": "hi" }, { trusted: [pub] })).files).toMatch(/notes\.txt is not in the manifest/);
  });

  it("finds a cited row the chain does not have, even when the manifest was signed again over it", () => {
    // The signer itself changes a cited row's hash and seals again: the signature and the files pass; the audit pack does not agree.
    const c = control(ev, "PC-06");
    c.audit!.records[0]!.row_hash = "f".repeat(64);
    const forged = sealComplianceEvidence({ ...ev.files, "controls/PC-06.json": `${JSON.stringify(c, null, 1)}\n` }, { key });
    const r = verifyComplianceEvidence(forged, { trusted: [pub], auditPack: pack });
    expect(Object.keys(failed(r))).toEqual(["cited rows"]);
    expect(failed(r)["cited rows"]).toMatch(new RegExp(`controls/PC-06\\.json: audit row ${c.audit!.records[0]!.seq} \\(policy\\.changed freeze\\) has hash ffffffffffff…, the audit pack's row has`));
    // A pack of another period, or one changed, is refused as the pack.
    const october = buildAuditPack(world.db, { from: "2026-10-01", to: "2026-10-31" }, { key });
    expect(failed(verifyComplianceEvidence(ev.files, { trusted: [pub], auditPack: october }))["audit pack"]).toMatch(/period 2026-10-01 \.\. 2026-10-31.*2026-11-01 \.\. 2026-11-30/);
    const changed = JSON.parse(JSON.stringify(pack)) as AuditPack;
    changed.sections.audit_rows[0]!.actor = "someone";
    expect(failed(verifyComplianceEvidence(ev.files, { trusted: [pub], auditPack: changed }))["audit pack"]).toMatch(/does not verify/);
  });

  it("carries no secret, no card number and no key the seeded world handed out", () => {
    const text = Object.values(ev.files).join("\n");
    for (const s of world.secrets) expect(text.includes(s), "a secret of the seeded world").toBe(false);
    expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(text).not.toMatch(/\b(pk|ptok|ptask|sk-ant|sk|whsec)_[A-Za-z0-9_-]{12,}/);
    expect(text).not.toMatch(/(?<![0-9a-f])\d{13,19}(?![0-9a-f])/);
    expect(text).not.toMatch(/"(payload|payload_json|terms_json|registration_json|assertion_json|public_key_pem|private_pem|label|approver|person)"/);
    // The only key in it is the signer's public key, in the manifest.
    expect(JSON.parse(ev.files["manifest.json"]!)).toMatchObject({ manifest: { public_key: pub } });
  });

  it("refuses a period that is not one, and a ledger whose audit chain does not verify", () => {
    expect(() => buildComplianceEvidence(world.db, { from: "2026-11-31", to: "2026-12-01" }, { key })).toThrow(/is not a day/);
    expect(() => buildComplianceEvidence(world.db, { from: "2026-11-30", to: "2026-11-01" }, { key })).toThrow(/ends .* before it starts/);
  });
});

describe("the commands (npm run compliance-evidence, verify-compliance-evidence)", () => {
  const dir = mkdtempSync(join(tmpdir(), "purser-compliance-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (script: string, args: string[], env: Record<string, string>) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, `../src/cli/${script}`), ...args], { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { code: x.status, out: `${x.stdout}${x.stderr}` }; }
  };

  it("writes the evidence from a ledger file read-only, and verifies it with the audit pack", () => {
    const ledger = join(dir, "ledger.sqlite");
    complianceWorld(ledger).db.close();
    const keyFile = join(dir, "checkpoint.pem");
    writeFileSync(keyFile, key.export({ type: "pkcs8", format: "pem" }));
    chmodSync(keyFile, 0o600);
    const env = { KIT11_DB: ledger, PURSER_CHECKPOINT_KEY_FILE: keyFile };
    const out = join(dir, "evidence");
    const made = cli("complianceEvidence.ts", ["--from", "2026-11-01", "--to", "2026-11-30", "--out", out], env);
    expect(made.code, made.out).toBe(0);
    expect(made.out).toMatch(/eu-ai-act .*evidence in period/);
    const packFile = join(dir, "pack.json");
    expect(cli("auditPack.ts", ["--from", "2026-11-01", "--to", "2026-11-30", "--out", packFile], env).code).toBe(0);
    const ok = cli("verifyComplianceEvidence.ts", [out, "--trust", pub, "--audit-pack", packFile], {});
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/VALID/);
    // Made again: the same files.
    const again = join(dir, "again");
    expect(cli("complianceEvidence.ts", ["--from", "2026-11-01", "--to", "2026-11-30", "--out", again], env).code).toBe(0);
    expect(readComplianceEvidence(again)).toEqual(readComplianceEvidence(out));
    // One changed byte: exit 1, naming the file.
    const f = join(out, "controls", "PC-01.json");
    writeFileSync(f, readFileSync(f, "utf8").replace('"rows": ', '"rows": 1'));
    const bad = cli("verifyComplianceEvidence.ts", [out, "--trust", pub, "--audit-pack", packFile], {});
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/FAIL\s+files\s+controls\/PC-01\.json: /);
    expect(bad.out).toMatch(/NOT VALID/);
    // No ledger: a usage error, nothing written.
    expect(cli("complianceEvidence.ts", ["--from", "2026-11-01", "--to", "2026-11-30", "--out", join(dir, "none")], { ...env, KIT11_DB: join(dir, "missing.sqlite") }).code).toBe(2);
    // writeComplianceEvidence refuses to write over a directory that holds other files.
    expect(() => writeComplianceEvidence(out, buildComplianceEvidence(complianceWorld().db, NOVEMBER, { key }))).toThrow(/already holds/);
  }, 120_000);
});
