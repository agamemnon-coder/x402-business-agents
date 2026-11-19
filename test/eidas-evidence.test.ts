// The eIDAS option (docs/legal/eidas-qes.md): an approval exported as JAdES-layout evidence and verified offline; one
// changed byte fails; an RFC 3161 time-stamp from a mock TSA; and the QES adapter's CSC API v2 flow against a MOCK CSC
// server (no QTSP account exists: built and tested against a mock, needs a QTSP account to run live), with its
// refusals: a hash the SAD was not bound to, an expired SAD, a wrong PIN. The passkey flow and the ledger are
// untouched: the export only reads them. No network: the mocks listen on 127.0.0.1.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { CscError, CscQesAdapter, QES_STATUS } from "../src/eidas/csc.js";
import { ecdsaDerToRaw, ecdsaRawToDer } from "../src/eidas/der.js";
import { eidasOn } from "../src/eidas/flag.js";
import {
  approvalFromLedger, approvalFromProofBundle, EIDAS_MEANS, EXPORT_NOTE, exportJades, jadesText, verifyJades, verifyJadesText,
  type JadesExport, type SignedApproval,
} from "../src/eidas/jades.js";
import { requestTimestamp, timeStampQuery, tokenOfResponse, verifyTimestampToken } from "../src/eidas/tsa.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import type { ProofBundle } from "../src/proof/bundle.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { mockCert, MockCsc, MockTsa, ecKey } from "./support/eidasMocks.js";

