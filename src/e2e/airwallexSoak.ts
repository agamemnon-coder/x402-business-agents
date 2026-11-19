// The Airwallex live soak (19 Nov, `npm run airwallex:soak`): 30 supplier payments through Purser's own pipeline against
// the Airwallex sandbox, with test money, and 5 negative controls. Each payment is planned by the treasury agent's code
// (proposeInvoicePayment: the balance read, and for a shortfall a rate check and a locked quote for the shortfall only),
// signed over its exact terms by a labelled virtual test passkey (no person's Face ID), executed by the invoice payment
// executor (the conversion on the signed quote, then POST /transfers/create with metadata.approval_sha256), taken to PAID
// by the sandbox's simulation endpoint (simulated: the sandbox does not settle by itself), then READ BACK from Airwallex
// (GET /transfers/{id}; for a conversion, GET /fx/conversions by request_id) and compared with the signed terms.
// A negative control is planned and signed the same way, then its stored terms are changed by one cent: the executor must
// refuse it before any create, and the calls made between the change and the refusal are counted from the call log.
//
// The plan, the comparisons, the aggregates and the record's Markdown are pure functions here (tested); runSoak drives a
// rail (the live adapter, or the in-memory stand-in) and never approves anything at Airwallex.

import { approvalOrigin } from "../executors/index.js";
import { executeInvoicePayment, type FeeRetry } from "../executors/invoicePayment.js";
import { proposeInvoicePayment } from "../agents/euroBill.js";
import { ibanSha, parseInvoiceFallback } from "../agents/invoice.js";
import { LICENSOR, MANUFACTURER } from "../config/payees.js";
import { cents } from "../airwallex/adapter.js";
import type { AirwallexRail, SandboxSim } from "../airwallex/port.js";
import type { CallLine } from "../airwallex/callBudget.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../passkey/ledger.js";
import { processAssertion, processRegistration } from "../passkey/process.js";
import { challengeFor } from "../passkey/webauthn.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
import { FakeAuthenticator } from "../redteam/authenticator.js";
import { setSetting } from "../world/settings.js";

export type Rail = AirwallexRail & SandboxSim;
export const SOAK_PASSKEY_LABEL = "airwallex-soak virtual test passkey";
export const SOAK_COMMAND: Origin = { actor: "cfo-command", command: "npm run airwallex:soak", moves_money: false };
/** The most Airwallex calls a live soak may make (every HTTP request counts, logins and retries too). */
export const SOAK_MAX_BUDGET = 450;
/** EUR kept untouched under the soak's payments (the treasury floor of this run's ledger). */
export const SOAK_EUR_FLOOR = "1000.00";
/** For a payment marked FX, the free EUR left before it is planned: the rest is the shortfall, bought from USD. */
export const SOAK_FX_FREE_EUR = "10.00";
const RP = "airwallex-soak.virtual-passkey.invalid";
const ORIGIN = `https://${RP}`;

export type PayeeKey = "bergtex" | "stockline";
const PAYEES = {
  bergtex: { ...MANUFACTURER, prefix: "BTX-SOAK", address: "Textilweg 4, 72760 Reutlingen, Germany", line: "Production lot, soak test" },
  // Stockline's licence fee is a contract in code (EUR 240.00, src/agents/invoice.ts offContract): its amount never varies.
  stockline: { ...LICENSOR, prefix: "SLL-SOAK", address: "Datenallee 12, 10115 Berlin, Germany", line: "Data licence, soak test" },
} as const;

export interface SoakPayment { n: number; payee: PayeeKey; amount: string; fx: boolean; why: string }
export type Tamper = "amount +0.01" | "amount -0.01" | "amount +0.01, terms_sha256 column recomputed" | "fee_max +0.01" | "conversion.buy_amount +0.01";
export interface SoakNegative { n: number; payee: PayeeKey; amount: string; fx: boolean; tamper: Tamper; after: number }

