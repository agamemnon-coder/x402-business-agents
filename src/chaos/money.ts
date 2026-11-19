// Chaos for money movement (npm run chaos:money). A euro invoice is proposed, approved with a passkey (a software
// authenticator through the real assertion path) and paid by the real executor (src/executors/invoicePayment.ts) over the
// real Airwallex client and adapter, talking to a stand-in REST API (./standInAirwallex.ts) that times out, answers 5xx and
// 429, drops the connection after Airwallex did the work, and lets the runner's process die at any saga checkpoint
// (src/policy/saga.ts) or with any call sent. A crash is emulated faithfully: the ledger is the SQLite image at the
// instant of death (db.serialize()), whatever catch or finally blocks did after it is thrown away with the old process,
// and Airwallex refuses every call of the dead process. The next life restarts as the runner does (recoverHolds, then
// resumeInterrupted). Clocks are skewed (the runner's against Airwallex's) and an approval may come late. Then the webhook
// storm: Airwallex's own events for every transfer, duplicated, out of order, and forged ones. A last calm life runs the
// recovery once more, and the invariants are checked:
//   I1 never paid twice: at Airwallex at most one live transfer and one conversion per approved proposal, none per other
//      proposal; no request_id twice;
//   I2 never paid without a valid signature: every transfer carries the hash of terms a passkey approved, the stored
//      signatures re-verify offline (reverifyPasskeyApprovals), and its amount is the approved amount;
//   I3 the ledger balances: the audit chain verifies, the general ledger verifies, Airwallex's money is conserved, and the
//      real reconciliation (src/finance/reconcile.ts) finds the ledger and Airwallex agree;
//   I4 every payment ends in a known state (executed and PAID; failed, expired or sent back for approval with nothing live
//      at Airwallex) or goes to a person (an alarm row: a payout left open, a reconciliation difference, ...);
//   I5 webhooks move nothing: no proposal or payout row changes while they are handled; forged ones are ignored.
// Test money only, no network, no key.
import Database from "better-sqlite3";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { AirwallexRest } from "../airwallex/adapter.js";
import { Airwallex } from "../airwallex/client.js";
import { proposeInvoicePayment, seedTreasury } from "../agents/euroBill.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import { verifyAuditChain } from "../audit/log.js";
import { openDb, type DB } from "../db/open.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { reconcile } from "../finance/reconcile.js";
import { verifyLedger } from "../ledger/core.js";
import { rejectionSha256, termsHash, type Terms } from "../lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../passkey/process.js";
import { challengeFor, reverifyPasskeyApprovals } from "../passkey/webauthn.js";
import { handleAirwallexHook } from "../policy/cardHooks.js";
import { recoverHolds } from "../policy/holds.js";
import { followPayouts } from "../payouts/follow.js";
import { health } from "../ops/health.js";
import { chaos, resumeInterrupted } from "../policy/saga.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { FAULTS, StandInAirwallex, type Fault } from "./standInAirwallex.js";

const RP = "purser.example";
const ORIGIN = `https://${RP}`;
const HOOK_SECRET = ["whsec", "chaos", "money", "stand", "in"].join("_");
const INVOICE_TEXT = readFileSync(new URL("../../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");
/** The saga's checkpoints on an invoice payment, where the process may die. */
export const CHECKPOINTS = ["conversion:before", "conversion:after-call", "conversion:after", "transfer:after-insert", "transfer:before", "transfer:after-create", "transfer:after-call", "transfer:after", "settle:before", "settle:after-call", "settle:after"] as const;

/** A small seeded generator (mulberry32): the same seed, the same scenarios, on any machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Scenario {
  id: string;
  /** What the scenario does, in words (hand-written ones say why). */
  title: string;
  seed: number;
  invoices: number;
  /** The chance of a fault on each call while faults are on, and which faults may happen. */
  faultRate: number;
  faults: Fault[];
  /** How many lives (runs of the recovery) faults stay on for, before the calm one. */
  faultyLives: number;
  /** The process dies at the nth time it reaches this checkpoint (1 = first), or with the nth Airwallex call of its life sent (of those to `path` when given). */
  crash: { at: "checkpoint"; point: string; nth: number } | { at: "call"; nth: number; path?: string } | null;
  /** A second crash, at this checkpoint, in the life after the first. */
  secondCrash: string | null;
  /** The runner's clock minus Airwallex's (ms); and how long after the approval the payment starts. */
  skewMs: number;
  delayMs: number;
  /** Two runners execute at once (the runner and a CLI on one ledger). */
  concurrent: boolean;
  /** The webhook storm: each event delivered this many times, shuffled; and forged events. */
  hookCopies: number;
  forgedHooks: number;
  /** Hand-written adversarial setups (never approved, terms edited after approval, a signature over other terms). */
  adversary?: "unapproved" | "terms-edited" | "other-terms-signature" | "rejected";
  /**
   * A canary: a planted break the invariants must catch, made after the run and before the checks (a second transfer
   * under one approval, a transfer under no approval, a payout row changed behind Airwallex's back, a payment the
   * ledger calls failed while Airwallex paid it). Never in the randomized set; the report lists them apart.
   */
  sabotage?: "pay-twice" | "pay-unsigned" | "payout-row-edited" | "failed-but-paid";
}

