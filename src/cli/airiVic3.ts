// npm run airi:vic-3 -- <command>: the Sourcing agent (Claude Haiku) chooses the Airi rail; the CFO-signed terms hash read
// back from Airi's mandate and from Airwallex's PaymentIntent record; the negative test F1/F2 (docs/runs/vic-3-plan.md).
//   --dry      A..F2 on the labelled stand-ins and a stand-in model, 0 network: no key is read, fetch is refused,
//              airi-cli is not run. The approvals are stand-in decisions, not the CFO's Face ID. The record says STAND-IN.
//   preflight  the guards, this world's passkey, the runner beside it (without the Airi rail and without Airwallex keys),
//              then 3 read-only Airi calls (auth whoami, payment-methods list, mandate list); no purchase
//   live       the run, with the runner (npm run relay) beside it for the CFO's Face IDs
//   recover    purchases a crash left open: looked up at the checkout or cancelled at Airi
// Every command but --dry refuses to start (nothing called, exit 2) without KIT11_AIRI_RAIL=on and VIC3_GO=yes.
// Options: --record <file> (default data/vic-3-record.json, or data/vic-3-dry-record.json), --md <file> (the record as a
// page), --log <file>.
// Nothing here approves anything live: the CFO does, with Face ID on the relay; Max taps in Airi with his passkey.

import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args.includes("--dry") ? "dry" : (args.find((a) => !a.startsWith("--") && !/\.(json|md|log)$/.test(a)) ?? "help");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = resolve(import.meta.dirname, "../..");
/** npm run airi:vic-4 passes --vic-4: a third paid purchase (G), a ready check before each tap, F1/F2 to Purser's
 *  credential check. Its own go (VIC4_GO=yes), ledger (data/vic-4*.sqlite) and keys folder (…/vic-4*). */
/** npm run airi:vic-5 passes --vic-5 (14 Nov): B alone end to end, C and D, F1/F2 on B's credential; vic-4's waits and
 *  checks, its own go (VIC5_GO=yes), ledger (data/vic-5*.sqlite) and keys folder (…/vic-5*). */
const variant = args.includes("--vic-5") ? "vic-5" as const : args.includes("--vic-4") ? "vic-4" as const : "vic-3" as const;
const waits = variant !== "vic-3";

if (cmd === "help") {
  console.log(`npm run airi:${variant} -- --dry | preflight | live | recover  [--record f.json] [--md f.md]   (docs/runs/${variant}-plan.md)`);
  process.exit(0);
}

const LIVE_KEYS = ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "AIRWALLEX_CALL_LOG", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "KIT11_AGENTS", "KIT11_AUTONOMY", "HUB_PUSH_ENABLED", "HUB_DECISIONS_ENABLED", "T0_ENABLED", "VIC3_GO", "VIC4_GO"];

const logFile = opt("--log") ?? resolve(repo, cmd === "dry" ? `data/${variant}-dry.log` : `data/${variant}.log`);
mkdirSync(dirname(logFile), { recursive: true });
let check: ((text: string) => void) | null = null;
/** Every line to the console and the run log, checked for secrets first. The one-time links never come here. */
function makeLog(prefix: string): (line: string) => void {
  return (line) => {
    check!(line);
    const l = `${new Date().toISOString()} ${prefix}${line}`;
    console.log(l);
    appendFileSync(logFile, `${l}\n`, { mode: 0o600 });
  };
}

async function write(rec: import("../airi/vic3.js").Vic3Record, defaultOut: string, log: (l: string) => void): Promise<void> {
  const { vic3Markdown } = await import("../airi/vic3.js");
  for (const [k, v] of Object.entries(rec.checks)) log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
  const out = opt("--record") ?? defaultOut;
  writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  log(`record     ${out}${rec.mode === "dry" ? " (STAND-IN: not the run's evidence)" : ""}`);
  const md = opt("--md");
  if (md) { writeFileSync(md, vic3Markdown(rec)); log(`page       ${md}`); }
  process.exitCode = Object.values(rec.checks).every((c) => c.ok) ? 0 : 1;
}