const p = (n: number, payee: PayeeKey, amount: string, why: string, fx = false): SoakPayment => ({ n, payee, amount, fx, why });
/** The 30 payments: two payees, small, odd-cent and large amounts, six of them with a USD to EUR conversion of the shortfall. */
export const SOAK_PAYMENTS: readonly SoakPayment[] = [
  p(1, "bergtex", "1.00", "small"), p(2, "stockline", "240.00", "licence (contract amount)"), p(3, "bergtex", "2.50", "small"),
  p(4, "bergtex", "19.99", "small, odd cents"), p(5, "bergtex", "33.33", "odd cents", true), p(6, "bergtex", "101.01", "odd cents"),
  p(7, "stockline", "240.00", "licence", true), p(8, "bergtex", "7.01", "small, odd cents"), p(9, "bergtex", "123.45", "odd cents"),
  p(10, "bergtex", "1850.00", "large", true), p(11, "bergtex", "277.77", "odd cents"), p(12, "stockline", "240.00", "licence"),
  p(13, "bergtex", "404.04", "odd cents"), p(14, "bergtex", "2500.00", "large"), p(15, "bergtex", "555.55", "odd cents", true),
  p(16, "bergtex", "10.00", "small"), p(17, "stockline", "240.00", "licence"), p(18, "bergtex", "678.91", "odd cents"),
  p(19, "bergtex", "3333.33", "large, odd cents"), p(20, "bergtex", "999.99", "odd cents"), p(21, "stockline", "240.00", "licence", true),
  p(22, "bergtex", "4999.99", "large, odd cents"), p(23, "bergtex", "12.34", "small, odd cents"), p(24, "bergtex", "1234.57", "odd cents"),
  p(25, "bergtex", "66.67", "odd cents"), p(26, "stockline", "240.00", "licence"), p(27, "bergtex", "2765.43", "large, odd cents", true),
  p(28, "bergtex", "88.88", "odd cents"), p(29, "bergtex", "6543.21", "large, odd cents"), p(30, "bergtex", "5.05", "small, odd cents"),
];

/** The 5 negative controls, each after the payment it names: one cent changed in the stored terms after signing. */
export const SOAK_NEGATIVES: readonly SoakNegative[] = [
  { n: 1, payee: "bergtex", amount: "150.00", fx: false, tamper: "amount +0.01", after: 6 },
  { n: 2, payee: "bergtex", amount: "75.25", fx: false, tamper: "amount -0.01", after: 12 },
  { n: 3, payee: "bergtex", amount: "310.10", fx: false, tamper: "amount +0.01, terms_sha256 column recomputed", after: 18 },
  { n: 4, payee: "stockline", amount: "240.00", fx: false, tamper: "fee_max +0.01", after: 24 },
  { n: 5, payee: "bergtex", amount: "420.42", fx: true, tamper: "conversion.buy_amount +0.01", after: 30 },
];

const spaced = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();
const display = (amount: string) => Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The invoice a payee would send for this payment, in the fixtures' layout (fixtures/bergtex-invoice-BTX-2026-11.txt). */
export function soakInvoiceText(payee: PayeeKey, invoiceNo: string, amount: string): string {
  const x = PAYEES[payee];
  const amt = `EUR ${display(amount)}`;
  return [
    x.name, x.address, "", `INVOICE ${invoiceNo}`, "Date: 19 November 2026", "Due date: 3 December 2026", "", "Bill to: Northwind Outdoor", "",
    "Description                                   Amount", `${x.line.padEnd(46)}${amt}`, "", `Total due                                     ${amt}`, "",
    "Pay by SWIFT to:", `Account name: ${x.name}`, `IBAN: ${spaced(x.iban)}`, `BIC: ${x.bic}`, `Payment reference: ${invoiceNo}`, "",
  ].join("\n");
}
export const soakInvoiceNo = (payee: PayeeKey, n: number, negative = false) => `${PAYEES[payee].prefix}-${negative ? "N" : ""}${String(n).padStart(2, "0")}`;

/** Changes the stored terms of a signed proposal by one cent, as the tamper names; the approval row is never touched. */
export function tamperTerms(db: DB, proposalId: string, tamper: Tamper): { field: string; from: string; to: string } {
  const row = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string };
  const t = JSON.parse(row.terms_json) as Record<string, unknown> & { amount: string; fee_max: string; conversion: null | { buy_amount: string } };
  const bump = (v: string, d: number) => fromCents(toCents(v) + d);
  let field: string, from: string, to: string;
  if (tamper.startsWith("amount")) { field = "amount"; from = t.amount; to = bump(t.amount, tamper.startsWith("amount -") ? -1 : 1); t.amount = to; }
  else if (tamper === "fee_max +0.01") { field = "fee_max"; from = t.fee_max; to = bump(t.fee_max, 1); t.fee_max = to; }
  else {
    if (!t.conversion) throw new Error(`${proposalId} has no conversion to change`);
    field = "conversion.buy_amount"; from = t.conversion.buy_amount; to = bump(t.conversion.buy_amount, 1); t.conversion.buy_amount = to;
  }
  db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify(t), proposalId);
  if (tamper === "amount +0.01, terms_sha256 column recomputed") db.prepare("UPDATE proposals SET terms_sha256 = ? WHERE proposal_id = ?").run(termsHash(t as unknown as Terms), proposalId);
  return { field, from, to };
}

