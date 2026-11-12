// What the Airwallex sandbox itself reports for a PaymentIntent, kept as a record (12 Nov): the answer of
// GET /api/v1/pa/payment_intents/{id}, unedited but for redaction. Used for the Airi run's two PaymentIntents
// (src/cli/vicReadback.ts writes docs/runs/airwallex-vic-payment-intents-<date>.json; /visa shows a few of its fields,
// each under Airwallex's own field name, src/redesign/vicNetwork.ts).
//
// Redacted where needed, by key name at any depth, whatever its letter case:
//   - a secret (client_secret, anything named like a key, password or token);
//   - card data (a number, an expiry, a CVC, the card's fingerprint): the first six and last four digits and the brand
//     stay, as Airwallex returns them apart;
//   - personal or device data (billing, shipping, customer, names, e-mail, phone, address, device);
//   - an authentication value (cavv, xid, a cryptogram): kept as "present, so many characters", never its value;
// and, in any text, a card-like number: 13 to 19 digits that pass the card check digit (Luhn). A long number that does
// not is an id, and stays. A redacted value is replaced by a marker that says why and what was there (a text of so
// many characters, an object), and its path is listed beside the answer. Nothing else is added, dropped or renamed.

import type { CallLine } from "./callBudget.js";

/** The record's file name: docs/runs/<prefix>-YYYY-MM-DD.json (the newest is the one the pages read). */
export const VIC_INTENTS_PREFIX = "airwallex-vic-payment-intents";
export const REDACTED = "[redacted: ";

export type RedactionWhy = "a secret" | "card data" | "personal or device data" | "an authentication value" | "a card-like number";
export interface Redaction { path: string; why: RedactionWhy }

const KEY_RULES: [RegExp, RedactionWhy][] = [
  [/secret|passw(or)?d|passcode|api[_-]?key|private[_-]?key|(access|refresh|bearer|id)[_-]?token/i, "a secret"],
  [/^(number|card_number|pan|expiry|expiry_month|expiry_year|expiry_date|cvc|cvv|cvv2|security_code|fingerprint)$/i, "card data"],
  [/^(billing|shipping|customer|customer_details|email|phone|phone_number|first_name|last_name|name|name_on_card|address|date_of_birth|ip|ip_address|device|device_data|device_id|browser|user_agent)$/i, "personal or device data"],
  [/^(cavv|aav|xid|ucaf|cryptogram|authentication_value)$/i, "an authentication value"],
];
/** A signed token (three dot-separated base64url parts) or a link that carries a secret: redacted whatever its key. */
const SECRET_VALUE = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$|[?&](client_secret|token|signature|sig)=/i;
/** 13 to 19 digits, alone or in groups split by single spaces or dashes, not part of a longer run of digits. */
const DIGIT_RUN = /(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/g;

/** The card check digit (Luhn) over a string of digits. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    const d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += double ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const MARKER = /\[redacted: (a secret|card data|personal or device data|an authentication value|a card-like number), [^\]]*\]/;
const whatWasThere = (v: unknown): string => typeof v === "string" ? `${v.length} characters` : Array.isArray(v) ? "a list" : v && typeof v === "object" ? "an object" : typeof v === "number" ? "a number" : v === null ? "null" : `a ${typeof v}`;
const marker = (why: RedactionWhy, v: unknown) => `${REDACTED}${why}, ${whatWasThere(v)}]`;
const keyRule = (key: string): RedactionWhy | null => KEY_RULES.find(([re]) => re.test(key))?.[1] ?? null;
/** A text with every card-like number in it replaced by a marker; `hit` says whether there was one. */
function scrubCardNumbers(text: string): { text: string; hit: boolean } {
  let hit = false;
  const out = text.replace(DIGIT_RUN, (run) => {
    const digits = run.replace(/[ -]/g, "");
    if (!luhnValid(digits)) return run;
    hit = true;
    return `${REDACTED}a card-like number, ${digits.length} digits]`;
  });
  return { text: out, hit };
}

/**
 * The answer with what must not be kept replaced by markers, and the list of what was replaced. The input is not
 * changed. `only` keeps the redaction to those reasons (the private working copy of an answer drops its secrets only).
 */
export function redactAnswer(raw: unknown, only?: readonly RedactionWhy[]): { value: unknown; redacted: Redaction[] } {
  const redacted: Redaction[] = [];
  const wanted = (why: RedactionWhy) => !only || only.includes(why);
  const walk = (v: unknown, path: string, key: string | null): unknown => {
    // Already a marker (an answer redacted once before): listed again, left as it is, so redacting twice changes nothing.
    const before = typeof v === "string" ? MARKER.exec(v) : null;
    if (before) { redacted.push({ path, why: before[1] as RedactionWhy }); return v; }
    const why = key === null ? null : keyRule(key);
    if (why && wanted(why) && v !== null && v !== undefined) { redacted.push({ path, why }); return marker(why, v); }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}${path ? "." : ""}${i}`, null));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, `${path}${path ? "." : ""}${k}`, k)]));
    if (typeof v === "string") {
      if (wanted("a secret") && SECRET_VALUE.test(v)) { redacted.push({ path, why: "a secret" }); return marker("a secret", v); }
      const s = wanted("a card-like number") ? scrubCardNumbers(v) : { text: v, hit: false };
      if (s.hit) { redacted.push({ path, why: "a card-like number" }); return s.text; }
    }
    return v;
  };
  return { value: walk(raw, "", null), redacted };
}

export interface IntentsRecord {
  read_at: string;
  method: string;
  why: string;
  run: string;
  test_money: true;
  redaction: string;
  /** The calls Max approved for this read-back, and the ones made (from the call log: time, method, endpoint with ids folded). */
  budget: number;
  calls: { at: string; method: string; endpoint: string }[];
  payment_intents: { purchase: string; id: string; redacted: Redaction[]; intent: Record<string, unknown> }[];
  not_read?: { purchase: string; id: string; why: string }[];
}

/** A record must hold no value under a key the rules redact, no signed token and no card-like number: refused otherwise. */
export function assertRecordSafe(rec: unknown): void {
  const walk = (v: unknown, path: string, key: string | null): void => {
    if (key !== null && keyRule(key) && v !== null && v !== undefined && !(typeof v === "string" && v.startsWith(REDACTED))) throw new Error(`refused: ${path} (${key}) would be written unredacted`);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}.${i}`, null));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k, k));
    if (typeof v === "string" && (SECRET_VALUE.test(v) || scrubCardNumbers(v).hit)) throw new Error(`refused: ${path} holds a token or a card-like number`);
  };
  walk(rec, "", null);
}

