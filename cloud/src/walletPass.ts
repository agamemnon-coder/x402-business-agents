// An Apple Wallet pass per agent card (21 Nov, the owner). A .pkpass is a zip of pass.json, its images, manifest.json
// (the SHA-1 of every other file, as Apple's format has it) and `signature`: a detached PKCS#7 (CMS SignedData) over
// manifest.json, signed with the company's Pass Type ID certificate and carrying Apple's WWDR intermediate, so Wallet
// can check that the pass came from that Pass Type ID and was not changed.
//
// Behind configuration only: every one of PASS_TYPE_ID, TEAM_ID, PASS_CERT_PEM, PASS_KEY_PEM and PASS_WWDR_PEM (Worker
// secrets the owner sets; never in git) must be there and readable, else `passConfigFrom` answers null, the console
// shows no button and the routes answer 404. The pass shows the agent's name, its card's limits, the card's last four
// and its status; it holds no card number and pays nothing. A revoked agent's pass is marked voided.
//
// Plain WebCrypto and a small DER writer and reader: the same code runs in the Worker and in the tests (which make a
// throwaway certificate at run time; no key is committed).

// ---- DER ----

const te = new TextEncoder();
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
function derLen(n: number): Uint8Array {
  if (n < 0x80) return Uint8Array.of(n);
  const b: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) b.unshift(x & 0xff);
  return Uint8Array.of(0x80 | b.length, ...b);
}
export const der = (tag: number, ...content: Uint8Array[]): Uint8Array => { const c = cat(...content); return cat(Uint8Array.of(tag), derLen(c.length), c); };
export const seq = (...c: Uint8Array[]) => der(0x30, ...c);
/** A SET OF in DER order: its elements sorted by their encodings. */
export const setOf = (...c: Uint8Array[]) => der(0x31, ...[...c].sort(cmpBytes));
const ctx = (n: number, ...c: Uint8Array[]) => der(0xa0 + n, ...c);
const octets = (b: Uint8Array) => der(0x04, b);
const NULL = Uint8Array.of(0x05, 0x00);
export function oid(dotted: string): Uint8Array {
  const p = dotted.split(".").map(Number);
  const body: number[] = [40 * p[0]! + p[1]!];
  for (const v of p.slice(2)) {
    const b: number[] = [];
    let x = v;
    do { b.unshift(x & 0x7f); x = Math.floor(x / 128); } while (x > 0);
    for (let i = 0; i < b.length - 1; i++) b[i]! |= 0x80;
    body.push(...b);
  }
  return der(0x06, Uint8Array.from(body));
}
export function int(n: number | Uint8Array): Uint8Array {
  let b = typeof n === "number" ? (() => { const a: number[] = []; let x = n; do { a.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0); return Uint8Array.from(a); })() : n;
  if (b[0]! & 0x80) b = cat(Uint8Array.of(0), b);
  return der(0x02, b);
}
function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
/** UTCTime as CMS's signingTime wants it (YYMMDDHHMMSSZ, years 1950 to 2049). */
export function utcTime(d: Date): Uint8Array {
  const s = d.toISOString();
  return der(0x17, te.encode(`${s.slice(2, 4)}${s.slice(5, 7)}${s.slice(8, 10)}${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`));
}

/** One DER element: its tag, where its content starts and ends, and where the whole element ends. */
export interface DerNode { tag: number; start: number; contentStart: number; end: number }
export function readDer(b: Uint8Array, at = 0): DerNode {
  if (at + 2 > b.length) throw new Error("DER: truncated");
  const tag = b[at]!;
  let len = b[at + 1]!, o = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4 || o + n > b.length) throw new Error("DER: bad length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[o + i]!;
    o += n;
  }
  if (o + len > b.length) throw new Error("DER: truncated");
  return { tag, start: at, contentStart: o, end: o + len };
}
/** The children of a constructed element. */
export function children(b: Uint8Array, n: DerNode): DerNode[] {
  const out: DerNode[] = [];
  for (let o = n.contentStart; o < n.end;) { const c = readDer(b, o); out.push(c); o = c.end; }
  return out;
}

// ---- PEM, certificates, keys ----

