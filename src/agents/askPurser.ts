// Ask Purser (G): a chat message becomes a single-use task card, within rules in code. A model (or the plain parser
// below) reads the message into typed fields; planTask decides. The amount must be written in the message itself, the
// kind must be one Purser makes cards for, and a message with words aimed at the AI is refused whole.

import type { Card, CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import type { Tools } from "../claude/tools.js";
import { audit } from "../audit/log.js";
import { autonomyOn } from "../config/agents.js";
import { AGENT_NAMES, publish, type AgentName } from "../autonomy/bus.js";
import { ASK_AGENT_PER_HOUR, TASK_DEFAULT_DAYS, TASK_KINDS, TASK_LINK_PENDING_MAX, TASK_MAX_DAYS, TASK_WITHIN_PER_DAY } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { moneyIn, writtenAmount } from "../lib/numbers.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { cardOf, ingestCardTransaction, storeCard } from "../policy/cards.js";
import { frozen, policyValue } from "../policy/rules.js";
import { attachReview } from "../claude/review.js";
import type { Actor } from "../audit/log.js";
import { findInjections } from "../policy/injection.js";
import { chargeUnderHold } from "../policy/holds.js";

export type TaskKind = keyof typeof TASK_KINDS;

/** What the message says, as read by the model or the plain parser. Nothing here is trusted. */
export interface TaskReading {
  /** A chat message asks only for travel: the "data" kind is the Sourcing agent's own (D22), never read from words. */
  kind: Exclude<TaskKind, "data"> | "other";
  /** The most the CFO allows, as written ("250.00"), or null if the message names none. */
  amount_eur: string | null;
  purpose: string;
  /** The day the card is for (YYYY-MM-DD), or null. */
  date: string | null;
}

export interface PlannedTask {
  kind: TaskKind;
  label: string;
  mccs: string[];
  amountCents: number;
  /** After this moment Airwallex declines every charge on the card. */
  validUntil: string;
  purpose: string;
}

export type TaskPlan = { ok: true; task: PlannedTask } | { ok: false; reply: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAY_MS = 86_400_000;
const group = (cents: number) => fromCents(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function kindOf(text: string): TaskReading["kind"] {
  if (/\b(flight|fly|plane|airline|air ticket)s?\b/i.test(text)) return "flight";
  if (/\b(hotel|room|nights?|stay)\b/i.test(text)) return "hotel";
  if (/\b(train|rail)\b/i.test(text)) return "train";
  return "other";
}

/** The date a message names: 2026-11-12, "12 November" or "November 12"; a day already past means next year. */
function dateOf(text: string, now: Date): string | null {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const names = MONTHS.map((m) => m.slice(0, 3)).join("|");
  const m = new RegExp(`\\b(\\d{1,2})\\s+(${names})[a-z]*\\b|\\b(${names})[a-z]*\\s+(\\d{1,2})\\b`, "i").exec(text);
  if (!m) return null;
  const day = Number(m[1] ?? m[4]);
  const month = MONTHS.findIndex((x) => x.startsWith(String(m[2] ?? m[3]).toLowerCase().slice(0, 3)));
  if (day < 1 || day > 31) return null;
  let year = now.getUTCFullYear();
  if (Date.UTC(year, month, day) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) year++;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// An amount next to a euro sign or the word EUR/euro; a bare number could be a date, a room or a flight number. Read
// by the one reader for typed numbers (src/lib/numbers.ts).
/** Every amount the message marks as euros, in cents. */
function euroAmountsIn(text: string): number[] {
  return moneyIn(text).flatMap((m) => (m.currency === "EUR" && m.reading.ok ? [m.reading.value] : []));
}

/** The plain parser: what Purser reads without a model, and the fallback when the model fails. */
export function readTaskFallback(text: string, now: Date): TaskReading {
  const cents = euroAmountsIn(text)[0];
  return { kind: kindOf(text), amount_eur: cents === undefined ? null : fromCents(cents), purpose: text, date: dateOf(text, now) };
}

// No markup survives: every < and > goes first (CodeQL: incomplete multi-character sanitization).
const plain = (s: string) => s.replace(/[<>]/g, " ").replace(/[^\p{L}\p{N}\p{P}\p{Zs}€$£]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);

/** What Purser does with a message and its reading: a task card's terms, or a reply saying why not. */
export function planTask(text: string, reading: TaskReading, now: Date): TaskPlan {
  const no = (reply: string): TaskPlan => ({ ok: false, reply });
  const planted = findInjections(text);
  if (planted.length) {
    return no(planted.some((f) => f.kind === "hidden_characters")
      ? "Your message contains hidden characters, so I did not act on it. Please type it again."
      : "Your message contains instructions aimed at the AI (such as \"ignore your rules\" or \"pre-approved\"), so I did not act on it. Limits are set in the CFO policy, not in a message.");
  }
  if (reading.kind === "other" || !(reading.kind in TASK_KINDS)) return no("I can only make task cards for flights, hotels and trains. For anything else, ask the CFO for a change to the policy.");
  const kind = TASK_KINDS[reading.kind];
  if (reading.amount_eur === null) return no(`How much may it cost at most? Write the amount in your message, for example "at most €250".`);
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(reading.amount_eur)) return no(`${reading.amount_eur} is not an amount in euros.`);
  const cents = toCents(reading.amount_eur);
  const written = writtenAmount(text, cents);
  if (!written.ok) return no(written.why ? `${written.why}.` : `${group(cents)} is not an amount in your message, so I did not use it. Write the most it may cost.`);
  if (cents <= 0) return no("The amount must be more than zero.");
  if (cents > kind.maxCents) return no(`A ${kind.label.toLowerCase()} card may be at most ${group(kind.maxCents)} EUR under the CFO policy.`);
  let validUntil: string;
  if (reading.date === null) validUntil = new Date(now.getTime() + TASK_DEFAULT_DAYS * DAY_MS).toISOString();
  else {
    const end = /^\d{4}-\d{2}-\d{2}$/.test(reading.date) ? Date.parse(`${reading.date}T23:59:59.000Z`) : NaN;
    if (!Number.isFinite(end)) return no(`${reading.date} is not a date.`);
    if (end < now.getTime()) return no(`${reading.date} is in the past.`);
    if (end > now.getTime() + TASK_MAX_DAYS * DAY_MS) return no(`A task card can run at most ${TASK_MAX_DAYS} days ahead; ask again closer to the date.`);
    validUntil = new Date(end).toISOString();
  }
  const purpose = plain(reading.purpose) || kind.label;
  return { ok: true, task: { kind: reading.kind, label: kind.label, mccs: [...kind.mccs], amountCents: cents, validUntil, purpose } };
}

/** A task card proposal waits this long for the CFO. */
const TASK_PROPOSAL_TTL_MS = 60 * 60 * 1000;

export type TaskCardTerms = Terms & {
  kind: "task_card";
  task: TaskKind;
  label: string;
  purpose: string;
  merchant_categories: string[];
  amount: string;
  currency: "EUR";
  valid_until: string;
  single_use: true;
  /** The CFO's message, by hash: what the card was asked for, without keeping the words in the terms. */
  message_sha256: string;
  /** Who asked: the CFO at the runner, someone with the dashboard link (the phone or a viewer), or an outside agent. */
  asked_by: AskedBy;
};

/** Where a chat message came from. Only "cfo-at-runner" can be issued within the CFO policy. */
export type AskedBy = "cfo-at-runner" | "dashboard-link" | `ext:${string}` | `agent:${string}`;

/** The Treasury agent proposes the card; nothing is issued before the CFO approves it with Face ID. */
export function proposeTaskCard(db: DB, task: PlannedTask, message: string, now = new Date(), asker?: Actor, askedBy: AskedBy = asker?.startsWith("ext:") ? asker as AskedBy : "dashboard-link"): ProposalRow {
  const terms: TaskCardTerms = {
    schema: TERMS_SCHEMA, kind: "task_card", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + TASK_PROPOSAL_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    task: task.kind, label: task.label, purpose: task.purpose, merchant_categories: task.mccs,
    amount: fromCents(task.amountCents), currency: "EUR", valid_until: task.validUntil, single_use: true,
    message_sha256: sha256Hex(message), asked_by: askedBy,
  };
  return createProposal(db, { terms, createdBy: asker ?? "treasury" }, now);
}

const sameSecond = (a: string | null | undefined, b: string) => !!a && Math.floor(Date.parse(a) / 1000) === Math.floor(Date.parse(b) / 1000);

/** Why the card Airwallex has is not the approved one, or null when it is. */
function differs(card: Card, t: Pick<TaskCardTerms, "amount" | "merchant_categories" | "valid_until">): string | null {
  const cents = toCents(t.amount);
  if (!card.limits || card.limits.perTxCents !== cents || card.limits.monthlyCents !== cents) return `the card at Airwallex has other limits than the approved ${t.amount} EUR`;
  const c = card.controls;
  if (!c?.singleUse) return "the card at Airwallex is not single-use";
  if ([...c.mccs].sort().join(",") !== [...t.merchant_categories].sort().join(",") || c.currencies.join(",") !== "EUR") return "the card at Airwallex allows other merchants or currencies than approved";
  if (!sameSecond(c.activeTo, t.valid_until)) return `the card at Airwallex ends at ${c.activeTo ?? "no date"}, not ${t.valid_until}`;
  return null;
}

/** What a task card is, whether approved by Face ID (a proposal's terms) or issued within the CFO policy. */
type TaskCardSpec = Pick<TaskCardTerms, "task" | "label" | "purpose" | "merchant_categories" | "amount" | "valid_until">;

/**
 * One single-use card at Airwallex with exactly these controls, read back before it counts. A card that comes back
 * different is frozen at once and not recorded. Safe to run again: the card is found by its nickname first. `ref` is
 * the proposal id (P-…) or, within the CFO policy, the task's own id (T-…).
 */
const TASK_HOLDER = "agents+tasks@northwind-outdoor.example";
function taskNickname(db: DB, ref: string, label: string): string {
  const business = db.prepare("SELECT address FROM metal_accounts WHERE role = 'business'").get() as { address: string } | undefined;
  return `task ${ref}: ${label.toLowerCase()}${business ? ` (${business.address.slice(-6).toLowerCase()})` : ""}`;
}
const failTask = (db: DB, taskId: string) => db.prepare("UPDATE task_cards SET status = 'FAILED' WHERE task_id = ? AND status = 'PENDING'").run(taskId);

/**
 * Reserves the task's row (PENDING) before Airwallex is asked, so a number is never used twice. A failed try of an
 * approved proposal is reserved again (the card is then found by its nickname, not issued twice).
 */
function reserveTask(db: DB, ref: string, t: TaskCardSpec, now: Date): void {
  db.prepare(`INSERT INTO task_cards (task_id, proposal_id, kind, purpose, mccs, amount_cents, valid_until, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    ON CONFLICT (task_id) DO UPDATE SET status = 'PENDING', created_at = excluded.created_at WHERE task_cards.status = 'FAILED'`)
    .run(`task:${ref}`, ref, t.task, t.purpose, t.merchant_categories.join(","), toCents(t.amount), t.valid_until, now.toISOString());
}

async function issueTaskCard(db: DB, rail: IssuingRail, ref: string, t: TaskCardSpec, now: Date, how: { within_policy: boolean }): Promise<Card> {
  const taskId = `task:${ref}`;
  const nickname = taskNickname(db, ref, t.label);
  const cents = toCents(t.amount);
  let card: Card;
  try {
    const holder = (await rail.findCardholderByEmail(TASK_HOLDER)) ?? (await rail.createCardholder({ email: TASK_HOLDER, firstName: "Task", lastName: "Cards" }));
    card = (await rail.findCard(holder.id, nickname)) ?? (await rail.createCard({
      cardholderId: holder.id, nickname, createdBy: "Northwind CFO policy", limits: { currency: "EUR", perTxCents: cents, monthlyCents: cents },
      controls: { mccs: t.merchant_categories, currencies: ["EUR"], activeTo: t.valid_until, singleUse: true },
    }));
  } catch (e) {
    failTask(db, taskId);
    throw e;
  }
  const problem = differs(card, t);
  if (problem) {
    await rail.setCardStatus(card.cardId, "INACTIVE");
    failTask(db, taskId);
    audit(db, "awx-executor", "card.frozen", taskId, { agent: taskId, last4: card.last4, why: problem }, now);
    throw new Error(`${problem}; the card is frozen and not used`);
  }
  db.transaction(() => {
    db.prepare("UPDATE task_cards SET status = 'ACTIVE' WHERE task_id = ? AND status = 'PENDING'").run(taskId);
    storeCard(db, taskId, card, now);
    audit(db, "awx-executor", "card.issued", taskId, {
      agent: taskId, last4: card.last4, nickname, limits: `${t.amount} / ${t.amount}`, currency: "EUR", ...(how.within_policy ? { within_policy: true } : { proposal_id: ref }),
      task: t.task, merchant_categories: t.merchant_categories.join(","), valid_until: t.valid_until, single_use: true,
    }, now);
  }).immediate();
  return card;
}

/** After the CFO's approval with Face ID: the approved card, issued and checked by issueTaskCard. */
export async function executeTaskCard(db: DB, rail: IssuingRail, proposalId: string, now = new Date()): Promise<void> {
  const t = beginExecution<TaskCardTerms>(db, proposalId, (terms) => {
    if (terms.kind !== "task_card") throw new Error(`${proposalId} is not a task card`);
    if (db.prepare("SELECT 1 FROM task_cards WHERE task_id = ? AND status != 'FAILED'").get(`task:${proposalId}`)) throw new Error(`${proposalId} already has its card`);
  }, now);
  try {
    reserveTask(db, proposalId, t, now);
    const card = await issueTaskCard(db, rail, proposalId, t, now, { within_policy: false });
    finishExecution(db, proposalId, "EXECUTED", { card_last4: card.last4 }, now);
    // D22: an agent that asked for the card hears that it was issued (autonomy only), and pays on it at its next wake.
    if (autonomyOn() && t.asked_by.startsWith("agent:") && (AGENT_NAMES as string[]).includes(t.asked_by.slice(6))) {
      publish(db, "card.issued", { task_id: `task:${proposalId}`, last4: card.last4, amount: t.amount, currency: t.currency, purpose: t.purpose, valid_until: t.valid_until, single_use: true }, t.asked_by.slice(6) as AgentName, "awx-executor", now);
    }
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now);
    throw e;
  }
}

/** A chat message is at most this long; longer ones are not read. */
export const ASK_MAX_CHARS = 500;

/** Purser's words for who asked, in the Opus review and on the dashboard. */
const ASKED_BY_WORDS = (a: AskedBy) => (a === "cfo-at-runner" ? "The CFO, at the runner," : a === "dashboard-link" ? "Someone with the dashboard link (the CFO's phone, or anyone given the viewer link)" : a.startsWith("agent:") ? `Northwind's ${a.slice(6)} agent` : `An outside agent (${a})`);

/**
 * One chat message to Purser: screened first (planted words never reach a model), read by Sonnet (or the plain
 * parser), checked by planTask. Only the CFO typing at the runner (`from: "runner"`) can get a card issued at once,
 * within the CFO policy: up to approval.task_card_eur, not above the four-eyes threshold, at most
 * TASK_WITHIN_PER_DAY a day, with the amount and date written in the message. Everything else, from the relay (the
 * phone or a viewer link) or an agent (`asker`), becomes a proposal that Opus reviews and the CFO approves with Face
 * ID. A relay ticket is answered once (`ticket`). Returns Purser's reply.
 */
export async function askPurser(
  db: DB, tools: Tools, message: string, now = new Date(),
  opts: { from?: "runner" | "relay"; rail?: IssuingRail | null; asker?: Actor; ticket?: string } = {},
): Promise<{ reply: string; proposalId: string | null; taskId: string | null }> {
  const askedBy: AskedBy = opts.asker?.startsWith("ext:") ? opts.asker as AskedBy : opts.from === "runner" && !opts.asker ? "cfo-at-runner" : "dashboard-link";
  const answer = (reply: string, proposalId: string | null = null, taskId: string | null = null) => {
    audit(db, "treasury", "ask.replied", proposalId ?? taskId ?? "ask", { reply, proposal_id: proposalId, task_id: taskId }, now);
    return { reply, proposalId, taskId };
  };
  const subject = opts.ticket ? `ask:${opts.ticket.slice(0, 80)}` : "ask";
  if (opts.ticket && db.prepare("SELECT 1 FROM audit_log WHERE event = 'ask.received' AND subject = ?").get(subject)) {
    return { reply: "I already answered this message.", proposalId: null, taskId: null };
  }
  const text = message.trim();
  // An outside agent may ask a few times an hour (counted before this one).
  const recent = opts.asker ? (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ask.received' AND actor = ? AND ts > ?")
    .get(opts.asker, new Date(now.getTime() - 3_600_000).toISOString()) as { n: number }).n : 0;
  audit(db, opts.asker ?? "human", "ask.received", subject, { message: text.slice(0, ASK_MAX_CHARS), chars: String(message.length), asked_by: askedBy }, now);
  if (opts.asker && recent >= ASK_AGENT_PER_HOUR) return answer(`Too many requests: an agent may ask ${ASK_AGENT_PER_HOUR} times an hour. Try again later.`);
  if (text === "") return answer("Tell me what you need, for example: \"Book a flight to Berlin on 12 November, at most €250\".");
  if (message.length > ASK_MAX_CHARS) return answer(`Please keep it to ${ASK_MAX_CHARS} characters.`);
  // Words aimed at the AI are refused before any model reads them.
  const screened = planTask(text, { kind: "other", amount_eur: null, purpose: "", date: null }, now);
  if (!screened.ok && /instructions aimed at the AI|hidden characters/.test(screened.reply)) return answer(screened.reply);
  // One waiting request per outside agent, and a few from the dashboard link: no flood of proposals on the phone.
  const waiting = (db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE kind = 'task_card' AND status = 'PENDING_APPROVAL' AND expires_at > ?
    AND json_extract(terms_json, '$.asked_by') = ?`).get(now.toISOString(), askedBy) as { n: number }).n;
  if (askedBy.startsWith("ext:") && waiting >= 1) return answer("Your earlier request is already waiting for the CFO. Wait for that one first.");
  if (askedBy === "dashboard-link" && waiting >= TASK_LINK_PENDING_MAX) return answer(`${waiting} task card requests are already waiting for Face ID. Approve or reject those first.`);
  const reading = await tools.task(text, now);
  const plan = planTask(text, reading.value, now);
  if (!plan.ok) return answer(plan.reply);
  const t = plan.task;
  const spec: TaskCardSpec = { task: t.kind, label: t.label, purpose: t.purpose, merchant_categories: t.mccs, amount: fromCents(t.amountCents), valid_until: t.validUntil };
  if (askedBy === "cfo-at-runner" && opts.rail && withinPolicy(db, text, reading.value, t, now)) {
    const rail = opts.rail;
    // The number and the row first, in one write: a crash after Airwallex answers leaves a PENDING row, never a reused number.
    const ref = db.transaction(() => {
      const last = (db.prepare("SELECT MAX(CAST(substr(task_id, 8) AS INTEGER)) AS n FROM task_cards WHERE task_id LIKE 'task:T-%'").get() as { n: number | null }).n ?? 0;
      const r = `T-${String(last + 1).padStart(4, "0")}`;
      reserveTask(db, r, spec, now);
      return r;
    }).immediate();
    try {
      const card = await issueTaskCard(db, rail, ref, spec, now, { within_policy: true });
      return answer(`Done, within your policy: a single-use ${t.label.toLowerCase()} card •••• ${card.last4}, at most ${spec.amount} EUR, until ${spec.valid_until.slice(0, 10)}. I book it next.`, null, `task:${ref}`);
    } catch (e) {
      return answer(`Airwallex did not issue the card as asked (${(e as Error).message.slice(0, 200)}). Nothing was charged.`);
    }
  }
  const p = proposeTaskCard(db, t, text, now, opts.asker, askedBy);
  await attachReview(db, tools, p, `${ASKED_BY_WORDS(askedBy)} asked in their own words: "${text}"`);
  return answer(`I proposed ${p.proposal_id}: a single-use ${t.label.toLowerCase()} card, at most ${spec.amount} EUR, until ${spec.valid_until.slice(0, 10)}. Approve it with Face ID and I book it.`, p.proposal_id);
}

/**
 * Within the CFO policy, for the CFO at the runner only: not frozen; at most the threshold and not above the four-eyes
 * threshold; fewer than TASK_WITHIN_PER_DAY such cards in 24 hours; the amount written next to € or EUR, and the date,
 * if any, written in the message. Anything else goes to Face ID, where the CFO sees what was read.
 */
function withinPolicy(db: DB, text: string, reading: TaskReading, t: PlannedTask, now: Date): boolean {
  if (frozen(db)) return false;
  if (t.amountCents > toCents(policyValue(db, "approval.task_card_eur") || "0.00")) return false;
  const fourEyes = policyValue(db, "approval.four_eyes_eur");
  if (fourEyes && t.amountCents > toCents(fourEyes)) return false;
  const today = (db.prepare("SELECT COUNT(*) AS n FROM task_cards WHERE task_id LIKE 'task:T-%' AND status != 'FAILED' AND created_at > ?")
    .get(new Date(now.getTime() - DAY_MS).toISOString()) as { n: number }).n;
  if (today >= TASK_WITHIN_PER_DAY) return false;
  if (!euroAmountsIn(text).includes(t.amountCents)) return false;
  return reading.date === null || reading.date === dateOf(text, now);
}

/** The relay's chat (the phone, or anyone with the viewer link): always a proposal, never a card at once. */
export function relayAsk(db: DB, tools: Tools) {
  return (text: string, ticket: string, now = new Date()) => askPurser(db, tools, text, now, { from: "relay", ticket });
}

/**
 * A task card reserved but never finished (the runner stopped between Airwallex and the ledger): after two minutes,
 * any card Airwallex made for it is frozen and the reservation marked failed, so no live card is unknown to the
 * emergency stop. Returns how many reservations it closed.
 */
export async function recoverTaskCards(db: DB, rail: IssuingRail, now = new Date()): Promise<number> {
  const stale = db.prepare("SELECT task_id, proposal_id, kind FROM task_cards WHERE status = 'PENDING' AND created_at < ?")
    .all(new Date(now.getTime() - 120_000).toISOString()) as { task_id: string; proposal_id: string; kind: TaskKind }[];
  for (const r of stale) {
    const holder = await rail.findCardholderByEmail(TASK_HOLDER);
    const card = holder ? await rail.findCard(holder.id, taskNickname(db, r.proposal_id, TASK_KINDS[r.kind].label)) : null;
    if (card && card.status === "ACTIVE") await rail.setCardStatus(card.cardId, "INACTIVE");
    failTask(db, r.task_id);
    audit(db, "awx-executor", "card.frozen", r.task_id, { agent: r.task_id, last4: card?.last4 ?? "", why: "its issue never finished; frozen before use" }, now);
  }
  return stale.length;
}

/**
 * After a task card's one purchase: Airwallex closes a single-use card itself, a moment later (live, 30 October: the
 * card still read ACTIVE, a status update was refused, then it read CLOSED). So freeze it if it is still open, and if
 * Airwallex refuses that, read it again until it is no longer active.
 */
async function closeUsedCard(rail: IssuingRail, cardId: string, waitMs = 1000, tries = 5): Promise<Card> {
  const now = await rail.getCard(cardId);
  if (now.status !== "ACTIVE") return now;
  try {
    return await rail.setCardStatus(cardId, "INACTIVE");
  } catch (e) {
    for (let i = 0; i < tries; i++) {
      const again = await rail.getCard(cardId);
      if (again.status !== "ACTIVE") return again;
      await new Promise((r) => setTimeout(r, waitMs));
    }
    throw e;
  }
}

/**
 * An agent pays on a task card (a sandbox simulation of the merchant's charge); Airwallex approves or declines. After
 * the one approved charge the card is closed: marked used here, and set inactive at Airwallex when `rail` is given
 * (otherwise the runner's next card sync does it).
 */
export async function bookOnTaskCard(db: DB, sim: IssuingSim, taskId: string, a: { merchant: string; amount: string; mcc?: string }, now = new Date(), rail?: IssuingRail): Promise<CardTransaction> {
  const task = db.prepare("SELECT kind, purpose, mccs FROM task_cards WHERE task_id = ?").get(taskId) as { kind: TaskKind; purpose: string; mccs: string } | undefined;
  const card = cardOf(db, taskId);
  if (!task || !card) throw new Error(`no task card ${taskId}`);
  const purpose = `${TASK_KINDS[task.kind].label}: ${task.purpose}`;
  const mcc = a.mcc ?? task.mccs.split(",")[0]!;
  audit(db, "treasury", "card.purchase_started", taskId, { agent: taskId, last4: card.last4, merchant: a.merchant, amount: fromCents(toCents(a.amount)), currency: "EUR", mcc }, now);
  const t = await chargeUnderHold(db, taskId, toCents(a.amount), now, () => sim.simulateCardCharge({ cardId: card.card_id, amountCents: toCents(a.amount), currency: "EUR", merchant: a.merchant, mcc }));
  ingestCardTransaction(db, t, "simulation", now, purpose);
  if (t.approved) {
    db.prepare("UPDATE task_cards SET status = 'USED' WHERE task_id = ?").run(taskId);
    if (rail) {
      // Airwallex closes a single-use card after its one purchase (live, 30 October), and a closed card cannot be set
      // INACTIVE; only a card it left open is frozen here.
      const closed = await closeUsedCard(rail, card.card_id);
      storeCard(db, taskId, closed, now);
      audit(db, "awx-executor", "card.closed", taskId, { agent: taskId, last4: card.last4, why: closed.status === "INACTIVE" ? "its one purchase is made; frozen by Purser" : "its one purchase is made; closed by Airwallex" }, now);
    }
  }
  return t;
}
