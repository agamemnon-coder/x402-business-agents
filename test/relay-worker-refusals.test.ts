// The relay Worker's refusals (worker/src/core.ts Relay): a runner sync without the token, too large or malformed; a
// submission before the runner has connected; a policy change, a policy text, a chat message or an enrolment that is
// malformed, too long, or one too many while the runner has not read the last; a wrong method on a known path. Each is
// refused with its status and words, and nothing is queued for the runner.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { viewKey } from "../src/relay/config.js";
import { sqlOver } from "../src/relay/local.js";
import { Relay } from "../worker/src/core.js";

const BASE = "https://kit11.example.workers.dev";
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-10-30T10:00:00Z");
const relay = () => new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => t0 });
const view = { "x-kit11-view": viewKey(TOKEN), origin: BASE, "content-type": "application/json" };
const post = (r: Relay, path: string, body: unknown, headers: Record<string, string> = view) => r.fetch(new Request(`${BASE}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
const sync = (r: Relay, body: unknown, auth = `Bearer ${TOKEN}`) => post(r, "/api/runner/sync", body, { authorization: auth, "content-type": "application/json" });
const said = async (res: Response) => ({ status: res.status, error: ((await res.json()) as { error?: string }).error });
const STATE = { snapshot: {}, approvals: { proposals: [], names: {}, passkey: { rp_id: "kit11.example.workers.dev", credentials: [] }, relay: { synced_at: t0.toISOString(), age_ms: 0 }, enrolment_open: false }, generated_at: t0.toISOString() };

describe("the runner's sync", () => {
  it("is refused without the relay token, with a malformed body or a malformed state", async () => {
    const r = relay();
    expect(await said(await sync(r, { state_hash: "h" }, "Bearer wrong"))).toEqual({ status: 401, error: "the relay token is missing or wrong" });
    expect(await said(await sync(r, { state_hash: "h" }, ""))).toEqual({ status: 401, error: "the relay token is missing or wrong" });
    expect(await said(await sync(r, "{not json"))).toEqual({ status: 400, error: "malformed sync" });
    expect(await said(await sync(r, { state_hash: 5 }))).toEqual({ status: 400, error: "malformed sync" });
    expect(await said(await sync(r, { state_hash: "h", state: { snapshot: {} } }))).toEqual({ status: 400, error: "malformed state" });
    expect(await said(await sync(r, { state_hash: "h", state: "x".repeat(10) }))).toEqual({ status: 400, error: "malformed state" });
  });

  it("takes a well-formed state, ignores acks that are not acks, and asks for the state when it has none", async () => {
    const r = relay();
    const first = await sync(r, { state_hash: "h1", acks: [{ ticket: 5 }, { ticket: "t1", status: "nonsense" }, "x"], hook_acks: [7, "h-1"] });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { need_state: boolean }).need_state).toBe(true);
    const second = await sync(r, { state_hash: "h1", state: STATE });
    expect(((await second.json()) as { need_state: boolean }).need_state).toBe(false);
  });
});

describe("the phone's submissions", () => {
  it("are refused while the runner has not connected", async () => {
    const r = relay();
    expect(await said(await post(r, "/api/policy-text", { text: "cap 0.03" }))).toEqual({ status: 503, error: "the runner has not connected yet" });
    expect(await said(await post(r, "/api/ask", { text: "hello" }))).toEqual({ status: 503, error: "the runner has not connected yet" });
  });

  it("a policy text or a chat message that is too long, not text, or one more while the runner still reads the last", async () => {
    const r = relay();
    await sync(r, { state_hash: "h1", state: STATE });
    expect((await post(r, "/api/policy-text", { text: "x".repeat(5000) })).status).toBe(400);
    expect((await said(await post(r, "/api/policy-text", { text: 5 }))).status).toBe(400);
    expect((await post(r, "/api/policy-text", { text: "cap the sourcing agent at 0.03" })).status).toBe(202);
    expect(await said(await post(r, "/api/policy-text", { text: "and another" }))).toEqual({ status: 429, error: "the runner is still reading your last text; wait for it" });
    expect((await post(r, "/api/ask", { text: "x".repeat(5000) })).status).toBe(400);
    expect((await post(r, "/api/ask", { text: "book a train" })).status).toBe(202);
    expect(await said(await post(r, "/api/ask", { text: "and a hotel" }))).toEqual({ status: 429, error: "Purser is still answering your last message; wait for it" });
  });

  it("a policy change that is malformed, or signed with a passkey the relay does not know, is refused", async () => {
    const r = relay();
    await sync(r, { state_hash: "h1", state: STATE });
    expect(await said(await post(r, "/api/policy", { canonical: "{}" }))).toEqual({ status: 400, error: "malformed submission" });
    const sub = { canonical: "{}", terms_sha256: "a".repeat(64), credential: { id: "cred-x", response: {} } };
    expect(await said(await post(r, "/api/policy", sub))).toEqual({ status: 403, error: "this passkey is not the enrolled one" });
  });

  it("enrolment without an open window, and malformed enrolment requests", async () => {
    const r = relay();
    await sync(r, { state_hash: "h1", state: STATE });
    expect(await said(await post(r, "/api/enrol/options", "[]"))).toEqual({ status: 400, error: "malformed request" });
    expect(await said(await post(r, "/api/enrol/options", { code: "ABCD-EFGH" }))).toEqual({ status: 409, error: "no enrolment is open; ask for a new code" });
    expect(await said(await post(r, "/api/enrol", { code: "x" }))).toEqual({ status: 400, error: "malformed submission" });
  });

  it("a wrong method on a known path is 405; an unknown path 404", async () => {
    const r = relay();
    expect((await r.fetch(new Request(`${BASE}/api/policy`, { headers: view }))).status).toBe(405);
    expect((await r.fetch(new Request(`${BASE}/hooks/airwallex`))).status).toBe(405);
    expect((await r.fetch(new Request(`${BASE}/api/nothing-here`, { headers: view }))).status).toBe(404);
  });
});
