// "Try Purser": anyone types a task and watches Purser handle it, in a demo world. Claude models read the words
// (Haiku sorts the request, Sonnet reads it into fields); code checks every field against a fixed CFO policy and
// decides. Nothing here calls Airwallex or Alta and no money exists: the cards and payments are simulated, and every
// answer says so. The engine is pure (the models come in as functions), so the relay Worker, npm run judge and the
// tests run the same code. It imports nothing that needs a ledger.

import { TASK_KINDS } from "../config/policy.js";
import { findInjections } from "../policy/injection.js";
import { moneyIn, numberTokens, readAllIn, readNumber, writtenAmount, centsWritten } from "../lib/numbers.js";

export const TRY_MAX_CHARS = 280;

/** What Haiku says the request is. */
export type Intent = "flight" | "hotel" | "train" | "software" | "supplier_payment" | "api_data" | "purchase" | "unclear";
/** What Sonnet reads from it. Nothing here is trusted: code checks each field against the words typed. */
export interface Reading {
  item: string; merchant: string | null; amount: string | null; currency: "EUR" | "USD" | "OTHER" | null; date: string | null; payee: string | null;
  /** How many, if the request says (a model's reading; code only uses it when the number is in the message). */
  quantity?: number | null;
  /** The model's view that the amount is per item ("€40 each"); code also looks for the words itself. */
  per_unit?: boolean | null;
}

const PER_UNIT = /\b(each|apiece|a piece|per (seat|licen[cs]e|user|item|unit|piece|card|ticket|night|person|room|copy))\b|\/(seat|user|item|night)\b/i;
const TOTAL = /\b(at most|max(imum)?|in total|total|up to|budget|no more than)\b/i;

