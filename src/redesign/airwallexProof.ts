// Airwallex, read back (section B, 6 Nov): what Airwallex itself returns for the main run, next to what the CFO decided.
// Two dated records, both read with GET only from the sandbox and sanitized: the main run's SWIFT transfer
// (docs/runs/airwallex-transfer-approval-<date>.json) and the three agents' cards (docs/runs/airwallex-cards-<date>.json).
// 1. The hash the CFO signed travels with the payment: the terms hash the CFO approved with Face ID (the main run's
//    ledger, proposal.approved) against the transfer's metadata.approval_sha256 as Airwallex returns it.
// 2. Each agent's card controls, which Airwallex enforces itself: the CFO policy's rule (limits from the run's
//    snapshot, merchant categories, currency and end date from the code that wrote the card) against the card's
//    controls as Airwallex returns them. Whether they match is computed here from the two records, never typed in.

import { readdirSync, readFileSync } from "node:fs";
import { cents } from "../airwallex/adapter.js";
import { CARD_ACTIVE_DAYS, MCC_WORDS } from "../config/policy.js";
import { fromCents, toCents } from "../lib/money.js";
import { cardControls } from "../policy/cards.js";
import { cardRaiseOf, type RunRecord } from "./run.js";
import { countOf, esc, icon } from "./ui.js";

const RUNS = new URL("../../docs/runs/", import.meta.url);

