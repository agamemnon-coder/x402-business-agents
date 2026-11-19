// RFC 3161 time-stamps for the eIDAS evidence export (src/eidas/jades.ts): the request a TSA takes, the HTTP call
// (RFC 3161 clause 3.4: POST application/timestamp-query), and an offline check of the token that comes back.
//
// What the check proves, and what it does not: the token's TSTInfo carries our hash and a time, and the TSA's
// signature over it verifies with the certificate inside the token, which is marked for time-stamping. Whether that
// TSA is trusted, or a qualified TSA whose stamps carry eIDAS art. 41(2)'s presumption of accurate time, needs its
// certificate chain checked against the EU Trusted List: not done offline here, and said so in every detail.
//
// Status (19 Nov 2026): built, and tested against a mock TSA in test/eidas-evidence.test.ts. The test suite has no
// network (test/support/noNetwork.ts), so no public TSA is called there.

import { createHash, randomBytes, verify as cryptoVerify, X509Certificate } from "node:crypto";
import { bool, children, generalizedTime, int, oid, OID, oidOf, octets, readOne, seq, TAG, type Der } from "./der.js";

/** The TimeStampReq for a SHA-256 digest (RFC 3161 clause 2.4.1), asking for the TSA's certificate in the token. */
export function timeStampQuery(digest: Uint8Array, nonce: Uint8Array = randomBytes(8)): Buffer {
  if (digest.length !== 32) throw new Error("a SHA-256 digest is 32 bytes");
  return seq(int(1), seq(seq(oid(OID.sha256)), octets(digest)), int(nonce), bool(true));
}

/** The token out of a TimeStampResp, or the TSA's refusal (RFC 3161 clause 2.4.2: status 0 granted, 1 with mods). */
export function tokenOfResponse(resp: Uint8Array): Buffer {
  const r = readOne(Buffer.from(resp));
  const [status, token] = children(r);
  const code = status ? children(status)[0] : undefined;
  if (r.tag !== TAG.SEQUENCE || !code || code.tag !== TAG.INTEGER) throw new Error("not a TimeStampResp");
  const n = code.content.length === 1 ? code.content[0]! : -1;
  if (n !== 0 && n !== 1) throw new Error(`the TSA refused the request (PKIStatus ${n})`);
  if (!token) throw new Error("the TSA granted the request but sent no token");
  return Buffer.from(token.raw);
}

/** Asks a TSA over HTTP for a token on `digest`. The caller chooses the TSA; nothing here is called by default. */
export async function requestTimestamp(url: string, digest: Uint8Array, f: typeof fetch = fetch): Promise<Buffer> {
  const res = await f(url, { method: "POST", headers: { "content-type": "application/timestamp-query" }, body: new Uint8Array(timeStampQuery(digest)) });
  if (!res.ok) throw new Error(`the TSA answered HTTP ${res.status}`);
  return tokenOfResponse(new Uint8Array(await res.arrayBuffer()));
}

export interface TimestampCheck { ok: boolean; detail: string; genTime?: string; tsa?: string }


/** What the verifier says about every stamp it accepts, so nobody reads more into it. */
export const TSA_TRUST_NOTE = "the TSA's trust (a qualified TSA on the EU Trusted List) is not checked offline";

/**
 * Checks an RFC 3161 TimeStampToken offline against the digest it should stamp. Never throws: a token that cannot be
 * read is a failed check with the reason.
 */
export function verifyTimestampToken(token: Uint8Array, digest: Uint8Array): TimestampCheck {
  try {
    return check(Buffer.from(token), Buffer.from(digest));
  } catch (e) {
    return { ok: false, detail: `the time-stamp token cannot be read: ${(e as Error).message}` };
  }
}

