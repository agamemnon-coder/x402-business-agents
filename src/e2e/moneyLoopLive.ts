// The money loop, run live against the Airwallex sandbox (26 Nov, v1.5.1, `npm run airwallex:money-loop-live`), test
// money only. Until these runs the Treasury advisor's conversion, the receivables matcher and the negotiated payout
// were tested against stand-ins only. Three runs, each its own record (docs/runs/2026-11-26-<record>.md):
//
//   fx-convert      cash and FX: the sandbox's real balances read; a test payable in CHF entered in the run's ledger;
//                   the CFO's FX threshold set with the passkey; the 13-week forecast from those balances and the
//                   advisor's suggestion from Airwallex's indicative rates; one proposal signed and then changed in
//                   the ledger, refused by the executor before any call and closed; a second signed and executed: a
//                   real sandbox quote and conversion, read back; asked again, nothing is converted twice.
//   receivables     money in: two customer invoices (one with a real single-use payment link, one already overdue);
//                   two deposits made by the sandbox's simulation endpoint on the EUR Global Account (one naming the
//                   linked invoice, one naming nothing); both read back from Airwallex and matched by Purser: the first
//                   pays its invoice, the second goes to review and suspense; matched once only; the paid invoice's
//                   link switched off at Airwallex; a reminder drafted for the overdue one, never sent.
//   negotiated-pay  the recorded negotiation (no model call) with the simulated supplier: an early-payment discount
//                   agreed in a chain of signed offers; the chain and the agreement hash verified; an invoice of the
//                   original amount refused before any call; the agreed amount planned, signed with the passkey and
//                   paid to the sandbox beneficiary, the agreement's hash in the transfer's metadata beside
//                   approval_sha256; the transfer read back.
//
// Simulated, and said so in each record: the approver is a labelled virtual test passkey (no person's Face ID); the
// CHF payable is a test invoice entered in the ledger; the customers, their payments (the sandbox's deposit
// simulation) and the supplier (a recorded negotiation) are simulated.

import type { Airwallex } from "../airwallex/client.js";
import type { AirwallexRail, Balance, PayoutRail } from "../airwallex/port.js";
import { simulateDeposit, listDeposits, type Deposit as AwxDeposit } from "../airwallex/deposits.js";
import { getLink } from "../airwallex/paymentLinks.js";
import { negotiationOf, proposeInvoicePayment, type InvoicePaymentTerms, type NegotiatedPayment } from "../agents/euroBill.js";
import { ibanSha, parseInvoiceFallback } from "../agents/invoice.js";
import { MANUFACTURER } from "../config/payees.js";
import type { DB } from "../db/open.js";
import { approvalOrigin } from "../executors/index.js";
import { executeFxConversion } from "../executors/fxConversion.js";
import { executeInvoicePayment } from "../executors/invoicePayment.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex } from "../lib/terms.js";
import { agreementSha256, agreedInvoiceNo, type Scene } from "../negotiate/rails.js";

/** The signed terms carry the agreed amount and the agreed invoice's number (rails.ts's agreedInvoiceNo), checked here
 *  for the record; the negotiation's own proof (the offer chain, the agreement hash) is checked by /agreed. */
function signedNamesAgreement(amount: unknown, sha: string, signed: { amount?: unknown; invoice_no?: unknown; reference?: unknown }, scene: Scene): boolean {
  const ref = agreedInvoiceNo(scene, sha);
  const no = typeof signed.invoice_no === "string" ? signed.invoice_no.split(" · ")[0] : "";
  return signed.amount === amount && (no === ref || signed.reference === ref);
}
import { recordedNegotiation, type Negotiation } from "../negotiate/negotiate.js";
import { chained, verifyOffer } from "../negotiate/offers.js";
import { closeBlocked } from "../policy/approvals.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
import { agedDebtors, arInvoice, draftReminders, issueInvoice, retireDoneLinks, reviewQueue, routeDeposit } from "../receivables/ar.js";
import { adviseFx, airwallexOpening, forecastInput, fxThresholdCents, indicativeRates, proposeFxConversion, type FxConversionTerms } from "../treasury/advisor.js";
import { cashForecast, signedAmount, type Forecast } from "../treasury/forecastCore.js";
import { FX_THRESHOLD_KEY, type FxSuggestion } from "../treasury/fxCore.js";
import { setSetting } from "../world/settings.js";
import { runner, type GovDeps, type GovResults } from "./governanceLive.js";

export const LOOP_RUNS = ["fx-convert", "receivables", "negotiated-pay"] as const;
export type LoopRun = (typeof LOOP_RUNS)[number];
/** The hard limit of one run's Airwallex calls (logins included). */
export const LOOP_LIVE_MAX_BUDGET = 40;
export const LOOP_PASSKEY_LABEL = "money-loop virtual test passkey (no person's Face ID)";
const LOOP_RP = "money-loop-live.virtual-passkey.invalid";
export const LOOP_COMMAND: Origin = { actor: "cfo-command", command: "npm run airwallex:money-loop-live", moves_money: false };

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const termsOf = <T>(db: DB, id: string) => JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as T;
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const shaOf = (db: DB, id: string) => (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string }).terms_sha256;
const loop = (run: LoopRun, d: GovDeps) => runner(run, d, { label: LOOP_PASSKEY_LABEL, rp: LOOP_RP });

// ---------------------------------------------------------------------------------------------------------------------
// Run 1: cash and FX.

