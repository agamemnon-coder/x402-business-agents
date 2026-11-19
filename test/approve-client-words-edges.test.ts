// The phone's words for the less common shapes of each proposal kind, built from the hashed terms only: what the CFO
// reads before Face ID must name the right payee, the right route and every warning, and must never make an unknown
// or malformed change look approvable (src/approve/client.ts).
import { describe, expect, it } from "vitest";
import { agentOf, describeTerms, firstScreenFacts, hexToBytes, bytesToB64url, notList, payablesFacts, whyYou, outflowOf, type PhoneProposal } from "../src/approve/client.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

describe("a mandate replace and a refund batch, the less common shapes", () => {
  it("leaves out 'already spent' when the step does not carry it", () => {
    const d = describeTerms({ kind: "mandate_replace", option: "A", query_price: "0.05", upstream_price: "0.04", margin: "0.01", total_budget: "20.00",
      steps: [{ order: "1", agent: "sourcing", cap: "0.04", budget: "12.00", payees: [ADDR] }] }, { [ADDR]: "Stockline" });
    expect(d.rows).toContainEqual(["Step 1: sourcing mandate", "up to 0.04 per payment, 12.00 in total"]);
    expect(d.warnings).toEqual([]);
  });

  it("says 'sale' for one refund, names an unknown customer by address, lists the dispute, and warns about any other payee", () => {
    const one = describeTerms({ kind: "refund_batch", customer: ADDR, total: "0.05", reason: "late data", dispute_id: "D-7",
      refunds: [{ sale_id: 4, amount: "0.05", to: ADDR }] }, {});
    expect(one.title).toBe("Refund 1 sale");
    expect(one.sentence).toBe("Refund 1 sale to 0x1111…1111, 0.05 USDZ in total.");
    expect(one.rows).toContainEqual(["Dispute", "D-7"]);
    expect(one.warnings).toEqual([]);

    const elsewhere = describeTerms({ kind: "refund_batch", customer: ADDR, total: "0.10", reason: "r",
      refunds: [{ sale_id: 4, amount: "0.05", to: ADDR }, { sale_id: 5, amount: "0.05", to: OTHER }] }, {});
    expect(elsewhere.warnings).toEqual([`Pays addresses other than the customer: ${OTHER}`]);
    expect(elsewhere.recipient).toBe("0x1111…1111; 0x2222…2222");
    expect(elsewhere.rows.some(([k]) => k === "Dispute")).toBe(false);
  });
});

describe("an invoice payment's words", () => {
  const base = { kind: "invoice_payment", currency: "EUR", amount: "2400.00", fee: "15.00", beneficiary_name: "Acme GmbH", vendor: "Acme GmbH",
    iban_last4: "3000", bic: "COBADEFFXXX", invoice_no: "INV-1", reference: "R1", method: "SWIFT" };

  it("defaults to EUR when the terms name no currency", () => {
    const { currency: _c, ...noCurrency } = base;
    expect(describeTerms(noCurrency, {}).amount).toBe("EUR 2,400.00");
  });

  it("shows an estimated fee when no ceiling is signed, and pays from free EUR without a conversion", () => {
    const d = describeTerms(base, {});
    expect(d.amount).toBe("EUR 2,400.00");
    expect(d.rows).toContainEqual(["Bank fee", "about EUR 15.00"]);
    expect(d.rows).toContainEqual(["Conversion", "none: paid from free EUR"]);
    expect(d.sentence).toBe("Pay Acme GmbH EUR 2,400.00 for invoice INV-1 by SWIFT, from free EUR.");
    expect(d.warnings).toEqual([]);
    expect(d.approvable).toBe(true);
  });

  it("warns when the account holder is not the invoice's vendor", () => {
    const d = describeTerms({ ...base, beneficiary_name: "Someone Else Ltd" }, {});
    expect(d.warnings).toEqual(["The account holder (Someone Else Ltd) is not the vendor on the invoice (Acme GmbH)"]);
  });

  it("shows the invoice's own total line, and warns on another currency and on an amount the line does not hold", () => {
    const d = describeTerms({ ...base, currency: "USD", document_total_line: "Total due: 2,400.00", document_currency: "" }, {});
    expect(d.rows).toContainEqual(["On the invoice", "\"Total due: 2,400.00\" (currency read from that line: none code knows)"]);
    expect(d.warnings).toEqual(["The invoice's own total line reads no currency code knows, not USD"]);
    const wrong = describeTerms({ ...base, amount: "24000.00", document_total_line: "Total EUR 2.400,00", document_currency: "EUR" }, {});
    expect(wrong.warnings).toEqual(["The amount EUR 24,000.00 is not written in the invoice's own total line shown above; check the document before you approve"]);
    const words = describeTerms({ ...base, document_total_line: "Total: see attachment", document_currency: "EUR" }, {});
    expect(words.warnings).toHaveLength(1);
  });

  it("is not approvable when Purser's fee is above its cap, and says so", () => {
    const d = describeTerms({ ...base, platform_fee: { amount: "48.00", currency: "EUR", bps: "200", to_account: "acct_purser" } }, {});
    expect(d.approvable).toBe(false);
    expect(d.warnings).toContain("Purser's fee here is 200 basis points, above its cap of 100 (1.00%); do not approve");
    expect(d.rows).toContainEqual(["Total out", "EUR 2,448.00 (the amount and Purser's fee; no Airwallex fee is expected on this route)"]);
    const odd = describeTerms({ ...base, platform_fee: { amount: "1.00", currency: "EUR", bps: "1.5", to_account: "a" } }, {});
    expect(odd.approvable).toBe(false);
  });
});

