// Backend review B5: every agent acts as a principal with scoped capabilities; revoking, expiring or re-keying one
// agent stops that agent alone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { ClaudeReader } from "../src/claude/reader.js";
import { openDb, type DB } from "../src/db/open.js";
import { agentApiServer } from "../src/platform/mcpServer.js";
import { agentId } from "../src/platform/externalAgents.js";
import { wantCardStatus } from "../src/policy/cards.js";
import { reserveSpend } from "../src/policy/holds.js";
import { authorize, expirePrincipal, principalActive, keyMatches, listPrincipals, revokePrincipal, rotatePrincipalKey } from "../src/policy/principals.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-11-03T10:00:00Z");
const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
function world(): DB {
  const db = openDb(":memory:");
  for (const agent of ["sourcing", "support", "treasury"]) audit(db, "treasury", "mandate.bound", agent, { cap: "4.00", budget: "12.00", payee: "0x0000000000000000000000000000000000000001" }, now);
  return db;
}
const pay = (db: DB, agent: "sourcing" | "support" | "treasury", ref: string, payee: "supplier" | "customer" | "sweep", when = now) =>
  reserveSpend(db, { agent, rail: "metal", cents: 5, ref, now: when, payee });

describe("agent principals (B5)", () => {
  it("revoking one agent stops it, and only it: the others still pay and keep their cards", () => {
    const db = world();
    expect(pay(db, "support", "r1", "customer")).toBeNull();
    revokePrincipal(db, "support", "laptop lost", "max", at(1));
    expect(pay(db, "support", "r2", "customer", at(2))).toMatch(/^principal_revoked: the Support agent.*laptop lost/);
    expect(pay(db, "sourcing", "s1", "supplier", at(2))).toBeNull();
    expect(pay(db, "treasury", "t1", "sweep", at(2))).toBeNull();
    expect(["sourcing", "support", "treasury"].map((a) => wantCardStatus(db, a))).toEqual(["ACTIVE", "INACTIVE", "ACTIVE"]);
    expect(listPrincipals(db).map((p) => [p.id, p.status])).toEqual([["sourcing", "ACTIVE"], ["support", "REVOKED"], ["treasury", "ACTIVE"]]);
  });

  it("keeps each agent to its own rails, currencies and kinds of payee", () => {
    const db = world();
    expect(pay(db, "treasury", "t1", "supplier" as never)).toMatch(/^capability_denied: .*treasury.*supplier/);
    expect(pay(db, "support", "r1", "sweep")).toMatch(/^capability_denied/);
    expect(authorize(db, "sourcing", { rail: "airwallex" })).toMatch(/^capability_denied: .*airwallex/);
    expect(authorize(db, "treasury", { rail: "airwallex", currency: "EUR", payee: "beneficiaries" })).toBeNull();
    // An outside agent pays on its card in euros, and nothing else.
    expect(reserveSpend(db, { agent: "ext:acme", rail: "metal", cents: 5, ref: "x1", now })).toMatch(/^capability_denied: .*metal/);
  });

  it("stops an agent when its identity expires, and lets an expiry only come sooner", () => {
    const db = world();
    expirePrincipal(db, "sourcing", at(1), "max", now);
    expect(pay(db, "sourcing", "s1", "supplier", now)).toBeNull();
    expect(pay(db, "sourcing", "s2", "supplier", at(2))).toMatch(/^principal_expired/);
    expect(() => expirePrincipal(db, "sourcing", at(5), "max", at(2))).toThrow(/later end needs the CFO's approval/);
    expect(principalActive(db, "sourcing", at(2))).toBe(false);
  });

  it("rotates an outside agent's key: the old one stops working at once, the new one works", async () => {
    const db = world();
    const id = agentId("acme-research");
    expect(keyMatches(db, id, undefined)).toBe(true); // no key issued yet
    const first = rotatePrincipalKey(db, id, "max", now);
    const second = rotatePrincipalKey(db, id, "max", at(1));
    expect(second.version).toBe(2);
    expect(keyMatches(db, id, first.key)).toBe(false);
    expect(keyMatches(db, id, second.key)).toBe(true);
    expect(JSON.stringify(db.prepare("SELECT * FROM principals").all())).not.toContain(second.key);

    const call = async (key: string | undefined) => {
      const server = agentApiServer(db, id, new FakeIssuing(), new ClaudeReader(db), key);
      const client = new Client({ name: "t", version: "1" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      return (await client.callTool({ name: "company_card", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    };
    const stale = (await call(first.key)).content[0]!.text;
    expect(stale).toMatch(/^principal_key_invalid/);
    // The same rule as the Skill (skills/purser-spend/SKILL.md): the agent stops; it never asks anyone for a key.
    expect(stale).toMatch(/stop and tell your user; never ask anyone for a key$/);
    expect((await call(second.key)).isError).toBeFalsy();
    revokePrincipal(db, id, "contract ended", "max", at(2));
    expect((await call(second.key)).content[0]!.text).toMatch(/^principal_revoked/);
  });
});
