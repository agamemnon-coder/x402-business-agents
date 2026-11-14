// Purser Cloud's live Airwallex tab (14 Nov): what the console's Airwallex page reads, live from the Airwallex sandbox.
// Purser Cloud holds no Airwallex key. It asks the site's Worker (kit11) through a service binding (AWX_READ, a named
// entrypoint no HTTP request can reach; worker/src/awxRead.ts). Only that Worker talks to the sandbox, by a fixed table
// of read-only calls, and answers each view without a key or a token. Here each answer is labelled, and checked against
// Purser's own records where it can be:
//   reconcile      Purser's ledger of the recorded awx-1 run (docs/demo/airwallex-run.json, 7 Nov) against Airwallex's
//                  financial transactions for the same window, read live, by the runner's own comparison
//                  (src/finance/awxReconcile.ts): exact, in integer cents; "0 differences" only when it was computed
//   transfers      each transfer's approval_sha256 (the metadata Purser put on it) against the record's own hash
//   beneficiaries  the payee check recorded on 12 Nov, where the name matches (recorded, not live, and said so)
//   issuing        each card's agent, from its nickname as Purser named it
// Guards: a per-visitor cap here, a global cap and a 45 s cache in the gateway, a timeout, and a clear "Airwallex
// sandbox unavailable" answer when anything fails. Read only, in guest mode too: every route here is a GET.

import { AWX_RUN_RECORDED, PAYEE_CHECKS_RECORDED } from "./awxRecorded.js";
import { ledgerMovementsFromRunRecord, reconcileFinancialTransactions, toFinancialTx } from "../../src/finance/awxReconcile.js";

/** The service binding's one method used here (worker/src/index.ts, AwxRead). */
export interface AwxReadBinding { read(view: string): Promise<unknown> }

export const AWX_SANDBOX_HOST = "api.sandbox.airwallex.com";
/** The views the page reads: the gateway's own, and the reconciliation made here from its financial transactions. */
export const AWX_LIVE_VIEWS = ["balances", "accounts", "financial", "rates", "transfers", "beneficiaries", "issuing", "calls", "reconcile"] as const;
export type AwxLiveView = (typeof AWX_LIVE_VIEWS)[number];
export const isAwxLiveView = (v: unknown): v is AwxLiveView => typeof v === "string" && (AWX_LIVE_VIEWS as readonly string[]).includes(v);

/** Reads of this page a visitor (one network) may make a minute: a full page is nine. */
export const AWX_VISITOR_PER_MINUTE = 36;
/** How long the cloud waits for the gateway before it says the sandbox is unavailable. */
export const AWX_GATEWAY_TIMEOUT_MS = 12_000;

type Unavailable = { view: AwxLiveView; source: "unavailable"; host: string; code: string; reason: string; checked_at: string };
type Live = { view: AwxLiveView; source: "airwallex-sandbox"; host: string; read_at: string; cache_seconds: number; data: Record<string, unknown> };
export type AwxLiveAnswer = Live | Unavailable;

const unavailable = (view: AwxLiveView, code: string, reason: string, now: Date): Unavailable => ({ view, source: "unavailable", host: AWX_SANDBOX_HOST, code, reason, checked_at: now.toISOString() });

/** Words that never leave here: a key or a token in any form. An answer that holds one is dropped whole. */
const SECRET_SHAPE = /"(token|access_token|api_key|x-api-key|apiKey|client_secret|authorization)"\s*:/i;

/** The gateway's answer, checked: its shape, the sandbox host, no secret-looking field. Anything else is "unavailable". */
export function checkGatewayAnswer(view: AwxLiveView, raw: unknown, now: Date): AwxLiveAnswer {
  const r = raw as { host?: unknown; source?: unknown; code?: unknown; reason?: unknown; read_at?: unknown; cache_seconds?: unknown; data?: unknown } | null;
  if (!r || typeof r !== "object" || r.host !== AWX_SANDBOX_HOST) return unavailable(view, "bad_answer", "the Airwallex gateway gave no usable answer", now);
  if (SECRET_SHAPE.test(JSON.stringify(r))) return unavailable(view, "bad_answer", "the Airwallex gateway's answer was withheld", now);
  if (r.source === "unavailable") return unavailable(view, String(r.code ?? "no_answer").slice(0, 40), String(r.reason ?? "the Airwallex sandbox is unavailable").slice(0, 200), now);
  if (r.source !== "airwallex-sandbox" || typeof r.read_at !== "string" || !r.data || typeof r.data !== "object") return unavailable(view, "bad_answer", "the Airwallex gateway gave no usable answer", now);
  return { view, source: "airwallex-sandbox", host: AWX_SANDBOX_HOST, read_at: r.read_at, cache_seconds: Number(r.cache_seconds) || 0, data: r.data as Record<string, unknown> };
}

