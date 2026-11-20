// The CFO-approved hold's live adapter (src/metal/hold.ts liveHoldDeps), against a JSON-RPC stand-in on this machine:
// the read-only over-capture check counts only a contract revert as the chain refusing one unit more than the approval.
// A node that fails for any other reason (an error that is no revert, an HTTP failure) is never read as a refusal, and
// a run past its RPC budget stops, so a capture is never made on a check that did not happen.
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { liveHoldDeps } from "../src/metal/hold.js";

type Mode = "revert" | "other-error" | "http-500" | "ok";
let mode: Mode = "revert";
const methods: string[] = [];
let server: Server;
let url = "";
let dir = "";
const holderFile = () => join(dir, "holder.json");
const spenderFile = () => join(dir, "spender.json");
const SUPPLIER = "0x00000000000000000000000000000000000000c3" as const;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const calls = JSON.parse(body) as { id: number; method: string } | { id: number; method: string }[];
      const one = (c: { id: number; method: string }) => {
        methods.push(c.method);
        if (c.method === "eth_chainId") return { jsonrpc: "2.0", id: c.id, result: "0xf951" };
        if (mode === "revert") return { jsonrpc: "2.0", id: c.id, error: { code: 3, message: "execution reverted: hold exceeded", data: "0x" } };
        if (mode === "other-error") return { jsonrpc: "2.0", id: c.id, error: { code: -32000, message: "header not found" } };
        return { jsonrpc: "2.0", id: c.id, result: "0x" };
      };
      if (mode === "http-500") { res.writeHead(500, { "content-type": "text/plain" }); res.end("upstream down"); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Array.isArray(calls) ? calls.map(one) : one(calls)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
  dir = mkdtempSync(join(tmpdir(), "hold-keys-"));
  for (const f of [holderFile(), spenderFile()]) {
    const pk = generatePrivateKey();
    writeFileSync(f, JSON.stringify({ address: privateKeyToAccount(pk).address, privateKey: pk }));
  }
  process.env.METAL_RPC_URL = url;
});
afterAll(async () => {
  delete process.env.METAL_RPC_URL;
  rmSync(dir, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => { methods.length = 0; });

const deps = (maxCalls = 10, onCall?: (m: string) => void) => liveHoldDeps({ holderKeyFile: holderFile(), spenderKeyFile: spenderFile(), maxCalls, onCall });
const holder = () => privateKeyToAccount((JSON.parse(readFileSync(holderFile(), "utf8")) as { privateKey: `0x${string}` }).privateKey).address;

describe("the over-capture check on the live chain", () => {
  it("a contract revert is the chain refusing: one short line, nothing sent", async () => {
    mode = "revert";
    const seen: string[] = [];
    const d = deps(10, (m) => seen.push(m));
    const r = await d.deps.simulateCapture(holder(), SUPPLIER, 2_500_001n);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/revert/i);
    expect(r.reason!.length).toBeLessThanOrEqual(200);
    expect(r.reason).not.toContain("\n");
    // Read-only: an eth_call, never a transaction.
    expect(seen).toEqual(["eth_call"]);
    expect(methods.filter((m) => m.startsWith("eth_send"))).toEqual([]);
    expect(d.used()).toBe(1);
  });

  it("a node error that is no revert is not a refusal: the check fails and says so", async () => {
    mode = "other-error";
    await expect(deps().deps.simulateCapture(holder(), SUPPLIER, 1n)).rejects.toThrow(/^hold: the over-capture check failed without a revert/);
  });

  it("an HTTP failure is not a refusal either", async () => {
    mode = "http-500";
    await expect(deps().deps.simulateCapture(holder(), SUPPLIER, 1n)).rejects.toThrow(/over-capture check failed without a revert/);
  });

  it("past the RPC budget the run stops: the budget's own error, not a refusal", async () => {
    mode = "revert";
    await expect(deps(0).deps.simulateCapture(holder(), SUPPLIER, 1n)).rejects.toThrow(/Metal RPC budget of 0 calls reached/);
    expect(methods).toEqual([]);
  });

  it("a chain that would accept the capture answers ok, which makes runApprovedHold stop before paying", async () => {
    mode = "ok";
    expect(await deps().deps.simulateCapture(holder(), SUPPLIER, 1n)).toEqual({ ok: true, reason: null });
  });

  it("a key file that is not one is refused without its contents in the message", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "0xdeadbeef-not-json");
    expect(() => liveHoldDeps({ holderKeyFile: bad, spenderKeyFile: spenderFile(), maxCalls: 1 })).toThrow(`not a metal-agent key file: ${bad}`);
    expect(() => liveHoldDeps({ holderKeyFile: join(dir, "missing.json"), spenderKeyFile: spenderFile(), maxCalls: 1 })).toThrow(/cannot be read \(ENOENT\)/);
  });
});
