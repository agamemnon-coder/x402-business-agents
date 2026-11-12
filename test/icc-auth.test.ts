// Signing and encryption for the ICC client (src/icc/auth.ts), against the structure docs/visa-icc.md documents. No
// network and no key from anywhere: every key and certificate is made here at run time (test/support/iccKeys.ts).
// The documentation publishes no signature with its key, so signatures are checked with Node's own verify.
import { createHash, createHmac, createPublicKey, verify, X509Certificate } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  IccCryptoError, bodyDigest, decryptResponse, encryptRequest, httpSignatureBase, httpSignatureHeaders, jwtClaims,
  readPrivateKeyFile, readRequestCertificate, requestHeaders, sharedSecretKey, signJwt, signingInput,
} from "../src/icc/auth.js";
import { makeIccTestKeys, responseJwe, selfSignedCertificate, writeIccKeyFiles, type IccTestKeys } from "./support/iccKeys.js";

const DOC = readFileSync(new URL("../docs/visa-icc.md", import.meta.url), "utf8");
const T0 = new Date("2026-11-12T10:00:00Z");
const JTI = "6643fb9a-8093-47c6-95d3-8d69785b5e62";
const BODY = JSON.stringify({ clientCorrelationId: "c-1" });
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

let keys: IccTestKeys;
beforeAll(() => { keys = makeIccTestKeys(); });

describe("the digest", () => {
  it("is the Base64 of the SHA-256's raw bytes by default, as the documentation's code samples do", () => {
    expect(bodyDigest(BODY)).toBe(createHash("sha256").update(BODY, "utf8").digest("base64"));
    expect(Buffer.from(bodyDigest(BODY), "base64")).toHaveLength(32);
  });
  it("is the Base64 of the hexadecimal text with the one switch, as the documentation's shell example does", () => {
    const hex = Buffer.from(bodyDigest(BODY, "hex"), "base64").toString("ascii");
    expect(hex).toBe(createHash("sha256").update(BODY, "utf8").digest("hex"));
  });
});