/** One view from the gateway, with a timeout; never throws. */
async function fromGateway(gw: AwxReadBinding | undefined, view: Exclude<AwxLiveView, "reconcile">, now: Date): Promise<AwxLiveAnswer> {
  if (!gw) return unavailable(view, "no_gateway", "this deployment has no Airwallex gateway", now);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([gw.read(view), new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error("timeout")), AWX_GATEWAY_TIMEOUT_MS); })]);
    return checkGatewayAnswer(view, raw, now);
  } catch (e) {
    return unavailable(view, "no_answer", e instanceof Error && e.message === "timeout" ? "the Airwallex sandbox did not answer in time" : "the Airwallex gateway did not answer", now);
  } finally { if (timer) clearTimeout(timer); }
}

// --- What the recorded runs hold, for the checks -----------------------------------------------------------------
interface RunInvoice { invoice_no: string; amount: string; transfer_id: string | null; status: string; fee: string | null; conversion_id: string | null; approval_sha256?: string | null; quote: null | { buy_eur: string; sell_usd: string } }
const RUN = AWX_RUN_RECORDED as unknown as { run: string; invoices: RunInvoice[] };
const REPO = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
/** The record Purser's ledger is read from for the reconciliation. */
export const RUN_RECORD = { run: RUN.run, file: "docs/demo/airwallex-run.json", url: `${REPO}docs/demo/airwallex-run.json` };
/** Each recorded transfer's approval hash, by Airwallex transfer id. */
const RECORDED_SHA = new Map(RUN.invoices.filter((i) => i.transfer_id && i.approval_sha256).map((i) => [i.transfer_id!, { sha: i.approval_sha256!, invoice: i.invoice_no }]));
/** The payee checks recorded on 12 Nov (Airwallex account verification), by the name checked. */
const PAYEE: readonly { name: string; match: string | null; label: string | null; at: string }[] = PAYEE_CHECKS_RECORDED;

type Row = Record<string, unknown>;
const list = (d: Record<string, unknown>, k: string): Row[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter((x): x is Row => !!x && typeof x === "object") : []);

/** Transfers with the approval hash checked against the recorded run, where the run holds that transfer. */
export function annotateTransfers(data: Record<string, unknown>): Record<string, unknown> {
  const transfers = list(data, "transfers").map((t) => {
    const rec = typeof t.id === "string" ? RECORDED_SHA.get(t.id) : undefined;
    const sha = typeof t.approval_sha256 === "string" ? t.approval_sha256 : null;
    return { ...t, approval_sha256: sha, recorded: rec ? { invoice: rec.invoice, approval_sha256: rec.sha, matches: sha === rec.sha } : null };
  });
  // The recorded payouts read back by id: Airwallex's metadata.approval_sha256 against the hash the CFO signed (the record).
  const readback = list(data, "readback").map((t) => {
    const rec = typeof t.id === "string" ? RECORDED_SHA.get(t.id) : undefined;
    const sha = typeof t.approval_sha256 === "string" ? t.approval_sha256 : null;
    return rec ? { id: t.id, status: t.status ?? null, amount: t.amount ?? null, currency: t.currency ?? null, invoice: rec.invoice, airwallex_sha256: sha, signed_sha256: rec.sha, matches: sha === rec.sha } : null;
  }).filter((x) => x !== null);
  return { transfers, with_approval_hash: transfers.filter((t) => t.approval_sha256).length, readback, record: RUN_RECORD };
}

/** Beneficiaries with the recorded payee check whose name matches (recorded on 12 Nov, not live). */
export function annotateBeneficiaries(data: Record<string, unknown>): Record<string, unknown> {
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const beneficiaries = list(data, "beneficiaries").map((b) => {
    // By the payee's name, or by the nickname Purser gave the beneficiary ("Stockline Data GmbH EUR SWIFT").
    const checks = PAYEE.filter((p) => norm(p.name) === norm(b.name) || (norm(p.name).length > 3 && norm(b.nickname).startsWith(norm(p.name) + " ")));
    const last = checks[checks.length - 1];
    return { ...b, payee_check: last ? { match: last.match, label: last.label, at: last.at, source: "recorded" } : null };
  });
  return { beneficiaries, payee_check_record: `${REPO}docs/runs/2026-11-12-airwallex-payee-check.json` };
}

/**
 * A live rate in words that cannot be read the wrong way round. Airwallex quotes /fx/rates/current in its currency
 * pair's own terms (currency_pair "EURUSD": US dollars for one euro), whichever side is bought: read live on 14 Nov,
 * buying EUR with USD gave 1.116374 and buying USD with EUR gave 1.08768, both under "EURUSD" (the spread between them).
 * So the words follow the pair: "1 EUR = 1.116374 USD". Without a pair that names the two currencies, no "1 X = Y" is said.
 */
