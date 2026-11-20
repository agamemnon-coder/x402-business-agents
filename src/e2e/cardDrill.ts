// The card drill (20 Nov, `npm run airwallex:card-drill`): agent cards frozen by default, checked against the Airwallex
// sandbox with test money. Per agent card: freeze, a charge while frozen, Purser's thaw for one purchase, the purchase's
// authorisation, a second authorisation inside the same window (the race an outside audit named), the refreeze, and a
// charge right after it; each status change timed until Airwallex reads it back. Then Purser's own purchase path (thaw,
// charge, refreeze) timed as one window; a process killed between thaw and refreeze, and what the runner does on
// restart; what the poll makes of the authorisations Purser did not start; and duplicate and late webhooks.
//
// Simulated, and said so in the record: every merchant charge is the sandbox's simulation endpoint (POST
// /simulation/issuing/create); the kill is a SIGKILL the child process sends itself at the point the drill chooses; the
// webhooks are replayed locally from this run's own sandbox answers, signed with a local test secret (the sandbox has
// no endpoint that replays an event). No passkey signs anything here, and nothing but the agents' cards is touched.

import { randomBytes, createHmac } from "node:crypto";
import { AGENTS, PLANS, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import type { CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import * as cards from "../policy/cards.js";
import { handleAirwallexHook } from "../policy/cardHooks.js";
import { fromCents } from "../lib/money.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
import type { DrillLine, SimAnswer } from "./drillHttp.js";

export const CARD_DRILL_SUFFIX = "card-drill";
export const CARD_DRILL_MAX_BUDGET = 200;
export const CARD_DRILL_COMMAND: Origin = { actor: "cfo-command", command: "npm run airwallex:card-drill", moves_money: false };
export const PHASES = ["setup", "cycle", "purchase", "crash", "detect", "webhooks"] as const;
export type Phase = (typeof PHASES)[number];
/** How long a fresh approval may sit in Airwallex's list under its older id alone before the poll records it (cards.ts). */
const FRESH_LISTING_MS = 2 * 60_000;

/** The merchant category each agent's card may pay (its first plan's), so Airwallex judges the charge on its status. */
export const drillMcc = (agent: Agent): string => Object.values(PLANS).find((p) => p.agent === agent)!.mcc;

/** The second authorisation inside each card's window: another amount on two cards, the purchase's own amount on one. */
export const SECOND_AUTH: Record<Agent, { cents: number; sameAsPurchase: boolean }> = {
  sourcing: { cents: 137, sameAsPurchase: false },
  support: { cents: 100, sameAsPurchase: true },
  treasury: { cents: 73, sameAsPurchase: false },
};
export const PURCHASE_CENTS = 100;
/** The crash child's purchase: another amount than the cycle's, so its window is never taken for the cycle's (from pass 2). */
export const CRASH_CENTS = 99;

export type Rail = IssuingRail & IssuingSim;
export type CrashKind = "after-thaw" | "thawed-before-ledger";

export interface Step {
  phase: Phase; id: string; agent: string | null; title: string; expect: string; outcome: string;
  /** true or false against `expect`; null when it is a measurement, or the sandbox does not support it. */
  pass: boolean | null;
  simulated: string | null;
  started_at: string; ended_at: string; ms: number;
  /** The drill log's line numbers (n) this step sent. */
  lines: number[];
  facts: Record<string, unknown>;
  error: string | null;
}

export interface CardDrillResults {
  drill: "card-drill"; pass_no: number; mode: "live" | "stand-in"; started_at: string; ended_at: string | null; phases: Phase[];
  code: { recover_card_windows: boolean; thaw_marked_before_call: boolean };
  cards: { agent: string; card_id: string; last4: string; nickname: string; per_tx: string; monthly: string }[];
  steps: Step[]; stopped: string | null;
}

export interface CardDrillDeps {
  db: DB; rail: Rail;
  /** The run's HTTP lines so far (live: the drill log; stand-in: none). */
  lines: () => DrillLine[];
  mode: "live" | "stand-in";
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Runs a process that thaws the agent's card and is killed at the chosen point. Resolves with how it ended. */
  crash: (kind: CrashKind, agent: Agent) => Promise<{ signal: string | null; code: number | null }>;
  /** Why the run must stop now (an unexpected 4xx/5xx, a spent budget), or null. */
  halted: () => string | null;
  only?: ReadonlySet<Phase>;
  /** The cards the cycle runs on (a re-run on one card); all three when absent. */
  agents?: readonly Agent[];
  passNo?: number;
  log?: (line: string) => void;
  save?: (r: CardDrillResults) => void;
}

/**
 * The point a crash child stops at: it thaws the card as Purser does for a purchase, then `die` is called and never
 * returns (live: the process sends itself SIGKILL; the stand-in: a promise that never settles, so nothing after it runs).
 */
export async function crashChild(db: DB, rail: Rail, agent: Agent, kind: CrashKind, now: Date, die: () => Promise<never>): Promise<never> {
  if (kind === "after-thaw") {
    // Killed after the thaw was answered and recorded, before the charge and the refreeze.
    await cards.openCardWindow(db, rail, agent, { amountCents: CRASH_CENTS, merchant: "CARDDRILL CRASH", why: "card drill: a purchase whose process is killed" }, now);
    return die();
  }
  // Killed the moment Airwallex has answered the thaw, before the ledger hears of it.
  const killing: Pick<IssuingRail, "setCardStatus"> = { setCardStatus: async (id, status) => { await rail.setCardStatus(id, status); return die(); } };
  await cards.openCardWindow(db, killing, agent, { amountCents: CRASH_CENTS, merchant: "CARDDRILL CRASH", why: "card drill: a purchase whose process is killed" }, now);
  return die();
}

const words = (t: CardTransaction) => (t.approved ? `approved (${t.status})` : `declined ${t.failureReason ?? t.status}`);

/** The drill, phase by phase. Each step is recorded; it stops at an unexpected HTTP answer or a spent call budget. */
export async function runCardDrill(d: CardDrillDeps): Promise<CardDrillResults> {
  const { db, rail } = d;
  const log = d.log ?? (() => undefined);
  const want = (p: Phase) => !d.only || d.only.has(p);
  const res: CardDrillResults = {
    drill: "card-drill", pass_no: d.passNo ?? 1, mode: d.mode, started_at: d.now().toISOString(), ended_at: null, phases: PHASES.filter(want),
    code: { recover_card_windows: typeof (cards as Record<string, unknown>).recoverCardWindows === "function", thaw_marked_before_call: false },
    cards: [], steps: [], stopped: null,
  };
  const save = () => d.save?.(res);
  const lineCount = () => d.lines().length;
  const linesSince = (k: number) => d.lines().slice(k);

  /** One step: timed, its HTTP lines kept, an error recorded (a halt or a spent budget stops the drill). */
  const step = async (phase: Phase, id: string, agent: string | null, title: string, expect: string, body: () => Promise<{ outcome: string; pass: boolean | null; facts?: Record<string, unknown>; simulated?: string }>): Promise<Step> => {
    const k = lineCount();
    const t0 = Date.now();
    const s: Step = { phase, id, agent, title, expect, outcome: "", pass: null, simulated: null, started_at: d.now().toISOString(), ended_at: "", ms: 0, lines: [], facts: {}, error: null };
    try {
      const r = await body();
      Object.assign(s, { outcome: r.outcome, pass: r.pass, facts: r.facts ?? {}, simulated: r.simulated ?? null });
    } catch (e) {
      s.error = (e as Error).message.slice(0, 400);
      s.outcome = `error: ${s.error}`;
      s.pass = false;
      // The sandbox's simulation refusing to simulate (isSimFailure): no approval or decline happened, so nothing to judge.
      if (/\/simulation\/issuing\/create -> 400 bad_request/.test(s.error)) {
        s.outcome = "the sandbox refused to simulate the charge (HTTP 400 bad_request \"failed to process transaction\"): neither approved nor declined, nothing to judge";
        s.pass = null;
      }
      const name = (e as { name?: string }).name;
      if (name === "AirwallexBudgetSpent" || name === "DrillHalted") res.stopped = `${id}: ${s.error}`;
    }
    s.ended_at = d.now().toISOString();
    s.ms = Date.now() - t0;
    s.lines = linesSince(k).map((l) => l.n);
    const why = d.halted();
    if (why && !res.stopped) res.stopped = `${id}: ${why}`;
    res.steps.push(s);
    log(`${s.pass === true ? "PASS" : s.pass === false ? "FAIL" : "INFO"}  ${id.padEnd(24)} ${agent ?? "-"}  ${s.outcome}  (${s.lines.length} calls, ${s.ms} ms)`);
    save();
    return s;
  };
  const go = () => !res.stopped;

  /**
   * A status change as Purser makes it, then read back until Airwallex says the wanted status (at most 4 more reads).
   * The latency is from the update's start to the answer of the first read that shows it.
   */
  const settle = async (agent: Agent, to: "ACTIVE" | "INACTIVE", change: () => Promise<unknown>) => {
    const k = lineCount();
    const t0 = Date.now();
    await change();
    const card = cards.cardOf(db, agent)!;
    let reads = 0;
    let seen = d.mode === "live" ? linesSince(k).filter((l) => l.card_status).at(-1)?.card_status ?? null : (await rail.getCard(card.card_id)).status;
    while (seen !== to && reads < 4) {
      await d.sleep(250);
      seen = (await rail.getCard(card.card_id)).status;
      reads++;
    }
    const mine = linesSince(k);
    const post = mine.find((l) => l.method === "POST");
    const first = mine.find((l) => l.card_status === to);
    const latency = d.mode === "live" ? (post && first ? Date.parse(first.answered_at) - Date.parse(post.at) : null) : Date.now() - t0;
    return { seen, extra_reads: reads, update_to_readback_ms: latency, update_ms: post?.ms ?? null };
  };

  const charge = async (agent: Agent, cents: number, merchant: string) => {
    // The stand-in stamps every charge with its clock: one second apart, as live charges are at least that far apart.
    if (d.mode === "stand-in") await d.sleep(1000);
    const card = cards.cardOf(db, agent)!;
    const t0 = Date.now();
    const t = await rail.simulateCardCharge({ cardId: card.card_id, amountCents: cents, currency: "EUR", merchant, mcc: drillMcc(agent) });
    return { t, ms: Date.now() - t0 };
  };
  const txFacts = (t: CardTransaction, ms: number) => ({ card_transaction_id: t.transactionId, legacy_id: t.legacyId ?? null, amount: fromCents(t.amountCents), currency: t.currency, status: t.status, approved: t.approved, failure_reason: t.failureReason, authorisation_ms: ms });

  // Setup: the three agents' drill cards, issued once (or adopted), frozen as the policy wants them.
  if (want("setup") || !cards.cardRows(db).length) {
    await step("setup", "setup.cards", null, "Issue or adopt the three agents' drill cards and bring them to the policy", "every card INACTIVE at Airwallex, limits and merchant categories as the policy", async () => {
      const rows = await cards.setupCards(db, rail, d.now(), { nicknameSuffix: CARD_DRILL_SUFFIX });
      const ok = rows.length === AGENTS.length && rows.every((r) => r.status === "INACTIVE");
      return { outcome: rows.map((r) => `${r.agent} ••${r.last4} ${r.status}`).join(", "), pass: ok, facts: { cards: rows.map((r) => ({ agent: r.agent, last4: r.last4, status: r.status })) } };
    });
  }
  for (const r of cards.cardRows(db)) res.cards.push({ agent: r.agent, card_id: r.card_id, last4: r.last4, nickname: r.nickname, per_tx: fromCents(r.per_tx_cents), monthly: fromCents(r.monthly_cents) });
  save();

  // The cycle, per card.
  const purchases: Record<string, CardTransaction> = {};
  if (want("cycle")) {
    for (const agent of d.agents ?? AGENTS) {
      if (!go()) break;
      const card = cards.cardOf(db, agent)!;
      await step("cycle", "cycle.freeze", agent, "Freeze the card (status INACTIVE)", "Airwallex reads the card back INACTIVE", async () => {
        const s = await settle(agent, "INACTIVE", () => rail.setCardStatus(card.card_id, "INACTIVE"));
        db.prepare("UPDATE cards SET status = ? WHERE agent = ?").run(s.seen, agent);
        return { outcome: `read back ${s.seen}; update to read-back ${s.update_to_readback_ms ?? "-"} ms`, pass: s.seen === "INACTIVE", facts: s };
      });
      if (!go()) break;
      await step("cycle", "cycle.charge_frozen", agent, "A merchant charges the frozen card (EUR 1.01)", "declined CARD_INACTIVE", async () => {
        const { t, ms } = await charge(agent, 101, "CARDDRILL FROZEN");
        return { outcome: words(t), pass: !t.approved && t.failureReason === "CARD_INACTIVE", facts: txFacts(t, ms), simulated: "the merchant's charge is the sandbox's simulation endpoint" };
      });
      if (!go()) break;
      await step("cycle", "cycle.thaw", agent, "Purser opens a purchase window (openCardWindow: thaw)", "Airwallex reads the card back ACTIVE", async () => {
        const s = await settle(agent, "ACTIVE", () => cards.openCardWindow(db, rail, agent, { amountCents: PURCHASE_CENTS, merchant: "CARDDRILL A", why: "card drill: one approved purchase" }, d.now()));
        return { outcome: `read back ${s.seen}; update to read-back ${s.update_to_readback_ms ?? "-"} ms`, pass: s.seen === "ACTIVE", facts: s };
      });
      if (!go()) break;
      await step("cycle", "cycle.auth_purchase", agent, `The approved purchase's authorisation (EUR ${fromCents(PURCHASE_CENTS)})`, "approved", async () => {
        const { t, ms } = await charge(agent, PURCHASE_CENTS, "CARDDRILL A");
        purchases[agent] = t;
        // Recorded as Purser's own purchase, as buyPlan records it.
        withOrigin(CARD_DRILL_COMMAND, () => cards.ingestCardTransaction(db, t, "simulation", d.now(), "card drill: the window's purchase"));
        return { outcome: words(t), pass: t.approved, facts: txFacts(t, ms), simulated: "the merchant's charge is the sandbox's simulation endpoint" };
      });
      if (!go()) break;
      const b = SECOND_AUTH[agent];
      await step("cycle", "cycle.auth_in_window", agent, `A second authorisation inside the same window (EUR ${fromCents(b.cents)}, ${b.sameAsPurchase ? "the purchase's own amount" : "another amount"}, another merchant)`, "declined (the brief's expectation)", async () => {
        const { t, ms } = await charge(agent, b.cents, "CARDDRILL B");
        return { outcome: `${words(t)}${t.approved ? ": the race is real at Airwallex; the card is thawed for any charge within its limits" : ""}`, pass: !t.approved, facts: { ...txFacts(t, ms), same_amount_as_purchase: b.sameAsPurchase }, simulated: "the merchant's charge is the sandbox's simulation endpoint" };
      });
      if (!go()) break;
      await step("cycle", "cycle.refreeze", agent, "Purser closes the window (closeCardWindow: refreeze)", "Airwallex reads the card back INACTIVE", async () => {
        const s = await settle(agent, "INACTIVE", () => cards.closeCardWindow(db, rail, agent, "card drill: Airwallex answered the purchase", d.now()));
        return { outcome: `read back ${s.seen}; update to read-back ${s.update_to_readback_ms ?? "-"} ms`, pass: s.seen === "INACTIVE", facts: s };
      });
      if (!go()) break;
      await step("cycle", "cycle.charge_after_refreeze", agent, "A merchant charges right after the refreeze was read back (EUR 1.02)", "declined CARD_INACTIVE", async () => {
        const { t, ms } = await charge(agent, 102, "CARDDRILL C");
        return { outcome: words(t), pass: !t.approved && t.failureReason === "CARD_INACTIVE", facts: txFacts(t, ms), simulated: "the merchant's charge is the sandbox's simulation endpoint" };
      });
    }
  }

  // Purser's own purchase path, one window from thaw to refreeze.
  if (want("purchase") && go()) {
    await step("purchase", "purchase.window", "sourcing", "Purser's purchase path (chargeInWindow): thaw, charge EUR 1.11, refreeze", "approved; the card INACTIVE again; the window's length measured", async () => {
      const card = cards.cardOf(db, "sourcing")!;
      const k = lineCount();
      const t0 = Date.now();
      const t = await cards.chargeInWindow(db, rail, "sourcing", { cardId: card.card_id, amountCents: 111, currency: "EUR", merchant: "CARDDRILL P", mcc: drillMcc("sourcing") }, d.now(), "card drill: Purser's purchase path");
      withOrigin(CARD_DRILL_COMMAND, () => cards.ingestCardTransaction(db, t, "simulation", d.now(), "card drill: Purser's purchase path"));
      const mine = linesSince(k);
      const posts = mine.filter((l) => l.method === "POST" && l.endpoint === "/issuing/cards/{id}/update");
      const lastRead = mine.filter((l) => l.card_status).at(-1);
      const windowMs = d.mode === "live" ? (posts[0] && lastRead ? Date.parse(lastRead.answered_at) - Date.parse(posts[0].at) : null) : Date.now() - t0;
      const after = d.mode === "live" ? lastRead?.card_status ?? null : (await rail.getCard(card.card_id)).status;
      return { outcome: `${words(t)}; card ${after}; thawed for ${windowMs ?? "-"} ms (thaw sent to refreeze read back)`, pass: t.approved && after === "INACTIVE", facts: { ...txFacts(t, 0), window_ms: windowMs, card_after: after }, simulated: "the merchant's charge is the sandbox's simulation endpoint" };
    });
  }

  // A process killed between thaw and refreeze; what the runner does on restart.
  if (want("crash") && go()) {
    const restart = async (agent: Agent, label: string) => {
      const card = cards.cardOf(db, agent)!;
      // What the runner does every few seconds (and, before 20 Nov, all it did after a restart). Judged only while it is
      // the whole restart; with the start-up recovery it is a measurement, and the recovery below is judged.
      const hasRecovery = typeof (cards as Record<string, unknown>).recoverCardWindows === "function";
      await step("crash", `crash.${label}.tick`, agent, "Restart: the runner's every-few-seconds card check (syncCardsIfChanged)", hasRecovery ? "measured only: the restart's own step is the recovery below" : "the card frozen at Airwallex (the runner's only card step after a restart at this commit)", async () => {
        const changed = await cards.syncCardsIfChanged(db, rail, d.now());
        const at = await rail.getCard(card.card_id);
        return { outcome: `changed ${changed.join(", ") || "nothing"}; Airwallex reads the card ${at.status}`, pass: hasRecovery ? null : at.status === "INACTIVE", facts: { changed, airwallex_status: at.status, ledger_status: cards.cardOf(db, agent)!.status, window_open: !!cards.openWindow(db, agent, d.now()) } };
      });
      if (!go()) return;
      const recover = (cards as Record<string, unknown>).recoverCardWindows as undefined | ((db: DB, rail: IssuingRail, now: Date) => Promise<{ closed: string[]; changed: string[] }>);
      await step("crash", `crash.${label}.recover`, agent, "Restart: the runner's start-up card recovery (recoverCardWindows)", "the card frozen at Airwallex at the restart", async () => {
        if (!recover) return { outcome: "no start-up card recovery in the runner at this commit", pass: false, facts: { present: false } };
        const t0 = Date.now();
        const r = await recover(db, rail, d.now());
        const ms = Date.now() - t0;
        const at = await rail.getCard(card.card_id);
        return { outcome: `closed ${r.closed.join(", ") || "no window"}; synced ${r.changed.join(", ") || "nothing"}; Airwallex reads the card ${at.status}; recovery took ${ms} ms`, pass: at.status === "INACTIVE", facts: { ...r, recovery_ms: ms, airwallex_status: at.status } };
      });
      if (!go()) return;
      await step("crash", `crash.${label}.charge`, agent, "A merchant charges the card after the restart (EUR 1.03)", "declined CARD_INACTIVE", async () => {
        const { t, ms } = await charge(agent, 103, "CARDDRILL AFTER CRASH");
        return { outcome: words(t), pass: !t.approved && t.failureReason === "CARD_INACTIVE", facts: txFacts(t, ms), simulated: "the merchant's charge is the sandbox's simulation endpoint" };
      });
    };
    for (const [kind, agent, label, title] of [
      ["after-thaw", "treasury", "k1", "Killed after the thaw was answered and recorded, before the charge and the refreeze"],
      ["thawed-before-ledger", "support", "k2", "Killed the moment Airwallex answered the thaw, before the ledger recorded it; restarted after the window would have run out"],
    ] as const) {
      if (!go()) break;
      const s = await step("crash", `crash.${label}.kill`, agent, title, "the child ends by SIGKILL with the card thawed at Airwallex", async () => {
        const out = await d.crash(kind, agent);
        const at = await rail.getCard(cards.cardOf(db, agent)!.card_id);
        return { outcome: `child ended by ${out.signal ?? `exit ${out.code}`}; Airwallex reads the card ${at.status}; ledger says ${cards.cardOf(db, agent)!.status}`, pass: out.signal === "SIGKILL" && at.status === "ACTIVE", facts: { ...out, airwallex_status: at.status, ledger_status: cards.cardOf(db, agent)!.status }, simulated: "the kill is a SIGKILL the child process sends itself at the point the drill chose" };
      });
      if (!go() || s.pass === false) continue;
      // K2: the restart comes after the window would have run out, so only the ledger can say the card is thawed.
      if (kind === "thawed-before-ledger") await d.sleep(cards.CARD_WINDOW_MS + 5_000);
      await restart(agent, label);
    }
  }

  // What the poll makes of the authorisations Purser did not start.
  if (want("detect") && go()) {
    const lastApproved = d.lines().filter((l) => l.sim && (l.sim.process_result ?? l.sim.status) !== "FAILED").at(-1);
    const wait = lastApproved ? Date.parse(lastApproved.answered_at) + FRESH_LISTING_MS + 5_000 - d.now().getTime() : 0;
    if (wait > 0) await d.sleep(wait);
    await step("detect", "detect.poll", null, "The poll reads every card's transactions; each authorisation inside a window that Purser did not start must raise card.unexpected_authorization", "each second authorisation flagged; the purchases not flagged", async () => {
      const before = (db.prepare("SELECT COUNT(*) AS n FROM card_transactions").get() as { n: number }).n;
      const fresh = await cards.pollCardTransactions(db, rail, d.now());
      const flagged = (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'card.unexpected_authorization'").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as { agent: string; amount: string });
      const second = (d.agents ?? AGENTS).map((a) => ({ agent: a, amount: fromCents(SECOND_AUTH[a].cents), same_amount_as_purchase: SECOND_AUTH[a].sameAsPurchase, flagged: flagged.some((f) => f.agent === a && f.amount === fromCents(SECOND_AUTH[a].cents)) }));
      const purchasesFlagged = flagged.filter((f) => f.amount === fromCents(PURCHASE_CENTS) && !SECOND_AUTH[f.agent as Agent]?.sameAsPurchase).length;
      const rows = (db.prepare("SELECT agent, amount_cents, approved, failure_reason FROM card_transactions ORDER BY occurred_at").all() as { agent: string; amount_cents: number; approved: number; failure_reason: string | null }[]);
      const ok = second.every((x) => x.flagged) && purchasesFlagged === 0;
      return { outcome: `${fresh} new from the poll (${before} recorded before); second authorisations flagged: ${second.map((x) => `${x.agent} ${x.flagged ? "yes" : "NO"}${x.same_amount_as_purchase ? " (same amount as the purchase)" : ""}`).join(", ")}`, pass: ok, facts: { fresh, before, second, purchases_flagged: purchasesFlagged, ledger: rows.map((r) => ({ agent: r.agent, amount: fromCents(r.amount_cents), approved: !!r.approved, failure_reason: r.failure_reason })) } };
    });
  }

  // Duplicate and late webhooks: replayed locally (the sandbox cannot replay an event).
  if (want("webhooks") && go()) {
    await step("webhooks", "webhooks.sandbox_replay", null, "Ask the sandbox to deliver an event twice, or late", "the sandbox replays an event", async () => ({
      outcome: "not supported by the sandbox: Airwallex's API has no endpoint that replays or resends a webhook event, and this run has no public webhook receiver; not attempted live",
      pass: null,
    }));
    await step("webhooks", "webhooks.local_replay", null, "Duplicate and late card-transaction webhooks, replayed locally from this run's own sandbox answers", "no second ledger row, no second alarm, no change to an earlier decision", async () => {
      const kept = d.lines().filter((l): l is DrillLine & { sim: SimAnswer } => !!l.sim && !!l.sim.card_id && !!cards.cardRows(db).find((c) => c.card_id === l.sim!.card_id));
      // Lines logged before the drill kept the answer's date (transacted_at; 20 Nov, pass 1) cannot make a whole event.
      const sims = kept.filter((l) => !!(l.sim.transacted_at ?? l.sim.transaction_date ?? l.sim.created_at));
      if (!sims.length) return { outcome: `no simulated authorisation with its date in this run's log to replay (${kept.length} without)`, pass: null };
      const secret = randomBytes(32).toString("hex");
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      const before = { rows: count("SELECT COUNT(*) AS n FROM card_transactions"), unexpected: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.unexpected_authorization'"), approved: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.charge_approved'"), declined: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.charge_declined'") };
      const outcomes: string[] = [];
      let n = 0;
      const deliver = (sim: SimAnswer, id: string) => {
        const ok = (sim.process_result ?? sim.status) !== "FAILED" && !sim.failure_reason;
        const body = JSON.stringify({ id, name: ok ? "issuing.card_transaction_event.success" : "issuing.card_transaction_event.failed", version: "2025-11-11", data: { object: sim } });
        const ts = String(d.now().getTime());
        outcomes.push(handleAirwallexHook(db, { id, ts, signature: createHmac("sha256", secret).update(ts + body).digest("hex"), body }, secret, d.now()));
      };
      for (const l of sims) {
        const id = `evt-carddrill-${l.n}`;
        deliver(l.sim, id); // late: after the simulation's answer (and the poll) recorded it
        deliver(l.sim, id); // the same event again (Airwallex retries until it gets a 200; the relay may pass it on twice)
        deliver(l.sim, `${id}-retry`); // the same authorisation under another event id
        n += 3;
      }
      const after = { rows: count("SELECT COUNT(*) AS n FROM card_transactions"), unexpected: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.unexpected_authorization'"), approved: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.charge_approved'"), declined: count("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'card.charge_declined'") };
      const newRows = after.rows - before.rows;
      const dup = outcomes.filter((o) => /already recorded/.test(o)).length;
      // After the poll every authorisation of the run is in the ledger already: a replay may add nothing.
      const polled = res.steps.some((x) => x.id === "detect.poll" && !x.error);
      return {
        outcome: `${n} deliveries of ${sims.length} authorisations${kept.length > sims.length ? ` (${kept.length - sims.length} logged without their date left out)` : ""}: ${newRows} new ledger row(s), ${after.unexpected - before.unexpected} new alarm(s), ${after.approved - before.approved} new approval and ${after.declined - before.declined} new decline record(s); ${dup} answered "already recorded"`,
        pass: polled ? newRows === 0 && after.unexpected === before.unexpected && after.approved === before.approved && after.declined === before.declined : null,
        facts: { deliveries: n, authorisations: sims.length, before, after, already_recorded: dup, after_poll: polled, outcomes: outcomes.slice(0, 60) },
        simulated: "replayed locally: the events are built from this run's own simulation answers (whitelisted fields) and signed with a local test secret; Airwallex sent none of them",
      };
    });
  }

  res.code.thaw_marked_before_call = await thawMarkedBeforeCall();
  res.ended_at = d.now().toISOString();
  save();
  return res;
}

/** Whether openCardWindow, at this commit, records the thaw in the ledger before Airwallex is asked (an offline probe). */
export async function thawMarkedBeforeCall(): Promise<boolean> {
  const { openDb } = await import("../db/open.js");
  const { FakeIssuing } = await import("../redteam/issuing.js");
  const db = openDb(":memory:");
  const awx = new FakeIssuing();
  await cards.setupCards(db, awx, new Date(), { agents: ["sourcing"] });
  let seen = "";
  const probe = { setCardStatus: async () => { seen = cards.cardOf(db, "sourcing")!.status; throw new Error("probe"); } };
  await cards.openCardWindow(db, probe, "sourcing", { amountCents: 1, merchant: "probe", why: "probe" }, new Date()).catch(() => undefined);
  db.close();
  return seen === "ACTIVE";
}
