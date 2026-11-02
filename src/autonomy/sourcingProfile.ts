// D19 block 3: the autonomous Sourcing agent. Goal: keep stock data fresh for paying customers at the best price,
// within its mandate, with at least 1¢ margin. It wakes on a refused purchase, a supplier's notice, a message, or its
// routine check, reads the market (two suppliers: price, data age, how often each was unavailable), and sets the buy
// policy that code then follows on every query at code speed: whom to buy from, the most to pay, how long to serve a
// cached stock check. It can ask the Treasury agent for a higher cap or a price change. It cannot change its mandate:
// Purser and Metal refuse anything over it, and only the CFO approves a new one.

import { currentOrigin } from "../provenance/origin.js";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { MODELS } from "../claude/reader.js";
import { SUPPLIERS, type SupplierId } from "../config/suppliers.js";
import { PLANS, RAIL_WORDS, REPORT_OFFER, TASK_KINDS, type Rail } from "../config/policy.js";
import { bookOnTaskCard, proposeTaskCard } from "../agents/askPurser.js";
import { checkRail } from "../agents/railChoice.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { buyPolicy } from "../agents/sourcing.js";
import { mandatesNow } from "../agents/treasury.js";
import { addresses, sellPrice, supplierPrice } from "../world/runtime.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { proposeCardRaise } from "../agents/cardBuyer.js";
import { buySoftwareOnCard } from "../visa/tapRail.js";
import { maxRaiseCents } from "../agents/declineAgent.js";
import { cardRows } from "../policy/cards.js";
import { setSetting } from "../world/settings.js";
import { sendMessage } from "./bus.js";
import type { AgentProfile } from "./runtime.js";
import type { AgentTool } from "../agents/loop.js";
import { BUY_POLICY_DESCRIPTION, BUY_POLICY_INPUT, checkBuyPolicy, MARKET_DESCRIPTION, sourcingFallback, policyFrom, policyWords, sourcingBrief, SOURCING_DISPLAY, SOURCING_GOAL, SOURCING_RULES, type BuyPolicyInput, type SupplierView } from "./sourcingCore.js";

export type { SupplierView } from "./sourcingCore.js";

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
  /** D22: pays Ridgeline's one-off report on an issued single-use task card (Airwallex decides). */
  payReportOnTaskCard?(taskId: string): Promise<{ approved: boolean; text: string; ref: string | null }>;
  /** Proposes a higher per-purchase card limit to the CFO (a Face ID proposal); the agent cannot set it. */
  askCardRaise?(perPurchase: string, reason: string): Promise<{ proposal_id: string }>;
}

export const SOFTWARE_PLANS = ["packwise-starter", "packwise-pro"] as const;
export type SoftwarePlan = (typeof SOFTWARE_PLANS)[number];

type InfoAnswer = { info: { price?: string; data_age_seconds?: number } } | { why: string; answered: boolean };

async function askInfo(url: string, timeoutMs: number): Promise<InfoAnswer> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { why: `answered HTTP ${res.status}`, answered: true };
    return { info: await res.json() as { price?: string; data_age_seconds?: number } };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return { why: err.name === "TimeoutError" ? `no answer within ${timeoutMs / 1000} s` : err.cause?.code === "ECONNREFUSED" ? "nothing answers on its address" : "the connection failed", answered: false };
  }
}

/**
 * Code's price check of one supplier: its free /v1/info. An error answer (503 while offline for maintenance) is the
 * supplier's answer. No answer at all is checked once more after a pause: in agent run 1 one unanswered check, while the
 * world's process was busy, read as "Stockline: not reachable now" while Stockline was serving (2 November).
 */
export async function checkSupplier(base: string, o: { timeoutMs?: number; pauseMs?: number } = {}): Promise<InfoAnswer> {
  const url = `${base}/v1/info`, timeoutMs = o.timeoutMs ?? 5000;
  const first = await askInfo(url, timeoutMs);
  if ("info" in first || first.answered) return first;
  await new Promise((r) => setTimeout(r, o.pauseMs ?? 1000));
  const second = await askInfo(url, timeoutMs);
  return "info" in second || second.answered ? second : { why: `${second.why}, checked twice`, answered: false };
}