export function pemBlocks(pem: string, label: RegExp): Uint8Array[] {
  const out: Uint8Array[] = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (let m = re.exec(pem); m; m = re.exec(pem)) {
    if (!label.test(m[1]!)) continue;
    const bin = atob(m[2]!.replace(/[^A-Za-z0-9+/=]/g, ""));
    out.push(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return out;
}

/** A certificate's issuer Name and serialNumber, as raw DER (what a SignerInfo names it by), and its subject's raw DER. */
export function certIds(cert: Uint8Array): { issuer: Uint8Array; serial: Uint8Array; subject: Uint8Array } {
  const top = readDer(cert);
  if (top.tag !== 0x30) throw new Error("not a certificate");
  const tbs = children(cert, top)[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error("not a certificate");
  const f = children(cert, tbs);
  const i = f[0]?.tag === 0xa0 ? 1 : 0; // [0] version, when present
  const serial = f[i], issuer = f[i + 2], subject = f[i + 4];
  if (serial?.tag !== 0x02 || issuer?.tag !== 0x30 || subject?.tag !== 0x30) throw new Error("not a certificate");
  return { serial: cert.slice(serial.start, serial.end), issuer: cert.slice(issuer.start, issuer.end), subject: cert.slice(subject.start, subject.end) };
}

const RSA_ENCRYPTION = "1.2.840.113549.1.1.1";
/** A PKCS#8 private key from PEM: "PRIVATE KEY" as it is, "RSA PRIVATE KEY" (PKCS#1) wrapped. Encrypted keys are refused. */
export function pkcs8Of(pem: string): Uint8Array {
  if (/ENCRYPTED/.test(pem)) throw new Error("the pass signing key is encrypted; export it without a passphrase (openssl pkcs8 -topk8 -nocrypt)");
  const p8 = pemBlocks(pem, /^PRIVATE KEY$/)[0];
  if (p8) return p8;
  const p1 = pemBlocks(pem, /^RSA PRIVATE KEY$/)[0];
  if (p1) return seq(int(0), seq(oid(RSA_ENCRYPTION), NULL), octets(p1));
  throw new Error("no private key in PASS_KEY_PEM");
}

// ---- Configuration ----

export interface PassConfig {
  passTypeId: string;
  teamId: string;
  /** The Pass Type ID certificate and Apple's WWDR intermediate, DER. */
  cert: Uint8Array;
  wwdr: Uint8Array;
  /** PKCS#8 DER; never logged, never sent anywhere. */
  key: Uint8Array;
  organization: string;
}

export interface PassEnv { PASS_TYPE_ID?: string; TEAM_ID?: string; PASS_CERT_PEM?: string; PASS_KEY_PEM?: string; PASS_WWDR_PEM?: string; PASS_ORG_NAME?: string }

/** The pass configuration, only when every part is there and readable; otherwise null (and no pass is offered). */
export function passConfigFrom(env: PassEnv): PassConfig | null {
  const { PASS_TYPE_ID: id, TEAM_ID: team, PASS_CERT_PEM: c, PASS_KEY_PEM: k, PASS_WWDR_PEM: w } = env;
  if (!id || !team || !c || !k || !w) return null;
  if (!/^pass\.[A-Za-z0-9.-]{3,200}$/.test(id) || !/^[A-Z0-9]{10}$/.test(team)) return null;
  try {
    const cert = pemBlocks(c, /^CERTIFICATE$/)[0], wwdr = pemBlocks(w, /^CERTIFICATE$/)[0];
    if (!cert || !wwdr) return null;
    certIds(cert);
    certIds(wwdr);
    const key = pkcs8Of(k);
    readDer(key);
    return { passTypeId: id, teamId: team, cert, wwdr, key, organization: (env.PASS_ORG_NAME || "Purser").slice(0, 60) };
  } catch {
    return null;
  }
}

// ---- The signature ----

const OID_DATA = "1.2.840.113549.1.7.1", OID_SIGNED = "1.2.840.113549.1.7.2", OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_CT = "1.2.840.113549.1.9.3", OID_DIGEST = "1.2.840.113549.1.9.4", OID_TIME = "1.2.840.113549.1.9.5";

const digest = async (alg: "SHA-1" | "SHA-256", b: Uint8Array) => new Uint8Array(await crypto.subtle.digest(alg, b as BufferSource));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The signed attributes CMS signs: content type data, signing time, and the content's SHA-256. As a DER SET. */
export async function signedAttrs(content: Uint8Array, at: Date): Promise<Uint8Array> {
  return setOf(
    seq(oid(OID_CT), setOf(oid(OID_DATA))),
    seq(oid(OID_TIME), setOf(utcTime(at))),
    seq(oid(OID_DIGEST), setOf(octets(await digest("SHA-256", content)))),
  );
}

/** A detached PKCS#7 SignedData over `content`, RSA with SHA-256, carrying the signer's certificate and the WWDR one. */
export async function signDetached(content: Uint8Array, cfg: Pick<PassConfig, "cert" | "wwdr" | "key">, at: Date): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", cfg.key as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const attrs = await signedAttrs(content, at);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, attrs as BufferSource));
  const { issuer, serial } = certIds(cfg.cert);
  const sha256Alg = seq(oid(OID_SHA256));
  // In the SignerInfo the attributes are [0] IMPLICIT: the same bytes with the SET tag replaced.
  const implicitAttrs = cat(Uint8Array.of(0xa0), attrs.slice(1));
  const signerInfo = seq(int(1), seq(issuer, serial), sha256Alg, implicitAttrs, seq(oid(RSA_ENCRYPTION), NULL), octets(sig));
  const signedData = seq(int(1), setOf(sha256Alg), seq(oid(OID_DATA)), ctx(0, cfg.cert, cfg.wwdr), setOf(signerInfo));
  return seq(oid(OID_SIGNED), ctx(0, signedData));
}

// ---- Zip (stored, no compression: what Wallet reads) ----

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zipStored(files: [string, Uint8Array][], at: Date): Uint8Array {
  const le = (n: number, bytes: number) => { const a = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) a[i] = (n >>> (8 * i)) & 0xff; return a; };
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2);
  const date = ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = te.encode(name), crc = crc32(data);
    const common = cat(le(20, 2), le(0, 2), le(0, 2), le(time, 2), le(date, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(n.length, 2), le(0, 2));
    const local = cat(le(0x04034b50, 4), common, n, data);
    central.push(cat(le(0x02014b50, 4), le(20, 2), common, le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), n));
    locals.push(local);
    offset += local.length;
  }
  const cd = cat(...central);
  return cat(...locals, cd, le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.length, 2), le(files.length, 2), le(cd.length, 4), le(offset, 4), le(0, 2));
}

