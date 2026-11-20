// Home's explainer of the money flow (the owner, 20 Nov: "one tasteful animated explainer"): an agent proposes a
// payment, Purser's code checks the limits, above the limit the CFO signs the exact terms with a passkey, it is paid on
// the rail; then one cent is changed after signing and the signature breaks.
//
// Every value is read from /try's two proof files (docs/proof/try-paid.json and try-refused.json, the live /try of
// 15 Nov, a test company, test money): the supplier and amount the CFO signed, the fingerprint (SHA-256) of the signed
// terms, the amount asked one cent later and its own fingerprint. The broken-signature panel shows only while the
// records hold exactly that: a refusal whose signature did not verify, the amount the one field changed, one cent apart,
// and no transfer made. The rails are named as Purser uses them: Airwallex (sandbox) and Alta (testnet).
//
// CSS only, no script. Every word is in sight and drawn in its own colours in every frame (no opacity or wipe on
// text; site audit, 19 Nov), so no frame leaves an empty block: what moves is a dot down the rail, the rail filling,
// the steps' icons lighting up in turn, the passkey ring closing, then the refusal's panel turning red and the changed
// cent ringed once (the owner, 20 Nov: "smooth, purposeful, not busy": one slow loop, nothing bounces or shakes). The
// final state is the default: with reduced motion (or no animation support) the whole flow stands, every step done and
// the refusal in sight.

import { readFileSync } from "node:fs";
import { esc, icon } from "./ui.js";

/** The two records the explainer reads. */
export const MONEY_FLOW_RECORDS = ["docs/proof/try-paid.json", "docs/proof/try-refused.json"] as const;

interface Terms { vendor: string; amount: string; currency: string }
interface Decision { outcome: string; signature: { verified: boolean }; signed_sha256: string; sent_sha256: string; changed: string[]; transfers_before: number; transfers_after: number }
interface Bundle { terms: Terms; terms_sha256: string; decision: Decision; asked: { terms: Terms } | null }

const readBundle = (f: string) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")) as Bundle;
const money = (a: string) => Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (a: string) => Math.round(Number(a) * 100);

export interface MoneyFlowFacts {
  vendor: string;
  /** "EUR 1,850.00": what the CFO signed. */
  amount: string;
  /** The first 8 hex characters of the signed terms' SHA-256. */
  signed: string;
  /** The one-cent change, only while the refused record holds it. */
  cent: { currency: string; asked: string; sent: string } | null;
}

/** The explainer's values from the two records (paid, refused); none when the paid record is not a paid, verified signature. */
export function moneyFlowFacts(paid: Bundle = readBundle(MONEY_FLOW_RECORDS[0]), refused: Bundle | null = readBundle(MONEY_FLOW_RECORDS[1])): MoneyFlowFacts | null {
  const d = paid.decision;
  if (d.outcome !== "paid" || !d.signature.verified || d.signed_sha256 !== paid.terms_sha256 || d.sent_sha256 !== d.signed_sha256) return null;
  const t = paid.terms;
  const r = refused?.decision, asked = refused?.asked?.terms;
  const oneCent = !!(r && asked && r.outcome === "refused" && !r.signature.verified && r.signed_sha256 === d.signed_sha256 && r.sent_sha256 !== r.signed_sha256
    && r.changed.length === 1 && r.changed[0] === "amount" && r.transfers_after === r.transfers_before
    && asked.currency === t.currency && asked.vendor === t.vendor && cents(asked.amount) - cents(t.amount) === 1);
  return {
    vendor: t.vendor, amount: `${t.currency} ${money(t.amount)}`, signed: d.signed_sha256.slice(0, 8),
    cent: oneCent ? { currency: asked!.currency, asked: money(asked!.amount), sent: r!.sent_sha256.slice(0, 8) } : null,
  };
}

