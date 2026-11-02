// D25, the TAP card rail, behind KIT11_TAP_RAIL=on (off by default; off, nothing changes). The Sourcing agent's card
// purchase from Packwise, the card-only merchant we run (simulated), goes:
//   1. the agent signs the checkout: signature 1 (Visa's Trusted Agent Protocol, as Visa's reference proxy reads it)
//      and signature 2 (ours, over Content-Digest), src/visa/tapSig.ts;
//   2. Packwise's merchant layer checks both against our pinned keys, src/visa/tapMerchant.ts. With KIT11_TAP_PROXY
//      set (a loopback URL, e.g. http://localhost:3001), the checkout is POSTed to /product/checkout through Visa's
//      reference proxy, run unchanged outside this repo, to our merchant server on :3000 (src/visa/tapServer.ts);
//      otherwise the merchant layer runs in-process (tests, and runs without the reference);
//   3. only then the agent's own Airwallex card is charged (src/agents/cardBuyer.ts), inside its limit at Airwallex.
// The signed body is the order (plan, amount, currency); the merchant checks it against what it sells, and the card is
// charged for the order the merchant verified. Before charging, the rail also requires the proxy's 200 (when it ran)
// and our own nonce row for exactly this request (review, 2 November: a verdict alone is not trusted).
// D24: the purchase's origin carries the TAP keyId and nonce, the proxy's HTTP status (when it ran) and our two
// verdicts; the charge's origin also carries Airwallex's transaction id for the authorisation (awx_transaction_id).
// A refusal charges nothing and is audited.

import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { buyPlan } from "../agents/cardBuyer.js";
import type { CardTransaction, IssuingSim } from "../airwallex/issuing.js";
import { audit } from "../audit/log.js";
import { agentName } from "../config/brand.js";
import { PLANS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { keyPath } from "../metal/agentCli.js";
import { currentOrigin, withOrigin, type Origin, type TapEvidence } from "../provenance/origin.js";
import { rawHeadersOf, tapMerchantConfig, verifyTapCheckout, type TapMerchantConfig, type TapMerchantVerdict } from "./tapMerchant.js";
import type { TapMerchantAnswer } from "./tapServer.js";
import { newNonce, signTapCheckout, type TapHeaders } from "./tapSig.js";

/** Packwise's checkout as agents address it in-process: a merchant we run (simulated), its checkout under /product/. */
export const TAP_RAIL_MERCHANT = { name: "Packwise", authority: "packwise.example", checkoutPath: "/product/checkout" } as const;
const RULE = "the TAP card rail: a checkout signed with Visa's Trusted Agent Protocol and our body signature, checked by the merchant";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function tapRailOn(env: Env = process.env): boolean {
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

// ---- how the signed checkout reaches the merchant ------------------------------------------------------------------

export interface Delivery { proxyStatus: number | null; verdict: TapMerchantVerdict | null; note?: string }
export interface TapTransport {
  kind: "in-process" | "reference-proxy";
  /** The authority the agent signs for and the merchant checks: where the agent sends the checkout. */
  config: TapMerchantConfig;
  deliver(r: { headers: TapHeaders; body: string; now: number }): Promise<Delivery>;
}

/** Our merchant layer in this process: no proxy. */
export function inProcessTransport(db: DB): TapTransport {
  const config = tapMerchantConfig({ ...TAP_RAIL_MERCHANT, merchantName: TAP_RAIL_MERCHANT.name });
  return {
    kind: "in-process", config,
    deliver: async ({ headers, body, now }) => ({
      proxyStatus: null,
      verdict: verifyTapCheckout(db, { method: "POST", target: config.checkoutPath, rawHeaders: rawHeadersOf({ host: config.authority, "content-type": "application/json", ...headers }), body: Buffer.from(body) }, config, now),
    }),
  };
}

/**
 * Through Visa's reference proxy (a loopback URL only): POST /product/checkout with the signed headers and body. The
 * proxy answers 403 itself when it refuses; otherwise it forwards to our merchant server, whose JSON verdict comes back.
 */
export function proxyTransport(proxyUrl: string): TapTransport {
  const u = new URL(proxyUrl);
  if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.pathname !== "/") throw new Error("KIT11_TAP_PROXY must be the reference proxy on this machine, e.g. http://localhost:3001");
  const config = tapMerchantConfig({ authority: u.host, checkoutPath: TAP_RAIL_MERCHANT.checkoutPath, merchantName: TAP_RAIL_MERCHANT.name });
  return {
    kind: "reference-proxy", config,
    deliver: ({ headers, body }) => new Promise<Delivery>((ok) => {
      const bytes = Buffer.from(body);
      const r = request({ host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port || 80), method: "POST", path: config.checkoutPath, headers: { host: u.host, "content-type": "application/json", "content-length": String(bytes.length), ...headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf8");
          let answer: TapMerchantAnswer | null;
          try { answer = JSON.parse(text) as TapMerchantAnswer; } catch { answer = null; }
          if (answer && typeof answer.verdict === "object" && answer.verdict) return ok({ proxyStatus: status, verdict: answer.verdict });
          const title = /<title>([^<]*)<\/title>/.exec(text)?.[1]?.replace(/[^\x20-\x7e]/g, "").trim();
          ok({ proxyStatus: status, verdict: null, note: `Visa's reference proxy answered ${status}${title ? ` (${title})` : ""}` });
        });
      });
      r.setTimeout(30_000, () => r.destroy(new Error("timed out")));
      r.on("error", (e) => ok({ proxyStatus: null, verdict: null, note: `the reference proxy was not reached: ${e.message}` }));
      r.end(bytes);
    }),
  };
}

