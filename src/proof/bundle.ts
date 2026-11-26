// "Verify it yourself" (15 Nov): the proof bundle of one /try payment, and the checks anyone can run on it without
// trusting our server. One JSON file holds the canonical signed terms and their SHA-256, the WebAuthn assertion
// (authenticatorData, clientDataJSON, signature), the passkey's public key (COSE) and the rpId, the engine's decision,
// the ledger entries the payment touched with the chain head, and, for a refusal, the terms that were asked and their
// hash. Nothing secret: a public key, a signature, a test company's terms (test money only), no name or e-mail.
//
// The checks are one piece of plain JavaScript (PROOF_VERIFY_JS) that uses only WebCrypto, TextEncoder and atob/btoa,
// which a browser and Node 22 both have. The /verify page places that text in its script; `npm run verify-bundle`
// runs the very same text in Node (verifyProofBundle below). So the page and the command line are one code path.

/** The bundle's format name. */
export const PROOF_FORMAT = "purser.proof-bundle/v1";

/**
 * The two committed samples (docs/proof/, from the deployed /try), served byte for byte as downloads under
 * PROOF_SAMPLE_DIR on the site, so a visitor without a file of their own has one to drop on /verify.
 */
export const PROOF_SAMPLES = { paid: "try-paid.json", refused: "try-refused.json" } as const;
export const PROOF_SAMPLE_DIR = "/verify/samples/";
export const proofSamplePath = (which: keyof typeof PROOF_SAMPLES): string => `${PROOF_SAMPLE_DIR}${PROOF_SAMPLES[which]}`;

/** The bundle's file name as /try offers it. */
export const PROOF_FILE = "purser-proof.json";

/** What a valid bundle proves, and what it does not, word for word on /verify and in the command line. */
export const PROOF_MEANS = [
  "Proves: the holder of this public key signed exactly these terms, with user verification, for this site (its rpId).",
  "A refusal: the terms that were asked hash differently, so this signature cannot cover them.",
  "Does not prove: who holds the key, or that it was Face ID (no attestation is checked). A test company: test money only.",
  "The decision and the ledger entries are the engine's record beside the signature: checked against the signed terms and their own hashes, not signed.",
] as const;
/** The line of PROOF_MEANS that only a refusal's bundle (one with asked terms) bears out. */
export const PROOF_REFUSAL_MEANS = PROOF_MEANS[1];
/** What a valid bundle proves, for this bundle: the refusal line only when it carries the asked terms. */
export function proofMeans(bundle: unknown): string[] {
  const refusal = typeof bundle === "object" && bundle !== null && (bundle as { asked?: unknown }).asked !== undefined;
  return PROOF_MEANS.filter((l) => refusal || l !== PROOF_REFUSAL_MEANS);
}

/** One WebAuthn assertion, base64url, as a browser hands it over. */
export interface ProofAssertion { credential_id: string; authenticatorData: string; clientDataJSON: string; signature: string }

/** A ledger entry as the engine hashes it (src/ledger/core.ts): its hash covers the one before. */
export interface ProofLedgerEntry {
  entry_id: number; posting_date: string; doc_date: string; description: string; source_key: string | null; doc_ref: string | null;
  doc_sha256: string | null; created_by: string; reverses: number | null; created_at: string; prev_hash: string; entry_hash: string;
  approval_sha256?: string; rail_ref?: string;
  lines: { line_no: number; account: string; debit_cents: number; credit_cents: number; currency: string; cost_centre: string | null; vat_code: string | null; vat_cents: number | null; party: string | null; due_date: string | null; doc_ref: string | null; memo: string | null }[];
}

