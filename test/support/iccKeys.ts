// Keys and a certificate for the ICC tests, made at run time with node:crypto only. Nothing here is a real key, and
// nothing is written to the repository: a test asks for a fresh set and, when it needs files, a fresh private folder.
//
// node:crypto cannot issue an X.509 certificate, so the few DER structures a self-signed one needs are written out by
// hand below. The certificate's subject carries a SERIALNUMBER, as the documentation's Java sample expects of the
// certificate that encrypts requests (docs/visa-icc.md, "Message-Level Encryption").
import { constants, createCipheriv, generateKeyPairSync, publicEncrypt, randomBytes, sign, type KeyObject } from "node:crypto";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const head = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return Buffer.concat([Buffer.from([tag, ...head]), body]);
}
const seq = (...p: Buffer[]) => der(0x30, ...p);
const set = (...p: Buffer[]) => der(0x31, ...p);
const text = (s: string) => der(0x0c, Buffer.from(s, "utf8"));
const printable = (s: string) => der(0x13, Buffer.from(s, "ascii"));
const utcTime = (s: string) => der(0x17, Buffer.from(s, "ascii"));
const integer = (b: Buffer) => der(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split(".").map(Number) as [number, number, ...number[]];
  const bytes = [a * 40 + b];
  for (let v of rest) {
    const chunk = [v & 0x7f];
    while ((v = Math.floor(v / 128)) > 0) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

const pem = (label: string, body: Buffer) => `-----BEGIN ${label}-----\n${body.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/** A self-signed certificate over `publicKey`, signed with `privateKey`. With `serialNumber`, the subject carries it. */
export function selfSignedCertificate(o: { publicKey: KeyObject; privateKey: KeyObject; commonName: string; serialNumber?: string; certSerial?: Buffer }): string {
  const name = seq(
    set(seq(oid("2.5.4.3"), text(o.commonName))),
    ...(o.serialNumber ? [set(seq(oid("2.5.4.5"), printable(o.serialNumber)))] : []),
  );
  const algorithm = seq(oid("1.2.840.113549.1.1.11"), der(0x05));
  const tbs = seq(
    der(0xa0, integer(Buffer.from([2]))),
    integer(o.certSerial ?? Buffer.from([0x01, 0xe2, 0x40])),
    algorithm, name,
    seq(utcTime("260101000000Z"), utcTime("360101000000Z")),
    name,
    o.publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = sign("sha256", tbs, o.privateKey);
  return pem("CERTIFICATE", seq(tbs, algorithm, der(0x03, Buffer.from([0]), signature)));
}

export interface IccTestKeys {
  /** The JWT signing key pair (the client's own). */
  signing: { publicKey: KeyObject; privateKey: KeyObject };
  /** The key pair that encrypts requests: the client holds the certificate, the stand-in the private key. */
  request: { publicKey: KeyObject; privateKey: KeyObject; certificatePem: string; keyId: string };
  /** The key pair that decrypts answers: the client holds the private key, the stand-in the public key. */
  response: { publicKey: KeyObject; privateKey: KeyObject };
  /** A shared secret, Base64, as the Business Center gives one. */
  sharedSecret: string;
}

const rsa = () => generateKeyPairSync("rsa", { modulusLength: 2048 });

export function makeIccTestKeys(): IccTestKeys {
  const signing = rsa(), request = rsa(), response = rsa();
  const keyId = `${Date.now()}${randomBytes(4).readUInt32BE(0)}`.slice(0, 22);
  return {
    signing,
    request: { ...request, keyId, certificatePem: selfSignedCertificate({ publicKey: request.publicKey, privateKey: request.privateKey, commonName: "Test stand-in request certificate", serialNumber: keyId }) },
    response,
    sharedSecret: randomBytes(32).toString("base64"),
  };
}

/** The keys as PEM files in a fresh private folder (0700; the key files 0600), the way the client's env reader wants them. */
export function writeIccKeyFiles(keys: IccTestKeys, o: { passphrase?: string } = {}): { dir: string; jwtKey: string; requestCert: string; responseKey: string } {
  const dir = mkdtempSync(join(tmpdir(), "icc-test-keys-"));
  chmodSync(dir, 0o700);
  const privatePem = (k: KeyObject) => (o.passphrase
    ? k.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: o.passphrase })
    : k.export({ type: "pkcs8", format: "pem" })) as string;
  const files = { dir, jwtKey: join(dir, "jwt-signing-key.pem"), requestCert: join(dir, "request-certificate.pem"), responseKey: join(dir, "response-key.pem") };
  writeFileSync(files.jwtKey, privatePem(keys.signing.privateKey), { mode: 0o600 });
  writeFileSync(files.requestCert, keys.request.certificatePem, { mode: 0o644 });
  writeFileSync(files.responseKey, privatePem(keys.response.privateKey), { mode: 0o600 });
  return files;
}

/**
 * An encrypted answer as the documentation describes one (docs/visa-icc.md, "Message-Level Encryption"): a compact JWE
 * whose header has alg RSA-OAEP-256, enc A256GCM, iat and kid. Made by the tests and by the test stand-in.
 */
export function responseJwe(json: string, publicKey: KeyObject, keyId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RSA-OAEP-256", enc: "A256GCM", iat: String(Date.now()), kid: keyId })).toString("base64url");
  const cek = randomBytes(32), iv = randomBytes(12);
  const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, cek);
  const cipher = createCipheriv("aes-256-gcm", cek, iv);
  cipher.setAAD(Buffer.from(header, "ascii"));
  const ciphertext = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  return [header, wrapped.toString("base64url"), iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}
