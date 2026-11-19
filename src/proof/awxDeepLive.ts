// Airwallex, deeper (19 Nov; `npm run airwallex:deep`, src/cli/airwallexDeep.ts): five capabilities Purser did not have,
// each through its own function, run once against the Airwallex SANDBOX with test money only.
//   1. Payout terms checked by Airwallex before the CFO signs, and a signed payment withdrawn before its day
//      (src/airwallex/transferRevoke.ts: transfers/validate, a SCHEDULED transfer, transfers/{id}/cancel).
//   2. The seller side: a payment link for one open receivable, the customer's bank transfer arriving on a Global
//      Account, matched to the invoice by the receivables agent from the account's own statement, and the link switched
//      off once the invoice is paid (src/airwallex/paymentLinks.ts, src/airwallex/globalAccountTx.ts). The arrival is
//      made by the sandbox's simulation endpoint (POST /simulation/deposit/create): no customer paid anything.
//   3. An agent card's headroom in Airwallex's own numbers: remaining limits and pending holds, against the limits Purser
//      set (src/airwallex/cardHeadroom.ts).
//   4. Airwallex's balance history (the wallet statement) checked line by line: it adds up, and the soak run's 30
//      payouts and 6 conversions are on it to the cent (src/airwallex/balanceHistory.ts).
//   5. Clean-up: the AUD Global Account the coverage check opened this morning, which Purser does not use, closed and
//      read back (src/airwallex/globalAccountTx.ts).
//
// Every request goes through the client (sandbox only, one at a time, 5/s, backoff on 429) and its call budget; the
// noting fetch keeps each answer's method, endpoint (ids folded), time, HTTP status, Airwallex's error code on a refusal,
// and Airwallex's own request and trace ids (plain ids only): never a body, a header value otherwise, a token or a key.

import { createHash, randomUUID } from "node:crypto";
import { matchReceipt, openReceivable, type Receivable } from "../agents/receivables.js";
import { checkContinuity, listBalanceHistory, matchStatement, movementsFromSoakRecord, type RecordedMovement } from "../airwallex/balanceHistory.js";
import { endpointOf } from "../airwallex/callBudget.js";
import { cardAuthorizations, cardRemainingLimits, headroom, type Headroom } from "../airwallex/cardHeadroom.js";
import { Airwallex, AirwallexAmbiguous, AirwallexError, traceOf, type AirwallexConfig } from "../airwallex/client.js";
import { simulateDeposit } from "../airwallex/deposits.js";
import { closeUnusedGlobalAccount, findArrival, listGlobalAccountTransactions, receiptOf, type GaTransaction } from "../airwallex/globalAccountTx.js";
import { toLimits } from "../airwallex/issuing.js";
import { createInvoiceLink, getLink, linkDifferences, retireLink, type PaymentLink } from "../airwallex/paymentLinks.js";
import { createScheduledTransfer, revokeScheduledTransfer, validateTransfer, type PlannedTransfer } from "../airwallex/transferRevoke.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { normalizePath } from "./awxCoverage.js";

/** One request as it was answered, with Airwallex's own ids for it (when it sent plain ones). */
export interface DeepLine { at: string; method: string; endpoint: string; status: number; code?: string; awx_request_id?: string; trace_id?: string }

const CODE = /^[a-z][a-z0-9_.-]{0,63}$/i;

/** The noting fetch (see the header). `known` holds ids made in the run whose shape the generic id rule may miss. */
export function deepNotingFetch(inner: typeof fetch, lines: DeepLine[], known: Set<string>, now: () => Date = () => new Date()): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const endpoint = endpointOf(url).split("/").map((s) => (known.has(s) ? "{id}" : s)).join("/");
    const line: DeepLine = { at: now().toISOString(), method: (init?.method ?? "GET").toUpperCase(), endpoint, status: 0 };
    try {
      const res = await inner(input, init);
      line.status = res.status;
      const t = traceOf(res.headers);
      if (t.requestId) line.awx_request_id = t.requestId;
      if (t.traceId) line.trace_id = t.traceId;
      if (!res.ok) {
        const code = ((await res.clone().json().catch(() => null)) as { code?: unknown } | null)?.code;
        if (typeof code === "string" && CODE.test(code)) line.code = code;
      }
      return res;
    } finally {
      lines.push(line);
    }
  }) as typeof fetch;
}

/** One endpoint call of the run. `http_status` is Airwallex's answer to that call; null when it was not sent. */
export interface DeepResult {
  capability: string;
  method: string;
  endpoint: string;
  function: string;
  http_status: number | null;
  error_code: string | null;
  at: string | null;
  live: boolean;
  new_endpoint: boolean;
  outcome: string;
  id: string | null;
  request_id: string | null;
  awx_request_id: string | null;
  trace_id: string | null;
}

/** The endpoints this run adds to Purser's code (the rest it calls were already live). */
export const NEW_ENDPOINTS = [
  "POST /transfers/validate", "POST /transfers/{id}/cancel", "POST /pa/payment_links/create", "GET /pa/payment_links/{id}", "POST /pa/payment_links/{id}/deactivate",
  "GET /global_accounts/{id}/transactions", "GET /global_accounts/{id}", "POST /global_accounts/{id}/close", "GET /issuing/cards/{id}/limits", "GET /issuing/authorizations", "GET /balances/history",
] as const;