export interface ProofBundle {
  format: typeof PROOF_FORMAT;
  note: string;
  made_at: string;
  proposal_id: string;
  /** The terms the passkey signed, their canonical JSON (RFC 8785) and its SHA-256: the signature's challenge. */
  terms: Record<string, unknown>;
  canonical: string;
  terms_sha256: string;
  rp_id: string;
  origin: string;
  assertion: ProofAssertion;
  /** The passkey's public key as stored at enrolment: COSE, base64url. alg -7 is ES256 (P-256), -257 is RS256. */
  public_key: { format: "cose"; cose: string; alg: number | null };
  /** What the engine decided, in its own words. */
  decision: {
    outcome: string;
    signature: { verified: boolean | null; reason: string };
    executor: { accepted: boolean | null; said: string | null };
    signed_sha256: string; sent_sha256: string; changed: string[]; transfers_before: number; transfers_after: number;
  };
  /** A refusal only: the terms that were asked, and their hash. */
  asked?: { terms: Record<string, unknown>; canonical: string; sha256: string };
  /**
   * A negotiated payment only (15 Nov): what the agents agreed, as the engine recorded it when the agreed invoice was
   * filed. Context beside the signed terms, not part of them: the signed terms carry the agreed amount and the agreement's
   * reference (its SHA-256's first 8 characters), which is how they name it.
   */
  negotiation?: {
    original_invoice_id: string | null; original_invoice_no: string; original_amount: string; agreed_amount: string; discount: string; currency: string; agreement_sha256: string; turns: number; superseded: boolean;
    /** Since 26 Nov: the agreement's canonical JSON (SHA-256 = agreement_sha256), each signed offer's SHA-256 in order (the last is the agreement's transcript_sha256), the agents' key ids. */
    agreement?: string; offers?: string[]; keys?: { sourcing: string; supplier: string };
  };
  /** The ledger entries of this payment's invoice, and the whole ledger's head (the last entry's hash) and length. */
  ledger: { entries: ProofLedgerEntry[]; head: string | null; count: number };
}

export interface ProofCheck { check: string; ok: boolean; detail: string }
export interface ProofResult { ok: boolean; checks: ProofCheck[] }

/**
 * The checks, in plain JavaScript (no backticks, no "${"): it defines verifyProofBundle(bundle) → Promise<{ ok, checks:
 * [{ check, ok, detail }] }>. Each detail names the actual values, so a reader sees what was compared.
 */
