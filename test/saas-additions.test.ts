// The jury panel's additions to the product pages (12 Nov).
//
// 1. One pricing model with reconciled numbers. The panel saw EUR 49 a month beside a second, unsettled fee per
//    payment, test fees that did not match the stated percentage, and a 48% margin in the model's own table. Now: one
//    model (src/config/pricing.ts), said in the same sentence on the README, in docs/business/model.md and in
//    docs/after-the-kit.md, with /pricing showing the same figures; one line that fits the two fixed test fees to the
//    percentage, worked out from the run records and the paying code's own figures; and the unit economics restated for
//    that model by its own generator (test/unit-economics-hypothesis.test.ts checks its arithmetic).
// 2. Security answers the buyer's first two questions, and "four eyes" is worded exactly (further down).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { platformFeeCents } from "../src/airwallex/binding.js";
import { FEE_BPS_CAP } from "../src/airwallex/platform.js";
import { figures as modelFigures, unitEconomics } from "../src/business/unitEconomics.js";
import { FOUR_EYES, FOUR_EYES_LINE, FOUR_EYES_NOTE, FOUR_EYES_ON_CHAIN_NOTE, PRICE_LINE, SECOND_APPROVER, WHY_COMPANY } from "../src/config/brand.js";
import { PRICING, PRICING_LABEL, PRICING_LINE, PRICING_STATEMENT, euro, percentOfBps } from "../src/config/pricing.js";
import { E2E_FEE_BPS } from "../src/e2e/setup.js";
import { ENROLMENT_TTL_MS } from "../src/passkey/ledger.js";
import { PLATFORM_FEE_RULE } from "../src/policy/rules.js";
import { GUARANTEES, guaranteesHtml } from "../src/redesign/guarantees.js";
import { PRICING_LEAD, e2eFeeRun, feeFacts, feeLine, feeRun, pricingPage } from "../src/redesign/pricing.js";
import { proofPage } from "../src/redesign/proof.js";
import { OVERVIEW_DOC, UNAVAILABLE, securityCards, securityPage, unavailableLines } from "../src/redesign/security.js";
import { esc } from "../src/redesign/ui.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** A doc as running text: bold and code marks out, white space single, so a sentence wrapped over lines reads as one. */
const flat = (p: string) => read(p).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
// "&amp;" last, so an escaped entity ("&amp;lt;") is decoded once, never twice.
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
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
    expect(PRICING_LEAD).toMatch(/^Pilot prices\. Nothing is on sale yet\.$/);
    expect(page).toContain("Pilot prices. Nothing is on sale yet.");
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

