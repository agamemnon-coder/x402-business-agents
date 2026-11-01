// Block 5.2: an Airwallex card decline starts the agent whose card it is (Haiku, with tools). It reads why Airwallex
// declined and acts: over the limit, it proposes a higher limit in its own words, which the CFO approves with Face ID;
// for any other reason (a merchant kind the card may not pay, a frozen card) a higher limit would not help, so it
// proposes none and says why. Code bounds the raise: it must cover the purchase and stay within 1.25× of it (no
// headroom "to be safe"), monthly too when the month would still decline it; one proposal per decline. Airwallex
// enforces the limit either way; nothing here changes a card.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import type { Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { runAgent, type AgentRun } from "./loop.js";

export interface DeclineFacts {
  agent: Agent;
  transactionId: string;
  merchant: string;
  item: string;
  amountCents: number;
  /** Airwallex's code: LIMIT_EXCEEDED, MERCHANT_CATEGORY_NOT_ALLOWED, CARD_INACTIVE… */
  reason: string;
  perTxCents: number;
  monthlyCents: number;
  spentMonthCents: number;
}

export interface DeclineDeps {
  /** Files the raise as a policy change for the CFO's Face ID (src/agents/cardBuyer.ts proposeCardRaise). */
  propose(r: { perTx: string; monthly?: string; reason: string }): { proposal_id: string };
}

export interface DeclineMeeting { source: "claude" | "fallback"; proposal_id: string | null; said: string; run: AgentRun }

export const REASON_WORDS: Record<string, string> = {
  LIMIT_EXCEEDED: "the purchase is over the card's limit",
  MERCHANT_CATEGORY_NOT_ALLOWED: "the card may not pay this kind of merchant",
  CURRENCY_NOT_ALLOWED: "the card may not pay in this currency",
  CARD_INACTIVE: "the card is frozen (a pause or the emergency stop)",
  CARD_NOT_ACTIVE: "the card is not active",
  CARD_CLOSED: "the card is closed",
};

/** The most a raise may be: the purchase × 1.25, rounded up to whole euros (45.00 → 57.00). */
export const maxRaiseCents = (cents: number) => Math.ceil((cents * 1.25) / 100) * 100;
const roundUp10 = (cents: number) => Math.ceil(cents / 1000) * 1000;

const SYSTEM = [
  "You are the Sourcing agent of Northwind Outdoor. You buy software on your company card at Airwallex; the CFO's limits sit on the card itself.",
  "Airwallex just declined one of your purchases. Read why with read_decline. If a limit caused it and the purchase is worth it, propose a higher limit with propose_raise: enough to cover it, no headroom beyond, with one sentence on why. If a limit did not cause it, a higher limit would not help: call no_raise and say what would.",
  "You cannot change your card: the CFO approves any raise with Face ID, and Airwallex enforces the limit either way.",
].join("\n");

