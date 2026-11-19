// The Airwallex coverage check, live (19 Nov; `npm run airwallex:coverage-live`, src/cli/airwallexCoverageLive.ts):
// each endpoint the coverage report (docs/evidence/airwallex-api-coverage.md) had not seen in a run record is called
// once against the Airwallex SANDBOX, through Purser's own function for it, with test money only; what the check creates
// is removed again where Purser's client can remove it (the batch, the webhook). An endpoint that needs something the
// sandbox account lacks (a feature, a template) is recorded with Airwallex's exact answer and stays not live.
//
// Every request goes through the client (src/airwallex/client.ts: sandbox only, one at a time, 5/s, backoff on 429)
// and its call budget (src/airwallex/callBudget.ts); `notingFetch` notes each answer's method, endpoint (ids folded),
// time, HTTP status and, for a refusal, Airwallex's error code: never a body, a header, a token or a key. The webhook's
// signing secret is dropped where createWebhook returns it. The record's rows carry `http_status`, so the coverage scan
// (src/proof/awxCoverage.ts recordMentions) counts a row as live only when Airwallex answered 2xx.

import { randomUUID } from "node:crypto";
import { AcceptanceRest, SANDBOX_TEST_CARD_SUCCESS } from "../airwallex/acceptance.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { AirwallexBatchRest } from "../airwallex/batchTransfers.js";
import { endpointOf } from "../airwallex/callBudget.js";
import { Airwallex, AirwallexAmbiguous, AirwallexError, type AirwallexConfig } from "../airwallex/client.js";
import { issuingFor } from "../airwallex/issuing.js";
import { AirwallexPlatformRest } from "../airwallex/platform.js";
import { CARD_EVENTS, createWebhook, deleteWebhook, listWebhooks } from "../airwallex/webhooks.js";
import { airwallexDiffs } from "../finance/dataQa.js";
import { fromCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { normalizePath } from "./awxCoverage.js";

/** One HTTP request as it was answered. `code` is Airwallex's error code on a refusal, when its body names one. */
export interface HttpLine { at: string; method: string; endpoint: string; status: number; code?: string }

/** What the check calls, in order: each endpoint the report had not seen live, and the function of Purser's that calls it. */
export const TARGETS = [
  { key: "accounts", method: "GET", endpoint: "/accounts", fn: "AirwallexPlatformRest.findConnectedAccount (src/airwallex/platform.ts)" },
  { key: "batchList", method: "GET", endpoint: "/batch_transfers", fn: "AirwallexBatchRest.findBatchByRequestId (src/airwallex/batchTransfers.ts)" },
  { key: "batchDelete", method: "POST", endpoint: "/batch_transfers/{id}/delete", fn: "AirwallexBatchRest.deleteBatch (src/airwallex/batchTransfers.ts)" },
  { key: "webhookCreate", method: "POST", endpoint: "/webhooks/create", fn: "createWebhook (src/airwallex/webhooks.ts)" },
  { key: "webhookDelete", method: "POST", endpoint: "/webhooks/{id}/delete", fn: "deleteWebhook (src/airwallex/webhooks.ts)" },
  { key: "cardholder", method: "POST", endpoint: "/issuing/cardholders/create", fn: "IssuingRest.createCardholder (src/airwallex/issuing.ts)" },
  { key: "globalAccount", method: "POST", endpoint: "/global_accounts/create", fn: "AirwallexRest.createGlobalAccount (src/airwallex/adapter.ts; the create usdGlobalAccountId makes)" },
  { key: "depositById", method: "GET", endpoint: "/deposits/{id}", fn: "airwallexDiffs, a deposit (src/finance/dataQa.ts)" },
  { key: "cardTxById", method: "GET", endpoint: "/issuing/transactions/{id}", fn: "airwallexDiffs, a card transaction (src/finance/dataQa.ts)" },
  { key: "intentConfirm", method: "POST", endpoint: "/pa/payment_intents/{id}/confirm", fn: "AcceptanceRest.confirmWithTestCard (src/airwallex/acceptance.ts)" },
  { key: "hostedAuthorize", method: "POST", endpoint: "/hosted_flows/{id}/authorize", fn: "AirwallexPlatformRest.onboardingLink (src/airwallex/platform.ts)" },
] as const;
export type TargetKey = (typeof TARGETS)[number]["key"];

/** One endpoint's result. `http_status` is Airwallex's answer to the call itself; null when it was not sent. */
export interface EndpointResult {
  method: string;
  endpoint: string;
  function: string;
  http_status: number | null;
  error_code: string | null;
  at: string | null;
  /** True only when Airwallex answered this call 2xx. */
  live: boolean;
  outcome: string;
  /** The Airwallex object the call created or read, where there is one. */
  id: string | null;
  /** What had to exist first, and how it was obtained. */
  precondition: string | null;
  /** What was removed again, or why nothing could be. */
  cleanup: string | null;
}

/** The webhook the check subscribes and deletes again: a URL nobody listens on, so no event reaches Purser. */
export const WEBHOOK_URL = "https://example.com/purser-awx-coverage-check";
/** The 13 Nov simulated deposit (docs/runs/2026-11-13-airwallex-deposits.json), read back by its id. */
export const DEPOSIT_13_NOV = { id: "59769c92-01dd-43e4-8b13-4296d71bd171", amount: "125.00", currency: "GBP", reference: "awx-switch-on deposit", since: "2026-11-13T00:00:00Z" };
/** The test company opened on 12 Nov (docs/runs/2026-11-12-real-customers.md), CREATED, waiting for its KYC flow. */
export const CONNECTED_ACCOUNT_12_NOV = "acct_tqitvOzLOL2gzTyLb5mgXg";
/** The Global Account currencies tried in order: USD is the one usdGlobalAccountId would open; then one Purser holds none of. */
export const GA_CANDIDATES = [{ currency: "USD", countryCode: "US" }, { currency: "AUD", countryCode: "AU" }, { currency: "SGD", countryCode: "SG" }] as const;

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** A fetch that notes each answer (see the header); a request that never got one is noted with status 0. */
export function notingFetch(inner: typeof fetch, lines: HttpLine[], now: () => Date = () => new Date()): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const line: HttpLine = { at: now().toISOString(), method: (init?.method ?? "GET").toUpperCase(), endpoint: endpointOf(url), status: 0 };
    try {
      const res = await inner(input, init);
      line.status = res.status;
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

export interface CoverageCtx {
  /** The client's configuration, its fetchImpl the noting (and, live, budgeted) fetch. */
  cfg: AirwallexConfig;
  lines: HttpLine[];
  /** A short id for this run's request ids, names and e-mail. */
  runId: string;
  date: string;
  /** The hosted onboarding template id Airwallex issues; none on this sandbox so far. */
  hostedFlowTemplate?: string | null;
  log?: (line: string) => void;
}

const said = (e: unknown): { status: number | null; code: string | null; text: string } => {
  if (e instanceof AirwallexError) return { status: e.status, code: e.code ?? null, text: `Airwallex answered ${e.status}${e.code ? ` ${e.code}` : ""}` };
  if (e instanceof AirwallexAmbiguous) return { status: null, code: null, text: "no answer from Airwallex (outcome unknown)" };
  return { status: null, code: null, text: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200) };
};
const ok2xx = (s: number | null) => s !== null && s >= 200 && s < 300;
const target = (key: TargetKey) => TARGETS.find((t) => t.key === key)!;

/** Runs every target once, in order; never throws for a refused call (it is a row). */
export async function runCoverageCheck(ctx: CoverageCtx): Promise<EndpointResult[]> {
  const api = new Airwallex(ctx.cfg);
  const rows: EndpointResult[] = [];
  const log = ctx.log ?? (() => {});

  const skip = (key: TargetKey, why: string, precondition: string | null = null): EndpointResult => {
    const t = target(key);
    const row: EndpointResult = { method: t.method, endpoint: t.endpoint, function: t.fn, http_status: null, error_code: null, at: null, live: false, outcome: `not run: ${why}`, id: null, precondition, cleanup: null };
    rows.push(row);
    log(`SKIP  ${t.method} ${t.endpoint}: ${why}`);
    return row;
  };

  /** Runs one target's function; the row's status is Airwallex's answer to that endpoint (its last attempt, after any 429). */
  async function attempt<T>(key: TargetKey, run: () => Promise<T>, describe: (r: T) => { outcome: string; id?: string | null }, precondition: string | null = null): Promise<{ value: T | null; row: EndpointResult }> {
    const t = target(key);
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
    const hit = ctx.lines.slice(from).filter((l) => l.method === t.method && normalizePath(l.endpoint) === t.endpoint).at(-1);
    const status = hit?.status ?? (err?.status ?? null);
    if (hit && !ok2xx(hit.status) && !err) outcome = `the call answered ${hit.status}${hit.code ? ` ${hit.code}` : ""}; the function went on: ${outcome}`;
    if (!hit && !err) outcome = `the function did not send this call: ${outcome}`;
    const row: EndpointResult = {
      method: t.method, endpoint: t.endpoint, function: t.fn, http_status: hit ? hit.status : null, error_code: hit?.code ?? err?.code ?? null, at: hit?.at ?? null,
      live: !!hit && ok2xx(status), outcome, id, precondition, cleanup: null,
    };
    rows.push(row);
    log(`${row.live ? "LIVE" : "NOT "}  ${t.method} ${t.endpoint}: ${row.http_status ?? "not sent"}${row.error_code ? ` ${row.error_code}` : ""}; ${outcome}`);
    return { value, row };
  }

  // 1. The connected-account lookup by request_id (a request id no account was opened with: the list answers none).
  const platform = new AirwallexPlatformRest(api);
  await attempt("accounts", () => platform.findConnectedAccount(`awxcov-${ctx.runId}`),
    (r) => ({ outcome: r ? `an account under this request id: ${r.accountId} (${r.status})` : "listed; no account under this request id (none was opened with it)", id: r?.accountId ?? null }));

  // 2. A batch made for the check (DRAFTING, no items, no money), found by its request_id, then deleted.
  const batches = new AirwallexBatchRest(api);
  const batchRequest = `awxcov-batch-${ctx.runId}`;
  let batchId: string | null = null, batchPre: string;
  try {
    const b = await batches.createBatch({ requestId: batchRequest, name: `Purser API coverage check ${ctx.date} (deleted again)`, metadata: { purpose: "api_coverage_check", test_money: "true" } });
    batchId = b.id;
    batchPre = `createBatch made batch ${b.id} (${b.status}, no items) under request_id ${batchRequest}`;
  } catch (e) {
    batchPre = `createBatch failed: ${said(e).text}`;
  }
  if (batchId) {
    const id = batchId;
    const found = await attempt("batchList", () => batches.findBatchByRequestId(batchRequest),
      (r) => ({ outcome: r ? `found the batch just made, by its request_id (${r.status})` : "listed; no batch under the request_id", id: r?.id ?? null }), batchPre);
    const del = await attempt("batchDelete", () => batches.deleteBatch(id), () => ({ outcome: "deleted the DRAFTING batch", id }), batchPre);
    let after: string;
    try { after = `read back after the delete: ${(await batches.getBatch(id)).status}`; } catch (e) { after = `read back after the delete: ${said(e).text}`; }
    del.row.cleanup = `${del.row.live ? "the batch is deleted" : "the delete did not go through"}; ${after}`;
    found.row.cleanup = "the batch was deleted again (the next row)";
  } else {
    skip("batchList", "no batch to list", batchPre);
    skip("batchDelete", "no batch to delete", batchPre);
  }

  // 3. A webhook subscription to a URL nobody listens on, deleted again at once; its signing secret is never kept.
  const created = await attempt("webhookCreate", async () => {
    const w = await createWebhook(api, { url: WEBHOOK_URL, events: [CARD_EVENTS[1]!], version: "2025-11-11" });
    return { id: w.id, events: w.events.length };
  }, (w) => ({ outcome: `subscribed ${WEBHOOK_URL} to ${w.events} event (the signing secret was dropped, never stored)`, id: w.id }));
  const hookId = created.value?.id ?? null;
  if (hookId) {
    const id = hookId;
    const del = await attempt("webhookDelete", () => deleteWebhook(api, id), () => ({ outcome: "deleted the subscription", id }), `createWebhook made subscription ${id}`);
    created.row.cleanup = "deleted again (the next row)";
    del.row.cleanup = "deleted";
  } else {
    skip("webhookDelete", "no subscription to delete", "createWebhook made none");
  }
  // The sweep: anything left at the check's URL (also a subscription made without an answer) is deleted and said.
  try {
    const left = (await listWebhooks(api)).filter((w) => w.url === WEBHOOK_URL);
    for (const w of left) await deleteWebhook(api, w.id).catch(() => undefined);
    const note = left.length ? `; ${left.length} left at the check's URL, deleted by the sweep` : "; none left at the check's URL (listed after)";
    created.row.cleanup = `${created.row.cleanup ?? "nothing made"}${note}`;
  } catch (e) {
    created.row.cleanup = `${created.row.cleanup ?? "nothing made"}; the list after failed: ${said(e).text}`;
  }

  // 4. A DELEGATE cardholder, made up for the sandbox (example.com address), with no card.
  await attempt("cardholder", () => issuingFor(api).createCardholder({ email: `purser-awx-coverage-${ctx.runId}@example.com`, firstName: "Coverage", lastName: "Check" }),
    (h) => ({ outcome: `cardholder ${h.status}, no card issued`, id: h.id }));
  rows.at(-1)!.cleanup = "none: Purser's client has no call that removes a cardholder (it holds no card and no money)";

  // 5. A Global Account in a currency Purser holds none in (USD first, the one usdGlobalAccountId would open).
  const rest = new AirwallexRest(api);
  let held: { id: string; currencies: string[] }[] | null = null, gaPre: string;
  try { held = await rest.activeGlobalAccounts(); gaPre = `activeGlobalAccounts: ${held.length} ACTIVE (${[...new Set(held.flatMap((g) => g.currencies))].sort().join(", ") || "no currency named"})`; } catch (e) { gaPre = `activeGlobalAccounts failed: ${said(e).text}`; }
  const pick = held ? GA_CANDIDATES.find((c) => !held!.some((g) => g.currencies.includes(c.currency))) : undefined;
  if (pick) {
    await attempt("globalAccount", () => rest.createGlobalAccount({ currency: pick.currency, countryCode: pick.countryCode, nickName: `Northwind ${pick.currency} (API coverage check)` }),
      (g) => ({ outcome: `opened a Global Account for ${pick.currency} (${g.status})`, id: g.id }), `${gaPre}; ${pick.currency} is not among them`);
    rows.at(-1)!.cleanup = "none: Purser's client has no call that closes a Global Account (it holds no money)";
  } else skip("globalAccount", held ? `Purser already holds ${GA_CANDIDATES.map((c) => c.currency).join(", ")}` : "the list of Global Accounts failed", gaPre);

  // 6. The 13 Nov simulated deposit, read back by its id (the read data-qa makes first).
  const get = (path: string, query?: Record<string, string>) => api.call<unknown>("GET", path, undefined, query);
  await attempt("depositById", () => airwallexDiffs(get, { type: "deposit", ...DEPOSIT_13_NOV }),
    (r) => ({ outcome: r.found ? `found: ${r.said}; ${r.diffs.length ? `differs from the 13 Nov record: ${r.diffs.join("; ")}` : "agrees with the 13 Nov record"}` : "not found", id: DEPOSIT_13_NOV.id }),
    "the deposit the sandbox simulated on 13 Nov (docs/runs/2026-11-13-airwallex-deposits.json)");

  // 7. A card transaction the sandbox already holds (the newest in its list), read back by its id.
  let tx: Record<string, unknown> | null = null, txPre: string;
  try {
    const list = await api.call<{ items?: Record<string, unknown>[] }>("GET", "/issuing/transactions", undefined, { page_num: "0", page_size: "10" });
    tx = (list.items ?? []).find((x) => typeof (x.transaction_id ?? x.id) === "string" && typeof x.card_id === "string") ?? null;
    txPre = tx ? `the newest card transaction in the sandbox's list (${String(tx.status)}, simulated)` : "the sandbox's card transaction list has none with an id and a card";
  } catch (e) { txPre = `the card transaction list failed: ${said(e).text}`; }
  if (tx) {
    const id = String(tx.transaction_id ?? tx.id), status = String(tx.status ?? "");
    const spec = {
      type: "card" as const, id, cardId: String(tx.card_id), amount: fromCents(Math.round(Math.abs(Number(tx.transaction_amount)) * 100)), currency: String(tx.transaction_currency ?? ""),
      approved: ["APPROVED", "PENDING", "CLEARED", "SETTLED"].includes(status), failure: typeof tx.failure_reason === "string" ? tx.failure_reason : null,
    };
    await attempt("cardTxById", () => airwallexDiffs(get, spec),
      (r) => ({ outcome: r.found ? `found: ${r.said}; ${r.diffs.length ? `differs from the list: ${r.diffs.join("; ")}` : "agrees with the list"}` : "not found", id }), txPre);
  } else skip("cardTxById", "no card transaction to read", txPre);

  // 8. A PaymentIntent for EUR 1.00, confirmed with Airwallex's documented success test card, then read back.
  const pa = new AcceptanceRest(ctx.cfg);
  let intentId: string | null = null, piPre: string;
  try {
    const pi = await pa.createPaymentIntent({ requestId: randomUUID(), amountCents: 100, currency: "EUR", merchantOrderId: `AWXCOV-${ctx.runId}` });
    intentId = pi.id;
    piPre = `createPaymentIntent made ${pi.id} (EUR 1.00, ${pi.status})`;
  } catch (e) { piPre = `createPaymentIntent failed: ${said(e).text}`; }
  if (intentId) {
    const id = intentId;
    const c = await attempt("intentConfirm", () => pa.confirmWithTestCard(id, { requestId: randomUUID(), number: SANDBOX_TEST_CARD_SUCCESS }),
      (r) => ({ outcome: `confirmed with the sandbox success test card: ${r.status}`, id }), piPre);
    try { const r = await pa.getPaymentIntent(id); c.row.outcome += `; read back: ${r.status}${r.last4 ? `, card ending ${r.last4}` : ""}`; } catch (e) { c.row.outcome += `; the read back failed: ${said(e).text}`; }
    c.row.cleanup = "none needed: EUR 1.00 of test money on a sandbox test card; nobody is paid out";
  } else skip("intentConfirm", "no PaymentIntent to confirm", piPre);

  // 9. The hosted KYC link: authorize needs a hosted flow, and a flow needs Airwallex's onboarding template id.
  if (ctx.hostedFlowTemplate) {
    const template = ctx.hostedFlowTemplate;
    await attempt("hostedAuthorize", () => platform.onboardingLink({ accountId: CONNECTED_ACCOUNT_12_NOV, template, returnUrl: "https://example.com/purser-awx-coverage-return", identity: `awxcov-${ctx.runId}` }),
      () => ({ outcome: "an onboarding link on airwallex.com (not kept)" }), `the test company opened on 12 Nov, ${CONNECTED_ACCOUNT_12_NOV}`);
  } else {
    skip("hostedAuthorize", "it needs a hosted flow, and hosted_flows/create needs the onboarding template id that Airwallex's account manager issues; this sandbox account has none (on 12 Nov the create answered 400 twice without one: docs/runs/2026-11-12-real-customers.md), so no flow id exists to authorize",
      "a hosted flow id: none can be made without the template");
  }
  return rows;
}

export interface CoverageRecord {
  run: "airwallex-coverage-live";
  ran_at: string;
  label: string;
  sandbox: string;
  test_money: true;
  command: string;
  why: string;
  budget: { approved: number | null; used: number; status_429: number };
  totals: { targets: number; live: number; refused: number; not_run: number };
  results: EndpointResult[];
  calls: HttpLine[];
}

export function coverageRecord(rows: EndpointResult[], lines: HttpLine[], o: { ranAt: string; budget: number | null; used: number }): CoverageRecord {
  return {
    run: "airwallex-coverage-live", ran_at: o.ranAt, label: "Airwallex sandbox · test money", sandbox: "https://api.sandbox.airwallex.com/api/v1", test_money: true,
    command: "npm run airwallex:coverage-live -- live",
    why: "Each endpoint docs/evidence/airwallex-api-coverage.md listed as TESTED ONLY or CODE ONLY, called once through Purser's own function for it. A row is live only when Airwallex answered the call itself 2xx.",
    budget: { approved: o.budget, used: o.used, status_429: lines.filter((l) => l.status === 429).length },
    totals: { targets: rows.length, live: rows.filter((r) => r.live).length, refused: rows.filter((r) => !r.live && r.http_status !== null).length, not_run: rows.filter((r) => r.http_status === null).length },
    results: rows, calls: lines,
  };
}

const cell = (s: string | number | null) => String(s ?? "–").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function coverageMarkdownRecord(r: CoverageRecord, date: string): string {
  const t = r.totals;
  return [
    `# Airwallex API coverage, called live: ${date}`,
    "",
    `\`${r.command}\` (src/cli/airwallexCoverageLive.ts, src/proof/awxCoverageLive.ts). The **Airwallex sandbox** only, test money only.`,
    "Each endpoint that docs/evidence/airwallex-api-coverage.md listed as TESTED ONLY or CODE ONLY, called once, through Purser's own",
    "function for it, one call at a time through the client's queue, rate limit and call budget. The machine-readable record is",
    `docs/runs/${date}-airwallex-coverage.json; the coverage report reads its rows and counts one as live only when Airwallex answered the call itself 2xx.`,
    "",
    `**${t.live} of ${t.targets} endpoints answered 2xx (live), ${t.refused} refused, ${t.not_run} not run.** ${r.budget.used} Airwallex calls${r.budget.approved ? ` of a budget of ${r.budget.approved}` : ""} (the logins included), ${r.budget.status_429} answered 429.`,
    "",
    "| Endpoint | Function | HTTP | Live | What happened | Id | Needed first | Clean-up |",
    "|---|---|---|---|---|---|---|---|",
    ...r.results.map((x) => `| \`${x.method} ${x.endpoint}\` | ${cell(x.function)} | ${x.http_status ?? "not sent"}${x.error_code ? ` \`${cell(x.error_code)}\`` : ""} | ${x.live ? "**yes**" : "no"} | ${cell(x.outcome)} | ${x.id ? `\`${cell(x.id)}\`` : "–"} | ${cell(x.precondition)} | ${cell(x.cleanup)} |`),
    "",
    "## Every call (UTC; no body, header, token or key)",
    "",
    "| # | Time | Call | HTTP |",
    "|---|---|---|---|",
    ...r.calls.map((c, i) => `| ${i + 1} | ${c.at.slice(11, 23)} | \`${c.method} ${c.endpoint}\` | ${c.status}${c.code ? ` \`${cell(c.code)}\`` : ""} |`),
    "",
    "## What this does not show",
    "",
    "- One call each: not that every branch around a call works, nor any webhook delivery (the webhook went to a URL nobody listens on, and was deleted at once).",
    "- The cardholder and the Global Account it opened stay in the sandbox: Purser's client has no call that removes either. Neither holds a card or money.",
    "- The webhook's signing secret came back in the create's answer and was dropped there: it is in no file, log or record.",
    "- Not counted in the /proof band: the band counts the Airwallex API trail (src/airwallex/apiTrail.ts), which this record is not part of.",
    "",
  ].join("\n");
}

// --- The stand-in, for `-- plan` and the tests (never a live run) ------------------------------------------------------

type Route = (body: Record<string, unknown>, query: URLSearchParams, path: string) => { status: number; json: unknown };
const j = (status: number, json: unknown) => ({ status, json });

/**
 * Airwallex in memory for this check: each route answers as the sandbox documents it. `refuse` makes one endpoint answer
 * an error ("METHOD /template" → status and code), as a feature not enabled would.
 */
export function standInFetch(o: { refuse?: Record<string, { status: number; code: string }>; heldCurrencies?: string[]; transactions?: number } = {}): typeof fetch {
  let batch: { id: string; request_id: string; status: string } | null = null;
  const hooks = new Map<string, { id: string; url: string; events: string[]; version: string }>();
  let n = 0;
  const deposit = { id: DEPOSIT_13_NOV.id, amount: 125, currency: "GBP", status: "SETTLED", reference: DEPOSIT_13_NOV.reference };
  const routes: Record<string, Route> = {
    "POST /authentication/login": () => j(201, { token: "stand-in-token", expires_at: "2099-01-01T00:00:00Z" }),
    "GET /accounts": (_b, q) => j(200, { items: [{ id: "acct_StandIn0001", status: "ACTIVE", request_id: "other-request" }].filter((a) => a.request_id === q.get("request_id")) }),
    "POST /batch_transfers/create": (b) => j(201, (batch = { id: "b6f5c7d2-0000-4000-8000-000000000001", request_id: String(b.request_id), status: "DRAFTING" })),
    "GET /batch_transfers": (_b, q) => j(200, { items: batch && batch.request_id === q.get("request_id") ? [batch] : [] }),
    "POST /batch_transfers/{id}/delete": () => { batch = null; return j(200, {}); },
    "GET /batch_transfers/{id}": () => (batch ? j(200, batch) : j(404, { code: "resource_not_found" })),
    "POST /webhooks/create": (b) => { const w = { id: `0f0e0d0c-0000-4000-8000-00000000000${++n}`, url: String(b.url), events: b.events as string[], version: String(b.version) }; hooks.set(w.id, w); return j(201, { ...w, secret: "whsec_STANDIN_SECRET_never_recorded" }); },
    "POST /webhooks/{id}/delete": (_b, _q, path) => { hooks.delete(path.split("/")[2]!); return j(200, {}); },
    "GET /webhooks": () => j(200, { items: [...hooks.values()], has_more: false }),
    "POST /issuing/cardholders/create": (b) => j(201, { cardholder_id: "c1a2b3c4-0000-4000-8000-000000000001", email: b.email, status: "PENDING" }),
    "GET /global_accounts": () => j(200, { items: (o.heldCurrencies ?? ["EUR", "GBP", "USD"]).map((c, i) => ({ id: `9a000000-0000-4000-8000-00000000000${i}`, status: "ACTIVE", required_features: [{ currency: c }] })) }),
    "POST /global_accounts/create": () => j(201, { id: "9b000000-0000-4000-8000-000000000001", status: "ACTIVE" }),
    "GET /deposits/{id}": () => j(200, deposit),
    "GET /deposits": () => j(200, { items: [deposit], has_more: false }),
    "GET /issuing/transactions": () => j(200, { items: Array.from({ length: o.transactions ?? 1 }, () => ({ transaction_id: "01a1de8c-6c31-7000-8ca8-0af114ac81b9", card_id: "7c000000-0000-4000-8000-000000000001", status: "APPROVED", transaction_amount: -30, transaction_currency: "EUR" })), has_more: false }),
    "GET /issuing/transactions/{id}": () => j(200, { transaction_id: "01a1de8c-6c31-7000-8ca8-0af114ac81b9", status: "APPROVED", transaction_amount: -30, transaction_currency: "EUR" }),
    "POST /pa/payment_intents/create": (b) => j(201, { id: "int_standin0001pi", status: "REQUIRES_PAYMENT_METHOD", amount: b.amount, currency: b.currency, merchant_order_id: b.merchant_order_id }),
    "POST /pa/payment_intents/{id}/confirm": () => j(200, { id: "int_standin0001pi", status: "SUCCEEDED", amount: 1, currency: "EUR" }),
    "GET /pa/payment_intents/{id}": () => j(200, { id: "int_standin0001pi", status: "SUCCEEDED", amount: 1, currency: "EUR", latest_payment_attempt: { payment_method: { card: { last4: "0008" } } } }),
    "POST /hosted_flows/create": () => j(201, { id: "hf_StandIn0001" }),
    "POST /hosted_flows/{id}/authorize": () => j(200, { url: "https://www.sandbox.airwallex.com/hosted/standin" }),
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${endpointOf(url.href)}`;
    const refused = o.refuse?.[key];
    const route = routes[key];
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const r = refused ? j(refused.status, { code: refused.code, message: "stand-in refusal" }) : route ? route(body, url.searchParams, url.pathname.replace(/^\/api\/v1/, "")) : j(404, { code: "resource_not_found" });
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
