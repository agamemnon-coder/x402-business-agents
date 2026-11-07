// /try/sign (TRY_SIGN_ENABLED): a visitor signs with their own passkey in a test world of their own. The world lives
// one hour in its own Durable Object instance ("try-sign"), in its own tables (ts_*), with its own passkeys: nothing
// here reads or writes the relay's state, its enrolled passkeys, its sessions or its queue. No Metal or relay token is
// handed to this desk.
//
// The waiting payment (T-0002) comes about step by step, one step per POST /agents (spec 6b, Max 7 Nov): (1) Claude
// Sonnet, the runner's invoice reader, reads Alpine Packaging's invoice (a document code wrote); (2) Purser's code checks
// the reading against the document's own lines, the payee against the allowlist, the text for planted instructions,
// and the amount against what the agent may pay alone; (3) code plans the payment as Purser does (planInvoice: EUR
// needed = invoice + SWIFT fee ceiling, convert only the shortfall) and asks the Airwallex sandbox for a read-only quote
// for exactly that shortfall (worker/src/fxQuote.ts), checked against the USD floor; (4) Claude Opus, the runner's
// Treasury timing agent, advises paying now or waiting, in one or two sentences code checks; (5) the terms are written
// from the reading, the plan, the quote and the advice. No model sets an amount, a payee, the FX or the plan, and no
// visitor's words reach a model. A live call that is unavailable is replaced by a recorded real one (src/try/recorded.ts)
// or by code's reading and a fixed sentence, labelled with the reason, never silently. The quote is in the terms, so
// the signature binds to the quote id, and an expired quote is refused even with a good signature; nothing is
// converted or paid. "Executed" is a stand-in that only records in the world's own table, as the Scenario Lab does.
//
// The signature itself is the real thing: the passkey is made with WebAuthn (user verification required, a random user
// id, no name or e-mail), the challenge is the SHA-256 of the exact terms (canonical JSON, as the real approvals), and
// the Worker checks the assertion with the D20 verifier (worker/src/webauthn.ts) against the public key this world
// registered. A proposal that fails a check has nothing to sign, and the server refuses a signature for it anyway.


import { COMMON_HEADERS, rateKey, type Sql } from "./core.js";
import { ATTACKS, TRICKS, TEST_ALLOWLIST, ibanSha256, runTrick, type AgentCall, type Attack } from "./trick.js";
import type { InvoiceReadSource, InvoiceReadingLive } from "../../src/try/claude.js";
import type { AgentAsk } from "../../src/try/world.js";
import { verifyAssertion, type PublicKeyXY } from "./webauthn.js";
import { QuoteUnavailable, type FxQuote, type FxSource } from "./fxQuote.js";
import { AGENTS, SWIFT_FEE_MAX_EUR_CENTS, type Agent } from "../../src/config/policy.js";
import { ALONE_CHOICES, ALONE_PER_DAY, PAID_ALONE, exposurePolicyOfWorld } from "../../src/try/policy.js";
import { EXPOSURE_TASK_CARDS, exposureOf, exposureWords, type RecordedRate } from "../../src/policy/exposure.js";
import { defaultPolicy, FIELD_WORDS, policyBounds, policyChanges, readSet, threeLocks, withSet, type Locks, type PolicyChange, type WorldPolicy } from "../../src/try/policy.js";
import { checkQuoteAgainstFloor, planInvoice, type TreasuryState } from "../../src/policy/treasury.js";
import { checkInvoiceReading, parseInvoiceFallback, type Invoice } from "../../src/claude/invoiceReading.js";
import { assessAgainst, type Beneficiary } from "../../src/policy/fraudCore.js";
import { findInjections } from "../../src/policy/injection.js";
import { alpineInvoice } from "../../src/try/invoiceDoc.js";
import { adviseTry, signatureLine, type AdviceCall } from "../../src/try/treasuryAdvice.js";
import { adviceOutOfBounds, licenceNumbers, type TimingFacts } from "../../src/agents/timingCore.js";
import type { RecordedAgents } from "../../src/try/recorded.js";
import { AGENT_LINE_DAILY_USD, CODE_LABEL, FIXED_TEXT, READ_BY_CODE, RECORDED_LABEL, adviceGiven, checkReason, liveLabel, moneyForPeople, strayRefusal } from "./agentLine.js";
export { PAID_ALONE };

/** Live agent calls (section 6): kept aside per call before it, settled after; per address an hour; everyone a minute. */
export const TRICK_RESERVE_USD = 0.03;
/** Kept aside before the Treasury agent's advice (Opus, up to five calls), settled after (src/claude/pricing.ts). */
export const ADVICE_RESERVE_USD = 0.15;
export const LIVE_PER_HOUR = 20;
export const LIVE_ALL_PER_MINUTE = 30;
const SWITCHED_OFF = "the live agents are switched off on this server";
const NO_MODEL_KEY = "this server has no model key";

/** A test world lives one hour, then everything in it is deleted. */
export const TRY_SIGN_TTL_MS = 60 * 60 * 1000;
/** A world with no passkey yet is deleted after ten minutes, and is the first to go when the store is full. */
export const TRY_SIGN_UNCLAIMED_MS = 10 * 60 * 1000;
/** At most this many live test worlds for everyone together; when full, the oldest world without a passkey makes room,
 * and only when every world has one does a new visitor wait. */
export const TRY_SIGN_MAX_WORLDS = 2000;
/** New test worlds per address (IPv6 by its /64) per hour. */
export const TRY_SIGN_WORLDS_PER_HOUR = 6;
/** New test worlds per network (IPv4 /24, IPv6 /48) per hour: one provider's block cannot open them all. */
export const TRY_SIGN_WORLDS_PER_NETWORK_HOUR = 20;
/** Requests per address per minute, every kind together. */
export const TRY_SIGN_PER_MINUTE = 30;
/** Requests per network (IPv4 /24, IPv6 /48) per minute: one provider's block of addresses cannot fill the ceiling
 * for everyone below on its own (20 /64s of one /48 at 30 a minute each would). */
export const TRY_SIGN_NET_PER_MINUTE = 60;
/** Requests a minute from everyone together: many addresses at once cannot make the instance (or its table) grow. */
export const TRY_SIGN_ALL_PER_MINUTE = 600;
/** Failed signatures or passkeys per address per hour before it is refused. */
export const TRY_SIGN_FAILS_PER_HOUR = 30;
const MAX_BODY = 16_384;
const MAX_TERMS = 4096;
// v2 (6 Nov): the payee's IBAN is in the terms, so the visitor can tamper with it as with the amount or the currency.
// v3 (6 Nov, P2): an `fx` block, the live Airwallex sandbox quote for the waiting payment (null when there is none).
// v4 (7 Nov, spec 6b): `agent_advice`, the Treasury agent's advice ("pay_now", "wait_until YYYY-MM-DD" or "none"), so
// the signature covers the agent's decision too; the payee, IBAN, amount and reference come from the checked reading.
export const TRY_TERMS_SCHEMA = "kit11.try-terms/v4";
/** Live FX quotes per address an hour (a world's two quotes, T-0002's and T-0003's, and every "Get a new quote"). */
export const TRY_SIGN_FX_PER_HOUR = 12;
/** Live FX quotes a minute, and an hour, from everyone together: the sandbox is asked at most this often. */
export const TRY_SIGN_FX_ALL_PER_MINUTE = 20;
export const TRY_SIGN_FX_ALL_PER_HOUR = 300;
/** A quote shared after a limit or a failure only while it has at least this long left. */
const FX_REUSE_MIN_MS = 2 * 60_000;
/** The story's pair: the Treasury agent holds USD and the invoice is in EUR, so it would buy EUR and sell USD. */
export const FX_PAIR = { buy: "EUR", sell: "USD" } as const;
/** What the page is told about the quote in the terms. */
export type FxStatus = { status: "live" | "reused"; quote: FxQuote } | { status: "unavailable"; reason: string };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

const headers = { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" };
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

/** The paths this desk answers; with the feature off the Worker answers 404 on every one of them. */
export const isTrySignPath = (path: string) => path === "/api/try-sign" || path.startsWith("/api/try-sign/");
export const trySignNotFound = () => answer(404, { error: "not found" });
/** Where the Worker sends one of these paths: the try-sign instance when the bundle carries the page, else a 404. */
export const trySignRoute = (path: string, pages: { trySign?: string }): "desk" | "not-found" | null =>
  !isTrySignPath(path) ? null : pages.trySign ? "desk" : "not-found";

// ── Bytes ──

const enc = new TextEncoder();
const toB64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64u(s: string): Uint8Array {
  if (!B64URL.test(s)) throw new Error("not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const hexToB64u = (h: string) => toB64u(Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16)));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : new Uint8Array(data)));
}
const sha256Hex = async (text: string) => hex(await sha256(text));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── Canonical JSON (RFC 8785 for terms without numbers, as src/lib/terms.ts: money is a decimal string) ──

export type TermsValue = string | boolean | null | TermsValue[] | { [k: string]: TermsValue };
export function canonical(v: TermsValue): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    // RFC 8785 sorts keys by their UTF-16 code units, which is what a plain sort compares.
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k]!)}`).join(",")}}`;
  }
  throw new Error("terms carry no numbers: money is a decimal string");
}

// ── A minimal CBOR reader, enough for a WebAuthn attestation object and its COSE key ──

type Cbor = number | bigint | string | boolean | null | Uint8Array | Cbor[] | Map<Cbor, Cbor>;
export function readCbor(b: Uint8Array, at = 0, depth = 0): { v: Cbor; end: number } {
  if (depth > 8) throw new Error("CBOR too deep");
  if (at >= b.length) throw new Error("CBOR truncated");
  const head = b[at]!, major = head >> 5, info = head & 31;
  let i = at + 1;
  let n: number;
  if (info < 24) n = info;
  else if (info === 24) n = b[i++]!;
  else if (info === 25) { n = (b[i]! << 8) | b[i + 1]!; i += 2; }
  else if (info === 26) { n = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0; i += 4; }
  else throw new Error("CBOR length not supported");
  if (i > b.length) throw new Error("CBOR truncated");
  switch (major) {
    case 0: return { v: n, end: i };
    case 1: return { v: -1 - n, end: i };
    case 2: case 3: {
      if (i + n > b.length) throw new Error("CBOR truncated");
      const s = b.slice(i, i + n);
      return { v: major === 2 ? s : new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(s), end: i + n };
    }
    case 4: {
      if (n > 64) throw new Error("CBOR array too long");
      const out: Cbor[] = [];
      for (let k = 0; k < n; k++) { const r = readCbor(b, i, depth + 1); out.push(r.v); i = r.end; }
      return { v: out, end: i };
    }
    case 5: {
      if (n > 64) throw new Error("CBOR map too long");
      const m = new Map<Cbor, Cbor>();
      for (let k = 0; k < n; k++) { const key = readCbor(b, i, depth + 1); const val = readCbor(b, key.end, depth + 1); m.set(key.v, val.v); i = val.end; }
      return { v: m, end: i };
    }
    case 7: if (info === 20) return { v: false, end: i }; if (info === 21) return { v: true, end: i }; if (info === 22) return { v: null, end: i };
  }
  throw new Error("CBOR item not supported");
}

/** A new passkey, checked: what navigator.credentials.create() gave, against this world's one-time challenge. */
export async function verifyRegistration(
  cred: { id: string; response: { clientDataJSON: string; attestationObject: string } },
  exp: { challenge: string; origin: string; rpId: string },
): Promise<{ ok: true; key: PublicKeyXY; counter: number } | { ok: false; why: string }> {
  try {
    const c = JSON.parse(new TextDecoder().decode(fromB64u(cred.response.clientDataJSON))) as { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
    if (c.type !== "webauthn.create") return { ok: false, why: "type" };
    if (c.challenge !== exp.challenge) return { ok: false, why: "challenge" };
    if (c.origin !== exp.origin || c.crossOrigin === true) return { ok: false, why: "origin" };
    const att = readCbor(fromB64u(cred.response.attestationObject)).v;
    const auth = att instanceof Map ? att.get("authData") : null;
    if (!(auth instanceof Uint8Array) || auth.length < 55) return { ok: false, why: "authenticator data" };
    if (!same(auth.slice(0, 32), await sha256(exp.rpId))) return { ok: false, why: "rp id" };
    const flags = auth[32]!;
    if (!(flags & 0x01)) return { ok: false, why: "user presence" };
    if (!(flags & 0x04)) return { ok: false, why: "user verification" };
    if (!(flags & 0x40)) return { ok: false, why: "no credential in the authenticator data" };
    const counter = ((auth[33]! << 24) | (auth[34]! << 16) | (auth[35]! << 8) | auth[36]!) >>> 0;
    const idLen = (auth[53]! << 8) | auth[54]!;
    const credId = auth.slice(55, 55 + idLen);
    if (credId.length !== idLen || idLen === 0 || toB64u(credId) !== cred.id) return { ok: false, why: "credential id" };
    const cose = readCbor(auth, 55 + idLen).v;
    if (!(cose instanceof Map)) return { ok: false, why: "public key" };
    // ES256 only, the one kind the D20 verifier checks: EC2 (1: 2), ES256 (3: -7), P-256 (-1: 1).
    const x = cose.get(-2), y = cose.get(-3);
    if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
      return { ok: false, why: "this passkey is not ES256 (P-256)" };
    }
    const key = { x: toB64u(x), y: toB64u(y) };
    // A point not on the curve is refused now, not at the first signature.
    await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: key.x, y: key.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { ok: true, key, counter };
  } catch {
    return { ok: false, why: "malformed" };
  }
}