/** Fixed inputs, all from committed records. */
export const SOAK = { record: "docs/runs/2026-11-19-airwallex-soak.json", from: "2026-11-19T08:49:00+0000", to: "2026-11-19T08:53:00+0000" };
/** The payee the soak paid (Bergtex Textil GmbH, a sandbox beneficiary); the revoked transfer is to it, EUR 1.00. */
export const BERGTEX_BENEFICIARY = "2abfa3ba-0786-44f7-b828-9d7c8e2da883";
/** The AUD Global Account the coverage check opened at 09:13 UTC today (docs/runs/2026-11-19-airwallex-coverage.json). */
export const AUD_GA_COVERAGE = "9d19f0a2-983e-4ea5-8420-23f3acadc71c";

export interface DeepCtx {
  cfg: AirwallexConfig;
  lines: DeepLine[];
  known: Set<string>;
  runId: string;
  db: DB;
  soak: Parameters<typeof movementsFromSoakRecord>[0];
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Only these capabilities (a second pass); all when unset. */
  only?: ReadonlySet<Capability>;
  /** Revoke this transfer (one an earlier pass scheduled) instead of validating and scheduling a new one. */
  revokeExisting?: string;
}

export const CAPABILITIES = ["revoke", "receivable", "card", "statement", "cleanup"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** A statement line as kept in the record (no description: it can name a payee): enough to re-check it offline. */
export interface StatementLine { id: string; currency: string; amount_cents: number; balance_cents: number; source: string | null; source_type: string; transaction_type: string; posted_at: string }

export interface DeepFacts {
  revoke: { terms: (Omit<PlannedTransfer, "approvalSha256"> & { approval_sha256: string }) | null; validated: boolean; scheduled: { id: string; status: string; transfer_date: string | null } | null; before: string | null; after: string | null } | null;
  receivable: { invoice: Receivable; link: { id: string; active_at_create: boolean; differences: string[]; active_after: boolean | null } | null; global_account_id: string | null; deposit_id: string | null; arrival: { id: string; amount: string; currency: string; status: string; why: string } | null; matched: { outcome: string; invoice_no: string | null; detail: string } | null; statement_line: string | null } | null;
  card: { card_id: string; nickname: string; purser_limits: { per_transaction: string; monthly: string } | null; headroom: Headroom } | null;
  statement: { window: { from: string; to: string }; lines: number; continuity: ReturnType<typeof checkContinuity>; checked: number; agree: number; differences: { label: string; recorded: string; on_statement: string; how: string }[]; fee_lines: number; statement_lines: StatementLine[] } | null;
  cleanup: { global_account_id: string; before: string; after: string } | null;
}

const said = (e: unknown): { status: number | null; code: string | null; text: string } => {
  if (e instanceof AirwallexError) return { status: e.status, code: e.code ?? null, text: `Airwallex answered ${e.status}${e.code ? ` ${e.code}` : ""}` };
  if (e instanceof AirwallexAmbiguous) return { status: null, code: null, text: "no answer from Airwallex (outcome unknown)" };
  return { status: null, code: null, text: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 240) };
};
const ok2xx = (s: number | null) => s !== null && s >= 200 && s < 300;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Runs the five capabilities once, in order; a refused call is a row, never a throw. */
export async function runDeepCheck(ctx: DeepCtx): Promise<{ rows: DeepResult[]; facts: DeepFacts }> {
  const api = new Airwallex(ctx.cfg);
  const now = ctx.now ?? (() => new Date());
  const sleep = ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = ctx.log ?? (() => {});
  const rows: DeepResult[] = [];
  const facts: DeepFacts = { revoke: null, receivable: null, card: null, statement: null, cleanup: null };
  const started = now();
  const on = (c: Capability) => !ctx.only || ctx.only.has(c);

  /** Runs a function and makes one row per endpoint it called (each endpoint's last answer). */
  async function step<T>(capability: string, fn: string, run: () => Promise<T>, describe: (v: T) => { outcome: string; id?: string | null }, o: { requestId?: string; only?: string[] } = {}): Promise<T | null> {
    const from = ctx.lines.length;
    let value: T | null = null, outcome: string, id: string | null = null, err: ReturnType<typeof said> | null = null;
    try {
      value = await run();
      const d = describe(value);
      outcome = d.outcome; id = d.id ?? null;
    } catch (e) {
      err = said(e);
      outcome = err.text;
    }
    const sent = ctx.lines.slice(from).filter((l) => l.endpoint !== "/authentication/login");
    const keys = [...new Set(sent.map((l) => `${l.method} ${normalizePath(l.endpoint) ?? l.endpoint}`))].filter((k) => !o.only || o.only.includes(k));
    if (!keys.length) {
      rows.push({ capability, method: "-", endpoint: "-", function: fn, http_status: null, error_code: err?.code ?? null, at: null, live: false, new_endpoint: false, outcome: `not sent: ${outcome}`, id, request_id: o.requestId ?? null, awx_request_id: null, trace_id: null });
      log(`NOT SENT  ${fn}: ${outcome}`);
      return value;
    }
    for (const k of keys) {
      const hit = sent.filter((l) => `${l.method} ${normalizePath(l.endpoint) ?? l.endpoint}` === k).at(-1)!;
      const [method, endpoint] = k.split(" ") as [string, string];
      const live = ok2xx(hit.status);
      const row: DeepResult = {
        capability, method, endpoint, function: fn, http_status: hit.status, error_code: hit.code ?? null, at: hit.at, live, new_endpoint: (NEW_ENDPOINTS as readonly string[]).includes(k),
        outcome: live && err ? `this call answered ${hit.status}; the step failed after it: ${outcome}` : outcome, id, request_id: o.requestId ?? null, awx_request_id: hit.awx_request_id ?? null, trace_id: hit.trace_id ?? null,
      };
      rows.push(row);
      log(`${live ? "LIVE" : "NOT "}  ${k}: ${hit.status}${hit.code ? ` ${hit.code}` : ""}; ${outcome}`);
    }
    return value;
  }

  // ---- 1. Payout terms validated before the signature; a signed, scheduled payment withdrawn before its day ----------
  if (on("revoke") && ctx.revokeExisting) {
    const id = ctx.revokeExisting;
    ctx.known.add(id);
    const rv = await step("1 validate and revoke", "revokeScheduledTransfer, the transfer the first pass scheduled (src/airwallex/transferRevoke.ts)", () => revokeScheduledTransfer(api, id),
      (r) => ({ outcome: `read first: ${r.before.status}; the cancel answered ${r.cancelAnswer}; read back: ${r.after.status}`, id }));
    facts.revoke = { terms: null, validated: false, scheduled: { id, status: "SCHEDULED", transfer_date: null }, before: rv?.before.status ?? null, after: rv?.after.status ?? null };
  }
  const day = new Date(started.getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  const termsBase = { requestId: randomUUID(), beneficiaryId: BERGTEX_BENEFICIARY, amountCents: 100, currency: "EUR", reference: `AWXDEEP-${ctx.runId.slice(-6)}`, reason: "professional_business_services", transferDate: day };
  const approvalSha256 = sha256(JSON.stringify({ ...termsBase, payee: "Bergtex Textil GmbH", note: "awx-deep test terms (sandbox, test money); no passkey signs in this run" }));
  const planned: PlannedTransfer & { transferDate: string } = { ...termsBase, approvalSha256 };
  if (on("revoke") && !ctx.revokeExisting) {
  facts.revoke = { terms: { ...termsBase, approval_sha256: approvalSha256 }, validated: false, scheduled: null, before: null, after: null };
  const validated = await step("1 validate and revoke", "validateTransfer (src/airwallex/transferRevoke.ts)", () => validateTransfer(api, planned),
    () => ({ outcome: `Airwallex accepted the exact terms (EUR 1.00 to Bergtex Textil GmbH, SWIFT, for ${day}) without creating a transfer` }), { requestId: planned.requestId });
  facts.revoke.validated = !!validated;
  if (validated) {
    const sched = await step("1 validate and revoke", "createScheduledTransfer (src/airwallex/transferRevoke.ts)", () => createScheduledTransfer(api, planned, started),
      (t) => ({ outcome: `created for ${t.transferDate ?? day}: ${t.status}`, id: t.id }), { requestId: planned.requestId });
    if (sched) {
      ctx.known.add(sched.id);
      facts.revoke.scheduled = { id: sched.id, status: sched.status, transfer_date: sched.transferDate };
      const rv = await step("1 validate and revoke", "revokeScheduledTransfer (src/airwallex/transferRevoke.ts)", () => revokeScheduledTransfer(api, sched.id),
        (r) => ({ outcome: `read first: ${r.before.status}; the cancel answered ${r.cancelAnswer}; read back: ${r.after.status}`, id: sched.id }), { requestId: planned.requestId });
      if (rv) { facts.revoke.before = rv.before.status; facts.revoke.after = rv.after.status; }
    }
  }
  }

  // ---- 2. The seller side: a payment link for an open receivable; a bank transfer arrives and is matched -------------
  const invoice: Receivable = { invoice_no: `NW-AR-${ctx.runId.slice(-6)}`, customer: "Alpenhof Sport AG", currency: "EUR", amount_cents: 31_250, due_date: new Date(started.getTime() + 30 * 86_400_000).toISOString().slice(0, 10) };
  let eur: { id: string } | undefined;
  if (on("receivable")) {
  openReceivable(ctx.db, invoice, started);
  facts.receivable = { invoice, link: null, global_account_id: null, deposit_id: null, arrival: null, matched: null, statement_line: null };
  const link = await step("2 receivable: link, arrival, match", "createInvoiceLink (src/airwallex/paymentLinks.ts)", () => createInvoiceLink(api, invoice, started),
    (l: PaymentLink) => ({ outcome: `a single-use link for ${l.currency} ${fromCents(l.amountCents)}, reference ${l.reference ?? "none"}, ${l.active ? "active" : "not active"}`, id: l.id }));
  if (link) {
    ctx.known.add(link.id);
    const back = await step("2 receivable: link, arrival, match", "getLink (src/airwallex/paymentLinks.ts)", () => getLink(api, link.id),
      (l) => { const d = linkDifferences(l, invoice); return { outcome: d.length ? `read back; differs from the invoice: ${d.join("; ")}` : "read back: exactly the invoice (amount, currency, reference, single use)", id: l.id }; });
    facts.receivable.link = { id: link.id, active_at_create: link.active, differences: back ? linkDifferences(back, invoice) : ["not read back"], active_after: null };
  }
  const gas = await step("2 receivable: link, arrival, match", "the EUR Global Account (GET /global_accounts, src/proof/awxDeepLive.ts)",
    () => api.call<{ items: { id: string; status: string; required_features?: { currency: string }[]; supported_features?: { currency: string }[] }[] }>("GET", "/global_accounts", undefined, { status: "ACTIVE", page_size: "100" }),
    (r) => ({ outcome: `${r.items.length} ACTIVE Global Accounts` }));
  eur = gas?.items.find((g) => g.id !== AUD_GA_COVERAGE && [...(g.required_features ?? []), ...(g.supported_features ?? [])].some((f) => f.currency === "EUR"));
  if (eur) {
    const ga = eur;
    facts.receivable.global_account_id = ga.id;
    const dep = await step("2 receivable: link, arrival, match", "simulateDeposit (src/airwallex/deposits.ts; the sandbox's simulation)",
      () => simulateDeposit(api, { globalAccountId: ga.id, amount: fromCents(invoice.amount_cents), payer: invoice.customer, reference: invoice.invoice_no }),
      (d) => ({ outcome: `SIMULATED by the sandbox: EUR ${fromCents(d.amountCents)} from ${invoice.customer}, reference ${invoice.invoice_no} (${d.status})`, id: d.id }));
    if (dep) {
      facts.receivable.deposit_id = dep.id;
      const window = { from: iso(new Date(started.getTime() - 60_000)), to: iso(new Date(now().getTime() + 120_000)) };
      let found: { tx: GaTransaction | null; why: string } = { tx: null, why: "not read" };
      for (let i = 0; i < 3 && !found.tx; i++) {
        if (i) await sleep(4000);
        const txs = await step("2 receivable: link, arrival, match", "listGlobalAccountTransactions (src/airwallex/globalAccountTx.ts)", () => listGlobalAccountTransactions(api, ga.id, window),
          (t) => { const f = findArrival(t, { currency: "EUR", amountCents: invoice.amount_cents, reference: invoice.invoice_no, payer: invoice.customer }); return { outcome: `${t.length} transaction(s) on the EUR account in the window; ${f.why}`, id: f.tx?.id ?? null }; });
        if (!txs) break;
        found = findArrival(txs, { currency: "EUR", amountCents: invoice.amount_cents, reference: invoice.invoice_no, payer: invoice.customer });
      }
      if (found.tx) {
        facts.receivable.arrival = { id: found.tx.id, amount: fromCents(found.tx.amountCents), currency: found.tx.currency, status: found.tx.status, why: found.why };
        const reference = found.tx.description.includes(invoice.invoice_no) ? found.tx.description : dep.reference;
        facts.receivable.matched = matchReceipt(ctx.db, receiptOf(eur.id, found.tx, reference), now());
        log(`MATCH  ${facts.receivable.matched.outcome}: ${facts.receivable.matched.detail}`);
      }
      const status = (ctx.db.prepare("SELECT status FROM receivables WHERE invoice_no = ?").get(invoice.invoice_no) as { status: string }).status;
      if (link) {
        const off = await step("2 receivable: link, arrival, match", "retireLink (src/airwallex/paymentLinks.ts)", () => retireLink(api, link.id, status),
          (l) => ({ outcome: `the invoice is ${status}: link deactivated (active: ${l.active})`, id: l.id }));
        if (facts.receivable.link) facts.receivable.link.active_after = off ? off.active : null;
      }
    }
  }
  }

  // ---- 3. An agent card's headroom in Airwallex's own numbers ---------------------------------------------------------
  type RawCard = { card_id: string; card_status?: string; nick_name?: string; created_at?: string; authorization_controls?: { transaction_limits?: { currency: string; limits: { amount: number; interval: string }[] } } };
  if (on("card")) {
  const cards = await step("3 agent card headroom", "the newest ACTIVE agent card (GET /issuing/cards, src/proof/awxDeepLive.ts)",
    () => api.call<{ items: RawCard[] }>("GET", "/issuing/cards", undefined, { card_status: "ACTIVE", page_num: "0", page_size: "50" }),
    (r) => ({ outcome: `${r.items.length} ACTIVE card(s)` }));
  // The list does not carry each card's controls: the newest cards are read one by one (at most 3) for the limits Purser set.
  let card: RawCard | undefined;
  for (const c of (cards?.items ?? []).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 3)) {
    const full = await step("3 agent card headroom", "the card's limits as Purser set them (GET /issuing/cards/{id}, src/proof/awxDeepLive.ts)",
      () => api.call<RawCard>("GET", `/issuing/cards/${encodeURIComponent(c.card_id)}`),
      (r) => { const l = toLimits(r.authorization_controls?.transaction_limits); return { outcome: l ? `${r.nick_name ?? "no nickname"}: EUR ${fromCents(l.perTxCents)} per transaction, EUR ${fromCents(l.monthlyCents)} a month` : `${r.nick_name ?? "no nickname"}: no EUR per-transaction and monthly limits`, id: c.card_id }; });
    if (full && toLimits(full.authorization_controls?.transaction_limits)) { card = full; break; }
  }
  if (card) {
    const set = toLimits(card.authorization_controls?.transaction_limits);
    const rem = await step("3 agent card headroom", "cardRemainingLimits (src/airwallex/cardHeadroom.ts)", () => cardRemainingLimits(api, card.card_id),
      (r) => ({ outcome: r.limits.map((l) => `${l.interval} ${r.currency} ${fromCents(Math.max(0, l.remainingCents))} of ${fromCents(Math.max(0, l.limitCents))} left`).join("; ") || "no limits", id: card.card_id }));
    const auths = await step("3 agent card headroom", "cardAuthorizations (src/airwallex/cardHeadroom.ts)",
      () => cardAuthorizations(api, card.card_id, { from: iso(new Date(started.getTime() - 30 * 86_400_000)), to: iso(now()) }),
      (a) => ({ outcome: `${a.length} authorisation(s) in 30 days, ${a.filter((x) => x.status === "PENDING").length} PENDING`, id: card.card_id }));
    if (rem) facts.card = { card_id: card.card_id, nickname: card.nick_name ?? "", purser_limits: set ? { per_transaction: `EUR ${fromCents(set.perTxCents)}`, monthly: `EUR ${fromCents(set.monthlyCents)}` } : null, headroom: headroom(rem, auths ?? [], set ? { perTransactionCents: set.perTxCents, monthlyCents: set.monthlyCents } : null) };
  }
  }

  // ---- 4. The wallet statement: it adds up, and the soak's payouts and conversions are on it ----------------------------
  const soakMoves: RecordedMovement[] = movementsFromSoakRecord(ctx.soak);
  if (on("statement")) {
  const hist = await step("4 balance history", "listBalanceHistory (src/airwallex/balanceHistory.ts)", () => listBalanceHistory(api, { from: SOAK.from, to: SOAK.to }),
    (l) => ({ outcome: `${l.length} statement line(s) posted ${SOAK.from.slice(11, 16)}–${SOAK.to.slice(11, 16)} UTC` }));
  if (hist) {
    const c = checkContinuity(hist), m = matchStatement(soakMoves, hist);
    facts.statement = {
      window: { from: SOAK.from, to: SOAK.to }, lines: hist.length, continuity: c, checked: m.checked, agree: m.agree,
      differences: m.matches.filter((x) => !x.agrees).map((x) => ({ label: x.label, recorded: x.recorded, on_statement: x.onStatement, how: x.how })), fee_lines: hist.filter((l) => l.sourceType === "FEE" || l.transactionType === "FEE").length,
      statement_lines: hist.map((l) => ({ id: l.id, currency: l.currency, amount_cents: l.amountCents, balance_cents: l.balanceCents, source: l.source, source_type: l.sourceType, transaction_type: l.transactionType, posted_at: l.postedAt })),
    };
    log(`STATEMENT  ${hist.length} lines; ${c.links - c.breaks.length} of ${c.links} links add up; ${m.agree} of ${m.checked} recorded movements on it to the cent`);
  }
  }
  if (on("statement") && facts.receivable?.deposit_id) {
    const dep = facts.receivable.deposit_id;
    const mine = await step("4 balance history", "listBalanceHistory, this run's window (src/airwallex/balanceHistory.ts)",
      () => listBalanceHistory(api, { from: iso(new Date(started.getTime() - 60_000)), to: iso(new Date(now().getTime() + 60_000)) }),
      (l) => { const hit = l.filter((x) => x.source === dep); return { outcome: `${l.length} line(s) in this run's window; ${hit.length ? `the deposit: ${hit.map((x) => `${x.transactionType || x.sourceType} EUR ${fromCents(Math.abs(x.amountCents))}, balance after EUR ${fromCents(Math.max(0, x.balanceCents))}`).join("; ")}` : "no line under the deposit's id yet"}; ${facts.revoke?.scheduled ? `${l.filter((x) => x.source === facts.revoke!.scheduled!.id).length} under the cancelled transfer` : ""}` }; });
    if (mine && facts.receivable) {
      const hit = mine.find((x) => x.source === dep);
      facts.receivable.statement_line = hit ? `${hit.transactionType || hit.sourceType} +EUR ${fromCents(Math.abs(hit.amountCents))} (balance after EUR ${fromCents(Math.max(0, hit.balanceCents))})` : null;
    }
  }

  // ---- 5. Clean-up: the AUD Global Account the coverage check opened and Purser does not use --------------------------
  if (on("cleanup")) {
  const closed = await step("5 clean-up", "closeUnusedGlobalAccount (src/airwallex/globalAccountTx.ts)", () => closeUnusedGlobalAccount(api, AUD_GA_COVERAGE, eur ? [eur.id] : []),
    (r) => ({ outcome: `was ${r.before.status} (${r.before.currencies.join(", ") || "no currency named"}); closed; read back: ${r.after.status}`, id: AUD_GA_COVERAGE }));
  if (closed) facts.cleanup = { global_account_id: AUD_GA_COVERAGE, before: closed.before.status, after: closed.after.status };
  }

  return { rows, facts };
}

