// npm run airi:vic-2 -- <command>: what Purser adds around the Airi rail (docs/runs/vic-2-plan.md). 0 Airi calls and
// 0 Airwallex calls in every command: the conductor's Airi client and checkout refuse any call, and that fails the run.
//   --dry                 D, E and F on stand-ins, 0 network: no key is read, fetch is refused, airi-cli is not run. The
//                         CFO's approvals are labelled stand-in decisions, not Face ID. The record says DRY RUN.
//   preflight             the environment, this world's passkey, and the runner beside it (holding this ledger's lock,
//                         without the Airi rail and without Airwallex keys); 0 calls of any kind
//   live                  the run, with the runner (npm run relay) beside it; VIC2_GO=yes only
//   recover               after a crash: closes a D altered after signing, reports the rest; 0 calls
// Options: --record <file> (default data/vic-2-record.json, or data/vic-2-dry-record.json), --log <file>, --no-f (leave
// out F, the lock lifted again: one Face ID less).
// Nothing here approves anything live: the CFO does, with Face ID on the relay.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args.includes("--dry") ? "dry" : (args.find((a) => !a.startsWith("--")) ?? "help");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = resolve(import.meta.dirname, "../..");
const withF = !args.includes("--no-f");

if (cmd === "help") {
  console.log("npm run airi:vic-2 -- --dry | preflight | live | recover  [--no-f]   (docs/runs/vic-2-plan.md)");
  process.exit(0);
}

const LIVE_KEYS = ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "AIRWALLEX_CALL_LOG", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "KIT11_AGENTS", "KIT11_AUTONOMY", "HUB_PUSH_ENABLED", "HUB_DECISIONS_ENABLED", "T0_ENABLED"];

const logFile = opt("--log") ?? resolve(repo, cmd === "dry" ? "data/vic-2-dry.log" : "data/vic-2.log");
mkdirSync(dirname(logFile), { recursive: true });
let check: ((text: string) => void) | null = null;
/** Every line to the console and the run log, checked for secrets first. vic-2 never has an Airi link to show. */
function makeLog(prefix: string): (line: string) => void {
  return (line) => {
    check!(line);
    const l = `${new Date().toISOString()} ${prefix}${line}`;
    console.log(l);
    appendFileSync(logFile, `${l}\n`, { mode: 0o600 });
  };
}

