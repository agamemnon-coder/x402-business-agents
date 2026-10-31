// The hard eval cases (src/evals/hard.ts) score the model's reading, not the parser's. With a stand-in model that reads
// each document right they all pass; one that "corrects" the IBAN to the one on file, reads the discount instead of
// the total or folds #9 into the range fails them. No test calls the real Anthropic API.
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runEvals } from "../src/evals/cases.js";
import { HARD_CASES } from "../src/evals/hard.js";

type Reading = Record<string, unknown>;
const invoice = (no: string, iban: string, amount = "1850.00", due = "2026-12-31"): Reading =>
  ({ invoice_no: no, vendor: "Bergtex Textil GmbH", amount, currency: "EUR", due_date: due, iban, bic: "COBADEFFXXX", reference: no });

/** A stand-in that answers by document: `wrong` swaps in the mistakes a weaker reading makes. */
function standIn(wrong = false): Anthropic {
  return { beta: { messages: { parse: async (p: { model: string; messages: { content: string }[] }) => {
    const text = p.messages[0]!.content;
    const doc = text.slice(text.indexOf("<document>"));
    let out: Reading;
    if (text.startsWith("Classify")) out = { kind: /dispute|betwist/i.test(doc) ? "dispute" : /Preis|price/i.test(doc) && !/INVOICE|RECHNUNG|Invoice/.test(doc) ? "price_notice" : "invoice", confidence: "high" };
    else if (text.startsWith("Extract the invoice")) {
      if (doc.includes("BTX-2026-12")) out = invoice("BTX-2026-12", "DE89370400440532013000", wrong ? "1813.00" : "1850.00");
      else if (doc.includes("BTX-2026-13")) out = invoice("BTX-2026-13", "DE89370400440532013000", "1850.00", "2026-12-16");
      else out = invoice("BTX-2026-14", wrong ? "DE89370400440532013000" : "DE89370400440532013008", "1850.00", "2026-12-17");
    } else if (text.startsWith("Extract the customer's dispute")) out = { customer: "summit-outfitters", sale_refs: wrong ? [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] : [5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16], claims: ["never_placed", "wrong_data"], requested_action: "refund_some", excerpts: [] };
    else if (text.startsWith("Extract the supplier's price change")) out = { supplier: "Stockline Data GmbH", old_price: "0.02", new_price: "0.04", effective_at: "2026-12-01T00:00:00Z", quote_excerpt: "kostet eine Bestandsabfrage 0,04 *USDZ statt bisher 0,02 *USDZ" };
    else throw new Error("not asked in these cases");
    return { model: p.model, stop_reason: "end_turn", stop_details: null, parsed_output: out, usage: { input_tokens: 10, output_tokens: 5 } };
  } } } } as unknown as Anthropic;
}

describe("the hard eval cases", () => {
  it("all pass for a reading that is right", async () => {
    const r = await runEvals(standIn(), {}, HARD_CASES);
    expect(r.map((x) => [x.id, x.problems])).toEqual(HARD_CASES.map((c) => [c.id, []]));
  });

  // Breaks if a case would credit a model for a dangerous reading: the IBAN on file instead of the document's own.
  it("fail a reading that takes the discount, folds #9 in, or corrects the IBAN to the one on file", async () => {
    const r = await runEvals(standIn(true), {}, HARD_CASES);
    const failed = Object.fromEntries(r.map((x) => [x.id, x.pass]));
    expect(failed).toMatchObject({ "hard-messy-invoice": false, "hard-subtle-iban": false, "hard-mixed-dispute": false, "hard-german-invoice": true, "hard-german-notice": true });
    expect(r.find((x) => x.id === "hard-subtle-iban")!.problems.join(" ")).toMatch(/…3008/);
  });
});
