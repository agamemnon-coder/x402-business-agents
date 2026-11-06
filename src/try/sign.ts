// /try/sign (TRY_SIGN_ENABLED): "Try it yourself: sign with your own Face ID". The demo, in three steps with a progress
// indicator (Max, 6 Nov): 1. the agent proposes (a test world of the visitor's own, one hour; the waiting proposal shown
// as the CFO's approval sheet, with its exact terms, beneficiary, IBAN, amount and terms hash; a second proposal blocked,
// with the lock that stopped it); 2. the visitor signs with Face ID (a test passkey made now, then a signature whose
// challenge is the SHA-256 of the exact terms); 3. Purser verifies (the server checks the signature, the stand-in
// executor runs it in the test world). Then the visitor tampers with a field (amount, IBAN, currency) and sees the same
// signature refused by the server, and downloads a receipt anyone can verify offline (npm run verify-receipt). The page's API is worker/src/trySign.ts. One inline script and one inline style,
// hashed into the CSP like the other public pages; everything it shows from the server goes in as text, never as markup.

import { esc, icon, iconSet, page } from "../redesign/ui.js";
import { REPO_URL } from "../submission/deck.js";
import { cfoApproval, recordedQuote, tryLocks } from "./examples.js";
import { RECEIPT_FORMAT } from "./receipt.js";

/** The feature flag, read where the bundle is built: on, the page, its API and the links to it are in the bundle. */
export const trySignOn = (env: NodeJS.ProcessEnv = process.env) => ["on", "1", "true"].includes(env.TRY_SIGN_ENABLED ?? "");

/** The label at the top of the page, word for word: the one-line disclaimer. */
export const TRY_SIGN_LABEL = "Test world · test passkey · nothing real moves";

/** The three steps, word for word (the progress indicator). */
export const TRY_SIGN_STEPS = ["The agent proposes", "You sign with Face ID", "Purser verifies"] as const;

/** The line under the start button, word for word (Max, 6 Nov). */
export const TRY_SIGN_HOOK = "A Treasury agent wants to pay an invoice above its limit. You decide.";
/** The big green check after signing, word for word. */
export const TRY_SIGN_SIGNED = "Signed and verified. This signature only fits these exact terms.";
/** The last line after a refused tamper: one cent off the amount, or any other single change (Max, 6 Nov). */
export const TAMPER_VERDICT = { cent: "One cent changed. The signature is worthless.", field: "One field changed. The signature is worthless." } as const;

/** The fields a visitor may change to tamper, as the terms name them. */
export const TAMPER_FIELDS = ["amount", "payee_iban", "currency", "fx.client_rate"] as const;

/** What the "What's real?" expander says, line by line (tests read it). */
export const WHATS_REAL = {
  simulated: [
    "A test world made for you, deleted after one hour: a test copy of Northwind Outdoor. Its balance, its payees and their IBANs are test data (the IBANs' check digits are 00, which no real account has).",
    "No payment or conversion at Airwallex, no Metal or Claude call, and no money moves: the agent's words are fixed text, and the executor is a stand-in that only records in your test world.",
    "The blocked payment and the lock that stops it are a simulation in your test world. The three examples it links to are real, each from the run it names.",
  ],
  real: [
    "Your device's passkey signature over the SHA-256 of the exact terms, and the server's check of it against the public key your device registered (the same verifier as the CFO's passkey sign-in).",
    "The tamper: the server checks your changed terms against the same signature, for real, and refuses them.",
    "The FX quote is live from the Airwallex sandbox (a test environment): read-only, nothing is converted, no money moves. It is in the terms, so the signature covers its quote id, and an expired quote is refused. Without a live quote (no sandbox key on the server, or the limit reached) the page shows the main run's recorded quote instead, labelled, and it is not in the signature.",
    "The receipt: receipt.json holds the exact terms, their hash, your passkey's signature, its public key and the algorithm. Anyone can check it offline, with no server: npm run verify-receipt -- receipt.json in the repository. Change one field or one cent and it fails. It proves that the holder of that key signed those terms, not who holds it.",
  ],
  limits: [
    "The server checks no attestation, so it cannot tell which authenticator made the key, and a key made in software would verify too: Face ID is what your device asks for, not something the server proves.",
    "This world, its passkey and its proposals live in their own store, apart from Northwind's: a test passkey is enrolled nowhere else, so it can never approve a real proposal or sign in to the CFO's pages.",
  ],
  sources: [
    "The test world: worker/src/trySign.ts; nothing in it is recorded anywhere else. The locks' real examples: docs/demo/main-run.json and docs/runs/visa-tap-live-2026-11-02.json.",
  ],
} as const;