export interface Invariant { id: "I1" | "I2" | "I3" | "I4" | "I5"; ok: boolean; detail: string }
export interface ScenarioResult {
  id: string; title: string; seed: number; ok: boolean; invariants: Invariant[];
  /** Proposals that sat APPROVED, refused before they began, with no alarm (until their expiry). */
  silentApprovals: string[];
  outcome: string[]; calls: number; faults: number; faultKinds: Record<string, number>; crashes: number; hooks: { delivered: number; forged: number; ignored: number };
  scenario: Scenario;
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** The randomized scenarios: `count` of them from `seed`. */
export function randomScenarios(seed: number, count: number): Scenario[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const s = Math.floor(r() * 2 ** 31);
    const crashKind = r();
    const faults = FAULTS.filter(() => r() < 0.6);
    return {
      id: `R${String(i + 1).padStart(3, "0")}`, title: "randomized", seed: s,
      invoices: r() < 0.25 ? 2 : 1,
      faultRate: pick(r, [0, 0.05, 0.15, 0.3, 0.5]),
      faults: faults.length ? faults : [pick(r, FAULTS)],
      faultyLives: 1 + Math.floor(r() * 3),
      crash: crashKind < 0.35 ? { at: "checkpoint", point: pick(r, CHECKPOINTS), nth: 1 + Math.floor(r() * 2) } : crashKind < 0.6 ? { at: "call", nth: 1 + Math.floor(r() * 14) } : null,
      secondCrash: r() < 0.2 ? pick(r, CHECKPOINTS) : null,
      skewMs: pick(r, [0, 0, 0, -120_000, 90_000, -600_000, 600_000, 16 * 60_000]),
      delayMs: pick(r, [0, 0, 0, 60_000, 14 * 60_000, 25 * 60_000]),
      concurrent: r() < 0.25,
      hookCopies: 1 + Math.floor(r() * 3),
      forgedHooks: Math.floor(r() * 4),
    };
  });
}

const base = (id: string, title: string, over: Partial<Scenario>): Scenario => ({ id, title, seed: 1, invoices: 1, faultRate: 0, faults: [], faultyLives: 1, crash: null, secondCrash: null, skewMs: 0, delayMs: 0, concurrent: false, hookCopies: 1, forgedHooks: 0, ...over });

