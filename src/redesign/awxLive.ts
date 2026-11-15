// Live with Airwallex (14 Nov), on /proof and Home: the two-way story with Airwallex, read live.
//   /proof  the reconciliation badge ("Purser's books = Airwallex's transactions · all 12 matched · checked 18:20 UTC")
//           and the newest Airwallex events (signature verified), from the site's own JSON (worker/src/awxBooks.ts,
//           worker/src/awxEvents.ts). Every value goes on the page as text; nothing here writes anywhere.
//   Home    the same badge as an image (worker/src/awxBooks.ts, AWX_BOOKS_SVG_PATH): Home's script reaches no network.
// Without the site's Worker (a local preview), the badge says "Airwallex unavailable" and the feed says so: never a
// number that was not read.

import { AWX_BADGE_LIST_URL, AWX_BADGE_TITLE } from "../finance/awxBadge.js";

export const AWX_LIVE_ID = "awx-live";
/** The site's paths (worker/src/awxBooks.ts, worker/src/awxEvents.ts), relative so they work at any depth of the site. */
const BOOKS_JSON = "awx-live/books.json";
const BOOKS_SVG = "awx-live/books.svg";
const EVENTS_JSON = "awx-live/events.json";
/** Events shown on /proof; all 50 are in Purser Cloud's Airwallex tab. */
export const AWX_LIVE_SHOWN = 5;
export const AWX_LIVE_HEAD = "Live with Airwallex";
export const AWX_LIVE_LEAD = "Purser asks the Airwallex sandbox for a quote or sends it a transfer, live, test money. The signed events feed is built and switched on: it shows Airwallex's webhooks as Airwallex sends them.";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** /proof's block: filled by AWX_LIVE_JS; without script it says it could not check. */
export function awxLiveHtml(): string {
  return `<section class="axl" id="${AWX_LIVE_ID}" aria-labelledby="${AWX_LIVE_ID}-h">
  <h2 class="sec" id="${AWX_LIVE_ID}-h">${esc(AWX_LIVE_HEAD)}</h2>
  <p class="axl-lead">${esc(AWX_LIVE_LEAD)}</p>
  <div class="axl-badge grey" data-axl-badge role="status" aria-live="polite"><span class="axl-dot" aria-hidden="true"></span><span class="axl-bt"><b>${esc(AWX_BADGE_TITLE)}</b><span data-axl-badge-text>Not checked yet</span></span><a class="axl-list" data-axl-list href="${esc(AWX_BADGE_LIST_URL)}" hidden>See the list&nbsp;↗</a></div>
  <h3 class="axl-h">Airwallex events</h3>
  <p class="axl-state" data-axl-ev-state>Not checked yet</p>
  <ul class="axl-ev" data-axl-ev></ul>
  <p class="axl-more"><a href="${esc(AWX_BADGE_LIST_URL)}">All events and Airwallex's rows in Purser Cloud&nbsp;↗</a> <span>Only events whose signature verified are kept, and only their type, Airwallex object id and time.</span></p>
</section>`;
}

export const AWX_LIVE_CSS = `
.axl { margin: 28px 0; }
.axl-lead { color: var(--muted); margin: 4px 0 12px; max-width: 70ch; }
.axl-badge { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 6px 10px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--sunken); }
.axl-badge .axl-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); flex: none; }
.axl-badge .axl-bt { display: grid; gap: 2px; min-width: 0; }
.axl-badge.ok { background: var(--ok-soft); border-color: var(--ok); } .axl-badge.ok .axl-dot { background: var(--ok); }
.axl-badge.amber { background: #fdf3e1; border-color: #a35f00; } .axl-badge.amber .axl-dot { background: #a35f00; }
.axl-list { margin-left: auto; font-weight: 600; display: inline-flex; align-items: center; min-height: 44px; }
.axl-h { margin: 18px 0 6px; font-size: 16px; }
.axl-state { color: var(--muted); margin: 0 0 8px; }
.axl-ev { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.axl-ev li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); min-width: 0; }
.axl-ev .axl-t { font-weight: 600; } .axl-ev .axl-t code { font-weight: 400; color: var(--muted); font-size: 12.5px; margin-left: 6px; }
.axl-ev .axl-w { color: var(--muted); font-size: 13px; text-align: right; }
.axl-ev .axl-id { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.axl-ev .axl-id code { font-size: 12px; word-break: break-all; background: var(--sunken); padding: 2px 6px; border-radius: 6px; }
.axl-ev .axl-ok { color: var(--ok); font-size: 13px; font-weight: 600; white-space: nowrap; }
.axl-ev button { font: inherit; font-size: 13px; min-height: 44px; min-width: 64px; padding: 2px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; flex: none; }
.axl-more { margin-top: 10px; font-size: 14px; } .axl-more a { display: inline-flex; align-items: center; min-height: 44px; } .axl-more span { display: block; color: var(--muted); }
@media (max-width: 520px) { .axl-ev li { grid-template-columns: minmax(0, 1fr); } .axl-ev .axl-w { text-align: left; } .axl-list { grid-column: 2; margin-left: 0; } }
`;

