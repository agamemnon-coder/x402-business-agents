// The demo world in Purser Cloud. Each built company (src/demoworld/build.ts) is loaded the way a runner's push lands:
// its batches come from the runner's own batchesFor and go through the cloud's own applySync, which checks every hash
// chain, every balance and every document's bytes. The vault's files are stored as documents (by their SHA-256) and
// the vault's own index as one object beside them.
//
// What this file adds to the engine's rows is a label, never a number: everything in the world was made with stand-in
// rails (no rail was called, no money moved), so every supplier, invoice and payment says `provenance: "stand-in"` and
// every transaction's rail name ends in "(stand-in)". Nothing here comes from a real sandbox run.
//
// The demo's companies hold no credential, no key and no invite: nobody can sign in to them, on any deployment.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureSchema } from "../../cloud/src/app.js";
import type { Blobs, Sql, SqlValue } from "../../cloud/src/store.js";
import { applySync, docBlobKey, SyncBatch, vaultIndexKey } from "../../cloud/src/sync.js";
import { TENANT_TABLES, TenantDb } from "../../cloud/src/tenant.js";
import { batchesFor } from "../cloudsync/client.js";
import { yearIndexPath } from "../vault/layout.js";
import { buildCompany, vaultIndex, WORLD_AS_OF, WORLD_START, WORLD_VERSION, type BuiltCompany } from "./build.js";
import { DEMO_COMPANIES, type CompanySpec } from "./companies.js";
import { fixed } from "./fixed.js";

/** How every row of the world was made: with stand-in rails. A row from a real sandbox run would say "sandbox". */
export const PROVENANCE = "stand-in";
export const STAND_IN_SUFFIX = " (stand-in)";
/** The world's one person: the test company's CFO, a role and not a name. No credential belongs to it. */
export const DEMO_OWNER = { id: "u_demo_cfo", display_name: "The CFO (test world)" };
/** The year the world's vault covers. */
export const VAULT_YEAR = 2026;

export interface LoadedCompany {
  slug: string;
  tenant_id: string;
  name: string;
  /** The invoice that shows each state a visitor should see, by its id in the cloud. */
  states: BuiltCompany["states"];
  counts: { invoices: number; documents: number; vault_files: number; ledger_entries: number; audit_rows: number; transactions: number };
}

/** Builds the three companies, each in its own folder under `dir`. */
export async function buildWorld(dir: string, specs: CompanySpec[] = DEMO_COMPANIES): Promise<BuiltCompany[]> {
  const out: BuiltCompany[] = [];
  for (const spec of specs) out.push(await buildCompany(spec, join(dir, spec.slug)));
  return out;
}

const labelled = <T extends { body: Record<string, unknown> }>(rows: T[] | undefined): T[] => (rows ?? []).map((r) => ({ ...r, body: { ...r.body, provenance: PROVENANCE } }));

/** Loads one built company into the cloud's storage, as a push of its runner would. The company must not exist yet. */
export async function loadCompany(sql: Sql, blobs: Blobs, c: BuiltCompany): Promise<LoadedCompany> {
  return fixed(`purser demo world v${WORLD_VERSION}: load ${c.spec.slug}`, c.as_of, async (clock) => {
    const now = clock.now();
    const { spec } = c;
    await ensureSchema(sql);
    await sql.run("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, ?, ?, 'en', ?)", [spec.tenantId, spec.slug, spec.name, WORLD_START]);
    const db = new TenantDb(sql, spec.tenantId);
    await db.apply([db.insert("users", { id: DEMO_OWNER.id, display_name: DEMO_OWNER.display_name, email: null, role: "owner", created_at: WORLD_START })]);

    // The runner's own batches, from an empty cloud: documents first, then the rows and both chains.
    for (const raw of batchesFor(c.db, { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] }, { now })) {
      const b = raw as { vendors?: { body: Record<string, unknown> }[]; invoices?: { body: Record<string, unknown> }[]; payments?: { body: Record<string, unknown> }[]; transactions?: { body: Record<string, unknown> }[] };
      const batch = {
        ...raw,
        ...(b.vendors ? { vendors: labelled(b.vendors) } : {}),
        ...(b.invoices ? { invoices: labelled(b.invoices) } : {}),
        ...(b.payments ? { payments: labelled(b.payments) } : {}),
        ...(b.transactions ? { transactions: b.transactions.map((t) => ({ ...t, body: { ...t.body, rail_label: `${String(t.body.rail_label)}${STAND_IN_SUFFIX}` } })) } : {}),
      };
      await applySync(db, blobs, SyncBatch.parse(batch), now);
    }

    // The vault: every filed PDF as a document (the supplier's own PDFs are there already), and the index beside them.
    const index = await vaultIndex(c);
    const held = new Set((await db.select<{ sha256: string }>("documents")).map((d) => d.sha256));
    const fresh = index.files.filter((f) => !held.has(f.sha256) && held.add(f.sha256));
    for (let i = 0; i < fresh.length; i += 20) {
      const documents = fresh.slice(i, i + 20).map((f) => ({ sha256: f.sha256, filename: basename(f.path), mime: "application/pdf", base64: readFileSync(join(c.vaultDir, f.path)).toString("base64") }));
      await applySync(db, blobs, SyncBatch.parse({ documents }), now);
    }
    await blobs.put(vaultIndexKey(spec.tenantId, VAULT_YEAR), new Uint8Array(readFileSync(join(c.vaultDir, yearIndexPath(spec.name, VAULT_YEAR)))), { kind: "vault-index" });

    return {
      slug: spec.slug, tenant_id: spec.tenantId, name: spec.name, states: c.states,
      counts: {
        invoices: await db.count("invoices"), documents: await db.count("documents"), vault_files: index.files.length,
        ledger_entries: await db.count("ledger_entries"), audit_rows: await db.count("audit_rows"), transactions: await db.count("transactions"),
      },
    };
  });
}

