// Metal testnet constants (build plan 1.3) and a tiny JSON-RPC helper.
// The RPC URL is a credential: it is read from the environment and never printed or logged.

export const CHAIN_ID = 63825;
export const USDZ = "0x000000000000000000000000000000000000B5d5" as const;
export const FACILITATOR_ROOT = "https://x402-testnet.metalntwx.com";
export const FACILITATOR_URL = `${FACILITATOR_ROOT}/x402/facilitator`;
export const EXPLORER_TX = "https://testnet.metalntwx.com/tx/";

export function rpcUrl(env = process.env): string {
  const url = env.METAL_RPC_URL;
  if (!url) throw new Error("METAL_RPC_URL is not set");
  return url;
}

export class RpcError extends Error {}

export async function rpc<T>(method: string, params: unknown[] = [], url = rpcUrl()): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  } catch {
    // The fetch error can quote the URL, so it is not passed on.
    throw new RpcError(`${method}: RPC unreachable`);
  }
  if (!res.ok) throw new RpcError(`${method}: RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new RpcError(`${method}: ${body.error.message ?? "error"}`);
  return body.result as T;
}

export interface ConsensusStatus {
  head: { hash: string; number: number };
  finalized: { hash: string; number: number };
}
