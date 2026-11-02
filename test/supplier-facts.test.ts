// Agent run 1 (2 November): two agents stated a wrong fact about the suppliers, each from code's facts.
// 1. Sourcing's market tool said "Stockline: not reachable now" while Stockline was serving: the world's process was
//    blocked recording the refusal on chain (spawnSync), and code's single price check got no answer. Now the check
//    asks once more when it got no answer at all, says what it got, and the recording no longer blocks the process.
// 2. Treasury's facts gave Ridgeline's price and not that it answered 503 (maintenance); it pointed Sourcing at it.
//    Now its position says, from the same check, whether each supplier answers.
// Local stand-in servers and fakes only; never the real API, the chain or Airwallex.
import { createServer, type Server } from "node:http";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSupplier, supplierView } from "../src/autonomy/sourcingProfile.js";
import { sourcingBrief } from "../src/autonomy/sourcingCore.js";
import { treasuryProfile, type TreasurySim } from "../src/autonomy/teamProfiles.js";
import { openDb } from "../src/db/open.js";
import { metalAgentAsync } from "../src/metal/agentCli.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((ok) => { s.closeAllConnections(); s.close(() => ok()); }))); });

/** A stand-in /v1/info: `answer(n)` for the n-th request (1-based) returns [status, body], or null to hold it unanswered. */
function stand(answer: (n: number) => [number, unknown] | null): Promise<{ base: string; asked: () => number }> {
  let n = 0;
  return new Promise((ok) => {
    const s = createServer((_req, res) => { const a = answer(++n); if (a) res.writeHead(a[0], { "content-type": "application/json" }).end(JSON.stringify(a[1])); });
    servers.push(s);
    s.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, asked: () => n }));
  });
}
const FAST = { timeoutMs: 200, pauseMs: 10 };

describe("code's price check of a supplier (agent run 1, 10:48)", () => {
  it("asks once more when the first check got no answer, and then reports the supplier's price", async () => {
    const s = await stand((n) => (n === 1 ? null : [200, { price: "0.04", data_age_seconds: 5 }]));
    const a = await checkSupplier(s.base, FAST);
    expect(a).toEqual({ info: { price: "0.04", data_age_seconds: 5 } });
    expect(s.asked()).toBe(2);
  });

  it("takes an error answer (503 for maintenance) as the supplier's answer, at once, and says so", async () => {
    const s = await stand(() => [503, { error: "offline for planned maintenance" }]);
    expect(await checkSupplier(s.base, FAST)).toEqual({ why: "answered HTTP 503", answered: true });
    expect(s.asked()).toBe(1);
  });

  it("says when nothing answered twice, and how", async () => {
    const held = await stand(() => null);
    expect(await checkSupplier(held.base, FAST)).toMatchObject({ why: "no answer within 0.2 s, checked twice" });
    const gone = await stand(() => null);
    const port = gone.base;
    await new Promise<void>((ok) => { const s = servers.pop()!; s.close(() => ok()); });
    expect(await checkSupplier(port, FAST)).toMatchObject({ why: "nothing answers on its address, checked twice" });
  });

  it("the Sourcing agent's facts carry the check's answer: the price when it answered, the reason when it did not", async () => {
    const db = openDb(":memory:");
    const stockline = await stand((n) => (n === 1 ? null : [200, { price: "0.04", data_age_seconds: 5 }]));
    const ridgeline = await stand(() => [503, { error: "offline" }]);
    const views = await Promise.all([supplierView(db, "stockline", stockline.base, FAST), supplierView(db, "ridgeline", ridgeline.base, FAST)]);
    const brief = sourcingBrief({ suppliers: views, capCents: 3, budgetLeftCents: 966, sellCents: 5, policy: { supplier: "stockline", max_price: null, cache_seconds: 0 }, card: null });
    expect(brief).toMatch(/- Stockline \(stockline\): 0\.04 a stock check, data 5 s old; margin at that price 0\.01;/);
    expect(brief).toMatch(/- Ridgeline Data \(ridgeline\): not reachable now \(code's price check: answered HTTP 503\);/);
  });
});

describe("the Treasury agent's position names whether each supplier answers (agent run 1, 10:49)", () => {
  const sim: TreasurySim = {
    mandates: async () => [{ agent: "sourcing", capCents: 3, budgetCents: 1000, spentCents: 34 }],
    proposePriceRise: async () => [], client: null, sweep: async () => ({ ok: true, text: "" }), planInvoice: async () => ({ ok: true, text: "" }),
  };
  const noFlow = () => ({ ok: false, text: "" });

  it("with code's check: Stockline answering at its price, Ridgeline not reachable with what the check got", async () => {
    const db = openDb(":memory:");
    const stockline = await stand(() => [200, { price: "0.04", data_age_seconds: 5 }]);
    const ridgeline = await stand(() => [503, { error: "offline" }]);
    const seen = await treasuryProfile(30 * 60_000, { runFlow: noFlow, sim, suppliers: (d) => Promise.all([supplierView(d, "stockline", stockline.base, FAST), supplierView(d, "ridgeline", ridgeline.base, FAST)]) }).observe(db);
    expect(seen).toMatch(/Query price 0\.05\. Suppliers now, by code's price check of each: Stockline 0\.04 a stock check, answering; Ridgeline Data \(0\.03 a stock check when it answers\) not reachable now \(answered HTTP 503\)\./);
  });

  it("without a check (or when it cannot run), the prices as before", async () => {
    const db = openDb(":memory:");
    expect(await treasuryProfile(30 * 60_000, { runFlow: noFlow, sim }).observe(db)).toMatch(/Query price 0\.05; Stockline 0\.02, Ridgeline Data 0\.03 a stock check\./);
    const broken = await treasuryProfile(30 * 60_000, { runFlow: noFlow, sim, suppliers: async () => { throw new Error("no addresses"); } }).observe(db);
    expect(broken).toMatch(/Query price 0\.05; Stockline 0\.02, Ridgeline Data 0\.03 a stock check\./);
  });
});

describe("metalAgentAsync: the CLI runs without blocking the process (the world keeps serving)", () => {
  const dir = mkdtempSync(join(tmpdir(), "metal-async-"));
  vi.stubEnv("KIT11_KEYS_DIR", join(dir, "keys"));
  const script = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };

  it("parses the CLI's lines and its exit code, while timers keep firing", async () => {
    const bin = script("refuse.sh", "sleep 0.4\necho \"refused mandate_cap_exceeded\"\necho \"transaction 0xabc\"\nexit 1");
    let ticks = 0;
    const t = setInterval(() => { ticks++; }, 20);
    const r = await metalAgentAsync(["mandate", "pull"], [0, 1], bin);
    clearInterval(t);
    expect(r.code).toBe(1);
    expect(r.fields.get("refused")).toEqual(["mandate_cap_exceeded"]);
    expect(r.fields.get("transaction")).toEqual(["0xabc"]);
    expect(ticks).toBeGreaterThan(5);
  });

  it("an exit code that is not an outcome, or an error line, is an error, as with metalAgent", async () => {
    await expect(metalAgentAsync(["mandate", "pull"], [0, 1], script("fail.sh", "exit 2"))).rejects.toThrow(/exited 2/);
    await expect(metalAgentAsync(["mandate", "pull"], [0, 1], script("err.sh", "echo \"error: bad input\"\nexit 1"))).rejects.toThrow(/exited 1/);
    await expect(metalAgentAsync(["mandate", "pull"], [0, 1], join(dir, "missing"))).rejects.toThrow(/exited -1/);
  });
});
