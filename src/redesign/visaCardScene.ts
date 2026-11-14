// /visa's card-rail scene (partner review, 14 Nov): the agent pays with an Airi credential, Airwallex's Visa card rail
// (sandbox, test card), and Purser adds three checks per credential on top: bound to one purchase, amount and merchant
// must match the signed terms, reuse refused. A replay of the recorded runs of 7 to 14 Nov, labelled as such: every id,
// amount and code is read here from the vic-5 record (docs/runs/2026-11-14-vic-5.json); a step whose record is missing
// or says otherwise leaves the scene out. The merchant half of the second check is in code and tests
// (src/airi/credentialGuard.ts, test/airi-credential-guard.test.ts) since 14 Nov, after the last run: the scene says so.

import { readFileSync } from "node:fs";
import { airiRun } from "./airiRun.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";
import { VIC3_RUN_FILE } from "./vic3Run.js";

export const VISA_CARD_SCENE_ID = "visa-card-scene";
export const VISA_CARD_SCENE_HEADING = "Agent pays with an Airi credential";
export const GUARD_FILE = "src/airi/credentialGuard.ts";
export const GUARD_TEST = "test/airi-credential-guard.test.ts";

interface Step { step: string; request?: { amount?: string; currency?: string; merchant?: string }; proposal_id?: string | null; mandate_id?: string | null; payment_intent_id?: string | null; terms_sha256?: string | null;
  read_back?: { mandate?: { equal?: boolean; before_credential?: boolean } | null; payment_intent?: { equal?: boolean } | null };
  outcome?: { status?: string; code?: string; by?: string }; calls?: { anthropic?: number; airwallex?: number; airi?: number } }
interface Rec { run?: string; mode?: string; started_at?: string; purchases?: Step[] }

