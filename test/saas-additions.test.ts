// The jury panel's additions to the product pages (12 Nov).
//
// 1. One pricing model with reconciled numbers. The panel saw EUR 49 a month beside a second, unsettled fee per
//    payment, test fees that did not match the stated percentage, and a 48% margin in the model's own table. Now: one
//    model (src/config/pricing.ts), said in the same sentence on the README, in docs/business/model.md and in
//    docs/after-the-kit.md, with /pricing showing the same figures; one line that fits the two fixed test fees to the
//    percentage, worked out from the run records and the paying code's own figures; and the unit economics restated for
//    that model by its own generator (test/unit-economics-hypothesis.test.ts checks its arithmetic).
// 2. Security answers the buyer's first two questions, and "four eyes" is worded exactly (further down).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { platformFeeCents } from "../src/airwallex/binding.js";
import { FEE_BPS_CAP } from "../src/airwallex/platform.js";
import { figures as modelFigures, unitEconomics } from "../src/business/unitEconomics.js";
import { PRICE_LINE, WHY_COMPANY } from "../src/config/brand.js";
import { PRICING, PRICING_LABEL, PRICING_LINE, PRICING_STATEMENT, euro, percentOfBps } from "../src/config/pricing.js";
import { E2E_FEE_BPS } from "../src/e2e/setup.js";
import { PLATFORM_FEE_RULE } from "../src/policy/rules.js";
import { PRICING_LEAD, e2eFeeRun, feeFacts, feeLine, feeRun, pricingPage } from "../src/redesign/pricing.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** A doc as running text: bold and code marks out, white space single, so a sentence wrapped over lines reads as one. */
const flat = (p: string) => read(p).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** A page's <main> as a person reads it with every fold open. */
const mainText = (html: string) => decode((/<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** The four places that state the price, the page aside: each must say the one model. */
const PRICE_DOCS = ["README.md", "docs/business/model.md", "docs/after-the-kit.md"] as const;

describe("one pricing model (the panel's review, 12 Nov)", () => {
  const { starter, business } = PRICING;

  it("is one sentence, built from the pricing module: a monthly plan by supplier invoices, plus a small fee per payout; labelled pilot pricing", () => {
    expect(PRICING_LINE).toBe(`${starter.name} ${euro(starter.monthlyCents)} a month (${starter.invoicesIncluded} invoices, then ${euro(starter.extraInvoiceCents)} each); ${business.name} from ${euro(business.fromMonthlyCents)} a month; a small fee per payout.`);
    expect(PRICING_LINE).toBe("Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout.");
    expect(PRICING_LABEL).toBe("Pilot pricing");
    expect(PRICING_STATEMENT).toBe(`Pilot pricing: ${PRICING_LINE}`);
    // The business lines (README, /proof, the deck, the form) say that sentence, under that label, as a hypothesis.
    expect(PRICE_LINE).toBe(PRICING_LINE);
    expect(WHY_COMPANY.find((l) => l.label === PRICING_LABEL)).toEqual({ label: "Pilot pricing", text: `${PRICING_LINE} A hypothesis.`, page: "model.md#pilot-pricing-hypothesis" });
    expect(read("docs/business/model.md")).toMatch(/^## Pilot pricing \(hypothesis\)$/m);
  });

  it("is stated the same on the README, in docs/business/model.md and in docs/after-the-kit.md, with the module's figures, so the four places cannot drift", () => {
    for (const doc of PRICE_DOCS) {
      const text = flat(doc);
      expect({ doc, states: text.includes(PRICING_STATEMENT) }).toEqual({ doc, states: true });
      // Each figure as the module has it, in the statement itself.
      const at = text.indexOf(PRICING_STATEMENT), said = text.slice(at, at + PRICING_STATEMENT.length);
      for (const figure of [euro(starter.monthlyCents), String(starter.invoicesIncluded), euro(starter.extraInvoiceCents), euro(business.fromMonthlyCents)]) expect({ doc, figure, said: said.includes(figure) }).toEqual({ doc, figure, said: true });
      // Labelled for what it is, right there (in its heading or in the next words): a hypothesis.
      expect({ doc, hypothesis: /hypothesis/i.test(text.slice(Math.max(0, at - 40), at + PRICING_STATEMENT.length + 40)) }).toEqual({ doc, hypothesis: true });
    }
    // The page: the same figures in its cards (test/saas-pages.test.ts reads each card), and it says "pilot prices".
    const page = mainText(pricingPage());
    expect(PRICING_LEAD).toContain("pilot prices");
    expect(page).toContain("These are pilot prices for design partners. Nothing is on sale yet.");
    expect(page).toContain(`${starter.name} ${euro(starter.monthlyCents)} a month ${starter.invoicesIncluded} invoices included ${euro(starter.extraInvoiceCents)} per extra invoice`);
    expect(page).toContain(`${business.name} from ${euro(business.fromMonthlyCents)} a month`);
    expect(page).toContain("A small fee per payout");
    // A changed figure in the module changes the sentence the docs must hold: a doc left behind fails here.
    expect(flat("README.md")).not.toContain(PRICING_STATEMENT.replace("€49", "€59"));
  });

  it("leaves no sentence in those places that calls pricing unsettled or names another model, and keeps the honest \"not yet\"", () => {
    const page = mainText(pricingPage());
    for (const [name, text] of [...PRICE_DOCS.map((d) => [d, flat(d)] as const), ["/pricing", page] as const]) {
      expect({ name, unsettled: /pricing is not settled|not settled|per-payment fee|both are hypotheses/i.exec(text)?.[0] ?? null }).toEqual({ name, unsettled: null });
      expect({ name, other: /€49 per company|per extra agent|€3 per extra|including 5 agents|€10 per/i.exec(text)?.[0] ?? null }).toEqual({ name, other: null });
    }
    // Still said, plainly: nothing is on sale, no customer has seen a price, no real-money go-live.
    expect(page).toContain("Nothing is on sale yet.");
    expect(page).toMatch(/Not yet: no real-money go-live\./);
    expect(flat("docs/business/model.md")).toContain("Nothing is on sale yet and no customer has seen a price.");
    expect(flat("docs/after-the-kit.md")).toContain("nothing is on sale and no customer has seen a price");
    expect(flat("docs/after-the-kit.md")).toContain("not ready for real money");
    expect(flat("README.md")).toContain("it is not ready for real money");
    // The doc says why the model has this shape, and that it replaced the earlier price.
    expect(flat("docs/business/model.md")).toContain("Why this shape (our reasoning): the unit a finance team counts is the supplier invoice");
    expect(flat("docs/business/model.md")).toContain("This replaces the price of 6 November 2026, which was per agent with Claude decisions included.");
  });

  it("shows the model's own arithmetic in docs/business/model.md and in the claims register, as the generator computes it, with what it leaves out", () => {
    const u = unitEconomics(), f = modelFigures(u), model = flat("docs/business/model.md"), claims = flat("docs/claims.md");
    const row = claims.slice(claims.indexOf("| Unit economics (hypothesis;"), claims.indexOf("| Claude cost per decision |", claims.indexOf("| Unit economics (hypothesis;")));
    expect(row).not.toBe("");
    // The claims row says each scenario as computed: invoices, cost, price, margin.
    expect(row).toContain(`at ${u.scenarios.map((s) => s.invoices).join(", ").replace(/, (\d+)$/, " and $1")} supplier invoices a month costs ${u.scenarios.map((s) => s.costEurText).join(", ").replace(/, (€[\d.]+)$/, " and $1")} against ${u.scenarios.map((s) => s.priceEurText).join(", ").replace(/, (€[\d.]+)$/, " and $1")}, gross margin ${u.scenarios.map((s) => s.marginText).join(", ").replace(/, (\d+%)$/, " and $1")} before the platform costs`);
    expect(row).toContain(`USD ${f.perInvoiceUsd} (${f.e2eCalls} Claude calls for ${f.e2eInvoices} invoices in the end-to-end sandbox run, at the main run's USD ${f.perCallUsd} a call)`);
    expect(row).toContain(`the price before 12 November gave ${f.earlierMargin} at the usage it included`);
    // The doc: the margin range, what is not in it, and the replaced price's own figure, not hidden.
    expect(model).toContain(`Gross margin per company (hypothesis): ${f.marginRange} across low, mid and high usage, before the platform costs (A8).`);
    expect(model).toContain("so the real margin is lower");
    expect(model).toContain(`its own table gave a gross margin of ${f.earlierMargin}`);
    expect(f.earlierMargin).toBe("48%");
  });
});

describe("the fee per payout: one line fits the fixed test fees to the percentage", () => {
  const cents = (eur: string) => Math.round(Number(eur.replace("EUR ", "")) * 100);

  it("takes the ceiling from the paying code and the rate from the CFO's policy rule, as the line says", () => {
    // The ceiling: the paying code's own constant, 1.00% of a payout.
    expect(PRICING.platformFee.capBps).toBe(FEE_BPS_CAP);
    expect(percentOfBps(FEE_BPS_CAP)).toBe("1.00%");
    // The rate: a rule of the CFO's policy (changed only with the CFO's signature), whose choices end at the ceiling.
    expect(PLATFORM_FEE_RULE.key).toBe("platform.fee_bps");
    expect(Math.max(...PLATFORM_FEE_RULE.choices!.map(Number))).toBe(FEE_BPS_CAP);
    expect(read("src/policy/rules.ts")).toContain("changed only through an approved policy_change, with Face ID) and never above FEE_BPS_CAP");
    // Sent to Airwallex as one fixed amount, the amount the CFO signed: which is why the records show fixed fees.
    expect(read("src/airwallex/adapter.ts")).toContain('{ application_fee_options: [{ source_type: "TRANSFER", type: "FIXED", amount: fromCents(f.amountCents), currency: f.currency }] }');
    expect(() => percentOfBps(-1)).toThrow();
  });

  it("reads both test fees from their run records and works out what share of its payout each was", () => {
    const first = feeRun(), second = e2eFeeRun(), facts = feeFacts();
    // The first run (connected accounts): a fixed fee passed straight to the payout code; the record says FIXED.
    const record = read(PRICING.platformFee.runRecord);
    expect(record).toContain(`application_fee_options: [{ source_type: TRANSFER, type: FIXED, amount: "${first.fee.replace("EUR ", "")}", currency: EUR }]`);
    expect([first.fee, first.payout]).toEqual(["EUR 0.05", "EUR 5.00"]);
    expect(cents(first.fee) / cents(first.payout) * 10_000).toBe(100);
    expect(facts.fixed).toEqual({ ...first, percent: "1.00%" });
    // The end-to-end run: the rate came from its test policy (src/e2e/setup.ts sets platform.fee_bps from the module),
    // and the paying code's own rounding gives the fee in the record.
    const e2e = read(PRICING.platformFee.e2eRecord);
    const row = e2e.split("\n").find((l) => /^\| SANDBOXTEST \| `[0-9a-f-]+`, EUR/.test(l))!;
    expect(row).toContain(`${second.payout} | **PAID**`);
    expect(row).toContain(`| ${second.fee}, SETTLED, to `);
    expect([second.fee, second.payout]).toEqual(["EUR 0.02", "EUR 4.84"]);
    expect(E2E_FEE_BPS).toBe(String(PRICING.platformFee.testPolicyBps));
    expect(read("src/e2e/platformRun.ts")).toContain('setSetting(db, "human", "platform.fee_bps", d.feeBps);');
    expect(platformFeeCents(cents(second.payout), PRICING.platformFee.testPolicyBps)).toBe(cents(second.fee));
    expect(facts.policy).toEqual({ ...second, percent: "0.50%" });
    expect(facts.cap).toBe("1.00%");
    // A record or a rate that no longer fits stops the page and the docs' check: the line is never wrong in silence.
    expect(() => feeFacts({ ...first, fee: "EUR 0.06" })).toThrow(/not a whole rate at or under the ceiling/);
    expect(() => feeFacts(first, { ...second, fee: "EUR 0.03" })).toThrow(/is not 0\.50% of EUR 4\.84, rounded to the cent/);
    expect(() => e2eFeeRun("# Another record (1 January 2027)\n")).toThrow(/not in the record/);
  });

  it("is one line, the same words on /pricing (folded in the fee's card), in docs/business/model.md and in docs/after-the-kit.md", () => {
    const line = feeLine();
    expect(line).toBe("The fee is a percentage of each payout: the CFO signs the rate in the policy, and code keeps it at or under 1.00%, rounds it to the cent and sends it to Airwallex as a fixed amount. The two sandbox runs used test values, not prices: EUR 0.05 on EUR 5.00 (1.00%, a fixed test fee set for that run) and EUR 0.02 on EUR 4.84 (the test policy's 0.50%, rounded to the cent).");
    for (const doc of ["docs/business/model.md", "docs/after-the-kit.md"]) expect({ doc, says: flat(doc).split(line).length - 1 }).toEqual({ doc, says: 1 });
    const html = pricingPage();
    const fold = /<details class="fold">[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
    expect(mainText(`<main>${fold}</main>`)).toContain(line);
    // Test values are labelled test values wherever the amounts are said.
    expect(line).toContain("test values, not prices");
    expect(flat("docs/claims.md")).toContain("Test values, not prices: EUR 0.05 on the EUR 5.00 sandbox payout above (1.00%, a fixed test fee set for that run), and EUR 0.02 on the EUR 4.84 payout of the end-to-end run (the test policy's 0.50%, rounded to the cent)");
    // The old wording, which called the test policy's rate a cap, is gone.
    for (const doc of ["docs/after-the-kit.md", "docs/claims.md", "docs/business/model.md", "README.md"]) expect({ doc, old: /\| 0\.50% in the test world, capped|capped in the CFO's policy \(0\.50%/.test(flat(doc)) }).toEqual({ doc, old: false });
  });
});
