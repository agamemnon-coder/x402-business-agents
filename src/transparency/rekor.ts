// Sigstore's Rekor transparency log (https://docs.sigstore.dev/logging/overview/), the parts Purser uses: a hashedrekord
// v0.0.1 entry (a SHA-256, a signature over the artifact it is the digest of, and the public key that made it), sent to
// Rekor's REST API (POST /api/v1/log/entries), and the offline checks of what Rekor returns:
// - the signed entry timestamp (SET): Rekor's ECDSA P-256 signature over the canonical JSON (RFC 8785) of
//   {body, integratedTime, logID, logIndex}, the log's promise to include the entry;
// - the inclusion proof: the entry's leaf hash, SHA-256(0x00 || body), hashed with the proof's path up to the tree's
//   root (RFC 9162, 2.1.3.2), and that root and size in a checkpoint (a signed note) signed by the log's key.
// Everything here is a pure function of its inputs and the log's public key: no network. The client at the bottom is
// the one place that talks to a log, behind a port (RekorClient) so tests use a fake log.

import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";

export const REKOR_URL = "https://rekor.sigstore.dev";
/** The checkpoint origin of Rekor's public production log (its signed notes start "rekor.sigstore.dev - <tree id>"). */
export const REKOR_ORIGIN = "rekor.sigstore.dev";

export interface HashedRekordBody {
  apiVersion: "0.0.1";
  kind: "hashedrekord";
  spec: {
    data: { hash: { algorithm: "sha256"; value: string } };
    signature: { content: string; publicKey: { content: string } };
  };
}

export interface RekorInclusionProof { checkpoint: string; hashes: string[]; logIndex: number; rootHash: string; treeSize: number }

/** One log entry as Rekor returns it under its UUID. */
export interface RekorEntry {
  body: string;
  integratedTime: number;
  logID: string;
  logIndex: number;
  verification: { inclusionProof?: RekorInclusionProof; signedEntryTimestamp: string };
}

/** The log a check trusts: its public key (PEM) and the origin its checkpoints carry. */
export interface LogTrust { publicKeyPem: string; origin: string }

const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest();

/** The DER (SubjectPublicKeyInfo) of a public key in PEM; throws on anything else. */
export function spkiDer(pem: string): Buffer {
  return createPublicKey(pem).export({ type: "spki", format: "der" });
}

/** A log's or a signer's id: SHA-256 of its public key's DER, hex (Rekor's logID is this for its own key). */
export function keyId(pem: string): string {
  return sha256(spkiDer(pem)).toString("hex");
}

/** The hashedrekord v0.0.1 entry Purser proposes: the artifact's digest, its signature (DER, base64) and the public key (PEM). */
export function hashedRekord(artifactSha256: string, signatureB64: string, publicKeyPem: string): HashedRekordBody {
  if (!HEX64.test(artifactSha256)) throw new Error("the artifact digest is 64 hex digits");
  return {
    apiVersion: "0.0.1", kind: "hashedrekord",
    spec: {
      data: { hash: { algorithm: "sha256", value: artifactSha256 } },
      signature: { content: signatureB64, publicKey: { content: Buffer.from(publicKeyPem, "utf8").toString("base64") } },
    },
  };
}

/** An entry's body, decoded: a hashedrekord v0.0.1 with every field this code reads, or null. */
export function readBody(bodyB64: string): HashedRekordBody | null {
  let b: unknown;
  try { b = JSON.parse(Buffer.from(bodyB64, "base64").toString("utf8")); } catch { return null; }
  const x = b as Partial<HashedRekordBody> | null;
  const s = x?.spec;
  if (x?.kind !== "hashedrekord" || x.apiVersion !== "0.0.1" || s?.data?.hash?.algorithm !== "sha256" || typeof s.data.hash.value !== "string"
    || typeof s.signature?.content !== "string" || typeof s.signature.publicKey?.content !== "string") return null;
  return x as HashedRekordBody;
}

/** RFC 6962 leaf hash of an entry: SHA-256(0x00 || the body's bytes), hex. */
export function leafHash(bodyB64: string): string {
  return sha256(Buffer.concat([Buffer.from([0]), Buffer.from(bodyB64, "base64")])).toString("hex");
}

const nodeHash = (l: Buffer, r: Buffer) => sha256(Buffer.concat([Buffer.from([1]), l, r]));

/**
 * The root an inclusion proof leads to from a leaf (RFC 9162, 2.1.3.2), hex; null when the path does not fit the index
 * and size (too short, too long, or an index outside the tree).
 */
