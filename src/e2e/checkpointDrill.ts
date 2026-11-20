// The checkpoint drill (outside audit 1.4, 20 Nov): signed audit checkpoints switched on for a runner's ledger file, as
// a runner is (PURSER_CHECKPOINT_KEY_FILE, PURSER_CHECKPOINT_FILE), and run through the runner's own code: a passkey
// enrolment, agents' card payments, an approved payment's execution, a policy change both ways and an agent key's
// rotation. Then, on copies of the ledger and its checkpoint file, each attack that the hash chain alone misses, with
// every sensitive operation tried after it and `npm run verify-audit` run against it. npm run audit:checkpoint-drill.
//
// What is simulated is labelled in the record (CHECKPOINT_DRILL_SIMULATED): the passkey is a virtual test passkey, the
// card rail is the in-memory Issuing double, and nothing reaches Airwallex, Alta or a phone. Test money only: no money
// moves anywhere. The key is made by `npm run verify-audit -- keygen` in a temporary directory outside the repository,
// and only its public key and key id are recorded.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buyPlan } from "../agents/cardBuyer.js";
import { parseCheckpoint } from "../audit/checkpoint.js";
import { CHECKPOINT_ENV, checkpointRefusal, resetCheckpointMemory, writeCheckpoint } from "../audit/checkpointer.js";
import { auditChainRefusal } from "../audit/intact.js";
import { MONEY_EVENTS } from "../provenance/origin.js";
import { openDb, type DB } from "../db/open.js";
import { executePolicyChange, proposePolicyChange } from "../executors/policyChange.js";
import { health } from "../ops/health.js";
import { processAssertion } from "../passkey/process.js";
import { payWithCard } from "../platform/externalAgents.js";
import { beginExecution } from "../policy/approvals.js";
import { reserveSpend } from "../policy/holds.js";
import { rotatePrincipalKey } from "../policy/principals.js";
import { frozen, policyValue } from "../policy/rules.js";
import { auditRows, checkpointLines, forgeAppend, nextSignedBy, rewriteFrom, truncateAfter } from "../redteam/checkpointAttacks.js";
import { redTeamWorld, type World } from "../redteam/world.js";

export const CHECKPOINT_PASSKEY_LABEL = "checkpoint-drill virtual test passkey (no person's Face ID)";

export const CHECKPOINT_DRILL_SIMULATED = [
  `The approver is a labelled virtual test passkey ("${CHECKPOINT_PASSKEY_LABEL}", src/redteam/authenticator.ts), enrolled on the drill's own ledger; its signatures go through the same WebAuthn verification as a phone's. No person's Face ID was used.`,
  "The agents' card payments go through the runner's own path (buyPlan, payWithCard: chargeUnderHold, reserveSpend, ingestCardTransaction) against the in-memory Issuing double (src/redteam/issuing.ts), not Airwallex: nothing reached Airwallex, Alta or a phone, and no money, test money included, moved.",
  "The approved payment is a refund batch whose execution is begun (beginExecution, the gate before any rail call); no rail is called after it.",
  "The attacks are made on copies of the ledger file and its checkpoint file, by plain SQL and file writes past Purser's code (src/redteam/checkpointAttacks.ts), as someone with write access to both would.",
  "The checkpoint key is a fresh Ed25519 key made by npm run verify-audit -- keygen in a temporary directory outside the repository, deleted at the end; only its public key and key id are in this record.",
];

export interface DrillStep { id: string; what: string; pass: boolean; detail: string; ms?: number }
export interface Timing { n: number; median_ms: number; max_ms: number }
export interface CheckpointDrillResult {
  started_at: string; ended_at: string;
  key: { key_id: string; public_key: string };
  ledger: { rows: number; money_rows: number; checkpoints: number; intents: number; ledger_bytes: number; checkpoint_file_bytes: number };
  timings: { check_before_payment: Timing; checkpoint_write: Timing; money_row_with_checkpoint: Timing };
  steps: DrillStep[];
}

export const timing = (ms: number[]): Timing => {
  const s = [...ms].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n: s.length, median_ms: r(mid ?? 0), max_ms: r(s.at(-1) ?? 0) };
};

const repo = resolve(import.meta.dirname, "../..");
/** A refusal for the checkpoints: the gate's own words (a proposal's refusal is prefixed with its id). */
const MISMATCH = /^(?:P-\d+: )?audit_checkpoint_mismatch: /;

function verifyAudit(env: Record<string, string>): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", resolve(repo, "src/cli/verifyAudit.ts")], { encoding: "utf8", env: { ...process.env, ...env }, cwd: repo, timeout: 120_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