if (cmd === "dry") {
  for (const k of LIVE_KEYS) delete process.env[k];
  globalThis.fetch = (async (input: unknown) => { throw new Error(`vic-2 dry: no network (${String(input).slice(0, 60)})`); }) as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "vic2-dry-"));
  process.env.KIT11_DB = join(dir, "vic-2-dry.sqlite");
  process.env.KIT11_KEYS_DIR = join(dir, "vic-2-dry-keys");
  process.env.KIT11_AIRI_RAIL = "on";
  try {
    check = (await import("../airi/vic1.js")).assertNoSecrets;
    const { runVic2, zeroRail } = await import("../airi/vic2.js");
    const { openDb } = await import("../db/open.js");
    const { StandInAiriClient } = await import("../airi/standIn.js");
    const { decide } = await import("../policy/approvals.js");
    const { executePolicyChange } = await import("../executors/policyChange.js");
    const db = openDb();
    const log = makeLog("DRY  ");
    const attempts: { op: string; by: string }[] = [];
    const rail = zeroRail(new StandInAiriClient(), attempts, log);
    const rec = await runVic2({
      db, mode: "dry", rail, attempts: () => attempts, log, withF,
      awaitCfo: async (id, until) => {
        const p = db.prepare("SELECT kind, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; terms_sha256: string };
        log(`FACE ID    (dry: a stand-in approval of ${id}, not the CFO's Face ID)`);
        decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not the CFO)", method: "cli" });
        // As the runner would run a policy change right after the Face ID (it runs no Airi purchase in vic-2).
        if (until === "executed" && p.kind === "policy_change") executePolicyChange(db, id);
        return (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
      },
    });
    for (const [k, v] of Object.entries(rec.checks)) log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
    const out = opt("--record") ?? resolve(repo, "data/vic-2-dry-record.json");
    writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
    log(`record     ${out} (DRY RUN: not the run's evidence)`);
    db.close();
    process.exitCode = Object.values(rec.checks).every((c) => c.ok) ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  // Live commands: this world's own ledger and keys, the conductor's rail on, nothing outside reachable.
  const why: string[] = [];
  if (!["preflight", "live", "recover"].includes(cmd)) why.push(`unknown command ${JSON.stringify(cmd)}`);
  if (process.env.KIT11_AIRI_RAIL !== "on") why.push("KIT11_AIRI_RAIL=on (the conductor's rail; the runner runs without it)");
  if (!/vic-2[^/]*\.sqlite$/.test(process.env.KIT11_DB ?? "")) why.push("KIT11_DB must be this world's own ledger (data/vic-2*.sqlite)");
  if (!/\/vic-2[^/]*$/.test(process.env.KIT11_KEYS_DIR ?? "")) why.push("KIT11_KEYS_DIR must be this world's own keys folder (…/vic-2*)");
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "HUB_DECISIONS_ENABLED"]) if (process.env[k]) why.push(`${k} must be unset: vic-2 calls nothing outside`);
  if (cmd === "live" && process.env.VIC2_GO !== "yes") why.push("VIC2_GO=yes (the CFO's go)");
  if (why.length) {
    console.error(`vic-2 ${cmd} refused; nothing was called:\n- ${why.join("\n- ")}`);
    process.exit(2);
  }
  check = (await import("../airi/vic1.js")).assertNoSecrets;
  const { runVic2, zeroRail, runnerProblems, readRunnerEnv, pollDecision, recoverVic2, Vic2Stop, LOCK_KEY } = await import("../airi/vic2.js");
  const { openDb } = await import("../db/open.js");
  const { AiriCliClient } = await import("../airi/cli.js");
  const { activePasskey } = await import("../passkey/ledger.js");
  const { lockOf, rowOf } = await import("../ops/runnerLock.js");
  const { approvalHint } = await import("./hint.js");
  const db = openDb();
  const log = makeLog("");
  const attempts: { op: string; by: string }[] = [];
  try {
    if (cmd === "recover") {
      for (const line of recoverVic2(db)) log(`recover    ${line}`);
    } else {
      // Before anything is proposed: the CFO's passkey, and a runner that cannot run D by itself.
      const pk = activePasskey(db);
      if (!pk) throw new Vic2Stop("no passkey is enrolled in this world: enrol and confirm it first (npm run relay -- --enrol, then npm run passkey -- confirm <fingerprint>)");
      const problems = runnerProblems(lockOf(db) ?? rowOf(db, "runner.relay"), readRunnerEnv);
      if (problems.length) throw new Vic2Stop(`the runner is not ready for vic-2:\n- ${problems.join("\n- ")}`);
      const pending = db.prepare("SELECT proposal_id FROM proposals WHERE status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')").all() as { proposal_id: string }[];
      if (pending.length) throw new Vic2Stop(`proposals are open in this ledger (${pending.map((p) => p.proposal_id).join(", ")}); vic-2 starts with none`);
      log(`preflight  passkey ${pk.credential_id.slice(0, 8)} enrolled; the runner holds this ledger's lock, without the Airi rail and without Airwallex keys; ${LOCK_KEY} = ${(db.prepare("SELECT value FROM settings WHERE key = ?").get(LOCK_KEY) as { value: string } | undefined)?.value ?? "(not set yet: the run sets the rail's policy)"}; 0 calls made`);
      log(`preflight  the CFO will be asked for ${withF ? 3 : 2} Face IDs: D (an Airi purchase, 30.00 EUR), the lock${withF ? ", the lock lifted" : ""}; no Airi tap`);
      if (cmd === "live") {
        // airi-cli is attached but never run: the guard refuses every call before it reaches the binary.
        const rail = zeroRail(new AiriCliClient(), attempts, log);
        const rec = await runVic2({
          db, mode: "live", rail, attempts: () => attempts, log, withF,
          ...(process.env.AIRI_PAYMENT_METHOD_ID ? { paymentMethodId: process.env.AIRI_PAYMENT_METHOD_ID } : {}),
          awaitCfo: async (id, until) => {
            log(`FACE ID    ${approvalHint(db, id)}`);
            if (until === "decided") log(`FACE ID    after this Face ID the phone may say "execution stopped: the Airi rail is off": expected, the runner runs no Airi purchase in vic-2`);
            return pollDecision(db, id, until, { sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), now: () => new Date(), log });
          },
        });
        for (const [k, v] of Object.entries(rec.checks)) log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
        const out = opt("--record") ?? resolve(repo, "data/vic-2-record.json");
        writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
        log(`record     ${out}`);
        process.exitCode = Object.values(rec.checks).every((c) => c.ok) ? 0 : 1;
      }
    }
  } catch (e) {
    const { scrubText } = await import("../airi/client.js");
    log(`STOP       ${scrubText(e instanceof Error ? e.message : String(e))}`);
    if (attempts.length) log(`STOP       outside calls tried (each refused before it ran): ${attempts.map((a) => `${a.by}.${a.op}`).join(", ")}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
