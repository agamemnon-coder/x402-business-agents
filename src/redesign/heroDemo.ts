// Home's hero demo (Max, 10 Nov): the invoice story in four steps, looping in about 15 seconds, every figure from the
// Airwallex-only run's record (docs/demo/airwallex-run.json). 1 Ask: the Treasury agent asks to pay an invoice it may
// not pay alone. 2 Face ID: the CFO approves the exact terms on the phone; their hash types in. 3 Paid: Purser hands
// the payout to Airwallex, which carries that hash in its own record of the SWIFT transfer (settlement simulated in the
// sandbox). 4 Tamper refused: one cent changed and the hash no longer matches. Step 4 is the check every payment runs,
// not a recorded event, and the caption says so; /try/sign is where a visitor does it. Own design, Purser's tokens, a
// dark stage in both themes; CSS transitions and a few lines of script, no library. Reduced motion, or ?demo=N, shows
// one still frame (the last by default). Fixed sizes, so nothing moves around it.

import type { Awx1Record } from "../awx/scenario.js";
import { awxRun } from "./awxRun.js";
import { esc, icon } from "./ui.js";

export const DEMO_ID = "hero-demo";
export const DEMO_STEPS = ["Ask", "Face ID", "Paid", "Tamper refused"] as const;
export const DEMO_LABEL = "Recorded run · Airwallex sandbox · test money";

export interface HeroDemoFacts { invoice: string; amount: string; tampered: string; hash: string; transfer: string; day: string; agent: string }

/** The facts the demo shows, from the record; null when one is missing or they do not belong together. */
export function heroDemoFacts(rec: Awx1Record | null = awxRun()): HeroDemoFacts | null {
  const inv = rec?.invoices.find((i) => i.status === "PAID" && !i.quote && !!i.transfer_id);
  const p = inv ? rec!.proposals.find((x) => x.proposal_id === inv.proposal_id) : undefined;
  if (!rec || !inv || !p || p.method !== "passkey" || p.created_by !== "treasury" || inv.approval_sha256 !== p.terms_sha256 || !inv.transfer_id) return null;
  const cents = Math.round(Number(inv.amount) * 100) + 1;
  const at = rec.attempts[0]?.at;
  return {
    invoice: inv.invoice_no, amount: inv.amount, tampered: (cents / 100).toFixed(2), hash: inv.approval_sha256, transfer: inv.transfer_id,
    day: at ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(at)) : "", agent: "Treasury agent",
  };
}

const FACE = `<svg class="hd-fid" viewBox="0 0 64 64" aria-hidden="true">
<circle class="hd-ring" cx="32" cy="32" r="29"/>
<g class="hd-glyph"><path d="M14 22v-4a4 4 0 0 1 4-4h4M42 14h4a4 4 0 0 1 4 4v4M50 42v4a4 4 0 0 1-4 4h-4M22 50h-4a4 4 0 0 1-4-4v-4"/><path d="M25 26v3M39 26v3M32 27v8h-2M26 41c3.5 3 8.5 3 12 0"/></g>
<path class="hd-check" d="M20 33l8 8 16-17"/></svg>`;

export function heroDemoHtml(f: HeroDemoFacts | null = heroDemoFacts(), tryHref = "try/sign"): string {
  if (!f) return "";
  const short = (s: string, n: number) => `${s.slice(0, n)}…`;
  return `<figure class="hd" id="${DEMO_ID}" data-phase="4" data-amount="${esc(f.amount)}" data-hash="${esc(short(f.hash, 16))}" aria-label="${esc(`${DEMO_LABEL}: the ${f.agent} asks to pay invoice ${f.invoice}, EUR ${f.amount}; the CFO approves the exact terms with Face ID; Airwallex pays by SWIFT with the terms hash in its own record; changing one cent is refused.`)}">
<ol class="hd-steps">${DEMO_STEPS.map((s, i) => `<li data-p="${i + 1}"><span>${i + 1}</span>${s === "Tamper refused" ? `<em>Tamper </em>refused` : esc(s)}</li>`).join("")}</ol>
<div class="hd-stage">
  <div class="hd-flow" aria-hidden="true">
    <div class="hd-node n1">${icon("landmark", 18)}<b>${esc(f.agent)}</b><small>Claude</small></div>
    <i class="hd-seg s1"><i></i></i>
    <div class="hd-node n2">${icon("shield-check", 18)}<b>Purser</b><small>CFO policy</small></div>
    <i class="hd-seg s2"><i></i></i>
    <div class="hd-node n3">${icon("credit-card", 18)}<b>Airwallex</b><small>SWIFT payout</small></div>
  </div>
  <div class="hd-phone"><div class="hd-screen">
    <p class="hd-k">Pay invoice <b>${esc(f.invoice)}</b></p>
    <p class="hd-amt">EUR <b class="hd-num">${esc(f.amount)}</b><b class="hd-bad">${esc(f.tampered)}</b></p>
    ${FACE}
    <p class="hd-hash"><span>terms hash</span><code class="hd-code">${esc(short(f.hash, 16))}</code></p>
    <p class="hd-st s1">Waiting for the CFO</p>
    <p class="hd-st s2">Approved with Face ID</p>
    <p class="hd-st hd-paid">${icon("circle-check", 14)}Paid · <code>${esc(short(f.transfer, 8))}</code></p>
    <p class="hd-st s4">Hash no longer matches</p>
    <p class="hd-stamp">Refused</p>
  </div></div>
</div>
<figcaption>${esc(`${DEMO_LABEL}${f.day ? `, ${f.day}` : ""}. Step 4 is the check every payment runs.`)} <a href="${esc(tryHref)}">Try it yourself →</a></figcaption>
</figure>`;
}