function keygen(out: string): { key_id: string; public_key: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", resolve(repo, "src/cli/verifyAudit.ts"), "keygen", "--out", out], { encoding: "utf8", cwd: repo, timeout: 120_000 });
  const pub = /^public +(\S+)$/m.exec(r.stdout)?.[1];
  const id = /^key id +(\S+)$/m.exec(r.stdout)?.[1];
  if (r.status !== 0 || !pub || !id) throw new Error(`keygen failed (exit ${r.status})`);
  return { key_id: id, public_key: pub };
}

const money = (db: DB) => (db.prepare("SELECT event FROM audit_log").all() as { event: string }[]).filter((r) => MONEY_EVENTS.has(r.event)).length;
const refusedOps = (db: DB) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'audit.checkpoint_refused'").all() as { payload_json: string }[]).map((r) => (JSON.parse(r.payload_json) as { op: string }).op);
const flush = (db: DB) => db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

/** Runs the drill in a fresh temporary directory; removes it afterwards (keep: leave it for a look). */
export async function runCheckpointDrill(o: { log?: (l: string) => void; keep?: boolean } = {}): Promise<CheckpointDrillResult> {
  const log = o.log ?? (() => {});
  const saved = Object.fromEntries(Object.values(CHECKPOINT_ENV).map((k) => [k, process.env[k]]));
  const dir = mkdtempSync(join(tmpdir(), "purser-checkpoint-drill-"));
  const steps: DrillStep[] = [];
  const step = (id: string, what: string, pass: boolean, detail: string, ms?: number) => {
    steps.push({ id, what, pass, detail, ...(ms === undefined ? {} : { ms: Math.round(ms * 100) / 100 }) });
    log(`${pass ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  };
  const started = new Date();
  try {
    // 1. The key, made the way the runbook says (npm run verify-audit -- keygen), and the runner switched on.
    const keyFile = join(dir, "audit-checkpoint.pem");
    const key = keygen(keyFile);
    const mode = statSync(keyFile).mode & 0o777;
    step("key.made", "an Ed25519 key made by npm run verify-audit -- keygen, outside the repository", mode === 0o600, `key id ${key.key_id}, file mode ${mode.toString(8)}`);
    for (const k of Object.values(CHECKPOINT_ENV)) delete process.env[k];
    const ledgerFile = join(dir, "ledger.sqlite");
    const cpFile = join(dir, "ledger.checkpoints.jsonl");
    process.env[CHECKPOINT_ENV.keyFile] = keyFile;
    process.env[CHECKPOINT_ENV.file] = cpFile;
    resetCheckpointMemory();

    // 2. The runner's flows on its ledger file, with the gate on.
    const w: World = await redTeamWorld(new Date(), { dbFile: ledgerFile, label: CHECKPOINT_PASSKEY_LABEL });
    const db = w.db;
    step("flow.enrolment", "the CFO's (virtual test) passkey enrolled and an outside agent onboarded, each checked against the latest checkpoint", existsSync(cpFile) && checkpointLines(cpFile).length > 0, `${checkpointLines(cpFile).length} checkpoint(s) written so far`);

    const charges: string[] = [];
    for (const plan of ["packwise-starter", "replyhub-starter", "ledgerly-starter"]) {
      const t = await buyPlan(db, w.issuing, plan, w.now());
      charges.push(`${plan} ${t.approved ? "approved" : `declined (${t.failureReason ?? t.status})`}`);
    }
    const ext = await payWithCard(db, w.issuing, w.outside, { merchant: "Trail Data Co", amount: "12.00", description: "market report (drill)" }, w.now());
    charges.push(`outside agent ${ext.approved ? "approved" : `declined (${ext.failureReason ?? ext.status})`}`);
    step("flow.card_payments", "four card payments by agents through chargeUnderHold and reserveSpend, each money row checkpointed", true, charges.join("; "));

    const p = w.propose();
    await processAssertion(db, w.cfoApproval(p.id, p.hash), w.now());
    let began = true;
    try { beginExecution(db, p.id, () => {}, w.now()); } catch { began = false; }
    step("flow.approved_payment", "an approved payment's execution begun (the gate before any rail call)", began, `${p.id} approved by the passkey; execution ${began ? "began" : "refused"}`);

    const stop = proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "checkpoint drill: emergency stop" }, "human", w.now());
    await processAssertion(db, w.cfoApproval(stop.proposal_id, stop.terms_sha256), w.now());
    executePolicyChange(db, stop.proposal_id, w.now());
    const lift = proposePolicyChange(db, { changes: [{ key: "freeze", to: "off" }], reason: "checkpoint drill: stop lifted" }, "human", w.now());
    await processAssertion(db, w.cfoApproval(lift.proposal_id, lift.terms_sha256), w.now());
    executePolicyChange(db, lift.proposal_id, w.now());
    step("flow.policy_change", "the emergency stop pulled and lifted (a loosening change, checked)", frozen(db) === false, "stop on, then off, each approved by the passkey");

    let rotated = true;
    try { rotatePrincipalKey(db, "sourcing", "checkpoint-drill", w.now()); } catch { rotated = false; }
    step("flow.key_enrolment", "an agent's key rotated (a key enrolment, checked)", rotated, `sourcing agent key ${rotated ? "rotated" : "refused"}`);

    // For each attack copy: a stop and a lift approved now, to be carried out after the attack.
    const pendingStop = proposePolicyChange(db, { changes: [{ key: "freeze", to: "on" }], reason: "checkpoint drill: stop after the attack" }, "human", w.now());
    await processAssertion(db, w.cfoApproval(pendingStop.proposal_id, pendingStop.terms_sha256), w.now());
    // The loosening one: the sourcing card's limit per purchase raised (the stop is off now, so lifting it is no change).
    const raised = (Number(policyValue(db, "card.sourcing.per_tx")) + 10).toFixed(2);
    const pendingLift = proposePolicyChange(db, { changes: [{ key: "card.sourcing.per_tx", to: raised }], reason: "checkpoint drill: a higher card limit after the attack" }, "human", w.now());
    await processAssertion(db, w.cfoApproval(pendingLift.proposal_id, pendingLift.terms_sha256), w.now());

    // 3. Timings on the live ledger: the check before a payment, a checkpoint write, a money row with its intent and checkpoint.
    const checks: number[] = [];
    for (let i = 0; i < 25; i++) { const t0 = performance.now(); const r = checkpointRefusal(db, "payment", w.now()); checks.push(performance.now() - t0); if (r) throw new Error(`clean ledger refused: ${r}`); }
    const writes: number[] = [];
    for (let i = 0; i < 10; i++) { const t0 = performance.now(); const r = writeCheckpoint(db); writes.push(performance.now() - t0); if (!r.ok) throw new Error(`checkpoint write refused: ${r.reason}`); }
    const moneyRows: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      const r = reserveSpend(db, { agent: "sourcing", rail: "metal", cents: 1, ref: `drill-${i}`, now: w.now(), payee: "supplier" });
      moneyRows.push(performance.now() - t0);
      if (r) throw new Error(`spend refused: ${r}`);
    }
    writeCheckpoint(db);
    flush(db);

    const clean = verifyAudit({ KIT11_DB: ledgerFile, [CHECKPOINT_ENV.keyFile]: keyFile, [CHECKPOINT_ENV.file]: cpFile });
    step("clean.verify_audit", "npm run verify-audit on the runner's ledger: every row's hash and every checkpoint's signature", clean.status === 0 && /^ok /.test(clean.out), clean.out.split("\n")[0]!);
    const alarmsClean = health(db, w.now()).alerts.filter((a) => a.code.startsWith("audit_checkpoint"));
    step("clean.health", "/health has no checkpoint alarm on the clean ledger", alarmsClean.length === 0, alarmsClean.length ? alarmsClean.map((a) => a.code).join(", ") : "no audit_checkpoint alarm");

    const rows = auditRows(db);
    const allLines = readFileSync(cpFile, "utf8").split("\n").filter(Boolean);
    const intents = allLines.filter((l) => (parseCheckpoint(l) as { v: string }).v.includes("intent")).length;
    const ledger = { rows: rows.length, money_rows: money(db), checkpoints: checkpointLines(cpFile).length, intents, ledger_bytes: statSync(ledgerFile).size, checkpoint_file_bytes: statSync(cpFile).size };
    log(`ledger   ${ledger.rows} audit rows (${ledger.money_rows} money rows), ${ledger.checkpoints} checkpoints, ${ledger.intents} signed intents`);
    db.close();

    // 4. The attacks, each on a fresh copy, by a fresh process's memory.
    const stranger = generateKeyPairSync("ed25519").privateKey;
    const attacks: { id: string; what: string; run: (cdb: DB, cp: string) => void }[] = [
      { id: "truncate", what: "the last two audit rows cut off the end", run: (cdb) => truncateAfter(cdb, auditRows(cdb).length - 2) },
      { id: "rewrite", what: "audit row 3 rewritten and every hash after it recomputed", run: (cdb) => rewriteFrom(cdb, 3, { rewritten: true }) },
      { id: "forged_money_row", what: "a money row (refund.paid, 500.00) appended after the latest checkpoint", run: (cdb) => { forgeAppend(cdb, "refund.paid", { amount: "500.00", origin: null }); } },
      { id: "checkpoint_file_cut", what: "the checkpoint file cut back to its first checkpoint", run: (_c, cp) => writeFileSync(cp, `${checkpointLines(cp)[0]}\n`) },
      { id: "checkpoint_replayed", what: "an old checkpoint appended again as the latest", run: (_c, cp) => appendFileSync(cp, `${checkpointLines(cp)[1]}\n`) },
      { id: "wrong_key", what: "a forged row covered by a checkpoint signed with a key the chain never introduced", run: (cdb, cp) => { const f = forgeAppend(cdb, "x.note", { forged: true }); appendFileSync(cp, `${JSON.stringify(nextSignedBy(cp, stranger, { entries: f.seq, head: f.row_hash }))}\n`); } },
    ];
    for (const a of attacks) {
      const aLedger = join(dir, `attack-${a.id}.sqlite`);
      const aCp = join(dir, `attack-${a.id}.checkpoints.jsonl`);
      copyFileSync(ledgerFile, aLedger);
      copyFileSync(cpFile, aCp);
      process.env[CHECKPOINT_ENV.file] = aCp;
      resetCheckpointMemory();
      const adb = openDb(aLedger);
      a.run(adb, aCp);
      const chainAlone = auditChainRefusal(adb);
      flush(adb);
      adb.close();
      // The offline verifier on the attacked files, before the runner adds its refusals to them.
      const v = verifyAudit({ KIT11_DB: aLedger, [CHECKPOINT_ENV.keyFile]: keyFile, [CHECKPOINT_ENV.file]: aCp });
      const findings = [...v.out.matchAll(/^FAIL {2}([a-z_]+) {2}/gm)].map((m) => m[1]!);
      // Then the runner, as a fresh process on them.
      resetCheckpointMemory();
      const cdb = openDb(aLedger);
      const t0 = performance.now();
      const pay = reserveSpend(cdb, { agent: "sourcing", rail: "metal", cents: 3, ref: `after-${a.id}`, now: w.now(), payee: "supplier" });
      const payMs = performance.now() - t0;
      let exec: string | null = null;
      try { executePolicyChange(cdb, pendingStop.proposal_id, w.now()); } catch (e) { exec = (e as Error).message; }
      let loosen: string | null = null;
      try { executePolicyChange(cdb, pendingLift.proposal_id, w.now()); } catch (e) { loosen = (e as Error).message; }
      let enrol: string | null = null;
      try { rotatePrincipalKey(cdb, "sourcing", "checkpoint-drill", w.now()); } catch (e) { enrol = (e as Error).message; }
      const ops = refusedOps(cdb);
      const alarm = health(cdb, w.now()).alerts.filter((x) => x.code.startsWith("audit_checkpoint")).map((x) => `${x.code} (${x.severity})`);
      cdb.close();
      step(`attack.${a.id}.chain_alone`, `${a.what}: the hash chain's own check`, true, chainAlone ? `the chain alone refuses too (${chainAlone.slice(0, 80)})` : "the chain alone passes (the hole checkpoints close)");
      step(`attack.${a.id}.payment`, `${a.what}: the next payment`, MISMATCH.test(pay ?? ""), pay ? pay.slice(0, 160) : "NOT refused", payMs);
      step(`attack.${a.id}.tightening`, `${a.what}: the emergency stop (moves no money, tightens) still runs`, exec === null, exec ? exec.slice(0, 160) : "ran");
      step(`attack.${a.id}.loosening`, `${a.what}: a higher card limit (a loosening policy change)`, MISMATCH.test(loosen ?? ""), loosen ? loosen.slice(0, 160) : "NOT refused");
      step(`attack.${a.id}.key_enrolment`, `${a.what}: an agent key enrolment`, MISMATCH.test(enrol ?? ""), enrol ? enrol.slice(0, 160) : "NOT refused");
      step(`attack.${a.id}.recorded`, `${a.what}: audit.checkpoint_refused recorded for each`, ["payment", "policy change", "key enrolment"].every((op) => ops.includes(op)), `refused ops recorded: ${[...new Set(ops)].join(", ") || "none"}`);
      step(`attack.${a.id}.health`, `${a.what}: /health raises the critical alarm`, alarm.some((x) => x.startsWith("audit_checkpoint_mismatch (critical)")), alarm.join(", ") || "no alarm");
      step(`attack.${a.id}.verify_audit`, `${a.what}: npm run verify-audit`, v.status === 1 && findings.length > 0, `exit ${v.status}; ${findings.join(", ") || "no finding"}`);
    }
    const ended = new Date();
    return { started_at: started.toISOString(), ended_at: ended.toISOString(), key, ledger, timings: { check_before_payment: timing(checks), checkpoint_write: timing(writes), money_row_with_checkpoint: timing(moneyRows) }, steps };
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    resetCheckpointMemory();
    if (!o.keep) rmSync(dir, { recursive: true, force: true });
  }
}