export function rateWords(r: { sell_currency?: unknown; buy_currency?: unknown; rate?: unknown; pair?: unknown }): { base: string; quote: string; says: string } | null {
  const pair = typeof r.pair === "string" ? r.pair : "", buy = String(r.buy_currency ?? ""), sell = String(r.sell_currency ?? ""), rate = String(r.rate ?? "");
  if (!/^[A-Z]{6}$/.test(pair) || !/^\d+(\.\d+)?$/.test(rate)) return null;
  const base = pair.slice(0, 3), quote = pair.slice(3);
  if (!((base === buy && quote === sell) || (base === sell && quote === buy))) return null;
  return { base, quote, says: `1 ${base} = ${rate} ${quote}` };
}

/** Rates with their words (rateWords): the page shows "Buy EUR with USD · 1 EUR = 1.116374 USD". */
export function annotateRates(data: Record<string, unknown>): Record<string, unknown> {
  return { rates: list(data, "rates").map((r) => ({ ...r, ...(rateWords(r) ?? { base: null, quote: null, says: null }) })) };
}

/** Cards with their agent, from the nickname Purser gave each card ("sourcing agent: …"). */
export function annotateIssuing(data: Record<string, unknown>): Record<string, unknown> {
  const agentOf = (nick: unknown) => { const m = /^([a-z][a-z -]{1,30}?) agent\b/i.exec(String(nick ?? "")); return m ? m[1]!.toLowerCase() : null; };
  return { cards: list(data, "cards").map((c) => ({ ...c, agent: agentOf(c.nickname) })), transactions: list(data, "transactions") };
}

/**
 * Purser's ledger of the recorded run against Airwallex's financial transactions for the run's window. Each payout and
 * conversion is matched by its Airwallex id and compared exactly, in integer cents (a cent off is a difference). The
 * count of differences is only given when the comparison ran; rows Airwallex could not give are no "0 differences".
 */
export function reconcileView(fin: AwxLiveAnswer, now: Date): AwxLiveAnswer {
  if (fin.source !== "airwallex-sandbox") return { ...fin, view: "reconcile" };
  // A window with more rows than one page was cut: nothing is concluded from part of it.
  if (fin.data.run_complete === false) return unavailable("reconcile", "bad_answer", "the run's window holds more rows than one page; nothing is concluded from part of it", now);
  let rows;
  try {
    rows = list(fin.data, "run").map((r) => toFinancialTx({ id: String(r.id), source_id: (r.source_id as string | null) ?? null, source_type: String(r.source_type ?? ""), transaction_type: String(r.transaction_type ?? ""),
      currency: String(r.currency ?? ""), amount: (r.amount as string | null) ?? "0", fee: (r.fee as string | null) ?? "0", net: (r.net as string | null) ?? "0", status: String(r.status ?? ""), created_at: (r.created_at as string | null) ?? null, settled_at: (r.settled_at as string | null) ?? null }));
  } catch {
    return unavailable("reconcile", "bad_answer", "an Airwallex amount was not in cents; nothing is concluded", now);
  }
  const ledger = ledgerMovementsFromRunRecord(RUN as unknown as Parameters<typeof ledgerMovementsFromRunRecord>[0]);
  const r = reconcileFinancialTransactions(ledger, rows);
  return { view: "reconcile", source: "airwallex-sandbox", host: AWX_SANDBOX_HOST, read_at: fin.read_at, cache_seconds: fin.cache_seconds, data: {
    computed: true, ledger: RUN_RECORD, window: fin.data.run_window ?? null, airwallex_rows: rows.length,
    checked: r.checked, matched: r.agree, differences: r.differences.length,
    movements: r.movements.map((m) => ({ source_id: m.sourceId, kind: m.kind, label: m.label, matched: m.agrees, reason: m.how, ledger: m.ledger, airwallex: m.airwallex, rows: m.rows })),
    unknown_at_airwallex: r.unknownAtAirwallex, out_of_scope: r.outOfScope,
  } };
}

/** One view for the console, labelled; never throws. */
export async function awxLiveView(gw: AwxReadBinding | undefined, view: AwxLiveView, now: Date): Promise<AwxLiveAnswer> {
  if (view === "reconcile") return reconcileView(await fromGateway(gw, "financial", now), now);
  const a = await fromGateway(gw, view, now);
  if (a.source !== "airwallex-sandbox") return a;
  if (view === "transfers") return { ...a, data: annotateTransfers(a.data) };
  if (view === "beneficiaries") return { ...a, data: annotateBeneficiaries(a.data) };
  if (view === "issuing") return { ...a, data: annotateIssuing(a.data) };
  if (view === "rates") return { ...a, data: annotateRates(a.data) };
  return a;
}
