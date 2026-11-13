// /airwallex as one story about Airwallex's own products (jury panel, 12 Nov): one tile per product Purser uses, in a
// fixed order (Issuing, Payouts, FX, Transfer approvals, Connected accounts, Payment acceptance, Airi). Each tile shows
// the product's name, one number, one short line of what happened, one line of what Airwallex itself does there, one id
// and the date of its own run. Everything on a tile is read here from that run's record at build time: no number, id,
// date or status is typed into the page. A tile whose record does not hold its facts is left out, and the heading
// counts the tiles that are there.
//
// The records: the Airwallex-only run (docs/demo/airwallex-run.json), the main run and its read-back
// (docs/demo/main-run.json, docs/runs/airwallex-transfer-approval-<date>.json), the two-locks run (its run log and its
// row in the runs list), the platform run (docs/runs/2026-11-10-platform-e2e/facts.json and its run log), the
// payment-acceptance run (its run log) and the Airi run (docs/demo/airi-run.json).
//
// Transfer approvals follows its record: the third state is whatever the run log and the runs list say when the site is
// built, so a finished run shows as finished without a change here. When the two disagree, the run log's state is shown.
// test/airwallex-products.test.ts holds every tile to its record file.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { APPROVAL_STATES } from "../airwallex/approvals.js";
import { toCents } from "../lib/money.js";
import { AIRI_RUN_FILE, AIRI_RUN_STEPS_ID, airiRun, type AiriRunRecord } from "./airiRun.js";
import { AWX_HASH_ID, hashTravel, type HashTravel } from "./airwallexProof.js";
import { AWX_RUN_FILE, AWX_RUN_STEPS_ID, awxRun } from "./awxRun.js";
import type { Awx1Record } from "../awx/scenario.js";
import { REPO_BLOB } from "./metalStory.js";
import { liveRuns, type RunRow } from "./runs.js";
import type { AgentRun, RunRecord } from "./run.js";
import { esc, icon } from "./ui.js";
import { VISUAL_CSS, visualsHtml } from "./airwallexVisual.js";

export const PRODUCT_ORDER = ["issuing", "payouts", "fx", "approvals", "connected", "acceptance", "airi"] as const;
export type ProductKey = (typeof PRODUCT_ORDER)[number];

/** The two-locks run's first log (10 Nov), the record the tile falls back to. */
export const TWO_LOCKS_FILE = "docs/runs/2026-11-10-airwallex-two-locks.md";
/**
 * The two-locks run's logs, one per day it moved on (docs/runs/<date>-airwallex-two-locks*.md: 10 Nov created and held,
 * 12 Nov approved at Airwallex and PAID, published by another team). The newest one that names a status is the record.
 */
export const TWO_LOCKS_LOG = /^(\d{4}-\d{2}-\d{2})-airwallex-two-locks[\w-]*\.md$/;
/** The two-locks run's row in the runs list (src/redesign/runs.ts) and its anchor on /runs. */
export const TWO_LOCKS_KEY = "two-locks-1";
export const PLATFORM_FACTS_FILE = "docs/runs/2026-11-10-platform-e2e/facts.json";
export const PLATFORM_RUN_FILE = "docs/runs/2026-11-10-platform-e2e.md";
export const CONNECTED_RUN_FILE = "docs/runs/2026-11-10-connected-accounts-sandbox.md";
/** The first connected-accounts run's row in the runs list. */
export const CONNECTED_KEY = "connected-1";
export const ACCEPTANCE_RUN_FILE = "docs/runs/2026-11-10-payment-acceptance-sandbox.md";
/** The kit's own sentences, quoted row by row. */
export const KIT_FILE = "docs/requirements-matrix.md";
/** The fold with the platform run on /airwallex, and the one with the main run's flow. */
export const PLATFORM_FOLD_ID = "platform-run";
export const MAIN_RUN_FOLD_ID = "main-run";
/** The main run's FX line inside that fold: the FX tile's id leads there. */
export const MAIN_RUN_FX_ID = "main-run-fx";
/** The page's label: true for every run on it (each block that shows one run carries that run's own date). */
export const AWX_PAGE_LABEL = "Airwallex sandbox · test money · each run dated";

type Doc = { label: string; href: string };
const DOCS = "https://www.airwallex.com/docs/";
/** The seven products: the name on the tile and Airwallex's own docs for what Purser uses of it. */
const PRODUCTS: Record<ProductKey, { name: string; docs: Doc[] }> = {
  issuing: { name: "Issuing", docs: [{ label: "Create commercial cards", href: `${DOCS}issuing/get-started/create-cards/create-commercial-cards` }, { label: "Transaction limits", href: `${DOCS}issuing/card-controls/authorization-controls/transaction-limits` }, { label: "Cards API", href: `${DOCS}api/issuing/cards` }, { label: "Issuing transactions API", href: `${DOCS}api/issuing/transactions` }] },
  payouts: { name: "Payouts", docs: [{ label: "Transfers API", href: `${DOCS}api/payouts/transfers` }, { label: "Create beneficiaries", href: `${DOCS}payouts/beneficiaries/create-beneficiaries` }] },
  fx: { name: "FX", docs: [{ label: "FX quotes API", href: `${DOCS}api/transactional_fx/quotes` }, { label: "Conversions API", href: `${DOCS}api/transactional_fx/conversion` }] },
  approvals: { name: "Transfer approvals", docs: [{ label: "Manage approvals for transfers", href: `${DOCS}payouts/transfers/manage-transfers/manage-approvals-for-transfers` }, { label: "Transfer statuses", href: `${DOCS}payouts/transfers/create-a-transfer/transfer-statuses` }] },
  connected: { name: "Connected accounts", docs: [{ label: "About connected accounts", href: `${DOCS}connected-accounts/about/about-connected-accounts` }, { label: "Platform relationships", href: `${DOCS}connected-accounts/about/platform-relationships` }, { label: "Create connected account", href: `${DOCS}api/scale/accounts/create` }] },
  acceptance: { name: "Payment acceptance", docs: [{ label: "Payment Intents API: create", href: `${DOCS}api/payments/payment_intents/create` }, { label: "Payment Intents API: confirm", href: `${DOCS}api/payments/payment_intents/confirm` }, { label: "Hosted payment page", href: `${DOCS}payments/integration-options/web-checkout/hosted-payment-page` }] },
  airi: { name: "Airi", docs: [{ label: "Airi", href: `${DOCS}payments/payment-methods/global/airi` }] },
};
/** The docs of all seven products, in the tiles' order (the docs fold). */
export const productDocs = () => PRODUCT_ORDER.map((key) => ({ key, ...PRODUCTS[key] }));