/** The hand-written scenarios: each one names the failure it is about. */
export const HAND_WRITTEN: readonly Scenario[] = [
  base("H01", "the transfer create is done at Airwallex and its answer is lost (connection dropped), every time it is sent", { faultRate: 1, faults: ["lost-answer"], faultyLives: 2 }),
  base("H02", "the process dies right after Airwallex made the transfer, before the ledger heard of it", { crash: { at: "checkpoint", point: "transfer:after-create", nth: 1 } }),
  base("H03", "the process dies with the conversion sent and done at Airwallex, before its answer arrives", { crash: { at: "call", nth: 1, path: "/fx/conversions/create" } }),
  base("H16", "the process dies with the transfer create sent and done at Airwallex, before its answer arrives", { crash: { at: "call", nth: 1, path: "/transfers/create" } }),
  base("H17", "the conversion's answer is lost, then the payout cannot go on (the EUR floor): the converted money must not vanish from view", { invoices: 2, faultRate: 1, faults: ["lost-answer"], faultyLives: 1 }),
  base("H04", "429 on every call, beyond the client's retries, then calm", { faultRate: 1, faults: ["429"], faultyLives: 2 }),
  base("H05", "502 after Airwallex did the work, on every POST", { faultRate: 1, faults: ["502-after"], faultyLives: 2 }),
  base("H06", "two runners pay the same approved proposal at once, with lost answers", { concurrent: true, faultRate: 0.4, faults: ["lost-answer", "timeout-after"] }),
  base("H07", "the runner's clock is 16 minutes ahead of Airwallex's: the quote it holds looks expired", { skewMs: 16 * 60_000 }),
  base("H08", "the approval is used 25 minutes later: the terms have expired", { delayMs: 25 * 60_000 }),
  base("H09", "a webhook storm: every event five times, shuffled, and six forged events", { hookCopies: 5, forgedHooks: 6 }),
  base("H10", "never approved: the executor is asked to pay a proposal waiting for the CFO", { adversary: "unapproved" }),
  base("H11", "the terms in the ledger are changed after the passkey approved them (amount +1.00)", { adversary: "terms-edited" }),
  base("H12", "the passkey signed other terms (another amount): the approval is refused, nothing is paid", { adversary: "other-terms-signature" }),
  base("H13", "rejected with the passkey, then the executor is asked to pay", { adversary: "rejected" }),
  base("H14", "the process dies twice: with the transfer's answer in hand, then again during the next life's settlement", { crash: { at: "checkpoint", point: "transfer:after-call", nth: 1 }, secondCrash: "settle:after-call" }),
  base("H15", "two invoices, every fault kind at 50%, three faulty lives, a crash with the 9th call", { invoices: 2, faultRate: 0.5, faults: [...FAULTS], faultyLives: 3, crash: { at: "call", nth: 9 } }),
];

class Crashed extends Error { constructor() { super("crashed"); this.name = "Crashed"; } }

