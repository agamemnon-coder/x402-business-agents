// Where the vault is written. One small interface, so the same tree goes to a local folder or to a customer's Google
// Drive or OneDrive (gdrive.ts, onedrive.ts). A sink to the cloud's own store (R2; the cloud is in cloud/) is not built
// yet (docs/vault.md, "Not done yet"). A sink creates a file once and never replaces it; the one file it may rewrite
// is a year's index.json, which lists everything.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

export interface VaultSink {
  readonly name: string;
  /** null when the file is not there; sha256 null when the store cannot tell its hash. */
  stat(path: string): Promise<{ sha256: string | null; bytes: number | null } | null>;
  /** Creates the file; refuses when something is already there. */
  create(path: string, bytes: Buffer, sha256: string, mime?: string): Promise<void>;
  readIndex(path: string): Promise<string | null>;
  /** The one rewrite a sink allows: a year's index.json. */
  writeIndex(path: string, text: string): Promise<void>;
  /** The file's bytes, where the store can return them (verify uses it). */
  read?(path: string): Promise<Buffer | null>;
}

export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** A folder on this machine (default data/vault): files written once and made read-only. */
export class LocalSink implements VaultSink {
  readonly name = "local";
  private readonly root: string;
  constructor(root = process.env.KIT11_VAULT_DIR ?? "data/vault") { this.root = resolve(root); }

  private abs(path: string): string {
    const p = resolve(this.root, path);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`${path} is outside the vault`);
    return p;
  }

  // Async so that every refusal (a path outside the vault, a file already there) is a rejected promise.
  async stat(path: string): Promise<{ sha256: string | null; bytes: number | null } | null> {
    const p = this.abs(path);
    if (!existsSync(p)) return null;
    const b = readFileSync(p);
    return { sha256: sha256(b), bytes: b.length };
  }

  async create(path: string, bytes: Buffer, hash: string): Promise<void> {
    const p = this.abs(path);
    if (sha256(bytes) !== hash) throw new Error(`${path}: the bytes do not match their hash`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes, { flag: "wx" });
    chmodSync(p, 0o444);
  }

  async readIndex(path: string): Promise<string | null> {
    const p = this.abs(path);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }

  async writeIndex(path: string, text: string): Promise<void> {
    const p = this.abs(path);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, p);
  }

  async read(path: string): Promise<Buffer | null> {
    const p = this.abs(path);
    return existsSync(p) ? readFileSync(p) : null;
  }
}