export async function meetDecline(db: DB, f: DeclineFacts, deps: DeclineDeps, client: Anthropic | null = claudeClient(), model: string = MODELS.classify): Promise<DeclineMeeting> {
  let proposal: string | null = null, decided = false, said = "";
  const limit = f.reason === "LIMIT_EXCEEDED";
  const monthNeed = f.spentMonthCents + f.amountCents;
  const monthShort = monthNeed > f.monthlyCents;
  const money = z.string().regex(/^\d+\.\d{2}$/);

  const run = await runAgent(db, {
    agent: f.agent, task: `card.decline.${f.transactionId}`, model, system: SYSTEM, maxTurns: 6, effort: "low",
    unfinished: () => (decided ? null : "you have not decided yet: propose_raise if a limit caused the decline, no_raise otherwise."),
    prompt: `Airwallex declined ${fromCents(f.amountCents)} EUR at ${f.merchant} (${f.item}) on your card.`,
    tools: [
      {
        name: "read_decline", description: "Why Airwallex declined, and your card's limits and spend this month.",
        input: z.strictObject({}),
        run: async () => ({ text: `Airwallex: ${f.reason} (${REASON_WORDS[f.reason] ?? "no reason in words"}). Purchase ${fromCents(f.amountCents)} EUR at ${f.merchant}. Card: ${fromCents(f.perTxCents)} per purchase, ${fromCents(f.monthlyCents)} a month, ${fromCents(f.spentMonthCents)} spent this month.` }),
      },
      {
        name: "propose_raise", description: "Proposes a higher card limit to the CFO (Face ID). Only for a decline a limit caused; enough to cover the purchase, at most 1.25× it.",
        input: z.strictObject({
          per_purchase: money.describe("New limit per purchase, e.g. \"50.00\""),
          per_month: money.nullable().describe("New monthly limit, only if the month would still decline it; else null"),
          reason: z.string().describe("One sentence for the CFO: why this purchase is worth it"),
        }),
        run: async ({ per_purchase, per_month, reason }: { per_purchase: string; per_month: string | null; reason: string }) => {
          if (proposal) return { text: `Not proposed: ${proposal} is already waiting for the CFO.`, blocked: "proposed already" };
          if (!limit) return { text: `Not proposed: Airwallex declined for ${f.reason} (${REASON_WORDS[f.reason] ?? "?"}), not a limit; a higher limit would not help.`, blocked: "not a limit decline" };
          const per = toCents(per_purchase);
          if (per < f.amountCents || per > maxRaiseCents(f.amountCents)) {
            return { text: `Not proposed: the limit per purchase must cover ${fromCents(f.amountCents)} and be at most ${fromCents(maxRaiseCents(f.amountCents))} (1.25× the purchase, no headroom).`, blocked: "raise bounds" };
          }
          if (monthShort && per_month === null) {
            return { text: `Not proposed: ${fromCents(f.spentMonthCents)} spent this month + ${fromCents(f.amountCents)} is over the ${fromCents(f.monthlyCents)} monthly limit, so it would still be declined; propose a monthly limit of at least ${fromCents(monthNeed)} and at most ${fromCents(maxRaiseCents(monthNeed))}.`, blocked: "raise bounds" };
          }
          if (per_month !== null) {
            const m = toCents(per_month);
            if (!monthShort) return { text: `Not proposed: the monthly limit of ${fromCents(f.monthlyCents)} already covers it; leave per_month null.`, blocked: "raise bounds" };
            if (m < monthNeed || m > maxRaiseCents(monthNeed)) return { text: `Not proposed: the monthly limit must be at least ${fromCents(monthNeed)} and at most ${fromCents(maxRaiseCents(monthNeed))}.`, blocked: "raise bounds" };
          }
          said = reason.trim().slice(0, 400);
          proposal = deps.propose({ perTx: fromCents(per), ...(per_month !== null ? { monthly: fromCents(toCents(per_month)) } : {}), reason: said }).proposal_id;
          decided = true;
          return { text: `${proposal} is with the CFO: ${fromCents(per)} per purchase${per_month !== null ? `, ${per_month} a month` : ""}.`, final: true };
        },
      },
      {
        name: "no_raise", description: "Proposes nothing, with one sentence on why (and what would help instead).",
        input: z.strictObject({ reason: z.string() }),
        run: async ({ reason }: { reason: string }) => {
          said = reason.trim().slice(0, 400);
          decided = true;
          return { text: "Noted; nothing proposed.", final: true };
        },
      },
    ],
  }, client);

  let source: DeclineMeeting["source"] = decided ? "claude" : "fallback";
  if (!decided && limit) {
    // Code's fixed rule, as before the agents: the purchase rounded up to 10.00, the month too if it is short.
    said = `Airwallex declined ${fromCents(f.amountCents)} EUR at ${f.merchant} over my ${fromCents(f.perTxCents)} limit; ${f.item} is the plan I need.`;
    proposal = deps.propose({ perTx: fromCents(roundUp10(f.amountCents)), ...(monthShort ? { monthly: fromCents(roundUp10(monthNeed)) } : {}), reason: said }).proposal_id;
    source = "fallback";
  }
  audit(db, f.agent, "card.decline_met", f.transactionId, { agent: f.agent, source, model: run.model, reason: f.reason, proposal_id: proposal, said });
  return { source, proposal_id: proposal, said, run };
}
