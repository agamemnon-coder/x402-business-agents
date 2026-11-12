// npm run airi:vic-1 -- <command>: the Airi rail's run (docs/runs/vic-1-plan.md).
//   --dry                 A, B and C on the stand-ins, 0 network: no key is read, fetch is refused, airi-cli is not run.
//                         B's approval is a labelled stand-in decision, not Max's Face ID. The record says DRY RUN.
//   preflight             the pinned airi-cli, Max's Airi session (stops when it has lapsed), an agent-enabled card,
//                         the mandate list readable: 3 read-only Airi calls (auth whoami, payment-methods list,
//                         mandate list); no purchase, no credential
//   live                  the run, with the runner (npm run relay, KIT11_AIRI_RAIL=on, the same KIT11_DB) beside it;
//                         VIC1_GO=yes only
//   recover               purchases a crash left open: looked up at the checkout or cancelled at Airi
// Options: --record <file> (default data/vic-1-record.json, or data/vic-1-dry-record.json), --log <file>.
// Nothing here approves anything live: Max does, with Face ID on the relay and with his passkey in Airi.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args.includes("--dry") ? "dry" : (args.find((a) => !a.startsWith("--")) ?? "help");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = resolve(import.meta.dirname, "../..");

if (cmd === "help") {
  console.log("npm run airi:vic-1 -- --dry | preflight | live | recover   (docs/runs/vic-1-plan.md)");
  process.exit(0);
}

const LIVE_KEYS = ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "AIRWALLEX_CALL_LOG", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "KIT11_AGENTS", "KIT11_AUTONOMY", "HUB_PUSH_ENABLED", "HUB_DECISIONS_ENABLED", "T0_ENABLED"];

const logFile = opt("--log") ?? resolve(repo, cmd === "dry" ? "data/vic-1-dry.log" : "data/vic-1.log");
mkdirSync(dirname(logFile), { recursive: true });
/** Every line to the console and the run log, checked for secrets first. The tap link never comes here. */
function makeLog(prefix: string): (line: string) => void {
  return (line) => {
    const { assertNoSecrets } = vic1Mod!;
    assertNoSecrets(line);
    const l = `${new Date().toISOString()} ${prefix}${line}`;
    console.log(l);
    appendFileSync(logFile, `${l}\n`, { mode: 0o600 });
  };
}
let vic1Mod: typeof import("../airi/vic1.js") | null = null;