/** The test payable that the forecast falls short on: a CHF invoice (the sandbox holds no CHF), due in 10 days. */
export const FX_PAYABLE = { id: "AP-FX-1126", vendor: "Alpenglas Zuerich AG (test supplier)", invoice_no: "AGZ-1126", currency: "CHF", amount: "100.00" } as const;
/** The CFO's threshold for a suggested conversion (policy treasury.fx_threshold_eur), set with the passkey. */
export const FX_THRESHOLD_EUR = "50.00";

export type FxRail = Pick<PayoutRail, "balancesAll" | "currentRateAny" | "createQuoteAny" | "createConversionAny" | "findConversionByRequestId">;
/** A conversion as Airwallex reads it back (GET /fx/conversions/{id}): only these fields are kept. */
export interface ConversionRead { conversion_id: string; request_id: string | null; status: string; buy_currency: string; buy_amount: string; sell_currency: string; sell_amount: string; metadata: Record<string, unknown> | null }

/** The test payable in the ledger, as the payables inbox files a supplier invoice that is ready to pay. */
export function enterTestPayable(db: DB, now: Date, dueDate: string): void {
  const at = now.toISOString();
  db.prepare("INSERT OR IGNORE INTO ap_documents (sha256, filename, mime, bytes, path, source, text_chars, received_at) VALUES (?, 'agz-1126.pdf', 'application/pdf', 1, 'test-payable', 'upload', 1, ?)").run(sha256Hex(`test payable ${FX_PAYABLE.invoice_no}`), at);
  db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by, gl_account, gl_rule, cost_centre, status, findings_json, received_at, updated_at)
    VALUES (?, ?, 'invoice', 'code', ?, ?, ?, ?, ?, ?, '0.00', ?, '0000', 'TESTCHZZ', '{}', 'code', '6900', 'test payable', 'ops', 'ready', '[]', ?, ?)`)
    .run(FX_PAYABLE.id, sha256Hex(`test payable ${FX_PAYABLE.invoice_no}`), FX_PAYABLE.vendor, FX_PAYABLE.invoice_no, at.slice(0, 10), dueDate, FX_PAYABLE.currency, FX_PAYABLE.amount, FX_PAYABLE.amount, at, at);
}

export async function runFxConvert(d: GovDeps & { rail: FxRail; readConversion: (id: string) => Promise<ConversionRead> }): Promise<GovResults> {
  const { db, rail } = d;
  const r = loop("fx-convert", d);
  const { res, step, calls } = r;
  await r.enrol();
  const asOf = d.now().toISOString().slice(0, 10);
  let balances: Record<string, Balance> = {};
  await step("cash", "fx.balances", "treasury", "Read the sandbox's real balances (GET /balances/current), the forecast's opening", "EUR available; CHF held or not, as Airwallex says", async () => {
    balances = await rail.balancesAll();
    const held = Object.entries(balances).filter(([, b]) => b.availableCents > 0).map(([c, b]) => `${c} ${fromCents(b.availableCents)}`);
    return { outcome: `${held.length} currencies with money available: ${held.join(", ")}; CHF available ${fromCents(balances.CHF?.availableCents ?? 0)}`, pass: (balances.EUR?.availableCents ?? 0) > 0, facts: { available: Object.fromEntries(Object.entries(balances).filter(([, b]) => b.availableCents > 0).map(([c, b]) => [c, fromCents(b.availableCents)])), chf_available: fromCents(balances.CHF?.availableCents ?? 0) } };
  });
  const due = addDays(asOf, 10);
  await step("cash", "fx.policy", "treasury", `The CFO sets the FX threshold (${FX_THRESHOLD_KEY}) to EUR ${FX_THRESHOLD_EUR} with the passkey; a test payable of ${FX_PAYABLE.currency} ${FX_PAYABLE.amount} (${FX_PAYABLE.invoice_no}, due ${due}) is entered in the run's ledger`, "the threshold applied; the payable open; no Airwallex call", async () => {
    const k = await calls(async () => { const id = await r.runnerChange(FX_THRESHOLD_KEY, FX_THRESHOLD_EUR, "money-loop run: suggest a conversion for a forecast shortfall of at least EUR 50"); enterTestPayable(db, d.now(), due); return id; });
    if (k.error) throw k.error;
    const t = fxThresholdCents(db);
    return { outcome: `${k.value} approved by the passkey and applied: threshold EUR ${t === null ? "not set" : fromCents(t)}; payable ${FX_PAYABLE.id} ${FX_PAYABLE.currency} ${FX_PAYABLE.amount} due ${due}; ${k.calls} Airwallex calls`, pass: t === toCents(FX_THRESHOLD_EUR) && k.calls === 0, facts: { proposal_id: k.value, threshold_eur: t === null ? null : fromCents(t), payable: { ...FX_PAYABLE, due_date: due } }, simulated: "signed by the virtual test passkey; the CHF payable is a test invoice entered in the ledger (no supplier sent it)" };
  });
  let forecast: Forecast | null = null;
  let suggestion: FxSuggestion | null = null;
  await step("cash", "fx.advice", "treasury", "The 13-week forecast from the real balances and the ledger; the advisor's exposure and suggestion from Airwallex's indicative rates (GET /fx/rates/current, which moves nothing)", `one suggestion: buy CHF ${FX_PAYABLE.amount} with EUR, at or above the threshold`, async () => {
    forecast = cashForecast(forecastInput(db, asOf, airwallexOpening(balances), "Airwallex sandbox available balances (read in fx.balances)"));
    const { rates, missing } = await indicativeRates(rail, forecast);
    const advice = adviseFx(db, forecast, rates);
    suggestion = advice.suggestions[0] ?? null;
    const chf = advice.exposures.find((e) => e.currency === "CHF");
    const s = suggestion as FxSuggestion | null;
    return {
      outcome: s ? `CHF lowest ${signedAmount(chf?.min_closing_cents ?? 0)} in week ${chf?.min_week}, short ${fromCents(chf?.shortfall_cents ?? 0)}; suggested: buy ${s.buy_currency} ${fromCents(s.buy_cents)} with at most ${s.sell_currency} ${fromCents(s.sell_max_cents)} (indicative ${fromCents(s.sell_cents)} at ${s.rate}, about EUR ${fromCents(s.eur_cents)} against the threshold EUR ${fromCents(s.threshold_eur_cents)}); ${rates.length} rates read${missing.length ? `, ${missing.length} not priced` : ""}` : `no suggestion: ${advice.notes.join(" ")}`,
      pass: advice.suggestions.length === 1 && !!s && s.buy_currency === "CHF" && s.buy_cents === toCents(FX_PAYABLE.amount) && s.sell_currency === "EUR" && s.eur_cents >= toCents(FX_THRESHOLD_EUR),
      facts: { as_of: asOf, chf_exposure: chf ?? null, rates: rates.map((x) => ({ pair: `${x.sell_currency}->${x.buy_currency}`, buy: fromCents(x.buy_cents), sell: fromCents(x.sell_cents), rate: x.rate, at: x.at })), missing, suggestion: s, notes: advice.notes },
    };
  });
  const sign = async () => {
    const p = proposeFxConversion(db, suggestion!, forecast!, d.now());
    const signed = await r.passkeyApprove(p.proposal_id);
    return { id: p.proposal_id, signed: signed.status };
  };
  await step("approve", "fx.changed_after_signing", "treasury", `A conversion proposal filed and signed with the passkey; its stored terms then changed (buy_amount ${FX_PAYABLE.amount} to 100.01) and the executor started`, "refused by the executor before any Airwallex call (the terms no longer hash to what was signed); closed: nothing converted", async () => {
    if (!suggestion || !forecast) return { outcome: "no suggestion to file", pass: false };
    const a = await sign();
    const sha = shaOf(db, a.id);
    const t = termsOf<FxConversionTerms & Record<string, unknown>>(db, a.id);
    db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, buy_amount: fromCents(toCents(t.buy_amount) + 1) }), a.id);
    const k = await calls(() => executeFxConversion(db, rail, a.id, d.now));
    const before = statusOf(db, a.id);
    closeBlocked(db, a.id, sha.slice(0, 8), "the money-loop run", d.now());
    const conversions = (db.prepare("SELECT COUNT(*) AS n FROM fx_conversions").get() as { n: number }).n;
    return {
      outcome: `${a.id} ${a.signed}; changed, then ${k.error ? `refused: ${k.error.message.slice(0, 160)}` : "NOT refused"}; ${k.calls} Airwallex calls; status ${before}, then closed ${statusOf(db, a.id)}; ${conversions} conversions in the ledger`,
      pass: a.signed === "approved" && !!k.error && k.calls === 0 && before === "APPROVED" && conversions === 0,
      facts: { proposal_id: a.id, terms_sha256: sha, changed: { field: "buy_amount", from: t.buy_amount, to: fromCents(toCents(t.buy_amount) + 1) }, refusal: k.error?.message.slice(0, 300) ?? null, calls: k.calls, closed_as: statusOf(db, a.id) },
      simulated: "signed by the virtual test passkey; the change after signing is made by the run in the ledger, as an attacker with write access would",
    };
  });
  let pid: string | null = null;
  await step("approve", "fx.signed", "treasury", "The same suggestion filed again and signed with the passkey", "APPROVED, with the signed maximum and request id in its terms", async () => {
    const b = await sign();
    pid = b.id;
    const t = termsOf<FxConversionTerms>(db, b.id);
    return { outcome: `${b.id} ${statusOf(db, b.id)}: buy ${t.buy_currency} ${t.buy_amount} with at most ${t.sell_currency} ${t.sell_max}; request_id ${t.conversion_request_id}`, pass: statusOf(db, b.id) === "APPROVED", facts: { proposal_id: b.id, terms_sha256: shaOf(db, b.id), buy: `${t.buy_currency} ${t.buy_amount}`, sell_max: `${t.sell_currency} ${t.sell_max}`, conversion_request_id: t.conversion_request_id }, simulated: "signed by the virtual test passkey" };
  });
  let conversionId: string | null = null;
  await step("convert", "fx.convert", "treasury", "The executor runs the signed conversion (executeFxConversion): a fresh quote for exactly the signed buy amount, held to the signed maximum, then one conversion under the signed request id carrying the approval hash", "EXECUTED: one quote and one conversion created at Airwallex", async () => {
    if (!pid) return { outcome: "nothing signed", pass: false };
    const k = await calls(() => executeFxConversion(db, rail, pid!, d.now));
    if (k.error) throw k.error;
    const row = db.prepare("SELECT conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256 FROM fx_conversions").get() as { conversion_id: string; quote_id: string; request_id: string; buy_amount: string; sell_amount: string; status: string; approval_sha256: string } | undefined;
    conversionId = row?.conversion_id ?? null;
    const creates = k.endpoints.filter((e) => /(^POST \/fx\/(quotes|conversions)\/create|stand-in create(Quote|Conversion)Any)$/.test(e)).length;
    return {
      outcome: `${k.value?.outcome}: ${k.value?.detail}; quote ${row?.quote_id ?? "-"}; payment ${statusOf(db, pid)}; calls ${k.endpoints.join(", ")}`,
      pass: k.value?.outcome === "EXECUTED" && !!row && row.request_id === termsOf<FxConversionTerms>(db, pid).conversion_request_id && row.approval_sha256 === shaOf(db, pid) && creates === 2,
      facts: { conversion: row ?? null, calls: k.endpoints },
    };
  });
  await step("convert", "fx.readback", null, "The conversion read back from Airwallex (GET /fx/conversions/{id})", `buys CHF ${FX_PAYABLE.amount}, sells EUR within the signed maximum, under the signed request id; the approval hash in its metadata if Airwallex shows it`, async () => {
    if (!conversionId || !pid) return { outcome: "no conversion", pass: false };
    const c = await d.readConversion(conversionId);
    const t = termsOf<FxConversionTerms>(db, pid);
    const meta = c.metadata?.approval_sha256 ?? null;
    return {
      outcome: `${c.conversion_id} ${c.status}: ${c.sell_currency} ${c.sell_amount} to ${c.buy_currency} ${c.buy_amount}; request_id ${c.request_id === t.conversion_request_id ? "the signed one" : `DIFFERS (${c.request_id})`}; metadata approval_sha256 ${meta === null ? "not shown in the read-back" : meta === shaOf(db, pid) ? "the signed hash" : "DIFFERS"}`,
      pass: c.buy_currency === "CHF" && c.buy_amount === FX_PAYABLE.amount && c.sell_currency === "EUR" && toCents(c.sell_amount) <= toCents(t.sell_max) && c.request_id === t.conversion_request_id && (meta === null || meta === shaOf(db, pid)),
      facts: { ...c, signed_sell_max: t.sell_max, approval_sha256_matches: meta === null ? null : meta === shaOf(db, pid) },
    };
  });
  await step("convert", "fx.again", "treasury", "The executor asked again for the same proposal", "refused (already executed) before any Airwallex call; one conversion in the ledger", async () => {
    if (!pid) return { outcome: "nothing signed", pass: false };
    const k = await calls(() => executeFxConversion(db, rail, pid!, d.now));
    const n = (db.prepare("SELECT COUNT(*) AS n FROM fx_conversions").get() as { n: number }).n;
    return { outcome: `${k.error ? `refused: ${k.error.message.slice(0, 120)}` : "NOT refused"}; ${k.calls} calls; ${n} conversion in the ledger`, pass: !!k.error && k.calls === 0 && n === 1 };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run 2: receivables.

/** The run's two test customer invoices (the customers are made up): one with a payment link, one already overdue. */
export const AR_LINKED = { invoice_no: "NW-AR-112601", customer: "Alpenhof Sport AG (test customer)", net_cents: 10_000, vat_code: "S21" } as const;
export const AR_OVERDUE = { invoice_no: "NW-AR-112602", customer: "Fjordline Outdoor AS (test customer)", net_cents: 6_050, vat_code: "S0" } as const;
/** The payment that names no invoice and fits none: it goes to review. */
export const AR_UNKNOWN = { amount: "33.33", reference: "GIFT-TEST-1126", payer: "Unknown Test Payer GmbH" } as const;

export async function runReceivables(d: GovDeps & { api: Pick<Airwallex, "call">; sleep: (ms: number) => Promise<void> }): Promise<GovResults> {
  const { db, api } = d;
  const r = loop("receivables", d);
  const { res, step, calls } = r;
  const today = d.now().toISOString().slice(0, 10);
  const started = d.now();
  let linkId: string | null = null;
  await step("issue", "ar.issue_linked", "treasury", `Invoice ${AR_LINKED.invoice_no} issued to a test customer (EUR 121.00 with 21% VAT, due in 14 days): booked, and a single-use Airwallex payment link made for exactly it, then read back`, "booked once; the link and its read-back exactly the invoice", async () => {
    const out = await issueInvoice(db, { ...AR_LINKED, currency: "EUR", issue_date: today, due_date: addDays(today, 14) }, api, d.now());
    if (!out.link) return { outcome: `no link kept: ${out.link_problem ?? "none made"}`, pass: false };
    linkId = out.link.id;
    const back = await getLink(api, out.link.id);
    const same = back.amountCents === out.invoice.amount_cents && back.currency === "EUR" && back.reference === AR_LINKED.invoice_no && !back.reusable && back.active;
    return { outcome: `${AR_LINKED.invoice_no} EUR ${fromCents(out.invoice.amount_cents)} booked (entry ${out.entry_id}); link ${out.link.id}; read back: EUR ${fromCents(back.amountCents)}, reference ${back.reference}, ${back.reusable ? "reusable" : "single use"}, ${back.active ? "active" : "not active"}`, pass: same, facts: { invoice_no: AR_LINKED.invoice_no, amount: fromCents(out.invoice.amount_cents), entry_id: out.entry_id, link_id: out.link.id, link_active: back.active } };
  });
  await step("issue", "ar.issue_overdue", "treasury", `Invoice ${AR_OVERDUE.invoice_no} to another test customer (EUR 60.50, VAT 0%), issued 30 days ago and due 6 days ago; no link`, "booked; no Airwallex call", async () => {
    const k = await calls(() => issueInvoice(db, { ...AR_OVERDUE, currency: "EUR", issue_date: addDays(today, -30), due_date: addDays(today, -6) }, null, d.now()));
    if (k.error) throw k.error;
    return { outcome: `${AR_OVERDUE.invoice_no} EUR ${fromCents(k.value!.invoice.amount_cents)} booked, due ${k.value!.invoice.due_date}; ${k.calls} calls`, pass: k.calls === 0 && k.value!.invoice.status === "OPEN", simulated: "an invoice dated in the past by the run (its dates are written, nothing waited 30 days)" };
  });
  let ga: string | null = null;
  await step("money-in", "ar.global_account", null, "The EUR Global Account money arrives on (GET /global_accounts)", "one ACTIVE account that receives EUR", async () => {
    const g = await api.call<{ items: { id: string; status: string; required_features?: { currency: string }[]; supported_features?: { currency: string }[] }[] }>("GET", "/global_accounts", undefined, { status: "ACTIVE", page_size: "100" });
    const eur = g.items.filter((x) => x.status === "ACTIVE" && [...(x.required_features ?? []), ...(x.supported_features ?? [])].some((f) => f.currency === "EUR"));
    ga = eur[0]?.id ?? null;
    return { outcome: `${g.items.length} ACTIVE Global Accounts; EUR: ${eur.map((x) => x.id).join(", ") || "none"}`, pass: !!ga, facts: { global_account_id: ga } };
  });
  const sent: { id: string; amount: string; reference: string; payer: string }[] = [];
  await step("money-in", "ar.deposits", null, `Two payments arrive by the sandbox's simulation (POST /simulation/deposit/create): EUR 121.00 with reference ${AR_LINKED.invoice_no}, and EUR ${AR_UNKNOWN.amount} with reference ${AR_UNKNOWN.reference} (no invoice)`, "two deposits made at Airwallex", async () => {
    if (!ga) return { outcome: "no EUR Global Account", pass: false };
    const inv = arInvoice(db, AR_LINKED.invoice_no)!;
    for (const p of [{ amount: fromCents(inv.amount_cents), reference: AR_LINKED.invoice_no, payer: AR_LINKED.customer }, { amount: AR_UNKNOWN.amount, reference: AR_UNKNOWN.reference, payer: AR_UNKNOWN.payer }]) {
      const dep = await simulateDeposit(api, { globalAccountId: ga, ...p });
      sent.push({ id: dep.id, ...p });
    }
    return { outcome: sent.map((s) => `${s.id} EUR ${s.amount} (${s.reference})`).join("; "), pass: sent.length === 2, facts: { deposits: sent.map((s) => ({ deposit_id: s.id, amount: s.amount, reference: s.reference })) }, simulated: "the payer and the money are the sandbox's deposit simulation; the deposits are then Airwallex's own records" };
  });
  let read: AwxDeposit[] = [];
  await step("money-in", "ar.readback", null, "Both deposits read back from Airwallex (GET /deposits for the run's window), again every 15 s until SETTLED (at most 4 reads)", "both found, SETTLED, with the amount and reference sent", async () => {
    if (sent.length !== 2) return { outcome: "no deposits", pass: false };
    const reads: string[] = [];
    for (let i = 0; i < 4; i++) {
      if (i) await d.sleep(15_000);
      const all = await listDeposits(api, { from: new Date(started.getTime() - 60_000).toISOString(), to: new Date(d.now().getTime() + 120_000).toISOString() });
      read = sent.map((s) => all.find((x) => x.id === s.id)).filter((x): x is AwxDeposit => !!x);
      reads.push(read.map((x) => x.status).join("+") || "none");
      if (read.length === 2 && read.every((x) => x.status === "SETTLED")) break;
    }
    const same = read.length === 2 && read.every((x, i) => x.amountCents === toCents(sent[i]!.amount) && x.currency === "EUR" && (x.reference === null || x.reference === sent[i]!.reference));
    return { outcome: `reads: ${reads.join(" -> ")}; ${read.map((x) => `${x.id} EUR ${fromCents(x.amountCents)} ${x.status} reference ${x.reference ?? "none"}`).join("; ")}`, pass: same && read.every((x) => x.status === "SETTLED"), facts: { reads, deposits: read.map((x) => ({ id: x.id, amount: fromCents(x.amountCents), currency: x.currency, status: x.status, reference: x.reference, created_at: x.createdAt })) } };
  });
  const asReceipt = (x: AwxDeposit) => ({ deposit_id: x.id, global_account_id: x.globalAccountId ?? ga, currency: x.currency, amount_cents: x.amountCents, reference: x.reference, payer: x.payer, received_at: x.createdAt ?? d.now().toISOString() });
  await step("match", "ar.match", "treasury", "Purser matches each deposit as Airwallex read it back (routeDeposit, src/receivables/ar.ts)", `${AR_LINKED.invoice_no} paid by its reference; the unknown payment to review and suspense (2900), never to revenue`, async () => {
    if (read.length !== 2) return { outcome: "nothing read back", pass: false };
    const k = await calls(() => read.map((x) => routeDeposit(db, asReceipt(x), d.now())));
    if (k.error) throw k.error;
    const [a, b] = k.value!;
    const inv = arInvoice(db, AR_LINKED.invoice_no)!;
    const q = reviewQueue(db);
    const suspense = db.prepare("SELECT COALESCE(SUM(suspense_cents), 0) AS c FROM ar_payments").get() as { c: number };
    return {
      outcome: `${read[0]!.id}: ${a!.by} ${a!.outcome} (${a!.detail}); ${AR_LINKED.invoice_no} ${inv.status}; ${read[1]!.id}: ${b!.by} ${b!.outcome} (${b!.detail}); review queue ${q.length}: ${q.map((x) => `EUR ${x.amount}, "${x.reason}"`).join("; ")}; suspense EUR ${fromCents(suspense.c)}; ${k.calls} calls`,
      pass: a!.outcome === "MATCHED" && inv.status === "PAID" && b!.outcome === "REVIEW" && q.length === 1 && q[0]!.payment_id === read[1]!.id && suspense.c === toCents(AR_UNKNOWN.amount) && k.calls === 0,
      facts: { matched: { deposit_id: read[0]!.id, outcome: a!.outcome, invoice_no: AR_LINKED.invoice_no, invoice_status: inv.status }, review: q.map((x) => ({ payment_id: x.payment_id, amount: x.amount, reason: x.reason })), suspense: fromCents(suspense.c) },
    };
  });
  await step("match", "ar.once", "treasury", "The first deposit routed again (a webhook and a poll that both see it)", "recorded once: the same outcome, no second booking", async () => {
    if (!read[0]) return { outcome: "nothing read back", pass: false };
    const entries = (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n;
    const again = routeDeposit(db, asReceipt(read[0]), d.now(), "webhook");
    const after = (db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n;
    const payments = (db.prepare("SELECT COUNT(*) AS n FROM ar_payments").get() as { n: number }).n;
    return { outcome: `${again.outcome} (${again.detail}); ledger entries ${entries} -> ${after}; payments recorded ${payments}`, pass: again.outcome === "MATCHED" && after === entries && payments === 2 };
  });
  await step("match", "ar.link_off", "treasury", `The paid invoice's payment link switched off at Airwallex (retireDoneLinks), then read back`, "deactivated: active false read back", async () => {
    const done = await retireDoneLinks(db, api, d.now());
    const back = linkId ? await getLink(api, linkId) : null;
    return { outcome: `retired ${done.join(", ") || "none"}; read back ${back ? (back.active ? "ACTIVE" : "not active") : "-"}`, pass: done.length === 1 && done[0] === AR_LINKED.invoice_no && back?.active === false, facts: { link_id: linkId, active: back?.active ?? null } };
  });
  await step("dunning", "ar.dunning", "treasury", `The aged debtors and the reminder drafts as of today (draftReminders): ${AR_OVERDUE.invoice_no} is 6 days late`, "one first-stage reminder drafted for it, stored as DRAFT, never sent; the paid invoice not in the aged list; no Airwallex call", async () => {
    const k = await calls(() => ({ drafts: draftReminders(db, today, d.now()), aged: agedDebtors(db, today) }));
    if (k.error) throw k.error;
    const { drafts, aged } = k.value!;
    const statuses = (db.prepare("SELECT status FROM ar_dunning").all() as { status: string }[]).map((x) => x.status);
    return {
      outcome: `${drafts.length} draft(s): ${drafts.map((x) => `${x.invoice_no} stage ${x.stage} due ${x.due_on}`).join("; ")}; stored ${statuses.join(", ")}; aged: ${aged.rows.map((x) => `${x.invoice_no} EUR ${fromCents(x.open_cents)} ${x.days_overdue} days (${x.bucket})`).join("; ")}; ${k.calls} calls`,
      pass: drafts.length === 1 && drafts[0]!.invoice_no === AR_OVERDUE.invoice_no && drafts[0]!.stage === 1 && statuses.every((x) => x === "DRAFT") && aged.rows.length === 1 && aged.rows[0]!.invoice_no === AR_OVERDUE.invoice_no && k.calls === 0,
      facts: { drafts: drafts.map((x) => ({ invoice_no: x.invoice_no, stage: x.stage, due_on: x.due_on })), aged: aged.rows.map((x) => ({ invoice_no: x.invoice_no, open: fromCents(x.open_cents), days_overdue: x.days_overdue, bucket: x.bucket })) },
    };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run 3: a negotiated early-payment discount, paid.

/** A transfer as Airwallex reads it back (GET /transfers/{id}): only these fields are kept. */
export interface TransferRead { id: string; request_id: string | null; status: string; amount: string; currency: string; reference: string | null; metadata: Record<string, unknown> | null }

/** The invoice negotiated: Bergtex (the sandbox's beneficiary on file), EUR 100.00, issued today, net 30. */
export const negotiationScene = (today: string): Scene => ({ supplier: { name: MANUFACTURER.name, iban: MANUFACTURER.iban, bic: MANUFACTURER.bic }, invoice_no: "BTX-NEG-1126", currency: "EUR", amount_cents: 10_000, issue_date: today, due_date: addDays(today, 30) });

const longDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
/** The invoice the supplier sends for the agreed terms (as /try's engine composes it): the agreed number, amount and day. */
export function negotiatedInvoiceText(scene: Scene, invoiceNo: string, amount: string, due: string): string {
  const spaced = scene.supplier.iban.replace(/(.{4})/g, "$1 ").trim();
  const amt = `EUR ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return [
    scene.supplier.name, "Textilweg 4, 72760 Reutlingen, Germany", "", `INVOICE ${invoiceNo}`, `Date: ${longDate(scene.issue_date)}`, `Due date: ${longDate(due)}`, "", "Bill to: Northwind Outdoor", "",
    "Description                                   Amount", `${`Production lot, early payment as agreed (${scene.invoice_no})`.padEnd(46)}${amt}`, "", `Total due                                     ${amt}`, "",
    "Pay by SWIFT to:", `Account name: ${scene.supplier.name}`, `IBAN: ${spaced}`, `BIC: ${scene.supplier.bic}`, `Payment reference: ${invoiceNo}`, "",
  ].join("\n");
}

export const negotiatedPayment = (n: Negotiation): NegotiatedPayment => ({
  agreement_sha256: n.sha256, transcript_sha256: n.transcript_sha256, original_invoice_no: n.scene.invoice_no, original_amount: n.agreement.invoice_amount,
  agreed_amount: n.agreement.amount, discount: n.agreement.discount, pay_by: n.agreement.pay_by,
});

export async function runNegotiatedPay(d: GovDeps & { awx: AirwallexRail; readTransfer: (id: string) => Promise<TransferRead> }): Promise<GovResults> {
  const { db, awx } = d;
  const r = loop("negotiated-pay", d);
  const { res, step, calls } = r;
  const today = d.now().toISOString().slice(0, 10);
  const scene = negotiationScene(today);
  await r.enrol();
  await step("setup", "neg.payee", "treasury", `The supplier's payee at Airwallex (${MANUFACTURER.name}, GET /beneficiaries), recorded in the run's ledger`, "found; the run creates none", async () => {
    const ben = await awx.findBeneficiaryByIban(MANUFACTURER.iban);
    if (!ben) return { outcome: `Airwallex holds no beneficiary for ${MANUFACTURER.name}; the run creates none`, pass: false };
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(ben.id, MANUFACTURER.name, MANUFACTURER.iban.slice(-4), ibanSha(MANUFACTURER.iban), MANUFACTURER.bic);
    for (const k of ["eur_floor", "eur_obligations", "usd_floor"] as const) setSetting(db, "treasury", k, "0.00");
    return { outcome: `${ben.id} (${ben.name}, IBAN ending ${MANUFACTURER.iban.slice(-4)})`, pass: true, facts: { beneficiary_id: ben.id } };
  });
  let n: Negotiation | null = null;
  await step("negotiate", "neg.agree", "sourcing", `The Sourcing agent negotiates an early-payment discount on ${scene.invoice_no} (EUR ${fromCents(scene.amount_cents)}, net 30) with the simulated supplier's agent: the recorded negotiation, every turn through Purser's rails and signed as an offer`, "agreed within the CFO's policy; the supplier's bank change refused by the rails; no Airwallex call", async () => {
    const k = await calls(() => recordedNegotiation(today, "the live run uses the recorded negotiation: no model call", scene));
    if (k.error) throw k.error;
    n = k.value!;
    const bank = n.turns.find((t) => t.who === "supplier" && t.proposed.iban);
    return {
      outcome: `${n.outcome}: EUR ${n.agreement.amount} by ${n.agreement.pay_by} (${n.agreement.early_payment}, discount EUR ${n.agreement.discount}), ${n.agreement.policy}; ${n.turns.length} turns; turn ${bank?.n ?? "-"}'s bank change ${bank && !bank.rails.ok ? `refused (${bank.rails.refusals.map((x) => x.rule).join(", ")})` : "NOT refused"}; agreement ${n.sha256.slice(0, 12)}…; ${k.calls} calls`,
      pass: n.outcome === "agreed" && n.agreement.policy === "within_cfo_policy" && !!bank && !bank.rails.ok && bank.rails.refusals.some((x) => x.rule === "payee_unchanged") && toCents(n.agreement.amount) < scene.amount_cents && k.calls === 0,
      facts: { negotiation_id: n.id, mode: n.mode, label: n.label, outcome: n.outcome, agreement: n.agreement, agreement_sha256: n.sha256, transcript_sha256: n.transcript_sha256, turns: n.turns.map((t) => ({ n: t.n, who: t.who, amount: t.proposed.amount, pay_by: t.proposed.pay_by, bank_change: !!t.proposed.iban, rails_ok: t.rails.ok, accept: t.accept, offer_sha256: t.offer_sha256 })) },
      simulated: "the recorded negotiation (turns written in advance, no model call); the supplier and its agent's key are the simulation's",
    };
  });
  await step("negotiate", "neg.verify", null, "The offers and the agreement checked: each offer's signature by its agent's key, the chain of offers, the agreement's hash and the chain's head inside it", "all hold", async () => {
    if (!n) return { outcome: "no negotiation", pass: false };
    const neg: Negotiation = n;
    const sigs = await Promise.all(neg.turns.map((t) => verifyOffer(t.offer, t.signature, neg.keys[t.who])));
    const chain = chained(neg.turns.map((t) => t.offer));
    const hash = agreementSha256(neg.agreement) === neg.sha256;
    const head = neg.agreement.transcript_sha256 === neg.turns.at(-1)!.offer_sha256;
    return { outcome: `signatures ${sigs.filter(Boolean).length} of ${sigs.length}; chain ${chain ? "holds" : "BROKEN"}; agreement hash ${hash ? "recomputed" : "DIFFERS"}; head ${head ? "inside the agreement" : "MISSING"}`, pass: sigs.every(Boolean) && chain && hash && head };
  });
  const ref = () => agreedInvoiceNo(scene, n!.sha256);
  await step("plan", "neg.original_refused", "treasury", "An invoice under the agreement's reference for the original amount (EUR 100.00) is planned with the agreement", "refused before any Airwallex call: only the agreed amount is paid", async () => {
    if (!n) return { outcome: "no negotiation", pass: false };
    const text = negotiatedInvoiceText(scene, ref(), n.agreement.invoice_amount, n.agreement.pay_by);
    const k = await calls(() => withOrigin(LOOP_COMMAND, () => proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text, d.now(), "MIN_15", undefined, undefined, undefined, negotiatedPayment(n!))));
    if (k.error) throw k.error;
    const p = (db.prepare("SELECT COUNT(*) AS c FROM proposals WHERE kind = 'invoice_payment'").get() as { c: number }).c;
    return { outcome: `${k.value!.kind}${k.value!.kind === "escalated" ? `: ${k.value!.reason}` : ""}; ${k.calls} calls; ${p} payment proposals`, pass: k.value!.kind === "escalated" && k.calls === 0 && p === 0 };
  });
  let pid: string | null = null;
  await step("plan", "neg.signed", "treasury", "The supplier's invoice for the agreed terms (its number carries the agreement's first 8 hex) planned with the agreement and signed with the passkey", "APPROVED: the signed amount is the agreed amount, and the signed terms carry the agreement's hash", async () => {
    if (!n) return { outcome: "no negotiation", pass: false };
    const text = negotiatedInvoiceText(scene, ref(), n.agreement.amount, n.agreement.pay_by);
    const out = await withOrigin(LOOP_COMMAND, () => proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text, d.now(), "MIN_15", undefined, undefined, undefined, negotiatedPayment(n!)));
    if (out.kind !== "proposed") return { outcome: `not planned: ${out.reason}`, pass: false };
    pid = out.proposal.proposal_id;
    const signed = await r.passkeyApprove(pid);
    const t = termsOf<InvoicePaymentTerms>(db, pid);
    return {
      outcome: `${pid} ${statusOf(db, pid)} (${signed.status}): EUR ${t.amount} to ${t.beneficiary_name}, reference ${t.reference}; negotiation.agreement_sha256 ${negotiationOf(t)?.agreement_sha256 === n.sha256 ? "the agreement's" : "MISSING"}; request_id ${t.transfer_request_id}`,
      pass: statusOf(db, pid) === "APPROVED" && t.amount === n.agreement.amount && signedNamesAgreement(n.agreement.amount, n.sha256, t, scene) && negotiationOf(t)?.agreement_sha256 === n.sha256 && !t.conversion,
      facts: { proposal_id: pid, terms_sha256: shaOf(db, pid), amount: t.amount, reference: t.reference, transfer_request_id: t.transfer_request_id, negotiation: negotiationOf(t), evidence: t.evidence },
      simulated: "signed by the virtual test passkey; the supplier's invoice is composed by the run for the agreed terms (as /try's engine does)",
    };
  });
  let transferId: string | null = null;
  await step("pay", "neg.pay", "treasury", "The payment executed (executeInvoicePayment): one transfer to the sandbox beneficiary under the signed request_id, approval_sha256 and agreement_sha256 in its metadata", "a transfer created for the agreed amount", async () => {
    if (!pid) return { outcome: "nothing signed", pass: false };
    const out = await withOrigin(approvalOrigin(db, pid)!, () => executeInvoicePayment(db, awx, null, pid!));
    transferId = out.transfer.id;
    return { outcome: `transfer ${out.transfer.id} ${out.transfer.status}, EUR ${fromCents(out.transfer.amountCents)}; payment ${statusOf(db, pid)}`, pass: out.transfer.requestId === termsOf<InvoicePaymentTerms>(db, pid).transfer_request_id && out.transfer.amountCents === toCents(n!.agreement.amount) && !["FAILED", "CANCELLED"].includes(out.transfer.status), facts: { transfer_id: out.transfer.id, status: out.transfer.status, amount: fromCents(out.transfer.amountCents) } };
  });
  await step("pay", "neg.readback", null, "The transfer read back from Airwallex (GET /transfers/{id})", "the agreed amount in EUR (not the invoice as issued); the signed request_id; approval_sha256 and agreement_sha256 in its metadata; the reference naming the agreement", async () => {
    if (!transferId || !pid || !n) return { outcome: "no transfer", pass: false };
    const t = await d.readTransfer(transferId);
    const signed = termsOf<InvoicePaymentTerms>(db, pid);
    const m = t.metadata ?? {};
    const checks = {
      amount_is_agreed: t.amount === n.agreement.amount && t.currency === "EUR",
      not_the_invoice_as_issued: t.amount !== n.agreement.invoice_amount,
      request_id: t.request_id === signed.transfer_request_id,
      approval_sha256: m.approval_sha256 === shaOf(db, pid),
      agreement_sha256: m.agreement_sha256 === n.sha256,
      reference: (t.reference ?? "").includes(n.sha256.slice(0, 8)),
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    return { outcome: `${t.id} ${t.status}: ${t.currency} ${t.amount} (agreed ${n.agreement.amount}, invoice as issued ${n.agreement.invoice_amount}); reference ${t.reference}; metadata agreement_sha256 ${String(m.agreement_sha256 ?? "none").slice(0, 12)}…${bad.length ? `; DIFFERS: ${bad.join(", ")}` : "; all as signed and agreed"}`, pass: bad.length === 0, facts: { transfer: t, checks, agreement_sha256: n.sha256, approval_sha256: shaOf(db, pid) } };
  });
  res.ended_at = d.now().toISOString();
  d.save?.(res);
  return res;
}
