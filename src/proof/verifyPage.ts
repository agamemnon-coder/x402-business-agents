// /verify (15 Nov, "Verify it yourself"): drop or paste a /try proof bundle, and this browser checks it with WebCrypto,
// on this device. The checks are src/proof/bundle.ts's PROOF_VERIFY_JS, the very text `npm run verify-bundle` runs in
// Node. The page makes no server call at all (its CSP says connect-src 'none'); the sample bundles are in the page
// itself (docs/proof/, from a /try run). Every check is one line: pass or fail, with the values it compared.

import { esc, icon, iconSet, page } from "../redesign/ui.js";
import { REPO_URL } from "../submission/deck.js";
import { PROOF_FORMAT, PROOF_MEANS, PROOF_REFUSAL_MEANS, PROOF_VERIFY_JS } from "./bundle.js";

/** The line under the heading, word for word. */
export const VERIFY_BUNDLE_LEAD = "Don't trust our server: check the payment yourself.";
/** The verdicts, word for word. */
export const VERIFY_BUNDLE_VERDICT = { valid: "Every check passes", invalid: "Not valid" } as const;
/** The largest file the page reads. */
export const VERIFY_BUNDLE_MAX = 262_144;

const CSS = `main { padding: 22px 0 28px; }
.intro { max-width: 820px; margin-bottom: 16px; }
.intro .eyebrow { margin-bottom: 6px; } .intro h1 { margin-bottom: 8px; } .intro .lead { font-size: 19px; font-weight: 650; color: var(--text); }
.box { max-width: 820px; padding: 18px; display: grid; gap: 14px; }
.box > * { min-width: 0; }
.drop { display: grid; gap: 10px; justify-items: start; padding: 18px; border: 2px dashed var(--border); border-radius: 14px; background: var(--sunken); }
.drop.over { border-color: var(--accent); background: var(--accent-soft); }
.drop p { margin: 0; }
.pick { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.pick input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
.pick label:focus-within { outline: 2px solid var(--accent); }
textarea { width: 100%; min-height: 96px; box-sizing: border-box; font: 500 13.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px; resize: vertical; }
.muted { color: var(--muted); } .small { font-size: 15px; }
.vv { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 12px; padding: 14px; border-radius: 14px; font-size: clamp(19px, 2.2vw, 23px); font-weight: 750; }
.vv svg { width: 34px; height: 34px; }
.vv[hidden] { display: none; }
.vv.ok { background: var(--sunken); color: var(--ok); } .vv.bad { background: var(--bad-soft); color: var(--bad); }
.vv span { overflow-wrap: anywhere; min-width: 0; }
dl.terms { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 6px 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--sunken); font-size: 15px; }
dl.terms dt { color: var(--muted); } dl.terms dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; min-width: 0; }
dl.terms[hidden] { display: none; }
ol.checks { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 14.5px; }
ol.checks li { display: grid; grid-template-columns: 20px 52px minmax(0, 1fr); gap: 8px; align-items: start; padding: 8px 10px; border-radius: 10px; background: var(--sunken); }
ol.checks li .i { margin-top: 2px; } ol.checks li.ok .i, ol.checks li.ok b { color: var(--ok); } ol.checks li.bad .i, ol.checks li.bad b { color: var(--bad); }
ol.checks li.bad { background: var(--bad-soft); }
ol.checks li span { overflow-wrap: anywhere; min-width: 0; } ol.checks li em { font-style: normal; font-weight: 700; }
ol.checks:empty { display: none; }
details.more { font-size: 14.5px; color: var(--muted); }
details.more > summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 32px; font-weight: 650; color: var(--accent); }
details.more > ul { margin: 4px 0 0; }
.status { margin: 0; font-size: 15px; color: var(--muted); } .status.bad { color: var(--bad); font-weight: 600; } .status:empty { display: none; }
code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }
@media (max-width: 640px) { .box { padding: 14px; } .btn { width: 100%; justify-content: center; white-space: normal; height: auto; min-height: 48px; } .pick { width: 100%; } .pick label { width: 100%; } dl.terms { grid-template-columns: 96px minmax(0, 1fr); } ol.checks li { grid-template-columns: 20px minmax(0, 1fr); } ol.checks li b { grid-column: 2; } ol.checks li span { grid-column: 1 / -1; } }`;