export interface DeepRecord {
  run: "airwallex-deep";
  ran_at: string;
  label: string;
  sandbox: string;
  test_money: true;
  simulated: string;
  command: string;
  budget: { approved: number | null; used: number; status_429: number };
  totals: { rows: number; live: number; refused: number; new_endpoints: number; new_endpoints_live: number };
  results: DeepResult[];
  facts: DeepFacts;
  calls: DeepLine[];
}

export function deepRecord(rows: DeepResult[], facts: DeepFacts, lines: DeepLine[], o: { ranAt: string; budget: number | null; used: number }): DeepRecord {
  const newKeys = new Set(rows.filter((r) => r.new_endpoint).map((r) => `${r.method} ${r.endpoint}`));
  const newLive = new Set(rows.filter((r) => r.new_endpoint && r.live).map((r) => `${r.method} ${r.endpoint}`));
  return {
    run: "airwallex-deep", ran_at: o.ranAt, label: "Airwallex sandbox · test money", sandbox: "https://api.sandbox.airwallex.com/api/v1", test_money: true,
    simulated: "The customer's bank transfer is made by the sandbox's simulation endpoint (POST /simulation/deposit/create): nobody paid anything. No passkey signs in this run: the revoked transfer carries the hash of its test terms, and the run plays the CFO withdrawing it.",
    command: "npm run airwallex:deep -- live",
    budget: { approved: o.budget, used: o.used, status_429: lines.filter((l) => l.status === 429).length },
    totals: { rows: rows.length, live: rows.filter((r) => r.live).length, refused: rows.filter((r) => !r.live && r.http_status !== null).length, new_endpoints: newKeys.size, new_endpoints_live: newLive.size },
    results: rows, facts, calls: lines,
  };
}

