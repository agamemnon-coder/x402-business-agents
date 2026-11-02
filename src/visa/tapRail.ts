// D25, the TAP card rail, behind KIT11_TAP_RAIL=on (off by default; off, nothing changes). The Sourcing agent's card
// purchase from Packwise, the card-only merchant we run (simulated), goes:
//   1. the agent signs the checkout: signature 1 (Visa's Trusted Agent Protocol, as Visa's reference proxy reads it)
//      and signature 2 (ours, over Content-Digest), src/visa/tapSig.ts;
//   2. Packwise's merchant layer checks both against our pinned keys, src/visa/tapMerchant.ts (in-process here: no
//      proxy runs in the product; the reference proxy runs only in the interop test in CI);
//   3. only then the agent's own Airwallex card is charged (src/agents/cardBuyer.ts), inside its limit at Airwallex.
// D24: the purchase's origin carries the TAP keyId and nonce and our two verdicts; the charge's origin also carries
// Airwallex's authorisation id. A refusal charges nothing and is audited with its reason.

import { readFileSync } from "node:fs";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { buyPlan } from "../agents/cardBuyer.js";
import type { CardTransaction, IssuingSim } from "../airwallex/issuing.js";
import { audit } from "../audit/log.js";
import { agentName } from "../config/brand.js";
import { PLANS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { keyPath } from "../metal/agentCli.js";
import { currentOrigin, withOrigin, type Origin, type TapEvidence } from "../provenance/origin.js";
import { rawHeadersOf, tapMerchantConfig, verifyTapCheckout } from "./tapMerchant.js";
import { newNonce, signTapCheckout } from "./tapSig.js";

/** Packwise's checkout as agents address it: a merchant we run (simulated), its checkout under /product/. */
export const TAP_RAIL_MERCHANT = { name: "Packwise", authority: "packwise.example", checkoutPath: "/product/checkout" } as const;
const RULE = "the TAP card rail: a checkout signed with Visa's Trusted Agent Protocol and our body signature, checked by the merchant";

export function tapRailOn(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  return env.KIT11_TAP_RAIL === "on";
}

export interface TapSigner { agent: string; keyId: string; privateKey: KeyObject }

/** The agent's TAP key from its key file (written by npm run visa -- setup, outside this repo, 0600). */
export function loadTapSigner(agent: string, file = keyPath(`tap-${agent}.key.json`)): TapSigner {
  const k = JSON.parse(readFileSync(file, "utf8")) as { keyid: string; privateJwk: import("node:crypto").JsonWebKey };
  const privateKey = createPrivateKey({ key: k.privateJwk, format: "jwk" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error(`the TAP key of the ${agent} agent is not Ed25519`);
  return { agent, keyId: k.keyid, privateKey };
}

/** The origin in force with the TAP evidence added (code's own, naming the rail, when nothing decided around it). */
function withTap(base: Origin | null, agent: string, tap: TapEvidence): Origin {
  if (base && base.actor !== "external") return { ...base, tap };
  return { actor: "code", rule: RULE, agent, tap };
}

/** Signs, checks, then charges. Throws (charging nothing) when the merchant refuses; Airwallex's decline is returned. */
export async function tapCardPurchase(db: DB, sim: IssuingSim, planId: string, signer: TapSigner, now = new Date()): Promise<CardTransaction> {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`no plan ${planId}`);
  const nowS = Math.floor(now.getTime() / 1000);
  const m = TAP_RAIL_MERCHANT;
  const body = JSON.stringify({ plan: planId });
  // 1. The agent signs.
  const headers = signTapCheckout({ authority: m.authority, target: m.checkoutPath, method: "POST", body, keyId: signer.keyId, privateKey: signer.privateKey, created: nowS, nonce: newNonce(), tag: "agent-payer-auth" });
  // 2. The merchant checks the request as it receives it.
  const v = verifyTapCheckout(db, { method: "POST", target: m.checkoutPath, rawHeaders: rawHeadersOf({ host: m.authority, "content-type": "application/json", ...headers }), body: Buffer.from(body) }, tapMerchantConfig(m), nowS);
  const refuse = (reason: string, extra: Record<string, string> = {}): never => {
    audit(db, "system", "tap.checkout_refused", m.authority, { agent: signer.agent, plan: planId, key_id: signer.keyId, reason, ...extra }, now);
    throw new Error(`${m.name}'s checkout refused the ${agentName(signer.agent)}'s TAP request: ${reason}; nothing was charged`);
  };
  if (!v.ok) return refuse(v.reason, { sig1: v.sig1, sig2: v.sig2 });
  // A recognised agent pays only with its own card: the signing agent must be the plan's agent.
  if (v.agent !== plan.agent) return refuse(`the ${agentName(v.agent)} may not pay with the ${agentName(plan.agent)}'s card`);
  const tap: TapEvidence = { key_id: v.keyId, nonce: v.nonce, sig1: v.sig1, sig2: v.sig2 };
  audit(db, "system", "tap.checkout_verified", m.authority, { agent: v.agent, plan: planId, ...tap }, now);
  // 3. The card, under the origin that carries the evidence; the charge's origin adds the authorisation id.
  const base = currentOrigin();
  return withOrigin(withTap(base, plan.agent, tap), () =>
    buyPlan(db, sim, planId, now, { chargeOrigin: (t) => withTap(base, plan.agent, { ...tap, authorization_id: t.transactionId }) }));
}

/**
 * The Sourcing agent's card purchase. With KIT11_TAP_RAIL=on a Packwise plan goes through TAP first; otherwise, and
 * for every other merchant, exactly the card path as before.
 */
export async function buySoftwareOnCard(db: DB, sim: IssuingSim, planId: string, o: { env?: NodeJS.ProcessEnv | Record<string, string | undefined>; signer?: (agent: string) => TapSigner; now?: Date } = {}): Promise<CardTransaction> {
  const plan = PLANS[planId];
  if (!tapRailOn(o.env) || plan?.merchant !== TAP_RAIL_MERCHANT.name) return buyPlan(db, sim, planId, o.now);
  return tapCardPurchase(db, sim, planId, (o.signer ?? loadTapSigner)(plan.agent), o.now);
}
