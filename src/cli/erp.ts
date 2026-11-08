// npm run erp: sync Purser with a company's ERP (Exact Online, Business Central, Odoo). See src/erp/cli.ts and docs/erp.md.

import { openDb } from "../db/open.js";
import { runErpCli } from "../erp/cli.js";

runErpCli(process.argv.slice(2), { db: openDb(), env: process.env, out: (l) => console.log(l) }).then(
  (code) => process.exit(code),
  (e: unknown) => { console.error((e as Error).message); process.exit(1); },
);