// ── The test world: EUR and USD balances with their floors, a limit an agent may pay alone, three payments ──

/**
 * Purser-style FX (spec 6b): the Treasury agent holds EUR and USD. Free EUR above the floor (EUR 1,000.00) is smaller
 * than the waiting invoice, so code converts exactly the shortfall; the USD floor bounds what it may sell.
 */
export const TEST_WORLD = {
  company: "Northwind Outdoor (test world)", currency: "EUR", balance: "26000.00", reserve_floor: "25000.00",
  usd_balance: "8000.00", usd_floor: "3000.00", alone_limit: "500.00",
} as const;
/** The SWIFT fee ceiling code reserves beside each invoice (src/config/policy.ts SWIFT_FEE_MAX_EUR_CENTS: EUR 20.00). */
export const FEE_MAX = `${Math.floor(SWIFT_FEE_MAX_EUR_CENTS / 100)}.${String(SWIFT_FEE_MAX_EUR_CENTS % 100).padStart(2, "0")}`;
const cents = (s: string) => { if (!/^\d+\.\d{2}$/.test(s)) throw new Error("not a decimal amount"); return Number(s.replace(".", "")); };
const money = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
/** For people, as the page writes it: EUR 25,000.00. */
const eur = (s: string) => moneyForPeople("EUR", s);
const usd = (s: string) => moneyForPeople("USD", s);

interface FixedProposal { id: string; agent: string; says: string; payee: string; iban: string; amount: string; reference: string }
/**
 * The test payees' IBANs. Check digits 00 are never valid (ISO 13616: they run from 02 to 98), so no bank account
 * anywhere has these numbers: they are shaped like a German IBAN and can pay nothing.
 */
export const TEST_IBAN = { stockline: "DE00000000000000004471", alpine: "DE00000000000000000118" } as const;
/**
 * What the agent proposes. T-0001 is fixed text. T-0002's payee, IBAN, amount and reference come from the checked
 * reading of its invoice (the values here are that invoice's, for the page's first paint), and its sentence is the
 * Treasury agent's advice; this fixed sentence is shown, labelled, whenever there is no live or recorded advice.
 */
export const FIXED_PROPOSALS: FixedProposal[] = [
  { id: "T-0001", agent: "Treasury agent", says: "Stockline's spring order is ready; I would pay it now to keep the price.", payee: "Stockline GmbH (test payee)", iban: TEST_IBAN.stockline, amount: "6500.00", reference: "Stock order SO-4471" },
  { id: "T-0002", agent: "Treasury agent", says: "Alpine Packaging's invoice is due Friday. It is more than I may pay alone, so I ask you.", payee: "Alpine Packaging (test payee)", iban: TEST_IBAN.alpine, amount: "1850.00", reference: "Invoice INV-2026-118" },
];
/**
 * The agent's next invoice (Max, 7 Nov: the demo's last screen): Alpine Packaging's next one. It arrives in the world
 * only once the visitor has signed T-0002. It is fixed text with no model sentence; it needs FX too, so it gets a second
 * live quote when it arrives, within the quote limits. It is checked by the same rules: above what the agent may pay
 * alone it waits for a signature; at or below a limit the visitor signed, it runs alone (runAlone).
 */
export const NEXT_INVOICE: FixedProposal = {
  id: "T-0003", agent: "Treasury agent", says: "Alpine Packaging's next invoice is in, for November's boxes.", payee: "Alpine Packaging (test payee)", iban: TEST_IBAN.alpine, amount: "1240.00", reference: "Invoice INV-2026-131",
};
/** Any proposal this world can hold, by its id: the two it opens with, and the next invoice. */
const fixedOf = (id: string): FixedProposal => [...FIXED_PROPOSALS, NEXT_INVOICE].find((x) => x.id === id)!;
/** The payment the agents prepare step by step and that waits for a person (T-0002). */
const QUOTED = "T-0002";

/** The plan in code's numbers (planInvoice), as decimal strings. */
export interface PlanNumbers { needed: string; fee_max: string; free: string; shortfall: string; buy: string | null; sell: string | null; rate_from: string | null }
export type Check = { check: "fail"; rule: string; plan?: PlanNumbers } | { check: "pass"; waits: string; plan: PlanNumbers };
/** The rules a payment is checked against: the world's at the start, or the policy the visitor set (step 0). */
export interface PaymentRules { reserve_floor: string; usd_floor: string; alone_limit: string }
export const TEST_RULES: PaymentRules = { reserve_floor: TEST_WORLD.reserve_floor, usd_floor: TEST_WORLD.usd_floor, alone_limit: TEST_WORLD.alone_limit };
/** The world's two balances. */
export interface Balances { eur: string; usd: string }
export const TEST_BALANCES: Balances = { eur: TEST_WORLD.balance, usd: TEST_WORLD.usd_balance };
/** A EUR/USD rate for the checks: a live quote's (sell / buy), or the main run's recorded rate, labelled. */
export interface CheckRate { usdPerEur: string; from: string }
export const rateOfQuote = (q: FxQuote): CheckRate => ({ usdPerEur: (Number(q.sell_amount) / Number(q.buy_amount)).toFixed(6), from: "the quote's rate" });
export const rateOfRecord = (r: RecordedRate): CheckRate => ({ usdPerEur: r.usdPerEur, from: `the recorded rate (${r.usdPerEur} USD per EUR, ${r.date})` });

/**
 * The rules, in code, Purser's way for a payment in EUR from EUR and USD (spec 6b): the plan first (planInvoice: EUR
 * needed = the invoice + the SWIFT fee ceiling; free EUR above the floor; convert only the shortfall); the conversion's
 * USD must keep the USD balance at or above its floor (checkQuoteAgainstFloor), at the payment's own quote when it buys
 * exactly the shortfall, else at the rate given (a quote's or the recorded one), and no rate blocks it; the EUR floor
 * holds after the payment; then the amount an agent may pay without a person. Pure.
 */
export function checkPayment(amount: string, bal: Balances = TEST_BALANCES, rules: PaymentRules = TEST_RULES, fx: { quote?: FxQuote | null; rate?: CheckRate | null } = {}): Check {
  const s: TreasuryState = { eurAvailableCents: cents(bal.eur), eurFloorCents: cents(rules.reserve_floor), eurObligationsCents: 0, usdAvailableCents: cents(bal.usd), usdFloorCents: cents(rules.usd_floor) };
  const plan = planInvoice(cents(amount), s, SWIFT_FEE_MAX_EUR_CENTS);
  const numbers: PlanNumbers = { needed: money(plan.needEurCents), fee_max: FEE_MAX, free: money(Math.max(0, plan.freeEurCents)), shortfall: money(Math.max(0, plan.needEurCents - Math.max(0, plan.freeEurCents))), buy: null, sell: null, rate_from: null };
  if (plan.kind === "underfunded") return { check: "fail", rule: `Reserve floor: the EUR balance is already below its floor of ${eur(rules.reserve_floor)}, so nothing more is paid.`, plan: numbers };
  let buy = 0, sell = 0;
  if (plan.kind === "convert_shortfall") {
    buy = plan.buyEurCents;
    // What to convert is the plan's (the shortfall), with or without a rate: a missing rate leaves only the USD unknown.
    numbers.buy = money(buy);
    const q = fx.quote && /^\d+\.\d{2}$/.test(fx.quote.buy_amount) && cents(fx.quote.buy_amount) === buy && /^\d+\.\d{2}$/.test(fx.quote.sell_amount) ? fx.quote : null;
    let from: string;
    if (q) { sell = cents(q.sell_amount); from = "its quote"; }
    else if (fx.rate) { sell = Math.ceil(buy * Number(fx.rate.usdPerEur)); from = fx.rate.from; }
    else return { check: "fail", rule: `No rate to plan the conversion: it needs ${eur(numbers.needed)}, ${eur(numbers.free)} is free above the EUR floor, and there is no quote or recorded rate for the ${eur(money(buy))} short.`, plan: numbers };
    Object.assign(numbers, { buy: money(buy), sell: money(sell), rate_from: from });
    const usdOk = checkQuoteAgainstFloor(sell, s);
    if (!usdOk.ok) {
      return { check: "fail", plan: numbers, rule: `Reserve floors: it needs ${eur(numbers.needed)} (the invoice + the ${eur(FEE_MAX)} fee ceiling) and only ${eur(numbers.free)} is free above the EUR floor. Converting the ${eur(money(buy))} short takes ${usd(money(sell))} at ${from}, more than the ${usd(money(Math.max(0, s.usdAvailableCents - s.usdFloorCents)))} free above the USD floor of ${usd(rules.usd_floor)}.` };
    }
  }
  // The EUR floor after the payment (the plan keeps it; code checks it all the same).
  if (cents(bal.eur) + buy - cents(amount) < cents(rules.reserve_floor)) return { check: "fail", plan: numbers, rule: `Reserve floor: the EUR balance may not go below ${eur(rules.reserve_floor)}.` };
  if (cents(amount) > cents(rules.alone_limit)) return { check: "pass", plan: numbers, waits: `Above the ${eur(rules.alone_limit)} an agent may pay alone, so it waits for a person's signature.` };
  return { check: "pass", plan: numbers, waits: "" };
}
/** The payment rules a policy sets: the company's reserve floor, the USD floor, and what the Treasury agent may pay alone. */
export const rulesOf = (p: WorldPolicy): PaymentRules => ({ reserve_floor: p.reserve_floor, usd_floor: TEST_WORLD.usd_floor, alone_limit: p.agents.treasury.alone });

/**
 * Room for one more payment alone: fewer than ALONE_PER_DAY ran alone in the 24 hours before now (Max, 7 Nov: the worst
 * case counts payments alone, so they have a limit per day; src/policy/exposure.ts counts the same number).
 */
export function aloneRoom(executions: readonly { alone?: boolean; at?: string }[], nowMs: number): boolean {
  const since = nowMs - 24 * 3_600_000;
  return executions.filter((e) => e.alone === true && Date.parse(String(e.at)) > since).length < ALONE_PER_DAY;
}

/** Step 0 (Max, item 1): a change to the test world's policy, as the visitor signs it when it loosens the policy. */
export const TRY_POLICY_SCHEMA = "kit11.try-policy/v1";
export function policyTerms(worldId: string, agent: Agent, version: number, changes: PolicyChange[], next: WorldPolicy, expiresAt: string): { [k: string]: TermsValue } {
  const a = next.agents[agent];
  return {
    schema: TRY_POLICY_SCHEMA, test_world: worldId, kind: "policy_change", agent, policy_version: String(version),
    changes: changes.map((c) => ({ field: c.field, key: c.key, from: c.from, to: c.to, looser: c.looser })),
    policy: { ...a, mccs: [...a.mccs], currencies: [...a.currencies], reserve_floor: next.reserve_floor },
    expires_at: expiresAt, nothing_real_moves: true,
  };
}

/** What a proposal's terms are made of: the payee, IBAN, amount and reference (T-0002's from the checked reading). */
export interface Payment { id: string; payee: string; iban: string; amount: string; reference: string }
/**
 * A proposal's terms: bound to this world (its public id) and its expiry, so a signature is good here only; the quote,
 * when there is a live one; and the Treasury agent's advice ("none" where it gave none), so the signature covers it.
 */
export function proposalTerms(p: Payment, worldId: string, expiresAt: string, fx: FxQuote | null = null, proposedBy = "Treasury agent (fixed text)", advice = "none"): { [k: string]: TermsValue } {
  return {
    schema: TRY_TERMS_SCHEMA, test_world: worldId, kind: "payment", proposal_id: p.id, proposed_by: proposedBy,
    payee: p.payee, payee_iban: p.iban, amount: p.amount, currency: TEST_WORLD.currency, reference: p.reference, expires_at: expiresAt,
    fx: fx ? { ...fx } : null, agent_advice: advice, nothing_real_moves: true,
  };
}

// ── The agents' steps on T-0002 (spec 6b, Max 7 Nov): one per POST /agents, in order, each kept per world ──

export const AGENT_STEPS = ["read", "check", "quote", "advise", "ready"] as const;
export type AgentStep = (typeof AGENT_STEPS)[number];
/** How long a step may hold the world before another request may take it over (a crashed request must not lock it). */
const STEP_LEASE_MS = 40_000;

/** Where a reading or an advice came from: the live agent, its recording, or code (a fixed sentence). */
export type Source = "live" | "recorded" | "code";
/** Where the agent's sentence on a proposal came from, as the page labels it. */
export interface Voice { source: Source; label: string; model: string | null; request_id: string | null; why: string | null }

/** What the world keeps of the agents' work (ts_agent_runs.json): enough to answer each step again, and to write T-0002. */
interface AgentState {
  document: string;
  results: Partial<Record<AgentStep, Record<string, unknown>>>;
  calls: AgentCall[];
  /** The model's reading as it came back (live or recorded), and the one used after code's check. */
  read?: { source: Source; reading: Invoice | null; note: string | null; label: string };
  used?: { reading: Invoice; source: Source; label: string; note: string | null; blocked: string | null };
  plan?: PlanNumbers & { kind: string };
  quote?: FxStatus | null;
  advice?: { source: Source; label: string; says: string; advice: string; timing: string | null; date: string | null; why: string | null; model: string | null; request_id: string | null };
}

