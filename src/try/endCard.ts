// The hands-on demo's end card (master list lines 252, 326 and 315): what the visitor just did, in order (invoice,
// decision, signature, payment, booking, archive), each with its id behind a fold; one "Verify yourself" button that
// checks, in the visitor's own browser, that the passkey's signature is over the SHA-256 of these exact terms; the right
// answer for the invoice next to what the agents decided, and whether they matched; and the scenario's seed with
// "Replay this scenario" and "Give me another scenario". Every value comes from an answer the engine gave this visitor.
//
// The verification needs no server: the terms (or their canonical text), the assertion this browser made at the
// approval, and the passkey's public key, which the browser keeps from the passkey's creation (the credential's
// response.getPublicKey(), SPKI) or as a JWK. The checks: the terms' SHA-256 is the challenge the passkey signed, the
// client data is an assertion with user presence and verification, and the ES256 signature verifies over the
// authenticator data and the client data's hash. Change one cent and the hash, so the challenge, no longer matches.
//
// Behind the switch `end_card` (off when missing). Plain HTML and a script string; the page (lane B) places them.

/** The verdicts, word for word. */
export const END_VERDICT = { ok: "Signature matches these terms", bad: "Does not match" } as const;
/** The sentence under a mismatch between the right answer and the agents': the money did not move on its own. */
export const MONEY_STAYED = "The money stayed: nothing moves without your signature.";

/** The right answer for an invoice, and what the agents decided, in the same three words. */
export type Action = "refuse" | "ask" | "pay";
export interface Expect { action: Action; reason: string }
export const ACTION_WORDS: Record<Action, string> = { refuse: "Refuse it", ask: "Ask a person first", pay: "Pay it after your signature" };

/** What the engine's answer to a filed invoice means, in those words: a duplicate or a blocked invoice is refused; one
 *  that needs a review or a supplier on file asks a person; a ready one is proposed for the visitor's signature. */
export function decisionOf(out: { kind: string; invoice: { status: string; findings: { code: string }[] } | null }): { action: Action; why: string } {
  if (out.kind === "duplicate_document") return { action: "refuse", why: "the same file was already filed" };
  const inv = out.invoice;
  if (!inv) return { action: "refuse", why: `not filed as an invoice (${out.kind})` };
  const codes = inv.findings.map((f) => f.code).join(", ");
  if (inv.status === "blocked" || inv.status === "rejected") return { action: "refuse", why: codes || inv.status };
  if (inv.status === "ready" || inv.status === "approved" || inv.status === "paid" || inv.status === "scheduled") return { action: "pay", why: codes ? `the checks passed, with a warning: ${codes}` : "the checks passed" };
  return { action: "ask", why: codes || inv.status };
}

export interface Comparison { expected: Expect; decided: { action: Action; why: string }; match: boolean; line: string; stayed: string | null }
/** The right answer against the agents'; a wrong agent answer is shown, never hidden, with why the money stayed. */
export function compareExpect(expected: Expect, decided: { action: Action; why: string }): Comparison {
  const match = expected.action === decided.action;
  return {
    expected, decided, match,
    line: `Right answer: ${ACTION_WORDS[expected.action]} (${expected.reason}). The agents: ${ACTION_WORDS[decided.action]} (${decided.why}). ${match ? "They matched." : "They did not match."}`,
    stayed: match ? null : MONEY_STAYED,
  };
}

/** One step the visitor did, with its id (shown behind the fold). */
export interface Step { step: "invoice" | "decision" | "signature" | "payment" | "booking" | "archive"; text: string; id: string | null }
export const STEP_ORDER: Step["step"][] = ["invoice", "decision", "signature", "payment", "booking", "archive"];

