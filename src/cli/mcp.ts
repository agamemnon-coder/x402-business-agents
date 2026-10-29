// npm run -s mcp: the agent API as an MCP server on stdio (P1). Whoever sets it up names the outside agent it serves:
//   KIT11_AGENT=acme-research npm run -s mcp
// with the runner's ledger (KIT11_DB) and the Airwallex sandbox keys in the environment. stdout is the MCP channel,
// so this process writes nothing else there; its few log lines go to stderr.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { openDb } from "../db/open.js";
import { agentApiServer } from "../platform/mcpServer.js";
import { agentId } from "../platform/externalAgents.js";

const id = agentId(process.env.KIT11_AGENT ?? "");
const server = agentApiServer(openDb(), id, issuingFromEnv()?.sim ?? null);
await server.connect(new StdioServerTransport());
console.error(`agent API: serving ${id} on stdio`);
