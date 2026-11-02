// Agent run 1 (2 November): the world's process recorded the price-rise refusal on chain with a blocking call, and for
// those seconds Stockline (served by the same process) did not answer the Sourcing agent's price check. The recording's
// whole path now runs the CLI asynchronously: the gas key's creation (once, even for two recordings at once), its
// top-up and the pull. Its checks before sending are unchanged. Mocks only: no chain, no CLI, no faucet.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "refusal-gas-"));
const calls: string[] = [];
let funded = 0;
vi.mock("../src/metal/agentCli.js", () => ({
  keyPath: (n: string) => join(dir, n),
  metalAgent: () => { calls.push("sync"); throw new Error("the blocking call must not be used for the recording"); },
  metalAgentAsync: async (args: string[]) => {
    calls.push(`async ${args.slice(0, 2).join(" ")}`);
    if (args[0] === "key") { await new Promise((r) => setTimeout(r, 30)); writeFileSync(args[3]!, "{}"); return { code: 0, out: "", fields: new Map() }; }
    return { code: 1, out: "", fields: new Map([["refused", ["mandate_cap_exceeded"]], ["transaction", ["0xref"]]]) };
  },
}));
vi.mock("../src/metal/testFunds.js", () => ({ fundTestWallet: async () => { funded++; return "enough"; } }));
vi.mock("@metalntwx/metal-pay/mandates", async () => {
  const cap = (await import("../src/lib/money.js")).centsToBaseUnits(3);
  return { extractTerms: () => ({ constraints: { perPaymentCap: cap } }), readMandateState: async () => ({ boundBlock: 5n, revoked: false }) };
});
vi.mock("../src/metal/chain.js", () => ({ publicClient: () => ({}), readKeyFile: () => ({ privateKey: `0x${"1".repeat(64)}` }) }));

const { recordCapRefusalOnChain } = await import("../src/metal/recordRefusal.js");
const m = { credential: {}, credentialPath: "/c.json", keyFile: "/k.json", principal: "0x1", reference: "0xref" } as never;
const to = "0x000000000000000000000000000000000000beef";

describe("recording the refusal on chain (agent run 1, 10:48)", () => {
  it("without a gas key given: creates it once for two recordings at once, tops it up, pulls; only asynchronous calls", async () => {
    calls.length = 0;
    const both = await Promise.all([recordCapRefusalOnChain(m, to, 4, "refusal-x-18"), recordCapRefusalOnChain(m, to, 4, "refusal-x-19")]);
    expect(both).toEqual([{ tx: "0xref", reason: "mandate_cap_exceeded" }, { tx: "0xref", reason: "mandate_cap_exceeded" }]);
    expect(calls.filter((c) => c === "async key create")).toHaveLength(1);
    expect(calls.filter((c) => c === "async mandate pull")).toHaveLength(2);
    expect(calls).not.toContain("sync");
    expect(funded).toBe(2);
  });

  it("still sends nothing for an amount within the cap", async () => {
    calls.length = 0;
    await expect(recordCapRefusalOnChain(m, to, 3, "refusal-x-20", "/gas.key")).rejects.toThrow(/not over this mandate's cap/);
    expect(calls).toEqual([]);
  });
});
