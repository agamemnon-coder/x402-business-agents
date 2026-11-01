// D19 block 3: the autonomous Sourcing agent. Goal: keep stock data fresh for paying customers at the best price,
// within its mandate, with at least 1¢ margin. It wakes on a refused purchase, a supplier's notice, a message, or its
// routine check, reads the market (two suppliers: price, data age, how often each was unavailable), and sets the buy
// policy that code then follows on every query at code speed: whom to buy from, the most to pay, how long to serve a
// cached stock check. It can ask the Treasury agent for a higher cap or a price change. It cannot change its mandate:
// Purser and Metal refuse anything over it, and only the CFO approves a new one.

import { z } from "zod";
import { audit } from "../audit/log.js";
import { MODELS } from "../claude/reader.js";
import { MAX_CACHE_SECONDS, MIN_MARGIN_CENTS, SUPPLIERS, type SupplierId } from "../config/suppliers.js";
import { PLANS, RAIL_WORDS, type Rail } from "../config/policy.js";
import { checkRail } from "../agents/railChoice.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { buyPolicy, type BuyPolicy } from "../agents/sourcing.js";
import { mandatesNow } from "../agents/treasury.js";
import { addresses, sellPrice, supplierPrice } from "../world/runtime.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { buyPlan, proposeCardRaise } from "../agents/cardBuyer.js";
import { maxRaiseCents } from "../agents/declineAgent.js";
import { cardRows } from "../policy/cards.js";
import { meetNewDeclines } from "../agents/declineTrigger.js";
import { setSetting } from "../world/settings.js";
import { sendMessage } from "./bus.js";
import type { AgentProfile } from "./runtime.js";
import type { AgentTool } from "../agents/loop.js";

export interface SupplierView { id: SupplierId; name: string; price_cents: number; data_age_seconds: number; available: boolean; last20: { paid: number; refused: number; unavailable: number } }

export interface SourcingWorld {
  /** Each supplier's live terms (its free /v1/info); unreachable: available false. */
  suppliers(): Promise<SupplierView[]>;
  /** The Sourcing mandate as the chain has it. */
  mandate(): Promise<{ capCents: number; budgetLeftCents: number }>;
  sellCents(): number;
  /** The Sourcing agent's company card at Airwallex (absent where the world has none). */
  card?(): Promise<{ perTxCents: number; monthlyCents: number } | null>;
  /** Charges a software plan to that card at Airwallex; a decline starts the decline agent (block 5.2). */
  buyPlan?(plan: SoftwarePlan): Promise<{ approved: boolean; text: string; ref: string | null }>;
  /** Proposes a higher per-purchase card limit to the CFO (a Face ID proposal); the agent cannot set it. */
  askCardRaise?(perPurchase: string, reason: string): Promise<{ proposal_id: string }>;
}

export const SOFTWARE_PLANS = ["packwise-starter", "packwise-pro"] as const;
export type SoftwarePlan = (typeof SOFTWARE_PLANS)[number];

