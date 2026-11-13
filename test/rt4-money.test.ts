// Red team round 4 (money and books, 9 November): each finding's reproduction, asserting what must happen instead.
import { standInBank } from "./support/standInBank.js";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { LICENSOR, MANUFACTURER, proposeInvoicePayment } from "../src/agents/euroBill.js";
import { referenceProblem } from "../src/payouts/routes.js";
import { insights } from "../src/ap/insights.js";
import { payApInvoice, rejectApInvoice, syncPayments } from "../src/ap/pay.js";
import { parseApFallback } from "../src/ap/reading.js";
import { requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { syncLedger } from "../src/ledger/feed.js";
import { transactionRegister } from "../src/money/register.js";
import { checkEvent } from "../src/policy/airwallexEvents.js";
import { assessAgainst } from "../src/policy/fraudCore.js";
import { executePayeeChange, checkThenProposePayeeChange, recordVerification, requestPayeeChange } from "../src/policy/payeeChange.js";
import { payablesApp } from "../src/servers/payables.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { CN, UK, US } from "./fakes/fxInvoices.js";
import { parserOnly, world } from "./support/rt4World.js";

describe("red team 4, money", () => {
  it("1: one UK account given as sort code + account and as its GB IBAN is one account: the second copy is a duplicate, never paid twice", async () => {
    const UK_AGAIN = UK.replace("Harbour Rope Ltd", "Harbour Rope & Cordage Limited")
      .replace("Account number: 31926819\nSort code: 60-16-13\nBank country: GB", "IBAN: GB29 NWBK 6016 1331 9268 19");
    const w = await world();
    const a = await w.add(UK, "uk.pdf");
    await w.addSupplier(a);
    await w.pay(a);
    expect(w.inv(a).status).toBe("paid");
    const b = await w.add(UK_AGAIN, "uk-again.pdf");
    expect(w.inv(b).findings.map((f) => f.code)).toContain("duplicate");
    expect(w.inv(b).status).toBe("blocked");
    expect(() => requestPayeeAddForInvoice(w.db, b, "treasury")).toThrow();
    expect(w.awx.transfers.filter((t) => t.status === "PAID" && String(t.currency) === "GBP")).toHaveLength(1);
  });

  it("2: a conversion Airwallex answers SCHEDULED is booked as committed and flagged until its settled event arrives", async () => {
    const w = await world();
    const orig = w.awx.createConversionAny.bind(w.awx);
    w.awx.createConversionAny = async (a) => ({ ...(await orig(a)), status: "SCHEDULED" });
    const id = await w.add(CN, "cn.pdf");
    await w.addSupplier(id);
    await w.pay(id);
    syncLedger(w.db, new Date());
    let fx = transactionRegister(w.db).rows.filter((r) => r.rail === "airwallex_fx");
    expect(fx.length).toBeGreaterThan(0);
    expect(fx.every((r) => r.moved && r.flags.includes("not_settled"))).toBe(true);
    const lines = () => w.db.prepare("SELECT account, currency, SUM(debit_cents) - SUM(credit_cents) AS net FROM ledger_lines WHERE account = '1203' AND currency = 'CNY' GROUP BY account, currency").get() as { net: number } | undefined;
    expect(lines()!.net).toBeGreaterThanOrEqual(0);
    const conv = w.db.prepare("SELECT conversion_id FROM fx_conversions").get() as { conversion_id: string };
    expect(checkEvent(w.db, "conversion.settled", { conversion_id: conv.conversion_id, status: "SETTLED" }).agrees).toBe(true);
    expect((w.db.prepare("SELECT status FROM fx_conversions").get() as { status: string }).status).toBe("SETTLED");
    fx = transactionRegister(w.db).rows.filter((r) => r.rail === "airwallex_fx");
    expect(fx.every((r) => r.moved && !r.flags.includes("not_settled"))).toBe(true);
  });

  it("3: two 'pay' requests at once: the invoice waits for the CFO, and is paid once its payout is", async () => {
    const w = await world();
    const id = await w.add(US, "us.pdf");
    await w.addSupplier(id);
    const now = new Date();
    const [a, b] = await Promise.all([payApInvoice(w.db, w.awx, id, now), payApInvoice(w.db, w.awx, id, now)]);
    const won = (a.kind === "proposed" ? a : b) as Extract<typeof a, { kind: "proposed" }>;
    expect(won.kind).toBe("proposed");
    expect(w.inv(id).status).toBe("waiting_cfo");
    w.approve(won.proposal.proposal_id);
    await executeSupplierPayment(w.db, w.awx, w.awx, won.proposal.proposal_id);
    await syncPayments(w.db, { now: () => now });
    expect(w.inv(id).status).toBe("paid");
  });

  it("4: a credit note a person has not accepted never lowers what is open", async () => {
    const FORGED = "Lagerhaus Nord GmbH\nGutschrift\nGutschriftsnummer: GS-9001\nDatum: 05.11.2026\nGesamtbetrag 1.190,00 EUR";
    const w = await world();
    const a = await w.add(DE, "de.pdf");
    await w.addSupplier(a);
    const before = insights(w.db).open_net;
    await w.add(FORGED, "forged.pdf");
    expect(insights(w.db).open_net).toEqual(before);
  });

  it("5: a bank change to an account on file for another supplier is refused; that supplier's record stays", async () => {
    const w = await world();
    expect(() => requestPayeeChange(w.db, { vendor: MANUFACTURER.name, iban: LICENSOR.iban, bic: LICENSOR.bic, source: null }, "human")).toThrow(/already on file/);
    const names = (w.db.prepare("SELECT name FROM beneficiaries").all() as { name: string }[]).map((b) => b.name);
    expect(names).toContain(LICENSOR.name);
  });

  it("5b: and a change approved before this check still never adopts another supplier's beneficiary", async () => {
    const w = await world();
    // Planted as an older request would have been filed: straight into the table, past today's request check.
    const req = requestPayeeChange(w.db, { vendor: MANUFACTURER.name, iban: "DE75512108001245126199", bic: "SOGEDEFFXXX", source: null }, "human");
    w.db.prepare("UPDATE payee_changes SET new_iban = ?, new_bic = ? WHERE change_id = ?").run(LICENSOR.iban, LICENSOR.bic, req.change_id);
    recordVerification(w.db, req.change_id, { by: "the CFO", how: "called Bergtex on the number in our 2025 contract; confirmed", actor: "human" });
    const p = await checkThenProposePayeeChange(w.db, standInBank(), req.change_id, "human");
    w.approve(p.proposal_id);
    await expect(executePayeeChange(w.db, w.awx, p.proposal_id)).rejects.toThrow(/on file/);
    const names = (w.db.prepare("SELECT name FROM beneficiaries").all() as { name: string }[]).map((b) => b.name);
    expect(names).toContain(LICENSOR.name);
  });

  it("6: a credit written only as a negative total is a credit note, not money owed", async () => {
    const NEG = EN.replace("INVOICE BTX-2026-21", "INVOICE BTX-2026-C21").replace("Payment reference: BTX-2026-21", "Payment reference: BTX-2026-C21")
      .replace("Subtotal EUR 1,554.62\nVAT 19% EUR 295.38\nTotal due EUR 1,850.00", "Total due EUR -1,850.00");
    const w = await world();
    const id = await w.add(NEG, "neg.pdf");
    expect(w.inv(id).doc_kind).toBe("credit_note");
    expect(insights(w.db).open).toEqual([]);
  });

  it("7: the read-back of a supplier without an IBAN is its account number's last four; an empty answer is refused", async () => {
    const w = await world();
    const lines: string[] = [];
    const server = payablesApp(w.db, { inbox: { dir: w.dir, reader: parserOnly }, rail: null, notify: (l) => lines.push(l) }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(base + "/")).text())![1]!;
    const post = (path: string, body: unknown) => new Promise<{ status: number; text: string }>((resolve, reject) => {
      const s = JSON.stringify(body);
      const req = request(base + path, { method: "POST", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(s)), "x-csrf": token, origin: base } }, (r) => {
        let text = ""; r.setEncoding("utf8").on("data", (c: string) => (text += c)).on("end", () => resolve({ status: r.statusCode ?? 0, text }));
      });
      req.on("error", reject); req.end(s);
    });
    try {
      for (const [text, name, last4] of [[UK, "uk.pdf", "6819"], [US, "us.pdf", null]] as const) {
        const id = await w.add(text, name);
        const req = JSON.parse((await post(`/api/payables/invoices/${id}/supplier-request`, {})).text) as { add_id: string };
        const ask = async () => { await post(`/api/payables/suppliers/${req.add_id}/verify-code`, {}); return /is (\d{6})/.exec(lines.at(-1)!)![1]; };
        const body = { by: "clerk", how: "called the number on file in our contract and confirmed", street: "x", city: "y", postcode: "z" };
        const empty = await post(`/api/payables/suppliers/${req.add_id}/verify`, { ...body, code: await ask(), iban_last4: "" });
        expect(empty.status).toBeGreaterThanOrEqual(400);
        const d = w.db.prepare("SELECT details_json FROM payee_adds WHERE add_id = ?").get(req.add_id) as { details_json: string };
        const acct = (JSON.parse(d.details_json) as { accountNumber: string }).accountNumber;
        const ok = await post(`/api/payables/suppliers/${req.add_id}/verify`, { ...body, code: await ask(), iban_last4: last4 ?? acct.slice(-4) });
        expect(ok.status).toBe(200);
      }
    } finally { server.close(); }
  });

  it("8: a line item starting with 'Ref…' is not the payment reference", () => {
    const text = EN.replace("Subtotal EUR", "Reflective safety vests, 40 pcs\nRefund policy: 30 days\nSubtotal EUR");
    expect(parseApFallback(text).reference).toBe("BTX-2026-21");
  });

  it("9: common ways of announcing new bank details are seen; ordinary bank lines are not", () => {
    const said = (text: string) => assessAgainst([], { vendor: "X GmbH", iban: "DE89370400440532013000", bic: "" }, text, "h").signals.some((s) => s.code === "bank_change_language");
    for (const t of [
      "Please note our new IBAN below.",
      "Our payment details have changed.",
      "We have moved our account to ABN AMRO; please pay to the IBAN below from now on.",
      "Bitte beachten Sie unsere neue IBAN.",
      "Onze IBAN is gewijzigd.",
      "Our banking details have been updated.",
      "Our bank details have changed",
    ]) expect({ t, flagged: said(t) }).toEqual({ t, flagged: true });
    for (const t of [
      "IBAN: DE89 3704 0044 0532 0130 00\nBIC: COBADEFFXXX",
      "Bankverbindung: Commerzbank Neuss, IBAN DE89 3704 0044 0532 0130 00",
      "Please pay to the IBAN below within 14 days.",
      "Payment details: IBAN DE89 3704 0044 0532 0130 00, reference BTX-2026-21",
      "Banking details\nAccount holder: Bergtex Textil GmbH",
    ]) expect({ t, flagged: said(t) }).toEqual({ t, flagged: false });
  });

  it("10: a copy of an invoice a person rejected goes to a person, citing the rejection", async () => {
    const w = await world();
    const a = await w.add(EN, "a.pdf");
    await rejectApInvoice(w.db, a, "we never ordered this; the supplier says it is not theirs", { sink: undefined });
    const b = await w.add(EN + "\nThank you for your business", "a-again.pdf");
    expect(w.inv(b).status).toBe("needs_review");
    expect(w.inv(b).findings.some((f) => f.code === "rejected_before" && f.detail.includes(a))).toBe(true);
  });

  it("11: a reference too long for SWIFT is refused at payment: it reaches the cap uncut, and every planner applies it", async () => {
    const long = "R".repeat(150);
    const text = EN.replace("Payment reference: BTX-2026-21", `Payment reference: ${long}`);
    expect(parseApFallback(text).reference).toBe(long);
    const w = await world();
    // A PDF line wraps a 150-character token, so the long reading is set as a model's reading would be stored.
    const id = await w.add(EN, "long.pdf");
    w.db.prepare("UPDATE ap_invoices SET reading_json = json_set(reading_json, '$.reference', ?) WHERE id = ?").run(long, id);
    await expect(payApInvoice(w.db, w.awx, id, new Date())).rejects.toThrow(/140 at most/);
    const out = await proposeInvoicePayment(w.db, w.awx, { invoice_no: "X-1 · Bergtex Textil GmbH", vendor: MANUFACTURER.name, amount: "10.00", currency: "EUR", due_date: "2026-11-30", iban: MANUFACTURER.iban, bic: MANUFACTURER.bic, reference: "R".repeat(141) }, "text", new Date());
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/140 at most/) });
    expect(referenceProblem("R".repeat(140))).toBeNull();
  });
});