export function rootFromInclusion(leafHex: string, index: number, treeSize: number, hashes: string[]): string | null {
  if (!HEX64.test(leafHex) || !Number.isSafeInteger(index) || !Number.isSafeInteger(treeSize) || index < 0 || index >= treeSize || !hashes.every((h) => HEX64.test(h))) return null;
  let fn = BigInt(index), sn = BigInt(treeSize - 1), r = Buffer.from(leafHex, "hex");
  for (const h of hashes) {
    const p = Buffer.from(h, "hex");
    if (sn === 0n) return null;
    if ((fn & 1n) === 1n || fn === sn) {
      r = nodeHash(p, r);
      if ((fn & 1n) === 0n) while ((fn & 1n) === 0n && fn !== 0n) { fn >>= 1n; sn >>= 1n; }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1n; sn >>= 1n;
  }
  return sn === 0n ? r.toString("hex") : null;
}

/** The bytes Rekor signs for an entry's SET: the canonical JSON of {body, integratedTime, logID, logIndex}. */
export function setPayload(e: Pick<RekorEntry, "body" | "integratedTime" | "logID" | "logIndex">): Buffer {
  return Buffer.from(jcs({ body: e.body, integratedTime: e.integratedTime, logID: e.logID, logIndex: e.logIndex } as unknown as Json), "utf8");
}

const verifyEcdsa = (key: KeyObject, data: Buffer, sig: Buffer) => { try { return cryptoVerify("sha256", data, key, sig); } catch { return false; } };

/** Whether the entry's SET is the log's signature over its payload. */
export function verifySet(e: RekorEntry, log: LogTrust): boolean {
  const sig = Buffer.from(e.verification?.signedEntryTimestamp ?? "", "base64");
  return sig.length > 0 && verifyEcdsa(createPublicKey(log.publicKeyPem), setPayload(e), sig);
}

export interface Checkpoint { origin: string; treeSize: number; rootHash: string; body: string; signatures: { name: string; keyHint: string; sig: Buffer }[] }

/** A checkpoint (a signed note, https://github.com/transparency-dev/formats/blob/main/log/README.md) parsed; null when malformed. */
export function parseCheckpoint(text: string): Checkpoint | null {
  const split = text.indexOf("\n\n");
  if (split < 0) return null;
  const body = text.slice(0, split + 1);
  const [origin, size, root] = body.split("\n");
  if (!origin || !size || !/^\d+$/.test(size) || !root) return null;
  const rootBytes = Buffer.from(root, "base64");
  if (rootBytes.length !== 32 || rootBytes.toString("base64") !== root) return null;
  const signatures: Checkpoint["signatures"] = [];
  for (const line of text.slice(split + 2).split("\n")) {
    if (!line) continue;
    const m = /^— (\S+) ([A-Za-z0-9+/=]+)$/.exec(line);
    if (!m) return null;
    const raw = Buffer.from(m[2]!, "base64");
    if (raw.length < 5) return null;
    signatures.push({ name: m[1]!, keyHint: raw.subarray(0, 4).toString("hex"), sig: raw.subarray(4) });
  }
  return { origin, treeSize: Number(size), rootHash: rootBytes.toString("hex"), body, signatures };
}

/** Whether a checkpoint is signed by the log: its origin is the log's, and one signature line (key hint = the key id's first 4 bytes) verifies. */
export function verifyCheckpoint(cp: Checkpoint, log: LogTrust): boolean {
  if (cp.origin !== log.origin && !cp.origin.startsWith(`${log.origin} - `)) return false;
  const hint = keyId(log.publicKeyPem).slice(0, 8), key = createPublicKey(log.publicKeyPem);
  return cp.signatures.some((s) => s.name === log.origin && s.keyHint === hint && verifyEcdsa(key, Buffer.from(cp.body, "utf8"), s.sig));
}

/** Rekor, as a port: propose one entry and get it back as the log integrated it, with its proof. */
export interface RekorClient {
  url: string;
  createEntry(body: HashedRekordBody): Promise<{ uuid: string; entry: RekorEntry }>;
}

export class RekorError extends Error {}

/** Rekor's REST API (POST /api/v1/log/entries, GET /api/v1/log/entries/{uuid}). Errors carry the status only, never a body. */
export function httpRekor(url = REKOR_URL, fetcher: typeof fetch = fetch): RekorClient {
  const one = async (res: Response): Promise<{ uuid: string; entry: RekorEntry }> => {
    const body = (await res.json()) as Record<string, RekorEntry>;
    const keys = Object.keys(body);
    if (keys.length !== 1) throw new RekorError("the log answered with no single entry");
    return { uuid: keys[0]!, entry: body[keys[0]!]! };
  };
  const get = async (uuid: string) => {
    if (!/^[0-9a-f]{64,80}$/.test(uuid)) throw new RekorError("the log named no entry");
    const res = await fetcher(`${url}/api/v1/log/entries/${uuid}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new RekorError(`GET entry: HTTP ${res.status}`);
    return one(res);
  };
  return {
    url,
    async createEntry(b) {
      let res: Response;
      try {
        res = await fetcher(`${url}/api/v1/log/entries`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(b), signal: AbortSignal.timeout(30_000) });
      } catch { throw new RekorError("the log did not answer"); }
      // 409: the same entry is in the log already; its address is in Location.
      if (res.status === 409) return get((res.headers.get("location") ?? "").split("/").pop() ?? "");
      if (res.status !== 201) throw new RekorError(`POST entry: HTTP ${res.status}`);
      const created = await one(res);
      // An answer without its inclusion proof (older Rekor versions): read the entry back for it.
      return created.entry.verification?.inclusionProof ? created : get(created.uuid);
    },
  };
}
