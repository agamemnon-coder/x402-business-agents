// Home's hero (home-story, 12 Nov): how Purser works in four steps, and the fourth is the visitor's own real check.
// Steps 1 to 3 play once from the Airwallex-only run's record (docs/demo/airwallex-run.json): 1 Ask: the Treasury agent
// asks to pay an invoice it may not pay alone. 2 Face ID: the CFO signs the exact terms on the phone; their hash types
// in. 3 Paid: Airwallex pays by SWIFT and carries that hash in its own record of the transfer. Then the hero rests on
// step 4 and waits: the phone shows the terms of a receipt file (src/redesign/heroReceipt.ts) and whether its signature
// is valid for them. "+1 cent", "Change the IBAN", "Reset" or typing another amount changes the terms in the page, and
// every change runs the real verification again in the browser with WebCrypto (VERIFY_CORE of src/try/verify.ts, the
// checks of `npm run verify-receipt`): canonical JSON of the terms as they now stand, its SHA-256, the hash the passkey
// signed, the ES256 signature, the RP id, user presence and verification. The verdict comes only from that check; there
// is no canned frame. No network, no Face ID, no navigation. Own design, Purser's tokens, a dark stage in both themes;
// CSS transitions and a few lines of script, no library. Reduced motion, or ?demo=N, shows one still frame (step 4 by
// default) with the controls working. Fixed sizes, so nothing moves around it while it plays or when the verdict changes.

import type { Awx1Record } from "../awx/scenario.js";
import { VERIFY_CORE } from "../try/verify.js";
import { CAVEAT_LINE } from "../config/brand.js";
import { awxRun } from "./awxRun.js";
import { heroReceipt, type HeroReceipt } from "./heroReceipt.js";
import { esc, icon } from "./ui.js";

export const DEMO_ID = "hero-demo";
/** The four tabs. The fourth is named after what the visitor does there (jury panel, A8: never a lowercase "refused"). */
export const DEMO_STEPS = ["Ask", "Face ID", "Paid", "+1 cent"] as const;
/** One short line per step, shown while it is current: what docs/runs/2026-11-07-awx-1.md and the record show. */
export const DEMO_LINES = [
  "The agent may not pay this alone. It asks.",
  "The CFO signs the exact terms with Face ID.",
  "Airwallex pays. The signed hash is in its record.",
  "Your turn: change one cent.",
] as const;
/** Step 4's verdicts, word for word; which one shows is the browser's check, nothing else. */
export const HERO_VERDICT = { valid: "Signature valid for these exact terms", refused: "Hash no longer matches" } as const;
const NO_WEBCRYPTO = "This browser offers no WebCrypto here, so it cannot check the signature.";

export interface HeroDemoFacts {
  invoice: string; amount: string; hash: string; transfer: string; agent: string;
  /** The day the run started, from its record: "7 November 2026". */
  date: string;
  /** The run's own check found the approval hash in Airwallex's record of this transfer (its verify line). */
  inRecord: boolean;
}

/** The facts steps 1 to 3 show, from the record; null when one is missing or they do not belong together. */
export function heroDemoFacts(rec: Awx1Record | null = awxRun()): HeroDemoFacts | null {
  const inv = rec?.invoices.find((i) => i.status === "PAID" && !i.quote && !!i.transfer_id);
  const p = inv ? rec!.proposals.find((x) => x.proposal_id === inv.proposal_id) : undefined;
  const at = rec?.attempts[0]?.at;
  if (!rec || !inv || !p || !at || p.method !== "passkey" || p.created_by !== "treasury" || inv.approval_sha256 !== p.terms_sha256 || !inv.transfer_id) return null;
  return {
    invoice: inv.invoice_no, amount: inv.amount, hash: inv.approval_sha256, transfer: inv.transfer_id, agent: "Treasury agent",
    date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(at)),
    inRecord: rec.verify.some((v) => v.level === "ok" && v.what.includes(inv.transfer_id!) && /approval hash in metadata/.test(v.detail)),
  };
}

