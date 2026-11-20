// How many tokens the tool definitions of /mcp/airwallex cost in a model's context (docs/codemode.md): the two Code Mode
// tools (search, execute) against the equivalent "one tool per endpoint" list built from the same spec
// (openapi/airwallex-read.json). With ANTHROPIC_API_KEY set it asks Anthropic's free count_tokens endpoint (no
// generation); without it, a labelled approximation (characters / 4). Writes docs/evidence/codemode-tokens.json.
//   npx tsx scripts/codemode-tokens.ts
import { writeFileSync } from "node:fs";
import { AWX_READ_SPEC } from "../cloud/src/claude/awxCodemode.js";
import { AWX_CODEMODE_TOOLS } from "../cloud/src/claude/awxCodemodeMcp.js";

type J = Record<string, unknown>;
interface ToolDef { name: string; description: string; input_schema: J }
const MODEL = "claude-sonnet-5-5";

const params = (AWX_READ_SPEC.components as unknown as { parameters: Record<string, J> }).parameters;
const resolve = (p: J): J => (typeof p.$ref === "string" ? params[p.$ref.split("/").pop()!]! : p);

/** One tool per endpoint, as an MCP server that maps an API one-to-one would list them. */
export function perEndpointTools(): ToolDef[] {
  return Object.entries(AWX_READ_SPEC.paths as unknown as Record<string, { get: J }>).map(([path, { get: op }]) => {
    const ps = ((op.parameters ?? []) as J[]).map(resolve);
    const properties = Object.fromEntries(ps.map((p) => [p.name as string, { ...(p.schema as J), ...(p.description ? { description: p.description } : {}) }]));
    const required = ps.filter((p) => p.required).map((p) => p.name as string);
    const resp = ((op.responses as Record<string, J>)["200"]!).description as string;
    return { name: op.operationId as string, description: `${op.summary as string} GET ${path} on the Airwallex sandbox (read only). Returns: ${resp}.`, input_schema: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false } };
  });
}
export const codeModeTools = (): ToolDef[] => AWX_CODEMODE_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as unknown as J }));

async function countApi(tools: ToolDef[] | null): Promise<number> {
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hi" }], ...(tools ? { tools } : {}) }),
  });
  if (!res.ok) throw new Error(`count_tokens answered ${res.status}`);
  return ((await res.json()) as { input_tokens: number }).input_tokens;
}
const approx = (tools: ToolDef[]) => Math.ceil(JSON.stringify(tools).length / 4);

const per = perEndpointTools(), two = codeModeTools();
let method: string, perTokens: number, twoTokens: number;
if (process.env.ANTHROPIC_API_KEY) {
  const base = await countApi(null);
  perTokens = (await countApi(per)) - base;
  twoTokens = (await countApi(two)) - base;
  method = `Anthropic count_tokens (POST /v1/messages/count_tokens, model ${MODEL}): input_tokens with the tools minus input_tokens of the same one-word message without tools`;
} else {
  perTokens = approx(per);
  twoTokens = approx(two);
  method = "APPROXIMATION: characters of the JSON tool list / 4 (no ANTHROPIC_API_KEY was set, so Anthropic's count_tokens was not called)";
}
const out = {
  date: "2026-11-20",
  method,
  endpoints: per.length,
  per_endpoint_tools: { tools: per.length, tokens: perTokens, chars: JSON.stringify(per).length, avg_tokens_per_tool: Math.round(perTokens / per.length) },
  code_mode_tools: { tools: two.length, tokens: twoTokens, chars: JSON.stringify(two).length },
  saving_tokens: perTokens - twoTokens,
  saving_percent: Math.round((1 - twoTokens / perTokens) * 1000) / 10,
  notes: [
    "Only the tool definitions are counted (what sits in the context on every turn). Code Mode then spends tokens per task: a search call and its spec fragments, and the execute plan and its selected result.",
    "The two-tool list is fixed in size; the per-endpoint list grows with each endpoint, so the saving grows with the number of endpoints. This server has only " + per.length + " read endpoints, so the saving here is small.",
    "Cloudflare's figure of about 1,000 tokens for Code Mode is about their own API (2,500+ endpoints), not this one.",
  ],
};
writeFileSync(new URL("../docs/evidence/codemode-tokens.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
