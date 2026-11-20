// "Verify it yourself" (15 Nov): the proof bundle the /try pay route hands back, checked by the very code /verify and
// `npm run verify-bundle` run (src/proof/bundle.ts). A real paid bundle and a real refusal from the pay route on the
// Node engine (test money, a software authenticator); then one cent, a swapped signature, a wrong rpId and a flipped
// user-verified flag each fail; an RS256 key passes; the CLI exits 0 on the committed sample and 1 on a changed copy.
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { canonicalTerms, termsHash, type Terms } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { PROOF_FORMAT, PROOF_REFUSAL_MEANS, proofMeans, verifyProofBundle, type ProofBundle, type ProofResult } from "../src/proof/bundle.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
let paid: ProofBundle;
let refused: ProofBundle;
let phone: FakeAuthenticator;

beforeAll(async () => {
  c = testCloud({ engine: true, tryIt: {} });
  expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } })).status).toBe(200);
  const r = await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "203.0.113.77" } });
  const s = r.json.session as string;
  const invoice = ((await c.req("POST", "/v1/engine/samples/clean", { key: s })).json.invoice as { id: string }).id;
  phone = new FakeAuthenticator();
  const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
  expect((await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } })).status).toBe(200);
  const p = (await c.req("POST", `/v1/engine/invoices/${invoice}/pay`, { key: s })).json.proposal as { id: string; challenge: string; terms_sha256: string };
  const approval = phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
  expect((await c.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: s, body: { terms_sha256: p.terms_sha256, credential: approval } })).status).toBe(200);
  const terms = (await c.req("GET", `/v1/engine/proposals/${p.id}/terms`, { key: s })).json.terms as Record<string, unknown>;
  const no = await c.req("POST", `/v1/engine/proposals/${p.id}/pay`, { key: s, body: { terms: { ...terms, amount: "1850.01" }, credential: approval } });
  expect(no.json.outcome).toBe("refused");
  refused = no.json.proof as unknown as ProofBundle;
  const yes = await c.req("POST", `/v1/engine/proposals/${p.id}/pay`, { key: s, body: { terms, credential: approval } });
  expect(yes.json.outcome).toBe("paid");
  paid = yes.json.proof as unknown as ProofBundle;
});
afterAll(() => c.close());

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const failed = (r: ProofResult) => r.checks.filter((x) => !x.ok).map((x) => x.check);

describe("the bundle the pay route hands back", () => {
  it("holds the terms, their hash, the assertion, the public key, the rpId, the decision and the ledger; no user handle", () => {
    expect(paid).toMatchObject({ format: PROOF_FORMAT, rp_id: RP, origin: ORIGIN, public_key: { format: "cose", alg: -7 }, decision: { outcome: "paid", changed: [] } });
    expect(paid.canonical).toBe(canonicalTerms(paid.terms as unknown as Terms));
    expect(paid.terms_sha256).toBe(termsHash(paid.terms as unknown as Terms));
    expect(Object.keys(paid.assertion).sort()).toEqual(["authenticatorData", "clientDataJSON", "credential_id", "signature"]);
    expect(paid.asked).toBeUndefined();
    // Exactly the payment's own entries: its invoice's accrual, its conversion's two, its transfer's two (amount and fee).
    expect(paid.ledger.entries.map((e) => e.source_key!.split("|")[0]).sort()).toEqual(["ap-accrual", "fx", "fx", "transfer", "transfer"]);
    expect(paid.ledger.entries.filter((e) => e.source_key!.startsWith("transfer|")).every((e) => e.source_key!.split("|")[1] === paid.terms.transfer_request_id)).toBe(true);
    expect(paid.ledger.entries.some((e) => /BTX-2026-17/.test(e.description))).toBe(false);
    expect(paid.ledger.head).toBe(paid.ledger.entries.at(-1)!.entry_hash);
    expect(JSON.stringify(paid)).not.toMatch(/userHandle|@|session/);
  });

  it("a paid bundle passes every check", async () => {
    const r = await verifyProofBundle(paid);
    expect(failed(r)).toEqual([]);
    expect(r.checks.map((x) => x.check)).toEqual(["format", "terms hash", "challenge", "client data", "rp id", "user verified", "signature", "decision", "ledger balance", "ledger chain", "ledger payment"]);
    expect(r.checks.find((x) => x.check === "challenge")!.detail).toContain(paid.terms_sha256);
  });

  it("a refusal passes too, and shows the asked terms hash differently", async () => {
    expect(refused.decision).toMatchObject({ outcome: "refused", changed: ["amount"], signature: { verified: false } });
    expect(refused.asked!.sha256).toBe(termsHash(refused.asked!.terms as unknown as Terms));
    expect(refused.asked!.sha256).not.toBe(refused.terms_sha256);
    const r = await verifyProofBundle(refused);
    expect(failed(r)).toEqual([]);
    expect(r.checks.find((x) => x.check === "asked terms")!.detail).toMatch(/amount "1850\.00" → "1850\.01".*cannot cover them/);
  });
});

