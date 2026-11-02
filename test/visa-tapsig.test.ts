// D25, signature 1 (TAP, exactly as Visa's unmodified reference proxy at commit 16d59bd reads it) and signature 2 (our
// body signature over Content-Digest, RFC 9421 format). The fixed vector below was computed independently with Python's
// `cryptography` (Ed25519, RFC 8032 test key 1) from the base strings written out here, and is checked byte for byte.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  contentDigest, ed25519FromSeed, parseContentDigest, parseSig1, parseSig2, sig1Base, sig1ParamsText, sig2Base, sig2ParamsText,
  signTapCheckout, splitTarget, TAP_CLOCK_SKEW_S, TAP_MAX_WINDOW_S, verifyEd25519, windowProblem,
} from "../src/visa/tapSig.js";

const SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const V = {
  publicRaw: "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=",
  body: '{"plan":"packwise-starter"}',
  sig1Input: 'sig2=("@authority" "@path"); created=1798761600; expires=1798761900; keyId="purser-vector-1"; alg="ed25519"; nonce="dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx"; tag="agent-payer-auth"',
  sig1Base: '"@authority": localhost:3001\n"@path": /product/checkout\n"@signature-params": ("@authority" "@path"); created=1798761600; expires=1798761900; keyId="purser-vector-1"; alg="ed25519"; nonce="dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx"; tag="agent-payer-auth"',
  sig1: "sig2=:WIw5cRXQa5WYAopSFETeEbJqMsCE8JEyoHAQ7UiW/XmgmtwQfrpqUu4UZnSNdxrNj+RkLyXUgCdYD5QQUb8CBA==:",
  digest: "sha-256=:4eD448YoVxNQKxxAM4Mk7rKaAknZj9Vop/FT11HLg+8=:",
  sig2Input: 'body=("@method" "@authority" "@path" "@query" "content-digest" "signature-input" "signature");created=1798761600;expires=1798761900;keyid="purser-vector-1";alg="ed25519";nonce="dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx";tag="purser-body"',
  sig2: "body=:cZeztjB8tan6NoC3CFrEpNlFnwINNBtYN2MPWETIePDBaBaD1qoitLEv2CKL9s9DVPPcPAUQL6v8M3m3kcgxAg==:",
};
const VECTOR_SIG2_BASE = [
  '"@method": POST',
  '"@authority": localhost:3001',
  '"@path": /product/checkout',
  '"@query": ?',
  `"content-digest": ${V.digest}`,
  `"signature-input": ${V.sig1Input}`,
  `"signature": ${V.sig1}`,
  `"@signature-params": ${V.sig2Input.slice("body=".length)}`,
].join("\n");

const key = ed25519FromSeed(SEED);
const vectorHeaders = () => signTapCheckout({
  authority: "localhost:3001", target: "/product/checkout", method: "POST", body: V.body,
  keyId: "purser-vector-1", privateKey: key.privateKey, created: 1798761600, expiresIn: 300,
  nonce: "dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx", tag: "agent-payer-auth",
});

describe("the fixed test vector (deterministic key and nonce)", () => {
  it("has the RFC 8032 public key", () => {
    expect(key.publicRaw.toString("base64")).toBe(V.publicRaw);
  });
  it("signs both signatures byte for byte", () => {
    expect(vectorHeaders()).toEqual({
      "signature-input": V.sig1Input,
      signature: V.sig1,
      "content-digest": V.digest,
      "purser-signature-input": V.sig2Input,
      "purser-signature": V.sig2,
    });
  });
  it("builds the two signature bases byte for byte", () => {
    const p1 = sig1ParamsText({ created: 1798761600, expires: 1798761900, keyId: "purser-vector-1", nonce: "dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx", tag: "agent-payer-auth" });
    expect(`sig2=${p1}`).toBe(V.sig1Input);
    expect(sig1Base("localhost:3001", "/product/checkout", p1)).toBe(V.sig1Base);
    const p2 = sig2ParamsText({ created: 1798761600, expires: 1798761900, keyid: "purser-vector-1", nonce: "dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx" });
    expect(`body=${p2}`).toBe(V.sig2Input);
    expect(sig2Base({ method: "POST", authority: "localhost:3001", path: "/product/checkout", query: "?", contentDigest: V.digest, signatureInput: V.sig1Input, signature: V.sig1 }, p2)).toBe(VECTOR_SIG2_BASE);
  });
  it("verifies with the public key, and not over a changed base", () => {
    const s1 = Buffer.from(V.sig1.slice(6, -1), "base64");
    expect(verifyEd25519(key.publicKey, V.sig1Base, s1)).toBe(true);
    expect(verifyEd25519(key.publicKey, V.sig1Base.replace("/product/checkout", "/product/other"), s1)).toBe(false);
    expect(verifyEd25519(key.publicKey, VECTOR_SIG2_BASE, Buffer.from(V.sig2.slice(6, -1), "base64"))).toBe(true);
  });
});

