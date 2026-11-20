// Metal's JSON-RPC helper (src/metal/network.ts). The RPC URL is a credential: no error it raises may quote it, even
// when fetch's own error does. Each failure (no URL, unreachable, an HTTP error, a JSON-RPC error) is an RpcError
// naming the method, never a silent undefined.
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpc, rpcUrl, RpcError } from "../src/metal/network.js";

const SECRET_URL = "https://rpc.example/v1/key-0123456789abcdef";
afterEach(() => { vi.unstubAllGlobals(); });

describe("the RPC URL", () => {
  it("is read from the environment and refused when missing", () => {
    expect(rpcUrl({ METAL_RPC_URL: SECRET_URL })).toBe(SECRET_URL);
    expect(() => rpcUrl({})).toThrow("METAL_RPC_URL is not set");
  });
});

describe("rpc", () => {
  it("posts one JSON-RPC 2.0 call and answers its result", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await rpc<string>("eth_blockNumber", [], SECRET_URL)).toBe("0x10");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SECRET_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
  });

  it("an unreachable RPC is named without its URL, whatever fetch's own error says", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`fetch failed: connect ECONNREFUSED ${SECRET_URL}`); }));
    const e = await rpc<string>("eth_chainId", [], SECRET_URL).then(() => new Error("expected a refusal"), (x: unknown) => x as Error);
    expect(e).toBeInstanceOf(RpcError);
    expect(e.message).toBe("eth_chainId: RPC unreachable");
    expect(JSON.stringify({ m: e.message, s: e.stack, c: (e as { cause?: unknown }).cause })).not.toContain("key-0123456789abcdef");
  });

  it("an HTTP error is an RpcError with its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(rpc("eth_call", [{}], SECRET_URL)).rejects.toThrow(new RpcError("eth_call: RPC HTTP 429"));
  });

  it("a JSON-RPC error is an RpcError with the node's message, or a plain one without", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } }), { status: 200 })));
    await expect(rpc("eth_call", [], SECRET_URL)).rejects.toThrow("eth_call: execution reverted");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603 } }), { status: 200 })));
    await expect(rpc("eth_call", [], SECRET_URL)).rejects.toThrow("eth_call: error");
  });

  it("without a URL given, uses METAL_RPC_URL, and refuses before any request when it is unset", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await expect(rpc("eth_chainId")).rejects.toThrow("METAL_RPC_URL is not set");
    expect(f).not.toHaveBeenCalled();
  });
});