const JS = `
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("run-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  ${PROOF_VERIFY_JS}
  function el(tag, cls, kids) { var n = document.createElement(tag); if (cls) n.className = cls; (kids || []).forEach(function (k) { if (k !== null && k !== undefined) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); }); return n; }
  function ic(name) { var s = document.createElement("span"); s.innerHTML = D.icons[name]; var n = s.firstChild; n.setAttribute("class", "i"); return n; }
  function status(text, bad) { $("v-status").textContent = text; $("v-status").className = "status" + (bad ? " bad" : ""); }
  function row(label, val) { return val === undefined || val === null || val === "" ? [] : [el("dt", "", [label]), el("dd", "", [String(val)])]; }
  function show(b, name) {
    return verifyProofBundle(b).then(function (v) {
      var box = $("v-verdict"), bad = v.checks.filter(function (c) { return !c.ok; });
      box.className = "vv " + (v.ok ? "ok" : "bad");
      box.replaceChildren(ic(v.ok ? "circle-check" : "octagon-x"), el("span", "", [v.ok ? D.verdict.valid + " (" + v.checks.length + ")" : D.verdict.invalid + ": " + bad.map(function (c) { return c.check; }).join(", ")]));
      box.hidden = false; box.dataset.ok = String(v.ok); box.dataset.failed = bad.map(function (c) { return c.check; }).join(",");
      $("v-checks").replaceChildren.apply($("v-checks"), v.checks.map(function (c) {
        var li = el("li", c.ok ? "ok" : "bad", [ic(c.ok ? "check" : "octagon-x"), el("b", "", [c.ok ? "pass" : "FAIL"]), el("span", "", [el("em", "", [c.check + ": "]), c.detail])]);
        li.dataset.check = c.check; return li;
      }));
      var t = b && typeof b.terms === "object" && b.terms ? b.terms : {}, d = b && b.decision ? b.decision : {};
      $("v-terms").replaceChildren.apply($("v-terms"), [].concat(row("Decision", d.outcome), row("Payee", t.beneficiary_name || t.vendor), row("Amount", t.amount !== undefined ? (t.currency || "") + " " + t.amount : null),
        row("Account", t.iban_last4 ? "···· " + t.iban_last4 : null), row("Proposal", b && b.proposal_id), row("Site (rpId)", b && b.rp_id),
        b && b.asked && b.asked.terms ? row("Asked amount", (b.asked.terms.currency || "") + " " + b.asked.terms.amount) : []));
      $("v-terms").hidden = false;
      // The refusal's line of "What this proves" only for a refusal's bundle (one with the asked terms).
      $("v-means-refusal").hidden = !(b && b.asked);
      status(name ? "Checked " + name + " in this browser; nothing was sent anywhere." : "");
    });
  }
  function load(text, name) {
    var b;
    if (text.length > D.max) { status("That is too large to be a proof bundle.", true); return; }
    try { b = JSON.parse(text); } catch (e) { status("That is not JSON: drop the " + D.file + " file /try gave you, or paste its text.", true); return; }
    show(b, name);
  }
  if (!window.crypto || !crypto.subtle) { status("This browser offers no WebCrypto here (it needs HTTPS), so it cannot check the signature.", true); $("v-file").disabled = true; return; }
  $("v-file").addEventListener("change", function () { var f = $("v-file").files[0]; if (f) f.text().then(function (t) { load(t, f.name); }); });
  $("v-check").addEventListener("click", function () { var t = $("v-paste").value.trim(); if (t) load(t, "the pasted text"); else status("Paste the bundle's text first.", true); });
  $("v-sample").addEventListener("click", function () { $("v-paste").value = JSON.stringify(D.samples.paid, null, 2); show(D.samples.paid, "the sample paid bundle"); });
  $("v-sample-refused").addEventListener("click", function () { $("v-paste").value = JSON.stringify(D.samples.refused, null, 2); show(D.samples.refused, "the sample refused bundle"); });
  var drop = $("v-drop");
  ["dragenter", "dragover"].forEach(function (e) { drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (e) { drop.addEventListener(e, function () { drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (ev) { ev.preventDefault(); var f = ev.dataTransfer && ev.dataTransfer.files[0]; if (f) f.text().then(function (t) { load(t, f.name); }); });
})();`;

