// D25, our merchant layer behind Visa's reference proxy: it re-verifies signature 1 itself (as the proxy reads it) and
// signature 2, against keys from our own pinned tap_agents list (never Visa's registry), checks the tag, the window,
// the authority and checkout path it is configured with, the body against Content-Digest, and stores the nonce per key
// only after everything passed. Red team: every request below the first must be refused, each with its reason.
import { sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { registerAgent, revokeAgent } from "../src/visa/tap.js";
import { rawHeadersOf, tapMerchantConfig, verifyTapCheckout, type ReceivedCheckout } from "../src/visa/tapMerchant.js";
import {
  ed25519FromSeed, sig2Base, sig2ParamsText, signTapCheckout, signTapCheckoutUnchecked, TAP_CLOCK_SKEW_S, type TapHeaders, type TapSignOptions,
} from "../src/visa/tapSig.js";

const AUTHORITY = "localhost:3001";
const CHECKOUT = "/product/checkout";
const cfg = tapMerchantConfig({ authority: AUTHORITY, checkoutPath: CHECKOUT });
const NOW = 1_800_000_000;
const BODY = '{"plan":"packwise-starter"}';
const ops = { agent: "sourcing", keyId: "sourcing-test-key-1", ...ed25519FromSeed(Buffer.alloc(32, 1)) };
const other = { agent: "support", keyId: "support-test-key-1", ...ed25519FromSeed(Buffer.alloc(32, 2)) };
const stranger = { agent: "stranger", keyId: "stranger-key-1", ...ed25519FromSeed(Buffer.alloc(32, 3)) };
let db: DB;
let n = 0;

const pin = (k: typeof ops, domains = [AUTHORITY], notAfter = NOW + 86_400) =>
  registerAgent(db, { agent: k.agent, keyid: k.keyId, publicJwk: k.publicKey.export({ format: "jwk" }), domains, notAfter });

beforeEach(() => {
  db = openDb(":memory:");
  pin(ops);
  pin(other);
});

type Opts = Partial<TapSignOptions> & { k?: typeof ops; unchecked?: boolean };
const headersFor = (o: Opts = {}): TapHeaders => {
  const k = o.k ?? ops;
  const opts: TapSignOptions = { authority: AUTHORITY, target: CHECKOUT, method: "POST", body: BODY, keyId: k.keyId, privateKey: k.privateKey, created: NOW, nonce: `nonce-${String(++n).padStart(16, "0")}`, tag: "agent-payer-auth", ...o };
  return o.unchecked ? signTapCheckoutUnchecked(opts) : signTapCheckout(opts);
};
/** What the merchant received behind the proxy: the proxy rewrote Host (changeOrigin), the rest as sent. */
const received = (h: TapHeaders, o: { target?: string; body?: string; method?: string; extra?: [string, string][] } = {}): ReceivedCheckout => ({
  method: o.method ?? "POST",
  target: o.target ?? CHECKOUT,
  rawHeaders: [...rawHeadersOf({ host: "localhost:3000", "content-type": "application/json", ...h }), ...(o.extra ?? []).flat()],
  body: Buffer.from(o.body ?? BODY),
});
const check = (r: ReceivedCheckout, now = NOW + 5) => verifyTapCheckout(db, r, cfg, now);
const refused = (why: RegExp) => ({ ok: false, reason: expect.stringMatching(why) });

describe("a signed checkout from a pinned agent", () => {
  it("is accepted once, with both signatures verified, naming the agent, key and nonce", () => {
    const h = headersFor();
    const v = check(received(h));
    expect(v).toMatchObject({ ok: true, agent: "sourcing", keyId: ops.keyId, sig1: "verified", sig2: "verified", created: NOW, expires: NOW + 300 });
    expect(db.prepare("SELECT keyid, nonce FROM tap_rail_nonces").all()).toEqual([{ keyid: ops.keyId, nonce: v.ok ? v.nonce : "" }]);
  });
  it("checks @authority against its configured public authority, not the Host the proxy rewrote", () => {
    expect(check(received(headersFor()))).toMatchObject({ ok: true });
  });
  it("refuses to be configured on a checkout the proxy does not check (outside /product/)", () => {
    expect(() => tapMerchantConfig({ authority: AUTHORITY, checkoutPath: "/checkout" })).toThrow(/\/product\//);
  });
});

describe("red team: the merchant refuses", () => {
  it("a replay of an accepted request", () => {
    const h = headersFor();
    expect(check(received(h)).ok).toBe(true);
    expect(check(received(h))).toMatchObject(refused(/replay/));
  });
  it("an expired request, and one from the future", () => {
    expect(check(received(headersFor()), NOW + 300 + TAP_CLOCK_SKEW_S + 1)).toMatchObject(refused(/expired/));
    expect(check(received(headersFor({ created: NOW + 600 })))).toMatchObject(refused(/future/));
  });
  it("a window over 8 minutes (which the proxy itself lets through)", () => {
    expect(check(received(headersFor({ expiresIn: 600, unchecked: true })))).toMatchObject(refused(/window of 600 s/));
  });
  it("a browsing tag on checkout (the proxy does not check tags)", () => {
    expect(check(received(headersFor({ tag: "agent-browser-auth" })))).toMatchObject(refused(/wrong tag agent-browser-auth/));
  });
  it("a request signed for another domain, and a key not pinned for this one", () => {
    expect(check(received(headersFor({ authority: "other.example" })))).toMatchObject(refused(/signature 1 does not verify/));
    db.prepare("DELETE FROM tap_agents WHERE keyid = ?").run(ops.keyId);
    pin(ops, ["other.example"]);
    expect(check(received(headersFor()))).toMatchObject(refused(/not pinned for localhost:3001/));
  });
  it("another path, also one the proxy never checks", () => {
    expect(check(received(headersFor({ target: "/product/other" }), { target: "/product/other" }))).toMatchObject(refused(/not this merchant's checkout/));
    expect(check(received(headersFor(), { target: "/product/other" }))).toMatchObject(refused(/not this merchant's checkout/));
    expect(check(received(headersFor({ target: "/checkout" }), { target: "/checkout" }))).toMatchObject(refused(/not this merchant's checkout/));
  });
  it("a query appended, even one signed (the proxy's @path keeps it)", () => {
    expect(check(received(headersFor({ target: `${CHECKOUT}?coupon=1` }), { target: `${CHECKOUT}?coupon=1` }))).toMatchObject(refused(/query/));
    expect(check(received(headersFor(), { target: `${CHECKOUT}?coupon=1` }))).toMatchObject(refused(/query/));
  });
  it("an unknown key, even one Visa's registry might hold (we only trust our pinned list)", () => {
    expect(check(received(headersFor({ k: stranger })))).toMatchObject(refused(/unknown key/));
  });
  it("a revoked key, and one past its end date", () => {
    revokeAgent(db, ops.keyId, new Date());
    expect(check(received(headersFor()))).toMatchObject(refused(/revoked/));
    pin(other, [AUTHORITY], NOW - 1);
    expect(check(received(headersFor({ k: other })))).toMatchObject(refused(/end date/));
  });
  it("signature 1's keyId and signature 2's keyid differing (even in case)", () => {
    const h = headersFor();
    // Signature 2 re-made by the other pinned agent, naming its own key, over this same request.
    const p2 = sig2ParamsText({ created: NOW, expires: NOW + 300, keyid: other.keyId, nonce: /nonce="([^"]+)"/.exec(h["signature-input"])![1]! });
    const base = sig2Base({ method: "POST", authority: AUTHORITY, path: CHECKOUT, query: "?", contentDigest: h["content-digest"], signatureInput: h["signature-input"], signature: h.signature }, p2);
    const swapped = { ...h, "purser-signature-input": `body=${p2}`, "purser-signature": `body=:${sign(null, Buffer.from(base), other.privateKey).toString("base64")}:` };
    expect(check(received(swapped))).toMatchObject(refused(/keyId .* keyid .* differ/));
    const upper = { ...h, "purser-signature-input": h["purser-signature-input"].replace(`keyid="${ops.keyId}"`, `keyid="${ops.keyId.toUpperCase()}"`) };
    expect(check(received(upper))).toMatchObject(refused(/differ/));
  });
  it("a tampered body under the original digest", () => {
    expect(check(received(headersFor(), { body: '{"plan":"packwise-pro"}' }))).toMatchObject(refused(/Content-Digest does not match the body/));
  });
  it("a tampered body with its digest recomputed", () => {
    const h = headersFor();
    const tampered = '{"plan":"packwise-pro"}';
    const recomputed = { ...h, "content-digest": headersFor({ body: tampered })["content-digest"] };
    expect(check(received(recomputed, { body: tampered }))).toMatchObject(refused(/signature 2 does not verify/));
  });
  it("signature 2 moved under another TAP request (other nonce, and the same nonce)", () => {
    const a = headersFor();
    const b = headersFor({ body: '{"plan":"packwise-pro"}' });
    const moved = { ...b, "content-digest": a["content-digest"], "purser-signature-input": a["purser-signature-input"], "purser-signature": a["purser-signature"] };
    expect(check(received(moved))).toMatchObject(refused(/nonces of signature 1 and signature 2 differ/));
    const nonce = /nonce="([^"]+)"/.exec(a["signature-input"])![1]!;
    const sameNonce = headersFor({ nonce, created: NOW + 1 });
    const moved2 = { ...sameNonce, "content-digest": a["content-digest"], "purser-signature-input": a["purser-signature-input"], "purser-signature": a["purser-signature"] };
    expect(check(received(moved2))).toMatchObject(refused(/signature 2 does not verify/));
  });
  for (const name of ["signature", "signature-input", "content-digest", "purser-signature", "purser-signature-input", "purser-anything"]) {
    it(`a second field line of ${name}`, () => {
      const h = headersFor();
      const sent = (h as unknown as Record<string, string>)[name];
      const Name = name.replace(/^./, (c) => c.toUpperCase());
      const extra: [string, string][] = sent ? [[Name, sent]] : [[Name, "x"], [name, "y"]];
      expect(check(received(h, { extra }))).toMatchObject(refused(new RegExp(`duplicate header ${name}`)));
    });
  }
  it("a Content-Digest with a second entry", () => {
    const h = headersFor();
    expect(check(received({ ...h, "content-digest": `${h["content-digest"]}, sha-512=:AAAA:` }))).toMatchObject(refused(/exactly one sha-256/));
  });
  it("an edited Signature-Input (tag, expires) under an intact Signature", () => {
    const browse = headersFor({ tag: "agent-browser-auth" });
    const asPayer = { ...browse, "signature-input": browse["signature-input"].replace("agent-browser-auth", "agent-payer-auth") };
    expect(check(received(asPayer))).toMatchObject({ ...refused(/signature 1 does not verify/), sig1: expect.stringMatching(/^refused/) });
    const h = headersFor();
    const longer = { ...h, "signature-input": h["signature-input"].replace(`expires=${NOW + 300}`, `expires=${NOW + 480}`) };
    expect(check(received(longer))).toMatchObject(refused(/signature 1 does not verify/));
  });
  it("a TAP request without our signature 2, and a GET", () => {
    const h = headersFor();
    const { "purser-signature-input": _a, "purser-signature": _b, ...tapOnly } = h;
    expect(check(received(tapOnly as TapHeaders))).toMatchObject(refused(/missing header purser-signature-input/));
    expect(check(received(h, { method: "GET" }))).toMatchObject(refused(/POST/));
  });
});

describe("the nonce", () => {
  it("is stored only after every check passed, so a refused request burns nothing", () => {
    const h = headersFor();
    expect(check(received(h, { body: "{}" })).ok).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS c FROM tap_rail_nonces").get()).toEqual({ c: 0 });
    expect(check(received(h)).ok).toBe(true);
  });
  it("is per key: the same nonce under another pinned key is that key's own", () => {
    const nonce = "shared-nonce-0000000001";
    expect(check(received(headersFor({ nonce }))).ok).toBe(true);
    expect(check(received(headersFor({ nonce, k: other }))).ok).toBe(true);
    expect(check(received(headersFor({ nonce, created: NOW + 2 })))).toMatchObject(refused(/replay/));
  });
  it("is forgotten only once no signature carrying it can be inside its window", () => {
    const nonce = "old-nonce-000000000001";
    expect(check(received(headersFor({ nonce }))).ok).toBe(true);
    const later = NOW + 10_000;
    expect(check(received(headersFor({ created: later })), later).ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS c FROM tap_rail_nonces WHERE nonce = ?").get(nonce)).toEqual({ c: 0 });
    expect(check(received(headersFor({ nonce })), later)).toMatchObject(refused(/expired/));
  });
  // Review, 2 November: the retention must cover the latest moment a replay could still be inside its window.
  it("is kept long enough: accepted at t (created t+30, expires t+510), a replay at t+540 is refused", () => {
    const t = NOW;
    const nonce = "edge-nonce-0000000000001";
    expect(check(received(headersFor({ nonce, created: t + TAP_CLOCK_SKEW_S, expiresIn: 480 })), t).ok).toBe(true);
    // Another accepted request at t+540 runs the purge first.
    expect(check(received(headersFor({ created: t + 540 })), t + 540).ok).toBe(true);
    expect(check(received(headersFor({ nonce, created: t + TAP_CLOCK_SKEW_S, expiresIn: 480 })), t + 540)).toMatchObject(refused(/replay/));
  });
  it("is kept for the merchant's own skew when it is configured larger", () => {
    const wide = tapMerchantConfig({ authority: AUTHORITY, checkoutPath: CHECKOUT, skew: 120 });
    const t = NOW;
    const nonce = "wide-skew-nonce-00000001";
    const replayed = () => received(headersFor({ nonce, created: t + 100, expiresIn: 480 }));
    expect(verifyTapCheckout(db, replayed(), wide, t).ok).toBe(true);
    expect(verifyTapCheckout(db, received(headersFor({ created: t + 650 })), wide, t + 650).ok).toBe(true);
    expect(verifyTapCheckout(db, replayed(), wide, t + 650)).toMatchObject(refused(/replay/));
  });
});

describe("review nits", () => {
  it("takes a key on its end date and refuses it one second later", () => {
    db.prepare("UPDATE tap_agents SET not_after = ? WHERE keyid = ?").run(NOW + 5, ops.keyId);
    expect(check(received(headersFor()), NOW + 5).ok).toBe(true);
    expect(check(received(headersFor()), NOW + 6)).toMatchObject(refused(/end date/));
  });
  it("keeps a revocation when the key is registered again", () => {
    revokeAgent(db, ops.keyId, new Date());
    pin(ops);
    expect(check(received(headersFor()))).toMatchObject(refused(/revoked/));
  });
  it("never throws: an unreadable pinned row and a closed ledger are refusals", () => {
    db.prepare("UPDATE tap_agents SET domains_json = 'not json' WHERE keyid = ?").run(ops.keyId);
    expect(check(received(headersFor()))).toMatchObject(refused(/not readable/));
    db.close();
    expect(check(received(headersFor()))).toMatchObject(refused(/could not check/));
  });
  it("signs the authority in lower case, as the merchant compares it", () => {
    expect(check(received(headersFor({ authority: "LocalHost:3001" }))).ok).toBe(true);
  });
});
