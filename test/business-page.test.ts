// /business, "For companies", and /one-pager (21 Nov; Max: "commercially strong", without inventing anything): the
// calculator's arithmetic is the same in the page as built and in the browser, every price is the price list's, the
// result is labelled the visitor's own estimate, no customer, saving, quote, competitor or endorsement is claimed, and
// both pages are served under a policy of their own hashes with one script that parses no markup.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL } from "../src/config/brand.js";
import { PRICING, PRICING_LINE, euro } from "../src/config/pricing.js";
import { BUSINESS_PAGE, BUSINESS_CSP, ONE_PAGER_CSP, ONE_PAGER_PAGE } from "../src/servers/dashboard.js";
import { FIRST_TARGET, FIRST_TARGET_NOTE, PILOT_AGREEMENT, CALC_DEFAULTS, CALC_JS, CALC_NOTE, FOUNDING_CTA, FOUNDING_NAME, FOUNDING_TERMS, FOUNDING_TEXT, GO_LIVE_DOC, PILOT_MAIL, POSITION, PRINT_JS, calc, calcEuro, calcHours, faqs, type CalcIn } from "../src/redesign/business.js";
import { FEE_BPS_CAP } from "../src/airwallex/platform.js";
import { existsSync } from "node:fs";
import { repoHref } from "../src/redesign/productPage.js";
import { START_STEPS } from "../src/redesign/home.js";
import { residency } from "../src/redesign/privacy.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { moreLinks, footerLinks } from "../src/ui/more.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const text = (html: string) => html.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const main = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];

/** The browser's calc, run as the page runs it (no document: it only defines itself). */
function browserCalc(): { calc: (i: CalcIn) => Record<string, number>; eur: (x: number) => string; hrs: (x: number) => string } {
  const sandbox: Record<string, unknown> = { document: { getElementById: () => null }, isFinite, Math };
  sandbox.globalThis = sandbox;
  runInNewContext(CALC_JS, sandbox);
  return sandbox.__purserCalc as ReturnType<typeof browserCalc>;
}

describe("the calculator", () => {
  const js = browserCalc();
  const cases: CalcIn[] = [
    CALC_DEFAULTS,
    { ...CALC_DEFAULTS, invoices: 400, atRisk: 20000 },
    { invoices: 37.5, minutes: 7, hourly: 62, share: 80, atRisk: 1500, caught: 25 },
    { invoices: 0, minutes: 0, hourly: 0, share: 0, atRisk: 0, caught: 0 },
    { invoices: -5, minutes: 9999, hourly: Number.NaN, share: 150, atRisk: 1e12, caught: -1 },
  ];

  it("works out the same in the page as built and in the browser, prices read from the price list", () => {
    for (const i of cases) {
      const a = calc(i), b = js.calc(i);
      for (const k of Object.keys(a) as (keyof typeof a)[]) expect({ i, k, v: b[k] }).toEqual({ i, k, v: expect.closeTo(a[k], 9) });
      expect(js.eur(a.year)).toBe(calcEuro(a.year));
      expect(js.hrs(a.hours)).toBe(calcHours(a.hours));
    }
    // Starter: its monthly price for the included invoices, then each extra one (src/config/pricing.ts).
    const { monthlyCents, invoicesIncluded, extraInvoiceCents } = PRICING.starter;
    expect(calc({ ...CALC_DEFAULTS, invoices: invoicesIncluded }).price).toBe(monthlyCents / 100);
    expect(calc({ ...CALC_DEFAULTS, invoices: invoicesIncluded + 300 }).price).toBe((monthlyCents + 300 * extraInvoiceCents) / 100);
    expect(calcEuro(-12.4)).toBe("−€12");
  });

  it("shows the defaults' result as built, labels every input the visitor's and the result an estimate", () => {
    const o = calc(CALC_DEFAULTS);
    for (const [id, v] of [["o-hours", calcHours(o.hours)], ["o-price", calcEuro(o.price)], ["o-year", calcEuro(o.year)]]) expect(BUSINESS_PAGE).toContain(`<dd id="${id}">${v}</dd>`);
    const t = text(main(BUSINESS_PAGE));
    expect(t).toContain(CALC_NOTE);
    expect(t).toContain("Your numbers (example inputs; replace them)");
    // Max, 21 Nov: a scenario with the visitor's inputs, never a proven saving; all six inputs editable.
    expect(CALC_NOTE.startsWith("Scenario with your inputs, not a measured saving.")).toBe(true);
    expect(t).toContain("Scenario for a year");
    expect(t).not.toMatch(/your estimate|proven saving|you will save/i);
    expect(BUSINESS_PAGE.match(/<input id="c-[a-z]+" name="[a-zA-Z]+" type="number"/g)).toHaveLength(6);
    expect(BUSINESS_PAGE).not.toMatch(/<input[^>]*\b(readonly|disabled)\b/);
    expect(t).toContain("(your guess)");
    expect(t).toContain("Without the fee per payout, which has no rate set.");
    // No money lost is assumed for the visitor: the default is nothing.
    expect(CALC_DEFAULTS.atRisk).toBe(0);
  });
});