/** One supplier as the Sourcing agent sees it: code's price check of its free /v1/info and its last 20 tries. */
export async function supplierView(db: DB, id: SupplierId, base = `http://127.0.0.1:${SUPPLIERS[id].port}`, check: { timeoutMs?: number; pauseMs?: number } = {}): Promise<SupplierView> {
  const s = SUPPLIERS[id];
  const stats = (db.prepare(`SELECT
      SUM(outcome = 'PAID') AS paid, SUM(outcome = 'REFUSED' AND refusal_reason NOT LIKE 'supplier_unavailable%') AS refused, SUM(refusal_reason LIKE 'supplier_unavailable%') AS unavailable
    FROM (SELECT outcome, refusal_reason FROM upstream_purchases WHERE supplier = ? ORDER BY id DESC LIMIT 20)`).get(id) as { paid: number | null; refused: number | null; unavailable: number | null });
  const a = await checkSupplier(base, check);
  const info = "info" in a ? a.info : null;
  return { id, name: s.name, price_cents: toCents(info?.price ?? supplierPrice(db, id)), data_age_seconds: info?.data_age_seconds ?? s.dataAgeSeconds, available: info !== null,
    ...("why" in a ? { why: a.why } : {}), last20: { paid: stats.paid ?? 0, refused: stats.refused ?? 0, unavailable: stats.unavailable ?? 0 } };
}

/** The suppliers running in this world (Ridgeline Data only where it has a key), each as supplierView reads it. */
export async function liveSuppliers(db: DB): Promise<SupplierView[]> {
  const running: SupplierId[] = addresses(db).ridgeline ? ["stockline", "ridgeline"] : ["stockline"];
  return Promise.all(running.map((id) => supplierView(db, id)));
}

/** The live world: the suppliers on localhost, the mandate from the chain, the price from the ledger. */
export function liveSourcingWorld(db: DB): SourcingWorld {
  return {
    suppliers: async () => liveSuppliers(db),
    mandate: async () => { const m = (await mandatesNow(db)).get("sourcing")!.now; return { capCents: m.capCents, budgetLeftCents: m.budgetCents - m.spentCents }; },
    sellCents: () => toCents(sellPrice(db)),
    // The company card, where it was issued (npm run cards -- setup) and the sandbox keys are set.
    ...(issuingFromEnv() ? {
      card: async () => { const c = cardRows(db).find((x) => x.agent === "sourcing"); return c ? { perTxCents: c.per_tx_cents, monthlyCents: c.monthly_cents } : null; },
      payReportOnTaskCard: async (taskId: string) => {
        const iss = issuingFromEnv()!;
        const t = await bookOnTaskCard(db, iss.sim, taskId, { merchant: REPORT_OFFER.supplier, amount: fromCents(REPORT_OFFER.cardCents), mcc: REPORT_OFFER.mcc }, new Date(), iss.rail);
        return { approved: t.approved, text: t.approved ? "approved by Airwallex" : `declined by Airwallex (${t.failureReason ?? t.status})`, ref: t.transactionId };
      },
      askCardRaise: async (perPurchase: string, reason: string) => ({ proposal_id: proposeCardRaise(db, "sourcing", { perTx: perPurchase }, reason).proposal_id }),
      buyPlan: async (plan: SoftwarePlan) => {
        // D25: with KIT11_TAP_RAIL=on the checkout is signed with TAP and checked by the merchant before the card is charged.
        const t = await buySoftwareOnCard(db, issuingFromEnv()!.sim, plan);
        if (t.approved) return { approved: true, text: "approved by Airwallex", ref: t.transactionId };
        // D22: Airwallex's answer is the agent's to act on (ask_card_raise); its webhook or the poll records it too.
        return { approved: false, text: `declined by Airwallex (${t.failureReason}); your card's limit decides, and only the CFO can raise it: ask with ask_card_raise if you need this plan`, ref: t.transactionId };
      },
    } : {}),
  };
}

