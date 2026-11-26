// Card hours and card controls as CFO policy (Airwallex Agentic Banking governance: "budget limits, permitted
// currencies, merchant category codes, and time windows" per agent card). Pure: no database, no Node modules, so the
// runner's loosens() (src/policy/loosens.ts) and the Worker can import it.
//
// card.<agent>.hours: when the agent's card may pay, e.g. "Mon-Fri 08:00-18:00 Europe/Amsterdam"; "" for any time.
// THIS IS NOT AN AIRWALLEX CONTROL. Airwallex Issuing's authorization controls (docs and API reference read 26
// November 2026: https://www.airwallex.com/docs/issuing/card-controls/authorization-controls and
// https://www.airwallex.com/docs/api/issuing/cards/create) are allowed_transaction_count (SINGLE / MULTIPLE),
// transaction_limits, allowed_merchant_categories, allowed_currencies, allowed_merchant_countries,
// blocked_transaction_usages and an activity period, active_from / active_to (one start and one end), plus
// alert_settings and remote authorization (Airwallex asks the customer's own endpoint, 2.5 s to answer; Purser does not
// run one). None is a recurring time of day or day of week. Purser uses the native ones where they fit (limits,
// categories, currencies, active_to on every card; SINGLE and active_to on task cards) and enforces the hours itself
// (src/policy/cardHoursGate.ts): no purchase Purser starts outside them (refused before anything reaches Airwallex),
// no purchase window opened on the card, and a card thawed for a purchase is frozen at Airwallex (card_status
// INACTIVE, the Issuing card update the card sync already uses) when the hours end. A merchant charging the card by
// itself outside the hours meets that frozen card and Airwallex declines it (CARD_INACTIVE): the decline is
// Airwallex's, the hours behind it are Purser's.
//
// card.<agent>.mccs / .currencies: the merchant categories and currencies the card may pay. These ARE Airwallex
// controls (allowed_merchant_categories, allowed_currencies): the card sync pushes them to the card and Airwallex
// declines the rest (src/policy/cards.ts).
//
// Loosening any of them (wider hours, a new merchant category or currency) is a policy change the CFO signs with the
// passkey, checked again when it reaches the card (src/policy/cardRaise.ts); tightening takes effect at once.

/** Sun = 0 ... Sat = 6, as Date.getUTCDay counts. */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** The order a range of days runs in: Monday first, so "Sat-Sun" is the weekend. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export interface CardHours {
  /** The days the card may pay, Sun = 0 ... Sat = 6, sorted. */
  days: number[];
  /** Minutes after local midnight: from (inclusive) to (exclusive), within one day. */
  startMin: number;
  endMin: number;
  /** An IANA time zone, e.g. Europe/Amsterdam. */
  tz: string;
}

/** Every reading error names what was wrong and the form the hours take. */
const bad = (what: string) => new Error(`card hours: ${what}; write e.g. "Mon-Fri 08:00-18:00 Europe/Amsterdam" (empty: any time)`);

function dayIndex(name: string): number {
  const i = DAY_NAMES.findIndex((d) => d.toLowerCase() === name.toLowerCase());
  if (i < 0) throw bad(`no day ${name}`);
  return i;
}

function minutes(hh: string, mm: string): number {
  const [h, m] = [Number(hh), Number(mm)];
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) throw bad(`no time ${hh}:${mm}`);
  return h * 60 + m;
}

const knownZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The hours in `s`, or null for "" (any time). Throws, saying why, on anything else. */
export function parseCardHours(s: string): CardHours | null {
  const v = s.trim().replace(/\s+/g, " ");
  if (v === "") return null;
  const m = /^([A-Za-z]{3}(?:-[A-Za-z]{3})?(?:,[A-Za-z]{3}(?:-[A-Za-z]{3})?)*) (\d{2}):(\d{2})-(\d{2}):(\d{2}) ([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*)$/.exec(v);
  if (!m) throw bad("not readable");
  const days = new Set<number>();
  for (const part of m[1]!.split(",")) {
    const [a, b] = part.split("-");
    if (b === undefined) { days.add(dayIndex(a!)); continue; }
    const [from, to] = [WEEK.indexOf(dayIndex(a!)), WEEK.indexOf(dayIndex(b))];
    if (from > to) throw bad(`${part} runs backwards (Mon to Sun)`);
    for (let i = from; i <= to; i++) days.add(WEEK[i]!);
  }
  const startMin = minutes(m[2]!, m[3]!), endMin = minutes(m[4]!, m[5]!);
  if (startMin >= 24 * 60 || endMin <= startMin) throw bad("the time range must run forward within one day");
  if (!knownZone(m[6]!)) throw bad(`${m[6]} is no IANA time zone`);
  return { days: [...days].sort((x, y) => x - y), startMin, endMin, tz: m[6]! };
}

/** Why `s` cannot be a card's hours, or null when it can. */
export function cardHoursProblem(s: string): string | null {
  try {
    parseCardHours(s);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** The day of the week (Sun = 0) and the minute of the day at `at`, in time zone `tz`. */
export function localMoment(at: Date, tz: string): { day: number; minute: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
  return { day: dayIndex(parts.weekday!), minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

/** Whether a card with these hours may pay at `at`; no hours (null) is any time. */
export function withinCardHours(h: CardHours | null, at: Date): boolean {
  if (!h) return true;
  const { day, minute } = localMoment(at, h.tz);
  return h.days.includes(day) && minute >= h.startMin && minute < h.endMin;
}

/** "Thu 07:59 Europe/Amsterdam": the moment as the card's hours read it. */
export function localWords(at: Date, tz: string): string {
  const { day, minute } = localMoment(at, tz);
  return `${DAY_NAMES[day]} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")} ${tz}`;
}

/** The hours in words, for the policy page and the audit log. */
export const cardHoursWords = (s: string): string => (s.trim() === "" ? "any time (no hours set)" : s.trim().replace(/\s+/g, " "));

/**
 * Whether every moment of `inner` lies within `outer` ("" is any time). Hours in another time zone are not proven to
 * be inside (summer time moves them), so they are not; a value that cannot be read is not inside either.
 */
export function cardHoursWithin(inner: string, outer: string): boolean {
  let a: CardHours | null, b: CardHours | null;
  try {
    [a, b] = [parseCardHours(inner), parseCardHours(outer)];
  } catch {
    return false;
  }
  if (!b) return true;
  if (!a) return false;
  return a.tz === b.tz && a.days.every((d) => b.days.includes(d)) && b.startMin <= a.startMin && a.endMin <= b.endMin;
}

/** The entries of a comma-separated list, trimmed. */
export const listOf = (s: string): string[] => s.split(",").map((x) => x.trim()).filter((x) => x !== "");
/** A list in the order Airwallex and the cards table keep it: sorted, comma-separated. */
export const canonicalList = (s: string): string => [...new Set(listOf(s))].sort().join(",");

function listProblem(s: string, what: string, re: RegExp, example: string): string | null {
  const items = listOf(s);
  if (!items.length) return `name at least one ${what}, e.g. ${example}`;
  const wrong = items.find((x) => !re.test(x));
  if (wrong) return `${JSON.stringify(wrong.slice(0, 12))} is no ${what}, e.g. ${example}`;
  const twice = items.find((x, i) => items.indexOf(x) !== i);
  return twice ? `${twice} is named twice` : null;
}
/** Why `s` cannot be a card's merchant categories (four-digit codes, ISO 18245), or null. */
export const mccListProblem = (s: string): string | null => listProblem(s, "merchant category code", /^\d{4}$/, "5734,7372");
/** Why `s` cannot be a card's currencies (ISO 4217 codes), or null. */
export const currencyListProblem = (s: string): string | null => listProblem(s, "currency code", /^[A-Z]{3}$/, "EUR,USD");

/** Whether every entry of list `inner` is in list `outer`. */
export const listWithin = (inner: string, outer: string): boolean => {
  const o = new Set(listOf(outer));
  return listOf(inner).every((x) => o.has(x));
};

/** The card control a policy key names: card.<agent>.hours / .mccs / .currencies; null for any other key. */
export function cardControlOf(key: string): { agent: string; control: "hours" | "mccs" | "currencies" } | null {
  const m = /^card\.([^.]+)\.(hours|mccs|currencies)$/.exec(key);
  return m ? { agent: m[1]!, control: m[2] as "hours" | "mccs" | "currencies" } : null;
}

/**
 * Whether changing a card control loosens the policy: wider hours (or none), a merchant category or currency the card
 * did not have. A value that cannot be read loosens (fails closed). Null when the key is no card control.
 */
export function cardControlLoosens(key: string, from: string, to: string): boolean | null {
  const c = cardControlOf(key);
  if (!c) return null;
  if (c.control === "hours") return !cardHoursWithin(to, from);
  const problem = c.control === "mccs" ? mccListProblem(to) : currencyListProblem(to);
  return problem !== null || !listWithin(to, from);
}