const CSS = `.testband { background: var(--text); color: var(--bg); text-align: center; font: 700 clamp(12.5px, 3.4vw, 15px)/1.3 Inter, system-ui, sans-serif; padding: 10px 10px; letter-spacing: .01em; }
.testband .i { vertical-align: -3px; margin-right: 6px; }
main { padding: 20px 0 24px; }
.intro { max-width: 760px; margin-bottom: 14px; }
.intro .eyebrow { margin-bottom: 6px; }
.intro h1 { margin-bottom: 8px; }
.intro .lead { font-size: 18px; }
/* "What's real?": one line, opened on demand. */
details.wr { margin-top: 10px; font-size: 15px; }
details.wr > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; font-weight: 650; color: var(--accent); }
details.wr > summary::-webkit-details-marker { display: none; }
details.wr > summary::after { content: "▾"; font-size: 13px; } details.wr[open] > summary::after { content: "▴"; }
.wr-body { display: grid; gap: 10px; padding: 14px 16px; margin-top: 4px; font-size: 15px; line-height: 1.5; }
.wr-body h3 { font-size: 15px; margin: 0; } .wr-body ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
/* The three steps. */
/* Sticky under the site's header, so the visitor always sees where they are. */
/* The site's header is translucent; here, where cards scroll under it and the steps, it is opaque (Max, 6 Nov). */
header.top { background: var(--bg); -webkit-backdrop-filter: none; backdrop-filter: none; }
ol.progress { list-style: none; margin: 0 0 14px; padding: 8px 0; box-shadow: 0 0 0 100vmax var(--bg); clip-path: inset(0 -100vmax); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; max-width: 760px; position: sticky; top: 64px; z-index: 30; background: var(--bg); }
#s-props, .prop, #result, #tamper { scroll-margin-top: 150px; }
ol.progress li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 14px; background: var(--sunken); color: var(--muted); font: 650 14.5px/1.25 Inter, system-ui, sans-serif; min-width: 0; }
ol.progress li .n { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--surface); border: 1px solid var(--border); font-size: 13.5px; }
ol.progress li.on { background: var(--accent-soft); color: var(--text); box-shadow: inset 0 0 0 2px var(--accent); }
ol.progress li.on .n { background: var(--accent); border-color: var(--accent); color: #fff; }
ol.progress li.done { color: var(--text); } ol.progress li.done .n { background: var(--ok); border-color: var(--ok); color: var(--surface); }
ol.progress li .t { min-width: 0; overflow-wrap: anywhere; }
.start { display: grid; gap: 8px; max-width: 760px; }
.start[hidden] { display: none; }
.hook { margin: 0; font-size: 17px; font-weight: 600; color: var(--text); }
/* One sentence shows; the rest is behind "more". */
details.more { font-size: 14.5px; color: var(--muted); }
details.more > summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 32px; font-weight: 650; color: var(--accent); }
details.more > p { margin: 4px 0 0; }
.bigok { display: flex; align-items: center; gap: 14px; }
.bigok .i { width: 56px; height: 56px; flex: none; color: var(--ok); }
.bigok h2 { font-size: clamp(22px, 2.6vw, 30px); line-height: 1.2; margin: 0; letter-spacing: -.015em; }
.outcome { margin: 4px 0 0; font-size: clamp(19px, 2vw, 22px); font-weight: 750; color: var(--bad); }
.outcome[hidden] { display: none; }
.muted { color: var(--muted); }
.small { font-size: 15px; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn[hidden] { display: none; }
.btn.big { height: 56px; font-size: 17px; padding: 0 26px; }
.status { font-size: 15.5px; color: var(--muted); min-height: 1.4em; overflow-wrap: anywhere; margin: 0; }
.status:empty { min-height: 0; }
.status.bad { color: var(--bad); font-weight: 600; }
.status.ok { color: var(--ok); font-weight: 600; }
.stephead { font-size: 20px; letter-spacing: -.015em; display: flex; align-items: center; gap: 10px; margin: 18px 0 10px; }
.stephead .n { width: 30px; height: 30px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 15px; flex: none; }
/* The test world, in one strip. */
dl.world { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; max-width: 760px; }
dl.world > div { display: inline-flex; gap: 5px; align-items: baseline; padding: 3px 9px; border-radius: 999px; background: var(--sunken); font-size: 13.5px; min-width: 0; }
dl.world dt { color: var(--muted); } dl.world dd { margin: 0; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.props { display: grid; gap: 16px; max-width: 760px; }
.prop { padding: 18px; display: grid; gap: 12px; }
/* The approval sheet: the CFO's (src/approve), for the visitor's proposal. */
.sheet .eyebrow { margin: 0; font-size: 13px; }
.sheet .title { font-size: clamp(22px, 2.4vw, 28px); font-weight: 750; line-height: 1.2; letter-spacing: -.015em; margin: 0; }
.sheet .sentence { margin: 0; color: var(--muted); font-size: 16px; }
.who { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; font-weight: 700; font-size: 15.5px; }
.who .av { width: 32px; height: 32px; background: var(--a-treasury); color: #fff; }
.who .av .i { width: 17px; height: 17px; }
.says { font-size: 16px; line-height: 1.45; margin: 0; }
.says::before { content: "“"; } .says::after { content: "”"; }
dl.facts { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 9px 12px; margin: 0; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--sunken); font-size: 15.5px; }
dl.facts dt { color: var(--muted); } dl.facts dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; min-width: 0; }
dl.facts dd.amount { font-size: 19px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14.5px; }
.chk { display: grid; gap: 4px; border-radius: 14px; padding: 12px 14px; font-size: 15.5px; line-height: 1.45; }
.chk b { display: flex; align-items: center; gap: 6px; }
.chk.fail { background: var(--bad-soft); color: var(--text); } .chk.fail b { color: var(--bad); }
.chk.pass { background: var(--sunken); } .chk.pass b { color: var(--accent); }
/* A hash, shortened (first 12 and last 8 characters): tap it for all 64, Copy for the clipboard. */
.hash { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px 6px 6px 10px; }
.hash .exp { flex: 1 1 12ch; min-width: 0; text-align: left; background: none; border: 0; padding: 4px 0; cursor: pointer; color: var(--text); }
.hash code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); }
.hash code b { color: var(--accent); }
.hash .copy { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 650 14px/1 Inter, system-ui, sans-serif; cursor: pointer; }
.hash .copy.ok { color: var(--ok); }
.hash code, details.terms pre { overflow-wrap: anywhere; word-break: break-all; }
details.terms summary { cursor: pointer; font-size: 15px; font-weight: 650; color: var(--accent); min-height: 32px; }
details.terms pre { margin: 8px 0 0; white-space: pre-wrap; font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 10px; padding: 10px; }
.actions { display: grid; gap: 8px; }
.actions .btn { justify-content: center; }
.basis { font-size: 14px; color: var(--faint); margin: 0; }
/* The three locks on the blocked payment. */
.locks { display: grid; gap: 8px; }
.locks h3 { font-size: 16px; margin: 0; }
.lock { border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; display: grid; gap: 4px; font-size: 15px; line-height: 1.45; }
.lock .lh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
.lock .tag { font-size: 13px; padding: 2px 9px; }
.lock.hit { border-color: var(--bad); background: var(--bad-soft); } .lock.hit .tag { background: var(--bad); color: var(--on-bad); }
/* The FX quote at the Airwallex lock: live and in this signature, or recorded and not. */
.fxq { display: grid; gap: 4px; margin-top: 4px; padding: 10px 12px; border-radius: 12px; background: var(--awx-soft); font-size: 15px; line-height: 1.45; }
.fxq .lh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
.fxq.live .tag { background: var(--ok); color: var(--surface); }
.fxq.recorded { background: var(--sunken); } .fxq.recorded .tag { background: var(--border); color: var(--text); }
.fxq > * { min-width: 0; overflow-wrap: anywhere; }
.lock a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; min-height: 32px; }
.lock a .i { flex: none; }
/* Grid and flex children may shrink below their content (a long word), and a card never grows past its column. */
.props > *, .prop > *, .result > *, .chk > *, .line > *, .who > *, .facts > *, .lock > *, .locks > *, #tamper > *, .tf > *, .hashes > * { min-width: 0; }
.prop { max-width: 100%; }
.line > span, .chk span { overflow-wrap: anywhere; }
.result { padding: 20px; display: grid; gap: 14px; max-width: min(760px, 100%); }
.result h2 { margin: 0; }
.receipt { display: grid; gap: 6px; }
.receipt code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }

.result[hidden], .props[hidden], #tamper[hidden], dl.world[hidden], #s-props[hidden] { display: none; }
.line { display: flex; align-items: flex-start; gap: 10px; font-size: 16px; line-height: 1.45; }
.line .i { margin-top: 2px; }
.line > .i, #t-icon { flex: none; }
.line.ok .i { color: var(--ok); } .line.bad .i { color: var(--bad); }
.line b { display: block; }
/* Tamper: the visitor's own edit. */
.tbox { border-top: 1px solid var(--border); padding-top: 14px; display: grid; gap: 10px; }
.tbox h3 { font-size: 18px; margin: 0; }
.tf { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.tf label[hidden] { display: none; }
.tf label { display: grid; gap: 4px; font-size: 14px; font-weight: 650; color: var(--muted); }
.tf input, .tf select { font: 600 16px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; min-height: 46px; padding: 8px 10px; width: 100%; }
.tf .chg input, .tf .chg select { border-color: var(--bad); box-shadow: 0 0 0 2px var(--bad-soft); }
.tactions { display: flex; flex-wrap: wrap; gap: 8px; }
#tamper { display: grid; gap: 10px; }
table.diff { width: 100%; border-collapse: collapse; font-size: 15px; table-layout: fixed; }
table.diff th, table.diff td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; vertical-align: top; }
table.diff th { color: var(--muted); font-weight: 650; font-size: 13.5px; }
table.diff tr.chg td { background: var(--bad-soft); font-weight: 700; }
table.diff tr.chg td:first-child::after { content: " · changed"; color: var(--bad); font-weight: 700; }
.hashes { display: grid; gap: 8px; }
.hashes p { margin: 0; }
#t-what, #t-why { overflow-wrap: anywhere; }
#t-why { display: grid; gap: 8px; margin-top: 2px; }
/* A laptop: the sheet and its result on the left, the blocked proposal and its locks beside them. */
@media (min-width: 1100px) { .props, dl.world { max-width: 1200px; } .props { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; } .props > .blocked { grid-column: 2; grid-row: 1 / span 2; } }
@media (min-width: 720px) { .tf { grid-template-columns: minmax(0, .9fr) minmax(0, 2.1fr) minmax(0, .7fr) minmax(0, .9fr); } .hashes { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .actions { grid-template-columns: max-content max-content; } }
@media (max-width: 640px) { .prop, .result { padding: 16px; }
  /* On a phone the passkey and Face ID buttons stay at the bottom of the screen while the sheet is read, as on the CFO's. */
  .sheet .actions { position: sticky; bottom: 0; z-index: 5; background: var(--surface); margin: 0 -15px; padding: 10px 15px calc(10px + env(safe-area-inset-bottom)); box-shadow: 0 -10px 18px -14px rgba(0, 0, 0, .35); } ol.progress li { padding: 6px 6px; font-size: 13px; gap: 6px; } ol.progress li .n { width: 22px; height: 22px; font-size: 12px; } dl.facts { grid-template-columns: 92px minmax(0, 1fr); padding: 12px; } .btn { width: 100%; justify-content: center; white-space: normal; height: auto; min-height: 48px; padding: 10px 18px; } .btn.big { min-height: 56px; } .stephead { font-size: 18px; } .intro h1 { font-size: 30px; } .intro .lead { font-size: 17px; } }`;

