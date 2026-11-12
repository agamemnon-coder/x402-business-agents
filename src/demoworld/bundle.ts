// The demo world as files for a deployment that has no sign-in (so nothing can be pushed to it): the rows as SQL for
// `wrangler d1 execute --file`, every stored object under its own key for `wrangler r2 object put`, a script with those
// commands, and a manifest that says what is in the bundle. The world is first built and loaded into a local database
// through the cloud's own code (src/demoworld/cloud.ts); what is written here is a copy of that, row for row.
//
// Also the local mode: the same world in the cloud's own request handler on this machine, for tests and browser checks.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CloudEnv } from "../../cloud/src/app.js";
import { demoEnv } from "../../cloud/src/demo.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { CLOSED_MONTH, DEMO_ORIGIN, DEMO_RP_ID, WORLD_AS_OF, WORLD_VERSION, type BuiltCompany } from "./build.js";
import { PROVENANCE, seedWorld, worldObjects, worldSql, type LoadedCompany } from "./cloud.js";
import { DEMO_COMPANIES, type CompanySpec } from "./companies.js";
import { TEST_PASSKEY_LABEL } from "./passkey.js";

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export interface LocalDemo {
  /** The cloud's environment in demo mode, over the seeded world: pass it to `handle`. */
  env: CloudEnv & { sql: ReturnType<typeof sqliteSql> };
  companies: LoadedCompany[];
  /** Each company's own runner ledger and vault, as the engine left them (for checks against the cloud's copy). */
  built: BuiltCompany[];
  close(): void;
}

/**
 * The local mode: the world built under `dir`, loaded into an in-memory database and a folder, and the cloud's
 * environment switched to demo mode over it. Nothing leaves this machine. `origin` is where a local server serves it.
 */
export async function localDemo(dir: string, o: { origin?: string; specs?: CompanySpec[]; rate?: { perMinute?: number; uncachedPerMinute?: number } } = {}): Promise<LocalDemo> {
  const specs = o.specs ?? DEMO_COMPANIES;
  const sql = sqliteSql(":memory:");
  const blobs = dirBlobs(join(dir, "blobs"));
  const { built, loaded } = await seedWorld(sql, blobs, join(dir, "build"), specs);
  const origin = o.origin ?? DEMO_ORIGIN;
  // Demo mode needs no secret: nothing signs in. The two values below are never used for anything.
  const env = { sql, blobs, sessionSecret: "", adminTokenSha256: "", rpId: new URL(origin).hostname || DEMO_RP_ID, origin, demo: demoEnv(specs.map((s) => s.slug), o.rate ?? {}) };
  return { env, companies: loaded, built, close: () => { for (const c of built) c.db.close(); sql.close(); } };
}

export interface BundleManifest {
  format: "purser-cloud-demo-world/v1";
  world_version: string;
  as_of: string;
  closed_month: string;
  note: string;
  provenance: string;
  approved_with: string;
  demo_slugs: string;
  sql: { file: string; sha256: string; statements: number; bytes: number };
  objects: { key: string; file: string; sha256: string; bytes: number; content_type: string }[];
  companies: LoadedCompany[];
}

/** The path with every link resolved, also when its last parts do not exist yet. */
function real(p: string): string {
  let head = resolve(p);
  const tail: string[] = [];
  while (!existsSync(head)) { tail.unshift(basename(head)); head = dirname(head); }
  return join(realpathSync(head), ...tail);
}

/**
 * Where a bundle may be written: anywhere but inside this repository. The bundle is generated data; outside the
 * repository it can never be committed by accident. Returns the resolved folder, or throws.
 */
export function bundleFolder(out: string): string {
  const repo = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const target = real(out);
  if (target === repo || target.startsWith(repo + sep)) throw new Error(`${target} is inside the repository: choose a folder outside it (the bundle is generated data, never committed)`);
  return target;
}

/** Safe inside single quotes in a POSIX shell. */
const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Builds the world and writes the bundle into `out` (made if missing; an earlier bundle there is replaced):
 *   seed.sql        the rows, for wrangler d1 execute
 *   r2/<key>        every object under its key
 *   r2-put.sh       one wrangler r2 object put per object
 *   manifest.json   what is in the bundle, with every hash
 * The build's working files (the suppliers' PDFs, the vault tree) are removed again; no ledger file is ever written.
 */
export async function writeBundle(folder: string, specs: CompanySpec[] = DEMO_COMPANIES): Promise<BundleManifest> {
  const out = bundleFolder(folder);
  mkdirSync(out, { recursive: true });
  for (const name of ["seed.sql", "r2", "r2-put.sh", "manifest.json", "work"]) rmSync(join(out, name), { recursive: true, force: true });
  const work = join(out, "work");
  const local = await localDemo(work, { specs });
  try {
    const ids = local.companies.map((c) => c.tenant_id);
    const sqlText = await worldSql(local.env.sql, ids);
    writeFileSync(join(out, "seed.sql"), sqlText);
    const objects: BundleManifest["objects"] = [];
    const lines = [
      "#!/bin/sh",
      "# Puts the demo world's objects into the demo deployment's own R2 bucket. Made by npm run cloud:seed-demo.",
      "# usage: sh r2-put.sh <bucket> [more wrangler flags, for example: --jurisdiction eu -c cloud/wrangler.jsonc -e demo]",
      "# Run it from the folder that holds this file, with wrangler signed in (it reads no key from this folder).",
      "set -eu",
      'BUCKET="$1"; shift',
      'W="${WRANGLER:-npx wrangler}"',
    ];
    for (const o of await worldObjects(local.env.sql, local.env.blobs, ids)) {
      const file = join("r2", o.key);
      mkdirSync(dirname(join(out, file)), { recursive: true });
      writeFileSync(join(out, file), o.bytes);
      objects.push({ key: o.key, file, sha256: sha256(o.bytes), bytes: o.bytes.length, content_type: o.content_type });
      lines.push(`$W r2 object put "$BUCKET"/${quoted(o.key)} --file ${quoted(file)} --content-type ${quoted(o.content_type)} --remote "$@"`);
    }
    lines.push(`echo "${objects.length} objects put into $BUCKET"`);
    writeFileSync(join(out, "r2-put.sh"), `${lines.join("\n")}\n`, { mode: 0o755 });
    const manifest: BundleManifest = {
      format: "purser-cloud-demo-world/v1", world_version: WORLD_VERSION, as_of: WORLD_AS_OF, closed_month: CLOSED_MONTH,
      note: "Test companies and test money: no real company, no real person, no real account and no real money. Built offline by Purser's own engine; no rail and no model was called.",
      provenance: PROVENANCE, approved_with: TEST_PASSKEY_LABEL, demo_slugs: specs.map((s) => s.slug).join(","),
      sql: { file: "seed.sql", sha256: sha256(sqlText), statements: sqlText.split("\n").filter((l) => /^(INSERT|DELETE) /.test(l)).length, bytes: Buffer.byteLength(sqlText) },
      objects, companies: local.companies,
    };
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    local.close();
    rmSync(work, { recursive: true, force: true });
  }
}