describe("a supplier payment's words", () => {
  const base = { kind: "supplier_payment", currency: "USD", amount: "500.00", beneficiary_name: "Shenzhen Parts", vendor: "Shenzhen Parts",
    account: "acct 1234", invoice_no: "SP-9", reference: "ref", method: "LOCAL" };

  it("states a route without clearing and without a fee to hold back", () => {
    const d = describeTerms({ ...base, fee_reserve: "0.00" }, {});
    expect(d.sentence).toBe("Pay Shenzhen Parts USD 500.00 for invoice SP-9 by LOCAL, from the USD balance.");
    expect(d.rows).toContainEqual(["Fee reserve", "none: no Airwallex fee is expected on this route (the real fee is recorded)"]);
    expect(d.rows).toContainEqual(["Conversion", "none: paid from the USD balance"]);
    expect(d.approvable).toBe(true);
  });

  it("names a different holder, a line in another currency, and the total out with Airwallex's fee on top", () => {
    const d = describeTerms({ ...base, clearing: "ACH", fee_reserve: "25.00", beneficiary_name: "Not Them",
      document_total_line: "TOTAL 500.00", document_currency: "CNY",
      platform_fee: { amount: "2.50", currency: "USD", bps: "50", to_account: "acct_purser" }, paying_account: { name: "Northwind (Airwallex, through Purser)", id: "acct_n" } }, {});
    expect(d.sentence).toContain("by LOCAL (ACH)");
    expect(d.rows).toContainEqual(["Paid from", "Northwind (Airwallex, through Purser), acct_n"]);
    expect(d.rows).toContainEqual(["Total out", "USD 502.50 (the amount and Purser's fee; Airwallex's own fee comes on top, at most USD 25.00)"]);
    expect(d.rows).toContainEqual(["On the invoice", "\"TOTAL 500.00\" (currency read from that line: CNY)"]);
    expect(d.warnings).toEqual([
      "The account holder (Not Them) is not the vendor on the invoice (Shenzhen Parts)",
      "The invoice's own total line reads CNY, not USD",
    ]);
  });
});