describe("the JWT", () => {
  const claims = (over: Partial<Parameters<typeof jwtClaims>[0]> = {}) => jwtClaims({ method: "POST", host: "apitest.cybersource.com", path: "/icc/v1/instructions", body: BODY, merchantId: "purser_sandbox", issuedAt: T0, jti: JTI, ...over });

  it("carries the documented claims: digest of the body, two minutes at most, a v4 jti, the method in lower case", () => {
    const c = claims({ responseMleKeyId: "resp-kid-1" });
    expect(c).toEqual({
      digest: bodyDigest(BODY), digestAlgorithm: "SHA-256", iat: 1794477600, exp: 1794477720, "request-method": "post",
      "request-resource-path": "/icc/v1/instructions", "request-host": "apitest.cybersource.com", iss: "purser_sandbox",
      jti: JTI, "v-c-jwt-version": "2", "v-c-merchant-id": "purser_sandbox", "v-c-response-mle-kid": "resp-kid-1",
    });
    expect((c.exp as number) - (c.iat as number)).toBeLessThanOrEqual(120);
    // In the order of the documentation's own example.
    expect(Object.keys(c).slice(0, 5)).toEqual(["digest", "digestAlgorithm", "iat", "exp", "request-method"]);
  });

  it("leaves digest and digestAlgorithm out when the body is empty (a GET)", () => {
    const c = claims({ method: "GET", path: "/tms/v1/instrumentidentifiers/A1B2C3D4E5F60718293A4B5C6D7E8F90", body: null });
    expect(c).not.toHaveProperty("digest");
    expect(c).not.toHaveProperty("digestAlgorithm");
    expect(c["request-method"]).toBe("get");
    expect(c).not.toHaveProperty("v-c-response-mle-kid");
  });

  it("refuses a jti that is not a version 4 UUID, a lifetime over two minutes, and a host with a scheme or path", () => {
    expect(() => claims({ jti: "12345678-1234-1234-1234-123456789012" })).toThrow(/UUID/);
    expect(() => claims({ lifetimeSeconds: 121 })).toThrow(/two minutes/);
    expect(() => claims({ host: "https://apitest.cybersource.com" })).toThrow(/host/);
  });

  it("signs with the P12 certificate's private key: RS256, kid and typ in the header; Node's verify accepts it", () => {
    const jws = signJwt({ scheme: "jwt-p12", keyId: "p12-key-id", privateKey: keys.signing.privateKey }, claims());
    const [h, c, s] = jws.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "RS256", kid: "p12-key-id", typ: "JWT" });
    expect(decode(c)).toEqual(claims());
    expect(jws).not.toMatch(/[+/=]/);
    expect(verify("sha256", Buffer.from(`${h}.${c}`), keys.signing.publicKey, Buffer.from(s, "base64url"))).toBe(true);
    // Tampering with a claim breaks it.
    const forged = Buffer.from(JSON.stringify({ ...claims(), "request-resource-path": "/pts/v2/payments" })).toString("base64url");
    expect(verify("sha256", Buffer.from(`${h}.${forged}`), keys.signing.publicKey, Buffer.from(s, "base64url"))).toBe(false);
  });

  it("signs with the shared secret: HS256 over the same text, keyed with the Base64-decoded secret", () => {
    const jws = signJwt({ scheme: "jwt-shared-secret", keyId: "ss-key-id", secret: sharedSecretKey(keys.sharedSecret) }, claims());
    const [h, c, s] = jws.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "HS256", kid: "ss-key-id", typ: "JWT" });
    expect(s).toBe(createHmac("sha256", Buffer.from(keys.sharedSecret, "base64")).update(`${h}.${c}`).digest("base64url"));
  });

  it("the documentation's example 2: its two JSON texts give the signing input whose SHA-256 the document states", () => {
    // The two texts between the single quotes of the page's printf command, exactly as docs/visa-icc.md quotes them
    // (the second includes its line break and two spaces).
    const block = /printf "%s\.%s" \\\n[\s\S]*?> signing_input\.txt/.exec(DOC)![0];
    const quoted = [...block.matchAll(/echo -n '([^']*)'/g)].map((m) => m[1]!);
    expect(quoted).toHaveLength(2);
    expect(JSON.parse(quoted[0]!)).toEqual({ alg: "HS256", typ: "JWT", kid: "1234567890" });
    const input = signingInput(quoted[0]!, quoted[1]!);
    expect(input).toHaveLength(579);
    const stated = /its SHA-256 is `([0-9a-f]{64})`/.exec(DOC)![1]!;
    expect(stated.startsWith("626201ca")).toBe(true);
    expect(createHash("sha256").update(input, "ascii").digest("hex")).toBe(stated);
    // The example's digest claim has the hexadecimal form: it decodes to 64 hexadecimal characters.
    expect(Buffer.from((JSON.parse(quoted[1]!) as { digest: string }).digest, "base64").toString("ascii")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requestHeaders: a bearer token and the content type, nothing else", () => {
    const h = requestHeaders({ scheme: "jwt-p12", keyId: "k", privateKey: keys.signing.privateKey }, { method: "POST", host: "apitest.cybersource.com", path: "/icc/v1/instructions", body: BODY, merchantId: "purser_sandbox", at: T0, jti: JTI });
    expect(Object.keys(h).sort()).toEqual(["authorization", "content-type"]);
    expect(h.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(h["content-type"]).toBe("application/json");
  });
});

