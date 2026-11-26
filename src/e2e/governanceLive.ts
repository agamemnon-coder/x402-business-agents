// The governance features, run live against the Airwallex sandbox (26 Nov, `npm run airwallex:governance-live`), test
// money only. Until this run they were tested against stand-ins only (docs/governance.md, "What is not done"). Three
// runs, each its own record (docs/runs/2026-11-26-<run>.md):
//
//   card-hours  one agent card issued through Purser's Issuing adapter and read back (metadata, merchant categories,
//               currencies, limits, end date); the card's hours set so that now is outside them, and a purchase Purser
//               would start refused before any Airwallex call; a purchase window opened inside the hours, then the
//               hours ended (Purser's clock injected, as the tests do: nothing waits for real hours), and the card
//               sync freezing the card at Airwallex; a simulated authorisation on the frozen card.
//   stop-rail   the CFO's emergency stop at the rail (src/policy/emergencyStop.ts railStop, src/airwallex/routedRail.ts):
//               two supplier payouts planned against the sandbox and signed; one is started while the stop lands in
//               the instant before its create, the other with the stop already on; the routed rail asked directly;
//               Airwallex read back for each request_id; the stop lifted with the passkey; the same payment then paid
//               and followed to its sandbox status.
//   entities    two legal entities, each with its own Airwallex account (the sandbox's connected account, ACTIVE since
//               10 Nov, and the platform account): a payment from entity A's own account, paid; payments set to fund
//               from entity B's account refused before any create.
//   replace-failed  one payout made to fail after it was sent (the sandbox's simulation), read back final-failed at
//               Airwallex, and replaced once by Purser (src/executors/replaceFailed.ts, behind
//               KIT11_REPLACE_FAILED_PAYOUT=on); asked again, nothing is sent a second time.
//
// Simulated, and said so in each record: the approver is a labelled virtual test passkey (no person's Face ID); every
// merchant charge is the sandbox's simulation endpoint; a payout's settlement is the sandbox's simulation.