const ON = { PURSER_EIDAS: "on" } as NodeJS.ProcessEnv;
const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
const t0 = new Date("2026-11-19T09:00:00Z");
const NOW = new Date("2026-11-19T10:00:00Z");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const failed = (r: { checks: { check: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.check);
let tickets = 0;
const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null = null): InboxItem =>
  ({ ticket: `t-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: t0.toISOString() });

/** A runner ledger with one refund batch approved by the CFO's (software) passkey, as test/passkey.test.ts makes one. */
async function ledgerApproval(): Promise<{ db: DB; approval: SignedApproval }> {
  const db = openDb(":memory:");
  const phone = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, t0);
  await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "max" }, t0);
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), t0);
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-19T09:10:00Z", total: "0.60" };
  createProposal(db, { terms, createdBy: "support" }, t0);
  const hash = termsHash(terms);
  const out = await processAssertion(db, item("assertion", { proposal_id: "P-0001", terms_sha256: hash, credential: phone.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: 1 }) }, "P-0001"), t0);
  expect(out.status).toBe("approved");
  return { db, approval: approvalFromLedger(db, "P-0001") };
}

const sample = JSON.parse(readFileSync("docs/proof/try-paid.json", "utf8")) as ProofBundle;
let ledger: { db: DB; approval: SignedApproval };
beforeAll(async () => { ledger = await ledgerApproval(); });

describe("the flag", () => {
  it("is off by default: no export and no QES adapter without PURSER_EIDAS=on", async () => {
    expect(eidasOn({})).toBe(false);
    expect(eidasOn(ON)).toBe(true);
    await expect(exportJades(ledger.approval, { env: {} })).rejects.toThrow(/eIDAS option is off/);
    expect(() => new CscQesAdapter({ baseUrl: "http://127.0.0.1:1/csc/v2", accessToken: "x", authData: async () => [], env: {} })).toThrow(/eIDAS option is off/);
  });
});

describe("export, then verify (round trip)", () => {
  it("a passkey approval from the runner's ledger: the terms, their hash, the assertion, the policy version and the times", async () => {
    const before = (ledger.db.prepare("SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM approvals) + (SELECT COUNT(*) FROM passkey_assertions) AS n").get() as { n: number }).n;
    const exp = await exportJades(ledger.approval, { env: ON, now: NOW });
    expect(exp.signatures).toEqual([]);
    expect(exp.purser.note).toBe(EXPORT_NOTE);
    const ev = JSON.parse(Buffer.from(exp.payload, "base64url").toString("utf8"));
    expect(ev).toMatchObject({ format: "purser.approval-evidence/v1", proposal_id: "P-0001", decision: "APPROVED", source: "runner-ledger", exported_at: NOW.toISOString(), policy: { version: 1 } });
    expect(ev.terms_sha256).toBe(sha256(ev.canonical).toString("hex"));
    expect(ev.passkeys).toHaveLength(1);
    const r = await verifyJadesText(jadesText(exp));
    expect(failed(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.check)).toEqual(["format", "payload", "terms hash", "passkey", "times", "policy"]);
    expect(r.levels.join("\n")).toMatch(/electronic signature over the terms hash.*not a QES/);
    expect(r.levels.join("\n")).toMatch(/no JAdES signature/);
    // The export only reads: the ledger and the approvals are as they were (every money invariant with them).
    const after = (ledger.db.prepare("SELECT (SELECT COUNT(*) FROM audit_log) + (SELECT COUNT(*) FROM approvals) + (SELECT COUNT(*) FROM passkey_assertions) AS n").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("the committed /try proof bundle (a real passkey over a real terms hash, test money); a refusal is not an approval", async () => {
    const exp = await exportJades(approvalFromProofBundle(sample), { env: ON, now: NOW });
    const r = await verifyJades(exp);
    expect(failed(r)).toEqual([]);
    expect(r.checks.find((c) => c.check === "policy")!.detail).toMatch(/carries none/);
    const refused = JSON.parse(readFileSync("docs/proof/try-refused.json", "utf8")) as ProofBundle;
    expect(() => approvalFromProofBundle(refused)).toThrow(/only a paid bundle/);
  });
});

describe("one changed byte fails", () => {
  let exp: JadesExport;
  beforeAll(async () => { exp = await exportJades(ledger.approval, { env: ON, now: NOW, stamp: new MockTsa().stamp }); });

  it("one cent more in the terms: the terms hash and the passkey's signature both fail", async () => {
    const ev = JSON.parse(Buffer.from(exp.payload, "base64url").toString("utf8"));
    ev.terms.total = "0.61";
    ev.canonical = ev.canonical.replace('"0.60"', '"0.61"');
    ev.terms_sha256 = sha256(ev.canonical).toString("hex");
    const { jcs } = await import("@metalntwx/metal-pay/mandates");
    const bad = { ...copy(exp), payload: Buffer.from(jcs(ev)).toString("base64url") };
    const r = await verifyJades(bad);
    expect(r.ok).toBe(false);
    expect(failed(r)).toEqual(expect.arrayContaining(["passkey", "payload time-stamp"]));
  });

  it("every one-byte change, at every place in the file, is refused, never accepted", async () => {
    const text = jadesText(exp);
    expect((await verifyJadesText(text)).ok).toBe(true);
    for (let i = 0; i < text.length; i++) {
      const flipped = text.slice(0, i) + String.fromCharCode(text.charCodeAt(i) ^ 1) + text.slice(i + 1);
      const r = await verifyJadesText(flipped);
      if (r.ok) expect.fail(`byte ${i} (${JSON.stringify(text.slice(i - 20, i + 5))}) changed and the file still verifies`);
    }
    expect(text.length).toBeGreaterThan(3000);
  }, 120_000);

  it("the command line: VALID and exit 0 for the file, NOT VALID and exit 1 for a changed copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "eidas-"));
    const good = join(dir, "P-0001.jades.json"), bad = join(dir, "changed.jades.json");
    const text = jadesText(exp);
    writeFileSync(good, text);
    const i = text.indexOf('"signature"') - 40;
    writeFileSync(bad, text.slice(0, i) + String.fromCharCode(text.charCodeAt(i) ^ 1) + text.slice(i + 1));
    const ok = execFileSync("npx", ["tsx", "src/cli/verifyEidas.ts", good], { encoding: "utf8" });
    expect(ok).toContain("VALID:");
    for (const l of EIDAS_MEANS) expect(ok).toContain(l);
    let code = 0, out = "";
    try { execFileSync("npx", ["tsx", "src/cli/verifyEidas.ts", bad], { encoding: "utf8" }); } catch (e) { code = (e as { status: number }).status; out = (e as { stdout: string }).stdout; }
    expect(code).toBe(1);
    expect(out).toContain("NOT VALID");
    // The export refuses with the flag off.
    let off = 0;
    try { execFileSync("npx", ["tsx", "src/cli/eidasExport.ts", "docs/proof/try-paid.json"], { encoding: "utf8", env: { ...process.env, PURSER_EIDAS: "" }, stdio: "pipe" }); } catch (e) { off = (e as { status: number }).status; }
    expect(off).toBe(2);
  }, 60_000);
});

describe("RFC 3161 time-stamps (a MOCK TSA: no public TSA is reachable from the tests)", () => {
  it("a token over the payload's SHA-256 verifies; over another digest it does not; the TSA's trust is said to be unchecked", async () => {
    const tsa = new MockTsa();
    const digest = sha256("payload");
    const token = tsa.token(digest);
    const ok = verifyTimestampToken(token, digest);
    expect(ok).toMatchObject({ ok: true, genTime: "2026-11-19T10:00:00.000Z" });
    expect(ok.detail).toMatch(/not checked offline/);
    expect(verifyTimestampToken(token, sha256("other")).ok).toBe(false);
    const forged = Buffer.from(token);
    forged[forged.length - 5]! ^= 1;
    expect(verifyTimestampToken(forged, digest).ok).toBe(false);
    expect(verifyTimestampToken(Buffer.from("not DER"), digest)).toMatchObject({ ok: false, detail: /cannot be read/ });
  });

  it("two real public TSA responses, recorded live on 19 Nov 2026 (freetsa.org, DigiCert), verify offline here", () => {
    // Recorded with curl from a query timeStampQuery made (scratch run, outside the suite, which has no network).
    const digest = sha256("purser eidas tsa reachability probe 2026-11-19");
    for (const [file, who] of [["freetsa-2026-11-19.tsr", /Free TSA/], ["digicert-2026-11-19.tsr", /DigiCert/]] as const) {
      const r = verifyTimestampToken(tokenOfResponse(readFileSync(`test/fixtures/eidas/${file}`)), digest);
      expect(r, file).toMatchObject({ ok: true, genTime: expect.stringMatching(/^2026-11-19T15:/), tsa: expect.stringMatching(who) });
      expect(r.detail).toMatch(/not checked offline/);
      expect(verifyTimestampToken(tokenOfResponse(readFileSync(`test/fixtures/eidas/${file}`)), sha256("other")).ok).toBe(false);
    }
  });

  it("requestTimestamp speaks RFC 3161 over HTTP (to the mock on 127.0.0.1)", async () => {
    const tsa = new MockTsa();
    const url = await tsa.listen();
    try {
      const digest = sha256("evidence");
      expect(verifyTimestampToken(await requestTimestamp(url, digest), digest).ok).toBe(true);
      expect(timeStampQuery(digest).subarray(0, 1)).toEqual(Buffer.from([0x30]));
      await expect(requestTimestamp(`${url.replace("/tsr", "")}/missing`, digest, async (u, init) => fetch(u, { ...init, headers: { "content-type": "text/plain" } }))).rejects.toThrow(/refused/);
    } finally {
      await tsa.close();
    }
  });
});

describe("the QES adapter, CSC API v2, against a MOCK CSC server (needs a QTSP account to run live)", () => {
  let csc: MockCsc;
  let url: string;
  beforeAll(async () => {
    csc = new MockCsc(() => NOW);
    csc.addCredential({ id: "cfo-es256" });
    csc.addCredential({ id: "cfo-rs256", kind: "rsa" });
    csc.addCredential({ id: "cfo-not-qc", qc: false, qualifier: "eu_eidas_aes" });
    url = await csc.listen();
  });
  afterAll(() => csc.close());
  const adapter = (credentialId?: string, extra: Partial<ConstructorParameters<typeof CscQesAdapter>[0]> = {}) =>
    new CscQesAdapter({ baseUrl: url, accessToken: csc.token, credentialId, authData: async () => [{ id: "PIN", value: "123456" }], env: ON, ...extra });

  it("says what it is everywhere: built and tested against a mock, needs a QTSP account", () => {
    expect(QES_STATUS).toBe("built and tested against a mock CSC server; needs a QTSP account to run live (no live QES has been made)");
    expect(adapter().status).toBe(QES_STATUS);
    expect(() => adapter(undefined, { baseUrl: "http://127.0.0.1:1/api" })).toThrow(/ends in \/csc\/v2/);
  });

  it("list → authorize (SAD bound to the one hash) → signHash: a JAdES-B-T signature over the same terms hash, verified offline", async () => {
    csc.calls.length = 0;
    const tsa = new MockTsa();
    const exp = await exportJades(ledger.approval, { env: ON, now: NOW, qes: adapter(), stamp: tsa.stamp });
    expect(csc.calls.map((c) => c.method)).toEqual(["credentials/list", "credentials/authorize", "signatures/signHash"]);
    const [, auth, sign] = csc.calls;
    // What the QTSP signs is SHA-256 of the JAdES signing input, whose payload carries the terms and their hash.
    const s = exp.signatures[0]!;
    const signedHash = sha256(`${s.protected}.${exp.payload}`).toString("base64");
    expect(auth!.body).toMatchObject({ credentialID: "cfo-es256", numSignatures: 1, hashes: [signedHash], hashAlgorithmOID: "2.16.840.1.101.3.4.2.1" });
    expect(String(auth!.body.description)).toContain(ledger.approval.terms_sha256);
    expect(sign!.body).toMatchObject({ credentialID: "cfo-es256", hashes: [signedHash], signAlgo: "1.2.840.10045.4.3.2" });
    const header = JSON.parse(Buffer.from(s.protected, "base64url").toString("utf8"));
    expect(Object.keys(header).sort()).toEqual(["alg", "iat", "srCms", "x5c", "x5t#S256"]);
    expect(header).toMatchObject({ alg: "ES256", iat: NOW.getTime() / 1000, srCms: [{ commId: { id: "http://uri.etsi.org/01903/v1.2.2#ProofOfApproval" } }] });
    const r = await verifyJades(exp);
    expect(failed(r)).toEqual([]);
    expect(r.levels.join("\n")).toMatch(/JAdES-B-T signature; its certificate claims to be qualified .*QcCompliance, QcSSCD.*not checked offline/);
    expect(r.checks.find((c) => c.check === "jades")!.detail).toMatch(/MOCK CFO.*claims QcCompliance, QcSSCD, QcType esign.*not checked against the EU Trusted List/);
    // One changed byte of the qualified signature, or of what it covers, fails.
    const bad = copy(exp);
    bad.signatures[0]!.signature = Buffer.from(Buffer.from(s.signature, "base64url").map((b, i) => (i === 3 ? b ^ 1 : b))).toString("base64url");
    expect(failed(await verifyJades(bad))).toEqual(expect.arrayContaining(["jades"]));
    // Another certificate in x5c (a key that did not sign): refused.
    const other = mockCert({ cn: "someone else", key: ecKey() }).toString("base64");
    const swapped = copy(exp);
    const h2 = { ...header, x5c: [other] };
    swapped.signatures[0]!.protected = Buffer.from(JSON.stringify(h2)).toString("base64url");
    expect((await verifyJades(swapped)).ok).toBe(false);
  });

  it("every one-byte change of a file with a JAdES-B-T signature and two time-stamps is refused too", async () => {
    const text = jadesText(await exportJades(ledger.approval, { env: ON, now: NOW, qes: adapter(), stamp: new MockTsa().stamp }));
    expect((await verifyJadesText(text)).ok).toBe(true);
    for (let i = 0; i < text.length; i++) {
      const r = await verifyJadesText(text.slice(0, i) + String.fromCharCode(text.charCodeAt(i) ^ 1) + text.slice(i + 1));
      if (r.ok) expect.fail(`byte ${i} (${JSON.stringify(text.slice(i - 20, i + 5))}) changed and the file still verifies`);
    }
  }, 180_000);

  it("an RSA credential signs too (RS256); a certificate without QC statements is said not to be a QES", async () => {
    const rsa = await verifyJades(await exportJades(ledger.approval, { env: ON, now: NOW, qes: adapter("cfo-rs256") }));
    expect(failed(rsa)).toEqual([]);
    expect(rsa.levels.join("\n")).toMatch(/JAdES-B-B signature; its certificate claims to be qualified/);
    const plain = await verifyJades(await exportJades(ledger.approval, { env: ON, now: NOW, qes: adapter("cfo-not-qc") }));
    expect(failed(plain)).toEqual([]);
    expect(plain.levels.join("\n")).toMatch(/does not claim to be qualified: not a QES/);
  });

  it("refuses a hash the SAD was not bound to (SCAL 2)", async () => {
    const swap: typeof fetch = async (u, init) => {
      if (String(u).endsWith("signatures/signHash")) {
        const b = JSON.parse(String(init!.body)) as { hashes: string[] };
        b.hashes = [sha256("other terms").toString("base64")];
        return fetch(u, { ...init, body: JSON.stringify(b) });
      }
      return fetch(u, init);
    };
    const err = await adapter(undefined, { fetch: swap }).signHash(sha256("terms"), "test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CscError);
    expect(err).toMatchObject({ method: "signatures/signHash", status: 400, error: "invalid_request", description: "Hash is not authorized by the SAD." });
  });

  it("refuses an expired SAD", async () => {
    let now = NOW.getTime();
    csc.now = () => new Date(now);
    const later: typeof fetch = async (u, init) => {
      if (String(u).endsWith("signatures/signHash")) now += (csc.sadLifetimeSeconds + 1) * 1000;
      return fetch(u, init);
    };
    try {
      await expect(adapter(undefined, { fetch: later }).signHash(sha256("terms"), "test")).rejects.toMatchObject({ method: "signatures/signHash", status: 400, description: "SAD expired" });
    } finally {
      csc.now = () => NOW;
    }
  });

  it("refuses a wrong PIN, a wrong access token, a disabled key, and an export whose signature would not verify", async () => {
    await expect(adapter(undefined, { authData: async () => [{ id: "PIN", value: "000000" }] }).signHash(sha256("terms"), "t")).rejects.toMatchObject({ error: "invalid_authentication_data" });
    await expect(adapter(undefined, { accessToken: "wrong" }).credential()).rejects.toMatchObject({ status: 401, error: "invalid_token" });
    csc.addCredential({ id: "cfo-disabled", status: "disabled" });
    await expect(adapter("cfo-disabled").credential()).rejects.toThrow(/disabled/);
    await expect(adapter("nobody").credential()).rejects.toThrow(/no credential nobody/);
    await expect(adapter().signHash(new Uint8Array(31), "t")).rejects.toThrow(/32 bytes/);
    // An RSSP that signs something else: the export checks its own file and refuses to hand it back.
    const liar = { status: QES_STATUS, credential: () => adapter().credential(), signHash: async () => new Uint8Array(64) };
    await expect(exportJades(ledger.approval, { env: ON, now: NOW, qes: liar })).rejects.toThrow(/does not verify: jades/);
  });
});

describe("DER helpers", () => {
  it("ECDSA r ‖ s and DER round trip", () => {
    const raw = Buffer.concat([Buffer.alloc(31, 0x80), Buffer.from([1]), Buffer.alloc(32, 0x01)]);
    expect(ecdsaDerToRaw(ecdsaRawToDer(raw))).toEqual(raw);
  });
});
