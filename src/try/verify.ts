// /try/verify (A3): check a /try/sign receipt.json in the browser, with WebCrypto, and no server call. The checks are
// the ones `npm run verify-receipt` makes (src/try/receipt.ts), step by step and worded the same: the terms hash to
// terms_sha256; the passkey's challenge is that hash; the client data is an assertion for the receipt's origin; the
// authenticator data is for its RP id, with user presence and verification; the ES256 signature verifies with the
// public key. The page reads the receipt from a file the visitor picks, or from the link /try/sign opens (its #fragment,
// which a browser never sends to a server), and its CSP allows no connection at all (connect-src 'none'). A toggle
// changes one field of the receipt's terms in the page, to watch the same signature fail.

import { esc, icon, iconSet, page } from "../redesign/ui.js";
import { REPO_URL } from "../submission/deck.js";
import { RECEIPT_FORMAT, RECEIPT_MEANS } from "./receipt.js";

/** The line under the heading, word for word. */
export const VERIFY_LEAD = "Don't trust our server: check it yourself.";
/** The verdicts, word for word. */
export const VERIFY_VERDICT = { valid: "Signature valid for these terms", invalid: "Invalid" } as const;
/** The fields the "change one field" toggle may change, and how (the same kinds of change as /try/sign's tamper). */
export const VERIFY_FIELDS = ["amount", "payee_iban", "currency", "fx.client_rate"] as const;

/**
 * The checks, in the browser's own words of JavaScript (no backticks and no "${": it lives in a template string). It
 * defines verifyReceiptWeb(receipt) → Promise<{ ok, checks: [{ check, ok, detail }] }>, the same checks, names and
 * details as verifyReceipt in src/try/receipt.ts; test/try-verify.test.ts runs both on the same receipts.
 */
