// Block 5.1: the Sourcing agent picks the rail per purchase (Haiku, with tools). This morning it has two purchases: the
// next customer's stock check from Stockline and Packwise's Starter plan. It reads each supplier's checkout and pays on a
// rail; code checks that the supplier accepts that rail before anything is paid (src/config/policy.ts, SUPPLIER_RAILS),
// and the rail itself enforces the limit: the Metal mandate on chain, the card's limits at Airwallex. A wrong rail is
// refused with the reason; the agent may try again. Without the agent, code pays each on the registry's rail.
//
// A third rail, Airi (VIC, 7 Nov): a single-use Visa credential from Airwallex's Airi wallet, for a purchase at a
// merchant of the Airi registry (src/airi/policy.ts). It is offered only when the caller brings such a purchase, the
// rail is on (KIT11_AIRI_RAIL=on, as the run used) and Purser's own Airi decision would not refuse it now: the agent
// not paused or stopped, the merchant on the CFO's Airi allowlist, the amount, items and currency valid and within the
// hard cap (src/airi/purchase.ts, decideAiriPurchase). Above the CFO's limit it is still offered, and the payment then
// waits for the CFO's Face ID. Whether it was offered, and why, is in the audit trail (purchase.airi_rail_offered or
// purchase.airi_rail_not_offered). Offering it skips nothing: the payment itself goes through requestAiriPurchase,
// which runs every Purser check again before Airi is asked. Without such a purchase, nothing here changes.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import { RAIL_WORDS, SUPPLIER_RAILS, type Rail, type Supplier } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { runAgent, type AgentRun } from "./loop.js";
import { airiPolicy, airiRailOn, merchantById } from "../airi/policy.js";
import { AIRI_RAIL, decideAiriPurchase, requestAiriPurchase, type AiriDeps, type AiriOutcome, type AiriPurchaseRequest } from "../airi/purchase.js";
import { fromCents } from "../lib/money.js";
import { frozen, paused } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";

/** The Airi rail's name in the agent's tools (src/airi/purchase.ts keeps it with each purchase's rail choice). */
export { AIRI_RAIL };
export const AIRI_RAIL_WORDS = "a single-use Visa credential from Airwallex's Airi (VIC)";
/** A rail the agent can pick: the two of the registry, and Airi when it is offered. */
export type ChosenRail = Rail | typeof AIRI_RAIL;

/** A purchase at a merchant of the Airi registry, which the agent may be offered to pay with Airi. */
export interface AiriRailPurchase {
  /** The merchant's id in the Airi registry (src/airi/policy.ts, AIRI_MERCHANTS). */
  merchantId: string;
  item: string;
  /** Two decimals, e.g. "12.00". */
  amount: string;
  currency: string;
  /** Pays it on Purser's Airi rail: requestAiriPurchase (airiRailPay below), which checks everything again. */
  pay(): Promise<RailPayment>;
}

export type AiriOffer = { offered: true; merchant: string; why: string } | { offered: false; merchant: string; why: string };

export interface RailPayment {
  /** Whether the rail let it through (false: Metal refused it, or Airwallex declined the card). */
  ok: boolean;
  text: string;
  /** The chain tx or the Airwallex transaction id. */
  ref: string | null;
}

export interface RailDeps {
  /** Serves the next customer query: its stock check bought from Stockline over x402 under the Sourcing mandate. */
  payStockline(): Promise<RailPayment>;
  /** Packwise's Starter plan charged to the Sourcing agent's Airwallex card. */
  payPackwise(): Promise<RailPayment>;
  /** A third purchase the agent may be offered to pay with Airi (only when airiRailOffer allows it). */
  airi?: AiriRailPurchase;
  /** Where KIT11_AIRI_RAIL is read (default: process.env). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface RailPurchase {
  /** A supplier of the registry, or the Airi merchant's id. */
  supplier: Supplier | string;
  rail: ChosenRail;
  by: "claude" | "code";
  reason: string;
  ok: boolean;
  text: string;
  ref: string | null;
}

export interface RailChoice {
  source: "claude" | "fallback";
  purchases: RailPurchase[];
  run: AgentRun;
}

const SUPPLIERS = Object.keys(SUPPLIER_RAILS) as Supplier[];
const RAILS = Object.keys(RAIL_WORDS) as Rail[];
const BLOCKED_BY: Record<ChosenRail, string> = { metal_x402: "Metal x402", airwallex_card: "Airwallex card", [AIRI_RAIL]: "Purser's Airi rail" };