if (cmd === "dry") {
  for (const k of LIVE_KEYS) delete process.env[k];
  globalThis.fetch = (async (input: unknown) => { throw new Error(`vic-3 dry: no network (${String(input).slice(0, 60)})`); }) as typeof fetch;
  const dir = mkdtempSync(join(tmpdir(), "vic3-dry-"));
  process.env.KIT11_DB = join(dir, "vic-3-dry.sqlite");
  process.env.KIT11_KEYS_DIR = join(dir, "vic-3-dry-keys");
  process.env.KIT11_AIRI_RAIL = "on";
  try {
    check = (await import("../airi/vic1.js")).assertNoSecrets;
    const { runVic3, standInClaude } = await import("../airi/vic3.js");
    const { openDb } = await import("../db/open.js");
    const { StandInAiriClient, StandInCheckout } = await import("../airi/standIn.js");
    const { decide } = await import("../policy/approvals.js");
    const db = openDb();
    const log = makeLog("STAND-IN  ");
    const rec = await runVic3({
      variant, ready: async (step, what) => log(`READY ${step}    (STAND-IN: no wait; live, the conductor waits here for Enter: ${what})`),
      db, mode: "dry", airi: new StandInAiriClient(), checkout: new StandInCheckout(), claude: standInClaude(), log, tmpRoot: dir, sleep: async () => {},
      showPasskeyUrl: (_url, i) => log(`AIRI TAP   ${i.actionId} (STAND-IN: a stand-in link, not printed; no tap needed)`),
      awaitCfo: async (id) => {
        const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
        log(`FACE ID    (STAND-IN: a stand-in approval of ${id}, not the CFO's Face ID)`);
        decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "dry-run stand-in (not the CFO)", method: "cli" });
        return (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
      },
    });
    await write(rec, resolve(repo, `data/${variant}-dry-record.json`), log);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  const { vic3LiveRefusals } = await import("../airi/vic3.js");
  const why = vic3LiveRefusals(cmd, process.env, variant);
  if (why.length) {
    console.error(`${variant} ${cmd} refused; nothing was called:\n- ${why.join("\n- ")}`);
    process.exit(2);
  }
  check = (await import("../airi/vic1.js")).assertNoSecrets;
  const { runVic3, vic3RunnerProblems, readRunnerEnv, removeOnSignal, Vic3Stop, BUDGETS, budgeted, Budget } = await import("../airi/vic3.js");
  const { preflight } = await import("../airi/vic1.js");
  const { pollDecision } = await import("../airi/vic2.js");
  const { openDb } = await import("../db/open.js");
  const { AiriCliClient } = await import("../airi/cli.js");
  const { liveAiriDeps, tapLine } = await import("../airi/deps.js");
  const { claudeClient } = await import("../claude/reader.js");
  const { activePasskey } = await import("../passkey/ledger.js");
  const { lockOf, rowOf } = await import("../ops/runnerLock.js");
  const { approvalHint } = await import("./hint.js");
  const db = openDb();
  const log = makeLog("");
  /** The one-time link: the console only, never the run log. */
  const tap = (line: string) => console.log(line);
  try {
    const live = liveAiriDeps({ showPasskeyUrl: () => {} }, log);
    if (!live) throw new Vic3Stop("no Airwallex sandbox keys; nothing was called");
    if (cmd === "recover") {
      const { recoverAiriPurchases } = await import("../airi/purchase.js");
      const b = { airi: new Budget("airi"), airwallex: new Budget("airwallex") };
      const rail = { ...live, airi: budgeted(live.airi, b.airi), checkout: budgeted(live.checkout, b.airwallex) };
      for (const r of await recoverAiriPurchases(db, rail)) log(`recover    ${r.actionId}: ${r.status}`);
    } else {
      // Before anything is called: the CFO's passkey, and a runner that cannot run B or E by itself.
      const pk = activePasskey(db);
      if (!pk) throw new Vic3Stop("no passkey is enrolled in this world: enrol and confirm it first (npm run relay -- --enrol, then npm run passkey -- confirm <fingerprint>)");
      const problems = vic3RunnerProblems(lockOf(db) ?? rowOf(db, "runner.relay"), readRunnerEnv);
      if (problems.length) throw new Vic3Stop(`the runner is not ready for vic-3:\n- ${problems.join("\n- ")}`);
      const open = db.prepare("SELECT proposal_id FROM proposals WHERE status IN ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING')").all() as { proposal_id: string }[];
      if (open.length) throw new Vic3Stop(`proposals are open in this ledger (${open.map((p) => p.proposal_id).join(", ")}); vic-3 starts with none`);
      log(`preflight  passkey ${pk.credential_id.slice(0, 8)} enrolled; the runner holds this ledger's lock, without the Airi rail and without Airwallex keys`);
      log(`preflight  budgets: Anthropic ${BUDGETS.anthropic}, Airwallex ${BUDGETS.airwallex} (this run's call log: ${process.env.AIRWALLEX_CALL_BUDGET}), airi-cli ${BUDGETS.airi}`);
      if (cmd === "preflight") {
        const b = new Budget("airi", 4);
        await preflight({ db, mode: "live", airi: budgeted(new AiriCliClient(), b), rail: null as never, log, awaitCfo: async () => "" });
        log(`preflight  ${b.n} read-only Airi call(s); no purchase, no credential, no Airwallex or Anthropic call`);
      } else {
        // Every credential directory of the run (B's kept copy for F2 among them) lives under this root, which is removed
        // when the run ends and also on Ctrl-C or a kill signal, where a finally would not run.
        const root = mkdtempSync(join(tmpdir(), "vic3-live-"));
        chmodSync(root, 0o700);
        removeOnSignal(root);
        const { createInterface } = await import("node:readline/promises");
        const QR = (await import("qrcode")).default;
        let current = "A";
        const rec = await runVic3({
          variant,
          // The 5-minute tap window starts only once Max says his phone is ready (vic-3's A ran out waiting).
          ready: waits ? async (step, what) => {
            current = step;
            log(`READY ${step}    waiting for Max: ${what}`);
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            await rl.question(`\n>>> ${step}: ${what}. Phone unlocked, Airi open? Press Enter to start (the link and its QR code follow, 5 minutes to tap) `);
            rl.close();
            log(`READY ${step}    Max is ready`);
          } : undefined,
          db, mode: "live", airi: new AiriCliClient(), checkout: live.checkout, claude: claudeClient(), log, tmpRoot: root,
          showPasskeyUrl: (url, i) => {
            tap(tapLine(waits ? current : i.actionId === "vic3-F1" ? "F1" : i.actionId.startsWith("P-") ? "B" : "A", i.actionId, i, url));
            // The QR code: the console only, like the link (Max scans it with his phone).
            if (waits) void QR.toString(url, { type: "terminal", small: true }).then((q) => tap(q), () => {});
          },
          awaitCfo: async (id) => {
            log(`FACE ID    ${approvalHint(db, id)}`);
            log(`FACE ID    after this Face ID the phone may say "execution stopped: the Airi rail is off": expected, this conductor runs it, not the runner`);
            return pollDecision(db, id, "decided", { sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)), now: () => new Date(), log });
          },
        });
        rmSync(root, { recursive: true, force: true });
        await write(rec, resolve(repo, `data/${variant}-record.json`), log);
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