export const VERIFY_CORE = `
var FORMAT = ${JSON.stringify(RECEIPT_FORMAT)};
function isObj(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function b64uBytes(s) { var b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function bytesB64u(u) { var s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); }
function hexOf(u) { return Array.from(u).map(function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
function hexBytes(h) { var u = new Uint8Array(h.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(2 * i, 2), 16); return u; }
function digest(u) { return crypto.subtle.digest("SHA-256", u).then(function (d) { return new Uint8Array(d); }); }
function utf8(s) { return new TextEncoder().encode(s); }
function canonicalTerms(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalTerms).join(",") + "]";
  if (isObj(v)) return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canonicalTerms(v[k]); }).join(",") + "}";
  throw new Error("the terms carry a number or another type the terms never have (money is a decimal string)");
}
// A WebAuthn ES256 signature is DER (SEQUENCE of two INTEGERs); WebCrypto takes r and s, 32 bytes each.
function derToRaw(d) {
  if (d.length < 8 || d[0] !== 0x30 || d[1] !== d.length - 2 || d[2] !== 0x02) return null;
  var rl = d[3], r = d.subarray(4, 4 + rl);
  if (d[4 + rl] !== 0x02) return null;
  var sl = d[5 + rl], s = d.subarray(6 + rl, 6 + rl + sl);
  if (6 + rl + sl !== d.length) return null;
  var out = new Uint8Array(64), ok = true;
  [r, s].forEach(function (x, i) { while (x.length > 32 && x[0] === 0) x = x.subarray(1); if (x.length > 32) ok = false; else out.set(x, i * 32 + 32 - x.length); });
  return ok ? out : null;
}
function chainRowCanonical(x) { return "{\\"at\\":" + JSON.stringify(x.at) + ",\\"data_sha256\\":" + JSON.stringify(x.data_sha256) + ",\\"kind\\":" + JSON.stringify(x.kind) + ",\\"prev\\":" + JSON.stringify(x.prev) + ",\\"seq\\":" + String(x.seq) + "}"; }
function hexDigest(s) { return digest(utf8(s)).then(hexOf); }
function verifyReceiptWeb(r) {
  var checks = [];
  function add(check, ok, detail) { checks.push({ check: check, ok: ok, detail: detail }); return ok; }
  function done() { return { ok: checks.length > 0 && checks.every(function (c) { return c.ok; }), checks: checks }; }
  var B64 = /^[A-Za-z0-9_-]+$/;
  var a = isObj(r) ? r.assertion : undefined, pk = isObj(r) ? r.public_key : undefined;
  var shaped = isObj(r) && r.receipt === FORMAT && isObj(r.terms) && typeof r.terms_sha256 === "string" && /^[0-9a-f]{64}$/.test(r.terms_sha256)
    && typeof r.rp_id === "string" && typeof r.origin === "string" && isObj(a)
    && [a.authenticatorData, a.clientDataJSON, a.signature].every(function (x) { return typeof x === "string" && B64.test(x); })
    && isObj(pk) && pk.kty === "EC" && pk.crv === "P-256" && typeof pk.x === "string" && typeof pk.y === "string";
  if (!add("format", shaped, shaped ? FORMAT : "not a " + FORMAT + " receipt (a field is missing or of the wrong type)")) return Promise.resolve(done());
  add("algorithm", r.algorithm === "ES256", r.algorithm === "ES256" ? "ES256 (ECDSA on P-256 with SHA-256)" : "ES256 expected, not " + String(r.algorithm));
  // 5. The world's hash chain (6c), when the receipt carries one: as src/try/receipt.ts checks it.
  function chain() {
    if (r.chain === undefined) return done();
    var c = r.chain, rows = isObj(c) && Array.isArray(c.rows) ? c.rows : null, prev = "0".repeat(64), i = 0;
    var finish = function (bad) {
      if (rows && !bad && (!isObj(c) || c.length !== rows.length || c.head !== (rows.length ? prev : null))) bad = "the chain's length or head is not its rows'";
      add("chain", !bad, bad || rows.length + " rows, each covering the one before; head " + prev);
      if (bad) return done();
      var want;
      try { want = canonicalTerms({ proposal_id: r.terms.proposal_id, terms_sha256: r.terms_sha256 }); } catch (e) { want = null; }
      return (want === null ? Promise.resolve(null) : hexDigest(want)).then(function (w) {
        var row = rows.filter(function (x) { return x.kind === "signature" && x.data_sha256 === w; })[0];
        add("chain signature", !!row, row ? "row " + row.seq + " records this signature (" + String(r.terms.proposal_id) + ", the terms hash signed)" : "no row of the chain records this signature");
        return done();
      });
    };
    var step = function () {
      if (!rows) return finish("the chain has no rows");
      if (i >= rows.length) return finish(null);
      var x = rows[i];
      if (!isObj(x) || x.seq !== i + 1 || typeof x.at !== "string" || typeof x.kind !== "string" || typeof x.data_sha256 !== "string" || typeof x.hash !== "string") return finish("row " + (i + 1) + " is not a chain row");
      if (x.prev !== prev) return finish("row " + (i + 1) + " does not follow the row before (its prev is not that row's hash)");
      return hexDigest(chainRowCanonical(x)).then(function (h) {
        if (h !== x.hash) return finish("row " + (i + 1) + "'s hash is not the SHA-256 of the row: it was changed");
        prev = x.hash; i++;
        return step();
      });
    };
    return step();
  }
  var canonical = null;
  try { canonical = canonicalTerms(r.terms); } catch (e) { add("terms", false, e.message); }
  var auth = b64uBytes(a.authenticatorData), cdj = b64uBytes(a.clientDataJSON);
  return (canonical === null ? Promise.resolve(null) : digest(utf8(canonical))).then(function (th) {
    if (th) { var h = hexOf(th); add("terms hash", h === r.terms_sha256, h === r.terms_sha256 ? "SHA-256 of the canonical terms is " + h : "the terms hash to " + h + ", not to the receipt's " + r.terms_sha256 + ": the terms were changed"); }
    var client = null;
    try { var c = JSON.parse(new TextDecoder().decode(cdj)); client = isObj(c) ? c : null; } catch (e) { client = null; }
    if (!client) add("client data", false, "the client data is not a JSON object");
    else {
      add("ceremony", client.type === "webauthn.get", client.type === "webauthn.get" ? "a passkey assertion (webauthn.get)" : "not an assertion (" + String(client.type) + ")");
      var want = bytesB64u(hexBytes(r.terms_sha256));
      add("challenge", client.challenge === want, client.challenge === want ? "the passkey signed a challenge equal to the terms hash"
        : "the passkey signed challenge " + String(client.challenge).slice(0, 16) + "…, not the terms hash (" + want.slice(0, 16) + "…)");
      var origin = client.origin === r.origin && client.crossOrigin !== true;
      add("origin", origin, origin ? "made on " + r.origin : "made on " + String(client.origin) + (client.crossOrigin === true ? " inside a frame" : "") + ", not " + r.origin);
    }
    var authOk = add("authenticator data", auth.length >= 37, auth.length >= 37 ? auth.length + " bytes" : "too short");
    return (authOk ? digest(utf8(r.rp_id)) : Promise.resolve(null)).then(function (rph) {
      if (rph) {
        var rp = rph.every(function (b, i) { return auth[i] === b; });
        add("RP id", rp, rp ? "for " + r.rp_id : "not for " + r.rp_id);
        var flags = auth[32];
        add("user present", (flags & 0x01) !== 0, (flags & 0x01) ? "the authenticator reports a person present" : "no user presence");
        add("user verified", (flags & 0x04) !== 0, (flags & 0x04) ? "the authenticator reports user verification (Face ID, a fingerprint or a PIN; which one is not in the signature)" : "no user verification");
      }
      var fx = isObj(r.terms.fx) ? r.terms.fx : null;
      if (fx) {
        var fs = typeof fx.quote_id === "string" && typeof fx.valid_to_at === "string" && typeof fx.client_rate === "string";
        add("fx quote", fs, fs ? "quote " + String(fx.quote_id) + ", " + String(fx.buy_currency) + " " + String(fx.buy_amount) + " for " + String(fx.sell_currency) + " " + String(fx.sell_amount) + " at " + String(fx.client_rate) + ", valid to " + String(fx.valid_to_at) + ": in the signed terms (that Airwallex issued it is not checked offline)" : "the terms' fx block is not a quote");
      }
      // The signature: ES256 over the authenticator data followed by the SHA-256 of the client data.
      var bad = function () { add("signature", false, "the public key or the signature is malformed"); return chain(); };
      var key;
      try { key = crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: pk.x, y: pk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); } catch (e) { return bad(); }
      return Promise.all([key, digest(cdj)]).then(function (k) {
        var signed = new Uint8Array(auth.length + 32); signed.set(auth); signed.set(k[1], auth.length);
        var raw = derToRaw(b64uBytes(a.signature));
        var ok = raw ? crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k[0], raw, signed) : Promise.resolve(false);
        return ok.then(function (v) {
          add("signature", v, v ? "the ES256 signature verifies with the receipt's public key" : "the signature does not verify with the receipt's public key");
          return chain();
        });
      }, bad);
    });
  });
}`;

