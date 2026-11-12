// A stand-in chain behind a JSON-RPC endpoint on this machine (127.0.0.1), for the code that builds its own transport
// from METAL_RPC_URL: the runner's relay (src/metal/passkeyRelay.ts liveRelay). Each request is handed to `rpc`, and
// its answer or its error goes back as a node's would. Nothing leaves this machine.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function serveRpc(rpc: (a: { method: string; params?: readonly unknown[] }) => Promise<unknown>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body) as { id: number; method: string; params?: readonly unknown[] };
      const answer = (o: object) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id, ...o })); };
      rpc({ method, ...(params ? { params } : {}) }).then(
        (result) => answer({ result }),
        (e: Error & { code?: number; data?: string }) => answer({ error: { code: e.code ?? -32603, message: e.message, ...(e.data ? { data: e.data } : {}) } }),
      );
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((ok) => { server.close(() => ok()); }) };
}