/** Plural words after a number that are not things bought ("in 3 minutes", "5 times"). */
const NOT_ITEMS = /^(seconds|secs|minutes|mins|hours|hrs|days|weeks|months|years|times|percent|tonnes|tons|kilos|kgs|metres|meters|kms|miles|lbs)$/i;
/** "3 x", "x 2,500", or a number right before a plural ("4 gift cards", "2.500 SKUs", "3 nights"); the number is group 1, 2 or 3. */
const COUNTED = /(?<![\w.,€$/:-])(\d[\d.,]*\d|\d)\s*(?:x|×)\s|(?:^|[\s(,])(?:x\s+|×\s*)(\d[\d.,]*\d|\d)(?!\w|[.,]\d)|(?<![\w.,€$/:-])(\d[\d.,]*\d|\d)\s+((?:[a-z-]+\s+){0,2}?)([a-z]+s)\b/gi;

/** The most a model's count is taken for, as the model's own schema check (src/try/claude.ts) allows: defence in depth. */
const MODEL_COUNT_MAX = 10_000;

/** A count the message writes: a whole number, none, or the reason the number written cannot be one ("2,5 checks"). */
export type Count = { n: number } | { n: null; why: string } | null;

/**
 * How many the message itself says: the model's count when that number is written in the message as a count,
 * otherwise a number written right before a plural ("4 gift cards", "2.500 SKUs") or with an x ("3 x", "x 2,500").
 * Read by the one reader (src/lib/numbers.ts): a count is whole, so "2.500 SKUs" is 2,500. Never a count the person did
 * not write, and never the number of a time ("in 3 minutes").
 */
export function countIn(text: string, modelSays?: number | null): Count {
  const counts = readAllIn(text, "count");
  const notTime = (end: number) => !NOT_ITEMS.test(/^\s*([a-z]+)/i.exec(text.slice(end))?.[1] ?? "");
  if (typeof modelSays === "number" && Number.isInteger(modelSays) && modelSays > 1 && modelSays < MODEL_COUNT_MAX && counts.some((t) => t.currency === null && t.reading.ok && t.reading.value === modelSays && notTime(t.end))) return { n: modelSays };
  for (const m of text.matchAll(COUNTED)) {
    if (m[5] && NOT_ITEMS.test(m[5])) continue;
    const raw = (m[1] ?? m[2] ?? m[3])!;
    const r = readNumber(raw, "count");
    if (!r.ok) return { n: null, why: r.why };
    if (r.value > 1) return { n: r.value };
  }
  return null;
}

/** One model call, as the engine reports it. */
export interface ModelCall<T> { value: T; model: string; ms: number; costUsd: number }
export interface TryModels {
  classify(text: string): Promise<ModelCall<Intent>>;
  read(text: string, intent: Intent): Promise<ModelCall<Reading>>;
}

export interface TryStep { by: string; title: string; detail: string; ms?: number; costUsd?: number; tone?: "ok" | "bad" | "wait" | "info" }
export type Outcome = "paid" | "face_id" | "refused" | "blocked" | "question";
/** Where the money would move: an Airwallex company card, an Airwallex single-use task card, an Airwallex SWIFT payout, or Alta. */
export type Rail = "card" | "task_card" | "swift" | "metal" | null;
/** Which flow from the recorded live run this one is (the page shows that run's proof). */
export type Live = "card_approved" | "card_declined" | "task_card" | "swift" | "x402" | "chain_refused" | "planted" | null;
export interface TryResult {
  outcome: Outcome;
  headline: string;
  detail: string;
  /** The simulated card the task would get, when one is issued. */
  card: { label: string; last4: string; limit: string; only: string; until: string | null } | null;
  steps: TryStep[];
  costUsd: number;
  /** A second request in the message that was not handled, named so it is never dropped silently; null when none. */
  not_done: string | null;
  /** "claude" when the models read it; "plain" when code read it alone (no key here, or today's budget is spent). */
  mode: "claude" | "plain";
  rail: Rail;
  live: Live;
}

/**
 * The demo world: a fixed copy of Northwind Outdoor's CFO policy, and a short catalog so a request without a price can
 * still be shown. Everything in it is labelled demo; none of it is a live price or a live account. Its card limit (€50 a
 * software purchase) is the demo's own: in the main run (3 Nov) the Sourcing card was €30, raised to €46 with Face ID,
 * and the page says so.
 */
export const DEMO_WORLD = {
  company: "Northwind Outdoor (demo world)",
  softwareCard: { agent: "Sourcing agent", perTxCents: 5_000, monthlyLeftCents: 10_000, only: "software" },
  taskCardAutoCents: 30_000,
  /** The sourcing agent's mandate on Alta, as in the recorded run: 0.04 a payment, 12.00 in total, 1.20 used. */
  metal: { agent: "Sourcing agent", payee: "Stockline", capCents: 4, budgetLeftCents: 1_080, priceCents: 4, unit: "stock check" },
  fourEyesCents: 1_000_000,
  eurFreeCents: 150_000,
  suppliers: ["Bergtex Textil GmbH", "Stockline"],
  catalog: [
    { match: /\bcanva\b/i, item: "Canva Pro, one month", cents: 1_199 },
    { match: /\bfigma\b/i, item: "Figma Professional, one month", cents: 1_500 },
    { match: /\bnotion\b/i, item: "Notion Plus, one month", cents: 1_000 },
    { match: /\bslack\b/i, item: "Slack Pro, one month", cents: 875 },
    { match: /\bps5\b|playstation/i, item: "PlayStation 5", cents: 54_999 },
    { match: /\biphone\b/i, item: "iPhone", cents: 99_900 },
  ],
} as const;

const DAY = 86_400_000;
const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every number the text writes, in cents, read by the one reader (src/lib/numbers.ts): "1.180", "1,180.50", "€12,99". */
export function centsIn(text: string): number[] {
  return centsWritten(text).filter((c) => c > 0);
}

/** Sorting and reading by code alone: the fallback when no model may be asked. */
export const plainModels: TryModels = {
  async classify(text) {
    const t = text.toLowerCase();
    const value: Intent = /\b(flight|fly|plane|airline)s?\b/.test(t) ? "flight" : /\b(hotel|room|nights?)\b/.test(t) ? "hotel" : /\b(train|rail)\b/.test(t) ? "train"
      : /\b(stock checks?|api calls?|per request|data feed|stockline)\b/.test(t) ? "api_data"
      : /\b(supplier|invoice|manufacturer|vendor|pay (our|the))\b/.test(t) ? "supplier_payment"
      : /\b(subscription|software|licen[cs]e|saas|pro plan|canva|figma|notion|slack)\b/.test(t) ? "software"
      : /\b(buy|order|purchase|get)\b/.test(t) ? "purchase" : "unclear";
    return { value, model: "code", ms: 0, costUsd: 0 };
  },
  async read(text, intent) {
    // Euros, as the demo world's policy is set; a price per request (Alta) in USD, or written with two decimals.
    const m = intent === "api_data" ? numberTokens(text).find((t) => t.currency === "USD" || (t.currency === null && /[.,]\d{2}$/.test(t.raw))) : numberTokens(text).find((t) => t.currency === "EUR");
    const date = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1] ?? null;
    return { value: { item: text.slice(0, 80), merchant: null, amount: m ? m.raw : null, currency: m ? (intent === "api_data" ? "USD" : "EUR") : null, date, payee: null }, model: "code", ms: 0, costUsd: 0 };
  },
};