/**
 * Home's one provenance line, in three parts: where steps 1 to 3 come from (the date from the record), the caveat word
 * for word, and what step 4 is, which follows the receipt file (the recorded approval itself, or a labelled sample).
 */
export function heroProvenance(f: HeroDemoFacts, r: HeroReceipt): string[] {
  return [
    `Steps 1 to 3: recorded on ${f.date} in the Airwallex sandbox.`,
    CAVEAT_LINE,
    r.kind === "recorded" ? "Step 4 checks that signature in your browser." : "Step 4 runs in your browser, on a copy of these terms signed with a test key.",
  ];
}

const FACE = `<svg class="hd-fid" viewBox="0 0 64 64" aria-hidden="true">
<circle class="hd-ring" cx="32" cy="32" r="29"/>
<g class="hd-glyph"><path d="M14 22v-4a4 4 0 0 1 4-4h4M42 14h4a4 4 0 0 1 4 4v4M50 42v4a4 4 0 0 1-4 4h-4M22 50h-4a4 4 0 0 1-4-4v-4"/><path d="M25 26v3M39 26v3M32 27v8h-2M26 41c3.5 3 8.5 3 12 0"/></g>
<path class="hd-check" d="M20 33l8 8 16-17"/></svg>`;

const short = (s: string, n: number) => `${s.slice(0, n)}…`;

/**
 * The hero's markup. Steps 1 to 3 show the record's facts (f); everything step 4 shows comes from the receipt (r): the
 * invoice, the payee, the amount with its currency, the IBAN's last four and the hash the passkey signed. Empty when
 * either is missing: no record, no hero; no valid receipt for that record, no hero.
 */
export function heroDemoHtml(f: HeroDemoFacts | null = heroDemoFacts(), r: HeroReceipt | null = heroReceipt(f)): string {
  if (!f || !r) return "";
  const t = r.shown, signed = r.data.terms_sha256;
  return `<figure class="hd" id="${DEMO_ID}" data-phase="4" data-verdict="valid" data-amount="${esc(f.amount)}" data-hash="${esc(short(f.hash, 16))}" aria-label="${esc(`How Purser works, in four steps. The ${f.agent} asks to pay invoice ${f.invoice}, ${t.currency} ${f.amount}. The CFO signs the exact terms with Face ID. Airwallex pays by SWIFT, with the terms hash in its own record. Then you change one cent, and the signature no longer matches.`)}">
<ol class="hd-steps">${DEMO_STEPS.map((s, i) => `<li data-p="${i + 1}"><span>${i + 1}</span>${esc(s)}</li>`).join("")}</ol>
<div class="hd-lines">${DEMO_LINES.map((l, i) => `<p data-p="${i + 1}">${esc(l)}</p>`).join("")}</div>
<div class="hd-stage">
  <div class="hd-flow" aria-hidden="true">
    <div class="hd-node n1">${icon("landmark", 18)}<b>${esc(f.agent)}</b><small>Claude</small></div>
    <i class="hd-seg s1"><i></i></i>
    <div class="hd-node n2">${icon("shield-check", 18)}<b>Purser</b><small>CFO policy</small></div>
    <i class="hd-seg s2"><i></i></i>
    <div class="hd-node n3">${icon("credit-card", 18)}<b>Airwallex</b><small>SWIFT payout</small></div>
  </div>
  <div class="hd-phone"><div class="hd-screen">
    <p class="hd-k">Pay invoice <b>${esc(t.invoice)}</b></p>
    <p class="hd-to">${esc(t.payee)}</p>
    <label class="hd-amt"><span>${esc(t.currency)}</span> <b class="hd-num">${esc(f.amount)}</b> <input class="hd-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="12" value="${esc(t.amount)}" aria-label="${esc(`Amount in ${t.currency}`)}"></label>
    <p class="hd-iban">IBAN <b>····${esc(t.ibanLast4)}</b></p>
    ${FACE}
    <p class="hd-hash"><span>terms hash</span><code class="hd-code">${esc(short(f.hash, 16))}</code></p>
    <p class="hd-st s1">Waiting for the CFO</p>
    <p class="hd-st s2">Approved with Face ID</p>
    <p class="hd-st hd-paid">${icon("circle-check", 14)}Paid · <code>${esc(short(f.transfer, 8))}</code></p>
    <p class="hd-verdict" role="status" aria-live="polite">${esc(HERO_VERDICT.valid)}</p>
    <p class="hd-stamp" aria-hidden="true">Refused</p>
  </div></div>
</div>
<p class="hd-hashes"><span>Signed <code class="hd-signed" title="${esc(signed)}">${esc(short(signed, 16))}</code></span><span>Now <code class="hd-now" title="${esc(signed)}">${esc(short(signed, 16))}</code></span></p>
<div class="hd-ctl"><button type="button" class="hd-btn go" data-act="cent">+1 cent</button><button type="button" class="hd-btn" data-act="iban">Change the IBAN</button><button type="button" class="hd-btn" data-act="reset">Reset</button></div>
</figure>`;
}