/** KIT11_TAP_PROXY set: through the reference proxy; otherwise in-process. */
export function transportFromEnv(db: DB, env: Env = process.env): TapTransport {
  return env.KIT11_TAP_PROXY ? proxyTransport(env.KIT11_TAP_PROXY) : inProcessTransport(db);
}

// ---- the purchase --------------------------------------------------------------------------------------------------

/** The origin in force with the TAP evidence added (code's own, naming the rail, when nothing decided around it). */
function withTap(base: Origin | null, agent: string, tap: TapEvidence): Origin {
  // A CFO command moves no money, so it never stands behind a purchase: code's own origin then, as with none.
  if (base && base.actor !== "external" && base.actor !== "cfo-command") return { ...base, tap };
  return { actor: "code", rule: RULE, agent, tap };
}

/** Signs, delivers, then charges. Throws (charging nothing) when the proxy or the merchant refuses; Airwallex's decline is returned. */
export async function tapCardPurchase(db: DB, sim: IssuingSim, planId: string, signer: TapSigner, now = new Date(), transport: TapTransport = inProcessTransport(db)): Promise<CardTransaction> {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`no plan ${planId}`);
  const nowS = Math.floor(now.getTime() / 1000);
  const m = transport.config;
  // The order, signed: the merchant checks it against what it sells, and only that order is charged.
  const body = JSON.stringify({ plan: planId, amount: fromCents(plan.amountCents), currency: "EUR" });
  // 1. The agent signs, for the authority it sends to.
  const nonce = newNonce();
  const headers = signTapCheckout({ authority: m.authority, target: m.checkoutPath, method: "POST", body, keyId: signer.keyId, privateKey: signer.privateKey, created: nowS, nonce, tag: "agent-payer-auth" });
  // 2. The merchant checks the request as it receives it (behind the proxy, when it runs).
  const d = await transport.deliver({ headers, body, now: nowS });
  const via = { transport: transport.kind, authority: m.authority, ...(d.proxyStatus === null ? {} : { proxy_status: d.proxyStatus }) };
  const refuse = (reason: string, extra: Record<string, string> = {}): never => {
    audit(db, "system", "tap.checkout_refused", m.authority, { agent: signer.agent, plan: planId, key_id: signer.keyId, nonce, reason, ...via, ...extra }, now);
    throw new Error(`${TAP_RAIL_MERCHANT.name}'s checkout refused the ${agentName(signer.agent)}'s TAP request: ${reason}; nothing was charged`);
  };
  const v = d.verdict;
  if (!v) return refuse(d.note ?? "no verdict from the merchant");
  if (!v.ok) return refuse(v.reason, { sig1: v.sig1, sig2: v.sig2 });
  if (transport.kind === "reference-proxy" && d.proxyStatus !== 200) return refuse(`the merchant said accepted, but the proxy answered ${d.proxyStatus ?? "nothing"}, not 200`);
  if (v.keyId !== signer.keyId || v.nonce !== nonce) return refuse("the merchant's verdict is not about this request");
  // Our own merchant's record: it stores the nonce only after every check passed. No row, no charge.
  if (!db.prepare("SELECT 1 FROM tap_rail_nonces WHERE keyid = ? AND nonce = ?").get(v.keyId, v.nonce)) return refuse("our merchant has no record of accepting this request's nonce");
  if (!v.order || v.order.plan !== planId || v.order.amountCents !== plan.amountCents || v.order.currency !== "EUR") return refuse("the merchant verified no order matching this purchase");
  // A recognised agent pays only with its own card: the signing agent must be the plan's agent.
  if (v.agent !== plan.agent) return refuse(`the ${agentName(v.agent)} may not pay with the ${agentName(plan.agent)}'s card`);
  const tap: TapEvidence = { key_id: v.keyId, nonce: v.nonce, sig1: v.sig1, sig2: v.sig2, ...(d.proxyStatus === null ? {} : { proxy_status: d.proxyStatus }) };
  audit(db, "system", "tap.checkout_verified", m.authority, { agent: v.agent, plan: planId, ...tap, ...via }, now);
  // 3. The card, for the order the merchant verified, under the origin that carries the evidence; the charge's origin
  //    adds Airwallex's transaction id for the authorisation.
  const verified = v.order.plan;
  const base = currentOrigin();
  return withOrigin(withTap(base, plan.agent, tap), () =>
    buyPlan(db, sim, verified, now, { chargeOrigin: (t) => withTap(base, plan.agent, { ...tap, awx_transaction_id: t.transactionId }) }));
}

/**
 * The Sourcing agent's card purchase. With KIT11_TAP_RAIL=on a Packwise plan goes through TAP first; otherwise, and
 * for every other merchant, exactly the card path as before.
 */
export async function buySoftwareOnCard(db: DB, sim: IssuingSim, planId: string, o: { env?: Env; signer?: (agent: string) => TapSigner; transport?: TapTransport; now?: Date } = {}): Promise<CardTransaction> {
  const plan = PLANS[planId];
  const env = o.env ?? process.env;
  if (!tapRailOn(env) || plan?.merchant !== TAP_RAIL_MERCHANT.name) return buyPlan(db, sim, planId, o.now);
  return tapCardPurchase(db, sim, planId, (o.signer ?? loadTapSigner)(plan.agent), o.now, o.transport ?? transportFromEnv(db, env));
}