/** A call logged before 12 Nov, when the call log folded the path segment payment_intents as if it were an id. */
const FOLDED_PATH = /^\/pa\/\{id\}\/\{id\}$/;
const FOLDED_NOTE = " The call log of this read-back wrote each GET as /pa/{id}/{id}: it folded the path segment payment_intents as if it were an id (fixed on 12 Nov in src/airwallex/callBudget.ts).";

/**
 * The record: how it was read, each PaymentIntent's answer (redacted, with the list of redactions) and the calls made.
 * Throws when an answer is for another PaymentIntent, when the call log holds more calls than the budget, or when it
 * holds anything but a login and GETs (the read-back is read-only).
 */
export function intentsRecord(o: { readAt: Date; run: string; purchases: { step: string; id: string }[]; answers: Record<string, unknown>; calls: readonly CallLine[]; budget: number; notRead?: { step: string; id: string; why: string }[] }): IntentsRecord {
  if (o.calls.length > o.budget) throw new Error(`the call log holds ${o.calls.length} calls, more than the budget of ${o.budget}`);
  for (const c of o.calls) if (!(c.method === "GET" || (c.method === "POST" && c.endpoint === "/authentication/login"))) throw new Error(`the read-back is read-only: ${c.method} ${c.endpoint} is in the call log`);
  const payment_intents = o.purchases.flatMap((p) => {
    const raw = o.answers[p.id];
    if (raw === undefined) return [];
    if (!raw || typeof raw !== "object" || (raw as { id?: unknown }).id !== p.id) throw new Error(`the answer kept for ${p.id} is not that PaymentIntent's`);
    const { value, redacted } = redactAnswer(raw);
    return [{ purchase: p.step, id: p.id, redacted, intent: value as Record<string, unknown> }];
  });
  const rec: IntentsRecord = {
    read_at: o.readAt.toISOString(),
    method: `GET only, Airwallex sandbox: GET /api/v1/pa/payment_intents/{id}, once per PaymentIntent. Nothing was created, updated or cancelled.${o.calls.some((c) => FOLDED_PATH.test(c.endpoint)) ? FOLDED_NOTE : ""}`,
    why: `The PaymentIntents of the Airi run (${o.run}) as the Airwallex sandbox reports them at the time of reading: Airwallex's own record of each payment.`,
    run: o.run,
    test_money: true,
    redaction: "Each answer is kept as Airwallex returned it, except the values listed under `redacted` (a secret, card data, personal or device data, an authentication value, a card-like number), each replaced by a marker that says why and what was there. Nothing else is added, dropped or renamed (src/airwallex/intentReadback.ts).",
    budget: o.budget,
    calls: o.calls.map((c) => ({ at: c.at, method: c.method, endpoint: c.endpoint })),
    payment_intents,
    ...(o.notRead?.length ? { not_read: o.notRead.map((n) => ({ purchase: n.step, id: n.id, why: n.why })) } : {}),
  };
  assertRecordSafe(rec);
  return rec;
}
