// npm run metal-inspect (src/cli/metalInspect.ts): the read-only mandate check from a clone. Without METAL_RPC_URL it
// prints the record's read of 12 November, labelled as recorded; with a stand-in RPC (no network) it reads "live" at most
// CLI_CEILING calls and never prints the URL; `refusal <tx>` decodes a MandateRefused event from the record, or from a
// receipt the stand-in returns.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLI_CEILING, metalInspect } from "../src/cli/metalInspect.js";

const RECORD = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-metal-inspector.json", import.meta.url), "utf8")) as {
  read: { block: number; block_hex: string; mandates: { agent: string; spent: string; occurrences: number; call: { data: string }; result_hex: string }[] };
  refusals: { tx: string; block: number; event: { mandate: string; amount: string; reason: number; reason_name: string }; raw_log: { address: string; topics: string[]; data: string } }[];
};
// Made up, and spelled so no scanner takes it for a real credential: it stands for a provider URL with its access value.
const URL_WITH_KEY = "https://rpc.example.invalid/v2/FAKE0path0value0123456789?x=FAKE0query0value987";

function standIn(receipt: unknown = null) {
  const calls: string[] = [];
  const answers = new Map(RECORD.read.mandates.map((m) => [m.call.data, m.result_hex]));
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    calls.push(body.method);
    if (body.method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x18cc66a" });
    if (body.method === "eth_getTransactionReceipt") return Response.json({ jsonrpc: "2.0", id: body.id, result: receipt });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: answers.get((body.params[0] as { data: string }).data) ?? "0x" });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("npm run metal-inspect", () => {
  it("prints the record's read, labelled as recorded, when no RPC is set: no call", async () => {
    const r = await metalInspect([]);
    expect(r.code).toBe(0);
    expect(r.out[0]).toBe(`Recorded on 2026-11-12 at block ${RECORD.read.block}, a read-only check (live read: METAL_RPC_URL is not set).`);
    for (const m of RECORD.read.mandates) expect(r.out.join("\n")).toMatch(new RegExp(`^${m.agent} +${m.spent.replace(".", "\\.")} +${m.occurrences} +no `, "m"));
    expect(r.out.join("\n")).not.toMatch(/live from/);
  });

  it("reads live through a stand-in RPC within its ceiling, and never prints the URL", async () => {
    const rpc = standIn();
    const r = await metalInspect([], { rpcUrl: URL_WITH_KEY, fetcher: rpc.fetcher, now: () => new Date("2026-11-13T09:00:00.000Z") });
    expect(r.out[0]).toBe(`Read live from Metal testnet at 09:00:00 UTC, block ${0x18cc66a}.`);
    expect(rpc.calls).toEqual(["eth_blockNumber", "eth_call", "eth_call", "eth_call"]);
    expect(rpc.calls.length).toBeLessThanOrEqual(CLI_CEILING);
    expect(r.out.join("\n")).not.toMatch(/FAKE0|rpc\.example/);
  });

  it("decodes both refusals of the record, and a receipt's refusal read live", async () => {
    for (const x of RECORD.refusals) {
      const r = await metalInspect(["refusal", x.tx]);
      expect(r.code).toBe(0);
      const out = r.out.join("\n");
      expect(out).toContain(`MandateRefused in ${x.tx} (block ${x.block})`);
      expect(out).toContain(`ref        ${x.event.mandate.toLowerCase()}`);
      expect(out).toContain(`amount     ${x.event.amount} *USDZ`);
      expect(out).toContain(`reason     ${x.event.reason} (${x.event.reason_name})`);
    }
    const other = `0x${"cd".repeat(32)}`;
    expect((await metalInspect(["refusal", other])).code).toBe(1);
    const rpc = standIn({ blockNumber: "0x10", logs: [{ address: "0x00", topics: ["0x01"], data: "0x" }, RECORD.refusals[0]!.raw_log] });
    const live = await metalInspect(["refusal", other], { rpcUrl: URL_WITH_KEY, fetcher: rpc.fetcher });
    expect(live.code).toBe(0);
    expect(live.out.join("\n")).toContain("reason     8 (OverPerPaymentCap)");
    expect(rpc.calls).toEqual(["eth_getTransactionReceipt"]);
    expect(live.out.join("\n")).not.toMatch(/FAKE0|rpc\.example/);
    expect((await metalInspect(["refusal", other], { rpcUrl: URL_WITH_KEY, fetcher: standIn(null).fetcher })).out[0]).toMatch(/no receipt for this transaction/);
    expect((await metalInspect(["refusal", "0x12"])).code).toBe(2);
    expect((await metalInspect(["something"])).code).toBe(2);
  });
});
