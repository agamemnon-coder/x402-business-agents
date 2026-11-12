import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
const f = (async () => new Response(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify({ vendor: "x" }) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_node_1" } })) as typeof fetch;
const c = new Anthropic({ apiKey: "spike-not-a-key", fetch: f, maxRetries: 0 });
const parsed = await c.beta.messages.parse({ model: "claude-sonnet-5-5", max_tokens: 100, messages: [{ role: "user", content: "x" }], output_config: { format: betaZodOutputFormat(z.object({ vendor: z.string() })) } });
const created = await c.beta.messages.create({ model: "claude-sonnet-5-5", max_tokens: 100, messages: [{ role: "user", content: "x" }] });
console.log(JSON.stringify({ node: process.version, parse_request_id: (parsed as { _request_id?: string | null })._request_id ?? null, create_request_id: (created as { _request_id?: string | null })._request_id ?? null }));