export interface TileState { text: string; tone: "ok" | "hold" | "bad" }
export interface ProductTile {
  key: ProductKey | "payee-check" | "batch" | "ledger"; name: string;
  /** The one number. */
  value: string;
  /** What happened, one short line; empty when the tile shows states instead. */
  what: string;
  /** What Airwallex itself enforces or provides there. */
  why: string;
  states?: TileState[];
  /** The one id, in full as its record has it, and what it names. */
  id: string; idLabel: string;
  /** Where the id leads: a fold on this page, the run on /runs, or the run log. */
  href: string;
  /** The run's own date. */
  iso: string;
  /** The record files everything on the tile was read from. */
  files: string[];
}

const read = (file: string): string | null => {
  const url = new URL(`../../${file}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : null;
};
/** "45.00" → "€45", "4.84" → "€4.84". */
// "EUR 45.00", the site's one style for an amount (review 12 Nov).
const euro = (amount: string) => `EUR ${Number(amount.replace(/,/g, "")).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A figure such as "€4.84" as a count-up (src/redesign/stats.ts COUNT_JS), anything else as it is. */
const countUp = (v: string) => {
  const m = /^(€)(\d+(?:\.(\d+))?)$/.exec(v);
  return m ? `${m[1]}<span data-count="${m[2]}" data-dec="${m[3]?.length ?? 0}">${esc(m[2]!)}</span>` : esc(v);
};
const money = (currency: string, amount: string) => currency === "EUR" ? euro(amount) : `${currency} ${amount}`;
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const faceId = (method: string | null | undefined, virtual = false) => method === "passkey" && !virtual ? "Face ID" : "the CFO's approval";
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * Issuing, from the Airwallex-only run: a charge over the card's limit as Airwallex read it back, declined by Airwallex;
 * the agent's raise asked of the CFO for that decline; and the same charge on the same card approved afterwards.
 */
export function issuingTile(rec: Awx1Record | null): ProductTile | null {
  if (!rec) return null;
  for (const no of rec.card_transactions.filter((t) => !t.approved && t.decline_code)) {
    const card = rec.cards.find((c) => c.agent === no.agent && c.last4 === no.last4);
    const limit = String(card?.read_back.per_tx ?? ""), raised = String(card?.read_back_end?.per_tx ?? "");
    if (!/^\d+\.\d{2}$/.test(limit) || toCents(no.amount) <= toCents(limit)) continue;
    const met = rec.declines_met.find((m) => m.transaction_id === no.id && m.proposal_id);
    const proposal = met ? rec.proposals.find((p) => p.proposal_id === met.proposal_id && p.status === "EXECUTED") : undefined;
    const yes = rec.card_transactions.find((t) => t.approved && t.last4 === no.last4 && t.amount === no.amount && t.merchant === no.merchant && t.occurred_at > no.occurred_at);
    if (!met || !proposal || !yes || !/^\d+\.\d{2}$/.test(raised) || toCents(raised) < toCents(no.amount)) continue;
    return {
      key: "issuing", name: PRODUCTS.issuing.name, value: money(no.currency, no.amount),
      what: "", why: "Airwallex enforces the card limit itself.",
      states: [
        { text: `Declined: ${no.decline_code}`, tone: "bad" },
        { text: "The agent asked the CFO", tone: "hold" },
        { text: `Approved after ${faceId(proposal.method, proposal.virtual_test_passkey)}`, tone: "ok" },
      ],
      id: no.id, idLabel: "Card transaction declined by Airwallex", href: `#${AWX_RUN_STEPS_ID}`, iso: no.occurred_at, files: [AWX_RUN_FILE],
    };
  }
  return null;
}

/** Payouts, from the main run and Airwallex's read-back of its transfer: the hash the CFO signed is the one Airwallex returns. */
export function payoutTile(h: HashTravel | null, runFile: string): ProductTile | null {
  if (!h?.match) return null;
  return {
    key: "payouts", name: PRODUCTS.payouts.name, value: money(h.currency, h.amount),
    what: `${h.transferMethod} payout with the hash of the terms the CFO signed.`, why: "Purser re-checks the echoed hash.",
    id: h.transferId, idLabel: `${h.transferMethod} transfer`, href: `#${AWX_HASH_ID}`, iso: h.signedAt, files: [runFile, h.file],
  };
}

export interface FxQuote { quoteId: string; validTo: string; buy: string; buyCurrency: string; sell: string; sellCurrency: string; proposal: string; approvedWith: string; at: string }
/**
 * The main run's FX, only as its ledger proves it: the quote Airwallex converted on is the quote in the proposal's own
 * terms (with its expiry), the conversion carries the hash the CFO approved for those terms, and less was bought than
 * the invoice with its fee ceiling. Null when the record does not hold the terms (the Airwallex-only run's does not).
 */
export function fxQuote(r: RunRecord): FxQuote | null {
  const ev = r.ledger?.events ?? [];
  const fx = ev.find((e) => e.event === "fx.converted");
  const proposal = (fx?.payload.origin as { proposal_id?: string } | undefined)?.proposal_id;
  const terms = r.ledger?.proposals.find((p) => p.proposal_id === proposal)?.terms as { amount?: string; fee_max?: string; conversion?: Record<string, string | undefined> } | undefined;
  const approved = ev.find((e) => e.event === "proposal.approved" && e.subject === proposal);
  const c = terms?.conversion;
  if (!fx || !proposal || !c?.quote_id || !c.valid_to || !c.buy_amount || !c.sell_amount || !approved || !terms?.amount) return null;
  if (c.quote_id !== fx.payload.quote_id || approved.payload.terms_sha256 !== fx.payload.approval_sha256) return null;
  if (toCents(c.buy_amount) >= toCents(terms.amount) + toCents(terms.fee_max ?? "0.00")) return null;
  return { quoteId: c.quote_id, validTo: c.valid_to, buy: c.buy_amount, buyCurrency: c.buy_currency ?? "", sell: c.sell_amount, sellCurrency: c.sell_currency ?? "", proposal, approvedWith: faceId(String(approved.payload.method ?? "")), at: fx.ts };
}

export function fxTile(q: FxQuote | null, runFile: string): ProductTile | null {
  if (!q) return null;
  return {
    key: "fx", name: PRODUCTS.fx.name, value: money(q.buyCurrency, q.buy),
    what: "Only the shortfall. The quote's id and expiry are in the signed terms.", why: "Airwallex locks the rate.",
    id: q.quoteId, idLabel: "FX quote", href: `#${MAIN_RUN_FX_ID}`, iso: q.at, files: [runFile],
  };
}

/**
 * The statuses that end a transfer unpaid: Airwallex's own failures, and the ends of its approval workflow (rejected,
 * recalled, or no next approver), as src/airwallex/approvals.ts names them.
 */
const UNPAID_END = new Set(["FAILED", "CANCELLED", "REJECTED", ...APPROVAL_STATES.filter((s) => s !== "IN_APPROVAL")]);
/** A transfer's statuses at Airwallex, in the order a transfer moves through them, then those that end it unpaid. */
const TRANSFER_STATUS = ["IN_APPROVAL", "SCHEDULED", "PROCESSING", "SENT", "PAID", ...UNPAID_END];
/** Every status above, as a whole word (APPROVAL_REJECTED is never read as REJECTED); a test holds it to the list. */
export const STATUS_RE = /\b(APPROVAL_REJECTED|APPROVAL_RECALLED|APPROVAL_BLOCKED|IN_APPROVAL|SCHEDULED|PROCESSING|SENT|PAID|FAILED|CANCELLED|REJECTED)\b/g;
export const transferStatuses = (): readonly string[] => TRANSFER_STATUS;
/** A clause that says the transfer did not (or not yet) reach the status that follows it in the same clause. */
const NEGATED = /\b(?:not|never|no longer|expects?|expected|until|cannot)\b[^.;:|\n]*$/i;
/** How far along a status is: PAID is the end; a failure outranks anything but PAID; otherwise the order above. */
const rank = (s: string) => s === "PAID" ? 100 : UNPAID_END.has(s) ? 50 : TRANSFER_STATUS.indexOf(s);

export interface TwoLocks {
  transferId: string; amount: string | null; iso: string;
  /** The status Airwallex answered when the transfer was created (null when only the runs list is readable). */
  held: string | null;
  /** The furthest status the source reports: the state of the run as published today. */
  now: string;
  finished: boolean;
  /** The first lock was a labelled test passkey, not a person's Face ID. */
  testPasskey: boolean;
  /** The run log and the runs list do not say the same; the run log's state is the one kept. */
  disagree: boolean;
  source: "record" | "runs";
  /** The run log the state was read from (null when only the runs list was readable). */
  file: string | null;
}

/**
 * The two-locks run as one of its logs has it. The log's "What happened" section gives the status on create (the first
 * status it names) and the furthest status it names; the transfer and the amount are the section's, or else the log's
 * own (a later log names them under "The payout"); the date is the transfer's creation or, in a log with a timed table,
 * the time of the row that reached the furthest status on the log's own day. The runs list's row gives its status figure
 * (in its older shape) and its transfer id. They should agree; when they do not, the run log's are shown. Without a
 * readable run log the row's are shown; with neither, nothing.
 */
export function twoLocksState(md: string | null, row: RunRow | null | undefined, day?: string): TwoLocks | null {
  const rowStatus = row?.stats?.map((s) => s.v).find((v) => TRANSFER_STATUS.includes(v));
  const rowId = row?.ids.find((i) => /transfer/i.test(i.label))?.value;
  const sec = md?.split(/^## What happened[^\n]*$/m)[1]?.split(/^## /m)[0] ?? "";
  // A status the run log says the transfer did not reach ("it was never PAID") is not one it is in.
  const statuses = [...sec.matchAll(STATUS_RE)].filter((m) => !NEGATED.test(sec.slice(0, m.index))).map((m) => m[1]!);
  const ID = /Transfer\s+`([0-9a-f]{8}-[0-9a-f-]{27})`/;
  const transferId = ID.exec(sec)?.[1] ?? ID.exec(md ?? "")?.[1];
  if (transferId && statuses.length) {
    const now = statuses.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    const created = /created (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z/.exec(sec)?.[1];
    const at = sec.split("\n").find((l) => l.includes(`\`${now}\``))?.match(/^\|\s*(\d{2}:\d{2}:\d{2})\s*\|/)?.[1];
    const iso = created ? `${created}.000Z` : day && at ? `${day}T${at}.000Z` : row?.iso;
    if (!iso) return null;
    const AMOUNT = /EUR (\d[\d,]*\.\d{2})/;
    return {
      transferId, amount: AMOUNT.exec(sec)?.[1] ?? AMOUNT.exec(md ?? "")?.[1] ?? null, iso, held: statuses[0]!, now, finished: now === "PAID", testPasskey: /test passkey/i.test(md ?? ""),
      disagree: (rowStatus !== undefined && rowStatus !== now) || (rowId !== undefined && rowId !== transferId), source: "record", file: null,
    };
  }
  if (!row || !rowStatus || !rowId) return null;
  return {
    transferId: rowId, amount: /EUR (\d[\d,]*\.\d{2})/.exec(row.what)?.[1] ?? null, iso: row.iso, held: null, now: rowStatus, finished: rowStatus === "PAID",
    testPasskey: /test passkey/i.test(row.what), disagree: false, source: "runs", file: null,
  };
}

/** The run's state from its logs: the newest log (by the date in its name) that names a status; else the runs list. */
export function twoLocksFromLogs(logs: { name: string; md: string | null }[], row: RunRow | null | undefined): TwoLocks | null {
  const dated = logs.flatMap((l) => { const day = TWO_LOCKS_LOG.exec(l.name)?.[1]; return day ? [{ ...l, day }] : []; }).sort((a, b) => (a.name < b.name ? 1 : -1));
  for (const l of dated) {
    const s = twoLocksState(l.md, row, l.day);
    if (s?.source === "record") return { ...s, file: `docs/runs/${l.name}` };
  }
  return twoLocksState(null, row);
}

/** Transfer approvals as three states in a row: signed in Purser, held at Airwallex, and what the run says now. */
export function approvalsTile(s: TwoLocks | null): ProductTile | null {
  if (!s?.amount) return null;
  return {
    key: "approvals", name: PRODUCTS.approvals.name, value: euro(s.amount),
    what: "", why: "Airwallex needs a person's approval.",
    states: [
      { text: s.testPasskey ? "Signed in Purser (test passkey)" : "Signed in Purser", tone: "ok" },
      { text: s.held ? `${s.held} at Airwallex` : "Held by Airwallex's approval workflow", tone: "hold" },
      { text: `Now: ${s.now}${s.finished ? "" : ", not paid"}`, tone: s.finished ? "ok" : UNPAID_END.has(s.now) ? "bad" : "hold" },
    ],
    id: s.transferId, idLabel: "Transfer", href: `runs#${TWO_LOCKS_KEY}`, iso: s.iso, files: [s.file ?? (s.source === "record" ? TWO_LOCKS_FILE : "src/redesign/runs.ts")],
  };
}

export interface PlatformFact {
  key: string; account: string; account_line: string;
  invoices: { received_at: string }[];
  beneficiaries: { method: string }[];
  approvals: { approved_with: string }[];
  transfers: { transfer_id: string | null; status: string; amount: string; airwallex_fee: string | null; failure: string | null }[];
  purser_fees: { amount: string; status: string; with_payout: string | null }[];
}
export interface PlatformRun {
  accounts: number; active: number; iso: string;
  paid: { transferId: string; amount: string; status: string; airwallexFee: string; purserFee: string; purserFeeStatus: string };
  /** The payout went by local transfer (the supplier's method at Airwallex), which the run log calls SEPA. */
  local: boolean; sepa: boolean;
  /** The run log says the PAID came through the sandbox's simulation. */
  simulatedPaid: boolean;
  refused: number; refusedAccounts: number;
  /** The refusals' cause as the run log gives it: the field Airwallex named, how the accounts were opened, what is left for a later run. */
  cause: { field: string; nonRegistered: boolean; laterRun: boolean } | null;
  testPasskey: boolean;
}

/** The platform run from its facts: the payout that went PAID with Purser's fee, and the payouts Airwallex refused at create. */
export function platformRun(facts: PlatformFact[], md: string): PlatformRun | null {
  for (const c of facts) {
    const t = c.transfers.find((x) => x.status === "PAID" && x.transfer_id);
    const fee = t && c.purser_fees.find((f) => f.with_payout === t.transfer_id);
    const iso = c.invoices[0]?.received_at;
    if (!t || !fee || !t.airwallex_fee || !iso) continue;
    const refusedIn = facts.filter((x) => x.transfers.some((y) => !y.transfer_id && y.failure));
    const field = /Every refusal: `[^`]+`, source `([^`]+)`/.exec(md)?.[1];
    return {
      accounts: facts.length, active: facts.filter((x) => /\bACTIVE\b/.test(x.account_line)).length, iso,
      paid: { transferId: t.transfer_id!, amount: t.amount, status: t.status, airwallexFee: t.airwallex_fee, purserFee: fee.amount, purserFeeStatus: fee.status },
      local: c.beneficiaries.every((b) => b.method === "LOCAL"), sepa: /SEPA, LOCAL|LOCAL\*{0,2} \(SEPA\)/.test(md), simulatedPaid: /\*\*PAID\*\* \(sandbox simulation\b/.test(md),
      refused: refusedIn.reduce((n, x) => n + x.transfers.filter((y) => !y.transfer_id && y.failure).length, 0), refusedAccounts: refusedIn.length,
      cause: field ? { field, nonRegistered: /opened as \*\*non-registered sole traders\*\*/.test(md), laterRun: /registered sole trader[^.]*\.\s+That is for a later run/.test(md) } : null,
      testPasskey: facts.every((x) => x.approvals.every((a) => /test passkey/.test(a.approved_with))),
    };
  }
  return null;
}

/** The words beside a sandbox payout's amounts, so two runs' different test amounts never read as one price (orchestrator, 12 Nov). */
export const TEST_VALUES = "Sandbox test values, not a rate.";

export function connectedTile(p: PlatformRun | null): ProductTile | null {
  if (!p) return null;
  return {
    key: "connected", name: PRODUCTS.connected.name, value: euro(p.paid.amount),
    what: `${p.paid.status} with Purser's ${euro(p.paid.purserFee)} fee${p.paid.purserFeeStatus === "SETTLED" ? "" : ` ${p.paid.purserFeeStatus}`}. ${TEST_VALUES}`,
    // SETTLED is Purser's own fee row: Airwallex accepted exactly the signed fee with this payout. Where the fee then shows
    // in the platform's balance is unconfirmed in the run logs, so the tile says no more than that (review, 12 Nov).
    why: p.paid.purserFeeStatus === "SETTLED" ? "Airwallex accepted the fee." : "Airwallex carries the application fee.",
    // The id leads to the run's own record, and the tile carries the run's date: another sandbox run (EUR 5.00, fee
    // EUR 0.05) is told on /runs, and the two are different runs, not one figure.
    id: p.paid.transferId, idLabel: "Payout", href: `${REPO_BLOB}${PLATFORM_RUN_FILE}`, iso: p.iso, files: [PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE],
  };
}

export interface FirstConnectedRun { account: string; transferId: string; amount: string; fee: string; status: string; simulated: boolean }
/**
 * The first connected-accounts run (10 Nov) from its own run log: the third run's payout on behalf of the connected
 * account, its amount, the application fee Airwallex accepted, and its status, which the sandbox's simulation set.
 */
export function firstConnectedRun(md: string): FirstConnectedRun | null {
  const sec = md.split(/^## Third run[^\n]*$/m)[1]?.split(/^## /m)[0] ?? "";
  const create = sec.split("\n").find((l) => l.includes("`POST /transfers/create`")) ?? "";
  const account = /`(acct_[A-Za-z0-9_-]+)`/.exec(sec)?.[1];
  const transferId = /\|\s*`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`/.exec(create)?.[1];
  const amount = /EUR (\d+\.\d{2}), SWIFT/.exec(create)?.[1];
  const fee = /Airwallex accepted exactly EUR (\d+\.\d{2})/.exec(sec)?.[1];
  const paid = sec.split("\n").find((l) => /\*\*`PAID`\*\*/.test(l));
  if (!account || !transferId || !amount || !fee || !paid) return null;
  return { account, transferId, amount, fee, status: "PAID", simulated: /\/simulation\//.test(paid) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export interface AcceptanceRun {
  intentId: string; status: string; amount: string; iso: string;
  /** The run log says the card was Airwallex's sandbox test card and the payer a test customer. */
  testCard: boolean; testCustomer: boolean;
}
/**
 * The payment-acceptance run from its run log: the PaymentIntent and the status Purser read back with GET, the invoice's
 * amount and the run's date. Only a run that read SUCCEEDED and booked from that read-back counts.
 */
export function acceptanceRun(md: string): AcceptanceRun | null {
  const got = /\|\s*`GET \/api\/v1\/pa\/payment_intents\/(int_[A-Za-z0-9]+)`\s*\|\s*200, `([A-Z_]+)`/.exec(md);
  const amount = /^- Invoice: [^\n]*EUR (\d+\.\d{2})/m.exec(md)?.[1];
  const d = /^# [^\n]*?(\d{1,2}) ([A-Z][a-z]+) (\d{4})\s*$/m.exec(md);
  const time = /\|\s*1\s*\|\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*\|/.exec(md)?.[1] ?? "00:00:00.000";
  const month = d ? MONTHS.indexOf(d[2]!) : -1;
  if (!got || got[2] !== "SUCCEEDED" || !amount || !d || month < 0 || !/Booked the receipt only from the status it read back/.test(md)) return null;
  return {
    intentId: got[1]!, status: got[2], amount, iso: `${d[3]}-${String(month + 1).padStart(2, "0")}-${d[1]!.padStart(2, "0")}T${time}Z`,
    testCard: /success test card/.test(md), testCustomer: /\(a test customer\)/.test(md),
  };
}

export function acceptanceTile(a: AcceptanceRun | null): ProductTile | null {
  if (!a) return null;
  return {
    key: "acceptance", name: PRODUCTS.acceptance.name, value: euro(a.amount),
    what: `A ${a.testCard ? "test " : ""}card paid the invoice; booked only after ${a.status}.`, why: "Airwallex reports the PaymentIntent's status.",
    id: a.intentId, idLabel: "PaymentIntent", href: `${REPO_BLOB}${ACCEPTANCE_RUN_FILE}`, iso: a.iso, files: [ACCEPTANCE_RUN_FILE],
  };
}

/** Airi, from its run: the purchase above Purser's limit, paid with Airi's credential only after the CFO's Face ID. */
export function airiTile(rec: AiriRunRecord | null): ProductTile | null {
  const b = rec?.purchases.find((p) => p.route === "cfo" && p.outcome === "SUCCEEDED" && p.proposal_end === "EXECUTED" && p.method === "passkey" && p.payment_intent_id);
  // The record's own checks on that purchase (it waited for the CFO, it ran after the Face ID) must have passed.
  const checked = Object.entries(rec?.checks ?? {}).filter(([k]) => k.startsWith("b_"));
  if (!rec || !b || toCents(b.amount) <= toCents(rec.policy.alone_max_eur) || !checked.length || checked.some(([, c]) => !c.ok)) return null;
  return {
    key: "airi", name: PRODUCTS.airi.name, value: money(b.currency, b.amount),
    what: `Over Purser's ${euro(rec.policy.alone_max_eur)} limit: paid only after the CFO's Face ID.`, why: "Airi issues a single-use Visa credential.",
    id: b.payment_intent_id!, idLabel: "PaymentIntent", href: `#${AIRI_RUN_STEPS_ID}`, iso: b.approved_at ?? rec.started_at, files: [AIRI_RUN_FILE],
  };
}

/** The kit's own sentence that names a SWIFT payout (docs/requirements-matrix.md quotes the kit row by row), or null. */
export function kitSwift(matrix: string | null): string | null {
  return /^\| K[\w-]+ \| "([^"]*SWIFT payout[^"]*)"/m.exec(matrix ?? "")?.[1] ?? null;
}

export function platformRunOfRecord(): PlatformRun | null {
  const facts = read(PLATFORM_FACTS_FILE), md = read(PLATFORM_RUN_FILE);
  return facts && md ? platformRun(JSON.parse(facts) as PlatformFact[], md) : null;
}
export function acceptanceRunOfRecord(): AcceptanceRun | null {
  const md = read(ACCEPTANCE_RUN_FILE);
  return md ? acceptanceRun(md) : null;
}
/** The two-locks run's logs in docs/runs, newest first (by the date in the name). */
export function twoLocksLogs(): { name: string; md: string }[] {
  return readdirSync(new URL("../../docs/runs/", import.meta.url)).filter((n) => TWO_LOCKS_LOG.test(n)).sort().reverse()
    .map((name) => ({ name, md: read(`docs/runs/${name}`) ?? "" }));
}
export const twoLocksOfRecord = (): TwoLocks | null => twoLocksFromLogs(twoLocksLogs(), liveRuns().find((r) => r.key === TWO_LOCKS_KEY));
export function firstConnectedRunOfRecord(): FirstConnectedRun | null {
  const md = read(CONNECTED_RUN_FILE);
  return md ? firstConnectedRun(md) : null;
}

// ── Behind flags in this build, each run live on 12 Nov (jury check, 12 Nov): the payee check, the batch transfer and
// Airwallex's own ledger against Purser's. Every figure and id is read from its record; a missing record leaves its tile out.
export const PAYEE_CHECK_FILE = "docs/runs/2026-11-12-airwallex-payee-check.json";
export const BATCH_FILE = "docs/runs/2026-11-12-airwallex-batch-transfer.json";
export const FT_FILE = "docs/runs/2026-11-12-airwallex-financial-transactions.json";
export const FLAGGED_LINE = "Built, not yet switched on; each ran live on 12 Nov.";
const json = <T>(file: string): T | null => { const t = read(file); try { return t ? JSON.parse(t) as T : null; } catch { return null; } };

export function payeeCheckTile(r: { checks: { match: string; proceed: number; checked_at: string }[] } | null): ProductTile | null {
  if (!r?.checks.length) return null;
  const ok = r.checks.filter((c) => c.proceed).length, refused = r.checks.length - ok;
  return {
    key: "payee-check", name: "Payee check", value: `${refused} of ${r.checks.length}`,
    what: `name checks stopped before the CFO is asked; ${ok} full match let through.`, why: "Airwallex asks the payee's bank for the account's name.",
    id: PAYEE_CHECK_FILE.replace(/^docs\/runs\/|\.json$/g, ""), idLabel: "Run record", href: `${REPO_BLOB}${PAYEE_CHECK_FILE.replace(/\.json$/, ".md")}`, iso: r.checks[0]!.checked_at, files: [PAYEE_CHECK_FILE],
  };
}
export function batchTile(r: { audit: { ts: string }[]; awx_batches: { awx_batch_id: string; status: string }[]; transfers: { amount: string; currency: string }[] } | null): ProductTile | null {
  const b = r?.awx_batches[0];
  if (!r || !b || !r.transfers.length) return null;
  const total = (r.transfers.reduce((n, t) => n + toCents(t.amount), 0) / 100).toFixed(2);
  return {
    key: "batch", name: "Batch transfer", value: money(r.transfers[0]!.currency, total),
    what: `${WORDS[r.transfers.length] ?? r.transfers.length} payouts, signed once, one batch; read back, then held ${b.status}.`, why: "Airwallex's approval workflow holds the batch.",
    id: b.awx_batch_id, idLabel: "Airwallex batch", href: `${REPO_BLOB}${BATCH_FILE.replace(/\.json$/, ".md")}`, iso: r.audit[0]!.ts, files: [BATCH_FILE],
  };
}
export function ledgerTile(r: { audit: { ts: string; event: string; payload: { agree?: number; checked?: number; differences?: number; items?: { id: string }[] } }[] } | null): ProductTile | null {
  const rec = r?.audit.filter((a) => a.event === "awx_ft.reconciled").pop(), read0 = r?.audit.find((a) => a.event === "awx_ft.read");
  const id = read0?.payload.items?.[0]?.id;
  if (!rec || rec.payload.checked === undefined || !id) return null;
  return {
    key: "ledger", name: "Ledger reconciliation", value: `${rec.payload.agree} of ${rec.payload.checked}`,
    what: `movements agree with Airwallex's own ledger to the cent; ${rec.payload.differences} differences.`, why: "Airwallex books each movement in its financial transactions.",
    id, idLabel: "Airwallex financial transaction", href: `${REPO_BLOB}${FT_FILE.replace(/\.json$/, ".md")}`, iso: rec.ts, files: [FT_FILE],
  };
}
export function flaggedTiles(): ProductTile[] {
  return [payeeCheckTile(json(PAYEE_CHECK_FILE)), batchTile(json(BATCH_FILE)), ledgerTile(json(FT_FILE))].filter((t): t is ProductTile => t !== null);
}
export function flaggedHtml(tiles: ProductTile[] = flaggedTiles()): string {
  return tiles.length ? `<section class="awgroup off" aria-labelledby="awg-off"><h2 id="awg-off"><span class="dot" aria-hidden="true"></span>${esc(FLAGGED_LINE)}</h2><div class="awp">${tiles.map(tileHtml).join("\n")}</div></section>` : "";
}

/** The tiles that have their facts, in the fixed order. */
export function productTiles(run: AgentRun): ProductTile[] {
  return [
    issuingTile(awxRun()), payoutTile(hashTravel(run.record), run.file), fxTile(fxQuote(run.record), run.file), approvalsTile(twoLocksOfRecord()),
    connectedTile(platformRunOfRecord()), acceptanceTile(acceptanceRunOfRecord()), airiTile(airiRun()),
  ].filter((t): t is ProductTile => t !== null);
}

/** The words a person reads on a tile (drawings and markup left out), counted as the page's word budget counts them. */
export const tileWords = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** An id as a tile shows it: a UUID by its first block, as the pages do elsewhere; any other id in full. */
export const shortId = (id: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id) ? `${id.slice(0, 8)}…` : id;
const link = (href: string, inner: string, attrs = "") => `<a href="${esc(href)}"${attrs}${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ""}>${inner}${/^https?:/.test(href) ? " ↗" : ""}</a>`;

/**
 * One product, quiet (owner, 13 Nov: "overwhelming with all the numbers"): its name, one plain sentence, its day and a
 * link to its proof in sight; the figure, what Airwallex enforces there and the id under "Details". A tile with states
 * (transfer approvals) shows them in sight: IN_APPROVAL and PAID are said as the record says them.
 */
function tileHtml(t: ProductTile): string {
  const line = t.states ? `<ol class="aws">${t.states.map((s) => `<li class="${s.tone}"><b>${esc(s.text)}</b></li>`).join("")}</ol>`
    : `<p class="w">${esc(/^[a-z]/.test(t.what) ? `${t.value} ${t.what}` : t.what)}</p>`;
  return `<article class="awt card${t.states ? " wide" : ""}" id="p-${t.key}" data-rec="${esc(t.files.join(" "))}"><h2>${esc(t.name)}</h2>
${line}
<p class="d"><time datetime="${esc(t.iso)}">${esc(dayShort(t.iso))}</time>${link(t.href, icon("file-check", 18), ` class="pr" aria-label="${esc(`${t.name}: the proof`)}" title="The proof"`)}</p>
<details class="fold awdet"><summary>Details</summary><span class="v">${countUp(t.value)}</span><p class="y">${esc(t.why)}</p><p class="i">${link(t.href, `<code>${esc(shortId(t.id))}</code>`, ` title="${esc(`${t.idLabel} ${t.id}`)}"`)}</p></details></article>`;
}

/** The tiles: one per product, in order. */
export function tilesHtml(tiles: ProductTile[]): string {
  return tiles.length ? `<section class="awgroup on" aria-labelledby="awg-on"><h2 id="awg-on"><span class="dot" aria-hidden="true"></span>In use</h2><div class="awp">${tiles.map(tileHtml).join("\n")}</div></section>` : "";
}

const liPlain = (t: string, tone = "") => `<li${tone ? ` class="${tone}"` : ""}>${esc(t)}</li>`;
// On a phone each docs link is a row of its own (PRODUCTS_CSS): the separators are hidden there.
const docsLi = (title: string, docs: Doc[]) => `<li>${esc(title)}: ${docs.map((d) => `<a class="pf" href="${esc(d.href)}" target="_blank" rel="noopener">${esc(d.label)} ↗</a>`).join('<span class="sep"> · </span>')}</li>`;
const foldHtml = (summary: string, inner: string, attrs = "") => `<details class="fold"${attrs}><summary>${esc(summary)}</summary>${inner}</details>`;
const runLog = (file: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">run\u00a0log\u00a0↗</a>`;

/**
 * One line: why the main run's payout went by SWIFT, and the local SEPA payout of the platform run with its fee. The kit
 * gives a fee rule for each SWIFT payout (it does not demand one), so the line says that, with the kit's own figure.
 */
export function swiftLineHtml(kit: string | null, p: PlatformRun | null): string {
  const fee = /EUR (\d+\.\d{2})/.exec(kit ?? "")?.[1];
  if (!kit || !fee || !p?.local || !p.sepa) return "";
  return `<p class="awswift" data-rec="${esc(`${KIT_FILE} ${PLATFORM_FACTS_FILE} ${PLATFORM_RUN_FILE}`)}">${esc("Why SWIFT:")} <span title="${esc(`The kit: "${kit}"`)}">${esc(`the hackathon kit's fee rule is for a SWIFT payout, EUR ${fee} each.`)}</span> ${esc("The platform run paid by")} ${link(`#${PLATFORM_FOLD_ID}`, esc("local SEPA transfer"))}${esc(`, Airwallex fee ${p.paid.airwallexFee}.`)}</p>`;
}

/** The platform run's fold: the PAID payout with both fees, then the refusals with their cause as the run log gives it. */
export function platformFoldHtml(p: PlatformRun | null, first: FirstConnectedRun | null, firstDay: string | null): string {
  if (!p) return "";
  const cause = p.cause?.nonRegistered ? `: the accounts were opened as non-registered sole traders, and Airwallex requires the payer's registration number (${p.cause.field})` : "";
  const items = [
    liPlain(`${p.accounts} test companies, each on its own Airwallex connected account${p.active === p.accounts ? ", all ACTIVE" : ` (${p.active} ACTIVE)`}.`),
    liPlain(`${p.paid.status}${p.simulatedPaid ? " (simulated)" : ""}: EUR ${p.paid.amount} by local${p.sepa ? " SEPA" : ""} transfer, ${p.paid.transferId}. Airwallex fee ${p.paid.airwallexFee}; Purser's fee EUR ${p.paid.purserFee}, ${p.paid.purserFeeStatus}.`, "ok"),
    ...(p.refused ? [liPlain(`${p.refused} payouts from the ${p.refusedAccounts} new test accounts were refused by Airwallex at create${cause}.${p.cause?.laterRun ? " A test company opened with a registration number has not run yet." : ""}`)] : []),
    ...(p.testPasskey ? [liPlain("Approvals in this run were signed with a test passkey, not Face ID.")] : []),
    ...(first ? [liPlain(`The first connected-account run${firstDay ? `, ${firstDay}` : ""}: €${first.amount} payout ${first.status}${first.simulated ? " (simulated)" : ""} with Purser's €${first.fee} fee. Account ${first.account}; payout ${first.transferId}. ${TEST_VALUES}`)] : []),
  ];
  const src = `<p class="src"><time datetime="${esc(p.iso)}">${esc(dayShort(p.iso))}</time>${esc(` · sandbox, test money · ${PLATFORM_FACTS_FILE}`)} · ${runLog(PLATFORM_RUN_FILE)}</p>`;
  // Its title (jury check, 12 Nov): what the run shows, with Airwallex's own code from the run log.
  const code = /code (\d{3})\*\*/.exec(read(PLATFORM_RUN_FILE) ?? "")?.[1];
  const title = p.cause?.nonRegistered && code ? `${p.accounts} test companies onboarded; Airwallex refused unregistered sole-trader payouts (code ${code}), as it should` : "Platform run, with its refusals";
  return foldHtml(title, `<ul class="pl">${items.join("")}</ul>${src}`, ` id="${PLATFORM_FOLD_ID}" data-rec="${esc([PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE, ...(first ? [CONNECTED_RUN_FILE] : [])].join(" "))}"`);
}

export interface AirwallexBody {
  /** The partner's name as text. */
  logo: string;
  /** The hash block and the cards beside the CFO policy (src/redesign/airwallexProof.ts), as they are. */
  hash: string; controls: string;
  /** The Airwallex-only run's block and the Airi runs' blocks, as /proof and /visa show them. */
  awx1: string; airi: string;
  /** The main run's flow (Metal earnings booked, the licence paid) and its list of Airwallex ids. */
  picture: string; mainProof: string[];
  /** The main run's lines of what is simulated (the SWIFT settlement, an earlier attempt), and the booked deposit's amount. */
  simulated: string[]; deposit: string | null;
  /** The docs of what the main run's deposit uses. */
  depositDocs: Doc[];
  proofHash: string;
}

/** The page's description: the products on its tiles, by name. */
export function airwallexDescription(run: AgentRun): string {
  const names = productTiles(run).map((t) => t.name);
  return `The Airwallex products Purser uses, each with one number, one id and the date of its own run: ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("")}.`;
}

/** The run of 13 Nov: the owner's own iPhone Face ID opened lock 1 on one payout (its row in src/redesign/runs.ts). */
export const FACEID_KEY = "awx-faceid-1";
/** That run as a fold on /airwallex, in its row's words: held IN_APPROVAL, not PAID that day. */
export function faceIdFoldHtml(row: RunRow | null | undefined): string {
  if (!row) return "";
  return foldHtml(`Approved with the owner's own Face ID (${dayShort(row.iso)})`, `<ul class="pl">${liPlain(row.line ?? row.what)}</ul><p class="src"><a class="pf" href="runs#${FACEID_KEY}">${esc("Every id on /runs")}</a></p>`, ` id="faceid-run"`);
}

/** /airwallex's body: the tiles first, the hash block under them, everything else folded. */
export function airwallexBody(run: AgentRun, o: AirwallexBody): string {
  const tiles = productTiles(run), platform = platformRunOfRecord(), locks = twoLocksOfRecord(), q = fxQuote(run.record), accept = acceptanceRunOfRecord();
  const firstRow = liveRuns().find((r) => r.key === CONNECTED_KEY), first = firstConnectedRunOfRecord();
  const testPasskeys = [...(platform?.testPasskey ? ["the platform run"] : []), ...(locks?.testPasskey ? ["the two-locks run"] : [])];
  const fxLine = q ? [`<li id="${MAIN_RUN_FX_ID}" data-rec="${esc(run.file)}">${esc(`FX: only ${q.buyCurrency} ${q.buy} bought for ${q.sellCurrency} ${q.sell}, on quote ${q.quoteId}, valid to ${q.validTo.slice(11, 16)} UTC. Both are in the terms of ${q.proposal}, which the CFO signed with ${q.approvedWith}.`)}</li>`] : [];
  const folds = [
    o.awx1 ? foldHtml("Airwallex-only run: every step and id", `<div class="awrb">${o.awx1}</div>`) : "",
    o.airi ? foldHtml("Airi runs: every step and id", `<div class="awrb">${o.airi}</div>`) : "",
    faceIdFoldHtml(liveRuns().find((r) => r.key === FACEID_KEY)),
    platformFoldHtml(platform, first, firstRow ? dayShort(firstRow.iso) : null),
    foldHtml("Metal earnings booked at Airwallex", `<div class="flow" role="img" aria-label="${esc("The main run at Airwallex, step by step")}">${o.picture}</div><ul class="pl">${[...o.mainProof, ...fxLine].join("")}</ul>`, ` id="${MAIN_RUN_FOLD_ID}"`),
    foldHtml("The Airwallex products and their docs", `<ul class="pl awd">${[...productDocs().filter((d) => tiles.some((t) => t.key === d.key)).map((d) => docsLi(d.name, d.docs)), ...(o.depositDocs.length ? [docsLi("Metal earnings booked", o.depositDocs)] : [])].join("")}</ul>`),
    foldHtml("What is simulated", `<ul class="pl">${[
      liPlain("The Airwallex sandbox, with test money only."),
      ...o.simulated.map((t) => liPlain(t)),
      ...(o.deposit ? [liPlain(`Metal earnings: USD ${o.deposit} booked as a simulated sandbox deposit; no test USD reached Airwallex.`)] : []),
      liPlain("Card charges at merchants are simulated by the sandbox; the approve or decline is Airwallex's own."),
      ...(accept?.testCard && accept.testCustomer ? [liPlain("Payment acceptance: Airwallex's sandbox test card and a test customer.")] : []),
      ...(platform ? [liPlain("Connected accounts: verification simulated (the sandbox made them ACTIVE), and PAID through the sandbox's simulation API.")] : []),
      // A sandbox transfer reaches PAID only through the simulation API: said for the two-locks transfer too, once its run is finished.
      ...(locks?.finished ? [liPlain("The two-locks transfer's PAID came through the sandbox's simulation API too.")] : []),
      ...(testPasskeys.length ? [liPlain(`In ${testPasskeys.join(" and ")} the approvals were signed with a labelled test passkey, not Face ID.`)] : []),
    ].join("")}</ul>`),
  ].join("");
  const count = WORDS[tiles.length] ?? String(tiles.length);
  const flagged = flaggedTiles();
  return `<main class="pp awxp"><div class="wrap">
  <div class="phd">${o.logo}<span class="pill run">${icon("database", 14)}${esc(AWX_PAGE_LABEL)}</span><h1>${esc(tiles.length > 1 ? `${count[0]!.toUpperCase()}${count.slice(1)} Airwallex products in use${flagged.length ? `; ${WORDS[flagged.length] ?? flagged.length} more tested live on 12 Nov` : ""}` : "Purser on Airwallex")}</h1></div>
  ${visualsHtml(tiles, flagged)}
  ${tilesHtml(tiles)}
  ${flaggedHtml(flagged)}
  ${o.hash || o.controls ? `<h2 class="vh">Airwallex, read back</h2><div class="awrb">${o.hash}${swiftLineHtml(kitSwift(read(KIT_FILE)), platform)}${o.controls}</div>` : ""}
  <div class="folds card">${folds}</div>
  <a class="open" href="proof#${esc(o.proofHash)}">All the proof ${icon("arrow-right", 15)}</a>
</div></main>`;
}

/** The tiles' styles and the page's tap targets, from the design system's tokens (the patterns of .num.card, .st and .awcard). */
export const PRODUCTS_CSS = `.awflag { margin: 18px 0 8px; color: var(--muted); font-size: 14.5px; }
.awp { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.awt { padding: 14px 16px 4px; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 4px; align-items: baseline; align-content: start; min-width: 0; scroll-margin-top: 80px; }
.awt h2 { font-size: 14px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--awx); line-height: 1.3; }
.awt .v { font-size: 22px; font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.awt p, .awt ol { grid-column: 1 / -1; margin: 0; }
.awt .w { font-size: 15px; font-weight: 500; line-height: 1.45; color: var(--text); }
.awt .d { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13.5px; color: var(--muted); }
.awt .d a.pr { display: inline-flex; align-items: center; min-height: 44px; color: var(--accent); font-weight: 600; text-decoration: none; }
.awt details.awdet { grid-column: 1 / -1; margin: 0 0 8px; } .awt details.awdet > summary { font-size: 13.5px; color: var(--muted); }
.awt details.awdet .v { display: block; margin: 6px 0 2px; }
.awt .y { font-size: 14.5px; color: var(--muted); line-height: 1.4; }
.awt .i { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13.5px; color: var(--faint); font-variant-numeric: tabular-nums; }
.awt .i a { display: inline-flex; align-items: center; min-height: 44px; min-width: 0; color: var(--accent); text-decoration: none; } .awt time { white-space: nowrap; }
.awt code { font: 600 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
ol.aws { list-style: none; padding: 2px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
ol.aws li { display: inline-flex; align-items: center; gap: 6px; font: 650 13.5px/1.35 Inter, system-ui, sans-serif; color: var(--faint); }
ol.aws li + li::before { content: "→"; }
ol.aws b { font-weight: 650; padding: 3px 10px; border-radius: 999px; background: var(--sunken); color: var(--muted); }
ol.aws li.ok b { background: var(--ok-soft); color: var(--ok); } ol.aws li.bad b { background: var(--bad-soft); color: var(--bad); }
@media (min-width: 560px) { .awp { grid-template-columns: repeat(2, minmax(0, 1fr)); } .awt.wide, .awp > :last-child { grid-column: span 2; }
  .awt { grid-template-columns: minmax(0, 1fr); padding: 16px 18px 4px; } }
@media (min-width: 900px) { .awp { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } .awp > :last-child:not(.wide) { grid-column: auto; } }
.awrb p.awswift { font-size: 15px; color: var(--muted); padding: 0 20px; } .awswift a { color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap; }
.folds .awrb .card { border: 0; border-radius: 0; box-shadow: none; background: none; padding: 0 0 10px; }
.folds .flow { padding: 6px 0 10px; } .folds > details > p.src { margin: 0 0 10px; color: var(--faint); font-size: 14px; overflow-wrap: anywhere; }
details#${PLATFORM_FOLD_ID}, details#${MAIN_RUN_FOLD_ID}, li#${MAIN_RUN_FX_ID}, details#${AWX_RUN_STEPS_ID}, details#${AIRI_RUN_STEPS_ID} { scroll-margin-top: 80px; }
/* The flow's arrows turn upright on a phone and reach over the fold's header: they never take a tap. */
.awxp .folds .flow .arrow { pointer-events: none; }
/* Tap targets (jury panel, 12 Nov): on a phone every link and fold header in the page is at least 44 px high. A link
   inside a sentence keeps its place in the line and grows by its padding; a pill grows by a clear border. The docs
   links stand in a list, one row of 44 px each, so no link's padding covers the one above it (review, 12 Nov). */
@media (max-width: 700px) { .awxp a.pf, .awxp .awswift a { padding: 14px 0; } .awxp a.open { min-height: 44px; }
  .awxp ul.awd a.pf { display: flex; align-items: center; min-height: 44px; padding: 0; } .awxp ul.awd .sep { display: none; }
  .awxp a.awm { border: 9px solid transparent; background-clip: padding-box; margin: -9px; } }
${VISUAL_CSS}`;
