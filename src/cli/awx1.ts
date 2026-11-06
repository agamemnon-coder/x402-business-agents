// npm run awx-1 -- <command>: Max's item 2.1, the Airwallex-only run (docs/runs/awx-1-plan.md).
//   plan                     every Airwallex call the run makes, by step and endpoint, and the Claude estimate; 0 calls
//   stand-in [--out file]    the whole scenario on the in-memory stand-ins, 0 network: no key is read, fetch is refused.
//                            Its record says STAND-IN; it is never written to docs/demo or docs/runs
//   preflight                the live world's settings (no secret printed), then 3 Airwallex calls: login, balances, webhooks
//   live [--from <step>]     the scenario on the sandbox, with the runner (npm run relay) beside it; AWX1_GO=yes only
//   record --verify-log <file> [--out file]   the run's record from the ledger, the call log, the last reconciliation
//                            and npm run verify's saved output; 0 calls
// Nothing here approves anything: Max does, with Face ID, on the relay.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { planMarkdown } from "../awx/plan.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "plan";
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = resolve(import.meta.dirname, "../..");

if (cmd === "plan") {
  console.log(planMarkdown(JSON.parse(readFileSync(resolve(repo, "docs/demo/main-run.json"), "utf8"))));
} else if (cmd === "stand-in") {
  // 0 network, whatever this machine holds: the keys are dropped from this process before any module reads them.
  for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_CALL_BUDGET", "AIRWALLEX_CALL_LOG", "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "T0_API_KEY", "KIT11_AGENTS", "KIT11_AUTONOMY", "HUB_PUSH_ENABLED", "HUB_DECISIONS_ENABLED", "T0_ENABLED"]) delete process.env[k];
  globalThis.fetch = (async (input: unknown) => { throw new Error(`awx-1 stand-in: no network (${String(input).slice(0, 60)})`); }) as typeof fetch;
  const out = opt("--out");
  if (out && /^docs[\\/](demo|runs)[\\/]/.test(relative(repo, resolve(out)))) { console.error("a stand-in record never goes to docs/demo or docs/runs: those hold the live run's record"); process.exit(2); }
  const dir = mkdtempSync(join(tmpdir(), "awx1-stand-in-"));
  process.env.KIT11_DB = join(dir, "awx-1-stand-in.sqlite");
  process.env.KIT11_KEYS_DIR = join(dir, "awx-1-stand-in-keys");
  try {
    const { openDb } = await import("../db/open.js");
    const { accepted, awx1Record, runAwx1, verifyLines } = await import("../awx/scenario.js");
    const { standInDeps, standInGet, standInSources, VIRTUAL_PASSKEY_LABEL } = await import("../awx/standIn.js");
    const { reconcile } = await import("../finance/reconcile.js");
    const db = openDb();
    const w = await standInDeps(db, { log: (l) => console.log(`STAND-IN  ${l}`) });
    await runAwx1(w.deps);
    const r = await reconcile(db, standInSources(w.issuing, w.awx));
    const rec = awx1Record(db, { mode: "stand-in", virtualLabels: [VIRTUAL_PASSKEY_LABEL], verify: await verifyLines(db, standInGet(w.awx)), reconcile: { checked: r.checked, differences: r.differences.length, skipped: r.skipped } });
    for (const [k, v] of Object.entries(rec.checks)) console.log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
    const a = accepted(rec);
    console.log(a.ok ? "STAND-IN ACCEPTED (stand-in only: not the run's evidence)" : `STAND-IN NOT ACCEPTED: ${a.why.join("; ")}`);
    if (out) writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`);
    db.close();
    process.exitCode = a.ok ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else if (cmd === "preflight" || cmd === "live") {
  const { hookSecretInKeysDir, liveRefusals } = await import("../awx/live.js");
  const why = liveRefusals(process.env, { keysDirHasHookSecret: hookSecretInKeysDir() });
  if (cmd === "live" && process.env.AWX1_GO !== "yes") why.push("AWX1_GO=yes: Max's go for the run, with the approved call count in AIRWALLEX_CALL_BUDGET");
  if (why.length) { for (const w of why) console.error(`REFUSED          ${w}`); console.error("nothing was called"); process.exit(2); }
  const { openDb } = await import("../db/open.js");
  const db = openDb();
  if (cmd === "preflight") {
    const { Airwallex, fromEnv } = await import("../airwallex/client.js");
    const { listWebhooks } = await import("../airwallex/webhooks.js");
    const { relayConfig } = await import("../relay/config.js");
    const { EUR_FLOOR_CENTS, LICENCE_FEE_EUR_CENTS, SWIFT_FEE_MAX_EUR_CENTS, TARGET_FREE_EUR_CENTS } = await import("../config/policy.js");
    const { fromCents, toCents } = await import("../lib/money.js");
    const api = new Airwallex(fromEnv()!);
    const bal = await api.call<{ currency: string; available_amount: number }[]>("GET", "/balances/current");
    const eur = toCents((bal.find((b) => b.currency === "EUR")?.available_amount ?? 0).toFixed(2));
    const usdAvail = bal.find((b) => b.currency === "USD")?.available_amount ?? 0;
    const freeIfCalibrated = Math.min(TARGET_FREE_EUR_CENTS, Math.max(0, eur - EUR_FLOOR_CENTS));
    console.log(`BALANCES         EUR ${fromCents(eur)} available, USD ${usdAvail}; free EUR at the seed's calibration: ${fromCents(freeIfCalibrated)}`);
    console.log(freeIfCalibrated >= LICENCE_FEE_EUR_CENTS + SWIFT_FEE_MAX_EUR_CENTS ? "f1               the licence (260.00 with its fee ceiling) can go from EUR without FX" : "f1               NOT ENOUGH EUR: the licence would need FX; stop (contingency: a simulated EUR deposit, on Max's go)");
    const url = `${(await relayConfig()).url}/hooks/airwallex`;
    const hook = (await listWebhooks(api)).find((w) => w.url === url);
    console.log(hook ? `WEBHOOKS         ${hook.id} sends ${hook.events.length} events to the relay` : "WEBHOOKS         NO subscription for the relay: stop (contingency: cards -- webhook --replace, on Max's go)");
    process.exit(hook && freeIfCalibrated >= LICENCE_FEE_EUR_CENTS + SWIFT_FEE_MAX_EUR_CENTS ? 0 : 1);
  }
  const { runAwx1, STEPS } = await import("../awx/scenario.js");
  const { liveDeps } = await import("../awx/live.js");
  const from = opt("--from") as (typeof STEPS)[number] | undefined;
  if (from && !STEPS.includes(from)) { console.error(`--from one of ${STEPS.join(", ")}`); process.exit(2); }
  const stamp = () => new Date().toISOString().slice(11, 19);
  try {
    await runAwx1(liveDeps(db, (l) => console.log(`${stamp()} ${l}`)), from ? { from } : {});
    console.log(`${stamp()} done: run npm run verify | tee <log>, npm run reconcile, then npm run awx-1 -- record --verify-log <log>`);
  } catch (e) {
    console.error(`${stamp()} STOPPED          ${(e as Error).message} (recorded as awx1.step_failed; see the runbook's abort criteria)`);
    process.exitCode = 1;
  }
} else if (cmd === "record") {
  const log = opt("--verify-log");
  if (!log) { console.error("usage: npm run awx-1 -- record --verify-log <npm run verify's saved output> [--out file]"); process.exit(2); }
  const { openDb } = await import("../db/open.js");
  const { accepted, awx1Record } = await import("../awx/scenario.js");
  const { lastReconciliation } = await import("../finance/reconcile.js");
  const { countByEndpoint, readCallLog } = await import("../airwallex/callBudget.js");
  const db = openDb();
  const verify = readFileSync(log, "utf8").split("\n").map((l) => /^(ok|FAIL|note)\s+(.+?)(?:\s{2,}(.*))?$/.exec(l)).filter((m) => m !== null)
    .map((m) => ({ level: m[1] as "ok" | "FAIL" | "note", what: m[2]!.trim(), detail: (m[3] ?? "").trim() }));
  const callLog = process.env.AIRWALLEX_CALL_LOG ? readCallLog(process.env.AIRWALLEX_CALL_LOG) : [];
  const rec = awx1Record(db, {
    mode: "live", virtualLabels: (process.env.AWX1_VIRTUAL_LABELS ?? "test-controller").split(",").filter(Boolean), verify, reconcile: lastReconciliation(db),
    calls: { airwallex: countByEndpoint(callLog), airwallex_total: callLog.length, budget: process.env.AIRWALLEX_CALL_BUDGET ? Number(process.env.AIRWALLEX_CALL_BUDGET) : null },
  });
  for (const [k, v] of Object.entries(rec.checks)) console.log(`${v.ok ? "ok  " : "FAIL"}  ${k}  ${v.detail}`);
  const a = accepted(rec);
  console.log(a.ok ? "ACCEPTED" : `NOT ACCEPTED: ${a.why.join("; ")}`);
  writeFileSync(opt("--out") ?? resolve(repo, "docs/demo/airwallex-run.json"), `${JSON.stringify(rec, null, 2)}\n`);
} else {
  console.error("usage: npm run awx-1 -- plan | stand-in [--out file] | preflight | live [--from <step>] | record --verify-log <file> [--out file]");
  process.exit(2);
}