describe("the HTTP signature", () => {
  it("the documentation's example 1: the validation string is reproduced character for character from its inputs", () => {
    // As docs/visa-icc.md quotes it: every line but the last ends with the two characters \n and a line break.
    const block = /```\n(host: apitest\.cybersource\.com\\n\n[\s\S]*?v-c-merchant-id: mymerchantid)\n```/.exec(DOC)![1]!;
    const documented = block.replaceAll("\\n\n", "\n");
    const base = httpSignatureBase({ method: "POST", host: "apitest.cybersource.com", path: "/pts/v2/payments/", date: new Date("2019-07-18T00:18:03Z"), dateHeader: "date", digest: "SHA-256=gXWufV4Zc7VkN9Wkv9jh/JuAVclqDusx3vkyo3uJFWU=", merchantId: "mymerchantid" });
    expect(base.text).toBe(documented);
    expect(base.headers).toBe("host date request-target digest v-c-merchant-id");
  });

  it("signs the validation string with HmacSHA256 and the Base64-decoded secret; the header has the four parameters", () => {
    const h = httpSignatureHeaders({ keyId: "ss-key-id", secret: sharedSecretKey(keys.sharedSecret) }, { method: "POST", host: "apitest.cybersource.com", path: "/icc/v1/instructions", body: BODY, merchantId: "purser_sandbox", at: T0 });
    expect(h["v-c-date"]).toBe("Thu, 12 Nov 2026 10:00:00 GMT");
    expect(h["v-c-merchant-id"]).toBe("purser_sandbox");
    expect(h.digest).toBe(`SHA-256=${bodyDigest(BODY)}`);
    const text = `host: apitest.cybersource.com\nv-c-date: Thu, 12 Nov 2026 10:00:00 GMT\nrequest-target: post /icc/v1/instructions\ndigest: ${h.digest}\nv-c-merchant-id: purser_sandbox`;
    const expected = createHmac("sha256", Buffer.from(keys.sharedSecret, "base64")).update(text, "utf8").digest("base64");
    expect(h.signature).toBe(`keyid="ss-key-id", algorithm="HmacSHA256", headers="host v-c-date request-target digest v-c-merchant-id", signature="${expected}"`);
  });

  it("a GET signs no digest; the one switch names the date header `date`", () => {
    const h = httpSignatureHeaders({ keyId: "k", secret: sharedSecretKey(keys.sharedSecret) }, { method: "GET", host: "apitest.cybersource.com", path: "/tms/v2/tokenized-cards/abc12345", body: null, merchantId: "m", at: T0, dateHeader: "date" });
    expect(h).not.toHaveProperty("digest");
    expect(h).not.toHaveProperty("v-c-date");
    expect(h.date).toBe("Thu, 12 Nov 2026 10:00:00 GMT");
    expect(h.signature).toContain('headers="host date request-target v-c-merchant-id"');
  });
});

describe("Message-Level Encryption", () => {
  it("a request is a compact JWE: RSA-OAEP with A256GCM, the certificate's SERIALNUMBER as kid; the test's private key opens it", () => {
    const cert = readRequestCertificateFromPem(keys.request.certificatePem);
    expect(cert.keyId).toBe(keys.request.keyId);
    const jwe = encryptRequest(BODY, cert);
    const parts = jwe.split(".");
    expect(parts).toHaveLength(5);
    expect(decode(parts[0]!)).toEqual({ alg: "RSA-OAEP", enc: "A256GCM", cty: "JWT", kid: keys.request.keyId });
    expect(decryptResponse(jwe, keys.request.privateKey)).toBe(BODY);
    // Each encryption has its own content key and nonce.
    expect(encryptRequest(BODY, cert)).not.toBe(jwe);
  });

  it("an answer made by the test (RSA-OAEP-256, A256GCM) decrypts in the code", () => {
    const jwe = testJwe(JSON.stringify({ instructionId: "x" }), keys.response.publicKey);
    expect(decryptResponse(jwe, keys.response.privateKey)).toBe('{"instructionId":"x"}');
  });

  it("tampering fails, with an error that carries nothing of the content", () => {
    const jwe = testJwe(JSON.stringify({ signedPayload: "marker-value" }), keys.response.publicKey);
    const p = jwe.split(".");
    const flip = (s: string) => Buffer.from(s, "base64url").map((b, i) => (i === 0 ? b ^ 1 : b));
    for (const i of [1, 2, 3, 4]) {
      const bad = p.map((x, j) => (j === i ? Buffer.from(flip(x)).toString("base64url") : x)).join(".");
      expect(() => decryptResponse(bad, keys.response.privateKey)).toThrow(IccCryptoError);
    }
    // The protected header is authenticated too.
    const header = Buffer.from(JSON.stringify({ ...decode(p[0]!), kid: "other" })).toString("base64url");
    expect(() => decryptResponse([header, ...p.slice(1)].join("."), keys.response.privateKey)).toThrow(IccCryptoError);
    // Another key cannot open it; other algorithms and shapes are refused.
    expect(() => decryptResponse(jwe, keys.signing.privateKey)).toThrow(IccCryptoError);
    expect(() => decryptResponse("a.b.c", keys.response.privateKey)).toThrow(IccCryptoError);
    const dir = Buffer.from(JSON.stringify({ alg: "dir", enc: "A256GCM" })).toString("base64url");
    expect(() => decryptResponse([dir, ...p.slice(1)].join("."), keys.response.privateKey)).toThrow(/algorithm/);
    try { decryptResponse(jwe.slice(0, -4), keys.response.privateKey); } catch (e) { expect((e as Error).message).not.toContain("marker"); }
  });

  it("a certificate without a SERIALNUMBER in its subject gives the certificate's own serial number, in decimal", () => {
    const pem = selfSignedCertificate({ publicKey: keys.request.publicKey, privateKey: keys.request.privateKey, commonName: "No serial", certSerial: Buffer.from([0x01, 0xe2, 0x40]) });
    expect(new X509Certificate(pem).serialNumber).toBe("01E240");
    expect(readRequestCertificateFromPem(pem).keyId).toBe("123456");
  });
});

