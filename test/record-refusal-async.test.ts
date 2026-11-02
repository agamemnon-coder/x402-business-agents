// Agent run 1 (2 November): the world's process recorded the price-rise refusal on chain with a blocking call, and for
// those seconds Stockline (served by the same process) did not answer the Sourcing agent's price check. The recording
// now runs the CLI asynchronously; its checks before sending are unchanged. Mocks only: no chain, no CLI.
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../src/metal/agentCli.js", () => ({
  keyPath: (n: string) => `/keys/${n}`,
  metalAgent: () => { calls.push("sync"); throw new Error("the blocking call must not be used for the recording"); },
  metalAgentAsync: async (args: string[]) => { calls.push(`async ${args.slice(0, 2).join(" ")}`); return { code: 1, out: "", fields: new Map([["refused", ["mandate_cap_exceeded"]], ["transaction", ["0xref"]]]) }; },
}));
vi.mock("@metalntwx/metal-pay/mandates", async () => {
  const cap = (await import("../src/lib/money.js")).centsToBaseUnits(3);
  return { extractTerms: () => ({ constraints: { perPaymentCap: cap } }), readMandateState: async () => ({ boundBlock: 5n, revoked: false }) };
});
vi.mock("../src/metal/chain.js", () => ({ publicClient: () => ({}), readKeyFile: () => ({ privateKey: `0x${"1".repeat(64)}` }) }));

const { recordCapRefusalOnChain } = await import("../src/metal/recordRefusal.js");
const m = { credential: {}, credentialPath: "/c.json", keyFile: "/k.json", principal: "0x1", reference: "0xref" } as never;
const to = "0x000000000000000000000000000000000000beef";

describe("recording the refusal on chain (agent run 1, 10:48)", () => {
  it("runs the CLI asynchronously and returns Metal's reason and transaction", async () => {
    calls.length = 0;
    expect(await recordCapRefusalOnChain(m, to, 4, "refusal-x-18", "/gas.key")).toEqual({ tx: "0xref", reason: "mandate_cap_exceeded" });
    expect(calls).toEqual(["async mandate pull"]);
  });

  it("still sends nothing for an amount within the cap", async () => {
    calls.length = 0;
    await expect(recordCapRefusalOnChain(m, to, 3, "refusal-x-19", "/gas.key")).rejects.toThrow(/not over this mandate's cap/);
    expect(calls).toEqual([]);
  });
});
