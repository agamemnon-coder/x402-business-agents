// A scripted Claude for the Coder agent's tests (src/ap/coderAgent.ts): each turn is the tool calls it makes, "stop"
// (it stops talking) or an error it throws; after the script it stops talking. `asked` counts the API calls it got.
import type Anthropic from "@anthropic-ai/sdk";

export type CoderCall = { name: string; input: unknown };
export type CoderTurn = CoderCall[] | "stop" | Error;

export function scriptedCoder(turns: CoderTurn[], model = "claude-haiku-5-5"): Anthropic & { asked: number; prompts: string[] } {
  const state = { asked: 0, prompts: [] as string[] };
  const create = async (params: { messages: { role: string; content: unknown }[] }) => {
    const t = turns[state.asked];
    state.asked += 1;
    const last = params.messages.at(-1)?.content;
    state.prompts.push(typeof last === "string" ? last : JSON.stringify(last));
    const usage = { input_tokens: 1000, output_tokens: 100 };
    if (t instanceof Error) throw t;
    if (!t || t === "stop") return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model, usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `tu-${state.asked}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model, usage };
  };
  return {
    get asked() { return state.asked; },
    get prompts() { return state.prompts; },
    beta: { messages: { create } },
  } as unknown as Anthropic & { asked: number; prompts: string[] };
}
