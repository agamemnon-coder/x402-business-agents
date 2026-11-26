// /business, "For companies", and /one-pager (21 Nov; Max: "commercially strong", without inventing anything). Since
// 26 Nov (Max: "way too simple and amateur … widgets, animations, architecture") /business is a landing page of few words
// and strong visuals: the headline with an animated console, the architecture, five controls each with its record, and
// the pilot with a short sign-up form, which opens the visitor's own mail app (no request, nothing stored). Every value
// in a visual is read from a record or the code. /one-pager keeps the whole story, its prices the price list's. Both
// claim no customer, saving, quote, competitor or endorsement, and both are served under a policy of their own hashes
// with one script that parses no markup.
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL } from "../src/config/brand.js";
import { PRICING, PRICING_LINE, euro } from "../src/config/pricing.js";
import { BUSINESS_PAGE, BUSINESS_CSP, ONE_PAGER_CSP, ONE_PAGER_PAGE, PRICING_HOME, REDIRECTS } from "../src/servers/dashboard.js";
import { BUSINESS_HONEST, FIRST_TARGET, FIRST_TARGET_NOTE, PILOT_AGREEMENT, FOUNDING_NAME, FOUNDING_TEXT, GO_LIVE_DOC, PILOT_APPLY, PILOT_FORM_NOTE, PILOT_JS, PILOT_MAIL, PILOT_QUESTIONS, PILOT_VOLUMES, POSITION, PRINT_JS, faqs, pilotMailto, type PilotForm } from "../src/redesign/business.js";
import { FEE_BPS_CAP } from "../src/airwallex/platform.js";
import { ALERT_CANNOT, ALERT_HEADLINE, ARCH_BYPASS, ARCH_NODES, BUSINESS_LINE, BUSINESS_QUESTION, CONSOLE_CHECKS, businessFacts, bentoTiles } from "../src/redesign/businessVisuals.js";
import { BUSINESS_H1, PAGE_CSS } from "../src/redesign/business.js";
import { CANNOT_APPROVE, noticeHeadline } from "../src/integrations/approvalChat.js";
import { TRY_ALONE_LIMIT } from "../src/config/policy.js";
import { CLEAN, NEW_BANK, WITHIN_LIMIT } from "../src/config/trySample.js";
import { agentRoster, stopDrillFacts } from "../src/redesign/home.js";
import { readFileSync } from "node:fs";
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