// The page script: no backticks and no "${" in here (it lives in a template string). Text from the server goes in with
// textContent; the only markup set is the icons, built on the server from the fixed icon set.
const JS = `
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("run-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var S = { token: null, world: null, options: null, credId: null, signed: null, timer: null };

  function el(tag, cls, kids) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    (kids || []).forEach(function (k) { if (k !== null && k !== undefined) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }
  // One sentence, and the rest behind a native "more" toggle.
  function more(text) { var d = el("details", "more", [el("summary", "", ["more"]), el("p", "", [text])]); return d; }
  function ic(name) { var s = document.createElement("span"); s.innerHTML = D.icons[name]; return s.firstChild; }
  function status(id, text, tone) { var n = $(id); n.textContent = text; n.className = "status" + (tone ? " " + tone : ""); }
  // The three steps: n is the one under way; those before it are done (all three once verified).
  function progress(n, allDone) {
    for (var i = 1; i <= 3; i++) {
      var li = $("pg-" + i), done = allDone || i < n, on = !allDone && i === n;
      li.classList.toggle("done", done); li.classList.toggle("on", on);
      if (on) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      li.querySelector(".n").textContent = done ? "✓" : String(i);
    }
  }
  // A hash as the page shows it: the first 12 and last 8 characters (the first 8 stressed, as on the CFO's sheet), the
  // whole hash on hover or a tap, with Copy. Copy that fails (no clipboard) shows the whole hash to select instead.
  function hashBox(h, cls) {
    var code = el("code", "", []);
    var show = function (all) { code.replaceChildren(el("b", "", [h.slice(0, 8)]), all ? h.slice(8) : h.slice(8, 12) + "…" + h.slice(-8)); };
    show(false);
    code.title = h;
    var b = el("button", "copy", ["Copy"]);
    b.type = "button";
    b.setAttribute("aria-label", "Copy the whole hash");
    b.addEventListener("click", function () {
      var done = function (ok) {
        b.replaceChildren(ok ? ic("check") : "", ok ? "Copied" : "Select the hash");
        b.classList.toggle("ok", ok);
        if (!ok) { show(true); x.setAttribute("aria-expanded", "true"); }
      };
      if (!navigator.clipboard) { done(false); return; }
      navigator.clipboard.writeText(h).then(function () { done(true); }, function () { done(false); });
    });
    // Tap the hash to see all 64 characters, tap again for the short form.
    var x = el("button", "exp", [code]);
    x.type = "button";
    x.setAttribute("aria-expanded", "false");
    x.setAttribute("aria-label", "Show the whole hash");
    x.addEventListener("click", function () { var all = x.getAttribute("aria-expanded") !== "true"; show(all); x.setAttribute("aria-expanded", String(all)); });
    var box = el("div", "hash" + (cls ? " " + cls : ""), [x, b]);
    box.dataset.hash = h;
    return box;
  }
  function group(s) { return String(s).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
  function amt(cur, s) { var p = String(s).split("."); return cur + " " + group(p[0]) + (p.length > 1 ? "." + p[1] : ""); }
  function eur(s) { var p = String(s).split("."); return "EUR " + group(p[0]) + "." + (p[1] || "00"); }
  function iban(s) { return String(s).replace(/(.{4})/g, "$1 ").trim(); }

  // Bytes.
  function toB64u(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); }
  function fromB64u(s) { var b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function hexToBytes(h) { var u = new Uint8Array(h.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(2 * i, 2), 16); return u; }
  function sha256(text) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (d) { return Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }); }
  // Canonical JSON (RFC 8785 for terms without numbers), as the approval page and the server compute it.
  function canon(v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    throw new Error("terms carry no numbers");
  }

  function post(path, body) {
    return fetch("/api/try-sign/" + path, { method: "POST", credentials: "omit", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); })
      .catch(function () { return { status: 0, data: { error: "the server cannot be reached" } }; });
  }
  function passkeyError(e) {
    var n = e && e.name;
    if (n === "NotAllowedError") return "Cancelled or timed out. Nothing was signed.";
    if (n === "NotSupportedError") return "This device offers no ES256 passkey, the kind the server checks. Try a phone by QR code.";
    if (n === "SecurityError") return "The browser refused: passkeys need this site's own address over HTTPS.";
    if (n === "InvalidStateError") return "This authenticator already has a passkey for this world.";
    return "The passkey did not work here (" + (n || "error") + ").";
  }

  function tick() {
    if (!S.world) return;
    var ms = Date.parse(S.world.expires_at) - Date.now();
    if (ms <= 0) {
      clearInterval(S.timer);
      document.querySelectorAll("[data-left]").forEach(function (n) { n.textContent = "expired"; });
      document.querySelectorAll("button[data-world]").forEach(function (b) { b.disabled = true; });
      status("w-status", "This test world has expired and is deleted. Reload the page to start a new one.", "bad");
      return;
    }
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    document.querySelectorAll("[data-left]").forEach(function (n) { n.textContent = (n.dataset.left === "in" ? "in " : "") + m + " min " + String(s).padStart(2, "0") + " s"; });
    // The quote's own countdown; once it has passed, the signature it would carry is worthless: get a new quote.
    var gone = false;
    document.querySelectorAll("[data-until]").forEach(function (n) {
      var q = Date.parse(n.dataset.until) - Date.now();
      if (q <= 0) { n.textContent = "expired"; gone = true; return; }
      n.textContent = "in " + Math.floor(q / 60000) + " min " + String(Math.floor((q % 60000) / 1000)).padStart(2, "0") + " s";
    });
    if (gone) quoteExpired();
  }
  function quoteExpired() {
    if (S.signed || !$("go-quote") || !$("go-quote").hidden) return;
    $("go-quote").hidden = false;
    document.querySelectorAll("button[data-sign]").forEach(function (b) { b.disabled = true; });
    status("q-status", "Quote expired. Get a fresh one and sign again.", "bad");
  }

  if (!window.PublicKeyCredential || !navigator.credentials) {
    status("w-status", "This browser has no passkeys (WebAuthn). Open this page in Safari, Chrome, Edge or Firefox on a recent phone or laptop.", "bad");
    $("go-world").disabled = true;
    return;
  }

  $("go-world").addEventListener("click", function () {
    var b = $("go-world");
    b.disabled = true;
    status("w-status", "Opening your test world…");
    post("world", {}).then(function (r) {
      if (r.status !== 201) { status("w-status", (r.data.error || ("error " + r.status)) + ".", "bad"); b.disabled = false; return; }
      S.token = r.data.world.token; S.world = r.data.world; S.options = r.data.passkey_options;
      $("w-id").textContent = S.world.id;
      $("w-balance").textContent = eur(S.world.balance);
      $("w-floor").textContent = eur(S.world.reserve_floor);
      $("w-alone").textContent = eur(S.world.alone_limit);
      $("w-facts").hidden = false;
      $("s-world").hidden = true;
      S.timer = setInterval(tick, 1000);
      S.fx = r.data.fx;
      return showProposals(r.data.proposals).then(function () {
        tick();
        progress(2);
        document.querySelector(".prop.sheet").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  });

  function createPasskey(b) {
    var o = S.options;
    b.disabled = true;
    status("k-status", "Waiting for your Face ID, Touch ID, Windows Hello or security key…");
    navigator.credentials.create({ publicKey: {
      challenge: fromB64u(o.challenge), rp: o.rp, user: { id: fromB64u(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation, authenticatorSelection: o.authenticatorSelection
    } }).then(function (c) {
      if (!c) { status("k-status", "Cancelled. No passkey was made.", "bad"); b.disabled = false; return; }
      var body = { token: S.token, credential: { id: c.id, rawId: toB64u(c.rawId), type: c.type, response: { clientDataJSON: toB64u(c.response.clientDataJSON), attestationObject: toB64u(c.response.attestationObject) } } };
      return post("passkey", body).then(function (r) {
        if (r.status !== 201) { status("k-status", "Not accepted: " + (r.data.error || ("error " + r.status)) + ".", "bad"); return; }
        S.credId = c.id;
        b.hidden = true;
        status("k-status", "Your test passkey is made and registered in this world only (" + c.id.slice(0, 10) + "…). Now sign.", "ok");
        document.querySelectorAll("button[data-sign]").forEach(function (x) { if (x.dataset.ready === "1") { x.disabled = false; x.classList.add("primary"); } });
      });
    }, function (e) { status("k-status", passkeyError(e), "bad"); b.disabled = false; });
  }

  function showProposals(list) {
    var box = $("props");
    box.replaceChildren();
    return Promise.all(list.map(function (p) {
      var terms = JSON.parse(p.canonical);
      return sha256(canon(terms)).then(function (h) { return { p: p, terms: terms, mine: h, same: canon(terms) === p.canonical && h === p.terms_sha256 }; });
    })).then(function (rows) {
      // The one waiting for a person first (the sheet the visitor signs), then the one a rule blocked.
      rows.filter(function (x) { return x.p.check !== "fail"; }).forEach(function (x) { box.appendChild(sheet(x)); });
      // The result shows right below the sheet it answers, before the blocked proposal.
      box.appendChild($("result"));
      rows.filter(function (x) { return x.p.check === "fail"; }).forEach(function (x) { box.appendChild(blocked(x)); });
      $("s-props").hidden = false;
    });
  }

  function agentLine(p) { return el("div", "who", [el("span", "av", [ic("landmark")]), p.agent, el("span", "pill", ["fixed text, no model call"])]); }
  function factsOf(p, t) {
    return el("dl", "facts", [
      el("dt", "", ["Amount"]), el("dd", "amount", [amt(t.currency, t.amount)]),
      el("dt", "", ["Beneficiary"]), el("dd", "", [t.payee]),
      el("dt", "", ["IBAN"]), el("dd", "mono", [iban(t.payee_iban)]),
      el("dt", "", ["Reference"]), el("dd", "", [t.reference]),
      el("dt", "", ["Proposal"]), el("dd", "", [p.proposal_id])
    ].concat(t.fx ? [el("dt", "", ["FX quote"]), el("dd", "", [fxLine(t.fx)])] : []));
  }
  // Who gave the quote: the Airwallex sandbox, or (local checks only) a stand-in, said as such.
  function fxFrom(q) { return q.source === "stand-in" ? "a stand-in (a local check, not Airwallex)" : "the Airwallex sandbox (a test environment)"; }
  // A quote in one line: what would be bought, for what, at which rate, and the quote id (short).
  function fxLine(q) { return amt(q.buy_currency, q.buy_amount) + " for " + amt(q.sell_currency, q.sell_amount) + " at " + q.client_rate + " · quote " + q.quote_id.slice(0, 8) + "…"; }

  // The waiting proposal, as the CFO's approval sheet: what is approved, the exact terms, the hash, Face ID.
  function sheet(x) {
    var p = x.p, t = x.terms;
    var st = el("p", "status", []);
    st.id = "st-" + p.proposal_id;
    var facts = factsOf(p, t);
    var left = el("dd", "", []); left.dataset.left = "in";
    facts.append(el("dt", "", ["Expires"]), left);
    if (t.fx) { var ql = el("dd", "", []); ql.dataset.until = t.fx.valid_to_at; ql.id = "q-left"; facts.append(el("dt", "", ["Quote expires"]), ql); }
    var kids = [
      el("p", "eyebrow", ["You are approving · " + p.proposal_id]),
      el("h3", "title", ["Pay " + t.payee + " " + amt(t.currency, t.amount)]),
      agentLine(p), el("p", "says", [p.says]), facts,
      el("div", "chk pass", [el("b", "", [ic("clock"), "Check: pass · waiting for a person"]), el("span", "", [p.waits])]),
      el("div", "", [el("p", "small muted", ["The hash of the exact terms, which your passkey signs" + (x.same ? " (checked on this device):" : ":")]), hashBox(x.mine)]),
      el("details", "terms", [el("summary", "", ["All terms (exactly what is hashed)"]), el("pre", "", [p.canonical])])
    ];
    var key = el("button", "btn primary big", [ic("scan-face"), "Create your test passkey"]);
    key.type = "button"; key.id = "go-key"; key.dataset.world = "1";
    key.addEventListener("click", function () { createPasskey(key); });
    var b = el("button", "btn big", [ic("scan-face"), "Sign with Face ID"]);
    b.type = "button"; b.dataset.sign = p.proposal_id; b.dataset.world = "1"; b.disabled = true;
    var ks = el("p", "status", []); ks.id = "k-status"; ks.setAttribute("aria-live", "polite");
    if (!x.same) {
      kids.push(el("p", "status bad", ["The terms do not hash to the hash the server sent. Do not sign."]));
    } else {
      b.dataset.ready = "1";
      b.addEventListener("click", function () { sign(x, b, st); });
    }
    if (S.credId) { key.hidden = true; if (b.dataset.ready === "1") { b.disabled = false; b.classList.add("primary"); } }
    var nq = el("button", "btn primary big", [ic("rotate-ccw"), "Get a new quote"]);
    nq.type = "button"; nq.id = "go-quote"; nq.dataset.world = "1"; nq.hidden = true;
    nq.addEventListener("click", function () { newQuote(nq); });
    var acts = el("div", "actions", [nq, key, b]);
    acts.id = "s-key";
    var qs = el("p", "status", []); qs.id = "q-status"; qs.setAttribute("aria-live", "polite");
    if (t.fx) kids.push(el("div", "", [el("p", "small muted", ["The live FX quote is part of these terms, so your signature covers its quote id and ends with it."]), more("Quote " + t.fx.quote_id + " from " + fxFrom(t.fx) + ": the Treasury agent holds USD and the invoice is in EUR, so it would buy " + amt(t.fx.buy_currency, t.fx.buy_amount) + " for " + amt(t.fx.sell_currency, t.fx.sell_amount) + " at " + t.fx.client_rate + ". Nothing is converted. Once the quote expires, the server refuses the signature: get a new quote and sign the new terms.")]));
    kids.push(el("div", "", [el("p", "small muted", ["First a test passkey for this world, then your signature."]), more("A random id, no name or e-mail, kept on your device for this site only; it opens this test world and nothing else. Face ID, Touch ID, Windows Hello, a security key, or your phone by QR code.")]), acts, qs, ks, st);
    kids.push(el("p", "basis", [D.cfo]));
    var a = el("article", "card prop sheet", kids);
    a.dataset.proposal = p.proposal_id;
    return a;
  }

  // "Get a new quote": new terms (the new quote in them), checked on this device again, to sign again.
  function newQuote(btn) {
    btn.disabled = true;
    status("q-status", "Asking the Airwallex sandbox for a new quote…");
    post("quote", { token: S.token }).then(function (r) {
      if (r.status !== 200) { status("q-status", "No new quote: " + (r.data.error || ("error " + r.status)).replace(/^no new live quote: /, "") + ".", "bad"); btn.disabled = false; return; }
      S.fx = r.data.fx;
      var p = r.data.proposal, terms = JSON.parse(p.canonical);
      return sha256(canon(terms)).then(function (h) {
        var old = document.querySelector(".prop.sheet");
        var fresh = sheet({ p: p, terms: terms, mine: h, same: canon(terms) === p.canonical && h === p.terms_sha256 });
        old.replaceWith(fresh);
        $("fx-lock").replaceWith(lockQuote());
        tick();
        status("q-status", "A new quote, so new terms: sign them again.", "ok");
      });
    });
  }

  // At the Airwallex lock: the live quote used in this signature, or, without one, the main run's, labelled recorded.
  function lockQuote() {
    var f = S.fx, box;
    if (f && f.status !== "unavailable") {
      var q = f.quote, left = el("b", "", []);
      left.dataset.until = q.valid_to_at;
      box = el("div", "fxq live", [
        el("div", "lh", [el("span", "tag", ["Used in this signature"]), q.source === "stand-in" ? "Stand-in quote (local check, not Airwallex)" : "Live quote, Airwallex sandbox"]),
        el("span", "", [amt(q.buy_currency, q.buy_amount) + " for " + amt(q.sell_currency, q.sell_amount) + " at " + q.client_rate + ". Quote " + q.quote_id.slice(0, 8) + "…" + q.quote_id.slice(-4) + ", expires ", left, "."]),
        more((q.source === "stand-in" ? "A stand-in gave this quote: a local check, not Airwallex." : "Read-only: Airwallex's sandbox (a test environment) was asked for a quote, and nothing was converted or paid.") + (f.status === "reused" ? " Shared: asked for a moment ago for another visitor, as many asked at once." : ""))
      ]);
    } else {
      var r = D.recordedFx;
      box = el("div", "fxq recorded", [
        el("div", "lh", [el("span", "tag", ["Recorded, not live"]), "Not in this signature"]),
        el("span", "", ["No live quote now (" + ((f && f.reason) || "none") + "). The main run's quote, " + r.run + ": " + amt(r.buy_currency, r.buy_amount) + " for " + amt(r.sell_currency, r.sell_amount) + " at " + r.client_rate + " (quote " + r.quote_id.slice(0, 8) + "…)."])
      ]);
    }
    box.id = "fx-lock";
    return box;
  }

  // The blocked proposal: nothing to sign, and which of the three locks stopped it, each with its real example.
  function blocked(x) {
    var p = x.p, t = x.terms;
    var locks = el("div", "locks", [el("h3", "", ["Which lock stopped it"])]);
    D.locks.forEach(function (l) {
      var hit = l.id === "purser";
      var a = el("a", "", [l.link, ic(/^https?:/.test(l.href) ? "external-link" : "arrow-right")]);
      a.href = l.href;
      if (/^https?:/.test(l.href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      var row = el("div", "lock " + l.id + (hit ? " hit" : ""), [
        el("div", "lh", [ic(hit ? "octagon-x" : "lock"), l.name, el("span", "tag", [hit ? "Stopped this one (simulated)" : "Not this one"])]),
        el("span", "", [hit ? p.rule : l.what]),
        a,
        more("Real example, " + l.run + ": " + l.example)
      ].concat(l.id === "airwallex" ? [lockQuote()] : []));
      row.dataset.lock = l.id;
      locks.appendChild(row);
    });
    locks.appendChild(el("p", "small muted", ["Your blocked payment is a simulation in your test world; the examples are real, from the runs named."]));
    var a = el("article", "card prop blocked", [
      el("p", "eyebrow", ["Blocked · " + p.proposal_id]),
      agentLine(p), el("p", "says", [p.says]), factsOf(p, t),
      el("div", "chk fail", [el("b", "", [ic("octagon-x"), "Check: fail · blocked by a rule"]), el("span", "", [p.rule]), el("span", "", ["Nothing to sign: no signature can approve this."])]),
      locks
    ]);
    a.dataset.proposal = p.proposal_id;
    return a;
  }

  function assertionOf(c) {
    return { id: c.id, rawId: toB64u(c.rawId), type: c.type, response: { clientDataJSON: toB64u(c.response.clientDataJSON), authenticatorData: toB64u(c.response.authenticatorData), signature: toB64u(c.response.signature) } };
  }

  function sign(x, b, st) {
    b.disabled = true;
    status(st.id, "Waiting for Face ID…");
    navigator.credentials.get({ publicKey: {
      challenge: hexToBytes(x.mine), rpId: location.hostname, allowCredentials: [{ type: "public-key", id: fromB64u(S.credId) }], userVerification: "required", timeout: 60000
    } }).then(function (c) {
      if (!c) { status(st.id, "Cancelled. Nothing was signed.", "bad"); b.disabled = false; return; }
      var a = assertionOf(c);
      progress(3);
      status(st.id, "Purser is checking your signature…");
      return post("sign", { token: S.token, proposal_id: x.p.proposal_id, canonical: x.p.canonical, credential: a }).then(function (r) {
        if (r.status !== 200 && r.data.why === "quote_expired") { progress(2); status(st.id, r.data.error, "bad"); $("go-quote").hidden = false; return; }
        if (r.status !== 200) { progress(2); status(st.id, "Not accepted: " + (r.data.error || ("error " + r.status)) + ".", "bad"); b.disabled = false; return; }
        S.signed = { x: x, a: a, d: r.data };
        b.hidden = true;
        progress(3, true);
        status(st.id, "Signed, verified and executed in your test world.", "ok");
        showResult(x, r.data);
      });
    }, function (e) { status(st.id, passkeyError(e), "bad"); b.disabled = false; });
  }

  function showResult(x, d) {
    $("r-hash").replaceChildren(hashBox(d.terms_sha256));
    $("r-checks").replaceChildren(el("span", "small muted", ["Checked by the server with the relay's passkey verifier."]), more("Checked: " + d.checks.join(", ") + "."));
    var e = d.executed;
    $("r-exec").replaceChildren(el("span", "small muted", ["Test transfer " + e.id + ": " + eur(e.amount) + " to " + e.payee + "."]), more("Test balance now " + eur(e.balance_after) + ". By the " + e.by + "."));
    var t = x.terms;
    $("t-amount").value = t.amount; $("t-iban").value = iban(t.payee_iban); $("t-currency").value = t.currency;
    document.querySelector('label[data-field="fx.client_rate"]').hidden = !t.fx;
    if (t.fx) $("t-rate").value = t.fx.client_rate;
    edited();
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── The receipt: everything needed to check the signature offline, and nothing secret (no world token). ──
  function receipt() {
    var s = S.signed, a = s.a, k = s.d.public_key;
    return {
      receipt: D.receipt, note: "A signature made on /try/sign in a test world: nothing real moved. Check it offline: npm run verify-receipt -- receipt.json",
      terms: JSON.parse(s.x.p.canonical), terms_sha256: s.d.terms_sha256, algorithm: s.d.algorithm,
      public_key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, credential_id: a.id, rp_id: location.hostname, origin: location.origin,
      assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature },
      verified_by_server_at: s.d.executed.at, verify: "npm run verify-receipt -- receipt.json"
    };
  }
  $("r-receipt").addEventListener("click", function () {
    if (!S.signed) return;
    var url = URL.createObjectURL(new Blob([JSON.stringify(receipt(), null, 2) + "\\n"], { type: "application/json" }));
    var link = el("a", "", []);
    link.href = url; link.download = "receipt.json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  });

  // ── Tamper: the visitor changes a field of the signed terms and sends them with the same signature. ──
  var LABEL = { amount: "Amount", payee_iban: "IBAN", currency: "Currency", "fx.client_rate": "FX rate" };
  // A field by its path ("fx.client_rate" is the quote's rate), and the fields these terms have.
  function get(t, k) { return k.split(".").reduce(function (o, x) { return o && o[x]; }, t); }
  function fieldsOf(t) { return D.fields.filter(function (k) { return get(t, k) !== undefined && get(t, k) !== null; }); }
  function shown(k, v, t) { return k === "amount" ? amt(t.currency, v) : k === "payee_iban" ? iban(v) : v; }
  // The visitor's terms: the signed ones with the three fields as typed (amounts to two decimals, IBANs without spaces).
  function typed() {
    var s = S.signed, t = JSON.parse(s.x.p.canonical);
    var a = $("t-amount").value.trim().replace(/,/g, "");
    if (!/^\\d{1,12}(\\.\\d{1,2})?$/.test(a)) return { error: "Type an amount like 1850.01." };
    var p = a.split(".");
    t.amount = String(Number(p[0])) + "." + ((p[1] || "") + "00").slice(0, 2);
    var i = $("t-iban").value.replace(/\\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{1,34}$/.test(i)) return { error: "Type an IBAN: letters and digits, up to 34." };
    t.payee_iban = i;
    t.currency = $("t-currency").value;
    if (t.fx) {
      var rate = $("t-rate").value.trim();
      if (!/^\\d{1,6}(\\.\\d{1,10})?$/.test(rate)) return { error: "Type a rate like 1.129677." };
      t.fx.client_rate = rate;
    }
    return { terms: t, changed: fieldsOf(s.x.terms).filter(function (k) { return get(t, k) !== get(s.x.terms, k); }) };
  }
  function edited() {
    if (!S.signed) return;
    var r = typed();
    D.fields.forEach(function (k) { var n = document.querySelector('label[data-field="' + k + '"]'); if (n) n.classList.toggle("chg", !!(r.changed && r.changed.indexOf(k) >= 0)); });
    $("t-send").disabled = !!r.error || r.changed.length === 0;
    status("t-status", r.error || (r.changed.length ? "Changed: " + r.changed.map(function (k) { return LABEL[k]; }).join(", ") + ". Send it with the signature you made." : (S.signed.x.terms.fx ? "Change the amount, the IBAN, the currency or the FX rate." : "Change the amount, the IBAN or the currency.")), r.error ? "bad" : "");
  }
  ["t-amount", "t-iban", "t-currency", "t-rate"].forEach(function (id) { $(id).addEventListener("input", edited); $(id).addEventListener("change", edited); });

  function tamper() {
    var s = S.signed, r = typed();
    if (!s || r.error || !r.changed.length) { edited(); return; }
    var bs = [$("t-send"), $("go-tamper")];
    bs.forEach(function (b) { b.disabled = true; });
    var changed = canon(r.terms);
    status("t-status", "Sending your terms with the same signature…");
    sha256(changed).then(function (h) {
      var rows = fieldsOf(s.x.terms).map(function (k) {
        var tr = el("tr", r.changed.indexOf(k) >= 0 ? "chg" : "", [el("td", "", [LABEL[k]]), el("td", "", [shown(k, get(s.x.terms, k), s.x.terms)]), el("td", "", [shown(k, get(r.terms, k), r.terms)])]);
        tr.dataset.row = k;
        return tr;
      });
      var table = el("table", "diff", [el("thead", "", [el("tr", "", [el("th", "", ["Field"]), el("th", "", ["You signed"]), el("th", "", ["Sent now"])])]), el("tbody", "", rows)]);
      $("t-what").replaceChildren(table, el("div", "hashes", [
        el("div", "", [el("p", "small muted", ["Signed terms hash to:"]), hashBox(s.x.mine, "old")]),
        el("div", "", [el("p", "small muted", ["Your changed terms hash to:"]), hashBox(h, "new")])
      ]));
      return post("sign", { token: S.token, proposal_id: s.x.p.proposal_id, canonical: changed, credential: s.a }).then(function (q) {
        var refused = q.status !== 200;
        $("t-line").className = "line " + (refused ? "bad" : "ok");
        $("t-icon").replaceChildren(ic(refused ? "octagon-x" : "triangle-alert"));
        $("t-head").textContent = refused ? "Refused: the same signature does not verify for the changed terms" : "Accepted?! This should not happen.";
        $("t-why").replaceChildren(el("span", "", [refused ? refusal(q) : ""]));
        var v = $("t-verdict");
        v.textContent = refused ? verdict(r.changed, s.x.terms, r.terms) : "";
        v.hidden = !refused;
        $("tamper").hidden = false;
        bs.forEach(function (b) { b.disabled = false; });
        edited();
        status("t-status", refused ? "Refused by the server. Change another field and send again, if you like." : "", refused ? "" : "bad");
        $("tamper").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    });
  }
  // The server's refusal in one sentence: why it refused, with the two hashes when it was the challenge.
  function refusal(q) {
    var d = q.data || {};
    var hex = function (h) { return /^[0-9a-f]{64}$/.test(h || "") ? h.slice(0, 12) + "…" : null; };
    if (d.why === "challenge" && hex(d.signed_sha256) && hex(d.terms_sha256)) return "The server refused it: the signature was made for hash " + hex(d.signed_sha256) + ", not for your terms (" + hex(d.terms_sha256) + ").";
    var why = String(d.error || ("error " + q.status)).replace(/^refused:\\s*/i, "");
    return "The server refused it: " + why + (/[.!?…]$/.test(why) ? "" : ".");
  }
  // The last line: one cent, one field, or how many.
  function verdict(changed, was, now) {
    var cents = function (a) { return Math.round(Number(a) * 100); };
    if (changed.length === 1 && changed[0] === "amount" && Math.abs(cents(now.amount) - cents(was.amount)) === 1) return D.verdict.cent;
    if (changed.length === 1) return D.verdict.field;
    return ["", "", "Two", "Three"][changed.length] + " fields changed. The signature is worthless.";
  }
  $("t-send").addEventListener("click", tamper);
  // The quick way, as before: the amount plus one cent, the rest as signed.
  $("go-tamper").addEventListener("click", function () {
    var t = S.signed && S.signed.x.terms;
    if (!t) return;
    var c = Math.round(Number(t.amount) * 100) + 1;
    $("t-amount").value = Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0");
    $("t-iban").value = iban(t.payee_iban); $("t-currency").value = t.currency;
    if (t.fx) $("t-rate").value = t.fx.client_rate;
    edited();
    tamper();
  });
})();`;