describe("what the pages claim", () => {
  const pages = [["business", BUSINESS_PAGE], ["onePager", ONE_PAGER_PAGE]] as const;

  it("names only the price list's prices, as pilot prices, with nothing on sale", () => {
    const allowed = new Set([euro(PRICING.starter.monthlyCents), euro(PRICING.starter.extraInvoiceCents), euro(PRICING.business.fromMonthlyCents)]);
    for (const [name, html] of pages) {
      // Every euro figure outside the calculator's own results is one of the price list's.
      const t = text(main(html).replace(/<div class="bz-res"[\s\S]*?<\/small><\/div>/, " ").replace(/<form[\s\S]*?<\/form>/, " "));
      expect({ name, other: [...t.matchAll(/€[\d,.]+/g)].map((m) => m[0]).filter((e) => !allowed.has(e)) }).toEqual({ name, other: [] });
      expect(t).toContain("Pilot prices. Nothing is on sale yet.");
    }
    expect(faqs().find((f) => f.id === "cost")!.a).toContain(PRICING_LINE);
  });

  it("claims no customer, saving, quote, partnership or competitor", () => {
    const bad = [/\btrusted by\b/i, /\bour customers\b/i, /\bcustomers? (say|saved|use)\b/i, /\bsaved? (them|our)\b/i, /\bcase stud/i, /\btestimonial/i, /\bin partnership with\b/i, /\bofficial partner\b/i, /\bendorsed by\b/i, /\bcertified\b/i, /“|”/,
      /\b(Pleo|Ramp|Brex|Spendesk|Payhawk|Soldo|Moss|Yokoy|Tipalti|Coupa|Expensify|Navan|Mesh Payments|Bill\.com)\b/];
    for (const [name, html] of pages) {
      const t = text(html);
      for (const re of bad) expect({ name, found: re.exec(t)?.[0] ?? null }).toEqual({ name, found: null });
      expect(t).toMatch(/No customers, pilots or revenue yet\./);
      expect(t).toMatch(/No partnership or endorsement (is )?claimed/i);
      // The first target group is a starting point, not a proven segment (Max, 21 Nov).
      expect(t).toMatch(/not a proven market segment/);
    }
  });

  it("answers the buyer's questions, and the judges' (review, 21 Nov), from what is built, each with a link", () => {
    expect(faqs().map((f) => f.q)).toEqual(["What if the AI is wrong?", "Who is liable for a payment?", "Where is my data?", "Do I change banks?", "What does it cost?",
      "Can an agent bypass Purser?", "What is the moat if the code is open source?", "Why not an existing spend or AP tool?", "Why isn't this just Airwallex?", "How long does it take to start?"]);
    expect(faqs().find((f) => f.id === "bypass")!.a).toMatch(/^Only routes connected to Purser are protected\./);
    expect(faqs().find((f) => f.id === "moat")!.a).toMatch(/A hypothesis, not tested with customers\.$/);
    for (const f of faqs()) {
      expect(f.links.length).toBeGreaterThan(0);
      expect(BUSINESS_PAGE).toContain(`<details id="faq-${f.id}"><summary>`);
    }
    // Where the data lives: /privacy's reading of the configs, the part not pinned said too.
    const z = Object.fromEntries(residency().map((r) => [r.id, r]));
    expect([z.db!.zone, z.docs!.zone, z.engine!.zone, z.ai!.zone]).toEqual(["eu", "eu", "open", "out"]);
    expect(faqs().find((f) => f.id === "data")!.a).toMatch(/not pinned to a region yet/);
    // Max, 21 Nov: pilots only under a written agreement, no real payments before the production checks.
    expect(faqs().find((f) => f.id === "liable")!.a).toContain(PILOT_AGREEMENT);
    expect(faqs().find((f) => f.id === "liable")!.links.map(([h]) => h)).toContain(repoHref(GO_LIVE_DOC));
    expect(PILOT_AGREEMENT).toBe("Pilots run only under a written agreement: scope, responsibilities, liability, privacy and access are agreed in writing beforehand. No real payments before the production checks are met.");
    // How long: the "Try it" step's own tag on Home, no other duration.
    expect(faqs().find((f) => f.id === "start")!.a).toContain(START_STEPS[0]!.tag);
  });

  it("asks for a pilot at the footer's contact address, and says Alta (formerly Metal) at its first mention", () => {
    expect(PILOT_MAIL).toBe(`mailto:${CONTACT_EMAIL}?subject=Purser%20Founding%20Partner%20Pilot`);
    for (const [, html] of pages) {
      expect(html).toContain(`href="${PILOT_MAIL}"`);
      expect(text(main(html))).toMatch(/^[^]*?\bAlta \(formerly Metal\)/);
      expect(text(main(html)).indexOf("Alta (formerly Metal)")).toBe(text(main(html)).search(/\bAlta\b/));
    }
  });
});

