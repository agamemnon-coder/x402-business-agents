// The pull that records Metal's refusal on chain (src/metal/recordRefusal.ts) is itself an over-cap payment sent to
// Metal. Any error once metal-agent was started is "pull sent: …" (the caller treats it as an incident and stops the
// Sourcing agent); errors before it (not over the cap, mandate not bound) are not. Fakes only: no CLI, no chain.
import { describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({ calls: 0, run: (() => ({ code: 1, fields: new Map([["refused", ["mandate_cap_exceeded"]], ["transaction", ["0xabc"]]]) })) as () => unknown }));
// The pull runs asynchronously (agent run 1: the blocking call held the world's process); the blocking one is never used.
vi.mock("../src/metal/agentCli.js", async (orig) => ({ ...(await orig<object>()), metalAgent: () => { throw new Error("the blocking call is not used"); }, metalAgentAsync: async () => { cli.calls++; return cli.run(); } }));
vi.mock("../src/metal/chain.js", async (orig) => ({ ...(await orig<object>()), publicClient: () => ({}) }));
vi.mock("@metalntwx/metal-pay/mandates", async (orig) => ({
  ...(await orig<object>()),
  extractTerms: () => ({ constraints: { perPaymentCap: 3n * 10n ** 16n } }),
  readMandateState: async () => ({ boundBlock: 1n, revoked: false, spent: 0n }),
}));

const { recordCapRefusalOnChain } = await import("../src/metal/recordRefusal.js");
const m = { agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "c", keyFile: "k", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" } as never;
const TO = "0x0000000000000000000000000000000000000001" as const;

describe("recordCapRefusalOnChain", () => {
  it("returns Metal's refusal and its transaction", async () => {
    await expect(recordCapRefusalOnChain(m, TO, 4, "p1", "gas")).resolves.toEqual({ tx: "0xabc", reason: "mandate_cap_exceeded" });
  });
  it("an error once metal-agent ran is 'pull sent: …' (an incident for the caller)", async () => {
    cli.run = () => { throw new Error("metal-agent exited 2"); };
    await expect(recordCapRefusalOnChain(m, TO, 4, "p2", "gas")).rejects.toThrow(/^pull sent: metal-agent exited 2/);
  });
  it("a pull Metal did not report refusing is an error the caller treats as an incident", async () => {
    cli.run = () => ({ code: 0, fields: new Map([["transaction", ["0xdef"]]]) });
    await expect(recordCapRefusalOnChain(m, TO, 4, "p3", "gas")).rejects.toThrow(/did not report a refusal/);
  });
  it("nothing is sent for an amount within the cap", async () => {
    const before = cli.calls;
    await expect(recordCapRefusalOnChain(m, TO, 3, "p4", "gas")).rejects.toThrow(/is not over this mandate's cap/);
    expect(cli.calls).toBe(before);
  });
});
