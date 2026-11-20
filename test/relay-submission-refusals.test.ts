// What the relay Worker (worker/src/core.ts) turns away before anything reaches the runner, each with the words the phone
// shows: a submission over 16 KB; anything before the runner has connected; a signature whose client data is not this
// site's statement over these exact terms (not text, not base64url, an approval sent as a rejection or as a line's
// removal); a policy change that does not hash to what was signed, is not JSON, or waits three deep; push and webhook
// routes that are not set up. The relay can refuse, never approve: the runner verifies every signature again.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { canonicalTerms, sha256Hex, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildRelayState, stateHash, type RelayState } from "../src/relay/state.js";
import { viewKey } from "../src/relay/config.js";
import { Relay, type Sql } from "../worker/src/core.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-10-30T14:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T14:10:00Z", total: "0.60" };
const HASH = termsHash(terms);

const sqlOver = (db: Database.Database): Sql => ({ exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } });
const relay = () => new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => t0 });
function state(): RelayState {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  const { window } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
  recordPasskey(db, { window, credentialId: "cred-1", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
  return buildRelayState(db, { rpId: RP, relayToken: TOKEN }, t0);
}
const sync = (r: Relay, s: RelayState) => r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(s), state: s }) }));
let n = 0;
const post = (r: Relay, path: string, body: unknown) =>
  r.fetch(new Request(`${BASE}${path}`, { method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": viewKey(TOKEN), "cf-connecting-ip": `10.9.${Math.floor(++n / 200)}.${n % 200}` }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const errorOf = async (res: Response) => `${res.status} ${((await res.json()) as { error: string }).error}`;
const cd = (challengeHex: string, over: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(challengeHex, "hex").toString("base64url"), origin: BASE, ...over })).toString("base64url");
const approval = (clientDataJSON: unknown, over: Record<string, unknown> = {}) => ({ proposal_id: "P-0001", terms_sha256: HASH, credential: { id: "cred-1", response: { clientDataJSON, authenticatorData: "AA", signature: "AA" } }, ...over });

describe("approvals the relay refuses", () => {
  it("anything before the runner has connected, and a body over 16 KB", async () => {
    const r = relay();
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH))))).toBe("503 the runner has not connected yet");
    expect(await errorOf(await post(r, "/api/assertions", JSON.stringify({ ...approval(cd(HASH)), pad: "x".repeat(17_000) })))).toBe("413 submission too large");
  });

  it("client data that is not this site's statement over exactly what is signed", async () => {
    const r = relay();
    await sync(r, state());
    expect((await post(r, "/api/assertions", approval(cd(HASH)))).status).toBe(202);
    const notFor = "400 this signature is not for these terms on this site";
    expect(await errorOf(await post(r, "/api/assertions", approval(42)))).toBe(notFor);
    expect(await errorOf(await post(r, "/api/assertions", approval("not base64url!")))).toBe(notFor);
    expect(await errorOf(await post(r, "/api/assertions", approval(Buffer.from("{not json").toString("base64url"))))).toBe(notFor);
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH, { crossOrigin: true }))))).toBe(notFor);
    // An approval's statement sent as a rejection, or as taking a line out.
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH), { decision: "REJECTED" })))).toBe("400 this signature is not a rejection of these terms on this site");
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH), { decision: "REMOVE_LINE", line: "P-0002" })))).toBe("400 this signature is not a removal from these terms on this site");
    const removal = await sha256Hex(`kit11 batch-remove v1 ${HASH} P-0002`);
    expect((await post(r, "/api/assertions", approval(cd(removal), { decision: "REMOVE_LINE", line: "P-0002" }))).status).toBe(202);
    // A removal must name a proposal line.
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(removal), { decision: "REMOVE_LINE", line: "all" })))).toBe("400 malformed submission");
  });

  it("an on-chain approval whose terms carry no digest to sign", async () => {
    const r = relay();
    const s = state();
    const p = s.approvals.proposals[0]!;
    Object.assign(p, { kind: "owners_execute", canonical: JSON.stringify({ kind: "owners_execute", onchain_digest: "0xnot-a-digest" }) });
    await sync(r, s);
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH))))).toBe("400 these terms carry no valid on-chain digest");
    Object.assign(p, { canonical: "{not json" });
    await sync(r, s);
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH))))).toBe("400 these terms carry no valid on-chain digest");
    const digest = "ab".repeat(32);
    Object.assign(p, { canonical: JSON.stringify({ kind: "owners_execute", onchain_digest: `0x${digest}` }) });
    await sync(r, s);
    expect(await errorOf(await post(r, "/api/assertions", approval(cd(HASH))))).toBe("400 this signature is not for these terms on this site");
    expect((await post(r, "/api/assertions", approval(cd(digest)))).status).toBe(202);
  });
});

