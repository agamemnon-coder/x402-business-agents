// /try/sign (TRY_SIGN_ENABLED): "Try it yourself: sign with your own Face ID". A visitor opens a test world of their
// own (one hour), makes a test passkey, sees an agent's two proposals (one blocked by a rule, with nothing to sign; one
// waiting for a person), signs the second with the hash of its exact terms as the challenge, sees the server verify it
// and the stand-in executor run it in the test world, then changes the amount by 0.01 and sees the same signature
// refused. The page's API is worker/src/trySign.ts. One inline script and one inline style, hashed into the CSP like
// the other public pages; everything it shows from the server goes in as text, never as markup.

import { esc, icon, iconSet, page } from "../redesign/ui.js";

/** The feature flag, read where the bundle is built: on, the page, its API and the links to it are in the bundle. */
export const trySignOn = (env: NodeJS.ProcessEnv = process.env) => ["on", "1", "true"].includes(env.TRY_SIGN_ENABLED ?? "");

/** The label at the top of the page, word for word. */
export const TRY_SIGN_LABEL = "Test world · test passkey · nothing real moves";

const CSS = `.testband { background: var(--text); color: var(--bg); text-align: center; font: 700 15px/1.3 Inter, system-ui, sans-serif; padding: 10px var(--gut); letter-spacing: .01em; }
.testband .i { vertical-align: -3px; margin-right: 6px; }
main { padding: 28px 0 24px; }
.intro { max-width: 760px; margin-bottom: 24px; }
.intro h1 { margin-bottom: 12px; }
.flow { display: grid; gap: 16px; max-width: 760px; list-style: none; margin: 0; padding: 0; }
.step { padding: 20px; display: grid; gap: 12px; }
.step h2 { font-size: 20px; letter-spacing: -.015em; display: flex; align-items: center; gap: 10px; }
.step h2 .n { width: 30px; height: 30px; border-radius: 50%; background: var(--text); color: var(--bg); display: grid; place-items: center; font-size: 15px; flex: none; }
.step.done h2 .n { background: var(--ok); color: var(--surface); }
.step p { margin: 0; }
.muted { color: var(--muted); }
.small { font-size: 15px; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn[hidden] { display: none; }
.status { font-size: 15.5px; color: var(--muted); min-height: 1.4em; overflow-wrap: anywhere; }
.status.bad { color: var(--bad); font-weight: 600; }
.status.ok { color: var(--ok); font-weight: 600; }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: 15.5px; }
.facts dt { color: var(--muted); } .facts dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.props { display: grid; gap: 16px; }
.prop { padding: 18px; display: grid; gap: 12px; }
.prop .who { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-weight: 700; }
.prop .who .av { width: 36px; height: 36px; background: var(--a-treasury); color: #fff; }
.prop .says { font-size: 16.5px; line-height: 1.45; margin: 0; }
.prop .says::before { content: "“"; } .prop .says::after { content: "”"; }
.chk { display: grid; gap: 4px; border-radius: 14px; padding: 12px 14px; font-size: 15.5px; line-height: 1.45; }
.chk b { display: flex; align-items: center; gap: 6px; }
.chk.fail { background: var(--bad-soft); color: var(--text); } .chk.fail b { color: var(--bad); }
.chk.pass { background: var(--sunken); } .chk.pass b { color: var(--accent); }
.chk.done { background: var(--ok-soft); } .chk.done b { color: var(--ok); }
.hash { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; word-break: break-all; background: var(--sunken); border-radius: 10px; padding: 8px 10px; }
details.terms summary { cursor: pointer; font-size: 15px; font-weight: 600; color: var(--muted); }
details.terms pre { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 10px; padding: 10px; }
.result { padding: 20px; display: grid; gap: 14px; max-width: 760px; margin-top: 16px; }
.result[hidden], .step[hidden], .props[hidden] { display: none; }
.line { display: flex; align-items: flex-start; gap: 10px; font-size: 16px; line-height: 1.45; }
.line .i { margin-top: 2px; }
.line.ok .i { color: var(--ok); } .line.bad .i { color: var(--bad); }
.line b { display: block; }
.note { font-size: 14.5px; color: var(--faint); max-width: 760px; margin: 18px 0 0; line-height: 1.5; }
@media (max-width: 640px) { .step, .prop, .result { padding: 16px; } .facts { grid-template-columns: minmax(0, 1fr); gap: 0; } .facts dd { margin-bottom: 6px; } .btn { width: 100%; justify-content: center; white-space: normal; height: auto; min-height: 48px; padding: 10px 18px; } }`;

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
  function ic(name) { var s = document.createElement("span"); s.innerHTML = D.icons[name]; return s.firstChild; }
  function status(id, text, tone) { var n = $(id); n.textContent = text; n.className = "status" + (tone ? " " + tone : ""); }
  function eur(s) { var p = String(s).split("."); return "EUR " + p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",") + "." + (p[1] || "00"); }

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
      $("w-left").textContent = "expired";
      document.querySelectorAll("button[data-world]").forEach(function (b) { b.disabled = true; });
      status("w-status", "This test world has expired and is deleted. Reload the page to start a new one.", "bad");
      return;
    }
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    $("w-left").textContent = m + " min " + String(s).padStart(2, "0") + " s";
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
      $("s-world").classList.add("done");
      b.hidden = true;
      status("w-status", "Your world is open. It is yours alone and is deleted after one hour.", "ok");
      S.timer = setInterval(tick, 1000); tick();
      $("s-key").hidden = false;
      return showProposals(r.data.proposals);
    });
  });

  $("go-key").addEventListener("click", function () {
    var b = $("go-key"), o = S.options;
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
        $("s-key").classList.add("done");
        b.hidden = true;
        status("k-status", "Your test passkey is made and registered in this world only (" + c.id.slice(0, 10) + "…).", "ok");
        document.querySelectorAll("button[data-sign]").forEach(function (x) { if (x.dataset.ready === "1") x.disabled = false; });
      });
    }, function (e) { status("k-status", passkeyError(e), "bad"); b.disabled = false; });
  });

  function showProposals(list) {
    var box = $("props");
    box.replaceChildren();
    return Promise.all(list.map(function (p) {
      var terms = JSON.parse(p.canonical);
      return sha256(canon(terms)).then(function (h) { return { p: p, terms: terms, mine: h, same: canon(terms) === p.canonical && h === p.terms_sha256 }; });
    })).then(function (rows) {
      rows.forEach(function (x) { box.appendChild(card(x)); });
      $("s-props").hidden = false;
    });
  }

  function card(x) {
    var p = x.p, t = x.terms;
    var facts = el("dl", "facts", [
      el("dt", "", ["Pay"]), el("dd", "", [t.payee]),
      el("dt", "", ["Amount"]), el("dd", "", [eur(t.amount)]),
      el("dt", "", ["Reference"]), el("dd", "", [t.reference]),
      el("dt", "", ["Proposal"]), el("dd", "", [p.proposal_id])
    ]);
    var kids = [
      el("div", "who", [el("span", "av", [ic("landmark")]), p.agent, el("span", "pill", ["fixed text, no model call"])]),
      el("p", "says", [p.says]), facts
    ];
    if (p.check === "fail") {
      // Nothing to sign: no button at all, and the rule that blocks it.
      kids.push(el("div", "chk fail", [el("b", "", [ic("octagon-x"), "Check: fail · blocked by a rule"]), el("span", "", [p.rule]), el("span", "", ["Nothing to sign: no signature can approve this."])]));
      return el("article", "card prop", kids);
    }
    var st = el("p", "status", []);
    st.id = "st-" + p.proposal_id;
    kids.push(el("div", "chk pass", [el("b", "", [ic("clock"), "Check: pass · waiting for a person"]), el("span", "", [p.waits])]));
    kids.push(el("div", "", [el("p", "small muted", ["The hash of the exact terms, which your passkey signs" + (x.same ? " (checked on this device):" : ":")]), el("div", "hash", [x.mine])]));
    var pre = el("pre", "", [x.p.canonical]);
    kids.push(el("details", "terms", [el("summary", "", ["All terms (exactly what is hashed)"]), pre]));
    var b = el("button", "btn primary", [ic("scan-face"), "Sign with Face ID"]);
    b.type = "button"; b.dataset.sign = p.proposal_id; b.dataset.world = "1"; b.disabled = true;
    if (!x.same) {
      kids.push(el("p", "status bad", ["The terms do not hash to the hash the server sent. Do not sign."]));
    } else {
      b.dataset.ready = "1";
      if (S.credId) b.disabled = false;
      b.addEventListener("click", function () { sign(x, b, st); });
    }
    kids.push(b, st);
    return el("article", "card prop", kids);
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
      status(st.id, "Sending the signature to the server…");
      return post("sign", { token: S.token, proposal_id: x.p.proposal_id, canonical: x.p.canonical, credential: a }).then(function (r) {
        if (r.status !== 200) { status(st.id, "Not accepted: " + (r.data.error || ("error " + r.status)) + ".", "bad"); b.disabled = false; return; }
        S.signed = { x: x, a: a };
        b.hidden = true;
        status(st.id, "Signed, verified and executed in your test world.", "ok");
        showResult(x, r.data);
      });
    }, function (e) { status(st.id, passkeyError(e), "bad"); b.disabled = false; });
  }

  function showResult(x, d) {
    $("r-hash").textContent = d.terms_sha256;
    $("r-checks").textContent = "Checked with the relay's passkey verifier: " + d.checks.join(", ") + ".";
    var e = d.executed;
    $("r-exec").textContent = "Test transfer " + e.id + ": " + eur(e.amount) + " to " + e.payee + ". Test balance now " + eur(e.balance_after) + ". By the " + e.by + ".";
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("go-tamper").addEventListener("click", function () {
    var b = $("go-tamper"), s = S.signed;
    if (!s) return;
    b.disabled = true;
    // The same signature, with the amount changed by 0.01 in the terms it claims to approve.
    var t = JSON.parse(s.x.p.canonical);
    var c = Math.round(Number(t.amount) * 100) + 1;
    t.amount = Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0");
    var changed = canon(t);
    sha256(changed).then(function (h) {
      $("t-what").textContent = "Amount " + eur(s.x.terms.amount) + " → " + eur(t.amount) + "; these terms hash to " + h + ".";
      return post("sign", { token: S.token, proposal_id: s.x.p.proposal_id, canonical: changed, credential: s.a }).then(function (r) {
        var refused = r.status !== 200;
        $("t-line").className = "line " + (refused ? "bad" : "ok");
        $("t-icon").replaceChildren(ic(refused ? "octagon-x" : "triangle-alert"));
        $("t-head").textContent = refused ? "Refused: the same signature does not verify for the changed terms" : "Accepted?! This should not happen.";
        $("t-why").textContent = refused ? (r.data.error || ("error " + r.status)) : "";
        $("tamper").hidden = false;
      });
    });
  });
})();`;

/** The page, its links and assets absolute (it answers at /try/sign, one level down). */
export function trySignPage(): string {
  const body = `<main><div class="wrap">
