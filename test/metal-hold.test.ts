// The CFO-approved hold on Metal: reserve exactly the signed amount, show the chain refuses one unit more, capture the
// exact amount. No network: the deps are fakes that record what would be sent.
import { describe, expect, it } from "vitest";
import { budgetedTransport, runApprovedHold, type HoldDeps, type HoldPlan } from "../src/metal/hold.js";
import { centsToBaseUnits } from "../src/lib/money.js";

const plan: HoldPlan = {
  approvedCents: 25, termsHash: "a".repeat(64),
  holder: "0x00000000000000000000000000000000000000a1", spender: "0x00000000000000000000000000000000000000b2", supplier: "0x00000000000000000000000000000000000000c3",
};

function fake(over: Partial<{ simOk: boolean }> = {}) {
  const calls: string[] = [];
  let held = 0n;
  const deps: HoldDeps = {
    approve: async (_s, a) => { calls.push(`approve ${a}`); return "0x01"; },
    placeHold: async (_h, a) => { calls.push(`hold ${a}`); held += a; return "0x02"; },
    simulateCapture: async (_h, _t, a) => { calls.push(`simulate ${a}`); return over.simOk ?? a <= held ? { ok: true, reason: null } : { ok: false, reason: "execution reverted" }; },
    capture: async (_h, _t, a) => { calls.push(`capture ${a}`); held -= a; return "0x03"; },
  };
  return { deps, calls, held: () => held };
}

describe("CFO-approved hold on Metal", () => {
  it("reserves exactly the approved amount, proves one unit more is refused, captures the exact amount", async () => {
    const f = fake();
    const r = await runApprovedHold(plan, f.deps);
    const amount = centsToBaseUnits(25);
    expect(f.calls).toEqual([`approve ${amount}`, `hold ${amount}`, `simulate ${amount + 1n}`, `capture ${amount}`]);
    expect(r.overCapture).toEqual({ baseUnits: (amount + 1n).toString(), refusedByChain: true, reason: "execution reverted" });
    expect(r.approved).toEqual({ cents: 25, baseUnits: amount.toString() });
    expect(f.held()).toBe(0n);
    expect(r.explorer).toHaveLength(3);
  });
  it("reports each id as soon as it exists, so a stopped run still names what landed", async () => {
    const f = fake();
    const steps: string[] = [];
    await runApprovedHold(plan, f.deps, (s, d) => steps.push(`${s}:${d}`));
    expect(steps).toEqual(["approve:0x01", "hold:0x02", "over-capture-refused:execution reverted", "capture:0x03"]);
  });
  it("never captures when the chain would accept more than the approval", async () => {
    const f = fake({ simOk: true });
    await expect(runApprovedHold(plan, f.deps)).rejects.toThrow(/above the approved amount/);
    expect(f.calls.some((c) => c.startsWith("capture"))).toBe(false);
  });
  it("refuses a missing or malformed approval before touching the chain", async () => {
    const f = fake();
    await expect(runApprovedHold({ ...plan, approvedCents: 0 }, f.deps)).rejects.toThrow(/positive/);
    await expect(runApprovedHold({ ...plan, termsHash: "nope" }, f.deps)).rejects.toThrow(/SHA-256/);
    expect(f.calls).toEqual([]);
  });
});

describe("Metal RPC budget", () => {
  it("answers eth_chainId locally and stops past the budget", async () => {
    const seen: string[] = [];
    const b = budgetedTransport("http://127.0.0.1:9", 0, (m) => seen.push(m));
    const t = b.transport({ chain: undefined, retryCount: 0 });
    expect(await t.request({ method: "eth_chainId" })).toBe("0xf951");
    await expect(t.request({ method: "eth_blockNumber" })).rejects.toThrow(/budget of 0/);
    expect(seen).toEqual([]);
    expect(b.used()).toBe(0);
  });
});
