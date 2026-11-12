// npm run reconcile-books -- --books <exact|bc|odoo|moneybird|t0> [--json]: sets Purser's books next to the outside
// books, per document (src/accounting/reconcileBooks.ts, docs/reconcile-books.md). It only reads the outside books,
// and only when a person runs it with that system's settings; without them it says which setting is missing (never a
// value) and keeps nothing. The result is kept as one audit row (books.reconciled). Exit code: 0 the books agree,
// 1 they differ, 2 not everything could be compared, or it could not run.

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { books as glBooks } from "../accounting/books.js";
import { purserDocs, readConnector, readT0, reconcileBooks, reconciliationLines, recordReconciliation, scrub, type ReadsBack, type Reconciliation, type T0Reader } from "../accounting/reconcileBooks.js";
import { T0Client } from "../accounting/t0.js";
import { ratesFromEnv } from "../accounting/t0Sink.js";
import { T0_SANDBOX_MAP } from "../config/t0Map.js";
import type { DB } from "../db/open.js";
import { CONNECTOR_NAMES, type ConnectorName, type ErpConnector } from "../erp/connector.js";
import { liveConnector, missingSettings, SETTINGS } from "../erp/registry.js";
import { ledgerItems } from "../erp/source.js";
import { redactSecrets } from "../lib/redact.js";

const USAGE = "usage: npm run reconcile-books -- --books exact|bc|odoo|moneybird|t0 [--json]";

export interface ReconcileBooksDeps {
  db: DB;
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  /** A connector (tests pass a stand-in); else the live one from the settings. */
  connector?: (name: ConnectorName) => ErpConnector & ReadsBack;
  /** A T:0 client (tests pass one on a stand-in); else one from T0_API_KEY, T0_BASE_URL and T0_ENTITY. */
  t0?: T0Reader;
  now?: () => Date;
}

const notCompared = (d: ReconcileBooksDeps, why: string) => {
  d.out(`Not compared: ${why}. Nothing was kept.`);
  return 2;
};

export async function runReconcileBooks(args: string[], d: ReconcileBooksDeps): Promise<number> {
  let values: { books?: string; json?: boolean };
  try {
    ({ values } = parseArgs({ args, options: { books: { type: "string" }, json: { type: "boolean" } }, allowPositionals: false, strict: true }));
  } catch {
    d.out(USAGE);
    return 2;
  }
  const which = values.books ?? "";
  if (which !== "t0" && !(CONNECTOR_NAMES as readonly string[]).includes(which)) {
    d.out(USAGE);
    return 2;
  }
  const items = ledgerItems(d.db);
  const ours = purserDocs(items);
  // The outside books' own credentials, never written out even when a failure quotes them.
  const secrets = [d.env.T0_API_KEY, ...CONNECTOR_NAMES.flatMap((n) => SETTINGS[n].secrets.map((k) => d.env[k]))];
  let r: Reconciliation;
  try {
    if (which === "t0") {
      const key = d.env.T0_API_KEY?.trim();
      if (!d.t0 && !key) return notCompared(d, "T0_API_KEY is not set");
      const rate = ratesFromEnv(d.env.T0_RATES);
      if (typeof rate === "string") return notCompared(d, rate);
      const client = d.t0 ?? new T0Client({ apiKey: key!, baseUrl: d.env.T0_BASE_URL || undefined, entity: d.env.T0_ENTITY || undefined });
      const t = await readT0(client, glBooks(d.db).postings, ours, { rate, ...(d.env.T0_MAP === "sandbox" ? { fallback: T0_SANDBOX_MAP } : {}) });
      r = reconcileBooks("T:0", ours, t.docs, { compared: t.compared, checks: t.checks, limits: t.limits });
    } else {
      const name = which as ConnectorName;
      if (!d.connector) {
        const missing = missingSettings(name, d.env);
        if (missing.length) return notCompared(d, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
      }
      const c = d.connector ? d.connector(name) : liveConnector(name, d.env);
      const x = await readConnector(d.db, c, items, { secrets });
      r = reconcileBooks(SETTINGS[name].label, ours, x.docs, { compared: x.compared, limits: x.limits });
    }
  } catch (e) {
    return notCompared(d, `the outside books could not be read: ${scrub((e as Error)?.message ?? String(e), secrets).slice(0, 300)}`);
  }
  recordReconciliation(d.db, r, (d.now ?? (() => new Date()))());
  for (const l of reconciliationLines(r)) d.out(l);
  if (values.json) d.out(JSON.stringify(r, null, 2));
  return r.verdict === "agree" ? 0 : r.verdict === "differ" ? 1 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openDb } = await import("../db/open.js");
  runReconcileBooks(process.argv.slice(2), { db: openDb(), env: process.env, out: (l) => console.log(l) }).then(
    (code) => process.exit(code),
    (e: unknown) => { console.error(redactSecrets((e as Error).message)); process.exit(2); },
  );
}
