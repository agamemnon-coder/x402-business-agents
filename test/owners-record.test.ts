// npm run owners -- record: the record of a run on the passkey account, written from the ledger's audit rows and the
// call log. Breaks if the record says anything a row does not (a step with no row must read "not run", a proposal that
// is waiting, executing or failed must read so); if a device is recorded as anything but the owner's statement; if a
// virtual test passkey is not named as one; if a date comes from the clock; if a credential or the relay's address
// reaches the record; if the command needs the owner's go or the endpoint, or runs without the call log; or if it
// overwrites another world's record. Software passkeys and the stand-in chain; no network.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../src/audit/log.js";
import { EXPLORER_TX } from "../src/metal/network.js";
import { readOwnersCalls } from "../src/metal/ownersBudget.js";
import { propose, setup } from "../src/metal/ownersFlow.js";
import { buildOwnersRecord, CLI_NOTE, DEVICE_NOTE, RecordRefused, recordRefusals, recordRun, renderOwnersRecord, writeOwnersRecord, type OwnersRecord, type RecordInputs } from "../src/metal/ownersRecord.js";
import { PASSKEY_VERIFIER } from "../src/metal/passkeyRelay.js";
import { loadVerifier } from "../src/metal/verifierCompile.js";
import { ownersWorld, T0, type TestWorld } from "./support/ownersWorld.js";