const EASE = "cubic-bezier(.22,1,.36,1)";
export const HERO_DEMO_CSS = `.hd { --hd-bg: #0b0d18; --hd-ink: #eef0ff; --hd-dim: #8d93b3; --hd-line: #262a45; --hd-acc: #8b85ff; --hd-ok: #3ccf82; --hd-bad: #ff5d68; --hd-awx: #ff8a4c;
  position: relative; margin: 0; padding: 16px; border-radius: 24px; border: 1px solid rgba(255,255,255,.07); color: var(--hd-ink); overflow: hidden; isolation: isolate;
  background: radial-gradient(120% 90% at 85% 0%, rgba(139,133,255,.28), transparent 55%), radial-gradient(90% 70% at 0% 100%, rgba(255,138,76,.16), transparent 60%), var(--hd-bg);
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 30px 60px -30px rgba(20,16,80,.55); }
.hd::before { content: ""; position: absolute; inset: 0; z-index: -1; background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(80% 70% at 60% 40%, #000, transparent); }
.hd-steps { list-style: none; margin: 0 0 14px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.hd-steps li { position: relative; display: flex; align-items: center; gap: 6px; padding: 7px 8px 9px; border-radius: 10px; font-size: 12.5px; font-weight: 650; color: var(--hd-dim); background: rgba(255,255,255,.03); white-space: nowrap; overflow: hidden; transition: color .4s ${EASE}, background .4s ${EASE}; }
.hd-steps em { font-style: normal; }
.hd-steps span { display: grid; place-items: center; width: 18px; height: 18px; flex: none; border-radius: 50%; font-size: 11px; background: rgba(255,255,255,.08); transition: background .4s ${EASE}; }
.hd-steps li::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: 3px; height: 2px; border-radius: 2px; background: var(--hd-acc); transform: scaleX(0); transform-origin: left; }
.hd[data-phase="1"] [data-p="1"], .hd[data-phase="2"] [data-p="2"], .hd[data-phase="3"] [data-p="3"], .hd[data-phase="4"] [data-p="4"] { color: var(--hd-ink); background: rgba(139,133,255,.14); }
.hd[data-phase="1"] [data-p="1"] span, .hd[data-phase="2"] [data-p="2"] span, .hd[data-phase="3"] [data-p="3"] span { background: var(--hd-acc); color: #0b0d18; }
.hd[data-phase="4"] [data-p="4"] { background: rgba(255,93,104,.16); } .hd[data-phase="4"] [data-p="4"] span { background: var(--hd-bad); color: #0b0d18; }
.hd.run[data-phase="1"] [data-p="1"]::after, .hd.run[data-phase="2"] [data-p="2"]::after, .hd.run[data-phase="3"] [data-p="3"]::after, .hd.run[data-phase="4"] [data-p="4"]::after { animation: hd-bar 3.4s linear forwards; }
.hd[data-phase="4"] [data-p="4"]::after { background: var(--hd-bad); }
@keyframes hd-bar { to { transform: scaleX(1); } }
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
.hd[data-phase="4"] .n2 { border-color: rgba(255,93,104,.6); box-shadow: 0 0 0 4px rgba(255,93,104,.12); }
.hd[data-phase="1"] .s1 > i, .hd[data-phase="2"] .s1 > i, .hd[data-phase="3"] .s1 > i, .hd[data-phase="4"] .s1 > i, .hd[data-phase="3"] .s2 > i, .hd[data-phase="4"] .s2 > i { transform: scaleY(1); }
.hd.run[data-phase="1"] .s1::after, .hd.run[data-phase="3"] .s2::after { animation: hd-pulse 1.1s ${EASE} .15s 2 both; }
@keyframes hd-pulse { 0% { top: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { top: calc(100% - 10px); opacity: 0; } }
.hd-phone { position: relative; height: 318px; border-radius: 34px; padding: 9px; background: linear-gradient(160deg, #2b2f4a, #12142a 60%); box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 24px 50px -20px rgba(0,0,0,.8), 0 0 60px -10px rgba(139,133,255,.35); }
.hd-phone::before { content: ""; position: absolute; top: 15px; left: 50%; width: 54px; height: 16px; margin-left: -27px; border-radius: 10px; background: #05060c; z-index: 2; }
.hd-screen { position: relative; height: 100%; border-radius: 26px; padding: 40px 14px 14px; background: linear-gradient(180deg, #151833, #0d0f20); display: flex; flex-direction: column; align-items: center; text-align: center; overflow: hidden; }
.hd-k { margin: 0; font-size: 11.5px; color: var(--hd-dim); letter-spacing: .02em; } .hd-k b { display: block; color: var(--hd-ink); font-size: 13px; font-weight: 650; }
.hd-amt { position: relative; margin: 6px 0 0; font-size: 12px; color: var(--hd-dim); font-weight: 650; height: 34px; }
.hd-amt b { font-size: 26px; color: var(--hd-ink); font-weight: 760; letter-spacing: -.02em; font-variant-numeric: tabular-nums; margin-left: 2px; }
.hd-amt .hd-bad { position: absolute; right: 0; top: 0; color: var(--hd-bad); opacity: 0; transform: translateY(8px); transition: opacity .35s ${EASE}, transform .35s ${EASE}; }
.hd-num { transition: opacity .35s ${EASE}; }
.hd[data-phase="4"] .hd-num { opacity: 0; } .hd[data-phase="4"] .hd-bad { opacity: 1; transform: none; }
.hd-fid { width: 64px; height: 64px; margin: 12px 0 6px; fill: none; stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
.hd-ring { stroke: var(--hd-acc); stroke-width: 2.5; stroke-dasharray: 46 136; transform-origin: 32px 32px; opacity: 0; transition: opacity .3s; }
.hd-glyph { stroke: var(--hd-dim); stroke-width: 2.6; transition: stroke .4s, opacity .4s; }
.hd-check { stroke: var(--hd-ok); stroke-width: 4; stroke-dasharray: 40; stroke-dashoffset: 40; transition: stroke-dashoffset .6s ${EASE}; }
.hd.run[data-phase="2"] .hd-ring { opacity: 1; animation: hd-spin 1s linear 0s 2, hd-fade .3s 1.7s forwards; }
.hd.run[data-phase="2"] .hd-glyph { stroke: var(--hd-acc); }
.hd[data-phase="2"] .hd-glyph, .hd[data-phase="3"] .hd-glyph, .hd[data-phase="4"] .hd-glyph { opacity: .0; }
.hd.run[data-phase="2"] .hd-glyph { opacity: 1; animation: hd-fade .3s 1.7s forwards; }
.hd[data-phase="2"] .hd-check, .hd[data-phase="3"] .hd-check, .hd[data-phase="4"] .hd-check { stroke-dashoffset: 0; }
.hd.run[data-phase="2"] .hd-check { transition-delay: 1.8s; }
@keyframes hd-spin { to { transform: rotate(360deg); } } @keyframes hd-fade { to { opacity: 0; } }
.hd-hash { margin: 4px 0 0; font-size: 10.5px; color: var(--hd-dim); opacity: 0; transition: opacity .4s ${EASE}; }
.hd-hash span { display: block; text-transform: uppercase; letter-spacing: .08em; font-size: 9.5px; }
.hd-hash code, .hd-paid code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #c4b5fd; }
.hd[data-phase="2"] .hd-hash, .hd[data-phase="3"] .hd-hash, .hd[data-phase="4"] .hd-hash { opacity: 1; }
.hd[data-phase="4"] .hd-hash code { color: var(--hd-bad); text-decoration: line-through; }
.hd-st { position: absolute; left: 50%; bottom: 18px; display: flex; align-items: center; gap: 5px; margin: 0; padding: 6px 11px; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; opacity: 0; transform: translate(-50%, 10px); transition: opacity .5s ${EASE}, transform .5s ${EASE}; }
.hd-st.s1 { color: #ffc46b; background: rgba(255,196,107,.12); } .hd-st.s2 { color: #c4b5fd; background: rgba(139,133,255,.16); }
.hd-paid { color: var(--hd-ok); background: rgba(60,207,130,.12); } .hd-paid code { color: var(--hd-ok); }
.hd-st.s4 { color: var(--hd-bad); background: rgba(255,93,104,.14); }
.hd[data-phase="1"] .s1, .hd[data-phase="2"] .s2, .hd[data-phase="3"] .hd-paid, .hd[data-phase="4"] .s4 { opacity: 1; transform: translate(-50%, 0); }
.hd.run[data-phase="2"] .s2 { transition-delay: 1.9s; } .hd.run[data-phase="4"] .s4 { transition-delay: .7s; }
.hd[data-phase="4"] .hd-check { opacity: .12; }
.hd-stamp { position: absolute; left: 50%; top: 52%; margin: 0; padding: 6px 14px; border: 3px solid var(--hd-bad); border-radius: 10px; color: var(--hd-bad); font-size: 20px; font-weight: 820; letter-spacing: .14em; text-transform: uppercase; background: rgba(11,13,24,.82); opacity: 0; transform: translate(-50%, -50%) rotate(-12deg) scale(1.6); transition: opacity .25s ${EASE}, transform .45s ${EASE}; }
.hd[data-phase="4"] .hd-stamp { opacity: 1; transform: translate(-50%, -50%) rotate(-12deg) scale(1); }
.hd.run[data-phase="4"] .hd-stamp { transition-delay: .55s; }
.hd.run[data-phase="4"] .hd-phone { animation: hd-shake .5s cubic-bezier(.36,.07,.19,.97) .15s both; }
@keyframes hd-shake { 10%, 90% { transform: translateX(-1px); } 20%, 80% { transform: translateX(3px); } 30%, 50%, 70% { transform: translateX(-6px); } 40%, 60% { transform: translateX(6px); } }
.hd[data-phase="0"] .hd-screen > * { opacity: .0 !important; transition: opacity .3s; }
.hd figcaption { margin: 12px 2px 0; font-size: 12.5px; color: var(--hd-dim); }
.hd figcaption a { color: #c4b5fd; font-weight: 650; text-decoration: none; white-space: nowrap; }
@media (max-width: 480px) { .hd { padding: 12px; } .hd-stage { grid-template-columns: minmax(0, 1fr) 172px; gap: 10px; height: 300px; } .hd-phone { height: 292px; } .hd-node { padding: 8px 9px; column-gap: 8px; grid-template-columns: 26px minmax(0, 1fr); } .hd-node svg { width: 26px; height: 26px; padding: 5px; } .hd-node b { font-size: 13px; } .hd-steps li { font-size: 11.5px; padding: 6px 5px 8px; gap: 4px; } .hd-steps em { display: none; } .hd-amt b { font-size: 23px; } .hd-fid { width: 50px; height: 50px; margin: 6px 0 2px; } .hd-screen { padding-top: 36px; } .hd-st { bottom: 12px; } }
@media (prefers-reduced-motion: reduce) { .hd *, .hd *::before, .hd *::after { transition: none !important; animation: none !important; } }`;

