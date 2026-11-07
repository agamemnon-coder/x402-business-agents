// How a VIC purchase runs, as /visa draws it under the Airi run's block (7 Nov): seven steps, left to right at desktop
// and top to bottom at phone width, each marked with whose step it is (the agent; Purser at 2 and 7; Airi and Visa at
// 3 to 5; Airwallex at 6), with purchase B's own id or value under it, and purchase C's branch off step 2 (refused by
// Purser before any Airi call). /proof's Airi block links here ("How it works").
//
// The drawing IS the list: an <ol> styled as a flow (CSS only, no motion), so a screen reader reads the seven steps in
// order. Every figure and id is read from the run's record (docs/demo/airi-run.json, the same one the block reads):
// when the record is a live run's but a fact a step needs is missing, vicFlow throws, so the page build fails instead
// of drawing a step without its value. Without a live record there is nothing to draw (as the block).

import { AIRI_RUN_FILE, VIC_FLOW_ANCHOR, airiRun, type AiriPurchase, type AiriRunRecord } from "./airiRun.js";
import { esc } from "./ui.js";

/** The flow's anchor on /visa: /proof's "How it works" links here. */
export const VIC_FLOW_ID = VIC_FLOW_ANCHOR;
export const VIC_FLOW_HEADING = "How it works";

export type VicOwner = "agent" | "purser" | "airi" | "airwallex";
/** Whose step it is, in words (each step says it, so colour is never the only sign). */
export const VIC_OWNER_WORDS: Record<VicOwner, string> = { agent: "Agent", purser: "Purser", airi: "Airi · Visa", airwallex: "Airwallex" };

export interface VicStep {
  owner: VicOwner;
  title: string;
  what: string;
  /** Purchase B's own id or value at this step, from the record. */
  value: string;
  tone?: "ok";
}

export interface VicFlow {
  /** "Purchase B": the purchase the steps follow. */
  follows: string;
  /** The record's label, dotted: "Airwallex sandbox · test card · test money". */
  label: string;
  steps: VicStep[];
  /** Purchase C's branch off step 2. */
  refused: { head: string; sub: string };
}

const short = (h: string) => `${h.slice(0, 8)}…`;

/** The seven steps from the record; throws when a fact a step needs is missing (the build fails, nothing is typed in). */
export function vicFlow(rec: AiriRunRecord): VicFlow {
  const missing = (what: string): never => { throw new Error(`the VIC flow on /visa needs ${what} in ${AIRI_RUN_FILE}`); };
  const buy = (s: AiriPurchase["step"]) => rec.purchases.find((p) => p.step === s) ?? missing(`purchase ${s}`);
  const need = <K extends keyof AiriPurchase>(p: AiriPurchase, k: K): NonNullable<AiriPurchase[K]> => (p[k] ?? missing(`purchase ${p.step}'s ${String(k)}`)) as NonNullable<AiriPurchase[K]>;
  const b = buy("B"), c = buy("C");
  // B is the purchase above the limit: the CFO's Face ID (a passkey) on its exact terms, then Airi, then the checkout.
  if (b.route !== "cfo" || need(b, "method") !== "passkey") missing("purchase B approved by the CFO's Face ID (route cfo, method passkey)");
  const tap = need(b, "tap");
  if (!/\bonce, with a passkey in Airi\b/.test(tap)) missing("purchase B's tap: once, with a passkey in Airi");
  if (!/single-use/.test(rec.credential ?? "")) missing("a single-use credential");
  if (rec.checkout?.kind !== "airwallex-sandbox-hosted") missing("the checkout: Airwallex's hosted checkout on the sandbox");
  if (!rec.test_card || !rec.test_money || !rec.label) missing("the label: test card and test money");
  const outcome = need(b, "outcome");
  if (need(b, "reported_to_airi") !== outcome) missing("purchase B's result reported to Airi as read back");
  if (c.route !== "refused" || c.by !== "purser" || c.airi_calls === undefined) missing("purchase C refused by Purser, with its count of Airi calls");
  const limit = rec.policy?.alone_max_eur ?? missing("the policy's limit");
  if (!rec.policy.merchants_allowed?.length) missing("the policy's allowed merchants");
  return {
    follows: `Purchase ${b.step}`,
    label: rec.label.split(", ").join(" · "),
    steps: [
      { owner: "agent", title: "Agent asks to buy", what: `${need(b, "agent").charAt(0).toUpperCase()}${b.agent.slice(1)} agent`, value: `${need(b, "currency")} ${need(b, "amount")}` },
      { owner: "purser", title: "Purser's policy", what: `Limit ${b.currency} ${limit}, allowed merchants; above it, the CFO's Face ID on the exact terms`, value: `${need(b, "proposal_id")} · terms ${short(need(b, "terms_sha256"))}` },
      { owner: "airi", title: "Airi mandate", what: "Amount, merchant, items, order hash", value: need(b, "mandate_id") },
      { owner: "airi", title: "Cardholder confirms", what: "Passkey in Airi", value: "Once" },
      { owner: "airi", title: "Single-use Visa credential (VIC)", what: "From Airwallex's Airi wallet", value: `${need(b, "credential_type")} · test card` },
      { owner: "airwallex", title: "Airwallex hosted checkout", what: "Our own sandbox merchant", value: need(b, "payment_intent_id") },
      { owner: "purser", title: "Result read back", what: "Reported to Airi", value: outcome, ...(outcome === "SUCCEEDED" ? { tone: "ok" as const } : {}) },
    ],
    refused: { head: `✕ Refused by Purser — ${c.airi_calls} Airi calls`, sub: `Purchase ${c.step}, a disallowed merchant` },
  };
}

