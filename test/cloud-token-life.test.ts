// One purchase, one token (cloud/src/tokenLife.ts, 23 Nov): the Tokenisation page leads with Airi's single-use
// credential's life as the vic-5 run record holds it (issued, bound, used once, reuse refused) and Purser's agent tokens as the
// partner-rails record holds them. Every figure from those records, every id masked, each with its label.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { tokenisation } from "../cloud/src/consoleData.js";
import { maskId, TOKEN_LIFE_CSS, TOKEN_LIFE_JS, tokenLifeOf } from "../cloud/src/tokenLife.js";

const VIC = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-14-vic-5.json", import.meta.url), "utf8")) as { label: string; credential_deleted: boolean; purchases: { step: string; mandate_id: string | null; payment_intent_id: string | null; terms_sha256: string | null; request: { amount: string } }[] };
const RAILS = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-20-partner-rails.json", import.meta.url), "utf8")) as { tokens: { token_id: string; token_last4: string }[] };

describe("the token's life", () => {
  const L = tokenLifeOf();
  const B = VIC.purchases.find((p) => p.step === "B")!;
  it("comes from the vic-5 record: issued, bound and read back, used once, reuse refused before any Airwallex call", () => {
    expect(L.vic.steps.map((s) => [s.key, s.ok])).toEqual([["issue", true], ["bind", true], ["use", true], ["reuse", true]]);
    expect(L.vic.steps[2]!.code).toBe("SUCCEEDED");
    expect(L.vic.steps[3]!.code).toBe("PURSER_CREDENTIAL_ALREADY_USED");
    expect(L.vic.purchase).toMatchObject({ amount: B.request.amount, currency: "EUR", model: "claude-haiku-5-5" });
    expect(L.vic.token).toMatchObject({ type: "DPAN", deleted: VIC.credential_deleted });
    expect(L.vic.label).toBe(VIC.label);
    expect(L.vic.misuse.map((m) => [m.key, m.code, m.calls])).toEqual([
      ["C", "PURSER_ABOVE_HARD_CAP", 0], ["D", "PURSER_MERCHANT_NOT_ALLOWED", 0], ["F1", "PURSER_CREDENTIAL_AMOUNT_MISMATCH", 0], ["F2", "PURSER_CREDENTIAL_ALREADY_USED", 0]]);
    expect(L.vic.first_try).toMatchObject({ code: "PURSER_NO_TAP" });
  });
  it("masks every id: no mandate, payment, terms hash or token id in full", () => {
    const all = JSON.stringify(L);
    for (const id of [B.mandate_id!, B.payment_intent_id!, B.terms_sha256!, ...RAILS.tokens.map((t) => t.token_id)]) {
      expect(all).not.toContain(id);
      expect(all).toContain(maskId(id)!);
    }
    expect(maskId("mdt_nlpdlr7dgho57xw5fpd")).toBe("mdt_nlpd…5fpd");
  });
  it("lists Purser's agent tokens with their mandates, uses and refusals, labelled as the recorded run", () => {
    expect(L.agent_tokens.tokens.map((t) => [t.agent, t.status, t.last4])).toEqual(RAILS.tokens.map((t, i) => [["sourcing", "support"][i], ["active", "revoked"][i], t.token_last4]));
    expect(L.agent_tokens.tokens[1]!.refused).toEqual(["OVER_PER_PURCHASE", "MCC_NOT_ALLOWED", "TOKEN_REVOKED"]);
    expect(L.agent_tokens.label).toMatch(/not this company's figures/);
  });
  it("is in GET /v1/tokenisation and on the page, drawn as text and moving only when motion is allowed", () => {
    expect((tokenisation() as { token_life: unknown }).token_life).toEqual(L);
    const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
    expect(html).toContain(TOKEN_LIFE_JS.trim());
    expect(html).toContain(TOKEN_LIFE_CSS.trim());
    expect(html).toContain("...tokenLifeSections(r.token_life),invoice");
    expect(TOKEN_LIFE_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(TOKEN_LIFE_JS).toContain("if(RM()||!('IntersectionObserver' in window))go();");
    expect(TOKEN_LIFE_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.tl-stop \{ transition: none; opacity: 1; transform: none; \}/);
    expect(TOKEN_LIFE_JS).toContain("sandbox:'Airwallex sandbox · Airi beta · test money'");
  });
  it("calls it Airi's single-use credential from one run, not a Visa network token per purchase, with no Visa mark (review, 21 Nov)", () => {
    expect(TOKEN_LIFE_JS).toContain("Airi\\'s single-use credential (Airi reports token_type DPAN; sandbox test card), one recorded run (vic-5)");
    expect(TOKEN_LIFE_JS).not.toMatch(/Each agent purchase|Visa network token|Visa-netwerktoken|BRAND_LOGOS\['visa/);
  });
});
