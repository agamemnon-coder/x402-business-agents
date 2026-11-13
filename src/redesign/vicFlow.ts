// How a VIC purchase runs: /visa's drawing, right under the page's heading and its entry line since 12 Nov (it sat
// under the Airi run's block before): seven steps, left to right at desktop and top to bottom at phone width, each
// marked with whose step it is (the agent, or "Script" while purchase B was not asked for inside a Claude call; Purser at 2 and 7; Airi at 3 and 4; Airi · VIC at 5 only, the one step where
// the Visa credential appears (jury panel, 12 Nov); Airwallex at 6), in neutral badge colours, with purchase
// B's own id or value under it (step 5's credential type as Airi's receipt names it), and purchase C's branch off step 2 (refused by Purser before any Airi call). The CFO's
// limit, the Airi mandate, the cardholder's passkey, the single-use credential and the Airwallex PaymentIntent are
// steps 2 to 6. /proof's Airi block links here ("How it works").
//
// The drawing IS the list: an <ol> styled as a flow (CSS only, no motion), so a screen reader reads the seven steps in
// order. Every figure and id is read from the run's record (docs/demo/airi-run.json, the same one the block reads):
// when the record is a live run's but a fact a step needs is missing, vicFlow throws, so the page build fails instead
// of drawing a step without its value. Without a live record there is nothing to draw (as the block).

import { AIRI_NO_CLAUDE, AIRI_RUN_FILE, VIC_FLOW_ANCHOR, airiRun, type AiriPurchase, type AiriRunRecord } from "./airiRun.js";
import { esc } from "./ui.js";

/** The flow's anchor on /visa: /proof's "How it works" links here. */
export const VIC_FLOW_ID = VIC_FLOW_ANCHOR;
export const VIC_FLOW_HEADING = "How it works";

export type VicOwner = "agent" | "purser" | "airi" | "airwallex";
/** Whose step it is, in words (each step says it, so colour is never the only sign). */
export const VIC_OWNER_WORDS: Record<VicOwner, string> = { agent: "Agent", purser: "Purser", airi: "Airi", airwallex: "Airwallex" };
/** Step 5's own label: the Visa credential (Purser binds it to one purchase) is the one step that is Visa Intelligent Commerce. */
export const VIC_CREDENTIAL_WHO = "Airi · VIC";

export interface VicStep {
  owner: VicOwner;
  /** The step's label when it is not the owner's plain word (step 5: "Airi · VIC"). */
  who?: string;
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
  const agentName = `${need(b, "agent").charAt(0).toUpperCase()}${b.agent.slice(1)} agent`;
  if (!rec.policy.merchants_allowed?.length) missing("the policy's allowed merchants");
  return {
    follows: `Purchase ${b.step}`,
    label: rec.label.split(", ").join(" · "),
    steps: [
      // Who asked for B, where the story starts (review, 12 Nov): the 7 November run was scripted, so step 1 says so; a
      // purchase asked for inside the agent's Claude call (rail_choice.by "claude") reads as the agent's step.
      b.rail_choice?.by === "claude"
        ? { owner: "agent", title: "Agent asks to buy", what: `${agentName}, in a Claude call`, value: `${need(b, "currency")} ${need(b, "amount")}` }
        : { owner: "agent", who: "Script", title: "Asks to buy", what: `Purser's script as the ${agentName}; ${AIRI_NO_CLAUDE}`, value: `${need(b, "currency")} ${need(b, "amount")}` },
      { owner: "purser", title: "Purser's policy", what: `Limit ${b.currency} ${limit}, allowed merchants; above it, the CFO's Face ID on the exact terms`, value: `${need(b, "proposal_id")} · terms ${short(need(b, "terms_sha256"))}` },
      { owner: "airi", title: "Airi mandate", what: "Amount, merchant and items, for this one purchase", value: need(b, "mandate_id") },
      { owner: "airi", title: "Cardholder confirms", what: "Passkey in Airi", value: "Once" },
      { owner: "airi", who: VIC_CREDENTIAL_WHO, title: "Visa credential (VIC)", what: "From Airwallex's Airi wallet; Purser binds it to this purchase", value: `Airi's receipt: ${need(b, "credential_type")} · test card` },
      { owner: "airwallex", title: "Airwallex hosted checkout", what: "Our own sandbox merchant", value: need(b, "payment_intent_id") },
      { owner: "purser", title: "Result read back", what: "Reported to Airi", value: outcome, ...(outcome === "SUCCEEDED" ? { tone: "ok" as const } : {}) },
    ],
    refused: { head: `✕ Refused by Purser — ${c.airi_calls} Airi calls`, sub: `Purchase ${c.step}, a disallowed merchant` },
  };
}