/** Null when the supplier accepts the rail; otherwise why not, in words the agent and the CFO read. */
export function checkRail(supplier: Supplier, rail: Rail): string | null {
  const s = SUPPLIER_RAILS[supplier];
  if (s.rails.includes(rail)) return null;
  const only = s.rails.length === 1 && s.rails[0] === "metal_x402" ? "only x402 on Metal" : "only a card";
  return `${s.name} accepts ${only} (${s.checkout}), not ${RAIL_WORDS[rail]}`;
}

/** The request Purser's Airi rail would get for this purchase (one item, at the amount). */
export function airiRequest(p: Pick<AiriRailPurchase, "merchantId" | "item" | "amount" | "currency">, paymentMethodId = ""): AiriPurchaseRequest | null {
  const m = merchantById(p.merchantId);
  return m ? { agent: "sourcing", paymentMethodId, merchantName: m.name, merchantUrl: m.url, merchantCountry: m.country, amount: p.amount, currency: p.currency, items: [{ name: p.item, unitPrice: p.amount, quantity: "1" }], description: p.item } : null;
}

/**
 * Whether the agent is offered Airi for this purchase, and why: the rail on, the agent not paused or stopped, a merchant
 * of the registry, and Purser's own Airi decision not a refusal (the CFO's allowlist, the amount, items, currency, hard
 * cap). Reads the CFO's Airi policy; calls nothing outside.
 */
