// A fake Claude for the variation tests (D26): it answers each run by which agent asks (told apart by its tools) and by
// the turn, the way the agents' scripts in other tests do, so a whole world of three agents can run without the API.
import type Anthropic from "@anthropic-ai/sdk";

export type Use = { name: string; input: unknown };
export interface Turn {
  role: "sourcing" | "treasury" | "support" | "dispute" | "design" | "other";
  turn: number;
  /** The run's first prompt. */
  prompt: string;
  /** What code answered to the tools so far. */
  results: string[];
}
/** Returns the tool calls for this turn, or null to stop talking. */
export type Script = (t: Turn) => Use[] | null;

const roleOf = (tools: string[]): Turn["role"] =>
  tools.includes("set_buy_policy") ? "sourcing" : tools.includes("settle_dispute") ? "support" : tools.includes("design_rebalance") ? "treasury"
    : tools.includes("verify_order") ? "dispute" : tools.includes("submit_plan") ? "design" : "other";

export function routerClient(script: Script): Anthropic & { calls: Turn[] } {
  const calls: Turn[] = [];
  const create = async (params: { tools?: { name: string }[]; messages: { role: string; content: unknown }[] }) => {
    const prompt = typeof params.messages[0]?.content === "string" ? params.messages[0].content : "";
    const results = params.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; content?: string }[]).filter((b) => b.type === "tool_result").map((b) => String(b.content)) : []));
    const t: Turn = { role: roleOf((params.tools ?? []).map((x) => x.name)), turn: params.messages.filter((m) => m.role === "assistant").length, prompt, results };
    calls.push(t);
    const uses = script(t);
    const usage = { input_tokens: 1000, output_tokens: 100 };
    if (!uses || uses.length === 0) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage };
    return { content: uses.map((u, k) => ({ type: "tool_use", id: `tu-${calls.length}-${k}`, name: u.name, input: u.input })), stop_reason: "tool_use", model: "claude-sonnet-5-5", usage };
  };
  return { calls, beta: { messages: { create } } } as unknown as Anthropic & { calls: Turn[] };
}

const finish = (summary: string): Use => ({ name: "finish", input: { summary } });
const seqsIn = (prompt: string) => [...new Set([...prompt.split("\n")[0]!.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];

/** A careful agent team: each does its job inside the rules, in its own words. */
export const safeTeam: Script = (t) => {
  if (t.role === "sourcing") return t.turn === 0 ? [{ name: "set_buy_policy", input: { supplier: "none", max_price: null, cache_seconds: 120, reason: "Serve from a short cache while the price is over my cap." } }] : t.turn === 1 ? [finish("Stopped live buys; asked nobody.")] : null;
  if (t.role === "treasury") {
    if (t.turn > 0) return t.turn === 1 ? [finish("Did what code allowed.")] : null;
    if (/invoice\.received/.test(t.prompt)) return [{ name: "plan_invoice", input: {} }];
    if (/money\.in/.test(t.prompt)) return [{ name: "sweep_earnings", input: { reason: "money came in" } }];
    return [{ name: "design_rebalance", input: { reason: "Sourcing is blocked by its cap" } }];
  }
  if (t.role === "support") return t.turn === 0 ? [{ name: "settle_dispute", input: {} }] : t.turn === 1 ? [finish("Settled from evidence.")] : null;
  if (t.role === "dispute") {
    const seqs = seqsIn(t.prompt);
    if (t.turn === 0) return seqs.map((seq) => ({ name: "check_data", input: { seq } }));
    const wrong = seqs.filter((s) => t.results.some((r) => r.startsWith(`#${s} `) && r.endsWith(": wrong")));
    if (t.turn === 1) return wrong.length ? wrong.map((seq) => ({ name: "refund", input: { seq, reason: "wrong data" } })) : [{ name: "escalate_to_cfo", input: { seqs, advice: "The data was right; I advise no refund." } }];
    if (t.turn === 2 && wrong.length) {
      // The right ones, and what code refused over the limits, go to the CFO together (once per dispute).
      const rest = seqs.filter((s) => !wrong.includes(s) || t.results.some((r) => r.startsWith(`Refused: #${s} `)));
      return rest.length ? [{ name: "escalate_to_cfo", input: { seqs: rest, advice: "The right ones I advise not to refund; the others are over my automatic limits." } }] : null;
    }
    return null;
  }
  return null;
};
