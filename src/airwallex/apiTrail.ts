// The Airwallex API trail (15 Nov): every Airwallex sandbox API call Purser's recorded runs hold, in one list, read at
// build time from the committed run records alone (docs/runs/*airwallex*, airwallex-*.json, docs/runs/2026-11-07-awx-1/
// and the awx-1 run's own record, docs/demo/airwallex-run.json). Nothing here calls Airwallex.
//
// Rules: a call the record itemises (time, method, path) is one row; a record that only counts calls per endpoint gives
// one row per endpoint with its count and no time. A status, an outcome or an object id is shown only where the record
// holds it; nothing is estimated. Paths keep their ids folded ({id}), as the call logs wrote them. Each transfer's
// approval_sha256 is compared with the terms hash the passkey signed, as the same record holds it, and recomputed from
// the terms themselves where the record keeps them (the awx-1 receipt). No token, key, client id, full account number or
// card number appears: the records hold none, and redact() masks anything shaped like one (test/airwallex-api-trail.test.ts).

import { readFileSync } from "node:fs";
import { termsHash, type Terms } from "../lib/terms.js";
import { countOf } from "../redesign/ui.js";

export const API_BASE = "/api/v1";
export const AWX1_RECORD = "docs/demo/airwallex-run.json";
export const AWX1_RECEIPT = "docs/runs/2026-11-07-awx-1/receipt-P-0002.json";
export const MAIN_RUN_RECORD = "docs/demo/main-run.json";

