// "The CFO's policy next to Visa's VIC rules" on /visa (12 Nov): a small, sourced table, folded under the two Airi runs.
// Left, Purser's own rule with its values read from the run records and the code's constants, and where it is enforced
// (a source file and a test that exist; a run's block on the page where it ran). Right, Visa's published rule for Visa
// Intelligent Commerce (v2), in Visa's own words, each quote from one page of developer.visa.com read on 12 Nov 2026.
// It is a comparison with Visa's documentation: no code here calls or imitates Visa's API, and the block says so.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AIRI_HARD_CAP_CENTS, type AiriPolicy } from "../src/airi/policy.js";
import { AIRI_TERMS_TTL_MS, airiTerms, decideAiriPurchase } from "../src/airi/purchase.js";
import { fromCents } from "../src/lib/money.js";
import { airiRun } from "../src/redesign/airiRun.js";
import { visaPage } from "../src/redesign/partners.js";
import { vic2Run } from "../src/redesign/vic2Run.js";
import { VIC_DOCS, VIC_RULES_ID, VIC_RULES_SUMMARY, vicRules, vicRulesHtml } from "../src/redesign/vicRules.js";

const run = airiRun()!, controls = vic2Run()!;
const rows = vicRules(run, controls);
const html = visaPage();
const block = new RegExp(`<details class="fold" id="${VIC_RULES_ID}">[\\s\\S]*?</details>`).exec(html)?.[0] ?? "";
const text = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const root = (p: string) => new URL(`../${p}`, import.meta.url);
const buy = (s: string) => run.purchases.find((p) => p.step === s)!;

