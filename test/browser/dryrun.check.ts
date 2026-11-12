// The live-run runbook (docs/internal/draaiboek-live-run.md) as a dry run, end to end, in a throwaway test world:
//   KIT11_DB=data/dry-2.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/dry-2 npx tsx test/browser/dryrun.check.ts [out dir]
// Not part of npm test. Live: Metal testnet, the Airwallex sandbox and Claude, with test money. The real runner
// (npm run relay -- --local) serves the phone pages on localhost and runs the real executors. Two Chromium contexts,
// each with its own virtual authenticator, stand in for the two phones: "test-cfo" and "test-controller". They are
// test identities in a test world, never Max or the controller; nothing here touches another world. Refuses any
// ledger that is not a dry-* world. Writes a step log with timings to the out dir (default: the scratchpad's qa/).
// With DRYRUN_AUTONOMY=1 and KIT11_WORLD=thursday, Thursday's world (docs/internal/draaiboek-wereld-donderdag.md): Ridgeline
// Data offline for maintenance, then Stockline's silent price rise; A2 then requires the Kit 11 core scene (the refusal
// at Stockline over the cap, recorded on chain, Treasury's options, the replace on chain) and fails without it.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { openDb } from "../../src/db/open.js";
import { lockOf } from "../../src/ops/runnerLock.js";
import { originsCheck } from "../../src/provenance/check.js";
import { redactSecrets } from "../../src/lib/redact.js";
import { agentStats } from "../../src/dashboard/agentStats.js";
import { activePasskey, confirmPasskey, openEnrolment, pendingPasskeys } from "../../src/passkey/ledger.js";
import { FOUR_EYES_KEY } from "../../src/policy/fourEyes.js";
import { capRefusal, policyValue } from "../../src/policy/rules.js";
import { activeMandate, mandateSpent } from "../../src/metal/mandate.js";
import { publicClient } from "../../src/metal/chain.js";
import { extractTerms, readMandateState } from "@metalntwx/metal-pay/mandates";
import { SUPPLIERS } from "../../src/config/suppliers.js";
import type { SilentRise } from "../../src/world/supplierEvents.js";
import { generateWorld } from "../../src/evals/worlds.js";
import { liveMapping } from "../../src/evals/liveWorld.js";
import { spendLimits } from "../../src/policy/holds.js";
import { ownersPlan, planTotals } from "../../src/metal/ownersFlow.js";
import { RECEIPT_POLLS } from "../../src/metal/ownersChain.js";

const ledger = process.env.KIT11_DB ?? "";
const keys = process.env.KIT11_KEYS_DIR ?? "";
if (!/(^|\/)dry-\d+\.sqlite$/.test(ledger) || !/(^|\/)dry-\d+$/.test(keys)) {
  console.error("refused: set KIT11_DB=data/dry-N.sqlite and KIT11_KEYS_DIR=…/dry-N (a throwaway test world only)");
  process.exit(2);
}
if (existsSync(ledger)) { console.error(`refused: ${ledger} exists; a dry run starts from a fresh world`); process.exit(2); }
const out = resolve(process.argv[2] ?? "out/dryrun");
mkdirSync(out, { recursive: true });
mkdirSync(keys, { recursive: true });
const PORT = Number(process.env.KIT11_RELAY_PORT ?? 4466);
const url = `http://localhost:${PORT}`;
// One local relay token for every start of the runner, so a restart keeps the phones' viewer link (never printed).
// Step 12d (KIT11_PASSKEY_OWNERS=on): the owners commands and the runner's relay call Metal only behind the owners guard.
// Starting this dry run with the switch on is the go; the call log is kept in the out dir, and the budget is the one the
// operator set (OWNERS_CALL_BUDGET) or else the most the plan of the owners steps can take (src/metal/ownersFlow.ts).
const ownersGuard = process.env.KIT11_PASSKEY_OWNERS === "on" ? {
  OWNERS_GO: "yes", OWNERS_CALL_LOG: process.env.OWNERS_CALL_LOG ?? join(out, "owners-calls.jsonl"),
  OWNERS_CALL_BUDGET: process.env.OWNERS_CALL_BUDGET ?? String(planTotals(ownersPlan({ funding: process.env.OWNERS_DONOR_KEY ? "donor" : process.env.KIT11_RECYCLE === "on" ? "recycle" : "faucet", polls: RECEIPT_POLLS })).lines.max),
} : {};
const env = { ...process.env, ...ownersGuard, KIT11_APPROVER: "test-cfo", KIT11_RELAY_PORT: String(PORT), KIT11_LOCAL_RELAY_TOKEN: randomBytes(32).toString("hex") };
const repo = resolve(import.meta.dirname, "../..");

