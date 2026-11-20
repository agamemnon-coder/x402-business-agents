// The read gateway's parsers (worker/src/awxRead.ts): Airwallex's answers read field by field, only what the page
// shows, as strings; a field of the wrong type or length is left out, never shown as something else; account numbers
// and IBANs only by their last four; a payee who is a person only by initials; a rate for another pair is no rate; the
// alternative field names the sandbox uses (amount_beneficiary_receives, payment_methods, card_id, billing_amount) are
// read where the usual ones are missing.
import { describe, expect, it } from "vitest";
import { accountsOf, balancesOf, beneficiariesOf, cardsOf, cardTransactionsOf, financialOf, rateOf, transfersOf } from "../worker/src/awxRead.js";

describe("Airwallex's answers, as the page gets them", () => {
  it("balances: three-letter currencies only, sorted; amounts as numbers or plain decimal strings, else nothing", () => {
    expect(balancesOf([{ currency: "USD", available_amount: 10.5, pending_amount: "1.25", reserved_amount: "1e3", total_amount: Infinity }, { currency: "EUR", available_amount: "35000.00" }, { currency: "euro", available_amount: 1 }, "junk"]))
      .toEqual([
        { currency: "EUR", available: "35000.00", pending: null, reserved: null, total: null },
        { currency: "USD", available: "10.5", pending: "1.25", reserved: null, total: null },
      ]);
    expect(balancesOf({ items: [{ currency: "GBP", available_amount: 1 }] })).toHaveLength(1);
    expect(balancesOf(null)).toEqual([]);
  });

  it("accounts: by the last four of an IBAN or account number, routing codes only when whole", () => {
    const [a] = accountsOf({ items: [{ id: "ga_1", account_name: "Northwind", iban: "DE89 3704 0044 0532 0130 00", account_number: "123", institution: { name: "Bank" }, routing_codes: [{ type: "sort_code", value: "123456" }, { type: "aba" }, "x"], country_code: "DEU" }, { account_name: "no id" }] });
    expect(a).toMatchObject({ id: "ga_1", iban_last4: "3000", account_number_last4: null, institution: "Bank", routing: [{ type: "sort_code", value: "123456" }], country: null });
    expect(accountsOf([{ account_name: "no id" }])).toEqual([]);
  });

  it("financial transactions and transfers: only rows with an id; a transfer's approval hash only when it is one", () => {
    expect(financialOf([{ id: "ft_1", amount: "-12.50", fee: 0, status: "SETTLED" }, { amount: 1 }])).toEqual([expect.objectContaining({ id: "ft_1", amount: "-12.50", fee: "0", net: null, status: "SETTLED" })]);
    const t = transfersOf({ items: [
      { id: "tr_1", amount_beneficiary_receives: 100, amount_payer_pays: "101.20", metadata: { approval_sha256: "a".repeat(64) } },
      { id: "tr_2", transfer_amount: "5.00", source_amount: "5.10", metadata: { approval_sha256: "A".repeat(64) }, reference: "x".repeat(141) },
    ] });
    expect(t[0]).toMatchObject({ amount: "100", source_amount: "101.20", approval_sha256: "a".repeat(64) });
    expect(t[1]).toMatchObject({ amount: "5.00", source_amount: "5.10", approval_sha256: null, reference: null });
  });

  it("a rate: only for the pair asked, from rate or client_rate", () => {
    expect(rateOf({ rate: "1.12", sell_currency: "USD", buy_currency: "EUR", currency_pair: "EURUSD" }, "USD", "EUR")).toMatchObject({ rate: "1.12", pair: "EURUSD" });
    expect(rateOf({ client_rate: 1.13 }, "USD", "EUR")).toMatchObject({ rate: "1.13", sell_currency: "USD", buy_currency: "EUR" });
    expect(rateOf({ rate: "1.12", sell_currency: "GBP" }, "USD", "EUR")).toBeNull();
    expect(rateOf({ rate: "1.12", buy_currency: "JPY" }, "USD", "EUR")).toBeNull();
    expect(rateOf({ rate: "high" }, "USD", "EUR")).toBeNull();
    expect(rateOf(null, "USD", "EUR")).toBeNull();
  });

  it("beneficiaries: the name on the account when there is no company name, a person by initials, methods from either field", () => {
    const [company, person, named] = beneficiariesOf([
      { id: "b1", nickname: "Stockline", beneficiary: { entity_type: "COMPANY", bank_details: { account_name: "Stockline GmbH", iban: "DE00000000000000004471", bank_country_code: "DE", account_currency: "EUR" } }, payment_methods: ["SWIFT", 7] },
      { id: "b2", nickname: "Max Mustermann", beneficiary: { entity_type: "PERSONAL", first_name: "Max", last_name: "Mustermann", bank_details: {} }, transfer_methods: ["LOCAL"] },
      { id: "b3", beneficiary: { company_name: "Alpine AG" } },
      { beneficiary: { company_name: "no id" } },
    ]);
    expect(company).toMatchObject({ id: "b1", name: "Stockline GmbH", iban_last4: "4471", methods: ["SWIFT"], country: "DE", currency: "EUR" });
    expect(person!.name).not.toContain("Mustermann");
    expect(person!.nickname ?? "").not.toContain("Mustermann");
    expect(person!.methods).toEqual(["LOCAL"]);
    expect(named).toMatchObject({ id: "b3", name: "Alpine AG", methods: [] });
    expect(beneficiariesOf([{ beneficiary: {} }])).toEqual([]);
  });

  it("cards: by card_id or id, limits only when whole, merchant categories only as four digits", () => {
    const [c] = cardsOf([{ id: "c1", status: "ACTIVE", card_number: "4111 1111 1111 1234", authorization_controls: { allowed_merchant_categories: ["5734", "57", 5734], active_to: "2027-01-01", transaction_limits: { currency: "EUR", limits: [{ amount: 50, interval: "PER_TRANSACTION" }, { amount: "x", interval: "DAILY" }] } } }]);
    expect(c).toMatchObject({ id: "c1", status: "ACTIVE", last4: "1234", currency: "EUR", limits: [{ amount: "50", interval: "PER_TRANSACTION" }], merchant_categories: ["5734"], active_to: "2027-01-01" });
    expect(cardsOf([{ card_id: "c2", card_status: "FROZEN" }])[0]).toMatchObject({ id: "c2", status: "FROZEN", limits: [], merchant_categories: [] });
  });

  it("card transactions: the billing amount and currency when the transaction's are missing", () => {
    expect(cardTransactionsOf([{ id: "t1", billing_amount: "9.99", billing_currency: "EUR", created_at: "2026-11-06T09:32:24+0000", merchant: { name: "Cloud", category_code: "5734" } }, { amount: 1 }])).toEqual([
      { id: "t1", card_id: null, type: null, status: null, amount: "9.99", currency: "EUR", merchant: "Cloud", mcc: "5734", at: "2026-11-06T09:32:24+0000", failure_reason: null },
    ]);
  });
});
