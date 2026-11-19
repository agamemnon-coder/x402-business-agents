// A small DER (ASN.1) reader and writer, enough for what the eIDAS option touches: an RFC 3161 time-stamp request and
// token, and the X.509 certificate fields the verifier reads (the QC statements of ETSI EN 319 412-5). No dependency:
// the runner's other code reads no ASN.1, and a verifier anyone can read is the point. Not a general ASN.1 library.

/** One DER element: its tag byte, its content, and the whole element's bytes (header and content). */
export interface Der { tag: number; content: Buffer; raw: Buffer }

/** Reads one element at `at`; throws on anything that is not definite-length DER inside `buf`. */
export function readDer(buf: Buffer, at = 0): Der & { end: number } {
  if (at + 2 > buf.length) throw new Error("DER ends early");
  const tag = buf[at]!;
  if ((tag & 0x1f) === 0x1f) throw new Error("DER: multi-byte tags are not read here");
  let len = buf[at + 1]!, off = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER: an indefinite or too long length");
    if (off + n > buf.length) throw new Error("DER ends early");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + i]!;
    off += n;
  }
  const end = off + len;
  if (end > buf.length) throw new Error("DER ends early");
  return { tag, content: buf.subarray(off, end), raw: buf.subarray(at, end), end };
}

/** The elements inside a constructed element (a SEQUENCE, a SET, an explicit tag). */
export function children(d: Der): Der[] {
  const out: Der[] = [];
  for (let at = 0; at < d.content.length;) {
    const c = readDer(d.content, at);
    out.push(c);
    at = c.end;
  }
  return out;
}

/** The one element a buffer must hold, nothing after it. */
export function readOne(buf: Buffer): Der {
  const d = readDer(buf, 0);
  if (d.end !== buf.length) throw new Error("DER: bytes after the element");
  return d;
}

export const TAG = {
  BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04, NULL: 0x05, OID: 0x06, UTF8: 0x0c,
  PRINTABLE: 0x13, UTC_TIME: 0x17, GENERALIZED_TIME: 0x18, SEQUENCE: 0x30, SET: 0x31,
} as const;

