// /t0's "Independent ledger check" tile (partner review, 14 Nov): T:0 as a control, not a mirror. Purser's books close
// only when T:0 agrees (src/accounting/closeGate.ts). The tile's sentence is computed here, at build, by running that
// check on the recorded read-back (docs/runs/2026-11-14-t0-readback.json) against Purser's books as recorded on 10 Nov;
// a missing record shows no tile, and a disagreeing one says so. The read-back downloads at /t0-readback.json.

import { readFileSync } from "node:fs";
import { closeCheckText, type CloseCheck } from "../accounting/closeGate.js";
import { entriesOfRecord, recordedAccounts, recordedCloseCheck, T0_POSTED_2026_11_10, T0_READBACK_FILE, T0_READBACK_PATH, type ReadBackRecord } from "../accounting/t0Readback.js";
import { browserCode } from "./browserCode.js";
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
.t0c a { display: inline-flex; align-items: center; min-height: 44px; overflow-wrap: anywhere; }
#t0c-run { border-top: 1px solid var(--border); padding-top: 10px; display: grid; gap: 8px; }
#t0c-run .t0c-ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
#t0c-run button { min-height: 44px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface, transparent); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
#t0c-run button:focus-visible, #t0c-run input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
#t0c-run label { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 15px; cursor: pointer; }
#t0c-run input { width: 20px; height: 20px; }
#t0c-run .t0c-out { margin: 0; min-height: 1.45em; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
#t0c-run .t0c-out.ok { color: var(--ok); } #t0c-run .t0c-out.no { color: var(--bad, #b42318); }`;

/** The run button's words and its toggle's. */
export const T0_RUN = { button: "Run the close check", toggle: "Change one cent", note: "Runs Purser's close check in your browser on the downloaded read-back. The cent is changed in your browser only." } as const;

/** What the page's script compares the read-back with: Purser's books as recorded on 10 Nov, per T:0 account, in cents. */
export const t0RunData = () => ({ accounts: Object.fromEntries(recordedAccounts()), count: T0_POSTED_2026_11_10, path: T0_READBACK_PATH.slice(1) });

/**
 * The button's script: fetch the read-back, run closeCheck (src/accounting/closeGate.ts, its types stripped) against
 * the recorded books; with the toggle on, one entry's lines get a cent more (debit and credit alike, so it still
 * balances) and the check says which entry and account keep the month open.
 */
export const T0_CLOSE_JS = `(function () {
${browserCode("src/accounting/closeGate.ts")}
var box = document.getElementById("t0c-run"); var data = document.getElementById("run-data");
if (!box || !data || !window.fetch) return;
var d = JSON.parse(data.textContent); var out = box.querySelector(".t0c-out"); var flip = box.querySelector("input"); var btn = box.querySelector("button");
box.hidden = false;
btn.addEventListener("click", function () {
  out.className = "t0c-out"; out.textContent = "Checking…"; btn.disabled = true;
  fetch(d.path).then(function (r) { if (!r.ok) throw new Error("the read-back did not load (" + r.status + ")"); return r.json(); }).then(function (rec) {
    var t0 = rec.entries.map(function (e) { return { je_number: e.je_number, atoms_per_unit: 100, lines: e.lines.map(function (l) { return { account_id: l.account, account_number: l.account, line_type: l.side, amount_atoms: l.cents }; }) }; });
    var changed = null;
    if (flip.checked && t0.length) { var e = t0[Math.floor(t0.length / 2)]; e.lines.forEach(function (l) { l.amount_atoms += 1; }); changed = e.je_number; }
    var t = performance.now();
    var c = closeCheck({ month: "2026-11", t0: t0, ourAccounts: new Map(Object.entries(d.accounts)), ourCount: d.count });
    var ms = (performance.now() - t).toFixed(1);
    if (c.agrees) { out.className = "t0c-out ok"; out.textContent = "The month can close. " + closeCheckText(c) + " Checked " + t0.length + " entries in " + ms + " ms."; }
    else {
      var p = c.problems.filter(function (x) { return x.kind === "account_differs" && changed && (x.entries || []).indexOf(changed) >= 0; })[0] || c.problems[0];
      out.className = "t0c-out no";
      out.textContent = changed && p.account ? "Month stays open: " + changed + " differs on account " + p.account + "." : "Month stays open: " + p.text + ".";
    }
  }).catch(function (err) { out.className = "t0c-out no"; out.textContent = String(err && err.message || err); }).then(function () { btn.disabled = false; });
});
})();`;

/** The tile: what T:0 said, the rule, and the read-back to download. */
export function t0CloseTileHtml(f: T0CloseFacts | null = t0CloseFacts()): string {
  if (!f) return "";
  const ok = f.check.agrees;
  return `<section class="card t0c${ok ? "" : " bad"}" id="${T0_CLOSE_ID}">
<h2>${icon(ok ? "circle-check" : "triangle-alert", 20)}${esc(T0_CLOSE_HEADING)}</h2>
<p class="t0c-says">${esc(f.text)}</p>
<p>${esc(T0_CLOSE_RULE)}</p>
<p class="t0c-src">${esc(`Read back ${DAY.format(new Date(f.readAt))}, read only. T:0 sandbox, test data.`)}</p>
<div id="t0c-run" hidden>
<div class="t0c-ctl"><button type="button">${esc(T0_RUN.button)}</button><label><input type="checkbox">${esc(T0_RUN.toggle)}</label></div>
<p class="t0c-out" aria-live="polite"></p>
<p class="t0c-src">${esc(T0_RUN.note)}</p>
</div>
<p class="t0c-links"><a href="${esc(T0_READBACK_PATH.slice(1))}" download>${esc(`Download the read-back (ids, amounts, times)`)}</a><a href="${esc(`${REPO_BLOB}src/accounting/closeGate.ts`)}" target="_blank" rel="noopener">${esc("The check")} ↗</a></p>
</section>`;
}
