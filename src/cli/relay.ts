// npm run relay [-- --enrol [--replace]] [-- --local] [-- --once]
// Connects this ledger (KIT11_DB) to the relay Worker, so the dashboard and passkey approvals work on a phone at
// one fixed address. Every approval the phone sends is verified here, against the pinned passkey and the exact
// terms hash, before anything is decided; then the executor runs as with the local approval page.
//   --enrol    opens a ten-minute window and prints a one-time code for enrolling the approver's passkey
//   --replace  with --enrol: the new passkey replaces the enrolled one once it is enrolled
//   --local    no Cloudflare: serves the same relay on http://localhost:4400 (KIT11_RELAY_PORT) for a laptop
//   --once     one sync (and the executions it starts), then exit

import { envWithoutOrigin, MONEY_EVENTS } from "../provenance/origin.js";
import { displayKey } from "../relay/sign.js";
import { reconcile } from "../finance/reconcile.js";
import { certifyPending } from "../metal/finality.js";
import { reconcileSourcesFromEnv } from "../finance/sources.js";
import { resolveSettlements } from "../finance/settlements.js";
import { redactSecrets } from "../lib/redact.js";
import { keyPath } from "../metal/agentCli.js";
import { randomBytes } from "node:crypto";
import { openDb } from "../db/open.js";
import { execute } from "../executors/index.js";
import { recoverHolds } from "../policy/holds.js";
import { recoverRecordPulls } from "../agents/sourcing.js";
import { resumeInterrupted } from "../policy/saga.js";
import { health, RECONCILE_EVERY_MS } from "../ops/health.js";
import { openEnrolment } from "../passkey/ledger.js";
import { relayConfig, viewerLink, type RelayConfig, mfaOn } from "../relay/config.js";
import { startLocalRelay } from "../relay/local.js";
import { RelayRunner } from "../relay/runner.js";
import { Tools } from "../claude/tools.js";
import { draftPolicyFromText, draftSummary } from "../policy/fromText.js";
import { recoverTaskCards, relayAsk } from "../agents/askPurser.js";
import { pollQuarantine } from "../policy/quarantine.js";
import { LiveReceivePolicy } from "../metal/receivePolicy.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { cardPollMs, cardRows, pollCardTransactions, syncCardsIfChanged } from "../policy/cards.js";
import { handleAirwallexHook } from "../policy/cardHooks.js";
import { WEBHOOK_SECRET_FILE } from "../airwallex/webhooks.js";
import { existsSync, readFileSync } from "node:fs";
import { agentsOn, autonomyOn } from "../config/agents.js";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { meetNewDeclines } from "../agents/declineTrigger.js";
import { pausedCredential, pausesNotRevoked, syncPauses } from "../policy/pause.js";
import { LivePauseChain } from "../metal/pauseChain.js";
import { osProcesses } from "../ops/processes.js";
import { asWorldGroup, holdRunnerLock } from "../ops/runnerLock.js";
import { openDecisions } from "../agents/disputeDecision.js";
import { HubLoop } from "../hub/consult.js";
import { t0Enabled, t0SinkFor } from "../accounting/t0Sink.js";
import { hubDecisionsEnabled, hubPushEnabled } from "../hub/config.js";

// One world, one runner, one process group (2 November: a stop reached only a wrapper, another world's runner ran on).
// Outside a world's group this starts itself again as the leader of a new one; then it takes the ledger's runner lock,
// so a second runner on the same ledger refuses to start. `npm run stop -- <world>` stops exactly this group.
// The ledger is always named (as `up` requires): a runner on a default path would be a world nobody can find to stop.
if (!process.env.KIT11_DB) {
  console.error("npm run relay needs KIT11_DB (the world's ledger), so the world can be found and stopped (npm run stop -- <world>).");
  process.exit(2);
}
const group = await asWorldGroup();
const db = openDb();
holdRunnerLock(db, db.name, "relay", group, osProcesses);

const args = process.argv.slice(2);
const once = args.includes("--once");
let cfg: RelayConfig;
if (args.includes("--local")) {
  // A fresh token each start, unless the caller keeps one across restarts (the dry run restarts the runner on purpose;
  // a new token would void the phones' viewer link). The hosted relay keeps its own token anyway.
  const kept = process.env.KIT11_LOCAL_RELAY_TOKEN ?? "";
  if (kept && !/^[0-9a-f]{64}$/.test(kept)) throw new Error("KIT11_LOCAL_RELAY_TOKEN must be 64 hex characters");
  const token = kept || randomBytes(32).toString("hex");
  const { url } = await startLocalRelay({ port: Number(process.env.KIT11_RELAY_PORT ?? 4400), token });
  cfg = { url, origin: url, rpId: new URL(url).hostname, token };
} else {
  cfg = await relayConfig();
}