interface WorldRow { id: string; expires: number; reg_challenge: string | null; balance: string; usd: string | null; created: number }
interface ProposalRow { id: string; canonical: string; sha: string; check_json: string; status: string; execution: string | null }
interface CredRow { id: string; x: string; y: string; counter: number }

/** The network an address belongs to, for the second world limit: IPv4 by its /24, IPv6 by its /48. */
export function networkKey(ip: string): string {
  const k = rateKey(ip);
  if (k.endsWith("::/64")) return `${k.slice(0, -"::/64".length).split(":").slice(0, 3).join(":")}::/48`;
  const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(k);
  return v4 ? `${v4[1]}.0/24` : k;
}

/** The body, up to a limit, counted as it arrives (a body sent without a length cannot grow past it); null past it. */
async function readCapped(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? "0") > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// The request schema (security task A1, 6 Nov): each body carries the keys the page sends and nothing else, each of
// its type; a key it does not know is refused, not ignored. A missing token still answers 410 below (no such world).
const PROPOSAL_ID = /^T-\d{4}$/;
const b64u = (max: number) => (v: unknown) => typeof v === "string" && v.length <= max && B64URL.test(v);
const optional = (ok: (v: unknown) => boolean) => (v: unknown) => v === undefined || ok(v);
const CREDENTIAL = {
  id: b64u(1024), rawId: optional(b64u(1024)), type: optional((v) => v === "public-key"), response: isObj,
  clientExtensionResults: optional(isObj), authenticatorAttachment: optional((v) => v === "platform" || v === "cross-platform"),
};
const RESPONSE = {
  passkey: {
    clientDataJSON: b64u(8192), attestationObject: b64u(MAX_BODY),
    transports: optional((v) => Array.isArray(v) && v.length <= 8 && v.every((t) => typeof t === "string" && t.length <= 32)),
  },
  sign: { clientDataJSON: b64u(8192), authenticatorData: b64u(8192), signature: b64u(2048), userHandle: optional(b64u(512)) },
};
const BODY: Record<string, Record<string, (v: unknown) => boolean>> = {
  "/world": {},
  "/passkey": { token: optional((v) => typeof v === "string"), credential: () => true },
  "/quote": { token: optional((v) => typeof v === "string") },
  // Spec 6b: the agents' next step on the waiting payment; with a step's name, that step (done: its stored result).
  "/agents": { token: optional((v) => typeof v === "string"), step: optional((v) => typeof v === "string" && (AGENT_STEPS as readonly string[]).includes(v)) },
  "/trick": { token: optional((v) => typeof v === "string"), attack: (v) => typeof v === "string" && (ATTACKS as readonly string[]).includes(v) },
  "/sign": { token: optional((v) => typeof v === "string"), proposal_id: (v) => typeof v === "string" && PROPOSAL_ID.test(v), canonical: (v) => typeof v === "string" && v.length <= MAX_TERMS, credential: () => true },
  // Step 0: the agent's whole policy (read field by field in src/try/policy.ts); a looser one with its terms and signature.
  "/policy": {
    token: optional((v) => typeof v === "string"), agent: (v) => typeof v === "string" && (AGENTS as readonly string[]).includes(v), set: isObj,
    canonical: optional((v) => typeof v === "string" && v.length <= MAX_TERMS), credential: optional(() => true),
  },
};
const fits = (o: Record<string, unknown>, shape: Record<string, (v: unknown) => boolean>) =>
  Object.keys(o).every((k) => Object.hasOwn(shape, k)) && Object.entries(shape).every(([k, ok]) => ok(o[k]));
/** Whether a body has this endpoint's shape: its own keys only, each of its type (the credential's too). */
export function wellFormed(sub: string, body: Record<string, unknown>): boolean {
  const shape = BODY[sub];
  if (!shape || !fits(body, shape)) return false;
  if (sub === "/world" || sub === "/quote" || sub === "/trick" || sub === "/agents") return true;
  if (sub === "/policy" && body.credential === undefined) return body.canonical === undefined;
  if (sub === "/policy" && body.canonical === undefined) return false;
  const c = body.credential;
  return isObj(c) && fits(c, CREDENTIAL) && fits(c.response as Record<string, unknown>, sub === "/passkey" ? RESPONSE.passkey : RESPONSE.sign);
}

export interface TrySignOptions {
  now?: () => Date;
  /** The Airwallex sandbox's quote source (worker/src/fxQuote.ts), or a stand-in in tests and local checks. */
  fx?: FxSource | null;
  /** Section 6: the runner's invoice reader, live (Sonnet), "off" under the emergency switch, or none without a key. */
  reader?: InvoiceReadSource | "off" | null;
  /** Spec 6b: the Treasury agent's advice (Opus, one Messages API call with tools per turn), "off", or none. */
  advisor?: AgentAsk | "off" | null;
  /** The recorded real outputs shown when a live agent is unavailable (src/try/recorded.ts); none: no recording. */
  recorded?: RecordedAgents | null;
  /** 1.1: the main run's recorded EUR/USD rate, for step 0's worst case and the checks when there is no live quote. */
  rate?: RecordedRate | null;
  /** Tests only: the amount on T-0002's invoice (EUR 1,850.00), to prove the terms come from the agent's reading. */
  invoiceAmount?: string;
  /** Tests only: the Treasury agent's deadline (15 s). */
  adviceDeadlineMs?: number;
}

export class TrySignDesk {
  private readonly now: () => Date;
  private readonly fx: FxSource | null;
  private readonly rate: RecordedRate | null;
  private readonly reader: InvoiceReadSource | "off" | null;
  private readonly advisor: AgentAsk | "off" | null;
  private readonly recorded: RecordedAgents | null;
  private readonly invoiceAmount: string;
  private readonly adviceDeadlineMs: number | undefined;
  /** The last live quote, shared only after a limit or a failure while it has time left (FX_REUSE_MIN_MS). */
  private lastQuote: FxQuote | null = null;