/** The loop: four phases of 3.4 s, a short blank, again; the amount counts up and the hash types in. */
export const HERO_DEMO_JS = `
(function () {
  var box = document.getElementById("${DEMO_ID}");
  if (!box) return;
  var num = box.querySelector(".hd-num"), code = box.querySelector(".hd-code");
  var amount = box.getAttribute("data-amount") || "", hash = box.getAttribute("data-hash") || "";
  var q = /[?&]demo=([1-4])/.exec(location.search);
  var still = !!q || /[?&]frame=/.test(location.search) || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (still) { box.setAttribute("data-phase", q ? q[1] : "4"); return; }
  var to = parseFloat(amount), t0 = 0;
  function count(ts) { if (!t0) t0 = ts; var k = Math.min(1, (ts - t0) / 900), e = 1 - Math.pow(1 - k, 3); num.textContent = (to * e).toFixed(2); if (k < 1) requestAnimationFrame(count); }
  function type(i) { code.textContent = hash.slice(0, i); if (i < hash.length) setTimeout(function () { type(i + 1); }, 45); }
  var phase = 0;
  function go() {
    phase = phase % 5 + 1;
    if (phase === 5) { box.setAttribute("data-phase", "0"); setTimeout(go, 700); return; }
    box.classList.remove("run"); void box.offsetWidth; box.classList.add("run");
    box.setAttribute("data-phase", String(phase));
    if (phase === 1) { t0 = 0; num.textContent = "0.00"; code.textContent = ""; requestAnimationFrame(count); }
    if (phase === 2) setTimeout(function () { type(1); }, 1900);
    setTimeout(go, phase === 4 ? 4200 : 3400);
  }
  go();
})();`;