const EASE = "cubic-bezier(.22,1,.36,1)";
const AT = (n: number, sel: string) => `.hd[data-phase="${n}"] ${sel}`;
export const HERO_DEMO_CSS = `.hd { --hd-bg: #0b0d18; --hd-ink: #eef0ff; --hd-dim: #8d93b3; --hd-line: #262a45; --hd-acc: #8b85ff; --hd-ok: #3ccf82; --hd-bad: #ff5d68; --hd-awx: #ff8a4c;
  position: relative; margin: 0; padding: 16px; border-radius: 24px; border: 1px solid rgba(255,255,255,.07); color: var(--hd-ink); overflow: hidden; isolation: isolate;
  background: radial-gradient(120% 90% at 85% 0%, rgba(139,133,255,.28), transparent 55%), radial-gradient(90% 70% at 0% 100%, rgba(255,138,76,.16), transparent 60%), var(--hd-bg);
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 30px 60px -30px rgba(20,16,80,.55); }
.hd::before { content: ""; position: absolute; inset: 0; z-index: -1; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(80% 70% at 60% 40%, #000, transparent); }
.hd-steps { list-style: none; margin: 0 0 10px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.hd-steps li { position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 8px 9px; border-radius: 10px; font-size: 12.5px; font-weight: 650; color: var(--hd-dim); background: rgba(255,255,255,.03); white-space: nowrap; overflow: hidden; transition: color .4s ${EASE}, background .4s ${EASE}; }
.hd-steps span { display: grid; place-items: center; width: 18px; height: 18px; flex: none; border-radius: 50%; font-size: 11px; background: rgba(255,255,255,.08); transition: background .4s ${EASE}; }
.hd-steps li::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: 3px; height: 2px; border-radius: 2px; background: var(--hd-acc); transform: scaleX(0); transform-origin: left; }
${[1, 2, 3, 4].map((n) => AT(n, `.hd-steps [data-p="${n}"]`)).join(", ")} { color: var(--hd-ink); background: rgba(139,133,255,.14); }
${[1, 2, 3, 4].map((n) => AT(n, `.hd-steps [data-p="${n}"] span`)).join(", ")} { background: var(--hd-acc); color: #0b0d18; }
${[1, 2, 3].map((n) => `.hd.run[data-phase="${n}"] [data-p="${n}"]::after`).join(", ")} { animation: hd-bar 3.2s linear forwards; }
.hd[data-phase="4"][data-verdict="refused"] .hd-steps [data-p="4"] { background: rgba(255,93,104,.16); } .hd[data-phase="4"][data-verdict="refused"] .hd-steps [data-p="4"] span { background: var(--hd-bad); }
@keyframes hd-bar { to { transform: scaleX(1); } }
/* One short line per step, all in one cell, so the hero keeps its height whichever shows. */
.hd-lines { display: grid; margin: 0 2px 10px; }
.hd-lines p { grid-area: 1 / 1; margin: 0; font-size: 14.5px; line-height: 1.4; font-weight: 600; visibility: hidden; opacity: 0; transition: opacity .4s ${EASE}; }
${[1, 2, 3, 4].map((n) => AT(n, `.hd-lines [data-p="${n}"]`)).join(", ")} { visibility: visible; opacity: 1; }
.hd-stage { display: grid; grid-template-columns: minmax(0, 1fr) 196px; gap: 14px; align-items: center; height: 330px; }
.hd-flow { display: grid; grid-template-rows: auto 1fr auto 1fr auto; height: 100%; padding: 6px 0; }
.hd-node { display: grid; grid-template-columns: 30px minmax(0, 1fr); column-gap: 10px; align-items: center; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--hd-line); background: rgba(255,255,255,.03); opacity: .45; transition: opacity .5s ${EASE}, border-color .5s ${EASE}, box-shadow .5s ${EASE}, transform .5s ${EASE}; }
.hd-node svg { grid-row: span 2; width: 30px; height: 30px; padding: 6px; border-radius: 9px; background: rgba(139,133,255,.16); color: var(--hd-acc); box-sizing: border-box; }
.hd-node.n3 svg { background: rgba(255,138,76,.16); color: var(--hd-awx); }
.hd-node b { font-size: 14.5px; line-height: 1.2; } .hd-node small { font-size: 12px; color: var(--hd-dim); }
.hd-seg { position: relative; justify-self: start; margin-left: 26px; width: 2px; background: var(--hd-line); border-radius: 2px; }
.hd-seg > i { position: absolute; inset: 0; border-radius: 2px; background: linear-gradient(var(--hd-acc), #c4b5fd); transform: scaleY(0); transform-origin: top; transition: transform .9s ${EASE}; box-shadow: 0 0 12px rgba(139,133,255,.8); }
.hd-seg.s2 > i { background: linear-gradient(var(--hd-acc), var(--hd-awx)); box-shadow: 0 0 12px rgba(255,138,76,.7); }
.hd-seg::after { content: ""; position: absolute; left: -4px; top: 0; width: 10px; height: 10px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 4px rgba(139,133,255,.35), 0 0 18px 4px rgba(139,133,255,.9); opacity: 0; }
.hd[data-phase="1"] .n1, .hd[data-phase="2"] .n1, .hd[data-phase="2"] .n2, .hd[data-phase="3"] .n1, .hd[data-phase="3"] .n2, .hd[data-phase="3"] .n3, .hd[data-phase="4"] .n1, .hd[data-phase="4"] .n2, .hd[data-phase="4"] .n3 { opacity: 1; }
.hd[data-phase="1"] .n1, .hd[data-phase="2"] .n2 { border-color: rgba(139,133,255,.6); box-shadow: 0 0 0 4px rgba(139,133,255,.1), 0 10px 30px -10px rgba(139,133,255,.6); transform: translateX(4px); }
.hd[data-phase="3"] .n3 { border-color: rgba(255,138,76,.6); box-shadow: 0 0 0 4px rgba(255,138,76,.1), 0 10px 30px -10px rgba(255,138,76,.55); transform: translateX(4px); }
.hd[data-phase="4"][data-verdict="refused"] .n2 { border-color: rgba(255,93,104,.6); box-shadow: 0 0 0 4px rgba(255,93,104,.12); }
.hd[data-phase="1"] .s1 > i, .hd[data-phase="2"] .s1 > i, .hd[data-phase="3"] .s1 > i, .hd[data-phase="4"] .s1 > i, .hd[data-phase="3"] .s2 > i, .hd[data-phase="4"] .s2 > i { transform: scaleY(1); }
.hd.run[data-phase="1"] .s1::after, .hd.run[data-phase="3"] .s2::after { animation: hd-pulse 1.1s ${EASE} .15s 2 both; }
@keyframes hd-pulse { 0% { top: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: calc(100% - 10px); opacity: 0; } }
.hd-phone { position: relative; height: 318px; border-radius: 34px; padding: 9px; background: linear-gradient(160deg, #2b2f4a, #12142a 60%); box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 24px 50px -20px rgba(0,0,0,.8), 0 0 60px -10px rgba(139,133,255,.35); }
.hd-phone::before { content: ""; position: absolute; top: 15px; left: 50%; width: 54px; height: 16px; margin-left: -27px; border-radius: 10px; background: #05060c; z-index: 2; }
.hd-screen { position: relative; height: 100%; border-radius: 26px; padding: 40px 12px 14px; background: linear-gradient(180deg, #151833, #0d0f20); display: flex; flex-direction: column; align-items: center; text-align: center; overflow: hidden; }
.hd-screen p { line-height: 1.3; }
.hd-k { margin: 0; font-size: 11.5px; color: var(--hd-dim); letter-spacing: .02em; } .hd-k b { display: block; color: var(--hd-ink); font-size: 13px; font-weight: 650; }
.hd-to { margin: 2px 0 0; font-size: 12px; color: var(--hd-dim); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hd-amt { position: relative; display: flex; align-items: center; justify-content: center; gap: 4px; margin: 4px 0 0; height: 44px; width: 100%; font-size: 12px; color: var(--hd-dim); font-weight: 650; }
.hd-amt b, .hd-in { font: 760 26px/1 Inter, system-ui, sans-serif; color: var(--hd-ink); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
/* The amount as a field (step 4): a thumb can hit it, and its edge says it can be typed in. */
.hd-in { width: 108px; height: 44px; min-width: 0; padding: 0 4px; text-align: center; border-radius: 10px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.06); transition: color .25s ${EASE}, border-color .25s ${EASE}; }
.hd-iban { margin: 4px 0 0; font-size: 12px; color: var(--hd-dim); } .hd-iban b { color: var(--hd-ink); font-weight: 650; font-variant-numeric: tabular-nums; transition: color .25s ${EASE}; }
.hd-btn:focus-visible, .hd-in:focus-visible { outline: 3px solid #c4b5fd; outline-offset: 2px; }
/* Steps 1 to 3 show the record: the amount as text, the Face ID glyph, the hash. Step 4 shows the receipt's terms. */
.hd[data-phase="4"] .hd-num, .hd[data-phase="4"] .hd-fid, .hd[data-phase="4"] .hd-hash, .hd[data-phase="4"] .hd-st { display: none; }
.hd:not([data-phase="4"]) .hd-in, .hd:not([data-phase="4"]) .hd-to, .hd:not([data-phase="4"]) .hd-iban, .hd:not([data-phase="4"]) .hd-verdict, .hd:not([data-phase="4"]) .hd-stamp { display: none; }
.hd:not([data-phase="4"]) .hd-hashes { visibility: hidden; }
.hd-fid { width: 64px; height: 64px; margin: 12px 0 6px; fill: none; stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
.hd-ring { stroke: var(--hd-acc); stroke-width: 2.5; stroke-dasharray: 46 136; transform-origin: 32px 32px; opacity: 0; transition: opacity .3s; }
.hd-glyph { stroke: var(--hd-dim); stroke-width: 2.6; transition: stroke .4s, opacity .4s; }
.hd-check { stroke: var(--hd-ok); stroke-width: 4; stroke-dasharray: 40; stroke-dashoffset: 40; transition: stroke-dashoffset .6s ${EASE}; }
.hd.run[data-phase="2"] .hd-ring { opacity: 1; animation: hd-spin 1s linear 0s 2, hd-fade .3s 1.7s forwards; }
.hd.run[data-phase="2"] .hd-glyph { stroke: var(--hd-acc); }
.hd[data-phase="2"] .hd-glyph, .hd[data-phase="3"] .hd-glyph { opacity: .0; }
.hd.run[data-phase="2"] .hd-glyph { opacity: 1; animation: hd-fade .3s 1.7s forwards; }
.hd[data-phase="2"] .hd-check, .hd[data-phase="3"] .hd-check { stroke-dashoffset: 0; }
.hd.run[data-phase="2"] .hd-check { transition-delay: 1.8s; }
@keyframes hd-spin { to { transform: rotate(360deg); } } @keyframes hd-fade { to { opacity: 0; } }
.hd-hash { margin: 4px 0 0; font-size: 10.5px; color: var(--hd-dim); opacity: 0; transition: opacity .4s ${EASE}; }
.hd-hash span { display: block; text-transform: uppercase; letter-spacing: .08em; font-size: 9.5px; }
.hd code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #c4b5fd; }
.hd[data-phase="2"] .hd-hash, .hd[data-phase="3"] .hd-hash { opacity: 1; }
.hd-st, .hd-verdict { position: absolute; left: 50%; bottom: 16px; margin: 0; padding: 6px 11px; border-radius: 14px; font-size: 12px; font-weight: 650; transform: translate(-50%, 0); }
.hd-st { display: flex; align-items: center; gap: 5px; white-space: nowrap; opacity: 0; transform: translate(-50%, 10px); transition: opacity .5s ${EASE}, transform .5s ${EASE}; }
.hd-st.s1 { color: #ffc46b; background: rgba(255,196,107,.12); } .hd-st.s2 { color: #c4b5fd; background: rgba(139,133,255,.16); }
.hd-paid { color: var(--hd-ok); background: rgba(60,207,130,.12); } .hd-paid code { color: var(--hd-ok); }
.hd[data-phase="1"] .s1, .hd[data-phase="2"] .s2, .hd[data-phase="3"] .hd-paid { opacity: 1; transform: translate(-50%, 0); }
.hd.run[data-phase="2"] .s2 { transition-delay: 1.9s; }
/* Step 4's verdict: what the browser's check just said, nothing else. */
.hd-verdict { width: calc(100% - 20px); color: var(--hd-ok); background: rgba(60,207,130,.12); }
.hd[data-verdict="refused"] .hd-verdict { color: var(--hd-bad); background: rgba(255,93,104,.14); }
.hd[data-verdict="none"] .hd-verdict { color: #ffc46b; background: rgba(255,196,107,.12); font-weight: 600; }
.hd[data-verdict="refused"] .hd-in { color: var(--hd-bad); border-color: rgba(255,93,104,.7); }
.hd.iban .hd-iban b { color: var(--hd-bad); }
.hd-stamp { position: absolute; left: 50%; top: 67%; margin: 0; padding: 5px 12px; border: 3px solid var(--hd-bad); border-radius: 10px; color: var(--hd-bad); font-size: 19px; font-weight: 820; letter-spacing: .14em; text-transform: uppercase; background: rgba(11,13,24,.82); opacity: 0; transform: translate(-50%, -50%) rotate(-12deg) scale(1.6); transition: opacity .25s ${EASE}, transform .45s ${EASE}; pointer-events: none; }
.hd[data-verdict="refused"] .hd-stamp { opacity: 1; transform: translate(-50%, -50%) rotate(-12deg) scale(1); transition-delay: .3s; }
.hd.shake .hd-phone { animation: hd-shake .5s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes hd-shake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(3px); } 30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); } }
/* Both hashes, short in sight and whole in the title: the one the passkey signed, and the terms' own as they now stand. */
.hd-hashes { display: flex; flex-wrap: wrap; gap: 2px 18px; margin: 12px 2px 0; font-size: 12.5px; font-weight: 600; color: var(--hd-dim); }
.hd-hashes span { display: inline-grid; grid-template-columns: 3.4em auto; align-items: baseline; white-space: nowrap; }
.hd[data-verdict="refused"] .hd-now { color: var(--hd-bad); }
/* The controls: the widget's own, each a thumb's size. */
.hd-ctl { display: grid; grid-template-columns: 1fr 1.5fr 1fr; gap: 8px; margin-top: 10px; }
.hd-btn { height: 44px; min-width: 0; padding: 0 6px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.06); color: var(--hd-ink); font: 650 14px/1 Inter, system-ui, sans-serif; white-space: nowrap; cursor: pointer; transition: background .2s, border-color .2s; }
.hd-btn:hover { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.3); }
.hd-btn.go { background: var(--hd-acc); border-color: var(--hd-acc); color: #0b0d18; font-weight: 750; }
.hd-btn.go:hover { background: #a39eff; border-color: #a39eff; }
@media (max-width: 480px) { .hd { padding: 12px; } .hd-stage { grid-template-columns: minmax(0, 1fr) 172px; gap: 10px; height: 300px; } .hd-phone { height: 292px; } .hd-node { padding: 8px 9px; column-gap: 8px; grid-template-columns: 26px minmax(0, 1fr); } .hd-node svg { width: 26px; height: 26px; padding: 5px; } .hd-node b { font-size: 13px; } .hd-steps li { font-size: 11.5px; padding: 6px 5px 8px; gap: 4px; } .hd-amt b, .hd-in { font-size: 23px; } .hd-in { width: 96px; } .hd-fid { width: 50px; height: 50px; margin: 6px 0 2px; } .hd-screen { padding: 36px 9px 12px; } .hd-st, .hd-verdict { bottom: 12px; font-size: 11.5px; padding: 6px 8px; } .hd-verdict { width: calc(100% - 14px); } .hd-btn { font-size: 13px; } .hd-lines p { font-size: 14px; } }
@media (prefers-reduced-motion: reduce) { .hd *, .hd *::before, .hd *::after { transition: none !important; animation: none !important; } }`;

