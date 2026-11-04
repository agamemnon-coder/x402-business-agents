// Agent recognition per the agent-recognition profile of Visa's Trusted Agent Protocol spec: RFC 9421 HTTP Message
// Signatures over @authority and @path, tags agent-browser-auth / agent-payer-auth, an 8-minute window and a nonce
// that is never accepted twice. Our own code against the RFC, with our self-hosted registry and test keys; not
// Visa's directory. The merchant must refuse every request below the first.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { newAgentKey, registerAgent, revokeAgent, signTapRequest, verifyTapRequest, type TapAgentKey } from "../src/visa/tap.js";

const SHOP = "shop.example";
const NOW = 1_800_000_000;

async function world() {
  const db = openDb(":memory:");
  const key = await newAgentKey("sourcing");
  registerAgent(db, { agent: "sourcing", keyid: key.keyid, publicJwk: key.publicJwk, domains: [SHOP], notAfter: NOW + 86_400 });
  return { db, key };
}
const checkout = async (key: TapAgentKey, o: Partial<Parameters<typeof signTapRequest>[0]> = {}) =>
  signTapRequest({ url: `https://${SHOP}/checkout`, method: "POST", key, tag: "agent-payer-auth", now: NOW, ...o });
const verify = (db: ReturnType<typeof openDb>, req: Request, o: { now?: number; tag?: "agent-payer-auth" | "agent-browser-auth" } = {}) =>
  verifyTapRequest(db, req, { tag: o.tag ?? "agent-payer-auth", now: o.now ?? NOW + 5 });

describe("a registered agent's signed request", () => {
  it("is accepted once, naming the agent and the nonce", async () => {
    const { db, key } = await world();
    const req = await checkout(key);
    expect(req.headers.get("signature-input")).toMatch(/^sig2=\("@authority" "@path"\);created=\d+;expires=\d+;keyid="[^"]+";alg="ed25519";nonce="[^"]+";tag="agent-payer-auth"$/);
    const r = await verify(db, req);
    expect(r).toMatchObject({ ok: true, agent: "sourcing", keyid: key.keyid });
    if (r.ok) expect(r.nonce.length).toBeGreaterThan(40);
  });
});

describe("the merchant refuses", () => {
  it("a request with no signature", async () => {
    const { db } = await world();
    expect(await verify(db, new Request(`https://${SHOP}/checkout`, { method: "POST" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/no signature/) });
  });
  it("a browsing tag on checkout", async () => {
    const { db, key } = await world();
    expect(await verify(db, await checkout(key, { tag: "agent-browser-auth" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/tag/) });
  });
  it("an unknown key", async () => {
    const { db } = await world();
    const stranger = await newAgentKey("stranger");
    expect(await verify(db, await checkout(stranger))).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown key/) });
  });
  it("a revoked key, and an expired one", async () => {
    const { db, key } = await world();
    const later = await checkout(key, { now: NOW + 90_000 });
    expect(await verify(db, later, { now: NOW + 90_005 })).toMatchObject({ ok: false, reason: expect.stringMatching(/key expired/) });
    revokeAgent(db, key.keyid);
    expect(await verify(db, await checkout(key))).toMatchObject({ ok: false, reason: expect.stringMatching(/revoked/) });
  });
  it("a valid key that is not registered for this merchant", async () => {
    const { db, key } = await world();
    const other = await checkout(key, { url: "https://other.example/checkout" });
    expect(await verify(db, other)).toMatchObject({ ok: false, reason: expect.stringMatching(/not registered for other\.example/) });
  });
  it("a request replayed to another host or path", async () => {
    const { db, key } = await world();
    const signed = await checkout(key);
    const moved = new Request(`https://${SHOP}/refund`, { method: "POST", headers: signed.headers });
    expect(await verify(db, moved)).toMatchObject({ ok: false, reason: expect.stringMatching(/signature/) });
  });
  it("the same nonce twice", async () => {
    const { db, key } = await world();
    const req = await checkout(key);
    expect((await verify(db, req.clone())).ok).toBe(true);
    expect(await verify(db, req)).toMatchObject({ ok: false, reason: expect.stringMatching(/nonce/) });
  });
  it("a request from the future, an expired one, and a window over 8 minutes", async () => {
    const { db, key } = await world();
    expect(await verify(db, await checkout(key, { now: NOW + 600 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/future|created/) });
    expect(await verify(db, await checkout(key), { now: NOW + 400 })).toMatchObject({ ok: false, reason: expect.stringMatching(/expired/) });
    expect(await verify(db, await checkout(key, { expiresIn: 600 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/window/) });
  });
  it("tampered signature bytes", async () => {
    const { db, key } = await world();
    const req = await checkout(key);
    const h = new Headers(req.headers);
    h.set("signature", h.get("signature")!.replace(/:(.)/, (_m, c: string) => `:${c === "A" ? "B" : "A"}`));
    expect(await verify(db, new Request(req.url, { method: "POST", headers: h }))).toMatchObject({ ok: false, reason: expect.stringMatching(/signature/) });
  });
  it("an upper-case keyId, which is not RFC 8941", async () => {
    const { db, key } = await world();
    const req = await checkout(key);
    const h = new Headers(req.headers);
    h.set("signature-input", h.get("signature-input")!.replace("keyid=", "keyId="));
    expect((await verify(db, new Request(req.url, { method: "POST", headers: h }))).ok).toBe(false);
  });
});
