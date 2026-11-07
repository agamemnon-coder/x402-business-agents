// A stand-in for the Treasury agent's advice (Opus on /try/sign), for the tests and the local browser checks (no
// network): it answers as model "stand-in", which the page labels "stand-in, not Claude", never as Claude. It plays the
// runner's tool loop: first read_position and read_quote, then submit_advice with a reason that quotes code's numbers
// from the prompt it was given, word for word (as the agent is told to).
import type { AgentAsk, AgentReply, AgentRequest } from "../../src/try/world.js";

export class StandInAdvisor {
  calls = 0;
  requests: AgentRequest[] = [];
  timing: "pay_now" | "wait_until" = "pay_now";
  date: string | null = null;
  /** The reason it gives; by default one written from code's numbers in the prompt. */
  reason: string | null = null;
  fail = false;
  /** Never answers (until the caller's deadline gives up). */
  hang = false;
  costUsd = 0.02;

  /** The default reason: code's numbers, copied from the prompt's "Code's numbers" line. */
  static reasonFrom(prompt: string): string {
    const m = /invoice EUR ([\d.]+) \+ SWIFT fee ceiling EUR ([\d.]+) = EUR ([\d.]+) needed; free EUR before the payment ([\d.]+); shortfall EUR ([\d.]+)/.exec(prompt);
    const fx = /buy EUR (\d+\.\d{2}) for (USD \d+\.\d{2})/.exec(prompt);
    const alone = /Above the (EUR [\d,.]+) the agent may pay alone/.exec(prompt);
    if (!m) return "The invoice is planned by code and waits for your Face ID.";
    return `It needs EUR ${m[3]} with the fee ceiling and only EUR ${m[4]} is free, so ${fx ? `the FX buys the EUR ${fx[1]} short for ${fx[2]}` : "no FX is needed"}. It is above the ${alone?.[1] ?? "limit"} I may pay alone, so you sign it with Face ID.`;
  }

  readonly ask: AgentAsk = async (req) => {
    this.calls++;
    this.requests.push(JSON.parse(JSON.stringify(req)) as AgentRequest);
    if (this.fail) throw new Error("stand-in: no answer");
    if (this.hang) return new Promise<AgentReply>(() => undefined);
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const id = `req_stand-in-advice-${String(this.calls).padStart(4, "0")}`;
    const base = { model: "stand-in", ms: 400, costUsd: this.costUsd, requestId: id, stop_reason: "tool_use" };
    if (turn === 0) {
      const content = [{ type: "tool_use" as const, id: `tu${this.calls}a`, name: "read_position", input: {} }, { type: "tool_use" as const, id: `tu${this.calls}b`, name: "read_quote", input: {} }];
      return { ...base, content, raw: content };
    }
    const prompt = String(req.messages[0]!.content);
    const content = [{ type: "tool_use" as const, id: `tu${this.calls}c`, name: "submit_advice", input: { timing: this.timing, date: this.timing === "wait_until" ? this.date : null, reason: this.reason ?? StandInAdvisor.reasonFrom(prompt) } }];
    return { ...base, content, raw: content };
  };
}