describe("key files", () => {
  it("reads a PEM private key, with or without a passphrase, and the request certificate", () => {
    const plain = writeIccKeyFiles(keys);
    const key = readPrivateKeyFile(plain.jwtKey, undefined, "ICC_JWT_PRIVATE_KEY_FILE");
    expect(createPublicKey(key).export({ type: "spki", format: "pem" })).toBe(keys.signing.publicKey.export({ type: "spki", format: "pem" }));
    expect(readRequestCertificate(plain.requestCert, "ICC_MLE_REQUEST_CERT_FILE").keyId).toBe(keys.request.keyId);
    const locked = writeIccKeyFiles(keys, { passphrase: "a test passphrase" });
    expect(readPrivateKeyFile(locked.responseKey, "a test passphrase", "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE").type).toBe("private");
    expect(() => readPrivateKeyFile(locked.responseKey, undefined, "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE")).toThrow(/ICC_MLE_RESPONSE_PRIVATE_KEY_FILE.*passphrase/);
  });

  it("refuses a key file that others can read, a missing file and a file that is no key, naming the variable and never the content", () => {
    const f = writeIccKeyFiles(keys);
    chmodSync(f.jwtKey, 0o640);
    expect(() => readPrivateKeyFile(f.jwtKey, undefined, "ICC_JWT_PRIVATE_KEY_FILE")).toThrow(/ICC_JWT_PRIVATE_KEY_FILE.*readable by others/);
    expect(() => readPrivateKeyFile(join(f.dir, "none.pem"), undefined, "ICC_JWT_PRIVATE_KEY_FILE")).toThrow(/ICC_JWT_PRIVATE_KEY_FILE.*could not be opened/);
    const junk = join(f.dir, "junk.pem");
    writeFileSync(junk, "not-a-key-marker", { mode: 0o600 });
    for (const read of [() => readPrivateKeyFile(junk, undefined, "ICC_JWT_PRIVATE_KEY_FILE"), () => readRequestCertificate(junk, "ICC_MLE_REQUEST_CERT_FILE")]) {
      let message = "";
      try { read(); } catch (e) { message = (e as Error).message; }
      expect(message).toMatch(/ICC_/);
      expect(message).not.toContain("not-a-key-marker");
      expect(message).not.toContain(f.dir);
    }
  });

  it("refuses a shared secret that is not Base64", () => {
    expect(() => sharedSecretKey("not base64 !!")).toThrow(/Base64/);
    expect(() => sharedSecretKey("")).toThrow(/Base64/);
  });
});

// ---- helpers ----------------------------------------------------------------------------------------------------

function readRequestCertificateFromPem(pem: string) {
  const f = writeIccKeyFiles(keys);
  writeFileSync(f.requestCert, pem);
  return readRequestCertificate(f.requestCert, "ICC_MLE_REQUEST_CERT_FILE");
}

/** A response JWE as the documentation describes one: RSA-OAEP-256 for the content key, A256GCM for the message. */
function testJwe(json: string, publicKey: IccTestKeys["response"]["publicKey"]): string {
  return responseJwe(json, publicKey, "resp-kid-1");
}
