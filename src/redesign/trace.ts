// /trace (Max's last round, 1.2): pick any payment of the main run (3 Nov) and see its chain, step by step: the policy,
// the agent's decision, the limit that held it or the proposal, the signature, the executor's hash check, the rail id,
// the booking line and the audit row. Nothing is typed in by hand. The run comes from its record (loadRecord(),
// docs/demo/main-run.json) and the record's own counts (payments()); what the record keeps only per group (each sale's
// and purchase's own tx, the journal, the chain's row hashes) comes from the companion record built from the same
// ledger (src/demo/runTrace.ts, docs/demo/main-run-trace.json), which the tests hold to the record. The books are the
// existing double entry (src/accounting/books.ts) over the companion's journal; the chain's linkage is checked with
// checkChainLinks (src/audit/log.ts). A step a payment does not have says so and why; no step is made up.
//
// A page with no script: the picker is a list of links (#<payment id>), and the chosen payment's chain is shown by CSS
// (:target); with none chosen, the SWIFT transfer's is. The URL is /trace; /trace#<payment id> opens one payment.

import { readFileSync } from "node:fs";
import { doubleEntry, type Posting } from "../accounting/books.js";
import { checkChainLinks } from "../audit/log.js";
import { AGENT_DISPLAY, CFO_VIEW_LINK, CFO_VIEW_URL, SANDBOX_SETTLED } from "../config/brand.js";
import type { LedgerRow } from "../demo/runLedger.js";
import { RECORD_UNCHANGED, TRACE_FILE, type PaymentKind, type RunTrace, type TraceMandate, type TracePayment } from "../demo/runTrace.js";
import { fromCents } from "../lib/money.js";
import { EXPLORER_TX } from "../metal/network.js";
import { family, loadRecord, type RunRecord } from "./run.js";
import { esc, page } from "./ui.js";

export const TRACE_URL = "trace";
export const TRACE_LINK = "Trace any payment";

export function loadTrace(): RunTrace {
  return JSON.parse(readFileSync(new URL(`../../${TRACE_FILE}`, import.meta.url), "utf8")) as RunTrace;
}

export type StepKey = "policy" | "decision" | "limit" | "signature" | "execution" | "rail" | "booking" | "audit";
export const STEP_TITLES: Record<StepKey, string> = {
  policy: "The policy", decision: "The decision", limit: "Inside the limit, or a proposal", signature: "The signature",
  execution: "The executor's hash check", rail: "The rail", booking: "The booking", audit: "The audit row",
};
/** One step of a payment's chain: shown from the record, or "none" with the reason this payment has no such step. */
export interface Step { key: StepKey; status: "shown" | "none"; text: string; ids: { label: string; value: string; href?: string }[] }
export interface Chain { payment: TracePayment; title: string; short: string; steps: Step[] }

/** The count, said one way (Max, 6 Nov): 88 = 86 on Metal + 1 card charge + 1 SWIFT transfer. */
export interface Count { n: number; metal: number; cards: number; transfers: number; sales: number; purchases: number; refunds: number; sweeps: number; line: string; metalParts: string }
const pl = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
export function countOf(t: RunTrace): Count {
  const k = (kind: PaymentKind) => t.payments.filter((p) => p.kind === kind).length;
  const [sales, purchases, refunds, sweeps, cards, transfers] = [k("sale"), k("purchase"), k("refund"), k("sweep"), k("card"), k("transfer")];
  const metal = sales + purchases + refunds + sweeps;
  return {
    n: t.payments.length, metal, cards, transfers, sales, purchases, refunds, sweeps,
    line: `${t.payments.length} = ${metal} on Metal + ${pl(cards, "card charge")} + ${pl(transfers, "SWIFT transfer")}`,
    metalParts: `${pl(sales, "sale")} + ${pl(purchases, "supplier purchase")} + ${pl(refunds, "refund")} + ${pl(sweeps, "sweep")}`,
  };
}
export const headerLine = (c: Count) => `Pick any of the ${c.n} payments (${c.metal} on Metal + ${pl(c.cards, "card charge")} + ${pl(c.transfers, "SWIFT transfer")}).`;
export const HEADER_SECOND = "Every step is shown; the audit rows themselves are summarised, not published.";

