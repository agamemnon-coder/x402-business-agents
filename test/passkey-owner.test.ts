// Block 1: the encoding behind "Face ID signs on chain". The signature ERC7913WebAuthnVerifier decodes must carry the
// Execute digest as the challenge, the user-verified flag, a low s, and indices that point at "type" and "challenge"
// in clientDataJSON; the quorum lists each passkey signer once. Breaks if any of that drifts. Software stand-in keys.
import { createHash, createPublicKey, verify } from "node:crypto";
import { decodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { challengeOf, derToRs, passkeyQuorum, passkeySigner, webauthnSignature } from "../src/metal/passkeyOwner.js";
import { softPasskey } from "../src/metal/softPasskey.js";

const DIGEST = `0x${"5a".repeat(32)}` as Hex;
const VERIFIER = "0x1111111111111111111111111111111111111111";
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function decode(sig: Hex) {
  const [r, s, ci, ti, ad, json] = decodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, uint256, bytes, string"), sig);
  return { r, s, ci: Number(ci), ti: Number(ti), ad, json };
}

describe("a passkey owner's signature for the WebAuthn verifier", () => {
  it("carries the digest as the challenge, with indices at type and challenge, and verifies as P-256 over authData ‖ sha256(clientData)", () => {
    const p = softPasskey();
    const a = p.assert(DIGEST);
    const d = decode(webauthnSignature(DIGEST, a));
    expect(d.json.slice(d.ti, d.ti + 21)).toBe('"type":"webauthn.get"');
    expect(d.json.slice(d.ci)).toMatch(new RegExp(`^"challenge":"${challengeOf(DIGEST)}"`));
    expect(BigInt(d.s) <= N / 2n).toBe(true);
    const msg = Buffer.concat([Buffer.from(d.ad.slice(2), "hex"), createHash("sha256").update(d.json).digest()]);
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: Buffer.from(p.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(p.key.qy.slice(2), "hex").toString("base64url") }, format: "jwk" });
    expect(verify("sha256", msg, { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(d.r.slice(2) + d.s.slice(2), "hex"))).toBe(true);
  });

  it("refuses an assertion over another challenge (a replayed or swapped approval)", () => {
    const a = softPasskey().assert(`0x${"77".repeat(32)}`);
    expect(() => webauthnSignature(DIGEST, a)).toThrow(/challenge is not this Execute digest/);
  });

  it("refuses an assertion without user verification (no Face ID)", () => {
    expect(() => webauthnSignature(DIGEST, softPasskey().assert(DIGEST, { uv: false }))).toThrow(/UP and UV/);
  });

  it("flips a high s into the lower half, which the verifier requires", () => {
    const r = 5n, s = N - 7n;
    const int = (v: bigint) => { const h = v.toString(16).padStart(64, "0"); const b = Buffer.from(h, "hex"); return b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b; };
    const body = Buffer.concat([Buffer.from([2, int(r).length]), int(r), Buffer.from([2, int(s).length]), int(s)]);
    const out = derToRs(new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body])));
    expect(BigInt(out.s)).toBe(7n);
  });

  it("builds signers as verifier ‖ qx ‖ qy and a quorum with each signer once, ordered by keccak", () => {
    const [a, b] = [softPasskey(), softPasskey()];
    const sa = passkeySigner(VERIFIER, a.key), sb = passkeySigner(VERIFIER, b.key);
    expect(sa.length).toBe(2 + 2 * 84);
    const q = passkeyQuorum([{ signer: sa, signature: "0x01" }, { signer: sb, signature: "0x02" }]);
    const [signers] = decodeAbiParameters(parseAbiParameters("bytes[], bytes[]"), q);
    expect([...signers].map((x) => keccak256(x))).toEqual([keccak256(sa), keccak256(sb)].sort());
    expect(() => passkeyQuorum([{ signer: sa, signature: "0x01" }, { signer: sa, signature: "0x02" }])).toThrow(/twice/);
  });
});
