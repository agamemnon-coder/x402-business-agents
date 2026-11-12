// The vault in the cloud: the year's index the vault wrote (src/vault/build.ts YearIndex), kept as one object per year
// beside the documents (vaultIndexKey). Every file in it is a document of the company under its SHA-256, so
// GET /v1/documents/{sha256} serves its bytes. The index is checked against the vault's own shape before it is shown:
// a file with no proper hash is never put on a page.

import { z } from "zod";
import { BadRequest } from "./read.js";
import type { Blobs } from "./store.js";
import { vaultIndexKey } from "./sync.js";
import type { TenantDb } from "./tenant.js";

const KINDS = ["invoice", "receipt", "month", "vat", "year", "suppliers"] as const;

const YearIndex = z.object({
  company: z.string().max(400),
  year: z.number().int().min(1900).max(9999),
  note: z.string().max(2000),
  files: z.array(z.object({
    path: z.string().min(1).max(1000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().min(0),
    kind: z.enum(KINDS),
    key: z.string().max(400),
    data_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    added_at: z.string().max(40),
  })).max(20_000),
});

export class VaultNotFound extends Error {}

export interface VaultFile { path: string; sha256: string; bytes: number; kind: (typeof KINDS)[number]; key: string; added_at: string; stored: boolean }
export interface VaultView { years: number[]; year: number | null; company: string | null; note: string | null; files: VaultFile[] }

/** The years the company has an index for, newest first. */
async function yearsOf(blobs: Blobs, tenantId: string): Promise<number[]> {
  const prefix = vaultIndexKey(tenantId, 0).replace(/0\/index\.json$/, "");
  const years = (await blobs.list(prefix)).map((k) => /^(\d{4})\/index\.json$/.exec(k.slice(prefix.length))?.[1]).filter((y): y is string => !!y).map(Number);
  return [...new Set(years)].sort((a, b) => b - a);
}

/** GET /v1/vault?year=YYYY: the year's index (the newest by default), each file marked whether the cloud holds it. */
export async function vaultView(db: TenantDb, blobs: Blobs, q: URLSearchParams): Promise<VaultView> {
  const asked = q.get("year");
  if (asked !== null && !/^\d{4}$/.test(asked)) throw new BadRequest("year is a year like 2026");
  const years = await yearsOf(blobs, db.tenantId);
  const year = asked !== null ? Number(asked) : years[0] ?? null;
  if (year === null) return { years, year: null, company: null, note: null, files: [] };
  const bytes = years.includes(year) ? await blobs.get(vaultIndexKey(db.tenantId, year)) : null;
  if (!bytes) throw new VaultNotFound(`no vault index for ${year}`);
  const index = YearIndex.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const held = new Set((await db.select<{ sha256: string }>("documents", {}, { order: ["sha256"] })).map((d) => d.sha256));
  const files = index.files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes, kind: f.kind, key: f.key, added_at: f.added_at, stored: held.has(f.sha256) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { years, year, company: index.company, note: index.note, files };
}
