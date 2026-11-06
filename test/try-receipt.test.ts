// /try/sign's receipt (6 Nov): after signing, receipt.json holds the exact terms, their hash, the passkey's assertion,
// the public key and the algorithm; `npm run verify-receipt -- receipt.json` checks it offline with Node's own crypto.
// A valid receipt verifies; one changed field, or one cent, fails; so does a changed hash, key, signature or site.
// The page builds the receipt in the browser the same way (test/browser/trysign.check.ts downloads it and runs the
// command on it).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { RECEIPT_FORMAT, canonicalTerms, verifyReceipt, type TryReceipt } from "../src/try/receipt.js";
import { BASE, RP, call, challengeOf, desk, signBody, withPasskey } from "./support/trySign.js";

/** A real signature in a test world, and the receipt the page makes of it (src/try/sign.ts, receipt()). */
async function signed(): Promise<{ receipt: TryReceipt; token: string }> {
  const { d } = desk();
  const { w, auth, b } = await withPasskey(d, new FakeAuthenticator());
  const a = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
  const r = await call(d, "sign", signBody(w.world.token, b, a));
  expect(r.status).toBe(200);
  const ans = (await r.json()) as { terms_sha256: string; algorithm: "ES256"; public_key: TryReceipt["public_key"]; executed: { at: string } };
  const receipt: TryReceipt = {
    receipt: RECEIPT_FORMAT, note: "A signature made on /try/sign in a test world: nothing real moved. Check it offline: npm run verify-receipt -- receipt.json",
    terms: JSON.parse(b.canonical) as Record<string, unknown>, terms_sha256: ans.terms_sha256, algorithm: ans.algorithm, public_key: ans.public_key,
    credential_id: a.id, rp_id: RP, origin: BASE,
    assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature },
    verified_by_server_at: ans.executed.at, verify: "npm run verify-receipt -- receipt.json",
  };
  return { receipt, token: w.world.token };
}
const failed = (r: ReturnType<typeof verifyReceipt>) => r.checks.filter((c) => !c.ok).map((c) => c.check);

describe("/try/sign's receipt", () => {
  it("the server's answer carries the public key it verified against, and the receipt carries no world token", async () => {
    const { receipt, token } = await signed();
    expect(receipt.public_key).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(receipt.public_key.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(receipt.algorithm).toBe("ES256");
    expect(JSON.stringify(receipt)).not.toContain(token);
  });

  it("a valid receipt verifies, every check passing", async () => {
    const { receipt } = await signed();
    const r = verifyReceipt(receipt);
    expect(failed(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.check)).toEqual(["format", "algorithm", "terms hash", "ceremony", "challenge", "origin", "authenticator data", "RP id", "user present", "user verified", "signature"]);
    // The hash is the canonical terms' SHA-256, as the server computed it.
    expect(r.checks.find((c) => c.check === "terms hash")!.detail).toContain(receipt.terms_sha256);
    expect(canonicalTerms(receipt.terms)).toContain('"payee_iban":');
  });

  it.each([
    ["one cent more", { amount: "1850.01" }],
    ["one cent less", { amount: "1849.99" }],
    ["another IBAN", { payee_iban: "DE00000000000000000666" }],
    ["another currency", { currency: "USD" }],
    ["another payee", { payee: "Someone Else Ltd" }],
    ["a field added", { note: "paid twice" }],
  ])("a changed term fails: %s", async (_, change) => {
    const { receipt } = await signed();
    const r = verifyReceipt({ ...receipt, terms: { ...receipt.terms, ...change } });
    expect(r.ok).toBe(false);
    expect(failed(r)).toEqual(["terms hash"]);
  });

  it("one cent with the hash made to match fails at the challenge: the signature was made for the old hash", async () => {
    const { receipt } = await signed();
    const terms = { ...receipt.terms, amount: "1850.01" };
    const { createHash } = await import("node:crypto");
    const r = verifyReceipt({ ...receipt, terms, terms_sha256: createHash("sha256").update(canonicalTerms(terms)).digest("hex") });
    expect(failed(r)).toEqual(["challenge"]);
  });

  it("another key, a changed signature, client data or site fails", async () => {
    const { receipt } = await signed();
    const other = (await signed()).receipt;
    expect(failed(verifyReceipt({ ...receipt, public_key: other.public_key }))).toEqual(["signature"]);
    const sig = Buffer.from(receipt.assertion.signature, "base64url");
    sig[sig.length - 1] = sig[sig.length - 1]! ^ 1;
    expect(failed(verifyReceipt({ ...receipt, assertion: { ...receipt.assertion, signature: sig.toString("base64url") } }))).toEqual(["signature"]);
    const cd = JSON.parse(Buffer.from(receipt.assertion.clientDataJSON, "base64url").toString()) as Record<string, unknown>;
    const forged = Buffer.from(JSON.stringify({ ...cd, origin: "https://evil.example" })).toString("base64url");
    expect(failed(verifyReceipt({ ...receipt, assertion: { ...receipt.assertion, clientDataJSON: forged } }))).toEqual(["origin", "signature"]);
    expect(failed(verifyReceipt({ ...receipt, rp_id: "evil.example" }))).toEqual(["RP id"]);
    expect(failed(verifyReceipt({ ...receipt, origin: "https://evil.example" }))).toEqual(["origin"]);
  });

  it("never throws: anything that is not a receipt fails at its format", () => {
    for (const x of [null, 1, "x", [], {}, { receipt: RECEIPT_FORMAT }, { receipt: "other/v1" }]) {
      const r = verifyReceipt(x);
      expect([r.ok, failed(r)]).toEqual([false, ["format"]]);
    }
  });

  it("npm run verify-receipt -- receipt.json: exit 0 and VALID for a valid one, exit 1 and NOT VALID for one cent more", async () => {
    const { receipt } = await signed();
    const dir = mkdtempSync(join(tmpdir(), "receipt-"));
    try {
      const repo = resolve(import.meta.dirname, "..");
      const run = (r: unknown) => {
        const f = join(dir, "receipt.json");
        writeFileSync(f, JSON.stringify(r, null, 2));
        return spawnSync(resolve(repo, "node_modules/.bin/tsx"), [resolve(repo, "src/cli/verifyReceipt.ts"), f], { cwd: repo, encoding: "utf8", timeout: 60_000 });
      };
      const ok = run(receipt);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("VALID:");
      expect(ok.stdout).not.toContain("FAIL");
      const bad = run({ ...receipt, terms: { ...receipt.terms, amount: "1850.01" } });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/FAIL {2}terms hash/);
      expect(bad.stdout).toContain("NOT VALID");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