/** The element at a place RFC 3161 / RFC 5652 fixes, with the tag it must have; anything else is refused. */
function want(d: Der | undefined, tag: number, what: string): Der {
  if (!d || d.tag !== tag) throw new Error(`${what} is not where RFC 3161 puts it`);
  return d;
}
/** An AlgorithmIdentifier's OID; its parameters absent or NULL, nothing else. */
function algOf(d: Der | undefined, what: string): string {
  const c = children(want(d, TAG.SEQUENCE, what));
  if (c.length < 1 || c.length > 2 || (c[1] && (c[1].tag !== TAG.NULL || c[1].content.length !== 0))) throw new Error(`${what} has parameters this check does not know`);
  return oidOf(want(c[0], TAG.OID, what));
}
const intIs = (d: Der | undefined, n: number, what: string) => {
  if (!want(d, TAG.INTEGER, what).content.equals(Buffer.from([n]))) throw new Error(`${what} is not ${n}`);
};
/** The certificate's issuer Name (DER) and its subject key identifier, read from its TBSCertificate. */
function certParts(c: X509Certificate): { issuer: Buffer; serial: Buffer; ski: Buffer | null } {
  const tbs = children(children(readOne(Buffer.from(c.raw)))[0]!);
  const o = tbs[0]!.tag === 0xa0 ? 1 : 0;
  const ext = tbs.find((x) => x.tag === 0xa3);
  const skiExt = ext ? children(children(ext)[0]!).map(children).find((e) => oidOf(e[0]!) === "2.5.29.14") : undefined;
  return { issuer: Buffer.from(tbs[o + 2]!.raw), serial: Buffer.from(tbs[o]!.content), ski: skiExt ? Buffer.from(readOne(Buffer.from(skiExt[skiExt.length - 1]!.content)).content) : null };
}

/** The digests and signature algorithms a TSA's signer may use (SHA-2 only), by OID, as node:crypto names their hash. */
const HASHES: Record<string, string> = { [OID.sha256]: "sha256", "2.16.840.1.101.3.4.2.2": "sha384", "2.16.840.1.101.3.4.2.3": "sha512" };
const ECDSA: Record<string, string> = { [OID.ecdsaWithSha256]: "sha256", "1.2.840.10045.4.3.3": "sha384", "1.2.840.10045.4.3.4": "sha512" };
const RSA: Record<string, string> = { [OID.sha256WithRsa]: "sha256", "1.2.840.113549.1.1.12": "sha384", "1.2.840.113549.1.1.13": "sha512" };
const SIGNING_CERTIFICATE = "1.2.840.113549.1.9.16.2.12";
const SIGNING_CERTIFICATE_V2 = "1.2.840.113549.1.9.16.2.47";