const CSS = `main { padding: 22px 0 28px; }
.intro { max-width: 760px; margin-bottom: 16px; }
.intro .eyebrow { margin-bottom: 6px; } .intro h1 { margin-bottom: 8px; } .intro .lead { font-size: 19px; font-weight: 650; color: var(--text); }
.box { max-width: 760px; padding: 18px; display: grid; gap: 14px; }
.box > * { min-width: 0; }
.pick { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.pick input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
.pick input[type=file]:focus-visible + .btn, .pick label:focus-within { outline: 2px solid var(--accent); }
.muted { color: var(--muted); } .small { font-size: 15px; }
.vv { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 12px; padding: 14px; border-radius: 14px; font-size: clamp(19px, 2.2vw, 23px); font-weight: 750; }
.vv svg { width: 34px; height: 34px; }
.vv[hidden] { display: none; }
.vv .i { width: 34px; height: 34px; flex: none; }
.vv.ok { background: var(--sunken); color: var(--ok); } .vv.bad { background: var(--bad-soft); color: var(--bad); }
.vv span { overflow-wrap: anywhere; min-width: 0; }
.why { margin: 0; font-size: 15.5px; overflow-wrap: anywhere; }
.why:empty { display: none; }
dl.terms { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 6px 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--sunken); font-size: 15px; }
dl.terms dt { color: var(--muted); } dl.terms dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; min-width: 0; }
dl.terms dd.chg { color: var(--bad); }
dl.terms[hidden], .flip[hidden] { display: none; }
ul.checks { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 14.5px; }
ul.checks li { display: flex; gap: 8px; align-items: flex-start; overflow-wrap: anywhere; } ul.checks li > span { min-width: 0; }
ul.checks li .i { flex: none; margin-top: 2px; } ul.checks li.ok .i { color: var(--ok); } ul.checks li.bad .i { color: var(--bad); }
details.more { font-size: 14.5px; color: var(--muted); }
details.more > summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 32px; font-weight: 650; color: var(--accent); }
details.more > p, details.more > ul { margin: 4px 0 0; }
.flip { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.flip select { font: 600 15px/1.3 Inter, system-ui, sans-serif; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; min-height: 44px; padding: 6px 10px; }
.btn[aria-pressed="true"] { background: var(--bad); border-color: var(--bad); color: var(--on-bad); }
.status { margin: 0; font-size: 15px; color: var(--muted); } .status.bad { color: var(--bad); font-weight: 600; } .status:empty { display: none; }
code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }
@media (max-width: 640px) { .box { padding: 16px; } .btn { width: 100%; justify-content: center; white-space: normal; height: auto; min-height: 48px; } dl.terms { grid-template-columns: 92px minmax(0, 1fr); } }`;

