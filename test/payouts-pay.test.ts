// Payables FX payouts: suppliers in the US, China, the UK, Turkey and the Netherlands, each added through the three
// steps (request, a person's verification, the CFO's Face ID) and paid in the invoice's own currency on its route; a
// shortfall bought from EUR on a locked quote; a dear quote, a broken floor, a bad account number and changed bank
// details stopped before anything moves. All against the in-memory Airwallex stand-in: no outside call, test money.
import { standInBank } from "./support/standInBank.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { apJournal } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, checkThenProposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { decide } from "../src/policy/approvals.js";
import type { SupplierPaymentTerms } from "../src/payouts/plan.js";
import { setSetting } from "../src/world/settings.js";
import { NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { CN, TR, UK, US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "fx-pay-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  // EUR 35,000.00 held, floor 25,000.00: with no other commitments, 10,000.00 is free to fund a shortfall.
  setSetting(db, "human", "eur_obligations", "0.00");
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
const add = async (text: string, name: string) => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
/** The three steps for the invoice's supplier; returns the invoice, now checked again. */
const addSupplier = async (id: string) => {
  const req = requestPayeeAddForInvoice(db, id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
  approve(p.proposal_id);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  return apInvoice(db, id)!;
};
const pay = async (id: string) => {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const terms = JSON.parse(out.proposal.terms_json) as SupplierPaymentTerms;
  approve(out.proposal.proposal_id);
  await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id);
  await syncPayments(db, { now: () => now });
  return terms;
};

describe("a supplier in each country, paid in its own currency on its route", () => {
  it("US: USD by ACH (LOCAL), from the USD balance, no conversion", async () => {
    const id = await add(US, "us.pdf");
    expect(apInvoice(db, id)!.status).toBe("needs_vendor");
    expect((await addSupplier(id)).status).toBe("ready");
    expect(awx.payoutBeneficiaries[0]).toMatchObject({ method: "LOCAL", clearing: "ACH", bank: { country: "US", currency: "USD", accountNumber: "50001121", routingType: "aba", routingValue: "021000021" } });
    const t = await pay(id);
    expect(t).toMatchObject({ kind: "supplier_payment", currency: "USD", amount: "2400.00", method: "LOCAL", clearing: "ACH", account: "account …1121, ABA 021000021 (US)", conversion: null });
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(awx.transfers.at(-1)).toMatchObject({ currency: "USD", amountCents: 240_000, status: "PAID" });
    const pay_ = apJournal(db).filter((e) => e.invoice_id === id && e.event === "payment");
    expect(pay_.map((e) => [e.account, e.debit, e.credit, e.currency])).toEqual([["2100", "2400.00", "", "USD"], ["1201", "", "2400.00", "USD"]]);
  });

  it("China: CNY by SWIFT (LOCAL CNY needs declarant information), the shortfall bought from EUR", async () => {
    const id = await add(CN, "cn.pdf");
    await addSupplier(id);
    expect(awx.payoutBeneficiaries[0]).toMatchObject({ method: "SWIFT", bank: { country: "CN", currency: "CNY", accountNumber: "6222021001115222", swiftCode: "ICBKCNBJNBO" } });
    const t = await pay(id);
    // 18,000.00 plus the SWIFT reserve of 200.00, all bought: no CNY was held.
    expect(t).toMatchObject({ currency: "CNY", method: "SWIFT", fee_reserve: "200.00", conversion: { buy_currency: "CNY", buy_amount: "18200.00", sell_currency: "EUR", sell_amount: "2366.00" } });
    expect(apInvoice(db, id)!.status).toBe("paid");
    const entries = apJournal(db).filter((e) => e.invoice_id === id && e.event === "payment");
    // Every entry balances per currency: the conversion through money in transit, the fee in CNY.
    for (const cur of ["CNY", "EUR"]) {
      const d = entries.filter((e) => e.currency === cur).reduce((s, e) => s + Number(e.debit || 0), 0);
      const c = entries.filter((e) => e.currency === cur).reduce((s, e) => s + Number(e.credit || 0), 0);
      expect(d.toFixed(2), cur).toBe(c.toFixed(2));
    }
    expect(entries.find((e) => e.account === "6800")).toMatchObject({ debit: "100.00", currency: "CNY" });
  });

  it("UK: GBP by Faster Payments with account number and sort code", async () => {
    const id = await add(UK, "uk.pdf");
    await addSupplier(id);
    const t = await pay(id);
    expect(t).toMatchObject({ currency: "GBP", method: "LOCAL", clearing: "FASTER_PAYMENTS", account: "account …6819, sort code 60-16-13 (GB)", conversion: { buy_amount: "960.00", sell_amount: "1123.20" } });
    expect(apInvoice(db, id)!.status).toBe("paid");
  });

  it("Turkey: TRY to a TR IBAN (LOCAL)", async () => {
    const id = await add(TR, "tr.pdf");
    await addSupplier(id);
    const t = await pay(id);
    expect(t).toMatchObject({ currency: "TRY", method: "LOCAL", account: "IBAN TR33…1326", conversion: { buy_amount: "52000.00", sell_currency: "EUR" } });
    expect(apInvoice(db, id)!.status).toBe("paid");
  });

  it("the Netherlands: EUR to an NL IBAN on SEPA (LOCAL), straight from the EUR balance", async () => {
    const id = await add(NL, "nl.pdf");
    await addSupplier(id);
    const t = await pay(id);
    expect(t).toMatchObject({ currency: "EUR", method: "LOCAL", account: "IBAN NL91…4300", conversion: null });
    expect(apInvoice(db, id)!.status).toBe("paid");
  });
});

describe("stopped before anything moves", () => {
  it("a quote dearer than the market's rate is not taken: the invoice stays ready, with the reason", async () => {
    const id = await add(UK, "uk.pdf");
    await addSupplier(id);
    awx.marketRatesAny["GBP/EUR"] = "1.1000";
    const out = await payApInvoice(db, awx, id, now);
    expect(out.kind).toBe("escalated");
    expect((out as { reason: string }).reason).toMatch(/above the market's current rate/);
    expect(apInvoice(db, id)!.status).toBe("ready");
    expect(awx.conversions).toHaveLength(0);
  });

  it("a conversion that would take EUR under its floor is not planned", async () => {
    const id = await add(UK, "uk.pdf");
    await addSupplier(id);
    setSetting(db, "human", "eur_obligations", "9500.00");
    const out = await payApInvoice(db, awx, id, now);
    expect((out as { reason: string }).reason).toMatch(/EUR has 500.00 free above its floor/);
    expect(awx.conversions).toHaveLength(0);
  });

  it("a bad account number blocks the invoice; no supplier can be requested with it", async () => {
    const id = await add(UK.replace("31926819", "3192681"), "uk.pdf");
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("blocked");
    expect(inv.findings.find((f) => f.code === "bank_details_invalid")?.detail).toMatch(/account number/);
    expect(() => requestPayeeAddForInvoice(db, id, "treasury", now)).toThrow(/not waiting for a new supplier/);
  });

  it("an ABA routing number that fails its checksum is blocked", async () => {
    const id = await add(US.replace("021000021", "021000022"), "us.pdf");
    expect(apInvoice(db, id)!.findings.find((f) => f.code === "bank_details_invalid")?.detail).toMatch(/ABA/);
  });

  it("a known supplier's invoice with another account is blocked as possible fraud", async () => {
    const first = await add(US, "us.pdf");
    await addSupplier(first);
    const id = await add(US.replace(/PC-7781/g, "PC-7790").replace("50001121", "50009999"), "us2.pdf");
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("blocked");
    expect(inv.findings.find((f) => f.code === "possible_fraud")?.detail).toMatch(/possible invoice fraud/);
  });

  it("a lost answer to the payout is resolved by looking the request up, never by sending again", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    approve(out.proposal.proposal_id);
    awx.loseNextTransferAnswer = true;
    await executeSupplierPayment(db, awx, awx, out.proposal.proposal_id);
    expect(awx.transfers).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'transfer.adopted'").get()).toEqual({ n: 1 });
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("paid");
  });

  it("the phone page shows the CFO the account, the conversion and the method before the Face ID", async () => {
    const { describeTerms, whyYou } = await import("../src/approve/client.js");
    const id = await add(UK, "uk.pdf");
    const req = requestPayeeAddForInvoice(db, id, "treasury", now);
    recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
    const p = await checkThenProposePayeeAdd(db, standInBank(), req.add_id, "treasury", now);
    const add_ = describeTerms(JSON.parse(p.terms_json), {});
    expect(add_.sentence).toContain("account 31926819 (sort code 60-16-13, GB)");
    expect(add_.warnings[0]).toMatch(/invoice fraud/);
    approve(p.proposal_id);
    await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const terms = JSON.parse(out.proposal.terms_json);
    const f = describeTerms(terms, {});
    // Filed under the supplier's own number and its name, so two suppliers' "HR-0042" never collide.
    expect(f).toMatchObject({ approvable: true, title: "Pay invoice HR-0042 · Harbour Rope Ltd", amount: "GBP 960.00", warnings: [] });
    expect(f.sentence).toMatch(/Pay Harbour Rope Ltd GBP 960\.00 for invoice HR-0042 · Harbour Rope Ltd by LOCAL \(FASTER_PAYMENTS\), after converting EUR 1,?123\.20 into GBP 960\.00/);
    expect(whyYou(terms)).toBe("A supplier is paid from the Airwallex account only with your Face ID.");
    // The supplier's own total line and its currency go with the terms, as for the EUR invoice payment (red team round 2).
    expect(terms).toMatchObject({ document_total_line: "Total due GBP 960.00", document_currency: "GBP" });
    expect(f.rows).toContainEqual(["On the invoice", '"Total due GBP 960.00" (currency read from that line: GBP)']);
    // A total line in another currency than the one paid is a warning on the phone.
    expect(describeTerms({ ...terms, document_currency: "SEK" }, {}).warnings).toContain("The invoice's own total line reads SEK, not GBP");
  });

  it("the same invoice is never paid twice", async () => {
    const id = await add(US, "us.pdf");
    await addSupplier(id);
    await pay(id);
    const again = await add(US.replace("Payment reference: PC-7781", "Payment reference: PC-7781 (reminder)"), "us-again.pdf");
    expect(apInvoice(db, again)!.findings.map((f) => f.code)).toContain("duplicate");
  });
});