const label = process.env.KIT11_APPROVER ?? "max";
const stamp = () => new Date().toISOString().slice(11, 19);
console.log(`relay    ${cfg.url}/  (approvals ${cfg.url}/approve/<id>; ledger ${process.env.KIT11_DB ?? "data/kit11.sqlite"})`);
const signer = displayKey(keyPath("relay-display-key.pem"));
console.log(`viewer   ${viewerLink(cfg, signer.publicSpki)}  (open once on each device: it unlocks the dashboard and pins this runner's key; it approves nothing${mfaOn() ? "; with MFA on it reads only and expires after next week: the CFO's actions need a passkey sign-in" : ""})`);
// D20: under MFA the viewer link changes every Monday; print the new one, so devices can renew without a restart.
if (mfaOn()) {
  let shown = viewerLink(cfg, signer.publicSpki);
  setInterval(() => {
    const next = viewerLink(cfg, signer.publicSpki);
    if (next !== shown) { shown = next; console.log(`${stamp()} viewer   a new week, a new link (last week's still works for seven days): ${next}`); }
  }, 3_600_000).unref();
}
if (args.includes("--enrol")) {
  const { window, code } = openEnrolment(db, { rpId: cfg.rpId, origin: cfg.origin, replace: args.includes("--replace") });
  console.log(`ENROL    on the phone open ${cfg.url}/enrol and type ${code} (valid until ${window.expires_at.slice(11, 19)} UTC, five tries)`);
}

// Airwallex's webhooks reach the relay; with the secret here too, the runner checks each one again and records it.
const hookSecret = existsSync(keyPath(WEBHOOK_SECRET_FILE)) ? readFileSync(keyPath(WEBHOOK_SECRET_FILE), "utf8").trim() : "";
console.log(`webhooks ${hookSecret ? "on: card transactions arrive from Airwallex as they happen" : "off (npm run cards -- webhook); card transactions come from the poll"}`);
// Block 5.2: with the agents on, a new card decline (from a webhook or the poll) starts the agent whose card it is.
// One at a time; each decline is claimed once, so the CLI that caused it and this runner never both act on it.
let declines: Promise<void> = Promise.resolve();
const meetDeclines = () => {
  if (!agentsOn()) return;
  declines = declines.then(async () => {
    for (const m of await meetNewDeclines(db, { by: "runner" })) console.log(`${stamp()} agent    ${m.source === "claude" ? "card decline met by the agent" : "card decline met by code"}${m.proposal_id ? `: ${m.proposal_id} waits for the CFO` : ": no raise"}`);
  }).catch((e: Error) => console.log(`${stamp()} agent    card decline: ${redactSecrets(e.message).slice(0, 200)}`));
};
const onHook = hookSecret ? (h: Parameters<typeof handleAirwallexHook>[1]) => { const line = handleAirwallexHook(db, h, hookSecret); meetDeclines(); return line; } : undefined;
// The CFO's policy in plain words from the phone (P2): Opus drafts, code checks, and only tightening can come this way.
const draftPolicy = async (text: string) => {
  const r = await draftPolicyFromText(db, new Tools(db), text, new Date(), { tightenOnly: true });
  return { proposalId: r.proposal?.proposal_id ?? null, message: draftSummary(r) };
};
// Ask Purser (G): a chat message through the relay (the phone, or anyone with the viewer link) becomes, at most, a
// task card proposal that waits for Face ID; it never issues a card itself (review 30 Oct, HIGH-1).
const ask = (text: string, ticket: string) => relayAsk(db, new Tools(db))(text, ticket);
const runner = new RelayRunner({ db, cfg, fetch, execute, label, signer, onHook, draftPolicy, ask, log: (line) => console.log(`${stamp()} ${line}`) });
let stopping = false;
// D19: with the autonomous agents on, each agent runs as its own process beside the runner (npm run agent -- <name>);
// their lines go to this log, prefixed. They stop with the runner. They start after the recovery below, so the
// Support agent never carries out a dispute decision while the runner's own resume does.
let agentProcs: ChildProcess[] = [];
const startAgents = () => autonomyOn() ? (["sourcing", "support", "treasury"] as const).map((n) => {
  const child = spawn("npx", ["tsx", resolve(import.meta.dirname, "agent.ts"), n], { env: envWithoutOrigin(), stdio: ["ignore", "pipe", "pipe"] });
  const out = (b: Buffer) => { for (const l of b.toString().split("\n")) if (l.trim() && !/ExperimentalWarning|trace-warnings/.test(l)) console.log(`agent    ${redactSecrets(l).slice(0, 400)}`); };
  child.stdout.on("data", out);
  child.stderr.on("data", out);
  return child;
}) : [];
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of agentProcs) c.kill("SIGTERM");
  console.log(`${stamp()} stopping; waiting for running executions`);
  // Deliver the last verdicts (an execution may just have finished) before leaving.
  void runner.idle().then(() => runner.syncOnce()).catch(() => undefined).then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// The agents' cards (K2): every few seconds, a limit the CFO changed goes to Airwallex, and new authorisations come