/** What the published hashes prove, and what they do not (Max, 6 Nov). */
export function chainLines(t: RunTrace): { check: ReturnType<typeof checkChainLinks>; proves: string; doesNot: string } {
  const check = checkChainLinks(t.audit.links);
  return {
    check,
    proves: `The chain's length and head are recorded: ${t.audit.rows} rows, head ${t.audit.head.slice(0, 8)}…, intact when checked against the ledger on 3 Nov. Each row's prev_hash is the row before's row_hash, from the genesis to that head${check.ok && check.head === t.audit.head && check.rows === t.audit.rows ? " (checked when this page was built)" : " (THIS CHECK FAILED)"}.`,
    doesNot: "The rows themselves contain credentials and are not published, so no row_hash can be recomputed from public files: the linkage and the head are checkable, each row's content is not.",
  };
}

const hms = (iso: string) => iso.slice(11, 19);
const unitOf = (currency: string) => (currency === "USDZ" ? "test USD" : currency);
const amountOf = (p: TracePayment) => (p.currency === "USDZ" ? `${p.amount} test USD` : `${p.currency} ${p.amount}`);
const agentName = (id: string) => (id in AGENT_DISPLAY ? AGENT_DISPLAY[id as keyof typeof AGENT_DISPLAY].name : id);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const KIND_WORD: Record<PaymentKind, string> = { sale: "Sale", purchase: "Supplier purchase", refund: "Refund", sweep: "Sweep", card: "Card charge", transfer: "SWIFT transfer" };

