// A software passkey for browser checks in WebKit, where Playwright has no virtual authenticator (Chromium's checks use
// that one). TEST ONLY: it is injected by a check before the page loads and is never part of the site. It makes a real
// ES256 key with WebCrypto, answers navigator.credentials.create() with a "none" attestation (user present and verified
// flags set, as a device does after Face ID) and navigator.credentials.get() with a real signature over the
// authenticator data and the SHA-256 of the client data, its counter moving forward. The server checks both for real,
// as it checks a phone's: so the whole flow runs in WebKit, and every signature in it is verified by the server.
// It proves nothing about Face ID itself (no biometric is involved); that is what a person's device adds.

/** The script, as text: passed to page.addInitScript before /try/sign loads. */
export const SOFT_PASSKEY = `(() => {
  const enc = new TextEncoder();
  const b64u = (buf) => { const u = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf); let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const sha = async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const head = (major, n) => n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : [major << 5 | 25, n >> 8, n & 255];
  const cbor = (v) => {
    if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === "string") { const b = enc.encode(v); return [...head(3, b.length), ...b]; }
    if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
    if (v instanceof Map) { let out = head(5, v.size); for (const [k, x] of v) out = out.concat(cbor(k), cbor(x)); return out; }
    throw new Error("soft passkey: cannot encode");
  };
  // WebCrypto signs as r || s; WebAuthn carries an ASN.1 DER sequence of the two integers.
  const der = (raw) => {
    const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) b = Uint8Array.of(0, ...b); return [0x02, b.length, ...b]; };
    const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
    return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
  };
  let key = null, id = null, counter = 0;
  const clientData = (type, challenge) => enc.encode(JSON.stringify({ type, challenge: b64u(challenge), origin: location.origin, crossOrigin: false }));
  const authData = async (flags, extra) => {
    counter++;
    return new Uint8Array([...(await sha(enc.encode(location.hostname))), flags, (counter >>> 24) & 255, (counter >> 16) & 255, (counter >> 8) & 255, counter & 255, ...(extra || [])]);
  };
  const credentials = {
    async create({ publicKey }) {
      key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
      id = crypto.getRandomValues(new Uint8Array(16));
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]);
      const attested = [...new Uint8Array(16), 0, id.length, ...id, ...cbor(cose)];
      const att = new Uint8Array(cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", await authData(0x45, attested)]])));
      return { id: b64u(id), rawId: id.buffer, type: "public-key", response: { clientDataJSON: clientData("webauthn.create", publicKey.challenge).buffer, attestationObject: att.buffer } };
    },
    async get({ publicKey }) {
      if (!key) throw Object.assign(new Error("no passkey"), { name: "NotAllowedError" });
      const cd = clientData("webauthn.get", publicKey.challenge);
      const ad = await authData(0x05);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new Uint8Array([...ad, ...(await sha(cd))])));
      return { id: b64u(id), rawId: id.buffer, type: "public-key", response: { clientDataJSON: cd.buffer, authenticatorData: ad.buffer, signature: der(sig).buffer } };
    },
  };
  if (!window.PublicKeyCredential) window.PublicKeyCredential = function PublicKeyCredential() {};
  Object.defineProperty(navigator, "credentials", { value: credentials, configurable: true });
  window.__softPasskeyCount = () => counter;
})();`;