// in (the webhook, once set up, brings them sooner). A failure here is logged and tried again; it never stops the relay.
const issuing = issuingFromEnv();
// awx-1: KIT11_CARD_POLL_MS=off leaves the transactions to the webhooks (each poll is a counted call); limits still sync.
const pollEvery = cardPollMs();
if (issuing) console.log(`cards    ${pollEvery === null ? "poll off: card transactions come from the webhooks" : `polled every ${pollEvery / 1000} s`}`);
let cardsAt = 0;
let polledAt = 0;
let cardsError = "";
async function cardsTick(): Promise<void> {
  if (!issuing || cardRows(db).length === 0 || Date.now() - cardsAt < 5000) return;
  cardsAt = Date.now();
  try {
    const synced = await syncCardsIfChanged(db, issuing.rail);
    if (synced.length) console.log(`${stamp()} cards    limits updated at Airwallex: ${synced.join(", ")}`);
    const fresh = pollEvery !== null && Date.now() - polledAt >= pollEvery ? (polledAt = Date.now(), await pollCardTransactions(db, issuing.rail)) : 0;
    if (fresh) console.log(`${stamp()} cards    ${fresh} new card transaction(s) from Airwallex`);
    if (fresh) meetDeclines();
    const orphans = await recoverTaskCards(db, issuing.rail);
    if (orphans) console.log(`${stamp()} cards    ${orphans} unfinished task card(s) frozen at Airwallex`);
    cardsError = "";
  } catch (e) {
    const message = redactSecrets((e as Error).message);
    if (message !== cardsError) console.error(`${stamp()} cards    ${message}`);
    cardsError = message;
  }
}

// A pull recording Metal's refusal (src/agents/sourcing.ts) runs in the world's process, not under this runner's lock:
// one left without an outcome by a process that ended is resolved here, at start and on every poll, once its timeout
// has passed (a started pull: an incident, its hold kept; one never started: not sent, its hold released).
function recordPullsTick(): void {
  try {
    const r = recoverRecordPulls(db);
    if (r.incidents + r.notSent) console.log(`${stamp()} recover  record pulls without an outcome: ${r.incidents} incident(s) (the Sourcing agent is stopped), ${r.notSent} never sent`);
  } catch (e) {
    console.error(`${stamp()} recover  ${redactSecrets((e as Error).message)}`);
  }
}

// The light reconciliation (finance item 5): a minute after start, then every hour (RECONCILE_EVERY_MS). Read-only;
// a difference is logged, raises an alarm and is shown on the dashboard.
let reconcileAt = Date.now() - RECONCILE_EVERY_MS + 60_000;
async function reconcileTick(): Promise<void> {
  if (Date.now() - reconcileAt < RECONCILE_EVERY_MS) return;
  reconcileAt = Date.now();
  try {
    const r = await reconcile(db, reconcileSourcesFromEnv());
    console.log(`${stamp()} reconcile ${r.checked} flows checked, ${r.differences.length} difference(s)${r.skipped.length ? `; not checked: ${r.skipped.join(", ")}` : ""}`);
  } catch (e) {
    console.error(`${stamp()} reconcile ${redactSecrets((e as Error).message)}`);
  }
}

// Customer payments left "being settled" (src/finance/settlements.ts): every 5 minutes, not only with the hourly
// reconciliation, so a sale whose row a crash cut off is closed, or charged-with-no-delivery goes to the CFO, soon.
let settlementsAt = 0;
async function settlementsTick(): Promise<void> {
  if (Date.now() - settlementsAt < 5 * 60_000) return;
  settlementsAt = Date.now();
  try {
    const r = await resolveSettlements(db, reconcileSourcesFromEnv());
    for (const x of r.resolved) console.log(`${stamp()} settle   ${x.key.slice(0, 10)}… ${x.outcome}${x.outcome === "CHARGED" ? ": charged with no delivery recorded, owed back unless a person finds it was delivered" : ""}`);
  } catch (e) {
    console.error(`${stamp()} settle   ${redactSecrets((e as Error).message)}`);
  }
}

