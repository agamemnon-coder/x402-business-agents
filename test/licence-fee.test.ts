// Kit 11: the treasury agent pays a monthly licence fee invoiced in euros, and the fee is kept in code. An invoice
// from the licensor is paid only for exactly the contracted amount; any other amount waits for a person, whatever
// the invoice or a model reading it says.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkInvoice, ibanSha, parseInvoiceFallback } from "../src/agents/invoice.js";
import { LICENSOR, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { CHART, VENDOR_GL } from "../src/config/gl.js";
import { LICENCE_FEE_EUR_CENTS } from "../src/config/policy.js";
import { openDb, type DB } from "../src/db/open.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");

function ledger(): DB {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('b-lic', ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(LICENSOR.name, LICENSOR.iban.slice(-4), ibanSha(LICENSOR.iban), LICENSOR.bic);
  return db;
}

describe("the monthly licence fee", () => {
  it("is a constant in code, in whole euro cents", () => {
    expect(Number.isSafeInteger(LICENCE_FEE_EUR_CENTS)).toBe(true);
    expect(LICENCE_FEE_EUR_CENTS).toBeGreaterThan(0);
  });

  it("passes the invoice check when the licensor invoices exactly that amount", () => {
    const inv = parseInvoiceFallback(text);
    expect(inv.vendor).toBe(LICENSOR.name);
    expect(Math.round(Number(inv.amount) * 100)).toBe(LICENCE_FEE_EUR_CENTS);
    expect(checkInvoice(ledger(), inv, text)).toMatchObject({ ok: true, name: LICENSOR.name, amountCents: LICENCE_FEE_EUR_CENTS });
  });

  it("stops any other amount from the licensor for a person, before anything is planned", () => {
    const inv = { ...parseInvoiceFallback(text), amount: ((LICENCE_FEE_EUR_CENTS + 100) / 100).toFixed(2) };
    const c = checkInvoice(ledger(), inv, text);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toMatch(/licence fee in code/);
  });

  it("is booked to its own expense account", () => {
    expect(VENDOR_GL[LICENSOR.name]).toBe("6350");
    expect(CHART["6350"]).toMatch(/licence/i);
  });

  it("is paid by the treasury agent end to end: allowlisted, one Face ID, SWIFT to PAID (sandbox stand-in)", async () => {
    const db = openDb(":memory:");
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(`expected a proposal: ${out.reason}`);
    expect(out.terms).toMatchObject({ amount: "240.00", currency: "EUR" });
    const sha = out.proposal.terms_sha256;
    decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "test", method: "cli" });
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(r.transfer.status).toBe("PAID");
    expect(out.terms).toMatchObject({ beneficiary_id: awx.beneficiaries.find((b) => b.iban === LICENSOR.iban)!.id });
    expect(awx.transfers[0]).toMatchObject({ amountCents: LICENCE_FEE_EUR_CENTS, currency: "EUR", metadata: sha });
  });
});
