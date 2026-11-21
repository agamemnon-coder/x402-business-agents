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
  // Max, 21 Nov: "the How to start section is really ugly, just remove it". The pilot's way is the hero's "Start a
  // pilot" and the For companies button, both to /business, where the pilot and its starter key are; the console as a
  // guest is the menu's Cloud and the judge tour's third stop. The steps themselves live on in /business.
  it("is gone from Home; the pilot leads to /business, the design-partner link and Ask Purser stay", () => {
    expect(mainOf(ON)).not.toContain('class="e-start"');
    expect(mainOf(ON)).toContain(`<a class="btn big ghost pilot" href="business">`);
    expect(START_STEPS.flatMap((s) => s.links.map((l) => l.href))).toEqual([TRY_URL, CLOUD_GUEST_URL, CLOUD_SETUP_URL]);
    expect([CLOUD_GUEST_URL, CLOUD_SETUP_URL]).toEqual([`${PURSER_CLOUD_URL}#/guest`, `${PURSER_CLOUD_URL}#/start`]);
    // The console still answers both routes (cloud/src/console.ts).
    expect(CONSOLE_PATHS["/start"]).toBe("#/start");
    for (const html of [ON, OFF]) expect(mainOf(html)).not.toContain('class="e-start"');
    const biz = /<div class="e-more e-biz">[\s\S]*?<\/div>/.exec(mainOf(ON))![0];
    expect(biz).toContain(`<a href="${DESIGN_PARTNER_URL}">${DESIGN_PARTNER_LABEL} →</a>`);
    expect(homePage(undefined, { partnerUrl: "" })).not.toContain(DESIGN_PARTNER_LABEL);
    expect(mainOf(ON)).toContain(`<a href="${ASK_URL}" target="_blank" rel="noopener">${ASK_LABEL}`);
  });
});
