// Max, 2 Nov (P-0006 expired before he could sign): a licence payment waits 20 minutes for the CFO's Face ID, not 10.
// An FX quote still caps it: never past the quote's expiry minus 30 seconds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { INVOICE_PROPOSAL_TTL_MS, QUOTE_SAFETY_MS } from "../src/config/policy.js";
import { proposalExpiry } from "../src/policy/treasury.js";
import { openDb } from "../src/db/open.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");

describe("the invoice payment approval window", () => {
  it("is 20 minutes", () => {
    expect(INVOICE_PROPOSAL_TTL_MS).toBe(20 * 60 * 1000);
  });

  it("a licence paid from euros waits 20 minutes for the Face ID", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    const now = new Date();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const terms = JSON.parse(out.proposal.terms_json);
    expect(terms.conversion).toBeFalsy();
    expect(Date.parse(terms.expires_at)).toBe(Math.floor((now.getTime() + 20 * 60_000) / 1000) * 1000);
  });

  it("a licence that needs a conversion ends with its 15-minute FX quote, minus 30 seconds", () => {
    const now = Date.parse("2026-11-02T14:00:00Z");
    const quoteValidTo = now + 15 * 60_000;
    expect(proposalExpiry(now, INVOICE_PROPOSAL_TTL_MS, quoteValidTo, QUOTE_SAFETY_MS)).toBe(quoteValidTo - 30_000);
  });
});