// Enterprise item 3: Metal's finality certificate for each new chain transaction in the ledger, every minute. Nodes keep
// them about 2 hours on testnet, so this must not wait for the hourly reconciliation. Read-only towards the chain.
let finalityAt = 0;
async function finalityTick(): Promise<void> {
  if (Date.now() - finalityAt < 60_000) return;
  finalityAt = Date.now();
  try {
    const r = await certifyPending(db);
    if (r.reported || r.not_kept || r.failed) console.log(`${stamp()} finality ${r.reported} reported certificate(s) stored${r.not_kept ? `, ${r.not_kept} no longer kept by the node` : ""}${r.failed ? `, ${r.failed} FAILED a check` : ""}`);
  } catch (e) {
    console.error(`${stamp()} finality ${redactSecrets((e as Error).message)}`);
  }
}

// B1: payments to the sweep wallet held in quarantine by Metal's receive policy, once it is set up; every 30 s.
let quarantineAt = 0;
let quarantineError = "";
async function quarantineTick(): Promise<void> {
  if (Date.now() - quarantineAt < 30_000 || !db.prepare("SELECT 1 FROM audit_log WHERE event = 'receive_policy.set'").get()) return;
  quarantineAt = Date.now();
  try {
    const held = await pollQuarantine(db, new LiveReceivePolicy());
    if (held) console.log(`${stamp()} metal    ${held} payment(s) from an unknown sender held in quarantine; return or accept with Face ID`);
    quarantineError = "";
  } catch (e) {
    const message = redactSecrets((e as Error).message);
    if (message !== quarantineError) console.error(`${stamp()} metal    ${message}`);
    quarantineError = message;
  }
}

// After a crash (backend review B2): first settle or release the holds the ledger can explain, then finish every
// money action left executing, from its last finished step. Nothing is sent twice: each step is keyed.
{
  const holds = recoverHolds(db);
  if (holds.settled + holds.released + holds.open) console.log(`${stamp()} recover  holds: ${holds.settled} settled, ${holds.released} released, ${holds.open} still open`);
  recordPullsTick();
  for (const r of await resumeInterrupted(db, execute)) console.log(`${stamp()} recover  ${r.id} resumed after a restart: ${redactSecrets(r.outcome)}`);
  // The Airi rail (KIT11_AIRI_RAIL=on): purchases a crash left open are looked up at the checkout or cancelled at Airi.
  if (process.env.KIT11_AIRI_RAIL === "on") {
    const { liveAiriDeps, fileLinkSink } = await import("../airi/deps.js");
    const { recoverAiriPurchases } = await import("../airi/purchase.js");
    const log = (line: string) => console.log(`${stamp()} ${line}`);
    const deps = liveAiriDeps(fileLinkSink(log), log);
    if (deps) {
      try {
        for (const r of await recoverAiriPurchases(db, deps)) console.log(`${stamp()} recover  Airi ${r.actionId}: ${r.status}`);
      } catch (e) {
        console.error(`${stamp()} recover  Airi purchases: ${redactSecrets((e as Error).message)}`);
      }
    }
  }
  // A dispute decision a restart cut off (refunds partly paid, the CFO's proposal not yet made): carried out now, once,
  // by the dispute flow from the ledger (npm run s2 -- --resume-only). It is never decided again.
  const undone = openDecisions(db);
  if (undone.length) {
    console.log(`${stamp()} recover  dispute decision(s) not fully carried out: ${undone.map((d) => d.dispute_id).join(", ")}; carrying out what is left`);
    // At most ten minutes: a hung refund or review must not keep the runner from starting (the alarm stays on /health).
    const code = await new Promise<number | string | null>((ok) => {
      const child = spawn(resolve(import.meta.dirname, "../../node_modules/.bin/tsx"), [resolve(import.meta.dirname, "s2.ts"), "--resume-only"], { env: envWithoutOrigin(), stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 });
      const out = (b: Buffer) => { for (const l of b.toString().split("\n")) if (l.trim() && !/ExperimentalWarning|trace-warnings/.test(l)) console.log(`${stamp()} recover  ${redactSecrets(l).slice(0, 300)}`); };
      child.stdout.on("data", out);
      child.stderr.on("data", out);
      child.on("error", (e) => ok(e.message));
      child.on("exit", (c, sig) => ok(c ?? sig));
    });
    if (code !== 0) console.error(`${stamp()} recover  the dispute decision was not carried out (${code}); /health shows it until it is`);
  }
  // 4.2 A pause whose revoke failed or was cut off by a crash: finish it now (review of 4.2). Purser refused the agent
  // all along; this makes the chain refuse it too. A failure here stays a health alarm until it succeeds.
  if (agentsOn() && pausesNotRevoked(db).length) {
    try {
      const done = await syncPauses(db, new LivePauseChain(() => "resume-sync", (agent) => pausedCredential(db, agent)));
      if (done.length) console.log(`${stamp()} recover  paused agent(s) revoked on chain: ${done.join(", ")}`);
    } catch (e) {
      console.error(`${stamp()} recover  revoke of a paused agent failed: ${redactSecrets((e as Error).message)}`);
    }
  }
}