describe("the 30-Day Founding Partner Pilot (Max, 21 Nov)", () => {
  const t = text(main(BUSINESS_PAGE));

  it("sits beside the plans, which keep their tiers and prices, under Max's heading and words", () => {
    expect(BUSINESS_PAGE).toContain(`<h2 class="bz-h" id="pilot">${FOUNDING_CTA}</h2>`);
    expect(FOUNDING_CTA).toBe("Become a Founding Partner");
    // Review, 21 Nov: no scarcity or hype ("limited availability", "shape the future").
    expect(FOUNDING_TEXT).toBe("Get 30 days of guided access to Purser: your agents do the routine payments, and a person approves every critical one.");
    expect(text(BUSINESS_PAGE) + text(ONE_PAGER_PAGE)).not.toMatch(/limited availability|shape the future/i);
    expect(t).toContain(FOUNDING_TEXT);
    expect(t).toContain(FOUNDING_NAME);
    expect(t).toMatch(/Free for 30 days/);
    // The plans, unchanged: every tier of the price list with its listed price; no discount.
    for (const want of [PRICING.starter.name, euro(PRICING.starter.monthlyCents), PRICING.business.name, euro(PRICING.business.fromMonthlyCents), PRICING.platformFee.name]) expect(t).toContain(want);
    expect(t).not.toMatch(/discount|% off|free plan|free forever/i);
    expect(BUSINESS_PAGE).toContain('<h2 class="bz-h" id="pricing">');
    expect(t.indexOf(FOUNDING_CTA)).toBeLessThan(t.indexOf("After the pilot, if you choose."));
  });

  it("states eligibility, scope and terms, promises no production payments before go-live, and claims no validated pricing", () => {
    expect(FOUNDING_TERMS.map((x) => x.id)).toEqual(["eligibility", "scope", "after"]);
    for (const want of ["No credit card.", "No automatic conversion or billing.", "Early access · for design partners", "a registered company, an authorised financial approver", "one clearly described workflow, and a suitable test environment", "Only under a written agreement", "No real payments before the production checks are met.", "one clearly scoped financial workflow", "Nothing is billed.", "You choose whether to move to a paid plan, if one is offered then.", "not a permanent free offer", "Not yet validated with customers."]) expect({ want, found: t.includes(want) }).toEqual({ want, found: true });
    expect(existsSync(new URL(`../${GO_LIVE_DOC}`, import.meta.url))).toBe(true);
    expect(BUSINESS_PAGE).toContain(`${GO_LIVE_DOC}" target="_blank" rel="noopener">The go-live requirements ↗</a>`);
    expect(t).not.toMatch(/\b(validated|proven) (pricing|prices)\b|\blive payments\b|\bproduction-ready\b/i);
    // Review, 21 Nov: nothing is on sale yet, so no "existing" paid plan; the fee's ceiling is the paying code's.
    expect(t).not.toContain("existing paid plan");
    expect(FEE_BPS_CAP).toBe(100);
    expect(t).toContain("capped at 1% of the payout in code (FEE_BPS_CAP); rate agreed in the pilot");
    expect(ONE_PAGER_PAGE).toContain(">Have a starter key?</a>");
  });

  it("presents the first target group as a starting point, not a proven segment, and lets other companies register interest", () => {
    expect(FIRST_TARGET).toMatch(/^Our first target group: EU companies of 20 to 200 employees using Airwallex/);
    expect(FIRST_TARGET_NOTE).toBe("A starting point, not a proven market segment. Other companies can still register interest.");
    expect(t).toContain("not a proven market segment");
    expect(BUSINESS_PAGE).toContain(`<a href="${PILOT_MAIL}">Other companies can still register interest</a>`);
    expect(text(main(ONE_PAGER_PAGE))).toContain(FIRST_TARGET_NOTE);
  });

  it("says the one-line position as the lead, on /business and on the one-pager", () => {
    expect(POSITION).toBe("Purser is the CFO control plane for AI-initiated business payments: it checks the supplier, enforces the mandate, binds approval to the exact payment, and reconciles the result.");
    for (const html of [BUSINESS_PAGE, ONE_PAGER_PAGE]) expect(text(main(html))).toContain(POSITION);
    expect(text(main(ONE_PAGER_PAGE))).toContain(FOUNDING_TEXT);
  });
});

