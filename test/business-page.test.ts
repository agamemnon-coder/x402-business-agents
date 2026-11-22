// /business, "For companies", and /one-pager (21 Nov; Max: "commercially strong", without inventing anything). Since
// 22 Nov (Max: "far too much text"; then "still too much, the demo duplicates Home") /business is only the question, one
// line, one small animated visual and the pilot's sign-up form, which opens the visitor's own mail app (no request,
// nothing stored); /one-pager keeps the whole story, its prices the price list's. Both claim no customer, saving, quote,
// competitor or endorsement, and both are served under a policy of their own hashes with one script that parses no markup.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL } from "../src/config/brand.js";
import { PRICING, PRICING_LINE, euro } from "../src/config/pricing.js";
import { BUSINESS_PAGE, BUSINESS_CSP, ONE_PAGER_CSP, ONE_PAGER_PAGE, PRICING_HOME, REDIRECTS } from "../src/servers/dashboard.js";
import { FIRST_TARGET, FIRST_TARGET_NOTE, PILOT_AGREEMENT, FOUNDING_NAME, FOUNDING_TEXT, GO_LIVE_DOC, PILOT_APPLY, PILOT_FORM_NOTE, PILOT_JS, PILOT_MAIL, PILOT_VOLUMES, POSITION, PRINT_JS, faqs, pilotMailto, type PilotForm } from "../src/redesign/business.js";
import { FEE_BPS_CAP } from "../src/airwallex/platform.js";
import { BUSINESS_LINE, BUSINESS_QUESTION, demoFacts } from "../src/redesign/businessVisuals.js";
import { repoHref } from "../src/redesign/productPage.js";
import { START_STEPS } from "../src/redesign/home.js";
import { residency } from "../src/redesign/privacy.js";
import { buildPages } from "../src/relay/assets.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { moreLinks, footerLinks, tabLabel, tabLinks } from "../src/ui/more.js";
import { scriptBlocks } from "./support/scriptBlocks.js";

const text = (html: string) => html.replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\b[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const main = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];

/** The browser's builder, run as the page runs it (no form in the document: it only defines itself). */
function browserBuild(): (f: PilotForm) => string {
  const sandbox: Record<string, unknown> = { document: { getElementById: () => null }, encodeURIComponent, String, JSON };
  sandbox.globalThis = sandbox;
  runInNewContext(PILOT_JS, sandbox);
  return (sandbox.__purserPilot as { build: (f: PilotForm) => string }).build;
}

