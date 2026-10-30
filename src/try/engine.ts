// "Try Purser": anyone types a task and watches Purser handle it, in a demo world. Claude models read the words
// (Haiku sorts the request, Sonnet reads it into fields); code checks every field against a fixed CFO policy and
// decides. Nothing here calls Airwallex or Metal and no money exists: the cards and payments are simulated, and every
// answer says so. The engine is pure (the models come in as functions), so the relay Worker, npm run judge and the
// tests run the same code. It imports nothing that needs a ledger.

import { TASK_KINDS } from "../config/policy.js";
import { findInjections } from "../policy/injection.js";

export const TRY_MAX_CHARS = 280;

/** What Haiku says the request is. */
export type Intent = "flight" | "hotel" | "train" | "software" | "supplier_payment" | "purchase" | "unclear";
/** What Sonnet reads from it. Nothing here is trusted: code checks each field against the words typed. */
export interface Reading { item: string; merchant: string | null; amount: string | null; currency: "EUR" | "USD" | "OTHER" | null; date: string | null; payee: string | null }

/** One model call, as the engine reports it. */
export interface ModelCall<T> { value: T; model: string; ms: number; costUsd: number }
export interface TryModels {
  classify(text: string): Promise<ModelCall<Intent>>;
  read(text: string, intent: Intent): Promise<ModelCall<Reading>>;
}

export interface TryStep { by: string; title: string; detail: string; ms?: number; costUsd?: number; tone?: "ok" | "bad" | "wait" | "info" }
export type Outcome = "paid" | "face_id" | "refused" | "blocked" | "question";
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
}

/**
 * The demo world: Northwind Outdoor's CFO policy, as in the recorded runs, and a short catalog so a request without a
 * price can still be shown. Everything in it is labelled demo; none of it is a live price or a live account.
 */
export const DEMO_WORLD = {
  company: "Northwind Outdoor (demo world)",
  softwareCard: { agent: "Operations agent", perTxCents: 5_000, monthlyLeftCents: 10_000, only: "software" },
  taskCardAutoCents: 30_000,
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
  const done = (outcome: Outcome, headline: string, detail: string, card: TryResult["card"] = null): TryResult =>
    ({ outcome, headline, detail, card, steps, costUsd: Math.round(cost * 1e6) / 1e6, mode });

  // 1. Code first: a line aimed at the AI stops the request before any model reads it.
  const planted = findInjections(text);
  if (planted.length) {
    steps.push({ by: "code", title: "Checked for instructions aimed at the AI", detail: `Found: "${planted[0]!.excerpt.slice(0, 90)}". Limits come from the CFO policy, never from a message, so no model was asked and nothing was planned.`, tone: "bad" });
    return done("blocked", "AI trick blocked", "The message tries to instruct the AI. Purser ignores it: only the CFO policy sets what an agent may do, and only Face ID changes it.");
  }
  steps.push({ by: "code", title: "Checked for instructions aimed at the AI", detail: "None found.", tone: "ok" });

  // 2. Haiku sorts the request; 3. Sonnet reads it into fields.
  const c = await models.classify(text);
  cost += c.costUsd;
  steps.push({ by: c.model, title: "Sorted the request", detail: `Kind: ${c.value.replace(/_/g, " ")}.`, ms: c.ms, costUsd: c.costUsd });
  if (c.value === "unclear") return done("question", "What should Purser do?", "Ask for something an agent can buy or pay: a flight, a hotel, a train, software, or a supplier's invoice, with the most it may cost.");
  const r = await models.read(text, c.value);
  cost += r.costUsd;
  const f = r.value;
  steps.push({ by: r.model, title: "Read the request", detail: [f.item && `item: ${f.item}`, f.merchant && `from: ${f.merchant}`, f.payee && `pay to: ${f.payee}`, f.amount && `amount: ${f.amount} ${f.currency ?? ""}`.trim(), f.date && `date: ${f.date}`].filter(Boolean).join(" · ") || "no fields", ms: r.ms, costUsd: r.costUsd });

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
  if (cents !== null) steps.push({ by: "code", title: "Checked the amount", detail: `${eur(cents)}${priced || ", as written in the message"}.`, tone: "ok" });

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
      return done("face_id", "Would ask the CFO for Face ID", `A single-use ${kind.label.toLowerCase()} card for ${eur(cents)} needs the CFO's approval. The phone would show these exact terms; Face ID signs their hash.`, card);
    }
    policy(`Within the policy: up to ${eur(DEMO_WORLD.taskCardAutoCents)} needs no Face ID; ${kind.label.toLowerCase()} merchants only; valid until ${until}.`, "ok");
    steps.push({ by: "demo world", title: "Issued a single-use card", detail: `Simulated: in the live system Airwallex Issuing creates it. One purchase up to ${eur(cents)} goes through; the card then closes itself.`, tone: "ok" });
    return done("paid", "Card issued, within the limit", `A single-use ${kind.label.toLowerCase()} card for at most ${eur(cents)}, ${kind.label.toLowerCase()} merchants only, until ${until}. No one had to approve it: it is inside the CFO policy.`, card);
  }

  if (c.value === "software") {
    const s = DEMO_WORLD.softwareCard;
    if (cents === null) return done("question", "How much does it cost?", "Write the price, for example \"Buy Figma Pro for €15\".");
    const card = { label: `${s.agent} · company card`, last4: "8120", limit: `${eur(s.perTxCents)} a purchase`, only: "software merchants only", until: null };
    if (cents > s.perTxCents || cents > s.monthlyLeftCents) {
      policy(`The ${s.agent.toLowerCase()}'s card allows ${eur(s.perTxCents)} a purchase; ${eur(cents)} is above it.`, "wait");
      steps.push({ by: "demo world", title: "Tried the card", detail: "Simulated: Airwallex would decline it (over the card's limit). The agent then asks the CFO for a higher limit.", tone: "bad" });
      return done("face_id", "Declined by the card, then would ask the CFO for Face ID", `${eur(cents)} is over the card's ${eur(s.perTxCents)} limit, so the bank declines it. The agent asks for a raise; only the CFO's Face ID can give it.`, card);
    }
    policy(`Within the ${s.agent.toLowerCase()}'s card: ${eur(s.perTxCents)} a purchase, software only.`, "ok");
    steps.push({ by: "demo world", title: "Paid with the agent's card", detail: `Simulated: Airwallex approves ${eur(cents)}${f.merchant ? ` at ${f.merchant}` : ""}, inside the limits set on the card.`, tone: "ok" });
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
    return done("face_id", "Would ask the CFO for Face ID", `A SWIFT transfer of ${eur(cents)} to ${payee}. The CFO approves the exact amount, payee, rate and the most the fee may be; then Airwallex pays it.`);
  }

  // A purchase no agent's card is for.
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