/** One scenario, start to end, and its invariants. */
export async function runScenario(sc: Scenario, onEnd?: (db: DB) => void): Promise<ScenarioResult> {
  const r = rng(sc.seed);
  let elapsed = 0;
  const awxNow = () => Date.now() + elapsed;
  const runnerNow = () => new Date(Date.now() + elapsed + sc.skewMs);
  const awx = new StandInAirwallex(awxNow);
  let db: DB = openDb(":memory:");
  const outcome: string[] = [];
  let crashes = 0;
  const rail = () => new AirwallexRest(new Airwallex({ clientId: "stand-in", apiKey: "stand-in", fetchImpl: awx.fetch, sleep: async () => {}, minGapMs: 0, now: awxNow, timeoutMs: 1_000 }));
  const fast = { delaysMs: [1, 1, 1, 1, 1], sleep: async () => {} };

  // Setup, calm: the treasury, the CFO's passkey, the invoices proposed and approved.
  const setupRail = rail();
  await seedTreasury(db, setupRail, setupRail);
  const phone = new FakeAuthenticator();
  let tickets = 0, counter = 0;
  const item = (kind: InboxItem["kind"], body: unknown, proposalId: string | null): InboxItem => ({ ticket: `ch-${++tickets}`, kind, proposal_id: proposalId, body: JSON.stringify(body), received_at: runnerNow().toISOString() });
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, runnerNow());
  const reg = await processRegistration(db, item("registration", { code, credential: phone.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }, null), { label: "cfo" }, runnerNow());
  if (reg.status !== "pending") throw new Error(`enrolment: ${reg.message}`);
  confirmPasskey(db, fingerprintOf(phone.spkiSha256), runnerNow());
  const proposals: string[] = [];
  for (let k = 0; k < sc.invoices; k++) {
    const text = k === 0 ? INVOICE_TEXT : INVOICE_TEXT.replaceAll("BTX-2026-11", `BTX-2026-1${k + 1}`);
    const out = await proposeInvoicePayment(db, setupRail, parseInvoiceFallback(text), text, runnerNow());
    if (out.kind !== "proposed") { outcome.push(`invoice ${k + 1}: ${out.kind} (${"reason" in out ? String(out.reason).slice(0, 80) : ""})`); continue; }
    const id = out.proposal.proposal_id, sha = out.proposal.terms_sha256;
    proposals.push(id);
    const sign = (signed: string, decision?: "REJECTED") => ({ proposal_id: id, terms_sha256: sha, ...(decision ? { decision } : {}), credential: phone.sign({ challenge: challengeFor(signed), origin: ORIGIN, rpId: RP, counter: ++counter }) });
    if (sc.adversary === "unapproved") continue;
    if (sc.adversary === "rejected") {
      const rej = await processAssertion(db, item("assertion", sign(rejectionSha256(sha), "REJECTED"), id), runnerNow());
      outcome.push(`${id} rejection: ${rej.status}`);
      continue;
    }
    const signed = sc.adversary === "other-terms-signature" ? otherTermsHash(db, id) : sha;
    const a = await processAssertion(db, item("assertion", sign(signed), id), runnerNow());
    outcome.push(`${id} approval: ${a.status}`);
    if (sc.adversary === "terms-edited") {
      const t = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as Record<string, unknown>;
      db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, amount: (Number(t.amount) + 1).toFixed(2) }), id);
    }
  }
  elapsed += sc.delayMs;

  // The lives: faults on for sc.faultyLives lives, then one calm life. A crash ends a life early.
  let crashPlan = sc.crash;
  for (let life = 0; life <= sc.faultyLives; life++) {
    const calm = life === sc.faultyLives;
    awx.revive();
    awx.faultOf = () => (!calm && r() < sc.faultRate ? pick(r, sc.faults) : null);
    let image: Buffer | null = null;
    const die = () => { if (!image) image = db.serialize(); };
    if (crashPlan && !calm) {
      const plan = crashPlan;
      if (plan.at === "call") {
        let k = 0;
        awx.crashOn = (call) => (!plan.path || call.path === plan.path) && ++k === plan.nth;
      }
      awx.onCrash = die;
      let seen = 0;
      chaos.at = (point) => {
        if (image) throw new Crashed();
        if (plan.at === "checkpoint" && point === plan.point && ++seen === plan.nth && !db.inTransaction) { awx.dead = true; die(); throw new Crashed(); }
      };
    } else {
      chaos.at = (_point) => { if (image) throw new Crashed(); };
    }
    const runOnce = async () => {
      const rl = rail();
      try {
        recoverHolds(db, runnerNow());
        const res = await resumeInterrupted(db, async (d, id) => {
          // H10 and H13: the executor is asked even for a proposal that is not approved (a bug, or someone at the CLI).
          await executeInvoicePayment(d, rl, rl, id, runnerNow, fast);
        }, runnerNow());
        if (sc.adversary === "unapproved" || sc.adversary === "rejected") {
          for (const id of proposals) await executeInvoicePayment(db, rl, rl, id, runnerNow, fast).then(() => outcome.push(`${id}: the executor paid an unapproved proposal`), (e: Error) => outcome.push(`${id}: executor refused (${e.message.slice(0, 70)})`));
        }
        return res.map((x) => `${x.id} ${x.outcome.slice(0, 90)}`).join("; ");
      } catch (e) {
        return `life threw ${(e as Error).name}: ${(e as Error).message.slice(0, 80)}`;
      }
    };
    const lives = sc.concurrent && life === 0 ? await Promise.all([runOnce(), runOnce()]) : [await runOnce()];
    chaos.at = null;
    outcome.push(`life ${life + 1}${calm ? " (calm)" : ""}: ${lives.join(" || ") || "nothing to resume"}`);
    if (image) {
      crashes++;
      db.close();
      db = reopen(image);
      const last = awx.log.at(-1);
      outcome.push(`  died (${crashPlan?.at === "call" ? `with ${last?.method} ${last?.path} sent and done` : crashPlan && "point" in crashPlan ? `at ${crashPlan.point}` : "?"}); restarted from the ledger as it was at that instant`);
      crashPlan = sc.secondCrash && crashes === 1 ? { at: "checkpoint", point: sc.secondCrash, nth: 1 } : null;
      // A life that died does not count: the same life runs again (faulty or calm), with a second crash if planned.
      life--;
    }
  }
  awx.revive();
  awx.faultOf = () => null;

  // The tail, calm, as the days after go: a person retries each failed payment once (the retry route's semantics: the
  // executor's own resume path); Airwallex pays out what it holds; the runner follows its payouts and reconciles.
  const tail = rail();
  for (const p of db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'invoice_payment' AND status = 'FAILED' ORDER BY proposal_id").all() as { proposal_id: string }[]) {
    const res = await executeInvoicePayment(db, tail, tail, p.proposal_id, runnerNow, fast).then(() => "paid", (e: Error) => `refused: ${e.message.slice(0, 80)}`);
    outcome.push(`a person retries ${p.proposal_id}: ${res}`);
  }
  await awx.settleAll();
  await followPayouts(db, tail, runnerNow());
  // What sits APPROVED now, refused before it began, with nothing on /health or in the alarm rows: kept as an
  // observation (it becomes EXPIRED at the next start after its expiry, below), never as a pass.
  const silent = (db.prepare("SELECT proposal_id FROM proposals WHERE status = 'APPROVED'").all() as { proposal_id: string }[]).map((x) => x.proposal_id)
    .filter((id) => !health(db, runnerNow()).alerts.some((a) => MONEY_ALERTS.includes(a.code)) && !db.prepare(`SELECT 1 FROM audit_log WHERE subject = ? AND event IN (${TO_A_PERSON.map(() => "?").join(",")})`).get(id, ...TO_A_PERSON));
  if (silent.length) outcome.push(`approved, refused before it began, no alarm: ${silent.join(", ")}`);
  // The next day: the runner starts again (as it does after a deploy or a reboot) and follows its payouts once more.
  elapsed += 24 * 3_600_000;
  recoverHolds(db, runnerNow());
  const nextDay = await resumeInterrupted(db, async (d, id) => { await executeInvoicePayment(d, tail, tail, id, runnerNow, fast); }, runnerNow());
  if (nextDay.length) outcome.push(`the next day's start: ${nextDay.map((x) => `${x.id} ${x.outcome.slice(0, 90)}`).join("; ")}`);
  await awx.settleAll();
  await followPayouts(db, tail, runnerNow());

  if (sc.sabotage) sabotage(db, awx, sc.sabotage);

  // The webhook storm, then the invariants.
  const before = moneyRows(db);
  const hooks = webhookStorm(db, awx, r, sc, runnerNow);
  const after = moneyRows(db);
  const invariants = await check(db, awx, proposals, sc, before === after, hooks, runnerNow);
  const result: ScenarioResult = {
    id: sc.id, title: sc.title, seed: sc.seed, ok: invariants.every((i) => i.ok), invariants, silentApprovals: silent, outcome, calls: awx.log.length,
    faults: awx.log.filter((l) => l.fault).length, faultKinds: awx.log.reduce<Record<string, number>>((m, l) => (l.fault ? { ...m, [l.fault]: (m[l.fault] ?? 0) + 1 } : m), {}), crashes, hooks, scenario: sc,
  };
  onEnd?.(db);
  db.close();
  return result;
}