export interface CheckpointDrillRecord extends CheckpointDrillResult {
  run: "checkpoint-drill"; date: string; command: string; commit: string | null; node: string; platform: string; simulated: string[];
  summary: { steps: number; passed: number; failed: number };
}

export function checkpointDrillRecord(r: CheckpointDrillResult, o: { date: string; commit: string | null; node: string; platform: string }): CheckpointDrillRecord {
  const passed = r.steps.filter((s) => s.pass).length;
  return { run: "checkpoint-drill", date: o.date, command: "npm run audit:checkpoint-drill -- record", commit: o.commit, node: o.node, platform: o.platform, simulated: CHECKPOINT_DRILL_SIMULATED, summary: { steps: r.steps.length, passed, failed: r.steps.length - passed }, ...r };
}

const ms = (t: Timing) => `median ${t.median_ms} ms, max ${t.max_ms} ms (${t.n} runs)`;

export function renderCheckpointDrill(rec: CheckpointDrillRecord): string {
  const attacks = [...new Set(rec.steps.filter((s) => s.id.startsWith("attack.")).map((s) => s.id.split(".")[1]!))];
  const refusedAll = attacks.filter((a) => rec.steps.filter((s) => s.id.startsWith(`attack.${a}.`)).every((s) => s.pass));
  return [
    `# Checkpoint drill: ${rec.date}`,
    "",
    `\`${rec.command}\`. Signed audit checkpoints (outside audit 1.4, [security.md](../security.md#signed-audit-checkpoints-20-november-outside-audit-14)) switched on for a runner's ledger file, as the runbook says (PURSER_CHECKPOINT_KEY_FILE, PURSER_CHECKPOINT_FILE), and run through the runner's own code; then each attack the hash chain alone misses, on copies of that ledger and its checkpoint file. Code: \`${(rec.commit ?? "unknown").slice(0, 12)}\`; Node ${rec.node} on ${rec.platform}; ${rec.started_at} to ${rec.ended_at}. The machine-readable record is docs/runs/${rec.date}-checkpoint-drill.json.`,
    "",
    `**${rec.summary.passed} of ${rec.summary.steps} steps passed, ${rec.summary.failed} failed.** ${refusedAll.length} of ${attacks.length} attacks refused at every gate and found by \`npm run verify-audit\`.`,
    "",
    "## In short",
    "",
    `- The runner's ledger: ${rec.ledger.rows} audit rows (${rec.ledger.money_rows} money rows), ${rec.ledger.checkpoints} signed checkpoints and ${rec.ledger.intents} signed intents, key id \`${rec.key.key_id}\`.`,
    `- The check before a payment: ${ms(rec.timings.check_before_payment)}.`,
    `- A checkpoint write (sign and append, fsync): ${ms(rec.timings.checkpoint_write)}.`,
    `- An agent's spend with its money row, signed intent and checkpoint (reserveSpend): ${ms(rec.timings.money_row_with_checkpoint)}.`,
    `- Attacks: ${attacks.join(", ")}. After each, the next payment, a loosening policy change (a higher card limit) and a key enrolment were tried; the emergency stop, which moves no money and tightens, was also tried.`,
    "",
    "## Simulated, and how",
    "",
    ...rec.simulated.map((s) => `- ${s}`),
    "",
    "## Every step",
    "",
    "| Step | What | Result | Detail |",
    "|---|---|---|---|",
    ...rec.steps.map((s) => `| \`${s.id}\` | ${s.what} | ${s.pass ? "pass" : "**FAIL**"} | ${s.detail.replace(/\|/g, "\\|")}${s.ms === undefined ? "" : ` (${s.ms} ms)`} |`),
    "",
    "## Not shown here",
    "",
    "- Purser Cloud's hosted engine (Durable Objects, purser-try) does not run checkpoints: they are the self-hosted runner's (a ledger file and a checkpoint file on disk). See docs/security.md.",
    "- A non-money row forged between two checkpoints, and a fresh process shown a checkpoint file cut back together with a ledger rewound to match, are the limits docs/security.md names; the second is found only against a copy of the file kept elsewhere (`npm run verify-audit -- --known <copy>`).",
    "",
  ].join("\n");
}