export interface CardScene {
  from: string; to: string; record: string;
  paid: { amount: string; currency: string; merchant: string; proposal: string; mandate: string; intent: string; hash: string };
  amount: { asked: string; code: string };
  reuse: { code: string };
  merchantRefused: { code: string } | null;
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const day = (iso: string) => DAY.format(new Date(iso));
const noCalls = (s: Step) => s.calls?.airwallex === 0 && s.calls?.airi === 0;

/** The scene's facts from the record, or null when the record does not show all three checks as run. */
export function cardScene(raw: unknown = readRecord(), firstIso: string | null = airiRun()?.started_at ?? null): CardScene | null {
  const r = raw as Rec | null;
  if (!r || r.mode !== "live" || !r.started_at || !Array.isArray(r.purchases)) return null;
  const at = (k: string) => r.purchases!.find((p) => p.step === k);
  const b = at("B"), f1 = at("F1"), f2 = at("F2"), d = at("D");
  if (!b || b.outcome?.status !== "succeeded" || !b.mandate_id || !b.payment_intent_id || !b.terms_sha256 || !b.proposal_id) return null;
  if (!b.read_back?.mandate?.equal || !b.read_back.mandate.before_credential || !b.read_back.payment_intent?.equal) return null;
  if (!f1 || f1.mandate_id !== b.mandate_id || f1.outcome?.code !== "PURSER_CREDENTIAL_AMOUNT_MISMATCH" || !noCalls(f1)) return null;
  if (!f2 || f2.mandate_id !== b.mandate_id || f2.outcome?.code !== "PURSER_CREDENTIAL_ALREADY_USED" || !noCalls(f2)) return null;
  return {
    from: day(firstIso ?? r.started_at), to: day(r.started_at), record: VIC3_RUN_FILE,
    paid: { amount: b.request?.amount ?? "", currency: b.request?.currency ?? "", merchant: b.request?.merchant ?? "", proposal: b.proposal_id, mandate: b.mandate_id, intent: b.payment_intent_id, hash: b.terms_sha256 },
    amount: { asked: `${f1.request?.amount ?? ""} ${f1.request?.currency ?? ""}`.trim(), code: f1.outcome.code },
    reuse: { code: f2.outcome.code },
    merchantRefused: d?.outcome?.status === "refused" && d.outcome.code && noCalls(d) ? { code: d.outcome.code } : null,
  };
}

function readRecord(): unknown {
  try { return JSON.parse(readFileSync(new URL(`../../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as unknown; } catch { return null; }
}


export const VISA_CARD_SCENE_CSS = `.vcs { padding: 16px 18px; display: grid; gap: 8px; }
.vcs h2 { font-size: 19px; line-height: 1.25; margin: 0; }
.vcs .vcs-label { margin: 0; font-size: 13.5px; color: var(--muted); }
.vcs .vcs-label b { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--text); font-weight: 600; margin-right: 6px; }
.vcs ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; counter-reset: vcs; }
.vcs li { border-top: 1px solid var(--border); padding: 8px 0 0; display: grid; gap: 2px; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.vcs li:first-child { border-top: 0; padding-top: 0; }
.vcs li > b { font-size: 15.5px; }
.vcs li > b::before { counter-increment: vcs; content: counter(vcs) ". "; color: var(--muted); }
.vcs .vcs-say { color: var(--muted); font-size: 14px; }
.vcs code { font-size: 13px; overflow-wrap: anywhere; }
.vcs .ok { color: var(--ok); font-weight: 600; } .vcs .no { color: var(--bad, #b42318); font-weight: 600; }
.vcs a.pf { display: inline-flex; align-items: center; min-height: 44px; }
@media (prefers-reduced-motion: no-preference) { .vcs li { animation: vcs-in .5s ease-out both; } .vcs li:nth-child(2) { animation-delay: .15s; } .vcs li:nth-child(3) { animation-delay: .3s; } .vcs li:nth-child(4) { animation-delay: .45s; } }
@keyframes vcs-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`;

const link = (file: string, label: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const code = (s: string) => `<code>${esc(s)}</code>`;

/** The scene: the payment, then Purser's three checks on its credential, each with what the record shows. */
export function visaCardSceneHtml(s: CardScene | null = cardScene()): string {
  if (!s) return "";
  const p = s.paid;
  const range = s.from.split(" ")[1] === s.to.split(" ")[1] ? `${s.from.split(" ")[0]}–${s.to}` : `${s.from}–${s.to}`;
  return `<section class="card vcs" id="${VISA_CARD_SCENE_ID}" aria-labelledby="${VISA_CARD_SCENE_ID}-h">
<h2 id="${VISA_CARD_SCENE_ID}-h">${esc(`${VISA_CARD_SCENE_HEADING} (test card, sandbox; recorded run of ${range})`)}</h2>
<p class="vcs-label"><b>${esc("Recorded, not live")}</b>${esc("Airi's credential is the agent's Visa card rail: Airwallex sandbox, test card, test money. Purser adds three checks per credential.")}</p>
<ol>
<li><b>${esc("The agent pays")}</b><span>${esc(`${p.currency} ${p.amount} at ${p.merchant}, after the CFO's Face ID on the exact terms (${p.proposal}).`)}</span><span class="vcs-say">${code(p.intent)}</span></li>
<li><b>${esc("Bound to one purchase")}</b><span>${esc("Airi's mandate carries the signed terms' hash, read back equal before use.")} <span class="ok">${esc("Checked")}</span></span><span class="vcs-say">${code(p.mandate)}</span></li>
<li><b>${esc("Amount and merchant must match the signed terms")}</b><span>${esc(`Same credential for ${s.amount.asked}: refused, no Airwallex call.`)} <span class="no">${esc(s.amount.code)}</span></span><span class="vcs-say">${esc("Another merchant: refused too, in code and tests since 14 Nov, not in the recorded run.")}</span></li>
<li><b>${esc("Reuse refused")}</b><span>${esc("Same credential again: refused, no Airwallex call.")} <span class="no">${esc(s.reuse.code)}</span></span></li>
</ol>
<p class="vcs-say">${link(s.record, "the run record")} ${link(GUARD_FILE, "the check")} ${link(GUARD_TEST, "its tests")}</p>
</section>`;
}
