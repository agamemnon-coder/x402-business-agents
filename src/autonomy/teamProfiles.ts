// D19 block 4: the autonomous Treasury and Support agents. Each wakes on its own events and messages and decides what to
// do with its tools; the tools reuse the tested flows, so every check stays where it was.
// - Treasury: goal, keep every agent able to do its job inside the CFO's 20.00, at a margin, and pay what is due on
//   time. It reads the position; it may design a rebalance with options (code checks the plan, the CFO decides with
//   Face ID), plan a euro invoice (FX for the shortfall, SWIFT, Face ID) with its timing advice, or answer an agent.
// - Support: goal, settle every customer dispute from evidence: refund what was wrong, nothing else, escalate the rest.
//   It settles a dispute with its dispute tools (signed orders, the data check, refunds inside the limits, the CFO).

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { MODELS } from "../claude/reader.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { mandatesNow, proposePriceRise } from "../agents/treasury.js";
import { designPriceRise } from "../agents/treasuryAgent.js";
import { addresses, sellPrice, supplierPrice } from "../world/runtime.js";
import { setSetting } from "../world/settings.js";
import { TOTAL_BUDGET_CENTS } from "../config/policy.js";
import { netEarnings } from "../agents/sweep.js";
import type { AgentProfile } from "./runtime.js";

const repo = resolve(import.meta.dirname, "../..");
const NOTICE = resolve(repo, "fixtures/stockline-price-notice.txt");

/** Runs one of the tested flows as its own process (it prints its own report); returns its last lines, redacted. */
export function runFlow(script: string, args: string[] = []): { ok: boolean; text: string } {
  const r = spawnSync("npx", ["tsx", `src/cli/${script}`, ...args], { cwd: repo, env: process.env, encoding: "utf8", timeout: 15 * 60_000 });
  const lines = redactSecrets(`${r.stdout ?? ""}${r.stderr ?? ""}`).split("\n").filter((l) => l.trim() && !/ExperimentalWarning|trace-warnings/.test(l));
  return { ok: r.status === 0, text: lines.slice(-12).join("\n").slice(0, 1500) };
}

const latestRefusal = (db: DB) => db.prepare("SELECT id, refusal_reason FROM upstream_purchases WHERE outcome = 'REFUSED' AND refusal_reason LIKE 'mandate_cap_exceeded%' ORDER BY id DESC LIMIT 1").get() as { id: number; refusal_reason: string } | undefined;
const waiting = (db: DB, kind: string) => db.prepare("SELECT proposal_id FROM proposals WHERE kind = ? AND status = 'PENDING_APPROVAL' AND expires_at > ?").all(kind, new Date().toISOString()) as { proposal_id: string }[];
const lastFrom = (db: DB, from: string) => (db.prepare("SELECT text FROM agent_messages WHERE from_agent = ? AND to_agent = 'treasury' ORDER BY id DESC LIMIT 1").get(from) as { text: string } | undefined)?.text;

export interface FlowDeps { runFlow: typeof runFlow }