const JS = `
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("run-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  ${VERIFY_CORE}
  var S = { receipt: null, name: "" };
  function el(tag, cls, kids) { var n = document.createElement(tag); if (cls) n.className = cls; (kids || []).forEach(function (k) { if (k !== null && k !== undefined) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); }); return n; }
  function ic(name) { var s = document.createElement("span"); s.innerHTML = D.icons[name]; return s.firstChild; }
  function status(text, bad) { $("v-status").textContent = text; $("v-status").className = "status" + (bad ? " bad" : ""); }
  function get(t, k) { return k.split(".").reduce(function (o, x) { return o && o[x]; }, t); }
  var LABEL = { amount: "Amount", payee_iban: "IBAN", currency: "Currency", "fx.client_rate": "FX rate" };
  // One field changed, as /try/sign's tamper does it: a cent more, another IBAN digit, another currency, a rate a millionth up.
  function changed(t, k) {
    var c = JSON.parse(JSON.stringify(t)), v = get(c, k);
    var w = k === "amount" ? (function () { var n = Math.round(Number(v) * 100) + 1; return Math.floor(n / 100) + "." + String(n % 100).padStart(2, "0"); })()
      : k === "payee_iban" ? v.slice(0, -1) + (v.slice(-1) === "9" ? "0" : String(Number(v.slice(-1)) + 1 || 1))
      : k === "currency" ? (v === "EUR" ? "USD" : "EUR")
      : (Number(v) + 0.000001).toFixed(Math.max(6, (String(v).split(".")[1] || "").length));
    if (k === "fx.client_rate") c.fx.client_rate = w; else c[k] = w;
    return c;
  }
  function show() {
    var r = S.receipt;
    if (!r) return;
    var flip = $("v-flip").getAttribute("aria-pressed") === "true", field = $("v-field").value;
    var terms = isObj(r.terms) ? r.terms : null;
    var mine = flip && terms && get(terms, field) !== undefined && get(terms, field) !== null ? Object.assign({}, r, { terms: changed(terms, field) }) : r;
    return verifyReceiptWeb(mine).then(function (v) {
      var bad = v.checks.filter(function (c) { return !c.ok; })[0];
      var box = $("v-verdict");
      box.className = "vv " + (v.ok ? "ok" : "bad");
      box.replaceChildren(ic(v.ok ? "circle-check" : "octagon-x"), el("span", "", [v.ok ? D.verdict.valid : D.verdict.invalid + ": the " + bad.check + " check fails"]));
      box.hidden = false;
      box.dataset.ok = String(v.ok);
      box.dataset.failed = bad ? bad.check : "";
      $("v-why").textContent = v.ok ? "Every check passed, here in your browser; nothing was sent to a server." : bad.detail.charAt(0).toUpperCase() + bad.detail.slice(1) + ".";
      var list = el("ul", "checks", v.checks.map(function (c) { var li = el("li", c.ok ? "ok" : "bad", [ic(c.ok ? "check" : "octagon-x"), el("span", "", [c.check + ": " + c.detail])]); li.dataset.check = c.check; return li; }));
      $("v-checks").replaceChildren(el("summary", "", ["All " + v.checks.length + " checks"]), list);
      $("v-checks").hidden = false;
      var t = isObj(mine.terms) ? mine.terms : {};
      // A row only for a field the receipt has: /try/sign's terms name payee and payee_iban, a live run's (awx-1's
      // P-0002) beneficiary_name and iban_last4.
      var row = function (k, label, val) { if (val === undefined || val === null || val === "") return []; var dd = el("dd", flip && k === field ? "chg" : "", [String(val)]); dd.dataset.field = k; return [el("dt", "", [label]), dd]; };
      var rows = [].concat(row("payee", "Payee", t.payee || t.beneficiary_name || t.vendor), row("amount", "Amount", (t.currency || "") + " " + t.amount), row("payee_iban", "IBAN", t.payee_iban || (t.iban_last4 ? "···· " + t.iban_last4 : undefined)));
      if (isObj(t.fx)) rows = rows.concat(row("fx.client_rate", "FX rate", t.fx.client_rate));
      rows = rows.concat(row("proposal_id", "Proposal", t.proposal_id));
      if (isObj(mine.chain) && Array.isArray(mine.chain.rows)) rows = rows.concat(row("chain", "Hash chain", mine.chain.rows.length + " rows, head " + String(mine.chain.head).slice(0, 12) + "…"));
      $("v-terms").replaceChildren.apply($("v-terms"), rows);
      $("v-terms").hidden = false;
      $("v-flipbox").hidden = !terms;
      status(S.name ? "Checked " + S.name + "." : "");
    });
  }
  function load(text, name) {
    var r;
    try { r = JSON.parse(text); } catch (e) { status("That file is not JSON: pick the receipt.json /try/sign gave you.", true); return; }
    S.receipt = r; S.name = name;
    $("v-flip").setAttribute("aria-pressed", "false");
    show();
  }
  if (!window.crypto || !crypto.subtle) { status("This browser offers no WebCrypto here (it needs HTTPS), so it cannot check the signature.", true); $("v-file").disabled = true; return; }
  $("v-file").addEventListener("change", function () {
    var f = $("v-file").files[0];
    if (!f) return;
    if (f.size > 65536) { status("That file is too large to be a receipt.", true); return; }
    f.text().then(function (t) { load(t, f.name); });
  });
  $("v-flip").addEventListener("click", function () { var on = $("v-flip").getAttribute("aria-pressed") !== "true"; $("v-flip").setAttribute("aria-pressed", String(on)); show(); });
  $("v-field").addEventListener("change", function () { if ($("v-flip").getAttribute("aria-pressed") === "true") show(); });
  // The receipt /try/sign hands over in the link's #fragment: it stays in this browser (a fragment is never sent).
  var m = /^#receipt=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (m) {
    history.replaceState(null, "", location.pathname);
    try { load(new TextDecoder().decode(b64uBytes(m[1])), "the receipt from /try/sign"); } catch (e) { status("The link carried no readable receipt; pick the file instead.", true); }
  }
})();`;