// ---- Images: plain PNGs made here (stored deflate blocks), the brand's two colours ----

function adler32(b: Uint8Array): number { let a = 1, s = 0; for (const x of b) { a = (a + x) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }
export function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 3)] = 0; for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (1 + w * 3) + 1 + x * 3); }
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)];
  for (let o = 0; o < raw.length || o === 0; o += 65535) {
    const part = raw.subarray(o, Math.min(raw.length, o + 65535)), last = o + 65535 >= raw.length;
    blocks.push(Uint8Array.of(last ? 1 : 0, part.length & 0xff, part.length >>> 8, ~part.length & 0xff, (~part.length >>> 8) & 0xff), part);
    if (last) break;
  }
  const be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const chunk = (type: string, data: Uint8Array) => { const td = cat(te.encode(type), data); return cat(be(data.length), td, be(crc32(td))); };
  const ihdr = cat(be(w), be(h), Uint8Array.of(8, 2, 0, 0, 0));
  return cat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", ihdr), chunk("IDAT", cat(...blocks, be(adler32(raw)))), chunk("IEND", new Uint8Array(0)));
}
const NAVY: [number, number, number] = [16, 24, 40], MINT: [number, number, number] = [56, 189, 148];
/** The mark: a navy square with a mint bar, as the console's. */
const mark = (s: number) => png(s, s, (x, y) => (x > s * 0.25 && x < s * 0.75 && y > s * 0.4 && y < s * 0.6 ? MINT : NAVY));
const logo = (w: number, h: number) => png(w, h, (x, y) => (x < h && y > h * 0.3 && y < h * 0.7 && x > h * 0.2 ? MINT : NAVY));

// ---- The pass ----