/** The live world: the suppliers on localhost, the mandate from the chain, the price from the ledger. */
export function liveSourcingWorld(db: DB): SourcingWorld {
  const running = (): SupplierId[] => (addresses(db).ridgeline ? ["stockline", "ridgeline"] : ["stockline"]);
  return {
    suppliers: async () => Promise.all(running().map(async (id) => {
      const s = SUPPLIERS[id];
      const stats = (db.prepare(`SELECT
          SUM(outcome = 'PAID') AS paid, SUM(outcome = 'REFUSED' AND refusal_reason NOT LIKE 'supplier_unavailable%') AS refused, SUM(refusal_reason LIKE 'supplier_unavailable%') AS unavailable
        FROM (SELECT outcome, refusal_reason FROM upstream_purchases WHERE supplier = ? ORDER BY id DESC LIMIT 20)`).get(id) as { paid: number | null; refused: number | null; unavailable: number | null });
      let info: { price?: string; data_age_seconds?: number } | null;
      try {
        info = await (await fetch(`http://127.0.0.1:${s.port}/v1/info`, { signal: AbortSignal.timeout(5000) })).json() as { price?: string; data_age_seconds?: number };
      } catch { info = null; }
      return { id, name: s.name, price_cents: toCents(info?.price ?? supplierPrice(db, id)), data_age_seconds: info?.data_age_seconds ?? s.dataAgeSeconds, available: info !== null,
        last20: { paid: stats.paid ?? 0, refused: stats.refused ?? 0, unavailable: stats.unavailable ?? 0 } };
    })),
    mandate: async () => { const m = (await mandatesNow(db)).get("sourcing")!.now; return { capCents: m.capCents, budgetLeftCents: m.budgetCents - m.spentCents }; },
    sellCents: () => toCents(sellPrice(db)),
    // The company card, where it was issued (npm run cards -- setup) and the sandbox keys are set.
    ...(issuingFromEnv() ? {
      card: async () => { const c = cardRows(db).find((x) => x.agent === "sourcing"); return c ? { perTxCents: c.per_tx_cents, monthlyCents: c.monthly_cents } : null; },
      askCardRaise: async (perPurchase: string, reason: string) => ({ proposal_id: proposeCardRaise(db, "sourcing", { perTx: perPurchase }, reason).proposal_id }),
      buyPlan: async (plan: SoftwarePlan) => {
        const t = await buyPlan(db, issuingFromEnv()!.sim, plan);
        if (t.approved) return { approved: true, text: "approved by Airwallex", ref: t.transactionId };
        // Block 5.2: a decline starts the decline agent here (claimed once, so the runner does not meet it again).
        const met = await meetNewDeclines(db, { by: "sourcing" });
        const raise = met.find((x) => x.proposal_id)?.proposal_id ?? null;
        return { approved: false, text: `declined by Airwallex (${t.failureReason})${raise ? `; the raise ${raise} waits for the CFO's Face ID` : "; no raise was proposed"}`, ref: t.transactionId };
      },
    } : {}),
  };
}

const policyWords = (p: BuyPolicy) => `${p.supplier === "none" ? "do not buy" : `buy from ${SUPPLIERS[p.supplier].name}`}${p.max_price ? ` up to ${p.max_price}` : " up to the mandate's cap"}${p.cache_seconds ? `, serve a cached stock check up to ${p.cache_seconds} s old` : ", no cache"}`;

export function sourcingProfile(world: SourcingWorld, tickMs = 10 * 60_000): AgentProfile {
  const describe = async (db: DB) => {
    const [sup, m, card] = await Promise.all([world.suppliers(), world.mandate(), world.card ? world.card() : Promise.resolve(null)]);
    const sell = world.sellCents();
    return [
      `You sell each stock check to customers for ${fromCents(sell)}. Your mandate: at most ${fromCents(m.capCents)} a purchase, ${fromCents(m.budgetLeftCents)} budget left.`,
      ...sup.map((s) => `- ${s.name} (${s.id}): ${s.available ? `${fromCents(s.price_cents)} a stock check, data ${s.data_age_seconds < 60 ? `${s.data_age_seconds} s` : `${Math.round(s.data_age_seconds / 60)} min`} old; margin at that price ${fromCents(sell - s.price_cents)}` : "not reachable now"}; last 20 tries: ${s.last20.paid} paid, ${s.last20.refused} refused, ${s.last20.unavailable} unavailable.`),
      `Your buy policy now: ${policyWords(buyPolicy(db))}.`,
      ...(card ? [`Your company card (Airwallex, software only): up to ${fromCents(card.perTxCents)} EUR a purchase, ${fromCents(card.monthlyCents)} EUR a month.`] : []),
    ].join("\n");
  };
  return {
    name: "sourcing", display: "the Sourcing agent", model: MODELS.classify, tickMs,
    goal: `keep stock data fresh for paying customers at the best price, stay within your mandate, and keep a margin of at least ${fromCents(MIN_MARGIN_CENTS)} per query.`,
    rules: [
      "Code buys a stock check for every customer query, following the buy policy you set: which supplier, the most to pay, how long a cached stock check may be served. You decide the policy; code runs it at code speed.",
      "Your mandate (a cap per purchase, a budget, these suppliers as payees) is enforced by Purser before signing and by Metal on chain. You cannot change it: ask the Treasury agent (send_message) for a higher cap or budget, or for a higher query price; the CFO decides with Face ID.",
      "Your warehouse software (Packwise) is a monthly plan; when it must change, buy_software pays it on the rail you pick. Your company card's limits are Airwallex's: a decline is final. You may ask the CFO for a higher limit (ask_card_raise), before buying or after a decline; the CFO decides with Face ID.",
    ].join("\n"),
    observe: describe,
    tools: (db) => {
      const tried = new Set<string>();
      const software: AgentTool<z.ZodType>[] = world.buyPlan ? [{
        name: "buy_software",
        description: `Buys a plan of Packwise's warehouse software for this month on the rail you pick. Plans: ${SOFTWARE_PLANS.map((id) => `${id} (${fromCents(PLANS[id]!.amountCents)} EUR, ${PLANS[id]!.label})`).join("; ")}. Rails: ${Object.entries(RAIL_WORDS).map(([k, v]) => `${k} = ${v}`).join("; ")}. Code checks the supplier accepts the rail; the card's limits are Airwallex's.`,
        input: z.strictObject({ plan: z.enum(SOFTWARE_PLANS), rail: z.enum(["metal_x402", "airwallex_card"]), reason: z.string().describe("One sentence: why this plan now") }),
        run: async (p: { plan: SoftwarePlan; rail: Rail; reason: string }) => {
          const wrong = checkRail("packwise", p.rail);
          if (wrong) return { text: `Not paid: ${wrong}`, blocked: "supplier's rails" };
          if (tried.has(p.plan)) return { text: `Not again: you already tried ${p.plan} in this wake; Airwallex's answer stands.`, blocked: "already tried" };
          tried.add(p.plan);
          const month = new Date().toISOString().slice(0, 7);
          if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'sourcing.software_bought' AND subject = ? AND json_extract(payload_json, '$.approved') = 1 AND substr(ts, 1, 7) = ?").get(p.plan, month)) {
            return { text: `Not again: ${p.plan} is already paid for this month.`, blocked: "already paid" };
          }
          const r = await world.buyPlan!(p.plan);
          audit(db, "sourcing", "sourcing.software_bought", p.plan, { plan: p.plan, rail: p.rail, approved: r.approved, ref: r.ref, reason: p.reason.trim().slice(0, 300), text: r.text.slice(0, 300) });
          return { text: `${PLANS[p.plan]!.label}, ${fromCents(PLANS[p.plan]!.amountCents)} EUR on your card: ${r.text}` };
        },
      }] : [];
      let asked = false;
      const raise: AgentTool<z.ZodType>[] = world.askCardRaise ? [{
        name: "ask_card_raise",
        description: "Asks the CFO for a higher per-purchase limit on your company card, for a plan you need. Code bounds it: at least the plan's price, at most 1.25 times it (rounded up to whole euros). The CFO approves or rejects with Face ID; Airwallex enforces the limit either way.",
        input: z.strictObject({ plan: z.enum(SOFTWARE_PLANS), per_purchase: z.string().regex(/^\d+\.\d{2}$/), reason: z.string().describe("One sentence for the CFO: why this plan, why now") }),
        run: async (p: { plan: SoftwarePlan; per_purchase: string; reason: string }) => {
          const price = PLANS[p.plan]!.amountCents, want = toCents(p.per_purchase), most = maxRaiseCents(price);
          if (want < price) return { text: `Not asked: ${p.per_purchase} would not cover ${fromCents(price)} EUR.`, blocked: "below the price" };
          if (want > most) return { text: `Not asked: at most ${fromCents(most)} EUR for a ${fromCents(price)} EUR plan (1.25 times, rounded up).`, blocked: "over 1.25x" };
          const card = world.card ? await world.card() : null;
          if (card && want <= card.perTxCents) return { text: `Not asked: your card already allows ${fromCents(card.perTxCents)} EUR a purchase.`, blocked: "no raise needed" };
          if (asked || db.prepare("SELECT 1 FROM proposals WHERE kind = 'policy_change' AND status = 'PENDING_APPROVAL' AND created_by = 'sourcing' AND expires_at > ?").get(new Date().toISOString())) {
            return { text: "Not asked again: a card raise already waits for the CFO.", blocked: "already asked" };
          }
          asked = true;
          const r = await world.askCardRaise!(p.per_purchase, p.reason.trim().slice(0, 300));
          return { text: `Asked the CFO for ${p.per_purchase} EUR a purchase: ${r.proposal_id} waits for Face ID. Buy the plan once it is approved.` };
        },
      }] : [];
      return [
      ...software,
      ...raise,
      {
        name: "market", description: "The suppliers now: price, data age, margin at your sell price, and how their last 20 tries went; your mandate and buy policy.",
        input: z.strictObject({}),
        run: async () => ({ text: await describe(db) }),
      },
      {
        name: "set_buy_policy", description: `Sets the policy code follows on every query. supplier: stockline, ridgeline, or none (serve only from the cache, otherwise refuse the query; the customer is not charged). max_price: the most per stock check, or null for up to your cap. cache_seconds: 0 to ${MAX_CACHE_SECONDS}.`,
        input: z.strictObject({
          supplier: z.enum(["stockline", "ridgeline", "none"]),
          max_price: z.string().regex(/^\d+\.\d{2}$/).nullable(),
          cache_seconds: z.number().int().min(0).max(MAX_CACHE_SECONDS),
          reason: z.string().describe("One sentence: why this policy"),
        }),
        run: async (p: { supplier: SupplierId | "none"; max_price: string | null; cache_seconds: number; reason: string }) => {
          const [sup, m] = await Promise.all([world.suppliers(), world.mandate()]);
          const sell = world.sellCents();
          if (p.supplier !== "none") {
            const s = sup.find((x) => x.id === p.supplier);
            if (!s) return { text: `Not set: ${SUPPLIERS[p.supplier].name} is not one of your suppliers here.`, blocked: "supplier" };
            const limit = p.max_price ? toCents(p.max_price) : m.capCents;
            if (p.max_price && toCents(p.max_price) > m.capCents) return { text: `Not set: ${p.max_price} is over your mandate's cap of ${fromCents(m.capCents)}; purchases over it are refused anyway. Ask the Treasury agent for a higher cap.`, blocked: "over the cap" };
            // The goal margin: a policy that would buy at a price leaving less than 1¢ is refused (one that only refuses
            // because the price is over its max_price buys nothing, so it costs no margin).
            if (s.price_cents <= limit && sell - s.price_cents < MIN_MARGIN_CENTS) {
              return { text: `Not set: ${s.name} at ${fromCents(s.price_cents)} against a sell price of ${fromCents(sell)} leaves under ${fromCents(MIN_MARGIN_CENTS)} margin. Choose otherwise, or ask the Treasury agent for a higher query price.`, blocked: "margin" };
            }
          }
          const next: BuyPolicy = { supplier: p.supplier, max_price: p.max_price, cache_seconds: p.cache_seconds, set_by: "sourcing", reason: p.reason.trim().slice(0, 300) };
          setSetting(db, "sourcing", "sourcing.buy_policy", JSON.stringify(next));
          audit(db, "sourcing", "sourcing.policy_set", "buy_policy", { ...next });
          return { text: `Buy policy set: ${policyWords(next)}.` };
        },
      },
    ];
    },
    // Without Claude: the policy stays as it was; a refusal over the cap goes to Treasury in code's words, as before.
    fallback: async (db, events) => {
      const refused = events.find((e) => e.kind === "upstream.refused" && String(e.payload.reason ?? "").startsWith("mandate_cap_exceeded"));
      if (!refused) return "kept the buy policy as it was";
      sendMessage(db, "sourcing", "treasury", `A purchase was refused over my mandate's cap: ${String(refused.payload.reason)}. I need a higher cap to keep buying from Stockline.`);
      return "kept the buy policy and told the Treasury agent about the refusal (code's message)";
    },
  };
}