/** The steps from the engine's answers, in order; a step that did not happen says so. */
export function endSteps(a: {
  invoice: { id: string; vendor: string; invoice_no: string; total: string; currency: string; doc_sha256: string } | null;
  decision: { action: Action; why: string } | null;
  proposal: { id: string; terms_sha256: string } | null;
  pay: { outcome: string; request_id?: string; settled: { transfer_status: string | null; ledger_entries: number; vault_added: string[] } | null } | null;
}): Step[] {
  const s: Step[] = [];
  s.push(a.invoice ? { step: "invoice", text: `Invoice ${a.invoice.invoice_no} from ${a.invoice.vendor}, ${a.invoice.currency} ${a.invoice.total}`, id: a.invoice.id } : { step: "invoice", text: "No invoice filed", id: null });
  s.push(a.decision ? { step: "decision", text: `${ACTION_WORDS[a.decision.action]}: ${a.decision.why}`, id: a.invoice?.doc_sha256 ?? null } : { step: "decision", text: "No decision yet", id: null });
  s.push(a.proposal ? { step: "signature", text: "Signed with your passkey over these exact terms", id: a.proposal.terms_sha256 } : { step: "signature", text: "Not signed", id: null });
  const st = a.pay?.settled ?? null;
  s.push(a.pay?.outcome === "paid" || a.pay?.outcome === "paid_once" ? { step: "payment", text: `Paid on the simulated bank (test money)${st?.transfer_status ? `, ${st.transfer_status}` : ""}`, id: a.pay.request_id ?? null } : { step: "payment", text: "Not paid", id: null });
  s.push(st ? { step: "booking", text: `Booked in Purser's ledger: ${st.ledger_entries} entries in all`, id: a.proposal?.id ?? null } : { step: "booking", text: "Not booked", id: null });
  s.push(st && st.vault_added.length ? { step: "archive", text: `Filed in the archive: ${st.vault_added.length} files`, id: st.vault_added.join(", ") } : { step: "archive", text: "Nothing filed yet", id: null });
  return s;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The seed's links: the same seed again, or a new one. A seed is a scenario's number, never anything about the visitor. */
export function seedLinks(seed: number, base = "/try"): { replay: string; another: string } {
  return { replay: `${base}#seed=${seed >>> 0}`, another: `${base}#seed=new` };
}

/** The card as HTML. The verify button runs END_CARD_VERIFY_JS in the page with what this browser kept. */
export function endCardHtml(a: { steps: Step[]; comparison: Comparison | null; seed: number | null }): string {
  const rows = a.steps.map((s) => `<li>${esc(s.text)}</li>`).join("");
  const ids = a.steps.map((s) => `<tr><th scope="row">${esc(s.step)}</th><td><code>${s.id ? esc(s.id) : "none"}</code></td></tr>`).join("");
  const cmp = a.comparison ? `<p class="expect">${esc(a.comparison.line)}${a.comparison.stayed ? ` <strong>${esc(a.comparison.stayed)}</strong>` : ""}</p>` : "";
  const seed = a.seed === null ? "" : (() => { const l = seedLinks(a.seed); return `<p class="seed">Scenario seed ${a.seed >>> 0}. <a href="${esc(l.replay)}">Replay this scenario</a> · <a href="${esc(l.another)}">Give me another scenario</a></p>`; })();
  return `<section class="end-card" aria-labelledby="end-h"><h2 id="end-h">What you just did</h2><ol>${rows}</ol>${cmp}
<button type="button" id="verify-yourself">Verify yourself</button><p id="verify-out" role="status"></p>
<details><summary>Ids</summary><table>${ids}</table></details>${seed}</section>`;
}

/**
 * The in-browser check, as plain JavaScript (no backticks and no "${"). It defines
 * verifyTermsSignature({ terms | canonical, assertion: { authenticatorData, clientDataJSON, signature } (base64url),
 * public_key: { spki } (base64url DER) | { kty: "EC", crv: "P-256", x, y } }) → Promise<{ ok, verdict, checks }>.
 * test/try-end-card.test.ts runs it in Node's WebCrypto against the engine's own signatures.
 */
export const END_CARD_VERIFY_JS = `
function ecB64u(s) { var b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function ecToB64u(u) { var s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); }
function ecHex(u) { return Array.from(u).map(function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
function ecCanon(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(ecCanon).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + ecCanon(v[k]); }).join(",") + "}";
  throw new Error("the terms carry a number; money in the terms is a decimal string");
}
function ecDerToRaw(d) {
  if (d.length < 8 || d[0] !== 0x30 || d[2] !== 0x02) return null;
  var rl = d[3], r = d.subarray(4, 4 + rl); if (d[4 + rl] !== 0x02) return null;
  var sl = d[5 + rl], s = d.subarray(6 + rl, 6 + rl + sl), out = new Uint8Array(64), ok = true;
  [r, s].forEach(function (x, i) { while (x.length > 32 && x[0] === 0) x = x.subarray(1); if (x.length > 32) ok = false; else out.set(x, i * 32 + 32 - x.length); });
  return ok ? out : null;
}
function verifyTermsSignature(input) {
  var checks = [], subtle = crypto.subtle;
  function add(check, ok, detail) { checks.push({ check: check, ok: ok, detail: detail }); return ok; }
  function done() { var ok = checks.length > 0 && checks.every(function (c) { return c.ok; }); return { ok: ok, verdict: ok ? ${JSON.stringify(END_VERDICT.ok)} : ${JSON.stringify(END_VERDICT.bad)}, checks: checks }; }
  var canonical;
  try { canonical = typeof input.canonical === "string" ? input.canonical : ecCanon(input.terms); } catch (e) { add("terms", false, String(e && e.message || e)); return Promise.resolve(done()); }
  var a = input.assertion || {}, pk = input.public_key || {}, authData, clientRaw, sig, client;
  try { authData = ecB64u(a.authenticatorData); clientRaw = ecB64u(a.clientDataJSON); sig = ecB64u(a.signature); client = JSON.parse(new TextDecoder().decode(clientRaw)); }
  catch (e) { add("assertion", false, "the signature could not be read"); return Promise.resolve(done()); }
  return subtle.digest("SHA-256", new TextEncoder().encode(canonical)).then(function (h) {
    var hash = new Uint8Array(h), hex = ecHex(hash);
    add("terms hash", true, "SHA-256 of these terms: " + hex);
    add("challenge", client.challenge === ecToB64u(hash), client.challenge === ecToB64u(hash) ? "the passkey signed this hash" : "the passkey signed another hash, not this one");
    add("assertion", client.type === "webauthn.get", client.type === "webauthn.get" ? "an assertion (webauthn.get)" : "not an assertion");
    var flags = authData.length > 32 ? authData[32] : 0;
    add("user verified", (flags & 0x05) === 0x05, (flags & 0x05) === 0x05 ? "user present and verified" : "no user verification");
    var importKey = pk.spki ? subtle.importKey("spki", ecB64u(pk.spki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
      : subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: pk.x, y: pk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return Promise.all([importKey, subtle.digest("SHA-256", clientRaw)]);
  }).then(function (x) {
    var key = x[0], cd = new Uint8Array(x[1]), signed = new Uint8Array(authData.length + cd.length), raw = ecDerToRaw(sig);
    signed.set(authData, 0); signed.set(cd, authData.length);
    if (!raw) { add("signature", false, "the signature is not ES256"); return done(); }
    return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signed).then(function (ok) { add("signature", ok, ok ? "ES256 signature verifies with your passkey's public key" : "the signature does not verify"); return done(); });
  }).catch(function () { add("signature", false, "the check could not run"); return done(); });
}
`;