describe("the CFO's policy next to Visa's VIC rules", () => {
  it("is one folded row on /visa, under the Airi runs and above the TAP section, closed until opened", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/<details[^>]* open/);
    expect(text(/<summary>([\s\S]*?)<\/summary>/.exec(block)![1]!)).toBe(VIC_RULES_SUMMARY);
    expect(VIC_RULES_SUMMARY).toBe("The CFO's policy next to Visa's VIC rules");
    expect(html.indexOf(`id="${VIC_RULES_ID}"`)).toBeGreaterThan(html.indexOf('id="airi-run-2"'));
    expect(html.indexOf(`id="${VIC_RULES_ID}"`)).toBeLessThan(html.indexOf('id="visa-tap"'));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.length).toBeLessThanOrEqual(6);
    for (const r of rows) for (const cell of [r.topic, r.purser, r.visa]) expect(text(block)).toContain(cell);
  });

  it("reads every value on Purser's side from the run records and the code, never typed", () => {
    const by = Object.fromEntries(rows.map((r) => [r.topic, r]));
    const cur = buy("B").currency, limit = `${cur} ${run.policy.alone_max_eur}`, cap = `${cur} ${fromCents(AIRI_HARD_CAP_CENTS)}`;
    expect(by.Amount!.purser).toBe(`Up to ${limit} with no Purser approval. Above it the CFO signs the exact amount with Face ID. Never above ${cap}.`);
    expect(by.Amount!.ran).toEqual({ text: `Ran: purchase B, ${buy("B").proposal_id}`, anchor: "airi-run" });
    expect(by.Merchant!.ran).toEqual({ text: `Ran: purchase C, ${buy("C").code}, ${buy("C").airi_calls} Airi calls`, anchor: "airi-run" });
    expect(by["How long an approval lasts"]!.purser).toBe(`An approval lapses after ${AIRI_TERMS_TTL_MS / 60_000} minutes.`);
    const ch = controls.steps.D.alteration.changed.amount, c2 = controls.steps.D.request.currency;
    expect(by["A change after approval"]!.ran).toEqual({ text: `Ran: the control test, ${c2} ${ch.from} changed to ${c2} ${ch.to}, refused`, anchor: "airi-run-2" });
    expect(controls.steps.D.executor.refused).toMatch(/terms do not match the approved hash/);
    expect(by["Total spend"]!.purser).toBe(`One approval covers one purchase. Without Face ID, at most ${run.policy.alone_per_day} purchases a day.`);
    // The policy really works that way: the same figures decide a purchase in code.
    const policy: AiriPolicy = { aloneMaxCents: Number(run.policy.alone_max_eur) * 100, alonePerDay: run.policy.alone_per_day, hardCapCents: AIRI_HARD_CAP_CENTS, currencies: [cur], merchants: ["https://shop.test"] };
    const req = (amount: string) => ({ agent: "sourcing" as const, paymentMethodId: "pm", merchantName: "Shop", merchantUrl: "https://shop.test/", merchantCountry: "NL", amount, currency: cur, items: [{ name: "x", unitPrice: amount, quantity: "1" }], description: "d" });
    expect(decideAiriPurchase(policy, req(run.policy.alone_max_eur))).toEqual({ route: "alone" });
    expect(decideAiriPurchase(policy, req(buy("B").amount))).toMatchObject({ route: "cfo" });
    expect(decideAiriPurchase(policy, req(fromCents(AIRI_HARD_CAP_CENTS + 1)))).toMatchObject({ route: "refused", code: "PURSER_ABOVE_HARD_CAP" });
    expect(decideAiriPurchase(policy, req(run.policy.alone_max_eur), run.policy.alone_per_day)).toMatchObject({ route: "cfo" });
    expect(decideAiriPurchase({ ...policy, merchants: [] }, req("1.00"))).toMatchObject({ route: "refused", code: buy("C").code });
    // Without the controls run's record the row stays, without a run it did not have.
    expect(vicRules(run, null).find((r) => r.topic === "A change after approval")!.ran).toBeUndefined();
  });

  it("has, in the terms the CFO signs, a field for each field of a VIC mandate that Visa documents", () => {
    const terms = airiTerms({ agent: "sourcing", paymentMethodId: "pm", merchantName: "Shop", merchantUrl: "https://shop.test/", merchantCountry: "NL", amount: "45.00", currency: "EUR", items: [{ name: "x", unitPrice: "45.00", quantity: "1" }], description: "d" }, "P-0001", "2026-11-07T10:30:00Z") as Record<string, unknown>;
    // declineThreshold { amount, currency } ↔ amount, currency; effectiveUntilTime ↔ expires_at; preferred merchant name ↔ merchant.name.
    const fields = Object.fromEntries(rows.flatMap((r) => r.mandate.map((m) => [m.visa, m.purser])));
    expect(fields).toEqual({ declineThreshold: "amount, currency", effectiveUntilTime: "expires_at", "preferred merchant name": "merchant.name" });
    expect(terms).toMatchObject({ amount: "45.00", currency: "EUR", expires_at: "2026-11-07T10:30:00Z", merchant: { name: "Shop" } });
  });

  it("names where each rule is enforced: a source file and a test that exist, and a run's block that is on the page", () => {
    const tests = new Set(readdirSync(root("test")));
    for (const r of rows) {
      expect({ topic: r.topic, src: existsSync(root(r.source)), test: tests.has(r.test.replace(/^test\//, "")) }).toEqual({ topic: r.topic, src: true, test: true });
      if (r.ran) expect({ topic: r.topic, anchor: html.includes(`id="${r.ran.anchor}"`), link: block.includes(`href="#${r.ran.anchor}"`) }).toEqual({ topic: r.topic, anchor: true, link: true });
      expect(block).toContain(`https://github.com/agamemnon-coder/x402-business-agents/blob/main/${r.source}`);
    }
  });

  it("gives Visa's rule in Visa's own words, each from the one page of developer.visa.com that was read", () => {
    expect(VIC_DOCS).toEqual({ url: "https://developer.visa.com/docs/visa-intelligent-commerce/concepts", title: "Visa Intelligent Commerce: Concepts", read: "2026-11-12" });
    expect(block).toContain(`href="${VIC_DOCS.url}" target="_blank" rel="noopener"`);
    expect(text(block)).toContain("read 12 Nov 2026");
    // The only outside link in the block besides the repository is that page.
    for (const m of block.matchAll(/href="(https?:[^"]+)"/g)) expect(m[1]!.startsWith(VIC_DOCS.url) || m[1]!.startsWith("https://github.com/agamemnon-coder/x402-business-agents/")).toBe(true);
    for (const r of rows) {
      expect(["Foundations", "Purchase types", "Lifecycles", "Controls and rules"]).toContain(r.section);
      expect(r.quotes.length).toBeGreaterThan(0);
      for (const q of r.quotes) { expect(q.length).toBeLessThanOrEqual(160); expect(text(block)).toContain(`“${q}”`); }
    }
    // The quotes, word for word as read on 12 Nov 2026 (the page and its raw .md, two fetches).
    expect(rows.flatMap((r) => r.quotes)).toEqual([
      "the transactionAmount alone does not exceed the mandate's declineThreshold",
      "the transaction's merchant name matches any preferred merchant name set on that mandate",
      "Instructions default to a 30-day (US) intent expiration.",
      "There is no endpoint to modify an existing instruction or mandate.",
      "it sums all transactions and mandates on the instructionId (including prior transactions) and confirms the total does not exceed the decline threshold",
      "cardholder authorizes a specific transaction",
      "Agent, within approved bounds",
    ]);
  });

  it("is a comparison, not a VIC implementation: it says so, says whose checks these are, and claims no approval by Visa", () => {
    const t = text(block);
    expect(t).toContain("A comparison with Visa's published rules, not an implementation of them: Purser does not call Visa's API.");
    expect(t).toContain("The checks on the left are Purser's own. Whether Airi or Visa enforce the rules on the right for this credential was not tested.");
    expect(t).not.toMatch(/certif|endorse|approved by Visa|Visa-approved|complian|emulat|conform/i);
    expect(t).not.toMatch(/\bTAP\b/);
    // No code path here talks to Visa: the module imports no client and names no Visa API path.
    const src = readFileSync(root("src/redesign/vicRules.ts"), "utf8");
    expect(src).not.toMatch(/fetch\(|\/vacp\/|api\.visa\.com|sandbox\.api\.visa/);
    expect(vicRulesHtml([])).toBe("");
  });

  it("is said in docs/claims.md with the same figures and the same source", () => {
    const row = readFileSync(root("docs/claims.md"), "utf8").split("\n").find((l) => l.startsWith("| \"The CFO's policy next to Visa's VIC rules\""))!;
    const cur = buy("B").currency, ch = controls.steps.D.alteration.changed.amount;
    for (const said of [`up to ${cur} ${run.policy.alone_max_eur} with no Purser approval`, `never above ${cur} ${fromCents(AIRI_HARD_CAP_CENTS)}`, `purchase B, ${buy("B").proposal_id}`, `\`${buy("C").code}\`, ${buy("C").airi_calls} Airi calls`,
      `lapses after ${AIRI_TERMS_TTL_MS / 60_000} minutes`, `${cur} ${ch.from} changed to ${cur} ${ch.to}`, `at most ${run.policy.alone_per_day} purchases a day`, VIC_DOCS.url, `a comparison table of ${["no", "one", "two", "three", "four", "five", "six"][rows.length]} rules`,
      "There is no endpoint to modify an existing instruction or mandate."]) expect({ said, in: row.includes(said) }).toEqual({ said, in: true });
  });

  it("has no number that is not a record's, a constant's or inside one of Visa's quotes", () => {
    const quotes = rows.flatMap((r) => r.quotes);
    let t = text(block);
    for (const q of quotes) t = t.split(`“${q}”`).join(" ");
    t = t.replace(/P-\d{4}/g, " ").replace(/read \d{1,2} \w{3} \d{4}/, " ").replace(/\(v2\)/g, " ").replace(/3-D Secure/g, " ");
    const allowed = new Set([run.policy.alone_max_eur, fromCents(AIRI_HARD_CAP_CENTS), String(AIRI_TERMS_TTL_MS / 60_000), String(run.policy.alone_per_day), String(buy("C").airi_calls), controls.steps.D.alteration.changed.amount.from, controls.steps.D.alteration.changed.amount.to]);
    expect((t.match(/\d+(?:\.\d+)*/g) ?? []).filter((x) => !allowed.has(x))).toEqual([]);
  });
});