/**
 * The hero's own few lines around VERIFY_CORE (browser JavaScript; no backticks, it lives in a template string):
 * heroCheck(receipt, edit) changes the amount and the IBAN's last four in a copy of the receipt's terms, runs
 * verifyReceiptWeb on it, and returns the verdict with both hashes: the one the passkey signed (the challenge in its
 * client data) and the SHA-256 of the canonical terms as they now stand. test/hero-demo.test.ts runs it in Node.
 */
export const HERO_CHECK_JS = `
function heroSigned(r) { try { return hexOf(b64uBytes(JSON.parse(new TextDecoder().decode(b64uBytes(r.assertion.clientDataJSON))).challenge)); } catch (e) { return ""; } }
function heroPlusCent(a) { var m = /^(\\d+)\\.(\\d\\d)$/.exec(a); if (!m) return null; var n = Number(m[1]) * 100 + Number(m[2]) + 1; return Math.floor(n / 100) + "." + String(n % 100).padStart(2, "0"); }
function heroOtherIban(s) { var d = s.slice(-1); return s.slice(0, -1) + (/\\d/.test(d) ? String((Number(d) + 1) % 10) : "0"); }
function heroCheck(r, edit) {
  var terms = JSON.parse(JSON.stringify(r.terms)), mine = {}, k;
  if (edit && edit.amount !== undefined) terms.amount = edit.amount;
  if (edit && edit.iban_last4 !== undefined) terms.iban_last4 = edit.iban_last4;
  for (k in r) mine[k] = r[k];
  mine.terms = terms;
  return Promise.all([verifyReceiptWeb(mine), digest(utf8(canonicalTerms(terms))).then(hexOf)]).then(function (x) {
    return { ok: x[0].ok, failed: x[0].checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.check; }), signed: heroSigned(r), now: x[1], terms: terms };
  });
}`;