/** The four steps' titles, a few words each (the explainer's own words; test/home-cloud.test.ts holds them). */
export const MONEY_FLOW_STEPS = ["An agent proposes a payment", "Purser's code checks the limits", "The CFO signs the exact terms", "Paid on the rail"] as const;
/** Where it is paid: Purser's two rails, both on test money; the /try run these values come from paid on its simulated bank. */
export const MONEY_FLOW_RAILS = "Airwallex sandbox or Alta (formerly Metal) testnet; /try pays a simulated bank";
export const MONEY_FLOW_CENT = "One cent changed after signing";
export const MONEY_FLOW_CAPTION = "Amount and fingerprints from /try's two proof files.";

export function moneyFlowHtml(f: MoneyFlowFacts | null = moneyFlowFacts(), whatsReal = "What's real?"): string {
  if (!f) return "";
  const [s0, s1, s2, s3] = MONEY_FLOW_STEPS;
  const step = (i: number, ic: string, title: string, line: string) => `<li class="mx-s mx-s${i}"><span class="mx-ic">${ic}</span><p><b>${esc(title)}</b><span>${line}</span></p></li>`;
  const ring = `<svg class="mx-ring" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><circle cx="22" cy="22" r="20"/></svg>`;
  // The changed cent, marked: the amount as asked, its last digit in a <mark>.
  const cent = f.cent ? `<div class="mx-cent">
    <p class="mx-ch">${icon("triangle-alert", 16)}<b>${esc(MONEY_FLOW_CENT)}</b></p>
    <p class="mx-amts"><s>${esc(f.amount)}</s> <span aria-hidden="true">→</span> <span class="mx-new">${esc(`${f.cent.currency} ${f.cent.asked.slice(0, -1)}`)}<mark>${esc(f.cent.asked.slice(-1))}</mark></span></p>
    <p class="mx-res">${icon("octagon-x", 16)}<span><b>Signature breaks. Nothing paid.</b> <small>Fingerprint <code>${esc(f.cent.sent)}…</code> is not the signed <code>${esc(f.signed)}…</code></small></span></p>
  </div>` : "";
  return `<figure class="mx" data-rec="${esc(MONEY_FLOW_RECORDS.join(" "))}" aria-labelledby="mx-cap">
  <div class="mx-card">
  <div class="mx-steps"><span class="mx-rail" aria-hidden="true"><span class="mx-fill"></span><span class="mx-dot"></span></span><ol class="mx-flow">
    ${step(0, icon("bot", 18), s0, `${esc(f.vendor)} · <span class="mx-num">${esc(f.amount)}</span>`)}
    ${step(1, icon("shield-check", 18), s1, esc("Above the agent's limit, so the CFO decides"))}
    ${step(2, `${ring}${icon("scan-face", 18)}`, s2, `With a passkey · fingerprint <code>${esc(f.signed)}…</code>`)}
    ${step(3, icon("check", 18), s3, esc(MONEY_FLOW_RAILS))}
  </ol></div>
  ${cent}
  </div>
  <figcaption id="mx-cap"><span>${esc(MONEY_FLOW_CAPTION)}</span> <a href="#real" data-real>${esc(whatsReal)}</a></figcaption>
</figure>`;
}

const LOOP = 12;
/** When each step lights up, as a share of the loop; all stay lit until the loop resets at 96%. */
const LIT = [3, 18, 34, 54] as const;
const CENT = 68;

