// /t0's "Independent ledger check" tile (partner review, 14 Nov): T:0 as a control, not a mirror. Purser's books close
// only when T:0 agrees (src/accounting/closeGate.ts). The tile's sentence is computed here, at build, by running that
// check on the recorded read-back (docs/runs/2026-11-14-t0-readback.json) against Purser's books as recorded on 10 Nov;
// a missing record shows no tile, and a disagreeing one says so. The read-back downloads at /t0-readback.json.

import { readFileSync } from "node:fs";
import { closeCheckText, type CloseCheck } from "../accounting/closeGate.js";
import { entriesOfRecord, recordedCloseCheck, T0_READBACK_FILE, T0_READBACK_PATH, type ReadBackRecord } from "../accounting/t0Readback.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const T0_CLOSE_ID = "t0-close-check";
export const T0_CLOSE_HEADING = "Independent ledger check";
export const T0_CLOSE_RULE = "Books close only when T:0 agrees: one cent off keeps the month open and names the entry.";

export interface T0CloseFacts { check: CloseCheck; text: string; readAt: string; entries: number }

export function t0CloseFacts(raw: string | null = readRecord()): T0CloseFacts | null {
  if (!raw) return null;
  let rec: ReadBackRecord;
  try { rec = JSON.parse(raw) as ReadBackRecord; } catch { return null; }
  if (!Array.isArray(rec.entries) || !rec.read_at) return null;
  const check = recordedCloseCheck(entriesOfRecord(rec));
  return { check, text: closeCheckText(check), readAt: rec.read_at, entries: rec.entries.length };
}

function readRecord(): string | null {
  try { return readFileSync(new URL(`../../${T0_READBACK_FILE}`, import.meta.url), "utf8"); } catch { return null; }
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const T0_CLOSE_CSS = `.t0c { padding: 16px 18px; display: grid; gap: 6px; border-left: 4px solid var(--ok); }
.t0c.bad { border-left-color: var(--bad, #b42318); }
.t0c h2 { font-size: 19px; line-height: 1.25; margin: 0; display: flex; align-items: center; gap: 8px; }
.t0c .t0c-says { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.4; }
.t0c p { margin: 0; font-size: 15px; line-height: 1.45; }
.t0c .t0c-src { font-size: 13.5px; color: var(--muted); }
.t0c .t0c-links { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.t0c a { display: inline-flex; align-items: center; min-height: 44px; overflow-wrap: anywhere; }`;

/** The tile: what T:0 said, the rule, and the read-back to download. */
export function t0CloseTileHtml(f: T0CloseFacts | null = t0CloseFacts()): string {
  if (!f) return "";
  const ok = f.check.agrees;
  return `<section class="card t0c${ok ? "" : " bad"}" id="${T0_CLOSE_ID}">
<h2>${icon(ok ? "circle-check" : "triangle-alert", 20)}${esc(T0_CLOSE_HEADING)}</h2>
<p class="t0c-says">${esc(f.text)}</p>
<p>${esc(T0_CLOSE_RULE)}</p>
<p class="t0c-src">${esc(`Read back ${DAY.format(new Date(f.readAt))}, read only. T:0 sandbox, test data.`)}</p>
<p class="t0c-links"><a href="${esc(T0_READBACK_PATH.slice(1))}" download>${esc(`Download the read-back (ids, amounts, times)`)}</a><a href="${esc(`${REPO_BLOB}src/accounting/closeGate.ts`)}" target="_blank" rel="noopener">${esc("The check")} ↗</a></p>
</section>`;
}