export function airiRailOffer(db: DB, p: Pick<AiriRailPurchase, "merchantId" | "item" | "amount" | "currency">, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AiriOffer {
  const merchant = p.merchantId;
  if (!airiRailOn(env)) return { offered: false, merchant, why: "the Airi rail is off (KIT11_AIRI_RAIL is not on)" };
  if (frozen(db)) return { offered: false, merchant, why: "the emergency stop is on" };
  if (paused(db, "sourcing")) return { offered: false, merchant, why: "the sourcing agent is paused by the CFO" };
  if (stopped(db, "sourcing")) return { offered: false, merchant, why: "the sourcing agent was stopped (velocity limit)" };
  const req = airiRequest(p);
  if (!req) return { offered: false, merchant, why: `${merchant} is not a merchant of the Airi registry` };
  const policy = airiPolicy(db);
  const d = decideAiriPurchase(policy, req, 0);
  if (d.route === "refused") return { offered: false, merchant, why: `${d.code}: ${d.reason}` };
  return { offered: true, merchant, why: d.route === "alone"
    ? `${req.merchantName} is on the CFO's Airi allowlist and ${p.amount} ${p.currency} is within the CFO's limit of ${fromCents(policy.aloneMaxCents)} for this rail`
    : `${req.merchantName} is on the CFO's Airi allowlist; ${p.amount} ${p.currency} is ${d.why}, so it waits for the CFO's Face ID` };
}

/** What a purchase on Purser's Airi rail came to, as the rail choice reports it. */
export function airiRailPayment(o: AiriOutcome): RailPayment {
  switch (o.status) {
    case "succeeded": return { ok: true, text: `paid with a single-use Visa credential from Airi: mandate ${o.mandateId}, checkout ${o.reference}${o.code ? ` (${o.code})` : ""}`, ref: o.reference };
    case "pending_approval": return { ok: false, text: `above the CFO's limit: ${o.proposalId} waits for the CFO's Face ID; Airi was not asked`, ref: null };
    case "refused": return { ok: false, text: `refused by ${o.by === "purser" ? "Purser" : o.by === "airi" ? "Airi" : "the checkout"} (${o.code})`, ref: o.mandateId ?? null };
    case "unconfirmed": return { ok: false, text: `the checkout's outcome is not known yet (mandate ${o.mandateId}); nothing is retried until a look-up tells`, ref: o.reference };
  }
}

/** The Airi purchase's pay, through Purser's Airi rail: requestAiriPurchase, with every Purser check, in front of Airi. */
export function airiRailPay(db: DB, deps: AiriDeps, p: Pick<AiriRailPurchase, "merchantId" | "item" | "amount" | "currency">, paymentMethodId: string, now: () => Date = () => new Date()): () => Promise<RailPayment> {
  return async () => {
    const req = airiRequest(p, paymentMethodId);
    if (!req) return { ok: false, text: `${p.merchantId} is not a merchant of the Airi registry; Airi was not asked`, ref: null };
    return airiRailPayment(await requestAiriPurchase(db, deps, req, now()));
  };
}

const SYSTEM = [
  "You are the Sourcing agent of Northwind Outdoor. You pay suppliers on one of two rails: x402 on Metal (a stablecoin payment under your own on-chain mandate: a cap per purchase, a budget, named payees) or your company card at Airwallex (software merchants only, a limit per purchase and per month).",
  "This morning you have two purchases: the next customer's stock check from Stockline, and Packwise's Starter plan. Read each supplier's checkout with supplier_terms, then pay each once with pay, on the rail that supplier accepts, with a short reason.",
  "Code refuses a rail a supplier does not accept, before anything is paid. You cannot change your limits: Metal and Airwallex enforce them, and only the CFO can approve new ones.",
].join("\n");

export async function chooseRails(db: DB, deps: RailDeps, client: Anthropic | null = claudeClient(), model: string = MODELS.classify): Promise<RailChoice> {
  // Airi is offered for the caller's Airi purchase only when the rail is on and Purser would not refuse it; recorded.
  const airi = deps.airi ?? null;
  const offer = airi ? airiRailOffer(db, airi, deps.env ?? process.env) : null;
  if (airi && offer) audit(db, "sourcing", offer.offered ? "purchase.airi_rail_offered" : "purchase.airi_rail_not_offered", airi.merchantId, { merchant: airi.merchantId, item: airi.item.slice(0, 120), amount: airi.amount, currency: airi.currency, why: offer.why.slice(0, 300) });
  const airiKey = airi && offer?.offered ? airi.merchantId : null;
  const airiName = airiKey ? merchantById(airiKey)!.name : "";
  const keys: string[] = [...SUPPLIERS, ...(airiKey ? [airiKey] : [])];
  const rails: ChosenRail[] = [...RAILS, ...(airiKey ? [AIRI_RAIL] as const : [])];
  const nameOf = (k: string) => k === airiKey ? airiName : SUPPLIER_RAILS[k as Supplier].name;
  const railWords = (r: ChosenRail) => r === AIRI_RAIL ? AIRI_RAIL_WORDS : RAIL_WORDS[r];
  /** Null when the purchase accepts the rail; otherwise why not. */
  const wrongRail = (k: string, rail: ChosenRail): string | null => {
    if (k === airiKey) return rail === AIRI_RAIL ? null : `${airiName} is paid only with ${AIRI_RAIL_WORDS} here, not ${railWords(rail)}`;
    if (rail === AIRI_RAIL) return `${nameOf(k)} is not a merchant on the CFO's Airi allowlist: ${AIRI_RAIL_WORDS} is not offered for it`;
    return checkRail(k as Supplier, rail);
  };

  const done = new Map<string, RailPurchase>();
  const payOn = async (supplier: string, rail: ChosenRail, by: RailPurchase["by"], reason: string): Promise<RailPurchase> => {
    let r: RailPayment;
    try {
      r = await (supplier === airiKey ? airi!.pay() : supplier === "stockline" ? deps.payStockline() : deps.payPackwise());
    } catch (e) {
      // Thrown by code before the rail (a pause, a stop, a policy limit) or after it (a hold kept in doubt): the
      // ledger's hold or transaction says which; nothing is tried again on any rail.
      r = { ok: false, text: `stopped: ${(e as Error).message}; nothing more was tried (the ledger shows whether the rail was reached)`, ref: null };
    }
    const p: RailPurchase = { supplier, rail, by, reason: reason.trim().slice(0, 300), ok: r.ok, text: r.text, ref: r.ref };
    done.set(supplier, p);
    audit(db, "sourcing", "purchase.rail_chosen", supplier, { supplier, rail, by, reason: p.reason, ok: r.ok, result: r.text.slice(0, 300), ref: r.ref, ...(supplier === airiKey ? { airi_offer: offer!.why.slice(0, 300) } : {}) });
    return p;
  };

  const airiTerms = airiKey ? `${airiName}: ${airi!.item}, ${airi!.amount} ${airi!.currency}. Checkout: Airwallex's hosted checkout, paid with ${AIRI_RAIL_WORDS}; the cardholder confirms each purchase in Airi with a passkey. Accepts: ${AIRI_RAIL} (${AIRI_RAIL_WORDS}). Purser: ${offer!.why}.` : "";
  const system = airiKey ? [SYSTEM, `Today you have a third purchase, at ${airiName}, a merchant on the CFO's Airi allowlist: pay it with ${AIRI_RAIL} (${AIRI_RAIL_WORDS}). Purser checks it again before Airi is asked; above the CFO's limit it waits for the CFO's Face ID.`].join("\n") : SYSTEM;
  const run = await runAgent(db, {
    agent: "sourcing", task: "purchase.rails", model, system, maxTurns: 6, effort: "low",
    unfinished: () => {
      const left = keys.filter((s) => !done.has(s)).map(nameOf);
      return left.length ? `${left.join(" and ")} ${left.length === 1 ? "is" : "are"} not paid yet. Pay ${left.length === 1 ? "it" : "each"} with pay, on the rail ${left.length === 1 ? "it accepts" : "each accepts"}.` : null;
    },
    prompt: airiKey
      ? `Three purchases are due: ${SUPPLIERS.map((s) => `${SUPPLIER_RAILS[s].name} (${SUPPLIER_RAILS[s].item})`).join(", ")} and ${airiName} (${airi!.item}, ${airi!.amount} ${airi!.currency}). Pick the rail for each.`
      : `Two purchases are due: ${SUPPLIERS.map((s) => `${SUPPLIER_RAILS[s].name} (${SUPPLIER_RAILS[s].item})`).join(" and ")}. Pick the rail for each.`,
    tools: [
      {
        name: "supplier_terms", description: "A supplier's checkout: what you buy and which rails it accepts.",
        input: z.strictObject({ supplier: z.enum(keys as [string, ...string[]]) }),
        run: async ({ supplier }: { supplier: string }) => {
          if (supplier === airiKey) return { text: airiTerms };
          const s = SUPPLIER_RAILS[supplier as Supplier];
          return { text: `${s.name}: ${s.item}. Checkout: ${s.checkout}. Accepts: ${s.rails.map((r) => `${r} (${RAIL_WORDS[r]})`).join(", ")}.` };
        },
      },
      {
        name: "pay", description: "Pays one supplier once, on the rail you pick. Code refuses a rail the supplier does not accept; Metal or Airwallex may still refuse it against your limits.",
        input: z.strictObject({
          supplier: z.enum(keys as [string, ...string[]]),
          rail: z.enum(rails as [ChosenRail, ...ChosenRail[]]).describe(`metal_x402: x402 on Metal under your mandate; airwallex_card: your Airwallex company card${airiKey ? `; ${AIRI_RAIL}: ${AIRI_RAIL_WORDS}, for ${airiName} only` : ""}`),
          reason: z.string().describe("Why this rail, in one short sentence"),
        }),
        run: async ({ supplier, rail, reason }: { supplier: string; rail: ChosenRail; reason: string }) => {
          const before = done.get(supplier);
          if (before) return { text: `Not paid: ${nameOf(supplier)} was already paid once (${before.text}).`, blocked: "paid already" };
          const wrong = wrongRail(supplier, rail);
          if (wrong) {
            audit(db, "sourcing", "purchase.rail_refused", supplier, { supplier, rail, reason: reason.slice(0, 300), why: wrong });
            return { text: `Not paid: ${wrong}. Nothing was charged; pick the rail it accepts.`, blocked: "supplier's rails" };
          }
          const p = await payOn(supplier, rail, "claude", reason);
          return { text: `${nameOf(supplier)} on ${railWords(rail)}: ${p.text}`, ...(p.ok ? {} : { blocked: BLOCKED_BY[rail] }) };
        },
      },
    ],
  }, client);

  // The agent's when every supplier was paid (or refused by the rail) by its own choice, even if the run ended badly
  // afterwards (review of 5.1); code's fallback otherwise.
  const source = keys.every((s) => done.get(s)?.by === "claude") ? "claude" : "fallback";
  for (const s of keys) {
    if (!done.has(s)) await payOn(s, s === airiKey ? AIRI_RAIL : SUPPLIER_RAILS[s as Supplier].rails[0]!, "code", s === airiKey ? "code's choice: the Airi rail the CFO's policy offers for this merchant" : "code's choice: the rail the supplier's checkout accepts");
  }
  const purchases = keys.map((s) => done.get(s)!);
  audit(db, "sourcing", "purchase.rails_chosen", "rails", { source, model: run.model, purchases: purchases.map((p) => ({ supplier: p.supplier, rail: p.rail, by: p.by, ok: p.ok })), ...(offer ? { airi: { offered: offer.offered, why: offer.why.slice(0, 300) } } : {}) });
  return { source, purchases, run };
}
