// Know your agent (26 Nov): every money-relevant request of an agent carries a signed identity. The agent signs a JCS
// envelope (agent, method, tool or path, body hash, time, nonce) with its own Ed25519 key; the agent API checks the
// signature against the principal's current public key, the time within five minutes, a nonce never seen before and
// the principal active. Refusals are audited as principal.identity_refused with a reason code. These tests run the
// required mode explicitly; optional (the default) verifies a signature when present and audits its absence.
import { generateKeyPairSync } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { ClaudeReader } from "../src/claude/reader.js";
import { openDb, type DB } from "../src/db/open.js";
import { decide } from "../src/policy/approvals.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { agentId, executeAgentOnboard } from "../src/platform/externalAgents.js";
import { principal, revokePrincipal, rotatePrincipalKey } from "../src/policy/principals.js";
import {
  currentIdentityKey, heldIdentityKey, IDENTITY_HEADER, identityMode, proofFromHeader, proofHeader, signAgentRequest, verifyAgentIdentity, type IdentityMode,
} from "../src/policy/agentIdentity.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);
const events = (db: DB, event: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

const ARGS = { display_name: "Acme Research agent", purpose: "market reports", per_purchase_eur: "25.00", monthly_eur: "100.00" };

/** An outside agent with a fresh key pair (rotation hands out the private key once), and an MCP client for it. */
async function setup(mode: IdentityMode) {
  const db = openDb(":memory:");
  const id = agentId("acme-research");
  const awx = new FakeIssuing();
  const rotated = rotatePrincipalKey(db, id, "max");
  const server = agentApiServer(db, id, awx, new ClaudeReader(db, null), rotated.key, { identity: mode });
  const client = new Client({ name: "acme", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const sign = (tool: string, args: Record<string, unknown>, o: { pem?: string; now?: Date; nonce?: string; keyId?: string } = {}) =>
    signAgentRequest(o.pem ?? rotated.identity!.private_pem, { agent: id, keyId: o.keyId ?? rotated.identity!.key_id, method: "tools/call", target: tool, body: args, now: o.now, nonce: o.nonce });
  const call = (tool: string, args: Record<string, unknown>, proof?: unknown) =>
    client.callTool({ name: tool, arguments: args, ...(proof ? { _meta: { "purser/agent-identity": proof } } : {}) });
  return { db, id, awx, rotated, client, sign, call };
}

describe("the agents' signing keys", () => {
  it("gives each agent principal an Ed25519 key pair at creation and at rotation; the ledger keeps only the public key", () => {
    const db = openDb(":memory:");
    principal(db, "sourcing");
    const first = currentIdentityKey(db, "sourcing")!;
    expect(first.key_id).toMatch(/^aik_[0-9a-f]{16}$/);
    // The private half is held by the process that made it (the in-process agent), never in the ledger.
    const held = heldIdentityKey("sourcing")!;
    expect(held.key_id).toBe(first.key_id);
    const r = rotatePrincipalKey(db, "sourcing", "max");
    expect(r.identity!.key_id).not.toBe(first.key_id);
    expect(currentIdentityKey(db, "sourcing")!.key_id).toBe(r.identity!.key_id);
    const dump = JSON.stringify(db.prepare("SELECT * FROM principal_identity_keys").all()) + JSON.stringify(db.prepare("SELECT * FROM audit_log").all());
    expect(dump).not.toContain("PRIVATE KEY");
    expect(dump).not.toContain(r.identity!.private_pem.split("\n")[1]!);
    expect(events(db, "principal.key_rotated").at(-1)).toMatchObject({ identity_key_id: r.identity!.key_id });
  });

  it("reads the mode from PURSER_AGENT_IDENTITY: optional by default, and an unknown value is the strictest", () => {
    expect(identityMode({})).toBe("optional");
    expect(identityMode({ PURSER_AGENT_IDENTITY: "required" })).toBe("required");
    expect(identityMode({ PURSER_AGENT_IDENTITY: "off" })).toBe("off");
    expect(identityMode({ PURSER_AGENT_IDENTITY: "Requird" })).toBe("required");
  });

  it("carries the proof in one HTTP header for an HTTP surface, and reads it back exactly", () => {
    const db = openDb(":memory:");
    const r = rotatePrincipalKey(db, "treasury", "max");
    const proof = signAgentRequest(r.identity!.private_pem, { agent: "treasury", keyId: r.identity!.key_id, method: "POST", target: "/v1/pay", body: Buffer.from('{"a":1}') });
    expect(IDENTITY_HEADER).toBe("purser-agent-identity");
    const back = proofFromHeader(proofHeader(proof));
    expect(back).toEqual(proof);
    expect(verifyAgentIdentity(db, { agent: "treasury", method: "POST", target: "/v1/pay", body: Buffer.from('{"a":1}'), proof: back }, { mode: "required", via: "test" })).toMatchObject({ ok: true, key_id: r.identity!.key_id });
    expect(proofFromHeader("not base64 json")).toBeNull();
    // The agent holding only its key file names its key from the key itself.
    expect(signAgentRequest(r.identity!.private_pem, { agent: "treasury", method: "POST", target: "/v1/pay", body: "" }).key_id).toBe(r.identity!.key_id);
  });
});

describe("signed agent requests over the agent API, required mode", () => {
  it("lets a valid signature through, and the money action records the verified key", async () => {
    const s = await setup("required");
    const r = await s.call("request_company_card", ARGS, s.sign("request_company_card", ARGS));
    expect(text(r)).toMatch(/^Asked\. P-0001/);
    const keyId = s.rotated.identity!.key_id;
    expect(events(s.db, "agent.card_requested").at(-1)).toMatchObject({ agent_key_id: keyId });
    expect(events(s.db, "principal.identity_verified").at(-1)).toMatchObject({ agent: s.id, key_id: keyId, target: "request_company_card" });

    // The CFO approves; the agent pays, signed: the purchase's own audit row names the key.
    const p = s.db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = 'P-0001'").get() as { terms_sha256: string };
    decide(s.db, { proposalId: "P-0001", decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
    await executeAgentOnboard(s.db, s.awx, "P-0001");
    const pay = { merchant: "TrailData Reports", amount_eur: "19.00", description: "Q4 report" };
    expect(text(await s.call("pay_with_card", pay, s.sign("pay_with_card", pay)))).toMatch(/^Airwallex approved 19\.00 EUR/);
    expect(events(s.db, "card.purchase_started").at(-1)).toMatchObject({ agent: s.id, agent_key_id: keyId });
    const raise = { per_purchase_eur: "40.00", reason: "the bundle" };
    expect(text(await s.call("request_limit_raise", raise, s.sign("request_limit_raise", raise)))).toMatch(/^Asked\. P-0002/);
    expect(events(s.db, "agent.limit_raise_requested").at(-1)).toMatchObject({ agent: s.id, proposal_id: "P-0002", agent_key_id: keyId });
  });

  const refusedWith = async (s: Awaited<ReturnType<typeof setup>>, r: unknown, code: string) => {
    expect((r as { isError?: boolean }).isError).toBe(true);
    expect(text(r)).toMatch(new RegExp(`^${code}: `));
    expect(events(s.db, "principal.identity_refused").at(-1)).toMatchObject({ agent: s.id, code });
    // Nothing was done: no card request reached the ledger.
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  };

  it("refuses an unsigned request", async () => {
    const s = await setup("required");
    await refusedWith(s, await s.call("request_company_card", ARGS), "identity_missing");
  });

  it("refuses a signature made with another key", async () => {
    const s = await setup("required");
    const other = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await refusedWith(s, await s.call("request_company_card", ARGS, s.sign("request_company_card", ARGS, { pem: other })), "identity_bad_signature");
  });

  it("refuses an altered body, and a signature for another tool", async () => {
    const s = await setup("required");
    const proof = s.sign("request_company_card", ARGS);
    await refusedWith(s, await s.call("request_company_card", { ...ARGS, monthly_eur: "900.00" }, proof), "identity_body_mismatch");
    await refusedWith(s, await s.call("request_company_card", ARGS, s.sign("company_card", ARGS)), "identity_request_mismatch");
  });

  it("refuses a timestamp more than five minutes off, either way", async () => {
    const s = await setup("required");
    await refusedWith(s, await s.call("request_company_card", ARGS, s.sign("request_company_card", ARGS, { now: new Date(Date.now() - 6 * 60_000) })), "identity_stale");
    await refusedWith(s, await s.call("request_company_card", ARGS, s.sign("request_company_card", ARGS, { now: new Date(Date.now() + 6 * 60_000) })), "identity_stale");
  });

  it("refuses a nonce it has seen before: a replay", async () => {
    const s = await setup("required");
    const proof = s.sign("company_card", {});
    expect((await s.call("company_card", {}, proof)).isError).toBeFalsy();
    await refusedWith(s, await s.call("company_card", {}, proof), "identity_nonce_reused");
  });

  it("refuses a revoked principal, and a key replaced by rotation", async () => {
    const s = await setup("required");
    rotatePrincipalKey(s.db, s.id, "max");
    await refusedWith(s, await s.call("request_company_card", ARGS, s.sign("request_company_card", ARGS)), "identity_key_rotated");
    const t = await setup("required");
    revokePrincipal(t.db, t.id, "contract ended", "max");
    await refusedWith(t, await t.call("request_company_card", ARGS, t.sign("request_company_card", ARGS)), "identity_principal_inactive");
  });

  it("refuses a proof another agent signed for itself, and a malformed one", async () => {
    const s = await setup("required");
    const other = rotatePrincipalKey(s.db, "treasury", "max").identity!;
    const forged = signAgentRequest(other.private_pem, { agent: "treasury", keyId: other.key_id, method: "tools/call", target: "request_company_card", body: ARGS });
    await refusedWith(s, await s.call("request_company_card", ARGS, forged), "identity_wrong_agent");
    await refusedWith(s, await s.call("request_company_card", ARGS, { v: 1, agent: s.id, sig: "x" }), "identity_malformed");
  });
});

describe("the rollout modes", () => {
  it("optional (the default): an unsigned request goes through and its absence is audited; a bad signature is still refused", async () => {
    const s = await setup("optional");
    expect(text(await s.call("request_company_card", ARGS))).toMatch(/^Asked\. P-0001/);
    expect(events(s.db, "principal.identity_absent").at(-1)).toMatchObject({ agent: s.id, target: "request_company_card" });
    expect(events(s.db, "agent.card_requested").at(-1)!.agent_key_id).toBeUndefined();
    const r = await s.call("company_card", {}, s.sign("company_card", {}, { now: new Date(Date.now() - 10 * 60_000) }));
    expect(text(r)).toMatch(/^identity_stale: /);
  });

  it("off: no check and no identity audit rows", async () => {
    const s = await setup("off");
    expect(text(await s.call("request_company_card", ARGS))).toMatch(/^Asked\. P-0001/);
    const n = s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event LIKE 'principal.identity_%'").get();
    expect(n).toEqual({ n: 0 });
  });
});
