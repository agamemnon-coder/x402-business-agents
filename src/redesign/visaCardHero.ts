// The top of /visa since 21 Nov (the owner, Max: "It must be clear it is about cards, not all those walls of text. So
// again: visuals, animations, architecture. Show it."). One card scene, played once: the agent's card (Airi's
// credential on Airi's test card), a spend over the CFO's limit, the CFO's Face ID, then paid via Airi in the Airwallex
// sandbox; under it the two refusals as chips (the same credential used again, a spend over the hard cap), and the card
// flow as an architecture in four boxes. Under prefers-reduced-motion nothing moves: the scene is its final frame.
//
// Every figure is read from the live record of 14 Nov, vic-5 (docs/runs/2026-11-14-vic-5.json, VIC3_RUN_FILE): the paid
// purchase (amount, merchant, proposal, PaymentIntent, Airi's code), the CFO's limit the agent may spend alone (the
// record's airi.policy_initial row), the CFO's passkey approval of that proposal (proposal.approved), the card's last
// four digits (preflight), the model that chose the rail, and the refusals with their codes and calls. Visa is text
// only: no mark (docs/evidence/logo-permissions.md, 14 Nov). It says plainly what the record says: Airi's credential on
// a test card, not a Visa network token.

import { existsSync, readFileSync } from "node:fs";
import { VIC3_RUN_FILE } from "./vic3Run.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const VISA_CARD_HERO_ID = "visa-card-hero";
export const VISA_ARCH_ID = "visa-arch";

interface Purchase { step: string; request: { amount: string; currency: string; merchant: string } | null; rail_choice: { by: string; model: string | null } | null; proposal_id: string | null; mandate_id: string | null; payment_intent_id: string | null; outcome: { status: string; code?: string; reason?: string } | null; calls?: Record<string, number> }
interface Rec { run: string; mode: string; started_at: string; preflight?: { card?: string }; purchases: Purchase[]; audit?: { event: string; subject?: string; payload: Record<string, unknown> }[] }

export interface VisaCardScene {
  run: string; day: string; last4: string; currency: string; /** The agent who asked (the record's airi.purchase_requested row). */ agent: string;
  paid: { amount: string; merchant: string; proposal: string; intent: string; code: string; model: string | null };
  /** What the agent may spend alone on this rail (the CFO's policy at the start of the run). */
  alone: string;
  /** The CFO's approval of the paid purchase: a passkey (Face ID on the CFO's phone). */
  approved: boolean;
  refusals: { what: "reused" | "cap"; amount: string; code: string; cap?: string; calls: number }[];
}

const zero = (c?: Record<string, number>) => Object.values(c ?? {}).reduce((n, x) => n + x, 0);
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

/** The scene from the vic-5 record; null when the record is missing, not live, or does not show a paid purchase above the limit after the CFO's approval. */
export function visaCardScene(file = VIC3_RUN_FILE): VisaCardScene | null {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return null;
  const r = JSON.parse(readFileSync(url, "utf8")) as Rec;
  if (r.mode !== "live") return null;
  const paid = r.purchases.find((p) => p.outcome?.status === "succeeded" && p.proposal_id && p.payment_intent_id && p.request);
  const policy = r.audit?.find((a) => a.event === "airi.policy_initial");
  const alone = String((policy?.payload.values as Record<string, unknown> | undefined)?.["approval.airi_alone"] ?? "");
  const approval = r.audit?.find((a) => a.event === "proposal.approved" && a.subject === paid?.proposal_id && a.payload.method === "passkey");
  const asked = String(r.audit?.find((a) => a.event === "airi.purchase_requested" && a.payload.amount === paid?.request?.amount)?.payload.agent ?? "");
  const last4 = /(\d{4})\s*$/.exec(r.preflight?.card ?? "")?.[1];
  if (!paid?.request || !/^\d+\.\d\d$/.test(alone) || Number(paid.request.amount) <= Number(alone) || !approval || !last4 || !asked) return null;
  const refusals: VisaCardScene["refusals"] = [];
  const reused = r.purchases.find((p) => p.outcome?.code === "PURSER_CREDENTIAL_ALREADY_USED" && p.mandate_id === paid.mandate_id);
  if (reused?.request) refusals.push({ what: "reused", amount: reused.request.amount, code: reused.outcome!.code!, calls: zero(reused.calls) });
  const cap = r.purchases.find((p) => p.outcome?.code === "PURSER_ABOVE_HARD_CAP");
  const capOf = /hard cap of ([\d.]+)/.exec(cap?.outcome?.reason ?? "")?.[1];
  if (cap?.request && capOf) refusals.push({ what: "cap", amount: cap.request.amount, code: cap.outcome!.code!, cap: capOf, calls: zero(cap.calls) });
  return { run: r.run, day: day(r.started_at), last4, agent: `${asked[0]!.toUpperCase()}${asked.slice(1)}`, currency: paid.request.currency, alone, approved: true,
    paid: { amount: paid.request.amount, merchant: paid.request.merchant, proposal: paid.proposal_id!, intent: paid.payment_intent_id!, code: paid.outcome!.code ?? "SUCCEEDED", model: paid.rail_choice?.model ?? null }, refusals };
}

