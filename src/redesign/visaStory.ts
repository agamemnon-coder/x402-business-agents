// /visa as one story, top to bottom (Visa judge, 14 Nov: "the VIC claim feels weak; TAP is hidden; 'Purser refused
// reuse, Airi didn't' is buried"). Five sections under the heading, each claim beside its record:
//   1. what Visa Intelligent Commerce asks for, in Visa's own words (developer.visa.com, read 14 Nov 2026;
//      docs/plans/visa-1114.md);
//   2. how Purser meets each one in our runs, or "not done yet", with the record;
//   3. the three Visa runs, counted from their records;
//   4. TAP, shown openly, outside the entry, with its record and what it proves;
//   5. what is not proven yet.
// Every count, code, amount and id is read from the records; Visa's terms are used only where a record matches them.

import { existsSync, readFileSync } from "node:fs";
import { VISA_TAP_STATUS } from "../config/brand.js";
import { airiRun, AIRI_RUN_FILE } from "./airiRun.js";
import { REPO_BLOB } from "./metalStory.js";
import { tapRun } from "./run.js";
import { esc } from "./ui.js";
import { VIC3_PREV_FILE, VIC3_RUN_FILE, vic3Run, vic3Summary, type Vic3Record } from "./vic3Run.js";

export const VISA_ASKS_ID = "visa-asks";
export const VISA_MEETS_ID = "visa-meets";
export const VISA_REUSE_ID = "visa-reuse";
export const VISA_RUNS3_ID = "visa-three-runs";
export const VISA_NOT_YET_ID = "visa-not-yet";
export const VISA_PLAN_FILE = "docs/plans/visa-1114.md";
/** The TAP section's heading: it says at once that TAP is outside the entry (Visa, 5 Nov). */
export const VISA_TAP_SECTION_HEADING = "Outside the entry: Visa TAP";

/** Visa's developer pages read on 14 Nov 2026 (docs/plans/visa-1114.md); no date is shown on them. */
const VIC_CONCEPTS = "https://developer.visa.com/docs/visa-intelligent-commerce/concepts";
const VIC_START = "https://developer.visa.com/capabilities/visa-intelligent-commerce";
const VIC_FLOWS = "https://developer.visa.com/docs/visa-intelligent-commerce/workflows";

/**
 * What Visa Intelligent Commerce asks for, four areas in Visa's own terms, each with the page it is read from. The
 * words in quotes are Visa's (docs/plans/visa-1114.md keeps the source table).
 */
export const VISA_ASKS: readonly { key: string; area: string; terms: string; href: string }[] = [
  { key: "identity", area: "Agent identity", terms: "a registered agent whose \"agent signatures\" Visa validates", href: VIC_START },
  { key: "credential", area: "Payment credential", terms: "an \"agentic token\" in place of the card number, its cryptogram \"one-time use\"", href: VIC_CONCEPTS },
  { key: "auth", area: "Consumer authentication", terms: "\"Visa Payment Passkeys\" bound to the consumer's device", href: VIC_START },
  { key: "intent", area: "Intent, consent and limits", terms: "the consumer's \"instruction\" and its mandates: the agent buys only \"within the set instruction parameters\"", href: VIC_FLOWS },
];