/** The newest dated record docs/runs/<prefix>-YYYY-MM-DD.json, or null when there is none. */
export function latestRecordFile(prefix: string, names: string[] = readdirSync(RUNS)): string | null {
  const re = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.json$`);
  const f = names.filter((n) => re.test(n)).sort().pop();
  return f ? `docs/runs/${f}` : null;
}
const readRecord = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T;

export interface TransferReadback {
  read_at: string; method: string; run: string;
  transfer: { id: string; request_id: string; status: string; transfer_method: string; transfer_amount: number | string; transfer_currency: string; fee_amount?: number | string | null; fee_currency?: string | null; created_at: string; metadata?: Record<string, string> | null };
}
export interface AwxCardRecord {
  last4: string; card_id_last4: string; nick_name: string; card_status: string; created_by: string; created_at: string; updated_at: string;
  controls: {
    transaction_limits?: { currency: string; limits: { amount: number | string; interval: string }[] } | null;
    allowed_merchant_categories?: string[]; allowed_currencies?: string[]; active_to?: string | null; allowed_transaction_count?: string;
  };
}
export interface CardsReadback { read_at: string; method: string; run: string; cards: AwxCardRecord[] }

export const TRANSFER_PREFIX = "airwallex-transfer-approval";
export const CARDS_PREFIX = "airwallex-cards";

export function transferReadback(): { file: string; rec: TransferReadback } | null {
  const file = latestRecordFile(TRANSFER_PREFIX);
  return file ? { file, rec: readRecord<TransferReadback>(file) } : null;
}
export function cardsReadback(): { file: string; rec: CardsReadback } | null {
  const file = latestRecordFile(CARDS_PREFIX);
  return file ? { file, rec: readRecord<CardsReadback>(file) } : null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** Airwallex writes "+0000"; Date reads "+00:00". */
const isoOf = (s: string) => new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

export interface HashTravel {
  proposalId: string; transferId: string; transferStatus: string; transferMethod: string; amount: string; currency: string;
  /** The terms hash the CFO approved (proposal.approved in the run's ledger), and how. */
  signed: string; approver: string; method: string; signedAt: string;
  /** What Airwallex returns in the transfer's metadata.approval_sha256 (null if it has none). */
  carried: string | null;
  match: boolean; readAt: string; file: string;
}

/**
 * The hash the CFO signed against the one Airwallex carries: the proposal that paid this transfer (proposal.executed,
 * by transfer id), the hash its approval signed (proposal.approved), and the transfer's metadata as Airwallex returns it.
 */
export function hashTravel(r: RunRecord, rb: { file: string; rec: TransferReadback } | null = transferReadback()): HashTravel | null {
  if (!rb) return null;
  const t = rb.rec.transfer, ev = r.ledger?.events ?? [];
  const executed = ev.find((e) => e.event === "proposal.executed" && e.payload.transfer_id === t.id);
  const approved = executed ? ev.find((e) => e.event === "proposal.approved" && e.subject === executed.subject) : undefined;
  const signed = String(approved?.payload.terms_sha256 ?? "");
  if (!executed || !approved || !HEX64.test(signed)) return null;
  const carried = t.metadata?.approval_sha256 ?? null;
  return {
    proposalId: executed.subject ?? "", transferId: t.id, transferStatus: t.status, transferMethod: t.transfer_method, amount: fromCents(cents(t.transfer_amount)), currency: t.transfer_currency,
    signed, approver: String(approved.payload.approver ?? ""), method: String(approved.payload.method ?? ""), signedAt: approved.ts,
    carried, match: carried === signed, readAt: rb.rec.read_at, file: rb.file,
  };
}

type RunCard = { agent: string; name: string; last4: string; per_tx: string; monthly: string };

export interface ControlCheck { rule: string; policy: string; airwallex: string; ok: boolean; /** Where the policy value came from, when a decision in the run changed it. */ note?: string }
export interface CardControlRow { agent: string; name: string; last4: string; idTail: string; status: string; createdBy: string; checks: ControlCheck[]; match: boolean }

const limitOf = (c: AwxCardRecord, interval: string) => c.controls.transaction_limits?.limits.find((l) => l.interval === interval)?.amount;
const mccWords = (mccs: string[]) => mccs.map((m) => `${MCC_WORDS[m] ?? "MCC"} (MCC ${m})`).join(", ");

/**
 * Each agent's card: the CFO policy's rule beside the control Airwallex returns. Limits per purchase and per month are
 * the policy's (the run's snapshot.cards, which the dashboard takes from the policy); merchant categories, currency and
 * end date are what the policy code (cardControls) writes onto the card: its agent's plans' categories, euros only,
 * CARD_ACTIVE_DAYS from issue. A card is matched to its agent by the last four digits the run recorded.
 */
export function cardControlRows(r: RunRecord, rb: { file: string; rec: CardsReadback } | null = cardsReadback()): CardControlRow[] {
  if (!rb) return [];
  const runCards = ((r.snapshot as unknown as { cards?: RunCard[] }).cards ?? []).filter((c) => /^(sourcing|support|treasury)$/.test(c.agent));
  const raise = cardRaiseOf(r);
  const raisedBy = raise ? r.ledger?.events.find((e) => e.event === "proposal.approved" && e.subject === raise.proposal)?.payload.method : undefined;
  return runCards.flatMap((rc) => {
    const awx = rb.rec.cards.find((c) => c.last4 === rc.last4 && c.nick_name.startsWith(`${rc.agent} agent`));
    if (!awx) return [];
    const issued = isoOf(awx.created_at);
    const want = cardControls(rc.agent, issued);
    const per = limitOf(awx, "PER_TRANSACTION"), month = limitOf(awx, "MONTHLY"), cur = awx.controls.transaction_limits?.currency ?? "";
    const mccs = [...(awx.controls.allowed_merchant_categories ?? [])].sort(), currencies = [...(awx.controls.allowed_currencies ?? [])].sort();
    const activeTo = awx.controls.active_to ? isoOf(awx.controls.active_to) : null;
    // The end date is written a moment before the card is created (cardControls, then the create call): within a minute.
    const endOk = !!activeTo && !!want.activeTo && Math.abs(activeTo.getTime() - new Date(want.activeTo).getTime()) <= 60_000;
    const checks: ControlCheck[] = [
      { rule: "Most per purchase", policy: `EUR ${rc.per_tx}`, ...(rc.agent === "sourcing" && raise?.to === rc.per_tx ? { note: `raised from EUR ${raise.from} by ${raise.proposal}${raisedBy === "passkey" ? ", approved with Face ID" : ""}` } : {}), airwallex: per !== undefined ? `${per} ${cur} · PER_TRANSACTION` : "none", ok: per !== undefined && cur === "EUR" && cents(per) === toCents(rc.per_tx) },
      { rule: "Most per month", policy: `EUR ${rc.monthly}`, airwallex: month !== undefined ? `${month} ${cur} · MONTHLY` : "none", ok: month !== undefined && cur === "EUR" && cents(month) === toCents(rc.monthly) },
      { rule: "Merchant categories", policy: mccWords(want.mccs), airwallex: mccs.length ? mccs.join(", ") : "any", ok: mccs.join(",") === want.mccs.join(",") },
      { rule: "Currency", policy: `${want.currencies.join(", ")} only`, airwallex: currencies.length ? currencies.join(", ") : "any", ok: currencies.join(",") === want.currencies.join(",") },
      { rule: "End date", policy: `${CARD_ACTIVE_DAYS} days from issue (${issued.toISOString().slice(0, 10)})`, airwallex: activeTo ? activeTo.toISOString().slice(0, 10) : "none", ok: endOk },
    ];
    return [{ agent: rc.agent, name: rc.name, last4: rc.last4, idTail: awx.card_id_last4, status: awx.card_status, createdBy: awx.created_by, checks, match: checks.every((c) => c.ok) }];
  });
}

/** The line the pages show above the hash: the words Max asked for, kept in one place. */
export const HASH_TRAVELS = "The hash the CFO signed travels with the payment.";

const badge = (ok: boolean, yes: string, no: string) => `<span class="awm ${ok ? "ok" : "bad"}">${icon(ok ? "circle-check" : "octagon-x", 16)}${esc(ok ? yes : no)}</span>`;

export const READBACK_CSS = `.awrb { display: grid; gap: 12px; }
@media (min-width: 900px) { .awrb.two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.awrb .card { padding: 16px 20px; display: grid; gap: 10px; align-content: start; min-width: 0; scroll-margin-top: 80px; }
.awrb h3 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 8px; }
.awrb p { margin: 0; font-size: 15.5px; line-height: 1.45; }
.awrb p.src { color: var(--faint); font-size: 14px; overflow-wrap: anywhere; }
.awh { display: grid; gap: 4px; padding: 10px 12px; border-radius: 12px; background: var(--sunken); min-width: 0; }
.awh b { font-size: 14px; color: var(--muted); font-weight: 650; }
.awh code { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; word-break: break-all; }
.awm { display: inline-flex; align-items: center; gap: 6px; font: 700 15px/1.3 Inter, system-ui, sans-serif; padding: 4px 12px; border-radius: 999px; justify-self: start; }
.awm.ok { background: var(--ok-soft); color: var(--ok); } .awm.bad { background: var(--bad-soft); color: var(--bad); }
ul.awc { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
ul.awc li { font-size: 15px; line-height: 1.45; border-left: 3px solid var(--ok); padding-left: 11px; overflow-wrap: anywhere; }
ul.awc li.no { border-left-color: var(--bad); }
.awcards { display: grid; gap: 10px; }
.awrb details.fold > div, .awrb details.fold > p { margin-bottom: 10px; }
.awcard { display: grid; gap: 6px; padding: 12px 14px; border-radius: 14px; background: var(--sunken); min-width: 0; scroll-margin-top: 80px; }
details#controls { scroll-margin-top: 80px; }
.awcard h4 { margin: 0; font-size: 16.5px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.awcard h4 .awm { font-size: 14px; padding: 2px 10px; }
.awcard > small { color: var(--faint); font-size: 13.5px; }
.awrow, .awhead { display: grid; grid-template-columns: 12em minmax(0, 1fr) minmax(0, 1fr); gap: 2px 14px; min-width: 0; }
.awrow { padding: 7px 0 0; border-top: 1px solid var(--border); font-size: 15px; line-height: 1.4; }
.awhead { font-weight: 700; font-size: 14px; color: var(--muted); }
.awrow .k { font-weight: 650; color: var(--muted); font-size: 14.5px; display: flex; align-items: center; gap: 6px; }
.awrow .k.ok { color: var(--ok); } .awrow .k.no { color: var(--bad); }
.awrow span { min-width: 0; } .awrow small { display: block; color: var(--faint); font-size: 13.5px; }
.awrow .lbl { display: none; color: var(--faint); font-size: 13.5px; font-weight: 600; margin-right: 6px; }
@media (max-width: 700px) { .awhead { display: none; } .awrow { grid-template-columns: minmax(0, 1fr); } .awrow .lbl { display: inline; } }`;

/** The hash block's anchor, on /airwallex and on /proof: Proof's Airwallex card links its hash claim here. */
export const AWX_HASH_ID = "awx-hash";
/** The hash block: the hash the CFO signed, the one Airwallex returns, and whether they match (computed). */
export function hashBlockHtml(h: HashTravel | null): string {
  if (!h) return "";
  const by = h.method === "passkey" ? "Face ID" : h.method;
  return `<div class="card" id="${AWX_HASH_ID}"><h3>${icon("file-check", 18)}${esc(HASH_TRAVELS)}</h3>
<div class="awh"><b>${esc(`The CFO signed, with ${by} (${h.proposalId}, ${h.signedAt.slice(11, 16)} UTC)`)}</b><code>${esc(h.signed)}</code></div>
<div class="awh"><b>${esc(`Airwallex returns, in transfer ${h.transferId.slice(0, 8)}…'s metadata.approval_sha256`)}</b><code>${esc(h.carried ?? "none")}</code></div>
${badge(h.match, "Match: the same hash", "No match")}
<p>${esc(`${h.currency} ${h.amount} by ${h.transferMethod}, ${h.transferStatus} at Airwallex.`)}</p>
<p class="src">${esc(`GET /transfers/{id}, read ${day(h.readAt)}, sandbox, test money · ${h.file}`)}</p></div>`;
}

/** One line for all the cards: how many match the CFO policy on every control, counted from the rows. */
export function cardsMatchBadge(rows: CardControlRow[]): string {
  const matched = rows.filter((r) => r.match).length;
  return badge(matched === rows.length, `${countOf(matched, rows.length)} cards match the CFO policy`, `${rows.length - matched} of ${rows.length} cards differ from the CFO policy`);
}

/** /airwallex's fold of the cards, side by side with the CFO policy: Proof links here, and the page opens it on arrival. */
export const AWX_CONTROLS_ID = "controls";
/** One card's own anchor inside that fold: #card-sourcing, #card-treasury, … (the page opens the fold around it). */
export const awxCardId = (agent: string) => `card-${agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;

/** Proof's short version of the card controls: one line per card, all five controls, matched or not. */
export function controlsShortHtml(rows: CardControlRow[], readAt: string, file: string): string {
  if (!rows.length) return "";
  const items = rows.map((r) => {
    const v = (rule: string) => r.checks.find((c) => c.rule === rule)!;
    const line = `${r.name} ····${r.last4}: ${v("Most per purchase").policy} per purchase, ${v("Most per month").policy} a month, ${v("Merchant categories").policy}, ${v("Currency").policy}, until ${v("End date").airwallex}`;
    return `<li class="${r.match ? "" : "no"}">${esc(line)}<br>${badge(r.match, "Airwallex matches the CFO policy", "Airwallex differs from the CFO policy")}</li>`;
  });
  return `<div class="card" id="awx-cards"><h3>${icon("credit-card", 18)}${esc("Card controls Airwallex enforces, written from the CFO policy")}</h3>
<p>${esc("Limit per purchase and per month, merchant categories, currency and end date, as Airwallex returns each agent's card.")}</p>
${cardsMatchBadge(rows)}
<details class="fold"><summary>${esc("Show each card")}</summary><ul class="awc">${items.join("")}</ul></details>
<p class="src">${esc(`GET /issuing/cards, read ${day(readAt)}, sandbox · ${file}`)}</p>
<a class="open" href="airwallex#${AWX_CONTROLS_ID}">${esc("Policy and card side by side")} ${icon("arrow-right", 14)}</a></div>`;
}

/** /airwallex's version: one line for all the cards, then (folded) per card each CFO policy rule beside the control Airwallex returns. */
export function controlsSideBySideHtml(rows: CardControlRow[], readAt: string, file: string): string {
  if (!rows.length) return "";
  const cardHtml = (r: CardControlRow) => `<div class="awcard" id="${awxCardId(r.agent)}"><h4>${icon("credit-card", 18)}${esc(`${r.name} ····${r.last4}`)}${badge(r.match, "matches", "differs")}</h4>
<div class="awhead"><span>${esc("Rule")}</span><span>${esc("CFO policy")}</span><span>${esc("Airwallex card control")}</span></div>
${r.checks.map((c) => `<div class="awrow"><span class="k ${c.ok ? "ok" : "no"}">${icon(c.ok ? "check" : "octagon-x", 14)}${esc(c.rule)}</span><span><b class="lbl">${esc("CFO policy")}</b>${esc(c.policy)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</span><span><b class="lbl">${esc("Airwallex")}</b>${esc(c.airwallex)}</span></div>`).join("")}
<small>${esc(`Card id …${r.idTail} · ${r.status} · created by "${r.createdBy}"`)}</small></div>`;
  // Max, 6 Nov: one line on the page; each card's side by side in a collapsed fold, as Proof folds its lists. The fold is
  // #controls and each card #card-<agent>: a link to either opens the fold (OPEN_TARGET_JS, src/redesign/ui.ts).
  return `<div class="card">${cardsMatchBadge(rows)}
<details class="fold" id="${AWX_CONTROLS_ID}"><summary>${esc("Show each card: the CFO policy beside the Airwallex card control")}</summary>
<p>${esc("Purser writes each card's controls from the CFO policy; Airwallex declines anything outside them, whatever the agent does.")}</p>
<div class="awcards">${rows.map(cardHtml).join("")}</div>
<p class="src">${esc(`GET /issuing/cards, then each card, read ${day(readAt)}, sandbox · ${file} · no card number beyond its last four digits`)}</p></details></div>`;
}
