// The vic-3 live run of 12 November (docs/runs/2026-11-12-vic-3.json), at the top of /visa and in /runs. Every number,
// code and id here is read from that record or counted from it; nothing is typed in. The Sourcing agent (Claude Haiku)
// chose the Airi rail from three; the CFO-signed terms hash was read back from Airi's mandate and from Airwallex's
// PaymentIntent record; Purser refused C, D and E before any outside call; F1 and F2 tested whether the Airi/Airwallex
// sandbox refuses a credential used for another order, and the record keeps what it answered.

import { existsSync, readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const VIC3_RUN_FILE = "docs/runs/2026-11-12-vic-3.json";
export const VIC3_RUN_LOG = "docs/runs/2026-11-12-vic-3.md";
export const VIC3_RUN_ID = "vic3-run";
export const VIC3_PURCHASES_ID = "vic3-purchases";

type Outcome = { status?: string | null; code?: string | null; outcome?: string | null; by?: string | null; refusal?: string | null };
export interface Vic3Purchase {
  step: string;
  request: { amount: string; currency: string; merchant: string } | null;
  rail_choice: { by: string; model: string | null; request_id: string | null; menu: { rail: string }[]; chosen: string | null } | null;
  proposal_id: string | null;
  mandate_id: string | null;
  payment_intent_id: string | null;
  read_back: { mandate: { equal: boolean; before_credential: boolean } | null; payment_intent: { equal: boolean } | null };
  outcome: Outcome | null;
  calls: { anthropic: number; airwallex: number; airi: number };
  negative_test?: { airwallex: { outcome?: string; code?: string } | null; finding: string };
}
export interface Vic3Record { run: string; mode: string; label: string; started_at: string; ended_at: string; purchases: Vic3Purchase[]; checks: Record<string, { ok: boolean; detail: string }> }

/** The live record, or null when there is none on this build (a dry or stand-in record is never shown as live). */
export function vic3Run(file = VIC3_RUN_FILE): Vic3Record | null {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return null;
  const rec = JSON.parse(readFileSync(url, "utf8")) as Vic3Record;
  return rec.mode === "live" ? rec : null;
}

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** The purchases proper (A to E): F1 and F2 are the negative test, not purchases. */
const purchasesOf = (r: Vic3Record) => r.purchases.filter((p) => !p.negative_test && !/^F/.test(p.step));
const paidOf = (r: Vic3Record) => purchasesOf(r).filter((p) => p.outcome?.status === "succeeded");
const zeroCalls = (p: Vic3Purchase) => p.calls.airi === 0 && p.calls.airwallex === 0 && p.calls.anthropic === 0;
/** Purser's code, or for the executor's hash check (which has none) its own words from the record. */
const codeOf = (p: Vic3Purchase) => p.outcome?.code ?? (p.outcome?.refusal ? p.outcome.refusal.replace(/^[^:]*:\s*/, "") : null);

/** The finding of the negative test, word for word from one of two templates, from the sandbox's answers. */
export function vic3Finding(r: Vic3Record): string {
  const fs = r.purchases.filter((p) => p.negative_test);
  const what = `${fs.map((p) => p.step).join(", ")}, a credential reused for another amount`;
  const refused = fs.map((p) => p.negative_test!.airwallex).filter((a) => a && a.outcome && a.outcome !== "SUCCEEDED");
  if (refused.length) return `${what}: the Airi/Airwallex sandbox refused it: ${refused.map((a) => a!.code ?? a!.outcome).join(", ")}.`;
  return `${what}: the Airi/Airwallex sandbox did not refuse it; here only Purser enforces the amount.`;
}

/** What the record says, counted: the paid purchases, the refusals with their codes and calls, who chose the rail. */
export function vic3Summary(r: Vic3Record) {
  const all = purchasesOf(r), paid = paidOf(r);
  const chosen = r.purchases.filter((p) => p.rail_choice?.chosen);
  const first = chosen[0]?.rail_choice ?? null;
  const refused = all.filter((p) => p.outcome?.status === "refused");
  const byPurser = refused.filter((p) => zeroCalls(p));
  const other = refused.filter((p) => !zeroCalls(p));
  return {
    date: day(r.started_at), paid: paid.length, of: all.length, paidSteps: paid, byPurser, other,
    model: first?.model ?? null, menu: first?.menu.length ?? 0, chosenBy: first?.by ?? null, requestId: first?.request_id ?? null,
    chosenCount: chosen.filter((p) => p.rail_choice!.by === "claude").length,
    finding: vic3Finding(r),
  };
}

const outcomeText = (p: Vic3Purchase) => {
  if (p.negative_test) return `the sandbox answered ${p.negative_test.airwallex?.outcome ?? "nothing"}`;
  const o = p.outcome ?? {};
  return o.status === "succeeded" ? `paid (${o.code ?? "SUCCEEDED"})` : `${o.status ?? "not run"}${codeOf(p) ? `, ${codeOf(p)}` : ""}`;
};
const eq = (x: { equal: boolean } | null | undefined) => (x ? (x.equal ? "equal" : "NOT equal") : "—");

/** The block at the top of /visa: the run in four lines, every purchase with its ids in one fold. */
export function vic3RunHtml(r: Vic3Record | null = vic3Run(), o: { first?: string } = {}): string {
  if (!r) return "";
  const s = vic3Summary(r);
  const short = (id: string) => (id.length > 18 ? `${id.slice(0, 16)}…` : id);
  const paidLine = s.paidSteps.map((p) => `${p.step} paid ${p.request?.currency} ${p.request?.amount}${p.proposal_id ? " after the CFO's Face ID" : ""}; the signed hash read back ${eq(p.read_back.mandate)} from Airi and ${eq(p.read_back.payment_intent)} from Airwallex`).join(". ");
  const refusedLine = [s.byPurser.length ? `${s.byPurser.map((p) => p.step).join(", ")} refused by Purser with 0 calls` : "", ...s.other.map((p) => `${p.step}: ${codeOf(p) === "PURSER_NO_TAP" ? "no tap in time" : "refused"}`)].filter(Boolean).join("; ");
  const rows = r.purchases.map((p) => `<li><b>${esc(p.step)}</b> · ${esc(p.request ? `${p.request.currency} ${p.request.amount}` : "")} · ${esc(outcomeText(p))}${p.rail_choice?.request_id ? ` · ${esc(`rail chosen by ${p.rail_choice.by}, request ${p.rail_choice.request_id}`)}` : ""}${p.mandate_id ? ` · ${esc(`mandate ${p.mandate_id}`)}` : ""}${p.payment_intent_id ? ` · ${esc(`PaymentIntent ${p.payment_intent_id}`)}` : ""}${p.read_back.mandate ? ` · ${esc(`mandate read-back ${eq(p.read_back.mandate)}`)}` : ""}${p.read_back.payment_intent ? ` · ${esc(`PaymentIntent read-back ${eq(p.read_back.payment_intent)}`)}` : ""} · ${esc(`calls: Anthropic ${p.calls.anthropic}, Airwallex ${p.calls.airwallex}, Airi ${p.calls.airi}`)}</li>`).join("");
  const record = `${REPO_BLOB}${VIC3_RUN_FILE}`;
  return `<div class="card airi" id="${VIC3_RUN_ID}"><h2>${esc(`Latest live run, ${s.date}: ${s.paid} of ${s.of} purchases paid`)}</h2>
<p class="airi-label">${esc(`Rail chosen by ${s.model ?? "Claude"} from ${s.menu}`)}${s.requestId ? ` · <a class="pf" href="${esc(record)}" target="_blank" rel="noopener">${esc(`request ${short(s.requestId)}`)} ↗</a>` : ""}</p>
<ul class="airi-out"><li>${esc(`${paidLine}.`)}</li>${refusedLine ? `<li>${esc(`${refusedLine}.`)}</li>` : ""}<li>${esc(s.finding)}</li></ul>
<details class="fold" id="${VIC3_PURCHASES_ID}"><summary>${esc("Each purchase, with its ids")}</summary><ul class="awc">${rows}</ul>
<p class="src">${esc(`Source: ${VIC3_RUN_FILE}. ${r.label}.`)} · <a class="pf" href="${esc(`${REPO_BLOB}${VIC3_RUN_LOG}`)}" target="_blank" rel="noopener">${esc("run log")} ↗</a></p></details>
${o.first ? `<p class="src">${esc(`The first live run, ${o.first}, follows below.`)}</p>` : ""}</div>`;
}