export const PROOF_VERIFY_JS = String.raw`
var PROOF_FORMAT = "purser.proof-bundle/v1";
function pvIsObj(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
// Base64url to bytes, or null when it cannot be decoded (a length of 4n+1 has no bytes): never throws.
function pvB64u(s) { var t = String(s), b; if (t.length % 4 === 1) return null; try { b = atob(t.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((t.length + 3) % 4)); } catch (e) { return null; } var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function pvToB64u(u) { var s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function pvHex(u) { var s = ""; for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? "0" : "") + u[i].toString(16); return s; }
function pvUtf8(s) { return new TextEncoder().encode(s); }
function pvSha(u) { return crypto.subtle.digest("SHA-256", u).then(function (d) { return new Uint8Array(d); }); }
function pvShaHex(s) { return pvSha(pvUtf8(s)).then(pvHex); }
function pvShort(h) { return typeof h === "string" && h.length > 16 ? h.slice(0, 12) + "…" + h.slice(-4) : String(h); }
// RFC 8785 (JCS) for what the terms and the ledger hold: strings, whole numbers, booleans, null, arrays, objects.
function pvJcs(v) {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isInteger(v)) throw new Error("a number that is not whole: " + v); return JSON.stringify(v); }
  if (Array.isArray(v)) return "[" + v.map(pvJcs).join(",") + "]";
  if (pvIsObj(v)) return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ":" + pvJcs(v[k]); }).join(",") + "}";
  throw new Error("a value JSON does not have");
}
// The signed terms carry no numbers at all (money is a decimal string), as src/lib/terms.ts insists.
function pvNoNumbers(v) { if (typeof v === "number") return false; if (Array.isArray(v)) return v.every(pvNoNumbers); if (pvIsObj(v)) return Object.keys(v).every(function (k) { return pvNoNumbers(v[k]); }); return true; }
// A small CBOR reader for a COSE key (a map of small integers to integers and byte strings).
function pvCbor(u) {
  var i = 0;
  function len(ai) { if (ai < 24) return ai; if (ai === 24) return u[i++]; if (ai === 25) { var a = (u[i] << 8) | u[i + 1]; i += 2; return a; } if (ai === 26) { var b = ((u[i] << 24) >>> 0) + ((u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]); i += 4; return b; } throw new Error("CBOR length"); }
  function item() {
    if (i >= u.length) throw new Error("CBOR ends early");
    var b = u[i++], major = b >> 5, n = len(b & 31);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) { var bytes = u.slice(i, i + n); i += n; return bytes; }
    if (major === 3) { var t = new TextDecoder().decode(u.slice(i, i + n)); i += n; return t; }
    if (major === 4) { var arr = []; for (var k = 0; k < n; k++) arr.push(item()); return arr; }
    if (major === 5) { var m = new Map(); for (var j = 0; j < n; j++) { var key = item(); m.set(key, item()); } return m; }
    throw new Error("CBOR type " + major);
  }
  return item();
}
// COSE to WebCrypto: EC2 P-256 (alg -7) or RSA (alg -257).
function pvKey(cose) {
  var m = pvCbor(cose);
  if (!(m instanceof Map)) return Promise.reject(new Error("the public key is not a COSE map"));
  var kty = m.get(1), alg = m.get(3);
  if (kty === 2 && m.get(-1) === 1 && (alg === -7 || alg === undefined)) {
    var jwk = { kty: "EC", crv: "P-256", x: pvToB64u(m.get(-2)), y: pvToB64u(m.get(-3)), ext: true };
    return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]).then(function (k) { return { key: k, alg: "ES256", params: { name: "ECDSA", hash: "SHA-256" } }; });
  }
  if (kty === 3 && (alg === -257 || alg === undefined)) {
    var rj = { kty: "RSA", n: pvToB64u(m.get(-1)), e: pvToB64u(m.get(-2)), alg: "RS256", ext: true };
    return crypto.subtle.importKey("jwk", rj, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]).then(function (k) { return { key: k, alg: "RS256", params: { name: "RSASSA-PKCS1-v1_5" } }; });
  }
  return Promise.reject(new Error("a key type this check does not know (kty " + kty + ", alg " + alg + "); ES256 and RS256 are known"));
}
// A WebAuthn ES256 signature is DER (a SEQUENCE of two INTEGERs); WebCrypto takes r and s, 32 bytes each.
function pvDerToRaw(d) {
  if (d.length < 8 || d[0] !== 0x30 || d[1] !== d.length - 2 || d[2] !== 0x02) return null;
  var rl = d[3], r = d.subarray(4, 4 + rl);
  if (d[4 + rl] !== 0x02) return null;
  var sl = d[5 + rl], s = d.subarray(6 + rl, 6 + rl + sl);
  if (6 + rl + sl !== d.length) return null;
  var out = new Uint8Array(64), ok = true;
  [r, s].forEach(function (x, k) { while (x.length > 32 && x[0] === 0) x = x.subarray(1); if (x.length > 32) ok = false; else out.set(x, k * 32 + 32 - x.length); });
  return ok ? out : null;
}
// "1850.00" as cents, or null for anything else.
function pvCents(s) { var m = /^(\d+)\.(\d{2})$/.exec(String(s)); return m ? Number(m[1]) * 100 + Number(m[2]) : null; }
function pvMoney(c) { var n = Math.abs(c); return (c < 0 ? "-" : "") + Math.floor(n / 100) + "." + String(n % 100).padStart(2, "0"); }

// Anything at all is answered with checks, never a throw: a failure while reading the file is a failed check.
function verifyProofBundle(b) {
  try { return pvVerify(b); } catch (e) { return Promise.resolve({ ok: false, checks: [{ check: "error", ok: false, detail: e && typeof e.message === "string" ? e.message : "the file could not be read" }] }); }
}
function pvVerify(b) {
  var checks = [];
  function add(check, ok, detail) { checks.push({ check: check, ok: !!ok, detail: detail }); return !!ok; }
  function done() { return { ok: checks.length > 0 && checks.every(function (c) { return c.ok; }), checks: checks }; }
  var B64 = /^[A-Za-z0-9_-]+$/, HEX = /^[0-9a-f]{64}$/;
  var a = pvIsObj(b) ? b.assertion : null, pk = pvIsObj(b) ? b.public_key : null;
  var shaped = pvIsObj(b) && b.format === PROOF_FORMAT && pvIsObj(b.terms) && typeof b.terms_sha256 === "string" && HEX.test(b.terms_sha256)
    && typeof b.rp_id === "string" && b.rp_id.length > 0 && typeof b.origin === "string" && pvIsObj(a)
    && [a.authenticatorData, a.clientDataJSON, a.signature].every(function (x) { return typeof x === "string" && B64.test(x); })
    && pvIsObj(pk) && typeof pk.cose === "string" && B64.test(pk.cose) && pvIsObj(b.decision) && pvIsObj(b.ledger) && Array.isArray(b.ledger.entries);
  // Each base64url field decoded once, here: one that cannot be decoded fails the format check, naming it.
  var ad = shaped ? pvB64u(a.authenticatorData) : null, cdj = shaped ? pvB64u(a.clientDataJSON) : null, sig = shaped ? pvB64u(a.signature) : null, cose = shaped ? pvB64u(pk.cose) : null;
  var undecoded = shaped ? [["assertion.authenticatorData", ad], ["assertion.clientDataJSON", cdj], ["assertion.signature", sig], ["public_key.cose", cose]].filter(function (f) { return f[1] === null; }).map(function (f) { return f[0]; }) : [];
  if (!add("format", shaped && undecoded.length === 0, !shaped ? "not a " + PROOF_FORMAT + " file (a field is missing or of the wrong type)"
    : undecoded.length ? undecoded.join(", ") + (undecoded.length > 1 ? " are" : " is") + " not base64url" : PROOF_FORMAT + ", proposal " + String(b.proposal_id))) return Promise.resolve(done());

  var canonical, cd;
  try { canonical = pvNoNumbers(b.terms) ? pvJcs(b.terms) : null; } catch (e) { canonical = null; }
  try { cd = JSON.parse(new TextDecoder().decode(cdj)); } catch (e) { cd = null; }

  return Promise.resolve().then(function () {
    // 1. The terms hash: recomputed here from the terms, never taken from the file.
    if (canonical === null) { add("terms hash", false, "the terms carry a number or another value signed terms never have"); return null; }
    return pvShaHex(canonical).then(function (h) {
      var same = b.canonical === canonical;
      add("terms hash", h === b.terms_sha256 && same, h === b.terms_sha256
        ? (same ? "SHA-256 of the canonical terms is " + h + ", as the file says" : "the file's canonical text is not the terms' canonical JSON")
        : "SHA-256 of the canonical terms is " + h + ", the file says " + b.terms_sha256);
      return h;
    });
  }).then(function (h) {
    // 2. The challenge the passkey signed is that hash (its 32 raw bytes, base64url), in an assertion for this origin.
    var chb = pvIsObj(cd) && typeof cd.challenge === "string" && B64.test(cd.challenge) ? pvB64u(cd.challenge) : null, ch = chb ? pvHex(chb) : null;
    add("challenge", ch !== null && h !== null && ch === h, ch === null ? "the client data carries no challenge" : "clientDataJSON.challenge is " + ch + (h !== null && ch === h ? ", the terms hash" : ", not the terms hash " + String(h)));
    var typeOk = pvIsObj(cd) && cd.type === "webauthn.get", originOk = pvIsObj(cd) && cd.origin === b.origin, framed = pvIsObj(cd) && cd.crossOrigin === true;
    add("client data", typeOk && originOk && !framed, pvIsObj(cd) ? "type " + String(cd.type) + ", origin " + String(cd.origin) + (originOk ? "" : " (the file says " + b.origin + ")") + (framed ? ", inside a frame on another site" : "") : "clientDataJSON is not JSON");
    // 3. The authenticator data: its first 32 bytes are SHA-256 of the rpId; the flags say user present and verified.
    return pvShaHex(b.rp_id).then(function (rph) {
      var got = ad.length >= 37 ? pvHex(ad.slice(0, 32)) : null;
      add("rp id", got === rph, got === null ? "the authenticator data is too short" : "rpIdHash " + pvShort(got) + (got === rph ? " = SHA-256(\"" + b.rp_id + "\")" : ", SHA-256(\"" + b.rp_id + "\") is " + pvShort(rph)));
      var flags = ad.length >= 37 ? ad[32] : 0, up = (flags & 1) === 1, uv = (flags & 4) === 4;
      add("user verified", up && uv, "flags 0x" + (flags < 16 ? "0" : "") + flags.toString(16) + ": user present " + (up ? "yes" : "no") + ", user verified " + (uv ? "yes" : "no"));
      return h;
    });
  }).then(function (h) {
    // 4. The signature over authenticatorData followed by SHA-256(clientDataJSON), with the public key.
    return pvSha(cdj).then(function (cdh) {
      var signed = new Uint8Array(ad.length + 32); signed.set(ad, 0); signed.set(cdh, ad.length);
      return pvKey(cose).then(function (k) {
        var s = k.alg === "ES256" ? pvDerToRaw(sig) : sig;
        if (!s) { add("signature", false, "the " + k.alg + " signature is not DER"); return h; }
        return crypto.subtle.verify(k.params, k.key, s, signed).then(function (ok) {
          add("signature", ok, k.alg + " " + (ok ? "verifies" : "does not verify") + " over authenticatorData + SHA-256(clientDataJSON) (" + pvShort(pvHex(cdh)) + ") with the public key");
          return h;
        });
      }, function (e) { add("signature", false, e.message); return h; });
    });
  }).then(function (h) {
    // 5. The engine's decision, each field against what it must equal (fuzzing, 19 Nov: an edited copy showed it
    // passing). The engine makes a bundle only for a payment (paid) or a refusal (refused). It names the signed hash.
    // What was sent is the signed terms, or for a refusal the asked terms (hashed here). A signature over other terms is
    // never verified, and the executor never accepts them (it checks the approved hash). A payment made a transfer, a
    // refusal none, and "changed" lists the fields where the asked terms differ.
    var x = b.asked, xc = null;
    if (x !== undefined) { try { xc = pvIsObj(x) && pvIsObj(x.terms) && pvNoNumbers(x.terms) ? pvJcs(x.terms) : null; } catch (e) { xc = null; } }
    return (xc === null ? Promise.resolve(null) : pvShaHex(xc)).then(function (xh) {
      var d = b.decision, o = d.outcome, v = pvIsObj(d.signature) ? d.signature.verified : undefined, acc = pvIsObj(d.executor) ? d.executor.accepted : undefined;
      var named = d.signed_sha256 === h, paid = o === "paid";
      var sentWant = x === undefined ? h : xh, sentOk = typeof d.sent_sha256 === "string" && d.sent_sha256 === sentWant, other = d.sent_sha256 !== h;
      var moved = Number.isInteger(d.transfers_before) && Number.isInteger(d.transfers_after) ? d.transfers_after - d.transfers_before : null;
      var want = x === undefined ? [] : xc !== null ? Object.keys(b.terms).filter(function (k) { return JSON.stringify(b.terms[k]) !== JSON.stringify(x.terms[k]); }) : null;
      var changedOk = Array.isArray(d.changed) && want !== null && JSON.stringify(d.changed.slice().sort()) === JSON.stringify(want.slice().sort());
      var why = o !== "paid" && o !== "refused" ? "an outcome a bundle never has (the engine makes one only for paid and refused)"
        : !named ? "it does not name the signed hash"
        : !sentOk ? "what was sent is not " + (x === undefined ? "the signed terms" : "the asked terms") + " (" + pvShort(sentWant) + ")"
        : typeof v !== "boolean" || typeof acc !== "boolean" ? "the signature's and the executor's answers are not true or false"
        : paid ? (x !== undefined ? "a payment with asked terms" : !(v === true && acc === true) ? "a payment needs a verified signature the executor accepted" : !(moved !== null && moved > 0) ? "a payment that made no transfer" : null)
        : v && acc ? "a refusal both checks passed" : other && (v || acc) ? "terms other than the signed ones verified or accepted" : moved !== 0 ? "a refusal that moved money" : null;
      if (!why && !changedOk) why = "the changed fields are not the ones that differ";
      add("decision", !why, String(o) + "; signed " + pvShort(d.signed_sha256) + ", sent " + pvShort(d.sent_sha256) + "; signature " + String(v) + ", executor " + String(acc) + "; transfers " + d.transfers_before + " → " + d.transfers_after + (why ? ": " + why : ""));
      // 6. A refusal: the asked terms hash differently, so the signature (whose challenge is the signed hash) cannot cover them.
      if (x === undefined) return h;
      if (xc === null) { add("asked terms", false, "the asked terms are missing or not terms"); return h; }
      if (x.canonical !== xc) { add("asked terms", false, "the file's canonical text of the asked terms is not their canonical JSON"); return h; }
      var diff = Object.keys(x.terms).concat(Object.keys(b.terms)).filter(function (k, i, all) { return all.indexOf(k) === i && JSON.stringify(x.terms[k]) !== JSON.stringify(b.terms[k]); });
      var shown = diff.map(function (k) { return k + " " + JSON.stringify(b.terms[k]) + " → " + JSON.stringify(x.terms[k]); }).join(", ");
      add("asked terms", xh === x.sha256 && xh !== h, (xh === x.sha256 ? "SHA-256 " + xh : "SHA-256 is " + xh + ", the file says " + String(x.sha256)) + (xh !== h ? ", not the signed " + pvShort(h) + (shown ? " (" + shown + ")" : "") + ": this signature cannot cover them" : ": the same as the signed terms"));
      return h;
    });
  }).then(function (h) {
    // 7. The ledger: every entry's lines balance per currency, its hash covers its body and the one before.
    var es = b.ledger.entries, bad = null, i = 0, sums = [];
    es.forEach(function (e) {
      var by = {};
      (Array.isArray(e.lines) ? e.lines : []).forEach(function (l) { by[l.currency] = (by[l.currency] || 0) + (l.debit_cents | 0) - (l.credit_cents | 0); });
      var off = Object.keys(by).filter(function (c) { return by[c] !== 0; });
      var dr = (e.lines || []).reduce(function (s, l) { return s + (l.debit_cents | 0); }, 0);
      sums.push("entry " + e.entry_id + " " + pvMoney(dr) + " = " + pvMoney(dr - off.reduce(function (s, c) { return s + by[c]; }, 0)));
      if (!bad && ((e.lines || []).length < 2 || off.length)) bad = "entry " + e.entry_id + " does not balance (" + off.map(function (c) { return c + " " + pvMoney(by[c]); }).join(", ") + ")";
    });
    // A refusal books nothing: no entry of this invoice may be the true answer then; a payment must have its entries.
    var none = es.length === 0, mayBeNone = String(b.decision.outcome) === "refused";
    if (none) {
      add("ledger balance", mayBeNone, mayBeNone ? "nothing was booked for this invoice: the refusal moved no money" : "a payment with no ledger entry");
      add("ledger chain", mayBeNone && (b.ledger.head === null || HEX.test(String(b.ledger.head))) && Number.isInteger(b.ledger.count) && b.ledger.count >= 0, "ledger head " + pvShort(b.ledger.head) + " of " + b.ledger.count + " entries; none is this invoice's");
      if (b.decision.outcome === "paid") add("ledger payment", false, "a payment with no ledger entry");
      return done();
    }
    add("ledger balance", !bad, bad || es.length + " entries, debits equal credits: " + sums.join("; "));
    // The numbers, the count and the head (fuzzing, 19 Nov: an edited head or count, or a dropped entry, still passed).
    // Entry numbers rise and none is past the count; the head is the hash of entry #count when the file holds it, and of
    // no other entry here. The file holds the entries the engine chose: one it leaves out cannot be seen, and is said.
    var L = b.ledger, ids = es.map(function (e) { return e.entry_id; }), last = ids[ids.length - 1];
    var shape = !Number.isInteger(L.count) || L.count < 1 ? "the ledger's count " + String(L.count) + " is not a number of entries"
      : !HEX.test(String(L.head)) ? "the ledger's head is not a SHA-256"
      : ids.some(function (n, k) { return !Number.isInteger(n) || n < 1 || (k > 0 && n <= ids[k - 1]); }) ? "the entry numbers do not rise"
      : last > L.count ? "entry #" + last + " is past the ledger's count, " + L.count : null;
    var atCount = es.filter(function (e) { return e.entry_id === L.count; })[0], atHead = es.filter(function (e) { return e.entry_hash === L.head; })[0];
    if (!shape && atCount && atCount.entry_hash !== L.head) shape = "the head " + pvShort(L.head) + " is not the hash of entry #" + L.count + ", the last of " + L.count;
    if (!shape && atHead && atHead.entry_id !== L.count) shape = "the head is the hash of entry #" + atHead.entry_id + ", not of the last, #" + L.count;
    function next() {
      if (i >= es.length) return Promise.resolve(null);
      var e = es[i++], body = {};
      Object.keys(e).forEach(function (k) { if (k !== "entry_hash" && k !== "prev_hash") body[k] = e[k]; });
      var text;
      try { text = String(e.prev_hash) + pvJcs(body); } catch (err) { return Promise.resolve("entry " + e.entry_id + ": " + err.message); }
      return pvShaHex(text).then(function (got) {
        if (got !== e.entry_hash) return "entry " + e.entry_id + " hashes to " + pvShort(got) + ", it says " + pvShort(e.entry_hash);
        var prev = es[i - 2];
        if (prev && prev.entry_id + 1 === e.entry_id && e.prev_hash !== prev.entry_hash) return "entry " + e.entry_id + " does not cover entry " + prev.entry_id;
        return next();
      });
    }
    return next().then(function (why) {
      why = why || shape;
      var gaps = [], from = 1;
      ids.concat([L.count + 1]).forEach(function (n) { if (n > from) gaps.push(n - 1 > from ? "#" + from + "–#" + (n - 1) : "#" + from); from = n + 1; });
      add("ledger chain", !why, why || es.length + " entries (" + ids.map(function (n) { return "#" + n; }).join(", ") + ") hash as posted, each covering the one before where they follow on; the head " + pvShort(L.head)
        + (atCount ? " is entry #" + L.count + " of " + L.count : " of " + L.count + " entries is not among these")
        + (gaps.length ? "; not in this file: " + gaps.join(", ") + " (that it holds all of this payment's entries is the engine's record, not checked here)" : ""));
      // 8. A payment: its own entries, as the signed terms name them, are in the file: the transfer of the signed amount
      // under the signed transfer_request_id, the invoice by its signed number, and a conversion's two legs.
      if (b.decision.outcome !== "paid") return done();
      var t = b.terms, amt = pvCents(t.amount), conv = pvIsObj(t.conversion) ? t.conversion : null;
      var key = function (e) { return typeof e.source_key === "string" ? e.source_key : ""; };
      var has = function (e, cur, side, c) { return c !== null && (Array.isArray(e.lines) ? e.lines : []).some(function (l) { return l.currency === cur && l[side] === c; }); };
      var tr = es.filter(function (e) { return typeof t.transfer_request_id === "string" && key(e).indexOf("transfer|" + t.transfer_request_id + "|") === 0 && has(e, t.currency, "debit_cents", amt); })[0];
      var inv = es.filter(function (e) { return key(e).indexOf("ap-") === 0 && e.doc_ref === t.invoice_no && has(e, t.currency, "credit_cents", amt); })[0];
      var sell = conv ? es.filter(function (e) { return key(e).indexOf("fx|") === 0 && has(e, conv.sell_currency, "credit_cents", pvCents(conv.sell_amount)); })[0] : null;
      var buy = sell ? es.filter(function (e) { return key(e).split("|")[1] === key(sell).split("|")[1] && key(e).indexOf("fx|") === 0 && has(e, conv.buy_currency, "debit_cents", pvCents(conv.buy_amount)); })[0] : null;
      var lacks = (tr ? [] : ["the signed transfer"]).concat(inv ? [] : ["the invoice"]).concat(!conv || buy ? [] : ["the conversion"]);
      add("ledger payment", lacks.length === 0, lacks.length ? lacks.join(", ") + (lacks.length > 1 ? " are" : " is") + " not booked in these entries"
        : "the signed transfer of " + t.currency + " " + t.amount + " (" + pvShort(t.transfer_request_id) + ") in #" + tr.entry_id + "; the invoice " + t.invoice_no + " in #" + inv.entry_id
          + (conv ? "; the conversion " + conv.sell_currency + " " + conv.sell_amount + " → " + conv.buy_currency + " " + conv.buy_amount + " in #" + sell.entry_id + " and #" + buy.entry_id : ""));
      return done();
    });
  }).catch(function (e) { add("error", false, e && e.message ? e.message : String(e)); return done(); });
}
`;

/** The same text as /verify runs, run here: Node 22 has WebCrypto, TextEncoder and atob as a browser does. */
export function verifyProofBundle(bundle: unknown): Promise<ProofResult> {
  const fn = new Function(`${PROOF_VERIFY_JS}\nreturn verifyProofBundle;`)() as (b: unknown) => Promise<ProofResult>;
  return fn(bundle);
}