export function sourcingProfile(world: SourcingWorld, tickMs = 10 * 60_000): AgentProfile {
  const describe = async (db: DB) => {
    const [suppliers, m, card] = await Promise.all([world.suppliers(), world.mandate(), world.card ? world.card() : Promise.resolve(null)]);
    return sourcingBrief({ suppliers, capCents: m.capCents, budgetLeftCents: m.budgetLeftCents, sellCents: world.sellCents(), policy: buyPolicy(db), card });
  };
  return {
    name: "sourcing", display: SOURCING_DISPLAY, model: MODELS.classify, tickMs,
    goal: SOURCING_GOAL,
    rules: SOURCING_RULES,
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
      // D22: Ridgeline's one-off report, on x402 under the mandate or a single-use Airwallex task card the CFO approves.
      const report: AgentTool<z.ZodType>[] = world.payReportOnTaskCard ? [{
        name: "buy_report",
        description: `Buys ${REPORT_OFFER.supplier}'s ${REPORT_OFFER.item}, if it offered one, on the rail you pick: metal_x402 (${fromCents(REPORT_OFFER.x402Cents)} test USD over x402, paid under your mandate) or airwallex_task_card (${fromCents(REPORT_OFFER.cardCents)} EUR on a single-use Airwallex card for this order only: the CFO approves the card with Face ID first, and once it is issued you call buy_report again to pay on it). Not buying is a valid choice.`,
        input: z.strictObject({ rail: z.enum(["metal_x402", "airwallex_task_card"]), reason: z.string().describe("One sentence: why this rail now") }),
        run: async (p: { rail: "metal_x402" | "airwallex_task_card"; reason: string }) => {
          if (!db.prepare("SELECT 1 FROM world_events WHERE kind = 'supplier.offer' AND for_agent = 'sourcing'").get()) return { text: `Nothing to buy: ${REPORT_OFFER.supplier} has made no offer.`, blocked: "no offer" };
          if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'sourcing.report_bought' AND json_extract(payload_json, '$.approved') = 1").get()) return { text: "Not again: the report is already bought.", blocked: "already bought" };
          if (p.rail === "metal_x402") {
            const m = await world.mandate();
            if (REPORT_OFFER.x402Cents > m.capCents) return { text: `Not paid: ${fromCents(REPORT_OFFER.x402Cents)} is over your mandate's cap of ${fromCents(m.capCents)} a purchase; Purser refuses it before signing, and Metal would refuse it on chain. Ask the Treasury agent for a higher cap, or use a task card.`, blocked: "over the cap" };
            return { text: `Not paid: ${REPORT_OFFER.supplier}'s x402 checkout for the report is not part of this world; use a task card or do not buy.`, blocked: "not offered here" };
          }
          const issued = db.prepare("SELECT t.task_id FROM task_cards t JOIN proposals p ON p.proposal_id = t.proposal_id WHERE t.kind = 'data' AND t.status = 'ACTIVE' AND p.created_by = 'sourcing' ORDER BY t.created_at DESC").get() as { task_id: string } | undefined;
          if (issued) {
            const r = await world.payReportOnTaskCard!(issued.task_id);
            audit(db, "sourcing", "sourcing.report_bought", issued.task_id, { rail: p.rail, approved: r.approved, ref: r.ref, amount: fromCents(REPORT_OFFER.cardCents), currency: "EUR", reason: p.reason.trim().slice(0, 300), text: r.text.slice(0, 300) });
            return { text: `${REPORT_OFFER.supplier}'s report, ${fromCents(REPORT_OFFER.cardCents)} EUR on the single-use card: ${r.text}`, ...(r.approved ? {} : { blocked: "declined by Airwallex" }) };
          }
          const waiting = db.prepare("SELECT proposal_id FROM proposals WHERE kind = 'task_card' AND status = 'PENDING_APPROVAL' AND created_by = 'sourcing' AND expires_at > ?").get(new Date().toISOString()) as { proposal_id: string } | undefined;
          if (waiting) return { text: `Not asked again: ${waiting.proposal_id} already waits for the CFO's Face ID.`, blocked: "already waiting" };
          const now = new Date();
          const prop = proposeTaskCard(db, {
            kind: "data", label: TASK_KINDS.data.label, mccs: [...TASK_KINDS.data.mccs], amountCents: REPORT_OFFER.cardCents,
            validUntil: new Date(now.getTime() + 7 * 86_400_000).toISOString(), purpose: REPORT_OFFER.purpose,
          }, p.reason.trim().slice(0, 300), now, "sourcing", "agent:sourcing");
          return { text: `Asked the CFO for a single-use Airwallex card of ${fromCents(REPORT_OFFER.cardCents)} EUR for the report: ${prop.proposal_id} waits for Face ID. Once it is issued, call buy_report again to pay on it.` };
        },
      }] : [];
      return [
      ...software,
      ...report,
      ...raise,
      {
        name: "market", description: MARKET_DESCRIPTION,
        input: z.strictObject({}),
        run: async () => ({ text: await describe(db) }),
      },
      {
        name: "set_buy_policy", description: BUY_POLICY_DESCRIPTION,
        input: BUY_POLICY_INPUT,
        run: async (p: BuyPolicyInput) => {
          const [sup, m] = await Promise.all([world.suppliers(), world.mandate()]);
          const no = checkBuyPolicy(p, sup, m.capCents, world.sellCents());
          if (no) return no;
          const next = policyFrom(p);
          setSetting(db, "sourcing", "sourcing.buy_policy", JSON.stringify(next));
          // D24: who set the policy (the agent's Claude run), so every purchase under it can name that decision.
          audit(db, "sourcing", "sourcing.policy_set", "buy_policy", { ...next, origin: (currentOrigin() as never) ?? null });
          return { text: `Buy policy set: ${policyWords(next)}.` };
        },
      },
    ];
    },
    // Without Claude: the policy stays as it was; a refusal over the cap goes to Treasury in code's words, as before.
    fallback: async (db, events) => {
      const f = sourcingFallback(events);
      if (f.message) sendMessage(db, "sourcing", "treasury", f.message);
      return f.summary;
    },
  };
}