describe("served as the site serves its pages", () => {
  const bundle = buildPages() as Pages;

  it("is listed first under More and in the footer (/one-pager is linked from /business, not listed)", () => {
    expect(moreLinks().map((l) => l.href)[0]).toBe("business");
    expect(footerLinks().some((l) => l.href === "business")).toBe(true);
    expect([...moreLinks(), ...footerLinks()].some((l) => l.href === "one-pager")).toBe(false);
    expect(BUSINESS_PAGE).toContain('href="one-pager"');
  });

  it("carries one script each, which parses no markup, under a policy of the page's own hashes", () => {
    for (const [path, html, csp, js] of [["/business", BUSINESS_PAGE, BUSINESS_CSP, CALC_JS], ["/one-pager", ONE_PAGER_PAGE, ONE_PAGER_CSP, PRINT_JS]] as const) {
      const scripts = scriptBlocks(html);
      expect({ path, n: scripts.length }).toEqual({ path, n: 1 });
      expect(scripts[0]).toContain(js);
      expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
      expect(csp).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'; style-src 'sha256-[A-Za-z0-9+/=]+'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/);
      const res = pageResponse(new Request(`https://x.test${path}`), bundle)!;
      expect({ path, status: res.status, csp: res.headers.get("content-security-policy") }).toEqual({ path, status: 200, csp });
    }
  });

  it("prints /one-pager on paper, light, without the site's header and footer", () => {
    expect(ONE_PAGER_PAGE).toMatch(/@media print \{[\s\S]*@page \{ size: A4;/);
    expect(ONE_PAGER_PAGE).toMatch(/@media print \{[\s\S]*header\.top, \.awx-row, footer\.foot, \.op-bar, \.noprint \{ display: none !important; \}/);
    // The button needs its script (window.print), so it is hidden until the script shows it.
    expect(ONE_PAGER_PAGE).toContain('<button class="btn primary" id="print" type="button" hidden>');
  });
});
