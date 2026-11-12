// npm run cloud:seed-demo -- --out <folder outside the repository>
//
// Builds Purser Cloud's demo world (three test companies, src/demoworld) offline with the real engine and writes it as
// a bundle for a demo deployment: seed.sql (wrangler d1 execute), r2/ and r2-put.sh (wrangler r2 object put) and
// manifest.json. It calls no network, no rail and no model, reads no key, and loads nothing anywhere: loading the
// bundle is two commands a person runs (printed at the end; docs/cloud.md).
//
// The same world, same bytes, on every run: the clock and all randomness are fixed.

import { resolve } from "node:path";
import { bundleFolder, writeBundle } from "../demoworld/bundle.js";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = at >= 0 ? args[at + 1] : undefined;
if (!out || args.length !== 2) {
  console.error("usage: npm run cloud:seed-demo -- --out <folder outside the repository>");
  process.exit(1);
}

// The bundle holds generated data: it never goes into the repository (so it can never be committed by accident).
let target: string;
try {
  target = bundleFolder(out);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const m = await writeBundle(target);
console.log(`Purser Cloud demo world v${m.world_version}, as of ${m.as_of}: written to ${target}`);
for (const c of m.companies) console.log(`  ${c.slug.padEnd(24)} ${c.name}: ${c.counts.invoices} invoices, ${c.counts.documents} documents, ${c.counts.ledger_entries} ledger entries, ${c.counts.audit_rows} audit rows`);
console.log(`  seed.sql: ${m.sql.statements} statements, sha256 ${m.sql.sha256}`);
console.log(`  r2/: ${m.objects.length} objects`);
console.log("");
console.log("To load it into the demo deployment (its own database and bucket only; run from the repository root, wrangler signed in; docs/cloud-demo.md):");
console.log(`  npx wrangler d1 migrations apply purser-demo --env demo --remote -c cloud/wrangler.jsonc`);
console.log(`  npx wrangler d1 execute purser-demo --env demo --remote --file ${resolve(target, "seed.sql")} -c cloud/wrangler.jsonc`);
console.log(`  (cd ${target} && sh r2-put.sh purser-demo-docs)`);
console.log(`The demo environment in cloud/wrangler.jsonc sets DEMO_PUBLIC=on and DEMO_SLUGS=${m.demo_slugs}.`);