it("says what a bundle proves: the refusal's line only for a refusal", () => {
  expect(proofMeans(paid)).not.toContain(PROOF_REFUSAL_MEANS);
  expect(proofMeans(paid)).toHaveLength(3);
  expect(proofMeans(refused)).toContain(PROOF_REFUSAL_MEANS);
  expect(proofMeans(refused)).toHaveLength(4);
  // The decision and the ledger beside the signature are said to be the engine's record (fuzzing: bundle-context).
  for (const b of [paid, refused]) expect(proofMeans(b).join("\n")).toContain("the engine's record");
});

describe("a change fails", () => {
  it("one cent changed in the terms", async () => {
    const b = copy(paid);
    b.terms.amount = "1850.01";
    expect(failed(await verifyProofBundle(b))).toEqual(expect.arrayContaining(["terms hash"]));
    // The hash changed with it: then the challenge no longer matches.
    b.terms_sha256 = termsHash(b.terms as unknown as Terms);
    b.canonical = canonicalTerms(b.terms as unknown as Terms);
    expect(failed(await verifyProofBundle(b))).toEqual(expect.arrayContaining(["challenge", "decision"]));
  });

  it("a swapped signature (another key's, over the same terms)", async () => {
    const b = copy(paid);
    const other = new FakeAuthenticator().sign({ challenge: challengeFor(b.terms_sha256), origin: ORIGIN, rpId: RP, counter: 1 });
    b.assertion.signature = other.response.signature;
    expect(failed(await verifyProofBundle(b))).toEqual(["signature"]);
  });

  it("a wrong rpId", async () => {
    const b = copy(paid);
    b.rp_id = "evil.example";
    expect(failed(await verifyProofBundle(b))).toEqual(["rp id"]);
  });

  it("the user-verified flag flipped", async () => {
    const b = copy(paid);
    const ad = Buffer.from(b.assertion.authenticatorData, "base64url");
    ad[32] = ad[32]! & ~0x04;
    b.assertion.authenticatorData = ad.toString("base64url");
    expect(failed(await verifyProofBundle(b))).toEqual(["user verified", "signature"]);
  });

  it("a ledger line changed, or not a bundle at all", async () => {
    const b = copy(paid);
    b.ledger.entries[0]!.lines[0]!.debit_cents += 1;
    expect(failed(await verifyProofBundle(b))).toEqual(expect.arrayContaining(["ledger balance", "ledger chain"]));
    expect(failed(await verifyProofBundle({ format: "something else" }))).toEqual(["format"]);
    expect(failed(await verifyProofBundle(null))).toEqual(["format"]);
  });
});

it("an RS256 passkey's signature verifies as well", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, "base64url")], [-2, Buffer.from(jwk.e, "base64url")]]));
  const b = copy(paid);
  const ad = Buffer.from(b.assertion.authenticatorData, "base64url");
  const cdh = createHash("sha256").update(Buffer.from(b.assertion.clientDataJSON, "base64url")).digest();
  b.assertion.signature = sign("sha256", Buffer.concat([ad, cdh]), privateKey).toString("base64url");
  b.public_key = { format: "cose", cose: Buffer.from(cose).toString("base64url"), alg: -257 };
  const r = await verifyProofBundle(b);
  expect(failed(r)).toEqual([]);
  expect(r.checks.find((x) => x.check === "signature")!.detail).toMatch(/^RS256 verifies/);
});

