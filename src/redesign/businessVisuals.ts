// /business's one visual (22 Nov; Max: "far too much text, make it a tight, animated visual"; then "still too much, the
// demo duplicates Home"): one small card in which an invoice arrives, the agent checks it, and it ends either within the
// limit and paid, or over the limit at the CFO's Face ID, signed. CSS only, on a loop; still under prefers-reduced-motion.
// The one amount is read from the recorded /try runs through workflowFacts (src/redesign/heroWave.ts); a run that no
// longer says it is an error, never a guess. No style attribute anywhere (the CSP): every rule is here.

import { WORKFLOW_RECORD, workflowFacts, type WorkflowFacts } from "./heroWave.js";
import { TRY_SAMPLE_RECORD } from "./heroFlow.js";
import { picon } from "./proofIcons.js";
import { esc, icon } from "./ui.js";

/** The question the page asks (Max, 21 Nov), and the line under it (22 Nov). */
export const BUSINESS_QUESTION = "Would you trust an AI agent with your company's money?";
export const BUSINESS_LINE = "Join the 30-day pilot: agents pay the routine, your CFO signs the rest with Face ID.";

/** The demo as the recorded /try runs have it: the invoice, what the agent paid alone, the signed amount, the refused change. */
export interface DemoFacts { supplier: string; number: string; amount: string; alone: string; cent: string; signed: string; sent: string; recs: { invoice: string; run: string } }
export function demoFacts(f: WorkflowFacts | null = workflowFacts()): DemoFacts {
  const held = f?.steps.find((s) => s.state === "held");
  const alone = /it paid (EUR [\d,]+\.\d{2}) on its own/.exec(held?.detail ?? "")?.[1];
  const r = /^\+(EUR 0\.01) after signing: signed (\w+)… ≠ sent (\w+)…$/.exec(f?.refused?.detail ?? "");
  if (!f || !alone || !r || !f.steps.some((s) => s.state === "paid")) throw new Error(`/business: ${WORKFLOW_RECORD} no longer has the agent's own payment, the paid signed invoice and the refused cent`);
  return { supplier: f.invoice.supplier, number: f.invoice.number, amount: f.invoice.amount, alone, cent: r[1]!, signed: r[2]!, sent: r[3]!, recs: { invoice: TRY_SAMPLE_RECORD, run: WORKFLOW_RECORD } };
}
/**
 * The visual: the invoice comes in, the agent checks it, then one of two ends lights up: within the limit, paid; or
 * over it, to the CFO's Face ID, then signed. A 9 s loop: the small invoice first, then the one over the limit.
 * Under reduced motion it stands still on the second (over the limit, signed).
 */
export function pilotVisualHtml(d: DemoFacts): string {
  const doc = (cls: string, amount: string) => `<span class="bzv-doc ${cls}"><span class="bzv-ic" aria-hidden="true">${icon("file-check", 18)}</span><span><small>${esc("Invoice")}</small><b>${esc(amount)}</b></span></span>`;
  return `<figure class="bzv" aria-labelledby="bzv-c">
<div class="bzv-in">${doc("a", d.alone)}${doc("b", d.amount)}</div>
<span class="bzv-w" aria-hidden="true"><i></i></span>
<p class="bzv-chk"><span class="bzv-ic" aria-hidden="true">${picon("shield-check", 18)}</span>${esc("Agent checks")}</p>
<span class="bzv-w" aria-hidden="true"><i></i></span>
<div class="bzv-ends"><p class="bzv-o ok"><span class="bzv-ic" aria-hidden="true">${icon("check", 18)}</span>${esc("Within limit · paid")}</p><p class="bzv-o cfo"><span class="bzv-ic" aria-hidden="true">${icon("scan-face", 18)}</span>${esc("Over limit · Face ID")}</p></div>
<p class="bzv-sig"><span class="bzv-ic" aria-hidden="true">${picon("badge-check", 18)}</span>${esc("Signed · exact terms")}</p>
<figcaption id="bzv-c">${esc("Sandbox · test money")}</figcaption>
</figure>`;
}