vi.setConfig({ testTimeout: 30_000 });
const REPO = resolve(import.meta.dirname, "..");
let w: TestWorld;
const temps: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "owners-record-")); temps.push(d); return d; };
afterEach(() => { vi.useRealTimers(); w?.close(); for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function world(o: Parameters<typeof ownersWorld>[0] = {}): Promise<TestWorld> {
  w = await ownersWorld(o);
  w.node.code.set(PASSKEY_VERIFIER.toLowerCase(), "0x60");
  return w;
}
const build = (inputs: Partial<RecordInputs> = {}): OwnersRecord => buildOwnersRecord(w.db, readOwnersCalls(w.log), { budget: 200, ...inputs });
const rows = (event: string) => (w.db.prepare("SELECT seq, ts, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { seq: number; ts: string; subject: string; payload_json: string }[]).map((r) => ({ seq: r.seq, ts: r.ts, subject: r.subject, p: JSON.parse(r.payload_json) as Record<string, unknown> }));
const text = (r: OwnersRecord) => `${JSON.stringify(r)}\n${renderOwnersRecord(r)}`;

describe("the record of a world that was only set up", () => {
  it("holds the account, the threshold, the verifier and its artifact, and the owners, each as the audit rows have them", async () => {
    await world();
    w.clock.now = new Date(T0.getTime() + 60_000);
    const { account } = await setup(w.d);
    const r = build();
    const made = rows("owners.account_created")[0]!;
    expect(r).toMatchObject({ network: "Metal testnet", chain_id: 63825, account, threshold: 2, verifier: made.p.verifier, stand_in: null });
    expect(r.account).toBe(made.p.account);
    // The artifact is read from the committed file, never typed.
    const artifact = loadVerifier();
    expect(r.verifier_artifact).toEqual({ openzeppelin: artifact.openzeppelin, compiler: artifact.compiler, evm: artifact.evmVersion, bytecode_sha256: artifact.bytecode_sha256 });
    // The owners: label, fingerprint and time from each passkey's enrolment row; the first enrolled is the CFO.
    const enrolled = rows("passkey.enrolled");
    expect(r.owners).toEqual([
      { role: "CFO", label: "max", fingerprint: enrolled[0]!.p.fingerprint, enrolled_at: enrolled[0]!.ts, virtual: false, device: "not stated", device_basis: "not stated" },
      { role: "second approver", label: "controller", fingerprint: enrolled[1]!.p.fingerprint, enrolled_at: enrolled[1]!.ts, virtual: false, device: "not stated", device_basis: "not stated" },
    ]);
    expect(r.owners[0]!.fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(r.device_note).toBe(DEVICE_NOTE);
  });

  it("lists the three transactions of setup with their hashes and explorer links, and every later step as not run", async () => {
    await world();
    await setup(w.d);
    const r = build();
    const done = rows("owners.tx_done");
    expect(r.steps.filter((s) => s.kind === "setup")).toEqual(done.map((d) => ({ kind: "setup", step: d.p.what, outcome: "done", at: d.ts, tx: d.p.tx, explorer: `${EXPLORER_TX}${String(d.p.tx)}`, detail: `block ${String(d.p.block)}; ${String(d.p.gas_used)} gas` })));
    expect(done.map((d) => d.p.what)).toEqual(["fund the gas sponsor with 5.00 test USD from the donor key", "create the passkey account (two passkey owners, threshold 2)", "fund the passkey account with 0.60 test USD"]);
    expect(r.steps.filter((s) => s.kind !== "setup").map((s) => [s.step, s.outcome, s.tx, s.at])).toEqual([
      ["bind the mandate: a proposal, both owners' approvals, and the account's call", "not run", null, null],
      ["replace the mandate: a proposal, both owners' approvals, and the account's call", "not run", null, null],
      ["revoke the mandate: a proposal, both owners' approvals, and the account's call", "not run", null, null],
      ["the Sourcing agent pays inside the mandate", "not run", null, null],
      ["a payment over the mandate's cap, refused on chain", "not run", null, null],
      ["the refused amount, paid after the owners raised the cap", "not run", null, null],
    ]);
    expect(r.proposals).toEqual([]);
    expect(r.refused_then_paid).toEqual([]);
    expect(renderOwnersRecord(r)).toMatch(/\| 9 \| {2}\| the refused amount, paid after the owners raised the cap<br>no such payment in this world's audit rows \| not run \| {2}\|/);
  });

  it("says what a setup that sent nothing itself did not do, and what a stopped one left open", async () => {
    await world();
    // An account this world recorded without creating or funding it (it was on chain already): no transaction, so not run.
    audit(w.db, "owner-signer", "owners.account_created", "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", { account: "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", owners: ["controller", "max"], signers: [], threshold: "2", verifier: PASSKEY_VERIFIER, tx: null }, T0);
    const r = build();
    expect(r.steps.slice(0, 2).map((s) => [s.step, s.outcome])).toEqual([["create the passkey account", "not run"], ["fund the passkey account", "not run"]]);
    expect(text(r)).not.toMatch(/"outcome":"done"/);
    w.close();
    // A setup stopped between a send and its receipt: sent, and no more than that.
    await world();
    w.node.state.receiptAfter = Infinity;
    await expect(setup(w.d)).rejects.toThrow(/no receipt yet/);
    await expect(async () => build()).rejects.toThrow(RecordRefused);
    audit(w.db, "owner-signer", "owners.account_created", "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", { account: "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", owners: ["controller", "max"], signers: [], threshold: "2", verifier: PASSKEY_VERIFIER, tx: null }, T0);
    const open = build().steps[0]!;
    expect(open).toMatchObject({ step: "fund the gas sponsor with 5.00 test USD from the donor key", outcome: "sent, no receipt recorded", tx: rows("owners.tx_sent")[0]!.p.tx });
  });

  it("refuses a world with no passkey account: there is nothing to record", async () => {
    await world();
    expect(() => build()).toThrow(/holds no passkey account yet .*Nothing was written/);
  });
});

describe("what the owner states about the devices", () => {
  it("is recorded as stated by the owner, one line, capped, and never as proven", async () => {
    await world();
    await setup(w.d);
    const r = build({ devices: { cfo: "  iPhone 15 Pro,\n Face ID  ", controller: `a second phone ${"x".repeat(300)}` } });
    expect(r.owners[0]).toMatchObject({ role: "CFO", device: "iPhone 15 Pro, Face ID", device_basis: "as stated by the owner", virtual: false });
    expect(r.owners[1]).toMatchObject({ role: "second approver", device_basis: "as stated by the owner" });
    expect(r.owners[1]!.device).toHaveLength(120);
    expect(r.owners[1]!.device.endsWith("…")).toBe(true);
    const page = renderOwnersRecord(r);
    expect(page).toContain("| CFO | max |");
    expect(page).toContain("iPhone 15 Pro, Face ID (as stated by the owner)");
    expect(page).toContain("Attestation is none, so the device type cannot be proven: a device description here is the owner's statement, not a finding of this record.");
    // Nothing says a device was proven, verified or attested, or that a phone signed.
    const all = text(r).replaceAll(DEVICE_NOTE, "");
    expect(all).not.toMatch(/proven|verified device|attested|device (is|was) (proven|verified|confirmed)|phone signed|signed (on|with) (a|the|his|her|their) (phone|iphone)/i);
    expect(r.stand_in).toBeNull();
  });
});

describe("a virtual second approver, or a virtual CFO", () => {
  it("the label test-controller is recorded as a virtual test passkey, whatever is stated for it, and the record's stand_in names it", async () => {
    await world({ labels: ["max", "test-controller"] });
    await setup(w.d);
    const r = build({ devices: { cfo: "iPhone 15", controller: "a real second phone, honest" } });
    const virtual = "virtual test passkey: Chromium's virtual authenticator driven by docs/runs/driver/test-controller.ts; not a person's device";
    expect(r.owners[1]).toEqual({
      role: "second approver", label: "test-controller", fingerprint: rows("passkey.enrolled")[1]!.p.fingerprint, enrolled_at: rows("passkey.enrolled")[1]!.ts, virtual: true, device: virtual,
      device_basis: "the passkey's label marks a virtual test passkey", stated_device_ignored: "a device description was stated for this owner and is not recorded: the label marks a virtual test passkey",
    });
    expect(r.owners[0]).toMatchObject({ role: "CFO", label: "max", virtual: false, device: "iPhone 15", device_basis: "as stated by the owner" });
    expect(r.stand_in).toBe(`the second approver "test-controller" is a ${virtual}`);
    expect(text(r)).not.toContain("a real second phone");
    expect(renderOwnersRecord(r)).toContain(`**Stand-in:** the second approver "test-controller" is a ${virtual}.`);
    // Without a statement there is nothing to ignore, and nothing says so.
    expect(build().owners[1]).not.toHaveProperty("stated_device_ignored");
  });

  it("the label test-cfo is a virtual CFO: the record says no person's device signed as the CFO", async () => {
    await world({ labels: ["test-cfo", "test-controller"] });
    await setup(w.d);
    const r = build({ devices: { cfo: "iPhone 15" } });
    expect(r.owners.map((o) => [o.role, o.label, o.virtual])).toEqual([["CFO", "test-cfo", true], ["second approver", "test-controller", true]]);
    expect(r.stand_in).toMatch(/^the CFO "test-cfo" is a virtual test passkey in the CFO role: .*; not a person's device; no person's device signed as the CFO; the second approver "test-controller" is a virtual test passkey: /);
    expect(text(r)).not.toContain("iPhone 15");
  });

  it("a virtual label names its role whichever passkey was enrolled first", async () => {
    await world({ labels: ["test-controller", "max"] });
    await setup(w.d);
    expect(build().owners.map((o) => [o.role, o.label])).toEqual([["CFO", "max"], ["second approver", "test-controller"]]);
  });
});

describe("deviations", () => {
  it("are one per line as the runner wrote them, single-lined, capped and redacted; with no file none are stated, and that is said", async () => {
    await world();
    await setup(w.d);
    const env = { METAL_RPC_URL: "https://rpc.example.test/v1/SECRETENDPOINTKEY0123456789", KIT11_RELAY_URL: "https://kit11-relay-abcdef.example.workers.dev", KIT11_RELAY_TOKEN: "relaytoken-0123456789abcdef0123456789abcdef" };
    const r = build({ env, deviations: [
      "the relay at https://kit11-relay-abcdef.example.workers.dev/approve/P-0001 was slow",
      `the endpoint ${env.METAL_RPC_URL} timed out once; token ${env.KIT11_RELAY_TOKEN}`,
      `long ${"y".repeat(400)}`,
      "tabs\tand\u0007bells | pipes",
      "kit11-relay-abcdef.example.workers.dev did not answer for a minute",
    ] });
    expect(r.deviations).toEqual([
      "the relay at [address removed] was slow",
      "the endpoint [rpc-url] timed out once; token [redacted]",
      `long ${"y".repeat(294)}…`,
      "tabs and bells | pipes",
      "[relay address] did not answer for a minute",
    ]);
    expect(r.deviations_note).toMatch(/As the runner wrote them .*code did not check them/);
    expect(text(r)).not.toMatch(/SECRETENDPOINTKEY|relaytoken-|kit11-relay-abcdef|rpc\.example/);
    expect(renderOwnersRecord(r)).toContain("- tabs and bells \\| pipes");
    const none = build();
    expect(none.deviations).toEqual([]);
    expect(none.deviations_note).toBe("No deviations file was given (OWNERS_DEVIATIONS): none are stated here, which is not the same as none happened.");
    expect(renderOwnersRecord(none)).toContain("- none stated");
  });
});

describe("the calls", () => {
  it("are counted from the log by method and by step against the budget, with what a cli: line is", async () => {
    await world({ donor: false });
    await setup(w.d);
    const calls = readOwnersCalls(w.log);
    const r = build({ budget: 40 });
    expect(r.calls).toMatchObject({ budget: 40, used: calls.length, left: 40 - calls.length, note: CLI_NOTE, first_call_at: calls[0]!.at, last_call_at: calls.at(-1)!.at });
    const count = (m: string) => calls.filter((c) => c.method === m).length;
    expect(r.calls.by_method).toEqual(Object.fromEntries([...new Set(calls.map((c) => c.method))].map((m) => [m, count(m)])));
    expect(r.calls.by_method["cli:fund"]).toBe(1);
    expect(Object.values(r.calls.by_method).reduce((n, x) => n + x, 0)).toBe(calls.length);
    expect(r.calls.by_step).toEqual([{ step: "setup", requests: calls.length - 1, cli_runs: 1 }]);
    expect(CLI_NOTE).toBe("A cli:<command> line is one whole run of the metal-agent CLI; the requests it makes inside are not counted.");
    expect(renderOwnersRecord(r)).toContain(`${calls.length} of the 40 calls agreed were used (${40 - calls.length} left). ${CLI_NOTE}`);
    expect(r.written_from).toMatchObject({ call_log_lines: calls.length, audit_log: { chain: "verified", rows: (w.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n } });
    // A budget lowered below what was used leaves nothing, never a negative number.
    expect(build({ budget: 3 }).calls).toMatchObject({ budget: 3, left: 0 });
  });
});

describe("dates", () => {
  it("come from the audit rows, never from the clock", async () => {
    await world({ at: new Date("2026-11-09T08:00:00Z") });
    w.clock.now = new Date("2026-11-09T08:30:00Z");
    await setup(w.d);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-02T03:04:05Z"));
    const r = build();
    expect(r.ran_at).toBe("2026-11-09T08:30:00.000Z");
    expect(r.ran_at).toBe(rows("owners.tx_sent")[0]!.ts);
    expect(r.last_row_at).toBe("2026-11-09T08:30:00.000Z");
    expect(r.owners[0]!.enrolled_at).toBe("2026-11-09T08:00:00.000Z");
    expect(text(r)).not.toMatch(/2031/);
    const dir = temp();
    const written = writeOwnersRecord(r, dir);
    expect(written).toEqual({ json: join(dir, "2026-11-09-faceid-onchain.json"), md: join(dir, "2026-11-09-faceid-onchain.md") });
    expect(readFileSync(written.json, "utf8")).not.toMatch(/2031/);
    expect(JSON.parse(readFileSync(written.json, "utf8"))).toEqual(r);
    expect(readFileSync(written.md, "utf8")).toBe(renderOwnersRecord(r));
  });
});

describe("a proposal that is not done", () => {
  it("is shown as it stands: waiting, one of two, executing with no receipt, failed with the account's reason", async () => {
    await world();
    await setup(w.d);
    const { proposal, terms } = await propose(w.again());
    const id = proposal.proposal_id;
    const of = (r: OwnersRecord) => ({ p: r.proposals[0]!, steps: r.steps.filter((s) => s.proposal_id === id).map((s) => [s.kind, s.outcome]) });
    const status = () => (w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

    let now = of(build());
    expect(now.p).toMatchObject({ proposal_id: id, what: "bind", status: "PENDING_APPROVAL", terms_sha256: proposal.terms_sha256, onchain_digest: terms.onchain_digest, expires_at: terms.expires_at, mandate: terms.action.mandate, cap: "0.05", budget: "0.50", approvals: [], tx: null, explorer: null });
    expect(now.steps).toEqual([["proposal", "filed"], ["approvals", "no approval recorded"], ["relay", "not run"]]);
    expect(build().steps.find((s) => s.kind === "proposal")).toMatchObject({ step: `propose ${id}: bind the sourcing mandate: up to 0.05 a payment, 0.50 in all, Stockline only`, at: rows("proposal.created")[0]!.ts });

    w.clock.now = new Date(T0.getTime() + 120_000);
    expect(await w.sign(id, 0)).toMatchObject({ status: "cosigned" });
    now = of(build());
    const cosigned = rows("proposal.cosigned")[0]!;
    expect(now.p).toMatchObject({ status: "PENDING_APPROVAL", approvals: [{ by: "max", role: "CFO", fingerprint: rows("passkey.enrolled")[0]!.p.fingerprint, at: cosigned.ts, of: "1 of 2" }] });
    expect(now.steps[1]).toEqual(["approvals", "1 of 2 approvals"]);

    w.clock.now = new Date(T0.getTime() + 180_000);
    expect(await w.sign(id, 1)).toMatchObject({ status: "approved" });
    expect(of(build()).p).toMatchObject({ status: "APPROVED", approvals: [{ by: "max", of: "1 of 2" }, { by: "controller", role: "second approver", fingerprint: rows("passkey.enrolled")[1]!.p.fingerprint, at: rows("proposal.approved")[0]!.ts, of: "2 of 2" }] });

    // Relayed, and the runner stopped before the receipt: executing, sent, and no more than that.
    w.node.state.receiptAfter = Infinity;
    await expect(w.relay(id)).rejects.toThrow(/no receipt yet/);
    const sent = rows("owners.sent")[0]!;
    now = of(build());
    expect(now.p).toMatchObject({ status: "EXECUTING", tx: null });
    expect(now.steps[2]).toEqual(["relay", "sent, no receipt recorded"]);
    expect(build().steps.find((s) => s.kind === "relay")).toMatchObject({ tx: sent.p.tx, explorer: `${EXPLORER_TX}${String(sent.p.tx)}`, at: sent.ts });
    expect(status()).toBe("EXECUTING");

    // The account reverts it: failed, with the account's own reason, and nothing reads as executed.
    w.node.state.reverts.set(terms.account.toLowerCase(), "0x");
    w.node.mine(sent.p.tx as `0x${string}`);
    await expect(w.relay(id, { resume: true })).rejects.toThrow(/reverted executeSigned/);
    now = of(build());
    expect(now.p).toMatchObject({ status: "FAILED", tx: null, explorer: null });
    expect(status()).toBe("FAILED");
    const relay = build().steps.find((s) => s.kind === "relay")!;
    expect(relay).toMatchObject({ outcome: "reverted", tx: sent.p.tx, detail: `the account's reason: ${String(rows("owners.reverted")[0]!.p.reason)}` });
    expect(text(build())).not.toMatch(/"outcome":"executed"/);
    expect(renderOwnersRecord(build())).toContain(`### ${id}: bind (FAILED)`);
  });

  it("records nothing of stored terms that no longer hash to what the audit row holds", async () => {
    await world();
    await setup(w.d);
    const { proposal } = await propose(w.again());
    w.db.prepare("UPDATE proposals SET terms_json = replace(terms_json, '\"0.05\"', '\"9.99\"') WHERE proposal_id = ?").run(proposal.proposal_id);
    const p = build().proposals[0]!;
    expect(p).toMatchObject({ what: null, onchain_digest: null, cap: null, terms_sha256: proposal.terms_sha256, note: expect.stringMatching(/do not hash to the terms_sha256 in the audit row/) });
    expect(text(build())).not.toContain("9.99");
  });
});

describe("writing the record", () => {
  it("never overwrites another world's record; the same world's is rewritten", async () => {
    await world();
    await setup(w.d);
    const dir = temp();
    const r = build();
    const first = writeOwnersRecord(r, dir);
    const again = writeOwnersRecord(build({ devices: { cfo: "iPhone 15" } }), dir);
    expect(again).toEqual(first);
    expect((JSON.parse(readFileSync(first.json, "utf8")) as OwnersRecord).owners[0]!.device).toBe("iPhone 15");
    // Another world, the same day: its account differs, and the file stays as it is.
    const before = readFileSync(first.json, "utf8");
    const other = { ...r, account: "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea" };
    expect(() => writeOwnersRecord(other, dir)).toThrow(RecordRefused);
    expect(() => writeOwnersRecord(other, dir)).toThrow(/is the record of another world .*it is not overwritten\. Nothing was written/);
    expect(readFileSync(first.json, "utf8")).toBe(before);
    // A file there that is no record is not overwritten either.
    writeFileSync(first.json, "not json");
    expect(() => writeOwnersRecord(r, dir)).toThrow(/cannot be read as a record; it is not overwritten/);
    expect(readFileSync(first.json, "utf8")).toBe("not json");
  });
});

describe("npm run owners -- record", () => {
  const settings = (over: Record<string, string | undefined> = {}) => ({ OWNERS_CALL_BUDGET: "60", OWNERS_CALL_LOG: w.log, ...over });

  it("needs the call log and the budget, and neither the owner's go nor the endpoint", async () => {
    await world();
    await setup(w.d);
    expect(recordRefusals(settings())).toEqual([]);
    expect(recordRefusals({})).toEqual([expect.stringMatching(/^OWNERS_CALL_BUDGET/), expect.stringMatching(/^OWNERS_CALL_LOG \(the world's call log/)]);
    expect(recordRefusals(settings({ OWNERS_CALL_BUDGET: "many" }))).toEqual([expect.stringMatching(/^OWNERS_CALL_BUDGET/)]);
    expect(recordRefusals(settings({ OWNERS_CALL_LOG: join(w.dir, "no-such.jsonl") }))).toEqual([expect.stringMatching(/OWNERS_CALL_LOG names a file that is not there/)]);
    expect(recordRefusals(settings({ OWNERS_DEVIATIONS: join(w.dir, "no-such.txt") }))).toEqual([expect.stringMatching(/OWNERS_DEVIATIONS names a file that is not there/)]);
    const dir = temp();
    expect(() => recordRun(w.db, { OWNERS_GO: "yes", METAL_RPC_URL: "https://rpc.example.test/v1/key" }, () => {}, dir)).toThrow(/refused: the record needs OWNERS_CALL_BUDGET .*OWNERS_CALL_LOG .*Nothing was written, and nothing was called/);
    expect(existsSync(join(dir, "2026-11-12-faceid-onchain.json"))).toBe(false);
    // With them, and with no go and no endpoint, it writes; the stand-in chain hears nothing.
    const [requests, calls] = [w.node.requests.length, readOwnersCalls(w.log).length];
    const deviations = join(w.dir, "deviations.txt");
    writeFileSync(deviations, "the second approver was enrolled twice\n\n   \nthe first enrolment window ran out\n");
    const said: string[] = [];
    const out = recordRun(w.db, settings({ OWNERS_DEVIATIONS: deviations, OWNERS_DEVICE_CFO: "iPhone 15", OWNERS_DEVICE_CONTROLLER: "iPad" }), (l) => said.push(l), dir);
    expect(out.json).toBe(join(dir, "2026-11-12-faceid-onchain.json"));
    expect(out.record.deviations).toEqual(["the second approver was enrolled twice", "the first enrolment window ran out"]);
    expect(out.record.owners.map((o) => [o.device, o.device_basis])).toEqual([["iPhone 15", "as stated by the owner"], ["iPad", "as stated by the owner"]]);
    expect(out.record.calls).toMatchObject({ budget: 60, used: calls });
    expect(w.node.requests).toHaveLength(requests);
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    expect(said.at(-1)).toBe(`RECORD           ${out.json} and ${out.md} written from ${out.record.written_from.audit_rows} audit rows and ${calls} call-log lines; no call was made`);
    expect(said.join("\n")).toMatch(/^ACCOUNT +0x[0-9a-fA-F]{40}: CFO max \(passkey [0-9A-F-]{19}\), second approver controller \(passkey [0-9A-F-]{19}\); threshold 2$/m);
    expect(said.join("\n")).toMatch(/^not run +the Sourcing agent pays inside the mandate$/m);
    expect(said.join("\n")).toMatch(/^step +create the passkey account \(two passkey owners, threshold 2\): done$/m);
  });

  it("the command itself: no go, no endpoint, the record written beside the ledger's world, the last line as the runbook quotes it", async () => {
    const dir = temp();
    await world({ dbFile: join(dir, "world.sqlite") });
    await setup(w.d);
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OWNERS_|KIT11_RELAY_|CLOUDFLARE_|METAL_RPC_URL$)/.test(k)));
    const run = (env: Record<string, string>) => new Promise<{ code: number | null; out: string; err: string }>((done) => {
      execFile(join(REPO, "node_modules/.bin/tsx"), ["src/cli/ownersExecute.ts", "record"], { cwd: REPO, env: { ...clean, KIT11_DB: join(dir, "world.sqlite"), ...env }, timeout: 220_000 }, (err, stdout, stderr) => {
        done({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, out: stdout, err: stderr });
      });
    });
    const out = join(dir, "records");
    const [refused, noLedger, ok] = await Promise.all([
      run({ OWNERS_RECORD_DIR: out, OWNERS_GO: "yes" }),
      run({ OWNERS_RECORD_DIR: out, OWNERS_CALL_BUDGET: "60", OWNERS_CALL_LOG: w.log, KIT11_DB: join(dir, "no-such.sqlite") }),
      run({ OWNERS_RECORD_DIR: out, OWNERS_CALL_BUDGET: "60", OWNERS_CALL_LOG: w.log }),
    ]);
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/refused: the record needs OWNERS_CALL_BUDGET .*OWNERS_CALL_LOG/);
    expect(noLedger.code).toBe(2);
    expect(noLedger.err).toMatch(/this world's ledger is not there/);
    expect(existsSync(join(dir, "no-such.sqlite"))).toBe(false);
    expect(ok.code, ok.err).toBe(0);
    const base = join(out, "2026-11-12-faceid-onchain");
    const calls = readOwnersCalls(w.log).length;
    expect(ok.out.trimEnd().split("\n").at(-1)).toMatch(new RegExp(`^RECORD           ${base}\\.json and ${base}\\.md written from \\d+ audit rows and ${calls} call-log lines; no call was made$`));
    const written = JSON.parse(readFileSync(`${base}.json`, "utf8")) as OwnersRecord;
    expect(written.account).toBe(rows("owners.account_created")[0]!.p.account);
    expect(readFileSync(`${base}.md`, "utf8")).toMatch(/^# Two passkey owners sign on chain: run record\n/);
    // Nothing was called: the call log is as it was.
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
  }, 240_000);
});