/**
 * The player and the controls. Steps 1 to 3 play once (3.2 s each: the amount counts up, the hash types in) when the
 * hero comes into view, then it rests on step 4; a control used at any moment goes straight to step 4. Every change
 * runs heroCheck again; a slower, older check never overwrites a newer result (seq).
 */
export const HERO_DEMO_JS = `
(function () {
  var box = document.getElementById("${DEMO_ID}"), blob = document.getElementById("run-data");
  if (!box || !blob) return;
  var R = JSON.parse(blob.textContent);
  ${VERIFY_CORE}
  ${HERO_CHECK_JS}
  var $ = function (s) { return box.querySelector(s); };
  var num = $(".hd-num"), code = $(".hd-code"), input = $(".hd-in"), ibanEl = $(".hd-iban b"), verdict = $(".hd-verdict"), signedEl = $(".hd-signed"), nowEl = $(".hd-now");
  var amount = box.getAttribute("data-amount") || "", hash = box.getAttribute("data-hash") || "";
  var signed = { amount: String(R.terms.amount), iban: String(R.terms.iban_last4) }, iban = signed.iban;
  var TXT = ${JSON.stringify({ ...HERO_VERDICT, none: NO_WEBCRYPTO })};
  var seq = 0, timers = [], raf = 0, started = false;
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function phase(n, run) { box.classList.remove("run"); if (run) { void box.offsetWidth; box.classList.add("run"); } box.setAttribute("data-phase", String(n)); }
  function stop() { timers.forEach(clearTimeout); timers = []; if (raf) cancelAnimationFrame(raf); raf = 0; num.textContent = amount; code.textContent = hash; }
  function rest() { started = true; stop(); if (box.getAttribute("data-phase") !== "4") phase(4, false); }
  function short(h) { return h.slice(0, 16) + "…"; }
  function none() { box.setAttribute("data-verdict", "none"); box.classList.remove("shake"); verdict.textContent = TXT.none; }
  function show(v) {
    box.setAttribute("data-verdict", v.ok ? "valid" : "refused");
    signedEl.textContent = short(v.signed); signedEl.title = v.signed;
    nowEl.textContent = short(v.now); nowEl.title = v.now;
    box.classList.remove("shake");
    if (v.ok) { verdict.textContent = TXT.valid; return; }
    // Said aloud as "Refused." first; in sight that word is the stamp.
    var said = document.createElement("span"); said.className = "vh"; said.textContent = "Refused. ";
    verdict.textContent = ""; verdict.appendChild(said);
    verdict.appendChild(document.createTextNode(v.failed.indexOf("terms hash") >= 0 ? TXT.refused : "The " + v.failed[0] + " check fails"));
    void box.offsetWidth; box.classList.add("shake");
  }
  // The real check, every time; only the newest answer is shown.
  function check() {
    var id = ++seq;
    if (!window.crypto || !crypto.subtle) { none(); return; }
    heroCheck(R, { amount: input.value.trim(), iban_last4: iban }).then(function (v) { if (id === seq) show(v); }, function () { if (id === seq) none(); });
  }
  function edit(act) {
    rest();
    if (act === "cent") input.value = heroPlusCent(input.value.trim()) || heroPlusCent(signed.amount) || signed.amount + "1";
    else if (act === "iban") iban = heroOtherIban(iban);
    else if (act === "reset") { input.value = signed.amount; iban = signed.iban; }
    ibanEl.textContent = "····" + iban;
    box.classList.toggle("iban", iban !== signed.iban);
    check();
  }
  box.addEventListener("click", function (e) { var b = e.target && e.target.closest ? e.target.closest("[data-act]") : null; if (b) edit(b.getAttribute("data-act")); });
  input.addEventListener("input", function () { edit("type"); });
  function count() {
    var to = parseFloat(amount), t0 = 0;
    num.textContent = "0.00";
    function tick(ts) { if (!t0) t0 = ts; var k = Math.min(1, (ts - t0) / 900), e = 1 - Math.pow(1 - k, 3); num.textContent = (to * e).toFixed(2); raf = k < 1 ? requestAnimationFrame(tick) : 0; }
    raf = requestAnimationFrame(tick);
  }
  function type(i) { code.textContent = hash.slice(0, i); if (i < hash.length) later(function () { type(i + 1); }, 45); }
  function play(n) {
    if (n > 3) { rest(); return; }
    phase(n, true);
    if (n === 1) { code.textContent = ""; count(); }
    if (n === 2) later(function () { type(1); }, 1700);
    later(function () { play(n + 1); }, 3200);
  }
  check();
  var q = /[?&]demo=([1-4])/.exec(location.search);
  if (q) { started = true; phase(+q[1], false); return; }
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  function begin() { if (!started) { started = true; play(1); } }
  if (!("IntersectionObserver" in window)) { begin(); return; }
  var io = new IntersectionObserver(function (es) { if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); begin(); } }, { threshold: 0.5 });
  io.observe(box);
})();`;
