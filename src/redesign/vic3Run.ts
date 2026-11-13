// The vic-3 live run of 12 November (docs/runs/2026-11-12-vic-3.json), at the top of /visa and in /runs. Every number,
// code and id here is read from that record or counted from it; nothing is typed in. The Sourcing agent (Claude Haiku)
// chose the Airi rail from three; the CFO-signed terms hash was read back from Airi's mandate and from Airwallex's
// PaymentIntent record; Purser refused C, D and E before any outside call; F1 and F2 tested whether the Airi/Airwallex
// sandbox refuses a credential used for another order, and the record keeps what it answered.

import type { SummaryCard } from "./summary.js";
import { existsSync, readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { statsHtml, type Stat } from "./stats.js";
import { esc } from "./ui.js";

/** The latest live Visa run (vic-4, 13 Nov): what /visa, /proof and Home show. vic-3 (12 Nov) stays on /runs. */
export const VIC3_RUN_FILE = "docs/runs/2026-11-13-vic-4.json";
export const VIC3_RUN_LOG = "docs/runs/2026-11-13-vic-4.md";
/** The run before it (vic-3, 12 Nov). */
export const VIC3_PREV_FILE = "docs/runs/2026-11-12-vic-3.json";
export const VIC3_PREV_LOG = "docs/runs/2026-11-12-vic-3.md";
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

/** Purser's refusals with 0 outside calls, F steps included when Purser's credential check refused them (vic-4). */
const purserRefused = (r: Vic3Record) => r.purchases.filter((p) => !p.negative_test && p.outcome?.status === "refused" && zeroCalls(p));
/** vic-4's F1/F2: the credential misuse refused by Purser's credential check (no negative_test: the sandbox was not asked). */
const credentialRefusals = (r: Vic3Record) => r.purchases.filter((p) => /^F/.test(p.step) && !p.negative_test && /^PURSER_CREDENTIAL_/.test(p.outcome?.code ?? ""));

/** The finding of the negative test, word for word from one of three templates, from the record. */
export function vic3Finding(r: Vic3Record): string {
  const cr = credentialRefusals(r);
  if (cr.length) return `We also tried reusing a credential, for a different amount and a second time (${cr.map((p) => p.step).join(", ")}). Purser's credential check refused ${cr.length === 2 ? "both" : "it"}, with 0 calls to Airi or Airwallex.`;
  const fs = r.purchases.filter((p) => p.negative_test);
  const steps = fs.map((p) => p.step).join(", ");
  const refused = fs.map((p) => p.negative_test!.airwallex).filter((a) => a && a.outcome && a.outcome !== "SUCCEEDED");
  const tried = `We also tried reusing a credential, for a different amount and a second time (${steps}).`;
  if (refused.length) return `${tried} The sandbox refused it: ${refused.map((a) => a!.code ?? a!.outcome).join(", ")}.`;
  return `${tried} The sandbox accepted ${fs.length === 2 ? "both" : "it"}, so in this test only Purser's check stops it.`;
}

/** What the record says, counted: the paid purchases, the refusals with their codes and calls, who chose the rail. */
export function vic3Summary(r: Vic3Record) {
  const all = purchasesOf(r), paid = paidOf(r);
  const chosen = r.purchases.filter((p) => p.rail_choice?.chosen);
  const first = chosen[0]?.rail_choice ?? null;
  const refused = all.filter((p) => p.outcome?.status === "refused");
  const byPurser = purserRefused(r);
  const other = refused.filter((p) => !zeroCalls(p));
  // Paid after the CFO's Face ID (a proposal) first: its hash is the one read back at Airi and Airwallex.
  const faceId = paid.filter((p) => p.proposal_id), alone = paid.filter((p) => !p.proposal_id);
  return {
    date: day(r.started_at), paid: paid.length, of: all.length, paidSteps: [...faceId, ...alone], paidFaceId: faceId, paidAlone: alone, byPurser, other,
    credentialRefused: credentialRefusals(r),
    model: first?.model ?? null, menu: first?.menu.length ?? 0, chosenBy: first?.by ?? null, requestId: first?.request_id ?? null,
    chosenCount: chosen.filter((p) => p.rail_choice!.by === "claude").length,
    finding: vic3Finding(r),
  };
}

/** The run in one line, as it ended for each purchase: "1 paid after Face ID, 3 refused by Purser, 1 not tapped: nothing charged". */
export function vic3Lead(r: Vic3Record): string {
  const s = vic3Summary(r);
  const noTap = s.other.filter((p) => codeOf(p) === "PURSER_NO_TAP").length;
  const otherRefused = s.other.length - noTap;
  const paid = s.paidAlone.length ? `${s.paid} paid (${s.paidFaceId.length} after Face ID)` : `${s.paid} paid after Face ID`;
  return [paid, ...(s.byPurser.length ? [`${s.byPurser.length} refused by Purser${s.credentialRefused.length ? " incl. reused credentials" : ""}`] : []), ...(otherRefused ? [`${otherRefused} refused at the network`] : []), ...(noTap ? [`${noTap} not tapped: nothing charged`] : [])].join(", ");
}

/**
 * The four cards at the top of /visa (jury pass, 13 Nov), from the record: the purchase paid after Face ID, those
 * Purser refused before any call, the one not tapped in Airi, and the signed hash read back at Airi and Airwallex.
 */
export function visaSummary(r: Vic3Record): SummaryCard[] {
  const s = vic3Summary(r), lead = s.paidSteps[0];
  const noTap = s.other.filter((p) => codeOf(p) === "PURSER_NO_TAP");
  const equal = lead ? [lead.read_back.mandate, lead.read_back.payment_intent].filter((x) => x?.equal).length : 0;
  return [
    ...(lead?.request ? [{ icon: "scan-face", fig: String(s.paidFaceId.length), title: "Paid after Face ID", tone: "ok" as const, rec: VIC3_RUN_FILE, href: `#${VIC3_RUN_ID}`, text: `Purchase ${lead.step}, ${lead.request.currency} ${lead.request.amount}, above the CFO's limit: paid only after the CFO's Face ID.` }] : []),
    ...(s.paidAlone.length ? [{ icon: "credit-card", fig: String(s.paidAlone.length), title: "Paid within the limit", tone: "ok" as const, rec: VIC3_RUN_FILE, href: `#${VIC3_PURCHASES_ID}`, text: `${s.paidAlone.map((p) => `${p.step}, ${p.request?.currency} ${p.request?.amount}`).join("; ")}: within the CFO's limit, the agent alone; one tap in Airi.` }] : []),
    ...(s.byPurser.length ? [{ icon: "ban", fig: String(s.byPurser.length), title: "Refused by Purser", tone: "bad" as const, rec: VIC3_RUN_FILE, href: `#${VIC3_PURCHASES_ID}`, text: `${s.byPurser.map((p) => p.step).join(", ")}: stopped before any call to Airi or Airwallex; nothing charged.${s.credentialRefused.length ? ` ${s.credentialRefused.map((p) => p.step).join(" and ")}: a credential reused, refused by Purser's credential check.` : ""}` }] : []),
    ...(noTap.length ? [{ icon: "clock", fig: String(noTap.length), title: "Not tapped", tone: "bad" as const, rec: VIC3_RUN_FILE, href: `#${VIC3_PURCHASES_ID}`, text: `${noTap.map((p) => p.step).join(", ")}: the cardholder did not confirm in Airi in time; nothing charged.` }] : []),
    ...(lead ? [{ icon: "file-check", fig: `${equal} of 2`, title: "Signed hash read back", tone: "ok" as const, rec: VIC3_RUN_FILE, href: `#${VIC3_RUN_ID}`, text: "The hash the CFO signed, equal in Airi's mandate and in Airwallex's PaymentIntent." }] : []),
  ];
}

const outcomeText = (p: Vic3Purchase) => {
  if (p.negative_test) return `the sandbox answered ${p.negative_test.airwallex?.outcome ?? "nothing"}`;
  const o = p.outcome ?? {};
  return o.status === "succeeded" ? `paid (${o.code ?? "SUCCEEDED"})` : `${o.status ?? "not run"}${codeOf(p) ? `, ${codeOf(p)}` : ""}`;
};
const eq = (x: { equal: boolean } | null | undefined) => (x ? (x.equal ? "equal" : "NOT equal") : "—");

/** The block at the top of /visa: the run in four lines, every purchase with its ids in one fold. */
export function vic3RunHtml(r: Vic3Record | null = vic3Run(), o: { first?: string; summarised?: boolean } = {}): string {
  if (!r) return "";
  const s = vic3Summary(r);
  const lead = s.paidSteps[0];
  const short = (id: string) => (id.length > 18 ? `${id.slice(0, 16)}…` : id);
  const paidLine = `${paidOf(r).map((p) => `${p.step}: ${p.request?.currency} ${p.request?.amount}${p.proposal_id ? " after the CFO's Face ID" : ""}`).join("; ")}. ${s.paid} of ${s.of} purchases paid`;
  const refusedLine = [s.byPurser.length ? `${s.byPurser.map((p) => p.step).join(", ")} refused by Purser with 0 calls` : "", ...s.other.map((p) => `${p.step}: ${codeOf(p) === "PURSER_NO_TAP" ? "the cardholder did not tap in time; nothing was charged" : `refused (${codeOf(p)})`}`)].filter(Boolean).join(". ");
  const rows = r.purchases.map((p) => `<li><b>${esc(p.step)}</b> · ${esc(p.request ? `${p.request.currency} ${p.request.amount}` : "")} · ${esc(outcomeText(p))}${p.rail_choice?.request_id ? ` · ${esc(`rail chosen by ${p.rail_choice.by}, request ${p.rail_choice.request_id}`)}` : ""}${p.mandate_id ? ` · ${esc(`mandate ${p.mandate_id}`)}` : ""}${p.payment_intent_id ? ` · ${esc(`PaymentIntent ${p.payment_intent_id}`)}` : ""}${p.read_back.mandate ? ` · ${esc(`mandate read-back ${eq(p.read_back.mandate)}`)}` : ""}${p.read_back.payment_intent ? ` · ${esc(`PaymentIntent read-back ${eq(p.read_back.payment_intent)}`)}` : ""} · ${esc(`calls: Anthropic ${p.calls.anthropic}, Airwallex ${p.calls.airwallex}, Airi ${p.calls.airi}`)}</li>`).join("");
  const record = `${REPO_BLOB}${VIC3_RUN_FILE}`;
  // The purchases whose rail Claude chose (the others went straight to Purser's rules), from the record.
  const chosen = r.purchases.filter((p) => p.rail_choice?.by === "claude" && p.rail_choice.chosen).map((p) => p.step);
  // The owner, 12 Nov ("less text, numbers as count-up stats"): a short heading, four figures, the finding in one line;
  // the rail line, the paid and refused lines and every purchase with its ids in the fold.
  const equal = lead ? [lead.read_back.mandate, lead.read_back.payment_intent].filter((x) => x?.equal).length : 0;
  // Jury pass, 13 Nov: what happened to each purchase leads, not "1 of 5 paid" (the rest were stopped on purpose).
  const noTap = s.other.filter((p) => codeOf(p) === "PURSER_NO_TAP").length;
  const stats: Stat[] = [
    { n: s.paidFaceId.length, label: "paid after Face ID", icon: "scan-face", tone: "ok" },
    ...(s.paidAlone.length ? [{ n: s.paidAlone.length, label: "paid within the limit", icon: "credit-card", tone: "ok" as const }] : []),
    ...(s.byPurser.length ? [{ n: s.byPurser.length, label: "refused by Purser, 0 calls", icon: "ban", tone: "bad" as const }] : []),
    ...(noTap ? [{ n: noTap, label: "not tapped: nothing charged", icon: "clock", tone: "bad" as const }] : []),
    ...(lead ? [{ n: equal, suf: " of 2", label: "hash matched at Airi and Airwallex", icon: "file-check", tone: "ok" as const }] : []),
  ];
  return `<div class="card airi" id="${VIC3_RUN_ID}"><h2>${esc(`Latest live run, ${s.date}`)}</h2>
${o.summarised ? "" : `<p class="vlead">${esc(vic3Lead(r))}</p>
${statsHtml(stats)}`}
${chosen.length ? `<p class="airi-finding">${esc(`Claude picked the Airi rail for each purchase it was asked about (${chosen.join(", ")}); Purser's code enforced the limit.`)}</p>` : ""}
<p class="airi-finding">${esc(s.finding)}</p>
<details class="fold" id="${VIC3_PURCHASES_ID}"><summary>${esc("Each purchase, with its ids")}</summary>
<p class="airi-label">${esc(`Rail chosen by ${s.model ?? "Claude"} from ${s.menu}`)}${s.requestId ? ` · <a class="pf" href="${esc(record)}" target="_blank" rel="noopener">${esc(`request ${short(s.requestId)}`)} ↗</a>` : ""}</p>
<ul class="airi-out"><li>${esc(`${paidLine}.`)}</li>${refusedLine ? `<li>${esc(`${refusedLine}.`)}</li>` : ""}</ul>
<ul class="awc">${rows}</ul>
<p class="src">${esc(`Source: ${VIC3_RUN_FILE}. ${r.label}.`)} · <a class="pf" href="${esc(`${REPO_BLOB}${VIC3_RUN_LOG}`)}" target="_blank" rel="noopener">${esc("run log")} ↗</a></p></details>
${o.first ? `<p class="src">${esc(`The first live run, ${o.first}, follows below.`)}</p>` : ""}</div>`;
}
