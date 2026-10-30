// "Try Purser": anyone types a task and watches Purser handle it, in a demo world. Claude models read the words
// (Haiku sorts the request, Sonnet reads it into fields); code checks every field against a fixed CFO policy and
// decides. Nothing here calls Airwallex or Metal and no money exists: the cards and payments are simulated, and every
// answer says so. The engine is pure (the models come in as functions), so the relay Worker, npm run judge and the
// tests run the same code. It imports nothing that needs a ledger.

import { TASK_KINDS } from "../config/policy.js";
import { findInjections } from "../policy/injection.js";

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

/**
 * How many the message itself says: the model's count when that number is written in the message, otherwise a number
 * written right before a plural ("4 gift cards", "3 nights") or "3 x". Never a count the person did not write.
 */
export function quantityIn(text: string, modelSays?: number | null): number | null {
  const written = (n: number) => new RegExp(`(^|[^\\d.,])${n}([^\\d.,]|$)`).test(text);
  if (typeof modelSays === "number" && Number.isInteger(modelSays) && modelSays > 1 && modelSays < 10_000 && written(modelSays)) return modelSays;
  const m = /\b(\d{1,4})\s*(?:x|×)\s|\b(\d{1,4})\s+(?:[a-z]+\s+){0,2}?[a-z]+s\b/i.exec(text);
  const n = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isInteger(n) && n > 1 ? n : null;
}

/** One model call, as the engine reports it. */
export interface ModelCall<T> { value: T; model: string; ms: number; costUsd: number }
export interface TryModels {
  classify(text: string): Promise<ModelCall<Intent>>;
  read(text: string, intent: Intent): Promise<ModelCall<Reading>>;
}

export interface TryStep { by: string; title: string; detail: string; ms?: number; costUsd?: number; tone?: "ok" | "bad" | "wait" | "info" }
export type Outcome = "paid" | "face_id" | "refused" | "blocked" | "question";
/** Where the money would move: an Airwallex company card, an Airwallex single-use task card, an Airwallex SWIFT payout, or Metal. */
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
  /** "claude" when the models read it; "plain" when code read it alone (no key here, or today's budget is spent). */
  mode: "claude" | "plain";
  rail: Rail;
  live: Live;
}

/**
 * The demo world: Northwind Outdoor's CFO policy, as in the recorded runs, and a short catalog so a request without a
 * price can still be shown. Everything in it is labelled demo; none of it is a live price or a live account.
 */
export const DEMO_WORLD = {
  company: "Northwind Outdoor (demo world)",
  softwareCard: { agent: "Operations agent", perTxCents: 5_000, monthlyLeftCents: 10_000, only: "software" },
  taskCardAutoCents: 30_000,
  /** The operations agent's mandate on Metal, as in the recorded run: 0.04 a payment, 12.00 in total, 1.20 used. */
  metal: { agent: "Operations agent", payee: "Stockline", capCents: 4, budgetLeftCents: 1_080, priceCents: 4, unit: "stock check" },
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

/** Every number the text writes, in cents, with "1.180" and "1,180.50" read the way people write them. */
export function centsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d.,]*\d|\d/g)) {
    let t = m[0];
    const lastSep = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    // A last separator followed by exactly two digits is the decimal point; any other separator groups thousands.
    if (lastSep >= 0 && t.length - lastSep - 1 === 2) t = t.slice(0, lastSep).replace(/[.,]/g, "") + "." + t.slice(lastSep + 1);
    else t = t.replace(/[.,]/g, "");
    const v = Math.round(Number(t) * 100);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
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
  async read(text) {
    const m = /€\s*(\d[\d.,]*\d|\d)|(\d[\d.,]*\d|\d)\s*(?:€|eur\b|euros?\b)/i.exec(text);
    const date = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1] ?? null;
    return { value: { item: text.slice(0, 80), merchant: null, amount: m ? (m[1] ?? m[2])! : null, currency: m ? "EUR" : null, date, payee: null }, model: "code", ms: 0, costUsd: 0 };
  },
};

