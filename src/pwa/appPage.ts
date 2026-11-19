// /app, where the installed app starts on the site (the manifest's start_url, ./manifest.ts). A phone that already
// holds the CFO's viewer key goes straight on to the dashboard. One that does not, typically an iPhone's Home Screen
// app, which keeps its own storage apart from Safari's, is asked once for the private link: pasted here, the key goes
// to the dashboard's own address after "#" (never to a server) and the dashboard keeps it, as when the link is opened.
// The same stylesheet and CSP as the approval pages (src/approve/): no inline code, one script from this origin.

import { withAppHead } from "./manifest.js";

const MARK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/></svg>';

export function appStartPage(iconVersion: string): string {
  return withAppHead(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Purser</title>
<meta name="description" content="Purser for the CFO, as an app on this phone: what waits for your signature, signed with your passkey.">
<link rel="icon" href="/assets/favicon.svg?v=${iconVersion}" type="image/svg+xml">
<link rel="stylesheet" href="/assets/approve.css">
</head>
<body data-page="app">
<header class="bar"><span class="mk" aria-hidden="true">${MARK}</span><h1>Purser</h1><span class="sub">For the CFO · test money</span></header>
<main id="app">
<section class="guest app-start">
<div class="guest-ill" aria-hidden="true">${MARK.replace('width="16" height="16"', 'width="36" height="36"')}</div>
<h2>Open Purser on this phone</h2>
<p class="muted">Paste the private link the runner gave you, once. It stays on this phone.</p>
<label for="link">Your private link</label>
<input id="link" class="policy-input" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ends in #view=…">
<button type="button" id="open" class="confirm">Open my dashboard</button>
<p id="say" class="muted" role="status"></p>
<a class="secondary" href="/?recorded">No link? The recorded CFO dashboard</a>
</section>
</main>
<noscript><p>This page needs JavaScript to keep your link on this phone.</p></noscript>
<script src="/assets/app.js"></script>
</body>
</html>
`, "site");
}

/** /assets/app.js: the start page's one script. The link is read here and goes nowhere but the dashboard's "#". */
export const APP_START_SCRIPT = `"use strict";
(function () {
  var VIEW = /(?:^#|&)view=([0-9a-f]{32})(?:&|$)/, RUNNER = /(?:^#|&)runner=([A-Za-z0-9_-]{80,200})(?:&|$)/;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function () {});
  var kept = "";
  try { kept = localStorage.getItem("kit11.view") || ""; } catch (e) { kept = ""; }
  if (/^[0-9a-f]{32}$/.test(kept)) { location.replace("/?dashboard"); return; }
  var input = document.getElementById("link"), say = document.getElementById("say"), open = document.getElementById("open");
  function go() {
    var text = String(input.value || "").trim(), at = text.indexOf("#");
    if (at > 0) {
      var from = null;
      try { from = new URL(text.slice(0, at)).origin; } catch (e) { from = null; }
      if (from === null) { say.textContent = "That is not a link. Paste the whole private link."; return; }
      if (from !== location.origin) { say.textContent = "This link is for another address: open it there."; return; }
    }
    var hash = at >= 0 ? text.slice(at) : "", v = VIEW.exec(hash), r = RUNNER.exec(hash);
    if (!v) { say.textContent = "This link has no key (#view=…). Paste the whole private link the runner gave you."; return; }
    location.replace("/?dashboard#view=" + v[1] + (r ? "&runner=" + r[1] : ""));
  }
  open.addEventListener("click", go);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
})();
`;
