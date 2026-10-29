import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANUFACTURER, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { bookCredit } from "../src/agents/sweep.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

const text = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");

async function world() {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  return { db, awx };
}

function approve(db: ReturnType<typeof openDb>, id: string, sha: string) {
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "test", method: "cli" });
}

describe("euro bill (S3) against the Airwallex port", () => {
  it("reads the invoice", () => {
    expect(parseInvoiceFallback(text)).toEqual({
      invoice_no: "BTX-2026-11", vendor: MANUFACTURER.name, amount: "1850.00", currency: "EUR", due_date: "2026-11-16",
      iban: MANUFACTURER.iban, bic: MANUFACTURER.bic, reference: "BTX-2026-11",
    });
  });

  it("calibrates free EUR to 1,500.00 and the USD floor 5,000 under the seed", async () => {
    const { db, awx } = await world();
    expect(awx.bal.USD.availableCents).toBe(2_500_000);
    const s = (await import("../src/agents/euroBill.js")).treasuryState(db, await awx.balances());
    expect(s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents).toBe(150_000);
    expect(s.usdFloorCents).toBe(2_000_000);
  });

  it("checks the market's current rate before it locks a quote, and records both", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out.kind).toBe("proposed");
    expect(awx.calls.indexOf("currentRate")).toBeLessThan(awx.calls.indexOf("createQuote"));
    const checked = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'fx.rate_checked'").get() as { payload_json: string }).payload_json);
    expect(checked).toMatchObject({ pair: "USD/EUR", buy: "EUR 370.00", market_rate: awx.rate, quote_rate: awx.rate });
  });

  it("escalates when the locked quote costs clearly more than the market's current rate", async () => {
    const { db, awx } = await world();
    awx.marketRate = String((Number(awx.rate) * 0.99).toFixed(6)); // the quote is 1% dearer than the market
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/above the market's current rate.*options/) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    expect(awx.calls).not.toContain("createConversion");
  });

  it("converts only the 370.00 shortfall (fee ceiling 20.00), then pays by SWIFT to PAID", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(out.terms.conversion?.buy_amount).toBe("370.00");
    expect(out.terms.after.eur_free).toBe("0.00");
    expect(awx.calls).not.toContain("createConversion");
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(r.transfer.status).toBe("PAID");
    expect(awx.transfers[0]!.metadata).toBe(out.proposal.terms_sha256);
    // The floor and the committed obligations stay whole; what is left is the unused part of the fee ceiling.
    expect(awx.bal.EUR.availableCents).toBe(50_000 + 800_000 + 2000 - 1347);
    const { fee_actual } = db.prepare("SELECT fee_actual FROM transfers WHERE transfer_id = ?").get(r.transfer.id) as { fee_actual: string };
    expect(fee_actual).toBe("EUR 13.47");
    expect(awx.bal.USD.availableCents).toBeGreaterThanOrEqual(2_000_000);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("a second copy of an invoice already paid is escalated, and nothing is quoted", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    const quotes = awx.calls.filter((c) => c === "createQuote").length;
    const again = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(again.kind).toBe("escalated");
    if (again.kind === "escalated") expect(again.reason).toMatch(/BTX-2026-11 is already paid/);
    expect(awx.calls.filter((c) => c === "createQuote").length).toBe(quotes);
    expect((db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number }).n).toBe(1);
  });

  it("an invoice that already waits for approval is not proposed a second time", async () => {
    const { db, awx } = await world();
    const first = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (first.kind !== "proposed") throw new Error(first.reason);
    const again = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(again.kind).toBe("escalated");
    if (again.kind === "escalated") expect(again.reason).toContain(`already waits for approval as ${first.proposal.proposal_id}`);
    expect(awx.calls.filter((c) => c === "createQuote").length).toBe(1);
  });

  it("an approved proposal for an invoice that another payout already pays converts nothing and pays nothing", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    // Another payout for the same invoice, e.g. from an older proposal approved on another device.
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('other', 'BTX-2026-11', '1850.00', 'EUR', 'SWIFT', '20.00', 'PAID', 'x', '2026-10-30T00:00:00Z')").run();
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow(/already paid/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.calls).not.toContain("createTransfer");
  });

  it("L2: a payee the CFO policy blocked after approval is not paid, and Airwallex is not called", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    setSetting(db, "human", `counterparty:${MANUFACTURER.name}`, "blocked");
    const before = awx.calls.length;
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id)).rejects.toThrow(/blocked by the CFO policy/);
    expect(awx.calls.slice(before).filter((c) => c !== "balances")).toEqual([]);
    expect(awx.transfers).toEqual([]);
  });

  it("F1: an expired quote voids the approval before Airwallex is called", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    const later = new Date(Date.parse(out.terms.conversion!.valid_to));
    await expect(executeInvoicePayment(db, awx, awx, out.proposal.proposal_id, () => later)).rejects.toThrow(/expired/);
    expect(awx.calls).not.toContain("createConversion");
    expect(awx.calls).not.toContain("createTransfer");
    const { status } = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(out.proposal.proposal_id) as { status: string };
    expect(status).toBe("EXPIRED");
  });

  it("F4b: escalates when the conversion would break the USD floor", async () => {
    const { db, awx } = await world();
    setSetting(db, "treasury", "usd_floor", "24900.00");
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out.kind).toBe("escalated");
    expect(awx.calls).not.toContain("createConversion");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });

  it("escalates, and quotes nothing, when committed EUR has already been spent", async () => {
    const { db, awx } = await world();
    awx.bal.EUR.availableCents -= 150_062; // free EUR 1,500.00 -> -0.62
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/^EUR is already 0\.62 below its floor plus commitments/) });
    expect(awx.calls).not.toContain("createQuote");
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });

  it("F5: changed bank details escalate and pay nothing", async () => {
    const { db, awx } = await world();
    const changed = text.replace("DE89 3704 0044 0532 0130 00", "DE44 5001 0517 5407 3249 31");
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(changed), changed);
    expect(out).toMatchObject({ kind: "escalated" });
    expect(awx.calls).not.toContain("createQuote");
  });

  it("F8: a lost transfer answer is adopted by request_id, not paid twice", async () => {
    const { db, awx } = await world();
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(db, out.proposal.proposal_id, out.proposal.terms_sha256);
    awx.loseNextTransferAnswer = true;
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(awx.transfers).toHaveLength(1);
    expect(r.transfer.status).toBe("PAID");
  });

  it("F6: one on-chain transfer is credited once, even when booking runs twice", async () => {
    const { db, awx } = await world();
    db.prepare(`INSERT INTO chain_credits (event_key, tx_hash, from_address, to_address, amount_base_units, block, finalized_block, awx_reference, created_at)
      VALUES ('63825:0xabc:1', '0xabc', '0xb', '0xw', '1350000000000000000', 1, 1, '0xabc', ?)`).run(new Date().toISOString());
    const first = await bookCredit(db, awx, awx, "63825:0xabc:1");
    db.prepare("UPDATE chain_credits SET awx_deposit_id = NULL").run(); // as if the process died before saving the id
    const second = await bookCredit(db, awx, awx, "63825:0xabc:1");
    expect(second).toEqual({ depositId: first.depositId, adopted: true });
    expect(awx.deposits.filter((d) => d.reference === "0xabc")).toHaveLength(1);
  });
});
