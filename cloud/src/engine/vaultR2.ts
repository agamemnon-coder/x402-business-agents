// A company's archive in the cloud's document store (R2 in the Worker, a directory in tests): the vault's sink
// (src/vault/sink.ts) over Blobs, under the company's own prefix t/<tenant>/vault/. A file is created once and never
// replaced; the one thing rewritten is a year's index.json, as with every sink.
//
// The vault's paths are made for people (a supplier's name, spaces, any script); a key keeps letters, digits, dots and
// dashes of each path segment and writes every other byte as _xx (hex), so two paths never share a key and no key can
// leave the prefix. A very long name in a script of many bytes can pass the store's key length: the store then refuses
// that file, and the engine reports it (Settled.error).
import { createHash } from "node:crypto";
import type { VaultSink } from "../../../src/vault/sink.js";
import type { Blobs } from "../store.js";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const KEPT = /[A-Za-z0-9.-]/;

function segmentKey(segment: string): string {
  if (!segment || segment === "." || segment === "..") throw new Error("not a path in the vault");
  let out = "";
  for (const byte of new TextEncoder().encode(segment)) {
    const ch = String.fromCharCode(byte);
    // A dot after a dot is written as hex too: no key ever holds "..".
    out += byte < 0x80 && KEPT.test(ch) && !(ch === "." && out.endsWith(".")) ? ch : `_${byte.toString(16).padStart(2, "0")}`;
  }
  return out;
}

/** The key of a vault path under the company's prefix. */
export const vaultKey = (tenantId: string, path: string): string => `t/${tenantId}/vault/${path.split("/").map(segmentKey).join("/")}`;

export function blobVault(blobs: Blobs, tenantId: string): VaultSink {
  if (!/^t_[A-Za-z0-9_-]{6,64}$/.test(tenantId)) throw new Error("a vault is one company's: a well-formed company id is needed");
  const key = (path: string) => vaultKey(tenantId, path);
  const read = async (path: string) => { const b = await blobs.get(key(path)); return b ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : null; };
  return {
    name: "cloud",
    stat: async (path) => { const b = await blobs.get(key(path)); return b ? { sha256: sha256(b), bytes: b.byteLength } : null; },
    create: async (path, bytes, hash, mime) => {
      if (sha256(bytes) !== hash) throw new Error(`${path}: the bytes do not match their hash`);
      if (blobs.has ? await blobs.has(key(path)) : (await blobs.get(key(path))) !== null) throw new Error(`${path} is already in the vault`);
      await blobs.put(key(path), bytes, { sha256: hash, mime: mime ?? "application/pdf" });
    },
    readIndex: async (path) => { const b = await blobs.get(key(path)); return b ? new TextDecoder().decode(b) : null; },
    writeIndex: async (path, text) => { await blobs.put(key(path), new TextEncoder().encode(text), { mime: "application/json" }); },
    read,
  };
}