describe("/business (22 Nov): the question, one line, one visual, the pilot's form", () => {
  const m = main(BUSINESS_PAGE), t = text(m);

  it("asks the question in the one h1, says one line, and keeps the label", () => {
    expect(BUSINESS_PAGE.match(/<h1\b/g)).toHaveLength(1);
    expect(BUSINESS_PAGE).toContain(`<h1 id="bzh-h">${BUSINESS_QUESTION}</h1>`);
    expect(BUSINESS_QUESTION).toBe("Would you trust an AI agent with your company's money?");
    expect(t).toContain(BUSINESS_LINE);
    expect(t).toContain("Founding Partner Pilot · test money only");
  });

  it("has the sign-up form: name, company, work email and invoices a month required, the message optional", () => {
    const form = /<form class="bzf-g" id="pilot-form"[^>]*>[\s\S]*?<\/form>/.exec(m)![0];
    expect(form).not.toMatch(/\b(action|method)=/);
    for (const [name, type] of [["name", "text"], ["company", "text"], ["email", "email"]]) expect(form).toMatch(new RegExp(`<input name="${name}" type="${type}"[^>]*\\brequired>`));
    expect(form).toMatch(/<select name="invoices" required><option value="">Choose<\/option><option>&lt;100<\/option><option>100–500<\/option><option>500–2,000<\/option><option>2,000\+<\/option><\/select>/);
    expect(PILOT_VOLUMES).toEqual(["<100", "100–500", "500–2,000", "2,000+"]);
    expect(form).toMatch(/<textarea name="message" rows="3" maxlength="2000"><\/textarea>/);
    expect(form).not.toMatch(/<textarea[^>]*required/);
    expect(form).toContain(`<button class="btn primary" type="submit">`);
    expect(text(form)).toContain(PILOT_APPLY);
    expect(PILOT_APPLY).toBe("Apply for the pilot");
    expect(text(form)).toContain(PILOT_FORM_NOTE);
    expect(PILOT_FORM_NOTE).toBe("Opens your email app with your details filled in; nothing is stored.");
    // Without its script the form cannot send (form-action 'none'): the plain mail link is there for that.
    expect(form).toContain(`<a href="${PILOT_MAIL}">email us directly</a>`);
    expect(m).toContain('href="one-pager"');
  });

  it("builds the mail from the fields, the same in the page as built and in the browser, every value encoded", () => {
    const build = browserBuild();
    const cases: PilotForm[] = [
      { name: "Ada Jansen", company: "Northwind B.V.", email: "ada@northwind.example", invoices: "100–500", message: "We pay 300 suppliers a month.\nIn EUR and GBP." },
      { name: "  X  ", company: "A&B?c=d", email: "x@y.example", invoices: "<100" },
      { name: "Eve\r\nBcc: evil@example.com", company: "Evil\nCo", email: "e@e.example", invoices: "2,000+", message: "a".repeat(5000) },
    ];
    for (const f of cases) expect(build(f)).toBe(pilotMailto(f));
    const u = new URL(pilotMailto(cases[0]!));
    expect(u.protocol).toBe("mailto:");
    expect(u.pathname).toBe(CONTACT_EMAIL);
    expect(u.searchParams.get("subject")).toBe("Purser Founding Partner Pilot: Northwind B.V.");
    expect(u.searchParams.get("body")).toBe("Name: Ada Jansen\nCompany: Northwind B.V.\nWork email: ada@northwind.example\nInvoices per month: 100–500\nMessage: We pay 300 suppliers a month.\nIn EUR and GBP.");
    // Nothing a visitor types adds a header or a recipient: one subject, one body, single fields on one line.
    const bad = new URL(pilotMailto(cases[2]!));
    expect([...bad.searchParams.keys()]).toEqual(["subject", "body"]);
    expect(bad.searchParams.get("subject")).toBe("Purser Founding Partner Pilot: Evil Co");
    expect(bad.searchParams.get("body")!.split("\n").slice(0, 2)).toEqual(["Name: Eve Bcc: evil@example.com", "Company: Evil Co"]);
    expect(new URL(pilotMailto(cases[1]!)).searchParams.get("subject")).toBe("Purser Founding Partner Pilot: A&B?c=d");
    expect(new URL(pilotMailto(cases[1]!)).searchParams.get("body")).toContain("Message: -");
    // The script only opens the mail: no request, no storage, no markup parsed.
    expect(PILOT_JS).toContain("location.href = build(");
    expect(PILOT_JS).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });

  it("shows one animated visual (CSS only, on a loop, still under reduced motion), with the recorded amount and no figures, diagram or plans", () => {
    const d = demoFacts();
    expect([d.amount, d.alone]).toEqual(["EUR 1,850.00", "EUR 120.00"]);
    const fig = /<figure class="bzv"[\s\S]*?<\/figure>/.exec(m)![0];
    for (const want of ["Invoice", d.amount, d.alone, "Agent checks", "Within limit · paid", "Over limit · Face ID", "Signed · exact terms", "Sandbox · test money"]) expect(text(fig)).toContain(want);
    expect(m.match(/<figure\b/g)).toHaveLength(1);
    for (const k of ["bzv-doc-a", "bzv-doc-b", "bzv-run1", "bzv-run2", "bzv-chk", "bzv-ok", "bzv-cfo", "bzv-sig"]) expect(BUSINESS_PAGE).toMatch(new RegExp(`@keyframes ${k} \\{`));
    expect(BUSINESS_PAGE).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\n {2}\.bzv-doc\.a \{ visibility: visible; animation: bzv-doc-a 9s/);
    expect(BUSINESS_PAGE).toContain("@media (prefers-reduced-motion: reduce) { figure.bzv * { animation: none !important; transition: none !important; } .bzv-doc.a { visibility: hidden; } }");
    expect(BUSINESS_PAGE).not.toMatch(/\sstyle="/);
    // Gone (Max, 22 Nov: "the demo duplicates Home"): the figures, the approval card, the diagram, the architecture,
    // the plans, the calculator, the questions and the buttons to /try and /proof.
    expect(m).not.toMatch(/class="bz(stats|card|d|a|-price|-calc|-faq|-fold)\b|<canvas|<details\b|data-stat=|href="\/try"|href="proof"/);
    expect(t).not.toMatch(/€/);
    expect(t.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length).toBeLessThanOrEqual(130);
  });
});

describe("what the pages claim", () => {
  const pages = [["business", BUSINESS_PAGE], ["onePager", ONE_PAGER_PAGE]] as const;

  it("names only the price list's prices on /one-pager, as pilot prices, with nothing on sale", () => {
    const allowed = new Set([euro(PRICING.starter.monthlyCents), euro(PRICING.starter.extraInvoiceCents), euro(PRICING.business.fromMonthlyCents)]);
    const t = text(main(ONE_PAGER_PAGE));
    expect([...t.matchAll(/€[\d,.]+/g)].map((x) => x[0]).filter((e) => !allowed.has(e))).toEqual([]);
    expect(t).toContain("Pilot prices. Nothing is on sale yet.");
    for (const want of [PRICING.starter.name, euro(PRICING.starter.monthlyCents), PRICING.business.name, euro(PRICING.business.fromMonthlyCents), PRICING.platformFee.name]) expect(t).toContain(want);
    expect(t).not.toMatch(/discount|% off|free plan|free forever/i);
    expect(FEE_BPS_CAP).toBe(100);
    expect(t).toContain("capped at 1% of the payout in code (FEE_BPS_CAP); rate agreed in the pilot");
    expect(t).toContain("Not yet validated with customers.");
    expect(faqs().find((f) => f.id === "cost")!.a).toContain(PRICING_LINE);
  });

  it("claims no customer, saving, quote, partnership or competitor", () => {
    const bad = [/\btrusted by\b/i, /\bour customers\b/i, /\bcustomers? (say|saved|use)\b/i, /\bsaved? (them|our)\b/i, /\bcase stud/i, /\btestimonial/i, /\bin partnership with\b/i, /\bofficial partner\b/i, /\bendorsed by\b/i, /\bcertified\b/i, /“|”/, /limited availability|shape the future/i,
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

  it("keeps the buyer's and the judges' answers (the README and /one-pager use them), each from what is built", () => {
    expect(faqs().map((f) => f.q)).toEqual(["What if the AI is wrong?", "Who is liable for a payment?", "Where is my data?", "Do I change banks?", "What does it cost?",
      "Can an agent bypass Purser?", "What is the moat if the code is open source?", "Why not an existing spend or AP tool?", "Why isn't this just Airwallex?", "How long does it take to start?"]);
    expect(faqs().find((f) => f.id === "bypass")!.a).toMatch(/^Only routes connected to Purser are protected\./);
    expect(faqs().find((f) => f.id === "moat")!.a).toMatch(/A hypothesis, not tested with customers\.$/);
    for (const f of faqs()) expect(f.links.length).toBeGreaterThan(0);
    const z = Object.fromEntries(residency().map((r) => [r.id, r]));
    expect([z.db!.zone, z.docs!.zone, z.engine!.zone, z.ai!.zone]).toEqual(["eu", "eu", "open", "out"]);
    expect(faqs().find((f) => f.id === "data")!.a).toMatch(/not pinned to a region yet/);
    expect(text(main(ONE_PAGER_PAGE))).toContain(faqs().find((f) => f.id === "data")!.a);
    expect(faqs().find((f) => f.id === "liable")!.a).toContain(PILOT_AGREEMENT);
    expect(faqs().find((f) => f.id === "liable")!.links.map(([h]) => h)).toContain(repoHref(GO_LIVE_DOC));
    expect(faqs().find((f) => f.id === "start")!.a).toContain(START_STEPS[0]!.tag);
  });

  it("asks for a pilot at the footer's contact address, and /one-pager says Alta (formerly Metal) at its first mention", () => {
    expect(PILOT_MAIL).toBe(`mailto:${CONTACT_EMAIL}?subject=Purser%20Founding%20Partner%20Pilot`);
    for (const [, html] of pages) expect(html).toContain(`href="${PILOT_MAIL}"`);
    const t = text(main(ONE_PAGER_PAGE));
    expect(t.indexOf("Alta (formerly Metal)")).toBe(t.search(/\bAlta\b/));
    expect(t).toContain(FOUNDING_TEXT);
    expect(t).toContain(FOUNDING_NAME);
    expect(t).toContain(POSITION);
    expect(FIRST_TARGET).toMatch(/^Our first target group: EU companies of 20 to 200 employees using Airwallex/);
    expect(t).toContain(FIRST_TARGET_NOTE);
    expect(ONE_PAGER_PAGE).toContain(">Have a starter key?</a>");
  });
});

describe("served as the site serves its pages", () => {
  const bundle = buildPages() as Pages;

  it("is a tab of its own (Business) and first in the footer; /pricing lands on /business, no anchor", () => {
    expect(tabLinks().map((l) => [l.href, tabLabel(l)])[0]).toEqual(["business", "Business"]);
    expect(moreLinks().map((l) => l.href)).not.toContain("business");
    expect(footerLinks().map((l) => l.href)[0]).toBe("business");
    expect([...moreLinks(), ...footerLinks()].some((l) => l.href === "one-pager")).toBe(false);
    expect(PRICING_HOME).toBe("/business");
    expect(REDIRECTS["/pricing"]).toBe("/business");
    const res = pageResponse(new Request("https://x.test/pricing"), bundle)!;
    expect({ status: res.status, to: res.headers.get("location") }).toEqual({ status: 302, to: "/business" });
  });

  it("carries one script each, which parses no markup, under a policy of the page's own hashes", () => {
    for (const [path, html, csp, js] of [["/business", BUSINESS_PAGE, BUSINESS_CSP, PILOT_JS], ["/one-pager", ONE_PAGER_PAGE, ONE_PAGER_CSP, PRINT_JS]] as const) {
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
    expect(ONE_PAGER_PAGE).toContain('<button class="btn primary" id="print" type="button" hidden>');
  });
});