/** The endpoint families the page counts. */
export const FAMILIES = ["transfers", "fx", "payment-intents", "cards", "balances", "beneficiaries", "spend", "auth", "other"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = {
  transfers: "transfers", fx: "FX quotes and conversions", "payment-intents": "payment intents", cards: "cards",
  balances: "balances and transactions", beneficiaries: "beneficiaries", spend: "Spend bills, vendors and files", auth: "logins", other: "other",
};

export interface TrailCall {
  /** ISO time of the call, when the record itemises it; null when it only counts calls. */
  at: string | null;
  method: string;
  /** The path under api.sandbox.airwallex.com, ids folded to {id}. */
  path: string;
  family: Family;
  /** How many calls this row stands for: 1 for an itemised call. */
  count: number;
  what: string;
  /** The status or outcome, as the record holds it; null when it holds none. */
  outcome: string | null;
  /** The Airwallex object id (or ids), as the record holds it; null when it holds none. */
  objectId: string | null;
  /** A note on how the row was read from the record. */
  note?: string;
}

export interface HashCheck {
  kind: "transfer" | "batch";
  label: string;
  /** The approval_sha256 the transfer (or batch) carries, as recorded. */
  carried: string;
  /** The terms hash the passkey signed, from the same run's record. */
  signed: string | null;
  /** SHA-256 of the RFC 8785 terms, recomputed here, where the record keeps the terms. */
  recomputed: string | null;
  match: boolean;
  how: string;
}

export interface TrailRun {
  key: string;
  /** ISO time the run (or read-back) started, from the record. */
  iso: string;
  title: string;
  record: string;
  /** Other records the run's rows or checks read. */
  alsoReads: string[];
  calls: TrailCall[];
  /** Calls the record states but does not list (for example, list pages of a read-back). */
  unlisted?: string;
  checks: HashCheck[];
}

export interface Trail { runs: TrailRun[]; calls: number; byFamily: Record<Family, number>; timed: number; checks: { transfers: { total: number; match: number }; batches: { total: number; match: number }; recomputed: number } }

type J = Record<string, unknown>;
const repo = (file: string) => new URL(`../../${file}`, import.meta.url);
const readJson = (file: string): J | null => { try { return JSON.parse(readFileSync(repo(file), "utf8")) as J; } catch { return null; } };
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

/** A family for a path under /api/v1. */
export function familyOf(path: string): Family {
  const p = path.replace(API_BASE, "");
  if (p.startsWith("/authentication")) return "auth";
  if (/^\/(transfers|batch_transfers|simulation\/transfers)/.test(p)) return "transfers";
  if (p.startsWith("/fx/")) return "fx";
  if (p.startsWith("/pa/")) return "payment-intents";
  if (/^\/(issuing|simulation\/issuing)/.test(p)) return "cards";
  if (/^\/(balances|financial_transactions|deposits|global_accounts|simulation\/deposit)/.test(p)) return "balances";
  if (p.startsWith("/beneficiaries")) return "beneficiaries";
  if (/^\/(spend\/|files\/upload|account$)/.test(p)) return "spend";
  return "other";
}

/** What a call does, in plain words, by method and folded path. */
const WORDS: Record<string, string> = {
  "POST /authentication/login": "Logs in to the sandbox for a short-lived access token (the token is never recorded)",
  "GET /balances/current": "Reads the wallet's current balances",
  "GET /financial_transactions": "Reads the account's ledger rows (payouts, fees, conversions, deposits)",
  "GET /global_accounts": "Lists the global accounts that can receive money",
  "POST /simulation/deposit/create": "Asks the sandbox to simulate an incoming deposit",
  "GET /deposits": "Lists deposits received",
  "POST /beneficiaries/verify_account": "Checks the payee's name against the account, before the payee is added",
  "GET /beneficiaries": "Lists saved beneficiaries",
  "GET /beneficiaries/{id}": "Reads one beneficiary (only that it exists is kept)",
  "POST /batch_transfers/create": "Creates a batch transfer carrying the signed batch hash",
  "POST /batch_transfers/{id}/add_items": "Adds the signed payment lines to the batch",
  "POST /batch_transfers/{id}/quote": "Asks Airwallex to quote the batch's fees",
  "GET /batch_transfers/{id}/items": "Reads the batch's lines back to compare them with the signed terms",
  "POST /batch_transfers/{id}/submit": "Submits the batch to Airwallex's own approval",
  "GET /batch_transfers/{id}": "Reads the batch back",
  "POST /transfers/create": "Creates a SWIFT payout with the signed terms hash in its metadata",
  "GET /transfers/{id}": "Reads a transfer back (status, amounts, metadata)",
  "GET /transfers": "Lists transfers",
  "POST /simulation/transfers/{id}/transition": "Asks the sandbox to move a payout to SENT or PAID (settlement is simulated), or to FAILED (a late failure, simulated)",
  "GET /fx/rates/current": "Reads the market rate, to compare with the quote",
  "POST /fx/quotes/create": "Locks an FX quote for the currency the payment needs",
  "GET /fx/quotes/{id}": "Reads an FX quote back",
  "POST /fx/conversions/create": "Converts on the locked quote, buying only the shortfall",
  "GET /fx/conversions": "Lists conversions",
  "GET /fx/conversions/{id}": "Reads a conversion back",
  "GET /issuing/cardholders": "Lists cardholders (no name or id is kept)",
  "GET /issuing/cards": "Lists the agents' cards",
  "GET /issuing/cards/{id}": "Reads one card's controls back (limits, merchant categories, currency)",
  "POST /issuing/cards/create": "Issues an agent's virtual card with the CFO's limits as Airwallex controls",
  "POST /issuing/cards/{id}/update": "Changes a card's limit after the CFO's Face ID",
  "POST /simulation/issuing/create": "Simulates a merchant charging an agent's card (Airwallex approves or declines it)",
  "GET /issuing/transactions": "Lists card transactions",
  "GET /issuing/transactions/{id}": "Reads one card transaction",
  "GET /webhooks": "Checks the webhook subscription is there",
  "GET /pa/payment_intents/{id}": "Reads a Visa Intelligent Commerce PaymentIntent back",
  "GET /account": "Reads the account's legal entity, which bills and vendors belong to",
  "GET /spend/vendors": "Lists Spend vendors, to find the supplier's by its external_id",
  "POST /spend/vendors/create": "Creates the supplier as a Spend vendor, once",
  "POST /files/upload": "Uploads the invoice PDF as a Spend attachment (files.sandbox.airwallex.com)",
  "GET /spend/bills": "Lists bills, to find one by its external_id before any create",
  "POST /spend/bills/create": "Creates the paid invoice as a bill, external_id = the signed terms hash",
  "GET /spend/bills/{id}": "Reads a bill back (external_id, amount, attachment, status)",
  "POST /spend/bills/{id}/mark_as_paid": "Marks the bill paid once its transfer is PAID",
};
export const wordsFor = (method: string, path: string): string => WORDS[`${method} ${path.replace(API_BASE, "")}`] ?? `${method} ${path}`;

/** "POST /batch_transfers/{id}/quote" or a line {method, endpoint} → method and full path. */
const split = (endpoint: string): [string, string] => { const [m, ...rest] = endpoint.split(" "); return [m!, `${API_BASE}${rest.join(" ")}`]; };
const call = (at: string | null, method: string, path: string, count = 1, extra: Partial<TrailCall> = {}): TrailCall =>
  ({ at, method, path, family: familyOf(path), count, what: wordsFor(method, path), outcome: null, objectId: null, ...extra });
const lineCalls = (rec: J): TrailCall[] => {
  const c = rec.calls as J | J[] | undefined;
  const lines = Array.isArray(c) ? c : arr(c?.lines);
  return lines.map((l) => call(str(l.at), str(l.method)!, `${API_BASE}${str(l.endpoint)!}`));
};
const aggregate = (byEndpoint: J[]): TrailCall[] => byEndpoint.map((e) => { const [m, p] = split(str(e.endpoint)!); return call(null, m, p, Number(e.calls)); });
const audit = (rec: J) => arr(rec.audit);
const ev = (rec: J, event: string) => audit(rec).filter((a) => a.event === event);
/** Set the outcome and id on the n-th call matching method+path (0-based); no-op if absent. */
const tag = (calls: TrailCall[], method: string, endpoint: string, n: number, outcome: string | null, objectId: string | null = null) => {
  const c = calls.filter((x) => x.method === method && x.path === `${API_BASE}${endpoint}`)[n];
  if (c) { c.outcome = outcome; c.objectId = objectId; }
};

/** The signed hash of each proposal approved in an audit list (proposal.approved rows). */
const signedOf = (rows: J[]) => new Map(rows.filter((a) => a.event === "proposal.approved").map((a) => [str(a.subject)!, str((a.payload as J)?.terms_sha256)]));

/** Batch transfer records: their lines and the batch, each hash against what the passkey signed in that record. */
function batchChecks(rec: J, label: string): HashCheck[] {
  const signed = signedOf(audit(rec));
  const filed = ev(rec, "batch.filed")[0]?.payload as J | undefined;
  const lines = arr(filed?.lines);
  const out: HashCheck[] = [];
  arr(rec.transfers).forEach((t, i) => {
    const carried = str(t.approval_sha256);
    if (!carried) return;
    const line = lines[i], pid = str(line?.proposal_id);
    const s = pid ? signed.get(pid) ?? null : null;
    out.push({ kind: "transfer", label: `${label}: ${str(t.invoice_no)} (request ${str(t.request_id)}), ${pid ?? "no line"}`, carried, signed: s, recomputed: null,
      match: !!s && s === carried && str(line?.terms_sha256) === carried, how: "the line's approval_sha256 against the hash the passkey signed for that line in the batch" });
  });
  for (const b of arr(rec.awx_batches)) {
    const created = ev(rec, "awx_batch.created").find((a) => a.subject === b.awx_batch_id)?.payload as J | undefined;
    const carried = str(created?.approval_sha256);
    if (!carried) continue;
    const s = signed.get(str(b.batch_id)!) ?? null;
    out.push({ kind: "batch", label: `${label}: batch ${str(b.awx_batch_id)} (${str(b.batch_id)})`, carried, signed: s, recomputed: null,
      match: !!s && s === carried && str(b.batch_sha256) === carried, how: "the batch's approval_sha256 at creation against the batch hash the passkey signed" });
  }
  return out;
}

const byTimeDesc = (a: TrailCall, b: TrailCall) => (b.at ?? "").localeCompare(a.at ?? "");

/** Every run that holds Airwallex calls, newest first. A missing record leaves its run out. */
export function trailRuns(): TrailRun[] {
  const runs: TrailRun[] = [];

  // 1 Nov: the read-back of every Airwallex id shown in the docs (GET only).
  const rb = readJson("docs/runs/airwallex-readback.json");
  if (rb) {
    const pathOf: Record<string, string> = { quote: "/fx/quotes/{id}", conversion: "/fx/conversions/{id}", transfer: "/transfers/{id}", beneficiary: "/beneficiaries/{id}", "card transaction": "/issuing/transactions", deposit: "/deposits" };
    const calls = arr(rb.found).map((f) => {
      const kind = str(f.kind)!, p = `${API_BASE}${pathOf[kind] ?? "/"}`;
      return call(null, "GET", p, 1, { outcome: `${str(f.status)}${f.amount && f.amount !== "-" ? `, ${str(f.amount)}` : ""}`, objectId: str(f.id),
        ...(kind === "deposit" ? { note: "found in the deposits list (no GET by id)" } : kind === "card transaction" ? { note: "found by GET by id or in the list; the record does not say which" } : {}) });
    });
    for (const n of arr(rb.not_found)) calls.push(call(null, "GET", `${API_BASE}/{kind}/{id}`, 1, { what: "Looked the id up as each kind in turn", outcome: "not found", objectId: str(n.id), family: "other" }));
    runs.push({ key: "readback-1101", iso: str(rb.read_at)!, title: "Read-back of every Airwallex id in the docs (GET only)", record: "docs/runs/airwallex-readback.json", alsoReads: [], calls,
      unlisted: "The record keeps one row per id: the GETs that missed before the answering one, and the list pages of deposits and card transactions, are not counted.", checks: [] });
  }

  // 3 Nov main run's SWIFT transfer, read back on 6 Nov: its metadata against the hash the CFO signed.
  const ta = readJson("docs/runs/airwallex-transfer-approval-2026-11-06.json"), main = readJson(MAIN_RUN_RECORD);
  if (ta) {
    const t = ta.transfer as J, carried = str((t.metadata as J)?.approval_sha256);
    const pid = /proposal (P-\d{4})/.exec(str(ta.why) ?? "")?.[1] ?? null;
    const signed = main && pid ? signedOf(arr((main.ledger as J)?.events)).get(pid) ?? null : null;
    runs.push({ key: "transfer-1106", iso: str(ta.read_at)!, title: "The main run's SWIFT transfer, read back", record: "docs/runs/airwallex-transfer-approval-2026-11-06.json", alsoReads: [MAIN_RUN_RECORD],
      calls: [call(null, "GET", `${API_BASE}/transfers/{id}`, 1, { outcome: `${str(t.status)}, ${str(t.transfer_amount)} ${str(t.transfer_currency)}`, objectId: str(t.id) })],
      checks: carried ? [{ kind: "transfer", label: `main run: transfer ${str(t.id)} (${pid ?? "?"}, ${str(t.reference)})`, carried, signed, recomputed: null, match: !!signed && signed === carried,
        how: "metadata.approval_sha256 as Airwallex returned it against the hash in the run ledger's proposal.approved row" }] : [] });
  }

  // 6 Nov: the main run's three agent cards, read back.
  const cards = readJson("docs/runs/airwallex-cards-2026-11-06.json");
  if (cards) {
    const calls = [call(null, "GET", `${API_BASE}/issuing/cards`)];
    for (const c of arr(cards.cards)) calls.push(call(null, "GET", `${API_BASE}/issuing/cards/{id}`, 1, { outcome: `${str(c.card_status)}, card ····${str(c.last4)}`, objectId: `…${str(c.card_id_last4)}` }));
    runs.push({ key: "cards-1106", iso: str(cards.read_at)!, title: "The main run's agent cards and their controls, read back", record: "docs/runs/airwallex-cards-2026-11-06.json", alsoReads: [], calls,
      unlisted: "The record keeps the three cards it selected; card ids are masked to their last four characters.", checks: [] });
  }

  // 7 Nov awx-1: the Airwallex-only run, with the owner's own passkey. The record counts calls per endpoint.
  const awx = readJson(AWX1_RECORD), receipt = readJson(AWX1_RECEIPT);
  if (awx) {
    const c = awx.calls as J;
    const calls = aggregate(arr(c.airwallex));
    const inv = arr(awx.invoices);
    const transfers = inv.filter((i) => str(i.transfer_id));
    const tagAll = (m: string, e: string, outcome: string | null, ids: string[]) => { const x = calls.find((y) => y.method === m && y.path === `${API_BASE}${e}`); if (x && ids.length) { x.outcome = outcome; x.objectId = ids.join(", "); } };
    tagAll("POST", "/transfers/create", transfers.map((t) => `${str(t.invoice_no)} ${str(t.status)}`).join("; "), transfers.map((t) => str(t.transfer_id)!));
    const quotes = inv.map((i) => i.quote as J | null).filter((q): q is J => !!q);
    tagAll("POST", "/fx/quotes/create", quotes.map((q) => `EUR ${str(q.buy_eur)} for USD ${str(q.sell_usd)} at ${str(q.rate)}`).join("; "), quotes.map((q) => str(q.quote_id)!));
    tagAll("POST", "/fx/conversions/create", null, inv.map((i) => str(i.conversion_id)).filter((x): x is string => !!x));
    tagAll("POST", "/issuing/cards/create", arr(awx.cards).map((k) => `${str(k.agent)} ····${str(k.last4)} ${str((k.read_back as J)?.status)}`).join("; "), arr(awx.cards).map((k) => `…${str(k.card_id_last4)}`));
    const signed = new Map(arr(awx.proposals).map((p) => [str(p.proposal_id)!, str(p.terms_sha256)]));
    const rterms = receipt?.terms as Terms | undefined;
    const checks: HashCheck[] = transfers.filter((t) => str(t.approval_sha256)).map((t) => {
      const pid = str(t.proposal_id)!, carried = str(t.approval_sha256)!, s = signed.get(pid) ?? null;
      const recomputed = rterms && rterms.proposal_id === pid ? termsHash(rterms) : null;
      return { kind: "transfer", label: `awx-1: transfer ${str(t.transfer_id)} (${pid}, ${str(t.invoice_no)})`, carried, signed: s, recomputed,
        match: !!s && s === carried && (recomputed === null || recomputed === carried),
        how: recomputed ? "approval_sha256 against the signed hash, and against SHA-256 of the signed terms recomputed from the receipt" : "approval_sha256 against the hash the owner's passkey signed (the run's proposals)" };
    });
    runs.push({ key: "awx-1", iso: "2026-11-07T12:04:31Z", title: "awx-1, the Airwallex-only run (the owner's own passkey)", record: AWX1_RECORD, alsoReads: [AWX1_RECEIPT, "docs/runs/2026-11-07-awx-1.md"], calls,
      unlisted: `The record counts calls per endpoint (${String(c.airwallex_total)} in all, of a budget of ${String(c.budget)}), without times.`, checks });
  }

  // 12 Nov: the VIC PaymentIntents of the Airi run, read back.
  const vic = readJson("docs/runs/airwallex-vic-payment-intents-2026-11-12.json");
  if (vic) {
    const calls = lineCalls(vic).map((x) => (x.path === `${API_BASE}/pa/{id}/{id}` ? { ...x, path: `${API_BASE}/pa/payment_intents/{id}`, family: "payment-intents" as Family, what: wordsFor("GET", "/pa/payment_intents/{id}"), note: "logged as /pa/{id}/{id}; the record names the path" } : x));
    arr(vic.payment_intents).forEach((p, i) => { const it = p.intent as J; tag(calls, "GET", "/pa/payment_intents/{id}", i, `${str(it.status)}, ${str(it.amount)} ${str(it.currency)} (purchase ${str(p.purchase)})`, str(p.id)); });
    runs.push({ key: "vic-1112", iso: str((arr(vic.calls)[0])?.at) ?? str(vic.read_at)!, title: "Visa Intelligent Commerce PaymentIntents, read back", record: "docs/runs/airwallex-vic-payment-intents-2026-11-12.json", alsoReads: [], calls, checks: [] });
  }

  // 12 Nov awx-depth: payee check, financial transactions, two batch transfers.
  const payee = readJson("docs/runs/2026-11-12-airwallex-payee-check.json");
  if (payee) {
    const calls = lineCalls(payee);
    arr(payee.checks).forEach((k, i) => tag(calls, "POST", "/beneficiaries/verify_account", i, `${str(k.match)} for "${str(k.vendor)}"${k.proceed ? ": may proceed" : ": stopped before the CFO"}`));
    runs.push({ key: "payee-1112", iso: str(calls[0]?.at)!, title: "Payee name check (Confirmation of Payee)", record: "docs/runs/2026-11-12-airwallex-payee-check.json", alsoReads: [], calls, checks: [] });
  }
  const ft = readJson("docs/runs/2026-11-12-airwallex-financial-transactions.json");
  if (ft) {
    const calls = lineCalls(ft), read = ev(ft, "awx_ft.read")[0]?.payload as J | undefined, rec = ev(ft, "awx_ft.reconciled")[0]?.payload as J | undefined;
    if (read) tag(calls, "GET", "/financial_transactions", 0, `${str(read.count)} rows read${rec ? `; ${countOf(Number(rec.agree), Number(rec.checked), true)} movements agree, ${str(rec.differences)} differences` : ""}`);
    runs.push({ key: "ft-1112", iso: str(calls[0]?.at)!, title: "Financial transactions against Purser's ledger", record: "docs/runs/2026-11-12-airwallex-financial-transactions.json", alsoReads: [], calls, checks: [] });
  }
  for (const [file, key, n] of [["docs/runs/2026-11-12-airwallex-batch-transfer.json", "batch-1112", "first"], ["docs/runs/2026-11-12-airwallex-batch-transfer-2.json", "batch-1112-2", "second"]] as const) {
    const b = readJson(file);
    if (!b) continue;
    const calls = lineCalls(b), created = ev(b, "awx_batch.created")[0], sub = ev(b, "awx_batch.submitted")[0], rbk = ev(b, "awx_batch.read_back")[0];
    if (created) tag(calls, "POST", "/batch_transfers/create", 0, str((created.payload as J).status), str(created.subject));
    if (rbk) tag(calls, "GET", "/batch_transfers/{id}/items", 0, (rbk.payload as J).agrees === true ? `agrees with the signed lines (${str((rbk.payload as J).items)} items)` : "differs from the signed lines", str(rbk.subject));
    if (sub) tag(calls, "POST", "/batch_transfers/{id}/submit", 0, str((sub.payload as J).status), str(sub.subject));
    runs.push({ key, iso: str(calls[0]?.at)!, title: `Batch transfer, the ${n} run (two signed lines, one batch hash)`, record: file, alsoReads: [], calls, checks: batchChecks(b, `batch ${n === "first" ? "1" : "2"}`) });
  }

  // 13 Nov switch-on: three phases, counted per endpoint (no times per call in the record).
  const sw = readJson("docs/runs/2026-11-13-airwallex-switch-on.json");
  if (sw) {
    const c = sw.calls as J, phases = (c.by_phase ?? {}) as Record<string, J>;
    const calls: TrailCall[] = [];
    for (const [phase, v] of Object.entries(phases)) for (const x of aggregate(arr(v.by_endpoint))) calls.push({ ...x, note: `phase ${phase}` });
    const checksOut = ev(sw, "payee.name_check_refused").map((a) => `${str((a.payload as J).match)} for "${str(a.subject)}"`);
    const v = calls.find((x) => x.path.endsWith("/beneficiaries/verify_account"));
    if (v && checksOut.length) v.outcome = `${checksOut.join("; ")}: stopped before the CFO`;
    const created = ev(sw, "awx_batch.created")[0], sub = ev(sw, "awx_batch.submitted")[0];
    const bc = calls.find((x) => x.path.endsWith("/batch_transfers/create"));
    if (bc && created) { bc.outcome = str((created.payload as J).status); bc.objectId = str(created.subject); }
    const bs = calls.find((x) => x.path.endsWith("/submit"));
    if (bs && sub) { bs.outcome = str((sub.payload as J).status); bs.objectId = str(sub.subject); }
    const paid = arr(sw.transfers).filter((t) => str(t.transfer_id));
    const tr = calls.find((x) => x.path.endsWith("/transfers/{id}"));
    if (tr && paid.length) { tr.outcome = paid.map((t) => `${str(t.invoice_no)} ${str(t.status)}`).join("; "); tr.objectId = paid.map((t) => str(t.transfer_id)!).join(", "); }
    const rec = ev(sw, "awx_ft.reconciled")[0]?.payload as J | undefined;
    const f = calls.find((x) => x.path.endsWith("/financial_transactions"));
    if (f && rec) f.outcome = `${countOf(Number(rec.agree), Number(rec.checked), true)} movements agree, ${str(rec.differences)} differences`;
    runs.push({ key: "switch-on-1113", iso: str(c.first)!, title: "Switch-on: payee check, batch transfer, ledger reconciliation", record: "docs/runs/2026-11-13-airwallex-switch-on.json", alsoReads: [], calls,
      unlisted: `The record counts calls per phase and endpoint (${String(c.total)} in all, ${str(c.first)} to ${str(c.last)}), without a time per call.`, checks: batchChecks(sw, "switch-on") });
  }
  const dep = readJson("docs/runs/2026-11-13-airwallex-deposits.json");
  if (dep) {
    const calls = lineCalls(dep), ga = ev(dep, "awx_deposit.global_accounts")[0]?.payload as J | undefined, sim = ev(dep, "awx_deposit.simulated")[0], seen = ev(dep, "awx_deposit.seen")[0], agreed = ev(dep, "awx_ft.agreed")[0];
    if (ga) tag(calls, "GET", "/global_accounts", 0, `${str(ga.count)} accounts, ${str(ga.active)} active`, str(ga.chosen));
    if (sim) { const p = sim.payload as J; tag(calls, "POST", "/simulation/deposit/create", 0, `${str(p.status)}, ${(Number(p.amount_cents) / 100).toFixed(2)} ${str(p.currency)} (simulated)`, str(sim.subject)); }
    if (seen) tag(calls, "GET", "/deposits", 1, str((seen.payload as J).status), str(seen.subject));
    if (agreed) { const p = agreed.payload as J; tag(calls, "GET", "/financial_transactions", 0, `agrees: ${str(p.airwallex)}`, arr(p.items).map((i) => str(i.id)!).join(", ")); }
    runs.push({ key: "deposits-1113", iso: str(calls[0]?.at)!, title: "A simulated deposit, followed into the ledger", record: "docs/runs/2026-11-13-airwallex-deposits.json", alsoReads: [], calls, checks: [] });
  }

  // 17 Nov late failure: two payouts taken to PAID, then FAILED, by the sandbox's simulation; a GET of each transfer
  // stood in for the webhook, then syncPayments read each again. The record itemises its calls; the rows are tagged in
  // the order of the record's audit rows (the transitions; the stand-in reads, then the re-reads, are the last GETs).
  const lf = readJson("docs/runs/2026-11-17-airwallex-late-failure.json");
  if (lf) {
    const calls = lineCalls(lf), transfers = arr(lf.transfers);
    transfers.forEach((t, i) => tag(calls, "POST", "/transfers/create", i, `${str(t.invoice_no)}, ${str(t.currency)} ${str(t.amount)}`, str(t.transfer_id)));
    const moves = audit(lf).filter((a) => (a.event === "transfer.status" && a.actor === "awx-executor" && ["SENT", "PAID"].includes(str((a.payload as J).status) ?? "") && !(a.payload as J).read)
      || a.event === "late_failure.fail_accepted");
    const sims = calls.filter((x) => x.method === "POST" && x.path === `${API_BASE}/simulation/transfers/{id}/transition`);
    if (moves.length === sims.length) moves.forEach((m, i) => { sims[i]!.outcome = `${str((m.payload as J).status)} (simulated)`; sims[i]!.objectId = str(m.subject); });
    const reads = [...ev(lf, "late_failure.webhook_stand_in").map((a) => ({ a, how: "read in place of the webhook" })), ...ev(lf, "transfer.rechecked").map((a) => ({ a, how: "read again by syncPayments" }))];
    const gets = calls.filter((x) => x.method === "GET" && x.path === `${API_BASE}/transfers/{id}`).slice(-reads.length);
    if (reads.length && gets.length === reads.length) reads.forEach(({ a, how }, i) => { const p = a.payload as J; gets[i]!.outcome = `${str(p.airwallex_status ?? p.status)}, ${how}`; gets[i]!.objectId = str(a.subject); });
    const signed = new Map(arr(lf.proposals).map((p) => [str(p.proposal_id)!, str(p.terms_sha256)]));
    const pidOf = new Map(ev(lf, "late_failure.created").map((a) => [str(a.subject)!, str((a.payload as J).proposal_id)]));
    const checks: HashCheck[] = transfers.filter((t) => str(t.approval_sha256)).map((t) => {
      const pid = pidOf.get(str(t.transfer_id)!) ?? null, carried = str(t.approval_sha256)!, s = pid ? signed.get(pid) ?? null : null;
      return { kind: "transfer", label: `late failure: transfer ${str(t.transfer_id)} (${pid ?? "?"}, ${str(t.invoice_no)})`, carried, signed: s, recomputed: null, match: !!s && s === carried,
        how: "approval_sha256 against the terms hash the labelled virtual test passkey signed (the run's proposals)" };
    });
    runs.push({ key: "late-failure-1117", iso: str(calls[0]?.at)!, title: "A payout that does not stay paid: PAID, then FAILED by the sandbox's simulation", record: "docs/runs/2026-11-17-airwallex-late-failure.json", alsoReads: [], calls, checks });
  }

  // 19 Nov: each paid invoice as a bill in Airwallex Spend (npm run airwallex-bills). The record itemises its calls; the
  // bill creates, read-backs and mark_as_paid are tagged in the order of its bills (one per invoice, in invoice order).
  const bl = readJson("docs/runs/2026-11-19-airwallex-bills.json");
  if (bl) {
    const calls = lineCalls(bl), bills = arr(bl.bills).filter((b) => str(b.bill_id));
    bills.forEach((b, i) => {
      const c = b.created as J | null, p = b.paid as J | null;
      tag(calls, "POST", "/spend/bills/create", i, `${str(b.invoice_no)}, ${str(c?.amount)}, ${str(c?.status)}`, str(b.bill_id));
      tag(calls, "GET", "/spend/bills/{id}", 2 * i, `${str(c?.status)}; read back ${str(c?.read_back)}`, str(b.bill_id));
      tag(calls, "POST", "/spend/bills/{id}/mark_as_paid", i, str(p?.status), str(b.bill_id));
      tag(calls, "GET", "/spend/bills/{id}", 2 * i + 1, `${str(p?.status)}; read back ${str(p?.read_back)}`, str(b.bill_id));
      tag(calls, "POST", "/files/upload", i, `${str(b.invoice_no)} PDF`, arr(c?.attachment_ids).map(String).join(", ") || null);
    });
    runs.push({ key: "bills-1119", iso: str(calls[0]?.at)!, title: "Paid invoices as bills in Airwallex Spend (accounts payable)", record: "docs/runs/2026-11-19-airwallex-bills.json", alsoReads: ["docs/runs/2026-11-19-airwallex-bills.md"], calls, checks: [] });
  }

  // 19 Nov soak (npm run airwallex:soak): 30 signed payments created, taken to PAID by the sandbox's simulation and read
  // back, 6 with an FX conversion first; 5 one-cent changes refused before any create. The record itemises its calls;
  // each create is tagged with its payment, in payment order, and each payment's read-back gives a hash check.
  const sk = readJson("docs/runs/2026-11-19-airwallex-soak.json");
  if (sk) {
    const calls = lineCalls(sk), pays = arr(sk.payments);
    pays.forEach((p, i) => tag(calls, "POST", "/transfers/create", i, `${str(p.invoice_no)}, ${str(p.currency)} ${str(p.amount)}, ${str(p.status_after_execute)}`, str(p.transfer_id)));
    const checks: HashCheck[] = pays.filter((p) => str((p.readback as J | null)?.approval_sha256)).map((p) => {
      const carried = str((p.readback as J).approval_sha256)!, signed = str(p.terms_sha256) ?? null;
      return { kind: "transfer", label: `soak: transfer ${str(p.transfer_id)} (${str(p.proposal_id)}, ${str(p.invoice_no)})`, carried, signed, recomputed: null, match: !!signed && signed === carried,
        how: "approval_sha256 read back from Airwallex against the terms hash the labelled virtual test passkey signed" };
    });
    runs.push({ key: "soak-1119", iso: str(calls[0]?.at)!, title: "Soak: 30 signed payments to PAID and read back, 6 with FX; 5 one-cent changes refused", record: "docs/runs/2026-11-19-airwallex-soak.json", alsoReads: ["docs/runs/2026-11-19-airwallex-soak.md"], calls, checks });
  }

  for (const r of runs) r.calls.sort(byTimeDesc);
  return runs.sort((a, b) => b.iso.localeCompare(a.iso));
}

/** Mask anything shaped like a secret, a full account number or a card number. The records hold none; this is a guard. */
export function redact(s: string): string {
  return s
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}\b/g, "[token removed]")
    .replace(/\b(?:sk|pk|api|key)_[A-Za-z0-9]{12,}\b/g, "[key removed]")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[account removed]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (m.replace(/\D/g, "").length >= 13 ? "[number removed]" : m));
}

export function apiTrail(): Trail {
  const runs = trailRuns().map((r) => JSON.parse(redact(JSON.stringify(r))) as TrailRun);
  const byFamily = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
  let calls = 0, timed = 0;
  for (const r of runs) for (const c of r.calls) { byFamily[c.family] += c.count; calls += c.count; if (c.at) timed += c.count; }
  const all = runs.flatMap((r) => r.checks);
  const t = all.filter((c) => c.kind === "transfer"), b = all.filter((c) => c.kind === "batch");
  return { runs, calls, byFamily, timed, checks: { transfers: { total: t.length, match: t.filter((c) => c.match).length }, batches: { total: b.length, match: b.filter((c) => c.match).length }, recomputed: all.filter((c) => c.recomputed).length } };
}
