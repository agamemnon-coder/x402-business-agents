// dry-179, seq 423: the Treasury agent's licence timing advice, shown on Watch beside the plan, said the shortfall was
// EUR 90.00 instead of 110.00: it left out the EUR 20.00 fee ceiling. Code's plan was right. Now code's numbers (the
// invoice, the fee ceiling, EUR needed, free EUR, the shortfall, the FX) are in the agent's facts, to quote, and the
// agent-facts eval case treasury-facts-shortfall (run it 10x with `npm run agent-evals -- --case
// treasury-facts-shortfall --runs 10`) judges its words with wrongAmountIn. Fake client only; no real API.
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury, treasuryState } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { adviseTiming, licenceNumbers, licenceNumbersLine } from "../src/agents/timingAgent.js";
import { publish } from "../src/autonomy/bus.js";
import { invoiceFacts, plannedInvoiceOf } from "../src/autonomy/invoiceFacts.js";
import { openDb } from "../src/db/open.js";
import { DRY179_LICENCE, FACT_CASES, wrongAmountIn } from "../src/evals/agentFacts.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { setSetting } from "../src/world/settings.js";

const LICENCE = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");

describe("code's licence numbers (dry-179)", () => {
  it("dry-179's plan: 240.00 + the 20.00 fee ceiling = 260.00 needed, 150.00 free, shortfall and FX 110.00", () => {
    expect(licenceNumbers(DRY179_LICENCE)).toEqual({ needed: "260.00", freeBefore: "150.00", shortfall: "110.00", fxBuy: "110.00" });
    expect(licenceNumbersLine(DRY179_LICENCE)).toBe("Code's numbers for this payment (quote these; do not compute your own): invoice EUR 240.00 + SWIFT fee ceiling EUR 20.00 = EUR 260.00 needed; free EUR before the payment 150.00; shortfall EUR 110.00 (EUR needed minus free EUR); the FX converts exactly that: buy EUR 110.00 for USD 124.43.");
  });

  it("paid from free EUR: no shortfall, no FX", () => {
    const f = { ...DRY179_LICENCE, quote: null, after: { eurFree: "1240.00", usdAvailable: "1.00" } };
    expect(licenceNumbers(f)).toEqual({ needed: "260.00", freeBefore: "1500.00", shortfall: "0.00", fxBuy: null });
  });

  it("the advice's prompt and read_position carry them; the agent is told to quote, not compute", async () => {
    const seen: string[] = [];
    let turn = 0;
    const client = { beta: { messages: { create: async (p: { system?: unknown; messages: { content: unknown }[] }) => {
      seen.push(JSON.stringify(p.system ?? ""), JSON.stringify(p.messages));
      const usage = { input_tokens: 10, output_tokens: 10 };
      const calls = [[{ name: "read_position", input: {} }], [{ name: "submit_advice", input: { timing: "pay_now", date: null, reason: "The quote for the EUR 110.00 shortfall is locked; paying now keeps the floors." } }]][turn++];
      if (!calls) return { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", model: "claude-opus-5-5", usage };
      return { content: calls.map((c, k) => ({ type: "tool_use", id: `t${turn}-${k}`, ...c })), stop_reason: "tool_use", model: "claude-opus-5-5", usage };
    } } } } as unknown as Anthropic;
    const a = await adviseTiming(openDb(":memory:"), DRY179_LICENCE, client, "claude-opus-5-5");
    expect(a.source).toBe("claude");
    const all = seen.join("\n");
    expect(all).toContain("shortfall EUR 110.00 (EUR needed minus free EUR)");
    expect(all).toMatch(/never compute one yourself/);
    expect(wrongAmountIn(a.reason)).toBeNull();
  });

  it("Treasury's observe gives code's sum whole when the licence is open (fee ceiling included)", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    // Free EUR 150.00, as dry-179's --free-eur 150.00 calibrated it.
    const s = treasuryState(db, JSON.parse((db.prepare("SELECT json FROM balance_snapshots ORDER BY id DESC LIMIT 1").get() as { json: string }).json) as Parameters<typeof treasuryState>[1]);
    setSetting(db, "treasury", "eur_obligations", ((s.eurAvailableCents - s.eurFloorCents - 15_000) / 100).toFixed(2));
    publish(db, "invoice.received", { vendor: "Stockline Data GmbH", file: "x.txt", text: LICENCE.slice(0, 1500) }, "treasury");
    const all = invoiceFacts(db, new Date(), plannedInvoiceOf(LICENCE)).lines.join("\n");
    expect(all).toMatch(/code's numbers \(quote them; do not compute your own\): invoice EUR 240\.00 \+ SWIFT fee ceiling EUR 20\.00 = EUR 260\.00 needed; free EUR 150\.00; shortfall EUR 110\.00 \(needed minus free\): code would convert exactly EUR 110\.00 from USD/);
    // And code's plan converts the same 110.00.
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(LICENCE), LICENCE);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(out.terms.conversion?.buy_amount).toBe("110.00");
  });
});

describe("the eval case's checker: every EUR amount named is one of code's numbers", () => {
  it("dry-179's own words fail; code's numbers pass", () => {
    expect(wrongAmountIn("The shortfall is 90.00, not 110.00, so the FX is larger than needed.")).toMatch(/90\.00/);
    expect(wrongAmountIn("Pay now: the shortfall of EUR 90 is covered by the locked quote.")).toMatch(/EUR 90/);
    expect(wrongAmountIn("Pay now: the EUR 110.00 shortfall (240.00 plus the 20.00 fee ceiling, less 150.00 free) is converted for USD 124.43 on a quote valid until 22:44.")).toBeNull();
    expect(wrongAmountIn("Pay now, well before the 15 November due date; the quote is locked.")).toBeNull();
    expect(wrongAmountIn("Converting €110 now costs $124.43; waiting until 2026-11-13 risks a worse rate.")).toBeNull();
    expect(wrongAmountIn("It needs EUR 260.00 in all, of which 150.00 is free.")).toBeNull();
    expect(wrongAmountIn("We need EUR 250.00.")).toMatch(/250/);
  });

  it("the case is registered for the agent evals, on Opus", () => {
    expect(FACT_CASES.find((c) => c.id === "treasury-facts-shortfall")).toMatchObject({ agent: "treasury", kind: "hard", model: "opus" });
  });
});