describe("/business (26 Nov): the headline and console, the architecture, the controls, the pilot's form", () => {
  const m = main(BUSINESS_PAGE), t = text(m);

  it("says the headline in the one h1 with one line and two buttons, and asks the question over the pilot", () => {
    expect(BUSINESS_PAGE.match(/<h1\b/g)).toHaveLength(1);
    expect(BUSINESS_H1).toBe("Let AI agents pay. Keep the CFO in control.");
    expect(BUSINESS_PAGE).toContain(`<h1 id="bzh-h"><span>Let AI agents pay.</span> <span>Keep the CFO in control.</span></h1>`);
    expect(t).toContain(BUSINESS_LINE);
    expect(t).toContain("Founding Partner Pilot · test money only");
    // Two buttons: the pilot (this page's form) and the hands-on demo.
    expect(m).toMatch(/<div class="bzx-c"><a class="btn primary" href="#pilot">Apply for the pilot<svg[\s\S]*?<\/a><a class="btn ghost" href="\/try">[\s\S]*?See it live<\/a><\/div>/);
    // The question (Max, 21 Nov) heads the pilot, where the form answers it.
    expect(BUSINESS_QUESTION).toBe("Would you trust an AI agent with your company's money?");
    expect(m).toContain(`<section class="bzs bzpl" id="pilot" aria-labelledby="bzq-h">`);
    expect(m).toContain(`<h2 class="bz-h" id="bzq-h">${BUSINESS_QUESTION}</h2>`);
  });

  it("has the sign-up form: name, work email and company required, everything else optional", () => {
    const form = /<form class="bzf-g" id="pilot-form"[^>]*>[\s\S]*?<\/form>/.exec(m)![0];
    expect(form).not.toMatch(/\b(action|method)=/);
    for (const [name, type] of [["name", "text"], ["company", "text"], ["email", "email"]]) expect(form).toMatch(new RegExp(`<input name="${name}" type="${type}"[^>]*\\brequired>`));
    // 26 Nov (Max: "far too full"): invoices a month and two of the questions fold under "Tell us more", optional.
    expect(form).toMatch(/<details class="more"><summary>Tell us more<\/summary><div>\n<label><span>Invoices per month<\/span><select name="invoices"><option value="">Choose<\/option><option>&lt;100<\/option><option>100–500<\/option><option>500–2,000<\/option><option>2,000\+<\/option><\/select>/);
    expect(form.indexOf('name="start"')).toBeLessThan(form.indexOf("<details"));
    expect(form.indexOf('name="pay"')).toBeGreaterThan(form.indexOf("<details"));
    expect(PILOT_VOLUMES).toEqual(["<100", "100–500", "500–2,000", "2,000+"]);
    // 26 Nov (the owner): three qualifying questions as chips (radios), none required, in place of the message.
    expect(PILOT_QUESTIONS.map((x) => [x.q, x.options])).toEqual([["How do you pay suppliers today?", ["Bank portal", "AP tool", "Spreadsheets"]], ["Who approves payments?", ["CFO", "Founder", "Accountant"]], ["When would you start?", ["Now", "Next quarter", "Exploring"]]]);
    for (const x of PILOT_QUESTIONS) for (const o of x.options) expect(form).toContain(`<input type="radio" name="${x.name}" value="${o}">`);
    expect(form).not.toMatch(/<textarea|type="radio"[^>]*required/);
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
      { name: "Ada Jansen", company: "Northwind B.V.", email: "ada@northwind.example", invoices: "100–500", pay: "AP tool", approver: "CFO", start: "Next quarter" },
      { name: "  X  ", company: "A&B?c=d", email: "x@y.example", invoices: "<100" },
      { name: "Eve\r\nBcc: evil@example.com", company: "Evil\nCo", email: "e@e.example", invoices: "2,000+", pay: "x\r\nCc: evil@example.com", start: "a".repeat(5000) },
    ];
    for (const f of cases) expect(build(f)).toBe(pilotMailto(f));
    const u = new URL(pilotMailto(cases[0]!));
    expect(u.protocol).toBe("mailto:");
    expect(u.pathname).toBe(CONTACT_EMAIL);
    expect(u.searchParams.get("subject")).toBe("Purser Founding Partner Pilot: Northwind B.V.");
    expect(u.searchParams.get("body")).toBe("Name: Ada Jansen\nCompany: Northwind B.V.\nWork email: ada@northwind.example\nInvoices per month: 100–500\nPays suppliers through: AP tool\nApproves payments: CFO\nWould start: Next quarter");
    // Nothing a visitor types adds a header or a recipient: one subject, one body, single fields on one line.
    const bad = new URL(pilotMailto(cases[2]!));
    expect([...bad.searchParams.keys()]).toEqual(["subject", "body"]);
    expect(bad.searchParams.get("subject")).toBe("Purser Founding Partner Pilot: Evil Co");
    expect(bad.searchParams.get("body")!.split("\n")).toEqual(["Name: Eve Bcc: evil@example.com", "Company: Evil Co", "Work email: e@e.example", "Invoices per month: 2,000+", "Pays suppliers through: x Cc: evil@example.com", "Approves payments: -", `Would start: ${"a".repeat(40)}`]);
    expect(new URL(pilotMailto(cases[1]!)).searchParams.get("subject")).toBe("Purser Founding Partner Pilot: A&B?c=d");
    expect(new URL(pilotMailto(cases[1]!)).searchParams.get("body")).toContain("Pays suppliers through: -\nApproves payments: -\nWould start: -");
    // The script only opens the mail: no request, no storage, no markup parsed.
    expect(PILOT_JS).toContain("location.href = build(");
    expect(PILOT_JS).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|cookie|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });

  it("draws its visuals in HTML and CSS: no canvas, no picture but the partners' logos as on file, no script but the form's", () => {
    // 26 Nov (Max: "widgets, animations, architecture"): the console, the architecture and the controls; the soft violet
    // glow stays. Every moving part is CSS, and only under prefers-reduced-motion: no-preference; the final frame is the
    // default, so with less motion every visual stands finished.
    expect(m).not.toMatch(/<canvas\b|<video\b|<iframe\b/);
    expect([...m.matchAll(/<img\b[^>]*>/g)].map((x) => /src="([^"?]+)/.exec(x[0])![1])).toEqual(["assets/logo-claude-slate.svg", "assets/logo-airwallex.png", "assets/logo-alta.svg"]);
    for (const img of m.matchAll(/<img\b[^>]*>/g)) expect(img[0]).toMatch(/ alt="[^"]+"/);
    expect(scriptBlocks(BUSINESS_PAGE)[0]!.replace(/^<script>|<\/script>$/gi, "").trim()).toBe(PILOT_JS);
    expect(BUSINESS_PAGE).toContain("main.bzp::before");
    expect(BUSINESS_PAGE).toContain(`<footer class="bzfoot"><div class="wrap"><p><span>${BUSINESS_HONEST}</span>`);
    expect(BUSINESS_PAGE).not.toMatch(/What's real\?|class="flink"/);
    expect(BUSINESS_PAGE).not.toMatch(/\sstyle="|\son[a-z]+="/);
    // Every animation of the page's own style is switched on inside the no-preference block (the keyframes sit outside it).
    const css = PAGE_CSS;
    expect(BUSINESS_PAGE).toContain(PAGE_CSS);
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " ").replace(/@keyframes [\w-]+ \{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " ");
    expect(outside).not.toMatch(/(?<![\w-])animation(-name)?\s*:/);
    for (const part of ['<figure class="cx"', '<div class="ar"', '<ul class="bt-g">', '<form class="bzf-g" id="pilot-form"']) expect(m).toContain(part);
    // Still not here (they are Home's, /proof's and /one-pager's): the plans, the calculator, the questions.
    expect(m).not.toMatch(/class="bz(stats|card|-price|-calc|-faq|-fold)\b|data-stat=/);
    expect(t).not.toMatch(/€/);
    expect(BUSINESS_PAGE).not.toMatch(/class="awx-strip|10 Airwallex features/);
  });

  it("reads every value in its visuals from a record or the code, and shows nothing it cannot read", () => {
    const f = businessFacts();
    const paid = JSON.parse(readFileSync("docs/proof/try-paid.json", "utf8")), refused = JSON.parse(readFileSync("docs/proof/try-refused.json", "utf8"));
    // The console: /try's paid invoice, the agent's limit and /try's two other samples.
    expect(f.pay).toEqual({ proposal: paid.proposal_id, vendor: paid.terms.vendor, invoice: paid.terms.reference, currency: "EUR", amount: "1,850.00", last4: paid.terms.iban_last4, signed: paid.terms_sha256, due: "8 Jan 2027" });
    expect([CLEAN.invoiceNo, CLEAN.dueDate, CLEAN.amountCents]).toEqual([paid.terms.reference, "2027-01-08", 185_000]);
    expect(paid.decision).toMatchObject({ outcome: "paid", signed_sha256: paid.terms_sha256, sent_sha256: paid.terms_sha256 });
    expect(f.limit).toBe(`${TRY_ALONE_LIMIT.currency} 500.00`);
    expect([f.alone, f.bank]).toEqual([{ invoice: WITHIN_LIMIT.invoiceNo, amount: "EUR 120.00" }, { invoice: NEW_BANK.invoiceNo, amount: "EUR 2,380.00" }]);
    for (const c of CONSOLE_CHECKS(f)) expect(t).toContain(c);
    for (const w of [f.pay.vendor, `${f.pay.invoice} · due ${f.pay.due}`, "EUR 1,850.00", f.pay.signed.slice(0, 12), "Paid by the agent", "Blocked: new bank details", "Demo company · test money"]) expect(t).toContain(w);
    // The changed cent: the refused file's amount and fingerprint, one cent over the signed one.
    expect(f.cent).toEqual({ amount: "1,850.01", sent: refused.decision.sent_sha256 });
    expect(refused.decision).toMatchObject({ outcome: "refused", signature: { verified: false }, changed: ["amount"] });
    expect(t).toContain(f.cent!.sent.slice(0, 16));
    // The stop, the cards and the declined charge: Home's readers of the same records.
    expect(f.stop).toEqual(stopDrillFacts());
    expect(f.cards).toEqual(agentRoster());
    for (const c of f.cards) expect(t).toContain(`${c.currency} ${c.perTx} a purchase`);
    expect(t).toContain(`One signed stop froze all three agents' cards in ${f.stop!.seconds} s`);
    expect(t).toContain(`Airwallex itself declined the charge: ${f.decline!.currency} ${f.decline!.amount} on a ${f.decline!.currency} ${f.decline!.limit} card.`);
    // The alert: approvalChat's own words, for the same payment; nothing in it acts.
    const notice = { proposal_id: f.pay.proposal, invoice_id: "AP-0001", amount: paid.terms.amount, currency: f.pay.currency, payee: f.pay.vendor, link: "https://purser.example/#/invoices/AP-0001", test_money: true };
    expect(ALERT_HEADLINE(f.pay)).toBe(noticeHeadline(notice));
    expect(ALERT_CANNOT).toBe(CANNOT_APPROVE);
    const mv = /<div class="mv">[\s\S]*?<\/div><\/div><\/div>/.exec(m)![0];
    expect(text(mv)).toContain(noticeHeadline(notice));
    expect(mv).not.toMatch(/<a\b|<button\b|<form\b/);
    // The ledger: three consecutive entries of the paid file, each one's prev_hash the one before's entry_hash.
    const es = paid.ledger.entries as { entry_id: number; prev_hash: string; entry_hash: string }[];
    expect(f.ledger.map((e) => e.id)).toEqual([4, 5, 6]);
    for (const e of f.ledger) expect(es.find((x) => x.entry_id === e.id)).toMatchObject({ prev_hash: e.prev, entry_hash: e.hash });
    expect(f.ledger[1]!.prev).toBe(f.ledger[0]!.hash);
    expect(f.ledger[2]!.prev).toBe(f.ledger[1]!.hash);
    // Five tiles, each with its record; a tile whose record lacks its piece drops out.
    expect(bentoTiles(f).map((x) => x.cls)).toEqual(["t-cent", "t-stop", "t-cards", "t-chat", "t-chain"]);
    expect(bentoTiles({ ...f, cent: null, stop: null, decline: null, ledger: [] }).map((x) => x.cls)).toEqual(["t-chat"]);
    for (const tile of bentoTiles(f)) expect(m).toContain(`<li class="bt ${tile.cls}" data-rec="${tile.rec}">`);
    // The architecture: five stops in order, and the lane under the limit that skips the CFO.
    expect(ARCH_NODES.map((n) => n.title)).toEqual(["Claude agents", "Purser", "CFO passkey", "The rails", "Books and audit"]);
    for (const n of ARCH_NODES) expect(t).toContain(n.title);
    expect(t).toContain(ARCH_BYPASS);
    // Few words: the visuals carry the page (counted as test/site-v4.test.ts counts them, with every label in a visual).
    expect(t.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length).toBeLessThanOrEqual(560);
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
      // The first target group is a starting point, not a proven segment (Max, 21 Nov); /business no longer names it.
      if (name === "onePager") expect(t).toMatch(/not a proven market segment/);
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