  /** It takes a SQL handle, a clock and, when the Worker has them, the quote source and the agents' functions; nothing else. */
  constructor(private readonly sql: Sql, opts: TrySignOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.reader = opts.reader ?? null;
    this.advisor = opts.advisor ?? null;
    this.recorded = opts.recorded ?? null;
    this.rate = opts.rate ?? null;
    this.fx = opts.fx ?? null;
    this.invoiceAmount = opts.invoiceAmount ?? "1850.00";
    this.adviceDeadlineMs = opts.adviceDeadlineMs;
    // Each world's trick readings, kept: a second click on the same attack asks no model again.
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_tricks (world TEXT NOT NULL, attack TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (world, attack))");
    // Spec 6b: what the agents did on each world's T-0002, step by step (step = how many are done; busy = a step's lease).
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_agent_runs (world TEXT PRIMARY KEY, step INTEGER NOT NULL, busy INTEGER NOT NULL, json TEXT NOT NULL)");
    // The live agents' spend per UTC day.
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_spend (day TEXT PRIMARY KEY, usd REAL NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_worlds (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, ip TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, reg_challenge TEXT, balance TEXT NOT NULL, usd TEXT)");
    // A store made before the USD balance (spec 6b) gets its column; a world without one starts from the test world's.
    try { this.sql.exec("ALTER TABLE ts_worlds ADD COLUMN usd TEXT"); } catch { /* it has it */ }
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_creds (world TEXT NOT NULL, id TEXT NOT NULL, x TEXT NOT NULL, y TEXT NOT NULL, counter INTEGER NOT NULL, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_proposals (world TEXT NOT NULL, id TEXT NOT NULL, canonical TEXT NOT NULL, sha TEXT NOT NULL, check_json TEXT NOT NULL, status TEXT NOT NULL, execution TEXT, PRIMARY KEY (world, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_hits (ip TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL)");
    // Step 0: the policy the visitor set in their world, numbered (a signature names the version it changes).
    // signed_sha: the SHA-256 of the last policy change the visitor signed (a payment run alone names it).
    this.sql.exec("CREATE TABLE IF NOT EXISTS ts_policy (world TEXT PRIMARY KEY, version INTEGER NOT NULL, json TEXT NOT NULL, signed_sha TEXT)");
    // Every query on a request goes through an index: the counts per address and kind, the purges by time.
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_hits_ip ON ts_hits (ip, kind, at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_hits_kind ON ts_hits (kind, at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_hits_at ON ts_hits (at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_worlds_expires ON ts_worlds (expires)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ts_worlds_created ON ts_worlds (created)");
  }

  /** Never throws: anything unexpected answers a fixed 500, with no exception text, stack or path in it (A1). */
  async fetch(req: Request): Promise<Response> {
    try {
      return await this.handle(req);
    } catch (e) {
      console.error("try-sign: unexpected error", e instanceof Error ? e.name : typeof e);
      return answer(500, { error: "the test world could not answer this; nothing was signed or run. Try again" });
    }
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!isTrySignPath(path)) return trySignNotFound();
    const sub = path.slice("/api/try-sign".length);
    if (!["/world", "/passkey", "/sign", "/quote", "/policy", "/trick", "/agents"].includes(sub)) return trySignNotFound();
    if (req.method !== "POST") return answer(405, { error: "use POST" });
    // Only this site's own page may ask: a browser on another site sends its own origin, or none on a form post.
    if (req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") === "cross-site") return answer(403, { error: "ask from the /try/sign page on this site" });

    const nowMs = this.now().getTime();
    const ip = rateKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    if (this.hits(ip, "fail", nowMs - 3_600_000) >= TRY_SIGN_FAILS_PER_HOUR) return answer(429, { error: "too many refused signatures from this address; wait an hour" });
    if (this.hits(ip, "req", nowMs - 60_000) >= TRY_SIGN_PER_MINUTE) return answer(429, { error: "a few requests a minute; wait a moment" });
    const net = networkKey(req.headers.get("cf-connecting-ip") ?? "unknown");
    if (this.hits(net, "req-net", nowMs - 60_000) >= TRY_SIGN_NET_PER_MINUTE) return answer(429, { error: "many requests a minute from your network; wait a moment" });
    const [{ n: everyone }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_hits WHERE kind = 'req' AND at > ?", nowMs - 60_000).toArray() as [{ n: number }];
    if (everyone >= TRY_SIGN_ALL_PER_MINUTE) return answer(503, { error: "many visitors are trying this right now; try again in a minute" });
    this.hit(ip, "req", nowMs);
    this.hit(net, "req-net", nowMs);
    this.purge(nowMs);

    const raw = await readCapped(req, MAX_BODY);
    if (raw === null) return answer(413, { error: "too large" });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return answer(400, { error: "send JSON" }); }
    if (!isObj(body)) return answer(400, { error: "send a JSON object" });
    const gone = () => answer(410, { error: "no such test world: it expired (a world lasts one hour, ten minutes without a passkey) or never existed; start a new one", expired: true });
    // No token at all is no world (as before); anything else must have the endpoint's shape before it is looked at.
    if (sub !== "/world" && body.token === undefined) return gone();
    if (!wellFormed(sub, body)) {
      return answer(400, { error: sub === "/sign" ? "malformed signature" : sub === "/passkey" ? "malformed passkey" : sub === "/quote" ? "send the world's token only"
        : sub === "/policy" ? "send the world's token, an agent (sourcing, support or treasury) and its policy; a signature only with its terms"
        : sub === "/agents" ? `send the world's token, and a step if you like: ${AGENT_STEPS.join(", ")}`
        : sub === "/trick" ? `send the world's token and an attack: ${ATTACKS.join(" or ")}` : "send an empty JSON object" });
    }

    if (sub === "/world") return this.newWorld(url, req.headers.get("cf-connecting-ip") ?? "unknown", nowMs);
    const world = await this.worldOf(body.token);
    if (!world || world.expires <= this.now().getTime()) return gone();
    if (sub === "/passkey") return this.registerPasskey(url, ip, world, body);
    if (sub === "/quote") return this.newQuote(ip, world);
    if (sub === "/policy") return this.setPolicy(url, ip, world, body);
    // 1.3: a fixed attack through Purser's own fraud and injection code; no proposal, no quote.
    if (sub === "/trick") return this.trick(ip, world, body.attack as Attack);
    if (sub === "/agents") return this.agents(ip, world, body.step as AgentStep | undefined);
    return this.sign(url, ip, world, body);
  }

  private hits(ip: string, kind: string, since: number): number {
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_hits WHERE ip = ? AND kind = ? AND at > ?", ip, kind, since).toArray() as [{ n: number }];
    return n;
  }
  private hit(ip: string, kind: string, at: number): void {
    this.sql.exec("INSERT INTO ts_hits (ip, kind, at) VALUES (?, ?, ?)", ip, kind, at);
  }

  private dropWorld(id: string): void {
    this.sql.exec("DELETE FROM ts_creds WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_proposals WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_agent_runs WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_tricks WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_policy WHERE world = ?", id);
    this.sql.exec("DELETE FROM ts_worlds WHERE id = ?", id);
  }

  /** Expired worlds go (after an hour, or ten minutes without a passkey), with their passkeys and proposals; old hits too. */
  private purge(nowMs: number): void {
    const gone = this.sql.exec(`SELECT id FROM ts_worlds WHERE expires <= ? UNION SELECT id FROM ts_worlds w WHERE created <= ?
      AND NOT EXISTS (SELECT 1 FROM ts_creds c WHERE c.world = w.id) LIMIT 500`, nowMs, nowMs - TRY_SIGN_UNCLAIMED_MS).toArray() as { id: string }[];
    for (const { id } of gone) this.dropWorld(id);
    // Request counts matter for a minute, worlds and failures for an hour: nothing older is kept.
    this.sql.exec("DELETE FROM ts_hits WHERE kind IN ('req', 'req-net') AND at <= ?", nowMs - 60_000);
    this.sql.exec("DELETE FROM ts_hits WHERE at <= ?", nowMs - 3_600_000);
  }

  private async worldOf(token: unknown): Promise<WorldRow | null> {
    if (typeof token !== "string" || !TOKEN.test(token)) return null;
    const rows = this.sql.exec("SELECT id, expires, reg_challenge, balance, usd, created FROM ts_worlds WHERE token_hash = ?", await sha256Hex(token)).toArray() as WorldRow[];
    return rows[0] ?? null;
  }

  private proposals(worldId: string): (ProposalRow & { terms: unknown; checked: Check })[] {
    return (this.sql.exec("SELECT id, canonical, sha, check_json, status, execution FROM ts_proposals WHERE world = ? ORDER BY id", worldId).toArray() as ProposalRow[])
      .map((p) => ({ ...p, terms: JSON.parse(p.canonical) as unknown, checked: JSON.parse(p.check_json) as Check }));
  }

  /**
   * A live quote for a payment, within the limits (per address, and for everyone a minute and an hour). Over a limit,
   * or when the sandbox gives none, the last live quote is shared if it buys the same amount and still has time; else
   * there is none, and the page shows the main run's recorded quote, labelled as such. Never a made-up quote.
   */
  private async quoteFor(ip: string, buyAmount: string): Promise<FxStatus> {
    const nowMs = this.now().getTime();
    const shared = (): FxStatus | null => this.lastQuote && this.lastQuote.buy_amount === buyAmount && Date.parse(this.lastQuote.valid_to_at) - nowMs >= FX_REUSE_MIN_MS
      ? { status: "reused", quote: this.lastQuote } : null;
    if (!this.fx) return { status: "unavailable", reason: "this server has no Airwallex sandbox key" };
    if (this.hits(ip, "fx", nowMs - 3_600_000) >= TRY_SIGN_FX_PER_HOUR || this.hits("*", "fx-all", nowMs - 60_000) >= TRY_SIGN_FX_ALL_PER_MINUTE
      || this.hits("*", "fx-all", nowMs - 3_600_000) >= TRY_SIGN_FX_ALL_PER_HOUR) {
      return shared() ?? { status: "unavailable", reason: "many live quotes were asked for just now; try again in a minute" };
    }
    this.hit(ip, "fx", nowMs);
    this.hit("*", "fx-all", nowMs);
    try {
      const quote = await this.fx.quote({ buyCurrency: FX_PAIR.buy, sellCurrency: FX_PAIR.sell, buyAmount });
      if (Date.parse(quote.valid_to_at) <= this.now().getTime()) throw new QuoteUnavailable("the quote had already expired");
      if (quote.buy_amount !== buyAmount) throw new QuoteUnavailable("the quote was not for the amount asked");
      this.lastQuote = quote;
      return { status: "live", quote };
    } catch (e) {
      // A fixed reason only: never Airwallex's words, a key or a token (fxQuote.ts makes its reasons so).
      const reason = e instanceof QuoteUnavailable ? e.reason : "the Airwallex sandbox gave no quote";
      console.error("try-sign: no live FX quote:", reason);
      return shared() ?? { status: "unavailable", reason };
    }
  }

  /**
   * 1.3 and section 6: one fixed fake invoice, read live by the runner's invoice reader when it can be (the shared
   * daily budget, the per-address and overall limits, the 8 s timeout and the emergency switch), else its recorded
   * reading, then decided by Purser's code. Kept per world, so asking again costs nothing.
   */
  private async trick(ip: string, world: WorldRow, attack: Attack): Promise<Response> {
    const kept = (this.sql.exec("SELECT json FROM ts_tricks WHERE world = ? AND attack = ?", world.id, attack).toArray() as { json: string }[])[0];
    if (kept) return answer(200, { trick: JSON.parse(kept.json) as unknown });
    const live = await this.liveCall(ip, TRICK_RESERVE_USD, (r: InvoiceReadSource) => r(TRICKS[attack].text), this.reader);
    const result = await runTrick(attack, live, this.recorded?.tricks[attack] ?? null);
    this.sql.exec("INSERT OR REPLACE INTO ts_tricks (world, attack, json) VALUES (?, ?, ?)", world.id, attack, JSON.stringify(result));
    return answer(200, { trick: result });
  }

  /**
   * One live agent call under the page's shared rules (Max, 7 Nov): the emergency switch first (no request, no limit hit,
   * nothing kept aside); then today's budget (AGENT_LINE_DAILY_USD for every live call on this page together), the
   * overall per-minute and per-address per-hour limits; the cost settled after. Any failure is a reason, never thrown.
   */
  private async liveCall<S, T extends { costUsd: number }>(ip: string, reserveUsd: number, call: (source: S) => Promise<T>, source: S | "off" | null): Promise<T | { unavailable: string }> {
    if (source === "off") return { unavailable: SWITCHED_OFF };
    if (!source) return { unavailable: NO_MODEL_KEY };
    const nowMs = this.now().getTime();
    const day = this.now().toISOString().slice(0, 10);
    const spent = (this.sql.exec("SELECT usd FROM ts_spend WHERE day = ?", day).toArray() as { usd: number }[])[0]?.usd ?? 0;
    const add = (usd: number) => this.sql.exec("INSERT INTO ts_spend (day, usd) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd", day, usd);
    if (spent + reserveUsd > AGENT_LINE_DAILY_USD) return { unavailable: `today's USD ${AGENT_LINE_DAILY_USD.toFixed(2)} for live agents on this page is spent` };
    if (this.hits("*", "live-all", nowMs - 60_000) >= LIVE_ALL_PER_MINUTE || this.hits(ip, "live", nowMs - 3_600_000) >= LIVE_PER_HOUR) return { unavailable: "the live agents' limit for this minute (or for your address this hour) is reached" };
    this.hit("*", "live-all", nowMs);
    this.hit(ip, "live", nowMs);
    add(reserveUsd);
    try {
      const r = await call(source);
      add(r.costUsd - reserveUsd);
      return r;
    } catch {
      console.error("try-sign: a live agent call failed");
      return { unavailable: "the live agent did not answer in time, or not in the expected shape" };
    }
  }

  // ── The agents' steps (spec 6b) ──

  private agentRow(worldId: string): { step: number; busy: number; state: AgentState } | null {
    const r = (this.sql.exec("SELECT step, busy, json FROM ts_agent_runs WHERE world = ?", worldId).toArray() as { step: number; busy: number; json: string }[])[0];
    return r ? { step: r.step, busy: r.busy, state: JSON.parse(r.json) as AgentState } : null;
  }
  /** What the agents did on T-0002 so far, as the page shows it under "What the agents did". */
  private agentRecord(state: AgentState, step: number) {
    return {
      steps: AGENT_STEPS.slice(0, step), next: AGENT_STEPS[step] ?? null, calls: state.calls,
      reading: state.used ? { ...state.used.reading, source: state.used.source, label: state.used.label, note: state.used.note } : null,
      plan: state.plan ?? null, quote_id: state.quote && state.quote.status !== "unavailable" ? state.quote.quote.quote_id : null,
      advice: state.advice ?? null,
    };
  }

  /**
   * POST /agents: the next step on T-0002, one per request, strictly in order, its result kept, so the page builds the
   * timeline from real answers. A step already done answers its kept result again (name it); a later one than the next
   * is refused (409); while a step runs, another request gets 409 "busy" and the page asks again. Each step makes at
   * most its own outside call, within the shared budget and limits (liveCall, quoteFor).
   */
  private async agents(ip: string, world: WorldRow, want: AgentStep | undefined): Promise<Response> {
    const row = this.agentRow(world.id);
    if (!row) return answer(404, { error: "this test world has no agents' run" });
    const done = row.step;
    const next = AGENT_STEPS[done] ?? null;
    const kept = (name: AgentStep) => answer(200, { step: name, result: row.state.results[name], done: done >= AGENT_STEPS.length, next, agents: this.agentRecord(row.state, done),
      ...(name === "ready" ? this.policyAnswer(world.id, this.now()) : {}) });
    if (want && AGENT_STEPS.indexOf(want) < done) return kept(want);
    if (!next) return kept("ready");
    if (want && want !== next) return answer(409, { error: `the steps run in order: the next one is ${next}`, next });
    const nowMs = this.now().getTime();
    if (row.busy > nowMs) return answer(409, { error: "busy: the agents are on the previous step; ask again in a moment", busy: true, next });
    // The lease, before any await: a second request now finds the step busy.
    this.sql.exec("UPDATE ts_agent_runs SET busy = ? WHERE world = ? AND step = ?", nowMs + STEP_LEASE_MS, world.id, done);
    const state = row.state;
    let result: Record<string, unknown>;
    try {
      result = await this.runStep(next, ip, world, state);
    } catch (e) {
      this.sql.exec("UPDATE ts_agent_runs SET busy = 0 WHERE world = ?", world.id);
      throw e;
    }
    state.results[next] = result;
    // Written only if the world is still there and the step is still this one (no await from here on).
    const still = this.sql.exec("SELECT 1 FROM ts_worlds WHERE id = ? AND expires > ?", world.id, this.now().getTime()).toArray();
    if (!still.length) return answer(410, { error: "this test world expired; start a new one", expired: true });
    if (next === "ready") this.writeT2(world.id, state, result);
    this.sql.exec("UPDATE ts_agent_runs SET step = ?, busy = 0, json = ? WHERE world = ? AND step = ?", done + 1, JSON.stringify(state), world.id, done);
    // With the quote kept, the world's payments (T-0001, blocked by the floors) are checked again at its rate.
    if (next === "quote") this.recheck(world.id);
    const ran = next === "ready" ? this.runAlone(world.id) : [];
    return answer(200, { step: next, result: next === "ready" ? { ...result, proposal: this.viewOf(world.id, QUOTED) } : result, done: next === "ready", next: AGENT_STEPS[done + 1] ?? null,
      agents: this.agentRecord(state, done + 1), ...(next === "ready" ? { ...this.policyAnswer(world.id, this.now()), paid_alone: ran } : {}) });
  }

  private async runStep(step: AgentStep, ip: string, world: WorldRow, state: AgentState): Promise<Record<string, unknown>> {
    switch (step) {
      case "read": return this.stepRead(ip, state);
      case "check": return this.stepCheck(world, state);
      case "quote": return this.stepQuote(ip, world, state);
      case "advise": return this.stepAdvise(ip, world, state);
      case "ready": return this.stepReady(world, state);
    }
  }

  /** Step 1: Claude Sonnet reads the invoice (live; else its recorded reading; else none, and code reads it at step 2). */
  private async stepRead(ip: string, state: AgentState): Promise<Record<string, unknown>> {
    const live = await this.liveCall(ip, TRICK_RESERVE_USD, (r: InvoiceReadSource) => r(state.document), this.reader);
    const fromModel: InvoiceReadingLive | null = "value" in live ? live : null;
    const rec = !fromModel ? this.recorded?.invoice ?? null : null;
    const why = "unavailable" in live ? live.unavailable : null;
    const idOk = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : null);
    const fields = (r: Invoice) => ({ vendor: r.vendor, amount: r.amount, currency: r.currency, iban: r.iban, invoice_no: r.invoice_no, due_date: r.due_date });
    const lines = parseInvoiceFallback(state.document);
    const input = `invoice ${lines.invoice_no} (${state.document.split("\n").length} lines)`;
    if (fromModel) {
      const label = liveLabel(fromModel.model, "reader");
      state.read = { source: "live", reading: fromModel.value, note: null, label };
      state.calls.push({ step: "read_invoice", model: fromModel.model, request_id: idOk(fromModel.requestId), ms: fromModel.ms, input, output: `${fromModel.value.vendor} · ${eur(fromModel.value.amount)} · IBAN …${fromModel.value.iban.slice(-4)}` });
      return { by: label, source: "live", live: true, note: null, fields: fields(fromModel.value), model: fromModel.model, request_id: idOk(fromModel.requestId), ms: fromModel.ms, document: state.document };
    }
    if (rec) {
      state.read = { source: "recorded", reading: rec.reading, note: why, label: RECORDED_LABEL };
      state.calls.push({ step: "read_invoice", model: rec.model, request_id: rec.request_id, ms: rec.ms, input: `${input}, recorded ${rec.date}`, output: `${rec.reading.vendor} · ${eur(rec.reading.amount)} · IBAN …${rec.reading.iban.slice(-4)}` });
      return { by: RECORDED_LABEL, source: "recorded", live: false, note: why, fields: fields(rec.reading), model: rec.model, request_id: rec.request_id, ms: rec.ms, recorded_on: rec.date, document: state.document };
    }
    const label = `${READ_BY_CODE} · ${why ?? "no reading"}`;
    state.read = { source: "code", reading: null, note: why, label };
    state.calls.push({ step: "read_invoice", model: null, request_id: null, ms: null, input, output: `no answer (${why})` });
    return { by: label, source: "code", live: false, note: why, fields: fields(lines), model: null, request_id: null, ms: null, document: state.document };
  }

  /**
   * Step 2: Purser's code checks. The reading against the document's own lines (checkInvoiceReading; a reading that fails
   * is not used, code's own reading is, labelled); the payee against the allowlist and the text for planted
   * instructions (the runner's fraud and injection code; a blocking signal blocks T-0002); the amount against what the
   * agent may pay alone (above it, the CFO signs).
   */
  private async stepCheck(world: WorldRow, state: AgentState): Promise<Record<string, unknown>> {
    const lines = parseInvoiceFallback(state.document);
    const r = state.read!;
    const problem = r.reading ? checkInvoiceReading(r.reading, state.document) : "there was no reading";
    const usedModel = !!r.reading && !problem;
    const reading: Invoice = usedModel ? r.reading! : lines;
    const label = usedModel ? r.label : `${READ_BY_CODE} · ${r.source === "code" ? r.note ?? "no reading" : `the ${r.source === "recorded" ? "recorded " : ""}reading failed the check`}`;
    const note = usedModel ? r.note : r.reading ? `the reading failed the runner's check (${problem}), so code's reading of the document is used` : r.note;
    const all: Beneficiary[] = await Promise.all(TEST_ALLOWLIST.map(async (b) => ({ beneficiary_id: b.beneficiary_id, name: b.name, iban_last4: b.iban.slice(-4), iban_sha256: await ibanSha256(b.iban), bic: b.bic })));
    const finding = assessAgainst(all, reading, state.document, await ibanSha256(reading.iban));
    const injections = findInjections(state.document);
    const first = finding.signals.find((s) => s.blocks);
    const alone = rulesOf(this.policyOf(world.id).policy).alone_limit;
    const above = /^\d+\.\d{2}$/.test(reading.amount) && cents(reading.amount) > cents(alone);
    const ticks = [
      { id: "reading", ok: !problem, label: problem ? "The reading differs from the invoice: code's reading is used" : "The reading matches the invoice's own lines", detail: problem },
      { id: "allowlist", ok: !finding.blocked, label: finding.blocked ? `Payee not allowed: ${first?.detail ?? "blocked"}` : `${reading.vendor} is on the allowlist, IBAN …${reading.iban.slice(-4)}`, detail: first?.detail ?? null },
      { id: "planted", ok: injections.length === 0, label: injections.length ? "Planted instructions found in the invoice" : "No planted instructions in the invoice", detail: injections[0]?.excerpt ?? null },
      { id: "alone", ok: true, label: above ? `${eur(reading.amount)} is above the ${eur(alone)} the agent may pay alone: it goes to you` : `${eur(reading.amount)} is within the ${eur(alone)} the agent may pay alone`, detail: null },
    ];
    const blocked = finding.blocked ? (first?.detail ?? "Blocked by Purser's fraud check.") : injections.length ? `Planted instructions in the invoice: ${injections[0]!.excerpt}` : null;
    state.used = { reading, source: usedModel ? r.source : "code", label, note, blocked };
    const why = blocked ? `Blocked: ${blocked}` : `The reading ${problem ? "failed the check, so code's reading is used" : "matches the invoice"}; the payee is on the allowlist; no planted instructions.`;
    state.calls.push({ step: "check", model: null, request_id: null, ms: null, input: "the reading, the invoice's own lines, the allowlist", output: ticks.map((t) => `${t.ok ? "✓" : "✗"} ${t.label}`).join("; ") });
    return { by: CODE_LABEL, ticks, why, blocked, reading: { ...reading, source: state.used.source, label, note } };
  }

  /** Step 3: code plans the payment (planInvoice) and asks the Airwallex sandbox for a quote for exactly the shortfall. */
  private async stepQuote(ip: string, world: WorldRow, state: AgentState): Promise<Record<string, unknown>> {
    const used = state.used!;
    if (used.blocked) { state.quote = null; return { by: CODE_LABEL, skipped: "blocked", plan: null, fx: null }; }
    const bal = this.balancesOf(world.id);
    const rules = rulesOf(this.policyOf(world.id).policy);
    const before = checkPayment(used.reading.amount, bal, rules, { rate: this.rate ? rateOfRecord(this.rate) : null });
    const plan = before.plan!;
    // EUR already under its floor: nothing is planned, quoted or advised (planInvoice's "underfunded").
    if (!plan.buy && before.check === "fail") {
      state.plan = { ...plan, kind: "underfunded" };
      state.quote = null;
      state.calls.push({ step: "quote", model: null, request_id: null, ms: null, input: "the plan", output: before.rule });
      return { by: CODE_LABEL, plan, plan_words: before.rule, fx: null, underfunded: true };
    }
    const planWords = `Needed ${eur(plan.needed)} (invoice + ${eur(FEE_MAX)} fee ceiling). Free ${eur(plan.free)} above the floor. ${plan.buy ? `Code converts the ${eur(plan.buy)} short.` : "No FX needed."}`;
    if (!plan.buy) {
      state.plan = { ...plan, kind: "pay_from_eur" };
      state.quote = null;
      state.calls.push({ step: "quote", model: null, request_id: null, ms: null, input: planWords, output: "no FX needed" });
      return { by: CODE_LABEL, plan, plan_words: planWords, fx: null, no_fx: true };
    }
    const started = Date.now();
    let fx = await this.quoteFor(ip, plan.buy);
    // A quote that is not for code's shortfall is not used (the plan, not the quote, sets the amount).
    if (fx.status !== "unavailable" && fx.quote.buy_amount !== plan.buy) fx = { status: "unavailable", reason: "the quote was not for the shortfall" };
    state.quote = fx;
    const quote = fx.status !== "unavailable" ? fx.quote : null;
    const checked = checkPayment(used.reading.amount, bal, rules, { quote, rate: this.rate ? rateOfRecord(this.rate) : null });
    state.plan = { ...(checked.plan ?? plan), kind: "convert_shortfall" };
    const by = !quote ? `${CODE_LABEL} · no live quote` : quote.source === "stand-in" ? "stand-in quote, not Airwallex" : "Airwallex sandbox · live quote";
    state.calls.push({ step: "quote", model: quote ? (quote.source === "stand-in" ? "stand-in" : "Airwallex sandbox") : null, request_id: quote?.quote_id ?? null, ms: quote ? Date.now() - started : null,
      input: `buy ${eur(plan.buy)} for USD`, output: quote ? `${eur(quote.buy_amount)} for ${usd(quote.sell_amount)} at ${quote.client_rate}` : `no live quote (${fx.status === "unavailable" ? fx.reason : ""})` });
    const usdAfter = checked.plan?.sell ? money(cents(bal.usd) - cents(checked.plan.sell)) : null;
    return { by, plan: state.plan, plan_words: planWords, fx, check: checked.check, rule: checked.check === "fail" ? checked.rule : null,
      usd_line: usdAfter ? `USD after: ${usd(usdAfter)}, above the ${usd(rules.usd_floor)} floor.` : null };
  }

  /** The facts code gives the Treasury agent: the runner's TimingFacts, from this world's numbers. */
  private timingFacts(world: WorldRow, state: AgentState): TimingFacts | null {
    const r = state.used!.reading;
    const bal = this.balancesOf(world.id);
    const rules = rulesOf(this.policyOf(world.id).policy);
    const q = state.quote && state.quote.status !== "unavailable" ? state.quote.quote : null;
    const plan = state.plan!;
    const sell = q ? q.sell_amount : plan.sell;
    const buy = plan.buy;
    const freeAfter = money(cents(plan.free) + (buy ? cents(buy) : 0) - cents(plan.needed));
    const f: TimingFacts = {
      proposalId: QUOTED, invoiceNo: r.invoice_no, vendor: r.vendor, amount: r.amount,
      // The due date from the invoice's own line (code's), so a recorded reading cannot bring an old date.
      dueDate: parseInvoiceFallback(state.document).due_date, today: this.now().toISOString().slice(0, 10),
      eurAvailable: bal.eur, eurFloor: rules.reserve_floor, eurObligations: "0.00", usdAvailable: bal.usd, usdFloor: rules.usd_floor,
      quote: q ? { sell: `USD ${q.sell_amount}`, buy: `EUR ${q.buy_amount}`, rate: q.client_rate, validTo: q.valid_to_at } : null,
      after: { eurFree: freeAfter, usdAvailable: sell ? money(cents(bal.usd) - cents(sell)) : bal.usd }, feeMax: FEE_MAX,
    };
    // The agent quotes code's numbers word for word, so they must agree with the plan: the numbers the prompt derives
    // (licenceNumbers) are the plan's, or the agent is not asked (a negative or inconsistent figure is refused there).
    try {
      const n = licenceNumbers(f);
      if (n.needed !== plan.needed || n.freeBefore !== plan.free || n.shortfall !== plan.shortfall || (n.fxBuy ?? null) !== (q ? plan.buy : null)) return null;
    } catch { return null; }
    return f;
  }

  /**
   * Step 4: Claude Opus, the runner's Treasury timing agent, advises: live, within the budget, the limits, 8 s a call and
   * its deadline; else its recorded advice; else the fixed sentence. Whatever it is, code checks it before it is used:
   * the advice's bounds against today's facts, and its reason (one or two sentences, every amount one of code's numbers).
   */
  private async stepAdvise(ip: string, world: WorldRow, state: AgentState): Promise<Record<string, unknown>> {
    const fixed = fixedOf(QUOTED).says;
    if (state.used!.blocked) {
      state.advice = { source: "code", label: `${FIXED_TEXT} · the invoice is blocked`, says: "", advice: "none", timing: null, date: null, why: "the invoice is blocked", model: null, request_id: null };
      return { by: state.advice.label, skipped: "blocked", ...state.advice };
    }
    const notAsked = (why: string) => {
      state.advice = { source: "code", label: `${FIXED_TEXT} · ${why}`, says: fixed, advice: "none", timing: null, date: null, why, model: null, request_id: null };
      return { by: state.advice.label, ...state.advice };
    };
    if (state.plan?.kind === "underfunded") return notAsked("the EUR balance is below its floor, so nothing is planned");
    // A conversion with no live quote: nothing to advise on (and, with no agent to ask, the reason is that one).
    const needsQuote = !!state.plan?.buy && !(state.quote && state.quote.status !== "unavailable");
    if (needsQuote) return notAsked(this.advisor === "off" ? SWITCHED_OFF : !this.advisor ? NO_MODEL_KEY : "there is no live quote to advise on");
    const f = this.timingFacts(world, state);
    if (!f) return notAsked("code's numbers for this payment did not agree, so the agent was not asked");
    const alone = rulesOf(this.policyOf(world.id).policy).alone_limit;
    const extra = [cents(f.amount) > cents(alone) ? signatureLine(eur(alone)) : `At or below the ${eur(alone)} the agent may pay alone, so this payment needs no signature.`];
    const given = (date: string | null) => adviceGiven(f, alone, date ? [date] : []);
    const reasonCheck = (a: { timing: string; date: string | null; reason: string }) => strayRefusal(a.reason, given(a.date), f);
    const live = await this.liveCall(ip, ADVICE_RESERVE_USD, (ask: AgentAsk) => adviseTry(ask, f, extra, { deadlineMs: this.adviceDeadlineMs, reasonCheck }), this.advisor);
    const verdict = (a: { timing: "pay_now" | "wait_until"; date: string | null; reason: string }): { says: string } | { bad: string } => {
      const out = adviceOutOfBounds(f, a);
      if (out) return { bad: "its advice is outside code's bounds for today" };
      const c = checkReason(a.reason, given(a.date));
      return "says" in c ? c : { bad: c.bad === "shape" ? "its reason was not one or two plain sentences" : "an amount in its reason was not one of code's numbers" };
    };
    const adviceOf = (a: { timing: string; date: string | null }) => (a.timing === "wait_until" ? `wait_until ${a.date}` : "pay_now");
    let unavailable: string | null = null;
    let rejected: { timing: string; date: string | null; reason: string } | null = null;
    if ("advice" in live) {
      for (const c of live.calls) state.calls.push(this.callOf(c));
      if (live.advice) {
        const v = verdict(live.advice);
        const last = live.calls[live.calls.length - 1];
        if ("says" in v) {
          state.advice = { source: "live", label: liveLabel(live.model ?? "", "advice"), says: v.says, advice: adviceOf(live.advice), timing: live.advice.timing, date: live.advice.date, why: null, model: live.model, request_id: last?.request_id ?? null };
          // The facts code gave the agent (the test world's, nothing of the visitor's), with its calls: what the page shows
          // under "What the agents did", and what a recording keeps (src/cli/recordTryAgents.ts).
          return { by: state.advice.label, ...state.advice, calls: live.calls, facts: f, ms: live.ms };
        }
        unavailable = `the live advice was not used: ${v.bad}`;
        // Model output, not a secret: kept in the step's answer (the page does not show it; the recording script prints it).
        rejected = { timing: live.advice.timing, date: live.advice.date, reason: live.advice.reason.slice(0, 1000) };
      } else unavailable = live.why ?? "the agent did not advise";
    } else unavailable = live.unavailable;
    // The recorded advice, checked as a live one against today's facts (another quote's amounts do not pass).
    const rec = this.recorded?.advice ?? null;
    if (rec) {
      const v = verdict({ timing: rec.timing, date: rec.advised_date, reason: rec.reason });
      for (const c of rec.calls) state.calls.push({ step: "advise", model: c.model, request_id: c.request_id, ms: c.ms, input: `recorded ${rec.date}: ${c.tools.map((t) => t.name).join(", ") || "no tool"}`, output: c.tools.some((t) => t.name === "submit_advice") ? "advice" : "read" });
      if ("says" in v) {
        state.advice = { source: "recorded", label: RECORDED_LABEL, says: v.says, advice: adviceOf({ timing: rec.timing, date: rec.advised_date }), timing: rec.timing, date: rec.advised_date, why: unavailable, model: rec.model, request_id: rec.calls[rec.calls.length - 1]?.request_id ?? null };
        return { by: RECORDED_LABEL, ...state.advice, recorded_on: rec.date };
      }
      unavailable = `${unavailable}; the recorded advice was not used: ${v.bad}`;
    }
    state.advice = { source: "code", label: `${FIXED_TEXT} · ${unavailable}`, says: fixed, advice: "none", timing: null, date: null, why: unavailable, model: null, request_id: null };
    return { by: state.advice.label, ...state.advice, ...(rejected ? { rejected } : {}) };
  }
  private callOf(c: AdviceCall): AgentCall {
    return { step: "advise", model: c.model, request_id: c.request_id, ms: c.ms, input: c.tools.map((t) => t.name).join(", ") || "no tool", output: c.tools.map((t) => (t.name === "submit_advice" ? `${t.blocked ? `refused (${t.blocked})` : `advice: ${String(t.input.timing ?? "")}`}` : "read")).join(", ") || "no tool call" };
  }

  /** Who did what, in the terms (spec 6b): the reader, the adviser, and that amounts and checks are code's. */
  private static proposedBy(state: AgentState): string {
    const u = state.used!, a = state.advice!;
    const who = (src: Source, label: string) => (/^Claude (\w+)/.exec(label)?.[1] ?? (label.startsWith("stand-in") ? "a stand-in" : "Claude"));
    const read = u.source === "live" ? `invoice read by ${who(u.source, u.label) === "a stand-in" ? "a stand-in" : `Claude ${who(u.source, u.label)}`}` : u.source === "recorded" ? "invoice reading recorded from Claude Sonnet" : "invoice read by code";
    const advice = a.source === "live" ? `advice by ${who(a.source, a.label) === "a stand-in" ? "a stand-in" : `Claude ${who(a.source, a.label)}`}` : a.source === "recorded" ? "advice recorded from Claude Opus" : `no advice (${(a.why ?? "none").slice(0, 120)})`;
    return `Treasury agent (${read}, ${advice}; amounts and checks by code)`;
  }

  /** Step 5: the terms from the reading, the plan, the quote and the advice; T-0002 is written (writeT2) and checked. */
  private async stepReady(world: WorldRow, state: AgentState): Promise<Record<string, unknown>> {
    const r = state.used!.reading;
    const quote = state.quote && state.quote.status !== "unavailable" ? state.quote.quote : null;
    const expiresAt = new Date(world.expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    const terms = proposalTerms({ id: QUOTED, payee: `${r.vendor} (test payee)`, iban: r.iban, amount: r.amount, reference: `Invoice ${r.invoice_no}` }, world.id, expiresAt, quote, TrySignDesk.proposedBy(state), state.advice!.advice);
    const c = canonical(terms);
    const sha = await sha256Hex(c);
    state.calls.push({ step: "ready", model: null, request_id: null, ms: null, input: "the reading, the plan, the quote, the advice", output: `terms ${sha.slice(0, 12)}…` });
    return { by: CODE_LABEL, canonical: c, terms_sha256: sha };
  }
  /** T-0002's row, checked under the policy in force (synchronous: the step's write). Blocked when the invoice is. */
  private writeT2(worldId: string, state: AgentState, ready: Record<string, unknown>): void {
    if (this.sql.exec("SELECT 1 FROM ts_proposals WHERE world = ? AND id = ?", worldId, QUOTED).toArray().length) return;
    const terms = JSON.parse(String(ready.canonical)) as { amount: string; fx: FxQuote | null };
    const check: Check = state.used!.blocked ? { check: "fail", rule: `Blocked by Purser's fraud check: ${state.used!.blocked}` }
      : checkPayment(terms.amount, this.balancesOf(worldId), rulesOf(this.policyOf(worldId).policy), { quote: terms.fx, rate: this.rateFor(worldId) });
    this.sql.exec("INSERT INTO ts_proposals (world, id, canonical, sha, check_json, status, execution) VALUES (?, ?, ?, ?, ?, ?, NULL)", worldId, QUOTED, String(ready.canonical), String(ready.terms_sha256), JSON.stringify(check), check.check === "fail" ? "blocked" : "waiting");
  }

  /** A proposal as the page gets it, with its sentence and where that came from (T-0001 and T-0003: fixed text). */
  private view(worldId: string, p: ProposalRow & { checked: Check }) {
    const f = fixedOf(p.id);
    const run = p.id === QUOTED ? this.agentRow(worldId) : null;
    const a = run?.state.advice;
    const voice: Voice | null = a ? { source: a.source, label: a.label, model: a.model, request_id: a.request_id, why: a.why } : null;
    return { proposal_id: p.id, agent: f.agent, says: a?.says || f.says, voice, canonical: p.canonical, terms_sha256: p.sha, status: p.status, ...p.checked,
      ...(run ? { agents: this.agentRecord(run.state, run.step) } : {}),
      ...(p.execution ? { execution: JSON.parse(p.execution) as unknown } : {}) };
  }
  private viewOf(worldId: string, id: string) {
    const p = this.proposals(worldId).find((x) => x.id === id);
    return p ? this.view(worldId, p) : null;
  }

  /** The rate the checks use: T-0002's live quote's, else the main run's recorded rate (labelled), else none. */
  private rateFor(worldId: string): CheckRate | null {
    const run = this.agentRow(worldId);
    const q = run?.state.quote && run.state.quote.status !== "unavailable" ? run.state.quote.quote : null;
    return q ? rateOfQuote(q) : this.rate ? rateOfRecord(this.rate) : null;
  }

  /**
   * "Get a new quote": new terms with a new quote for the payment that waits and carries one (T-0002, or the next
   * invoice), for the shortfall the plan finds now, so it must be signed again. Before T-0002 is ready there is none.
   */
  private async newQuote(ip: string, world: WorldRow): Promise<Response> {
    const rules = rulesOf(this.policyOf(world.id).policy);
    const bal = this.balancesOf(world.id);
    // The payment that waits and carries a quote, or needs a conversion and has none (the sandbox gave none before).
    const planOf = (t: unknown) => checkPayment((t as { amount: string }).amount, bal, rules, { rate: this.rateFor(world.id) }).plan;
    const p = this.proposals(world.id).find((x) => x.status === "waiting" && x.checked.check === "pass" && ((x.terms as { fx?: unknown }).fx || planOf(x.terms)?.buy));
    if (!p) {
      const ready = this.proposals(world.id).some((x) => x.id === QUOTED);
      const ran = this.proposals(world.id).some((x) => x.status === "executed" && (x.terms as { fx?: unknown }).fx);
      return answer(409, { error: !ready ? "T-0002 is not ready yet: the agents are still preparing it" : ran ? "the payment with a quote is already signed and ran; there is nothing to quote again" : "no payment that needs a quote waits for a person in this test world" });
    }
    const t = p.terms as { [k: string]: TermsValue } & { amount: string };
    const plan = planOf(t);
    if (!plan?.buy) return answer(409, { error: `${p.id} needs no conversion now` });
    const fx = await this.quoteFor(ip, plan.buy);
    if (fx.status === "unavailable") return answer(503, { error: `no new live quote: ${fx.reason}`, fx });
    const c = canonical({ ...t, fx: { ...fx.quote } });
    const sha = await sha256Hex(c);
    // Written only while it still waits (no await between the read and the write): a signature that ran meanwhile wins.
    const still = (this.sql.exec("SELECT status FROM ts_proposals WHERE world = ? AND id = ?", world.id, p.id).toArray() as { status: string }[])[0];
    if (still?.status !== "waiting") return answer(409, { error: `${p.id} is already signed and ran; there is nothing to quote again` });
    this.sql.exec("UPDATE ts_proposals SET canonical = ?, sha = ? WHERE world = ? AND id = ?", c, sha, world.id, p.id);
    if (p.id === QUOTED) {
      const run = this.agentRow(world.id);
      if (run) { run.state.quote = fx; this.sql.exec("UPDATE ts_agent_runs SET json = ? WHERE world = ?", JSON.stringify(run.state), world.id); }
    }
    this.recheck(world.id);
    // Within what the agent may pay alone (a limit the visitor signed), the payment runs alone now that its quote is new.
    const alone = this.runAlone(world.id);
    const view = this.viewOf(world.id, p.id);
    if (alone.length) return answer(200, { proposal: view, fx, paid_alone: alone, ...this.policyAnswer(world.id, this.now()) });
    return answer(200, { proposal: view, fx });
  }

  private async newWorld(url: URL, address: string, nowMs: number): Promise<Response> {
    const ip = rateKey(address);
    const net = networkKey(address);
    const id = hex(random(8));
    const token = toB64u(random(32));
    const tokenHash = await sha256Hex(token);
    const challenge = toB64u(random(32));
    const expires = nowMs + TRY_SIGN_TTL_MS;
    const expiresAt = new Date(expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    // T-0001 opens blocked or waiting by the rules at the recorded rate (no quote yet; the quote step checks it again).
    // T-0002 is not written yet: the agents prepare it step by step (POST /agents). No outside call here.
    const t1 = FIXED_PROPOSALS[0]!;
    const check1 = checkPayment(t1.amount, TEST_BALANCES, TEST_RULES, { rate: this.rate ? rateOfRecord(this.rate) : null });
    const c1 = canonical(proposalTerms(t1, id, expiresAt));
    const sha1 = await sha256Hex(c1);
    const state: AgentState = { document: alpineInvoice(new Date(nowMs), this.invoiceAmount), results: {}, calls: [] };
    // No await from here on: the limits are checked and the world written together, so tries at once cannot pass both.
    if (this.hits(ip, "world", nowMs - 3_600_000) >= TRY_SIGN_WORLDS_PER_HOUR) return answer(429, { error: `${TRY_SIGN_WORLDS_PER_HOUR} test worlds an hour from one address; use the one you have, or wait` });
    if (this.hits(net, "world-net", nowMs - 3_600_000) >= TRY_SIGN_WORLDS_PER_NETWORK_HOUR) return answer(429, { error: "many test worlds this hour from your network; use the one you have, or wait" });
    const [{ n }] = this.sql.exec("SELECT COUNT(*) AS n FROM ts_worlds WHERE expires > ?", nowMs).toArray() as [{ n: number }];
    if (n >= TRY_SIGN_MAX_WORLDS) {
      // Full: the oldest world nobody made a passkey for makes room; only when every world has one, the visitor waits.
      const idle = (this.sql.exec("SELECT id FROM ts_worlds w WHERE NOT EXISTS (SELECT 1 FROM ts_creds c WHERE c.world = w.id) ORDER BY created LIMIT 1").toArray() as { id: string }[])[0];
      if (!idle) return answer(503, { error: "many test worlds are open right now; try again in a few minutes" });
      this.dropWorld(idle.id);
    }
    this.hit(ip, "world", nowMs);
    this.hit(net, "world-net", nowMs);
    this.sql.exec("INSERT INTO ts_worlds (id, token_hash, ip, created, expires, reg_challenge, balance, usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, tokenHash, ip, nowMs, expires, challenge, TEST_WORLD.balance, TEST_WORLD.usd_balance);
    this.sql.exec("INSERT INTO ts_proposals (world, id, canonical, sha, check_json, status, execution) VALUES (?, ?, ?, ?, ?, ?, NULL)", id, t1.id, c1, sha1, JSON.stringify(check1), check1.check === "fail" ? "blocked" : "waiting");
    this.sql.exec("INSERT INTO ts_agent_runs (world, step, busy, json) VALUES (?, 0, 0, ?)", id, JSON.stringify(state));
    const policy = defaultPolicy(new Date(nowMs), TEST_WORLD);
    this.sql.exec("INSERT INTO ts_policy (world, version, json) VALUES (?, 1, ?)", id, JSON.stringify(policy));
    return answer(201, {
      world: { id, token, expires_at: expiresAt, ...TEST_WORLD },
      agents: { steps: [], next: AGENT_STEPS[0], all: AGENT_STEPS },
      ...this.policyState(id, new Date(nowMs)),
      proposals: this.proposals(id).map((p) => this.view(id, p)),
      // WebAuthn options for the visitor's own passkey: a random user id, no name or e-mail of theirs; user verification
      // required; any authenticator (phone, laptop, security key, a phone over QR), so no authenticatorAttachment.
      passkey_options: {
        challenge, rp: { id: url.hostname, name: "Purser test world" },
        user: { id: toB64u(random(16)), name: "Purser test passkey", displayName: "Test passkey" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 120_000, attestation: "none",
        authenticatorSelection: { residentKey: "discouraged", userVerification: "required" },
      },
    });
  }

  private async registerPasskey(url: URL, ip: string, world: WorldRow, body: Record<string, unknown>): Promise<Response> {
    const c = body.credential;
    if (!isObj(c) || typeof c.id !== "string" || !B64URL.test(c.id) || c.id.length > 1024 || !isObj(c.response)
      || typeof c.response.clientDataJSON !== "string" || typeof c.response.attestationObject !== "string") return answer(400, { error: "malformed passkey" });
    if (world.reg_challenge === null) return answer(409, { error: "this test world already has its passkey" });
    // One use, whatever happens next (no await before this): a second create for the same world finds no challenge.
    this.sql.exec("UPDATE ts_worlds SET reg_challenge = NULL WHERE id = ?", world.id);
    const v = await verifyRegistration({ id: c.id, response: { clientDataJSON: c.response.clientDataJSON, attestationObject: c.response.attestationObject } },
      { challenge: world.reg_challenge, origin: url.origin, rpId: url.hostname });
    if (!v.ok) { this.hit(ip, "fail", this.now().getTime()); return answer(400, { error: `the new passkey did not verify (${v.why}); start a new test world`, why: v.why }); }
    // The world may have gone during the await (expired, or made room for a new visitor while it had no passkey yet):
    // then no passkey row is written, so none is left behind without its world.
    const still = this.sql.exec("SELECT 1 FROM ts_worlds WHERE id = ? AND expires > ?", world.id, this.now().getTime()).toArray();
    if (still.length === 0) return answer(410, { error: "this test world is gone (it expired, or made room while it had no passkey); start a new one", expired: true });
    this.sql.exec("INSERT INTO ts_creds (world, id, x, y, counter) VALUES (?, ?, ?, ?, ?)", world.id, c.id, v.key.x, v.key.y, v.counter);
    return answer(201, { passkey: { id: c.id }, world: { id: world.id } });
  }

  // ── Step 0: the world's policy (Max, item 1) ──

  /** 1.1: the worst case a policy allows, by Purser's own code (src/policy/exposure.ts), with the main run's rate. */
  private exposure(p: WorldPolicy) {
    const ep = exposurePolicyOfWorld(p);
    return exposureWords(exposureOf(ep), ep, this.rate);
  }
  /** The policy in force in this world, and its version (1 when the world opened). */
  private policyOf(worldId: string): { version: number; policy: WorldPolicy } {
    const row = (this.sql.exec("SELECT version, json FROM ts_policy WHERE world = ?", worldId).toArray() as { version: number; json: string }[])[0];
    return row ? { version: row.version, policy: JSON.parse(row.json) as WorldPolicy } : { version: 1, policy: defaultPolicy(this.now(), TEST_WORLD) };
  }
  private balancesOf(worldId: string): Balances {
    const r = (this.sql.exec("SELECT balance, usd FROM ts_worlds WHERE id = ?", worldId).toArray() as { balance: string; usd: string | null }[])[0];
    return { eur: r?.balance ?? TEST_WORLD.balance, usd: r?.usd ?? TEST_WORLD.usd_balance };
  }
  /** Checks a payment's terms as they are now: its amount, its own quote, the rate for the others. */
  private checkTerms(worldId: string, terms: unknown, bal: Balances, rules: PaymentRules): Check {
    const t = terms as { amount: string; fx?: FxQuote | null };
    return checkPayment(t.amount, bal, rules, { quote: t.fx ?? null, rate: this.rateFor(worldId) });
  }
  /** Each agent's three locks under a policy; the Treasury agent's with the world's payments checked under it. */
  private locksOf(worldId: string, policy: WorldPolicy, now: Date): Record<string, Locks> {
    const bal = this.balancesOf(worldId);
    const rows = this.proposals(worldId);
    return Object.fromEntries(AGENTS.map((a) => {
      const l = threeLocks(policy, a, now, worldId);
      if (a !== "treasury") return [a, l];
      // The world's payments as they are (T-0002 once ready, the next invoice once it has arrived).
      const payments = rows.map((r) => {
        const amount = (r.terms as { amount: string }).amount;
        return r.status === "executed"
          ? { proposal_id: r.id, amount, check: "executed", alone: (JSON.parse(r.execution ?? "{}") as { alone?: boolean }).alone === true }
          : { proposal_id: r.id, amount, ...this.checkTerms(worldId, r.terms, bal, rulesOf(policy)) };
      });
      return [a, { ...l, purser: { ...l.purser, payments } }];
    }));
  }
  /** What the page is told about the policy: the policy in force, its locks, and the world's payments under it. */
  private policyState(worldId: string, now: Date) {
    const { version, policy } = this.policyOf(worldId);
    // Screen 4's figure for each amount the visitor may choose (Max, 7 Nov: the worst case moves with "may pay alone").
    const withAlone = (v: string): WorldPolicy => ({ ...policy, agents: { ...policy.agents, treasury: { ...policy.agents.treasury, alone: v } } });
    const exposure_alone = Object.fromEntries(ALONE_CHOICES.map((v) => [v, this.exposure(withAlone(v)).headline]));
    // 1.4 (Max, 7 Nov): each amount's EUR worst case a month, in cents, and the one in force, so the page can say what a
    // looser rule adds ("+€139,500 a month") by Purser's code, not its own arithmetic.
    // The figure the words show: task cards apart (Max's decision A, EXPOSURE_TASK_CARDS), as in the headline.
    const monthOf = (p: WorldPolicy) => { const x = exposureOf(exposurePolicyOfWorld(p)); return x.total.month.eurCents - (EXPOSURE_TASK_CARDS === "apart" ? x.agents.find((e) => e.agent === "treasury")!.alone.monthEurCents : 0); };
    const exposure_month = { in_force: monthOf(policy), alone: Object.fromEntries(ALONE_CHOICES.map((v) => [v, monthOf(withAlone(v))])) };
    return { policy, policy_version: String(version), locks: this.locksOf(worldId, policy, now), bounds: policyBounds(now), exposure: this.exposure(policy), exposure_alone, exposure_month };
  }
  private policyAnswer(worldId: string, now: Date) {
    const state = this.policyState(worldId, now);
    const rules = rulesOf(state.policy);
    const bal = this.balancesOf(worldId);
    return { ...state, proposals: this.proposals(worldId).map((p) => this.view(worldId, p)), world: { balance: bal.eur, usd_balance: bal.usd, ...rules } };
  }
  /** Every payment that has not run, checked again against the balances and the policy in force. */
  private recheck(worldId: string): void {
    const rules = rulesOf(this.policyOf(worldId).policy);
    const bal = this.balancesOf(worldId);
    for (const p of this.proposals(worldId)) {
      if (p.status === "executed") continue;
      const c = this.checkTerms(worldId, p.terms, bal, rules);
      this.sql.exec("UPDATE ts_proposals SET check_json = ?, status = ? WHERE world = ? AND id = ?", JSON.stringify(c), c.check === "fail" ? "blocked" : "waiting", worldId, p.id);
    }
  }
  /** Writes the new policy only if no other change came first (no await from the caller's last read to here). */
  private applyPolicy(worldId: string, version: number, next: WorldPolicy, extra: Record<string, unknown>, signedSha: string | null): Response {
    const now = this.policyOf(worldId).version;
    if (now !== version) return answer(200, { applied: false, why: "stale", reason: "Refused: the policy changed meanwhile, so these are not its terms any more. Nothing changed; try again.", ...this.policyAnswer(worldId, this.now()) });
    this.sql.exec("UPDATE ts_policy SET version = ?, json = ?, signed_sha = COALESCE(?, signed_sha) WHERE world = ? AND version = ?", version + 1, JSON.stringify(next), signedSha, worldId, version);
    this.recheck(worldId);
    const alone = this.runAlone(worldId);
    return answer(200, { ...extra, paid_alone: alone, ...this.policyAnswer(worldId, this.now()) });
  }

  /**
   * What a payment does to the balances, by the stand-in: EUR + the conversion's buy - the amount; USD - its sell (at
   * the payment's own quote, else the rate the check used). The stand-in charges no SWIFT fee; the fee ceiling the plan
   * reserved stays in the balance.
   */
  private static executed(amount: string, bal: Balances, c: Check & { check: "pass" }) {
    const buy = c.plan.buy ? cents(c.plan.buy) : 0, sell = c.plan.sell ? cents(c.plan.sell) : 0;
    return {
      balance_after: money(cents(bal.eur) + buy - cents(amount)), usd_after: money(cents(bal.usd) - sell),
      fx_bought: c.plan.buy, fx_sold: c.plan.sell, fx_rate_from: c.plan.rate_from,
      fee: `The stand-in charges no SWIFT fee; the ${eur(FEE_MAX)} fee ceiling the plan reserved stays in the balance.`,
    };
  }

  /**
   * Payments within what the agent may pay alone run without a signature (Max, 6 Nov), by the same stand-in executor and
   * after the same checks a signed payment gets at the moment it runs: the world has not expired; fewer than
   * ALONE_PER_DAY ran alone in the last 24 hours (aloneRoom); it has not run; the floors hold on the balances now; its
   * amount is at or below the "may pay alone" limit in force (which only a policy the visitor signed can raise above the
   * world's EUR 500.00, and no payment here is that small); its quote, if it has one, is still valid (else it waits for
   * a new quote, and runs alone then). It is bound to its terms by their SHA-256 (stored with them) and to the signed
   * policy change that allowed it. One at a time, the balances read again after each; synchronous, with no await
   * between the reads and the writes. Returns the ids it ran.
   */
  private runAlone(worldId: string): string[] {
    const ran: string[] = [];
    for (;;) {
      const nowMs = this.now().getTime();
      const w = (this.sql.exec("SELECT expires FROM ts_worlds WHERE id = ?", worldId).toArray() as { expires: number }[])[0];
      if (!w || w.expires <= nowMs) return ran;
      const bal = this.balancesOf(worldId);
      const pol = (this.sql.exec("SELECT version, json, signed_sha FROM ts_policy WHERE world = ?", worldId).toArray() as { version: number; json: string; signed_sha: string | null }[])[0];
      if (!pol) return ran;
      const rules = rulesOf(JSON.parse(pol.json) as WorldPolicy);
      const done = (this.sql.exec("SELECT execution FROM ts_proposals WHERE world = ? AND status = 'executed'", worldId).toArray() as { execution: string | null }[]).map((r) => JSON.parse(r.execution ?? "{}") as { alone?: boolean; at?: string });
      if (!aloneRoom(done, nowMs)) return ran;
      let checked: (Check & { check: "pass" }) | null = null;
      const next = this.proposals(worldId).find((p) => {
        if (p.status !== "waiting") return false;
        const c = this.checkTerms(worldId, p.terms, bal, rules);
        if (c.check !== "pass" || c.waits !== "") return false;
        const quote = (p.terms as { fx?: { valid_to_at?: string } | null }).fx;
        if (quote && !(Date.parse(String(quote.valid_to_at)) > nowMs)) return false;
        checked = c;
        return true;
      });
      if (!next || !checked) return ran;
      const t = next.terms as { amount: string; payee: string; fx?: { quote_id?: string } | null };
      const execution = {
        id: `test-${hex(random(6))}`, at: new Date(nowMs).toISOString(), amount: t.amount, currency: TEST_WORLD.currency, payee: t.payee,
        ...TrySignDesk.executed(t.amount, bal, checked), fx_quote_id: t.fx?.quote_id ?? null,
        by: "stand-in executor: recorded in this test world only; nothing paid or converted at Airwallex, no Metal call",
        alone: true, label: PAID_ALONE, rule: `at or below the ${eur(rules.alone_limit)} the agent may pay alone`,
        terms_sha256: next.sha, policy_version: String(pol.version), policy_change_sha256: pol.signed_sha,
      };
      this.sql.exec("UPDATE ts_proposals SET status = 'executed', execution = ? WHERE world = ? AND id = ? AND status = 'waiting'", JSON.stringify(execution), worldId, next.id);
      this.sql.exec("UPDATE ts_worlds SET balance = ?, usd = ? WHERE id = ?", execution.balance_after, execution.usd_after, worldId);
      this.recheck(worldId);
      ran.push(next.id);
    }
  }

  /**
   * The agent's next invoice (T-0003), once T-0002 is signed: it needs FX too, so code plans it and asks for a second
   * live quote for its shortfall (within the quote limits; without one it is checked at the recorded rate, labelled);
   * written once, checked under the policy in force against the balances now (blocked, or waiting for a person), then any
   * payment within what the agent may pay alone runs (runAlone). Returns the ids that ran alone. The quote and the hash
   * come first; from the read to the writes no await.
   */
  private async nextInvoice(worldId: string, ip: string): Promise<string[]> {
    const w = (this.sql.exec("SELECT expires FROM ts_worlds WHERE id = ?", worldId).toArray() as { expires: number }[])[0];
    if (!w) return [];
    if ((this.sql.exec("SELECT 1 FROM ts_proposals WHERE world = ? AND id = ?", worldId, NEXT_INVOICE.id).toArray()).length) return [];
    const rules = rulesOf(this.policyOf(worldId).policy);
    const plan = checkPayment(NEXT_INVOICE.amount, this.balancesOf(worldId), rules, { rate: this.rateFor(worldId) }).plan;
    const fx = plan?.buy ? await this.quoteFor(ip, plan.buy) : null;
    const quote = fx && fx.status !== "unavailable" ? fx.quote : null;
    const expiresAt = new Date(w.expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    const c = canonical(proposalTerms(NEXT_INVOICE, worldId, expiresAt, quote));
    const sha = await sha256Hex(c);
    if ((this.sql.exec("SELECT 1 FROM ts_proposals WHERE world = ? AND id = ?", worldId, NEXT_INVOICE.id).toArray()).length) return [];
    const check = checkPayment(NEXT_INVOICE.amount, this.balancesOf(worldId), rulesOf(this.policyOf(worldId).policy), { quote, rate: this.rateFor(worldId) });
    this.sql.exec("INSERT INTO ts_proposals (world, id, canonical, sha, check_json, status, execution) VALUES (?, ?, ?, ?, ?, ?, NULL)", worldId, NEXT_INVOICE.id, c, sha, JSON.stringify(check), check.check === "fail" ? "blocked" : "waiting");
    return this.runAlone(worldId);
  }

  /**
   * A change to the world's policy. Read whole and checked (src/try/policy.ts readSet); compared field by field with the
   * policy in force. Only stricter: applied at once. Any field looser: refused, with the exact terms of the change to
   * sign (an answer, 200, not an error); with the visitor's signature over exactly those terms, verified as a payment's
   * is (the D20 verifier, this world's passkey, challenge = their SHA-256), applied. Nothing is sent anywhere. Before
   * T-0002 is ready the payments checked are the ones the world has; T-0002 is checked under the policy in force when
   * it is written.
   */
  private async setPolicy(url: URL, ip: string, world: WorldRow, body: Record<string, unknown>): Promise<Response> {
    const now = this.now();
    const agent = body.agent as Agent;
    const read = readSet(body.set, now);
    if (!read.ok) return answer(400, { error: `${read.error}. Nothing changed.`, applied: false });
    const cur = this.policyOf(world.id);
    const changes = policyChanges(cur.policy, agent, read.set);
    if (changes.length === 0) return answer(200, { applied: false, why: "no_change", reason: "Nothing changed: these are the values in force.", ...this.policyAnswer(world.id, now) });
    const next = withSet(cur.policy, agent, read.set);
    const looser = changes.filter((c) => c.looser).map((c) => c.field);
    const expiresAt = new Date(world.expires).toISOString().replace(/\.\d{3}Z$/, "Z");
    const terms = canonical(policyTerms(world.id, agent, cur.version, changes, next, expiresAt));
    const sha = await sha256Hex(terms);
    if (looser.length === 0) return this.applyPolicy(world.id, cur.version, next, { applied: true, signed: false, changes, reason: "Stricter: applied at once. A stricter policy needs no signature." }, null);
    if (body.credential === undefined) {
      const which = looser.map((f) => FIELD_WORDS[f].toLowerCase()).join(", ");
      return answer(200, {
        applied: false, needs_signature: true, looser, changes, canonical: terms, terms_sha256: sha, proposed: this.locksOf(world.id, next, now), proposed_exposure: this.exposure(next),
        reason: `Refused: this change makes the policy looser (${which}), and a looser policy needs your passkey's signature over its exact terms, as the CFO's does in Purser. Nothing changed.`,
        ...(looser.includes("alone") ? { alone_effect: agent === "treasury"
          ? `Signing lets the Treasury agent pay alone up to ${eur(next.agents.treasury.alone)}: a payment in this test world at or below it then runs without your signature.`
          : `Signing lets this agent pay alone up to ${eur(next.agents[agent].alone)}. This test world's payments are the Treasury agent's, so none of them runs alone because of it.` } : {}),
        ...this.policyAnswer(world.id, now),
      });
    }
    // Signed: this world's passkey, over exactly these terms.
    const sent = String(body.canonical);
    const credential = body.credential as { id: string; response: Record<string, unknown> };
    const cred = (this.sql.exec("SELECT id, x, y, counter FROM ts_creds WHERE world = ? AND id = ?", world.id, credential.id).toArray() as CredRow[])[0];
    if (!cred) {
      this.hit(ip, "fail", now.getTime());
      return answer(403, { error: "this passkey is not this test world's: it signs no policy here", verified: false, why: "unknown passkey", applied: false });
    }
    const r = credential.response;
    const sentSha = await sha256Hex(sent);
    const v = await verifyAssertion({ authenticatorData: String(r.authenticatorData ?? ""), clientDataJSON: String(r.clientDataJSON ?? ""), signature: String(r.signature ?? "") },
      { x: cred.x, y: cred.y }, { challenge: hexToB64u(sentSha), origin: url.origin, rpId: url.hostname, lastCounter: cred.counter });
    const refuse = (why: string, reason: string) => {
      this.hit(ip, "fail", this.now().getTime());
      return answer(200, { applied: false, verified: false, why, reason, error: reason, ...this.policyAnswer(world.id, this.now()) });
    };
    if (!v.ok) return refuse(v.why, `Refused: the server's verifier did not accept this signature (${v.why === "challenge" ? "it was made for other terms" : v.why}). Nothing changed.`);
    if (sent !== terms) return refuse("terms", "Refused: the signature is not over the terms of this change (another change, or the policy has moved since). Nothing changed.");
    const latest = (this.sql.exec("SELECT counter FROM ts_creds WHERE world = ? AND id = ?", world.id, cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    if ((v.counter !== 0 || latest !== 0) && v.counter <= latest) return refuse("counter", "Refused: the signature counter did not move forward (a replay). Nothing changed.");
    const w = (this.sql.exec("SELECT expires FROM ts_worlds WHERE id = ?", world.id).toArray() as { expires: number }[])[0];
    if (!w || w.expires <= this.now().getTime()) return answer(410, { error: "this test world expired while signing; start a new one", expired: true, applied: false });
    if (this.policyOf(world.id).version !== cur.version) return refuse("stale", "Refused: the policy changed meanwhile, so these are not its terms any more. Nothing changed.");
    this.sql.exec("UPDATE ts_creds SET counter = ? WHERE world = ? AND id = ?", v.counter, world.id, cred.id);
    return this.applyPolicy(world.id, cur.version, next, { applied: true, signed: true, verified: true, changes, terms_sha256: sha, reason: "Signed and verified: the looser policy holds in your test world." }, sha);
  }

  private async sign(url: URL, ip: string, world: WorldRow, body: Record<string, unknown>): Promise<Response> {
    const { proposal_id, canonical: terms, credential } = body;
    if (typeof proposal_id !== "string" || typeof terms !== "string" || terms.length > MAX_TERMS || !isObj(credential) || typeof credential.id !== "string" || !isObj(credential.response)) {
      return answer(400, { error: "malformed signature" });
    }
    const p = this.proposals(world.id).find((x) => x.id === proposal_id);
    if (!p && proposal_id === QUOTED) return answer(409, { error: "T-0002 is not ready yet: the agents are still preparing it; nothing to sign", not_ready: true, verified: false });
    if (!p) return answer(404, { error: `no proposal ${proposal_id} in this test world` });
    // A proposal that fails a check has nothing to sign: no signature, however good, runs it.
    if (p.checked.check === "fail") return answer(409, { error: `blocked by a rule: ${p.checked.rule} No signature can approve it.`, blocked: true, rule: p.checked.rule, verified: false });
    const cred = (this.sql.exec("SELECT id, x, y, counter FROM ts_creds WHERE world = ? AND id = ?", world.id, credential.id).toArray() as CredRow[])[0];
    if (!cred) {
      this.hit(ip, "fail", this.now().getTime());
      return answer(403, { error: "this passkey is not this test world's: a passkey from another world, or a real one, signs nothing here", verified: false, why: "unknown passkey" });
    }
    const r = credential.response;
    const sha = await sha256Hex(terms);
    let signed: string | null = null;
    try {
      const cd = JSON.parse(new TextDecoder().decode(fromB64u(String(r.clientDataJSON ?? "")))) as { challenge?: unknown };
      signed = typeof cd.challenge === "string" ? hex(fromB64u(cd.challenge)) : null;
    } catch { signed = null; }
    const v = await verifyAssertion({ authenticatorData: String(r.authenticatorData ?? ""), clientDataJSON: String(r.clientDataJSON ?? ""), signature: String(r.signature ?? "") },
      { x: cred.x, y: cred.y }, { challenge: hexToB64u(sha), origin: url.origin, rpId: url.hostname, lastCounter: cred.counter });
    if (!v.ok) {
      this.hit(ip, "fail", this.now().getTime());
      const why = v.why === "challenge" ? `the signature was made for ${signed && /^[0-9a-f]{64}$/.test(signed) ? `hash ${signed.slice(0, 12)}…` : "other terms"}; these terms hash to ${sha.slice(0, 12)}…` : v.why;
      // A refused signature is an answer, not an error (A6): 200 with verified false and the reason, so the page shows
      // it without the browser logging a failed request. Malformed requests and limits stay 4xx.
      const reason = `refused: the server's verifier did not accept this signature (${why})`;
      return answer(200, { verified: false, reason, error: reason, why: v.why, terms_sha256: sha, signed_sha256: signed });
    }
    // Read again after the awaits above: the terms may have moved (a new quote) since the page fetched them.
    const now = this.now().getTime();
    const fresh = (this.sql.exec("SELECT status, canonical, execution FROM ts_proposals WHERE world = ? AND id = ?", world.id, p.id).toArray() as { status: string; canonical: string }[])[0];
    const w = (this.sql.exec("SELECT expires FROM ts_worlds WHERE id = ?", world.id).toArray() as { expires: number }[])[0];
    if (!fresh || !w || w.expires <= now) return answer(410, { error: "this test world expired while signing; start a new one", expired: true, verified: false });
    if (fresh.status !== "waiting" && terms === p.canonical) return answer(409, { error: `refused: ${p.id} already ran once; a replayed signature runs nothing`, verified: true, why: "replay", terms_sha256: sha });
    if (terms !== fresh.canonical) {
      this.hit(ip, "fail", this.now().getTime());
      const reason = "refused: these are not this proposal's terms";
      return answer(200, { verified: false, reason, error: reason, why: "terms", terms_sha256: sha });
    }
    if (fresh.status !== "waiting") return answer(409, { error: `refused: ${p.id} already ran once; a replayed signature runs nothing`, verified: true, why: "replay", terms_sha256: sha });
    // The quote is part of what was signed, and it has an end: after it, even a good signature runs nothing.
    const quote = (p.terms as { fx?: { valid_to_at?: string } | null }).fx;
    if (quote && !(Date.parse(String(quote.valid_to_at)) > now)) {
      return answer(409, { error: "Quote expired. Get a fresh one and sign again.", expired_at: String(quote.valid_to_at), verified: true, why: "quote_expired", quote_expired: true, terms_sha256: sha });
    }
    const latest = (this.sql.exec("SELECT counter FROM ts_creds WHERE world = ? AND id = ?", world.id, cred.id).toArray() as { counter: number }[])[0]?.counter ?? 0;
    if ((v.counter !== 0 || latest !== 0) && v.counter <= latest) {
      const reason = "refused: the signature counter did not move forward (a replay)";
      return answer(200, { verified: false, reason, error: reason, why: "counter" });
    }
    const amount = (p.terms as { amount: string }).amount;
    const bal = this.balancesOf(world.id);
    const again = this.checkTerms(world.id, p.terms, bal, rulesOf(this.policyOf(world.id).policy));
    if (again.check === "fail") return answer(409, { error: `blocked by a rule: ${again.rule}`, blocked: true, verified: true });
    const execution = {
      id: `test-${hex(random(6))}`, at: new Date(now).toISOString(), amount, currency: TEST_WORLD.currency, payee: (p.terms as { payee: string }).payee,
      ...TrySignDesk.executed(amount, bal, again), fx_quote_id: (quote as { quote_id?: string } | null | undefined)?.quote_id ?? null, by: "stand-in executor: recorded in this test world only; nothing paid or converted at Airwallex, no Metal call",
    };
    this.sql.exec("UPDATE ts_creds SET counter = ? WHERE world = ? AND id = ?", v.counter, world.id, cred.id);
    this.sql.exec("UPDATE ts_proposals SET status = 'executed', execution = ? WHERE world = ? AND id = ?", JSON.stringify(execution), world.id, p.id);
    this.sql.exec("UPDATE ts_worlds SET balance = ?, usd = ? WHERE id = ?", execution.balance_after, execution.usd_after, world.id);
    // The other payments are checked again against the new balances (under the world's policy).
    this.recheck(world.id);
    // Signed T-0002: the agent's next invoice arrives, with its own quote, checked under the policy in force (and run alone if within it).
    const next = p.id === QUOTED ? await this.nextInvoice(world.id, ip) : [];
    // The public key it verified against (public by nature: it can check signatures, never make one), so the page can
    // hand the visitor a receipt anyone can verify offline (npm run verify-receipt).
    return answer(200, {
      verified: true, checks: ["signature (ES256)", "challenge = the terms' SHA-256", "origin", "RP id", "user present", "user verified", "counter"], terms_sha256: sha, executed: execution,
      public_key: { kty: "EC", crv: "P-256", x: cred.x, y: cred.y }, algorithm: "ES256", ...(next.length ? { paid_alone: next } : {}),
      // The world as it is now (the next invoice among its payments), as a policy answer gives it.
      ...this.policyAnswer(world.id, this.now()),
    });
  }
}
