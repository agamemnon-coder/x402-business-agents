// One line per proposal on the dashboard and in the audit report (src/dashboard/snapshot.ts summarize), from the stored
// terms only, for every kind; unreadable terms say so. And who approved, in words: a person's passkey reads as Face ID,
// a labelled virtual test passkey never does, and two people read as both.
import { describe, expect, it } from "vitest";
import { approverName, summarize } from "../src/dashboard/snapshot.js";

const s = (kind: string, t: Record<string, unknown>) => summarize(kind, JSON.stringify(t));

describe("a proposal in one line", () => {
  it("says so when the terms cannot be read, and names an unknown kind by its title", () => {
    expect(summarize("invoice_payment", "{oops")).toBe("terms unreadable");
    expect(s("brand_new_kind", {})).toBe("brand new kind");
  });

  it("a price option, a refund batch (one sale, a dispute, an amount that is no amount), an invoice payment with and without conversion", () => {
    expect(s("mandate_replace", { option: "B", query_price: "0.07", margin: "0.03", upstream_price: "0.04", total_budget: "20.00", steps: [{ agent: "sourcing", cap: "0.04", budget: "12.00" }] }))
      .toBe("Option B: sell at 0.07 (margin 0.03 on 0.04); sourcing cap 0.04, budget 12.00; total 20.00");
    expect(s("mandate_replace", { option: "A" })).toBe("Option A: sell at  (margin  on ); ; total ");
    expect(s("refund_batch", { refunds: [{ amount: "0.05" }], customer: "0x1111111111111111111111111111111111111111", dispute_id: "D-1" })).toMatch(/^Refund 1 sale, 0\.05 USDZ in total, to the customer .* \(dispute D-1\)$/);
    expect(s("refund_batch", { refunds: [{ amount: "0.05" }, { amount: "bad" }], customer: "x" })).toBe("Refund 2 sales, 0.05 USDZ in total, to the customer x");
    expect(s("invoice_payment", { vendor: "Bergtex", amount: "1850.00", invoice_no: "BTX-1", iban_last4: "3000", fee_max: "20.00", conversion: { sell_amount: "416.59", buy_amount: "370.00", client_rate: "1.1259" } }))
      .toBe("Pay Bergtex EUR 1850.00 for invoice BTX-1 by SWIFT to IBAN …3000; first convert USD 416.59 to EUR 370.00 at 1.1259; fee at most EUR 20.00");
    expect(s("invoice_payment", { vendor: "Bergtex", amount: "10.00", invoice_no: "BTX-2", iban_last4: "3000", method: "LOCAL", fee: "1.00" }))
      .toBe("Pay Bergtex EUR 10.00 for invoice BTX-2 by LOCAL to IBAN …3000; paid from free EUR; fee about EUR 1.00");
  });

  it("a dev test, bank details changed or added (verified by whom), a held payment returned or accepted", () => {
    expect(s("dev_test", { label: "DEV TEST", purpose: "Face ID check" })).toBe("DEV TEST: Face ID check");
    expect(s("payee_change", { vendor: "Bergtex", new_iban: "DE02100100100006820101", old_iban_last4: "3000", verification: { by: "max" } })).toBe("Pay Bergtex to the account ending 0101 instead of …3000; verified by max");
    expect(s("payee_change", { vendor: "Bergtex", new_iban: "DE02100100100006820101", old_iban_last4: "3000" })).toBe("Pay Bergtex to the account ending 0101 instead of …3000; verified by ");
    expect(s("payee_add", { vendor: "Acme", iban: "NL91ABNA0417164300", verification: { by: "anna" } })).toBe("Add Acme as a supplier, paid to the account ending 4300; verified by anna");
    expect(s("payee_add", { vendor: "Acme", iban: "NL91ABNA0417164300" })).toBe("Add Acme as a supplier, paid to the account ending 4300; verified by ");
    expect(s("quarantine_release", { action: "return", amount: "5.00", originator: "0xabc" })).toBe("Return 5.00 test USD held in quarantine to its sender 0xabc");
    expect(s("quarantine_release", { action: "accept", amount: "5.00", originator: "0xabc" })).toBe("Accept 5.00 test USD from 0xabc, held in quarantine, into the sweep wallet");
  });

  it("a task card, an outside agent's card (with or without its limits) and a policy change", () => {
    expect(s("task_card", { label: "Train", amount: "120.00", merchant_categories: ["4112", "4111"], valid_until: "2026-11-30T23:59:00Z", purpose: "the fair" })).toBe("Train card, one purchase of at most EUR 120.00 at merchant category 4112, 4111, until 2026-11-30: the fair");
    expect(s("task_card", { label: "Hotel", amount: "90.00", valid_until: "", purpose: "p" })).toBe("Hotel card, one purchase of at most EUR 90.00 at merchant category , until : p");
    expect(s("agent_onboard", { display_name: "Bot", agent_id: "ext:bot", card: { per_tx: "50.00", monthly: "500.00" }, purpose: "ads" })).toBe("Issue Bot (outside agent ext:bot) a virtual company card: at most 50.00 EUR per purchase and 500.00 EUR per month, for ads");
    expect(s("agent_onboard", { display_name: "Bot", agent_id: "ext:bot", purpose: "ads" })).toBe("Issue Bot (outside agent ext:bot) a virtual company card: at most  EUR per purchase and  EUR per month, for ads");
    expect(s("policy_change", { changes: [{ label: "Sourcing cap", from: "", to: "0.03" }, { label: "Floor", from: "500.00", to: "" }] })).toBe("Sourcing cap: no extra limit → 0.03; Floor: 500.00 → no extra limit");
    expect(s("policy_change", {})).toBe("");
  });
});

describe("who approved, in words", () => {
  it("a person's passkey is Face ID; two people are both; a virtual test passkey is never called a person", () => {
    expect(approverName("max (passkey k_EWzUuv)", "passkey")).toBe("Max · Face ID");
    expect(approverName("max (passkey a) + anna (passkey b)", "passkey")).toBe("Max & Anna · Face ID");
    const mixed = approverName("max (passkey a) + test-controller (passkey b)", "passkey");
    expect(mixed).toMatch(/^Max · Face ID & /);
    expect(mixed).toMatch(/virtual test passkey/);
    expect(approverName("cfo", "cli")).toBe("cfo");
  });
});