/**
 * The flow: a heading, its label, and the steps as an ordered list (step 2 carries C's branch). The heading is an h2 on
 * /visa, where the flow comes straight after the page's h1 (no heading level skipped).
 */
export function vicFlowHtml(f: VicFlow, o: { h?: "h2" | "h3" } = {}): string {
  const h = o.h ?? "h3";
  const li = (s: VicStep, i: number) => `<li class="vf-${s.owner}"><span class="vf-who">${esc(s.who ?? VIC_OWNER_WORDS[s.owner])}</span><b>${esc(s.title)}</b><span class="vf-what">${esc(s.what)}</span><code class="vf-v${s.tone ? ` ${s.tone}` : ""}">${esc(s.value)}</code>${i === 1
    ? `<p class="vf-no"><b>${esc(f.refused.head)}</b><span>${esc(f.refused.sub)}</span></p>` : ""}</li>`;
  return `<section class="card vicflow" id="${VIC_FLOW_ID}" aria-labelledby="${VIC_FLOW_ID}-h"><${h} id="${VIC_FLOW_ID}-h">${esc(`${VIC_FLOW_HEADING}: ${f.follows.charAt(0).toLowerCase()}${f.follows.slice(1)}`)}</${h}>
<p class="vf-label">${esc(f.label)}</p>
<ol class="vf" role="list">${f.steps.map(li).join("")}</ol></section>`;
}

/** The flow as /visa shows it, from the committed record: "" without a live record; throws when a fact is missing. */
export function vicFlowBlock(rec: AiriRunRecord | null = airiRun(), o: { h?: "h2" | "h3" } = {}): string {
  return rec ? vicFlowHtml(vicFlow(rec), o) : "";
}

/**
 * The flow's styles: horizontal from 960 px, vertical below; no motion. Airi's steps carry the text's own neutral
 * colour (12 Nov: a brand-like pink read as Visa's or Airi's mark); Purser and Airwallex keep their tokens.
 */
export const VIC_FLOW_CSS = `.vicflow { padding: 16px 18px; display: grid; gap: 8px; scroll-margin-top: 80px; min-width: 0; }
.vicflow h2, .vicflow h3 { font-size: 18px; margin: 0; }
.vicflow .vf-label { margin: 0; color: var(--muted); font-size: 14.5px; font-weight: 600; }
ol.vf { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; counter-reset: vf; }
ol.vf > li { counter-increment: vf; position: relative; display: grid; gap: 3px; align-content: start; padding: 10px 12px 10px 44px; border-radius: 14px; background: var(--sunken); border-left: 4px solid var(--vf-c); min-width: 0; --vf-c: var(--muted); }
ol.vf > li::before { content: counter(vf); position: absolute; left: 10px; top: 10px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 750 13px/1 Inter, system-ui, sans-serif; color: var(--surface); background: var(--vf-c); }
ol.vf > li:not(:last-child)::after { content: ""; position: absolute; left: 18px; bottom: -14px; width: 8px; height: 8px; border-right: 2px solid var(--faint); border-bottom: 2px solid var(--faint); transform: rotate(45deg); }
ol.vf > li.vf-purser { --vf-c: var(--accent); } ol.vf > li.vf-airi { --vf-c: var(--text); } ol.vf > li.vf-airwallex { --vf-c: var(--awx); }
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