/** Each payment's chain, from the record and its companion. */
export function chains(r: RunRecord, t: RunTrace): Chain[] {
  const ev: LedgerRow[] = r.ledger?.events ?? [];
  const props = r.ledger?.proposals ?? [];
  const row = (event: string, subject: string) => ev.find((e) => e.event === event && e.subject === subject);
  const postings = doubleEntry(t.journal);
  const links = new Map(t.audit.links.map((l) => [l.seq, l]));
  const sourceOf: Record<PaymentKind, string> = { sale: "sale", purchase: "upstream", refund: "refund", sweep: "sweep", card: "card", transfer: "transfer" };
  const agents = (r.snapshot as unknown as { agents: { id: string; asks: string[]; card: { merchants: string[] }; settings: { key: string; value: string }[] }[] }).agents;
  const settings = new Map(agents.flatMap((a) => a.settings.map((s) => [s.key, s.value] as const)));
  const asks = (id: string) => agents.find((a) => a.id === id)?.asks ?? [];
  const approvedOf = (proposal: string) => row("proposal.approved", proposal);

  return t.payments.map((p): Chain => {
    const m: TraceMandate | undefined = t.mandates.find((x) => x.seq === p.mandate_seq);
    const o = (p.origin ?? {}) as Record<string, unknown>;
    const setBy = (o.set_by ?? null) as Record<string, unknown> | null;
    const steps: Step[] = [];
    const add = (key: StepKey, status: Step["status"], text: string, ids: Step["ids"] = []) => steps.push({ key, status, text, ids });
    const tx = (h: string) => ({ label: "tx", value: h, href: `${EXPLORER_TX}${h}` });

    // 1. The policy.
    if (p.kind === "card") {
      const synced = ev.filter((e) => e.event === "card.limits_synced" && e.subject === str(o.agent) && e.ts <= p.at).pop();
      const [perTx, monthly] = String(synced?.payload.to ?? "").split(" / ");
      const card = agents.find((a) => a.id === str(o.agent))?.card;
      add("policy", "shown", `The ${agentName(str(o.agent))}'s card at Airwallex: up to EUR ${perTx} a purchase and EUR ${monthly} a month, ${(card?.merchants ?? []).join(", ")} only.`, synced ? [{ label: "limits synced at", value: `${hms(synced.ts)} UTC (seq ${synced.seq})` }] : []);
    } else if (p.kind === "transfer") {
      const fourEyes = props.find((x) => x.kind === "policy_change" && JSON.stringify(x.terms).includes("approval.four_eyes_eur"));
      add("policy", "shown", `The Treasury agent cannot pay an invoice alone. Its policy sends these to the CFO: ${asks("treasury").filter((a) => /invoice|two people/i.test(a)).map((a) => a.replace(/^./, (ch) => ch.toLowerCase())).join("; ")}.`, fourEyes ? [{ label: "four-eyes rule set by", value: fourEyes.proposal_id }] : []);
    } else if (m) {
      const whose = m.agent === "customer" ? "The simulated customer's" : `The ${agentName(m.agent)}'s`;
      const extra = p.kind === "refund" ? ` The CFO's refund policy: up to ${settings.get("approval.refund_each")} test USD each and ${settings.get("approval.refund_per_dispute")} per dispute without a signature.` : "";
      add("policy", "shown", `${whose} mandate on Metal: up to ${m.cap} test USD a payment, ${m.budget} in total, ${m.event === "mandate.replaced" ? `replaced at ${hms(m.ts)} UTC by ${m.proposal_id}` : `bound at ${hms(m.ts)} UTC`}.${extra}`, [tx(m.tx), ...(m.mandate_hash ? [{ label: "mandate hash", value: m.mandate_hash }] : [])]);
    } else {
      add("policy", "none", "The record names no mandate for this payment.");
    }

    // 2. The decision: who decided, as the payment's own audit row recorded it.
    const actor = str(o.actor);
    if (actor === "agent") {
      add("decision", "shown", `The ${agentName(str(o.agent))} decided, with Claude ${family(str(o.model))}.`, [{ label: "agent", value: str(o.agent) }, { label: "model", value: str(o.model) }, { label: "request id", value: str(o.request_id) }]);
    } else if (actor === "code" && setBy) {
      add("decision", "shown", `Applied by code under ${str(o.rule)}, which the ${agentName(str(setBy.agent))} set with Claude ${family(str(setBy.model))}. No Claude call for this payment itself.`, [{ label: "agent", value: str(setBy.agent) }, { label: "model", value: str(setBy.model) }, { label: "request id", value: str(setBy.request_id) }]);
    } else if (actor === "code") {
      add("decision", "shown", `Applied by code under ${str(o.rule)}. No Claude call behind this payment: no model or request id.`, [{ label: "agent", value: str(o.agent) }]);
    } else if (actor === "external") {
      add("decision", "shown", "The simulated customer's agent bought a stock check and paid for it. Not one of our agents: no model or request id of ours.", [{ label: "payer", value: "the simulated customer" }]);
    } else if (actor === "cfo" && p.proposal_id) {
      const created = row("proposal.created", p.proposal_id);
      const by = (created?.payload.origin ?? {}) as Record<string, unknown>;
      add("decision", "shown", `The ${agentName(str(by.agent))} planned it with Claude ${family(str(by.model))} and proposed it to the CFO as ${p.proposal_id}.`, [{ label: "agent", value: str(by.agent) }, { label: "model", value: str(by.model) }, { label: "request id", value: str(by.request_id) }]);
    } else {
      add("decision", "none", "The payment's audit row names no one who decided it.");
    }

    // 3. Inside the limit (which lock held it), or a proposal.
    if (p.kind === "transfer" && p.proposal_id) {
      const created = row("proposal.created", p.proposal_id);
      add("limit", "shown", `A proposal, not a payment inside a limit: ${p.proposal_id} (${String(created?.payload.kind ?? "").replace(/_/g, " ")}), created at ${hms(created?.ts ?? "")} UTC.`, [{ label: "proposal", value: p.proposal_id }, { label: "terms hash", value: str(created?.payload.terms_sha256) }]);
    } else if (p.kind === "card") {
      const synced = ev.filter((e) => e.event === "card.limits_synced" && e.subject === str(o.agent) && e.ts <= p.at).pop();
      const perTx = String(synced?.payload.to ?? "").split(" / ")[0] ?? "";
      add("limit", "shown", `Inside the limit: EUR ${p.amount} against EUR ${perTx} a purchase. Held by Airwallex's card controls.`, [{ label: "lock", value: "Airwallex's card controls" }]);
    } else if (m) {
      add("limit", "shown", `Inside the limit: ${p.amount} against ${m.cap} test USD a payment. Held by ${m.agent === "customer" ? "the customer's own mandate on Metal (its lock, not ours)" : "Metal's mandate on chain; Purser's code checks the same limit before signing"}.`, [{ label: "lock", value: m.agent === "customer" ? "the customer's mandate on Metal" : "Metal's mandate on chain" }]);
    } else {
      add("limit", "none", "The record names no limit for this payment.");
    }

    // 4. The signature.
    const approved = p.proposal_id ? approvedOf(p.proposal_id) : undefined;
    if (approved) {
      add("signature", "shown", `${str(approved.payload.approver) === "max" ? "The CFO" : str(approved.payload.approver)} signed it with Face ID (passkey) at ${hms(approved.ts)} UTC, over the terms hash.`, [{ label: "signed by", value: str(approved.payload.approver) }, { label: "at", value: approved.ts }, { label: "terms hash", value: str(approved.payload.terms_sha256) }]);
    } else if (p.kind === "card") {
      const raise = ev.filter((e) => e.event === "proposal.executed" && e.ts <= p.at && props.find((x) => x.proposal_id === e.subject)?.kind === "policy_change" && JSON.stringify(props.find((x) => x.proposal_id === e.subject)?.terms).includes(`card.${str(o.agent)}.per_tx`)).pop();
      const by = raise ? approvedOf(raise.subject ?? "") : undefined;
      add("signature", "none", `No signature for this charge: it was inside the card's limit, and a payment inside its limit is signed by no one.${raise && by ? ` The limit itself was raised by ${raise.subject}, which the CFO signed with Face ID at ${hms(by.ts)} UTC.` : ""}`);
    } else if (p.kind === "sale") {
      add("signature", "none", "No signature of ours: the customer's agent paid under its own mandate.");
    } else {
      const signedBy = m?.proposal_id ? approvedOf(m.proposal_id) : undefined;
      add("signature", "none", `No signature for this payment: an agent paying inside its own mandate signs nothing with the CFO.${signedBy ? ` The mandate itself was signed: ${m!.proposal_id}, by ${str(signedBy.payload.approver)} at ${hms(signedBy.ts)} UTC.` : ""}`);
    }

    // 5. The executor re-checks the hash: every executor row of the payment carries the signed terms' hash.
    if (p.approval_sha256) {
      const rows = ev.filter((e) => str(e.payload.approval_sha256) && (e.subject === p.rail_id || str((e.payload.origin as Record<string, unknown> | undefined)?.proposal_id) === p.proposal_id));
      const signed = approved ? str(approved.payload.terms_sha256) : "";
      const all = rows.length > 0 && rows.every((e) => e.payload.approval_sha256 === signed) && p.approval_sha256 === signed;
      add("execution", all ? "shown" : "none", all
        ? `The Airwallex executor ran it only with the signed hash: ${rows.map((e) => `${e.event} (seq ${e.seq})`).join(", ")} each carry the same hash as the signed terms.`
        : "The executor's rows do not carry the signed hash.", [{ label: "approval_sha256", value: p.approval_sha256 }]);
    } else {
      add("execution", "none", "No hash to re-check: nothing was signed for this payment.");
    }

    // 6. The rail.
    if (p.rail === "metal") add("rail", "shown", "Paid on Metal testnet; the transaction is public.", [tx(p.rail_id)]);
    else if (p.rail === "airwallex_card") add("rail", "shown", "Approved by Airwallex on the agent's card (sandbox). No approval hash: nothing was signed for it.", [{ label: "Airwallex id", value: p.rail_id }]);
    else add("rail", "shown", `Sent by SWIFT through Airwallex, the approval hash in the transfer's metadata; PAID ${SANDBOX_SETTLED}.`, [{ label: "Airwallex id", value: p.rail_id }, { label: "approval_sha256", value: p.approval_sha256 ?? "" }]);

    // 7. The booking: the GL journal's lines for this payment, as the books post them (double entry).
    const lines = t.journal.filter((l) => l.source === sourceOf[p.kind] && l.proof === p.rail_id);
    const booked: Posting[] = postings.filter((x) => lines.some((l) => l.ref === x.ref && l.description === x.description && l.date === x.date && l.proof === x.proof));
    add("booking", booked.length ? "shown" : "none", booked.length
      ? booked.map((x) => `${x.entry} ${x.debit_cents ? "debit" : "credit"} ${x.account} ${x.account_name}: ${fromCents(x.debit_cents || x.credit_cents)} ${unitOf(x.currency)}`).join("; ")
      : "No journal line names this payment.", [...new Set(booked.map((x) => x.entry))].map((e) => ({ label: "entry", value: e })));

    // 8. The audit row.
    const link = links.get(p.audit.seq);
    add("audit", link ? "shown" : "none", link ? `Row ${p.audit.seq} (${p.audit.event}) of ${t.audit.rows} in the hash chain. Its content is summarised above, not published.` : "The chain has no such row.", link ? [{ label: "row_hash", value: link.row_hash }, { label: "prev_hash", value: link.prev_hash }] : []);

    const title = `${KIND_WORD[p.kind]} ${p.kind === "sale" || p.kind === "purchase" ? `#${p.ref} ` : ""}· ${amountOf(p)} · ${hms(p.at)} UTC`;
    return { payment: p, title, short: p.kind === "sale" || p.kind === "purchase" ? p.ref : p.kind === "refund" ? `#${p.ref}` : hms(p.at).slice(0, 5), steps };
  });
}