const ACTION = /\b(buy|pay|renew|book|order|purchase|subscribe|run|get|reserve)\b/i;
/** Words that start another request: "Also renew Notion", ", then book a hotel", "as well as". */
const ALSO = /(?:[.;!?]+\s+|,\s*|\s+)(?=(?:and\s+)?(?:also|additionally|in addition|as well as)\b)|(?:[.;!?]+\s+|,\s*)(?=(?:and\s+)?(?:plus|then|after that)\b)|\s+and\s+(?=then\b)/gi;
/** A verb that starts another request, after one that already asked for something: "Book a flight. Book a hotel too." */
const NEXT_VERB = /(?:[.;!?]+\s+|,\s*(?:and\s+)?|\s+and\s+)(?=(?:please\s+)?(?:buy|renew|book|order|purchase|subscribe|reserve)\b)|[.;!?]+\s+(?=(?:please\s+)?(?:pay|run)\b(?!\s+(?:at most|up to|max|no more than|less than|with|by|using|it|that|for it)\b))/gi;

/**
 * One request at a time: the first request in the message, and the rest when the message asks for something more
 * ("Figma seat 49,99 EUR. Also renew Notion at 1.050,00 EUR"). The rest is never dropped silently: the answer names it
 * as not done. Code splits it, so the models read only the request that is handled.
 */
export function splitRequests(text: string): { first: string; rest: string | null } {
  const cuts = [...[...text.matchAll(ALSO)].map((m) => ({ m, verb: false })), ...[...text.matchAll(NEXT_VERB)].map((m) => ({ m, verb: true }))].sort((a, b) => a.m.index - b.m.index);
  for (const { m, verb } of cuts) {
    const before = text.slice(0, m.index);
    const rest = text.slice(m.index + m[0].length).trim();
    if (!/\p{L}/u.test(before) || !/\p{L}{2}/u.test(rest) || (verb && !ACTION.test(before))) continue;
    return { first: (before + (/^[.!?]+/.exec(m[0])?.[0] ?? "")).trim(), rest };
  }
  return { first: text, rest: null };
}

/** The amounts a message names as money: a number with a currency sign or code, or with exactly two decimals. */
function amountsNamed(text: string) {
  return moneyIn(text).filter((m) => m.currency !== null || /[.,]\d{2}$/.test(m.raw));
}
const money = (cents: number, currency: "EUR" | "USD" | null) => (currency === "USD" ? `$${(cents / 100).toFixed(2)}` : eur(cents));
const listed = (xs: string[]) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The amount a model (or the plain reader) read, checked against the words typed: the number must be written in the
 * message, and it is read there, in its context (src/lib/numbers.ts), never from the model's copy alone. A number
 * that is ambiguous or would need rounding comes back with the reason.
 */
function amountWritten(text: string, written: string): { cents: number } | { why: string } | null {
  const raw = numberTokens(written)[0]?.raw;
  if (raw === undefined) return null;
  const there = moneyIn(text).find((m) => m.raw === raw);
  if (there) return there.reading.ok ? { cents: there.reading.value } : { why: there.reading.why };
  const alone = readNumber(written, "money");
  if (!alone.ok) return { why: alone.why };
  const w = writtenAmount(text, alone.value);
  return w.ok ? { cents: alone.value } : w.why ? { why: w.why } : null;
}

