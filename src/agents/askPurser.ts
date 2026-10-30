// Ask Purser (G): a chat message becomes a single-use task card, within rules in code. A model (or the plain parser
// below) reads the message into typed fields; planTask decides. The amount must be written in the message itself, the
// kind must be one Purser makes cards for, and a message with words aimed at the AI is refused whole.

import { TASK_DEFAULT_DAYS, TASK_KINDS, TASK_MAX_DAYS } from "../config/policy.js";
import { fromCents } from "../lib/money.js";
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