/** The hash of the proposal's terms with another amount: what a phone showing other terms would sign. */
function otherTermsHash(db: DB, id: string): string {
  const t = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as Record<string, unknown>;
  return termsHash({ ...t, amount: "1.00" } as unknown as Terms);
}

/** The canaries (Scenario.sabotage): each plants exactly one break of one invariant. */
function sabotage(db: DB, awx: StandInAirwallex, kind: NonNullable<Scenario["sabotage"]>): void {
  const first = awx.transfers.find((t) => t.status === "PAID");
  if (kind === "pay-twice" && first) awx.transfers.push({ ...first, id: randomUUID(), requestId: randomUUID() });
  if (kind === "pay-unsigned") awx.transfers.push({ id: randomUUID(), requestId: randomUUID(), status: "PAID", amountCents: 50_000, currency: "EUR", metadata: "0".repeat(64), fee: null, beneficiaryId: "ben_2" });
  if (kind === "payout-row-edited") db.prepare("UPDATE transfers SET status = 'SENT' WHERE status = 'PAID'").run();
  if (kind === "failed-but-paid") db.prepare("UPDATE proposals SET status = 'FAILED' WHERE status = 'EXECUTED'").run();
}

/** The canaries: the same calm payment, each with one planted break; every one must be caught. */
export const CANARIES: readonly Scenario[] = [
  base("C1", "canary: a second transfer at Airwallex under the same approval (a double payment)", { sabotage: "pay-twice" }),
  base("C2", "canary: a transfer at Airwallex that no approval signed", { sabotage: "pay-unsigned" }),
  base("C3", "canary: the ledger's payout row says SENT while Airwallex says PAID", { sabotage: "payout-row-edited" }),
  base("C4", "canary: the ledger calls a payment failed while Airwallex paid it, and nothing says so", { sabotage: "failed-but-paid" }),
];