import type { Agent } from "../config/policy.js";
import { MANUFACTURER } from "../config/payees.js";
import type { DB } from "../db/open.js";
import type { AirwallexRail, SandboxSim } from "../airwallex/port.js";
import type { Card, CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import { HeldBeforeCreate, RoutedRail, type ActGuard, type Rails3 } from "../airwallex/routedRail.js";
import { proposeInvoicePayment } from "../agents/euroBill.js";
import { ibanSha, parseInvoiceFallback } from "../agents/invoice.js";
import { buyPlan } from "../agents/cardBuyer.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { replaceFailedHook, replaceFailedPayout, replacementRequestId, type ReplaceRail } from "../executors/replaceFailed.js";
import { approvalOrigin } from "../executors/index.js";
import { executePolicyChange, proposePolicyChange } from "../executors/policyChange.js";
import { cardControls, cardOf, openCardWindow, setupCards, syncCardsAfterPolicy, syncCardsIfChanged, wantCardStatus } from "../policy/cards.js";
import { cardHoursRefusal, effectiveCardHours } from "../policy/cardHoursGate.js";
import { localWords, parseCardHours, withinCardHours } from "../policy/cardHours.js";
import { cardLimits, frozen, policyValue, ruleFor } from "../policy/rules.js";
import { railStop, STOP_WORDS } from "../policy/emergencyStop.js";
import { entityRefusal, mayPayFrom, payFromKey, registerEntity, type LegalEntity } from "../policy/entities.js";
import { policyVersion } from "../policy/versions.js";
import { fromCents } from "../lib/money.js";
import { canonicalTerms, sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processPolicyRequest, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { setSetting } from "../world/settings.js";
import { soakInvoiceText } from "./airwallexSoak.js";
import type { Step } from "./cardDrill.js";
import type { DrillLine } from "./drillHttp.js";

export const GOV_RUNS = ["card-hours", "stop-rail", "entities", "replace-failed"] as const;
export type GovRun = (typeof GOV_RUNS)[number];
/** The hard limit of one run's Airwallex calls (logins included). */
export const GOV_LIVE_MAX_BUDGET = 80;
export const GOV_PASSKEY_LABEL = "governance-live virtual test passkey (no person's Face ID)";
export const GOV_COMMAND: Origin = { actor: "cfo-command", command: "npm run airwallex:governance-live", moves_money: false };
const RP = "governance-live.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;
/** The nickname suffix of the run's own agent card: a new card, never one of the card drill's. */
export const GOV_CARD_SUFFIX = "governance-1126";
export const GOV_CARD_AGENT: Agent = "sourcing";
/** The hours the CFO sets on the card: an evening window, so a run in the day is outside them. */
export const GOV_HOURS = "Mon-Fri 18:00-20:00 Europe/Amsterdam";

export interface GovResults {
  drill: GovRun; pass_no: number; mode: "live" | "stand-in"; started_at: string; ended_at: string | null; passkey: string;
  cards: { agent: string; card_id: string; last4: string; nickname: string }[];
  timings: Record<string, number | null>;
  steps: Step[]; stopped: string | null;
}

export interface GovDeps {
  db: DB;
  mode: "live" | "stand-in";
  now: () => Date;
  lines: () => DrillLine[];
  halted: () => string | null;
  log?: (line: string) => void;
  save?: (r: GovResults) => void;
}

type Outcome = { outcome: string; pass: boolean | null; facts?: Record<string, unknown>; simulated?: string };

/** The step recorder, the call counter and the virtual passkey every run shares. */
function runner(run: GovRun, d: GovDeps) {
  const { db } = d;
  const log = d.log ?? (() => undefined);
  const res: GovResults = { drill: run, pass_no: 1, mode: d.mode, started_at: d.now().toISOString(), ended_at: null, passkey: GOV_PASSKEY_LABEL, cards: [], timings: {}, steps: [], stopped: null };
  const lineCount = () => d.lines().length;
  const go = () => !res.stopped;
  const step = async (phase: string, id: string, agent: string | null, title: string, expect: string, body: () => Promise<Outcome>): Promise<Step | null> => {
    if (!go()) return null;
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
      if (/\/simulation\/issuing\/create -> 400 bad_request/.test(s.error)) {
        s.outcome = "the sandbox refused to simulate the charge (HTTP 400 bad_request): neither approved nor declined, nothing to judge";
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
    // A step that failed stops the run (the brief: stop a run at its first real blocker); a measurement does not.
    if (s.pass === false && !res.stopped) res.stopped = `${id}: ${s.outcome.slice(0, 200)}`;
    res.steps.push(s);
    log(`${s.pass === true ? "PASS" : s.pass === false ? "FAIL" : "INFO"}  ${id.padEnd(28)} ${agent ?? "-"}  ${s.outcome}  (${s.lines.length} calls, ${s.ms} ms)`);
    d.save?.(res);
    return s;
  };
  /** Runs `f` and counts the Airwallex calls it made, and the POSTs among them (a create is a POST). */
  const calls = async <T>(f: () => Promise<T> | T): Promise<{ value: T | null; error: Error | null; calls: number; posts: number; endpoints: string[] }> => {
    const k = lineCount();
    const out = (value: T | null, error: Error | null) => {
      const ls = d.lines().slice(k);
      return { value, error, calls: ls.length, posts: ls.filter((l) => l.method === "POST" && l.endpoint !== "/authentication/login").length, endpoints: ls.map((l) => `${l.method} ${l.endpoint}`) };
    };
    try { return out(await f(), null); } catch (e) { return out(null, e as Error); }
  };

  // The virtual test passkey (labelled), the ledger's only approver.
  const auth = new FakeAuthenticator();
  let counter = 0;
  const enrol = () => step("setup", "setup.passkey", null, "Enrol the virtual test passkey (labelled) as this ledger's only approver", "enrolled and confirmed", async () => {
    const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, d.now());
    const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
    const out = await processRegistration(db, { ticket: `gov-enrol-${run}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: d.now().toISOString() }, { label: GOV_PASSKEY_LABEL }, d.now());
    confirmPasskey(db, fingerprintOf(auth.spkiSha256), d.now());
    return { outcome: `${out.status}; confirmed: ${GOV_PASSKEY_LABEL}`, pass: out.status === "pending", simulated: "a virtual test passkey, no person's Face ID" };
  });
  /** A policy change as the phone sends it: created and approved in one step, signed by the passkey (tighten only). Not applied. */
  const phoneChange = async (key: string, to: string, reason: string, at = d.now()) => {
    const terms = { schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: `C-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`, expires_at: new Date(at.getTime() + 10 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"), changes: [{ key, label: ruleFor(db, key)?.label ?? key, from: policyValue(db, key), to }], reason };
    const canonical = canonicalTerms(terms as unknown as Terms);
    const hash = sha256Hex(canonical);
    const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
    const out = await processPolicyRequest(db, { ticket: `gov-${terms.proposal_id}`, kind: "policy", proposal_id: null, body: JSON.stringify({ canonical, terms_sha256: hash, credential }), received_at: at.toISOString() }, at);
    return { out, proposalId: terms.proposal_id };
  };
  /** The passkey's approval of a proposal made on the runner. */
  const passkeyApprove = async (proposalId: string, at = d.now()) => {
    const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
    const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter: ++counter });
    return processAssertion(db, { ticket: `gov-${proposalId}-${counter}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: at.toISOString() }, at);
  };
  /** A change on the runner, approved with the passkey and applied (a loosening: never from the phone). */
  const runnerChange = async (key: string, to: string, reason: string) => {
    const id = proposePolicyChange(db, { changes: [{ key, to }], reason }, "human", d.now()).proposal_id;
    const out = await passkeyApprove(id);
    if (out.status !== "approved") throw new Error(`the passkey approval of ${id} was ${out.status}: ${out.message ?? ""}`);
    executePolicyChange(db, id, d.now());
    return id;
  };
  return { res, step, calls, enrol, phoneChange, passkeyApprove, runnerChange, go };
}

const words = (t: CardTransaction) => (t.approved ? `approved (${t.status})` : `declined ${t.failureReason ?? t.status}`);
const simNote = "the merchant's charge is the sandbox's simulation endpoint";
const sameList = (a: string[] | undefined, b: string[]) => !!a && [...a].sort().join(",") === [...b].sort().join(",");
const termsOf = <T>(db: DB, id: string) => JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as T;
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const shaOf = (db: DB, id: string) => (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }).terms_sha256;

/**
 * The moments Purser's clock is set to for the end of the hours: the last half minute inside them and the first half
 * minute after, on the next weekday evening at or after `from` (Europe/Amsterdam). Nothing waits for them.
 */
export function hoursEdge(from: Date, hours = GOV_HOURS): { inside: Date; after: Date } {
  const h = parseCardHours(hours)!;
  for (let m = Math.ceil(from.getTime() / 60_000); m < from.getTime() / 60_000 + 8 * 1440; m++) {
    const at = new Date(m * 60_000 + 30_000);
    const after = new Date(at.getTime() + 60_000);
    if (withinCardHours(h, at) && !withinCardHours(h, after)) return { inside: at, after };
  }
  throw new Error("no end of the hours within a week");
}

// ---------------------------------------------------------------------------------------------------------------------
// Run 1: card governance in Airwallex Issuing.

export async function runCardHours(d: GovDeps & { rail: IssuingRail & IssuingSim; edge?: { inside: Date; after: Date } }): Promise<GovResults> {
  const { db, rail } = d;
  const r = runner("card-hours", d);
  const { res, step, calls } = r;
  const agent = GOV_CARD_AGENT;
  const edge = d.edge ?? hoursEdge(d.now());
  res.timings.clock_inside_hours = edge.inside.getTime();
  res.timings.clock_after_hours = edge.after.getTime();

  await r.enrol();
  let issuedAt = d.now();
  let card: Card | null = null;
  await step("setup", "card.issue", agent, `Issue the ${agent} agent's card through Purser's Issuing adapter (setupCards; a new card, nickname suffix ${GOV_CARD_SUFFIX})`, "issued, with the policy's limits and controls, then frozen by default (INACTIVE)", async () => {
    issuedAt = d.now();
    const rows = await setupCards(db, rail, issuedAt, { agents: [agent], nicknameSuffix: GOV_CARD_SUFFIX });
    const row = rows.find((x) => x.agent === agent)!;
    const ev = db.prepare("SELECT event FROM audit_log WHERE subject = ? AND event IN ('card.issued', 'card.adopted') ORDER BY seq LIMIT 1").get(agent) as { event: string } | undefined;
    res.cards.push({ agent, card_id: row.card_id, last4: row.last4, nickname: row.nickname });
    return { outcome: `${ev?.event === "card.issued" ? "issued" : "ADOPTED an existing card"} ${row.card_id} ••${row.last4}; status ${row.status}; policy v${policyVersion(db, issuedAt).version}`, pass: ev?.event === "card.issued" && row.status === "INACTIVE", facts: { card_id: row.card_id, last4: row.last4, status: row.status, event: ev?.event ?? null } };
  });
  await step("setup", "card.readback", agent, "Read the card back from Airwallex (GET /issuing/cards/{id})", "metadata agent_id and policy_version; merchant categories, currencies, limits and end date as the CFO policy says", async () => {
    card = await rail.getCard(cardOf(db, agent)!.card_id);
    const want = { controls: cardControls(agent, issuedAt, db), limits: cardLimits(db, agent), version: `v${policyVersion(db, issuedAt).version}` };
    const c = card.controls;
    const endGapS = c?.activeTo && want.controls.activeTo ? Math.round(Math.abs(Date.parse(c.activeTo) - Date.parse(want.controls.activeTo)) / 1000) : null;
    const checks = {
      metadata_agent_id: card.metadata?.agent_id === agent,
      metadata_policy_version: card.metadata?.policy_version === want.version,
      merchant_categories: sameList(c?.mccs, want.controls.mccs),
      currencies: sameList(c?.currencies, want.controls.currencies),
      limits: card.limits?.perTxCents === want.limits.perTxCents && card.limits?.monthlyCents === want.limits.monthlyCents && card.limits?.currency === "EUR",
      active_to: endGapS !== null && endGapS <= 60,
    };
    const facts = {
      card_status: card.status, metadata: card.metadata ?? null, allowed_merchant_categories: c?.mccs ?? null, allowed_currencies: c?.currencies ?? null,
      transaction_limits: card.limits ? { currency: card.limits.currency, per_transaction: fromCents(card.limits.perTxCents), monthly: fromCents(card.limits.monthlyCents) } : null,
      active_to: c?.activeTo ?? null, allowed_transaction_count: c?.singleUse ? "SINGLE" : "MULTIPLE",
      policy: { mccs: want.controls.mccs, currencies: want.controls.currencies, per_transaction: fromCents(want.limits.perTxCents), monthly: fromCents(want.limits.monthlyCents), active_to: want.controls.activeTo, policy_version: want.version },
      active_to_gap_s: endGapS, checks,
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    return {
      outcome: `${card.status}; metadata ${JSON.stringify(card.metadata ?? {})}; MCC ${(c?.mccs ?? []).join(",") || "none"}; ${(c?.currencies ?? []).join(",") || "no currency"}; EUR ${card.limits ? `${fromCents(card.limits.perTxCents)} per purchase / ${fromCents(card.limits.monthlyCents)} a month` : "no limits"}; active_to ${c?.activeTo ?? "none"}${bad.length ? `; DIFFERS: ${bad.join(", ")}` : "; all as the policy says"}`,
      pass: bad.length === 0, facts,
    };
  });

  let hoursChange: string | null = null;
  await step("hours", "hours.set", agent, `The CFO sets the card's hours to "${GOV_HOURS}" (a tightening, signed with the passkey on the phone path); the runner applies it and syncs the cards`, "the hours Purser enforces on the card are the new hours; no Airwallex call (the hours are Purser's own control)", async () => {
    const k = await calls(async () => {
      const { out, proposalId } = await r.phoneChange(`card.${agent}.hours`, GOV_HOURS, "governance run: the card pays in its evening window only");
      if (out.status !== "approved") throw new Error(`the phone's change was ${out.status}: ${out.message ?? ""}`);
      hoursChange = proposalId;
      executePolicyChange(db, proposalId, d.now());
      return syncCardsAfterPolicy(db, proposalId, rail, d.now());
    });
    if (k.error) throw k.error;
    const enforced = effectiveCardHours(db, agent);
    return { outcome: `${hoursChange} approved by the passkey and applied; the card's hours ${enforced}; policy v${policyVersion(db, d.now()).version}; ${k.calls} Airwallex calls`, pass: enforced === GOV_HOURS && cardOf(db, agent)!.hours === GOV_HOURS, facts: { proposal_id: hoursChange, hours: enforced, calls: k.calls }, simulated: "signed by the virtual test passkey" };
  });
  await step("hours", "hours.refused_now", agent, "Now (outside the hours) the agent buys on its card (buyPlan packwise-starter, EUR 19.99): Purser starts the purchase", "refused outside_card_hours by Purser, before any Airwallex call; the refusal audited", async () => {
    const now = d.now();
    const k = await calls(() => buyPlan(db, rail, "packwise-starter", now));
    const refused = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'card.purchase_refused' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
    const w = await calls(() => openCardWindow(db, rail, agent, { amountCents: 100, merchant: "Packwise", why: "governance run: outside the hours" }, now));
    return {
      outcome: `${k.error ? `refused: ${k.error.message.slice(0, 160)}` : "NOT refused"}; ${k.calls} Airwallex calls; a purchase window: ${w.value === null && !w.error ? "none opened" : "OPENED"}, ${w.calls} calls; now ${localWords(now, "Europe/Amsterdam")}`,
      pass: !!k.error && /^outside_card_hours/.test(k.error.message) && k.calls === 0 && !!refused && w.value === null && !w.error && w.calls === 0,
      facts: { now: now.toISOString(), local: localWords(now, "Europe/Amsterdam"), refusal: refused ? JSON.parse(refused.payload_json) : null, calls: k.calls, window_calls: w.calls },
    };
  });

  let thawRead: Card | null = null;
  await step("hours", "hours.thaw_inside", agent, `Purser's clock set inside the hours (${localWords(edge.inside, "Europe/Amsterdam")}): Purser opens a purchase window for one approved purchase (openCardWindow, EUR 1.00 at Packwise), then the card is read back`, "thawed: ACTIVE at Airwallex, its metadata naming the agent, the task and the policy version", async () => {
    const w = await openCardWindow(db, rail, agent, { amountCents: 100, merchant: "Packwise", why: "governance run: an approved purchase inside the hours" }, edge.inside);
    if (!w) return { outcome: "no window opened", pass: false };
    thawRead = await rail.getCard(cardOf(db, agent)!.card_id);
    return {
      outcome: `window until ${w.until}; read back ${thawRead.status}; metadata ${JSON.stringify(thawRead.metadata ?? {})}`,
      pass: thawRead.status === "ACTIVE" && thawRead.metadata?.agent_id === agent && typeof thawRead.metadata?.task_id === "string" && /^v\d+$/.test(thawRead.metadata?.policy_version ?? ""),
      facts: { clock: edge.inside.toISOString(), window_until: w.until, card_status: thawRead.status, metadata: thawRead.metadata ?? null },
      simulated: "Purser's clock injected (inside the hours); the Airwallex calls are real and happen now",
    };
  });
  await step("hours", "hours.purchase_auth", agent, "The approved purchase's authorisation on the thawed card (EUR 1.00, Packwise, MCC 5734)", "approved by Airwallex", async () => {
    const t = await rail.simulateCardCharge({ cardId: cardOf(db, agent)!.card_id, amountCents: 100, currency: "EUR", merchant: "GOVRUN PACKWISE", mcc: "5734" });
    return { outcome: words(t), pass: t.approved, facts: { card_transaction_id: t.transactionId, status: t.status, failure_reason: t.failureReason }, simulated: simNote };
  });
  await step("hours", "hours.end_sync", agent, `Purser's clock set just after the hours end (${localWords(edge.after, "Europe/Amsterdam")}), the purchase window still open: the runner's card sync (syncCardsIfChanged), then the card read back`, "the window closed (the hours ended), the card frozen at Airwallex: card_status INACTIVE read back", async () => {
    const before = wantCardStatus(db, agent, edge.inside);
    const after = wantCardStatus(db, agent, edge.after);
    const t0 = Date.now();
    const changed = await syncCardsIfChanged(db, rail, edge.after);
    const read = await rail.getCard(cardOf(db, agent)!.card_id);
    res.timings.hours_end_freeze_ms = Date.now() - t0;
    const closed = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'card.window_closed' AND subject = ? ORDER BY seq DESC LIMIT 1").get(agent) as { payload_json: string } | undefined;
    const frozenRow = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'card.frozen' AND subject = ? ORDER BY seq DESC LIMIT 1").get(agent) as { payload_json: string } | undefined;
    const why = frozenRow ? (JSON.parse(frozenRow.payload_json) as { why?: string }).why ?? "" : "";
    const closedWhy = closed ? (JSON.parse(closed.payload_json) as { why?: string }).why ?? "" : "";
    return {
      outcome: `policy wants ${before} inside, ${after} after; sync changed ${changed.join(", ") || "nothing"}; read back ${read.status}; window closed: "${closedWhy}"; frozen: "${why}"`,
      pass: before === "ACTIVE" && after === "INACTIVE" && changed.includes(agent) && read.status === "INACTIVE" && /hours ended/.test(closedWhy) && /outside its hours/.test(why),
      facts: { clock: edge.after.toISOString(), want_inside: before, want_after: after, changed, card_status: read.status, window_closed_why: closedWhy, frozen_why: why, ms: res.timings.hours_end_freeze_ms },
      simulated: "Purser's clock injected (just after the hours); the Airwallex calls are real and happen now",
    };
  });
  await step("hours", "hours.charge_frozen", agent, "A merchant charges the frozen card by itself (EUR 1.00, MCC 5734)", "declined CARD_INACTIVE by Airwallex", async () => {
    const t = await rail.simulateCardCharge({ cardId: cardOf(db, agent)!.card_id, amountCents: 100, currency: "EUR", merchant: "GOVRUN AFTER HOURS", mcc: "5734" });
    return { outcome: words(t), pass: !t.approved && t.failureReason === "CARD_INACTIVE", facts: { card_transaction_id: t.transactionId, status: t.status, failure_reason: t.failureReason }, simulated: simNote };
  });
  await step("hours", "hours.no_window_after", agent, "After the hours, Purser tries to open a purchase window (clock still after the hours)", "no window, no Airwallex call", async () => {
    const w = await calls(() => openCardWindow(db, rail, agent, { amountCents: 100, merchant: "Packwise", why: "governance run: after the hours" }, edge.after));
    return { outcome: `${w.value === null && !w.error ? "no window" : "a window OPENED"}; ${w.calls} calls; ${cardHoursRefusal(db, agent, edge.after) ?? ""}`.slice(0, 300), pass: w.value === null && !w.error && w.calls === 0 };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run 2: the emergency stop at the rail.

export const STOP_RAIL_PAYOUTS = [{ invoice: "BTX-GOV-1126-1", eur: "1.00" }, { invoice: "BTX-GOV-1126-2", eur: "1.01" }] as const;

export async function runStopRail(d: GovDeps & {
  awx: Rails3; simBank: Rails3; issuing: IssuingRail;
  /** Whether Airwallex holds a transfer under this request_id (GET /transfers?request_id=…). */
  transferExists: (requestId: string) => Promise<boolean>;
}): Promise<GovResults> {
  const { db } = d;
  const r = runner("stop-rail", d);
  const { res, step, calls } = r;
  const routes = new Map<string, { bank: "airwallex" | "simulated"; twin: string | null }>();
  const spent: string[] = [], released: string[] = [];
  const guard: ActGuard = { blocked: async () => null, spend: async (a) => { spent.push(a.key); }, release: async (k) => { released.push(k); } };
  // The stop the rail asks (Purser Cloud's railStop); `landing` applies a signed stop at the instant a create reaches it.
  let landing: { proposalId: string; kind: string } | null = null;
  const asked = railStop(db, d.now);
  const stop = (what: "conversion" | "transfer" | "batch", ref: string) => {
    if (landing && what === landing.kind) { const l = landing; landing = null; executePolicyChange(db, l.proposalId, d.now()); }
    return asked(what, ref);
  };
  const rail = new RoutedRail(d.awx, d.simBank, { get: (k) => routes.get(k) ?? null, set: (k, v) => { routes.set(k, v); } }, guard, undefined, () => undefined, stop);
  const atAwx = <T>(f: () => Promise<T>) => rail.within("airwallex", f);

  await r.enrol();
  const payouts: { proposalId: string; requestId: string; invoice: string; eur: string; beneficiaryId: string }[] = [];
  await step("setup", "setup.payouts", "treasury", `Two supplier payouts planned against the sandbox (EUR ${STOP_RAIL_PAYOUTS[0].eur} and EUR ${STOP_RAIL_PAYOUTS[1].eur} to ${MANUFACTURER.name}) and signed with the passkey`, "both APPROVED, not executed", async () => {
    const ben = await d.awx.findBeneficiaryByIban(MANUFACTURER.iban);
    if (!ben) return { outcome: `Airwallex holds no beneficiary for ${MANUFACTURER.name}; the run creates none`, pass: false };
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(ben.id, MANUFACTURER.name, MANUFACTURER.iban.slice(-4), ibanSha(MANUFACTURER.iban), MANUFACTURER.bic);
    // The routed rail's record that this payee was made at Airwallex (as Purser Cloud records a payee it finds there).
    routes.set(`ben:${ben.id}`, { bank: "airwallex", twin: null });
    for (const k of ["eur_floor", "eur_obligations", "usd_floor"] as const) setSetting(db, "treasury", k, "0.00");
    for (const p of STOP_RAIL_PAYOUTS) {
      const text = soakInvoiceText("bergtex", p.invoice, p.eur);
      const out = await withOrigin(GOV_COMMAND, () => proposeInvoicePayment(db, d.awx, parseInvoiceFallback(text), text, d.now()));
      if (out.kind !== "proposed") return { outcome: `${p.invoice} not planned: ${out.reason}`, pass: false };
      const signed = await r.passkeyApprove(out.proposal.proposal_id);
      const t = termsOf<{ transfer_request_id: string; conversion: unknown }>(db, out.proposal.proposal_id);
      if (t.conversion) return { outcome: `${p.invoice} needs a conversion; this run pays euros only`, pass: false };
      payouts.push({ proposalId: out.proposal.proposal_id, requestId: t.transfer_request_id, invoice: p.invoice, eur: p.eur, beneficiaryId: ben.id });
      if (signed.status !== "approved") return { outcome: `${out.proposal.proposal_id} ${signed.status}`, pass: false };
    }
    return {
      outcome: payouts.map((p) => `${p.proposalId} ${statusOf(db, p.proposalId)} (EUR ${p.eur}, request_id ${p.requestId})`).join("; "),
      pass: payouts.length === 2 && payouts.every((p) => statusOf(db, p.proposalId) === "APPROVED"),
      facts: { beneficiary_id: ben.id, payouts: payouts.map((p) => ({ proposal_id: p.proposalId, invoice_no: p.invoice, amount: `EUR ${p.eur}`, transfer_request_id: p.requestId, terms_sha256: shaOf(db, p.proposalId) })) },
      simulated: "signed by the virtual test passkey",
    };
  });
  const [p1, p2] = [payouts[0], payouts[1]];
  let stopId: string | null = null;
  await step("stop", "stop.signed", null, "The CFO signs the emergency stop on the phone (a policy change, freeze off to on), not yet applied", "approved by the passkey", async () => {
    const { out, proposalId } = await r.phoneChange("freeze", "on", "governance run: the CFO pulls the emergency stop");
    stopId = proposalId;
    return { outcome: `${proposalId} ${out.status}; the stop is ${frozen(db) ? "ON" : "not yet applied"}`, pass: out.status === "approved" && !frozen(db), facts: { proposal_id: proposalId }, simulated: "signed by the virtual test passkey" };
  });
  await step("stop", "stop.lands_at_rail", "treasury", `The second payout (${p2?.proposalId ?? "-"}) is started on the routed rail with the stop off; the signed stop is applied at the instant its transfer create reaches the rail, after the executor's own last check`, "HeldBeforeCreate at the rail: no POST to Airwallex, the payout row closed CANCELLED (held_by_purser), the payment FAILED, the refusal audited (checked: rail)", async () => {
    if (!p2 || !stopId) return { outcome: "nothing planned", pass: false };
    landing = { proposalId: stopId, kind: "transfer" };
    const k = await calls(() => atAwx(() => withOrigin(approvalOrigin(db, p2.proposalId)!, () => executeInvoicePayment(db, rail, null, p2.proposalId))));
    const row = db.prepare("SELECT status, failure_type FROM transfers WHERE request_id = ?").get(p2.requestId) as { status: string; failure_type: string | null } | undefined;
    const held = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.held_before_create' AND subject = ? ORDER BY seq DESC LIMIT 1").get(p2.requestId) as { payload_json: string } | undefined;
    const heldBy = held ? (JSON.parse(held.payload_json) as { checked?: string }).checked : null;
    return {
      outcome: `${k.error ? `${k.error.name}: ${k.error.message.slice(0, 120)}` : "NOT refused"}; ${k.calls} Airwallex calls (${k.posts} POST: ${k.endpoints.join(", ") || "none"}); stop ${frozen(db) ? "on" : "OFF"}; row ${row ? `${row.status} ${row.failure_type ?? ""}` : "none"}; payment ${statusOf(db, p2.proposalId)}; audited checked: ${heldBy ?? "none"}`,
      pass: k.error instanceof HeldBeforeCreate && k.posts === 0 && frozen(db) && row?.status === "CANCELLED" && row.failure_type === "held_by_purser" && statusOf(db, p2.proposalId) === "FAILED" && heldBy === "rail",
      facts: { proposal_id: p2.proposalId, request_id: p2.requestId, calls: k.endpoints, posts: k.posts, row: row ?? null, payment: statusOf(db, p2.proposalId), held_checked: heldBy, caps_spoken_for: spent.includes(p2.requestId), caps_released: released.includes(p2.requestId) },
      simulated: "the moment the stop lands is chosen by the run (inside the rail's last ask); the stop itself is the CFO's signed change",
    };
  });
  await step("stop", "stop.sync", null, "The runner syncs the cards after the stop (this ledger holds no cards)", "no card, no call", async () => {
    const k = await calls(() => syncCardsAfterPolicy(db, stopId!, d.issuing, d.now()));
    return { outcome: `${k.error ? `error: ${k.error.message}` : `changed ${JSON.stringify(k.value)}`}; ${k.calls} calls`, pass: !k.error && k.calls === 0 };
  });
  await step("blocked", "blocked.executor", "treasury", `The first payout (${p1?.proposalId ?? "-"}) is started on the routed rail while the stop is on (executeInvoicePayment)`, "refused by the executor when its execution begins: no POST to Airwallex; the payment stays APPROVED", async () => {
    if (!p1) return { outcome: "nothing planned", pass: false };
    const k = await calls(() => atAwx(() => withOrigin(approvalOrigin(db, p1.proposalId)!, () => executeInvoicePayment(db, rail, null, p1.proposalId))));
    return {
      outcome: `${k.error ? `refused: ${k.error.message.slice(0, 120)}` : "NOT refused"}; ${k.calls} Airwallex calls (${k.posts} POST: ${k.endpoints.join(", ") || "none"}); payment ${statusOf(db, p1.proposalId)}`,
      pass: !!k.error && k.error.message.includes(STOP_WORDS) && k.posts === 0 && statusOf(db, p1.proposalId) === "APPROVED",
      facts: { proposal_id: p1.proposalId, calls: k.endpoints, posts: k.posts, payment: statusOf(db, p1.proposalId) },
    };
  });
  await step("blocked", "blocked.rail", "treasury", `The routed rail asked directly for the first payout's transfer (its signed request_id, payee and amount), the stop on`, "HeldBeforeCreate: nothing sent to Airwallex; the refusal audited (checked: rail)", async () => {
    if (!p1) return { outcome: "nothing planned", pass: false };
    const k = await calls(() => atAwx(() => rail.createTransfer({ requestId: p1.requestId, beneficiaryId: p1.beneficiaryId, amountCents: 100, currency: "EUR", sourceCurrency: "EUR", reference: p1.invoice, reason: "governance run: the rail asked directly", approvalSha256: shaOf(db, p1.proposalId) })));
    const held = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'transfer.held_before_create' AND subject = ? ORDER BY seq DESC LIMIT 1").get(p1.requestId) as { payload_json: string } | undefined;
    const heldBy = held ? (JSON.parse(held.payload_json) as { checked?: string }).checked : null;
    return { outcome: `${k.error ? `${k.error.name}: ${k.error.message.slice(0, 120)}` : "NOT refused"}; ${k.calls} Airwallex calls; audited checked: ${heldBy ?? "none"}`, pass: k.error instanceof HeldBeforeCreate && k.calls === 0 && heldBy === "rail", facts: { request_id: p1.requestId, calls: k.calls, held_checked: heldBy } };
  });
  await step("blocked", "readback.none", null, "Airwallex read back by each payout's request_id (GET /transfers?request_id=…)", "no transfer under either request_id", async () => {
    if (!p1 || !p2) return { outcome: "nothing planned", pass: false };
    const [e1, e2] = [await d.transferExists(p1.requestId), await d.transferExists(p2.requestId)];
    return { outcome: `${p1.requestId}: ${e1 ? "a TRANSFER EXISTS" : "no transfer"}; ${p2.requestId}: ${e2 ? "a TRANSFER EXISTS" : "no transfer"}`, pass: !e1 && !e2, facts: { [p1.requestId]: e1, [p2.requestId]: e2 } };
  });
  await step("lift", "lift.passkey", null, "The CFO lifts the stop: a proposal on the runner (freeze on to off), approved with the passkey, applied", "the stop off", async () => {
    const id = await r.runnerChange("freeze", "off", "governance run: checked, all clear");
    await syncCardsAfterPolicy(db, id, d.issuing, d.now());
    return { outcome: `${id} approved by the passkey and applied; the stop ${frozen(db) ? "STILL ON" : "off"}`, pass: !frozen(db), facts: { proposal_id: id }, simulated: "signed by the virtual test passkey" };
  });
  let paid: { id: string; status: string } | null = null;
  await step("lift", "paid.payout1", "treasury", `The same first payout (${p1?.proposalId ?? "-"}) started again on the routed rail after the lift, then settled by the sandbox's simulation`, "the transfer created under its signed request_id, followed to PAID", async () => {
    if (!p1) return { outcome: "nothing planned", pass: false };
    const t0 = Date.now();
    const k = await calls(() => atAwx(() => withOrigin(approvalOrigin(db, p1.proposalId)!, () => executeInvoicePayment(db, rail, rail, p1.proposalId))));
    res.timings.payout_create_to_paid_ms = Date.now() - t0;
    if (k.error) throw k.error;
    const tr = k.value!.transfer;
    paid = { id: tr.id, status: tr.status };
    return { outcome: `transfer ${tr.id} ${tr.status}; payment ${statusOf(db, p1.proposalId)}; ${k.calls} Airwallex calls (${k.endpoints.join(", ")})`, pass: tr.status === "PAID" && tr.requestId === p1.requestId && statusOf(db, p1.proposalId) === "EXECUTED", facts: { transfer_id: tr.id, request_id: tr.requestId, status: tr.status, fee: tr.fee ? `${tr.fee.currency} ${fromCents(tr.fee.cents)}` : null, calls: k.endpoints }, simulated: "the settlement to PAID is the sandbox's simulation" };
  });
  await step("lift", "readback.paid", null, "Airwallex read back: the transfer by its id, and the request_id", "PAID; a transfer under the first payout's request_id", async () => {
    if (!p1 || !paid) return { outcome: "nothing paid", pass: false };
    const t = await d.awx.getTransfer(paid.id);
    const exists = await d.transferExists(p1.requestId);
    return { outcome: `${t.id} ${t.status} (EUR ${fromCents(t.amountCents)}); request_id ${p1.requestId}: ${exists ? "found" : "NOT found"}`, pass: t.status === "PAID" && exists && t.amountCents === 100, facts: { transfer_id: t.id, status: t.status, amount: `EUR ${fromCents(t.amountCents)}`, fee: t.fee ? `${t.fee.currency} ${fromCents(t.fee.cents)}` : null } };
  });
  await step("lift", "after.payout2", "treasury", `The payout held at the rail (${p2?.proposalId ?? "-"}) started again after the lift`, "not sent again under its request_id (a new proposal pays the invoice): no POST", async () => {
    if (!p2) return { outcome: "nothing planned", pass: false };
    const k = await calls(() => atAwx(() => withOrigin(approvalOrigin(db, p2.proposalId)!, () => executeInvoicePayment(db, rail, rail, p2.proposalId))));
    const exists = await d.transferExists(p2.requestId);
    return { outcome: `${k.error ? `refused: ${k.error.message.slice(0, 140)}` : "NOT refused"}; ${k.posts} POST; Airwallex under ${p2.requestId}: ${exists ? "a TRANSFER EXISTS" : "no transfer"}`, pass: !!k.error && k.posts === 0 && !exists, facts: { calls: k.endpoints, posts: k.posts, transfer_exists: exists } };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run 3: entities and their funding accounts.

export interface Payee { id: string; name: string; iban: string; bic: string }

export async function runEntities(d: GovDeps & {
  /** Entity A's own account (x-on-behalf-of) and the rail acting for it. */
  a: { entity: LegalEntity; rail: AirwallexRail & SandboxSim };
  /** Entity B's account; `rail` acts for it explicitly (x-on-behalf-of B), `ownRail` is the client's default account, which is B's. */
  b: { entity: LegalEntity; rail: AirwallexRail; ownRail: AirwallexRail };
  /** A test payee on file at entity A's account (read, never created by the run). */
  payeeAtA: () => Promise<Payee | undefined>;
  transferExists: (at: "a" | "b", requestId: string) => Promise<boolean>;
}): Promise<GovResults> {
  const { db, a, b } = d;
  const r = runner("entities", d);
  const { res, step, calls } = r;
  const invoiceText = (p: Payee, no: string, eur: string) => [
    p.name, "Testlaan 1, 4331 AA Middelburg, Netherlands (test address)", "", `INVOICE ${no}`, "Date: 26 November 2026", "Due date: 10 December 2026", "", "Bill to: Northwind Outdoor", "",
    "Description                                   Amount", `${"Packaging, entities test".padEnd(46)}EUR ${eur}`, "", `Total due                                     EUR ${eur}`, "",
    "Pay by SWIFT to:", `Account name: ${p.name}`, `IBAN: ${p.iban.replace(/(.{4})/g, "$1 ").trim()}`, `BIC: ${p.bic}`, `Payment reference: ${no}`, "",
  ].join("\n");

  await r.enrol();
  await step("setup", "setup.entities", null, `Register two legal entities, each with its own Airwallex account: A ${a.entity.name} (${a.entity.funding_account}), B ${b.entity.name} (${b.entity.funding_account})`, "both held; neither open to any agent", async () => {
    registerEntity(db, "system", a.entity, d.now());
    registerEntity(db, "system", b.entity, d.now());
    for (const k of ["eur_floor", "eur_obligations", "usd_floor"] as const) setSetting(db, "treasury", k, "0.00");
    return { outcome: `held: ${a.entity.id}, ${b.entity.id}; treasury may pay from A ${mayPayFrom(db, "treasury", a.entity.id)}, from B ${mayPayFrom(db, "treasury", b.entity.id)}`, pass: !mayPayFrom(db, "treasury", a.entity.id) && !mayPayFrom(db, "treasury", b.entity.id) };
  });
  await step("setup", "setup.allow_a", "treasury", `The CFO opens entity A to the treasury agent (${payFromKey(a.entity.id, "treasury")} allowed: a loosening, a proposal on the runner signed with the passkey)`, "the treasury agent may pay from A, not from B", async () => {
    const id = await r.runnerChange(payFromKey(a.entity.id, "treasury"), "allowed", "governance run: the treasury agent pays entity A's bills");
    return { outcome: `${id} approved by the passkey and applied; A ${mayPayFrom(db, "treasury", a.entity.id)}, B ${mayPayFrom(db, "treasury", b.entity.id)}`, pass: mayPayFrom(db, "treasury", a.entity.id) && !mayPayFrom(db, "treasury", b.entity.id), facts: { proposal_id: id }, simulated: "signed by the virtual test passkey" };
  });
  let payee: Payee | undefined;
  await step("setup", "setup.payee_a", null, "A test payee already on file at entity A's account, read from Airwallex (GET /beneficiaries with x-on-behalf-of A) and put on Purser's allowlist", "found; nothing created at Airwallex", async () => {
    payee = await d.payeeAtA();
    if (!payee) return { outcome: "no payee with an IBAN on file at entity A's account; the run creates none", pass: false };
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(payee.id, payee.name, payee.iban.slice(-4), ibanSha(payee.iban), payee.bic);
    return { outcome: `${payee.id} ${payee.name}, IBAN ••${payee.iban.slice(-4)}`, pass: true, facts: { beneficiary_id: payee.id, name: payee.name, iban_last4: payee.iban.slice(-4) } };
  });
  const plan = async (rail: AirwallexRail, no: string, eur: string, entity: string) => {
    const text = invoiceText(payee!, no, eur);
    return withOrigin(GOV_COMMAND, () => proposeInvoicePayment(db, rail, parseInvoiceFallback(text), text, d.now(), "MIN_15", undefined, undefined, entity));
  };
  let p1: string | null = null;
  await step("pay", "pay.plan_a", "treasury", `A payment from entity A (EUR 1.00 to the test payee, invoice ENT-A-1126-1), planned on the rail acting for A's own account, signed with the passkey`, "proposed with paying_entity A and funding_account A's account in the signed terms; APPROVED", async () => {
    const out = await plan(a.rail, "ENT-A-1126-1", "1.00", a.entity.id);
    if (out.kind !== "proposed") return { outcome: `not planned: ${out.reason}`, pass: false };
    p1 = out.proposal.proposal_id;
    const signed = await r.passkeyApprove(p1);
    const t = termsOf<{ paying_entity?: unknown; funding_account?: unknown; transfer_request_id: string }>(db, p1);
    return { outcome: `${p1} ${statusOf(db, p1)} (${signed.status}); paying_entity ${JSON.stringify(t.paying_entity)}; funding_account ${JSON.stringify(t.funding_account)}; request_id ${t.transfer_request_id}`, pass: statusOf(db, p1) === "APPROVED" && (t.funding_account as { id?: string })?.id === a.entity.funding_account, facts: { proposal_id: p1, paying_entity: t.paying_entity, funding_account: t.funding_account, transfer_request_id: t.transfer_request_id, terms_sha256: shaOf(db, p1) }, simulated: "signed by the virtual test passkey" };
  });
  let paidId: string | null = null;
  await step("pay", "pay.exec_a", "treasury", "Entity A's payment executed on the rail acting for A's own account (x-on-behalf-of), then settled by the sandbox's simulation", "the transfer created at A's account, followed to PAID", async () => {
    if (!p1) return { outcome: "nothing planned", pass: false };
    const k = await calls(() => withOrigin(approvalOrigin(db, p1!)!, () => executeInvoicePayment(db, a.rail, a.rail, p1!)));
    if (k.error) throw k.error;
    const tr = k.value!.transfer;
    paidId = tr.id;
    return { outcome: `transfer ${tr.id} ${tr.status}; payment ${statusOf(db, p1)}; ${k.calls} calls (${k.endpoints.join(", ")})`, pass: tr.status === "PAID" && statusOf(db, p1) === "EXECUTED", facts: { transfer_id: tr.id, request_id: tr.requestId, status: tr.status, fee: tr.fee ? `${tr.fee.currency} ${fromCents(tr.fee.cents)}` : null, calls: k.endpoints }, simulated: "the settlement to PAID is the sandbox's simulation" };
  });
  await step("pay", "readback.a", null, "Airwallex read back: the transfer at A's account by its id; its request_id at B's account", "PAID at A; no transfer under that request_id at B", async () => {
    if (!p1 || !paidId) return { outcome: "nothing paid", pass: false };
    const t = await a.rail.getTransfer(paidId);
    const rid = termsOf<{ transfer_request_id: string }>(db, p1).transfer_request_id;
    const atB = await d.transferExists("b", rid);
    return { outcome: `${t.id} ${t.status} at A (EUR ${fromCents(t.amountCents)}); at B: ${atB ? "a TRANSFER EXISTS" : "no transfer"}`, pass: t.status === "PAID" && !atB, facts: { transfer_id: t.id, status: t.status, at_b: atB } };
  });
  await step("refuse", "refuse.plan_rail_b", "treasury", "A payment from entity A planned on a rail acting for entity B's account (x-on-behalf-of B)", "refused funding_account_mismatch before any Airwallex call; no proposal", async () => {
    const before = (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'invoice_payment'").get() as { n: number }).n;
    const k = await calls(() => plan(b.rail, "ENT-A-1126-2", "1.01", a.entity.id));
    const after = (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE kind = 'invoice_payment'").get() as { n: number }).n;
    const out = k.value;
    return { outcome: `${out?.kind === "escalated" ? `refused: ${out.reason.slice(0, 220)}` : `NOT refused (${out?.kind ?? k.error?.message})`}; ${k.calls} Airwallex calls`, pass: out?.kind === "escalated" && /^funding_account_mismatch/.test(out.reason) && k.calls === 0 && after === before, facts: { calls: k.calls, reason: out?.kind === "escalated" ? out.reason : null } };
  });
  await step("refuse", "refuse.plan_entity_b", "treasury", "A payment set to fund from entity B (its own account), which the CFO has not opened to the treasury agent", "refused entity_not_permitted before any Airwallex call", async () => {
    const k = await calls(() => plan(b.rail, "ENT-B-1126-1", "1.02", b.entity.id));
    const out = k.value;
    return { outcome: `${out?.kind === "escalated" ? `refused: ${out.reason.slice(0, 220)}` : `NOT refused (${out?.kind ?? k.error?.message})`}; ${k.calls} Airwallex calls`, pass: out?.kind === "escalated" && /^entity_not_permitted/.test(out.reason) && k.calls === 0, facts: { calls: k.calls, reason: out?.kind === "escalated" ? out.reason : null } };
  });
  await step("refuse", "refuse.terms_b", null, "Terms naming entity A but funding it from entity B's account (Purser's entity check, run at planning and again at execution)", "refused funding_account_mismatch", async () => {
    const why = entityRefusal(db, { paying_entity: { id: a.entity.id }, funding_account: { id: b.entity.funding_account } }, "treasury");
    return { outcome: why ? `refused: ${why.slice(0, 220)}` : "NOT refused", pass: !!why && /^funding_account_mismatch/.test(why) };
  });
  let p2: { id: string; rid: string } | null = null;
  await step("refuse", "refuse.exec_rail_b", "treasury", "A second payment from entity A (EUR 1.01, ENT-A-1126-3), planned on A's rail and signed, then executed on the client's default account (entity B's own account)", "refused before any create (no POST): the terms were signed for A's account", async () => {
    const out = await plan(a.rail, "ENT-A-1126-3", "1.01", a.entity.id);
    if (out.kind !== "proposed") return { outcome: `not planned: ${out.reason}`, pass: false };
    const signed = await r.passkeyApprove(out.proposal.proposal_id);
    if (signed.status !== "approved") return { outcome: `not approved: ${signed.status}`, pass: false };
    p2 = { id: out.proposal.proposal_id, rid: termsOf<{ transfer_request_id: string }>(db, out.proposal.proposal_id).transfer_request_id };
    const k = await calls(() => withOrigin(approvalOrigin(db, p2!.id)!, () => executeInvoicePayment(db, b.ownRail, null, p2!.id)));
    return { outcome: `${p2.id} signed; on B's account: ${k.error ? `refused: ${k.error.message.slice(0, 180)}` : "NOT refused"}; ${k.calls} Airwallex calls (${k.posts} POST: ${k.endpoints.join(", ") || "none"}); payment ${statusOf(db, p2.id)}`, pass: !!k.error && /nothing is paid/.test(k.error.message) && k.posts === 0, facts: { proposal_id: p2.id, request_id: p2.rid, calls: k.endpoints, posts: k.posts, payment: statusOf(db, p2.id) }, simulated: "signed by the virtual test passkey" };
  });
  await step("refuse", "readback.none", null, "Airwallex read back by the refused payment's request_id, at A's account and at B's", "no transfer at either", async () => {
    if (!p2) return { outcome: "nothing planned", pass: false };
    const [atA, atB] = [await d.transferExists("a", p2.rid), await d.transferExists("b", p2.rid)];
    return { outcome: `${p2.rid}: at A ${atA ? "a TRANSFER EXISTS" : "no transfer"}, at B ${atB ? "a TRANSFER EXISTS" : "no transfer"}`, pass: !atA && !atB, facts: { at_a: atA, at_b: atB } };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run 4: one failed payout, replaced once.

export async function runReplaceFailed(d: GovDeps & {
  awx: AirwallexRail & SandboxSim & ReplaceRail;
  transferExists: (requestId: string) => Promise<boolean>;
  /** Waits between read-backs while Airwallex has the transfer FAILED and not yet closed (live: real seconds). */
  sleep: (ms: number) => Promise<void>;
}): Promise<GovResults> {
  const { db, awx } = d;
  const r = runner("replace-failed", d);
  const { res, step, calls } = r;
  await r.enrol();
  let pid: string | null = null, rid = "", first = "";
  await step("setup", "setup.payout", "treasury", `A supplier payout planned against the sandbox (EUR 1.02 to ${MANUFACTURER.name}, invoice BTX-GOV-1126-R) and signed with the passkey`, "APPROVED", async () => {
    const ben = await awx.findBeneficiaryByIban(MANUFACTURER.iban);
    if (!ben) return { outcome: `Airwallex holds no beneficiary for ${MANUFACTURER.name}; the run creates none`, pass: false };
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(ben.id, MANUFACTURER.name, MANUFACTURER.iban.slice(-4), ibanSha(MANUFACTURER.iban), MANUFACTURER.bic);
    for (const k of ["eur_floor", "eur_obligations", "usd_floor"] as const) setSetting(db, "treasury", k, "0.00");
    const text = soakInvoiceText("bergtex", "BTX-GOV-1126-R", "1.02");
    const out = await withOrigin(GOV_COMMAND, () => proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text, d.now()));
    if (out.kind !== "proposed") return { outcome: `not planned: ${out.reason}`, pass: false };
    pid = out.proposal.proposal_id;
    const signed = await r.passkeyApprove(pid);
    rid = termsOf<{ transfer_request_id: string }>(db, pid).transfer_request_id;
    return { outcome: `${pid} ${statusOf(db, pid)} (${signed.status}); request_id ${rid}`, pass: statusOf(db, pid) === "APPROVED", facts: { proposal_id: pid, transfer_request_id: rid, beneficiary_id: ben.id, terms_sha256: shaOf(db, pid) }, simulated: "signed by the virtual test passkey" };
  });
  await step("pay", "pay.create", "treasury", "The payment executed (executeInvoicePayment, no settlement simulated)", "a transfer created under the signed request_id", async () => {
    const out = await withOrigin(approvalOrigin(db, pid!)!, () => executeInvoicePayment(db, awx, null, pid!));
    first = out.transfer.id;
    return { outcome: `transfer ${first} ${out.transfer.status}; payment ${statusOf(db, pid!)}`, pass: out.transfer.requestId === rid && !["FAILED", "CANCELLED"].includes(out.transfer.status), facts: { transfer_id: first, status: out.transfer.status } };
  });
  await step("fail", "fail.simulated", null, "The first transfer moved SENT, then FAILED, by the sandbox's simulation endpoint (never PAID)", "Airwallex accepts both transitions", async () => {
    const sent = await awx.transitionTransfer(first, "SENT");
    const failed = await awx.transitionTransfer(first, "FAILED");
    return { outcome: `SENT answered ${sent.status}; FAILED answered ${failed.status}${failed.failureType ? ` (${failed.failureType})` : ""}`, pass: ["FAILED", "CANCELLED"].includes(failed.status), facts: { sent: sent.status, failed: failed.status, failure_type: failed.failureType ?? null }, simulated: "the failure is the sandbox's simulation endpoint" };
  });
  await step("fail", "fail.readback", null, "The first transfer read back at Airwallex (GET /transfers/{id}), again after 20 s while it is FAILED and not yet closed (at most 3 reads)", "CANCELLED with a failure type (final-failed)", async () => {
    let t = await awx.getTransfer(first);
    const reads = [`${t.status}${t.failureType ? ` ${t.failureType}` : ""}`];
    while (t.status === "FAILED" && reads.length < 3) { await d.sleep(20_000); t = await awx.getTransfer(first); reads.push(`${t.status}${t.failureType ? ` ${t.failureType}` : ""}`); }
    return { outcome: `reads: ${reads.join(" -> ")}`, pass: t.status === "CANCELLED" && !!t.failureType, facts: { reads, status: t.status, failure_type: t.failureType ?? null } };
  });
  await step("replace", "replace.off", "treasury", "The runner's replacement hook with KIT11_REPLACE_FAILED_PAYOUT unset (the default)", "no hook: nothing is replaced by code", async () => {
    const hook = replaceFailedHook(db, awx, {});
    return { outcome: hook ? "a hook EXISTS" : "no hook (off)", pass: hook === null };
  });
  let replacement: { id: string; status: string; rid: string } | null = null;
  await step("replace", "replace.once", "treasury", "The runner's replacement hook with KIT11_REPLACE_FAILED_PAYOUT=on, for the failed payment", "replaced once: one new transfer under the request_id derived from the first, same amount, payee and approval hash", async () => {
    const hook = replaceFailedHook(db, awx, { KIT11_REPLACE_FAILED_PAYOUT: "on" });
    if (!hook) return { outcome: "no hook", pass: false };
    const k = await calls(() => hook(pid!));
    if (k.error) throw k.error;
    const row = db.prepare("SELECT request_id, transfer_id, status, amount FROM transfers WHERE replaces_request_id = ?").get(rid) as { request_id: string; transfer_id: string | null; status: string; amount: string } | undefined;
    if (row?.transfer_id) replacement = { id: row.transfer_id, status: row.status, rid: row.request_id };
    const creates = k.endpoints.filter((e) => /^POST (\/transfers\/create|stand-in create(Payout)?Transfer)$/.test(e)).length;
    return { outcome: `${k.value}; replacement ${row?.transfer_id ?? "none"} ${row?.status ?? ""} under ${row?.request_id ?? "-"} (derived from the first: ${row?.request_id === replacementRequestId(rid)}); ${creates} create; calls ${k.endpoints.join(", ")}`, pass: !!row?.transfer_id && row.request_id === replacementRequestId(rid) && row.amount === "1.02" && creates === 1, facts: { outcome: k.value, replacement_request_id: row?.request_id ?? null, replacement_transfer_id: row?.transfer_id ?? null, status: row?.status ?? null, calls: k.endpoints } };
  });
  await step("replace", "replace.settle", null, "The replacement settled by the sandbox's simulation (SENT, PAID) and read back", "PAID", async () => {
    if (!replacement) return { outcome: "no replacement", pass: false };
    let t = await awx.getTransfer(replacement.id);
    for (const to of ["SENT", "PAID"] as const) if (t.status !== to && t.status !== "PAID") t = await awx.transitionTransfer(replacement.id, to);
    const read = await awx.getTransfer(replacement.id);
    return { outcome: `${read.id} ${read.status} (EUR ${fromCents(read.amountCents)})`, pass: read.status === "PAID" && read.amountCents === 102, facts: { transfer_id: read.id, status: read.status }, simulated: "the settlement to PAID is the sandbox's simulation" };
  });
  await step("replace", "replace.again", "treasury", "Asked again: the hook, then replaceFailedPayout directly", "no second send: the hook answers asked before; the direct call finds the replacement (already_replaced); no POST", async () => {
    const hook = replaceFailedHook(db, awx, { KIT11_REPLACE_FAILED_PAYOUT: "on" })!;
    const h = await calls(() => hook(pid!));
    const direct = await calls(() => replaceFailedPayout(db, awx, null, pid!));
    const out = direct.value;
    return { outcome: `hook: ${h.value ?? h.error?.message} (${h.calls} calls); direct: ${out ? out.outcome : direct.error?.message} (${direct.calls} calls, ${direct.posts} POST)`, pass: h.value === "asked before" && h.calls === 0 && out?.outcome === "already_replaced" && direct.posts === 0, facts: { hook: h.value, direct: out ?? null } };
  });
  await step("replace", "readback.both", null, "Airwallex read back by both request_ids (GET /transfers?request_id=…) and both transfers by id", "one transfer under each request_id; the first CANCELLED, the replacement PAID", async () => {
    if (!replacement) return { outcome: "no replacement", pass: false };
    const [a, b] = [await d.transferExists(rid), await d.transferExists(replacement.rid)];
    const t1 = await awx.getTransfer(first);
    const t2 = await awx.getTransfer(replacement.id);
    return { outcome: `${rid}: ${a ? "found" : "NONE"}; ${replacement.rid}: ${b ? "found" : "NONE"}; first ${t1.status}${t1.failureType ? ` ${t1.failureType}` : ""}; replacement ${t2.status}`, pass: a && b && t1.status === "CANCELLED" && t2.status === "PAID", facts: { first: { id: t1.id, status: t1.status, failure_type: t1.failureType ?? null }, replacement: { id: t2.id, status: t2.status } } };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
/** Stand-in lines: each rail call as the live adapter would send it (one HTTP request each), numbered like the drill log. */
export function standInLog() {
  const lines: DrillLine[] = [];
  const note = (method: string, endpoint: string) => { const at = new Date().toISOString(); lines.push({ n: lines.length + 1, pid: process.pid, at, answered_at: at, ms: 0, method, endpoint, status: 200, awx_request_id: null, trace_id: null, code: null }); };
  const POSTS = new Set(["createCard", "createCardholder", "setCardStatus", "setCardLimits", "setCardControls", "simulateCardCharge", "createTransfer", "createPayoutTransfer", "transitionTransfer", "createQuote", "createConversion", "createBeneficiary"]);
  const counted = <T extends object>(o: T): T => new Proxy(o, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r) as unknown;
      if (typeof v !== "function" || typeof p !== "string" || p === "constructor") return v;
      return (...a: unknown[]) => { note(POSTS.has(p) ? "POST" : "GET", `stand-in ${p}`); return (v as (...x: unknown[]) => unknown).apply(t, a); };
    },
  });
  return { lines, counted };
}