/** The flow: a heading, its label, and the steps as an ordered list (step 2 carries C's branch). */
export function vicFlowHtml(f: VicFlow): string {
  const li = (s: VicStep, i: number) => `<li class="vf-${s.owner}"><span class="vf-who">${esc(VIC_OWNER_WORDS[s.owner])}</span><b>${esc(s.title)}</b><span class="vf-what">${esc(s.what)}</span><code class="vf-v${s.tone ? ` ${s.tone}` : ""}">${esc(s.value)}</code>${i === 1
    ? `<p class="vf-no"><b>${esc(f.refused.head)}</b><span>${esc(f.refused.sub)}</span></p>` : ""}</li>`;
  return `<section class="card vicflow" id="${VIC_FLOW_ID}" aria-labelledby="${VIC_FLOW_ID}-h"><h3 id="${VIC_FLOW_ID}-h">${esc(`${VIC_FLOW_HEADING}: ${f.follows.charAt(0).toLowerCase()}${f.follows.slice(1)}`)}</h3>
<p class="vf-label">${esc(f.label)}</p>
<ol class="vf" role="list">${f.steps.map(li).join("")}</ol></section>`;
}

/** The flow as /visa shows it, from the committed record: "" without a live record; throws when a fact is missing. */
export function vicFlowBlock(rec: AiriRunRecord | null = airiRun()): string {
  return rec ? vicFlowHtml(vicFlow(rec)) : "";
}

/** The flow's styles: owner colours in light and dark, horizontal from 960 px, vertical below; no motion. */
export const VIC_FLOW_CSS = `.vicflow { --vf-airi: #be185d; padding: 16px 18px; display: grid; gap: 8px; scroll-margin-top: 80px; min-width: 0; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .vicflow { --vf-airi: #f472b6; } }
:root[data-theme="dark"] .vicflow { --vf-airi: #f472b6; }
.vicflow h3 { font-size: 18px; margin: 0; }
.vicflow .vf-label { margin: 0; color: var(--muted); font-size: 14.5px; font-weight: 600; }
ol.vf { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; counter-reset: vf; }
ol.vf > li { counter-increment: vf; position: relative; display: grid; gap: 3px; align-content: start; padding: 10px 12px 10px 44px; border-radius: 14px; background: var(--sunken); border-left: 4px solid var(--vf-c); min-width: 0; --vf-c: var(--muted); }
ol.vf > li::before { content: counter(vf); position: absolute; left: 10px; top: 10px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 750 13px/1 Inter, system-ui, sans-serif; color: var(--surface); background: var(--vf-c); }
ol.vf > li:not(:last-child)::after { content: ""; position: absolute; left: 18px; bottom: -14px; width: 8px; height: 8px; border-right: 2px solid var(--faint); border-bottom: 2px solid var(--faint); transform: rotate(45deg); }
ol.vf > li.vf-purser { --vf-c: var(--accent); } ol.vf > li.vf-airi { --vf-c: var(--vf-airi); } ol.vf > li.vf-airwallex { --vf-c: var(--awx); }
ol.vf .vf-who { font-size: 12.5px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; color: var(--vf-c); }
ol.vf b { font-size: 15px; line-height: 1.3; } ol.vf .vf-what { font-size: 13.5px; line-height: 1.35; color: var(--muted); }
ol.vf code.vf-v { font: 650 12.5px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; margin-top: 2px; color: var(--text); }
ol.vf code.vf-v.ok { color: var(--ok); }
ol.vf .vf-no { margin: 6px 0 0; padding: 6px 8px; border: 1.5px dashed var(--bad); border-radius: 10px; background: var(--bad-soft); display: grid; gap: 1px; }
ol.vf .vf-no b { color: var(--bad); font-size: 13.5px; } ol.vf .vf-no span { font-size: 12.5px; color: var(--muted); line-height: 1.3; }
@media (min-width: 960px) {
  ol.vf { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 14px; }
  ol.vf > li { padding: 40px 10px 10px; border-left: 0; border-top: 4px solid var(--vf-c); }
  ol.vf > li::before { left: 10px; top: 10px; }
  ol.vf > li:not(:last-child)::after { left: auto; right: -11px; top: 18px; bottom: auto; transform: rotate(-45deg); }
}`;
