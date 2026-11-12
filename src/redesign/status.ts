// /status (12 Nov): a calm status page. The live part is the site's own /health (worker/src/core.ts, the relay), read by
// the visitor's browser with one small script and said in plain words: the site is up, whether a live run is going on
// ("no live run in progress" is the normal quiet state, not an error), the runner's last sync, the alarm codes.
//
// The page can never show a false "all good": its HTML is neutral ("not read yet"), and only an answer in /health's own
// shape, with a status that fits it, turns a line positive. A failed request, an answer that is no JSON or any other
// shape says "The status could not be read just now" and nothing else; the link to /health is in the HTML, so a
// reader without JavaScript has it too. Text only is written from the answer, and nothing beyond what /health publishes.
//
// Below it, static: the five newest live runs of /runs' own list (src/redesign/runs.ts), each linked to its record.
//
// "offline": the copy `npm run judge` serves. That server has no /health and no runner, so its copy says so, carries no
// script and links to the hosted page instead of an address that would not answer.

import { RUNNER_DOWN_AFTER_MS } from "../ops/publicHealth.js";
import { SITE_URL } from "../ui/meta.js";
import { REPO_BLOB } from "./metalStory.js";
import { outLink, productPage, repoHref, siteLink } from "./productPage.js";
import { RUNS_TITLE, RUNS_URL, liveRuns, type RunRow } from "./runs.js";
import { esc, icon } from "./ui.js";

export type StatusMode = "hosted" | "offline";
/** How many runs the page lists. */
export const STATUS_RUNS = 5;

export interface LatestRun { key: string; iso: string; day: string; title: string; short: string; href: string }

/** A run's record in the repository: its run log when /runs names one, else its first file; always a GitHub address. */
function recordHref(r: RunRow): string {
  const f = r.files.find((x) => x.label === "run log") ?? r.files[0];
  if (!f) throw new Error(`the run ${r.key} names no record`);
  // Some rows name their log relative to docs/runs/README.md ("../../docs/runs/…"): the same file, by its address.
  const href = f.href.startsWith("../") ? repoHref(f.href.replace(/^(?:\.\.\/)+/, "")) : f.href;
  if (!href.startsWith(REPO_BLOB)) throw new Error(`the run ${r.key}'s record is not a file of the repository: ${f.href}`);
  return href;
}

