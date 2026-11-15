// /proof's opening (competitive judge panel, 15 Nov: "4,743 words; open with three facts, each with one link and its
// id"): Airwallex's own card decline at the CFO's limit, Alta's refusal on chain, and the passkey check anyone runs
// offline. Every value is read from its record (proofRows: docs/demo/airwallex-run.json and the main run; the receipt
// the verify-approval script checks); a fact whose record is missing is left out, never filled in.

import { awxRun } from "./awxRun.js";
import { proofRows } from "./home.js";
import { RECEIPT, VERIFY_COMMAND } from "./proofRuns.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export interface FirstFact { icon: string; head: string; text: string; link: string; href: string; id: string; external: boolean }

export function proofFirstFacts(): FirstFact[] {
  const rows = proofRows(), out: FirstFact[] = [];
  const awx = rows.find((r) => r.partner === "Airwallex"), alta = rows.find((r) => r.partner === "Alta");
  const code = awx ? awxRun()?.card_transactions.find((t) => t.id === awx.full)?.decline_code : undefined;
  if (awx && code) out.push({ icon: "ban", head: `Airwallex declined the card: ${code}`, text: `${awx.text.replace(/\.$/, "")}, by Airwallex's own card controls (sandbox).`, link: "Card transaction", href: awx.href, id: awx.full, external: false });
  if (alta) out.push({ icon: "link-2", head: "Alta refused the payment on chain", text: "Over the agent's mandate cap, on Alta testnet.", link: "Transaction", href: alta.href, id: alta.full, external: true });
  const file = RECEIPT.replace(/^.*\//, "");
  if (RECEIPT) out.push({ icon: "shield-check", head: "Check a passkey approval yourself, offline", text: `${VERIFY_COMMAND}: the signature covers exactly the signed terms; change one cent and it says NOT VALID.`, link: "Receipt", href: `${REPO_BLOB}${RECEIPT}`, id: file, external: true });
  return out;
}

export function proofFirstHtml(facts: FirstFact[] = proofFirstFacts()): string {
  if (!facts.length) return "";
  return `<ol class="pfirst" aria-label="Three facts to check first">${facts.map((f) => `<li><span class="pf-ic">${icon(f.icon, 18)}</span><div><b>${esc(f.head)}</b><p>${esc(f.text)}</p><a href="${esc(f.href)}"${f.external ? ' target="_blank" rel="noopener"' : ""}>${esc(f.link)} <code class="mono">${esc(f.id)}</code>${f.external ? "&nbsp;↗" : ""}</a></div></li>`).join("")}</ol>`;
}

export const PROOF_FIRST_CSS = `
/* The three facts first (judge panel, 15 Nov). */
ol.pfirst { list-style: none; margin: 8px 0 24px; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
ol.pfirst li { display: flex; gap: 12px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); min-width: 0; }
ol.pfirst .pf-ic { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ol.pfirst div { min-width: 0; display: grid; gap: 4px; align-content: start; }
ol.pfirst b { font-size: 15.5px; font-weight: 700; overflow-wrap: anywhere; }
ol.pfirst p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.45; }
ol.pfirst a { font-size: 14px; overflow-wrap: anywhere; }
ol.pfirst code { font-size: 12.5px; word-break: break-all; }
@media (max-width: 900px) { ol.pfirst { grid-template-columns: 1fr; } }
`;

/**
 * /visa's opening (judge panel, 15 Nov): the latest live run's three facts (vic-5, 14 Nov), each with one link and its
 * id, then one line saying what that run is and is not. Every value is the record's; a fact whose step is missing is
 * left out. The vic-5 record: docs/runs/2026-11-14-vic-5.json (VIC3_RUN_FILE).
 */
interface VisaRec {
  run: string; started_at: string;
  budgets?: { anthropic?: { used: number } };
  purchases: { step: string; request?: { amount: string; currency: string }; proposal_id?: string | null; mandate_id?: string | null; payment_intent_id?: string | null; outcome?: { status: string; code?: string } | null; calls: { anthropic: number; airwallex: number; airi: number } }[];
}
const zero = (c: { anthropic: number; airwallex: number; airi: number }) => c.anthropic + c.airwallex + c.airi === 0;
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

export function visaFirstFacts(r: VisaRec | null, file: string, reuseHref: string): FirstFact[] {
  if (!r) return [];
  const out: FirstFact[] = [], rec = `${REPO_BLOB}${file}`;
  const paid = r.purchases.find((p) => p.outcome?.status === "succeeded" && p.payment_intent_id && p.proposal_id);
  if (paid?.request) out.push({ icon: "scan-face", head: `Paid after Face ID: ${paid.request.currency} ${paid.request.amount}`, text: "The signed terms read back equal at Airi and Airwallex.", link: "Payment", href: rec, id: paid.payment_intent_id!, external: true });
  const reused = r.purchases.find((p) => p.outcome?.code === "PURSER_CREDENTIAL_ALREADY_USED" && zero(p.calls) && p.mandate_id);
  if (reused) out.push({ icon: "credit-card", head: "Reused credential refused", text: "PURSER_CREDENTIAL_ALREADY_USED, before any outside call.", link: "Credential", href: reuseHref, id: reused.mandate_id!, external: false });
  const cap = r.purchases.find((p) => p.outcome?.code === "PURSER_ABOVE_HARD_CAP" && zero(p.calls));
  if (cap?.request) out.push({ icon: "ban", head: `Over the hard cap: ${cap.request.currency} ${cap.request.amount}`, text: "PURSER_ABOVE_HARD_CAP, refused with no outside call.", link: "Run record", href: rec, id: `${r.run}, step ${cap.step}`, external: true });
  return out;
}

/** What the run is and is not, in one line, from its record: whose credential, and how often Claude was called. */
export function visaLimitsLine(r: VisaRec | null): string {
  if (!r) return "";
  const n = r.budgets?.anthropic?.used ?? 0, words = ["not once", "once", "twice"];
  const claude = n ? `Claude was called ${words[n] ?? `${n} times`}, to choose the rail; Purser's code held the limits` : "Claude was not called in this run; Purser's code held the limits";
  return `The run of ${dayOf(r.started_at)} (${r.run}): Airi's credential on Airi's test card, not a Visa network token; the Airwallex sandbox, test money. ${claude}.`;
}
