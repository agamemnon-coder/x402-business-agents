// D24: who decided a money movement, recorded when the action starts and never worked out afterwards.
//
// An origin travels with the code path that starts a money action (Node's AsyncLocalStorage), and into a subprocess
// that a tool starts through the environment (KIT11_ORIGIN). It is set at four doors only:
// - the agent loop, around each tool call: the agent, the Claude model, the API request id of the answer that asked
//   for the tool, and the run id (src/agents/loop.ts);
// - the executor, around an approved proposal: the approval and the CFO's passkey, and the controller's with four eyes;
// - code's own automatic paths, named by their rule (a refund within the automatic limits, a purchase under the buy
//   policy), which replace any agent origin around them;
// - the doors where outside money arrives: a customer's payment, a retailer's deposit, a merchant's card charge.
// Every money event in the audit chain records the origin in force when it is written (src/audit/log.ts), or null:
// a null is an error the origins check counts (src/provenance/check.ts), never a guess.

import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

const Id = z.string().min(1).max(200);
/** D25: a card checkout signed with TAP and checked by our merchant layer (src/visa/tapRail.ts): the agent's TAP key id
 *  and nonce, Visa's reference proxy's HTTP status when the checkout went through it, our verdicts on signature 1
 *  (TAP) and signature 2 (body), and, on the charge itself, Airwallex's transaction id for the authorisation (its card
 *  transaction id, as the simulation returns it). */
const TapEvidence = z.strictObject({ key_id: Id, nonce: Id, sig1: Id, sig2: Id, proxy_status: z.number().int().optional(), awx_transaction_id: Id.optional() });
export type TapEvidence = z.infer<typeof TapEvidence>;
const AgentOrigin = z.strictObject({ actor: z.literal("agent"), agent: Id, model: Id, request_id: Id.nullable(), run_id: Id, tap: TapEvidence.optional() });
const CfoOrigin = z.strictObject({
  actor: z.literal("cfo"), proposal_id: Id, approval_id: Id, method: Id, approver: Id,
  /** With four eyes: the other person who signed the same terms with their own passkey first (the controller). */
  cosigner: Id.optional(),
  tap: TapEvidence.optional(),
});
type Code = { actor: "code"; rule: string; agent?: string; set_by?: Origin; tap?: TapEvidence };
const CodeOrigin: z.ZodType<Code> = z.strictObject({
  actor: z.literal("code"), rule: Id, agent: Id.optional(), tap: TapEvidence.optional(),
  /** The decision code follows, when someone set it: the buy policy an agent's Claude run set, for one. */
  set_by: z.lazy(() => OriginSchema).optional(),
});
const ExternalOrigin = z.strictObject({ actor: z.literal("external"), party: z.enum(["customer", "supplier", "retailer", "merchant", "sender", "outside_agent"]), name: Id.optional() });
const OriginSchema: z.ZodType<Origin> = z.union([AgentOrigin, CfoOrigin, CodeOrigin, ExternalOrigin]) as never;

export type Origin =
  | z.infer<typeof AgentOrigin>
  | z.infer<typeof CfoOrigin>
  | Code
  | z.infer<typeof ExternalOrigin>;

/** The events that move money (or refuse to): each records its origin. The money flow shows exactly these. */
export const MONEY_EVENTS = new Set([
  "sale.delivered", "upstream.paid", "upstream.refused", "upstream.refused_on_chain", "upstream.paid_after_lookup",
  "refund.paid", "refund.pending", "refund.refused", "refund.held", "sweep.paid", "sweep.pending", "sweep.refused", "sweep.held",
  "credit.deposited", "transfer.created", "fx.converted", "card.purchase_started", "card.charge_approved", "card.charge_declined",
  "card.charge_reversed", "receivable.matched", "receivable.escalated", "mandate.replaced", "clearing.deposited", "clearing.withdrawn",
  "quarantine.held", "quarantine.returned", "quarantine.accepted",
  // After a crash the action is found at the outside service and adopted, never sent twice: the same money movement.
  "transfer.adopted", "fx.adopted", "credit.adopted", "refund.already_paid", "upstream.in_doubt", "refund.deferred", "sweep.deferred",
  // Test money for a fresh world, and the passkey owners' own transfer.
  "business.funded", "treasury.seeded", "owners.sent",
]);

/** Code's own automatic paths, by their rule (D24). */
export const AUTO_REFUND: Origin = { actor: "code", rule: "refund within the CFO's automatic limits", agent: "support" };

const store = new AsyncLocalStorage<Origin>();

/** A well-formed origin from JSON text, or null. */
export function parseOrigin(text: string | undefined | null): Origin | null {
  if (!text) return null;
  try {
    const r = OriginSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// A subprocess started by a tool (the sweep, the dispute settlement) inherits its parent's origin, once, at start.
const fromEnv = parseOrigin(process.env.KIT11_ORIGIN);

/** The origin in force here: the innermost withOrigin, else the one this process was started with, else null. */
export function currentOrigin(): Origin | null {
  return store.getStore() ?? fromEnv ?? scriptOrigin;
}

/** Runs fn with this origin in force; an inner withOrigin replaces it only inside. */
export function withOrigin<T>(origin: Origin, fn: () => T): T {
  return store.run(OriginSchema.parse(origin), fn);
}

/** The origin in force, as stored in a ledger row's origin_json column (null when there is none). */
export function originJson(): string | null {
  const o = currentOrigin();
  return o ? JSON.stringify(o) : null;
}

/** For a top-level script with no origin of its own (none inherited through the environment): what decides here. */
let scriptOrigin: Origin | null = null;
export function setScriptOrigin(o: Origin): void {
  if (!fromEnv) scriptOrigin = OriginSchema.parse(o);
}

/** The environment for a long-lived process (an agent, the world) that must start with no origin of its own. */
export function envWithoutOrigin(): NodeJS.ProcessEnv {
  const { KIT11_ORIGIN: _drop, ...rest } = process.env;
  return rest;
}

/** The environment that passes the origin in force on to a subprocess (nothing when there is none). */
export function originEnv(): Record<string, string> {
  const o = currentOrigin();
  return o ? { KIT11_ORIGIN: JSON.stringify(o) } : {};
}