/** A ledger reopened from the image it had when its process died (as SQLite finds the file after a SIGKILL). */
function reopen(image: Buffer): DB {
  const db = new Database(image);
  db.pragma("foreign_keys = ON");
  return db;
}

/** The proposal and payout rows, as text: compared before and after the webhooks. */
function moneyRows(db: DB): string {
  return JSON.stringify([db.prepare("SELECT proposal_id, status, terms_sha256 FROM proposals ORDER BY proposal_id").all(), db.prepare("SELECT * FROM transfers ORDER BY rowid").all(), db.prepare("SELECT * FROM approvals ORDER BY approval_id").all()]);
}

/** Airwallex's events for every status each transfer went through, duplicated and shuffled, and forged ones. */
function webhookStorm(db: DB, awx: StandInAirwallex, r: () => number, sc: Scenario, now: () => Date): { delivered: number; forged: number; ignored: number } {
  const events: { id: string; body: string; forged: boolean; key: string }[] = [];
  for (const h of awx.history) {
    const name = `payout.transfer.${h.status.toLowerCase()}`;
    const body = JSON.stringify({ id: `evt_${h.transferId}_${h.status}`, name, account_id: "acct_stand_in", created_at: new Date(h.at).toISOString(), data: { object: { id: h.transferId, request_id: h.requestId, status: h.status, transfer_amount: h.amountCents / 100, transfer_currency: "EUR" } } });
    for (let c = 0; c < sc.hookCopies; c++) events.push({ id: `evt_${h.transferId}_${h.status}`, body, forged: false, key: HOOK_SECRET });
  }
  for (let f = 0; f < sc.forgedHooks; f++) {
    const kind = f % 3;
    const target = awx.transfers[f % Math.max(1, awx.transfers.length)];
    const body = JSON.stringify({ id: `evt_forged_${f}`, name: "payout.transfer.paid", data: { object: { id: target?.id ?? randomUUID(), request_id: target?.requestId ?? randomUUID(), status: "PAID", transfer_amount: 999_999, transfer_currency: "EUR" } } });
    // 0: signed with another key; 1: a real event's signature on a changed body; 2: no signature at all.
    events.push({ id: `evt_forged_${f}`, body, forged: true, key: kind === 0 ? "whsec_attacker" : kind === 1 ? "replay" : "" });
  }
  for (let i = events.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [events[i], events[j]] = [events[j]!, events[i]!]; }
  let ignored = 0;
  const realSig = events.find((e) => !e.forged);
  for (const e of events) {
    const ts = String(now().getTime());
    const signature = e.key === "" ? "" : e.key === "replay" ? (realSig ? createHmac("sha256", HOOK_SECRET).update(ts + realSig.body).digest("hex") : "0".repeat(64)) : createHmac("sha256", e.key).update(ts + e.body).digest("hex");
    const line = handleAirwallexHook(db, { id: e.id, ts, body: e.body, signature }, HOOK_SECRET, now());
    if (/bad signature|ignored/.test(line)) ignored++;
  }
  return { delivered: events.length, forged: events.filter((e) => e.forged).length, ignored };
}

/** The /health alerts that tell a person a payment needs them (src/ops/health.ts). */
const MONEY_ALERTS = ["action_stuck", "airwallex_disagrees", "reconciliation_difference", "hold_stale"];
const LIVE = (s: string) => !["CANCELLED", "FAILED", "REFUNDED", "RETURNED"].includes(s);
/** Rows a person is shown (an alarm on the dashboard or in /health): the payment went to a person. */
const TO_A_PERSON = ["transfer.left_open", "transfer.ambiguous", "transfer.payee_unconfirmed", "transfer.row_conflict", "reconcile.difference", "transfer.retry_stopped", "transfer.awaiting_airwallex_approval", "transfer.fee_over_ceiling"];

