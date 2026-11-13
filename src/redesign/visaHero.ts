// /visa's hero (13 Nov, the owner: "impressive, people need to know where to look, more visuals and data"): one flow
// with the latest live run's purchases on their paths, the outcome of every purchase in one strip, and the signed hash
// shown equal at Purser, Airi and Airwallex. Every step, amount, code and hash is read from the run record
// (docs/runs/2026-11-13-vic-4.json via vic3Run); the words for a code are labels, not figures. No check count anywhere.
// Inline SVG and HTML only, no script: the page's CSP hashes stay as they are. Its CSS is this page's own (VISA_HERO_CSS).

import type { Vic3Purchase, Vic3Record } from "./vic3Run.js";
import { countOf, esc } from "./ui.js";

export const VISA_FLOW_ID = "visa-flow";
export const VISA_OUTCOMES_ID = "visa-outcomes";
export const VISA_HASH_ID = "visa-hash";

/** How a purchase ended, from its record: paid alone, paid after the CFO's Face ID, refused by Purser, or not tapped. */
export type Outcome = "paid" | "paid-faceid" | "refused" | "notap" | "other";
const codeOf = (p: Vic3Purchase) => p.outcome?.code ?? null;
export function outcomeOf(p: Vic3Purchase): Outcome {
  const o = p.outcome ?? {};
  if (o.status === "succeeded") return p.proposal_id ? "paid-faceid" : "paid";
  if (codeOf(p) === "PURSER_NO_TAP") return "notap";
  if (o.status === "refused" && /^purser/.test(o.by ?? "")) return "refused";
  return "other";
}

/** A refusal's reason in a few words, from its code (or, for the executor's hash check, its own words). */
export function reasonOf(p: Vic3Purchase): string {
  const c = codeOf(p);
  if (c === "PURSER_ABOVE_HARD_CAP") return "over the hard cap";
  if (c === "PURSER_MERCHANT_NOT_ALLOWED") return "merchant not allowed";
  if (c === "PURSER_CREDENTIAL_AMOUNT_MISMATCH") return "credential for another amount";
  if (c === "PURSER_CREDENTIAL_ALREADY_USED") return "credential used a second time";
  if (c === "PURSER_NO_TAP") return "no tap in Airi within 5 minutes";
  if (/terms do not match the approved hash/.test(p.outcome?.refusal ?? "")) return "terms changed after the Face ID";
  return c ?? p.outcome?.status ?? "not run";
}

const OUT_WORDS: Record<Outcome, string> = { paid: "Paid within the limit", "paid-faceid": "Paid after Face ID", refused: "Refused by Purser", notap: "Not tapped", other: "Other" };
const amt = (p: Vic3Purchase) => (p.request ? `${p.request.currency} ${p.request.amount}` : "");

// Icons, inline SVG (aria-hidden: each chip says its outcome in words beside it).
const svg = (d: string) => `<svg class="vh-i" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON: Record<Outcome, string> = {
  paid: svg('<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  "paid-faceid": svg('<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  refused: svg('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.2 11.8l7.6-7.6" stroke="currentColor" stroke-width="1.8"/>'),
  notap: svg('<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 5v3.2l2.2 1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  other: svg('<circle cx="8" cy="8" r="2" fill="currentColor"/>'),
};
const ARROW = `<svg class="vh-a" viewBox="0 0 24 12" aria-hidden="true" focusable="false"><path d="M1 6h19m-5-4.5L20.5 6 15 10.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** One purchase as a chip: its step, amount and outcome; the reason in its title and, for a stop, in the chip. */
function chip(p: Vic3Purchase, o: { reason?: boolean } = {}): string {
  const out = outcomeOf(p);
  const why = out === "paid" || out === "paid-faceid" ? OUT_WORDS[out] : reasonOf(p);
  return `<span class="vh-c vh-${out}" title="${esc(`${p.step}, ${amt(p)}: ${OUT_WORDS[out].toLowerCase()}; ${why}`)}">${ICON[out]}<b>${esc(p.step)}</b><span class="vh-am">${esc(amt(p))}</span>${o.reason ? `<span class="vh-why">${esc(why)}</span>` : ""}</span>`;
}