describe("Content-Digest (RFC 9530)", () => {
  it("is the SHA-256 of the exact body bytes", () => {
    expect(contentDigest(Buffer.from(V.body))).toBe(V.digest);
    expect(contentDigest(V.body)).toBe(`sha-256=:${createHash("sha256").update(V.body).digest("base64")}:`);
  });
  it("holds exactly one sha-256 entry", () => {
    expect(parseContentDigest(V.digest)).toMatchObject({ ok: true });
    expect(parseContentDigest(`${V.digest}, sha-512=:AAAA:`)).toMatchObject({ ok: false, reason: expect.stringMatching(/exactly one sha-256/) });
    expect(parseContentDigest("sha-512=:AAAA:")).toMatchObject({ ok: false });
    expect(parseContentDigest("sha-256=:AAAA:")).toMatchObject({ ok: false, reason: expect.stringMatching(/32 bytes/) });
  });
});

describe("parsing signature 1 the way the reference proxy reads it, strictly", () => {
  it("reads back what it signed", () => {
    const h = vectorHeaders();
    const p = parseSig1(h["signature-input"], h.signature);
    expect(p).toMatchObject({ ok: true, value: { created: 1798761600, expires: 1798761900, keyId: "purser-vector-1", nonce: "dGFwLXRlc3QtdmVjdG9yLW5vbmNlLTAx", tag: "agent-payer-auth" } });
    if (p.ok) expect(p.value.paramsText).toBe(V.sig1Input.slice(5));
  });
  it("accepts the reference agent's own layout and nonce (a UUID), and RFC 8941 spacing", () => {
    const ref = 'sig2=("@authority" "@path"); created=1798761600; expires=1798762080; keyId="primary-ed25519"; alg="ed25519"; nonce="0f8fad5b-d9cb-469f-a165-70867728950e"; tag="agent-browser-auth"';
    expect(parseSig1(ref, V.sig1)).toMatchObject({ ok: true, value: { keyId: "primary-ed25519", tag: "agent-browser-auth" } });
    expect(parseSig1(ref.replace(/; /g, ";"), V.sig1)).toMatchObject({ ok: true });
  });
  const refused: [string, string, RegExp][] = [
    ["RFC 9421's keyid (the proxy reads keyId)", V.sig1Input.replace("keyId=", "keyid="), /keyId/],
    ["another label", V.sig1Input.replace("sig2=", "sig1="), /sig2/],
    ["other components", V.sig1Input.replace('"@path")', '"@path" "content-type")'), /components/],
    ["a second signature in the header", `${V.sig1Input}, sig3=("@authority");created=1`, /./],
    ["a duplicate parameter (the proxy keeps the last)", `${V.sig1Input}; keyId="other"`, /twice/],
    ["an unknown parameter", `${V.sig1Input}; extra="x"`, /unknown parameter/],
    ["a missing nonce", V.sig1Input.replace(/; nonce="[^"]+"/, ""), /nonce/],
    ["another algorithm", V.sig1Input.replace('alg="ed25519"', 'alg="rsa-pss-sha256"'), /ed25519/],
    ["an unknown tag", V.sig1Input.replace("agent-payer-auth", "agent-payment-auth"), /tag/],
    ["a keyId the proxy would refuse", V.sig1Input.replace("purser-vector-1", "purser/vector"), /keyId/],
  ];
  for (const [what, input, why] of refused) {
    it(`refuses ${what}`, () => {
      expect(parseSig1(input, V.sig1)).toMatchObject({ ok: false, reason: expect.stringMatching(why) });
    });
  }
  it("refuses a Signature that is not one sig2 of 64 bytes", () => {
    expect(parseSig1(V.sig1Input, V.sig1.replace("sig2=", "sig1="))).toMatchObject({ ok: false });
    expect(parseSig1(V.sig1Input, `${V.sig1}, sig3=:AAAA:`)).toMatchObject({ ok: false });
    expect(parseSig1(V.sig1Input, "sig2=:AAAA:")).toMatchObject({ ok: false, reason: expect.stringMatching(/64 bytes/) });
  });
});

describe("parsing signature 2", () => {
  it("reads back what it signed", () => {
    const h = vectorHeaders();
    expect(parseSig2(h["purser-signature-input"], h["purser-signature"])).toMatchObject({ ok: true, value: { keyid: "purser-vector-1", tag: "purser-body", paramsText: V.sig2Input.slice(5) } });
  });
  it("refuses fewer components, another tag, keyId, or another label", () => {
    expect(parseSig2(V.sig2Input.replace(' "@query"', ""), V.sig2)).toMatchObject({ ok: false, reason: expect.stringMatching(/components/) });
    expect(parseSig2(V.sig2Input.replace("purser-body", "agent-payer-auth"), V.sig2)).toMatchObject({ ok: false, reason: expect.stringMatching(/tag/) });
    expect(parseSig2(V.sig2Input.replace("keyid=", "keyId="), V.sig2)).toMatchObject({ ok: false });
    expect(parseSig2(V.sig2Input.replace("body=", "sig2="), V.sig2)).toMatchObject({ ok: false });
  });
});

describe("the signer's own limits, with the one skew both sides share", () => {
  it("never signs a window over 8 minutes, nor an empty one", () => {
    expect(() => signTapCheckout({ authority: "a.example", target: "/product/checkout", method: "POST", body: "", keyId: "k-1", privateKey: key.privateKey, created: 1, expiresIn: TAP_MAX_WINDOW_S + 1, nonce: "n".repeat(22), tag: "agent-payer-auth" })).toThrow(/480/);
    expect(() => signTapCheckout({ authority: "a.example", target: "/product/checkout", method: "POST", body: "", keyId: "k-1", privateKey: key.privateKey, created: 1, expiresIn: 0, nonce: "n".repeat(22), tag: "agent-payer-auth" })).toThrow(/window/);
  });
  it("never signs a keyId the proxy would refuse", () => {
    expect(() => signTapCheckout({ authority: "a.example", target: "/product/checkout", method: "POST", body: "", keyId: "k/1", privateKey: key.privateKey, created: 1, nonce: "n".repeat(22), tag: "agent-payer-auth" })).toThrow(/keyId/);
  });
  it("judges a window: created in the future, expired, too long", () => {
    const now = 2_000_000_000;
    expect(windowProblem(now, now + 300, now)).toBeNull();
    expect(windowProblem(now + TAP_CLOCK_SKEW_S, now + 300, now)).toBeNull();
    expect(windowProblem(now + TAP_CLOCK_SKEW_S + 1, now + 300, now)).toMatch(/future/);
    expect(windowProblem(now - 400, now - TAP_CLOCK_SKEW_S - 1, now)).toMatch(/expired/);
    expect(windowProblem(now, now + TAP_MAX_WINDOW_S + 1, now)).toMatch(/window/);
    expect(windowProblem(now, now, now)).toMatch(/window/);
  });
  it("splits a request target into RFC 9421's @path and @query", () => {
    expect(splitTarget("/product/checkout")).toEqual({ path: "/product/checkout", query: "?" });
    expect(splitTarget("/product/checkout?x=1")).toEqual({ path: "/product/checkout", query: "?x=1" });
  });
});