/** What Airwallex answered the cancel, from the rows (for the summary line). */
const cancelSaid = (r: DeepRecord) => {
  const c = r.results.filter((x) => x.method === "POST" && x.endpoint === "/transfers/{id}/cancel").at(-1);
  return c ? `Airwallex answered ${c.http_status}${c.error_code ? ` ${c.error_code}` : ""}${c.live ? "" : "; the transfer was not cancelled"}` : "not sent";
};

const cell = (s: string | number | boolean | null | undefined) => String(s ?? "–").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function deepMarkdownRecord(r: DeepRecord, date: string, name = `${date}-airwallex-deep`): string {
  const f = r.facts;
  const st = f.statement;
  return [
    `# Airwallex, deeper: ${date}`,
    "",
    `\`${r.command}\` (src/cli/airwallexDeep.ts, src/proof/awxDeepLive.ts). The **Airwallex sandbox** only, test money only. The machine-readable record,`,
    `with every call's HTTP status and Airwallex's own request and trace ids, is docs/runs/${name}.json.`,
    "",
    `**${r.totals.new_endpoints_live} of ${r.totals.new_endpoints} new endpoints answered 2xx.** ${r.totals.live} of ${r.totals.rows} calls in the table live, ${r.totals.refused} refused. ${r.budget.used} Airwallex calls${r.budget.approved ? ` of a budget of ${r.budget.approved}` : ""} (logins included), ${r.budget.status_429} answered 429.`,
    "",
    `Simulated: ${r.simulated}`,
    "",
    "## What each capability showed",
    "",
    `1. **Terms checked before the signature; a signed payment withdrawn before its day.** ${f.revoke && !f.revoke.terms ? `The transfer an earlier pass scheduled, \`${f.revoke.scheduled?.id}\`: read first ${f.revoke.before ?? "(not read)"}; ${f.revoke.after ? `cancelled; read back **${f.revoke.after}**` : "not cancelled (see the table)"}.` : f.revoke && f.revoke.terms ? `Airwallex ${f.revoke.validated ? "accepted" : "did not accept"} the exact terms (EUR 1.00 to Bergtex Textil GmbH, reference ${f.revoke.terms.reference}, request_id \`${f.revoke.terms.requestId}\`, terms hash \`${f.revoke.terms.approval_sha256.slice(0, 16)}…\`) through transfers/validate.${f.revoke.scheduled ? ` Created for ${f.revoke.scheduled.transfer_date ?? f.revoke.terms.transferDate}: transfer \`${f.revoke.scheduled.id}\`, ${f.revoke.scheduled.status}.` : ""}${f.revoke.after ? ` Read first: ${f.revoke.before}; cancelled; read back: **${f.revoke.after}**.` : f.revoke.scheduled ? ` The cancel: ${cancelSaid(r)}.` : ""}` : "not run"}`,
    `2. **The seller side.** ${f.receivable ? `Open receivable ${f.receivable.invoice.invoice_no} (${f.receivable.invoice.customer}, EUR ${fromCents(f.receivable.invoice.amount_cents)}, due ${f.receivable.invoice.due_date}).${f.receivable.link ? ` Payment link \`${f.receivable.link.id}\`: ${f.receivable.link.differences.length ? `differs: ${f.receivable.link.differences.join("; ")}` : "read back as exactly the invoice"}.` : " No payment link."}${f.receivable.deposit_id ? ` The sandbox simulated the customer's transfer (deposit \`${f.receivable.deposit_id}\`).` : ""}${f.receivable.arrival ? ` On the EUR Global Account's own statement: \`${f.receivable.arrival.id}\`, EUR ${f.receivable.arrival.amount}, ${f.receivable.arrival.status}.` : " Not found on the Global Account's statement."}${f.receivable.matched ? ` The receivables agent: **${f.receivable.matched.outcome}** (${f.receivable.matched.detail}).` : ""}${f.receivable.link && f.receivable.link.active_after !== null ? ` Link switched off: active ${f.receivable.link.active_after}.` : ""}${f.receivable.statement_line ? ` On the wallet statement: ${f.receivable.statement_line}.` : ""}` : "not run"}`,
    `3. **An agent card's headroom.** ${f.card ? `Card \`${f.card.card_id}\` (${f.card.nickname || "no nickname"}): ${f.card.headroom.intervals.map((i) => `${i.interval} ${i.remaining} left of ${i.limit}`).join("; ")}; spendable in one go ${f.card.headroom.spendable}; ${f.card.headroom.pendingHolds.count} pending hold(s), ${f.card.headroom.pendingHolds.total}. Against Purser's limits (${f.card.purser_limits ? `${f.card.purser_limits.per_transaction} per transaction, ${f.card.purser_limits.monthly} a month` : "none read"}): ${f.card.headroom.disagreements.length ? f.card.headroom.disagreements.join("; ") : "agree"}.` : "not run"}`,
    `4. **The wallet statement.** ${st ? `${st.lines} lines posted ${st.window.from.slice(11, 16)}–${st.window.to.slice(11, 16)} UTC (the soak run). Continuity: ${st.continuity.links - st.continuity.breaks.length} of ${st.continuity.links} links add up${st.continuity.breaks.length ? ` (${st.continuity.breaks.length} break(s), listed in the JSON)` : ""}. The soak record's payouts and conversion legs: **${st.agree} of ${st.checked} on the statement to the cent**${st.differences.length ? `; ${st.differences.length} not: ${st.differences.slice(0, 3).map((d) => `${d.label} (${d.how})`).join("; ")}` : ""}. ${st.fee_lines} fee line(s), reported beside the payouts${st.continuity.holdLines ? `; ${st.continuity.holdLines} conversion hold and release line(s), read with the amount's sign inverted (src/airwallex/balanceHistory.ts, HOLD_SIGN_INVERTED)` : ""}.` : "not run"}`,
    `5. **Clean-up.** ${f.cleanup ? `The AUD Global Account \`${f.cleanup.global_account_id}\` the coverage check opened this morning: ${f.cleanup.before}, closed, read back **${f.cleanup.after}**.` : "not run (see the table)"}`,
    "",
    "## Every endpoint call",
    "",
    "| Capability | Endpoint | New | Function | HTTP | Live | What happened | Id | Our request_id | Airwallex trace id (x-b3-traceid) |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...r.results.map((x) => `| ${cell(x.capability)} | \`${x.method} ${x.endpoint}\` | ${x.new_endpoint ? "new" : ""} | ${cell(x.function)} | ${x.http_status ?? "not sent"}${x.error_code ? ` \`${cell(x.error_code)}\`` : ""} | ${x.live ? "**yes**" : "no"} | ${cell(x.outcome)} | ${x.id ? `\`${cell(x.id)}\`` : "–"} | ${x.request_id ? `\`${x.request_id}\`` : "–"} | ${x.trace_id ?? x.awx_request_id ? `\`${x.trace_id ?? x.awx_request_id}\`` : "–"} |`),
    "",
    "## Every call (UTC; no body, header, token or key)",
    "",
    "| # | Time | Call | HTTP | Airwallex request id | Trace id |",
    "|---|---|---|---|---|---|",
    ...r.calls.map((c, i) => `| ${i + 1} | ${c.at.slice(11, 23)} | \`${c.method} ${c.endpoint}\` | ${c.status}${c.code ? ` \`${cell(c.code)}\`` : ""} | ${c.awx_request_id ? `\`${c.awx_request_id}\`` : "–"} | ${c.trace_id ? `\`${c.trace_id}\`` : "–"} |`),
    "",
    "## What this does not show",
    "",
    "- One run each: not every branch around each call. The unit tests (test/airwallex-deep.test.ts) cover the refusals and edge cases on stand-ins.",
    "- The customer's payment is the sandbox's simulation, not a bank's; the payment link was not paid (its checkout is a browser page), it was switched off once the invoice was paid by the simulated transfer.",
    "- The revoked transfer was never signed with a passkey: it shows Airwallex's side (SCHEDULED, then cancelled), not the CFO's withdrawal screen.",
    "- `POST /hosted_flows/{id}/authorize` stays not live: it needs Airwallex's onboarding template id, which this sandbox account was never issued (docs/runs/2026-11-19-airwallex-coverage.md).",
    "",
  ].join("\n");
}

// --- The stand-in, for `-- plan` and the tests (never a live run) ------------------------------------------------------

type Route = (body: Record<string, unknown>, query: URLSearchParams, path: string) => { status: number; json: unknown };
const j = (status: number, json: unknown) => ({ status, json });

/** Airwallex in memory for this run; `refuse` makes one endpoint ("METHOD /template") answer an error, as a feature not enabled would. */
export function deepStandInFetch(o: { refuse?: Record<string, { status: number; code: string }> } = {}): typeof fetch {
  const transfers = new Map<string, Record<string, unknown>>();
  const links = new Map<string, Record<string, unknown>>();
  const gaTx: Record<string, unknown>[] = [];
  const history: Record<string, unknown>[] = [];
  const ga = { aud: { id: AUD_GA_COVERAGE, status: "ACTIVE", required_features: [{ currency: "AUD" }] }, eur: { id: "9a000000-0000-4000-8000-0000000000e1", status: "ACTIVE", required_features: [{ currency: "EUR" }] } };
  let n = 0;
  const routes: Record<string, Route> = {
    "POST /authentication/login": () => j(201, { token: "stand-in-token", expires_at: "2099-01-01T00:00:00Z" }),
    "POST /transfers/validate": () => j(200, { result: "OK" }),
    "POST /transfers/create": (b) => { const t = { id: `7f000000-0000-4000-8000-00000000000${++n}`, status: b.transfer_date ? "SCHEDULED" : "PROCESSING", transfer_amount: Number(b.transfer_amount), transfer_currency: b.transfer_currency, reference: b.reference, transfer_date: b.transfer_date, request_id: b.request_id }; transfers.set(t.id, t); return j(201, t); },
    "GET /transfers/{id}": (_b, _q, p) => { const t = transfers.get(p.split("/")[2]!); return t ? j(200, t) : j(404, { code: "not_found" }); },
    "POST /transfers/{id}/cancel": (_b, _q, p) => { const t = transfers.get(p.split("/")[2]!); if (!t) return j(404, { code: "not_found" }); t.status = "CANCELLED"; return j(200, "OK"); },
    "POST /pa/payment_links/create": (b) => { const l = { id: `plink_StandIn${++n}x`, url: "https://checkout.sandbox.airwallex.com/standin", active: true, status: "UNPAID", amount: b.amount, currency: b.currency, reference: b.reference, reusable: b.reusable, metadata: b.metadata }; links.set(l.id, l); return j(201, l); },
    "GET /pa/payment_links/{id}": (_b, _q, p) => { const l = links.get(p.split("/")[3]!); return l ? j(200, l) : j(404, { code: "not_found" }); },
    "POST /pa/payment_links/{id}/deactivate": (_b, _q, p) => { const l = links.get(p.split("/")[3]!); if (!l) return j(404, { code: "not_found" }); l.active = false; return j(200, l); },
    "GET /global_accounts": () => j(200, { items: [ga.eur, ga.aud].filter((g) => g.status === "ACTIVE") }),
    "GET /global_accounts/{id}": (_b, _q, p) => { const g = [ga.eur, ga.aud].find((x) => x.id === p.split("/")[2]); return g ? j(200, g) : j(404, { code: "not_found" }); },
    "POST /global_accounts/{id}/close": (_b, _q, p) => { const g = [ga.eur, ga.aud].find((x) => x.id === p.split("/")[2]); if (!g) return j(404, { code: "not_found" }); g.status = "CLOSED"; return j(200, g); },
    "POST /simulation/deposit/create": (b) => {
      const id = `de000000-0000-4000-8000-00000000000${++n}`;
      gaTx.push({ id: `ga-tx-${n}`, type: "DEPOSIT", status: "SETTLED", currency: "EUR", amount: b.amount, payer_name: b.payer_name, description: `${b.payer_name} ${b.reference}`, create_time: new Date().toISOString() });
      history.push({ id: `bh-${n}`, currency: "EUR", amount: b.amount, balance: 1000 + Number(b.amount), source: id, source_type: "DEPOSIT", transaction_type: "DEPOSIT", posted_at: new Date().toISOString() });
      return j(201, { id, global_account_id: b.global_account_id, amount: b.amount, currency: "EUR", status: "SETTLED", reference: b.reference, payer_name: b.payer_name });
    },
    "GET /global_accounts/{id}/transactions": () => j(200, { items: gaTx, has_more: false }),
    // The list does not carry the controls (as live); the card itself does.
    "GET /issuing/cards": () => j(200, { items: [{ card_id: "c4000000-0000-4000-8000-000000000001", card_status: "ACTIVE", nick_name: "agent sourcing", created_at: "2026-11-07T10:00:00Z" }] }),
    "GET /issuing/cards/{id}": () => j(200, { card_id: "c4000000-0000-4000-8000-000000000001", card_status: "ACTIVE", nick_name: "agent sourcing", created_at: "2026-11-07T10:00:00Z", authorization_controls: { transaction_limits: { currency: "EUR", limits: [{ amount: 50, interval: "PER_TRANSACTION" }, { amount: 200, interval: "MONTHLY" }] } } }),
    "GET /issuing/cards/{id}/limits": () => j(200, { currency: "EUR", limits: [{ amount: 50, interval: "PER_TRANSACTION", remaining: 50 }, { amount: 200, interval: "MONTHLY", remaining: 155 }] }),
    "GET /issuing/authorizations": () => j(200, { items: [{ transaction_id: "a1", status: "PENDING", billing_currency: "EUR", billing_amount: -19.99, merchant: { name: "Stand-in Shop" } }], has_more: false }),
    "GET /balances/history": (_b, q) => {
      if (q.get("from_post_at")?.startsWith("2026-11-19T08:49")) {
        return j(200, { items: [
          { id: "s1", currency: "EUR", amount: -1, balance: 999, source: "a63888f6-3388-498e-993f-d2efbb64b578", source_type: "PAYOUT", transaction_type: "PAYOUT", posted_at: "2026-11-19T08:49:35+0000" },
          { id: "s0", currency: "EUR", amount: 1000, balance: 1000, source: "seed", source_type: "DEPOSIT", transaction_type: "DEPOSIT", posted_at: "2026-11-19T08:49:01+0000" },
        ], has_more: false });
      }
      return j(200, { items: history, has_more: false });
    },
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const key = `${method} ${endpointOf(url.href)}`;
    const refused = o.refuse?.[key];
    const route = routes[key];
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const r = refused ? j(refused.status, { code: refused.code, message: "stand-in refusal" }) : route ? route(body, url.searchParams, path) : j(404, { code: "resource_not_found" });
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json", "x-request-id": `standin-${method.toLowerCase()}-${path.split("/")[1]}` } });
  }) as typeof fetch;
}