function check(token: Buffer, digest: Buffer): TimestampCheck {
  // ContentInfo { signedData, [0] SignedData } (RFC 5652 clauses 3 and 5.1), every place held to its tag.
  const ci = children(want(readOne(token), TAG.SEQUENCE, "the token"));
  if (ci.length !== 2 || oidOf(want(ci[0], TAG.OID, "the content type")) !== OID.signedData) return { ok: false, detail: "not a CMS SignedData time-stamp token" };
  const w = children(want(ci[1], 0xa0, "the signed data"));
  if (w.length !== 1) return { ok: false, detail: "not a CMS SignedData time-stamp token" };
  const parts = children(want(w[0], TAG.SEQUENCE, "the signed data"));
  intIs(parts[0], 3, "the SignedData version");
  const digestAlgs = children(want(parts[1], TAG.SET, "the digest algorithms")).map((a) => algOf(a, "a digest algorithm"));
  const encap = children(want(parts[2], TAG.SEQUENCE, "the encapsulated content"));
  // Optional certificates [0]; no CRLs [1] (this check could not read them); then the signer infos.
  const rest = parts.slice(3);
  const certsSet = rest[0]?.tag === 0xa0 ? rest.shift() : undefined;
  if (rest.length !== 1) return { ok: false, detail: "the token holds something besides certificates and its signer (CRLs are not read here)" };
  if (encap.length !== 2 || oidOf(want(encap[0], TAG.OID, "the content type")) !== OID.tstInfo) return { ok: false, detail: "the token's content is not a TSTInfo" };
  const wrapped = children(want(encap[1], 0xa0, "the TSTInfo"));
  if (wrapped.length !== 1) return { ok: false, detail: "the token's content is not a TSTInfo" };
  const tstInfo = readOne(Buffer.from(want(wrapped[0], TAG.OCTET_STRING, "the TSTInfo").content));
  // TSTInfo { version 1, policy, messageImprint, serialNumber, genTime, ... } (RFC 3161 clause 2.4.2).
  const t = children(want(tstInfo, TAG.SEQUENCE, "the TSTInfo"));
  intIs(t[0], 1, "the TSTInfo version");
  const policy = oidOf(want(t[1], TAG.OID, "the policy"));
  const imprint = children(want(t[2], TAG.SEQUENCE, "the message imprint"));
  const algo = algOf(imprint[0], "the imprint's algorithm");
  const hashed = want(imprint[1], TAG.OCTET_STRING, "the imprint").content;
  want(t[3], TAG.INTEGER, "the serial number");
  const genTime = generalizedTime(want(t[4], TAG.GENERALIZED_TIME, "the time"));
  if (algo !== OID.sha256) return { ok: false, detail: `the token stamps a ${algo} digest, not SHA-256`, genTime };
  if (!hashed.equals(digest)) return { ok: false, detail: `the token stamps ${hashed.toString("hex").slice(0, 12)}…, not ${digest.toString("hex").slice(0, 12)}…`, genTime };

  // One SignerInfo { version, sid, sha256, [0] signedAttrs, signatureAlgorithm, signature }, no unsigned attributes.
  const infos = children(want(rest[0], TAG.SET, "the signer infos"));
  if (infos.length !== 1) return { ok: false, detail: "a time-stamp token has exactly one signer", genTime };
  const s = children(want(infos[0], TAG.SEQUENCE, "the signer info"));
  if (s.length !== 6) return { ok: false, detail: "the signer info is not { version, sid, digest, signed attributes, algorithm, signature } (unsigned attributes are not read here)", genTime };
  const bySerial = s[1]!.tag === TAG.SEQUENCE;
  intIs(s[0], bySerial ? 1 : 3, "the SignerInfo version");
  const signerDigest = HASHES[algOf(s[2], "the signer's digest algorithm")];
  if (!signerDigest) return { ok: false, detail: "the signer's digest is not SHA-256, SHA-384 or SHA-512", genTime };
  if (digestAlgs.length !== 1 || HASHES[digestAlgs[0]!] !== signerDigest) return { ok: false, detail: "the token's digest algorithms are not its signer's alone", genTime };
  const signedAttrs = want(s[3], 0xa0, "the signed attributes");
  const sigAlg = algOf(s[4], "the signature algorithm");
  const signature = want(s[5], TAG.OCTET_STRING, "the signature").content;
  const attrs = children(signedAttrs).map((a) => children(want(a, TAG.SEQUENCE, "an attribute")));
  const attrOids = attrs.map((a) => oidOf(want(a[0], TAG.OID, "an attribute type")));
  if (new Set(attrOids).size !== attrOids.length) return { ok: false, detail: "a signed attribute is there twice", genTime };
  const attr = (o: string): Der | undefined => {
    const a = attrs[attrOids.indexOf(o)];
    const vals = a && a.length === 2 ? children(want(a[1], TAG.SET, "an attribute's values")) : [];
    return vals.length === 1 ? vals[0] : undefined;
  };
  const ctype = attr(OID.contentType), md = attr(OID.messageDigest);
  if (!ctype || ctype.tag !== TAG.OID || oidOf(ctype) !== OID.tstInfo) return { ok: false, detail: "the signed content type is not a TSTInfo", genTime };
  if (!md || md.tag !== TAG.OCTET_STRING || !md.content.equals(createHash(signerDigest).update(tstInfo.raw).digest())) return { ok: false, detail: "the signed message digest is not the TSTInfo's", genTime };

  // The signer's certificate: named by sid, and bound by the signed ESS signing-certificate attribute (RFC 3161
  // clause 2.4.1, RFC 5816), so not one byte of it can change. Every other certificate must be its chain.
  const certs = certsSet ? children(certsSet).map((c) => new X509Certificate(want(c, TAG.SEQUENCE, "a certificate").raw)) : [];
  const sid = s[1]!;
  const cert = certs.find((c) => {
    const p = certParts(c);
    if (!bySerial) return sid.tag === 0x80 && p.ski !== null && p.ski.equals(sid.content);
    const [iss, ser] = children(sid);
    return children(sid).length === 2 && iss!.raw.equals(p.issuer) && want(ser, TAG.INTEGER, "the signer's serial").content.equals(p.serial);
  });
  if (!cert) return { ok: false, detail: "the token carries no certificate of its signer (it was asked for one)", genTime };
  const v2 = attr(SIGNING_CERTIFICATE_V2), v1 = attr(SIGNING_CERTIFICATE);
  const essId = children(want(children(want(v2 ?? v1, TAG.SEQUENCE, "the signing-certificate attribute"))[0], TAG.SEQUENCE, "the certificate IDs"))[0];
  const ess = children(want(essId, TAG.SEQUENCE, "the signer's certificate ID"));
  const essAlg = v2 && ess[0]?.tag === TAG.SEQUENCE ? algOf(ess.shift(), "the certificate hash's algorithm") : v2 ? OID.sha256 : "1.3.14.3.2.26";
  const certHash = want(ess[0], TAG.OCTET_STRING, "the certificate hash").content;
  if (essAlg !== OID.sha256 && essAlg !== "1.3.14.3.2.26") return { ok: false, detail: `a certificate hash algorithm this check does not know (${essAlg})`, genTime };
  if (!createHash(essAlg === OID.sha256 ? "sha256" : "sha1").update(cert.raw).digest().equals(certHash)) return { ok: false, detail: "the signed signing-certificate attribute names another certificate", genTime };
  const chain = [cert];
  for (let cur = cert, next: X509Certificate | undefined; (next = certs.find((c) => !chain.includes(c) && cur.checkIssued(c) && cur.verify(c.publicKey))); cur = next) chain.push(next);
  if (chain.length !== certs.length) return { ok: false, detail: "a certificate in the token is not on its signer's chain", genTime };
  const top = chain[chain.length - 1]!;
  if (top.checkIssued(top) && !top.verify(top.publicKey)) return { ok: false, detail: "the top certificate of the TSA's chain does not verify itself", genTime };

  if (!(cert.keyUsage ?? []).includes("1.3.6.1.5.5.7.3.8")) return { ok: false, detail: `${cert.subject.replace(/\n/g, ", ")} is not a time-stamping certificate`, genTime };
  if (Date.parse(genTime) < Date.parse(cert.validFrom) || Date.parse(genTime) > Date.parse(cert.validTo)) return { ok: false, detail: "the stamp's time is outside its certificate's validity", genTime };
  // signedAttrs is signed as a DER SET OF (tag 0x31), not as the [0] IMPLICIT it is stored under (RFC 5652 clause 5.4).
  const signedBytes = Buffer.concat([Buffer.from([TAG.SET]), signedAttrs.raw.subarray(1)]);
  const keyType = cert.publicKey.asymmetricKeyType;
  const sigHash = keyType === "ec" ? ECDSA[sigAlg] : keyType === "rsa" ? (sigAlg === OID.rsaEncryption ? signerDigest : RSA[sigAlg]) : undefined;
  if (!sigHash) return { ok: false, detail: `a signature algorithm this check does not know for a ${keyType} key (${sigAlg})`, genTime };
  const ok = cryptoVerify(sigHash, signedBytes, cert.publicKey, signature);
  const tsa = cert.subject.replace(/\n/g, ", ");
  return ok
    ? { ok: true, detail: `RFC 3161 token of ${genTime} by ${tsa} (policy ${policy}) stamps ${digest.toString("hex").slice(0, 12)}…; its signature verifies; ${TSA_TRUST_NOTE}`, genTime, tsa }
    : { ok: false, detail: `the TSA's signature does not verify with ${tsa}'s certificate`, genTime, tsa };
}