describe("a new supplier without an IBAN, and one with", () => {
  const ver = { by: "Max", how: "called the number on file" };
  it("reads an ABA routing number, a sort code, another routing scheme and none", () => {
    const of = (bank: Record<string, string>) => describeTerms({ kind: "payee_add", vendor: "Acme Inc", bank: { accountNumber: "987654321", currency: "USD", method: "LOCAL", country: "US", ...bank }, verification: ver, address: { street: "1 Main", postcode: "10001", city: "NYC" } }, {});
    const aba = of({ routingType: "aba", routingValue: "026009593", clearing: "ACH" });
    expect(aba.rows).toContainEqual(["Routing", "ABA 026009593"]);
    expect(aba.rows).toContainEqual(["Paid in", "USD by LOCAL (ACH)"]);
    expect(aba.big).toBe("…4321");
    expect(aba.sentence).toBe("Add Acme Inc as a supplier, paid in USD by LOCAL to account 987654321 (ABA 026009593, US). Max recorded that the supplier confirmed it: called the number on file.");
    expect(of({ routingType: "sort_code", routingValue: "401276", swiftCode: "HBUKGB4B" }).rows).toContainEqual(["Routing", "sort code 40-12-76, BIC HBUKGB4B"]);
    expect(of({ routingType: "cnaps", routingValue: "102100099996" }).rows).toContainEqual(["Routing", "cnaps 102100099996"]);
    const none = of({});
    expect(none.rows).toContainEqual(["Routing", ""]);
    expect(none.rows).toContainEqual(["Paid in", "USD by LOCAL"]);
  });

  it("with an IBAN: the route when the terms carry it, and 'none' for a missing BIC", () => {
    const d = describeTerms({ kind: "payee_add", vendor: "Beta BV", iban: "NL91ABNA0417164300", bank: { iban: "NL91ABNA0417164300", currency: "EUR", method: "SEPA", clearing: "SCT" }, verification: ver }, {});
    expect(d.sentence).toBe("Add Beta BV as a supplier, paid in EUR by SEPA (SCT) to IBAN NL91 ABNA 0417 1643 00 (BIC none). Max recorded that the supplier confirmed it: called the number on file.");
    expect(d.rows).toContainEqual(["Paid in", "EUR by SEPA (SCT)"]);
    const old = describeTerms({ kind: "payee_add", vendor: "Beta BV", iban: "NL91ABNA0417164300", bic: "ABNANL2A" }, {});
    expect(old.rows.some(([k]) => k === "Paid in")).toBe(false);
    expect(old.rows).toContainEqual(["Verified by", ""]);
  });

  it("a bank-detail change without a recorded verification still warns about invoice fraud", () => {
    const d = describeTerms({ kind: "payee_change", vendor: "Beta BV", new_iban: "NL91ABNA0417164300", new_bic: "ABNANL2A", old_iban_last4: "9999" }, {});
    expect(d.rows).toContainEqual(["Verified by", ""]);
    expect(d.warnings[0]).toMatch(/invoice fraud/);
    expect(d.big).toBe("…4300");
  });
});