export function treasuryProfile(tickMs = 30 * 60_000, deps: FlowDeps = { runFlow }): AgentProfile {
  const position = async (db: DB) => {
    const m = [...(await mandatesNow(db)).values()].map((c) => c.now);
    const sell = toCents(sellPrice(db));
    const r = latestRefusal(db);
    const pend = db.prepare("SELECT proposal_id, kind FROM proposals WHERE status = 'PENDING_APPROVAL' AND expires_at > ?").all(new Date().toISOString()) as { proposal_id: string; kind: string }[];
    return [
      `Mandates (lifetime): ${m.map((x) => `${x.agent} cap ${fromCents(x.capCents)}, budget ${fromCents(x.budgetCents)}, spent ${fromCents(x.spentCents)}`).join("; ")}. Total budget ${fromCents(m.reduce((s, x) => s + x.budgetCents, 0))} of ${fromCents(TOTAL_BUDGET_CENTS)} allowed.`,
      `Query price ${fromCents(sell)}; Stockline ${supplierPrice(db, "stockline")}, Ridgeline Data ${supplierPrice(db, "ridgeline")} a stock check.`,
      r ? `Latest refusal over a cap: ${r.refusal_reason}.` : "No refusal over a cap.",
      (() => { const e = netEarnings(db); return `Net earnings on the business account, not yet swept to Airwallex: ${fromCents(Math.max(0, e.netCents))} (sales ${fromCents(e.revenueCents)}, upstream ${fromCents(e.upstreamCents)}, refunds ${fromCents(e.refundsCents)}, swept ${fromCents(e.sweptCents)}).`; })(),
      pend.length ? `Waiting for the CFO: ${pend.map((p) => `${p.proposal_id} (${p.kind})`).join(", ")}.` : "Nothing waits for the CFO.",
    ].join("\n");
  };
  return {
    name: "treasury", display: "the Treasury agent", model: MODELS.review, tickMs,
    goal: `keep every agent able to do its job inside the CFO's ${fromCents(TOTAL_BUDGET_CENTS)} total, keep a margin on every query, and pay what Northwind owes on time.`,
    rules: [
      "You may sweep the net earnings from the business account on Metal to Airwallex (sweep_earnings): code keeps what the other mandates may still spend, waits for finality and books the credit. You may design a rebalance of the agents' mandates with two price options (design_rebalance): code checks the plan (the 20.00 total, caps, budgets, margin) and the CFO decides with Face ID, often with a second person. You may plan a euro invoice (plan_invoice): code locks the FX quote and checks the floors; the CFO approves with Face ID. You cannot move money yourself.",
      "When you have nothing to do, finish without acting: proposing nothing is a valid decision.",
    ].join("\n"),
    observe: position,
    tools: (db) => { let swept = false; return [
      { name: "position", description: "The mandates, the prices, the latest refusal and what waits for the CFO.", input: z.strictObject({}), run: async () => ({ text: await position(db) }) },
      {
        name: "design_rebalance", description: "Designs a rebalance of the three mandates with two query-price options and your advice; code checks it and sends the options to the CFO. Only when an agent cannot do its job within its mandate.",
        input: z.strictObject({ reason: z.string().describe("Why a rebalance is needed now") }),
        run: async ({ reason }: { reason: string }) => {
          const open = waiting(db, "mandate_replace");
          if (open.length) return { text: `Not designed: ${open.map((p) => p.proposal_id).join(", ")} already wait for the CFO.`, blocked: "already waiting" };
          const r = latestRefusal(db);
          if (!r) return { text: "Not designed: no purchase was refused over a cap, so no agent is blocked by its mandate.", blocked: "no need" };
          const addr = addresses(db);
          const sellCents = toCents(sellPrice(db));
          const live = toCents(supplierPrice(db, "stockline"));
          const design = await designPriceRise(db, {
            sellCents, oldUpstreamCents: 2, newUpstreamCents: live, refusal: r.refusal_reason, mandates: [...(await mandatesNow(db)).values()].map((c) => c.now),
            ...(lastFrom(db, "sourcing") ? { sourcingMessage: `${lastFrom(db, "sourcing")} (Treasury's own reason: ${reason})` } : {}),
          });
          const props = await proposePriceRise(db, addr, sellCents, { noticePath: NOTICE, liveOfferCents: live, refusal: { purchaseId: r.id, reason: r.refusal_reason } }, new Date(), design.plan);
          return { text: `${design.source === "claude" ? "Your plan" : "Code's plan"} went to the CFO as ${props.map((p) => p.proposal_id).join(" and ")}: ${design.plan.advice}`, ...(design.source === "claude" ? {} : { blocked: "plan fell back to code" }) };
        },
      },
      {
        name: "sweep_earnings", description: "Sweeps the net earnings from the business account (Metal) to the sweep wallet and books them at Airwallex, after finality. Code plans the amount; it keeps what the other mandates may still spend.",
        input: z.strictObject({ reason: z.string().describe("Why sweep now") }),
        run: async () => {
          if (swept || db.prepare("SELECT 1 FROM sweeps WHERE created_at > ?").get(new Date(Date.now() - 30 * 60_000).toISOString())) return { text: "Not again: a sweep ran in the last half hour.", blocked: "already swept" };
          const e = netEarnings(db);
          if (e.netCents <= 0) return { text: `Not swept: net earnings are ${fromCents(Math.max(0, e.netCents))}; nothing to move.`, blocked: "nothing to sweep" };
          swept = true;
          const r = deps.runFlow("s3.ts", ["--sweep-only"]);
          return { text: r.text, ...(r.ok ? {} : { blocked: "the sweep did not complete" }) };
        },
      },
      {
        name: "plan_invoice", description: "Plans the euro invoice that came in (the licence): FX only for the shortfall, SWIFT, the fee ceiling, your timing advice; it waits for the CFO's Face ID.",
        input: z.strictObject({}),
        run: async () => {
          if (waiting(db, "invoice_payment").length) return { text: "Not planned: an invoice payment already waits for the CFO.", blocked: "already waiting" };
          const r = deps.runFlow("licence.ts");
          return { text: r.text, ...(r.ok ? {} : { blocked: "the plan did not complete" }) };
        },
      },
    ]; },
    // Without Claude: as before the agents, code's fixed plan answers a refusal the Sourcing agent reported.
    fallback: async (db, events, messages) => {
      if (!messages.some((m) => m.from_agent === "sourcing") || waiting(db, "mandate_replace").length || !latestRefusal(db)) return "did nothing (nothing code would do here)";
      const r = latestRefusal(db)!;
      const addr = addresses(db);
      const sellCents = toCents(sellPrice(db));
      const live = toCents(supplierPrice(db, "stockline"));
      const props = await proposePriceRise(db, addr, sellCents, { noticePath: NOTICE, liveOfferCents: live, refusal: { purchaseId: r.id, reason: r.refusal_reason } });
      return `code's fixed plan went to the CFO as ${props.map((p) => p.proposal_id).join(" and ")}`;
    },
  };
}

