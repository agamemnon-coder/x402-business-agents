// Home leads with Purser Cloud (the owner, 20 Nov: "Purser Cloud becomes the company's product"; judges check every
// claim). Held here: the explainer of the money flow shows only what /try's two proof files hold (the amount signed,
// its fingerprint, the amount one cent higher, its own fingerprint, refused with nothing paid), and drops its refusal
// panel when the records do not hold exactly that; it is CSS only, still under reduced motion, and never fades text
// (since 21 Nov Home shows the changed cent as the first tile of its proof row, test/home-story.test.ts; the explainer
// stays a component). How to start says what Purser Cloud does today (a /try test company deleted after 24 hours, the
// console's guest route, the starter-key set-up, test money, the design-partner contact), and claims no customer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_PARTNER_LABEL, DESIGN_PARTNER_URL } from "../src/config/brand.js";
import { ASK_LABEL, ASK_URL, CLOUD_GUEST_URL, CLOUD_SETUP_URL, START_STEPS, homePage } from "../src/redesign/home.js";
import { MONEY_FLOW_CSS, MONEY_FLOW_RECORDS, MONEY_FLOW_STEPS, moneyFlowFacts, moneyFlowHtml } from "../src/redesign/moneyFlow.js";
import { PURSER_CLOUD_URL } from "../src/ui/more.js";
import { TRY_URL } from "../src/redesign/ui.js";
import { CONSOLE_PATHS } from "../cloud/src/console.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">" };
const text = (html: string) => html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&(?:amp|quot|#39|lt|gt);/g, (e) => ENTITIES[e]!).replace(/\s+/g, " ").trim();
const ON = homePage(undefined, { trySign: true }), OFF = homePage();
const mainOf = (html: string) => /<main[\s\S]*<\/main>/.exec(html)![0];
type Bundle = Parameters<typeof moneyFlowFacts>[0];
const PAID = JSON.parse(read(MONEY_FLOW_RECORDS[0])) as Bundle & { terms: { amount: string; currency: string; vendor: string }; terms_sha256: string };
const REFUSED = JSON.parse(read(MONEY_FLOW_RECORDS[1])) as Bundle & { asked: { terms: { amount: string } }; decision: { sent_sha256: string; reason?: string } };
const money = (a: string) => Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe("The explainer of the money flow", () => {
  const figure = moneyFlowHtml();

  it("shows the four steps, then the changed cent, every value from /try's two proof files", () => {
    expect(figure).toContain(`data-rec="${MONEY_FLOW_RECORDS.join(" ")}"`);
    const t = text(figure);
    let at = -1;
    for (const s of MONEY_FLOW_STEPS) { expect(t.indexOf(s)).toBeGreaterThan(at); at = t.indexOf(s); }
    const cur = PAID.terms.currency;
    expect(t).toContain(`${PAID.terms.vendor} · ${cur} ${money(PAID.terms.amount)}`);
    expect(t).toContain(`fingerprint ${PAID.terms_sha256.slice(0, 8)}…`);
    // One cent higher, the cent marked; its own fingerprint beside the signed one; nothing paid.
    expect(Math.round(Number(REFUSED.asked.terms.amount) * 100) - Math.round(Number(PAID.terms.amount) * 100)).toBe(1);
    expect(figure).toContain(`${cur} ${money(REFUSED.asked.terms.amount).slice(0, -1)}<mark>${money(REFUSED.asked.terms.amount).slice(-1)}</mark>`);
    expect(t).toContain(`Signature breaks. Nothing paid. Fingerprint ${REFUSED.decision.sent_sha256.slice(0, 8)}… is not the signed ${PAID.terms_sha256.slice(0, 8)}…`);
    expect(t).toContain("Airwallex sandbox or Alta (formerly Metal) testnet; /try pays a simulated bank");
    // The records say it: a refusal, signature not verified, the amount the one field changed, no transfer.
    const d = (REFUSED as unknown as { decision: { outcome: string; signature: { verified: boolean }; changed: string[]; transfers_before: number; transfers_after: number } }).decision;
    expect([d.outcome, d.signature.verified, d.changed, d.transfers_after - d.transfers_before]).toEqual(["refused", false, ["amount"], 0]);
    // Its caption links the "What's real?" fold; Home's fold names both files (its proof row's first tile reads them).
    expect(figure).toContain('<a href="#real" data-real>What\'s real?</a>');
    const fold = text(/<details class="real"[\s\S]*?<\/details>/.exec(ON)![0]);
    for (const f of MONEY_FLOW_RECORDS) expect(fold).toContain(f);
  });

  it("drops what the records do not hold: no refusal panel without a one-cent refusal, nothing without a paid, verified signature", () => {
    const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const twoCents = clone(REFUSED); twoCents.asked.terms.amount = (Number(PAID.terms.amount) + 0.02).toFixed(2);
    expect(moneyFlowFacts(PAID, twoCents)?.cent).toBeNull();
    const paidAnyway = clone(REFUSED) as unknown as { decision: { transfers_after: number } }; paidAnyway.decision.transfers_after += 1;
    expect(moneyFlowFacts(PAID, paidAnyway as unknown as Bundle)?.cent).toBeNull();
    expect(moneyFlowHtml(moneyFlowFacts(PAID, null))).not.toContain("mx-cent");
    const unsigned = clone(PAID) as unknown as { decision: { signature: { verified: boolean } } }; unsigned.decision.signature.verified = false;
    expect(moneyFlowFacts(unsigned as unknown as Bundle)).toBeNull();
    expect(moneyFlowHtml(null)).toBe("");
  });

  it("is CSS only: it moves only without a wish for less motion, never fades or wipes text, and has no style attribute", () => {
    expect(figure).not.toMatch(/ style="|<script/);
    const [still, ...rest] = MONEY_FLOW_CSS.split("@media (prefers-reduced-motion: no-preference)");
    expect(rest).toHaveLength(1);
    expect(still).not.toMatch(/animation:/);
    expect(MONEY_FLOW_CSS).not.toMatch(/opacity|clip-path/);
    // The dot that runs down the rail shows only while it moves.
    expect(still).toMatch(/\.mx-dot \{ display: none;/);
  });
});

describe("How to start, on Home", () => {
  const start = /<section class="e-start"[\s\S]*?<\/section>/.exec(mainOf(ON))![0];

  it("is Try, the console as a guest, and the pilot, each to the address that serves it", () => {
    // 21 Nov (Max: "The steps need to be prettier; it's the small details"): three steps, an icon, one line, one tag each.
    expect(START_STEPS.map((s) => [s.icon, s.title])).toEqual([["zap", "Try it now"], ["layout-dashboard", "Explore the console"], ["rocket", "Run a pilot"]]);
    expect(START_STEPS.flatMap((s) => s.links.map((l) => l.href))).toEqual([TRY_URL, CLOUD_GUEST_URL, CLOUD_SETUP_URL]);
    expect([CLOUD_GUEST_URL, CLOUD_SETUP_URL]).toEqual([`${PURSER_CLOUD_URL}#/guest`, `${PURSER_CLOUD_URL}#/start`]);
    // The console answers both routes (cloud/src/console.ts): the guest route and the first run with a starter key.
    const console = read("cloud/src/console.ts");
    expect(console).toContain("if(path==='/guest')");
    expect(console).toContain("a.href='#/start'");
    expect(CONSOLE_PATHS["/start"]).toBe("#/start");
    // The pilot card carries the design-partner contact (mailto, set since 20 Nov) and says it is test money.
    const pilot = /<li class="reveal pilot">[\s\S]*?<\/li>/.exec(start)![0];
    expect(pilot).toContain(`<a href="${DESIGN_PARTNER_URL}">${DESIGN_PARTNER_LABEL} →</a>`);
    expect(text(pilot)).toMatch(/Test money · no real payments yet/);
    expect(homePage(undefined, { partnerUrl: "" })).not.toContain(DESIGN_PARTNER_LABEL);
  });

  it("links Ask Purser, the chat on Purser Cloud, and carries no chat code itself", () => {
    expect(ASK_URL).toBe(`${PURSER_CLOUD_URL}ask`);
    expect(start).toContain(`<p class="ask">Questions first? <a href="${ASK_URL}" target="_blank" rel="noopener">${ASK_LABEL}`);
    for (const html of [ON, OFF]) expect(mainOf(html).split(ASK_URL).length - 1).toBe(1);
    // Home still calls no server: its CSP allows no connection (test/home-story.test.ts, A7).
    expect(ON).not.toMatch(/<textarea|<form\b/);
  });

  it("says only what the product does today: the set-up page's two minutes, the sweep's 24 hours, no customer", () => {
    expect(read("src/ui/i18n.ts")).toContain('"cs.setup_lede": "About two minutes.');
    expect(read("cloud/src/try/sweep.ts")).toMatch(/every visitor's company past its 24 hours is wiped/);
    expect(text(start)).toContain("2 minutes · deleted after 24 h");
    expect(text(start)).toContain("as a guest. No sign-up. Read only");
    for (const html of [ON, OFF]) {
      const t = text(mainOf(html));
      expect(t).not.toMatch(/\b(customers? (use|trust)|trusted by|used by \d|our customers|in production at)\b/i);
      expect(t).not.toMatch(/\b(Pleo|Ramp|Brex|Spendesk|Payhawk|Expensify|Mercury|Revolut|Stripe|Mastercard|Coinbase)\b/);
      expect(t).not.toMatch(/founder|Max Geurtsen/i);
    }
    expect(text(/<details class="real"[\s\S]*?<\/details>/.exec(ON)![0])).toContain("No customer uses it yet.");
  });
});
