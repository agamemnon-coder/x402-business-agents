// npm run autopilot [-- --once] [--interval <seconds>] [--folder <dir>]... [--erp <exact|bc|odoo|moneybird>]
// npm run autopilot -- --retry <item>      a person puts an item the autopilot parked back in line
// npm run autopilot -- --parked            lists the parked items with their reasons
//
// Takes every pending supplier invoice one step forward until nothing can move without a person (src/ap/autopilot.ts,
// docs/autopilot.md): files new documents from the folders (default <KIT11_AP_DIR or data/ap>/inbox), books them, asks
// for new suppliers, plans payments for the CFO, executes what the CFO approved, follows the payments, posts the
// ledger and files the vault (KIT11_VAULT=off: no vault). --once drains and exits; otherwise it runs every --interval
// seconds (default 30) until Ctrl-C. One autopilot per ledger. Test money only: the Airwallex sandbox.

import { join } from "node:path";
import { airwallexFromEnv } from "../airwallex/adapter.js";
import { payablesSink } from "../ap/books.js";
import { autopilotPass, defaultOwner, drain, parkedItems, releaseLease, retryItem, type AutopilotDeps } from "../ap/autopilot.js";
import { ClaudeReader } from "../claude/reader.js";
import { openDb } from "../db/open.js";
import { CONNECTOR_NAMES, type ConnectorName } from "../erp/connector.js";
import { liveConnector } from "../erp/registry.js";
import { execute } from "../executors/index.js";
import { LocalSink } from "../vault/sink.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const all = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));

async function main(): Promise<number> {
  const db = openDb();
  if (args.includes("--parked")) {
    const parked = parkedItems(db);
    for (const p of parked) console.log(`${p.item}  ${p.step}, ${p.attempts} tries: ${p.reason ?? ""}`);
    console.log(parked.length ? `${parked.length} parked: put one back with npm run autopilot -- --retry <item>` : "nothing is parked");
    return 0;
  }
  const retry = flag("--retry");
  if (retry !== undefined) {
    const ok = retryItem(db, retry, "a person at the terminal");
    console.log(ok ? `${retry} is back in line: the next pass tries it again` : `${retry} is not parked`);
    return ok ? 0 : 1;
  }
  const dir = process.env.KIT11_AP_DIR ?? "data/ap";
  const folders = all("--folder");
  const erpName = flag("--erp");
  if (erpName !== undefined && !(CONNECTOR_NAMES as readonly string[]).includes(erpName)) throw new Error(`--erp takes one of ${CONNECTOR_NAMES.join(", ")}`);
  const awx = await airwallexFromEnv();
  const owner = defaultOwner();
  const deps: AutopilotDeps = {
    inbox: { dir, reader: new ClaudeReader(db), sink: payablesSink() },
    folders: folders.length ? folders : [join(dir, "inbox")],
    rail: awx?.rail ?? null,
    payeeNames: await (await import("../airwallex/payeeName.js")).payeeVerifierFromEnv(),
    execute: (d, id) => execute(d, id),
    vault: process.env.KIT11_VAULT === "off" ? null : new LocalSink(process.env.KIT11_VAULT_DIR ?? "data/vault"),
    erp: erpName ? liveConnector(erpName as ConnectorName, process.env) : null,
    gate: null,
    owner,
  };
  console.log("Every supplier payment waits for the CFO's Face ID: this ledger's policy has no limit for paying alone.");
  if (!awx) console.log("Airwallex sandbox keys are not set: payments are not planned or executed.");
  console.log(`Watching ${deps.folders.join(", ")}${deps.vault ? "; filing the vault" : ""}${erpName ? `; syncing the books to ${erpName}` : ""}.`);
  const stop = () => { releaseLease(db, owner.id); db.close(); };

  if (args.includes("--once")) {
    const r = await drain(db, deps);
    stop();
    if (r.lease === "busy") { console.log(`another autopilot runs on this ledger (${r.holder ? `pid ${r.holder.pid} on ${r.holder.host}` : "unknown"}); nothing was done`); return 2; }
    console.log(`${r.moved} step(s) in ${r.passes} pass(es); the rest waits for a person or the CFO`);
    return 0;
  }
  const seconds = Number(flag("--interval") ?? 30);
  if (!Number.isFinite(seconds) || seconds < 5) throw new Error("--interval is at least 5 seconds");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await autopilotPass(db, deps);
      if (r.lease === "busy") console.log(`another autopilot holds this ledger (${r.holder ? `pid ${r.holder.pid} on ${r.holder.host}` : "unknown"}); waiting`);
      else if (r.moved) console.log(`${new Date().toISOString()}  ${r.moved} step(s)`);
    } catch (e) {
      console.error((e as Error).message);
    } finally {
      running = false;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stop(); process.exit(0); });
  await tick();
  setInterval(() => void tick(), seconds * 1000);
  console.log(`running every ${seconds} s (Ctrl-C stops)`);
  return -1;
}

main().then((code) => { if (code >= 0) process.exit(code); }, (e: unknown) => { console.error((e as Error).message); process.exit(1); });