/** Fills /proof's block from the site's JSON; text only (textContent), no HTML from an answer ever reaches the page. */
export const AWX_LIVE_JS = `(function () {
  var box = document.getElementById(${JSON.stringify(AWX_LIVE_ID)});
  if (!box || !window.fetch) return;
  var badge = box.querySelector("[data-axl-badge]"), btext = box.querySelector("[data-axl-badge-text]"), list = box.querySelector("[data-axl-list]");
  var evs = box.querySelector("[data-axl-ev]"), evState = box.querySelector("[data-axl-ev-state]");
  function hm(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toISOString().slice(11, 16) + " UTC"; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) + ", " + hm(iso); }
  function get(u) { return fetch(u, { headers: { accept: "application/json" } }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  btext.textContent = "Checking Airwallex…";
  get(${JSON.stringify(BOOKS_JSON)}).then(function (b) {
    var n = function (v) { return typeof v === "number" && v >= 0 && v % 1 === 0; };
    if (b && b.state === "matched" && n(b.checked)) { badge.className = "axl-badge ok"; btext.textContent = "all " + b.checked + " matched · checked " + hm(b.checked_at); }
    else if (b && b.state === "unmatched" && n(b.unmatched)) { badge.className = "axl-badge amber"; btext.textContent = b.unmatched + " unmatched · checked " + hm(b.checked_at); list.hidden = false; }
    else { badge.className = "axl-badge grey"; btext.textContent = "Airwallex unavailable · last checked " + hm(b && b.checked_at || new Date().toISOString()); }
  }).catch(function () { badge.className = "axl-badge grey"; btext.textContent = "Airwallex unavailable · last checked " + hm(new Date().toISOString()); });
  evState.textContent = "Checking…";
  get(${JSON.stringify(EVENTS_JSON)}).then(function (a) {
    var rows = (a && Array.isArray(a.events) ? a.events : []).filter(function (e) { return e && e.signature_verified === true && typeof e.type === "string"; }).slice(0, ${AWX_LIVE_SHOWN});
    if (!rows.length) { evState.textContent = a && a.receiving === false ? "This site is not set up to receive Airwallex webhooks right now." : "No Airwallex event has arrived yet."; return; }
    evState.textContent = "Last event: " + when(a.last_event_at || rows[0].received_at) + ". Newest first.";
    rows.forEach(function (e) {
      var li = el("li"), t = el("span", "axl-t", e.topic || "Event"); t.appendChild(el("code", "", e.type));
      li.appendChild(t); li.appendChild(el("span", "axl-w", when(e.received_at)));
      var id = String(e.object_id || e.event_id || ""), row = el("span", "axl-id");
      row.appendChild(el("code", "", id));
      if (navigator.clipboard && id) { var c = el("button", "", "Copy"); c.type = "button"; c.setAttribute("aria-label", "Copy " + id); c.addEventListener("click", function () { navigator.clipboard.writeText(id).then(function () { c.textContent = "Copied"; }); }); row.appendChild(c); }
      row.appendChild(el("span", "axl-ok", "✓ Signature verified"));
      li.appendChild(row); evs.appendChild(li);
    });
  }).catch(function () { evState.textContent = "Airwallex events unavailable right now."; });
})();`;

/** Home's badge: an image the site draws (no script, no fetch), linking to the block on /proof. */
export function awxHomeBadgeHtml(): string {
  return `<p class="h-axl"><a href="proof#${AWX_LIVE_ID}" aria-label="${esc(`${AWX_BADGE_TITLE}, checked live: see it on the proof page`)}"><img src="${BOOKS_SVG}" width="360" height="56" alt="${esc(`${AWX_BADGE_TITLE}: checked live against the Airwallex sandbox`)}" loading="lazy" decoding="async"></a></p>`;
}

export const AWX_HOME_BADGE_CSS = `
.h-axl { margin: 14px 0 0; } .h-axl a { display: inline-block; max-width: 100%; } .h-axl img { display: block; max-width: 100%; height: auto; }
`;