<section class="intro">
  <p class="eyebrow">Try it yourself</p>
  <h1 class="h-sec">Sign with your own Face ID</h1>
  <p class="lead">A test world of your own for one hour. An agent proposes two payments; rules in code check them. One is blocked by a rule and has nothing to sign. The other waits for a person: you sign the hash of its exact terms with a passkey you make now, and the server verifies it.</p>
</section>
<ol class="flow" role="list">
  <li class="card step" id="s-world"><h2><span class="n">1</span>Open your test world</h2>
    <p class="muted small">Stand-in executors only, like the Scenario Lab: no Airwallex, Metal or Claude call, no money. It is deleted after one hour.</p>
    <dl class="facts" id="w-facts" hidden><dt>World</dt><dd id="w-id"></dd><dt>Test balance</dt><dd id="w-balance"></dd><dt>Reserve floor</dt><dd id="w-floor"></dd><dt>An agent pays alone up to</dt><dd id="w-alone"></dd><dt>Deleted in</dt><dd id="w-left"></dd></dl>
    <button class="btn primary" type="button" id="go-world">${icon("play", 18)}Start my test world</button>
    <p class="status" id="w-status" aria-live="polite"></p>
  </li>
  <li class="card step" id="s-key" hidden><h2><span class="n">2</span>Make a test passkey</h2>
    <p class="muted small">Face ID, Touch ID, Windows Hello, a security key, or your phone by QR code, within ten minutes. No name or e-mail: a random id, kept on your device as “Purser test passkey” for this site. It opens this test world and nothing else.</p>
    <button class="btn primary" type="button" id="go-key" data-world="1">${icon("scan-face", 18)}Create a test passkey</button>
    <p class="status" id="k-status" aria-live="polite"></p>
  </li>
  <li class="step" id="s-props" hidden><h2><span class="n">3</span>The agent's proposals</h2>
    <div class="props" id="props"></div>
  </li>
