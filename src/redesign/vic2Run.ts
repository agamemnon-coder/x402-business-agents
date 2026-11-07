// The second Airi run on the site (vic-2, 7 Nov): what Purser adds around Airwallex's Airi, with the CFO's Face ID on
// the hosted relay and 0 Airi and 0 Airwallex calls in the whole run: nothing is bought. Shown on /visa under the VIC
// flow (in full, nothing folded) and on /airwallex and /proof (short, linking to /visa). Everything is read from its record,
// docs/demo/vic-2-run.json (the conductor's record, sanitised: no passkey credential id or assertion); the run log is
// docs/runs/2026-11-07-vic-2.md. The block shows only when the record is a live run's with every check passing and no
// outside call. The CFO is a role, never a person's name. test/vic2-run-page.test.ts holds every figure to the record.

import { existsSync, readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const VIC2_RUN_FILE = "docs/demo/vic-2-run.json";
export const VIC2_RUN_LOG = "docs/runs/2026-11-07-vic-2.md";
export const VIC2_RUN_ID = "airi-run-2";
export const VIC2_HEADING = "What Purser adds around Airi: a second live run";
export const VIC2_LABEL = "A separate run · nothing bought: 0 Airi and 0 Airwallex calls";
export const VIC2_BADGES = { D: "✕ Changed after Face ID: refused", E: "✕ Shop locked by the CFO: refused", F: "✓ Unlocked: offered again" } as const;

export interface Vic2Record {
  run: string;
  mode: "live" | "dry";
  started_at: string;
  ended_at: string;
  source: string;
  steps: {
    D: { request: { amount: string; currency: string }; outcome: { proposalId: string }; end: string; alteration: { changed: { amount: { from: string; to: string } } }; executor: { refused: string }; airi_calls: number };
    E: { lock: { proposal_id: string; end: string }; purchase: { amount: string; currency: string; outcome: { status: string; code: string } }; airi_calls: number };
    F: { unlock: { proposal_id: string; end: string }; offer: { offered: boolean }; airi_calls: number };
  };
  checks: Record<string, { ok: boolean; detail: string }>;
  outside_calls: { airi: number; airwallex: number };
}

/** The live run's record, or null when there is none, it is not live, a check failed or anything outside was called. */
export function vic2Run(file = VIC2_RUN_FILE): Vic2Record | null {
  const url = new URL(`../../${file}`, import.meta.url);
  if (!existsSync(url)) return null;
  const rec = JSON.parse(readFileSync(url, "utf8")) as Vic2Record;
  const allOk = Object.values(rec.checks).every((c) => c.ok);
  return rec.mode === "live" && allOk && rec.outside_calls.airi === 0 && rec.outside_calls.airwallex === 0 ? rec : null;
}

export interface Vic2Line { badge: string; ok: boolean; text: string }

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const capital = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

/** The three outcomes, each from the record. */
export function vic2Lines(rec: Vic2Record): Vic2Line[] {
  const { D, E, F } = rec.steps;
  const ch = D.alteration.changed.amount;
  return [
    { badge: VIC2_BADGES.D, ok: true, text: `${D.request.currency} ${ch.from} approved with Face ID; our own labelled test then changed it to ${D.request.currency} ${ch.to}. Refused: not what the CFO signed.` },
    { badge: VIC2_BADGES.E, ok: true, text: `After the CFO's Face ID blocked the test shop, ${E.purchase.currency} ${E.purchase.amount} within the limit was refused before Airi was asked.` },
    { badge: VIC2_BADGES.F, ok: F.offer.offered, text: "A second Face ID lifted the block; the run stopped there." },
  ];
}

const checksUrl = `${REPO_BLOB}${VIC2_RUN_LOG}#checks`;

/**
 * The block. Full (/airwallex): heading, label, the three outcomes, "7 of 7 checks pass", the checks in a fold.
 * fold: false (/visa, where nothing is folded above the TAP picture): the same without the fold, the run log linked.
 * short (/airwallex, /proof): heading and the checks, a link to the outcomes on /visa.
 */
export function vic2RunHtml(rec: Vic2Record | null, o: { short?: boolean; fold?: boolean } = {}): string {
  if (!rec) return "";
  const checks = Object.entries(rec.checks);
  const ok = checks.filter(([, c]) => c.ok).length;
  const h = `<div class="card airi" id="${VIC2_RUN_ID}"><h3 class="airi-h">${icon("shield-check", 18)}${esc(`${VIC2_HEADING} (${day(rec.started_at)})`)}</h3>
<p class="airi-label">${esc(VIC2_LABEL)}</p>`;
  const link = `<a class="awm ok" href="${esc(checksUrl)}" target="_blank" rel="noopener">${icon("circle-check", 16)}${esc(`${ok} of ${checks.length} checks pass`)} ↗</a>`;
  // The text budgets of /airwallex and /proof (test/site-v4.test.ts) leave room for the heading and the checks only; the rest is a link away.
  if (o.short) return `<div class="card airi" id="${VIC2_RUN_ID}"><h3 class="airi-h">${icon("shield-check", 18)}${esc(`${VIC2_HEADING} (${day(rec.started_at)})`)}</h3>\n${link}\n<a class="open" href="visa#${VIC2_RUN_ID}">${esc("Details")} ${icon("arrow-right", 14)}</a></div>`;
  const out = `<ul class="airi-out">${vic2Lines(rec).map((l) => `<li class="${l.ok ? "ok" : "no"}"><span class="awm ${l.ok ? "ok" : "bad"}">${esc(l.badge)}</span> ${esc(l.text)}</li>`).join("")}</ul>`;
  const log = `<a class="pf" href="${esc(`${REPO_BLOB}${VIC2_RUN_LOG}`)}" target="_blank" rel="noopener">${esc("run log")} ↗</a>`;
  if (o.fold === false) return `${h}\n${out}\n${link}\n<p class="src">${log}</p></div>`;
  return `${h}
${out}
${link}
<details class="fold"><summary>${esc("Details")}</summary>
<ul class="awc">${checks.map(([n, c]) => `<li><code>${esc(n)}</code> ${esc(c.ok ? "✓" : "✕")} ${esc(capital(c.detail))}</li>`).join("")}</ul>
<p class="src">${esc(rec.source)} · ${log}</p></details></div>`;
}

export function vic2RunBlock(rec: Vic2Record | null = vic2Run(), o: { short?: boolean; fold?: boolean } = {}): string {
  return vic2RunHtml(rec, o);
}