export const MONEY_FLOW_CSS = `
.mx { margin: 0; }
.mx-card { position: relative; padding: 22px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 18px 40px -18px rgba(16, 24, 40, .22); }
.mx-steps { position: relative; }
ol.mx-flow { position: relative; list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.mx-rail { position: absolute; left: 21px; top: 22px; bottom: 22px; width: 2px; border-radius: 2px; background: var(--border); }
.mx-fill { position: absolute; inset: 0; border-radius: 2px; background: var(--accent); transform-origin: top; }
.mx-dot { display: none; position: absolute; left: -4px; top: 100%; width: 10px; height: 10px; margin-top: -5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 5px var(--accent-soft); }
.mx-s { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 14px; align-items: center; }
.mx-ic { position: relative; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent); }
.mx-s3 .mx-ic { border-color: var(--ok); background: var(--ok-soft); color: var(--ok); }
.mx-ring { position: absolute; inset: -1px; transform: rotate(-90deg); }
.mx-ring circle { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 126; stroke-dashoffset: 0; }
.mx-s p { margin: 0; min-width: 0; }
.mx-s b { display: block; font-size: 16px; line-height: 1.3; font-weight: 700; letter-spacing: -.01em; }
.mx-s p > span { display: block; margin-top: 2px; font-size: 14px; line-height: 1.4; color: var(--muted); }
.mx-num { color: var(--text); font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mx code, .mx-res code { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; color: var(--text); }
.mx-cent { margin: 18px 0 0; padding: 14px 16px; border: 1px dashed var(--bad); border-radius: 14px; background: var(--bad-soft); }
.mx-ch { margin: 0; display: flex; align-items: center; gap: 8px; color: var(--bad); font-size: 14px; } .mx-ch b { color: var(--text); }
.mx-amts { margin: 8px 0 0; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.mx-amts s { color: var(--muted); font-weight: 600; text-decoration-thickness: 2px; }
.mx-amts mark { padding: 0 2px; border-radius: 4px; background: var(--bad); color: var(--on-bad); }
.mx-res { margin: 8px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: start; color: var(--bad); font-size: 14px; line-height: 1.4; }
.mx-res .i { margin-top: 2px; } .mx-res b { color: var(--text); } .mx-res small { display: block; font-size: 13px; color: var(--muted); }
.mx figcaption { margin: 8px 0 0; display: flex; flex-wrap: wrap; align-items: center; column-gap: 6px; font-size: 14px; line-height: 1.4; color: var(--muted); }
.mx figcaption a { color: var(--accent); font-weight: 650; display: inline-flex; align-items: center; min-height: 44px; }
@media (max-width: 640px) { .mx-card { padding: 16px; } .mx-amts { font-size: 17px; } }
@media (prefers-reduced-motion: no-preference) {
  .mx-dot { display: block; animation: mx-dot ${LOOP}s cubic-bezier(.45, 0, .2, 1) infinite; }
  .mx-fill { animation: mx-fill ${LOOP}s cubic-bezier(.45, 0, .2, 1) infinite; }
${LIT.map((_, i) => `  .mx-s${i} .mx-ic { animation: mx-lit${i} ${LOOP}s ease-out infinite; }`).join("\n")}
  .mx-ring circle { animation: mx-ring ${LOOP}s ease-in-out infinite; }
  .mx-cent { animation: mx-cent ${LOOP}s ease-in-out infinite; }
  .mx-amts mark { animation: mx-mark ${LOOP}s ease-in-out infinite; }
}
@keyframes mx-dot { 0%, ${LIT[0]}% { top: 0; } ${LIT[3]}%, 100% { top: 100%; } }
@keyframes mx-fill { 0%, ${LIT[0]}% { transform: scaleY(0); } ${LIT[3]}%, 96% { transform: scaleY(1); } 100% { transform: scaleY(0); } }
${LIT.map((at, i) => {
  const [on, soft] = i === 3 ? ["var(--ok)", "var(--ok-soft)"] : ["var(--accent)", "var(--accent-soft)"];
  return `@keyframes mx-lit${i} { 0%, ${at}% { border-color: var(--border); background: var(--sunken); color: var(--muted); } ${at + 6}%, 96% { border-color: ${on}; background: ${soft}; color: ${on}; } 100% { border-color: var(--border); background: var(--sunken); color: var(--muted); } }`;
}).join("\n")}
@keyframes mx-ring { 0%, ${LIT[2]}% { stroke-dashoffset: 126; } ${LIT[2] + 12}%, 96% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: 126; } }
@keyframes mx-cent { 0%, ${CENT}% { border-color: var(--border); background: var(--bg); } ${CENT + 4}%, 96% { border-color: var(--bad); background: var(--bad-soft); } 100% { border-color: var(--border); background: var(--bg); } }
@keyframes mx-mark { 0%, ${CENT + 2}% { box-shadow: 0 0 0 0 transparent; } ${CENT + 6}% { box-shadow: 0 0 0 6px var(--bad-soft), 0 0 0 7px var(--bad); } ${CENT + 12}%, 100% { box-shadow: 0 0 0 0 transparent; } }
`;