/** The page, its links and assets absolute (it answers at /try/verify, one level down). */
export function tryVerifyPage(): string {
  const fields = VERIFY_FIELDS.map((f) => `<option value="${f}">${esc({ amount: "Amount (+ 0.01)", payee_iban: "IBAN (one digit)", currency: "Currency", "fx.client_rate": "FX rate (+ 0.000001)" }[f])}</option>`).join("");
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">Verify a receipt</p>
  <h1 class="h-sec">Check the signature yourself</h1>
  <p class="lead" id="v-lead">${esc(VERIFY_LEAD)}</p>
  <p class="muted">Your browser checks receipt.json with WebCrypto, on this device; this page sends nothing to any server.</p>
</section>
<section class="card box" aria-live="polite">
  <div class="pick"><label class="btn primary" for="v-file">${icon("receipt", 18)}Pick receipt.json</label><input type="file" id="v-file" accept="application/json,.json"></div>
  <p class="status" id="v-status"></p>
  <div class="vv" id="v-verdict" hidden></div>
  <p class="why" id="v-why"></p>
  <dl class="terms" id="v-terms" hidden></dl>
  <details class="more" id="v-checks" hidden></details>
  <div class="flip" id="v-flipbox" hidden><select id="v-field" aria-label="Which field">${fields}</select><button class="btn" type="button" id="v-flip" aria-pressed="false">${icon("triangle-alert", 18)}Change one field</button></div>
  <details class="more"><summary>more</summary><ul>${RECEIPT_MEANS.map((l) => `<li>${esc(l)}</li>`).join("")}<li>The same checks run offline with <code>npm run verify-receipt -- receipt.json</code> in the repository, ${esc(REPO_URL.replace(/^https:\/\//, ""))}.</li></ul></details>
</section>
<p class="small muted"><a href="/try/sign">${icon("arrow-right", 16)}Make a receipt on /try/sign</a></p>
</div></main>`;
  const html = page({
    title: "Verify a receipt", description: "Check a /try/sign receipt.json in your browser with WebCrypto: no server call. Change one field and it fails.",
    tab: "try", css: CSS, body, js: JS, stage: false,
    data: { icons: iconSet(["circle-check", "octagon-x", "check"]), verdict: VERIFY_VERDICT },
    source: "Source: src/try/verify.ts (the checks of src/try/receipt.ts, in the browser).",
    real: ["Real: the checks run in your browser with WebCrypto, on the receipt you pick; nothing is sent to any server. A test world's receipt: nothing real moved."],
  });
  return html.replace(/(href|src)="(?!https?:|#|\/|data:|mailto:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}
