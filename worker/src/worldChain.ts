// /try/sign, 6c: a hash chain per test world. Every event in a world (the world opened, an agent's step, a proposal, a
// signature, a refusal, an execution, a policy change) appends one row {seq, at, kind, data_sha256, prev, hash}:
// data_sha256 is the SHA-256 of the event's data as canonical JSON, prev is the row before's hash (64 zeros for the
// first), and hash is the SHA-256 of the canonical JSON of the row without its hash. So each row covers the one before,
// and changing any row, its data, or their order breaks every hash after it.
//
// The chain lives with the world in the Durable Object's own table (ts_chain), and goes with it. The row is written in
// the same synchronous stretch as the event it records (no await between them), so its SHA-256 is computed here, in
// plain code, not with crypto.subtle (which is asynchronous). The page recomputes the chain in the browser
// ("Verify the chain") and the receipt carries it, checked offline by src/try/receipt.ts and /try/verify.

/** The event kinds a world's chain records. */
export const CHAIN_KINDS = ["world_opened", "agent_step", "proposal", "signature", "refusal", "execution", "policy_change"] as const;
export type ChainKind = (typeof CHAIN_KINDS)[number];
/** The prev of the first row. */
export const CHAIN_GENESIS = "0".repeat(64);
/** At most this many rows a world (a visit makes a few dozen; the per-address limits bound the rest); past it, none more. */
export const CHAIN_MAX_ROWS = 400;

export interface ChainRow { seq: number; at: string; kind: ChainKind; data_sha256: string; prev: string; hash: string }
/** A data value: canonical JSON without numbers, as the terms (money is a decimal string). */
export type ChainData = string | boolean | null | ChainData[] | { [k: string]: ChainData };

/** Canonical JSON (RFC 8785) of the data, which carries no numbers (as the terms). */
export function canonicalData(v: ChainData): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalData).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalData(v[k]!)}`).join(",")}}`;
  throw new Error("chain data carries no numbers");
}
/** Canonical JSON (RFC 8785) of a row without its hash: keys sorted, seq a whole number, the rest strings. */
export function canonicalRow(r: Omit<ChainRow, "hash">): string {
  if (!Number.isSafeInteger(r.seq) || r.seq < 1) throw new Error("seq is a whole number from 1");
  return `{"at":${JSON.stringify(r.at)},"data_sha256":${JSON.stringify(r.data_sha256)},"kind":${JSON.stringify(r.kind)},"prev":${JSON.stringify(r.prev)},"seq":${r.seq}}`;
}

// ── SHA-256 (FIPS 180-4), synchronous, over UTF-8 ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
/** The SHA-256 of a string's UTF-8 bytes, in hex. */
export function sha256HexSync(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bits = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + k) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** The row that follows `last` (or the first one) for this event. Pure. */
export function nextRow(last: Pick<ChainRow, "seq" | "hash"> | null, at: string, kind: ChainKind, data: ChainData): ChainRow {
  const row = { seq: (last?.seq ?? 0) + 1, at, kind, data_sha256: sha256HexSync(canonicalData(data)), prev: last?.hash ?? CHAIN_GENESIS };
  return { ...row, hash: sha256HexSync(canonicalRow(row)) };
}

/** A chain checked from its first row: each hash recomputed, each prev the row before's, seq counting from 1. Never throws. */
export function checkChain(rows: unknown): { ok: boolean; length: number; head: string | null; bad: number | null; why: string | null } {
  if (!Array.isArray(rows)) return { ok: false, length: 0, head: null, bad: null, why: "not a list of rows" };
  let prev = CHAIN_GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Partial<ChainRow>;
    const fail = (why: string) => ({ ok: false, length: rows.length, head: null, bad: i + 1, why: `row ${i + 1}: ${why}` });
    if (typeof r !== "object" || r === null || r.seq !== i + 1 || typeof r.at !== "string" || typeof r.kind !== "string" || !(CHAIN_KINDS as readonly string[]).includes(r.kind)
      || typeof r.data_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.data_sha256) || typeof r.hash !== "string") return fail("not a chain row");
    if (r.prev !== prev) return fail("its prev is not the hash of the row before");
    const h = sha256HexSync(canonicalRow({ seq: r.seq, at: r.at, kind: r.kind as ChainKind, data_sha256: r.data_sha256, prev: r.prev }));
    if (h !== r.hash) return fail("its hash is not the SHA-256 of the row");
    prev = r.hash;
  }
  return { ok: true, length: rows.length, head: rows.length ? prev : null, bad: null, why: null };
}