it("npm run verify-bundle: 0 on the committed sample, 1 on a copy with one cent changed", () => {
  const run = (f: string) => { try { return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", "src/cli/verifyBundle.ts", f], { encoding: "utf8" }) }; } catch (e) { const x = e as { status: number; stdout: string }; return { code: x.status, out: x.stdout }; } };
  for (const f of ["docs/proof/try-paid.json", "docs/proof/try-refused.json"]) {
    const ok = run(f);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toContain(`VALID: ${f}`);
    // "A refusal: …" only for the refused bundle (the one with asked terms), never under a paid one.
    if (f.endsWith("try-paid.json")) expect(ok.out).not.toContain("A refusal");
    else expect(ok.out).toContain(PROOF_REFUSAL_MEANS);
  }
  const b = JSON.parse(readFileSync("docs/proof/try-paid.json", "utf8")) as ProofBundle;
  b.terms.amount = "1850.01";
  const f = join(mkdtempSync(join(tmpdir(), "proof-")), "changed.json");
  writeFileSync(f, JSON.stringify(b));
  const bad = run(f);
  expect(bad.code).toBe(1);
  expect(bad.out).toMatch(/NOT VALID.*terms hash/);
  // A base64url field that cannot be decoded: a failed check and NOT VALID, never a stack trace (fuzzing: bundle-malformed).
  const m = JSON.parse(readFileSync("docs/proof/try-paid.json", "utf8")) as ProofBundle;
  m.assertion.authenticatorData = "A";
  const g = join(mkdtempSync(join(tmpdir(), "proof-")), "malformed.json");
  writeFileSync(g, JSON.stringify(m));
  const malformed = run(g);
  expect(malformed.code).toBe(1);
  expect(malformed.out).toContain("FAIL  format          assertion.authenticatorData is not base64url");
  expect(malformed.out).toContain(`NOT VALID: ${g} (format)`);
}, 60_000);

describe("/verify, and the links to it", () => {
  it("is served at /verify under its own hash CSP that allows no connection, with no inline handler", async () => {
    const { VERIFY_BUNDLE_CSP, VERIFY_BUNDLE_PAGE } = await import("../src/servers/dashboard.js");
    const { pageResponse } = await import("../worker/src/core.js");
    const script = /<script>([\s\S]*?)<\/script>/i.exec(VERIFY_BUNDLE_PAGE)![1]!;
    expect(VERIFY_BUNDLE_CSP).toContain(`script-src 'sha256-${createHash("sha256").update(script, "utf8").digest("base64")}'`);
    expect(VERIFY_BUNDLE_CSP).toContain("connect-src 'none'");
    expect(VERIFY_BUNDLE_CSP).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(VERIFY_BUNDLE_PAGE).not.toMatch(/\son[a-z]+=/i);
    // "What this proves": the refusal's line is in the page, hidden until a refusal's bundle is checked.
    expect(VERIFY_BUNDLE_PAGE).toContain(`<li id="v-means-refusal" hidden>${PROOF_REFUSAL_MEANS}</li>`);
    // The checks are the same text the command line runs, and both samples are in the page.
    const { PROOF_VERIFY_JS } = await import("../src/proof/bundle.js");
    expect(script).toContain(PROOF_VERIFY_JS);
    expect(VERIFY_BUNDLE_PAGE).toContain(JSON.parse(readFileSync("docs/proof/try-paid.json", "utf8")).terms_sha256);
    const pages = { verify: VERIFY_BUNDLE_PAGE, csp: { verify: VERIFY_BUNDLE_CSP } } as unknown as Parameters<typeof pageResponse>[1];
    const r = pageResponse(new Request("https://kit11.example/verify"), pages);
    expect(r?.status).toBe(200);
    expect(r?.headers.get("content-security-policy")).toBe(VERIFY_BUNDLE_CSP);
    expect(await r!.text()).toBe(VERIFY_BUNDLE_PAGE);
  }, 30_000); // a cold import of the dashboard module can pass 5 s on a loaded CI runner (20 Nov)

  it("is linked from /proof, from the /try finish, and from the README", async () => {
    const { verifyCalloutHtml } = await import("../src/redesign/proofRuns.js");
    expect(verifyCalloutHtml()).toContain('<a href="verify">Verify a /try payment yourself</a>');
    const { VERIFY_URL } = await import("../cloud/src/tryPage.js");
    expect(VERIFY_URL).toMatch(/^https:\/\/[^/]+\/verify$/);
    expect(readFileSync("README.md", "utf8")).toMatch(/\[\/verify\]\(https:\/\/kit11\.max-31b\.workers\.dev\/verify\).*npm run verify-bundle -- purser-proof\.json/);
  });
});

describe("the sample proof bundles as downloads (Max, 15 Nov: \"I don't have anything\")", () => {
  const files = { paid: "docs/proof/try-paid.json", refused: "docs/proof/try-refused.json" } as const;

  it("the site serves both at /verify/samples/, byte for byte from docs/proof/, as JSON attachments; no other name", async () => {
    const { buildPages } = await import("../src/relay/assets.js");
    const { pageResponse } = await import("../worker/src/core.js");
    const { proofSamplePath, PROOF_SAMPLES } = await import("../src/proof/bundle.js");
    const pages = buildPages({} as NodeJS.ProcessEnv);
    for (const which of ["paid", "refused"] as const) {
      const r = pageResponse(new Request(`https://kit11.example${proofSamplePath(which)}`), pages);
      expect(r?.status).toBe(200);
      expect(r!.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(r!.headers.get("content-disposition")).toBe(`attachment; filename="${PROOF_SAMPLES[which]}"`);
      expect(await r!.text()).toBe(readFileSync(files[which], "utf8"));
    }
    for (const bad of ["/verify/samples/", "/verify/samples/other.json", "/verify/samples/constructor", "/verify/samples/../package.json"]) {
      const r = pageResponse(new Request(`https://kit11.example${bad}`), pages);
      expect(r?.headers.get("content-disposition") ?? null, bad).toBeNull();
    }
  });

  it("npm run judge serves the same bytes", async () => {
    const { startJudge } = await import("../src/cli/judge.js");
    const j = await startJudge(0);
    try {
      for (const [which, f] of Object.entries(files)) {
        const r = await fetch(`${j.url}/verify/samples/try-${which}.json`);
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toMatch(/^application\/json/);
        expect(r.headers.get("content-disposition")).toBe(`attachment; filename="try-${which}.json"`);
        expect(await r.text()).toBe(readFileSync(f, "utf8"));
      }
    } finally {
      j.server.close();
    }
  });

  it("/verify offers them under the drop zone with /try, and /proof's verify aside links them", async () => {
    const { VERIFY_BUNDLE_PAGE } = await import("../src/servers/dashboard.js");
    const line = /<p class="nofile small" id="v-nofile">([\s\S]*?)<\/p>/.exec(VERIFY_BUNDLE_PAGE)?.[1] ?? "";
    expect(line).toMatch(/^No file yet\? /);
    expect(line).toContain('<a href="/verify/samples/try-paid.json" download="try-paid.json">Download a paid sample</a>');
    expect(line).toContain('<a href="/verify/samples/try-refused.json" download="try-refused.json">Download the refused sample</a>');
    expect(line).toContain('or make your own on <a href="/try">/try</a> (2 minutes): the finish hands you the proof file.');
    // Right under the drop zone, and the sample buttons are still there.
    expect(VERIFY_BUNDLE_PAGE.indexOf('id="v-nofile"')).toBeGreaterThan(VERIFY_BUNDLE_PAGE.indexOf('id="v-drop"'));
    expect(VERIFY_BUNDLE_PAGE.indexOf('id="v-nofile"')).toBeLessThan(VERIFY_BUNDLE_PAGE.indexOf('id="v-paste"'));
    expect(VERIFY_BUNDLE_PAGE).toContain('id="v-sample"');
    const { verifyCalloutHtml } = await import("../src/redesign/proofRuns.js");
    expect(verifyCalloutHtml()).toContain('<a href="verify/samples/try-paid.json" download="try-paid.json">A paid sample</a>');
    expect(verifyCalloutHtml()).toContain('<a href="verify/samples/try-refused.json" download="try-refused.json">the refused sample</a>');
  }, 30_000); // a cold import of the dashboard module can pass 5 s on a loaded CI runner (20 Nov)
});
