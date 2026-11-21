// The opening of /alta (Metal Award, 15 Nov; refreshed 19 Nov with the newest live records): three facts, each with its
// explorer links and the record it comes from, then the numbers. Every hash, amount and date is read here from the run
// records, never typed in:
//   inside and outside the mandate  docs/runs/2026-11-19-alta-series.json and -finish.json (19 Nov: the payments paid
//                     under the agent's mandate, and each attempt outside it refused on chain, with its reason); without
//                     them, the refusal of docs/runs/2026-11-12-faceid-onchain.json as before
//   two owners        docs/runs/2026-11-12-faceid-onchain.json (P-0002 relayed after 2 of 2 approvals) and
//                     docs/runs/passkey-owners.json (1 Nov: the mandate bind with the CFO's passkey alone, reverted on chain)
//   the anchor        docs/runs/2026-11-19-anchor.json, its verify-anchor MATCH as docs/runs/2026-11-19-alta-series.md
//                     prints it; without it, docs/runs/2026-11-13-anchor.json and docs/runs/2026-11-15-anchor-verified.json
// A record that is missing or does not show its fact leaves that fact out; with no fact the block is empty.

import { existsSync, readFileSync } from "node:fs";
import { EXPLORER, REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const ALTA_FACTS_ID = "alta-facts";
export const FACEID_RECORD = "docs/runs/2026-11-12-faceid-onchain.json";
export const OWNERS_RECORD = "docs/runs/passkey-owners.json";
export const ANCHOR_RECORD = "docs/runs/2026-11-13-anchor.json";
export const ANCHOR_VERIFIED_RECORD = "docs/runs/2026-11-15-anchor-verified.json";
export const NO_ENDORSEMENT_ALTA = "No endorsement implied";
/** The 19 Nov series on Alta testnet (pass 1 and pass 2), its run log, and the fresh anchor that pins both. */
export const SERIES_RECORDS = ["docs/runs/2026-11-19-alta-series.json", "docs/runs/2026-11-19-alta-series-finish.json"] as const;
export const SERIES_LOG = "docs/runs/2026-11-19-alta-series.md";
export const ANCHOR_19_RECORD = "docs/runs/2026-11-19-anchor.json";
/** Where the series' run log prints verify-anchor's output for the fresh anchor. */
export const ANCHOR_19_CHECK = `${SERIES_LOG}#the-anchor-fresh-and-its-check`;

type Step = { kind?: string; step?: string; outcome?: string; tx?: string | null; at?: string; event?: string; reason?: string; amount?: string };
type Series = { ran_at?: string; steps?: Step[] };
const TX = /^0x[0-9a-f]{64}$/;

function read<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T; } catch { return null; }
}
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

export interface AltaFact { id: "refused" | "owners" | "anchor"; title: string; text: string; links: { label: string; href: string }[]; record: string[];
  /** The tile's figure and its few words (/alta's proof tiles since 21 Nov; the owner: "not so much text"), from the same rows as the text. */
  fig: string; short: string }

export interface AltaFactsInput {
  faceid?: { steps?: Step[] } | null;
  owners?: { ran_at?: string; steps?: Step[] } | null;
  anchor?: { tx?: string; anchored_at?: string } | null;
  verified?: { result?: string; ran_at?: string; tx?: string } | null;
  /** The 19 Nov series' records, in order (pass 1, pass 2). */
  series?: (Series | null)[] | null;
  /** The 19 Nov anchor, and the series' run log (it prints verify-anchor's output for it). */
  anchor19?: { tx?: string; anchored_at?: string; height?: number; parts?: unknown[] } | null;
  seriesLog?: string | null;
}

const readText = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };
/** A refusal's reason as a link's few words. */
const REASON_LINK: Record<string, string> = { OverPerPaymentCap: "cap: tx", PayeeNotAllowed: "payee: tx", OverBudget: "budget: tx" };