if (cmd === "dry") {
  for (const k of LIVE_KEYS) delete process.env[k];
  globalThis.fetch = (async (input: unknown) => { throw new Error(`vic-1 dry: no network (${String(input).slice(0, 60)})`); }) as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "vic1-dry-"));
  process.env.KIT11_DB = join(dir, "vic-1-dry.sqlite");
  process.env.KIT11_KEYS_DIR = join(dir, "vic-1-dry-keys");
  process.env.KIT11_AIRI_RAIL = "on";
  try {
    vic1Mod = await import("../airi/vic1.js");
    const { runVic1, counted } = vic1Mod;
    const { openDb } = await import("../db/open.js");
    const { StandInAiriClient, StandInCheckout } = await import("../airi/standIn.js");
    const { executeAiriPurchase } = await import("../airi/purchase.js");
    const { decide } = await import("../policy/approvals.js");
    const db = openDb();
    const log = makeLog("DRY  ");
    const calls: { op: string; by: string }[] = [];
    const airi = counted(new StandInAiriClient(), "airi", calls);
    const checkout = counted(new StandInCheckout(), "checkout", calls);
    const rail = { airi, checkout, say: log, showPasskeyUrl: (_url: string, i: { actionId: string }) => log(`AIRI TAP ${i.actionId.startsWith("P-") ? "B" : "A"}  ${i.actionId} (dry: a stand-in link, not printed; no tap needed)`) };
    const rec = await runVic1({
      db, mode: "dry", rail, airi, log,
      awaitCfo: async (id) => {
        const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
        log(`FACE ID    (dry: a stand-in approval of ${id}, not Max's Face ID)`);
        decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not Max)", method: "cli" });
        // Under the approval's origin, as the runner's execute() would (D24).
        const { approvalOrigin } = await import("../executors/index.js");
        const { withOrigin } = await import("../provenance/origin.js");
        await withOrigin(approvalOrigin(db, id)!, () => executeAiriPurchase(db, rail, id));
        return (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
      },
    }, () => calls);
    for (const [k, v] of Object.entries(rec.checks)) log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
    const out = opt("--record") ?? resolve(repo, "data/vic-1-dry-record.json");
    writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
    log(`record     ${out} (DRY RUN: not the run's evidence)`);
    db.close();
    process.exitCode = Object.values(rec.checks).every((c) => c.ok) ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  // Live commands: this world's own ledger and keys, the rail on, no Metal.
  const why: string[] = [];
  if (process.env.KIT11_AIRI_RAIL !== "on") why.push("KIT11_AIRI_RAIL=on");
  if (!/vic-1[^/]*\.sqlite$/.test(process.env.KIT11_DB ?? "")) why.push("KIT11_DB must be this world's own ledger (data/vic-1*.sqlite)");
  if (!/\/vic-1[^/]*$/.test(process.env.KIT11_KEYS_DIR ?? "")) why.push("KIT11_KEYS_DIR must be this world's own keys folder (…/vic-1*)");
  if (process.env.METAL_RPC_URL) why.push("METAL_RPC_URL must be unset: vic-1 makes no Metal call");
  if (cmd !== "preflight") {
    if (!process.env.AIRWALLEX_CLIENT_ID || !process.env.AIRWALLEX_API_KEY) why.push("AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set");
    if (!process.env.AIRWALLEX_CALL_BUDGET || !process.env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET (the number Max approved) and AIRWALLEX_CALL_LOG must be set");
  }
  if (cmd === "live" && process.env.VIC1_GO !== "yes") why.push("VIC1_GO=yes (Max's go)");
  if (why.length) {
    console.error(`vic-1 ${cmd} refused; nothing was called:\n- ${why.join("\n- ")}`);
    process.exit(2);
  }
  vic1Mod = await import("../airi/vic1.js");
  const { runVic1, preflight, counted, Vic1Stop } = vic1Mod;
  const { openDb } = await import("../db/open.js");
  const { AiriCliClient } = await import("../airi/cli.js");
  const { awaitWithTap, consoleLinkSink, liveAiriDeps, takeTapLink } = await import("../airi/deps.js");
  const { approvalHint } = await import("./hint.js");
  const db = openDb();
  const log = makeLog("");
  /** The one-time link: the console only, never the run log. */
  const tap = (line: string) => console.log(line);
  // Why B's link went unseen on 7 November (vic-1b): this process did print it (its console, conductor.log), but as an
  // unlabelled, untimestamped line that never reached the run log, so nothing watching the run's log or its
  // timestamped lines saw it come. Now: a labelled "AIRI TAP B" line with the time on the console the moment the
  // runner writes the link, and a notice (without the link) in the run log, repeated each minute while the tap waits.
  const calls: { op: string; by: string }[] = [];
  const budget = Number(process.env.VIC1_AIRI_CALL_BUDGET ?? "12");
  const airi = counted(new AiriCliClient(), "airi", calls, budget);
  try {
    if (cmd === "preflight") {
      await preflight({ db, mode: "live", airi, rail: null as never, log, awaitCfo: async () => "" });
    } else {
      const live = liveAiriDeps(consoleLinkSink(tap, "A"), log);
      if (!live) throw new Vic1Stop("no Airwallex sandbox keys; nothing was called");
      const rail = { ...live, airi, checkout: counted(live.checkout, "checkout", calls) };
      if (cmd === "recover") {
        const { recoverAiriPurchases } = await import("../airi/purchase.js");
        for (const r of await recoverAiriPurchases(db, rail)) log(`recover    ${r.actionId}: ${r.status}`);
      } else {
        const rec = await runVic1({
          db, mode: "live", rail, airi, log,
          awaitCfo: async (id) => {
            log(`FACE ID    ${approvalHint(db, id)}`);
            log(`AIRI TAP B  after the Face ID the runner asks Airi for B's mandate; its one-time link will show here, on this console, as an "AIRI TAP B" line`);
            return awaitWithTap({
              id, which: "B", tap, log, takeLink: () => takeTapLink(id),
              status: () => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status,
            });
          },
        }, () => calls);
        for (const [k, v] of Object.entries(rec.checks)) log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
        const out = opt("--record") ?? resolve(repo, "data/vic-1-record.json");
        writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
        log(`record     ${out}`);
        process.exitCode = Object.values(rec.checks).every((c) => c.ok) ? 0 : 1;
      }
    }
  } catch (e) {
    const { scrubText } = await import("../airi/client.js");
    log(`STOP       ${scrubText(e instanceof Error ? e.message : String(e))}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