const ZERO = "The amount must be more than zero";
/** An amount read from the message, refused when it is zero: nothing is bought or paid for €0. */
function amountWrittenAboveZero(text: string, written: string): { cents: number } | { why: string } | null {
  const r = amountWritten(text, written);
  return r && "cents" in r && r.cents <= 0 ? { why: `${written} is zero. ${ZERO}` } : r;
}

/** Handles one request in the demo world. `now` fixes the clock (for dates); `models` are Claude, or code alone. */
export async function tryPurser(input: string, models: TryModels, now: Date, mode: "claude" | "plain" = "claude"): Promise<TryResult> {
  const whole = input.replace(/\r/g, "").trim().slice(0, TRY_MAX_CHARS);
  const steps: TryStep[] = [];
  let cost = 0;
  let rail: Rail = null;
  let live: Live = null;
  let notDone: string | null = null;
  const done = (outcome: Outcome, headline: string, detail: string, card: TryResult["card"] = null): TryResult => ({
    outcome, headline, detail: notDone ? `${detail} Not done: "${notDone}". Try handles one request at a time; send it as its own try.` : detail,
    card, steps, costUsd: Math.round(cost * 1e6) / 1e6, mode, rail, live, not_done: notDone,
  });

  // 1. Code first: a line aimed at the AI stops the request before any model reads it.
  const planted = findInjections(whole);
  if (planted.length) {
    steps.push({ by: "code", title: "Checked for instructions aimed at the AI", detail: `Found: "${planted[0]!.excerpt.slice(0, 90)}". Limits come from the CFO policy, never from a message, so no model was asked and nothing was planned.`, tone: "bad" });
    live = "planted";
    return done("blocked", "Trick blocked", "The message tries to instruct the AI. Purser ignores it: only the CFO policy sets what an agent may do, and only Face ID changes it.");
  }
  steps.push({ by: "code", title: "Checked for instructions aimed at the AI", detail: "None found.", tone: "ok" });

  // 2. One request at a time, with one amount: code finds a second request, and names it as not done.
  const { first: text, rest } = splitRequests(whole);
  if (rest) {
    notDone = rest;
    steps.push({ by: "code", title: "Found more than one request", detail: `Try handles one request at a time. Handled: "${text}". Not done: "${rest}".`, tone: "bad" });
  }
  const named = amountsNamed(text);
  const unreadable = named.find((m) => !m.reading.ok);
  if (unreadable && !unreadable.reading.ok) {
    steps.push({ by: "code", title: "Checked the amount", detail: `${unreadable.reading.why}.`, tone: "bad" });
    return done("question", "Which amount?", `${unreadable.reading.why}. Nothing was done.`);
  }
  const amounts = [...new Map(named.map((m) => [m.reading.ok ? m.reading.value : -1, m.currency])).entries()];
  if (amounts.some(([c]) => c <= 0)) {
    steps.push({ by: "code", title: "Checked the amount", detail: `The message names an amount of zero. ${ZERO}.`, tone: "bad" });
    return done("question", "How much may it cost?", `${ZERO}: nothing is bought or paid for ${money(0, amounts.find(([c]) => c <= 0)![1])}. Nothing was done.`);
  }
  if (amounts.length > 1) {
    const shown = listed(amounts.map(([c, cur]) => money(c, cur)));
    steps.push({ by: "code", title: "Checked the amount", detail: `The message names more than one amount: ${shown}.`, tone: "bad" });
    return done("question", "Which amount?", `The message names more than one amount (${shown}). Try handles one request with one amount at a time, so nothing was done. Write the one amount it may cost, or send each as its own try.`);
  }
  const items = DEMO_WORLD.catalog.map((x) => ({ x, at: x.match.exec(text)?.index ?? -1 })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  const travel = /\b(flight|hotel|train)s?\s+(?:and|&|\+|plus)\s+(?:an?\s+|the\s+)?(flight|hotel|train)s?\b/i.exec(text);
  if (items.length > 1 || (travel && travel[1]!.toLowerCase() !== travel[2]!.toLowerCase())) {
    const what = items.length > 1 ? listed(items.map((h) => h.x.item)) : `a ${travel![1]!.toLowerCase()} and a ${travel![2]!.toLowerCase()}`;
    steps.push({ by: "code", title: "Found more than one request", detail: `The message asks for ${what}.`, tone: "bad" });
    return done("question", "One at a time", `The message asks for ${what}. Try handles one request at a time, so nothing was done. Send each as its own try.`);
  }

  // 3. Haiku sorts the request; 4. Sonnet reads it into fields.
  const c = await models.classify(text);
  cost += c.costUsd;
  const KIND: Record<Intent, string> = { flight: "a flight", hotel: "a hotel", train: "a train", software: "software", supplier_payment: "a supplier payment", api_data: "data, paid per request", purchase: "a purchase", unclear: "unclear" };
  steps.push({ by: c.model, title: "Sorted the request", detail: `Kind: ${KIND[c.value]}.`, ms: c.ms, costUsd: c.costUsd });
  if (c.value === "unclear") return done("question", "What should Purser do?", "Ask for something an agent can buy or pay: a flight, a hotel, a train, software, or a supplier's invoice, with the most it may cost.");
  const r = await models.read(text, c.value);
  cost += r.costUsd;
  const f = r.value;
  steps.push({ by: r.model, title: "Read the request", detail: [f.item && `item: ${f.item}`, f.merchant && `from: ${f.merchant}`, f.payee && `pay to: ${f.payee}`, f.amount && `amount: ${f.amount} ${f.currency ?? ""}`.trim(), f.date && `date: ${f.date}`].filter(Boolean).join(" · ") || "no fields", ms: r.ms, costUsd: r.costUsd });

  // 5. Code checks the amount against the words typed: a model cannot add a number the CFO did not write, and a number
  // is read where it is written, by the one reader (src/lib/numbers.ts).
  const read = f.amount !== null ? amountWrittenAboveZero(text, f.amount) : null;
  if (read && "why" in read) {
    steps.push({ by: "code", title: "Checked the amount", detail: `${read.why}.`, tone: "bad" });
    return done("question", "Which amount?", `${read.why}. Nothing was done.`);
  }
  if (f.amount !== null && read === null) steps.push({ by: "code", title: "Checked the amount", detail: `${f.amount} is not a number in the message, so it was not used.`, tone: "bad" });
  if (read && amounts.length === 1 && amounts[0]![0] !== read.cents) {
    const shown = listed([money(read.cents, null), money(amounts[0]![0], amounts[0]![1])]);
    steps.push({ by: "code", title: "Checked the amount", detail: `The message names more than one amount: ${shown}.`, tone: "bad" });
    return done("question", "Which amount?", `The message names more than one amount (${shown}). Try handles one request with one amount at a time, so nothing was done. Write the one amount it may cost.`);
  }

  // Pay per request on Alta: the sourcing agent's mandate, checked here as the chain checks it.
  if (c.value === "api_data") return metalRequest(text, f, read?.cents ?? null, steps, (o, h, d) => { rail = "metal"; live = o === "paid" ? "x402" : h === "Refused by the chain" ? "chain_refused" : null; return done(o, h, d); });

  let cents: number | null = read ? read.cents : null;
  let priced = "";
  if (cents !== null && f.currency && f.currency !== "EUR") {
    steps.push({ by: "code", title: "Checked the currency", detail: `Northwind's policy is set in euros; ${f.currency} needs a quote first.`, tone: "bad" });
    return done("question", "Ask in euros", "Write the most it may cost in euros, for example \"at most €250\".");
  }
  if (cents === null) {
    const hit = items[0]?.x;
    if (hit) { cents = hit.cents; priced = ` (demo catalog price for ${hit.item})`; }
  }
  // How many: code multiplies a price per item by a count written in the message, and asks when it cannot tell.
  const count = countIn(text, f.quantity);
  const qty = count?.n ?? null;
  const perUnit = PER_UNIT.test(text) || (f.per_unit === true && qty !== null);
  if (cents !== null && !TOTAL.test(text)) {
    const fromCatalog = priced !== "";
    if (count && count.n === null && (perUnit || fromCatalog)) {
      steps.push({ by: "code", title: "Checked the amount", detail: `${count.why}.`, tone: "bad" });
      return done("question", "How many?", `${count.why}. Write how many as a whole number, for example "Buy 3 seats at €40 each".`);
    }
    if (perUnit && qty === null) {
      steps.push({ by: "code", title: "Checked the amount", detail: `${eur(cents)} each, but the message does not say how many.`, tone: "bad" });
      return done("question", "How many?", `${eur(cents)} is a price per item. Write how many, for example "Buy 3 seats at €40 each", so code can work out the total.`);
    }
    if (qty !== null && (perUnit || fromCatalog)) {
      const unit = cents;
      cents = unit * qty;
      steps.push({ by: "code", title: "Checked the amount", detail: `${qty} × ${eur(unit)} = ${eur(cents)}${priced || ", as written in the message"}.`, tone: "ok" });
    } else if (qty !== null) {
      steps.push({ by: "code", title: "Checked the amount", detail: `${qty} items and ${eur(cents)}: the message does not say whether that is the total or the price of each.`, tone: "bad" });
      return done("question", `${eur(cents)} in total, or each?`, `Write "at most ${eur(cents)} in total" or "${eur(cents)} each", so code can work out what may be spent.`);
    } else steps.push({ by: "code", title: "Checked the amount", detail: `${eur(cents)}${priced || ", as written in the message"}.`, tone: "ok" });
  } else if (cents !== null) steps.push({ by: "code", title: "Checked the amount", detail: `${eur(cents)}${priced || ", as written in the message"}.`, tone: "ok" });

  const policy = (detail: string, tone: TryStep["tone"]) => steps.push({ by: "code", title: "Checked the CFO policy", detail, tone });
  const last4 = (s: string) => String(1000 + ([...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 9000));

  // 5. The CFO policy decides, by kind.
  if (c.value === "flight" || c.value === "hotel" || c.value === "train") {
    const kind = TASK_KINDS[c.value];
    if (cents === null) return done("question", "How much may it cost?", `Write the most the ${kind.label.toLowerCase()} may cost, for example "at most €250".`);
    if (cents > kind.maxCents) { policy(`A ${kind.label.toLowerCase()} card may be at most ${eur(kind.maxCents)}.`, "bad"); return done("refused", "Refused by the policy", `${eur(cents)} is above the most a ${kind.label.toLowerCase()} card may hold (${eur(kind.maxCents)}). The CFO would have to change the policy first.`); }
    const date = f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && text.includes(f.date.slice(8).replace(/^0/, "")) ? f.date : null;
    const until = date ?? new Date(now.getTime() + 7 * DAY).toISOString().slice(0, 10);
    const card = { label: `${kind.label} · single use`, last4: last4(text), limit: eur(cents), only: `${kind.label.toLowerCase()} merchants only (MCC ${kind.mccs.join(", ")})`, until };
    if (cents > DEMO_WORLD.taskCardAutoCents) {
      policy(`Task cards up to ${eur(DEMO_WORLD.taskCardAutoCents)} are issued without Face ID; this one is above it.`, "wait");
      rail = "task_card"; live = "task_card";
      return done("face_id", "Would ask the CFO for Face ID", `A single-use ${kind.label.toLowerCase()} card for ${eur(cents)} needs the CFO's approval. The phone would show these exact terms; Face ID signs their hash.`, card);
    }
    policy(`Within the policy: up to ${eur(DEMO_WORLD.taskCardAutoCents)} needs no Face ID; ${kind.label.toLowerCase()} merchants only; valid until ${until}.`, "ok");
    steps.push({ by: "demo world", title: "Issued a single-use card", detail: `Simulated: in the live system Airwallex Issuing creates it. One purchase up to ${eur(cents)} goes through; the card then closes itself.`, tone: "ok" });
    rail = "task_card"; live = "task_card";
    return done("paid", "Card issued, within the limit", `A single-use ${kind.label.toLowerCase()} card for at most ${eur(cents)}, ${kind.label.toLowerCase()} merchants only, until ${until}. No one had to approve it: it is inside the CFO policy.`, card);
  }

  if (c.value === "software") {
    const s = DEMO_WORLD.softwareCard;
    if (cents === null) return done("question", "How much does it cost?", "Write the price, for example \"Buy Figma Pro for €15\".");
    const card = { label: `${s.agent} · company card`, last4: "8120", limit: `${eur(s.perTxCents)} a purchase`, only: "software merchants only", until: null };
    if (cents > s.perTxCents || cents > s.monthlyLeftCents) {
      policy(`The ${s.agent.toLowerCase()}'s card allows ${eur(s.perTxCents)} a purchase; ${eur(cents)} is above it.`, "wait");
      steps.push({ by: "demo world", title: "Tried the card", detail: "Simulated: Airwallex would decline it (over the card's limit). The agent then asks the CFO for a higher limit.", tone: "bad" });
      rail = "card"; live = "card_declined";
      return done("face_id", "Declined by the card, then would ask the CFO for Face ID", `${eur(cents)} is over the card's ${eur(s.perTxCents)} limit, so the bank declines it. The agent asks for a raise; only the CFO's Face ID can give it.`, card);
    }
    policy(`Within the ${s.agent.toLowerCase()}'s card: ${eur(s.perTxCents)} a purchase, software only.`, "ok");
    steps.push({ by: "demo world", title: "Paid with the agent's card", detail: `Simulated: Airwallex approves ${eur(cents)}${f.merchant ? ` at ${f.merchant}` : ""}, inside the limits set on the card.`, tone: "ok" });
    rail = "card"; live = "card_approved";
    return done("paid", "Paid, within the limit", `${eur(cents)}${priced ? priced : ""} on the ${s.agent.toLowerCase()}'s own card. No one had to approve it: the bank enforces the limit the CFO set.`, card);
  }

  if (c.value === "supplier_payment") {
    if (cents === null) return done("question", "How much should be paid?", "Write the invoice amount, for example \"Pay our supplier €1,180\".");
    const named = f.payee && !/^(our|the|a)?\s*(supplier|manufacturer|vendor)s?$/i.test(f.payee.trim()) ? f.payee.trim() : null;
    const payee = named ?? DEMO_WORLD.suppliers[0];
    if (named && !DEMO_WORLD.suppliers.some((s) => s.toLowerCase() === named.toLowerCase())) {
      policy(`${named} is not on the allowlist of suppliers (${DEMO_WORLD.suppliers.join(", ")}).`, "bad");
      return done("refused", "Blocked: unknown payee", `Purser pays suppliers only to accounts on file. ${named} would first have to be added, with the CFO's Face ID; nothing is paid before.`);
    }
    const shortfall = Math.max(0, cents - DEMO_WORLD.eurFreeCents);
    policy(`${payee} is on file. Every bank transfer needs the CFO's Face ID${cents > DEMO_WORLD.fourEyesCents ? `, and above ${eur(DEMO_WORLD.fourEyesCents)} a second person too` : ""}.${shortfall ? ` Free euros: ${eur(DEMO_WORLD.eurFreeCents)}; only the missing ${eur(shortfall)} would be converted, on a locked Airwallex quote.` : " The euros are there; nothing needs converting."}`, "wait");
    rail = "swift"; live = "swift";
    return done("face_id", "Would ask the CFO for Face ID", `A SWIFT transfer of ${eur(cents)} to ${payee}. The CFO approves the exact amount, payee, rate and the most the fee may be; then Airwallex pays it.`);
  }

  // A purchase no agent's card is for: each card only pays its own kind of merchant, so Airwallex would decline it.
  rail = "card"; live = "card_declined";
  policy("No agent has a card for this: the sourcing agent buys warehouse and data software, the support agent helpdesk software, the treasury agent bookkeeping.", "bad");
  return done("refused", "Refused by the policy", `${cents !== null ? `${eur(cents)}${priced} for ` : ""}${f.item || "this purchase"} is not something any agent may buy. The CFO would have to change the policy first; a message cannot.`);
}

/**
 * Claude when it may be asked (a key on the server and budget left today), code alone otherwise; when a model call
 * fails, the request is handled again by code alone and the page says so.
 */
export async function tryPurserSafely(input: string, models: TryModels | null, now: Date, why = "no model is configured here"): Promise<TryResult> {
  if (models) {
    try {
      return await tryPurser(input, models, now, "claude");
    } catch (e) {
      why = `the model could not be reached (${e instanceof Error ? e.message : "error"})`;
    }
  }
  const r = await tryPurser(input, plainModels, now, "plain");
  r.steps.unshift({ by: "code", title: "Read by code alone", detail: `Claude was not asked: ${why}. The policy check is the same either way.`, tone: "info" });
  return r;
}

const usdz = (cents: number) => `${(cents / 100).toFixed(2)} test USD`;

/**
 * A request to pay for data per request (x402 on Alta), under the sourcing agent's mandate: one payee (Stockline),
 * at most the mandate's cap a payment, inside what is left of its budget. These are the checks Alta itself makes on
 * chain; here code makes them on the demo world's copy of the mandate.
 */
function metalRequest(text: string, f: Reading, written: number | null, steps: TryStep[], done: (o: Outcome, h: string, d: string) => TryResult): TryResult {
  const m = DEMO_WORLD.metal;
  const payee = f.merchant ?? f.payee;
  if (payee && !new RegExp(`\\b${m.payee}\\b`, "i").test(payee)) {
    steps.push({ by: "code", title: "Checked the mandate", detail: `The ${m.agent.toLowerCase()}'s mandate pays ${m.payee} only; ${payee} is not it.`, tone: "bad" });
    return done("refused", "Refused: not the mandate's payee", `The mandate on Alta pays one payee, ${m.payee}. A payment to ${payee} would be refused on chain; the CFO would have to approve a new mandate first.`);
  }
  if (f.currency === "EUR") {
    steps.push({ by: "code", title: "Checked the amount", detail: "Alta mandates pay in test USD, not euros.", tone: "bad" });
    return done("question", "Ask in test USD", `Write the price per request in USD, for example "${m.unit}s at $0.04 each".`);
  }
  // The price per request: as written in the message (code checks it is there), or Stockline's price.
  const unit = written ?? m.priceCents;
  const counted = countIn(text, f.quantity);
  if (counted && counted.n === null) {
    steps.push({ by: "code", title: "Checked the amount", detail: `${counted.why}.`, tone: "bad" });
    return done("question", "How many?", `${counted.why}. Write how many ${m.unit}s as a whole number, for example "25 ${m.unit}s".`);
  }
  const count = counted?.n ?? 1;
  const total = unit * count;
  steps.push({ by: "code", title: "Checked the amount", detail: `${count > 1 ? `${count} × ${usdz(unit)} = ` : ""}${usdz(total)}${written === unit ? ", as written in the message" : ` (${m.payee}'s price per request)`}.`, tone: "ok" });
  const rule = `The ${m.agent.toLowerCase()}'s mandate: at most ${usdz(m.capCents)} a payment, ${usdz(m.budgetLeftCents)} left of its budget, ${m.payee} only.`;
  if (unit > m.capCents) {
    steps.push({ by: "code", title: "Checked the mandate", detail: `${rule} ${usdz(unit)} a request is over the cap.`, tone: "bad" });
    return done("refused", "Refused by the chain", `Each request would cost ${usdz(unit)}, over the mandate's ${usdz(m.capCents)} a payment, so Alta refuses it on chain and nothing moves. The agent asks the CFO; a new mandate needs Face ID.`);
  }
  if (total > m.budgetLeftCents) {
    steps.push({ by: "code", title: "Checked the mandate", detail: `${rule} ${usdz(total)} in all is more than is left.`, tone: "bad" });
    return done("refused", "Refused: over the mandate's budget", `${usdz(total)} is more than the ${usdz(m.budgetLeftCents)} left under the mandate; the payments past it would be refused on chain.`);
  }
  steps.push({ by: "code", title: "Checked the mandate", detail: `${rule} Inside it.`, tone: "ok" });
  steps.push({ by: "demo world", title: "Paid per request on Alta", detail: `Simulated: in the live system each request is an x402 payment of ${usdz(unit)}, signed under the mandate and settled by Alta's facilitator.`, tone: "ok" });
  return done("paid", "Paid per request, inside the mandate", `${count} payment${count > 1 ? "s" : ""} of ${usdz(unit)} to ${m.payee}, ${usdz(total)} in all. No one had to approve them: the mandate on chain sets the limit, and the chain enforces it.`);
}
