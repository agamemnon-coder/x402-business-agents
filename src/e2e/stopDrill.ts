// The stop drill (20 Nov, `npm run airwallex:stop-drill`): the emergency stop and the velocity stop, pulled live against
// sandbox-backed agents (test money). Before the stop: every agent card thawed mid-purchase, and a supplier payout
// planned against the Airwallex sandbox and signed, waiting to run. The stop is pulled the way the CFO pulls it: a
// policy change signed on the phone. Then every agent, card and pending action is tried, and the time until all of
// them are blocked is measured. Lifting it is tried every way but the intended one (the phone, a typed hash, no
// approval), then the intended one: a proposal on the runner, signed with the passkey. The velocity stop: the Treasury
// agent buys six times in a minute (its limit is five), is stopped by code, and is lifted the same way.
//
// Simulated, and said so in the record: the passkey is a labelled virtual test passkey (src/redteam/authenticator.ts),
// no person's Face ID; every merchant charge is the sandbox's simulation endpoint. The payout is never created.

import { AGENTS, PLANS, VELOCITY, type Agent } from "../config/policy.js";
import { MANUFACTURER } from "../config/payees.js";
import type { DB } from "../db/open.js";
import type { AirwallexRail } from "../airwallex/port.js";
import type { CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import { audit } from "../audit/log.js";
import { proposeInvoicePayment } from "../agents/euroBill.js";
import { ibanSha, parseInvoiceFallback } from "../agents/invoice.js";
import { buyPlan } from "../agents/cardBuyer.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { approvalOrigin } from "../executors/index.js";
import { executePolicyChange, proposePolicyChange } from "../executors/policyChange.js";
import { decide } from "../policy/approvals.js";
import { cardOf, cardRows, chargeInWindow, ingestCardTransaction, openCardWindow, setupCards, syncCardsAfterPolicy } from "../policy/cards.js";
import { chargeUnderHold, purserRefusal } from "../policy/holds.js";
import { frozen, policyValue, ruleFor } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";
import { health } from "../ops/health.js";
import { fromCents } from "../lib/money.js";
import { canonicalTerms, sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { activePasskey, confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processPolicyRequest, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { setSetting } from "../world/settings.js";
import { soakInvoiceText } from "./airwallexSoak.js";
import { CARD_DRILL_SUFFIX, drillMcc, type Step } from "./cardDrill.js";
import type { DrillLine } from "./drillHttp.js";

export const STOP_DRILL_MAX_BUDGET = 150;
export const STOP_PASSKEY_LABEL = "stop-drill virtual test passkey (no person's Face ID)";
export const STOP_DRILL_COMMAND: Origin = { actor: "cfo-command", command: "npm run airwallex:stop-drill", moves_money: false };
const RP = "stop-drill.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;
export const STOP_INVOICE_NO = "BTX-STOP-1120";
export const STOP_PAYOUT_EUR = "1.00";
/** The velocity stop is tried on this agent: its limit per minute is the smallest. */
export const VELOCITY_AGENT: Agent = "treasury";

export interface StopDrillResults {
  drill: "stop-drill"; pass_no: number; mode: "live" | "stand-in"; started_at: string; ended_at: string | null; passkey: string;
  cards: { agent: string; card_id: string; last4: string; nickname: string }[];
  timings: Record<string, number | null>;
  steps: Step[]; stopped: string | null;
}

export interface StopDrillDeps {
  db: DB; rail: IssuingRail & IssuingSim; awx: AirwallexRail;
  /** Whether Airwallex holds a transfer under this request_id (GET /transfers?request_id=…). */
  transferExists: (requestId: string) => Promise<boolean>;
  lines: () => DrillLine[];
  mode: "live" | "stand-in";
  now: () => Date;
  halted: () => string | null;
  log?: (line: string) => void;
  save?: (r: StopDrillResults) => void;
  /** Only these groups of steps (a re-run): payout, windows, stop, blocked, lift, burst, velocity. The cards and the passkey always. */
  only?: ReadonlySet<StopGroup>;
  passNo?: number;
}

export const STOP_GROUPS = ["payout", "windows", "stop", "blocked", "lift", "burst", "velocity"] as const;
export type StopGroup = (typeof STOP_GROUPS)[number];
/** The group a step belongs to, for a re-run of some of them. */
export const stopGroupOf = (id: string): StopGroup | null =>
  id === "setup.cards" || id === "setup.passkey" ? null : id.endsWith(".payout") ? "payout" : id === "setup.windows" ? "windows" : id === "velocity.burst" ? "burst" : (id.split(".")[0] as StopGroup);

type Phase = "setup" | "stop" | "blocked" | "lift" | "velocity";

/** The drill, in order. Each step is recorded; it stops at an unexpected HTTP answer or a spent call budget. */
export async function runStopDrill(d: StopDrillDeps): Promise<StopDrillResults> {
  const { db, rail } = d;
  const log = d.log ?? (() => undefined);
  const res: StopDrillResults = { drill: "stop-drill", pass_no: d.passNo ?? 1, mode: d.mode, started_at: d.now().toISOString(), ended_at: null, passkey: STOP_PASSKEY_LABEL, cards: [], timings: {}, steps: [], stopped: null };
  const save = () => d.save?.(res);
  const lineCount = () => d.lines().length;
  const go = () => !res.stopped;

  const step = async (phase: Phase, id: string, agent: string | null, title: string, expect: string, body: () => Promise<{ outcome: string; pass: boolean | null; facts?: Record<string, unknown>; simulated?: string }>): Promise<Step | null> => {
    const group = stopGroupOf(id);
    if (d.only && group && !d.only.has(group)) return null;
    const k = lineCount();
    const t0 = Date.now();
    const s: Step = { phase: phase as Step["phase"], id, agent, title, expect, outcome: "", pass: null, simulated: null, started_at: d.now().toISOString(), ended_at: "", ms: 0, lines: [], facts: {}, error: null };
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
    s.lines = d.lines().slice(k).map((l) => l.n);
    const why = d.halted();
    if (why && !res.stopped) res.stopped = `${id}: ${why}`;
    res.steps.push(s);
    log(`${s.pass === true ? "PASS" : s.pass === false ? "FAIL" : "INFO"}  ${id.padEnd(30)} ${agent ?? "-"}  ${s.outcome}  (${s.lines.length} calls, ${s.ms} ms)`);
    save();
    return s;
  };
  /** Runs `f` and counts the Airwallex calls it made: a refusal "before any call" must make none. */
  const calls = async <T>(f: () => Promise<T> | T): Promise<{ value: T | null; error: string | null; calls: number }> => {
    const k = lineCount();
    try { return { value: await f(), error: null, calls: lineCount() - k }; } catch (e) { return { value: null, error: (e as Error).message, calls: lineCount() - k }; }
  };
  const simNote = "the merchant's charge is the sandbox's simulation endpoint";
  const words = (t: CardTransaction) => (t.approved ? `approved (${t.status})` : `declined ${t.failureReason ?? t.status}`);

  // The virtual test passkey (labelled), the only approver of this ledger.
  const auth = new FakeAuthenticator();
  let counter = 0;
  /** A policy change as the phone sends it: created and approved in one step, signed by the passkey (phone: tighten only). */
  const phoneChange = async (key: string, to: string, reason: string) => {
    const terms = { schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: `C-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`, expires_at: new Date(d.now().getTime() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), changes: [{ key, label: ruleFor(db, key)?.label ?? key, from: policyValue(db, key), to }], reason };
    const canonical = canonicalTerms(terms as unknown as Terms);
    const hash = sha256Hex(canonical);
    const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
    const out = await processPolicyRequest(db, { ticket: `stop-drill-${terms.proposal_id}`, kind: "policy", proposal_id: null, body: JSON.stringify({ canonical, terms_sha256: hash, credential }), received_at: d.now().toISOString() }, d.now());
    return { out, proposalId: terms.proposal_id };
  };
  /** The passkey's approval of a proposal made on the runner. */
  const passkeyApprove = async (proposalId: string) => {
    const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
    const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
    return processAssertion(db, { ticket: `stop-drill-${proposalId}-${counter}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: d.now().toISOString() }, d.now());
  };
  /** One purchase on an agent's card the way an agent buys (buyPlan's path, with a small amount): held, thawed, charged, refrozen, recorded. */
  const purchase = async (agent: Agent, cents: number, merchant: string) => {
    const card = cardOf(db, agent)!;
    audit(db, agent, "card.purchase_started", `stop-drill-${agent}-${cents}`, { agent, last4: card.last4, merchant, plan: "stop drill", amount: fromCents(cents), currency: "EUR" }, d.now());
    const t = await chargeUnderHold(db, agent, cents, d.now(), () => chargeInWindow(db, rail, agent, { cardId: card.card_id, amountCents: cents, currency: "EUR", merchant, mcc: drillMcc(agent) }, d.now(), "stop drill: a purchase"));
    withOrigin(STOP_DRILL_COMMAND, () => ingestCardTransaction(db, t, "simulation", d.now(), "stop drill: a purchase"));
    return t;
  };

  // ---- Setup: the card drill's three cards, the virtual passkey, a payout signed and waiting, every card thawed mid-purchase.
  await step("setup", "setup.cards", null, "Adopt the three agents' drill cards (issued by the card drill) and bring them to the policy", "three cards, INACTIVE at Airwallex", async () => {
    const rows = await setupCards(db, rail, d.now(), { nicknameSuffix: CARD_DRILL_SUFFIX });
    return { outcome: rows.map((r) => `${r.agent} ••${r.last4} ${r.status}`).join(", "), pass: rows.length === AGENTS.length && rows.every((r) => r.status === "INACTIVE") };
  });
  for (const r of cardRows(db)) res.cards.push({ agent: r.agent, card_id: r.card_id, last4: r.last4, nickname: r.nickname });
  if (go()) await step("setup", "setup.passkey", null, "Enrol the virtual test passkey (labelled) as this ledger's only approver", "enrolled and confirmed", async () => {
    // A re-run on the same ledger: the earlier pass's virtual passkey lived in that process only, so a new one replaces it.
    const replace = !!activePasskey(db);
    const label = `${STOP_PASSKEY_LABEL}${res.pass_no > 1 ? `, pass ${res.pass_no}` : ""}`;
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, replace }, d.now());
    const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
    const out = await processRegistration(db, { ticket: `stop-drill-enrol-${res.pass_no}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: d.now().toISOString() }, { label }, d.now());
    confirmPasskey(db, fingerprintOf(auth.spkiSha256), d.now());
    return { outcome: `${out.status}; confirmed: ${label}${replace ? " (replacing the earlier pass's)" : ""}`, pass: out.status === "pending", simulated: "a virtual test passkey, no person's Face ID" };
  });
  let payout: { proposalId: string; requestId: string } | null = null;
  if (go()) await step("setup", "setup.payout", "treasury", `A supplier payout planned against the sandbox (EUR ${STOP_PAYOUT_EUR} to ${MANUFACTURER.name}) and signed, waiting to run`, "APPROVED, not executed", async () => {
    const ben = await d.awx.findBeneficiaryByIban(MANUFACTURER.iban);
    if (!ben) return { outcome: `Airwallex holds no beneficiary for ${MANUFACTURER.name}; the drill creates none`, pass: false };
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(ben.id, MANUFACTURER.name, MANUFACTURER.iban.slice(-4), ibanSha(MANUFACTURER.iban), MANUFACTURER.bic);
    setSetting(db, "treasury", "eur_floor", "0.00");
    setSetting(db, "treasury", "eur_obligations", "0.00");
    setSetting(db, "treasury", "usd_floor", "0.00");
    const text = soakInvoiceText("bergtex", STOP_INVOICE_NO, STOP_PAYOUT_EUR);
    const out = await withOrigin(STOP_DRILL_COMMAND, () => proposeInvoicePayment(d.db, d.awx, parseInvoiceFallback(text), text, d.now()));
    if (out.kind !== "proposed") return { outcome: `not planned: ${out.reason}`, pass: false };
    const pid = out.proposal.proposal_id;
    const signed = await passkeyApprove(pid);
    const terms = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(pid) as { terms_json: string }).terms_json) as { transfer_request_id: string; conversion: unknown };
    payout = { proposalId: pid, requestId: terms.transfer_request_id };
    const status = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(pid) as { status: string }).status;
    return { outcome: `${pid} ${status} by the virtual passkey (${signed.status}); request_id ${terms.transfer_request_id}${terms.conversion ? "; with a conversion" : ""}`, pass: status === "APPROVED", facts: { proposal_id: pid, transfer_request_id: terms.transfer_request_id, beneficiary_id: ben.id }, simulated: "signed by the virtual test passkey" };
  });
  if (go()) await step("setup", "setup.windows", null, "Every agent's card thawed mid-purchase (openCardWindow on each)", "three cards ACTIVE at Airwallex", async () => {
    const out: string[] = [];
    for (const a of AGENTS) {
      const w = await openCardWindow(db, rail, a, { amountCents: 500, merchant: "STOPDRILL MID-PURCHASE", why: "stop drill: a purchase in flight when the stop is pulled" }, d.now());
      out.push(`${a} ${w ? cardOf(db, a)!.status : "no window"}`);
    }
    return { outcome: out.join(", "), pass: cardRows(db).every((r) => r.status === "ACTIVE") };
  });

  // ---- The emergency stop, pulled from the phone with one passkey signature.
  let pulledAt = 0;
  if (go()) await step("stop", "stop.pull", null, "The CFO pulls the emergency stop on the phone (a policy change signed by the passkey), the runner applies it and syncs the cards", "every card frozen at Airwallex; the time to fully blocked measured", async () => {
    const k = lineCount();
    pulledAt = Date.now();
    const pulledIso = new Date(pulledAt).toISOString();
    const { out, proposalId } = await phoneChange("freeze", "on", "stop drill: the CFO pulls the emergency stop");
    if (out.status !== "approved") return { outcome: `the phone's change was ${out.status}: ${out.message ?? ""}`, pass: false };
    executePolicyChange(db, proposalId, d.now());
    const codeMs = Date.now() - pulledAt;
    const changed = await syncCardsAfterPolicy(db, proposalId, rail, d.now());
    const doneMs = Date.now() - pulledAt;
    const reads = d.lines().slice(k).filter((l) => l.card_status === "INACTIVE");
    const perCard = d.mode === "live" ? reads.map((l) => Date.parse(l.answered_at) - Date.parse(pulledIso)) : [];
    res.timings.code_blocked_ms = codeMs;
    res.timings.cards_frozen_ms = d.mode === "live" ? (perCard.length ? Math.max(...perCard) : null) : doneMs;
    res.timings.fully_blocked_ms = doneMs;
    return {
      outcome: `${proposalId} approved by the passkey; Purser refuses every agent payment after ${codeMs} ms; ${changed.join(", ")} frozen at Airwallex, the last read back INACTIVE after ${res.timings.cards_frozen_ms ?? "-"} ms; fully blocked after ${doneMs} ms`,
      pass: frozen(db) && changed.length === AGENTS.length && cardRows(db).every((r) => r.status === "INACTIVE"),
      facts: { proposal_id: proposalId, code_blocked_ms: codeMs, card_readback_ms: perCard, fully_blocked_ms: doneMs, changed },
      simulated: "signed by the virtual test passkey",
    };
  });

  // ---- Everything blocked.
  if (go()) for (const a of AGENTS) {
    if (!go()) break;
    await step("blocked", "blocked.charge", a, "A merchant charges the agent's card (EUR 1.04)", "declined CARD_INACTIVE", async () => {
      const t = await rail.simulateCardCharge({ cardId: cardOf(db, a)!.card_id, amountCents: 104, currency: "EUR", merchant: "STOPDRILL MERCHANT", mcc: drillMcc(a) });
      return { outcome: words(t), pass: !t.approved && t.failureReason === "CARD_INACTIVE", facts: { card_transaction_id: t.transactionId, failure_reason: t.failureReason }, simulated: simNote };
    });
    const plan = Object.entries(PLANS).find(([, p]) => p.agent === a)![0];
    await step("blocked", "blocked.purchase", a, `The agent buys on its card (buyPlan ${plan})`, "refused by Purser, before any Airwallex call", async () => {
      const r = await calls(() => buyPlan(db, rail, plan, d.now()));
      return { outcome: `${r.error ? `refused: ${r.error.slice(0, 140)}` : "NOT refused"}; ${r.calls} Airwallex calls`, pass: !!r.error && /emergency stop/.test(r.error) && r.calls === 0 };
    });
    await step("blocked", "blocked.alta", a, "The agent pays on Alta (Purser's check before signing)", "refused frozen_by_cfo", async () => {
      const why = purserRefusal(db, a, 1, d.now());
      return { outcome: why ? `refused: ${why.slice(0, 140)}` : "NOT refused", pass: !!why && why.startsWith("frozen_by_cfo") };
    });
    await step("blocked", "blocked.window", a, "Purser tries to open a purchase window on the card", "no window opened, no Airwallex call", async () => {
      const r = await calls(() => openCardWindow(db, rail, a, { amountCents: 100, merchant: "x", why: "stop drill" }, d.now()));
      return { outcome: `${r.value === null && !r.error ? "no window" : r.error ? `error: ${r.error}` : "a window OPENED"}; ${r.calls} calls`, pass: r.value === null && !r.error && r.calls === 0 };
    });
  }
  if (go()) await step("blocked", "blocked.payout", "treasury", "The signed payout waiting to run is started (executeInvoicePayment)", "refused before any create; Airwallex holds no transfer under its request_id", async () => {
    if (!payout) return { outcome: "no payout was planned in setup", pass: false };
    const p = payout;
    const k = lineCount();
    const r = await calls(() => withOrigin(approvalOrigin(db, p.proposalId)!, () => executeInvoicePayment(db, d.awx, null, p.proposalId)));
    const posts = d.lines().slice(k).filter((l) => l.method === "POST").length;
    const exists = await d.transferExists(p.requestId);
    return { outcome: `${r.error ? `refused: ${r.error.slice(0, 160)}` : "NOT refused"}; ${r.calls} calls (${posts} POST) while refusing; at Airwallex: ${exists ? "a TRANSFER EXISTS" : "no transfer"}`, pass: !!r.error && /emergency stop/.test(r.error) && posts === 0 && !exists, facts: { calls: r.calls, posts, transfer_exists: exists } };
  });
  if (go()) await step("blocked", "blocked.health", null, "The runner's health", "the emergency_stop alarm stands (/health answers 503)", async () => {
    const h = health(db, d.now());
    const on = h.alerts.some((a) => a.code === "emergency_stop");
    return { outcome: on ? "emergency_stop alarm standing" : "NO emergency_stop alarm", pass: on };
  });

  // ---- Lifting it: every way but the intended one is refused.
  let liftId: string | null = null;
  if (go()) await step("lift", "lift.phone", null, "Lift the stop from the phone (a signed change, freeze on to off)", "refused: the phone can only tighten", async () => {
    const { out } = await phoneChange("freeze", "off", "stop drill: lift from the phone");
    return { outcome: `${out.status}: ${(out.message ?? "").slice(0, 160)}`, pass: out.status === "refused" && frozen(db), simulated: "signed by the virtual test passkey" };
  });
  if (go()) await step("lift", "lift.unapproved", null, "Lift the stop with a proposal on the runner that nobody approved", "refused: not approved", async () => {
    liftId = proposePolicyChange(db, { changes: [{ key: "freeze", to: "off" }], reason: "stop drill: checked, all clear" }, "human", d.now()).proposal_id;
    const r = await calls(() => executePolicyChange(db, liftId!, d.now()));
    return { outcome: r.error ? `refused: ${r.error.slice(0, 140)}` : "NOT refused", pass: !!r.error && frozen(db), facts: { proposal_id: liftId } };
  });
  if (go() && liftId) await step("lift", "lift.typed", null, "Approve the runner's proposal with its typed hash prefix (no passkey)", "refused: once a passkey is enrolled, a typed prefix can only reject", async () => {
    const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(liftId) as { terms_sha256: string }).terms_sha256;
    const r = await calls(() => decide(db, { proposalId: liftId!, decision: "APPROVED", typedPrefix: hash.slice(0, 8), approver: "someone at the runner", method: "cli" }, d.now()));
    return { outcome: r.error ? `refused: ${r.error.slice(0, 140)}` : "NOT refused", pass: !!r.error && frozen(db) };
  });
  if (go() && liftId) await step("lift", "lift.passkey", null, "Approve the runner's proposal with the passkey, apply it, sync the cards", "lifted; the cards stay frozen by default", async () => {
    const out = await passkeyApprove(liftId!);
    if (out.status !== "approved") return { outcome: `the passkey approval was ${out.status}: ${out.message ?? ""}`, pass: false };
    executePolicyChange(db, liftId!, d.now());
    await syncCardsAfterPolicy(db, liftId!, rail, d.now());
    return { outcome: `${liftId} approved by the passkey; emergency stop ${frozen(db) ? "STILL ON" : "off"}; cards ${cardRows(db).map((r) => r.status).join(", ")}`, pass: !frozen(db) && cardRows(db).every((r) => r.status === "INACTIVE"), simulated: "signed by the virtual test passkey" };
  });
  if (go()) await step("lift", "lift.purchase", "sourcing", "After the lift, an agent buys on its card (EUR 1.05)", "approved; the card INACTIVE again after it", async () => {
    const t = await purchase("sourcing", 105, "STOPDRILL AFTER LIFT");
    return { outcome: `${words(t)}; card ${cardOf(db, "sourcing")!.status}`, pass: t.approved && cardOf(db, "sourcing")!.status === "INACTIVE", facts: { card_transaction_id: t.transactionId }, simulated: simNote };
  });

  // ---- The velocity stop: the Treasury agent buys once more per minute than its limit allows.
  const limit = VELOCITY[VELOCITY_AGENT].perMinute;
  let tripAnsweredAt: string | null = null;
  if (go()) await step("velocity", "velocity.burst", VELOCITY_AGENT, `The ${VELOCITY_AGENT} agent buys ${limit + 1} times within a minute (its limit is ${limit} a minute)`, `purchases 1 to ${limit} approved; the ${limit + 1}th approved by Airwallex and stops the agent`, async () => {
    const start = Date.now();
    const out: { n: number; approved: boolean; status: string; stopped_after: boolean; at_ms: number }[] = [];
    let tripMs: number | null = null;
    for (let n = 1; n <= limit + 1; n++) {
      const k = lineCount();
      const t = await purchase(VELOCITY_AGENT, 20 + n, `STOPDRILL VELOCITY ${n}`);
      const isStopped = stopped(db, VELOCITY_AGENT);
      out.push({ n, approved: t.approved, status: t.status, stopped_after: isStopped, at_ms: Date.now() - start });
      if (isStopped) {
        // The tripping authorisation's answer, then the moment Purser had the agent stopped (this line).
        const sim = d.lines().slice(k).find((l) => l.endpoint === "/simulation/issuing/create");
        tripAnsweredAt = sim?.answered_at ?? null;
        tripMs = sim ? Date.now() - Date.parse(sim.answered_at) : null;
        break;
      }
    }
    const last = out.at(-1)!;
    const trips = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'velocity.tripped' AND subject = ?").all(VELOCITY_AGENT) as { payload_json: string }[];
    res.timings.velocity_stop_after_authorisation_ms = tripMs;
    return {
      outcome: `${out.map((x) => `${x.n}:${x.approved ? "ok" : "declined"}`).join(" ")} in ${last.at_ms} ms; stopped after purchase ${out.findIndex((x) => x.stopped_after) + 1 || "none"}${trips[0] ? ` (${(JSON.parse(trips[0].payload_json) as { reason: string }).reason})` : ""}`,
      pass: out.length === limit + 1 && out.slice(0, limit).every((x) => x.approved && !x.stopped_after) && last.stopped_after && last.at_ms < 60_000,
      facts: { purchases: out, stop_after_authorisation_ms: tripMs, tripped: trips.map((r) => JSON.parse(r.payload_json)) },
      simulated: simNote,
    };
  });
  if (go()) await step("velocity", "velocity.card", VELOCITY_AGENT, "The stopped agent's card at Airwallex, and a merchant charging it (EUR 1.06)", "INACTIVE; declined CARD_INACTIVE", async () => {
    const card = await rail.getCard(cardOf(db, VELOCITY_AGENT)!.card_id);
    const t = await rail.simulateCardCharge({ cardId: card.cardId, amountCents: 106, currency: "EUR", merchant: "STOPDRILL MERCHANT", mcc: drillMcc(VELOCITY_AGENT) });
    const reads = d.lines().filter((l) => l.card_status === "INACTIVE" && tripAnsweredAt && Date.parse(l.at) >= Date.parse(tripAnsweredAt) - 5_000);
    return { outcome: `card ${card.status}; ${words(t)}`, pass: card.status === "INACTIVE" && !t.approved && t.failureReason === "CARD_INACTIVE", facts: { card_status: card.status, failure_reason: t.failureReason, inactive_reads_near_trip: reads.map((l) => ({ n: l.n, answered_at: l.answered_at })) }, simulated: simNote };
  });
  if (go()) await step("velocity", "velocity.purchase", VELOCITY_AGENT, "The stopped agent tries to buy again", "refused by Purser before any Airwallex call", async () => {
    const r = await calls(() => purchase(VELOCITY_AGENT, 27, "STOPDRILL VELOCITY 7"));
    return { outcome: `${r.error ? `refused: ${r.error.slice(0, 140)}` : "NOT refused"}; ${r.calls} calls`, pass: !!r.error && r.calls === 0 };
  });
  if (go()) await step("velocity", "velocity.others", "support", "Another agent buys while the Treasury agent is stopped (EUR 1.07)", "approved: the other agents go on", async () => {
    const t = await purchase("support", 107, "STOPDRILL OTHER AGENT");
    return { outcome: words(t), pass: t.approved, simulated: simNote };
  });
  if (go()) await step("velocity", "velocity.lift_phone", VELOCITY_AGENT, "Lift the velocity stop from the phone (a signed change, stop on to off)", "refused: the phone can only tighten", async () => {
    const { out } = await phoneChange(`stop.${VELOCITY_AGENT}`, "off", "stop drill: lift from the phone");
    return { outcome: `${out.status}: ${(out.message ?? "").slice(0, 160)}`, pass: out.status === "refused" && stopped(db, VELOCITY_AGENT), simulated: "signed by the virtual test passkey" };
  });
  if (go()) await step("velocity", "velocity.lift_passkey", VELOCITY_AGENT, "Lift it with a proposal on the runner, approved with the passkey; then the agent buys (EUR 1.08)", "lifted; the purchase approved", async () => {
    const id = proposePolicyChange(db, { changes: [{ key: `stop.${VELOCITY_AGENT}`, to: "off" }], reason: "stop drill: the burst was the drill" }, "human", d.now()).proposal_id;
    const typed = await calls(() => decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }).terms_sha256.slice(0, 8), approver: "someone at the runner", method: "cli" }, d.now()));
    const out = await passkeyApprove(id);
    executePolicyChange(db, id, d.now());
    await syncCardsAfterPolicy(db, id, rail, d.now());
    const t = await purchase(VELOCITY_AGENT, 108, "STOPDRILL AFTER LIFT");
    return { outcome: `typed prefix ${typed.error ? "refused" : "ACCEPTED"}; passkey ${out.status}; stop ${stopped(db, VELOCITY_AGENT) ? "STILL ON" : "off"}; purchase ${words(t)}`, pass: !!typed.error && out.status === "approved" && !stopped(db, VELOCITY_AGENT) && t.approved, facts: { proposal_id: id }, simulated: "signed by the virtual test passkey; " + simNote };
  });

  res.ended_at = d.now().toISOString();
  save();
  return res;
}
