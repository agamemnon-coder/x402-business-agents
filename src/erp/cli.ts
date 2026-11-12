// npm run erp -- list                                   the connectors and which settings each still needs (names only)
// npm run erp -- status [--connector exact|bc|odoo|moneybird]     what was sent, what failed, what needs a correction
// npm run erp -- sync --connector exact --dry-run       the requests a sync would send, redacted; nothing is sent
// npm run erp -- sync --connector exact --live          send what changed (needs the connector's settings)
// npm run erp -- pull --connector exact --live          read the ERP's chart of accounts and suppliers
// npm run erp -- resolve --connector bc --object invoice:<id> --as synced|retry --by <who>
//                                                       a person settles an object left for them (needs_review)
// npm run erp -- correct --connector exact --object invoice:<id> --live
//                                                       a credit note (or reversal) and the new version
// npm run erp -- calls                                  the run's call log by endpoint, against the approved number
// npm run erp -- readback --connector moneybird --live [--out <file>]
//                                                       read every purchase invoice back and reconcile it with the ledger
// npm run erp -- record --connector moneybird [--readback <file>] [--steps <file>] [--idempotency-step <name>] [--markdown]
//                                                       the run's record as data, from the call log, the audit log and the read-back
// npm run erp -- world --step build --dir <folder> | --step recode
//                                                       the sandbox run's test world (src/erp/sandboxWorld.ts); calls nothing
// The dry run needs no account and no settings: without them it uses example settings and says so.
// Every --live command needs the owner's go and a call budget (src/erp/callBudget.ts): ERP_LIVE_GO=yes,
// ERP_CALL_BUDGET and ERP_CALL_LOG. Each request is counted in the log before it is sent; the one over is not sent.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { DB } from "../db/open.js";
import { callsByEndpoint, liveRefusals, readCallLog } from "./callBudget.js";
import { CONNECTOR_NAMES, redactRequest, type ConnectorName, type ErpConnector, type HttpRequest, type Transport } from "./connector.js";
import type { MoneybirdConnector } from "./moneybird.js";
import { reconcile, reconciliationLines, type Reconciliation } from "./readback.js";
import { dryRunConnector, liveConnector, missingSettings, SETTINGS } from "./registry.js";
import { buildRunRecord, runRecordMarkdown, type RunStep } from "./runRecord.js";
import { buildSandboxWorld, recodeSandboxInvoice } from "./sandboxWorld.js";
import { ledgerItems } from "./source.js";
import { correct, resolve, syncAll, syncStatus, type SyncItem } from "./sync.js";
import { decodeCallForTest } from "./xmlrpc.js";

