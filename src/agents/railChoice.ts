// Block 5.1: the Sourcing agent picks the rail per purchase (Haiku, with tools). This morning it has two purchases: the
// next customer's stock check from Stockline and Packwise's Starter plan. It reads each supplier's checkout and pays on a
// rail; code checks that the supplier accepts that rail before anything is paid (src/config/policy.ts, SUPPLIER_RAILS),
// and the rail itself enforces the limit: the Metal mandate on chain, the card's limits at Airwallex. A wrong rail is
// refused with the reason; the agent may try again. Without the agent, code pays each on the registry's rail.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import { RAIL_WORDS, SUPPLIER_RAILS, type Rail, type Supplier } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { runAgent, type AgentRun } from "./loop.js";

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
}

export interface RailPurchase {
  supplier: Supplier;
  rail: Rail;
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
const BLOCKED_BY: Record<Rail, string> = { metal_x402: "Metal x402", airwallex_card: "Airwallex card" };

/** Null when the supplier accepts the rail; otherwise why not, in words the agent and the CFO read. */
export function checkRail(supplier: Supplier, rail: Rail): string | null {
  const s = SUPPLIER_RAILS[supplier];
  if (s.rails.includes(rail)) return null;
  const only = s.rails.length === 1 && s.rails[0] === "metal_x402" ? "only x402 on Metal" : "only a card";
  return `${s.name} accepts ${only} (${s.checkout}), not ${RAIL_WORDS[rail]}`;
}

const SYSTEM = [
  "You are the Sourcing agent of Northwind Outdoor. You pay suppliers on one of two rails: x402 on Metal (a stablecoin payment under your own on-chain mandate: a cap per purchase, a budget, named payees) or your company card at Airwallex (software merchants only, a limit per purchase and per month).",
  "This morning you have two purchases: the next customer's stock check from Stockline, and Packwise's Starter plan. Read each supplier's checkout with supplier_terms, then pay each once with pay, on the rail that supplier accepts, with a short reason.",
  "Code refuses a rail a supplier does not accept, before anything is paid. You cannot change your limits: Metal and Airwallex enforce them, and only the CFO can approve new ones.",
].join("\n");

export async function chooseRails(db: DB, deps: RailDeps, client: Anthropic | null = claudeClient(), model: string = MODELS.classify): Promise<RailChoice> {
  const done = new Map<Supplier, RailPurchase>();
  const payOn = async (supplier: Supplier, rail: Rail, by: RailPurchase["by"], reason: string): Promise<RailPurchase> => {
    let r: RailPayment;
    try {
      r = await (supplier === "stockline" ? deps.payStockline() : deps.payPackwise());
    } catch (e) {
      r = { ok: false, text: `refused before signing: ${(e as Error).message}`, ref: null };
    }
    const p: RailPurchase = { supplier, rail, by, reason: reason.trim().slice(0, 300), ok: r.ok, text: r.text, ref: r.ref };
    done.set(supplier, p);
    audit(db, "sourcing", "purchase.rail_chosen", supplier, { supplier, rail, by, reason: p.reason, ok: r.ok, result: r.text.slice(0, 300), ref: r.ref });
    return p;
  };

  const run = await runAgent(db, {
    agent: "sourcing", task: "purchase.rails", model, system: SYSTEM, maxTurns: 6, effort: "low",
    unfinished: () => {
      const left = SUPPLIERS.filter((s) => !done.has(s)).map((s) => SUPPLIER_RAILS[s].name);
      return left.length ? `${left.join(" and ")} ${left.length === 1 ? "is" : "are"} not paid yet. Pay ${left.length === 1 ? "it" : "each"} with pay, on the rail ${left.length === 1 ? "it accepts" : "each accepts"}.` : null;
    },
    prompt: `Two purchases are due: ${SUPPLIERS.map((s) => `${SUPPLIER_RAILS[s].name} (${SUPPLIER_RAILS[s].item})`).join(" and ")}. Pick the rail for each.`,
    tools: [
      {
        name: "supplier_terms", description: "A supplier's checkout: what you buy and which rails it accepts.",
        input: z.strictObject({ supplier: z.enum(SUPPLIERS as [Supplier, ...Supplier[]]) }),
        run: async ({ supplier }: { supplier: Supplier }) => {
          const s = SUPPLIER_RAILS[supplier];
          return { text: `${s.name}: ${s.item}. Checkout: ${s.checkout}. Accepts: ${s.rails.map((r) => `${r} (${RAIL_WORDS[r]})`).join(", ")}.` };
        },
      },
      {
        name: "pay", description: "Pays one supplier once, on the rail you pick. Code refuses a rail the supplier does not accept; Metal or Airwallex may still refuse it against your limits.",
        input: z.strictObject({
          supplier: z.enum(SUPPLIERS as [Supplier, ...Supplier[]]),
          rail: z.enum(RAILS as [Rail, ...Rail[]]).describe("metal_x402: x402 on Metal under your mandate; airwallex_card: your Airwallex company card"),
          reason: z.string().describe("Why this rail, in one short sentence"),
        }),
        run: async ({ supplier, rail, reason }: { supplier: Supplier; rail: Rail; reason: string }) => {
          const before = done.get(supplier);
          if (before) return { text: `Not paid: ${SUPPLIER_RAILS[supplier].name} was already paid once (${before.text}).`, blocked: "paid already" };
          const wrong = checkRail(supplier, rail);
          if (wrong) {
            audit(db, "sourcing", "purchase.rail_refused", supplier, { supplier, rail, reason: reason.slice(0, 300), why: wrong });
            return { text: `Not paid: ${wrong}. Nothing was charged; pick the rail it accepts.`, blocked: "supplier's rails" };
          }
          const p = await payOn(supplier, rail, "claude", reason);
          return { text: `${SUPPLIER_RAILS[supplier].name} on ${RAIL_WORDS[rail]}: ${p.text}`, ...(p.ok ? {} : { blocked: BLOCKED_BY[rail] }) };
        },
      },
    ],
  }, client);

  // Counts as the agent's only when it finished with every supplier paid (or refused by the rail) by its own choice.
  const source = run.status === "done" && SUPPLIERS.every((s) => done.get(s)?.by === "claude") ? "claude" : "fallback";
  for (const s of SUPPLIERS) {
    if (!done.has(s)) await payOn(s, SUPPLIER_RAILS[s].rails[0]!, "code", "code's choice: the rail the supplier's checkout accepts");
  }
  const purchases = SUPPLIERS.map((s) => done.get(s)!);
  audit(db, "sourcing", "purchase.rails_chosen", "rails", { source, model: run.model, purchases: purchases.map((p) => ({ supplier: p.supplier, rail: p.rail, by: p.by, ok: p.ok })) });
  return { source, purchases, run };
}
