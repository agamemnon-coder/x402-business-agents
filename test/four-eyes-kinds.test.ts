// When a proposal needs two people (src/policy/fourEyes.ts), kind by kind: an owners_execute always; a supplier payment
// whose euro value the terms do not state always; one with Purser's fee in another currency counts as unknown; an
// invoice payment by its euro value or its amount; an outside agent's card by its monthly limit; a task card by its
// amount; resuming a paused agent; a batch whose lines together pass the threshold or one of whose lines is unknown.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { fourEyes, supplierPaymentEur } from "../src/policy/fourEyes.js";

let db: DB;
const threshold = (v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', ?, 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
const needs = (kind: string, terms: Record<string, unknown>) => fourEyes(db, { kind, terms_json: JSON.stringify(terms) });
const usd = (amount: string, extra: Record<string, unknown> = {}) => ({ amount, currency: "USD", conversion: { sell_currency: "EUR", sell_amount: "90.00", buy_amount: "100.00" }, ...extra });

beforeEach(() => { db = openDb(":memory:"); });

describe("four eyes, kind by kind", () => {
  it("an owners_execute always needs both owners; with no threshold set, nothing else that moves money does", () => {
    threshold("");
    expect(needs("owners_execute", {})).toBe(true);
    expect(needs("supplier_payment", { amount: "999999.00", currency: "EUR" })).toBe(false);
    expect(needs("payment_batch", { lines: [{ kind: "supplier_payment", terms: { amount: "1.00", currency: "EUR" } }] })).toBe(false);
  });

  it("a supplier payment: by its euro value, and always when the terms state none", () => {
    threshold("1000.00");
    expect(needs("supplier_payment", { amount: "1000.00", currency: "EUR" })).toBe(false);
    expect(needs("supplier_payment", { amount: "1000.01", currency: "EUR" })).toBe(true);
    expect(needs("supplier_payment", usd("100.00"))).toBe(false);
    expect(needs("supplier_payment", { amount: "100.00", currency: "USD" })).toBe(true);
    expect(needs("supplier_payment", usd("100.00", { conversion: { sell_currency: "GBP", sell_amount: "1.00", buy_amount: "1.00" } }))).toBe(true);
    expect(needs("supplier_payment", usd("100.00", { conversion: { sell_currency: "EUR", sell_amount: "1.00", buy_amount: "0.00" } }))).toBe(true);
    expect(needs("supplier_payment", { amount: "10.00", currency: "EUR", platform_fee: { amount: "0.10", currency: "USD" } })).toBe(true);
    expect(needs("supplier_payment", { amount: "10", currency: "EUR" })).toBe(true);
  });

  it("the euro value of a converted payment counts Purser's fee at the quote's rate, never below what is sold", () => {
    expect(supplierPaymentEur(JSON.stringify(usd("100.00", { platform_fee: { amount: "1.00", currency: "USD" } })))).toBe("90.90");
    expect(supplierPaymentEur(JSON.stringify(usd("50.00")))).toBe("90.00");
    expect(supplierPaymentEur(JSON.stringify({ amount: "1.00", currency: "USD" }))).toBeNull();
  });

  it("an invoice payment by its euro value, else by its amount", () => {
    threshold("100.00");
    expect(needs("invoice_payment", { amount: "150.00", currency: "EUR" })).toBe(true);
    expect(needs("invoice_payment", { amount: "150.00", currency: "USD" })).toBe(true);
    expect(needs("invoice_payment", { amount: "50.00", currency: "USD" })).toBe(false);
    expect(needs("invoice_payment", { amount: "lots", currency: "USD" })).toBe(false);
  });

  it("an outside agent's card by its monthly limit, a task card by its amount, a resume by binding a mandate again", () => {
    threshold("100.00");
    expect(needs("agent_onboard", { card: { per_tx: "50.00", monthly: "150.00" } })).toBe(true);
    expect(needs("agent_onboard", { card: { monthly: "100.00" } })).toBe(false);
    expect(needs("agent_onboard", {})).toBe(false);
    expect(needs("task_card", { amount: "120.00" })).toBe(true);
    expect(needs("task_card", { amount: "20.00" })).toBe(false);
    expect(needs("policy_change", { changes: [{ key: "pause.sourcing", from: "on", to: "off" }] })).toBe(true);
    expect(needs("policy_change", { changes: [{ key: "pause.sourcing", from: "off", to: "on" }] })).toBe(false);
    expect(needs("policy_change", {})).toBe(false);
    for (const kind of ["payee_change", "payee_add", "mandate_replace"]) expect(needs(kind, {})).toBe(true);
    expect(needs("refund_batch", {})).toBe(false);
  });

  it("a batch: when one line needs two people, when the lines together pass the threshold, or when a line's value is unknown", () => {
    threshold("100.00");
    const line = (amount: string, kind = "supplier_payment", currency = "EUR") => ({ kind, terms: { amount, currency } });
    expect(needs("payment_batch", { lines: [line("60.00"), line("30.00")] })).toBe(false);
    expect(needs("payment_batch", { lines: [line("60.00"), line("50.00")] })).toBe(true);
    expect(needs("payment_batch", { lines: [line("150.00")] })).toBe(true);
    expect(needs("payment_batch", { lines: [line("10.00"), line("10.00", "refund_batch")] })).toBe(true);
    expect(needs("payment_batch", { lines: [line("10.00", "invoice_payment", "USD")] })).toBe(true);
    expect(needs("payment_batch", {})).toBe(false);
  });
});