/** The newest runs of /runs' list (it is sorted newest first): the day without the year, and the title up to its first colon or bracket. */
export function latestRuns(rows: RunRow[] = liveRuns(), n = STATUS_RUNS): LatestRun[] {
  return rows.slice(0, n).map((r) => ({ key: r.key, iso: r.iso, day: r.date.replace(/ \d{4}$/, ""), title: r.title, short: r.title.split(/: | \(/)[0]!, href: recordHref(r) }));
}

const minutes = (ms: number) => `${ms / 60_000} minute${ms === 60_000 ? "" : "s"}`;

/**
 * The page's one script. It asks for "health" (the site's own /health, relative to the page; the page's policy allows
 * no other address) and writes text only. Every state it can end in is listed here; anything that is not /health's own
 * shape ends in `unread`.
 */
export const STATUS_JS = `(function () {
  var card = document.getElementById("now");
  if (!card) return;
  var DOWN = ${JSON.stringify(minutes(RUNNER_DOWN_AFTER_MS))};
  var CODE = /^[a-z0-9_]{1,40}$/;
  function put(id, text, cls) { var e = document.getElementById(id); if (e) { e.textContent = text; e.className = cls || ""; } }
  function agents(text) { var row = document.getElementById("st-agents-row"); if (row) row.hidden = text === null; if (text !== null) put("st-agents", text); }
  function when(iso) {
    var d = typeof iso === "string" ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return null;
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
  }
  function unread() {
    card.setAttribute("data-tone", "unread");
    put("st-head", "The status could not be read just now");
    put("st-site", "Not read"); put("st-runner", "Not read"); put("st-sync", "Not read"); put("st-alarms", "Not read");
    agents(null);
  }
  function show(http, b) {
    if (!b || typeof b !== "object" || !Array.isArray(b.alerts)) return unread();
    for (var i = 0; i < b.alerts.length; i++) if (typeof b.alerts[i] !== "string" || !CODE.test(b.alerts[i])) return unread();
    var n = b.alerts.length, codes = b.alerts.join(", ");
    var quiet = http === 200 && b.status === "recorded_demo" && b.runner === "off";
    var ok = http === 200 && b.status === "ok" && b.runner === "up" && n === 0;
    var alarm = http === 503 && b.status === "alert" && (b.runner === "up" || b.runner === "down" || b.runner === "unknown");
    if (!quiet && !ok && !alarm) return unread();
    var last = b.last_sync == null ? null : when(b.last_sync);
    if (quiet && b.last_sync != null && !last) return unread();
    put("st-site", "Up", "good");
    if (quiet) {
      card.setAttribute("data-tone", "quiet");
      put("st-head", "No live run in progress");
      put("st-runner", "Off between runs");
      put("st-sync", last || "None on record");
      put("st-alarms", n ? codes + " (at last sync)" : b.checked_at == null ? "No report on record" : "None at last sync", n ? "bad" : "");
    } else if (ok) {
      card.setAttribute("data-tone", "ok");
      put("st-head", "A live run is in progress");
      put("st-runner", "Syncing", "good");
      put("st-sync", "In the last " + DOWN);
      put("st-alarms", "None", "good");
    } else {
      card.setAttribute("data-tone", "alarm");
      put("st-head", b.runner === "down" ? "Live run expected, but the runner stopped syncing" : b.runner === "unknown" ? "Live run declared, but the runner has not synced" : "A live run is in progress, with an alarm");
      put("st-runner", b.runner === "up" ? "Syncing" : b.runner === "down" ? "Not syncing" : "No sync on record", b.runner === "up" ? "good" : "bad");
      put("st-sync", b.runner === "up" ? "In the last " + DOWN : b.runner === "down" ? "Over " + DOWN + " ago" : "None on record");
      put("st-alarms", n ? codes : "No health report from the runner", "bad");
    }
    var a = b.live_agents_today;
    agents(a && typeof a === "object" && typeof a.usd === "number" && typeof a.budget_usd === "number" && isFinite(a.usd) && isFinite(a.budget_usd) && a.usd >= 0 && a.budget_usd > 0 ? "$" + a.usd.toFixed(2) + " of $" + a.budget_usd.toFixed(2) : null);
  }
  try {
    fetch("health", { cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json().then(function (b) { show(r.status, b); }); })
      .catch(unread);
  } catch (e) { unread(); }
})();`;

/** The page's own few rules: the status lines (label left, value right) and the runs' days; the design system's tokens only. */
const STATUS_CSS = `.kv { margin: 0; }
.kv > div { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 9px 0; border-top: 1px solid var(--border); font-size: 16px; line-height: 1.4; }
.kv > div[hidden] { display: none; }
.kv dt { color: var(--muted); flex: none; }
.kv dd { margin: 0; text-align: right; font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.kv dd.good { color: var(--ok); } .kv dd.bad { color: var(--bad); }
#st-head { flex: 1 1 0; min-width: 0; }
#now[data-tone="unread"] .kv dd { color: var(--muted); }
#now[data-tone="ok"] h2 .ic { color: var(--ok); } #now[data-tone="alarm"] h2 .ic { color: var(--bad); } #now[data-tone="unread"] h2 .ic { color: var(--muted); }
ul.pl time { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 4px; white-space: nowrap; }`;

const line = (label: string, id: string, rowId = "") => `<div${rowId ? ` id="${rowId}" hidden` : ""}><dt>${esc(label)}</dt><dd id="${id}">—</dd></div>`;

export function statusPage(mode: StatusMode = "hosted"): string {
  const runs = latestRuns(), labels = [...new Set(liveRuns().slice(0, STATUS_RUNS).map((r) => r.money))];
  const now = mode === "hosted"
    ? `<article class="pc card" id="now" aria-live="polite"><h2><span class="ic">${icon("circle-dot", 19)}</span><span id="st-head">Live status not read yet</span></h2>
    <dl class="kv">${line("Site", "st-site")}${line("Runner", "st-runner")}${line("Last sync", "st-sync")}${line("Alarms", "st-alarms")}${line("Try agents today", "st-agents", "st-agents-row")}</dl>
    <div class="links">${siteLink("health", "The raw answer: /health")}</div></article>`
    : `<article class="pc card" id="now"><h2><span class="ic">${icon("circle-dot", 19)}</span>No live status in this copy</h2>
    <p>It runs on your computer, with no runner behind it.</p>
    <div class="links">${outLink(`${SITE_URL}/status`, "The hosted status page")}</div></article>`;
  const body = `<div class="cols c2">
  ${now}
  <article class="pc card" id="runs"><h2><span class="ic">${icon("calendar-range", 19)}</span>Latest live runs<span class="pill">${esc(labels.join(" · "))}</span></h2>
    <ul class="pl">${runs.map((r) => `<li><time datetime="${esc(r.iso)}">${esc(r.day)}</time> <a class="pf" href="${esc(r.href)}" target="_blank" rel="noopener" title="${esc(r.title)}">${esc(r.short)} ↗</a></li>`).join("")}</ul>
    <div class="links">${siteLink(RUNS_URL, RUNS_TITLE)}</div></article>
</div>`;
  return productPage({
    key: "status", title: "Status", h1: "Status", label: "Sandbox and testnet only",
    lead: mode === "hosted" ? "Read live from this site itself." : "An offline copy: nothing here is live.",
    description: "Purser's status in plain words: whether the site is up and a live run is in progress, the runner's last sync and alarms, and the five latest live runs. Sandbox and testnet only.",
    body, css: STATUS_CSS, ...(mode === "hosted" ? { js: STATUS_JS } : {}),
    source: "Source: this site's own /health (worker/src/core.ts) and each run's record, as /runs lists them (src/redesign/runs.ts).",
    real: mode === "hosted" ? [
      "Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.",
      "The live part is this site's own /health, read by your browser when the page opens.",
      "No live run in progress is the normal state: the hosted pages replay the recorded run.",
    ] : [
      "Sandbox and testnet only: Airwallex's sandbox, Metal's testnet, test money.",
      "This offline copy has no runner and no /health: nothing on it is live.",
    ],
  });
}