type Rec = Vic3Record & { audit?: { seq: number; event: string; payload?: { values?: Record<string, string> } }[] };
const readRec = (file: string): Rec | null => {
  const url = new URL(`../../${file}`, import.meta.url);
  return existsSync(url) ? (JSON.parse(readFileSync(url, "utf8")) as Rec) : null;
};
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const recLink = (file: string, words = file.replace(/^docs\/(runs|demo)\//, "")) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(words)} ↗</a>`;
const md = (file: string) => file.replace(/\.json$/, ".md");

/** The facts the rows stand on, read from vic-4 and vic-3 (the latest run and the one before it). */
export function visaStoryFacts() {
  const v4 = vic3Run(), v3 = vic3Run(VIC3_PREV_FILE), raw = readRec(VIC3_RUN_FILE);
  if (!v4) return null;
  const find = (r: Vic3Record | null, step: string) => r?.purchases.find((p) => p.step === step) ?? null;
  const b = v4.purchases.find((p) => p.proposal_id && p.outcome?.status === "succeeded" && p.read_back.mandate?.equal && p.read_back.payment_intent?.equal) ?? null;
  const policy = raw?.audit?.find((a) => a.event === "airi.policy_initial")?.payload?.values ?? {};
  const refusedCode = (step: string) => find(v4, step)?.outcome?.status === "refused" ? find(v4, step)?.outcome?.code ?? null : null;
  const reuse = ["F1", "F2"].map((s) => ({ step: s, now: find(v4, s), then: find(v3, s) }));
  return {
    v4, v3, b, policy,
    alone: policy["approval.airi_alone"] ?? null, perDay: policy["approval.airi_alone_per_day"] ?? null,
    cap: refusedCode("C"), merchant: refusedCode("D"), changed: find(v4, "E")?.outcome?.status === "refused" ? find(v4, "E") : null,
    reuse, audit: raw?.audit ?? [],
  };
}

/** 1. What Visa Intelligent Commerce asks for. */
export function visaAsksHtml(): string {
  const items = VISA_ASKS.map((a) => `<li><b>${esc(a.area)}:</b> ${esc(a.terms)}. <a class="pf" href="${esc(a.href)}" target="_blank" rel="noopener">${esc("Visa")} ↗</a></li>`).join("");
  return `<section class="card vs" id="${VISA_ASKS_ID}"><h2>${esc("What Visa Intelligent Commerce asks for")}</h2>
<ol class="vs-asks">${items}</ol>
<p class="vh-src">${esc("Visa's developer pages, read 14 Nov 2026:")} ${recLink(VISA_PLAN_FILE, "the source table")}</p></section>`;
}

/** 2. How Purser meets each one in our runs: "Purser does X" with its record, or "Not done yet". */
export function visaMeetsHtml(): string {
  const f = visaStoryFacts();
  if (!f) return "";
  const v4 = VIC3_RUN_FILE, v3 = VIC3_PREV_FILE, tap = tapRun();
  const reuseNow = f.reuse.filter((x) => /^PURSER_CREDENTIAL_/.test(x.now?.outcome?.code ?? "") && x.now!.calls.airwallex === 0 && x.now!.calls.airi === 0);
  const reuseThen = f.reuse.filter((x) => x.then?.negative_test && (x.then.negative_test.airwallex?.outcome ?? "") === "SUCCEEDED");
  const rows: { key: string; ok: boolean; text: string; recs: string }[] = [
    {
      key: "identity", ok: false,
      text: tap ? "Not done yet in the Airi runs. A separate run signs the agent's checkout per TAP (below, outside the entry)." : "Not done yet.",
      recs: tap ? recLink(tap.file) : "",
    },
    {
      key: "credential", ok: reuseNow.length === 2,
      text: `Bound to one purchase by Purser: another amount, ${reuseNow.find((x) => x.step === "F1")?.now?.outcome?.code ?? "not refused"}; a second use, ${reuseNow.find((x) => x.step === "F2")?.now?.outcome?.code ?? "not refused"}; before any Airwallex call. Airi's credential, not a Visa agentic token.`,
      recs: `${recLink(v4)}${reuseThen.length ? ` ${recLink(md(v3))}` : ""}`,
    },
    {
      key: "auth", ok: !!f.b,
      text: f.b ? `Above the CFO's limit, the CFO's passkey (Face ID) signs the SHA-256 of the exact terms; for ${f.b.step} (${f.b.request?.currency ?? ""} ${f.b.request?.amount ?? ""}) Airi's mandate and Airwallex's PaymentIntent held the same hash. Purser's passkey, not a Visa Payment Passkey.` : "Not done yet.",
      recs: recLink(md(v4)),
    },
    {
      key: "intent", ok: !!(f.alone && f.cap && f.merchant),
      text: `In Purser's code: up to EUR ${f.alone ?? "?"} alone, ${f.perDay ?? "?"} a day; over the hard cap ${f.cap ?? "not refused"}; a merchant not listed ${f.merchant ?? "not refused"}${f.changed ? "; changed terms refused by the hash check" : ""}; no outside call. Each step in Purser's hash-chained audit log (${f.audit.length} rows).`,
      recs: recLink(md(v4)),
    },
  ];
  const area = (k: string) => VISA_ASKS.find((a) => a.key === k)!.area;
  return `<section class="card vs" id="${VISA_MEETS_ID}"><h2>${esc("How Purser meets each one, in our runs")}</h2>
<ul class="vs-rows">${rows.map((r) => `<li class="vs-row ${r.ok ? "vs-ok" : "vs-no"}"><span class="vs-k">${esc(area(r.key))}</span><span class="vs-t">${esc(r.text)}</span><span class="vs-r">${r.recs}</span></li>`).join("")}</ul></section>`;
}

/** The finding the judge found buried: reusing a credential, Purser refused it; the sandbox did not. */
export function visaReuseHtml(): string {
  const f = visaStoryFacts();
  if (!f) return "";
  const now = f.reuse.filter((x) => /^PURSER_CREDENTIAL_/.test(x.now?.outcome?.code ?? ""));
  const then = f.reuse.filter((x) => x.then?.negative_test);
  if (now.length !== 2 || then.length !== 2) return "";
  const accepted = then.every((x) => (x.then!.negative_test!.airwallex?.outcome ?? "") === "SUCCEEDED");
  return `<section class="card vs vs-reuse" id="${VISA_REUSE_ID}"><h2>${esc("A reused credential: Purser refused it, the sandbox did not")}</h2>
<div class="vs-two"><div><p class="vs-lt">${esc(`Airi/Airwallex sandbox (${day(f.v3!.started_at)})`)}</p><p>${esc(accepted ? "Another amount, then a second use: both accepted (SUCCEEDED)." : "Another amount, then a second use: see the record.")}</p>${recLink(md(VIC3_PREV_FILE))}</div>
<div><p class="vs-lt">${esc(`Purser (${day(f.v4.started_at)})`)}</p><p>${esc(`Both refused before any Airwallex call: ${now.map((x) => x.now!.outcome!.code).join(", ")}.`)}</p>${recLink(md(VIC3_RUN_FILE))}</div></div></section>`;
}

/** 3. The three Visa runs, each counted from its own record. */
export function visaThreeRunsHtml(): string {
  const airi = airiRun(), runs = [vic3Run(VIC3_PREV_FILE), vic3Run()].filter((r): r is Vic3Record => !!r);
  if (!airi) return "";
  const rows: { day: string; paid: number; notConfirmed: number; refused: number; file: string }[] = [
    { day: day(airi.started_at), paid: airi.purchases.filter((p) => (p as { status?: string }).status === "SETTLED").length, notConfirmed: 0, refused: airi.purchases.filter((p) => (p as { by?: string }).by === "purser").length, file: AIRI_RUN_FILE },
    ...runs.map((r) => { const s = vic3Summary(r); return { day: day(r.started_at), paid: s.paid, notConfirmed: s.other.filter((p) => p.outcome?.code === "PURSER_NO_TAP").length, refused: s.byPurser.length, file: r === runs[runs.length - 1] ? VIC3_RUN_FILE : VIC3_PREV_FILE }; }),
  ];
  const sum = (k: "paid" | "notConfirmed" | "refused") => rows.reduce((n, r) => n + r[k], 0);
  return `<section class="card vs" id="${VISA_RUNS3_ID}"><h2>${esc(`The ${rows.length} Visa runs: ${sum("paid")} paid, ${sum("notConfirmed")} not confirmed in Airi`)}</h2>
<table class="vs-runs"><thead><tr><th>${esc("Run")}</th><th>${esc("Paid")}</th><th>${esc("Not confirmed in Airi")}</th><th>${esc("Refused by Purser")}</th><th>${esc("Record")}</th></tr></thead>
<tbody>${rows.map((r) => `<tr><td>${esc(r.day)}</td><td>${r.paid}</td><td>${r.notConfirmed}</td><td>${r.refused}</td><td>${recLink(r.file)}</td></tr>`).join("")}</tbody></table>
<p class="vh-src">${esc("Not confirmed in Airi: the owner did not tap in Airi within 5 minutes; Purser cancelled the mandate and nothing was charged. Airwallex sandbox, Airi's test card, test money.")}</p></section>`;
}

/** 4. TAP, openly: its status first (outside the entry), what the run proves, and its record. */
export function visaTapSectionHtml(id: string, more = ""): string {
  const tap = tapRun();
  if (!tap) return "";
  const buy = tap.steps.find((s) => s.approved), over = tap.steps.find((s) => !s.approved);
  const proved = [
    buy ? `The Sourcing agent's checkout request was signed per TAP; Visa's reference proxy (commit ${tap.commit}) ${buy.sig1 === "verified" ? "verified the signature" : `answered ${buy.sig1}`} and the merchant accepted it.` : "",
    over ? `A second purchase over the card's limit was declined by Airwallex (${over.reason ?? "declined"}).` : "",
    "Not proven: the registry was Visa's reference registry, self-hosted, with a test key; not Visa's directory, and Visa has not approved the agent. The merchant is ours.",
  ].filter(Boolean);
  return `<section class="card vs vs-tap" id="${id}"><h2>${esc(VISA_TAP_SECTION_HEADING)}</h2>
<p class="claim">${esc(VISA_TAP_STATUS)}</p>
<ul class="vs-list">${proved.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
<p class="vh-src">${esc(`${tap.label}.`)} ${recLink(tap.file)}</p>${more}</section>`;
}

/** 5. What is not proven yet: short, honest. */
export const VISA_NOT_YET: readonly string[] = [
  "A Visa-provisioned agentic token or cryptogram: the runs use Airi's credential in the Airwallex sandbox.",
  "A real card or real money: Airi's test card, test money only.",
  "Registration with Visa as an agent, or a Visa Payment Passkey: the passkey is the CFO's, in Purser.",
  "Signals to Visa: outcomes go to Airi and to our records.",
];
export function visaNotYetHtml(): string {
  return `<section class="card vs" id="${VISA_NOT_YET_ID}"><h2>${esc("What is not proven yet")}</h2>
<ul class="vs-list">${VISA_NOT_YET.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>`;
}

export const VISA_STORY_CSS = `
.vs { margin: 18px 0 0; padding: 18px; scroll-margin-top: 80px; }
.vs h2 { margin: 0 0 12px; font-size: 18px; }
.vs-asks, .vs-rows, .vs-list { margin: 0; padding: 0 0 0 20px; display: grid; gap: 8px; }
.vs-rows { list-style: none; padding: 0; gap: 10px; }
.vs-row { display: grid; grid-template-columns: 180px minmax(0, 1fr) auto; gap: 4px 14px; align-items: baseline; padding: 10px 0 10px 12px; border-left: 3px solid var(--border); }
.vs-ok { border-left-color: var(--ok); } .vs-no { border-left-color: var(--vwarn); }
.vs-k { font-weight: 700; } .vs-r { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 13px; }
.vs-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.vs-two > div { padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--sunken); }
.vs-two > div:first-child { border-color: var(--bad); } .vs-two > div:last-child { border-color: var(--ok); }
.vs-two p { margin: 0 0 6px; }
.vs-lt { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.vs-runs { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.vs-runs th, .vs-runs td { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid var(--border); }
.vs-runs th { font-size: 12.5px; color: var(--muted); font-weight: 650; }
@media (max-width: 560px) {
  .vs { padding: 12px; margin-top: 14px; }
  .vs h2 { font-size: 16px; }
  .vs-row { grid-template-columns: minmax(0, 1fr); }
  .vs-two { grid-template-columns: minmax(0, 1fr); }
  .vs-runs { font-size: 13px; } .vs-runs th, .vs-runs td { padding-right: 6px; }
}`;