/** Airwallex's transfer, as GET /transfers/{id} answers it (only the fields compared and kept). */
export interface AwxTransferRead {
  id?: string; request_id?: string; status?: string; transfer_amount?: number | string; transfer_currency?: string; beneficiary_id?: string;
  reference?: string; metadata?: Record<string, unknown> | null; fee_amount?: number | string | null; fee_currency?: string | null; created_at?: string; updated_at?: string;
}
export interface Want { sha: string; amount: string; currency: string; beneficiaryId: string; reference: string; requestId: string }
export interface Readback {
  status: string | null; amount: string | null; currency: string | null; beneficiary_id: string | null; reference: string | null; request_id: string | null;
  approval_sha256: string | null; fee: string | null; created_at: string | null; updated_at: string | null;
  match: { approval_sha256: boolean; amount: boolean; currency: boolean; beneficiary_id: boolean; reference: boolean; request_id: boolean; status_paid: boolean };
  all_match: boolean;
}

const amountOf = (v: unknown): string | null => { try { return v === undefined || v === null ? null : fromCents(cents(v)); } catch { return null; } };
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Airwallex's own transfer compared, field by field, with the signed terms. */
export function compareTransfer(o: AwxTransferRead, want: Want): Readback {
  const r = {
    status: str(o.status), amount: amountOf(o.transfer_amount), currency: str(o.transfer_currency), beneficiary_id: str(o.beneficiary_id), reference: str(o.reference),
    request_id: str(o.request_id), approval_sha256: str(o.metadata?.approval_sha256), fee: o.fee_amount != null ? `${o.fee_currency ?? "?"} ${amountOf(o.fee_amount) ?? "?"}` : null,
    created_at: str(o.created_at), updated_at: str(o.updated_at),
  };
  const match = {
    approval_sha256: r.approval_sha256 === want.sha, amount: r.amount === want.amount, currency: r.currency === want.currency, beneficiary_id: r.beneficiary_id === want.beneficiaryId,
    reference: r.reference === want.reference, request_id: r.request_id === want.requestId, status_paid: r.status === "PAID",
  };
  return { ...r, match, all_match: Object.values(match).every(Boolean) };
}

export interface ConversionReadback { found: number; conversion_id: string | null; status: string | null; buy_amount: string | null; sell_amount: string | null; approval_sha256: string | null; all_match: boolean; differences: string[] }
type AwxConversion = { conversion_id?: string; request_id?: string; quote_id?: string; status?: string; buy_amount?: number | string; sell_amount?: number | string; metadata?: Record<string, unknown> | null };

