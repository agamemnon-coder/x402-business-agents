// The virtual second approver (docs/runs/driver/test-controller.ts): a Chromium virtual authenticator that plays the
// second owner of the passkey account when the owner has one device. Breaks if it can be given another name, keep its
// credential inside the repository or readable by others, enrol before the owner or over an existing passkey, confirm
// its own fingerprint, sign anything but an owners_execute, sign first, or sign with a credential that is not the
// active passkey labelled test-controller. The phone is a seam here (a software authenticator); the browser check
// test/browser/test-controller.check.ts drives the real one against a local relay.
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Address } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { termsHash, TERMS_SCHEMA } from "../src/lib/terms.js";
import { approvalHashOf, coseP256, ownersExecuteTerms, type OwnersExecuteTerms } from "../src/metal/ownersExecute.js";
import { passkeySigner } from "../src/metal/passkeyOwner.js";
import { confirmPasskey, fingerprintOf, openEnrolment, openWindow, pendingPasskeys } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { signerLabel } from "../src/ops/reliability.js";
import {
  approve, CREDENTIAL_FILE, credentialFile, enrol, LABEL, loadCredential, NAME, parseCommand, Refused, relayOf, saveCredential, viewerOf,
  type ControllerDeps, type ControllerPhone, type StoredCredential,
} from "../docs/runs/driver/test-controller.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-11-12T10:00:00Z");
const VERIFIER = "0xd4c84c2bea087053691623bc463da61b528755ab" as Address;
// A real owners_execute from test world dry-93 (a bind on the passkey account, public testnet data).
const F = JSON.parse(readFileSync(new URL("./fixtures/owners-execute-terms.json", import.meta.url), "utf8")) as OwnersExecuteTerms;
const REPO = resolve(import.meta.dirname, "..");
process.env.KIT11_PASSKEY_OWNERS = "on";
let n = 0;
const item = (kind: InboxItem["kind"], body: unknown, id: string | null = null): InboxItem => ({ ticket: `t-${++n}`, kind, proposal_id: id, body: JSON.stringify(body), received_at: t0.toISOString() });
const b64 = (b64url: string) => Buffer.from(b64url, "base64url").toString("base64");
const pkOf = (db: DB, id: string) => (db.prepare("SELECT public_key FROM passkeys WHERE credential_id = ?").get(id) as { public_key: string }).public_key;
const events = (db: DB, event: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

/** The owner's passkey, enrolled and confirmed as the runner's own first passkey (label max). */
async function ownerEnrols(db: DB): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  await processRegistration(db, item("registration", { code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, t0);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), t0);
  return auth;
}

interface World { db: DB; env: Record<string, string>; lines: string[]; opened: number; auth: FakeAuthenticator; deps: ControllerDeps; pressed: string[] }