const CSS = `.tracep { padding-top: 26px; padding-bottom: 40px; }
.tracep h1 { font-size: clamp(28px, 3.2vw, 40px); font-weight: 780; margin: 0 0 8px; }
.tracep .lead2 { font-size: 18px; font-weight: 650; margin: 0 0 4px; max-width: 46em; }
.tracep .sub { color: var(--muted); margin: 0 0 6px; font-size: 15.5px; max-width: 52em; }
.tracep .label { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
.picker { display: grid; gap: 12px; margin: 0 0 22px; }
.picker h2 { font-size: 15.5px; font-weight: 700; margin: 0 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips a { font: 600 14px/1 Inter, system-ui, sans-serif; padding: 9px 10px; min-width: 40px; text-align: center; border-radius: 10px; background: var(--sunken); color: var(--text); text-decoration: none; border: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.chips a:hover, .chips a:focus-visible { border-color: var(--accent); color: var(--accent); }
.pay { display: none; padding: 18px 20px; scroll-margin-top: 80px; }
.pay:target, .pays:not(:has(.pay:target)) .pay.first { display: block; }
.pay h2 { font-size: 20px; margin: 0 0 12px; overflow-wrap: anywhere; }
ol.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
ol.steps li { border-left: 3px solid var(--ok); padding: 2px 0 2px 12px; }
ol.steps li.none { border-left-color: var(--border); }
ol.steps b { display: block; font-size: 15.5px; }
ol.steps b small { font-weight: 600; color: var(--muted); font-size: 13.5px; margin-left: 6px; }
ol.steps p { margin: 2px 0 0; font-size: 15.5px; line-height: 1.45; }
ol.steps dl { margin: 4px 0 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 10px; font-size: 14px; }
ol.steps dt { color: var(--muted); }
ol.steps dd { margin: 0; font: 600 13.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
ol.steps dd a { color: var(--accent); }
.chainnote { margin: 22px 0 0; padding: 14px 18px; font-size: 15px; display: grid; gap: 6px; }
.chainnote p { margin: 0; }
.backl { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 18px; }
.backl a { color: var(--accent); font-weight: 650; text-decoration: none; }`;

