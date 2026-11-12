// npm run outside-agent -- "<goal>": a Claude agent that is not one of ours connects to the agent API over MCP (P1)
// and works towards its goal with the five tools it is given, and nothing else. It is the "foreign agent" of the
// demo: it knows no ledger, no keys and no policy, only what the tools tell it. Every card and every raise it asks
// for waits for the CFO's Face ID.
//   KIT11_AGENT names it (default acme-research); KIT11_DB and the Airwallex sandbox keys are the runner's.

import Anthropic from "@anthropic-ai/sdk";
import { mcpTools, type MCPCallToolResultLike, type MCPClientLike } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { redactSecrets } from "../lib/redact.js";

const name = process.env.KIT11_AGENT ?? "acme-research";
const goal = process.argv.slice(2).join(" ").trim()
  || "Get a company card from Northwind for buying market reports: about 20 EUR each, at most 80 EUR a month. If you already have one, buy the Q4 European outdoor market report from TrailData Reports for 19.00 EUR.";
const apiKey = process.env.KIT11_ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("KIT11_ANTHROPIC_API_KEY is not set: the outside agent needs a model");

const env = Object.fromEntries(Object.entries({ ...process.env, KIT11_AGENT: name }).filter((e): e is [string, string] => typeof e[1] === "string"));
const mcp = new Client({ name: `${name}-agent`, version: "1.0.0" });
await mcp.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/cli/mcp.ts"], env, stderr: "inherit" }));
const { tools } = await mcp.listTools();
console.log(`${name}: connected to the agent API; tools: ${tools.map((t) => t.name).join(", ")}`);

// Our server always answers with content blocks (never the protocol's older toolResult shape).
const caller: MCPClientLike = { callTool: async (p) => (await mcp.callTool(p)) as MCPCallToolResultLike };
// Each tool call and its answer is printed as it happens, so the demo shows what the agent did, not what it says.
// A refusal (isError: a declined charge, say) comes out of run() as a thrown ToolError that holds the result's content
// (the sentence, then the structured object as JSON; its message joins them). It is printed and thrown on unchanged:
// the tool runner gives that content to the model as an error tool result it can act on (read reason and next_tool),
// and the run goes on.
const show = (out: unknown) => (Array.isArray(out) ? out.map((b: { text?: string }) => b.text ?? "").join(" ") : String(out));
const print = (arrow: string, out: unknown) => console.log(`  ${arrow} ${redactSecrets(show(out)).replace(/\s+/g, " ").slice(0, 400)}`);
const logged = mcpTools(tools, caller).map((t) => ({
  ...t,
  run: async (input: Record<string, unknown>) => {
    console.log(`  → ${t.name} ${JSON.stringify(input)}`);
    try {
      const out = await t.run(input);
      print("←", out);
      return out;
    } catch (e) {
      print("← refused:", e instanceof Error ? e.message : e);
      throw e;
    }
  },
}));

const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });
const runner = client.beta.messages.toolRunner({
  model: "claude-sonnet-5-5",
  max_tokens: 4000,
  max_iterations: 8,
  system: `You are the purchasing agent of Acme Research, a small research firm. You are not part of Northwind Outdoor; you reach Northwind only through the tools you have been given. Be brief. Never invent card details. When something waits for a person's approval, say so and stop.`,
  tools: logged,
  messages: [{ role: "user", content: goal }],
});
for await (const message of runner) {
  for (const b of message.content) if (b.type === "text" && b.text.trim()) console.log(`${name}: ${b.text.trim()}`);
}
await mcp.close();
