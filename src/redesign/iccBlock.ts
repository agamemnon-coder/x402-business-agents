// The ICC block on /visa (Visa Intelligent Commerce Connect, 12 Nov). Until an ICC run record exists under docs/runs,
// the block is one quiet line, the only status sentence the stream allows (ICC_STATUS), and nothing else. Once
// `npm run icc -- record` has written docs/runs/<date>-icc.json, the block reads every number and id from that file,
// through readIccRunRecord (src/icc/record.ts), and says no more than it does: the result first (the date, each
// purchase's outcome in the record's own words), then what was not done, the checks, the calls and the budget in a
// fold, the ids and hashes last. A file that fails the reader's checks counts as absent. Classes from the Airi run's
// block and the read-back (AIRI_CSS, READBACK_CSS, both on /visa already): no new style.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readIccRunRecord, type IccRunRecord } from "../icc/record.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

/** The one status sentence the stream allows while no ICC run record exists, word for word. */
export const ICC_STATUS = "Intelligent Commerce Connect: access requested, not granted yet; not used in this entry.";
/** Where `npm run icc -- record` writes the run record. */
export const ICC_RUNS_DIR = fileURLToPath(new URL("../../docs/runs/", import.meta.url));
export const ICC_RUN_ID = "icc-run";
/** The words a run record's block may add in sight to /visa over the status sentence: /visa's word budgets
 * (test/site-v4.test.ts, test/browser/pages.check.ts) grow by this much only while a valid record exists. */
export const ICC_RUN_EXTRA_WORDS = 45;

/** The newest valid ICC run record in dir, by its own date, with its file name; null when there is none. */
export function iccRecordFileIn(dir = ICC_RUNS_DIR): { rec: IccRunRecord; file: string } | null {
  if (!existsSync(dir)) return null;
  const found = readdirSync(dir).filter((f) => f.endsWith("-icc.json")).flatMap((file) => {
    // A file the reader refuses (or cannot read) is not a record: the page shows the status sentence instead.
    try { return [{ rec: readIccRunRecord(readFileSync(join(dir, file), "utf8")), file }]; } catch { return []; }
  });
  return found.sort((a, b) => b.rec.run_date.localeCompare(a.rec.run_date))[0] ?? null;
}

/** The newest valid ICC run record in dir, or null. */
export const iccRecordIn = (dir = ICC_RUNS_DIR): IccRunRecord | null => iccRecordFileIn(dir)?.rec ?? null;

const day = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** The block for a record: result first, details on click, ids and hashes last. `md` is the run record's Markdown, if it is there. */
export function iccRunHtml(r: IccRunRecord, md: string | null = null): string {
  // A refusal wears the red badge, as purchase C's does on the Airi run; any other outcome a neutral one: the words are the record's.
  const out = `<ul class="airi-out">${r.purchases.map((p) => `<li${p.refusal_code ? ' class="no"' : ""}><span class="${p.refusal_code ? "awm bad" : "pill"}">${esc(p.label)}</span> ${esc(`${p.currency} ${p.amount} at ${p.merchant}: ${p.outcome}${p.refusal_code ? ` (${p.refusal_code})` : ""}.`)}</li>`).join("")}</ul>`;
  // What was not done opens first under Details, sentence by sentence, in the record's own words; in sight, the
  // outcome lines already say what happened ("no payment was made" where the record says so).
  const notDone = r.not_done.length ? `<p><b>${esc("Not done")}</b></p><ul class="awc">${r.not_done.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "";
  const checks = r.checks.length ? `<p><b>${esc("Checks")}</b></p><ul class="awc">${r.checks.map((k) => `<li${k.ok ? "" : ' class="no"'}>${esc(`${k.ok ? "✓" : "✕"} ${k.stage} · ${k.name}: ${k.detail}`)}</li>`).join("")}</ul>` : "";
  const calls = `<p><b>${esc("Calls")}</b></p><ul class="awc">${r.calls.by_endpoint.map((e) => `<li><code>${esc(e.endpoint)}</code>: ${esc(`${e.calls}`)}</li>`).join("")}</ul>
<p class="src">${esc(`${r.calls.total} calls in the call log, of a budget of ${r.calls.budget}.`)}</p>`;
  const ids = r.purchases.flatMap((p) => {
    const parts = [
      ...(p.approved_with ? [`CFO approval: ${esc(p.approved_with)}`] : []),
      ...(p.terms_sha256 ? [`terms hash <code>${esc(p.terms_sha256)}</code>`] : []),
      ...(p.instruction_id ? [`instruction <code>${esc(p.instruction_id)}</code>`] : []),
    ];
    return parts.length ? [`<li>${esc(p.label)}: ${parts.join(" · ")}</li>`] : [];
  });
  const idList = ids.length ? `<p><b>${esc("Ids and hashes")}</b></p><ul class="awc">${ids.join("")}</ul>` : "";
  const link = md ? `<p class="src"><a class="pf" href="${esc(`${REPO_BLOB}docs/runs/${md}`)}" target="_blank" rel="noopener">${esc("run record")} ↗</a></p>` : "";
  return `<div class="awrb"><div class="card airi" id="${ICC_RUN_ID}"><h3 class="airi-h">${icon("credit-card", 18)}${esc(`Intelligent Commerce Connect: a ${r.environment} run (${day(r.run_date)})`)}</h3>
<p class="airi-label">${esc("A separate run, read from its record")}</p>
${out}
<details class="fold"><summary>${esc("Details")}</summary>
${notDone}
${checks}
${calls}
${idList}
${link}</details></div></div>`;
}

/** The block for /visa: the record's block when docs/runs (or dir) holds a valid ICC run record, else the status sentence. */
export function iccBlock(dir = ICC_RUNS_DIR): string {
  const found = iccRecordFileIn(dir);
  if (!found) return `<p class="septest">${esc(ICC_STATUS)}</p>`;
  const md = `${basename(found.file, ".json")}.md`;
  return iccRunHtml(found.rec, existsSync(join(dir, md)) ? md : null);
}