describe("policy changes the relay refuses", () => {
  const policy = (over: Record<string, unknown> = {}) => canonicalTerms({ schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: "C-0a1b2c3d", expires_at: "2026-10-30T14:10:00Z", changes: [], reason: "r", ...over } as Terms);
  const submission = (canonical: string, hash = sha256Hex(canonical), clientDataJSON: unknown = cd(hash)) => ({ canonical, terms_sha256: hash, credential: { id: "cred-1", response: { clientDataJSON, authenticatorData: "AA", signature: "AA" } } });

  it("before the runner connected, over 16 KB, not hashing to what was signed, not JSON, not signed on this site", async () => {
    const r = relay();
    expect(await errorOf(await post(r, "/api/policy", submission(policy())))).toBe("503 the runner has not connected yet");
    expect(await errorOf(await post(r, "/api/policy", JSON.stringify({ ...submission(policy()), pad: "x".repeat(17_000) })))).toBe("413 submission too large");
    await sync(r, state());
    expect(await errorOf(await post(r, "/api/policy", submission(policy(), "0".repeat(64))))).toBe("400 the terms do not hash to the signed hash");
    expect(await errorOf(await post(r, "/api/policy", submission("{not json")))).toBe("400 malformed terms");
    expect(await errorOf(await post(r, "/api/policy", submission(JSON.stringify(["policy_change"]))))).toBe("400 not a policy change made on the phone");
    expect(await errorOf(await post(r, "/api/policy", submission(policy(), undefined, cd("00".repeat(32)))))).toBe("400 this signature is not for these terms on this site");
  });

  it("at most three waiting for the runner", async () => {
    const r = relay();
    await sync(r, state());
    for (let i = 0; i < 3; i++) expect((await post(r, "/api/policy", submission(policy({ reason: `r${i}` })))).status).toBe(202);
    expect(await errorOf(await post(r, "/api/policy", submission(policy({ reason: "r4" }))))).toBe("429 too many policy changes are waiting for the runner");
  });

  it("the policy in words and a request to Purser: within their length, after the runner connected", async () => {
    const r = relay();
    expect(await errorOf(await post(r, "/api/ask", { text: "pay Stockline" }))).toBe("503 the runner has not connected yet");
    await sync(r, state());
    expect(await errorOf(await post(r, "/api/ask", { text: "x".repeat(501) }))).toBe("400 write your request in at most 500 characters");
    expect(await errorOf(await post(r, "/api/policy-text", { text: "" }))).toBe("400 write the policy in at most 2000 characters");
    expect(await errorOf(await post(r, "/api/ask", JSON.stringify({ text: "x".repeat(17_000) })))).toBe("413 submission too large");
    expect(await errorOf(await post(r, "/api/policy-text", JSON.stringify({ text: "x".repeat(17_000) })))).toBe("413 submission too large");
  });
});

describe("routes that are not set up", () => {
  it("push without VAPID keys, an unsubscribe without an endpoint, a webhook without its secret", async () => {
    const r = relay();
    expect(await errorOf(await post(r, "/api/push/subscribe", { endpoint: "https://fcm.googleapis.com/x", keys: {} }))).toBe("404 push is not set up on this relay");
    expect(await errorOf(await post(r, "/api/push/unsubscribe", { endpoint: 42 }))).toBe("400 malformed request");
    expect((await post(r, "/api/push/unsubscribe", { endpoint: "https://fcm.googleapis.com/x" })).status).toBe(200);
    const hook = await r.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", body: "{}" }));
    expect(await errorOf(hook)).toBe("503 webhooks are not set up on this relay");
  });
});
