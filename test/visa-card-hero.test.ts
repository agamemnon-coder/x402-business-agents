// /visa's card scene since 21 Nov (the owner, Max: "It must be clear it is about cards, not all those walls of text. So
// again: visuals, animations, architecture. Show it."; src/redesign/visaCardHero.ts): every figure on the card and its
// steps from the vic-5 record of 14 Nov, the two refusals as chips with their codes, the card flow, Visa as text only,
// and the honest line (Airi's credential on a test card, not a Visa network token; sandbox, test money).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VISA_CARD_HERO_CSS, visaArchHtml, visaCardHeroHtml, visaCardScene } from "../src/redesign/visaCardHero.js";
import { VIC3_RUN_FILE } from "../src/redesign/vic3Run.js";
import { VISA_PAGE } from "../src/servers/dashboard.js";

type P = { step: string; request: { amount: string; currency: string; merchant: string } | null; proposal_id: string | null; mandate_id: string | null; payment_intent_id: string | null; outcome: { status: string; code?: string; reason?: string }; calls: Record<string, number>; rail_choice: { model: string } | null };
const rec = JSON.parse(readFileSync(new URL(`../${VIC3_RUN_FILE}`, import.meta.url), "utf8")) as { run: string; mode: string; preflight: { card: string }; purchases: P[]; audit: { event: string; subject: string; payload: Record<string, unknown> }[] };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const main = /<main[\s\S]*<\/main>/.exec(VISA_PAGE)![0];

describe("/visa's card scene, from the vic-5 record", () => {
  const s = visaCardScene()!;
  const paid = rec.purchases.find((p) => p.outcome.status === "succeeded")!;

  it("reads the paid purchase, the CFO's limit and approval, the card and the refusals from the record", () => {
    expect(rec.mode).toBe("live");
    expect(s.run).toBe(rec.run);
    expect(s.paid).toEqual({ amount: paid.request!.amount, merchant: paid.request!.merchant, proposal: paid.proposal_id, intent: paid.payment_intent_id, code: paid.outcome.code, model: paid.rail_choice!.model });
    const policy = rec.audit.find((a) => a.event === "airi.policy_initial")!.payload.values as Record<string, string>;
    expect(s.alone).toBe(policy["approval.airi_alone"]);
    expect(Number(s.paid.amount)).toBeGreaterThan(Number(s.alone));
    expect(rec.audit.some((a) => a.event === "proposal.approved" && a.subject === paid.proposal_id && a.payload.method === "passkey")).toBe(true);
    expect(rec.preflight.card.endsWith(s.last4)).toBe(true);
    const reused = rec.purchases.find((p) => p.outcome.code === "PURSER_CREDENTIAL_ALREADY_USED")!, cap = rec.purchases.find((p) => p.outcome.code === "PURSER_ABOVE_HARD_CAP")!;
    expect(s.refusals).toEqual([
      { what: "reused", amount: reused.request!.amount, code: "PURSER_CREDENTIAL_ALREADY_USED", calls: 0 },
      { what: "cap", amount: cap.request!.amount, code: "PURSER_ABOVE_HARD_CAP", cap: /hard cap of ([\d.]+)/.exec(cap.outcome.reason!)![1], calls: 0 },
    ]);
    expect(visaCardScene("docs/runs/no-such-run.json")).toBeNull();
  });

  it("opens /visa: the card, the four steps, the two refusals as chips, the honest line, then the card flow", () => {
    const hero = /<section class="vcard card" id="visa-card-hero"[\s\S]*?<\/section>/.exec(main)![0];
    expect(main.indexOf('id="visa-card-hero"')).toBeGreaterThan(main.indexOf("</h1>"));
    expect(main.indexOf('id="visa-card-hero"')).toBeLessThan(main.indexOf("<details"));
    expect(main.indexOf('id="visa-arch"')).toBeLessThan(main.indexOf("<details"));
    const t = text(hero);
    expect(t).toContain(`•••• •••• •••• ${s.last4}`);
    expect(t).toContain(`The spend EUR ${s.paid.amount} ${s.paid.merchant}`);
    expect(t).toContain(`Over the CFO's limit EUR ${s.alone} alone`);
    expect(t).toContain(`Face ID The CFO approves ${s.paid.proposal}`);
    expect(t).toContain(`Paid via Airi ${s.paid.code} ${s.paid.intent}`);
    expect(t).toContain("Same credential used again: refused PURSER_CREDENTIAL_ALREADY_USED");
    expect(t).toContain(`EUR ${s.refusals[1]!.amount}, over the EUR ${s.refusals[1]!.cap} hard cap: refused PURSER_ABOVE_HARD_CAP`);
    // As the records say it: Airi's credential on a test card, not a Visa network token; sandbox, test money.
    expect(t).toContain("Airi's credential on Airi's test card, not a Visa network token. Airwallex sandbox, test money; the run of 14 Nov (vic-5).");
    expect(text(visaArchHtml())).toBe("The card flow Agent asks to buy; Claude picks the rail Purser the CFO's limits, Face ID, the signed terms Airi a single-use credential for those terms Airwallex checkout sandbox: pays, the terms read back");
    // Visa as text only: no mark, no image, no style attribute, no script of its own.
    expect(hero).not.toMatch(/<img|style="|<script/);
    expect(visaCardHeroHtml(null)).toBe("");
  });

  it("plays once, and not at all under reduced motion", () => {
    const motion = /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/.exec(VISA_CARD_HERO_CSS)![0];
    expect(motion).toContain("animation");
    expect(VISA_CARD_HERO_CSS.replace(motion, "")).not.toMatch(/animation:/);
    expect(VISA_CARD_HERO_CSS).not.toMatch(/infinite/);
  });
});
