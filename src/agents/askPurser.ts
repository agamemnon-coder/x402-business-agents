// Ask Purser (G): a chat message becomes a single-use task card, within rules in code. A model (or the plain parser
// below) reads the message into typed fields; planTask decides. The amount must be written in the message itself, the
// kind must be one Purser makes cards for, and a message with words aimed at the AI is refused whole.

import type { Card, CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";
import type { Tools } from "../claude/tools.js";
import { audit } from "../audit/log.js";
import { TASK_DEFAULT_DAYS, TASK_KINDS, TASK_MAX_DAYS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { beginExecution, createProposal, finishExecution, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { cardOf, ingestCardTransaction, storeCard } from "../policy/cards.js";
import { frozen, policyValue } from "../policy/rules.js";
import { attachReview } from "../claude/review.js";
import type { Actor } from "../audit/log.js";
import { amountsIn } from "../policy/fromText.js";
import { findInjections } from "../policy/injection.js";

export type TaskKind = keyof typeof TASK_KINDS;

/** What the message says, as read by the model or the plain parser. Nothing here is trusted. */
export interface TaskReading {
  kind: TaskKind | "other";
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

function kindOf(text: string): TaskKind | "other" {
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

/** The plain parser: what Purser reads without a model, and the fallback when the model fails. */
export function readTaskFallback(text: string, now: Date): TaskReading {
  // An amount next to a euro sign or the word EUR/euro; a bare number could be a date or a flight number.
  const m = /€\s*(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s*(?:€|eur\b|euros?\b)/i.exec(text);
  const cents = m ? amountsIn(m[1] ?? m[2] ?? "")[0] : undefined;
  return { kind: kindOf(text), amount_eur: cents === undefined ? null : fromCents(cents), purpose: text, date: dateOf(text, now) };
}

const plain = (s: string) => s.replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\p{P}\p{Zs}€$£]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);

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
  if (!/^\d+\.\d{2}$/.test(reading.amount_eur)) return no(`${reading.amount_eur} is not an amount in euros.`);
  const cents = Math.round(Number(reading.amount_eur) * 100);
  if (!amountsIn(text).includes(cents)) return no(`${group(cents)} is not an amount in your message, so I did not use it. Write the most it may cost.`);
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
};

/** The Finance agent proposes the card; nothing is issued before the CFO approves it with Face ID. */
export function proposeTaskCard(db: DB, task: PlannedTask, message: string, now = new Date(), asker?: Actor): ProposalRow {
  const terms: TaskCardTerms = {
    schema: TERMS_SCHEMA, kind: "task_card", proposal_id: nextProposalId(db),
    expires_at: new Date(now.getTime() + TASK_PROPOSAL_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
    task: task.kind, label: task.label, purpose: task.purpose, merchant_categories: task.mccs,
    amount: fromCents(task.amountCents), currency: "EUR", valid_until: task.validUntil, single_use: true,
    message_sha256: sha256Hex(message),
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
async function issueTaskCard(db: DB, rail: IssuingRail, ref: string, t: TaskCardSpec, now: Date, how: { within_policy: boolean }): Promise<Card> {
  const taskId = `task:${ref}`;
  const email = "agents+tasks@northwind-outdoor.example";
  const holder = (await rail.findCardholderByEmail(email)) ?? (await rail.createCardholder({ email, firstName: "Task", lastName: "Cards" }));
  const business = db.prepare("SELECT address FROM metal_accounts WHERE role = 'business'").get() as { address: string } | undefined;
  const nickname = `task ${ref}: ${t.label.toLowerCase()}${business ? ` (${business.address.slice(-6).toLowerCase()})` : ""}`;
  const cents = toCents(t.amount);
  const card = (await rail.findCard(holder.id, nickname)) ?? (await rail.createCard({
    cardholderId: holder.id, nickname, createdBy: "Northwind CFO policy", limits: { currency: "EUR", perTxCents: cents, monthlyCents: cents },
    controls: { mccs: t.merchant_categories, currencies: ["EUR"], activeTo: t.valid_until, singleUse: true },
  }));
  const problem = differs(card, t);
  if (problem) {
    await rail.setCardStatus(card.cardId, "INACTIVE");
    audit(db, "awx-executor", "card.frozen", taskId, { agent: taskId, last4: card.last4, why: problem }, now);
    throw new Error(`${problem}; the card is frozen and not used`);
  }
  db.transaction(() => {
    db.prepare("INSERT INTO task_cards (task_id, proposal_id, kind, purpose, mccs, amount_cents, valid_until, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)")
      .run(taskId, ref, t.task, t.purpose, t.merchant_categories.join(","), cents, t.valid_until, now.toISOString());
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
    if (db.prepare("SELECT 1 FROM task_cards WHERE task_id = ?").get(`task:${proposalId}`)) throw new Error(`${proposalId} already has its card`);
  }, now);
  try {
    const card = await issueTaskCard(db, rail, proposalId, t, now, { within_policy: false });
    finishExecution(db, proposalId, "EXECUTED", { card_last4: card.last4 }, now);
  } catch (e) {
    finishExecution(db, proposalId, "FAILED", { error: (e as Error).message.slice(0, 300) }, now);
    throw e;
  }
}

/** A chat message is at most this long; longer ones are not read. */
export const ASK_MAX_CHARS = 500;

/**
 * One chat message to Purser: screened first (planted words never reach a model), read by Sonnet (or the plain
 * parser), checked by planTask. From the CFO, a card up to the policy's threshold (approval.task_card_eur) is issued
 * at once when Airwallex is reachable; anything else, and anything an agent asks for (`asker`), becomes a proposal
 * that Opus reviews and the CFO approves with Face ID. Returns Purser's reply.
 */
export async function askPurser(
  db: DB, tools: Tools, message: string, now = new Date(), opts: { rail?: IssuingRail | null; asker?: Actor } = {},
): Promise<{ reply: string; proposalId: string | null; taskId: string | null }> {
  const answer = (reply: string, proposalId: string | null = null, taskId: string | null = null) => {
    audit(db, "treasury", "ask.replied", proposalId ?? taskId ?? "ask", { reply, proposal_id: proposalId, task_id: taskId }, now);
    return { reply, proposalId, taskId };
  };
  const text = message.trim();
  audit(db, opts.asker ?? "human", "ask.received", "ask", { message: text.slice(0, ASK_MAX_CHARS), chars: String(message.length) }, now);
  if (text === "") return answer("Tell me what you need, for example: \"Book a flight to Berlin on 12 November, at most €250\".");
  if (message.length > ASK_MAX_CHARS) return answer(`Please keep it to ${ASK_MAX_CHARS} characters.`);
  // Words aimed at the AI are refused before any model reads them.
  const screened = planTask(text, { kind: "other", amount_eur: null, purpose: "", date: null }, now);
  if (!screened.ok && /instructions aimed at the AI|hidden characters/.test(screened.reply)) return answer(screened.reply);
  const reading = await tools.task(text, now);
  const plan = planTask(text, reading.value, now);
  if (!plan.ok) return answer(plan.reply);
  const t = plan.task;
  const spec: TaskCardSpec = { task: t.kind, label: t.label, purpose: t.purpose, merchant_categories: t.mccs, amount: fromCents(t.amountCents), valid_until: t.validUntil };
  const within = !opts.asker && !!opts.rail && !frozen(db) && t.amountCents <= toCents(policyValue(db, "approval.task_card_eur") || "0.00");
  if (within && opts.rail) {
    const ref = `T-${String((db.prepare("SELECT COUNT(*) AS n FROM task_cards WHERE task_id LIKE 'task:T-%'").get() as { n: number }).n + 1).padStart(4, "0")}`;
    try {
      const card = await issueTaskCard(db, opts.rail, ref, spec, now, { within_policy: true });
      return answer(`Done, within your policy: a single-use ${t.label.toLowerCase()} card •••• ${card.last4}, at most ${spec.amount} EUR, until ${spec.valid_until.slice(0, 10)}. I book it next.`, null, `task:${ref}`);
    } catch (e) {
      return answer(`Airwallex did not issue the card as asked (${(e as Error).message.slice(0, 200)}). Nothing was charged.`);
    }
  }
  const p = proposeTaskCard(db, t, text, now, opts.asker);
  await attachReview(db, tools, p, `${opts.asker ? `An agent (${opts.asker})` : "The CFO"} asked in their own words: "${text}"`);
  return answer(`I proposed ${p.proposal_id}: a single-use ${t.label.toLowerCase()} card, at most ${spec.amount} EUR, until ${spec.valid_until.slice(0, 10)}. Approve it with Face ID and I book it.`, p.proposal_id);
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
  const t = await sim.simulateCardCharge({ cardId: card.card_id, amountCents: toCents(a.amount), currency: "EUR", merchant: a.merchant, mcc });
  ingestCardTransaction(db, t, "simulation", now, purpose);
  if (t.approved) {
    db.prepare("UPDATE task_cards SET status = 'USED' WHERE task_id = ?").run(taskId);
    if (rail) {
      const closed = await rail.setCardStatus(card.card_id, "INACTIVE");
      storeCard(db, taskId, closed, now);
      audit(db, "awx-executor", "card.closed", taskId, { agent: taskId, last4: card.last4, why: "its one purchase is made" }, now);
    }
  }
  return t;
}