/** An element from its tag and content. */
export function der(tag: number, ...content: (Buffer | Uint8Array)[]): Buffer {
  const body = Buffer.concat(content.map((c) => Buffer.from(c)));
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : (() => {
    const bytes: number[] = [];
    for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

export const seq = (...c: Buffer[]) => der(TAG.SEQUENCE, ...c);
export const set = (...c: Buffer[]) => der(TAG.SET, ...c.slice().sort(Buffer.compare)); // DER sorts a SET OF
export const octets = (b: Uint8Array) => der(TAG.OCTET_STRING, b);
export const nullDer = () => der(TAG.NULL);
export const bool = (v: boolean) => der(TAG.BOOLEAN, Buffer.from([v ? 0xff : 0]));
export const utf8 = (s: string) => der(TAG.UTF8, Buffer.from(s, "utf8"));
export const bitString = (b: Uint8Array) => der(TAG.BIT_STRING, Buffer.from([0]), b);
/** [n] EXPLICIT (constructed) or IMPLICIT over a constructed type. */
export const ctx = (n: number, ...c: Buffer[]) => der(0xa0 | n, ...c);

/** A non-negative INTEGER from a number or big-endian bytes. */
export function int(v: number | bigint | Uint8Array): Buffer {
  let b: Buffer;
  if (typeof v === "number" || typeof v === "bigint") {
    let x = BigInt(v);
    if (x < 0n) throw new Error("DER: only non-negative integers here");
    const bytes: number[] = [];
    do { bytes.unshift(Number(x & 0xffn)); x >>= 8n; } while (x > 0n);
    b = Buffer.from(bytes);
  } else {
    b = Buffer.from(v);
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.subarray(i);
  }
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(TAG.INTEGER, b);
}

/** An OBJECT IDENTIFIER from its dotted form. */
export function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map((p) => BigInt(p));
  if (parts.length < 2) throw new Error(`not an OID: ${dotted}`);
  const out: number[] = [Number(parts[0]! * 40n + parts[1]!)];
  for (const p of parts.slice(2)) {
    const bytes: number[] = [];
    let x = p;
    do { bytes.unshift(Number(x & 0x7fn)); x >>= 7n; } while (x > 0n);
    for (let i = 0; i < bytes.length - 1; i++) bytes[i]! |= 0x80;
    out.push(...bytes);
  }
  return der(TAG.OID, Buffer.from(out));
}

/** The dotted form of an OBJECT IDENTIFIER element. */
export function oidOf(d: Der): string {
  if (d.tag !== TAG.OID || d.content.length === 0) throw new Error("DER: not an OBJECT IDENTIFIER");
  const c = d.content, out: bigint[] = [];
  let v = 0n;
  for (let i = 0; i < c.length; i++) {
    v = (v << 7n) | BigInt(c[i]! & 0x7f);
    if (!(c[i]! & 0x80)) { out.push(v); v = 0n; }
  }
  const first = out.shift()!;
  const a = first < 80n ? first / 40n : 2n;
  return [a, first - a * 40n, ...out].join(".");
}

/** GeneralizedTime "YYYYMMDDHHMMSS[.f]Z" as an ISO string. */
export function generalizedTime(d: Der): string {
  if (d.tag !== TAG.GENERALIZED_TIME) throw new Error("DER: not a GeneralizedTime");
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(d.content.toString("latin1"));
  if (!m) throw new Error(`DER: not a UTC GeneralizedTime: ${d.content.toString("latin1")}`);
  const ms = m[7] ? m[7].slice(0, 4).padEnd(4, "0") : ".000";
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${ms}Z`;
}

export function gtime(iso: string): Buffer {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return der(TAG.GENERALIZED_TIME, Buffer.from(`${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, "latin1"));
}

export const OID = {
  sha256: "2.16.840.1.101.3.4.2.1",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  rsaEncryption: "1.2.840.113549.1.1.1",
  sha256WithRsa: "1.2.840.113549.1.1.11",
  signedData: "1.2.840.113549.1.7.2",
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  /** RFC 3739 / ETSI EN 319 412-5: the certificate's QC statements extension. */
  qcStatements: "1.3.6.1.5.5.7.1.3",
  /** ETSI EN 319 412-5: the certificate says it is an EU qualified certificate. */
  qcCompliance: "0.4.0.1862.1.1",
  /** ETSI EN 319 412-5: the certificate says its private key is in a QSCD. */
  qcSSCD: "0.4.0.1862.1.4",
  /** ETSI EN 319 412-5: the QC type; esign (0.4.0.1862.1.6.1) is for electronic signatures. */
  qcType: "0.4.0.1862.1.6",
  qcTypeEsign: "0.4.0.1862.1.6.1",
} as const;

/** ECDSA's DER signature (SEQUENCE of r and s) as JOSE's raw r ‖ s, each `size` bytes. */
export function ecdsaDerToRaw(sig: Buffer, size = 32): Buffer {
  const s = readOne(sig);
  const [r, ss] = children(s);
  if (s.tag !== TAG.SEQUENCE || !r || !ss || r.tag !== TAG.INTEGER || ss.tag !== TAG.INTEGER) throw new Error("not a DER ECDSA signature");
  const fix = (b: Buffer) => {
    let x = b;
    while (x.length > size && x[0] === 0) x = x.subarray(1);
    if (x.length > size) throw new Error("an ECDSA integer is too long");
    return Buffer.concat([Buffer.alloc(size - x.length), x]);
  };
  return Buffer.concat([fix(r.content), fix(ss.content)]);
}

/** JOSE's raw r ‖ s as ECDSA's DER signature. */
export function ecdsaRawToDer(raw: Buffer): Buffer {
  if (raw.length % 2) throw new Error("a raw ECDSA signature has an even length");
  return seq(int(raw.subarray(0, raw.length / 2)), int(raw.subarray(raw.length / 2)));
}
