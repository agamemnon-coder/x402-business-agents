// The strongest proof first (Max's last round, item 2): the short claims each partner card on /proof opens with, every
// one a link to where it is proven, every number read from its record and never typed in. They say in fewer words what
// PROOF_SENTENCES (src/config/brand.ts) says; test/proof-first.test.ts checks both against the records.
// - Airwallex: the hash the CFO signed in Airwallex's own record of the SWIFT payment (hashTravel), and the cards that
//   carry the CFO's policy (cardControlRows), each linked to its anchor on /airwallex.
// - Metal: #24 refused on chain and the payments, each its own tx (metalStory), linked to Metal's testnet explorer.
// - Claude: the main run's decisions and fallbacks (split, from agent_stats), and the reliability run's hand-off fault
//   with its fix: the eval rebuilt from rel-1's moment, before (docs/runs/reliability-2026-11.md) and after
//   (docs/evals/agents.json) the fix, and the next run (docs/demo/reliability.json).

import { readFileSync } from "node:fs";
import { AWX_CONTROLS_ID, AWX_HASH_ID, awxCardId, cardControlRows, cardsReadback, hashTravel, transferReadback, type CardsReadback, type TransferReadback } from "./airwallexProof.js";
import { metalStory, refusalNote, REPO_BLOB } from "./metalStory.js";
import { split, type RunRecord } from "./run.js";
import { esc } from "./ui.js";

export interface LeadLink { label: string; href: string }
export interface Lead {
  text: string; href: string;
  /** A small line under the claim, saying exactly what its numbers are. */
  note?: string;
  /** Further links beside the claim (each card's own anchor). */
  links?: LeadLink[];
}

/** The eval rebuilt from the reliability run's moment, before and after the fix. */
export const RELIABILITY_CASE = "treasury-card-raise";
export const RELIABILITY_LOG = "docs/runs/reliability-2026-11.md";
export interface ReliabilityFix { run: string; next: string; commit: string; before: { passed: number; runs: number }; after: { passed: number; runs: number } }

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * The fix, from its three records, or null when any of them does not say it: the first reliability run that did not
 * pass and the next one that did (docs/demo/reliability.json), the eval's result before the fix and the fix's commit
 * (the reliability log), and its result after (the eval record, run on that commit).
 */
export function reliabilityFix(): ReliabilityFix | null {
  const runs = JSON.parse(read("docs/demo/reliability.json")) as { run: string; passed: boolean }[];
  const i = runs.findIndex((r) => !r.passed);
  const next = i >= 0 ? runs.slice(i + 1).find((r) => r.passed) : undefined;
  const log = read(RELIABILITY_LOG);
  const row = log.split("\n").find((l) => l.startsWith(`| \`${RELIABILITY_CASE}\` |`)) ?? "";
  const before = /\| (\d+)\/(\d+) before the fix\./.exec(row);
  const commit = /The fix\*\* is commit ([0-9a-f]{7,40})\b/.exec(log)?.[1];
  const evals = JSON.parse(read("docs/evals/agents.json")) as { rows: { case: string; passed: number; runs: number; commit?: string }[] };
  const after = evals.rows.find((r) => r.case === RELIABILITY_CASE);
  if (i < 0 || !next || !before || !commit || !after || !after.commit?.startsWith(commit)) return null;
  return { run: runs[i]!.run, next: next.run, commit, before: { passed: Number(before[1]), runs: Number(before[2]) }, after: { passed: after.passed, runs: after.runs } };
}

/** Each partner card's opening claims, from the main run's record and the dated read-backs. */
export function proofLeads(record: RunRecord, o: { transfer?: { file: string; rec: TransferReadback } | null; cards?: { file: string; rec: CardsReadback } | null } = {}): Record<"airwallex" | "metal" | "claude", Lead[]> {
  const h = hashTravel(record, o.transfer === undefined ? transferReadback() : o.transfer);
  const rb = o.cards === undefined ? cardsReadback() : o.cards;
  const rows = rb ? cardControlRows(record, rb) : [];
  const m = metalStory(record), sp = split(record), rf = reliabilityFix();
  return {
    airwallex: [
      ...(h?.match ? [{ text: `The hash the CFO signed is in Airwallex's own record of the ${h.transferMethod} payment`, href: `airwallex#${AWX_HASH_ID}` }] : []),
      ...(rows.length ? [{
        text: `${rows.filter((r) => r.match).length} of ${rows.length} cards carry the CFO's policy`, href: `airwallex#${AWX_CONTROLS_ID}`,
        links: rows.map((r) => ({ label: `${r.name.replace(/ agent$/, "")} ····${r.last4}`, href: `airwallex#${awxCardId(r.agent)}` })),
      }] : []),
    ],
    metal: [
      // What the explorer shows for it, beside the link (jury review, 7 Nov, #3): the log is not decoded there.
      ...(m.refusal?.proof.href ? [{ text: `#${m.refusal.seq} refused on chain`, href: m.refusal.proof.href, ...(refusalNote(m.refusal) ? { note: refusalNote(m.refusal)! } : {}) }] : []),
      ...(m.payments.total && m.payments.account.href ? [{ text: `${m.payments.total} payments, each its own tx`, href: m.payments.account.href }] : []),
    ],
    claude: [
      { text: sp.byClaude === sp.decisions ? `all ${sp.decisions} decisions by Claude, ${sp.fallbacks} fallbacks` : `${sp.byClaude} decisions by Claude, ${sp.fallbacks} fallbacks`, href: "claude" },
      // Max's line; the note says what 6/10 → 10/10 is: the eval rebuilt from the run's moment, not the run itself.
      ...(rf ? [{
        text: `a reliability run found a hand-off fault; ${rf.after.passed === rf.after.runs ? "the rebuilt eval now passes every run" : "fixed"}`, href: `${REPO_BLOB}${RELIABILITY_LOG}`,
        note: `The eval rebuilt from the reliability run's moment, before and after the fix (commit ${rf.commit}); the next reliability run passed every step.`,
      }] : []),
    ],
  };
}

export const LEAD_CSS = `ul.lead { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
ul.lead li { border-left: 4px solid var(--ok); padding: 2px 0 2px 12px; min-width: 0; font-size: 16.5px; line-height: 1.35; }
ul.lead a.c { color: var(--text); font-weight: 720; font-size: 17.5px; line-height: 1.35; text-decoration: underline; text-decoration-color: var(--border); text-underline-offset: 4px; overflow-wrap: anywhere; }
ul.lead a.c:hover { text-decoration-color: var(--accent); }
ul.lead .ks { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 2px; font-size: 14.5px; }
ul.lead .ks a { color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap; }
ul.lead small { display: block; margin-top: 2px; color: var(--muted); font-size: 14px; line-height: 1.4; }`;

/** A card's opening claims: each a link (a page of ours in this tab, the explorer or GitHub in a new one). */
export function leadHtml(leads: Lead[]): string {
  if (!leads.length) return "";
  const a = (href: string, cls: string, label: string) => {
    const out = /^https:\/\//.test(href);
    return `<a${cls ? ` class="${cls}"` : ""} href="${esc(href)}"${out ? ' target="_blank" rel="noopener"' : ""}>${esc(label)}${out ? "\u00a0↗" : ""}</a>`;
  };
  return `<ul class="lead">${leads.map((l) => `<li>${a(l.href, "c", l.text)}${l.links?.length ? `<span class="ks">${l.links.map((k) => a(k.href, "", k.label)).join("")}</span>` : ""}${l.note ? `<small>${esc(l.note)}</small>` : ""}</li>`).join("")}</ul>`;
}