// 2a. "If the approver is unavailable": the buyer's first two questions (what happens when the approver is away or
// loses the phone; who may enrol a new passkey), answered in at most five lines in docs/security.md, shown on /security
// in the doc's own words, and linked from guarantee 1 on /proof. Every line is true of the code as it is: each claim
// is held here against the file it cites.
describe("if the approver is unavailable (the panel's review, 12 Nov)", () => {
  const doc = read("docs/security.md");
  const section = /^## If the approver is unavailable\n\n([\s\S]*?)\n## /m.exec(doc)?.[1] ?? "";
  const lines = section.split("\n").filter((l) => l.trim());
  const html = securityPage();
  const card = /<article class="pc card[^"]*" id="s-sign">[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
  const fold = /<details class="fold" id="unavailable"><summary>([^<]+)<\/summary><ul class="pl">([\s\S]*?)<\/ul><\/details>/.exec(card);

  it("docs/security.md answers both questions in at most five lines, and says plainly what is not built", () => {
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(5);
    for (const l of lines) expect({ l: l.slice(0, 30), numbered: /^\d\. \*\*[^*]+\*\* /.test(l) }).toEqual({ l: l.slice(0, 30), numbered: true });
    const text = section.replace(/\*\*|`/g, "");
    // What happens when the approver is away, or loses the phone.
    expect(text).toContain("Away or out of reach: nothing above the limits is paid. The payment waits for the signature and expires unsigned; payments inside the limits go on");
    expect(text).toContain("A lost phone: the passkey is replaced, not recovered.");
    // Who may enrol a new passkey: on the runner, and in Purser Cloud.
    expect(text).toContain("Who may enrol a new passkey, on the runner: only the person at the runner");
    // 12 Nov (review): the route needs only the admin scope, so an admin key may start a person's enrolment too;
    // an owner's passkey, once any owner has one, only a signed-in owner (cloud/src/auth.ts startEnrolment).
    expect(text).toContain("Who may enrol, in Purser Cloud (built, not live): a signed-in owner or an API key with the admin scope starts a person's enrolment; an owner's passkey, once any owner has one, only a signed-in owner.");
    // Not built, said so: no deputy, no delegation. And the runs had one person.
    expect(text).toContain("No deputy, no delegation: neither is built.");
    expect(text).toContain("Our runs had one person: the second signature came from a test passkey.");
    // No gendered pronoun for the approver, and nothing absolute.
    expect(text).not.toMatch(/\b(he|she|his|her|him)\b/i);
    expect(text).not.toMatch(/\b(always|never fails|guarantee|cannot be)\b/i);
  });

  it("is true of the code it cites: waiting and expiry, four eyes, replacing a passkey, who opens an enrolment", () => {
    // Every file and command the section names exists.
    const cited = [...section.matchAll(/`((?:src|docs)\/[\w/.-]+)`/g)].map((m) => m[1]!);
    expect(cited).toEqual(["src/policy/approvals.ts", "src/policy/fourEyes.ts", "src/passkey/ledger.ts", "docs/cloud.md"]);
    for (const f of cited) expect({ f, exists: existsSync(new URL(`../${f}`, import.meta.url)) }).toEqual({ f, exists: true });
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect([scripts.relay, scripts.passkey]).toEqual(["tsx src/cli/relay.ts", "tsx src/cli/passkey.ts"]);
    // 1. A proposal waits for approval and expires unsigned; only an approved one is paid.
    const approvals = read("src/policy/approvals.ts");
    expect(approvals).toContain('PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "SUPERSEDED", "NEEDS_REAPPROVAL"]');
    expect(approvals).toContain('transition(db, p.proposal_id, p.status, "EXPIRED");');
    expect(approvals).toContain("expired at ${expired}; approval void");
    // 2. No deputy and no delegation in the approval, passkey or cloud code; a second person has a passkey of their own,
    //    and where four eyes applies one person's signature only counts toward two.
    for (const f of ["src/policy/approvals.ts", "src/policy/fourEyes.ts", "src/passkey/ledger.ts", "src/passkey/process.ts", "src/cli/passkey.ts", "cloud/src/auth.ts", "cloud/src/app.ts"]) expect({ f, deputy: /deput|delegat|stand[- ]in approver|out of office/i.test(read(f)) }).toEqual({ f, deputy: false });
    expect(read("src/cli/passkey.ts")).toContain('if (cmd === "add")');
    expect(read("src/passkey/ledger.ts")).toContain("// E1: another person beside those enrolled, each with a passkey of their own.");
    expect(approvals).toContain("a second person must approve it with their own passkey");
    expect(read("src/passkey/process.ts")).toContain('if (pk.status !== "ACTIVE") return refuse("revoked_passkey"');
    // 3. A replaced passkey counts until the new one is confirmed, and is revoked then.
    const ledger = read("src/passkey/ledger.ts");
    expect(ledger).toContain("the old passkey stays active until the new one is enrolled");
    expect(ledger).toContain("The person on the runner confirms the fingerprint the phone shows; only then is the passkey pinned (and a passkey");
    expect(ledger).toContain("UPDATE passkeys SET status = 'REVOKED' WHERE credential_id = ?");
    // 4. On the runner: a ten-minute window with a one-time code, opened and confirmed from the runner's own commands.
    expect(ENROLMENT_TTL_MS).toBe(10 * 60 * 1000);
    expect(read("src/cli/relay.ts")).toContain("//   --enrol    opens a ten-minute window and prints a one-time code for enrolling the approver's passkey");
    expect(read("src/cli/relay.ts")).toContain("//   --replace  with --enrol: the new passkey replaces the enrolled one once it is enrolled");
    expect(read("src/cli/passkey.ts")).toContain('if (cmd === "confirm")');
    // 5. In Purser Cloud, as its doc says it: the route needs the admin scope (a signed-in owner, or a key with it);
    //    an owner's passkey, once any owner has one, only a signed-in owner.
    expect(read("cloud/src/app.ts")).toMatch(/path: "\/v1\/users\/\{id\}\/enrolment", [^\n]*need: "admin"/);
    expect(read("cloud/src/auth.ts")).toContain(`if (ownerPasskeys > 0 && !(caller.kind === "session" && caller.role === "owner")) throw new AuthError(403, "only a signed-in owner may enrol an owner's passkey");`);
    const cloud = flat("docs/cloud.md");
    expect(cloud).toContain("| POST /v1/users/{id}/enrolment | admin | Start a person's passkey enrolment: a single-use secret for 30 minutes (an owner's passkey: a signed-in owner only, once any owner has one). |");
    expect(cloud).toContain("| POST /v1/admin/tenants/{id}/recovery | platform admin | An owner lost their passkey: after checking out of band who asks (checked_by says how), issue a one-time recovery key for that owner");
    expect(cloud).toContain("Redeemed, it removes the owner's old passkeys, ends their sessions and is spent, in the same write as the new passkey.");
    // "Built, not live": the hosted preview is private and no customer uses it.
    expect(flat("docs/after-the-kit.md")).toContain("A hosted preview exists but is private (behind an access key); no customer uses it");
  });

  it("/security gives the same answer, in the doc's own lines, folded under the signature with the anchor \"unavailable\"", () => {
    expect(UNAVAILABLE).toEqual({ id: "unavailable", doc: "docs/security.md", heading: "If the approver is unavailable", anchor: "#if-the-approver-is-unavailable" });
    expect(doc).toMatch(/^## If the approver is unavailable$/m);
    // The page's lines are the doc's lines: at most five, in the doc's order and words, bold and code marks out, and
    // without the files and commands each line names in brackets at its end (the doc keeps those; the page links it).
    const plain = lines.map((l) => l.replace(/^\d\. /, "").replace(/ \(`[^\n]*\)$/, "").replace(/\*\*|`/g, ""));
    expect(unavailableLines()).toEqual(plain);
    for (const l of plain) {
      expect({ l: l.slice(0, 30), inDoc: flat("docs/security.md").includes(l), ends: /[.]$/.test(l), code: /src\/|npm run|POST \//.test(l) }).toEqual({ l: l.slice(0, 30), inDoc: true, ends: true, code: false });
    }
    expect(plain[0]).toBe("Away or out of reach: nothing above the limits is paid. The payment waits for the signature and expires unsigned; payments inside the limits go on.");
    expect(fold).not.toBeNull();
    expect(fold![1]).toBe("If the approver is unavailable");
    // Compared as the page's markup, exactly: each line is the doc's line escaped as the page escapes it, then the link.
    const items = [...fold![2]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
    expect(items.slice(0, -1)).toEqual(plain.map(esc));
    expect(items.at(-1)).toMatch(/^<a class="pf" href="[^"]+docs\/security\.md#if-the-approver-is-unavailable"[^>]*>docs\/security\.md ↗<\/a>$/);
    expect(items.length - 1).toBeLessThanOrEqual(5);
    expect(fold![2]).toContain('<a class="pf" href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security.md#if-the-approver-is-unavailable" target="_blank" rel="noopener">docs/security.md ↗</a>');
    // Folded: in sight it is five words under the signature's card, and one anchor on the page.
    expect((html.match(/id="unavailable"/g) ?? []).length).toBe(1);
    expect(securityCards().find((c) => c.more)!.id).toBe("s-sign");
    // A section that grows past five lines, or loses its numbering, stops the page: never a longer or a looser answer.
    expect(() => unavailableLines(doc.replace("\n## Accepted risks", "\n6. **And more:** a sixth line.\n\n## Accepted risks"))).toThrow(/one to five numbered lines/);
    expect(doc).toContain("5. **Who may enrol, in Purser Cloud");
    expect(() => unavailableLines(doc.replace("5. **Who may enrol, in Purser Cloud", "**Who may enrol, in Purser Cloud"))).toThrow(/one to five numbered lines/);
    expect(() => unavailableLines("# Security\n\n## Checks\n")).toThrow(/one to five numbered lines/);
    // A line that no longer names what it rests on stops the page too.
    expect(() => unavailableLines(doc.replace(" (`src/passkey/ledger.ts`)", ""))).toThrow(/each ending with the files it cites/);
  });

  it("guarantee 1 on /proof links there, folded with its \"How\"; the link resolves on the site", () => {
    const g = GUARANTEES[0]!;
    expect([g.id, g.more]).toEqual(["g-terms", { label: "If the approver is unavailable", href: "security#unavailable" }]);
    expect(GUARANTEES.filter((x) => x.more).map((x) => x.id)).toEqual(["g-terms"]);
    const li = /<li id="g-terms"[\s\S]*?<\/li>/.exec(proofPage())?.[0] ?? "";
    // Inside the fold, after how it works and before the file and the test: nothing new in sight on /proof.
    expect(li).toMatch(/<details><summary>How<\/summary><p>[^<]+<\/p><p><a href="security#unavailable">If the approver is unavailable<\/a><\/p><p class="src">/);
    expect(li.replace(/<details>[\s\S]*?<\/details>/, "")).not.toContain("unavailable");
    expect(guaranteesHtml()).toContain('<a href="security#unavailable">If the approver is unavailable</a>');
    // The page it leads to is served, and carries the anchor.
    const pages = buildPages() as Pages;
    expect(pageResponse(new Request("https://x.test/security"), pages)?.status).toBe(200);
    expect(pages.security).toContain('<details class="fold" id="unavailable">');
  });
});

// 2b. "Four eyes", worded exactly. The four-eyes proof had one person: the second signature came from a test passkey.
// So wherever the short form says what ran, it carries the note, in these words, until a run with two people exists:
// "four eyes (the second signature from a test passkey, not a second person)". The separate on-chain run of 30 October
// had two test keys on one machine, so its short form says that instead (a test passkey would not be true of it).
describe("four eyes, worded exactly (the panel's review, 12 Nov)", () => {
  /**
   * A doc as its units of meaning: paragraphs, list items and table cells, each as running text (link targets out).
   * `row` is the table row a cell is in: a short cell is a row's label, and the row says what it means.
   */
  const units = (md: string) => md.split(/\n\s*\n|\n(?=\s*[-*] |\s*\d+\. |\|)/).flatMap((block) => {
    const text = block.replace(/\]\([^)]*\)/g, "]").replace(/\s+/g, " ").trim();
    if (!text.startsWith("|")) return text ? [{ text, row: text }] : [];
    return text.split("|").map((cell) => cell.trim()).filter(Boolean).map((cell) => ({ text: cell, row: text }));
  });
  /** The sentence a mention is in, and the next one. */
  const around = (unit: string, at: number) => {
    const ends = [...unit.matchAll(/[.!?;](?=\s+["“(*`[]?[A-Z0-9])/g)].map((m) => m.index + 1);
    const from = [0, ...ends].filter((e) => e <= at).at(-1)!, after = ends.filter((e) => e > at);
    return unit.slice(from, after[1] ?? unit.length);
  };
  /** Who signed, said: the note itself, the on-chain run's own, or the earlier wording that names the test passkey. */
  const NOTED = new RegExp(`${FOUR_EYES_NOTE}|${FOUR_EYES_ON_CHAIN_NOTE}|came from a test passkey, not a second person|labelled (?:virtual )?test passkey|a test passkey, not`);
  /**
   * Not a claim about what ran, so no note: the control as it works (two people, a threshold, on or off), a plan, a
   * name (the four-eyes run, world, rule, test or file), or the glossary's own heading.
   */
  const NOT_A_RUN = new RegExp([
    // How the control works: who must sign, and when it applies.
    "two (?:different )?people", "a second person", "second person's", "both (?:passkeys|signatures|owners|must)", "two approvers", "four[- ]eyes threshold", "four eyes above", "four eyes at any amount", "toward four eyes",
    "four eyes (?:is|are) (?:on|off|built|tested)", "four eyes (?:on|off) ", "with four eyes", "(?:when|once|turning) four eyes", "optional four eyes", "Four eyes off chain",
    // A plan, not a run.
    "four eyes (?:by|as the) default", "second human approver for four eyes",
    // Names: the four-eyes run, world, rule, check and test, their files and command, a link's own name.
    "four[- ]eyes (?:rule|run|world|check|approval|test)", "four-eyes and compliance runs", "four-eyes(?:-onchain)?\\.(?:md|test|json)", "npm run four-eyes", "cfo-policy\\.md, four eyes",
    // The glossary's heading, the list of what was built, a requirement's own text, a line kept off the site, a row's name.
    "Mandate, x402, terms hash, four eyes", "the video, four eyes, the open items", "four eyes\\), the agents' tools", "Four eyes on chain: a Metal account with several owners", ", four eyes on chain, limits enforced", "\"Four eyes on the mandate change\"",
  ].join("|"), "i");

  /** The places a reader meets the short form: the README, llms.txt, the current docs and the submission texts. Run records and design specs are history. */
  const PLACES = ["README.md", "llms.txt", "docs/security.md", "docs/claims.md", OVERVIEW_DOC, "docs/after-the-kit.md", "docs/idea-vs-build.md", "docs/requirements-matrix.md", "docs/controls.md", "docs/controls-matrix.md", "docs/compliance.md",
    "docs/metal-award.md", "docs/cfo-policy.md", "docs/architecture.md", "docs/business/model.md", "docs/business/problem.md", "docs/business/roadmap.md",
    "docs/submission/README.md", "docs/submission/demo-day.md", "docs/submission/long-description.md", "docs/submission/pitch.md", "docs/submission/qa.md",
    "docs/submission/release-notes.md"];

  it("has the note in one place, in these words", () => {
    expect(FOUR_EYES_NOTE).toBe("the second signature from a test passkey, not a second person");
    expect(FOUR_EYES).toBe("four eyes (the second signature from a test passkey, not a second person)");
    expect(FOUR_EYES_ON_CHAIN_NOTE).toBe("two test keys on one machine, not two people");
    expect(FOUR_EYES_LINE).toBe("Four eyes on chain: two signatures required (the second signature from a test passkey, not a second person)");
    // What the records say, so the two notes are true: the main run's second approver was a labelled test passkey, and
    // in the on-chain run of 30 October both keys sat on one machine.
    expect(SECOND_APPROVER).toBe("Second approver: a labelled test passkey in this demo. In production this is a second person.");
    expect(read("docs/runs/2026-10-30-four-eyes.md")).toContain("**The two keys sat on one machine here.**");
    expect(read("docs/runs/2026-10-30-four-eyes.md")).toContain("Its keys are test keys (sponsor for gas, CFO, controller, a");
  });

  it("carries the note wherever the short form says what ran: the README, llms.txt, the docs and the submission texts", () => {
    const bare: string[] = [];
    let mentions = 0;
    for (const place of PLACES) {
      for (const unit of units(read(place).replace(/\*\*|`/g, ""))) {
        for (const m of unit.text.matchAll(/four[- ]eyes/gi)) {
          mentions += 1;
          // The mention's own sentence and the next one; for a short cell (a row's label), the row it names.
          const near = unit.text.length <= 80 ? unit.row : around(unit.text, m.index);
          if (!NOTED.test(near) && !NOT_A_RUN.test(near)) bare.push(`${place}: …${unit.text.slice(Math.max(0, m.index - 70), m.index + 90)}…`);
        }
      }
    }
    expect(bare).toEqual([]);
    expect(mentions).toBeGreaterThan(40);
    // The check catches a bare mention: the README's sentence as it stood before 12 November.
    const before = "The CFO signed A; after four eyes, both mandates were replaced on chain: Treasury 0x789a (11:26:54).";
    expect(NOTED.test(around(before, before.indexOf("four eyes"))) || NOT_A_RUN.test(around(before, before.indexOf("four eyes")))).toBe(false);
    const now = before.replace("four eyes", FOUR_EYES);
    expect(NOTED.test(around(now, now.indexOf("four eyes")))).toBe(true);
  });

  it("says it in these words where this work changed a sentence", () => {
    // The main run's mandate change (P-0002): the exact short form.
    expect(flat("README.md")).toContain(`The CFO signed A; after ${FOUR_EYES}, both mandates were replaced on chain`);
    expect(flat("README.md")).toContain("in the main run the second signature came from a test passkey, not a second person); the proposer never approves.");
    expect(flat("docs/requirements-matrix.md")).toContain(`Treasury's options 40 s later; ${FOUR_EYES}, then the mandates replaced (P-0002);`);
    expect(flat("docs/submission/demo-day.md")).toContain(`Treasury proposes options 40 s later; ${FOUR_EYES} |`);
    expect(flat("docs/idea-vs-build.md")).toContain(`Four eyes ran in the main run (P-0002; ${FOUR_EYES_NOTE});`);
    expect(flat("docs/claims.md")).toContain(`"${FOUR_EYES_LINE}" (FOUR_EYES_LINE; the short form everywhere is "${FOUR_EYES}", FOUR_EYES in src/config/brand.ts`);
    expect(flat("docs/security.md")).toContain("Our runs had one person: the second signature came from a test passkey.");
    // The on-chain run of 30 October: its own note.
    for (const [doc, said] of [
      ["README.md", `four eyes on chain (${FOUR_EYES_ON_CHAIN_NOTE}), the compliance contract`],
      ["docs/claims.md", `In a separate test world, with ${FOUR_EYES_ON_CHAIN_NOTE}; Northwind's recorded account is one-owner`],
      ["docs/claims.md", `| Four eyes on chain (2-of-2 account; ${FOUR_EYES_ON_CHAIN_NOTE}) |`],
      ["docs/claims.md", `| Four eyes on chain (30 Oct; ${FOUR_EYES_ON_CHAIN_NOTE}), passkeys as owners`],
      ["docs/controls-matrix.md", `the CFO and the controller together passed (${FOUR_EYES_ON_CHAIN_NOTE}) |`],
      ["docs/compliance.md", `30 October, with ${FOUR_EYES_ON_CHAIN_NOTE}; Northwind's recorded account has one owner`],
      ["docs/requirements-matrix.md", `two passed (${FOUR_EYES_ON_CHAIN_NOTE}).`],
      ["docs/submission/long-description.md", `Four eyes on chain. A 2-of-2 Metal account: the CFO and a controller (${FOUR_EYES_ON_CHAIN_NOTE}).`],
      ["docs/metal-award.md", `Four eyes on chain (run log; ${FOUR_EYES_ON_CHAIN_NOTE}).`],
    ] as const) expect({ doc, said, found: flat(doc).replace(/\]\([^)]*\)/g, "").replace(/\[/g, "").includes(said) }).toEqual({ doc, said, found: true });
  });

  it("carries it on the site: on /metal where the on-chain run is named, and in every page's \"What's real?\" lines", () => {
    const pages = buildPages() as unknown as Record<string, string>;
    const text = (html: string) => decode(html.replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, " ").replace(/<svg\b[\s\S]*?<\/svg[^>]*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    // /metal, folded under "Beyond the kit": the on-chain run with who signed (no words added in sight).
    expect(text(pages.metal!)).toContain(`Four eyes on chain : 1 signature: reverted (${FOUR_EYES_ON_CHAIN_NOTE}).`);
    expect(pages.metal).toMatch(/<details[^>]*>\s*<summary[^>]*>Beyond the kit: separate runs, each dated \(not the main run\)<\/summary>[\s\S]*?two test keys on one machine, not two people/);
    // Every page built on the site's frame says who the second approver was, in its "What's real?" lines.
    for (const name of ["home", "watch", "proof", "metal", "airwallex", "visa", "claude", "trace", "runs"]) expect({ name, says: text(pages[name]!).includes(SECOND_APPROVER) }).toEqual({ name, says: true });
    // On the public pages a reader reaches, every "four eyes" in the text is the on-chain run with its note, a name or
    // the control as it works; /pricing's "Four-eyes approval" is a feature of the Business plan, not a claim.
    const bare: string[] = [];
    for (const name of ["home", "watch", "proof", "pricing", "security", "metal", "airwallex", "visa", "claude", "trace", "runs", "notFound"]) {
      const t = text(pages[name]!);
      for (const m of t.matchAll(/four[- ]eyes/gi)) {
        const near = t.slice(Math.max(0, m.index - 160), m.index + 200);
        if (!NOTED.test(near) && !NOT_A_RUN.test(near) && !/Four-eyes approval|Four eyes on chain: Smart account/.test(near)) bare.push(`${name}: …${t.slice(Math.max(0, m.index - 60), m.index + 80)}…`);
      }
    }
    expect(bare).toEqual([]);
  });
});