/** A path of steps; the purchases that ended at a step stand under it. */
function lane(title: string, cls: string, steps: { name: string; at: Vic3Purchase[] }[]): string {
  const items = steps.map((s, i) => `<li class="vh-s${s.at.length ? " vh-has" : ""}"><span class="vh-n">${esc(s.name)}</span>${s.at.length ? `<span class="vh-at">${s.at.map((p) => chip(p, { reason: outcomeOf(p) !== "paid" && outcomeOf(p) !== "paid-faceid" })).join("")}</span>` : ""}</li>${i < steps.length - 1 ? `<li class="vh-arr" aria-hidden="true">${ARROW}</li>` : ""}`).join("");
  return `<div class="vh-lane ${cls}"><p class="vh-lt">${esc(title)}</p><ol class="vh-steps">${items}</ol></div>`;
}

/**
 * The flow: the agent asks, Purser's policy decides; within the limit one tap in Airi, then the Visa credential, the
 * Airwallex PaymentIntent, paid; over it the CFO's Face ID first; refused, stopped before any call. Each purchase of the
 * run stands where it ended.
 */
export function visaFlowHtml(r: Vic3Record): string {
  const ps = r.purchases;
  const by = (f: (p: Vic3Purchase) => boolean) => ps.filter(f);
  const paidAlone = by((p) => outcomeOf(p) === "paid");
  const paidFaceId = by((p) => outcomeOf(p) === "paid-faceid");
  const noTap = by((p) => outcomeOf(p) === "notap");
  const refused = by((p) => outcomeOf(p) === "refused");
  const tail = (paid: Vic3Purchase[], tapStop: Vic3Purchase[]) => [
    { name: "One tap in Airi", at: tapStop },
    { name: "Visa credential", at: [] },
    { name: "Airwallex PaymentIntent", at: [] },
    { name: "Paid", at: paid },
  ];
  return `<section class="vh-flow card" id="${VISA_FLOW_ID}" aria-label="${esc("How each purchase of the latest live run went")}">
<ol class="vh-head"><li class="vh-s"><span class="vh-n">${esc("The agent asks to buy")}</span></li><li class="vh-arr" aria-hidden="true">${ARROW}</li><li class="vh-s vh-key"><span class="vh-n">${esc("Purser's policy check")}</span></li></ol>
<div class="vh-lanes">
${lane("Within the CFO's limit", "vh-l-ok", tail(paidAlone, noTap))}
${lane("Over the limit", "vh-l-face", [{ name: "CFO's Face ID", at: [] }, { name: "Then the same path", at: [] }, { name: "Paid", at: paidFaceId }])}
${lane("Refused", "vh-l-bad", [{ name: "Stopped before any call; nothing charged", at: refused }])}
</div></section>`;
}

/** Every purchase of the run in one strip, in the record's order, with a legend that counts each outcome. */
export function visaOutcomesHtml(r: Vic3Record, runs: string | null = null): string {
  const order: Outcome[] = ["paid", "paid-faceid", "refused", "notap"];
  const n = (o: Outcome) => r.purchases.filter((p) => outcomeOf(p) === o).length;
  const legend = order.filter((o) => n(o)).map((o) => `<li class="vh-${o}">${ICON[o]}${esc(`${OUT_WORDS[o]}: ${n(o)}`)}</li>`).join("");
  return `<section class="vh-out card" id="${VISA_OUTCOMES_ID}"><h2 class="vh-h">${esc("Every purchase, as it ended")}</h2>
<ul class="vh-leg">${legend}</ul>
<ol class="vh-strip">${r.purchases.map((p) => `<li>${chip(p, { reason: true })}</li>`).join("")}</ol>${runs ? `<p class="vh-src">${esc(`${runs}.`)}</p>` : ""}</section>`;
}