describe("a held payment, a task card and the card and credential rails", () => {
  it("accepting a held payment warns; returning it does not", () => {
    const t = { kind: "quarantine_release", amount: "12.00", originator: OTHER, to: ADDR, tx_hash: "0xabcdef0123456789" };
    const accept = describeTerms({ ...t, action: "accept" }, {});
    expect(accept).toMatchObject({ title: "Accept a held payment", recipient: `the sweep wallet ${ADDR}`, short: "accepting it", amountLabel: "Accepts" });
    expect(accept.warnings).toHaveLength(1);
    expect(accept.rows).toContainEqual(["Held in", "transaction 0xabcdef01…"]);
    const back = describeTerms({ ...t, action: "return" }, {});
    expect(back).toMatchObject({ title: "Return a held payment", recipient: OTHER, short: "returning it", amountLabel: "Returns", warnings: [] });
    expect(back.sentence).toBe(`Send the 12.00 test USD that Alta held in quarantine back to its sender ${OTHER}. Nothing else moves.`);
  });

  it("names the merchant kind and who asked for a task card, for every asker", () => {
    const card = (mcc: string[] | undefined, asked_by: string) => describeTerms({ kind: "task_card", label: "Train ticket", amount: "120.00", purpose: "a trip", valid_until: "2026-11-12T23:59:00Z", asked_by, ...(mcc ? { merchant_categories: mcc } : {}) }, {});
    expect(card(["4511"], "cfo-at-runner").recipient).toBe("an airline (merchant category 4511)");
    expect(card(["7011"], "x").recipient).toBe("a hotel (merchant category 7011)");
    expect(card(["4112"], "x").recipient).toBe("a railway (merchant category 4112)");
    expect(card(["1234"], "x").recipient).toBe("a merchant (merchant category 1234)");
    expect(card(undefined, "x").recipient).toBe("a merchant (merchant category )");
    expect(card(["4112"], "cfo-at-runner").rows).toContainEqual(["Asked by", "you, at the runner"]);
    expect(card(["4112"], "cfo-at-runner").warnings[0]).toMatch(/^Purser read this from your own message\./);
    expect(card(["4112"], "ext:acme-bot").rows).toContainEqual(["Asked by", "outside agent ext:acme-bot"]);
    expect(card(["4112"], "ext:acme-bot").warnings[0]).toMatch(/^An outside agent \(ext:acme-bot\) asked for this card, not you/);
    expect(card(["4112"], "").rows).toContainEqual(["Asked by", "someone with the dashboard link"]);
    expect(card(["4112"], "").warnings[0]).toMatch(/dashboard link/);
    expect(card(["4112"], "x").rows).toContainEqual(["Ends", "12 Nov 2026, 23:59 UTC"]);
    const bad = describeTerms({ kind: "task_card", label: "x", amount: "1.00", valid_until: "not a date", asked_by: "" }, {});
    expect(bad.rows).toContainEqual(["Ends", "not a date"]);
  });

  it("an Airi purchase and an ICC request without a merchant object read empty, never another merchant", () => {
    const airi = describeTerms({ kind: "airi_purchase", agent: "sourcing", currency: "USD", amount: "10.00", items: [{ quantity: "2", name: "Data", unit_price: "5.00" }], description: "data" }, {});
    expect(airi.rows).toContainEqual(["Merchant", " ()"]);
    expect(airi.rows).toContainEqual(["Items", "2 × Data at 5.00"]);
    const icc = describeTerms({ kind: "icc_purchase", agent: "sourcing", currency: "USD", amount: "10.00", description: "data", expires_at: "2026-11-20T00:00:00Z" }, {});
    expect(icc.recipient).toBe(", ");
    expect(icc.rows).toContainEqual(["Items", ""]);
    expect(icc.title).toBe("Payment credential request");
  });

  it("an outside agent's company card states its limits, and without a card object no limit is invented", () => {
    const d = describeTerms({ kind: "agent_onboard", display_name: "Acme Bot", agent_id: "ext:acme", purpose: "ads", card: { per_tx: "50.00", monthly: "1000.00" } }, {});
    expect(d).toMatchObject({ title: "Company card for an outside agent", amount: "1,000.00 EUR a month at most", big: "50.00", unit: "EUR per purchase" });
    expect(d.rows).toContainEqual(["Most per month", "1,000.00 EUR"]);
    expect(describeTerms({ kind: "agent_onboard", display_name: "x", agent_id: "y", purpose: "z" }, {}).big).toBe("");
  });
});

describe("an owners_execute the page cannot check", () => {
  it("without an action, calls, a deadline or a nonce: not approvable, with each problem named, and the page does not crash", () => {
    // Until 19 November a deadline that is not a number threw (new Date(NaN).toISOString()) and took the page down
    // instead of saying the change cannot be signed.
    for (const valid_until of ["x", "1e300"]) {
      const d = describeTerms({ kind: "owners_execute", account: ADDR, expires_at: "2026-11-20T00:00:00Z", valid_until, nonce: "not a number" }, {});
      expect(d.approvable).toBe(false);
      expect(d.title).toBe("An on-chain change this page does not know");
      expect(d.warnings).toEqual([
        "The terms carry no valid on-chain digest; this cannot be signed",
        "The call does not go to the account itself with no value; this cannot be signed",
        "The signed deadline does not end with this proposal; this cannot be signed",
        "The nonce is not a two-owner lane; this cannot be signed",
      ]);
      expect(d.rows).toContainEqual(["Valid until", valid_until]);
    }
  });

  it("a nonce above the lane's 255 bits is refused", () => {
    const exp = Date.parse("2026-11-20T00:00:00Z") / 1000;
    const d = describeTerms({ kind: "owners_execute", account: ADDR, expires_at: "2026-11-20T00:00:00Z", valid_until: String(exp), nonce: (2n ** 256n).toString(),
      onchain_digest: `0x${"ab".repeat(32)}`, action: { what: "bind", agent: "sourcing", cap: "0.04", budget: "12.00", payee: ADDR, payee_name: "Stockline" },
      calls: [{ target: ADDR, value: "0", call_data: "0x240c29bb00" }] }, {});
    expect(d.warnings).toEqual(["The nonce is not a two-owner lane; this cannot be signed"]);
    expect(d.approvable).toBe(false);
  });
});