export const BUSINESS_VISUAL_CSS = `figure.bzv { margin: 0; display: grid; justify-items: center; gap: 0; padding: 22px 20px 16px; border-radius: 22px; min-width: 0; border: 1px solid var(--glass-line, var(--border));
  background: radial-gradient(80% 60% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%), var(--surface); box-shadow: 0 30px 70px -40px color-mix(in srgb, var(--accent) 70%, transparent); }
.bzv-ic { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: color-mix(in srgb, var(--c, var(--accent)) 16%, transparent); color: var(--c, var(--accent)); }
.bzv-in { display: grid; }
.bzv-doc { grid-area: 1 / 1; display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 14px; border: 1px solid var(--border); background: var(--sunken); }
.bzv-doc > span:last-child { display: flex; flex-direction: column; } .bzv-doc small { font-size: 14px; color: var(--muted); } .bzv-doc b { font-size: 18px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.bzv-doc.a { visibility: hidden; }
.bzv-w { position: relative; width: 2px; height: 26px; margin: 4px 0; background: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.bzv-w i { position: absolute; left: 50%; top: 0; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px 3px color-mix(in srgb, var(--accent) 70%, transparent); opacity: 0; }
.bzv-chk, .bzv-o, .bzv-sig { margin: 0; display: flex; align-items: center; gap: 10px; padding: 8px 14px 8px 8px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 35%, var(--border)); background: var(--surface); font-size: 15px; font-weight: 700; }
.bzv-ends { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: 100%; }
.bzv-o { justify-content: flex-start; min-width: 0; overflow-wrap: anywhere; } @media (min-width: 421px) { .bzv-o { white-space: nowrap; gap: 8px; padding-right: 12px; font-size: 14.5px; } } .bzv-o.ok { --c: var(--ok); } .bzv-o.cfo { --c: var(--accent); }
.bzv-sig { --c: var(--ok); margin-top: 12px; }
figure.bzv figcaption { margin-top: 12px; font-size: 14px; color: var(--muted); }
@media (max-width: 420px) { .bzv-ends { grid-template-columns: minmax(0, 1fr); } }
/* The loop, 9 s: the small invoice (0-45%) ends within the limit, paid; the one over the limit (50-95%) at the CFO's Face ID, then signed. */
@media (prefers-reduced-motion: no-preference) {
  .bzv-doc.a { visibility: visible; animation: bzv-doc-a 9s ease-in-out infinite both; }
  .bzv-doc.b { animation: bzv-doc-b 9s ease-in-out infinite both; }
  .bzv-w:nth-of-type(1) i { animation: bzv-run1 9s linear infinite both; }
  .bzv-w:nth-of-type(2) i { animation: bzv-run2 9s linear infinite both; }
  .bzv-chk { animation: bzv-chk 9s ease-in-out infinite both; }
  .bzv-o.ok { animation: bzv-ok 9s ease-in-out infinite both; }
  .bzv-o.cfo { animation: bzv-cfo 9s ease-in-out infinite both; }
  .bzv-sig { animation: bzv-sig 9s ease-in-out infinite both; }
}
@keyframes bzv-doc-a { 0% { opacity: 0; transform: translateY(-10px); } 5%, 42% { opacity: 1; transform: none; } 47%, 100% { opacity: 0; transform: none; } }
@keyframes bzv-doc-b { 0%, 47% { opacity: 0; transform: translateY(-10px); } 52%, 92% { opacity: 1; transform: none; } 97%, 100% { opacity: 0; } }
@keyframes bzv-run1 { 0%, 6% { top: 0; opacity: 0; } 7% { opacity: 1; } 13% { top: 100%; opacity: 1; } 14%, 53% { top: 100%; opacity: 0; } 54% { top: 0; opacity: 1; } 60% { top: 100%; opacity: 1; } 61%, 100% { top: 100%; opacity: 0; } }
@keyframes bzv-run2 { 0%, 20% { top: 0; opacity: 0; } 21% { opacity: 1; } 27% { top: 100%; opacity: 1; } 28%, 67% { top: 100%; opacity: 0; } 68% { top: 0; opacity: 1; } 74% { top: 100%; opacity: 1; } 75%, 100% { top: 100%; opacity: 0; } }
@keyframes bzv-chk { 0%, 12%, 26%, 59%, 73%, 100% { box-shadow: none; } 15%, 22%, 62%, 69% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); border-color: var(--accent); } }
@keyframes bzv-ok { 0%, 26%, 46%, 100% { box-shadow: none; } 29%, 43% { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, var(--surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); } }
@keyframes bzv-cfo { 0%, 73%, 96%, 100% { box-shadow: none; } 76%, 93% { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent); } }
@keyframes bzv-sig { 0%, 80% { opacity: 0; transform: scale(.92); } 84%, 93% { opacity: 1; transform: none; } 97%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { figure.bzv * { animation: none !important; transition: none !important; } .bzv-doc.a { visibility: hidden; } }`;