const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

/** The hash the CFO signed, and the same hash read back from Airi's mandate and Airwallex's PaymentIntent. */
export function visaHashHtml(r: Vic3Record): string {
  const b = r.purchases.find((p) => outcomeOf(p) === "paid-faceid" && p.terms_sha256 && p.read_back.mandate && p.read_back.payment_intent);
  if (!b?.terms_sha256) return "";
  const signed = b.terms_sha256;
  const inAiri = b.read_back.mandate?.terms_sha256_in_mandate ?? null;
  const inAwx = (b.read_back.payment_intent as { read_back?: string | null } | null)?.read_back ?? null;
  const cell = (where: string, sub: string, h: string | null, eq: boolean | null) => `<li class="vh-hc${eq === false ? " vh-ne" : ""}"><span class="vh-hw">${esc(where)}</span><span class="vh-hs">${esc(sub)}</span><code>${esc(h ? shortHash(h) : "not read")}</code>${eq === null ? "" : `<span class="vh-tick">${eq ? ICON.paid : ICON.refused}${esc(eq ? "equal" : "not equal")}</span>`}</li>`;
  const eqAiri = !!b.read_back.mandate?.equal && inAiri === signed;
  const eqAwx = !!b.read_back.payment_intent?.equal && inAwx === signed;
  return `<section class="vh-hash card" id="${VISA_HASH_ID}"><h2 class="vh-h">${esc(`The hash the CFO signed for ${b.step}, read back`)}</h2>
<ol class="vh-hl">${cell("Purser", `signed with Face ID (${b.proposal_id ?? ""})`, signed, null)}<li class="vh-eq" aria-hidden="true">=</li>${cell("Airi", "the mandate, before the credential", inAiri, eqAiri)}<li class="vh-eq" aria-hidden="true">=</li>${cell("Airwallex", "the PaymentIntent's metadata", inAwx, eqAwx)}</ol>
<p class="vh-src">${esc(`${countOf([eqAiri, eqAwx].filter(Boolean).length, 2)} read-backs equal to the signed hash (SHA-256 ${signed}).`)}</p></section>`;
}