/** Builds the world in `dir` and loads it: the local mode, for tests and the console check (no file leaves `dir`). */
export async function seedWorld(sql: Sql, blobs: Blobs, dir: string, specs: CompanySpec[] = DEMO_COMPANIES): Promise<{ built: BuiltCompany[]; loaded: LoadedCompany[] }> {
  const built = await buildWorld(dir, specs);
  const loaded: LoadedCompany[] = [];
  for (const c of built) loaded.push(await loadCompany(sql, blobs, c));
  return { built, loaded };
}

const literal = (v: SqlValue): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

/**
 * The world's rows as SQL for `wrangler d1 execute --file`: first every row of these companies is removed (so seeding
 * again replaces the world), then every row is inserted, table by table, in the order it was written. One statement
 * per line; no transaction statements (D1 refuses them in a file). The schema is not in here: the database must hold
 * cloud/migrations/0001_init.sql first.
 */
export async function worldSql(sql: Sql, tenantIds: string[]): Promise<string> {
  if (tenantIds.some((t) => !/^t_demo_[a-z0-9_]+$/.test(t))) throw new Error("only the demo world's own companies (t_demo_…) are written as SQL");
  const ids = tenantIds.map(literal).join(", ");
  const out: string[] = [
    `-- Purser Cloud demo world v${WORLD_VERSION}, as of ${WORLD_AS_OF}: test companies, stand-in rails, no real money.`,
    "-- Made by npm run cloud:seed-demo. Load into the demo deployment's own database only.",
  ];
  for (const table of [...TENANT_TABLES].reverse()) out.push(`DELETE FROM ${table} WHERE tenant_id IN (${ids});`);
  out.push(`DELETE FROM tenants WHERE id IN (${ids});`);
  const insert = async (table: string, where: string) => {
    for (const id of tenantIds) {
      for (const row of await sql.all<Record<string, SqlValue>>(`SELECT * FROM ${table} WHERE ${where} = ? ORDER BY rowid`, [id])) {
        const cols = Object.keys(row);
        out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((k) => literal(row[k]!)).join(", ")});`);
      }
    }
  };
  await insert("tenants", "id");
  for (const table of TENANT_TABLES) await insert(table, "tenant_id");
  return `${out.join("\n")}\n`;
}

/** Every stored object of these companies, by its key, with the content type the document store should keep. */
export async function worldObjects(sql: Sql, blobs: Blobs, tenantIds: string[]): Promise<{ key: string; bytes: Uint8Array; content_type: string }[]> {
  const out: { key: string; bytes: Uint8Array; content_type: string }[] = [];
  for (const id of tenantIds) {
    const mime = new Map((await sql.all<{ sha256: string; mime: string }>("SELECT sha256, mime FROM documents WHERE tenant_id = ?", [id])).map((d) => [docBlobKey(id, d.sha256), d.mime]));
    for (const key of await blobs.list(`t/${id}/`)) {
      const bytes = await blobs.get(key);
      if (!bytes) throw new Error(`${key} is listed but holds nothing`);
      out.push({ key, bytes, content_type: mime.get(key) ?? (key.endsWith(".json") ? "application/json" : "application/octet-stream") });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