/** Airwallex's conversions under the signed request_id compared with the signed conversion terms. */
export function compareConversion(items: AwxConversion[], want: { requestId: string; quoteId: string; buy: string; sell: string; sha: string }): ConversionReadback {
  const hits = items.filter((x) => x.request_id === want.requestId);
  const x = hits[0];
  if (hits.length !== 1 || !x) return { found: hits.length, conversion_id: null, status: null, buy_amount: null, sell_amount: null, approval_sha256: null, all_match: false, differences: [`${hits.length} conversions with request_id ${want.requestId}`] };
  const got = { conversion_id: str(x.conversion_id), status: str(x.status), buy_amount: amountOf(x.buy_amount), sell_amount: amountOf(x.sell_amount), approval_sha256: str(x.metadata?.approval_sha256) };
  const differences = ([
    ["quote_id", x.quote_id ?? want.quoteId, want.quoteId], ["buy_amount", got.buy_amount, want.buy], ["sell_amount", got.sell_amount, want.sell],
    ["metadata.approval_sha256", got.approval_sha256, want.sha], ["status", got.status, "SETTLED"],
  ] as const).filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k} ${String(a)} != ${b}`);
  return { found: 1, ...got, all_match: differences.length === 0, differences };
}

/** The p-th percentile (nearest rank) of the values, or null when there are none. */
export function percentile(values: readonly number[], pct: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((pct / 100) * s.length) - 1))]!;
}

export function countEndpoints(calls: readonly CallLine[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of calls) m[`${c.method} ${c.endpoint}`] = (m[`${c.method} ${c.endpoint}`] ?? 0) + 1;
  return m;
}

export interface PaymentResult {
  n: number; payee: string; invoice_no: string; amount: string; currency: "EUR"; why: string; fx_planned: boolean;
  proposal_id: string | null; terms_sha256: string | null; signed_by: string | null; transfer_request_id: string | null;
  conversion: null | { conversion_id: string | null; quote_id: string; request_id: string; buy: string; sell: string; client_rate: string; readback: ConversionReadback | null };
  transfer_id: string | null; status_after_execute: string | null; create_sent_at: string | null; create_answered_at: string | null; paid_seen_at: string | null; create_to_paid_ms: number | null;
  readback: Readback | null; readback_at: string | null;
  calls: { total: number; by_endpoint: Record<string, number> }; started_at: string; ended_at: string | null; error: string | null;
}
export interface NegativeResult {
  n: number; after_payment: number; payee: string; invoice_no: string; amount: string; fx_planned: boolean; tamper: Tamper; changed: { field: string; from: string; to: string } | null;
  proposal_id: string | null; signed_sha256: string | null; transfer_request_id: string | null; conversion_request_id: string | null;
  refused: boolean; refusal: string | null; at: string | null;
  calls_from_change_to_refusal: { total: number; post: number; by_endpoint: Record<string, number> };
  rail_creates_in_window: number; ledger_transfer_rows: number; ledger_conversion_rows: number;
  airwallex_lookup: null | { transfer_found: boolean; conversion_found: boolean | null };
  error: string | null;
}
export interface SoakResults {
  stream: "airwallex-soak"; started_at: string; ended_at: string | null; mode: "live" | "stand-in";
  setup: { calls: { total: number; by_endpoint: Record<string, number> }; balances_before: Record<string, string>; beneficiaries: Record<string, string>; floors: Record<string, string> };
  payments: PaymentResult[]; negatives: NegativeResult[]; stopped: string | null;
}

export interface SoakDeps {
  db: DB; rail: Rail;
  /** A read at Airwallex (GET), as the existing client sends it. */
  get: (path: string, query?: Record<string, string>) => Promise<unknown>;
  /** Every Airwallex call so far, oldest first (live: the run's call log). */
  calls: () => CallLine[];
  feeRetry: FeeRetry;
  mode: "live" | "stand-in";
  log?: (line: string) => void;
  /** Called after each step with the results so far (live: written to the run's folder). */
  save?: (r: SoakResults) => void;
  payments?: readonly SoakPayment[];
  negatives?: readonly SoakNegative[];
}

interface Timed { method: string; start: number; end: number; status: string | null }
/** The rail with each method call timed (start, answer, the status it answered), for the create-to-PAID latency. */
function timedRail(rail: Rail, out: Timed[]): Rail {
  return new Proxy(rail, {
    get(t, prop, r) {
      const v = Reflect.get(t, prop, r) as unknown;
      if (typeof v !== "function" || typeof prop !== "string") return v;
      return async (...a: unknown[]) => {
        const start = Date.now();
        const res = await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a);
        out.push({ method: prop, start, end: Date.now(), status: res && typeof res === "object" && typeof (res as { status?: unknown }).status === "string" ? (res as { status: string }).status : null });
        return res;
      };
    },
  });
}

async function enrol(db: DB, now: Date) {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN }, now);
  const credential = auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP });
  const out = await processRegistration(db, { ticket: "airwallex-soak-enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential }), received_at: now.toISOString() }, { label: SOAK_PASSKEY_LABEL }, now);
  if (out.status !== "pending") throw new Error(`the virtual passkey was not enrolled: ${JSON.stringify(out)}`);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), now);
  return auth;
}

async function sign(db: DB, auth: FakeAuthenticator, proposalId: string, counter: number, now: Date) {
  const hash = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const credential = auth.sign({ challenge: challengeFor(hash), origin: ORIGIN, rpId: RP, counter });
  const out = await processAssertion(db, { ticket: `airwallex-soak-${proposalId}`, kind: "assertion", proposal_id: proposalId, body: JSON.stringify({ proposal_id: proposalId, terms_sha256: hash, credential }), received_at: now.toISOString() }, now);
  if (out.status !== "approved") throw new Error(`${proposalId} was not approved: ${JSON.stringify(out)}`);
  return hash;
}

/** Why a ledger is not fresh enough for a soak (a virtual passkey goes only on a ledger with no passkey and no proposal). */
export function soakLedgerRefusal(db: DB): string | undefined {
  const keys = db.prepare("SELECT label FROM passkeys").all() as { label: string }[];
  if (keys.length) return `this ledger already has a passkey (${keys.map((k) => k.label).join(", ")}); the soak enrols its virtual test passkey only on a fresh ledger`;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n;
  return n ? `this ledger already has ${n} proposals; the soak runs only on a fresh ledger` : undefined;
}

const latestEurCents = (db: DB): number => {
  const r = db.prepare("SELECT json FROM balance_snapshots ORDER BY rowid DESC LIMIT 1").get() as { json: string } | undefined;
  return (JSON.parse(r?.json ?? "{}") as { EUR?: { availableCents?: number } }).EUR?.availableCents ?? 0;
};

/** What the soak needs before it starts, from one balance read: EUR for the payments paid from EUR, USD for the conversions. */
export function fundingRefusal(balances: Record<string, { availableCents: number } | undefined>, payments: readonly SoakPayment[], negatives: readonly SoakNegative[]): string | undefined {
  const reserve = 5_000; // EUR 50.00 a payment for the fee and its reserve
  const fromEur = payments.filter((x) => !x.fx).reduce((s, x) => s + toCents(x.amount) + reserve, 0) + payments.filter((x) => x.fx).length * (toCents(SOAK_FX_FREE_EUR) + reserve);
  const bought = [...payments.filter((x) => x.fx), ...negatives.filter((x) => x.fx)].reduce((s, x) => s + toCents(x.amount) + reserve, 0);
  const eur = balances.EUR?.availableCents ?? 0, usd = balances.USD?.availableCents ?? 0;
  if (eur - toCents(SOAK_EUR_FLOOR) < fromEur) return `EUR available ${fromCents(eur)} less the floor ${SOAK_EUR_FLOOR} does not cover EUR ${fromCents(fromEur)} paid from EUR; nothing was planned`;
  // At most 1.30 USD a euro, so a quote never meets the USD floor (0.00) half-way through.
  if (usd < Math.ceil(bought * 1.3)) return `USD available ${fromCents(usd)} does not cover about USD ${fromCents(Math.ceil(bought * 1.3))} for the conversions; nothing was planned`;
  return undefined;
}

/**
 * The soak, in order: setup (balances, the two payees' Airwallex beneficiaries, floors, the virtual passkey), then each
 * payment, with each negative control after the payment it names. It stops at the first transfer Airwallex holds
 * IN_APPROVAL (Purser never approves at Airwallex) and at a spent call budget; every other error is recorded and it goes on.
 */
export async function runSoak(d: SoakDeps): Promise<SoakResults> {
  const { db } = d;
  const log = d.log ?? (() => undefined);
  const payments = d.payments ?? SOAK_PAYMENTS, negatives = d.negatives ?? SOAK_NEGATIVES;
  const timed: Timed[] = [];
  const rail = timedRail(d.rail, timed);
  const since = (k: number) => d.calls().slice(k);
  const iso = (ms: number) => new Date(ms).toISOString();
  const res: SoakResults = { stream: "airwallex-soak", started_at: new Date().toISOString(), ended_at: null, mode: d.mode, setup: { calls: { total: 0, by_endpoint: {} }, balances_before: {}, beneficiaries: {}, floors: {} }, payments: [], negatives: [], stopped: null };
  const save = () => d.save?.(res);

  const fresh = soakLedgerRefusal(db);
  if (fresh) throw new Error(fresh);
  // Setup: one balance read, the two payees as Airwallex already holds them (the soak creates no beneficiary), the floors.
  const c0 = d.calls().length;
  const bal = await rail.balances();
  for (const [k, v] of Object.entries(bal)) if (v) res.setup.balances_before[k] = fromCents(v.availableCents);
  for (const [key, payee] of Object.entries(PAYEES)) {
    const ben = await rail.findBeneficiaryByIban(payee.iban);
    if (!ben) throw new Error(`Airwallex holds no beneficiary for ${payee.name} (IBAN ending ${payee.iban.slice(-4)}); the soak creates none`);
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
      .run(ben.id, payee.name, payee.iban.slice(-4), ibanSha(payee.iban), payee.bic);
    res.setup.beneficiaries[key] = ben.id;
  }
  const short = fundingRefusal(bal, payments, negatives);
  res.setup.calls = { total: d.calls().length - c0, by_endpoint: countEndpoints(since(c0)) };
  if (short) { res.stopped = short; res.ended_at = new Date().toISOString(); save(); return res; }
  setSetting(db, "treasury", "eur_floor", SOAK_EUR_FLOOR);
  setSetting(db, "treasury", "eur_obligations", "0.00");
  setSetting(db, "treasury", "usd_floor", "0.00");
  res.setup.floors = { eur_floor: SOAK_EUR_FLOOR, usd_floor: "0.00", fx_free_eur: SOAK_FX_FREE_EUR };
  const auth = await enrol(db, new Date());
  let counter = 0;
  save();

  /** For a payment marked FX, the commitments are set so only SOAK_FX_FREE_EUR is free: the plan then buys the shortfall. */
  const setFree = (fx: boolean) => setSetting(db, "treasury", "eur_obligations", fx ? fromCents(Math.max(0, latestEurCents(db) - toCents(SOAK_EUR_FLOOR) - toCents(SOAK_FX_FREE_EUR))) : "0.00");
  const budgetSpent = (e: unknown) => (e as { name?: string }).name === "AirwallexBudgetSpent";

  const plan = async (payee: PayeeKey, invoiceNo: string, amount: string, fx: boolean) => {
    setFree(fx);
    const text = soakInvoiceText(payee, invoiceNo, amount);
    const out = await withOrigin(SOAK_COMMAND, () => proposeInvoicePayment(db, rail, parseInvoiceFallback(text), text));
    if (out.kind !== "proposed") throw new Error(`not planned: ${out.reason}`);
    return out.proposal.proposal_id;
  };
  const termsOf = (proposalId: string) => JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as {
    amount: string; currency: string; beneficiary_id: string; reference: string; transfer_request_id: string;
    conversion: null | { request_id: string; quote_id: string; buy_amount: string; sell_amount: string; client_rate: string };
  };

  const pay = async (x: SoakPayment): Promise<"go" | "stop"> => {
    const invoiceNo = soakInvoiceNo(x.payee, x.n);
    const k = d.calls().length, t0 = timed.length;
    const r: PaymentResult = {
      n: x.n, payee: PAYEES[x.payee].name, invoice_no: invoiceNo, amount: x.amount, currency: "EUR", why: x.why, fx_planned: x.fx, proposal_id: null, terms_sha256: null, signed_by: null,
      transfer_request_id: null, conversion: null, transfer_id: null, status_after_execute: null, create_sent_at: null, create_answered_at: null, paid_seen_at: null, create_to_paid_ms: null,
      readback: null, readback_at: null, calls: { total: 0, by_endpoint: {} }, started_at: new Date().toISOString(), ended_at: null, error: null,
    };
    res.payments.push(r);
    let verdict: "go" | "stop" = "go";
    try {
      const pid = await plan(x.payee, invoiceNo, x.amount, x.fx);
      r.proposal_id = pid;
      r.terms_sha256 = await sign(db, auth, pid, ++counter, new Date());
      r.signed_by = SOAK_PASSKEY_LABEL;
      const t = termsOf(pid);
      r.transfer_request_id = t.transfer_request_id;
      if (t.conversion) r.conversion = { conversion_id: null, quote_id: t.conversion.quote_id, request_id: t.conversion.request_id, buy: t.conversion.buy_amount, sell: t.conversion.sell_amount, client_rate: t.conversion.client_rate, readback: null };
      const out = await withOrigin(approvalOrigin(db, pid)!, () => executeInvoicePayment(db, rail, rail, pid, undefined, d.feeRetry));
      r.transfer_id = out.transfer.id;
      r.status_after_execute = out.transfer.status;
      if (r.conversion) r.conversion.conversion_id = out.conversionId;
      const mine = timed.slice(t0);
      const create = mine.find((m) => m.method === "createTransfer");
      if (create) {
        r.create_sent_at = iso(create.start);
        r.create_answered_at = iso(create.end);
        const paid = mine.find((m) => m.start >= create.end && m.method === "getTransfer" && m.status === "PAID");
        if (paid) { r.paid_seen_at = iso(paid.end); r.create_to_paid_ms = paid.end - create.start; }
      }
      audit(db, "system", "airwallex_soak.executed", out.transfer.id, { n: x.n, invoice_no: invoiceNo, proposal_id: pid, terms_sha256: r.terms_sha256, status: out.transfer.status, signer: SOAK_PASSKEY_LABEL });
      if (out.transfer.status === "IN_APPROVAL") {
        res.stopped = `payment ${x.n}: Airwallex holds transfer ${out.transfer.id} IN_APPROVAL (its own approval workflow); Purser never approves there, so the soak stops`;
        verdict = "stop";
      }
      // The read-back: Airwallex's own record of the transfer, and of the conversion, compared with the signed terms.
      const o = (await d.get(`/transfers/${encodeURIComponent(out.transfer.id)}`)) as AwxTransferRead;
      r.readback_at = new Date().toISOString();
      r.readback = compareTransfer(o, { sha: r.terms_sha256, amount: t.amount, currency: t.currency, beneficiaryId: t.beneficiary_id, reference: t.reference, requestId: t.transfer_request_id });
      if (t.conversion && r.conversion) {
        const list = (await d.get("/fx/conversions", { request_id: t.conversion.request_id, page_num: "0", page_size: "10" })) as { items?: AwxConversion[] };
        r.conversion.readback = compareConversion(list.items ?? [], { requestId: t.conversion.request_id, quoteId: t.conversion.quote_id, buy: t.conversion.buy_amount, sell: t.conversion.sell_amount, sha: r.terms_sha256 });
      }
    } catch (e) {
      r.error = (e as Error).message.slice(0, 400);
      if (budgetSpent(e)) { res.stopped = `payment ${x.n}: ${r.error}`; verdict = "stop"; }
    }
    r.ended_at = new Date().toISOString();
    r.calls = { total: d.calls().length - k, by_endpoint: countEndpoints(since(k)) };
    log(`PAYMENT  ${String(x.n).padStart(2)} ${invoiceNo.padEnd(12)} EUR ${x.amount.padStart(8)}${x.fx ? " FX" : "   "} ${r.transfer_id ?? "-"} ${r.readback?.status ?? r.status_after_execute ?? "-"} readback ${r.readback ? (r.readback.all_match ? "match" : "MISMATCH") : "-"}${r.conversion ? ` conversion ${r.conversion.readback?.all_match ? "match" : "MISMATCH"}` : ""} ${r.create_to_paid_ms ?? "-"} ms, ${r.calls.total} calls${r.error ? `  ERROR ${r.error}` : ""}`);
    save();
    return verdict;
  };

  const negative = async (x: SoakNegative): Promise<"go" | "stop"> => {
    const invoiceNo = soakInvoiceNo(x.payee, x.n, true);
    const r: NegativeResult = {
      n: x.n, after_payment: x.after, payee: PAYEES[x.payee].name, invoice_no: invoiceNo, amount: x.amount, fx_planned: x.fx, tamper: x.tamper, changed: null, proposal_id: null, signed_sha256: null,
      transfer_request_id: null, conversion_request_id: null, refused: false, refusal: null, at: null, calls_from_change_to_refusal: { total: 0, post: 0, by_endpoint: {} }, rail_creates_in_window: 0,
      ledger_transfer_rows: 0, ledger_conversion_rows: 0, airwallex_lookup: null, error: null,
    };
    res.negatives.push(r);
    try {
      const pid = await plan(x.payee, invoiceNo, x.amount, x.fx);
      r.proposal_id = pid;
      r.signed_sha256 = await sign(db, auth, pid, ++counter, new Date());
      const t = termsOf(pid);
      r.transfer_request_id = t.transfer_request_id;
      r.conversion_request_id = t.conversion?.request_id ?? null;
      // From here on every Airwallex call is counted: the change, then the executor, which must refuse before any create.
      const k = d.calls().length, t0 = timed.length;
      r.changed = tamperTerms(db, pid, x.tamper);
      try {
        await withOrigin(approvalOrigin(db, pid)!, () => executeInvoicePayment(db, rail, rail, pid, undefined, d.feeRetry));
        r.refused = false;
        r.refusal = "NOT REFUSED: the executor ran the changed terms";
      } catch (e) {
        r.refusal = (e as Error).message.slice(0, 300);
        r.refused = /terms do not match the approved hash/.test(r.refusal);
      }
      r.at = new Date().toISOString();
      const window = since(k);
      r.calls_from_change_to_refusal = { total: window.length, post: window.filter((c) => c.method === "POST").length, by_endpoint: countEndpoints(window) };
      r.rail_creates_in_window = timed.slice(t0).filter((m) => /^create(Transfer|PayoutTransfer|Conversion|ConversionAny)$/.test(m.method)).length;
      r.ledger_transfer_rows = (db.prepare("SELECT COUNT(*) AS n FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as { n: number }).n;
      r.ledger_conversion_rows = t.conversion ? (db.prepare("SELECT COUNT(*) AS n FROM fx_conversions WHERE request_id = ?").get(t.conversion.request_id) as { n: number }).n : 0;
      audit(db, "system", "airwallex_soak.negative", pid, { n: x.n, tamper: x.tamper, changed: r.changed, outcome: r.refused ? "refused before any create" : "not refused", calls_in_window: r.calls_from_change_to_refusal.total });
      // After the window: Airwallex asked whether it holds anything under the signed request ids (it must hold nothing).
      const tr = (await d.get("/transfers", { request_id: t.transfer_request_id, page_num: "0", page_size: "10" })) as { items?: { request_id?: string }[] };
      const cv = t.conversion ? (await d.get("/fx/conversions", { request_id: t.conversion.request_id, page_num: "0", page_size: "10" })) as { items?: { request_id?: string }[] } : null;
      r.airwallex_lookup = { transfer_found: (tr.items ?? []).some((i) => i.request_id === t.transfer_request_id), conversion_found: cv ? (cv.items ?? []).some((i) => i.request_id === t.conversion!.request_id) : null };
    } catch (e) {
      r.error = (e as Error).message.slice(0, 400);
      if (budgetSpent(e)) { res.stopped = `negative ${x.n}: ${r.error}`; save(); return "stop"; }
    }
    log(`NEGATIVE ${x.n} ${invoiceNo.padEnd(12)} ${x.tamper.padEnd(46)} ${r.refused ? "REFUSED" : "NOT REFUSED"}: ${r.calls_from_change_to_refusal.total} calls (${r.calls_from_change_to_refusal.post} POST) from the change to the refusal; at Airwallex: ${r.airwallex_lookup ? (r.airwallex_lookup.transfer_found || r.airwallex_lookup.conversion_found ? "FOUND" : "nothing") : "-"}${r.error ? `  ERROR ${r.error}` : ""}`);
    save();
    return "go";
  };

  for (const x of payments) {
    if ((await pay(x)) === "stop") break;
    let stop = false;
    for (const n of negatives.filter((y) => y.after === x.n)) if ((await negative(n)) === "stop") { stop = true; break; }
    if (stop) break;
  }
  setSetting(db, "treasury", "eur_obligations", "0.00");
  res.ended_at = new Date().toISOString();
  save();
  return res;
}

export interface SoakSummary {
  planned: number; created: number; paid: number; readback_matches: number; conversions: { planned: number; booked: number; readback_matches: number };
  latency_ms: { n: number; p50: number | null; p95: number | null; min: number | null; max: number | null };
  calls: { total: number; setup: number; payments: number; negatives: number; per_payment: { mean: number | null; min: number | null; max: number | null }; by_endpoint: Record<string, number> };
  negatives: { planned: number; refused: number; calls_in_window: number; posts_in_window: number; creates_in_window: number; found_at_airwallex: number; by_endpoint_in_window: Record<string, number> };
  http: { requests: number; status_429: number; non_2xx: { status: number; endpoint: string; at: string }[] } | null;
  errors: { where: string; error: string }[];
  stopped: string | null;
}

/** The soak's aggregates from its results, its call log, and (live) the HTTP status of each call. */
export function summarize(r: SoakResults, calls: readonly CallLine[], http: { at: string; method: string; endpoint: string; status: number }[] | null): SoakSummary {
  const lat = r.payments.map((x) => x.create_to_paid_ms).filter((v): v is number => v !== null);
  const per = r.payments.map((x) => x.calls.total);
  const conv = r.payments.filter((x) => x.conversion);
  const negWin = r.negatives.flatMap((x) => Object.entries(x.calls_from_change_to_refusal.by_endpoint));
  const byWin: Record<string, number> = {};
  for (const [k, v] of negWin) byWin[k] = (byWin[k] ?? 0) + v;
  return {
    planned: r.payments.length,
    created: r.payments.filter((x) => x.transfer_id).length,
    paid: r.payments.filter((x) => x.readback?.status === "PAID").length,
    readback_matches: r.payments.filter((x) => x.readback?.all_match).length,
    conversions: { planned: conv.length, booked: conv.filter((x) => x.conversion?.conversion_id).length, readback_matches: conv.filter((x) => x.conversion?.readback?.all_match).length },
    latency_ms: { n: lat.length, p50: percentile(lat, 50), p95: percentile(lat, 95), min: lat.length ? Math.min(...lat) : null, max: lat.length ? Math.max(...lat) : null },
    calls: {
      total: calls.length, setup: r.setup.calls.total, payments: per.reduce((a, b) => a + b, 0), negatives: calls.length - r.setup.calls.total - per.reduce((a, b) => a + b, 0),
      per_payment: { mean: per.length ? Math.round((per.reduce((a, b) => a + b, 0) / per.length) * 10) / 10 : null, min: per.length ? Math.min(...per) : null, max: per.length ? Math.max(...per) : null },
      by_endpoint: countEndpoints(calls),
    },
    negatives: {
      planned: r.negatives.length, refused: r.negatives.filter((x) => x.refused).length,
      calls_in_window: r.negatives.reduce((a, x) => a + x.calls_from_change_to_refusal.total, 0), posts_in_window: r.negatives.reduce((a, x) => a + x.calls_from_change_to_refusal.post, 0),
      creates_in_window: r.negatives.reduce((a, x) => a + x.rail_creates_in_window, 0),
      found_at_airwallex: r.negatives.filter((x) => x.airwallex_lookup?.transfer_found || x.airwallex_lookup?.conversion_found).length, by_endpoint_in_window: byWin,
    },
    http: http && { requests: http.length, status_429: http.filter((h) => h.status === 429).length, non_2xx: http.filter((h) => h.status < 200 || h.status > 299).map((h) => ({ status: h.status, endpoint: `${h.method} ${h.endpoint}`, at: h.at })) },
    errors: [...r.payments.filter((x) => x.error).map((x) => ({ where: `payment ${x.n}`, error: x.error! })), ...r.negatives.filter((x) => x.error).map((x) => ({ where: `negative ${x.n}`, error: x.error! }))],
    stopped: r.stopped,
  };
}
