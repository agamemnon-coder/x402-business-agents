// The refusal recording no longer blocks the process (agent run 1), so a second cap refusal can arrive while the first
// is being recorded. Per mandate (and kind) one recording runs at a time in this process; the ledger row is the guard
// across processes. Here two overlapping recordings with a slow stand-in Metal: one pull, one audit row. No chain.
import { describe, expect, it, vi } from "vitest";

const metal = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/metal/recordRefusal.js", () => ({
  recordCapRefusalOnChain: async () => { metal.calls++; await new Promise((r) => setTimeout(r, 50)); return { tx: `0x${"cd".repeat(32)}`, reason: "mandate_cap_exceeded" }; },
}));

const { openDb } = await import("../src/db/open.js");
const { SourcingAgent } = await import("../src/agents/sourcing.js");

const m = { agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "c", keyFile: "k", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" };
const REASON = "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment";

describe("one refusal recording at a time per mandate", () => {
  it("two overlapping recordings under one mandate: one pull to Metal, one ledger row", async () => {
    const db = openDb(":memory:");
    const a = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    const record = (seq: number) => (a as unknown as { recordOnChain(m: unknown, seq: number, reason: string): Promise<boolean> }).recordOnChain(m, seq, REASON);
    await Promise.all([record(18), record(19)]);
    expect(metal.calls).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.refused_on_chain'").get() as { n: number }).n).toBe(1);
    // Once recorded, the ledger row keeps it at one.
    await record(20);
    expect(metal.calls).toBe(1);
  });
});