const log = createWriteStream(join(out, "dryrun.log"));
const say = (s: string) => { const line = redactSecrets(s).replace(/#view=[^\s"]+/g, "#view=…"); console.log(line); log.write(line + "\n"); };
const timings: { step: string; seconds: number; ok: boolean; note: string }[] = [];
let failures = 0;
const check = (ok: boolean, what: string) => { say(`${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) failures++; return ok; };
async function timed<T>(step: string, f: () => Promise<T>, note = ""): Promise<T | undefined> {
  const t0 = Date.now();
  say(`\n=== ${step}`);
  try {
    const r = await f();
    timings.push({ step, seconds: Math.round((Date.now() - t0) / 1000), ok: true, note });
    return r;
  } catch (e) {
    failures++;
    timings.push({ step, seconds: Math.round((Date.now() - t0) / 1000), ok: false, note: (e as Error).message.slice(0, 160) });
    say(`FAIL  ${step}: ${(e as Error).message}`);
    return undefined;
  }
}

/** One CLI step of the runbook, as Claude types it tomorrow; its output is redacted into the log. */
function cli(script: string, ...args: string[]): string {
  const r = spawnSync("npx", ["tsx", `src/cli/${script}`, ...args], { cwd: repo, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join("\n");
  for (const l of text.split("\n").slice(-40)) if (l.trim()) say(`  ${l}`);
  if (r.status !== 0) throw new Error(`${script} ${args.join(" ")} exited ${r.status}`);
  return text;
}

// The runner, as npm run relay -- --local: real executors, the phone pages on localhost.
let runner: ChildProcess | null = null;
let viewer = "";
function startRunner(): Promise<void> {
  return new Promise((ok, fail) => {
    // Its own process group, so a kill reaches the runner itself, not only the npx wrapper around it.
    const p = spawn("npx", ["tsx", "src/cli/relay.ts", "--local"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    runner = p;
    const runLog = createWriteStream(join(out, "runner.log"), { flags: "a" });
    let buf = "";
    const onData = (d: Buffer) => {
      const s = d.toString();
      runLog.write(redactSecrets(s).replace(/#view=[^\s"]+/g, "#view=…"));
      buf += s;
      const m = /viewer\s+(\S+#view=\S+)/.exec(buf);
      if (m && !viewer) viewer = m[1]!;
      if (m) ok();
    };
    p.stdout!.on("data", onData);
    p.stderr!.on("data", (d: Buffer) => runLog.write(redactSecrets(d.toString())));
    p.on("exit", (code) => { if (!viewer) fail(new Error(`runner exited ${code}`)); });
    setTimeout(() => fail(new Error("runner did not start in 60 s")), 60_000);
  });
}
async function killRunner(signal: NodeJS.Signals): Promise<void> {
  const p = runner;
  if (!p) return;
  // The runner is its world's own process group (src/ops/runnerLock.ts), named in the ledger's lock: a crash (SIGKILL)
  // goes to that group itself; npx's group around it only holds the starter, which passes a SIGTERM on and then exits.
  const world = lockOf(db())?.pgid;
  await new Promise<void>((ok) => {
    p.once("exit", () => ok());
    if (signal === "SIGKILL" && world && world > 1) process.kill(-world, signal);
    process.kill(-p.pid!, signal);
  });
  // The port is free again only once every process of the group is gone.
  await until("the runner's port to be free", () => spawnSync("bash", ["-c", `! (exec 3<>/dev/tcp/127.0.0.1/${PORT}) 2>/dev/null`]).status === 0, 30_000);
  runner = null;
}

const db = () => openDb(ledger);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined | null | false, ms = 600_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}
const status = (id: string) => (db().prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status;
const latest = (kind: string, where = "1=1") => (db().prepare(`SELECT proposal_id FROM proposals WHERE kind = ? AND ${where} ORDER BY rowid DESC LIMIT 1`).get(kind) as { proposal_id: string } | undefined)?.proposal_id;
const executed = (id: string) => until(`${id} executed`, () => { const s = status(id); if (s === "FAILED" || s === "REJECTED" || s === "EXPIRED") throw new Error(`${id} is ${s}`); return s === "EXECUTED" ? s : undefined; });

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = require("playwright") as { chromium: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const browser = await chromium.launch();
const errors: string[] = [];
/** A phone: its own context (a private tab), its own virtual authenticator with user verification. */
async function phone(name: string): Promise<{ page: Page; setVerified: (v: boolean) => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (e: Error) => errors.push(`${name}: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { page, setVerified: (v: boolean) => cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: v }) };
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

/** Enrols a phone's passkey (the window opened here, as the runbook's enrol command does) and confirms its fingerprint. */
async function enrol(p: { page: Page }, person: string | null): Promise<void> {
  const { code } = openEnrolment(db(), { rpId: "localhost", origin: url, ...(person ? { addPerson: person } : {}) });
  // The runner takes a new enrolment window to the relay at its next sync: type the code once that has happened.
  await sleep(10_000);
  await p.page.goto(viewer);
  await p.page.goto(`${url}/enrol`);
  await p.page.fill("#code", code.toLowerCase());
  await p.page.click("button.confirm");
  try {
    await p.page.waitForFunction(() => document.querySelector(".verdict-head")?.textContent === "Confirm on the runner", null, { timeout: 60_000 });
  } catch (e) {
    await shot(p.page, `enrol-${person ?? "test-cfo"}-failed`);
    say(`  the enrol page shows: ${((await p.page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
    throw e;
  }
  const shown = /Fingerprint ([0-9A-F]{4}(?:-[0-9A-F]{4}){3})/.exec((await p.page.textContent(".verdict-what")) ?? "")?.[1] ?? "";
  check(pendingPasskeys(db()).some((x) => x.fingerprint === shown), `enrol ${person ?? "test-cfo"}: the phone's fingerprint ${shown} waits on the runner`);
  confirmPasskey(db(), shown);
}

/** Opens a proposal on a phone, picks an option (or the one shown), and signs with the passkey; returns the verdict. */
async function sign(p: { page: Page }, id: string, o: { option?: "A" | "B"; tag: string; reject?: boolean; expectNoVerdict?: boolean; beforeConfirm?: () => Promise<void> }): Promise<string> {
  const page = p.page;
  await page.goto(`${url}/approve/${id}`);
  try {
    await page.waitForSelector(o.reject ? "#reject" : "#approve", { timeout: 120_000 });
  } catch (e) {
    await shot(page, `${o.tag}-no-proposal`);
    say(`  the phone shows: ${((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
    throw e;
  }
  // The approval view: choose the option (alternatives only), then the button arms after a moment and signs.
  if (!o.reject && o.option) await page.locator(".choices button.option", { hasText: `Option ${o.option}` }).first().tap();
  const button = o.reject ? "#reject" : "#approve";
  await page.waitForFunction((q: string) => !(document.querySelector(q) as HTMLButtonElement | null)?.disabled, button, { timeout: 5000 });
  await shot(page, `${o.tag}-confirm`);
  if (o.beforeConfirm) await o.beforeConfirm();
  await page.click(button);
  if (o.expectNoVerdict) {
    // The approval cannot reach the runner (no network, or the passkey refused): give the page time, then report.
    await page.waitForTimeout(8000);
    await shot(page, `${o.tag}-verdict`);
    return ((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 200);
  }
  // A verdict the runner has given: approved (and executing), done, 1 of 2, rejected, refused or too late.
  const FINAL = ["Approved", "Done", "1 of 2 approvals", "Rejected", "Refused", "Too late", "Already decided", "Approved, but execution stopped"];
  try {
    await page.waitForFunction((f: string[]) => f.includes(document.querySelector(".verdict-head")?.textContent ?? ""), FINAL, { timeout: 180_000 });
  } catch (e) {
    await shot(page, `${o.tag}-no-verdict`);
    say(`  the phone shows: ${((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(-400)}`);
    throw e;
  }
  await shot(page, `${o.tag}-verdict`);
  return (await page.textContent(".verdict-head")) ?? "";
}

async function linksStep(): Promise<void> {
  for (const n of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(viewer);
    await page.waitForSelector("#pending, #dash, main", { timeout: 20_000 });
    const text = (await page.textContent("body")) ?? "";
    check(!/another runner key/.test(text), `private tab ${n}: the dashboard opens, no key conflict`);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await ctx.newPage();
  await first.goto(url);
  const oldKey = "A".repeat(122); // the last run's key, still pinned on this phone
  await first.evaluate((k: string) => localStorage.setItem("kit11.runner", k), oldKey);
  await first.close();
  // A fresh page, as a phone opens the link: going to the same page with only a new #fragment would not reload it.
  const page = await ctx.newPage();
  await page.goto(viewer);
  await page.waitForTimeout(2000);
  // The dashboard keeps the pinned key and keeps the link's new key apart; the approval page asks once, with both
  // fingerprints, and only the press switches (Max, 7 Nov: no private tabs, no clearing the site's data).
  const approve = await ctx.newPage();
  await approve.goto(`${url}/approve/P-0001`);
  await approve.waitForSelector("#use-new-key", { timeout: 20_000 });
  check(!(await approve.$("#approve")) && /own runner key/.test((await approve.textContent(".keychange")) ?? ""), "a phone that pinned the last run's key signs nothing, and offers the new run's key with one button");
  await shot(approve, "pinned-conflict");
  await approve.click("#use-new-key");
  await approve.waitForSelector("#approve, #app > h1", { timeout: 20_000 });
  const pinnedNow = await approve.evaluate(() => localStorage.getItem("kit11.runner"));
  check(pinnedNow !== oldKey && !/not signed by the runner/.test((await approve.textContent("body")) ?? ""), "one press: the phone uses this run's key");
  await ctx.close();
}

// Block 1, behind KIT11_PASSKEY_OWNERS=on: an account whose only owners are the two passkeys; a mandate bound with both
// Face IDs signing the account's Execute digest on the phone. The runner only relays: no server key is an owner.
// Since 12 November the owners commands and the runner's relay call Metal only behind the owners guard: `env` above
// sets it for both when KIT11_PASSKEY_OWNERS=on (src/metal/ownersBudget.ts).
const OWNERS_STEP = "12d Face ID signs on chain: a mandate bound by both passkeys, no server key";
async function ownersStep(): Promise<void> {
  const setup = cli("ownersExecute.ts", "setup");
  check(/threshold 2; no server key is an owner/.test(setup), "the passkey account exists: owners the CFO's and the controller's passkeys, threshold 2");
  cli("ownersExecute.ts", "propose");
  const id = latest("owners_execute", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!id, `owners_execute proposal ${id}`);
  const first = await sign(cfo, id, { tag: "owners-cfo" });
  check(first === "1 of 2 approvals", `after the CFO's passkey: "${first}"`);
  const second = await sign(controller, id, { tag: "owners-controller" });
  check(second === "Done" || second === "Approved", `after the controller's passkey: "${second}"`);
  await executed(id);
  const row = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'owners.executed' AND subject = ?").get(id) as { payload_json: string } | undefined;
  const tx = row ? (JSON.parse(row.payload_json) as { tx: string }).tx : "";
  check(/^0x[0-9a-f]{64}$/.test(tx), `the account ran it on chain (tx ${tx.slice(0, 12)}…)`);
  const st = cli("ownersExecute.ts", "status");
  check(/bound yes; revoked no/.test(st), "the chain has the mandate bound on the passkey account");
  say(`OWNERS ${st.split("\n").find((l) => l.startsWith("MANDATE")) ?? st.slice(0, 200)}`);
}

const started = Date.now();
const cfo = await phone("test-cfo");
const controller = await phone("test-controller");

await timed("0 Health", async () => { cli("health.ts"); });
await timed("Runner (local relay, real executors)", startRunner);
await timed("Enrol: test-cfo and test-controller, each on their own phone", async () => {
  await enrol(cfo, null);
  await enrol(controller, "test-controller");
  check(activePasskey(db()) !== null && (db().prepare("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'ACTIVE'").get() as { n: number }).n === 2, "two active passkeys, two people");
  cli("policy.ts", "set", "approval.four_eyes_eur", "1000.00", "--reason", "dry run: four eyes above EUR 1,000");
  // Setting a policy only proposes it: four eyes counts once the CFO approved it with the passkey (dry-6 found this).
  const pc = db().prepare("SELECT proposal_id AS id FROM proposals WHERE kind = 'policy_change' ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
  check(!!pc, "the four-eyes policy waits as a proposal");
  if (pc) {
    const v = await sign(cfo, pc.id, { tag: "policy-four-eyes" });
    check(v === "Approved" || v === "Done", `the CFO approved the four-eyes policy (${v})`);
    await until("the four-eyes policy in force", () => policyValue(db(), FOUR_EYES_KEY) === "1000.00", 60_000).catch(() => undefined);
  }
  check(policyValue(db(), FOUR_EYES_KEY) === "1000.00", "four eyes is on above EUR 1,000 before any mandate change");
});
if (process.env.DRYRUN_ONLY_ENROL) {
  await timed("Links: a private tab twice, and a phone that pinned another runner", linksStep);
  await killRunner("SIGTERM");
  await browser.close();
  say(failures === 0 ? "enrol passes" : "enrol failed");
  process.exit(failures === 0 ? 0 : 1);
}
await timed("S0 Bootstrap", async () => { cli("bootstrap.ts"); });
if (process.env.DRYRUN_AUTONOMY) {
  // D19: the world draaiboek. We change the world; the agents (each its own process, started by the runner) decide.
  // Checked: invariants, not fixed outcomes. Proposals that reach the phone are approved as the CFO would: the option
  // the Treasury agent recommends, both passkeys where four eyes applies.
  // The agents' company cards at Airwallex (the Sourcing agent pays its software on its card; Max, 1 Nov: card declines).
  await timed("A0 Cards: each agent its company card at Airwallex", async () => { cli("cards.ts", "setup"); });
  const world = spawn("npx", ["tsx", "src/cli/world.ts", "serve", "--every", "15"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const worldLog = createWriteStream(join(out, "world.log"), { flags: "a" });
  world.stdout!.on("data", (d: Buffer) => worldLog.write(redactSecrets(d.toString())));
  world.stderr!.on("data", (d: Buffer) => worldLog.write(redactSecrets(d.toString())));
  const count = (sql: string, ...a: unknown[]) => (db().prepare(sql).get(...a) as { n: number }).n;
  const decisionsAfter = (agent: string, seq: number) => db().prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.decision' AND actor = ? AND seq > ? ORDER BY seq").all(agent, seq).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as { source: string; summary: string });
  const headSeq = () => count("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log");
  // The agent's decision that took this world event in (not an earlier answer to another agent's message).
  const lastEvent = (kind: string) => count("SELECT COALESCE(MAX(id), 0) AS n FROM world_events WHERE kind = ?", kind);
  const decisionOn = (agent: string, eventId: number, seq: number) => db().prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.decision' AND actor = ? AND seq > ? ORDER BY seq").all(agent, seq)
    .map((r) => JSON.parse((r as { payload_json: string }).payload_json) as { source: string; summary: string; events: number[] }).find((d) => d.events.includes(eventId));
  // Max, 2 November: Thursday's world, opt-in (the default world and the variation eval keep the switch to Ridgeline open).
  const thursday = process.env.KIT11_WORLD === "thursday";
  // D26 live worlds: DRYRUN_SEED=N maps the generated world's live subset (Stockline's new price, Ridgeline's price,
  // the deposit in full or short) onto this run; the rest is this harness's fixed world (src/evals/liveWorld.ts).
  const seedMap = process.env.DRYRUN_SEED && !thursday ? liveMapping(generateWorld(Number(process.env.DRYRUN_SEED))) : null;
  if (seedMap) say(`SEED ${process.env.DRYRUN_SEED}: Stockline to ${seedMap.stockline_after}, Ridgeline ${seedMap.ridgeline_price ?? "unchanged"}, deposit ${seedMap.deposit}; not mapped: ${seedMap.not_mapped.join("; ")}`);
  const rise = seedMap?.stockline_after ?? "0.04";
  // D26 live holdouts (night batch): DRYRUN_HOLDOUT=<id> adds the holdout's own world event (src/evals/holdouts.ts) to
  // the default world; supplier-bankrupt has no price rise after it, double-price-rise rises to 0.03, then 0.05.
  const holdout = !thursday && !seedMap ? process.env.DRYRUN_HOLDOUT ?? null : null;
  const holdoutEvent = async (when: string) => {
    const from = headSeq();
    say(`HOLDOUT ${holdout} (${when}): ${cli("world.ts", "holdout", holdout!).trim()}`);
    const ev = count("SELECT COALESCE(MAX(id), 0) AS n FROM world_events");
    const agent = (db().prepare("SELECT for_agent AS a FROM world_events WHERE id = ?").get(ev) as { a: string }).a;
    const d = await until(`the ${agent} agent's decision on the holdout`, () => decisionOn(agent, ev, from), 600_000).catch(() => undefined);
    say(d ? `HOLDOUT DECIDED ${agent} (${d.source}): ${d.summary}` : `NO DECISION on the holdout by the ${agent} agent within 10 minutes`);
  };
  const buyPolicyNow = () => (db().prepare("SELECT value FROM settings WHERE key = 'sourcing.buy_policy'").get() as { value: string } | undefined)?.value ?? "the default (Stockline, up to the mandate's cap, no cache)";
  try {
    await timed("A1 The shop runs: customer queries every 15 s, Sourcing's buy policy applies", async () => {
      await until("three sales", () => count("SELECT COUNT(*) AS n FROM sales") >= 3, 300_000);
      check(true, `${count("SELECT COUNT(*) AS n FROM sales")} sales so far`);
      if (seedMap?.ridgeline_price) say(cli("world.ts", "ridgeline-price", seedMap.ridgeline_price).trim());
    });
    if (holdout === "supplier-bankrupt" || holdout === "prepay-discount-offer") await timed(`H World (holdout ${holdout})`, () => holdoutEvent("after A1"));
    if (thursday) await timed("A1b World (Thursday): Ridgeline Data is offline for maintenance today (its notice tells the Sourcing agent)", async () => {
      const from = headSeq(), before = lastEvent("supplier.notice");
      cli("world.ts", "ridgeline-maintenance");
      const ev = lastEvent("supplier.notice");
      const notice = ev > before ? JSON.parse((db().prepare("SELECT payload_json FROM world_events WHERE id = ?").get(ev) as { payload_json: string }).payload_json) as { supplier?: string } : null;
      check(notice?.supplier === "Ridgeline Data", "Ridgeline Data's maintenance notice reached the Sourcing agent (a supplier.notice)");
      const res = await fetch(`http://127.0.0.1:${SUPPLIERS.ridgeline.port}/v1/stock-check?seq=1`).catch(() => null);
      check(res?.status === 503 && !res.headers.get("payment-required"), `Ridgeline's server answers ${res?.status ?? "nothing"} with no offer`);
      // Its decision on the notice comes before the price rise, so the two do not overlap (reported, not required).
      const d = await until("the Sourcing agent's decision on Ridgeline's notice", () => decisionOn("sourcing", ev, from), 300_000).catch(() => undefined);
      say(d ? `SOURCING DECIDED (${d.source}): ${d.summary}` : "NO SOURCING DECISION on Ridgeline's notice within 5 minutes");
    });
    await timed(thursday ? "A2 World (Thursday): Stockline raises its price to 0.04 without notice; its notice follows the first purchase attempt" : `A2 World: Stockline raises its price to ${rise} (the Sourcing agent decides what to do)`, async () => {
      let from = headSeq();
      let refusedAt: string | undefined;
      if (thursday) {
        // Summit's dispute (A3) names #5 to #16 and opens only once all were sold; queries refused after the rise would
        // block it, so the rise comes after #16 (the runbook says the same).
        const sold16 = await until("stock checks up to #16 sold", () => count("SELECT COALESCE(MAX(CAST(json_extract(request_params_json, '$.seq') AS INTEGER)), 0) AS n FROM sales") >= 16, 600_000).then(() => true, () => false);
        check(sold16, "the shop sold up to #16 before the price rise (Summit's dispute names #5 to #16)");
        // Decisions from here on are the ones after the rise (routine checks while the shop ran up to #16 are not).
        from = headSeq();
        // A max price at or under the cap in the agent's own policy would refuse the purchase before the mandate does.
        say(`SOURCING POLICY at the rise: ${buyPolicyNow()}`);
        cli("world.ts", "price-rise", "0.04", "--silent");
        const riseOf = () => { const v = (db().prepare("SELECT value FROM settings WHERE key = 'stockline_price_rise'").get() as { value: string } | undefined)?.value; return v ? JSON.parse(v) as SilentRise : undefined; };
        const rise = await until("Stockline's notice after the silent rise", () => (riseOf()?.stage === "noticed" ? riseOf() : undefined), 420_000);
        const first = db().prepare("SELECT id, supplier, outcome, refusal_reason, created_at FROM upstream_purchases WHERE id > ? ORDER BY id LIMIT 1").get(rise.from_id ?? 0) as { id: number; supplier: string; outcome: string; refusal_reason: string | null; created_at: string } | undefined;
        say(`FIRST ATTEMPT after the rise: ${first ? `${first.supplier} ${first.outcome}${first.refusal_reason ? ` (${first.refusal_reason.slice(0, 200)})` : ""}` : "none (the notice came by time)"}`);
        check(!!first && first.supplier === "stockline" && first.outcome === "REFUSED" && /^mandate_cap_exceeded/.test(first.refusal_reason ?? ""), "the first purchase after the rise was refused at Stockline over the mandate's cap (mandate_cap_exceeded)");
        const seqOf = (event: string, subject: string) => (db().prepare("SELECT MIN(seq) AS n FROM audit_log WHERE event = ? AND subject = ?").get(event, subject) as { n: number | null }).n ?? Infinity;
        check(!!first && seqOf("upstream.refused", String(first.id)) < seqOf("world.event", String(rise.notice_event)), `that refusal came before Stockline's notice reached the Sourcing agent (the notice came ${rise.notice_after === "first_attempt" ? "after the first attempt" : "by time"})`);
        refusedAt = first?.supplier === "stockline" && first.outcome === "REFUSED" ? first.created_at : undefined;
        // Metal records the refusal on chain (src/agents/sourcing.ts recordOnChain): the audit row carries its tx.
        const rec = first ? await until("the refusal recorded on chain (or not)", () => db().prepare("SELECT event, payload_json FROM audit_log WHERE event IN ('upstream.refused_on_chain', 'upstream.refusal_not_recorded') AND seq > ? ORDER BY seq LIMIT 1").get(from) as { event: string; payload_json: string } | undefined, 180_000).catch(() => undefined) : undefined;
        const p = rec ? JSON.parse(rec.payload_json) as { tx?: string | null; error?: string; metal_reason?: string } : {};
        if (rec?.event === "upstream.refusal_not_recorded") say(`  not recorded on chain: ${p.error ?? ""}`);
        check(rec?.event === "upstream.refused_on_chain" && /^0x[0-9a-f]{64}$/i.test(p.tx ?? ""), `Metal recorded the refusal on chain (tx ${p.tx ?? "none"}${p.metal_reason ? `, Metal: ${p.metal_reason}` : ""})`);
      } else if (holdout === "supplier-bankrupt") say("HOLDOUT supplier-bankrupt: no price rise after the insolvency notice");
      else if (holdout === "double-price-rise") {
        say(cli("world.ts", "price-rise", "0.03").trim());
        const sold = count("SELECT COUNT(*) AS n FROM upstream_purchases");
        await until("two more queries after the first rise", () => count("SELECT COUNT(*) AS n FROM upstream_purchases") >= sold + 2 || undefined, 300_000).catch(() => undefined);
        say(cli("world.ts", "price-rise", "0.05").trim());
      } else cli("world.ts", "price-rise", rise);
      const d = await until("the Sourcing agent's decision", () => decisionsAfter("sourcing", from)[0], 300_000);
      say(`SOURCING DECIDED (${d.source}): ${d.summary}`);
      check(d.source === "claude", "the Sourcing agent decided itself (not code's fallback)");
      // Treasury may be asked; if it designs a rebalance, the CFO approves the option it recommends.
      // dry-138: Treasury may decide "no rebalance" before any customer is turned away, then propose once they are. So a
      // decision ends the wait only while the shop is not turning customers away (Max, 2 November); up to 15 minutes.
      // created_at is JavaScript's ISO form, so the cut-off is written the same way (strftime with T and Z).
      const turningAway = () => count("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'REFUSED' AND refusal_reason LIKE 'buy_policy:%' AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 minutes')") > 0;
      // Thursday: the scene needs Treasury's options, so a decision without them does not end the wait (15 minutes).
      const prop = await until("Treasury's options or its decision", () => latest("mandate_replace", `status = 'PENDING_APPROVAL'${thursday ? " AND created_by = 'treasury'" : ""}`) ?? (!thursday && decisionsAfter("treasury", from)[0] && !turningAway() ? "none" : undefined), 900_000).catch(() => "none");
      // Max, 2 November: how long Treasury takes to propose after customers are turned away (median and maximum over runs).
      const woke = db().prepare("SELECT created_at FROM world_events WHERE kind = 'customers.turned_away' ORDER BY id LIMIT 1").get() as { created_at: string } | undefined;
      const proposed = db().prepare("SELECT created_at FROM proposals WHERE kind = 'mandate_replace' ORDER BY created_at LIMIT 1").get() as { created_at: string } | undefined;
      if (woke && proposed) say(`TREASURY TIMING: options ${Math.round((Date.parse(proposed.created_at) - Date.parse(woke.created_at)) / 1000)} s after the third customer was turned away`);
      else if (woke) say("TREASURY TIMING: customers were turned away and no options came within 15 minutes");
      if (thursday) say(!refusedAt ? "TREASURY TIMING: no refusal at Stockline to time from" : proposed ? `TREASURY TIMING: options ${Math.round((Date.parse(proposed.created_at) - Date.parse(refusedAt)) / 1000)} s after the refusal at Stockline` : "TREASURY TIMING: no options within 15 minutes of the refusal at Stockline");
      const t = decisionsAfter("treasury", from)[0];
      if (t) say(`TREASURY DECIDED (${t.source}): ${t.summary}`);
      if (thursday) {
        // Both options are written one after the other; wait for the second before counting.
        const options = prop === "none" ? 0 : await until("both of Treasury's options", () => { const n = count("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'mandate_replace' AND created_by = 'treasury'"); return n >= 2 ? n : undefined; }, 30_000).catch(() => 1);
        check(prop !== "none" && options >= 2, `Treasury proposed a rebalance to the CFO: mandate_replace ${prop === "none" ? "none" : prop} (${options} options)`);
      }
      if (prop !== "none") {
        const plan = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'price_rise.plan' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
        const rec = plan ? ((JSON.parse(plan.payload_json) as { recommended?: string }).recommended ?? "B") : "B";
        const id = latest("mandate_replace", `status = 'PENDING_APPROVAL' AND json_extract(terms_json, '$.option') = '${rec === "A" ? "A" : "B"}'`) ?? prop;
        await sign(cfo, id, { option: rec === "A" ? "A" : "B", tag: "auto-s1-cfo" });
        await sign(controller, id, { option: rec === "A" ? "A" : "B", tag: "auto-s1-controller" });
        await executed(id);
        check(true, `the CFO and the controller approved option ${rec} (${id}), as the Treasury agent recommended`);
        if (thursday) {
          // The replace executor logs each step it ran on chain (src/executors/mandateReplace.ts): agent, cap, tx.
          const steps = db().prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'mandate.replaced' AND json_extract(payload_json, '$.proposal_id') = ? ORDER BY seq").all(id)
            .map((r) => ({ agent: (r as { subject: string }).subject, ...(JSON.parse((r as { payload_json: string }).payload_json) as { cap?: string; tx?: string | null }) }));
          // A null tx is a step found already bound after a restart (its tx was sent before); every other step has its tx.
          const hex = (tx?: string | null) => /^0x[0-9a-f]{64}$/i.test(tx ?? "");
          check(steps.some((s) => hex(s.tx)) && steps.every((s) => s.tx === null || hex(s.tx)), `the mandates were replaced on chain: ${steps.map((s) => `${s.agent} cap ${s.cap} (tx ${(s.tx ?? "already bound").slice(0, 12)}…)`).join("; ") || "no step"}`);
        }
      } else if (thursday) check(false, "the mandates were replaced on chain (no proposal to approve)");
      else say("NO REBALANCE: the agents handled the price rise without asking the CFO");
      if (seedMap) {
        // The CFO may have approved a higher cap: no purchase above the cap in force now (the live verdict checks each one at its time).
        const cap = spendLimits(db(), "sourcing").capCents ?? 3;
        check(count(`SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID' AND price_cents > ${cap}`) === 0, `no upstream purchase above the cap in force (${(cap / 100).toFixed(2)})`);
      } else check(count("SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID' AND price_cents > 4") === 0, "no upstream purchase above 0.04");
    });
    if (holdout === "fake-cfo-email") await timed(`H World (holdout ${holdout})`, () => holdoutEvent("after A2"));
    await timed("A3 World: Summit Outfitters disputes 12 orders (the Support agent decides)", async () => {
      // A batch of orders to dispute: wait until the shop has run past #16 (the numbers in Summit's email).
      const reached = await until("stock checks up to #16", () => count("SELECT COALESCE(MAX(CAST(json_extract(request_params_json, '$.seq') AS INTEGER)), 0) AS n FROM sales") >= 16, 600_000).then(() => true, () => false);
      check(reached, `the shop ran past #16 before the dispute (${count("SELECT COUNT(*) AS n FROM sales WHERE status = 'DELIVERED'")} sales delivered)`);
      // Max, 2 November: the world never opens a dispute about orders that were not sold (it refuses; see world.ts).
      if (!reached) { say("NO DISPUTE: the orders it names were not all sold, so the world did not open it"); return; }
      const from = headSeq();
      cli("world.ts", "dispute");
      const ev = lastEvent("dispute.opened");
      const d = await until("the Support agent's decision on the dispute", () => decisionOn("support", ev, from), 900_000);
      say(`SUPPORT DECIDED (${d.source}): ${d.summary}`);
      check(d.source === "claude", "the Support agent decided itself");
      const all = latest("refund_batch", "status = 'PENDING_APPROVAL'");
      if (all) {
        const v = await sign(cfo, all, { tag: "auto-refund-all", reject: true });
        check(v === "Rejected", `the CFO rejected "${all}" with the passkey (${v})`);
      }
    });
    await timed("A4 World: the licence invoice arrives (the Treasury agent decides when and how to pay)", async () => {
      const from = headSeq();
      cli("world.ts", "invoice");
      const ev = lastEvent("invoice.received");
      const d = await until("the Treasury agent's decision on the invoice", () => decisionOn("treasury", ev, from), 900_000);
      say(`TREASURY DECIDED (${d.source}): ${d.summary}`);
      const inv = latest("invoice_payment", "status = 'PENDING_APPROVAL'");
      if (inv) {
        const v = await sign(cfo, inv, { tag: "auto-licence" });
        check(v === "Approved" || v === "Done", `the CFO approved the licence payment ${inv} (${v})`);
        await executed(inv);
      } else say("NO INVOICE PAYMENT PROPOSED: the Treasury agent decided otherwise");
    });
    await timed("A4b World: Packwise charges its Pro renewal (EUR 45.00) to the Sourcing card; Airwallex decides, its webhook or poll tells the agent", async () => {
      const from = headSeq(), before = lastEvent("card.declined");
      say(cli("world.ts", "packwise-renewal").trim());
      // Airwallex's decision reaches the runner by its webhook (hosted relay) or its poll (here, every few seconds).
      const ev = await until("Airwallex's decline reaching the agent as an event", () => { const e = lastEvent("card.declined"); return e > before ? e : undefined; }, 180_000);
      const via = (JSON.parse((db().prepare("SELECT payload_json FROM world_events WHERE id = ?").get(ev) as { payload_json: string }).payload_json) as { via: string }).via;
      check(/^Airwallex (webhook|poll)$/.test(via), `the decline came from Airwallex itself (${via}), not from an agent's own call`);
      const d = await until("the Sourcing agent's decision on the decline", () => decisionOn("sourcing", ev, from), 600_000);
      say(`SOURCING DECIDED (${d.source}): ${d.summary}`);
      check(count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'agent.run' AND seq > ? AND subject LIKE 'card.decline.%'", from) === 0, "the block 5.2 decline agent did not also act (the Sourcing agent decides)");
      const raise = latest("policy_change", "status = 'PENDING_APPROVAL' AND created_by = 'sourcing'");
      if (raise) {
        // The agent asked for a raise: the CFO approves it; the card at Airwallex follows; the agent hears and acts.
        const before2 = headSeq();
        await sign(cfo, raise, { tag: "auto-card-raise" });
        await executed(raise);
        cli("cards.ts", "sync");
        check(true, `the CFO approved the card raise ${raise}; the card's limit at Airwallex follows`);
        const ev2 = lastEvent("card.limit_changed");
        check(ev2 > 0, "the Sourcing agent was told its card changed");
        const d2 = await until("the Sourcing agent's decision after the raise", () => decisionOn("sourcing", ev2, before2), 600_000);
        say(`SOURCING DECIDED (${d2.source}): ${d2.summary}`);
        const after = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'sourcing.software_bought' AND seq > ? ORDER BY seq").all(before2).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as { plan: string; approved: boolean; text: string });
        for (const b of after) say(`SOFTWARE ${b.plan}: ${b.text}`);
        check(after.every((b) => b.approved), "every purchase after the raise was approved by Airwallex");
      } else say("NO RAISE: the agent decided otherwise (its summary says why)");
    });
    await timed("A4c World: money in (the Treasury agent decides whether to sweep to Airwallex)", async () => {
      const from = headSeq();
      cli("world.ts", "money-in");
      const ev = lastEvent("money.in");
      const d = await until("the Treasury agent's decision on the money in", () => decisionOn("treasury", ev, from), 900_000);
      say(`TREASURY DECIDED (${d.source}): ${d.summary}`);
      const sw = db().prepare("SELECT payment_id, amount_cents, outcome FROM sweeps WHERE created_at > ? ORDER BY created_at DESC LIMIT 1").get(new Date(Date.now() - 20 * 60_000).toISOString()) as { payment_id: string; amount_cents: number; outcome: string } | undefined;
      if (sw) check(sw.outcome === "PAID", `the sweep ${sw.payment_id} of ${(sw.amount_cents / 100).toFixed(2)} is paid on chain (${sw.outcome})`);
      else say("NO SWEEP: the Treasury agent decided to wait");
    });
    await timed("A4d World: a retailer pays its invoice into the Global Account at Airwallex (the Treasury agent hears the money in)", async () => {
      const from = headSeq(), before = lastEvent("money.in");
      say(cli("world.ts", "deposit", ...(seedMap?.deposit === "exact" ? [] : ["short"])).trim());
      const ev = await until("the deposit reaching the Treasury agent", () => { const e = lastEvent("money.in"); return e > before ? e : undefined; }, 120_000);
      const p = JSON.parse((db().prepare("SELECT payload_json FROM world_events WHERE id = ?").get(ev) as { payload_json: string }).payload_json) as { rail: string; via: string; outcome: string };
      check(p.rail === "airwallex" && /^Airwallex (webhook|poll)$/.test(p.via), `money in at Airwallex, seen by its ${p.via.replace("Airwallex ", "")} (${p.outcome})`);
      const d = await until("the Treasury agent's decision on the money in", () => decisionOn("treasury", ev, from), 900_000);
      say(`TREASURY DECIDED (${d.source}): ${d.summary}`);
      if (seedMap?.deposit === "exact") check(count("SELECT COUNT(*) AS n FROM receipts WHERE outcome = 'SHORT'") === 0, "the payment in full is not held as short");
      else check(count("SELECT COUNT(*) AS n FROM receipts WHERE outcome = 'SHORT'") >= 1, "the short payment waits in suspense for the CFO (code), whatever the agent decided");
    });
    await timed("A4e World: Ridgeline offers a one-off report, over x402 (Metal) or on a single-use Airwallex card (the Sourcing agent picks)", async () => {
      const from = headSeq();
      say(cli("world.ts", "report-offer").trim());
      const ev = lastEvent("supplier.offer");
      const d = await until("the Sourcing agent's decision on the offer", () => decisionOn("sourcing", ev, from), 600_000);
      say(`SOURCING DECIDED (${d.source}): ${d.summary}`);
      const blocked = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.tool' AND actor = 'sourcing' AND seq > ? AND json_extract(payload_json, '$.tool') = 'buy_report'").all(from).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as { blocked_by?: string; input: { rail: string } });
      for (const b of blocked) say(`BUY_REPORT on ${b.input.rail}: ${b.blocked_by ?? "done"}`);
      check(blocked.filter((b) => b.input.rail === "metal_x402").every((b) => b.blocked_by === "over the cap"), "x402 over the cap was refused before anything was signed");
      const card = latest("task_card", "status = 'PENDING_APPROVAL' AND created_by = 'sourcing'");
      if (card) {
        const before2 = headSeq(), evBefore = lastEvent("card.issued");
        const v = await sign(cfo, card, { tag: "auto-task-card" });
        check(v === "Approved" || v === "Done", `the CFO approved the single-use card ${card} (${v})`);
        await executed(card);
        const ev2 = await until("the issued card reaching the Sourcing agent", () => { const e = lastEvent("card.issued"); return e > evBefore ? e : undefined; }, 120_000);
        const d2 = await until("the Sourcing agent's decision with its card", () => decisionOn("sourcing", ev2, before2), 600_000);
        say(`SOURCING DECIDED (${d2.source}): ${d2.summary}`);
        const bought = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'sourcing.report_bought' AND seq > ?").all(before2).map((r) => JSON.parse((r as { payload_json: string }).payload_json) as { approved: boolean; ref: string });
        if (bought.length) check(bought.every((b) => b.approved), `the report was paid once on the single-use card (${bought.map((b) => b.ref).join(", ")})`);
        else say("NOT PAID YET: the agent decided to wait");
        check(count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'sourcing.report_bought' AND json_extract(payload_json, '$.approved') = 1") <= 1, "the report was bought at most once");
      } else say("NO TASK CARD: the agent decided otherwise (its summary says why)");
    });
    await timed("A5 Invariants: verify, request ids, fallbacks under 10%", async () => {
      const v = cli("verify.ts");
      check(/all checks pass|0 failed|passes/i.test(v), "npm run verify passes (nothing paid twice, every approval by passkey)");
      // Metal QA: what the dashboard shows for each mandate, read against the chain.
      let vc = "";
      try { vc = cli("dashboardVsChain.ts"); } catch { /* reported below */ }
      check(/matches the chain for all/.test(vc), "the dashboard's mandates match the chain (cap, budget, spend)");
      const stats = agentStats(db());
      const decisions = stats.reduce((n, x) => n + x.decisions, 0), fallbacks = stats.reduce((n, x) => n + x.fallback, 0);
      check(decisions > 0 && fallbacks / decisions < 0.1, `fallbacks ${fallbacks} of ${decisions} decisions (under 10%)`);
      check(stats.every((x) => x.calls_without_request_id === 0), "every Claude call has an API request id");
      for (const x of stats) say(`AGENT SUMMARY ${x.agent}: ${x.decisions} decisions, fallback ${x.fallback_pct}%, ${x.claude_calls} calls, ${(x.cost_usd_micros / 1e6).toFixed(4)} USD`);
      // D24: every money movement records who decided it, at the source. One without blocks the run.
      const o = originsCheck(db());
      for (const m of o.missing.slice(0, 10)) say(`NO ORIGIN #${m.seq} ${m.event} ${m.subject ?? ""}`);
      check(o.recorded && o.missing.length === 0, `every money movement has its origin (${o.movements} movements, ${o.missing.length} without)`);
      say(`ORIGINS ${o.movements} movements, ${o.missing.length} without an origin`);
    });
  } finally {
    try { process.kill(-world.pid!, "SIGTERM"); } catch { /* gone */ }
  }
  await killRunner("SIGTERM");
  await browser.close();
  writeFileSync(join(out, "timings.json"), JSON.stringify({ total_minutes: Math.round((Date.now() - started) / 60_000), failures, timings }, null, 2));
  say(failures === 0 ? "autonomy run passes" : `${failures} check(s) failed in the autonomy run`);
  process.exit(failures === 0 ? 0 : 1);
}
if (process.env.DRYRUN_ONLY_OWNERS) {
  // Block 1 on its own: enrol, bootstrap, then step 12d (a quick check before the whole draaiboek).
  await timed(OWNERS_STEP, ownersStep);
  await killRunner("SIGTERM");
  await browser.close();
  say(failures === 0 ? "owners passes" : "owners failed");
  process.exit(failures === 0 ? 0 : 1);
}
await timed("1 Sales per query (0.05, upstream 0.02): stock checks 1-40", async () => { cli("trade.ts", "1", "40"); });
let optA = "", optB = "";
await timed("2-4 Price rise, refusal on chain, two options with Opus's advice", async () => {
  const outS1 = cli("s1.ts", "raise");
  check(/mandate_cap_exceeded/.test(outS1), "the purchase at 0.04 was refused against the 0.03 mandate");
  const ids = (db().prepare("SELECT proposal_id, terms_json FROM proposals WHERE kind = 'mandate_replace' ORDER BY proposal_id").all() as { proposal_id: string; terms_json: string }[]);
  optA = ids.find((r) => (JSON.parse(r.terms_json) as { option?: string }).option === "A")!.proposal_id;
  optB = ids.find((r) => (JSON.parse(r.terms_json) as { option?: string }).option === "B")!.proposal_id;
  check(!!optA && !!optB, `options A (${optA}) and B (${optB}) proposed`);
});
await timed("5 Four eyes on chain (2-of-2 account in this world)", async () => {
  const r = spawnSync("npx", ["tsx", "src/cli/fourEyes.ts"], { cwd: repo, env: { ...env, KIT11_KEYS_DIR: `${keys}/four-eyes`, RUN_OUT: `dry-run-four-eyes`, RUN_OUT_DIR: out }, encoding: "utf8" });
  const text = `${r.stdout}${r.stderr}`;
  check(/reverted.*CFO alone/.test(text.replace(/\n/g, " ")) || /reverted/.test(text), "the CFO's signature alone reverted on chain");
  check(r.status === 0, "four-eyes run finished");
});
await timed("Mis-tap: A chosen by mistake, then B; nothing signed", async () => {
  const page = cfo.page;
  await page.goto(`${url}/approve/${optB}`);
  await page.waitForSelector(".choices button.option");
  await page.locator(".choices button.option", { hasText: "Option A" }).first().tap();
  check(/Option A/.test((await page.textContent(".what-title")) ?? "") && (await page.textContent("#approve")) === "Approve option A with Face ID", "the view and the button name the option chosen (A)");
  check(await page.isDisabled("#approve"), "the button arms again after the change");
  await page.locator(".choices button.option", { hasText: "Option B" }).first().tap();
  check((await page.textContent("#approve")) === "Approve option B with Face ID", "choosing B again: the button names B");
  check((db().prepare("SELECT COUNT(*) AS n FROM cosignatures").get() as { n: number }).n === 0, "nothing was signed");
});
await timed("6 Mandates replaced: option B, test-cfo then test-controller", async () => {
  const first = await sign(cfo, optB, { option: "B", tag: "s1-cfo" });
  check(first === "1 of 2 approvals", `after the first passkey: "${first}"`);
  check(status(optB) === "PENDING_APPROVAL", "still waiting for the second person");
  const second = await sign(controller, optB, { option: "B", tag: "s1-controller" });
  check(second === "Done" || second === "Approved", `after the second passkey: "${second}"`);
  await executed(optB);
  check(status(optA) !== "EXECUTED", "option A was not executed");
});
await timed("1b Sales resume (41-50)", async () => { cli("s1.ts", "resume"); });
await timed("7 Dispute on signed orders; 'refund all 12' rejected (Opus advises it)", async () => {
  cli("s2.ts");
  const all = latest("refund_batch", "status = 'PENDING_APPROVAL'");
  check(!!all, `"refund all 12" waits for the CFO (${all})`);
  const page = cfo.page;
  await page.goto(`${url}/approve/${all}`);
  await page.waitForSelector("#reject");
  const order = await page.$$eval(".actions button", (n: Element[]) => n.map((x) => x.id));
  check(order.join() === "reject,approve" && (await page.textContent("#approve")) === "Approve anyway with Face ID", "'refund all 12': warned, Reject first, 'Approve anyway' second, armed after 3 s");
  await shot(page, "refund-all-warning");
  await page.waitForFunction(() => !(document.querySelector("#reject") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await page.click("#reject");
  await page.waitForFunction(() => document.querySelector(".verdict-head")?.textContent === "Rejected", null, { timeout: 60_000 });
  check(status(all!) === "REJECTED", `${all} rejected with the passkey`);
});
await timed("8 Receive policy, then the sweep once final", async () => { cli("receivePolicy.ts", "setup"); });
let bergtex = "";
await timed("9 Bergtex EUR 1,850.00 proposed (sweep first)", async () => {
  cli("s3.ts");
  bergtex = latest("invoice_payment", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!bergtex, `Bergtex proposal ${bergtex}`);
});
await timed("Expiry: the countdown on both phones, then the proposal runs out and a fresh quote needs a new approval", async () => {
  const exp = (db().prepare("SELECT expires_at FROM proposals WHERE proposal_id = ?").get(bergtex) as { expires_at: string }).expires_at;
  for (const [who, p] of [["test-cfo", cfo], ["test-controller", controller]] as const) {
    await p.page.goto(`${url}/approve/${bergtex}`);
    await p.page.waitForSelector(".countdown");
    const shown = (await p.page.textContent(".countdown")) ?? "";
    const m = /expires in (?:(\d+)h )?(\d+)m (\d+)s/.exec(shown);
    const secs = m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : -1;
    const real = Math.round((Date.parse(exp) - Date.now()) / 1000);
    check(Math.abs(secs - real) <= 5, `${who}: the countdown says ${shown.trim()}, the terms expire in ${real} s`);
  }
  say(`  waiting for ${bergtex} to run out (${exp})`);
  await until(`${bergtex} past its expiry`, () => Date.now() > Date.parse(exp) + 5000, 15 * 60_000);
  const late = await sign(cfo, bergtex, { tag: "bergtex-late" }).catch((e: Error) => `error: ${e.message}`);
  check(/too late|expired|Expired|ran out/i.test(late) || status(bergtex) === "EXPIRED", `approving after expiry signs nothing (${late}; ${status(bergtex)})`);
  check((db().prepare("SELECT COUNT(*) AS n FROM transfers WHERE invoice_no = 'BTX-2026-11'").get() as { n: number }).n === 0, "no transfer for Bergtex yet");
  cli("s3.ts");
  const fresh = latest("invoice_payment", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!fresh && fresh !== bergtex, `a fresh proposal with a fresh quote (${fresh})`);
  bergtex = fresh;
});
await timed("9b Bergtex paid: test-cfo and test-controller (four eyes above EUR 1,000)", async () => {
  check((await sign(cfo, bergtex, { tag: "bergtex-cfo" })) === "1 of 2 approvals", "first passkey: 1 of 2");
  await sign(controller, bergtex, { tag: "bergtex-controller" });
  await executed(bergtex);
});
await timed("10 Licence EUR 240.00 (FX + SWIFT); the runner is killed right after the approval and restarted", async () => {
  cli("licence.ts");
  const lic = latest("invoice_payment", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!lic, `licence proposal ${lic}`);
  if (process.env.KIT11_AGENTS === "on") {
    // Block 5.3: the Treasury agent's timing advice, beside the proposal (advisory; reported, not required).
    const adv = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'licence.timing_advised' AND subject = ?").get(lic) as { payload_json: string } | undefined;
    const a = adv ? (JSON.parse(adv.payload_json) as { timing: string; date: string | null }) : null;
    say(`TIMING AGENT ${a ? `${a.timing}${a.date ? ` ${a.date}` : ""}` : "no advice (the agent did not decide)"}`);
  }
  // Network away: the approval cannot be sent; the page says so and nothing is signed on the runner.
  // The page is open and the sheet armed; then the network goes, and Face ID is pressed.
  const offline = await sign(cfo, lic, { tag: "licence-offline", expectNoVerdict: true, beforeConfirm: () => cfo.page.route("**/api/**", (r: { abort: () => void }) => r.abort()) })
    .catch((e: Error) => `error: ${e.message.slice(0, 80)}`);
  check(status(lic) === "PENDING_APPROVAL", `network away: nothing approved (${offline})`);
  await cfo.page.unroute("**/api/**");
  // The phone locked during Face ID: the passkey refuses, the page says so, nothing is signed.
  await cfo.setVerified(false);
  const locked = await sign(cfo, lic, { tag: "licence-locked", expectNoVerdict: true }).catch((e: Error) => `error: ${e.message.slice(0, 80)}`);
  check(status(lic) === "PENDING_APPROVAL", `Face ID failed: nothing approved (${locked})`);
  await cfo.setVerified(true);
  const page = cfo.page;
  await page.goto(`${url}/approve/${lic}`);
  await page.waitForSelector("#approve");
  await page.waitForFunction(() => !(document.querySelector("#approve") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await page.click("#approve");
  await until(`${lic} approved`, () => { const s = status(lic); return s && s !== "PENDING_APPROVAL" ? s : undefined; }, 120_000);
  await killRunner("SIGKILL");
  say(`  runner killed with ${lic} at ${status(lic)}`);
  await startRunner();
  await executed(lic);
  const n = (db().prepare("SELECT COUNT(*) AS n FROM transfers WHERE invoice_no = 'SLL-2026-11'").get() as { n: number }).n;
  check(n === 1, `one transfer for the licence after the restart (${n})`);
});
let raise = "";
await timed("11 Cards: EUR 19.99 approved, EUR 45.00 declined, raise EUR 30 → 50", async () => {
  cli("cards.ts", "setup");
  const railsFrom = (db().prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
  const scen = cli("cards.ts", "scenario");
  if (process.env.KIT11_AGENTS === "on") {
    // Block 5.1: the Sourcing agent picked the rail per purchase; code checked each supplier accepts it.
    const rails = (db().prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'purchase.rail_chosen' AND seq > ? ORDER BY seq").all(railsFrom) as { subject: string; payload_json: string }[])
      .map((r) => ({ supplier: r.subject, ...(JSON.parse(r.payload_json) as { rail: string; by: string; ok: boolean }) }));
    check(rails.some((r) => r.supplier === "stockline" && r.rail === "metal_x402" && r.ok), "Stockline paid over x402 on Metal (a stock check under the Sourcing mandate)");
    check(rails.some((r) => r.supplier === "packwise" && r.rail === "airwallex_card" && r.ok), "Packwise Starter paid on the Sourcing agent's Airwallex card");
    check(rails.length === 2, `each supplier paid once (${rails.length} payments)`);
    const sum = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'purchase.rails_chosen' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
    const source = sum ? (JSON.parse(sum.payload_json) as { source: string }).source : "none";
    say(`RAILS AGENT ${source === "claude" ? "the Sourcing agent's own choice" : "code's fallback (reported, not a failure)"}; ${scen.split("\n").filter((l) => /SOURCING AGENT|refused by code/.test(l)).join(" | ").slice(0, 300)}`);
  }
  raise = latest("policy_change", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!raise, `raise proposal ${raise}`);
  if (process.env.KIT11_AGENTS === "on") {
    // Block 5.2: the decline started the agent whose card it is; a limit decline got a raise, the wrong-merchant one none.
    const met = (db().prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'card.decline_met' AND seq > ? ORDER BY seq").all(railsFrom) as { subject: string; payload_json: string }[])
      .map((r) => JSON.parse(r.payload_json) as { agent: string; source: string; reason: string; proposal_id: string | null });
    const limit = met.find((m) => m.agent === "sourcing" && m.reason === "LIMIT_EXCEEDED");
    check(!!limit && limit.proposal_id === raise, `the Sourcing agent met the limit decline and its raise is ${raise}`);
    const mcc = met.find((m) => m.agent === "support");
    check(!!mcc && mcc.proposal_id === null, "the Support agent met the wrong-merchant decline and proposed no raise");
    say(`DECLINE AGENT ${met.map((m) => `${m.agent} ${m.reason}: ${m.source}${m.proposal_id ? ` → ${m.proposal_id}` : ", no raise"}`).join("; ")}`);
  }
  await sign(cfo, raise, { tag: "card-raise" });
  await executed(raise);
  cli("cards.ts", "sync");
  const buy = cli("cards.ts", "buy", "packwise-pro");
  check(/APPROVED|approved/.test(buy), "the same EUR 45.00 is approved after the raise");
});
await timed("12 Emergency stop on, a card charge declined, stop off", async () => {
  const page = cfo.page;
  await page.goto(`${url}/`);
  await page.waitForSelector("#stop:not([hidden])", { timeout: 30_000 });
  await page.click("#stop");
  await page.waitForSelector("#stop-sheet[open]");
  await page.click("#stop-go");
  await page.waitForSelector("main > button.confirm");
  await page.click("main > button.confirm");
  await page.waitForSelector("#sheet:not([hidden]) .sheet-title");
  await page.waitForFunction(() => !(document.querySelector("#sheet button.confirm") as HTMLButtonElement).disabled, null, { timeout: 5000 });
  await page.click("#sheet button.confirm");
  await page.waitForSelector(".verdict.ok", { timeout: 60_000 });
  await until("freeze on", () => (db().prepare("SELECT value FROM settings WHERE key = 'freeze'").get() as { value: string } | undefined)?.value === "on", 60_000);
  await sleep(8000); // the runner syncs the frozen cards to Airwallex
  const frozenBuy = (() => { try { return cli("cards.ts", "buy", "packwise-starter"); } catch (e) { return (e as Error).message; } })();
  check(/declined|INACTIVE|frozen|refused|stop/i.test(frozenBuy), "a card charge while stopped is refused");
  cli("policy.ts", "set", "freeze", "off", "--reason", "dry run: lift the stop");
  const lift = latest("policy_change", "status = 'PENDING_APPROVAL'") ?? "";
  await sign(cfo, lift, { tag: "stop-off" });
  await executed(lift);
});
// 4.2, only with the agents on (Thursday's run): the CFO pauses one agent with Face ID. Its Metal mandate is revoked on
// chain and its card frozen at Airwallex; resuming takes both passkeys (four eyes) and binds a fresh mandate with the
// same cap and what was left of the budget.
if (process.env.KIT11_AGENTS === "on") await timed("12b Pause the Support agent (mandate revoked on chain, card frozen), then resume with both passkeys", async () => {
  const before = await activeMandate("support");
  const spentBefore = await mandateSpent(before);
  cli("policy.ts", "set", "pause.support", "on", "--reason", "dry run: pause the Support agent");
  const p = latest("policy_change", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!p, `pause proposal ${p}`);
  await sign(cfo, p, { tag: "pause-support" });
  await executed(p);
  const rev = db().prepare("SELECT payload_json FROM audit_log WHERE event = 'mandate.revoked' AND subject = 'support' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
  const revTx = rev ? String((JSON.parse(rev.payload_json) as { tx?: string }).tx ?? "") : "";
  check(/^0x[0-9a-f]{64}$/i.test(revTx), `the Support mandate revoked on chain (tx ${revTx.slice(0, 12)}…)`);
  check((await readMandateState(publicClient(), before.principal, before.reference)).revoked, "the chain says the Support mandate is revoked");
  check(/^paused_by_cfo:/.test(capRefusal(db(), "support", 5) ?? ""), "Purser refuses the Support agent's payments before signing");
  await until("the Support card inactive at Airwallex", () => (db().prepare("SELECT status FROM cards WHERE agent = 'support'").get() as { status: string } | undefined)?.status === "INACTIVE", 60_000)
    .then(() => check(true, "the Support card is inactive at Airwallex"), () => check(false, "the Support card is inactive at Airwallex"));
  cli("policy.ts", "set", "pause.support", "off", "--reason", "dry run: resume the Support agent");
  const r = latest("policy_change", "status = 'PENDING_APPROVAL'") ?? "";
  check((await sign(cfo, r, { tag: "resume-support-cfo" })) === "1 of 2 approvals", "resume: first passkey 1 of 2 (four eyes)");
  await sign(controller, r, { tag: "resume-support-controller" });
  await executed(r);
  const after = await activeMandate("support");
  check(after.credentialHash !== before.credentialHash, "a new Support mandate is bound in place of the revoked one");
  // Metal binds a fresh mandate (a revoked one cannot be replaced): same cap, only what was left of the budget.
  const budgetOf = (m: typeof before) => extractTerms(m.credential).constraints.budget;
  check(budgetOf(after) === budgetOf(before) - spentBefore && (await mandateSpent(after)) === 0n,
    `the resumed mandate has what was left of the budget (${budgetOf(before) - spentBefore} of ${budgetOf(before)} base units), so the lifetime limit is unchanged`);
  check(capRefusal(db(), "support", 5) === null, "Purser lets the Support agent pay again");
});
// Block 6, agents on: a rebalance right after the resume. The resumed mandate's spend started at nothing on chain; the
// plan works on lifetime figures, so the new Support mandate gets its old chain budget plus the 0.50 moved, and the
// spend since the resume carries over in the replace.
if (process.env.KIT11_AGENTS === "on") await timed("12c Rebalance right after the resume: 0.50 from Treasury to Support, both passkeys", async () => {
  const before = await activeMandate("support");
  const budgetOf = (m: typeof before) => extractTerms(m.credential).constraints.budget;
  const spentBefore = await mandateSpent(before);
  cli("rebalance.ts", "--from", "treasury", "--to", "support", "--amount", "0.50", "--reason", "dry run: rebalance right after the resume");
  const r = latest("mandate_replace", "status = 'PENDING_APPROVAL'") ?? "";
  check(!!r, `rebalance proposal ${r}`);
  const terms = JSON.parse((db().prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(r) as { terms_json: string }).terms_json) as { steps: { agent: string; budget: string; budget_on_chain?: string; spent_before_pause?: string }[] };
  const step = terms.steps.find((x) => x.agent === "support");
  check(!!step?.budget_on_chain && !!step.spent_before_pause, `the signed terms show Support's lifetime budget ${step?.budget}, on chain ${step?.budget_on_chain}, spent before the pause ${step?.spent_before_pause}`);
  check((await sign(cfo, r, { tag: "rebalance-cfo" })) === "1 of 2 approvals", "rebalance: first passkey 1 of 2 (four eyes)");
  await sign(controller, r, { tag: "rebalance-controller" });
  await executed(r);
  const after = await activeMandate("support");
  check(budgetOf(after) === budgetOf(before) + 500_000_000_000_000_000n, `the new Support mandate on chain: ${budgetOf(after)} = ${budgetOf(before)} + 0.50 (the spend before the pause still counted)`);
  check((await mandateSpent(after)) === spentBefore, "the spend since the resume carried over in the replace");
});
if (process.env.KIT11_PASSKEY_OWNERS === "on") await timed(OWNERS_STEP, ownersStep);
await timed("13 Bank change for Bergtex in three steps (test identities)", async () => {
  const req = cli("payee.ts", "request", "Bergtex Textil GmbH", "DE02100100100006820101", "PBNKDEFFXXX");
  const id = /(B-\d{4})/.exec(req)?.[1] ?? "";
  cli("payee.ts", "verified", id, "--by", "test-controller", "--how", "dry run: no call made (test world)");
  cli("payee.ts", "propose", id);
  const p = latest("payee_change", "status = 'PENDING_APPROVAL'") ?? "";
  check((await sign(cfo, p, { tag: "payee-cfo" })) === "1 of 2 approvals", "bank change: first passkey 1 of 2");
  await sign(controller, p, { tag: "payee-controller" });
  await executed(p);
});
await timed("14 Agent recognition (dev test)", async () => {
  cli("visa.ts", "setup");
  const r = spawnSync("npx", ["tsx", "src/cli/visa.ts", "run"], { cwd: repo, env: { ...env, RUN_OUT: "dry-run-visa", RUN_OUT_DIR: out }, encoding: "utf8" });
  check(/approved by Airwallex/.test(r.stdout) && /LIMIT_EXCEEDED/.test(r.stdout), "recognised and approved; over the limit declined by Airwallex");
});
await timed("Links: a private tab twice, and a phone that pinned another runner", linksStep);
await timed("Verify: chain, ledger, audit log; nothing paid twice", async () => {
  cli("verify.ts");
  const dup = db().prepare("SELECT invoice_no, COUNT(*) AS n FROM transfers GROUP BY invoice_no HAVING n > 1").all();
  check(dup.length === 0, `one transfer per invoice (${JSON.stringify(dup)})`);
  const dupApprovals = db().prepare("SELECT proposal_id, COUNT(*) AS n FROM approvals GROUP BY proposal_id HAVING n > 1").all();
  check(dupApprovals.length === 0, "one decision per proposal");
});

await killRunner("SIGTERM");
await browser.close();
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""}`);
if (process.env.KIT11_AGENTS === "on") {
  // Metal QA: what the dashboard shows for each mandate, read against the chain.
  let vc = "";
  try { vc = cli("dashboardVsChain.ts"); } catch { /* reported below */ }
  check(/matches the chain for all/.test(vc), "the dashboard's mandates match the chain (cap, budget, spend)");
  // D19: every Claude call behind an agent decision carries the API's request id; the summary shows the fallback share.
  const stats = agentStats(db());
  const missing = stats.reduce((n, s) => n + s.calls_without_request_id, 0);
  check(missing === 0 && stats.some((s) => s.claude_calls > 0), `every agent Claude call has an API request id (${stats.reduce((n, s) => n + s.claude_calls, 0)} calls, ${missing} without)`);
  for (const s of stats) say(`AGENT SUMMARY ${s.agent}: ${s.decisions} decisions, fallback ${s.fallback_pct}%, ${s.claude_calls} calls, ${(s.cost_usd_micros / 1e6).toFixed(4)} USD`);
  // D24: every money movement records who decided it, at the source. One without blocks the run.
  const o = originsCheck(db());
  for (const m of o.missing.slice(0, 10)) say(`NO ORIGIN #${m.seq} ${m.event} ${m.subject ?? ""}`);
  check(o.recorded && o.missing.length === 0, `every money movement has its origin (${o.movements} movements, ${o.missing.length} without)`);
  say(`ORIGINS ${o.movements} movements, ${o.missing.length} without an origin`);
}
const total = Math.round((Date.now() - started) / 60_000);
writeFileSync(join(out, "timings.json"), JSON.stringify({ total_minutes: total, failures, timings }, null, 2));
say(`\n${failures === 0 ? "dry run passes" : `${failures} check(s) failed`}: ${total} minutes; timings in ${join(out, "timings.json")}`);
process.exit(failures === 0 ? 0 : 1);