const GROUPS: [PaymentKind, string][] = [["transfer", "SWIFT transfer"], ["card", "Card charge"], ["sweep", "Sweep"], ["refund", "Refunds (by sale)"], ["purchase", "Supplier purchases (by query)"], ["sale", "Sales (by sale)"]];

export function tracePage(r: RunRecord = loadRecord().record, t: RunTrace = loadTrace()): string {
  const c = countOf(t), all = chains(r, t), chain = chainLines(t);
  const first = all.find((x) => x.payment.kind === "transfer") ?? all[0]!;
  const picker = GROUPS.map(([kind, label]) => {
    const mine = all.filter((x) => x.payment.kind === kind);
    if (!mine.length) return "";
    return `<div><h2>${esc(label)} · ${mine.length}</h2><div class="chips">${mine.map((x) => `<a href="#${esc(x.payment.id)}" aria-label="${esc(x.title)}">${esc(x.short)}</a>`).join("")}</div></div>`;
  }).join("\n");
  const section = (x: Chain) => `<section class="card pay${x === first ? " first" : ""}" id="${esc(x.payment.id)}" aria-label="${esc(x.title)}"><h2>${esc(x.title)}</h2><ol class="steps">
${x.steps.map((s) => `<li class="${s.status}"><b>${esc(STEP_TITLES[s.key])}${s.status === "none" ? "<small>not a step for this payment</small>" : ""}</b><p>${esc(s.text)}</p>${s.ids.length ? `<dl>${s.ids.map((i) => `<dt>${esc(i.label)}</dt><dd>${i.href ? `<a href="${esc(i.href)}" rel="noopener" target="_blank">${esc(i.value)}</a>` : esc(i.value)}</dd>`).join("")}</dl>` : ""}</li>`).join("\n")}
</ol></section>`;
  const body = `<main class="wrap tracep">
<h1>Trace any payment</h1>
<p class="lead2">${esc(headerLine(c))} ${esc(HEADER_SECOND)}</p>
<p class="sub">From the main run of 3 November, test money. On Metal: ${esc(c.metalParts)}.</p>
<p class="label">${esc(t.label)} ${esc(RECORD_UNCHANGED)}</p>
<nav class="picker" aria-label="Pick a payment">
${picker}
</nav>
<div class="pays">
${all.map(section).join("\n")}
</div>
<div class="card chainnote"><p>${esc(chain.proves)}</p><p>${esc(chain.doesNot)}</p></div>
<p class="backl"><a href="${esc(CFO_VIEW_URL)}">${esc(CFO_VIEW_LINK)}</a><a href="proof">Proof</a></p>
</main>`;
  return page({
    title: "Trace any payment · Purser", description: `${headerLine(c)} Each step of the main run's payments, from the record.`, tab: null, css: CSS, body,
    source: `Source: ${TRACE_FILE} (${t.label}) and docs/demo/main-run.json.`,
  });
}
