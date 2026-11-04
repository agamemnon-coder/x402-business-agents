// npm run -s mcp: the agent API as an MCP server on stdio (P1). Whoever sets it up names the outside agent it serves:
//   KIT11_AGENT=acme-research npm run -s mcp
//   KIT11_AGENT_KEY: the agent's key, once npm run principals -- rotate gave it one (a rotated or missing key is refused)
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