export interface ProofSamples { paid: unknown; refused: unknown }

/** The page, its links and assets absolute. */
export function verifyBundlePage(samples: ProofSamples): string {
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">Verify it yourself</p>
  <h1 class="h-sec">Check a payment's signature</h1>
  <p class="lead" id="v-lead">${esc(VERIFY_BUNDLE_LEAD)}</p>
  <p class="muted">Drop the proof file from a /try payment. Your browser checks it with WebCrypto, on this device: this page sends nothing to any server.</p>
</section>
<section class="card box" aria-live="polite">
  <div class="drop" id="v-drop">
    <p>Drop <code>${esc("purser-proof.json")}</code> here, or:</p>
    <div class="pick"><label class="btn primary" for="v-file">${icon("file-check", 18)}Pick the file</label><input type="file" id="v-file" accept="application/json,.json">
    <button class="btn" type="button" id="v-sample">${icon("receipt", 18)}Load a sample bundle</button><button class="btn" type="button" id="v-sample-refused">${icon("triangle-alert", 18)}Load the refused sample</button></div>
  </div>
  <label class="small muted" for="v-paste">Or paste the bundle's text</label>
  <textarea id="v-paste" spellcheck="false" autocomplete="off"></textarea>
  <div><button class="btn" type="button" id="v-check">${icon("shield-check", 18)}Check the pasted text</button></div>
  <p class="status" id="v-status"></p>
  <div class="vv" id="v-verdict" hidden></div>
  <dl class="terms" id="v-terms" hidden></dl>
  <ol class="checks" id="v-checks"></ol>
  <details class="more"><summary>What this proves</summary><ul>${PROOF_MEANS.map((l) => (l === PROOF_REFUSAL_MEANS ? `<li id="v-means-refusal" hidden>${esc(l)}</li>` : `<li>${esc(l)}</li>`)).join("")}<li>The same checks, the same code, offline: <code>npm run verify-bundle -- purser-proof.json</code> in the repository, ${esc(REPO_URL.replace(/^https:\/\//, ""))}. The samples are <code>docs/proof/</code> there.</li></ul></details>
</section>
<p class="small muted"><a href="/try">${icon("arrow-right", 16)}Make a payment on /try, then download its proof</a> · <a href="/proof">${icon("arrow-right", 16)}Proof</a></p>
</div></main>`;
  const html = page({
    title: "Verify a payment", description: "Drop a /try proof bundle and your browser checks the passkey signature, the terms hash, the rpId, user verification and the ledger with WebCrypto. No server call.",
    tab: "proof", css: CSS, body, js: JS, stage: false,
    data: { icons: iconSet(["circle-check", "octagon-x", "check"]), verdict: VERIFY_BUNDLE_VERDICT, samples, max: VERIFY_BUNDLE_MAX, file: "purser-proof.json", format: PROOF_FORMAT },
    source: "Source: src/proof/verifyPage.ts (the checks of src/proof/bundle.ts, in the browser).",
    real: ["Real: the checks run in your browser with WebCrypto, on the file you give; nothing is sent to any server. A /try test company: test money only."],
  });
  return html.replace(/(href|src)="(?!https?:|#|\/|data:|mailto:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}