export interface AgentPassData {
  company: string;
  tenant: string;
  agent: string;
  name: string;
  role: string;
  card_last4: string | null;
  currency: string;
  per_purchase: string | null;
  per_month: string | null;
  status: "active" | "paused" | "revoked";
  /** The agent's payment token, when it has one: its id and status, never the token. */
  token?: { token_id: string; status: string; mandate_sha256: string } | null;
  /** Where the console shows this agent. */
  console_url: string;
}

const STATUS_WORDS = { active: "Active", paused: "Paused", revoked: "Revoked" } as const;

export function passJson(cfg: Pick<PassConfig, "passTypeId" | "teamId" | "organization">, d: AgentPassData, serial: string): Record<string, unknown> {
  const money = (v: string | null) => (v ? `${d.currency} ${v}` : "none");
  return {
    formatVersion: 1, passTypeIdentifier: cfg.passTypeId, teamIdentifier: cfg.teamId, serialNumber: serial,
    organizationName: cfg.organization, description: `${d.name}: the agent's card at ${d.company}`.slice(0, 120), logoText: "Purser",
    foregroundColor: "rgb(255, 255, 255)", backgroundColor: `rgb(${NAVY.join(", ")})`, labelColor: `rgb(${MINT.join(", ")})`,
    sharingProhibited: true, ...(d.status === "revoked" ? { voided: true } : {}),
    generic: {
      primaryFields: [{ key: "agent", label: "AGENT", value: d.name }],
      secondaryFields: [{ key: "per_purchase", label: "PER PURCHASE", value: money(d.per_purchase) }, { key: "per_month", label: "PER MONTH", value: money(d.per_month) }],
      auxiliaryFields: [{ key: "card", label: "CARD", value: d.card_last4 ? `•••• ${d.card_last4}` : "none" }, { key: "status", label: "STATUS", value: STATUS_WORDS[d.status] }],
      backFields: [
        { key: "what", label: "What this is", value: `${d.name} (${d.role}) pays for ${d.company} within the CFO's limits shown here. This pass shows the agent's card; it holds no card number and cannot pay.` },
        { key: "company", label: "Company", value: d.company },
        ...(d.token ? [{ key: "token", label: "Payment token", value: `${d.token.token_id} (${d.token.status}); bound to mandate ${d.token.mandate_sha256.slice(0, 16)}…` }] : []),
        { key: "money", label: "Money", value: "Test money only: an Airwallex sandbox card." },
        { key: "console", label: "In Purser Cloud", value: d.console_url },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: d.console_url, messageEncoding: "iso-8859-1", altText: "Open in Purser Cloud" }],
  };
}

/** The pass's serial number: stable for one company's agent and card, so a new pass replaces the old one in Wallet. */
export async function passSerial(d: Pick<AgentPassData, "tenant" | "agent" | "card_last4">): Promise<string> {
  return `purser-${hex(await digest("SHA-256", te.encode(`${d.tenant}|${d.agent}|${d.card_last4 ?? ""}`))).slice(0, 24)}`;
}

/** The files of the pass before it is signed: pass.json and its images. */
export async function passFiles(cfg: Pick<PassConfig, "passTypeId" | "teamId" | "organization">, d: AgentPassData): Promise<[string, Uint8Array][]> {
  return [
    ["pass.json", te.encode(JSON.stringify(passJson(cfg, d, await passSerial(d)), null, 2))],
    ["icon.png", mark(29)], ["icon@2x.png", mark(58)], ["icon@3x.png", mark(87)],
    ["logo.png", logo(160, 50)], ["logo@2x.png", logo(320, 100)],
  ];
}

/** manifest.json: each file's SHA-1, hex, as Wallet checks it. */
export async function manifestOf(files: [string, Uint8Array][]): Promise<Record<string, string>> {
  const m: Record<string, string> = {};
  for (const [name, data] of files) m[name] = hex(await digest("SHA-1", data));
  return m;
}

/** The whole .pkpass: the files, manifest.json, and the signature over the manifest. */
export async function buildPkpass(cfg: PassConfig, d: AgentPassData, at: Date): Promise<Uint8Array> {
  const files = await passFiles(cfg, d);
  const manifest = te.encode(JSON.stringify(await manifestOf(files)));
  const signature = await signDetached(manifest, cfg, at);
  return zipStored([...files, ["manifest.json", manifest], ["signature", signature]], at);
}

export const PKPASS_TYPE = "application/vnd.apple.pkpass";
