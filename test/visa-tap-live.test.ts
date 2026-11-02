// D25, the live TAP run's script, tested offline: Airwallex's stand-in, a scripted Claude, a pass-through stand-in for
// Visa's reference proxy and registry, and our real merchant server. The record must hold, per step, the TAP keyId and
// nonce, the proxy's HTTP status, our layer's verdict, the Airwallex id confirmed by a read-only GET, the D24 origin,
// and the card brand exactly as the GET returns it (or that it returned none).
import type Anthropic from "@anthropic-ai/sdk";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { freshWorldProblem, runTapLive, type LiveRunDeps } from "../src/visa/tapLiveRun.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}
const buy = (plan: string, rail: string) => ({ name: "buy_software", input: { plan, rail, reason: "The Starter plan is due; Packwise takes a card only." } });
const finish = { name: "finish", input: { summary: "Paid Packwise Starter on my card." } };

let db: DB, awx: FakeIssuing, proxy: Server, proxyUrl: string, merchantPort: number, proxyRefuses: boolean, cardGet: Record<string, unknown>;

const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => ok(p)); }); });

beforeEach(async () => {
  db = openDb(":memory:");
  awx = new FakeIssuing();
  proxyRefuses = false;
  cardGet = { card_id: "x", brand: "VISA", card_status: "ACTIVE" };
  merchantPort = await freePort();
  proxy = createServer((req, res) => {
    if (req.url === "/test-proxy") return void res.writeHead(200).end("ok");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (proxyRefuses) return void res.writeHead(403, { "content-type": "text/html" }).end("<title>Signature Verification Failed</title>");
      const f = request({ host: "127.0.0.1", port: merchantPort, method: req.method, path: req.url, headers: { ...req.headers, host: `localhost:${merchantPort}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      f.end(Buffer.concat(chunks));
    });
  });
  await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", () => ok()));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((ok) => proxy.close(() => ok())); });

const registered: unknown[] = [];
const deps = (client: Anthropic | null): LiveRunDeps => ({
  db, issuing: { rail: awx, sim: awx }, proxyUrl, registryUrl: "http://registry.test", merchantPort, client, refCommit: "16d59bdf3f8a542bc538d0962edbb80ea30a02af",
  readBack: { card: async () => cardGet, transactions: (id) => awx.listCardTransactions(id) },
  sleep: async () => {}, readBackTries: 2,
  fetchImpl: (async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith("http://registry.test")) {
      if (init?.method === "POST") registered.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }
    return fetch(url, init);
  }) as typeof fetch,
});

describe("the live TAP run, offline", () => {
  it("records both steps with keyId, nonce, the proxy's 200, our verdict, the GET-confirmed Airwallex id and the D24 origin", async () => {
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "metal_x402")], [buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.ok).toBe(true);
    expect(r.reference.commit).toMatch(/^16d59bd/);
    const [agent, over] = r.steps;
    expect(agent).toMatchObject({
      by: expect.stringMatching(/Sourcing agent \(claude-haiku/), plan: "packwise-starter", rail: "airwallex_card", ok: true,
      tap: { key_id: r.key_id, nonce: expect.any(String), proxy_status: 200, sig1: "verified", sig2: "verified", merchant: "accepted" },
      airwallex: { approved: true, confirmed_by_get: { approved: true, amount: "19.99", currency: "EUR" } },
      origin: { actor: "agent", agent: "sourcing", tap: { key_id: r.key_id, proxy_status: 200 } },
      note: expect.stringMatching(/metal_x402 \(refused by code: supplier's rails\).*airwallex_card/),
    });
    expect((agent!.origin as { tap: { awx_transaction_id: string } }).tap.awx_transaction_id).toBe(agent!.airwallex!.transaction_id);
    expect(over).toMatchObject({
      by: "code", plan: "packwise-pro", ok: true,
      tap: { proxy_status: 200, merchant: "accepted" },
      airwallex: { approved: false, failure_reason: expect.stringMatching(/LIMIT/), confirmed_by_get: { approved: false } },
      origin: { actor: "code", rule: expect.stringMatching(/over the card's per-purchase limit/) },
    });
    expect(over!.tap!.nonce).not.toBe(agent!.tap!.nonce);
    expect(r.card).toMatchObject({ agent: "sourcing", brand_as_returned: { brand: "VISA" } });
    // The test key went to the reference registry as the raw Ed25519 key, under the keyId the steps name.
    expect(registered.at(-1)).toMatchObject({ keys: [{ key_id: r.key_id, algorithm: "ed25519" }] });
    expect(r.labels.join(" ")).not.toMatch(/certified|endorsed/);
  });

  it("records the brand as Airwallex returns it, and says so when it returns none", async () => {
    cardGet = { card_id: "x", brand: "MASTERCARD" };
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.card!.brand_as_returned).toEqual({ brand: "MASTERCARD" });
    cardGet = { card_id: "x", card_status: "ACTIVE" };
    db = openDb(":memory:");
    awx = new FakeIssuing();
    const r2 = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r2.card!.brand_as_returned).toMatch(/no brand field.*card_id, card_status/);
  });

  it("is not ok, and charges nothing, when the proxy refuses", async () => {
    proxyRefuses = true;
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.ok).toBe(false);
    expect(r.steps[0]!.tap).toMatchObject({ proxy_status: 403, merchant: expect.stringMatching(/refused: .*403/) });
    expect(awx.calls).not.toContain("charge");
  });

  it("is not ok when Claude does not run, and says so", async () => {
    const r = await runTapLive(deps(null));
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toMatchObject({ ok: false, note: expect.stringMatching(/no purchase/) });
  });

  it("stops before anything when the reference is not running", async () => {
    await expect(runTapLive({ ...deps(null), proxyUrl: "http://127.0.0.1:9" })).rejects.toThrow(/reference proxy is not running/);
    expect(awx.calls).toEqual([]);
  });
});

describe("only in a fresh test world", () => {
  it("refuses live-1, the reserve, an existing ledger, and no ledger named", () => {
    expect(freshWorldProblem(undefined, false)).toMatch(/KIT11_DB/);
    expect(freshWorldProblem("data/live-1.sqlite", false)).toMatch(/live-1/);
    expect(freshWorldProblem("/x/reserve/kit11.sqlite", false)).toMatch(/reserve/);
    expect(freshWorldProblem("data/visa-tap-live.sqlite", true)).toMatch(/fresh/);
    expect(freshWorldProblem("data/visa-tap-live-2026-11-02.sqlite", false)).toBeNull();
  });
});
