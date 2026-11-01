// The Sourcing agent meets a supplier's price rise itself (Haiku, with tools). It checks Stockline's live offer
// against its own mandate, serves the next customer query (which buys the stock check upstream under that mandate),
// sees whether Metal lets the purchase through, and tells the Treasury agent what happened and what it needs, in its
// own words. Metal's refusal on chain is the limit: no tool lets the agent change its cap, its budget or its payee.
// Without the agent, code does the same steps as before and writes the message itself.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { runAgent, type AgentRun } from "./loop.js";

export interface SourcingDeps {
  /** Stockline's live offer for one stock check, and the agent's mandate as the chain has it. */
  offer(): Promise<{ liveCents: number; capCents: number; budgetLeftCents: number }>;
  /** Serves the next customer query: the purchase upstream under the mandate, refused or not. */
  tryPurchase(): Promise<{ seq: number; refused: string | null; charged: boolean }>;
  /** Hands the agent's message to the Treasury agent (and the log). */
  notify(message: string): void;
}

export interface PriceRiseMeeting {
  source: "claude" | "fallback";
  tried: boolean;
  refusal: string | null;
  seq: number | null;
  /** What the agent told Treasury, in its own words; empty when code took over. */
  message: string;
  run: AgentRun;
}

const SYSTEM = [
  "You are the Sourcing agent of Northwind Outdoor. For each customer query you buy one live stock check from the supplier Stockline and resell it, paying under your own on-chain mandate on Metal: a cap per purchase, a budget, Stockline as the only payee.",
  "Stockline has sent a price notice. Find out what it means for you: check the live offer against your mandate with check_offer, serve the next customer query with try_purchase (you may try once), and tell the Treasury agent with notify_treasury what happened and what you need, in one or two plain sentences with the numbers.",
  "You cannot raise your own cap or budget, or pay anyone else: Metal enforces your mandate on chain, and only the CFO can approve a new one.",
].join("\n");

export async function meetPriceRise(db: DB, f: { oldCents: number; noticeCents: number }, deps: SourcingDeps, client: Anthropic | null = claudeClient(), model: string = MODELS.classify): Promise<PriceRiseMeeting> {
  let tried = false, refusal: string | null = null, seq: number | null = null, message = "";
  const None = z.strictObject({});
  const run = await runAgent(db, {
    agent: "sourcing", task: "price_rise.meet", model, system: SYSTEM, maxTurns: 6, effort: "low",
    unfinished: () => (!tried ? "you have not served the next customer query yet. Call try_purchase first, then tell the Treasury agent with notify_treasury."
      : !message ? "you tried the purchase but have not told the Treasury agent yet. Call notify_treasury." : null),
    prompt: `Stockline's notice says its price per stock check goes from ${fromCents(f.oldCents)} to ${fromCents(f.noticeCents)}. Code has read the notice and cross-checked it against the live offer.`,
    tools: [
      {
        name: "check_offer", description: "Stockline's live price for one stock check, and your mandate's cap and budget left, as the chain has them.",
        input: None,
        run: async () => {
          const o = await deps.offer();
          return { text: `Live offer ${fromCents(o.liveCents)}; your cap ${fromCents(o.capCents)} a purchase; budget left ${fromCents(o.budgetLeftCents)}.` };
        },
      },
      {
        name: "try_purchase", description: "Serves the next customer query: buys its stock check from Stockline under your mandate. Once.",
        input: None,
        run: async () => {
          if (tried) return { text: "You already tried; a second try would be refused the same way.", blocked: "one try" };
          tried = true;
          const p = await deps.tryPurchase();
          refusal = p.refused; seq = p.seq;
          return {
            text: p.refused
              ? `Stock check #${p.seq}: Metal refused the purchase against your mandate (${p.refused}). The customer was ${p.charged ? "CHARGED" : "not charged"}.`
              : `Stock check #${p.seq}: bought and sold.`,
            ...(p.refused ? { blocked: "Metal mandate" } : {}),
          };
        },
      },
      {
        name: "notify_treasury", description: "Tells the Treasury agent what happened and what you need. Only after try_purchase: Treasury acts on Metal's answer.",
        input: z.strictObject({ message: z.string() }),
        run: async ({ message: m }: { message: string }) => {
          // dry-18: Haiku wrote to Treasury without trying, so code had to take over. Treasury needs Metal's answer.
          if (!tried) return { text: "Not sent: first serve the next customer query with try_purchase. Treasury needs Metal's answer on chain, not the notice alone.", blocked: "not tried yet" };
          message = m.trim().slice(0, 600);
          deps.notify(message);
          return { text: "Treasury has your message.", final: true };
        },
      },
    ],
  }, client);
  const source = run.status === "done" && tried ? "claude" : "fallback";
  audit(db, "sourcing", "price_rise.met", seq === null ? null : String(seq), { source, model: run.model, tried, refusal, message });
  return { source, tried, refusal, seq, message, run };
}