export function supportProfile(tickMs = 30 * 60_000): AgentProfile {
  const open = (db: DB) => db.prepare("SELECT dispute_id, customer, created_at FROM disputes ORDER BY created_at DESC LIMIT 5").all() as { dispute_id: string; customer: string; created_at: string }[];
  return {
    name: "support", display: "the Support agent", model: MODELS.act, tickMs,
    goal: "settle every customer dispute from evidence: refund exactly what was wrong, nothing else, and send the rest to the CFO with your advice.",
    rules: "settle_dispute runs your dispute tools: the signed orders and their payments on chain, the supplier's corrections, refunds inside the CFO's automatic limits (paid under your mandate), and an escalation for the rest. You cannot refund outside those limits; the CFO decides with Face ID.",
    observe: async (db) => {
      const d = open(db);
      return d.length ? `Disputes on file: ${d.map((x) => `${x.dispute_id} from ${x.customer.slice(0, 10)}… (${x.created_at.slice(11, 16)})`).join(", ")}.` : "No dispute on file.";
    },
    tools: (db) => [
      {
        name: "settle_dispute", description: "Settles the customer's dispute that came in, from evidence, with your dispute tools.",
        input: z.strictObject({}),
        run: async () => {
          if (db.prepare("SELECT 1 FROM audit_log WHERE event = 'dispute.settled_by_agent' AND ts > ?").get(new Date(Date.now() - 30 * 60_000).toISOString())) return { text: "Not again: this dispute was settled in the last half hour.", blocked: "already settled" };
          const r = runFlow("s2.ts");
          return { text: r.text, ...(r.ok ? {} : { blocked: "the settlement did not complete" }) };
        },
      },
    ],
    fallback: async (db, events) => (events.some((e) => e.kind === "dispute.opened") ? `${runFlow("s2.ts").ok ? "code settled the dispute" : "code's settlement stopped"} (the agent did not decide)` : "did nothing"),
  };
}

/** For the world CLI: a supplier's price, as the world changes it. */
export function setSupplierPrice(db: DB, id: "stockline" | "ridgeline", price: string): void {
  setSetting(db, "system", id === "stockline" ? "upstream_price" : "ridgeline_price", price);
}