/** A world whose phone is a software authenticator behind the driver's phone seam; what the runner does is done in process. */
function world(): World {
  const db = openDb(":memory:");
  const keys = mkdtempSync(join(tmpdir(), "kit11-test-controller-"));
  const w: World = { db, env: { KIT11_KEYS_DIR: keys, KIT11_RELAY_URL: ORIGIN, KIT11_RELAY_TOKEN: "relay-token-for-tests" }, lines: [], opened: 0, auth: new FakeAuthenticator(), pressed: [], deps: undefined as never };
  let count: number | null = null;
  const phone: ControllerPhone = {
    async enrol(code) {
      const window = openWindow(db, t0)!;
      await processRegistration(db, item("registration", { code, credential: w.auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, t0);
      return { fingerprint: fingerprintOf(w.auth.spkiSha256), credential: { credentialId: b64(w.auth.credentialId), isResidentCredential: true, rpId: RP, privateKey: "cHJpdmF0ZQ==", userHandle: "dQ==", signCount: 1 } };
    },
    async approve(id, stored, guard) {
      guard();
      w.pressed.push(id);
      const p = db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; terms_json: string; terms_sha256: string };
      const out = await processAssertion(db, item("assertion", { proposal_id: id, terms_sha256: p.terms_sha256, credential: w.auth.sign({ challenge: challengeFor(approvalHashOf(p)), origin: ORIGIN, rpId: RP, counter: stored.credential.signCount + 1 }) }, id), t0);
      count = stored.credential.signCount + 1;
      return { verdict: out.status === "approved" ? "Approved" : out.status === "cosigned" ? "1 of 2 approvals" : "Refused" };
    },
    signCount: async () => count,
    async close() { /* nothing to close */ },
  };
  w.deps = { db, env: w.env, say: (l) => w.lines.push(l), now: () => t0, sleep: async () => undefined, phone: async () => { w.opened++; return phone; } };
  return w;
}

/** Owner and virtual controller both enrolled (the operator confirmed the controller's fingerprint), and an owners_execute filed. */
async function readyWorld(): Promise<World & { max: FakeAuthenticator; terms: OwnersExecuteTerms; fingerprint: string }> {
  const w = world();
  const max = await ownerEnrols(w.db);
  const { fingerprint } = await enrol(w.deps);
  confirmPasskey(w.db, fingerprint, t0);
  const terms = ownersExecuteTerms({
    proposal_id: "P-0001", expires_at: "2026-11-12T10:15:00Z", account: F.account, chain_id: "63825",
    owners: [passkeySigner(VERIFIER, coseP256(pkOf(w.db, max.credentialId))), passkeySigner(VERIFIER, coseP256(pkOf(w.db, w.auth.credentialId)))],
    calls: F.calls, nonce: F.nonce, valid_until: String(Math.floor(Date.parse("2026-11-12T10:15:00Z") / 1000) + 120), action: F.action,
  });
  createProposal(w.db, { terms, createdBy: "treasury" }, t0);
  audit(w.db, "owner-signer", "owners.account_created", F.account, { account: F.account, owners: ["max", NAME], threshold: "2" }, t0);
  return Object.assign(w, { max, terms, fingerprint });
}
const ownerSigns = (w: { db: DB; max: FakeAuthenticator; terms: OwnersExecuteTerms }) => processAssertion(w.db, item("assertion", {
  proposal_id: "P-0001", terms_sha256: termsHash(w.terms), credential: w.max.sign({ challenge: challengeFor(w.terms.onchain_digest.slice(2)), origin: ORIGIN, rpId: RP, counter: 1 }),
}, "P-0001"), t0);
const statusOf = (db: DB, id = "P-0001") => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const refusal = async (run: () => Promise<unknown>): Promise<string> => { try { await run(); } catch (e) { expect(e).toBeInstanceOf(Refused); return (e as Error).message; } throw new Error("it did not refuse"); };

describe("the virtual second approver's name and commands", () => {
  it("is test-controller, a constant, and every line it prints about itself says it is a virtual test passkey", () => {
    expect(NAME).toBe("test-controller");
    expect(LABEL).toBe("virtual test passkey (test-controller)");
    // The word the reliability record uses for this label (src/ops/reliability.ts) is the same.
    expect(signerLabel(`${NAME} (passkey 12345678)`)).toBe("virtual test passkey (second approver role)");
  });

  it("takes enrol and approve <proposal id>, and refuses any other name, a rejection, or anything else", () => {
    expect(parseCommand(["enrol"])).toEqual({ cmd: "enrol" });
    expect(parseCommand(["enrol", "test-controller"])).toEqual({ cmd: "enrol" });
    expect(parseCommand(["approve", "P-0002"])).toEqual({ cmd: "approve", id: "P-0002" });
    expect(() => parseCommand(["enrol", "max"])).toThrow(/only ever test-controller/);
    expect(() => parseCommand(["enrol", "anna"])).toThrow(Refused);
    expect(() => parseCommand(["approve"])).toThrow(/usage/);
    expect(() => parseCommand(["approve", "P-0002", "--reject"])).toThrow(/only approves/);
    expect(() => parseCommand(["reject", "P-0002"])).toThrow(/only approves/);
    expect(() => parseCommand(["approve", "../P-0002"])).toThrow(/not a proposal id/);
    expect(() => parseCommand([])).toThrow(/usage/);
  });
});

describe("where the virtual passkey's credential is kept", () => {
  it("refuses a keys folder inside the repository", () => {
    expect(() => credentialFile({ KIT11_KEYS_DIR: join(REPO, "data/keys") })).toThrow(/outside the code repo/);
    expect(() => credentialFile({ KIT11_KEYS_DIR: REPO })).toThrow(/outside the code repo/);
    expect(() => credentialFile({})).toThrow(/KIT11_KEYS_DIR/);
    const keys = mkdtempSync(join(tmpdir(), "kit11-test-controller-"));
    expect(credentialFile({ KIT11_KEYS_DIR: keys })).toBe(join(keys, CREDENTIAL_FILE));
  });

  const stored: StoredCredential = { label: "test-controller", virtual: true, what: "x", saved_at: t0.toISOString(), credential: { credentialId: "aWQ=", isResidentCredential: true, rpId: RP, privateKey: "cHJpdmF0ZQ==", userHandle: "dQ==", signCount: 1 } };

  it("writes it readable by its owner only, and never widens a file that is there", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kit11-test-controller-")), CREDENTIAL_FILE);
    saveCredential(file, stored);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadCredential(file).credential.signCount).toBe(1);
    // A file someone made stricter stays as strict when the sign counter is saved.
    chmodSync(file, 0o400);
    saveCredential(file, { ...stored, credential: { ...stored.credential, signCount: 2 } });
    expect(statSync(file).mode & 0o777).toBe(0o400);
    expect(loadCredential(file).credential.signCount).toBe(2);
    // A file someone made readable by others is not read, and is closed again by the next save.
    chmodSync(file, 0o644);
    expect(() => loadCredential(file)).toThrow(/readable by others/);
    saveCredential(file, stored);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("reads only a credential that says it is the virtual test-controller", () => {
    const file = join(mkdtempSync(join(tmpdir(), "kit11-test-controller-")), CREDENTIAL_FILE);
    expect(() => loadCredential(file)).toThrow(/no credential/);
    writeFileSync(file, JSON.stringify({ ...stored, label: "max" }), { mode: 0o600 });
    expect(() => loadCredential(file)).toThrow(/not the virtual test-controller's/);
  });
});

describe("what the virtual phone needs from the environment", () => {
  it("takes the relay's address and token from the environment and looks nothing up", () => {
    expect(relayOf({ KIT11_RELAY_URL: `${ORIGIN}/`, KIT11_RELAY_TOKEN: "t" })).toEqual({ url: ORIGIN, origin: ORIGIN, rpId: RP, token: "t" });
    // Without the address it refuses: the runner can look it up at Cloudflare, this driver never does.
    expect(() => relayOf({ KIT11_RELAY_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" })).toThrow(/KIT11_RELAY_URL/);
    expect(() => relayOf({ KIT11_RELAY_URL: "not an address", KIT11_RELAY_TOKEN: "t" })).toThrow(/KIT11_RELAY_URL/);
    expect(() => relayOf({ KIT11_RELAY_URL: ORIGIN })).toThrow(/KIT11_RELAY_TOKEN/);
  });

  it("builds the viewer link from the token and the runner's key file, and refuses before the runner has made that key", () => {
    const w = world();
    expect(() => viewerOf(w.env)).toThrow(/start the runner/);
    expect(existsSync(join(w.env.KIT11_KEYS_DIR!, "relay-display-key.pem"))).toBe(false);
  });
});

describe("enrol", () => {
  let w: World;
  beforeEach(() => { w = world(); });

  it("refuses before the owner's passkey is enrolled, and opens nothing", async () => {
    expect(await refusal(() => enrol(w.deps))).toMatch(/the owner enrols first/);
    expect(w.opened).toBe(0);
    expect((w.db.prepare("SELECT COUNT(*) AS n FROM passkey_enrolments").get() as { n: number }).n).toBe(0);
  });

  it("refuses while another enrolment window is open: it never enrols through a window that is not its own", async () => {
    await ownerEnrols(w.db);
    openEnrolment(w.db, { rpId: RP, origin: ORIGIN, addPerson: "anna" }, t0);
    expect(await refusal(() => enrol(w.deps))).toMatch(/window is open for anna/);
    expect(w.opened).toBe(0);
    expect(openWindow(w.db, t0)?.label).toBe("anna");
  });

  it("creates the passkey in a window for test-controller only, keeps the credential, and leaves the confirmation to the operator", async () => {
    const max = await ownerEnrols(w.db);
    const out = await enrol(w.deps);
    expect(out.fingerprint).toBe(fingerprintOf(w.auth.spkiSha256));
    // The window it opened adds the person test-controller: the label is in the audit row.
    expect(events(w.db, "passkey.enrolment_opened").at(-1)).toMatchObject({ adds: NAME, replace: false });
    // Not confirmed by the driver: the passkey waits, and the owner's is still the only active one.
    expect(pendingPasskeys(w.db, t0).map((p) => [p.label, p.fingerprint])).toEqual([[NAME, out.fingerprint]]);
    expect((w.db.prepare("SELECT label, credential_id FROM passkeys WHERE status = 'ACTIVE'").all() as { label: string; credential_id: string }[])).toEqual([{ label: "max", credential_id: max.credentialId }]);
    const file = credentialFile(w.env);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadCredential(file)).toMatchObject({ label: NAME, virtual: true, credential: { rpId: RP, signCount: 1 } });
    const text = w.lines.join("\n");
    expect(text).toContain(`npm run passkey -- confirm ${out.fingerprint}`);
    expect(text).toMatch(/on the owner's go/);
    // Every line it prints says what it is; none holds the key or the relay's token.
    for (const l of w.lines) expect(l).toMatch(/virtual test passkey \(test-controller\)|^ {17}/);
    expect(text).not.toContain("cHJpdmF0ZQ==");
    expect(text).not.toContain(w.env.KIT11_RELAY_TOKEN);
    // The operator's confirmation pins it under the label, and the audit row carries the label.
    confirmPasskey(w.db, out.fingerprint, t0);
    expect(events(w.db, "passkey.enrolled").at(-1)).toMatchObject({ label: NAME, fingerprint: out.fingerprint, confirmed_on: "runner" });
  });

  it("refuses when test-controller already has an active passkey, or one waiting: it replaces nobody's passkey", async () => {
    await ownerEnrols(w.db);
    const { fingerprint } = await enrol(w.deps);
    expect(await refusal(() => enrol(w.deps))).toMatch(new RegExp(`waits.*npm run passkey -- confirm ${fingerprint}`));
    confirmPasskey(w.db, fingerprint, t0);
    const before = readFileSync(credentialFile(w.env), "utf8");
    expect(await refusal(() => enrol(w.deps))).toMatch(/already has an active passkey/);
    expect(w.opened).toBe(1);
    expect(readFileSync(credentialFile(w.env), "utf8")).toBe(before);
    expect((w.db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'REVOKED'").get() as { n: number }).n).toBe(0);
  });

  it("gives no confirm line when the fingerprint the page shows is not the passkey waiting in its own window", async () => {
    await ownerEnrols(w.db);
    const real = await w.deps.phone();
    w.deps.phone = async () => ({ ...real, enrol: async (code) => ({ ...(await real.enrol(code)), fingerprint: "AAAA-BBBB-CCCC-DDDD" }) });
    await expect(enrol(w.deps)).rejects.toThrow(/do not confirm/);
    expect(w.lines.join("\n")).not.toMatch(/npm run passkey -- confirm/);
  });
});

describe("approve", () => {
  it("refuses to sign first: the owner's approval must be in the ledger before the virtual approver's", async () => {
    const w = await readyWorld();
    expect(await refusal(() => approve(w.deps, "P-0001"))).toMatch(/never signs first/);
    expect(w.opened).toBe(1); // the enrolment only
    expect(w.pressed).toEqual([]);
    expect(statusOf(w.db)).toBe("PENDING_APPROVAL");
    expect((w.db.prepare("SELECT COUNT(*) AS n FROM cosignatures").get() as { n: number }).n).toBe(0);
  });

  it("signs second, after another person, and the approval row names test-controller", async () => {
    const w = await readyWorld();
    expect(await ownerSigns(w)).toMatchObject({ status: "cosigned" });
    const out = await approve(w.deps, "P-0001");
    expect(out).toMatchObject({ ok: true, verdict: "Approved" });
    expect(statusOf(w.db)).toBe("APPROVED");
    const approver = String(events(w.db, "proposal.approved").at(-1)!.approver);
    expect(approver).toMatch(/^max \(passkey .{8}\) \+ test-controller \(passkey .{8}\)$/);
    expect(signerLabel(approver.split(" + ")[1]!)).toBe("virtual test passkey (second approver role)");
    // The sign counter is kept for the next use.
    expect(loadCredential(credentialFile(w.env)).credential.signCount).toBe(2);
    expect(w.lines.at(-1)).toMatch(/^APPROVED {9}virtual test passkey \(test-controller\): signed P-0001 as the second approver, after max; the page says "Approved"$/);
  });

  it("refuses a proposal that is not an owners_execute", async () => {
    const w = await readyWorld();
    createProposal(w.db, { terms: { schema: TERMS_SCHEMA, kind: "dev_test", proposal_id: "P-0002", expires_at: "2026-11-12T10:15:00Z", label: "Dev test", purpose: "a check" }, createdBy: "system" }, t0);
    expect(await refusal(() => approve(w.deps, "P-0002"))).toMatch(/P-0002 is a dev_test, not an owners_execute/);
    expect(await refusal(() => approve(w.deps, "P-0009"))).toMatch(/no proposal P-0009/);
    expect(w.pressed).toEqual([]);
  });

  it("refuses when the credential in its file is not the active passkey labelled test-controller", async () => {
    // Not confirmed yet: the passkey waits, it is not active.
    const u = world();
    await ownerEnrols(u.db);
    await enrol(u.deps);
    expect(await refusal(() => approve(u.deps, "P-0001"))).toMatch(/not the active passkey labelled test-controller/);
    // Another credential in the file than the one the ledger pinned.
    const w = await readyWorld();
    await ownerSigns(w);
    const file = credentialFile(w.env);
    const kept = loadCredential(file);
    saveCredential(file, { ...kept, credential: { ...kept.credential, credentialId: b64(w.max.credentialId) } });
    expect(await refusal(() => approve(w.deps, "P-0001"))).toMatch(/not the active passkey labelled test-controller/);
    // No file at all.
    const x = await readyWorld();
    await ownerSigns(x);
    writeFileSync(credentialFile(x.env), "", { mode: 0o600 });
    await expect(approve(x.deps, "P-0001")).rejects.toThrow(/no credential/);
    expect([...u.pressed, ...w.pressed, ...x.pressed]).toEqual([]);
    expect(statusOf(w.db)).toBe("PENDING_APPROVAL");
  });

  it("refuses a proposal that is decided or expired, and a second signature of its own", async () => {
    const w = await readyWorld();
    await ownerSigns(w);
    await approve(w.deps, "P-0001");
    expect(await refusal(() => approve(w.deps, "P-0001"))).toMatch(/P-0001 is approved, not waiting for approval/);
    const late = await readyWorld();
    await ownerSigns(late);
    late.deps.now = () => new Date("2026-11-12T10:15:01Z");
    expect(await refusal(() => approve(late.deps, "P-0001"))).toMatch(/expired/);
    expect(late.pressed).toEqual([]);
  });

  it("checks the ledger again with the page open, just before it signs", async () => {
    const w = await readyWorld();
    await ownerSigns(w);
    const real = await w.deps.phone();
    w.deps.phone = async () => ({ ...real, approve: async (id, stored, guard) => {
      // Between the first check and the press the owner's passkey is revoked: nobody else's approval stands any more.
      w.db.prepare("DELETE FROM cosignatures").run();
      return real.approve(id, stored, guard);
    } });
    expect(await refusal(() => approve(w.deps, "P-0001"))).toMatch(/never signs first/);
    expect(w.pressed).toEqual([]);
  });
});