describe("a payment batch's words", () => {
  const line = (id: string, amount: string, extra: Record<string, unknown> = {}) => ({ proposal_id: id, terms: { kind: "supplier_payment", currency: "EUR", amount, beneficiary_name: "Acme", vendor: "Acme", account: "a", invoice_no: id, ...extra } });

  it("one invoice: singular words; a line without readable terms makes the totals unsignable", () => {
    const one = describeTerms({ kind: "payment_batch", lines: [line("I-1", "10.00")], totals: { EUR: "10.00" } }, {});
    expect(one.title).toBe("Betaal 1 factuur in één keer");
    expect(one.sentence).toMatch(/deze 1 betaling goed/);
    expect(one.approvable).toBe(true);
    const unreadable = describeTerms({ kind: "payment_batch", lines: [line("I-1", "10.00"), { proposal_id: "I-2" }], totals: { EUR: "10.00" } }, {});
    expect(unreadable.approvable).toBe(false);
    expect(unreadable.warnings[0]).toMatch(/niet de som van de regels/);
  });

  it("names a line by its holder when the vendor is missing, prefixes each line's warnings, and with no totals is not signable", () => {
    const d = describeTerms({ kind: "payment_batch", lines: [line("I-1", "10.00", { vendor: "", beneficiary_name: "Holder" }), line("I-2", "5.00", { document_total_line: "Total 7.00", document_currency: "EUR" })] }, {});
    expect(d.rows[0]![1]).toMatch(/aan Holder \(factuur I-1\)/);
    expect(d.recipient).toBe("Holder; Acme");
    expect(d.warnings).toContain("I-2: The amount EUR 5.00 is not written in the invoice's own total line shown above; check the document before you approve");
    expect(d.approvable).toBe(false);
    expect(describeTerms({ kind: "payment_batch" }, {})).toMatchObject({ approvable: false, big: "", title: "Betaal 0 facturen in één keer" });
  });
});

