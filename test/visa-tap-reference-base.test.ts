// D25, local interop check without Visa's code: our signer against the signature-base construction of Visa's
// reference proxy, cdn-proxy/server.js at commit 16d59bd (github.com/visa/trusted-agent-protocol), as quoted by line
// number below. Nothing of the reference is run or reimplemented here; the quoted expressions are the expectations our
// headers must meet. The real proxy runs, unchanged, only in CI (.github/workflows/tap-interop.yml).
import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ed25519FromSeed, signTapCheckout } from "../src/visa/tapSig.js";

const key = ed25519FromSeed(Buffer.alloc(32, 7));
const HOST = "localhost:3001"; // server.js 511: authority = req.get('host')
const URL_ = "/product/checkout"; // server.js 512: path = req.url (with any query string)
const headers = signTapCheckout({
  authority: HOST, target: URL_, method: "POST", body: '{"plan":"packwise-starter"}', keyId: "purser-sourcing-1",
  privateKey: key.privateKey, created: 1_800_000_000, expiresIn: 300, nonce: "bm9uY2UtZm9yLXRoZS1wcm94eS10ZXN0", tag: "agent-payer-auth",
});
const signatureInput = headers["signature-input"];

describe("signature 1 as the reference proxy reads it (server.js, 16d59bd)", () => {
  it("parses with the proxy's own expressions (lines 216, 225, 229-237, 248-254)", () => {
    // 216: signatureInput.match(/sig2=\(([^)]+)\);\s*(.+)/)
    const m = /sig2=\(([^)]+)\);\s*(.+)/.exec(signatureInput);
    expect(m).not.toBeNull();
    // 225: paramString.split(/\s+/).map(p => p.replace(/['"]/g, ''))
    expect(m![1]!.split(/\s+/).map((p) => p.replace(/['"]/g, ""))).toEqual(["@authority", "@path"]);
    // 229: attributesString.matchAll(/(\w+)=("[^"]*"|\d+)/g); 233-237: quoted values unquoted, others parseInt
    const attrs = Object.fromEntries([...m![2]!.matchAll(/(\w+)=("[^"]*"|\d+)/g)].map(([, k, v]) => [k, v!.startsWith('"') ? v!.slice(1, -1) : parseInt(v!, 10)]));
    // 248-254: it reads nonce, created, expires, keyId (camelCase), alg and tag
    expect(attrs).toEqual({ created: 1_800_000_000, expires: 1_800_000_300, keyId: "purser-sourcing-1", alg: "ed25519", nonce: "bm9uY2UtZm9yLXRoZS1wcm94eS10ZXN0", tag: "agent-payer-auth" });
    // 67: validateKeyId: /^[a-zA-Z0-9._-]+$/ and at most 100 characters
    expect(/^[a-zA-Z0-9._-]+$/.test(String(attrs.keyId)) && String(attrs.keyId).length <= 100).toBe(true);
    // 558, 563: algorithm.toLowerCase() === 'ed25519'
    expect(String(attrs.alg).toLowerCase()).toBe("ed25519");
  });

  it("is signed over exactly the base the proxy rebuilds (lines 263-298, 510-515), verified as it verifies (355-385, 540)", () => {
    // 269-274: `"@authority": ${requestData.authority}` and `"@path": ${requestData.path}`, in the order of the params
    // 292-296: `"@signature-params": ` + the Signature-Input header with a leading 'sig2=' removed
    // 298: components.join('\n')
    expect(signatureInput.startsWith("sig2=")).toBe(true);
    const base = [`"@authority": ${HOST}`, `"@path": ${URL_}`, `"@signature-params": ${signatureInput.substring(5)}`].join("\n");
    // 540: signature.match(/sig2=:([^:]+):/)
    const sig = /sig2=:([^:]+):/.exec(headers.signature)![1]!;
    // 366-373: the registry's raw 32-byte key behind the DER prefix 30 2a 30 05 06 03 2b 65 70 03 21 00, as spki
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), key.publicRaw]), format: "der", type: "spki" });
    // 376-385: 64 bytes, crypto.verify(null, Buffer.from(signatureString, 'utf-8'), publicKey, signatureBuffer)
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
    expect(verify(null, Buffer.from(base, "utf-8"), pub, Buffer.from(sig, "base64"))).toBe(true);
    // The same base with a query on the URL (512: req.url keeps it) does not verify: checkout URLs carry none.
    expect(verify(null, Buffer.from(base.replace(URL_, `${URL_}?x=1`), "utf-8"), pub, Buffer.from(sig, "base64"))).toBe(false);
  });

  it("goes to a path the proxy checks at all (lines 643-647: only req.url.toLowerCase() starting with '/product/')", () => {
    expect(URL_.toLowerCase().startsWith("/product/")).toBe(true);
  });

  it("leaves signature 2 in headers the proxy never reads (401-402: only signature-input and signature)", () => {
    expect(Object.keys(headers).filter((h) => h === "signature-input" || h === "signature")).toEqual(["signature-input", "signature"]);
    expect(headers["purser-signature-input"].startsWith("body=")).toBe(true);
    // 216 matches anywhere in the header, so nothing else may share it: our Signature-Input carries sig2 alone.
    expect(signatureInput.match(/sig2=/g)).toHaveLength(1);
  });
});
