// The merchant we run for the agent-recognition demo: Packwise, the warehouse software the Operations agent buys.
// It recognises the agent first (src/visa/tap.ts: the agent-recognition profile of Visa's TAP spec, our registry and
// test keys), and only then is the agent's own Airwallex Visa card charged, inside the CFO limit Airwallex enforces
// (src/agents/cardBuyer.ts). In the sandbox the charge is a simulated card authorisation. Every outcome is audited.

import { buyPlan } from "../agents/cardBuyer.js";
import type { IssuingSim } from "../airwallex/issuing.js";
import { audit } from "../audit/log.js";
import { agentName } from "../config/brand.js";
import { PLANS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { verifyTapRequest } from "./tap.js";

export const TAP_MERCHANT = { name: "Packwise", domain: "packwise.example" };

export type TapCheckout =
  | { recognised: false; approved: false; reason: string }
  | { recognised: true; agent: string; approved: boolean; reason: string | null; transactionId: string | null };

/** POST /checkout: recognise the agent (agent-payer-auth), then charge its own card for the plan in the body. */
export async function tapCheckout(db: DB, sim: IssuingSim, req: Request, now = new Date()): Promise<TapCheckout> {
  const body = await req.clone().text();
  const v = await verifyTapRequest(db, req, { tag: "agent-payer-auth", now: Math.floor(now.getTime() / 1000) });
  if (!v.ok) {
    audit(db, "system", "tap.refused", TAP_MERCHANT.domain, { reason: v.reason }, now);
    return { recognised: false, approved: false, reason: v.reason };
  }
  audit(db, "system", "tap.recognised", TAP_MERCHANT.domain, { agent: v.agent, keyid: v.keyid, nonce: v.nonce }, now);
  let plan: string | undefined;
  try { plan = (JSON.parse(body) as { plan?: unknown }).plan as string | undefined; } catch { plan = undefined; }
  const p = typeof plan === "string" ? PLANS[plan] : undefined;
  if (!p || p.merchant !== TAP_MERCHANT.name) return { recognised: true, agent: v.agent, approved: false, reason: `no plan ${String(plan)} at ${TAP_MERCHANT.name}`, transactionId: null };
  // A recognised agent pays only with its own card: the signing agent must be the plan's agent.
  if (p.agent !== v.agent) return { recognised: true, agent: v.agent, approved: false, reason: `${agentName(v.agent)} may not pay with the ${agentName(p.agent)}'s card`, transactionId: null };
  try {
    const t = await buyPlan(db, sim, plan!, now);
    return { recognised: true, agent: v.agent, approved: t.approved, reason: t.approved ? null : `declined by Airwallex: ${t.failureReason}`, transactionId: t.transactionId };
  } catch (e) {
    return { recognised: true, agent: v.agent, approved: false, reason: (e as Error).message, transactionId: null };
  }
}