/** The page's own CSS for the hero: site tokens, plus one amber of its own for "not tapped", light and dark. */
export const VISA_HERO_CSS = `
.pp a.pf, .pp a[data-rec], .pp .src a, .foot a.flink { display: inline-block; min-height: 24px; line-height: 24px; }
.pp { --vwarn: #8a4b00; --vwarn-soft: #fdf1dc; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .pp { --vwarn: #f2b45a; --vwarn-soft: #3a2a10; } }
:root[data-theme="dark"] .pp { --vwarn: #f2b45a; --vwarn-soft: #3a2a10; }
.vh-flow, .vh-out, .vh-hash { margin: 18px 0 0; padding: 18px; }
.vh-h { margin: 0 0 12px; font-size: 16px; }
.vh-i { width: 14px; height: 14px; flex: none; }
.vh-a { width: 24px; height: 12px; color: var(--faint); }
.vh-head, .vh-steps, .vh-strip, .vh-leg, .vh-hl { list-style: none; margin: 0; padding: 0; }
.vh-head, .vh-steps { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
.vh-head { margin-bottom: 14px; }
.vh-arr { align-self: flex-start; display: flex; padding-top: 11px; }
.vh-s { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.vh-n { display: inline-block; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--sunken); font-size: 13.5px; font-weight: 600; }
.vh-key .vh-n { background: var(--accent-soft); border-color: var(--accent); }
.vh-lanes { display: grid; gap: 12px; }
.vh-lane { border-left: 3px solid var(--border); padding: 2px 0 2px 12px; }
.vh-l-ok { border-left-color: var(--ok); } .vh-l-face { border-left-color: var(--accent); } .vh-l-bad { border-left-color: var(--bad); }
.vh-lt { margin: 0 0 8px; font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.vh-at { display: flex; flex-wrap: wrap; gap: 6px; }
.vh-c { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px; border: 1px solid; font-size: 13px; line-height: 1.3; max-width: 100%; }
.vh-c b { font-weight: 700; } .vh-am { font-variant-numeric: tabular-nums; }
.vh-why { color: var(--muted); font-size: 12.5px; }
.vh-paid, .vh-paid-faceid { color: var(--ok); border-color: var(--ok); background: var(--ok-soft); }
.vh-refused { color: var(--bad); border-color: var(--bad); background: var(--bad-soft); }
.vh-notap { color: var(--vwarn); border-color: var(--vwarn); background: var(--vwarn-soft); border-style: dashed; }
.vh-c b, .vh-c .vh-am { color: var(--text); }
.vh-leg { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 12px; font-size: 13.5px; }
.vh-leg li { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; color: var(--text); }
.vh-leg li.vh-paid .vh-i, .vh-leg li.vh-paid-faceid .vh-i { color: var(--ok); } .vh-leg li.vh-refused .vh-i { color: var(--bad); } .vh-leg li.vh-notap .vh-i { color: var(--vwarn); }
.vh-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.vh-strip .vh-c { width: 100%; border-radius: 10px; flex-wrap: wrap; }
.vh-hl { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; }
.vh-hc { flex: 1 1 180px; display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--sunken); min-width: 0; }
.vh-hw { font-weight: 700; } .vh-hs { font-size: 12.5px; color: var(--muted); }
.vh-hc code { font-size: 14px; overflow-wrap: anywhere; }
.vh-tick { display: inline-flex; align-items: center; gap: 5px; color: var(--ok); font-size: 13px; font-weight: 600; }
.vh-ne .vh-tick { color: var(--bad); }
.vh-eq { align-self: center; font-size: 22px; font-weight: 700; color: var(--ok); }
.vh-src { margin: 10px 0 0; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
@media (max-width: 560px) {
  .vh-flow, .vh-out, .vh-hash { padding: 12px; margin-top: 14px; }
  .vh-h { font-size: 15px; margin-bottom: 8px; }
  .vh-head { margin-bottom: 10px; } .vh-lanes { gap: 8px; } .vh-lt { margin-bottom: 6px; }
  .vh-steps { gap: 4px; } .vh-a { width: 14px; } .vh-arr { padding-top: 8px; }
  .vh-n { padding: 4px 7px; font-size: 12.5px; border-radius: 6px; }
  .vh-s { gap: 4px; flex-direction: row; flex-wrap: wrap; align-items: center; } .vh-arr { padding-top: 6px; }
  .vh-flow .vh-why { display: none; }
  #vic3-run .awc li { font-size: 12.5px; line-height: 1.4; padding: 6px 0; overflow-wrap: anywhere; }
  #vic3-run .airi-finding, #vic3-run .airi-out li { font-size: 13px; }
  #vic-more li, #vic-more p, #vic-more td, #vic-more th { font-size: 13.5px; line-height: 1.45; }
  .vh-c { padding: 3px 8px; font-size: 12.5px; }
  .vh-leg { gap: 4px 12px; margin-bottom: 8px; font-size: 12.5px; }
  .vh-strip { grid-template-columns: 1fr 1fr; gap: 5px; }
  .vh-strip .vh-c { padding: 4px 7px; } .vh-strip .vh-why { flex-basis: 100%; font-size: 11.5px; line-height: 1.25; }
  .vh-hl { flex-wrap: nowrap; gap: 4px; } .vh-hc { flex: 1 1 0; padding: 7px; } .vh-hs { display: none; }
  .vh-hc code { font-size: 11px; } .vh-hw { font-size: 13px; } .vh-tick { font-size: 12px; } .vh-eq { font-size: 16px; }
}
`;