describe("the first screen and why it waits for the CFO", () => {
  it("an unknown kind with no name reads 'unknown'", () => {
    expect(describeTerms({}, {})).toMatchObject({ approvable: false, title: "Proposal of kind unknown", label: "unknown" });
  });

  it("names the agent behind every kind of proposer", () => {
    expect(agentOf("treasury", { kind: "task_card", asked_by: "ext:bot" })).toBe("Outside agent bot");
    expect(agentOf("treasury", { kind: "task_card", asked_by: "" })).toBe("None: a chat message with the dashboard link");
    expect(agentOf("ext:acme", { kind: "dev_test" })).toBe("Outside agent acme");
    expect(agentOf("system", { kind: "dev_test" })).toBe("Purser");
    expect(agentOf("", { kind: "dev_test" })).toBe("Purser");
    expect(agentOf("human", { kind: "dev_test" })).toBe("None: a change made by a person");
    expect(agentOf("treasury", { kind: "supplier_payment", source: "payables_inbox" })).toBe("Payables inbox");
    expect(agentOf("treasury", { kind: "icc_purchase", agent: "sourcing" })).toBe("Sourcing agent");
    expect(agentOf("treasury", { kind: "icc_purchase" })).toBe("Treasury agent");
  });

  it("says which rule sends each kind to the CFO", () => {
    const cases: [string, RegExp][] = [
      ["policy_change", /CFO policy changes only/], ["payee_change", /bank details change only/], ["payee_add", /new supplier is paid only/],
      ["quarantine_release", /held in quarantine/], ["airi_purchase", /through Airi/], ["icc_purchase", /payment credential is requested/],
      ["agent_onboard", /outside agent gets a company card/], ["owners_execute", /both owners' passkeys/], ["dev_test", /nothing moves/],
      ["mandate_replace", /mandate changes only/], ["supplier_payment", /Airwallex account only/], ["nonsense", /cannot be approved on the phone/],
    ];
    for (const [kind, re] of cases) expect(whyYou({ kind }), kind).toMatch(re);
    expect(whyYou({ kind: "refund_batch" })).toBe("Your policy sends refunds above its limits to you.");
    expect(whyYou({ kind: "task_card" })).toBe("A task card is issued only with your Face ID.");
    expect(whyYou({ kind: "task_card" }, [{ key: "approval.task_card_eur", value: "50.00" }])).toBe("Without your Face ID, a task card is issued only when you ask at the runner, up to 50.00 EUR.");
    expect(whyYou({ kind: "dev_test" }, [], { approved_by: [] })).toBe("It checks Face ID on this phone; nothing moves. It needs two people (four eyes).");
  });

  it("the first screen of an inbox payment without a reason shows only its total line", () => {
    expect(firstScreenFacts({ kind: "invoice_payment", document_total_line: "Total 5.00" })).toEqual([["On the invoice", "“Total 5.00”"]]);
    expect(firstScreenFacts({ kind: "supplier_payment", source: "payables_inbox" })).toEqual([]);
  });
});

describe("a payables payment in the company's language", () => {
  const t = { kind: "invoice_payment", currency: "EUR", amount: "1000.00", beneficiary_name: "Acme", vendor: "Acme", iban_last4: "3000", bic: "COBADEFF", invoice_no: "F-1", reference: "R", method: "SWIFT", fee_max: "20.00" };

  it("an invoice payment: IBAN payee, BIC in the method, the bank fee ceiling, no conversion, EUR by default", () => {
    const f = payablesFacts(t, "en");
    expect(f.first[0]![1]).toBe("Acme, IBAN …3000");
    expect(f.details[1]![1]).toBe("SWIFT, BIC COBADEFF");
    expect(f.amount).toBe("EUR 1,000.00");
    expect(f.warnings).toEqual([]);
  });

  it("a reason the phrases do not know reads as the code in words; Purser's fee above its cap and a line without a currency are warned", () => {
    const f = payablesFacts({ ...t, reason: "rent_payment", document_total_line: "Totaal 1.000,00", document_currency: "",
      platform_fee: { amount: "30.00", currency: "EUR", bps: "300", to_account: "acct_p" } }, "nl");
    expect(f.first.map(([, v]) => v)).toContain("Rent payment");
    expect(f.warnings).toHaveLength(2);
    expect(f.first.length).toBe(5);
  });

  it("a supplier payment in Dutch: the account as payee, the clearing in the method, no bank fee and a conversion", () => {
    const f = payablesFacts({ kind: "supplier_payment", currency: "USD", amount: "10.00", beneficiary_name: "Other", vendor: "Acme", account: "acct 1", method: "LOCAL", clearing: "ACH",
      fee_reserve: "0.00", conversion: { sell_currency: "EUR", sell_amount: "9.00", buy_currency: "USD", buy_amount: "10.00", client_rate: "1.11" } }, "nl");
    expect(f.first[0]![1]).toBe("Other, acct 1");
    expect(f.details[1]![1]).toBe("LOCAL (ACH)");
    expect(f.warnings).toHaveLength(1);
  });
});

describe("bytes and the options not chosen", () => {
  it("refuses a hex string with odd length or other characters", () => {
    expect(() => hexToBytes("abc")).toThrow(/not hex/);
    expect(() => hexToBytes("zz")).toThrow(/not hex/);
    expect([...hexToBytes("00ff")]).toEqual([0, 255]);
  });

  it("encodes an ArrayBuffer as well as a Uint8Array", () => {
    expect(bytesToB64url(new Uint8Array([251, 255]).buffer)).toBe("-_8");
  });

  it("names an alternative by its id when its terms are not an object or not JSON", () => {
    const p = (id: string, canonical: string): PhoneProposal => ({ proposal_id: id, kind: "x", group: "g", canonical, terms_sha256: "", expires_at: "", created_by: "", created_at: "", review: null });
    const chosen = p("P-1", "{}");
    expect(notList(chosen, [chosen, p("P-2", "[1]"), p("P-3", "{oops")], {})).toEqual(["P-2", "P-3"]);
  });

  it("an outflow needs an amount in cents, a currency and a readable fee", () => {
    expect(outflowOf({ amount: "10.00", currency: "EUR" })).toEqual({ currency: "EUR", cents: 1000 });
    expect(outflowOf({ amount: "10", currency: "EUR" })).toBeNull();
    expect(outflowOf({ amount: "10.00" })).toBeNull();
    expect(outflowOf({ amount: "10.00", currency: "EUR", platform_fee: { amount: "x" } })).toBeNull();
  });
});
