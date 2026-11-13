// npm run mcp:local [port]: Purser Cloud's MCP server on this machine (the Worker's own handler over SQLite, no network,
// the demo company only), so any MCP client or the MCP Inspector can be pointed at it:
//   npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http --method tools/list \
//     --header "Authorization: Bearer purser-demo-read-only"
// Read only, made-up data. It serves /mcp, the OAuth sign-in and /connect-ai; Ctrl-C stops it.

import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../cloud/src/node.js";

const port = Number(process.argv[2] ?? 8787);
const origin = `http://localhost:${port}`;
const env: CloudEnv = {
  sql: sqliteSql(":memory:"), blobs: dirBlobs(mkdtempSync(join(tmpdir(), "purser-mcp-"))), sessionSecret: randomBytes(32).toString("base64url"),
  adminTokenSha256: createHash("sha256").update(randomBytes(32)).digest("hex"), rpId: "localhost", origin,
  rate: { perMinute: 10_000, signInPerMinute: 1_000, failedAuthPerMinute: 1_000 },
  outbound: (url: string, init: RequestInit) => fetch(url, init),
};
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const r = await handle(new Request(`${origin}${req.url}`, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`Purser MCP (demo company, read only) at ${origin}/mcp; token purser-demo-read-only`));