</ol>
<section class="card result" id="result" hidden aria-live="polite">
  <h2 class="h-sec">Signed</h2>
  <div><p class="small muted">The hash you signed (SHA-256 of the exact terms):</p><div class="hash" id="r-hash"></div></div>
  <div class="line ok">${icon("shield-check", 22)}<span><b>Verified by the server</b><span id="r-checks" class="small muted"></span></span></div>
  <div class="line ok">${icon("circle-check", 22)}<span><b>Executed in your test world</b><span id="r-exec" class="small muted"></span></span></div>
  <button class="btn" type="button" id="go-tamper" data-world="1">${icon("triangle-alert", 18)}Try to tamper: change the amount by 0.01</button>
  <div id="tamper" hidden><p class="small muted" id="t-what"></p><div class="line" id="t-line"><span id="t-icon"></span><span><b id="t-head"></b><span id="t-why" class="small"></span></span></div></div>
</section>
<p class="note">${esc("What is real here: your device's passkey signature over the hash, and the server's check of it (the same verifier as the CFO's passkey sign-in) against the public key your device registered. The server checks no attestation, so it cannot tell which authenticator made the key, and a key made in software would verify too; Face ID is what your device asks for, not something the server proves. What is not real: the world, its balance, the agent's words (fixed text) and the executor (a stand-in that only records). This world, its passkey record and its proposals live in their own store, apart from Northwind's: a test passkey is not enrolled anywhere else, so it can never approve a real proposal or sign in to the CFO's pages.")}</p>
</div></main>`;
  const html = page({
    title: "Sign with your own Face ID", description: "Try it yourself: a test world of your own, a test passkey, and a signature the server verifies. Nothing real moves.",
    tab: "try", css: CSS, body, js: JS, stage: false, data: { icons: iconSet(["landmark", "octagon-x", "clock", "scan-face", "triangle-alert", "circle-check"]) },
    source: "Source: a test world made for you (worker/src/trySign.ts); nothing in it is recorded anywhere else.",
  }).replace("<body>\n", () => `<body>\n<div class="testband" role="note">${icon("lock", 16)}${esc(TRY_SIGN_LABEL)}</div>\n`);
  // Relative links and assets made absolute: the page answers one level down, at /try/sign.
  return html.replace(/(href|src)="(?!https?:|#|\/|data:|mailto:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}