const li = (lines: readonly string[]) => lines.map((l) => `<li>${esc(l)}</li>`).join("");

/** The page, its links and assets absolute (it answers at /try/sign, one level down). */
export function trySignPage(): string {
  const locks = tryLocks().map((l) => ({ ...l, href: /^https?:\/\//.test(l.href) ? l.href : `/${l.href}` }));
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">Try it yourself</p>
  <h1 class="h-sec">Sign with your own Face ID</h1>
  <p class="lead">An agent proposes a payment it may not make alone; you sign its exact terms with Face ID, and Purser verifies the signature.</p>
  <details class="wr"><summary>${icon("info", 16)}What's real?</summary><div class="card wr-body">
    <h3>Simulated</h3><ul>${li(WHATS_REAL.simulated)}</ul>
    <h3>Real</h3><ul>${li(WHATS_REAL.real)}</ul>
    <h3>What the server does not prove</h3><ul>${li(WHATS_REAL.limits)}</ul>
    <h3>Sources</h3><ul>${li(WHATS_REAL.sources)}</ul>
  </div></details>
</section>
<ol class="progress" aria-label="Three steps">
${TRY_SIGN_STEPS.map((s, i) => `  <li id="pg-${i + 1}"${i === 0 ? ' class="on" aria-current="step"' : ""}><span class="n">${i + 1}</span><span class="t">${esc(s)}</span></li>`).join("\n")}
</ol>
<div class="start" id="s-world">
  <button class="btn primary big" type="button" id="go-world">${icon("play", 18)}Start: show me the proposal</button>
  <p class="hook" id="hook">${esc(TRY_SIGN_HOOK)}</p>
  <p class="status" id="w-status" aria-live="polite"></p>
</div>
<section id="s-props" hidden>
  <dl class="world" id="w-facts" hidden><div><dt>Test world</dt><dd id="w-id"></dd></div><div><dt>Balance</dt><dd id="w-balance"></dd></div><div><dt>Reserve floor</dt><dd id="w-floor"></dd></div><div><dt>An agent pays alone up to</dt><dd id="w-alone"></dd></div><div><dt>Deleted</dt><dd id="w-left" data-left="in"></dd></div></dl>
  <div class="props" id="props"></div>
</section>
<section class="card result" id="result" hidden aria-live="polite">
  <div class="bigok">${icon("circle-check", 56)}<h2 id="r-head">${esc(TRY_SIGN_SIGNED)}</h2></div>
  <div class="line ok">${icon("shield-check", 22)}<span><b>Verified by the server</b><span id="r-checks"></span></span></div>
  <div class="line ok">${icon("circle-check", 22)}<span><b>Executed in your test world</b><span id="r-exec"></span></span></div>
  <div><p class="small muted">The hash you signed (SHA-256 of the exact terms):</p><div id="r-hash"></div></div>
  <div class="receipt"><button class="btn" type="button" id="r-receipt">${icon("receipt", 18)}Download receipt.json</button>
    <p class="small muted">Check it offline with one command, no server: <code>npm run verify-receipt -- receipt.json</code>.</p>
    <details class="more"><summary>more</summary><p>It holds the exact terms, their hash, your signature, its public key and the algorithm, and no secret. The command is in the repository, ${esc(REPO_URL.replace(/^https:\/\//, ""))}. Change one field or one cent and it fails. It proves that the holder of that key signed these terms, not who holds it.</p></details></div>
  <div class="tbox" id="tamper-box">
    <h3>${icon("triangle-alert", 18)} Now try to tamper</h3>
    <p class="small muted">Change a field, then send it with the same signature: the server checks it for real.</p>
    <div class="tf">
      <label data-field="amount">Amount<input id="t-amount" inputmode="decimal" autocomplete="off" spellcheck="false" data-world="1"></label>
      <label data-field="payee_iban">IBAN<input id="t-iban" autocomplete="off" autocapitalize="characters" spellcheck="false" data-world="1"></label>
      <label data-field="currency">Currency<select id="t-currency" data-world="1"><option>EUR</option><option>USD</option><option>GBP</option><option>CHF</option></select></label>
      <label data-field="fx.client_rate" hidden>FX rate<input id="t-rate" inputmode="decimal" autocomplete="off" spellcheck="false" data-world="1"></label>
    </div>
    <div class="tactions"><button class="btn primary" type="button" id="t-send" data-world="1" disabled>Send with the same signature</button><button class="btn" type="button" id="go-tamper" data-world="1">Try to tamper: change the amount by 0.01</button></div>
    <p class="status" id="t-status" aria-live="polite"></p>
    <div id="tamper" hidden><div id="t-what"></div><div class="line" id="t-line"><span id="t-icon"></span><div><b id="t-head"></b><div id="t-why" class="small"></div></div></div><p class="outcome" id="t-verdict" hidden></p></div>
  </div>
</section>
</div></main>`;
  const html = page({
    title: "Sign with your own Face ID", description: "Try it yourself: an agent proposes, you sign the exact terms with Face ID, Purser verifies. A test world of your own; nothing real moves.",
    tab: "try", css: CSS, body, js: JS, stage: false,
    data: { icons: iconSet(["landmark", "octagon-x", "clock", "scan-face", "triangle-alert", "circle-check", "check", "lock", "external-link", "arrow-right", "receipt", "rotate-ccw"]), locks, cfo: cfoApproval().line, fields: TAMPER_FIELDS, verdict: TAMPER_VERDICT, receipt: RECEIPT_FORMAT, recordedFx: recordedQuote() },
    source: "Source: a test world made for you (worker/src/trySign.ts); nothing in it is recorded anywhere else. The lock examples: docs/demo/main-run.json and docs/runs/visa-tap-live-2026-11-02.json.",
    // Its own "What's real?" (final review, 4 Nov): this page is not the main run, and calls none of the partners.
    real: [
      "A test world made for you, deleted after one hour: a test copy of Northwind Outdoor; its balance, payees, IBANs and the agent's two proposals (fixed text, no model) are test data.",
      "No payment or conversion at Airwallex, no Metal or Claude call, and no money moves: the executor only records, in your test world.",
      "Real: your device's passkey signature over the hash of the exact terms, and the server's check of it against the public key your device registered.",
    ],
  }).replace("<body>\n", () => `<body>\n<div class="testband" role="note">${icon("lock", 16)}${esc(TRY_SIGN_LABEL)}</div>\n`);
  // One "What's real?" on this page (Max, 6 Nov): the one under the disclaimer. The footer's copy is cut out, by position.
  const foot = html.indexOf('<footer class="foot">');
  const a = html.indexOf('<details class="real"', foot), b = html.indexOf("</details>", a);
  if (foot < 0 || a < 0 || b < 0) throw new Error("/try/sign: the footer's What's real? was not found");
  const one = html.slice(0, a) + html.slice(b + "</details>".length);
  // Relative links and assets made absolute: the page answers one level down, at /try/sign.
  return one.replace(/(href|src)="(?!https?:|#|\/|data:|mailto:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}