/** Handles one request in the demo world. `now` fixes the clock (for dates); `models` are Claude, or code alone. */
export async function tryPurser(input: string, models: TryModels, now: Date, mode: "claude" | "plain" = "claude"): Promise<TryResult> {
  const text = input.replace(/\r/g, "").trim().slice(0, TRY_MAX_CHARS);
  const steps: TryStep[] = [];
  let cost = 0;
  let rail: Rail = null;
  let live: Live = null;
  const done = (outcome: Outcome, headline: string, detail: string, card: TryResult["card"] = null): TryResult =>
    ({ outcome, headline, detail, card, steps, costUsd: Math.round(cost * 1e6) / 1e6, mode, rail, live });

  // 1. Code first: a line aimed at the AI stops the request before any model reads it.
  const planted = findInjections(text);
  if (planted.length) {
    steps.push({ by: "code", title: "Checked for instructions aimed at the AI", detail: `Found: "${planted[0]!.excerpt.slice(0, 90)}". Limits come from the CFO policy, never from a message, so no model was asked and nothing was planned.`, tone: "bad" });
    live = "planted";
    return done("blocked", "Trick blocked", "The message tries to instruct the AI. Purser ignores it: only the CFO policy sets what an agent may do, and only Face ID changes it.");
  }
  steps.push({ by: "code", title: "Checked for instructions aimed at the AI", detail: "None found.", tone: "ok" });

  // 2. Haiku sorts the request; 3. Sonnet reads it into fields.
  const c = await models.classify(text);
  cost += c.costUsd;
  const KIND: Record<Intent, string> = { flight: "a flight", hotel: "a hotel", train: "a train", software: "software", supplier_payment: "a supplier payment", api_data: "data, paid per request", purchase: "a purchase", unclear: "unclear" };
  steps.push({ by: c.model, title: "Sorted the request", detail: `Kind: ${KIND[c.value]}.`, ms: c.ms, costUsd: c.costUsd });
  if (c.value === "unclear") return done("question", "What should Purser do?", "Ask for something an agent can buy or pay: a flight, a hotel, a train, software, or a supplier's invoice, with the most it may cost.");
  const r = await models.read(text, c.value);
  cost += r.costUsd;
  const f = r.value;
  steps.push({ by: r.model, title: "Read the request", detail: [f.item && `item: ${f.item}`, f.merchant && `from: ${f.merchant}`, f.payee && `pay to: ${f.payee}`, f.amount && `amount: ${f.amount} ${f.currency ?? ""}`.trim(), f.date && `date: ${f.date}`].filter(Boolean).join(" · ") || "no fields", ms: r.ms, costUsd: r.costUsd });

  // Pay per request on Metal: the operations agent's mandate, checked here as the chain checks it.
  if (c.value === "api_data") return metalRequest(text, f, steps, (o, h, d) => { rail = "metal"; live = o === "paid" ? "x402" : h === "Refused by the chain" ? "chain_refused" : null; return done(o, h, d); });

  // 4. Code checks the amount against the words typed: a model cannot add a number the CFO did not write.
  let cents: number | null = null;
  let priced = "";
  if (f.amount !== null) {
    const v = centsIn(f.amount)[0];
    if (v !== undefined && centsIn(text).includes(v)) cents = v;
    else steps.push({ by: "code", title: "Checked the amount", detail: `${f.amount} is not a number in the message, so it was not used.`, tone: "bad" });
  }
  if (cents !== null && f.currency && f.currency !== "EUR") {
    steps.push({ by: "code", title: "Checked the currency", detail: `Northwind's policy is set in euros; ${f.currency} needs a quote first.`, tone: "bad" });
    return done("question", "Ask in euros", "Write the most it may cost in euros, for example \"at most €250\".");
  }
  if (cents === null) {
    const hit = DEMO_WORLD.catalog.find((x) => x.match.test(text));
    if (hit) { cents = hit.cents; priced = ` (demo catalog price for ${hit.item})`; }
  }
  // How many: code multiplies a price per item by a count written in the message, and asks when it cannot tell.
  const qty = quantityIn(text, f.quantity);
  const perUnit = PER_UNIT.test(text) || (f.per_unit === true && qty !== null);
  if (cents !== null && !TOTAL.test(text)) {
    const fromCatalog = priced !== "";
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
  policy("No agent has a card for this: the operations agent buys software, the sales agent ads, the finance agent bookkeeping.", "bad");
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
 * A request to pay for data per request (x402 on Metal), under the operations agent's mandate: one payee (Stockline),
 * at most the mandate's cap a payment, inside what is left of its budget. These are the checks Metal itself makes on
 * chain; here code makes them on the demo world's copy of the mandate.
 */
function metalRequest(text: string, f: Reading, steps: TryStep[], done: (o: Outcome, h: string, d: string) => TryResult): TryResult {
  const m = DEMO_WORLD.metal;
  const payee = f.merchant ?? f.payee;
  if (payee && !new RegExp(`\\b${m.payee}\\b`, "i").test(payee)) {
    steps.push({ by: "code", title: "Checked the mandate", detail: `The ${m.agent.toLowerCase()}'s mandate pays ${m.payee} only; ${payee} is not it.`, tone: "bad" });
    return done("refused", "Refused: not the mandate's payee", `The mandate on Metal pays one payee, ${m.payee}. A payment to ${payee} would be refused on chain; the CFO would have to approve a new mandate first.`);
  }
  if (f.currency === "EUR") {
    steps.push({ by: "code", title: "Checked the amount", detail: "Metal mandates pay in test USD, not euros.", tone: "bad" });
    return done("question", "Ask in test USD", `Write the price per request in USD, for example "${m.unit}s at $0.04 each".`);
  }
  // The price per request: as written in the message (code checks it is there), or Stockline's price.
  const written = f.amount !== null ? centsIn(f.amount)[0] : undefined;
  const unit = written !== undefined && centsIn(text).includes(written) ? written : m.priceCents;
  const count = quantityIn(text, f.quantity) ?? 1;
  const total = unit * count;
  steps.push({ by: "code", title: "Checked the amount", detail: `${count > 1 ? `${count} × ${usdz(unit)} = ` : ""}${usdz(total)}${written === unit ? ", as written in the message" : ` (${m.payee}'s price per request)`}.`, tone: "ok" });
  const rule = `The ${m.agent.toLowerCase()}'s mandate: at most ${usdz(m.capCents)} a payment, ${usdz(m.budgetLeftCents)} left of its budget, ${m.payee} only.`;
  if (unit > m.capCents) {
    steps.push({ by: "code", title: "Checked the mandate", detail: `${rule} ${usdz(unit)} a request is over the cap.`, tone: "bad" });
    return done("refused", "Refused by the chain", `Each request would cost ${usdz(unit)}, over the mandate's ${usdz(m.capCents)} a payment, so Metal refuses it on chain and nothing moves. The agent asks the CFO; a new mandate needs Face ID.`);
  }
  if (total > m.budgetLeftCents) {
    steps.push({ by: "code", title: "Checked the mandate", detail: `${rule} ${usdz(total)} in all is more than is left.`, tone: "bad" });
    return done("refused", "Refused: over the mandate's budget", `${usdz(total)} is more than the ${usdz(m.budgetLeftCents)} left under the mandate; the payments past it would be refused on chain.`);
  }
  steps.push({ by: "code", title: "Checked the mandate", detail: `${rule} Inside it.`, tone: "ok" });
  steps.push({ by: "demo world", title: "Paid per request on Metal", detail: `Simulated: in the live system each request is an x402 payment of ${usdz(unit)}, signed under the mandate and settled by Metal's facilitator.`, tone: "ok" });
  return done("paid", "Paid per request, inside the mandate", `${count} payment${count > 1 ? "s" : ""} of ${usdz(unit)} to ${m.payee}, ${usdz(total)} in all. No one had to approve them: the mandate on chain sets the limit, and the chain enforces it.`);
}
