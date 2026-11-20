// The relay Worker (worker/src/core.ts Relay), the limits test/relay-worker-refusals.test.ts leaves: a runner state, a
// webhook event, an enrolment request or submission over its size is refused (413) before it is parsed; a push
// unsubscription that names no endpoint; a passkey sign-in that is malformed, or with a passkey the runner synced with
// no public key; and a webhook whose body is signed but not an event. Nothing is queued for the runner.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { viewKey } from "../src/relay/config.js";
import { sqlOver } from "../src/relay/local.js";
import { Relay, viewKeyForWeek } from "../worker/src/core.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const SECRET = "whsec-test-not-a-secret";
const t0 = new Date("2026-10-30T10:00:00Z");
const view = { "x-kit11-view": viewKey(TOKEN), origin: BASE, "content-type": "application/json" };
const relay = (o: { mfa?: boolean } = {}) => new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, webhookSecret: SECRET, now: () => t0, push: { publicKey: "BPk", send: async () => 201 }, ...o });
const post = (r: Relay, path: string, body: string, headers: Record<string, string> = view) => r.fetch(new Request(`${BASE}${path}`, { method: "POST", headers, body }));
const said = async (res: Response) => ({ status: res.status, error: ((await res.json()) as { error?: string }).error });
const STATE = (credentials: unknown[] = []) => ({ snapshot: {}, approvals: { proposals: [], names: {}, passkey: { rp_id: "kit11.example.workers.dev", credentials }, relay: { synced_at: t0.toISOString(), age_ms: 0 }, enrolment_open: false }, generated_at: t0.toISOString() });
const hmac = async (key: string, text: string) => {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text))).toString("hex");
};

describe("sizes, refused before anything is parsed", () => {
  it("a runner state over 1.5 MB", async () => {
    const r = relay();
    const res = await post(r, "/api/runner/sync", JSON.stringify({ state_hash: "h", pad: "x".repeat(1_500_001) }), { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });
    expect(await said(res)).toEqual({ status: 413, error: "state too large" });
  });

  it("a webhook event over 64 KB, before its signature is checked", async () => {
    expect(await said(await post(relay(), "/hooks/airwallex", "x".repeat(65_537), { "content-type": "application/json" }))).toEqual({ status: 413, error: "event too large" });
  });

  it("an enrolment request over 1 KB and an enrolment over 16 KB", async () => {
    const r = relay();
    expect(await said(await post(r, "/api/enrol/options", JSON.stringify({ code: "x".repeat(2000) })))).toEqual({ status: 413, error: "too large" });
    expect(await said(await post(r, "/api/enrol", JSON.stringify({ code: "1", credential: { id: "c" }, pad: "x".repeat(17_000) })))).toEqual({ status: 413, error: "submission too large" });
    expect(await said(await post(r, "/api/enrol/options", "[1]"))).toEqual({ status: 400, error: "malformed request" });
  });
});

describe("push, sign-in and webhook bodies", () => {
  it("an unsubscription without an endpoint is malformed; with one it is gone", async () => {
    const r = relay();
    expect(await said(await post(r, "/api/push/unsubscribe", JSON.stringify({ nope: 1 })))).toEqual({ status: 400, error: "malformed request" });
    expect(await said(await post(r, "/api/push/unsubscribe", "not json"))).toEqual({ status: 400, error: "malformed request" });
    const ok = await post(r, "/api/push/unsubscribe", JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ subscribed: false });
  });

  const mfaHeaders = async () => ({ ...view, "x-kit11-view": await viewKeyForWeek(TOKEN, t0) });

  it("a sign-in that is not an object, or lacks its challenge or credential, is malformed", async () => {
    const r = relay({ mfa: true });
    const mfaView = await mfaHeaders();
    for (const body of ["[]", "nope", JSON.stringify({ challenge: 5, credential: { id: "c", response: {} } }), JSON.stringify({ challenge: "c", credential: { id: "c" } }), JSON.stringify({ challenge: "c", credential: { id: 7, response: {} } })]) {
      expect(await said(await post(r, "/api/session", body, mfaView))).toEqual({ status: 400, error: "malformed sign-in" });
    }
  });

  it("a sign-in with an enrolled passkey the runner synced without its public key is refused, with how to fix it", async () => {
    const r = relay({ mfa: true });
    const mfaView = await mfaHeaders();
    await post(r, "/api/runner/sync", JSON.stringify({ state_hash: "h1", state: STATE([{ id: "cred-rsa", label: "old key" }]) }), { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" });
    const options = (await (await post(r, "/api/session/options", "{}", mfaView)).json()) as { challenge: string; allow: string[] };
    expect(options.allow).toEqual(["cred-rsa"]);
    const res = await post(r, "/api/session", JSON.stringify({ challenge: options.challenge, credential: { id: "cred-rsa", response: {} } }), mfaView);
    expect(res.status).toBe(403);
    expect((await said(res)).error).toMatch(/^this relay has no public key for that passkey: the runner needs KIT11_MFA=on/);
  });

  it("a webhook signed correctly whose body is not JSON, or not an event, is malformed and not stored", async () => {
    const r = relay();
    const ts = String(t0.getTime());
    const send = async (body: string) => post(r, "/hooks/airwallex", body, { "content-type": "application/json", "x-timestamp": ts, "x-signature": await hmac(SECRET, ts + body) });
    expect(await said(await send("not json"))).toEqual({ status: 400, error: "malformed event" });
    expect(await said(await send(JSON.stringify({ id: "x".repeat(129) })))).toEqual({ status: 400, error: "malformed event" });
    expect(await said(await send("[]"))).toEqual({ status: 400, error: "malformed event" });
    expect((await send(JSON.stringify({ id: "evt_1", name: "payout.transfer.paid" }))).status).toBe(200);
  });
});