export interface CliDeps {
  db: DB;
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  /** The connector for a live call (tests pass a fake). */
  live?: (name: ConnectorName) => ErpConnector;
  /** What a live connector sends through, under the call budget: fetch, unless a test passes its stand-in. */
  transport?: Transport;
  items?: (db: DB) => SyncItem[];
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function connectorArg(args: string[]): ConnectorName {
  const c = flag(args, "connector");
  if (!c || !(CONNECTOR_NAMES as readonly string[]).includes(c)) throw new Error(`say which ERP: --connector ${CONNECTOR_NAMES.join("|")}`);
  return c as ConnectorName;
}

function printRequest(r: HttpRequest, out: (s: string) => void) {
  const x = redactRequest(r);
  out(`  ${x.method} ${x.url}`);
  if (typeof x.body === "string" && x.body) {
    let b = x.body;
    if (b.startsWith("<?xml")) {
      // An Odoo call, shown as model.method(args); the database, user id and key (already redacted) are left out.
      const call = decodeCallForTest(b);
      b = call.method === "execute_kw" ? `${String(call.params[3])}.${String(call.params[4])} ${JSON.stringify(call.params.slice(5))}` : `${call.method}(…)`;
    } else {
      try { b = JSON.stringify(JSON.parse(b)); } catch { /* a form */ }
    }
    out(`    ${b.length > 700 ? `${b.slice(0, 700)}…` : b}`);
  } else if (x.body !== undefined) out(`    ${String(x.body)}`);
}

export async function runErpCli(args: string[], d: CliDeps): Promise<number> {
  const cmd = args[0];
  const live = args.includes("--live");
  const dry = args.includes("--dry-run");
  const items = d.items ?? ledgerItems;
  if (cmd === "list") {
    for (const name of CONNECTOR_NAMES) {
      const miss = missingSettings(name, d.env);
      d.out(`${name.padEnd(6)} ${SETTINGS[name].label}: ${miss.length ? `not set up (missing ${miss.join(", ")})` : `settings present (${SETTINGS[name].live})`}`);
    }
    return 0;
  }
  if (cmd === "status") {
    const name = flag(args, "connector");
    const rows = syncStatus(d.db, name);
    if (rows.length === 0) { d.out("nothing sent to an ERP yet"); return 0; }
    for (const r of rows) d.out(`${r.connector.padEnd(6)} ${r.kind.padEnd(8)} ${r.object_id.padEnd(28)} ${r.status.padEnd(17)} ${r.external_id ?? "-"}${r.last_error ? `  (${r.last_error})` : ""}`);
    return 0;
  }
  if (cmd === "calls") {
    // What the run's call log holds, by endpoint, against the approved number. Reads the log; calls nothing.
    const file = d.env.ERP_CALL_LOG;
    if (!file) throw new Error("ERP_CALL_LOG is not set: name the run's call log");
    const calls = readCallLog(file);
    const budget = d.env.ERP_CALL_BUDGET ?? "";
    d.out(/^\d+$/.test(budget) ? `${calls.length} of ${Number(budget)} approved requests used` : `${calls.length} requests in the call log (no ERP_CALL_BUDGET is set)`);
    for (const e of callsByEndpoint(calls)) d.out(`${String(e.calls).padStart(3)}  ${e.endpoint}`);
    return 0;
  }
  if (cmd === "record") {
    // The run's record as data. Reads the call log, the ledger and the files named; calls nothing.
    const name = connectorArg(args);
    const file = d.env.ERP_CALL_LOG;
    if (!file) throw new Error("ERP_CALL_LOG is not set: name the run's call log");
    if (!/^\d+$/.test(d.env.ERP_CALL_BUDGET ?? "")) throw new Error("ERP_CALL_BUDGET is not set: the approved number of requests for the whole run");
    const readback = flag(args, "readback");
    const steps = flag(args, "steps");
    const record = buildRunRecord(d.db, {
      connector: name, administration: name === "moneybird" ? d.env.ERP_MONEYBIRD_ADMINISTRATION_ID ?? null : null, sandboxOnly: d.env.ERP_MONEYBIRD_SANDBOX_ONLY === "on",
      calls: readCallLog(file), approved: Number(d.env.ERP_CALL_BUDGET),
      steps: steps ? readFileSync(steps, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RunStep) : [],
      reconciliation: readback ? (JSON.parse(readFileSync(readback, "utf8")) as Reconciliation) : null,
      ...(flag(args, "idempotency-step") ? { idempotencyStep: flag(args, "idempotency-step")! } : {}),
    });
    d.out(args.includes("--markdown") ? runRecordMarkdown(record) : JSON.stringify(record, null, 2));
    return 0;
  }
  if (cmd === "world") {
    // The Moneybird sandbox run's test world, in this ledger: stand-in rails, test data, no network.
    const stepName = flag(args, "step");
    if (stepName === "build") {
      const dir = flag(args, "dir");
      if (!dir) throw new Error("say where the test world keeps its PDFs: --dir <folder outside the repository>");
      const w = await buildSandboxWorld(d.db, resolvePath(dir));
      d.out(`Test world "${w.company}": stand-in rails, test data only.`);
      for (const i of w.invoices) d.out(`invoice ${i.number.padEnd(12)} ${i.supplier.padEnd(34)} net ${i.net}  VAT ${i.vat}  total ${i.total}  ${i.status}  account ${i.account}${i.changed ? `  (${i.changed})` : ""}`);
      d.out(`paid    ${w.paid.invoice}: ${w.paid.amount}, stand-in payout ${w.paid.transfer}`);
      d.out(`card    ${w.card.merchant}: ${w.card.amount}, stand-in card transaction ${w.card.transaction}, account ${w.card.account}`);
      return 0;
    }
    if (stepName === "recode") {
      const r = recodeSandboxInvoice(d.db);
      d.out(`invoice:${r.ledgerId} moved from account ${r.from} to ${r.to}`);
      return 0;
    }
    throw new Error("say --step build --dir <folder> or --step recode");
  }
  if (cmd === "resolve") {
    // A person's call on an object the ERP holds in a state they had to look at; nothing is sent to the ERP.
    const name = connectorArg(args);
    const [kind, ...rest] = (flag(args, "object") ?? "").split(":");
    const id = rest.join(":");
    const as = flag(args, "as");
    const by = flag(args, "by");
    if (!kind || !id || !["vendor", "invoice", "payment", "journal"].includes(kind)) throw new Error("say which object: --object invoice:<id>");
    if (as !== "synced" && as !== "retry") throw new Error("say --as synced (finished in the ERP) or --as retry (send it again from where it stopped)");
    if (!by) throw new Error("say who resolves it: --by <name or role>");
    resolve(d.db, name, kind as SyncItem["kind"], id, as, by);
    d.out(`${kind} ${id}: ${as} by ${by}`);
    return 0;
  }
  if (cmd === "sync" || cmd === "pull" || cmd === "correct" || cmd === "readback") {
    const name = connectorArg(args);
    if (cmd === "readback" && name !== "moneybird") throw new Error("readback is built for Moneybird only");
    if (dry === live) throw new Error("say --dry-run (send nothing, print the requests) or --live (send them)");
    if (dry) {
      if (cmd !== "sync") throw new Error(`${cmd} has no dry run; use sync --dry-run to see the requests`);
      const { connector, transport, usesExampleSettings } = dryRunConnector(name, d.env);
      d.out(`Dry run for ${SETTINGS[name].label}: nothing is sent.${usesExampleSettings ? " Example settings (no ERP is set up): journal codes, VAT codes and ids are placeholders." : ""}`);
      const res = await syncAll(d.db, connector, items(d.db), { dryRun: true, sleep: async () => {} });
      for (const r of res) d.out(`${r.kind.padEnd(8)} ${r.id.padEnd(28)} ${r.outcome}${r.detail ? `: ${r.detail}` : ""}`);
      d.out(`${transport.sent.length} requests would be sent:`);
      for (const r of transport.sent) printRequest(r, d.out);
      return 0;
    }
    // A pull lists what some settings are made from (Moneybird's tax rate ids), so it does not need those yet.
    const miss = missingSettings(name, d.env, cmd === "pull");
    if (miss.length && !d.live) throw new Error(`${SETTINGS[name].label} is not set up: missing ${miss.join(", ")} (see docs/erp.md)`);
    // The owner's go, the approved number of requests and the log that counts them, before a connector is even built.
    const why = liveRefusals(d.env);
    if (why.length) throw new Error(`a live run needs ${why.join(", ")}; nothing was called`);
    const c = d.live ? d.live(name) : liveConnector(name, d.env, d.transport);
    try {
      if (cmd === "pull") {
        const accounts = await c.pullChartOfAccounts();
        const vendors = await c.pullVendors();
        d.out(`${accounts.length} accounts, ${vendors.length} suppliers in ${SETTINGS[name].label}`);
        // Moneybird maps by ledger account id (ERP_MONEYBIRD_GL_MAP) and tax rate id (ERP_MONEYBIRD_TAX_RATES): show them.
        const ids = name === "moneybird";
        for (const a of accounts) d.out(`  account ${a.code || "-"}  ${a.name}${a.note ? `  (${a.note})` : ""}${ids ? `  [id ${a.externalId}]` : ""}`);
        for (const v of vendors) d.out(`  supplier ${v.name}${v.vatId ? ` (${v.vatId})` : ""}`);
        const taxes = (c as { pullTaxRates?: () => Promise<{ id: string; name: string; percentage: string; type: string }[]> }).pullTaxRates;
        if (taxes) for (const t of await taxes.call(c)) d.out(`  tax rate ${t.name} (${t.percentage}%, ${t.type})  [id ${t.id}]`);
        return 0;
      }
      if (cmd === "readback") {
        // One GET per purchase invoice the ERP holds for Purser, then the comparison with the ledger, as data.
        const mb = c as Partial<Pick<MoneybirdConnector, "readPurchaseInvoice">>;
        if (!mb.readPurchaseInvoice) throw new Error("this connector cannot read an invoice back");
        const rec = await reconcile(d.db, name, (id) => mb.readPurchaseInvoice!.call(c, id), { items: items(d.db) });
        for (const l of reconciliationLines(rec)) d.out(l);
        const outFile = flag(args, "out");
        if (outFile) writeFileSync(resolvePath(outFile), `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
        return rec.differences > 0 || rec.not_compared.length > 0 ? 1 : 0;
      }
      if (cmd === "correct") {
        const obj = flag(args, "object") ?? "";
        const [kind, ...rest] = obj.split(":");
        const id = rest.join(":");
        const item = items(d.db).find((i) => i.kind === kind && i.object.id === id);
        if (!item) throw new Error(`no ${kind || "object"} ${id || "(none given)"} in the ledger; give --object invoice:<id> or journal:<id>`);
        const r = await correct(d.db, c, item);
        d.out(`${r.kind} ${r.id}: corrected, now ${r.externalId}`);
        return 0;
      }
      const res = await syncAll(d.db, c, items(d.db));
      for (const r of res) d.out(`${r.kind.padEnd(8)} ${r.id.padEnd(28)} ${r.outcome}${r.externalId ? ` ${r.externalId}` : ""}${r.detail ? `: ${r.detail}` : ""}`);
      return res.some((r) => r.outcome === "failed" || r.outcome === "invalid") ? 1 : 0;
    } finally {
      // Said after every live command, also one that stopped: the count is the log's, written before each request left.
      d.out(`${readCallLog(resolvePath(d.env.ERP_CALL_LOG!)).length} of ${Number(d.env.ERP_CALL_BUDGET)} approved requests used`);
    }
  }
  d.out("npm run erp -- list | status | calls | readback --connector moneybird --live | record --connector … | world --step build|recode | sync --connector exact|bc|odoo|moneybird --dry-run|--live | pull --connector … --live | correct --connector … --object invoice:<id> --live | resolve --connector … --object invoice:<id> --as synced|retry --by <who>");
  return cmd ? 2 : 0;
}
