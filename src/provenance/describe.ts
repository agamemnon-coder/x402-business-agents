// D24: who decided a money movement, in words, from its recorded origin and nothing else. Used by the money flow,
// the CFO's feed and every page that says who moved money.

import type { Origin } from "./origin.js";

export const NOT_RECORDED = "who decided is not recorded";
const MODEL_WORDS: Record<string, string> = { "claude-haiku-5-5": "Claude Haiku", "claude-sonnet-5-5": "Claude Sonnet", "claude-opus-5-5": "Claude Opus" };
const AGENT_WORDS: Record<string, string> = { sourcing: "the Sourcing agent", support: "the Support agent", treasury: "the Treasury agent", checker: "the Checker agent", payer: "the Payer agent" };

export function describeOrigin(o: Origin | null): { model: string | null; decided: string; request?: string } {
  if (!o) return { model: null, decided: NOT_RECORDED };
  switch (o.actor) {
    case "agent": return { model: o.model, decided: `${AGENT_WORDS[o.agent] ?? o.agent} (${MODEL_WORDS[o.model] ?? o.model}) decided`, ...(o.request_id ? { request: o.request_id } : {}) };
    case "cfo": return { model: null, decided: o.cosigner ? "two people approved it, each with their own Face ID (four eyes)" : `the CFO approved it with ${o.method === "passkey" ? "Face ID" : `a ${o.method} approval`}` };
    case "cfo-command": return { model: null, decided: `the CFO ran ${o.command} (it moves no money)` };
    case "code": return { model: null, decided: `code: ${o.rule}${o.set_by ? `, as ${describeOrigin(o.set_by).decided.replace(/ decided$/, "")} set it` : ""}` };
    case "external": return { model: null, decided: o.party === "customer" ? "Summit's agent paid (the simulated customer)" : o.party === "retailer" ? `${o.name ?? "a retailer"} paid (a retailer)` : o.party === "merchant" ? `${o.name ?? "the merchant"} charged the card` : o.party === "outside_agent" ? `${o.name ?? "an outside agent"} paid (an outside agent)` : o.party === "supplier" ? `${o.name ?? "a supplier"} paid` : "an outside sender paid in" };
  }
}
