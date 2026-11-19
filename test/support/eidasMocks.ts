// Stand-ins for the eIDAS option's outside parties, for the tests only. Nothing here is a QTSP, a qualified
// certificate or a qualified time-stamp: every certificate is made up on the spot by a made-up CA ("MOCK QTSP CA"),
// and every key is generated per run and thrown away. The QC statements a mock certificate carries are there to show
// that the verifier reads them and still says the EU Trusted List is not checked: anyone can write them.
//
//   - mockCert: X.509 v3 certificates (DER), signed by a mock CA, optionally with QC statements or an EKU.
//   - MockTsa: an RFC 3161 TSA (a function, and an HTTP endpoint on 127.0.0.1 for requestTimestamp).
//   - MockCsc: a CSC API v2 remote signing service on 127.0.0.1 (credentials/list, /info, /authorize,
//     signatures/signHash), with SCAL 2 (the SAD is bound to the hashes) and an injectable clock to expire a SAD.

import { createHash, generateKeyPairSync, privateEncrypt, randomBytes, sign, constants, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { p256 } from "@noble/curves/p256"; // viem's dependency, in the lockfile: signs a precomputed hash, which node:crypto does not
import { bitString, bool, children, ctx, der, gtime, int, oid, OID, octets, readOne, seq, set, TAG, utf8 } from "../../src/eidas/der.js";

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

export interface KeyPair { privateKey: KeyObject; publicKey: KeyObject; kind: "ec" | "rsa" }
export const ecKey = (): KeyPair => ({ ...generateKeyPairSync("ec", { namedCurve: "P-256" }), kind: "ec" });
export const rsaKey = (): KeyPair => ({ ...generateKeyPairSync("rsa", { modulusLength: 2048 }), kind: "rsa" });

const nameDer = (cn: string) => seq(set(seq(oid("2.5.4.3"), utf8(cn))), set(seq(oid("2.5.4.10"), utf8("MOCK — not a trust service provider"))));
const utcTime = (iso: string) => der(TAG.UTC_TIME, Buffer.from(new Date(iso).toISOString().slice(2, 19).replace(/[-:T]/g, "") + "Z", "latin1"));
const sigAlg = (k: KeyPair) => (k.kind === "ec" ? seq(oid(OID.ecdsaWithSha256)) : seq(oid(OID.sha256WithRsa), der(TAG.NULL)));

export interface CertSpec {
  cn: string;
  key: KeyPair;
  issuer?: { cn: string; key: KeyPair };
  serial?: number;
  notBefore?: string;
  notAfter?: string;
  ca?: boolean;
  /** QC statements (ETSI EN 319 412-5) the mock certificate claims: QcCompliance, QcSSCD and QcType esign. */
  qc?: boolean;
  /** Extended key usage for a TSA (id-kp-timeStamping), critical as RFC 3161 asks. */
  tsa?: boolean;
}

/** An X.509 v3 certificate, DER. Self-signed when there is no issuer. */
export function mockCert(s: CertSpec): Buffer {
  const issuer = s.issuer ?? { cn: s.cn, key: s.key };
  const ext: Buffer[] = [];
  if (s.ca) ext.push(seq(oid("2.5.29.19"), bool(true), octets(seq(bool(true)))));
  if (s.tsa) ext.push(seq(oid("2.5.29.37"), bool(true), octets(seq(oid("1.3.6.1.5.5.7.3.8")))));
  if (s.qc) ext.push(seq(oid(OID.qcStatements), octets(seq(seq(oid(OID.qcCompliance)), seq(oid(OID.qcSSCD)), seq(oid(OID.qcType), seq(oid(OID.qcTypeEsign)))))));
  const tbs = seq(
    ctx(0, int(2)), int(s.serial ?? 1), sigAlg(issuer.key), nameDer(issuer.cn),
    seq(utcTime(s.notBefore ?? "2026-01-01T00:00:00Z"), utcTime(s.notAfter ?? "2028-01-01T00:00:00Z")),
    nameDer(s.cn), s.key.publicKey.export({ type: "spki", format: "der" }),
    ...(ext.length ? [ctx(3, seq(...ext))] : []),
  );
  return seq(tbs, sigAlg(issuer.key), bitString(sign("sha256", tbs, issuer.key.privateKey)));
}

/** Signs a SHA-256 as is, the way an HSM does: ECDSA (DER) or RSASSA-PKCS1-v1_5 over the DigestInfo. */
export function signDigest(k: KeyPair, digest: Uint8Array): Buffer {
  if (k.kind === "rsa") {
    const digestInfo = seq(seq(oid(OID.sha256), der(TAG.NULL)), octets(digest));
    return privateEncrypt({ key: k.privateKey, padding: constants.RSA_PKCS1_PADDING }, digestInfo);
  }
  const d = Buffer.from(k.privateKey.export({ format: "jwk" }).d!, "base64url");
  return Buffer.from(p256.sign(digest, d, { prehash: false }).toDERRawBytes());
}

/** A mock RFC 3161 TSA. `stamp` makes a token directly; `listen` serves application/timestamp-query on 127.0.0.1. */
export class MockTsa {
  readonly key = ecKey();
  readonly cert: Buffer;
  private serial = 0;
  private server: Server | null = null;
  constructor(public now: () => Date = () => new Date("2026-11-19T10:00:00Z")) {
    this.cert = mockCert({ cn: "MOCK TSA (not qualified)", key: this.key, serial: 77, tsa: true });
  }

  token(digest: Uint8Array, nonce?: Buffer): Buffer {
    const tst = seq(int(1), oid("1.3.6.1.4.1.99999.1"), seq(seq(oid(OID.sha256)), octets(digest)), int(++this.serial), gtime(this.now().toISOString()), ...(nonce ? [der(TAG.INTEGER, nonce)] : []));
    // contentType, messageDigest and ESS signingCertificateV2 (RFC 5816): the SHA-256 of the TSA's certificate, signed.
    const attrs = set(
      seq(oid(OID.contentType), set(oid(OID.tstInfo))), seq(oid(OID.messageDigest), set(octets(sha256(tst)))),
      seq(oid("1.2.840.113549.1.9.16.2.47"), set(seq(seq(seq(octets(sha256(this.cert))))))),
    );
    const signature = sign("sha256", attrs, this.key.privateKey);
    const issuerAndSerial = seq(nameDer("MOCK TSA (not qualified)"), int(77));
    const signerInfo = seq(int(1), issuerAndSerial, seq(oid(OID.sha256)), Buffer.concat([Buffer.from([0xa0]), attrs.subarray(1)]), seq(oid(OID.ecdsaWithSha256)), octets(signature));
    const signedData = seq(int(3), set(seq(oid(OID.sha256))), seq(oid(OID.tstInfo), ctx(0, octets(tst))), ctx(0, this.cert), set(signerInfo));
    return seq(oid(OID.signedData), ctx(0, signedData));
  }

  stamp = async (digest: Buffer): Promise<Buffer> => this.token(digest);

  async listen(): Promise<string> {
    this.server = createServer(async (req, res) => {
      const body = await read(req);
      try {
        if (req.method !== "POST" || req.headers["content-type"] !== "application/timestamp-query") throw new Error("not a time-stamp query");
        const q = children(readOne(body));
        const digest = children(q[1]!)[1]!.content;
        const nonce = q.find((x, i) => i > 1 && x.tag === TAG.INTEGER)?.content;
        res.writeHead(200, { "content-type": "application/timestamp-reply" }).end(seq(seq(int(0)), this.token(digest, nonce ? Buffer.from(nonce) : undefined)));
      } catch {
        res.writeHead(200, { "content-type": "application/timestamp-reply" }).end(seq(seq(int(2))));
      }
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/tsr`;
  }

  close = () => new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
}

const read = (req: IncomingMessage) => new Promise<Buffer>((resolve) => { const parts: Buffer[] = []; req.on("data", (c: Buffer) => parts.push(c)); req.on("end", () => resolve(Buffer.concat(parts))); });

export interface MockCredential {
  id: string;
  key: KeyPair;
  chain: Buffer[];
  pin: string;
  qualifier: string;
  status: "enabled" | "disabled";
}

/** A mock CSC API v2 remote signing service (the QTSP's RSSP) on 127.0.0.1. */
export class MockCsc {
  readonly token = randomBytes(16).toString("hex");
  readonly caKey = ecKey();
  readonly caCert: Buffer;
  readonly credentials: MockCredential[] = [];
  /** Every request, as received: the tests read what the client sent. */
  readonly calls: { method: string; body: Record<string, unknown> }[] = [];
  private readonly sads = new Map<string, { credentialID: string; hashes: Set<string>; expiresAt: number; left: number }>();
  private server: Server | null = null;
  sadLifetimeSeconds = 300;

  constructor(public now: () => Date = () => new Date("2026-11-19T10:00:00Z")) {
    this.caCert = mockCert({ cn: "MOCK QTSP CA (not on any Trusted List)", key: this.caKey, serial: 1, ca: true });
  }

  /** Adds the CFO's credential: a key, and a certificate claiming to be qualified, issued by the mock CA. */
  addCredential(o: { id?: string; kind?: "ec" | "rsa"; qualifier?: string; status?: "enabled" | "disabled"; qc?: boolean; pin?: string } = {}): MockCredential {
    const key = o.kind === "rsa" ? rsaKey() : ecKey();
    const leaf = mockCert({ cn: "MOCK CFO Northwind (test only)", key, issuer: { cn: "MOCK QTSP CA (not on any Trusted List)", key: this.caKey }, serial: 1000 + this.credentials.length, qc: o.qc ?? true });
    const c: MockCredential = { id: o.id ?? `cred-${this.credentials.length + 1}`, key, chain: [leaf, this.caCert], pin: o.pin ?? "123456", qualifier: o.qualifier ?? "eu_eidas_qes", status: o.status ?? "enabled" };
    this.credentials.push(c);
    return c;
  }

  private info(c: MockCredential) {
    return {
      credentialID: c.id, description: "MOCK credential", signatureQualifier: c.qualifier,
      key: { status: c.status, algo: c.key.kind === "ec" ? [OID.ecdsaWithSha256] : [OID.rsaEncryption], len: c.key.kind === "ec" ? 256 : 2048, ...(c.key.kind === "ec" ? { curve: "1.2.840.10045.3.1.7" } : {}) },
      cert: { status: "valid", certificates: c.chain.map((x) => x.toString("base64")) },
      auth: { mode: "explicit", objects: [{ type: "Password", id: "PIN", format: "N" }] },
      SCAL: "2", multisign: 1,
    };
  }

  private handle(method: string, b: Record<string, unknown>): [number, Record<string, unknown>] {
    const bad = (d: string, error = "invalid_request"): [number, Record<string, unknown>] => [400, { error, error_description: d }];
    const cred = () => this.credentials.find((c) => c.id === b.credentialID);
    switch (method) {
      case "credentials/list":
        return [200, { credentialIDs: this.credentials.map((c) => c.id), ...(b.credentialInfo === true ? { credentialInfos: this.credentials.map((c) => this.info(c)) } : {}) }];
      case "credentials/info": {
        const c = cred();
        return c ? [200, this.info(c)] : bad("Invalid parameter credentialID");
      }
      case "credentials/authorize": {
        const c = cred();
        if (typeof b.credentialID !== "string") return bad("Missing (or invalid type) string parameter credentialID");
        if (!c) return bad("Invalid parameter credentialID");
        if (c.status !== "enabled") return bad("The credential identified by credentialID is disabled");
        if (!Number.isInteger(b.numSignatures) || (b.numSignatures as number) < 1) return bad("Invalid value for parameter numSignatures");
        if ((b.numSignatures as number) > 1) return bad("Numbers of signatures is too high");
        const hashes = b.hashes;
        // SCAL 2: the hashes are required, so the SAD is bound to them.
        if (!Array.isArray(hashes) || hashes.length === 0 || !hashes.every((h) => typeof h === "string")) return bad("Missing (or invalid type) array parameter hashes");
        if (b.hashAlgorithmOID !== OID.sha256) return bad("Invalid parameter hashAlgorithmOID");
        const auth = Array.isArray(b.authData) ? (b.authData as { id?: unknown; value?: unknown }[]) : [];
        if (!auth.some((a) => a.id === "PIN" && a.value === c.pin)) return bad("The authentication data is invalid", "invalid_authentication_data");
        const SAD = randomBytes(24).toString("base64url");
        this.sads.set(SAD, { credentialID: c.id, hashes: new Set(hashes as string[]), expiresAt: this.now().getTime() + this.sadLifetimeSeconds * 1000, left: b.numSignatures as number });
        return [200, { SAD, expiresIn: this.sadLifetimeSeconds }];
      }
      case "signatures/signHash": {
        const c = cred();
        if (!c) return bad("Invalid parameter credentialID");
        if (typeof b.SAD !== "string") return bad("Missing (or invalid type) string parameter SAD");
        const sad = this.sads.get(b.SAD);
        if (!sad || sad.credentialID !== c.id) return bad("Invalid parameter SAD");
        if (this.now().getTime() > sad.expiresAt) return bad("SAD expired");
        const hashes = b.hashes;
        if (!Array.isArray(hashes) || hashes.length === 0) return bad("Empty hash array");
        if (b.signAlgo !== (c.key.kind === "ec" ? OID.ecdsaWithSha256 : OID.rsaEncryption)) return bad("Invalid parameter signAlgo");
        const out: string[] = [];
        for (const h of hashes as string[]) {
          const bytes = Buffer.from(h, "base64");
          if (bytes.toString("base64") !== h) return bad("Invalid Base64 hash string parameter");
          if (bytes.length !== 32) return bad("Invalid digest value length");
          if (!sad.hashes.has(h)) return bad("Hash is not authorized by the SAD.");
        }
        if (sad.left < hashes.length) return bad("Invalid parameter SAD");
        sad.left -= hashes.length;
        for (const h of hashes as string[]) out.push(signDigest(c.key, Buffer.from(h, "base64")).toString("base64"));
        return [200, { signatures: out }];
      }
      default:
        return [404, { error: "invalid_request", error_description: `no method ${method}` }];
    }
  }

  async listen(): Promise<string> {
    this.server = createServer(async (req, res) => {
      const raw = await read(req);
      const method = (req.url ?? "").replace(/^\/csc\/v2\//, "");
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>; } catch { /* an empty or broken body: the method refuses it */ }
      this.calls.push({ method, body });
      const [status, json] = req.headers.authorization === `Bearer ${this.token}` ? this.handle(method, body) : [401, { error: "invalid_token", error_description: "Invalid access token" }];
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/csc/v2`;
  }

  close = () => new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
}