async function check(db: DB, awx: StandInAirwallex, proposals: string[], sc: Scenario, hooksMovedNothing: boolean, hooks: { delivered: number; forged: number; ignored: number }, now: () => Date): Promise<Invariant[]> {
  const props = db.prepare("SELECT proposal_id, status, terms_sha256, terms_json FROM proposals WHERE kind = 'invoice_payment'").all() as { proposal_id: string; status: string; terms_sha256: string; terms_json: string }[];
  const approved = new Map((db.prepare("SELECT proposal_id, approved_sha256, method FROM approvals WHERE decision = 'APPROVED'").all() as { proposal_id: string; approved_sha256: string; method: string }[]).map((a) => [a.proposal_id, a]));
  const live = awx.transfers.filter((t) => LIVE(t.status));
  const out: Invariant[] = [];

  // I1: never paid twice.
  const perSha = new Map<string, number>();
  for (const t of live) perSha.set(t.metadata, (perSha.get(t.metadata) ?? 0) + 1);
  const twice = [...perSha.entries()].filter(([, n]) => n > 1);
  const convPer = new Map<string, number>();
  for (const [cid, sha] of awx.fake.conversionMetadata) { void cid; convPer.set(sha, (convPer.get(sha) ?? 0) + 1); }
  const convTwice = [...convPer.entries()].filter(([, n]) => n > 1);
  const reqIds = awx.transfers.map((t) => t.requestId);
  out.push({ id: "I1", ok: twice.length === 0 && convTwice.length === 0 && new Set(reqIds).size === reqIds.length && live.length <= approved.size,
    detail: `${live.length} live transfer(s) at Airwallex for ${approved.size} approval(s); ${awx.fake.conversions.length} conversion(s)${twice.length ? `; PAID TWICE: ${twice.map(([s, n]) => `${s.slice(0, 8)}×${n}`).join(", ")}` : ""}${convTwice.length ? `; CONVERTED TWICE: ${convTwice.length}` : ""}` });

  // I2: never paid without a valid signature.
  const sigChecks = await reverifyPasskeyApprovals(db);
  const unsigned: string[] = [];
  for (const t of awx.transfers) {
    const p = props.find((x) => x.terms_sha256 === t.metadata);
    const a = p ? approved.get(p.proposal_id) : undefined;
    const terms = p ? JSON.parse(p.terms_json) as { amount: string } : null;
    if (!p || !a || a.method !== "passkey" || a.approved_sha256 !== t.metadata || !terms || Math.round(Number(terms.amount) * 100) !== t.amountCents) unsigned.push(`${t.id.slice(0, 8)} (${(t.amountCents / 100).toFixed(2)} EUR, terms ${t.metadata.slice(0, 8)})`);
  }
  out.push({ id: "I2", ok: unsigned.length === 0 && sigChecks.every((c) => c.ok), detail: `${awx.transfers.length} transfer(s), each to passkey-approved terms: ${unsigned.length ? `NO for ${unsigned.join(", ")}` : "yes"}; ${sigChecks.length} stored signature(s) re-verified${sigChecks.some((c) => !c.ok) ? `: ${sigChecks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}` : ""}` });

  // I3: the ledger balances: the audit chain and the general ledger verify, Airwallex's money is conserved, and every
  // executed payment's payout row says what Airwallex says. The reconciliation runs as the hourly job runs it (its
  // differences are alarm rows, read by I4).
  const chain = verifyAuditChain(db);
  const gl = verifyLedger(db);
  const rec = await reconcile(db, {
    transfer: async (id) => { const t = awx.transfers.find((x) => x.id === id); if (!t) throw new Error(`no transfer ${id}`); return { status: t.status, amountCents: t.amountCents, currency: t.currency }; },
    transferByRequestId: async (rid) => { const t = awx.transfers.find((x) => x.requestId === rid); return t && { id: t.id, status: t.status, amountCents: t.amountCents, currency: t.currency }; },
  }, now());
  const f = awx.fake;
  const paidOut = awx.transfers.filter((t) => t.status === "PAID").reduce((s, t) => s + t.amountCents + (t.fee?.cents ?? 0), 0);
  const eurIn = f.conversions.reduce((s, c) => s + c.buyAmountCents, 0);
  const conserved = f.bal.EUR.availableCents + f.bal.EUR.reservedCents + paidOut === 3_500_000 + eurIn;
  const executedDisagree = props.filter((p) => p.status === "EXECUTED").filter((p) => {
    const rid = (JSON.parse(p.terms_json) as { transfer_request_id?: string }).transfer_request_id ?? "";
    const row = db.prepare("SELECT transfer_id, status FROM transfers WHERE request_id = ?").get(rid) as { transfer_id: string | null; status: string } | undefined;
    const t = awx.transfers.find((x) => x.requestId === rid);
    return !row || !t || row.transfer_id !== t.id || row.status !== t.status;
  }).map((p) => p.proposal_id);
  out.push({ id: "I3", ok: chain.ok && gl.ok && conserved && executedDisagree.length === 0,
    detail: `audit chain ${chain.ok ? "intact" : "BROKEN"}; general ledger ${gl.ok ? "verifies" : "DOES NOT VERIFY"}; Airwallex's EUR ${conserved ? "conserved" : "NOT CONSERVED"}; executed payments ${executedDisagree.length ? `DISAGREE with Airwallex: ${executedDisagree.join(", ")}` : "agree with Airwallex"}; reconciliation: ${rec.checked} checked, ${rec.differences.length} difference(s)${rec.differences.length ? ` (${rec.differences.map((d) => `${d.ref.slice(0, 12)}: ledger ${d.ledger} / Airwallex ${d.outside}`).join("; ").slice(0, 300)})` : ""}` });

  // I4: every payment ends in a known state, or goes to a person: an alarm row for it, or an alert in /health.
  const alarms = new Set((db.prepare(`SELECT subject FROM audit_log WHERE event IN (${TO_A_PERSON.map(() => "?").join(",")})`).all(...TO_A_PERSON) as { subject: string }[]).map((x) => x.subject));
  // Only the alerts about payments under way count: an unrelated alert does not tell a person about this payment.
  const alerts = health(db, now()).alerts.map((a) => a.code).filter((c) => MONEY_ALERTS.includes(c));
  const states: string[] = [];
  let unknown = 0;
  for (const p of props) {
    const t = JSON.parse(p.terms_json) as { transfer_request_id?: string };
    const atAwx = awx.transfers.find((x) => x.requestId === t.transfer_request_id);
    const row = db.prepare("SELECT transfer_id, status FROM transfers WHERE request_id = ?").get(t.transfer_request_id ?? "") as { transfer_id: string | null; status: string } | undefined;
    let known: boolean;
    if (p.status === "EXECUTED") known = !!atAwx && atAwx.status === "PAID" && row?.status === "PAID";
    else if (["FAILED", "NEEDS_REAPPROVAL", "EXPIRED", "REJECTED", "PENDING_APPROVAL", "SUPERSEDED"].includes(p.status)) known = !atAwx || !LIVE(atAwx.status);
    else known = false;
    const person = !known && (alarms.has(p.proposal_id) || alarms.has(t.transfer_request_id ?? "") || (!!atAwx && alarms.has(atAwx.id)) || alerts.length > 0);
    if (!known && !person) unknown++;
    states.push(`${p.proposal_id} ${p.status}${atAwx ? `, Airwallex ${atAwx.status}` : ", nothing at Airwallex"}${row ? `, payout row ${row.status}` : ""}${known ? "" : person ? ` → a person (${[...alerts, ...[p.proposal_id, t.transfer_request_id ?? "", atAwx?.id ?? ""].filter((x) => alarms.has(x)).map(() => "alarm row")].join(", ")})` : " → UNKNOWN: no alarm"}`);
  }
  // A conversion Airwallex made under an approval: in the ledger, or its payment went to a person.
  for (const c of awx.fake.conversions) {
    const p = props.find((x) => (JSON.parse(x.terms_json) as { conversion?: { request_id?: string } }).conversion?.request_id === c.requestId);
    const inLedger = !!db.prepare("SELECT 1 FROM fx_conversions WHERE request_id = ?").get(c.requestId);
    if (inLedger) continue;
    const person = !!p && (alarms.has(p.proposal_id) || alarms.has(c.requestId) || alerts.length > 0);
    if (!person) unknown++;
    states.push(`conversion ${c.conversionId} (${(c.buyAmountCents / 100).toFixed(2)} EUR for ${p?.proposal_id ?? "no proposal"}) done at Airwallex, not in the ledger${person ? " → a person" : " → UNKNOWN: no alarm"}`);
  }
  out.push({ id: "I4", ok: unknown === 0, detail: states.join("; ") || "no proposal was made" });

  // I5: webhooks move nothing; forged ones are ignored.
  out.push({ id: "I5", ok: hooksMovedNothing && hooks.ignored >= hooks.forged, detail: `${hooks.delivered} delivered (${hooks.forged} forged): ${hooks.ignored} ignored as unsigned or malformed; proposals, payout rows and approvals ${hooksMovedNothing ? "unchanged" : "CHANGED"}` });
  void proposals; void sc;
  return out;
}