// Agents of this run left behind by a relay that crashed (its exit handler sends them SIGTERM): give them half a minute
// to go; if any still runs, start none beside it (two Support agents could act on the same dispute) and say so.
if (!stopping && autonomyOn()) {
  const leftAgents = () => osProcesses.list().filter((p) => p.token === group.token && p.pid !== process.pid && !p.state.startsWith("Z") && /src\/cli\/agent\.ts/.test(p.cmd));
  for (let i = 0; i < 30 && leftAgents().length; i++) await new Promise((r) => setTimeout(r, 1000));
  const left = leftAgents();
  if (left.length) console.error(`${stamp()} ALARM    agent process(es) of the previous relay still run (pids ${left.map((p) => p.pid).join(", ")}); no new agents started beside them. npm run stop -- <world> stops the whole run.`);
  else agentProcs = startAgents();
}
// The agents stop with this relay however it ends (a crash too), so a restarted relay never runs beside them.
process.on("exit", () => { for (const c of agentProcs) try { c.kill("SIGTERM"); } catch { /* gone */ } });

// Monitoring (B7): each alarm is logged once when it is raised and once when it clears; the relay's /health shows them.
let standing = new Set<string>();
function alarmsTick(): void {
  const now = health(db);
  const codes = new Set(now.alerts.map((a) => `${a.code}:${a.words}`));
  for (const a of now.alerts) if (!standing.has(`${a.code}:${a.words}`)) console.error(`${stamp()} ALARM    ${a.severity}: ${a.words}`);
  for (const c of standing) if (!codes.has(c)) console.log(`${stamp()} alarm    cleared: ${c.slice(c.indexOf(":") + 1)}`);
  standing = codes;
}

// Phase D (src/hub): Max's hub and Cardputer, each part behind its own switch. The push never holds up this loop; the
// hub's decisions only add a gate (src/hub/gate.ts). Neither the hub's address nor its token is ever printed.
const hub = new HubLoop(db, { fetch, log: (line) => console.log(`${stamp()} ${line}`) }, execute);
if (hubPushEnabled() || hubDecisionsEnabled()) console.log(`hub      push ${hubPushEnabled() ? "on" : "off"}, decisions ${hubDecisionsEnabled() ? "on (an extra gate after Face ID)" : "off"}`);
async function hubTick(): Promise<void> {
  void hub.pushIfChanged();
  try {
    for (const id of await hub.tick()) console.log(`${stamp()} hub      ${id}: the hub decided; handed to the executor`);
  } catch (e) {
    console.error(`${stamp()} hub      tick failed: ${redactSecrets((e as Error).message).slice(0, 200)}`);
  }
}

// Phase E (T0_ENABLED): after money moved (a new money event in the audit log), the books go to T:0 in the background.
// Idempotent per journal entry; a failure is logged and dropped, and the next movement tries again.
const moneyEvents = [...MONEY_EVENTS];
let lastMoneySeq = -1;
function t0Tick(): void {
  if (!t0Enabled()) return;
  const seq = (db.prepare(`SELECT MAX(seq) AS s FROM audit_log WHERE event IN (${moneyEvents.map(() => "?").join(", ")})`).get(...moneyEvents) as { s: number | null }).s ?? 0;
  if (seq === lastMoneySeq) return;
  lastMoneySeq = seq;
  void t0SinkFor(db, { log: (line) => console.log(`${stamp()} ${line}`) }).afterMoney();
}

let lastError = "";
while (!stopping) {
  alarmsTick();
  await cardsTick();
  await quarantineTick();
  recordPullsTick();
  await reconcileTick();
  await settlementsTick();
  await finalityTick();
  await hubTick();
  t0Tick();
  try {
    await runner.syncOnce();
    if (lastError) console.log(`${stamp()} relay reachable again`);
    lastError = "";
    if (once) {
      await runner.idle();
      await runner.syncOnce();
      break;
    }
  } catch (e) {
    const message = (e as Error).message;
    if (message !== lastError) console.error(`${stamp()} relay unreachable: ${message}`);
    lastError = message;
    if (once) process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
process.exit(0);