export function altaFacts(i: AltaFactsInput = {
  faceid: read(FACEID_RECORD), owners: read(OWNERS_RECORD), anchor: read(ANCHOR_RECORD), verified: read(ANCHOR_VERIFIED_RECORD),
  series: SERIES_RECORDS.map((f) => read<Series>(f)), anchor19: read(ANCHOR_19_RECORD), seriesLog: readText(SERIES_LOG),
}): AltaFact[] {
  const out: AltaFact[] = [];
  const steps = i.faceid?.steps ?? [];
  const txOf = (s: Step | undefined) => (s && typeof s.tx === "string" && TX.test(s.tx) ? s.tx : null);

  // 19 Nov, the newest live run on Alta: every payment the chain paid under the agent's mandate, and every attempt
  // outside it that the chain refused (as the evidence wall counts them, src/redesign/evidenceWallData.ts: a step planned
  // as over the budget that the chain paid was inside it, so it is a payment, not an attempt outside the mandate).
  const series = (i.series ?? []).filter((x): x is Series => !!x);
  const sSteps = series.flatMap((x) => x.steps ?? []);
  const paid = sSteps.filter((x) => x.event === "MandatePayment" && txOf(x));
  const refused = sSteps.filter((x) => x.kind === "over-mandate" && x.outcome === "refused on chain" && x.event === "MandateRefused" && x.reason && txOf(x));
  const tried = sSteps.filter((x) => x.kind === "over-mandate" && x.event !== "MandatePayment");
  const ran = series[0]?.ran_at;
  if (paid.length && refused.length && refused.length === tried.length && ran) {
    const total = (paid.reduce((n, x) => n + Math.round(Number(x.amount) * 100), 0) / 100).toFixed(2);
    out.push({ id: "refused", title: "Refused on chain",
      text: `${day(ran)}: ${paid.length} payments inside the agent's mandate, ${total} test USD in all. Alta refused ${refused.length === 3 ? "all 3" : refused.length} attempts outside it on chain (${refused.map((x) => x.reason).join(", ")}); nothing moved.`,
      links: refused.map((x) => ({ label: REASON_LINK[x.reason!] ?? "tx", href: `${EXPLORER}/tx/${txOf(x)}` })),
      fig: refused.length === tried.length ? `All ${tried.length}` : `${refused.length} of ${tried.length}`, short: `attempts outside the mandate, refused on chain (${day(ran)})`,
      // The run log (the first record's .md) tells both passes, each step with its transaction: one link for the two.
      record: [SERIES_RECORDS[0]] });
  }

  const refusal = steps.find((s) => s.kind === "refusal" && s.outcome === "refused on chain");
  const over = refusal?.step ? /^([\d.]+) to (\w+), over the mandate's ([\d.]+) cap/.exec(refusal.step) : null;
  if (!out.length && refusal && over && txOf(refusal) && refusal.at) {
    out.push({ id: "refused", title: "Refused on chain",
      text: `${day(refusal.at)}: ${over[1]} to ${over[2]}, over the mandate's ${over[3]} cap. Alta refused it on chain; nothing moved.`,
      links: [{ label: "tx", href: `${EXPLORER}/tx/${txOf(refusal)}` }], record: [FACEID_RECORD], fig: over[1]!, short: `over the ${over[3]} cap, refused on chain (${day(refusal.at)})` });
  }

  // The mandate change: the relay of P-0002 after both owners signed; and, separately, one passkey alone refused.
  const signed = steps.find((s) => s.kind === "approvals" && /P-0002/.test(s.step ?? "") && s.outcome === "2 of 2 approvals");
  const change = steps.find((s) => s.kind === "relay" && /P-0002/.test(s.step ?? "") && s.outcome === "executed");
  const alone = (i.owners?.steps ?? []).find((s) => /mandate with the CFO's passkey alone/.test(s.step ?? "") && s.outcome === "reverted");
  if (signed && change && txOf(change) && change.at) {
    const links = [{ label: "both: tx", href: `${EXPLORER}/tx/${txOf(change)}` }];
    const record = [FACEID_RECORD];
    let text = `${day(change.at)}: the cap changed only after both owners signed: the CFO's iPhone passkey and a labelled test passkey.`;
    if (alone && txOf(alone) && i.owners?.ran_at) {
      text += ` One passkey alone: refused on chain (${day(i.owners.ran_at)}, software passkeys).`;
      links.push({ label: "one: tx", href: `${EXPLORER}/tx/${txOf(alone)}` });
      record.push(OWNERS_RECORD);
    }
    out.push({ id: "owners", title: "Two passkey owners", text, links, record, fig: "Both", short: links.length > 1 ? "passkeys to change a cap; one alone is refused on chain" : "passkeys signed the cap change" });
  }

  // The fresh anchor of 19 Nov, which pins the series' records too; verify-anchor's MATCH as the run log prints it.
  const a19 = i.anchor19;
  if (a19?.tx && TX.test(a19.tx) && a19.anchored_at && a19.height) {
    // The exact line, compared as text (no pattern built from a path).
    const match = (i.seriesLog ?? "").split(/\r?\n/).includes(`MATCH: ${ANCHOR_19_RECORD}, tx ${a19.tx}`);
    // "The series above included" only when the series is the fact above and the anchor names its record as a part.
    const pins = out[0]?.record[0] === SERIES_RECORDS[0] && (a19.parts ?? []).some((x) => (x as { file?: string }).file === SERIES_RECORDS[0]);
    out.push({ id: "anchor", title: "Anchored",
      text: `${day(a19.anchored_at)}: the head of Purser's records, ${a19.height} rows and lines${pins ? ", the series above included" : ""}, in one transaction.${match ? " verify-anchor: MATCH." : ""}`,
      links: [{ label: "tx", href: `${EXPLORER}/tx/${a19.tx}` }], record: match ? [ANCHOR_19_RECORD, ANCHOR_19_CHECK] : [ANCHOR_19_RECORD],
      fig: String(a19.height), short: `records sealed in one transaction${match ? "; verify-anchor: MATCH" : ""} (${day(a19.anchored_at)})` });
    return out;
  }
  const at = i.anchor?.anchored_at;
  if (i.anchor?.tx && TX.test(i.anchor.tx) && at) {
    const v = i.verified && i.verified.result === "MATCH" && i.verified.tx === i.anchor.tx && i.verified.ran_at ? i.verified : null;
    out.push({ id: "anchor", title: "Anchored",
      text: `${day(at)}: the head of Purser's records, in one transaction.${v ? ` verify-anchor run live on ${day(v.ran_at!)}: MATCH.` : ""}`,
      links: [{ label: "tx", href: `${EXPLORER}/tx/${i.anchor.tx}` }], record: v ? [ANCHOR_RECORD, ANCHOR_VERIFIED_RECORD] : [ANCHOR_RECORD],
      fig: "1 tx", short: `the head of Purser's records${v ? "; verify-anchor: MATCH" : ""} (${day(at)})` });
  }
  return out;
}

export const ALTA_FACTS_CSS = `.afacts { display: grid; gap: 10px; margin: 0 0 18px; }
.afacts ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.afacts li { padding: 14px 16px; display: grid; gap: 6px; align-content: start; }
.afacts h2 { margin: 0; font-size: 17px; line-height: 1.3; display: flex; align-items: center; gap: 8px; }
.afacts p { margin: 0; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.afacts .alinks { display: flex; flex-wrap: wrap; gap: 0 14px; font-size: 14px; }
.afacts .alinks a { display: inline-flex; align-items: center; min-height: 44px; }
.afacts .anum { font-size: 15px; margin: 0; }
.afacts .anum a { display: inline-flex; align-items: center; min-height: 44px; }
.phd .noend { font-size: 13px; color: var(--muted); }`;

const ICON: Record<AltaFact["id"], string> = { refused: "ban", owners: "users", anchor: "shield-check" };
/** The record's readable page when it has one (the .md beside the .json), else the .json itself. */
const shown = (file: string) => { const md = file.replace(/\.json$/, ".md"); return md !== file && existsSync(new URL(`../../${md}`, import.meta.url)) ? md : file; };
/** A record named by its run's date ("12 Nov record"), its file in the link (and in the link's title). */
const RECORD_DAY: Record<string, string> = { [FACEID_RECORD]: "12 Nov", [OWNERS_RECORD]: "1 Nov", [ANCHOR_RECORD]: "13 Nov", [ANCHOR_VERIFIED_RECORD]: "15 Nov",
  [SERIES_RECORDS[0]]: "19 Nov", [ANCHOR_19_RECORD]: "19 Nov", [ANCHOR_19_CHECK]: "MATCH" };
const recordLink = (file: string) => `<a href="${esc(`${REPO_BLOB}${shown(file)}`)}" title="${esc(shown(file))}" target="_blank" rel="noopener">${esc(`${RECORD_DAY[file] ?? file.split("/").pop()} record`)} ↗</a>`;

/** The block: the three facts, then the numbers (the main run's Alta payments, with their list). */
export function altaFactsHtml(facts: AltaFact[], payments: { count: number; list: string } | null): string {
  if (!facts.length) return "";
  // data-rec: the fact's own record (its first), as the site's other dated blocks name theirs.
  const li = (f: AltaFact) => `<li class="card" id="fact-${f.id}" data-rec="${esc(f.record[0]!)}"><h2>${icon(ICON[f.id], 18)}${esc(f.title)}</h2><p>${esc(f.text)}</p>
<p class="alinks">${f.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}${f.record.map(recordLink).join("")}</p></li>`;
  const num = payments ? `<p class="anum">${esc(`${payments.count} Alta payments in the main run, each its own transaction.`)} <a href="${esc(`${REPO_BLOB}${payments.list}`)}" title="${esc(payments.list)}" target="_blank" rel="noopener">${esc("3 Nov record")} ↗</a></p>` : "";
  return `<section class="afacts" id="${ALTA_FACTS_ID}" aria-label="${esc("Three facts on Alta testnet")}"><ol>${facts.map(li).join("")}</ol>${num}</section>`;
}

/**
 * The three facts as proof tiles under /alta's scene (the owner, 21 Nov: "not so much text"): the title, one figure,
 * its few words, and the same explorer links and records as the full facts (whose text stays in the page's folds).
 */
export function altaTilesHtml(facts: AltaFact[]): string {
  if (!facts.length) return "";
  const li = (f: AltaFact) => `<li class="card" id="fact-${f.id}" data-rec="${esc(f.record[0]!)}"><h2>${icon(ICON[f.id], 16)}${esc(f.title)}</h2><span class="at-v">${esc(f.fig)}</span><p>${esc(f.short)}</p>
<p class="alinks">${f.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}${f.record.slice(0, 1).map(recordLink).join("")}</p></li>`;
  return `<section class="afacts atiles" id="${ALTA_FACTS_ID}" aria-label="${esc("Three facts on Alta testnet")}"><ol>${facts.map(li).join("")}</ol></section>`;
}

export const ALTA_TILES_CSS = `.atiles { margin: 0; }
.atiles ol { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.atiles li { gap: 2px; padding: 12px 16px 4px; }
.atiles h2 { font-size: 13px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.atiles h2 svg { color: var(--metal); }
.atiles .at-v { font-size: clamp(28px, 3vw, 36px); font-weight: 780; letter-spacing: -.03em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.atiles p { font-size: 14.5px; }
@media (max-width: 760px) { .atiles ol { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .atiles li { grid-template-columns: 92px minmax(0, 1fr); column-gap: 12px; padding: 10px 14px 2px; } .atiles li > * { grid-column: 2; }
  .atiles .at-v { grid-column: 1; grid-row: 1 / span 3; align-self: center; font-size: 28px; } }`;
