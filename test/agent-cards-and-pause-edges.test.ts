// Two read-outs and a pause on the paths the other files leave. Each agent's card set (src/airwallex/agentCardSet.ts):
// cards with no or unreadable creation time sort last, the same time sorts by id, and the summary counts one older card
// still active in the singular. Pausing (src/policy/pause.ts): the revoked mandate bound last when two bound in the same
// block order; a pause in a ledger that never changed it by a policy change still counts as not revoked; a resume
// that reports no spend or budget records none; a proposal that is not a policy change is never run as a pause.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cardSetSummary, classifyAgentCards, type CardLite } from "../src/airwallex/agentCardSet.js";
import { openDb, type DB } from "../src/db/open.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal, decide } from "../src/policy/approvals.js";
import { executePauseChange, latestRevoked, pausesNotRevoked, type PauseChain } from "../src/policy/pause.js";

const now = new Date("2026-11-03T10:00:00Z");
const card = (id: string, over: Partial<CardLite> = {}): CardLite => ({ id, last4: "4242", status: "ACTIVE", nickname: "sourcing agent: software", created_at: null, per_tx_cents: 3000, monthly_cents: 10000, ...over });
const policy = { sourcing: { per_tx_cents: 3000, monthly_cents: 10000 }, support: { per_tx_cents: 1, monthly_cents: 2 }, treasury: { per_tx_cents: 1, monthly_cents: 2 } };

describe("each agent's card set", () => {
  it("cards with no or unreadable creation time sort last; the same time sorts by id; one older card active is named in the singular", () => {
    const sets = classifyAgentCards([
      card("c_a", { created_at: "garbage" }), card("c_b"), card("c_new", { created_at: "2026-11-19T10:00:00+0000" }),
      card("c_same1", { created_at: "2026-11-18T10:00:00Z", status: "INACTIVE" }), card("c_same2", { created_at: "2026-11-18T10:00:00Z", status: "INACTIVE" }),
    ], policy);
    const s = sets.find((x) => x.agent === "sourcing")!;
    expect(s.live!.id).toBe("c_new");
    expect(s.older.map((o) => o.card.id)).toEqual(["c_same2", "c_same1", "c_b", "c_a"]);
    const summary = cardSetSummary([{ ...s, older: [{ card: card("c_x"), frozen: false }] }]);
    expect(summary).toEqual({ ok: false, text: "1 of 1 agents have a live card that matches the CFO policy; 1 older test card is still active" });
    expect(cardSetSummary([{ ...s, older: [] }])).toEqual({ ok: true, text: "1 of 1 agents have a live card that matches the CFO policy" });
  });
});

describe("pausing an agent", () => {
  let db: DB;
  beforeEach(() => { process.env.KIT11_AGENTS = "on"; db = openDb(":memory:"); });
  afterEach(() => { delete process.env.KIT11_AGENTS; });
  const approve = (id: string) => {
    const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "max", method: "cli" }, now);
  };

  it("the revoked mandate bound last, whatever order the chain lists them in", () => {
    const a = { id: "a", bound: true, revoked: true, boundBlock: 5n };
    const b = { id: "b", bound: true, revoked: true, boundBlock: 9n };
    const c = { id: "c", bound: true, revoked: true, boundBlock: 9n };
    expect(latestRevoked([a, b])!.id).toBe("b");
    expect(latestRevoked([b, a])!.id).toBe("b");
    expect(latestRevoked([b, c])!.id).toBe("b");
    expect(latestRevoked([{ ...a, revoked: false }])).toBeNull();
  });

  it("a pause switched on outside a policy change still counts until its mandate is revoked", () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('pause.support', 'on', ?)").run(now.toISOString());
    expect(pausesNotRevoked(db)).toEqual(["support"]);
  });

  it("a resume that reports no spend or budget records none", async () => {
    const chain: PauseChain = {
      revoke: async () => ({ tx: `0x${"1".repeat(64)}`, credential_hash: "0xold" }),
      resume: async () => ({ tx: `0x${"2".repeat(64)}`, credential_hash: "0xnew" }),
    };
    for (const to of ["on", "off"] as const) {
      const p = proposePolicyChange(db, { changes: [{ key: "pause.support", to }], reason: to === "on" ? "pause" : "resume" }, "human", now);
      approve(p.proposal_id);
      await executePauseChange(db, p.proposal_id, chain, now);
    }
    const resumed = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'mandate.resumed'").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(resumed).not.toHaveProperty("spent_before");
    expect(resumed).not.toHaveProperty("budget");
    expect(resumed).toMatchObject({ agent: "support", credential_hash: "0xnew" });
  });

  it("a proposal that is not a policy change is never run as a pause", async () => {
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-03T11:00:00Z", total: "0.10" } as Terms, createdBy: "support" }, now);
    approve("P-0001");
    let called = false;
    const chain: PauseChain = { revoke: async () => { called = true; return { tx: null, credential_hash: "x" }; }, resume: async () => { called = true; return { tx: null, credential_hash: "x" }; } };
    await expect(executePauseChange(db, "P-0001", chain, now)).rejects.toThrow("P-0001 is not a policy change");
    expect(called).toBe(false);
  });
});
