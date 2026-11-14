// The live commands over real HTTP, as a live run reaches Alta: no injected request, so `runLive` builds its own
// transport (viem's http, one attempt per request) from METAL_RPC_URL. Here that URL is a JSON-RPC server on this
// machine (a random port on 127.0.0.1) that hands every request to the in-memory chain. It holds the wiring a unit
// test cannot: the request shapes on the wire, a revert's reason coming back through a JSON-RPC error, one attempt
// per request, and the RPC URL (a credential) never reaching an output line. No request leaves this machine.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveCommand } from "../src/tokenize/guard.js";
import { openRunLedger } from "../src/tokenize/ledger.js";
import { callLog, runLive } from "../src/tokenize/live.js";
import { callsNeeded, TX_STEPS } from "../src/tokenize/plan.js";
import { liveWorld, removeTokenizeWorlds } from "./support/tokenizeWorld.js";

/** The path of the test server's address: it stands for the credential part of a real RPC URL (built here, not a literal). */
const ENDPOINT = ["rpc", "endpoint", "part", "0123456789abcdef"].join("-");
const SECRET_PATH = `/v1/${ENDPOINT}`;

let world: Awaited<ReturnType<typeof liveWorld>>;
let server: Server;
let url: string;
/** Every JSON-RPC request the server got, in order; `fail` makes the next one of a method answer HTTP 500 once. */
const wire: { method: string; params: unknown[]; path: string }[] = [];
let failOnce: string | null = null;

beforeAll(async () => {
  world = await liveWorld();
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => {
      void (async () => {
        const { id, method, params } = JSON.parse(body) as { id: number; method: string; params?: unknown[] };
        wire.push({ method, params: params ?? [], path: req.url ?? "" });
        if (failOnce === method) { failOnce = null; res.statusCode = 500; res.end("upstream unavailable"); return; }
        res.setHeader("content-type", "application/json");
        try {
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result: await world.chain.request({ method, params: params ?? [] }) }));
        } catch (e) {
          const err = e as Error & { code?: number; data?: string };
          res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: err.code ?? -32000, message: err.message, ...(err.data ? { data: err.data } : {}) } }));
        }
      })();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${SECRET_PATH}`;
}, 60_000);
afterAll(async () => {
  await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
  removeTokenizeWorlds(); // the keys, ledgers and call log this file made
});

/** A command as the CLI runs it: its own transport from METAL_RPC_URL; only the settlement token is the stand-in's. */
async function live(cmd: LiveCommand, over: Record<string, string | undefined> = {}) {
  const out: string[] = [], errs: string[] = [];
  const before = wire.length;
  const code = await runLive(cmd, { env: { ...world.env, METAL_RPC_URL: url, ...over }, io: { say: (s) => out.push(s), err: (s) => errs.push(s) }, settlement: world.settlement, sleep: async () => {} });
  return { code, text: [...out, ...errs].join("\n"), requests: wire.slice(before).map((w) => w.method) };
}

describe("tokenize live over HTTP on this machine", () => {
  it("runs the whole flow through its own transport, with the requests the plan counts, and names a revert from the node's answer", async () => {
    const counts: Record<string, number> = {};
    for (const step of [...TX_STEPS, "verify" as const]) {
      const need = callsNeeded(step, world.statusOf);
      const o = await live(step);
      expect({ step, code: o.code, text: o.text }).toMatchObject({ step, code: 0 });
      expect({ step, onTheWire: o.requests.length }).toEqual({ step, onTheWire: need });
      counts[step] = o.requests.length;
    }
    expect(counts).toEqual({ fund: 14, deploy: 4, mint: 4, finance: 10, settle: 6, verify: 1 });
    expect(world.chain.mined.length - world.baseline).toBe(11);
    expect(world.txs().every((t) => t.status === "success")).toBe(true);
    // The chain id is never asked of the node by these commands (it is answered locally); preflight asks it for real.
    expect(wire.map((w) => w.method)).not.toContain("eth_chainId");
    const pre = await live("preflight");
    expect(pre.code).toBe(0);
    expect(pre.requests).toEqual(["eth_chainId", "eth_call", "eth_call", "eth_call", "eth_call"]);
    // The shapes on the wire: the estimate names the sender, the target and the data, and nothing else; the nonce is
    // asked as pending; the transaction goes out as one raw EIP-1559 transaction.
    const estimate = wire.find((w) => w.method === "eth_estimateGas" && (w.params[0] as { to?: string }).to)!;
    expect(Object.keys(estimate.params[0] as object).sort()).toEqual(["data", "from", "to"]);
    expect(estimate.params).toHaveLength(1);
    const deployEstimate = wire.find((w) => w.method === "eth_estimateGas")!;
    expect(Object.keys(deployEstimate.params[0] as object).sort()).toEqual(["data", "from"]);
    expect(wire.find((w) => w.method === "eth_getTransactionCount")!.params[1]).toBe("pending");
    for (const w of wire.filter((x) => x.method === "eth_sendRawTransaction")) { expect(w.params).toHaveLength(1); expect(w.params[0]).toMatch(/^0x02[0-9a-f]+$/); }
    expect(wire.every((w) => w.path === SECRET_PATH)).toBe(true);

    // A second ledger tries the same invoice on the same contract: the node's estimate reverts, and the contract's
    // own reason comes back through the JSON-RPC error.
    const second = { TOKENIZE_DB: join(world.dir, "tokenize-second.sqlite") };
    const l1 = openRunLedger(world.env.TOKENIZE_DB!, { readonly: true }), l2 = openRunLedger(second.TOKENIZE_DB);
    for (const k of ["roles", "funding", "contract"]) l2.put(k, l1.get(k)!);
    l1.close(); l2.close();
    const mined = world.chain.mined.length;
    const dup = await live("mint", second);
    expect(dup.code).toBe(2);
    expect(dup.text).toMatch(/REFUSED {2}mint the invoice token: the chain would refuse it \(AlreadyTokenized\); nothing signed, nothing sent/);
    expect(dup.requests).toEqual(["eth_estimateGas"]);
    expect(world.chain.mined.length).toBe(mined);
  }, 120_000);

  it("makes one attempt per request, stops when the node fails, and never prints the RPC URL", async () => {
    // The node answers HTTP 500 once: the command stops; the request was sent once, not retried, and counted once.
    const logged = callLog(world.env.TOKENIZE_CALL_LOG!).count();
    failOnce = "eth_call";
    const failed = await live("verify");
    expect(failed.code).toBe(3);
    expect(failed.text).toMatch(/STOPPED {2}a request to the RPC failed \(.*\)\. Run the command again: it continues from the journal/);
    expect(failed.requests).toEqual(["eth_call"]);
    expect(callLog(world.env.TOKENIZE_CALL_LOG!).count()).toBe(logged + 1);
    expect((await live("verify")).code).toBe(0);
    // The node is gone altogether.
    const down = await live("verify", { METAL_RPC_URL: `http://127.0.0.1:1${SECRET_PATH}` });
    expect(down.code).toBe(3);
    expect(down.text).toMatch(/STOPPED {2}a request to the RPC failed/);
    // No output line of any command carried the endpoint's path (the credential part of the URL).
    for (const o of [failed, down]) expect(o.text).not.toContain(ENDPOINT);
  }, 60_000);
});
