// npm run airwallex:card-drill -- <command>: the card drill (src/e2e/cardDrill.ts) against the Airwallex sandbox, test money.
//
//   stand-in   the whole drill on the in-memory Issuing stand-in (the crash child in-process); 0 network.
//   live       against the sandbox. Needs CARD_DRILL_GO=yes, AIRWALLEX_CALL_BUDGET (at most 200, one log for every pass),
//              AIRWALLEX_CALL_LOG, KIT11_DB=…/card-drill*.sqlite (the drill's own ledger), AIRWALLEX_PLATFORM and
//              AIRWALLEX_OAUTH off. CARD_DRILL_ONLY=phase,… runs only those phases (a re-run); CARD_DRILL_PASS=n names
//              the pass; CARD_DRILL_AGENTS=agent,… limits the cycle to those cards. Results go beside the ledger: results-pass<n>.json and http.jsonl (every request; never a body,
//              header or card number). It stops at the first unexpected 4xx or 5xx.
//   record     writes docs/runs/<CARD_DRILL_DATE or today>-card-drill.json and .md from those files; 0 calls.
//   child <kind> <agent>   (live only, started by `live`) thaws the card as Purser does, then kills itself (SIGKILL).

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0] ?? "stand-in";
const repo = resolve(import.meta.dirname, "../..");
for (const k of ["KIT11_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "KIT11_AP_AGENTS", "KIT11_AGENTS"]) delete process.env[k];

const drill = await import("../e2e/cardDrill.js");
const { drillFetch, drillHaltReason, readDrillLog } = await import("../e2e/drillHttp.js");
type Agent = import("../config/policy.js").Agent;

const runDir = () => (process.env.KIT11_DB ?? "").replace(/\.sqlite$/, "");
const drillLedger = (env: Record<string, string | undefined>) => /card-drill[^\\/]*\.sqlite$/.test(env.KIT11_DB ?? "");
const httpLog = () => join(runDir(), "http.jsonl");

export function cardDrillRefusals(env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.CARD_DRILL_GO !== "yes") why.push("CARD_DRILL_GO=yes (the go for this run's sandbox calls)");
  if (!env.AIRWALLEX_CALL_BUDGET || !env.AIRWALLEX_CALL_LOG) why.push("AIRWALLEX_CALL_BUDGET and AIRWALLEX_CALL_LOG (every call counted in one log)");
  else if (!/^\d+$/.test(env.AIRWALLEX_CALL_BUDGET) || Number(env.AIRWALLEX_CALL_BUDGET) < 1 || Number(env.AIRWALLEX_CALL_BUDGET) > drill.CARD_DRILL_MAX_BUDGET) why.push(`AIRWALLEX_CALL_BUDGET a whole number from 1 to ${drill.CARD_DRILL_MAX_BUDGET}`);
  if (!drillLedger(env)) why.push("KIT11_DB=…/card-drill*.sqlite (the drill's own ledger)");
  if (env.AIRWALLEX_PLATFORM === "on") why.push("AIRWALLEX_PLATFORM off (the company's own sandbox account only)");
  if (env.AIRWALLEX_OAUTH === "on") why.push("AIRWALLEX_OAUTH off (the sandbox API key pair)");
  if (env.CARD_DRILL_ONLY && !env.CARD_DRILL_ONLY.split(",").every((p) => (drill.PHASES as readonly string[]).includes(p))) why.push(`CARD_DRILL_ONLY a comma list of ${drill.PHASES.join(", ")}`);
  if (env.CARD_DRILL_PASS && !/^[1-9]$/.test(env.CARD_DRILL_PASS)) why.push("CARD_DRILL_PASS a pass number 1 to 9");
  if (env.CARD_DRILL_SIM_FAILURES && !/^[0-5]$/.test(env.CARD_DRILL_SIM_FAILURES)) why.push("CARD_DRILL_SIM_FAILURES a number 0 to 5");
  if (env.CARD_DRILL_AGENTS && !env.CARD_DRILL_AGENTS.split(",").every((a) => ["sourcing", "support", "treasury"].includes(a))) why.push("CARD_DRILL_AGENTS a comma list of sourcing, support, treasury");
  return why;
}

/** The live card rail: the client from the environment, over the drill's fetch over the budgeted fetch. */
async function liveRail() {
  const { fromEnv, Airwallex, SANDBOX_BASE } = await import("../airwallex/client.js");
  const { budgetFromEnv } = await import("../airwallex/callBudget.js");
  const { IssuingRest } = await import("../airwallex/issuing.js");
  const cfg = fromEnv();
  if (!cfg || !cfg.clientId) { console.error("REFUSED  the Airwallex sandbox API key pair is not set; nothing was called"); process.exit(2); }
  if ((cfg.baseUrl ?? SANDBOX_BASE) !== SANDBOX_BASE) { console.error("REFUSED  the configured base URL is not the sandbox; nothing was called"); process.exit(2); }
  const budgeted = budgetFromEnv(process.env, (...a) => fetch(...a))!;
  // From pass 3 (20 Nov): the sandbox's simulation refusing to simulate is recorded, not halting, up to CARD_DRILL_SIM_FAILURES in the run.
  const api = new Airwallex({ ...cfg, fetchImpl: drillFetch(budgeted, { file: httpLog(), toleratedSimFailures: Number(process.env.CARD_DRILL_SIM_FAILURES ?? "0") }) });
  return new IssuingRest(api);
}

if (cmd === "stand-in") {
  for (const k of ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"]) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`card-drill stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  const { openDb } = await import("../db/open.js");
  const { FakeIssuing } = await import("../redteam/issuing.js");
  let clock = Date.now();
  const awx = new FakeIssuing();
  awx.clock = () => clock;
  const db = openDb(":memory:");
  const res = await drill.runCardDrill({
    db, rail: awx, lines: () => [], mode: "stand-in", now: () => new Date(clock), sleep: async (ms) => { clock += ms; }, halted: () => null,
    // The child's work runs here up to its kill point and then never goes on (a promise that never settles).
    crash: async (kind, agent) => {
      let dead = false;
      void drill.crashChild(db, awx, agent, kind, new Date(clock), () => { dead = true; return new Promise<never>(() => undefined); });
      while (!dead) await new Promise((r) => setImmediate(r));
      return { signal: "SIGKILL", code: null };
    },
    log: (l) => console.log(`STAND-IN ${l}`),
  });
  const fails = res.steps.filter((s) => s.pass === false);
  console.log(`stand-in: ${res.steps.length} steps, ${fails.length} failed (${fails.map((s) => `${s.id} ${s.agent ?? ""}`).join(", ") || "none"}); ${awx.calls.length} rail calls (+1 login live)`);
} else if (cmd === "live") {
  const why = cardDrillRefusals(process.env);
  if (why.length) { for (const w of why) console.error(`REFUSED  ${w}`); process.exit(2); }
  const halted = drillHaltReason(httpLog());
  if (halted) { console.error(`REFUSED  this run is halted (${halted}); look at it before anything else is sent`); process.exit(2); }
  mkdirSync(runDir(), { recursive: true });
  const { openDb } = await import("../db/open.js");
  const db = openDb();
  const foreign = (db.prepare("SELECT nickname FROM cards").all() as { nickname: string }[]).filter((c) => !c.nickname.endsWith(`(${drill.CARD_DRILL_SUFFIX})`));
  if (foreign.length) { console.error(`REFUSED  this ledger holds cards that are not the drill's (${foreign.length}); use a fresh card-drill ledger`); process.exit(2); }
  const rail = await liveRail();
  const passNo = Number(process.env.CARD_DRILL_PASS ?? "1");
  const out = join(runDir(), `results-pass${passNo}.json`);
  const me = resolve(import.meta.dirname, "airwallexCardDrill.ts");
  const res = await drill.runCardDrill({
    db, rail, lines: () => readDrillLog(httpLog()), mode: "live", now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), halted: () => drillHaltReason(httpLog()),
    only: process.env.CARD_DRILL_ONLY ? new Set(process.env.CARD_DRILL_ONLY.split(",") as import("../e2e/cardDrill.js").Phase[]) : undefined, passNo,
    agents: process.env.CARD_DRILL_AGENTS ? (process.env.CARD_DRILL_AGENTS.split(",") as Agent[]) : undefined,
    crash: (kind, agent) => new Promise((done, fail) => {
      const child = spawn(process.execPath, ["--import", "tsx", me, "child", kind, agent], { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
      child.on("error", fail);
      child.on("exit", (code, signal) => done({ code, signal }));
    }),
    log: (l) => console.log(l),
    save: (r) => writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`),
  });
  const f = res.steps.filter((s) => s.pass === false).length;
  console.log(`SUMMARY  pass ${passNo}: ${res.steps.length} steps, ${res.steps.filter((s) => s.pass === true).length} passed, ${f} failed; ${readDrillLog(httpLog()).length} requests in the drill log${res.stopped ? `; STOPPED: ${res.stopped}` : ""}`);
} else if (cmd === "child") {
  const [kind, agent] = [args[1] as import("../e2e/cardDrill.js").CrashKind, args[2] as Agent];
  if (!["after-thaw", "thawed-before-ledger"].includes(kind) || !["sourcing", "support", "treasury"].includes(agent) || cardDrillRefusals(process.env).length) { console.error("usage: child after-thaw|thawed-before-ledger <agent> (started by live)"); process.exit(2); }
  const { openDb } = await import("../db/open.js");
  const db = openDb();
  const rail = await liveRail();
  console.log(`CHILD    ${kind} on the ${agent} card: thawing, then SIGKILL (pid ${process.pid})`);
  await drill.crashChild(db, rail, agent, kind, new Date(), () => { process.kill(process.pid, "SIGKILL"); return new Promise<never>(() => undefined); });
} else if (cmd === "record") {
  if (!drillLedger(process.env) || !process.env.AIRWALLEX_CALL_LOG) { console.error("REFUSED  KIT11_DB=…/card-drill*.sqlite and AIRWALLEX_CALL_LOG (this run's own files); nothing was read"); process.exit(2); }
  const { readCallLog } = await import("../airwallex/callBudget.js");
  const { drillRecord, renderDrillMarkdown } = await import("../e2e/drillRecord.js");
  const { cardDrillSummary, CARD_DRILL_SIMULATED, CARD_DRILL_NOT_SHOWN, CARD_DRILL_PASS_NOTES } = await import("../e2e/cardDrillRecord.js");
  const files = existsSync(runDir()) ? readdirSync(runDir()).filter((f) => /^results-pass\d\.json$/.test(f)).sort() : [];
  if (!files.length) { console.error(`no results in ${runDir()}: run live first`); process.exit(2); }
  const results = files.map((f) => JSON.parse(readFileSync(join(runDir(), f), "utf8")) as import("../e2e/cardDrill.js").CardDrillResults);
  const date = process.env.CARD_DRILL_DATE ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error("CARD_DRILL_DATE is YYYY-MM-DD"); process.exit(2); }
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(); } catch { return null; } })();
  const rec = drillRecord({
    run: "card-drill", date, command: "npm run airwallex:card-drill -- live", commit, simulated: CARD_DRILL_SIMULATED, max: drill.CARD_DRILL_MAX_BUDGET,
    approved: Number(process.env.AIRWALLEX_CALL_BUDGET ?? 0) || null, cards: results[0]!.cards,
    passes: results.map((r) => ({ pass_no: r.pass_no, started_at: r.started_at, ended_at: r.ended_at, stopped: r.stopped, note: CARD_DRILL_PASS_NOTES[r.pass_no] ?? null, phases: r.phases, code: r.code, steps: r.steps })),
    lines: readDrillLog(httpLog()), callLog: readCallLog(process.env.AIRWALLEX_CALL_LOG), notShown: CARD_DRILL_NOT_SHOWN,
  });
  const base = resolve(repo, "docs/runs", `${date}-card-drill`);
  writeFileSync(`${base}.json`, `${JSON.stringify(rec, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderDrillMarkdown(rec, { title: "Card drill", intro: "Agent cards frozen by default, checked against Airwallex: freeze, thaw, authorise, refreeze, per card, timed; the race inside a purchase window; a process killed between thaw and refreeze; duplicate and late webhooks.", file: `docs/runs/${date}-card-drill.json`, summary: cardDrillSummary(rec) }));
  console.log(`WROTE    ${base}.json\nWROTE    ${base}.md`);
} else {
  console.error("usage: npm run airwallex:card-drill -- stand-in | live | record");
  process.exit(2);
}