const fam = (m: string | null) => (/claude-(haiku|sonnet|opus)/i.exec(m ?? "")?.[1] ?? "").replace(/^./, (c) => c.toUpperCase());
const rec = (file: string, label: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" title="${esc(file)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;

/** The card, the four steps, the refusals as chips and the honest line. Empty without a scene. */
export function visaCardHeroHtml(s: VisaCardScene | null, file = VIC3_RUN_FILE): string {
  if (!s) return "";
  const c = s.currency;
  const card = `<div class="vc-card" role="img" aria-label="${esc(`The agent's card: Airi's credential on Airi's test card ending ${s.last4}, single use, ${c} ${s.paid.amount}; paid in the Airwallex sandbox`)}">
<span class="vc-top"><b>Purser</b><span>${esc(`${s.agent} agent`)}</span></span><span class="vc-mid"><span class="vc-chip" aria-hidden="true"></span><span class="vc-stamp">${icon("circle-check", 18)}${esc(`Paid ${c} ${s.paid.amount}`)}</span></span>
<span class="vc-num">•••• •••• •••• ${esc(s.last4)}</span><span class="vc-bot"><span>${esc("Airi credential · single use")}</span><span>${esc("test card")}</span></span>
</div>`;
  const step = (n: number, ic: string, k: string, b: string, sub = "", cls = "") => `<li class="vc-s v${n}${cls}"><span class="vc-ic">${icon(ic, 18)}</span><span class="vc-k">${esc(k)}</span><b>${esc(b)}</b>${sub ? `<small>${sub}</small>` : ""}</li>`;
  const steps = [
    step(1, "credit-card", "The spend", `${c} ${s.paid.amount}`, esc(s.paid.merchant)),
    step(2, "triangle-alert", "Over the CFO's limit", `${c} ${s.alone} alone`, esc("so the agent waits for the CFO"), " warn"),
    step(3, "scan-face", "Face ID", `The CFO approves ${s.paid.proposal}`, esc("the signed terms, bound to this one purchase")),
    step(4, "circle-check", "Paid via Airi", s.paid.code, `<code>${esc(s.paid.intent)}</code> ${rec(file, `${s.day} record`)}`, " ok"),
  ].join("");
  const chip = (x: VisaCardScene["refusals"][number]) => x.what === "reused"
    ? `<li class="vc-chipno">${icon("ban", 16)}<span><b>${esc("Same credential used again: refused")}</b><code>${esc(x.code)}</code></span></li>`
    : `<li class="vc-chipno">${icon("ban", 16)}<span><b>${esc(`${c} ${x.amount}, over the ${c} ${x.cap} hard cap: refused`)}</b><code>${esc(x.code)}</code></span></li>`;
  const chips = s.refusals.length ? `<ul class="vc-chips" aria-label="${esc("Refused by Purser, before any outside call")}">${s.refusals.map(chip).join("")}</ul>` : "";
  return `<section class="vcard card" id="${VISA_CARD_HERO_ID}" data-rec="${esc(file)}" aria-labelledby="vc-h"><h2 class="vc-h" id="vc-h">${esc("An agent's card, over the CFO's limit")}</h2>
<div class="vc-grid">${card}<ol class="vc-steps">${steps}</ol></div>${chips}
<p class="vc-note">${esc(`Airi's credential on Airi's test card, not a Visa network token. Airwallex sandbox, test money; the run of ${s.day} (${s.run}).${s.paid.model ? ` Claude ${fam(s.paid.model)} chose the rail; Purser's code held the limits.` : ""}`)}</p></section>`;
}

/** The card flow: agent → Purser → Airi → Airwallex's checkout (sandbox). */
export function visaArchHtml(): string {
  const box = (ic: string, t: string, sub: string, cls = "") => `<li class="aa-n${cls}"><span class="aa-ic">${icon(ic, 20)}</span><b>${esc(t)}</b><span>${esc(sub)}</span></li>`;
  return `<section class="aarch varch card" id="${VISA_ARCH_ID}" aria-labelledby="va-h"><h2 class="vc-h" id="va-h">${esc("The card flow")}</h2>
<ol class="aa-flow">${box("bot", "Agent", "asks to buy; Claude picks the rail")}${box("shield-check", "Purser", "the CFO's limits, Face ID, the signed terms", " lock")}${box("credit-card", "Airi", "a single-use credential for those terms", " lock")}${box("landmark", "Airwallex checkout", "sandbox: pays, the terms read back")}</ol></section>`;
}

export const VISA_CARD_HERO_CSS = `.vcard { padding: 18px 20px 14px; display: grid; gap: 14px; }
.vc-h { margin: 0; font-size: clamp(19px, 2vw, 23px); font-weight: 760; letter-spacing: -.01em; }
.vc-grid { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 22px; align-items: center; }
@media (max-width: 760px) { .vc-grid { grid-template-columns: minmax(0, 1fr); gap: 14px; } }
.vc-card { position: relative; aspect-ratio: 1.586; width: 100%; max-width: 340px; margin: 0 auto; border-radius: 18px; padding: 18px 20px; box-sizing: border-box; color: #fff;
  background: linear-gradient(135deg, #1a1f71 0%, #2b3a9e 55%, #4f46e5 100%); box-shadow: 0 14px 30px rgba(26, 31, 113, .28); display: grid; grid-template-rows: auto 1fr auto auto; gap: 6px; overflow: hidden; }
.vc-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; } .vc-top b { font-size: 17px; letter-spacing: -.01em; } .vc-top span { opacity: .85; }
.vc-chip { width: 42px; height: 30px; border-radius: 7px; background: linear-gradient(135deg, #e9d48b, #c8a64b); align-self: center; }
.vc-num { font: 600 clamp(17px, 2.2vw, 20px)/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .06em; white-space: nowrap; }
.vc-bot { display: flex; justify-content: space-between; gap: 8px; white-space: nowrap; font-size: clamp(10.5px, 3vw, 12.5px); opacity: .9; text-transform: uppercase; letter-spacing: .04em; }
.vc-mid { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vc-stamp { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: #fff; color: #0f7a43; font-weight: 750; font-size: 15px; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
.vc-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.vc-s { display: grid; grid-template-columns: 32px minmax(0, 1fr); column-gap: 10px; align-items: center; padding: 8px 12px; border-radius: 14px; background: var(--sunken); min-width: 0; }
.vc-s .vc-ic { grid-row: span 3; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: var(--surface); color: var(--accent); }
.vc-s.warn .vc-ic { color: var(--vwarn, #b45309); } .vc-s.ok { background: var(--ok-soft); } .vc-s.ok .vc-ic { color: var(--ok); }
.vc-k { font-size: 12.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--muted); }
.vc-s b { font-size: 16px; line-height: 1.3; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.vc-s small { font-size: 13.5px; color: var(--muted); overflow-wrap: anywhere; }
.vc-s small code { font-size: 12.5px; word-break: break-all; }
.vc-s a.pf { font-size: 13.5px; display: inline-flex; align-items: center; min-height: 28px; }
.vc-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.vc-chipno { display: inline-flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: 12px; background: var(--bad-soft); color: var(--bad); min-width: 0; max-width: 100%; }
.vc-chipno svg { flex: none; margin-top: 2px; }
.vc-chipno span { display: grid; gap: 2px; min-width: 0; } .vc-chipno b { color: var(--text); font-size: 14.5px; } .vc-chipno code { font-size: 12.5px; overflow-wrap: anywhere; }
.vc-note { margin: 0; font-size: 14px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 10px; }
.varch .aa-n.lock { box-shadow: inset 0 0 0 2px var(--accent); } .varch .aa-ic { color: var(--accent); }
@media (prefers-reduced-motion: no-preference) {
  .vcard .vc-card { animation: vc-card .7s cubic-bezier(.2,.8,.2,1) both; }
  .vcard .vc-s { animation: vc-in .45s ease-out both; }
  .vcard .v1 { animation-delay: .5s; } .vcard .v2 { animation-delay: 1.2s; } .vcard .v3 { animation-delay: 1.9s; } .vcard .v4 { animation-delay: 2.6s; }
  .vcard .vc-stamp { animation: vc-stamp .45s cubic-bezier(.2,1.4,.4,1) 3s both; }
  .vcard .vc-chipno { animation: vc-in .4s ease-out both; } .vcard .vc-chipno:nth-child(1) { animation-delay: 3.4s; } .vcard .vc-chipno:nth-child(2) { animation-delay: 3.6s; }
  .varch .aa-n { animation: vc-in .45s ease-out both; } .varch .aa-n:nth-child(2) { animation-delay: .12s; } .varch .aa-n:nth-child(3) { animation-delay: .24s; } .varch .aa-n:nth-child(4) { animation-delay: .36s; }
}
@keyframes vc-card { from { opacity: 0; transform: translateY(14px) rotate(-3deg); } to { opacity: 1; transform: none; } }
@keyframes vc-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes vc-stamp { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }`;
