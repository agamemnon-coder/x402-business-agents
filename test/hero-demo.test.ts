// Home's hero demo (Max, 10 Nov): every figure from the Airwallex-only run's record, the tamper step labelled as the
// check every payment runs, a link to /try/sign, a still frame for reduced motion, and small enough to inline.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { DEMO_LABEL, DEMO_STEPS, HERO_DEMO_CSS, HERO_DEMO_JS, heroDemoFacts, heroDemoHtml } from "../src/redesign/heroDemo.js";

const rec = JSON.parse(readFileSync(new URL("../docs/demo/airwallex-run.json", import.meta.url), "utf8")) as { invoices: { invoice_no: string; amount: string; transfer_id: string; approval_sha256: string; proposal_id: string; status: string }[]; proposals: { proposal_id: string; terms_sha256: string; method: string; created_by: string }[] };

describe("the hero demo", () => {
  const f = heroDemoFacts()!;
  it("takes every figure from the record: the Treasury agent's invoice, its signed hash, Airwallex's transfer", () => {
    const inv = rec.invoices.find((i) => i.invoice_no === f.invoice)!;
    const p = rec.proposals.find((x) => x.proposal_id === inv.proposal_id)!;
    expect([inv.status, inv.amount, inv.transfer_id, inv.approval_sha256]).toEqual(["PAID", f.amount, f.transfer, f.hash]);
    expect([p.terms_sha256, p.method, p.created_by]).toEqual([f.hash, "passkey", "treasury"]);
    expect(Math.round(Number(f.tampered) * 100) - Math.round(Number(f.amount) * 100)).toBe(1);
  });

  it("tells four steps, labels the run and the tamper step, and links to /try/sign", () => {
    const html = heroDemoHtml(f);
    expect(DEMO_STEPS).toEqual(["Ask", "Face ID", "Paid", "Tamper refused"]);
    expect(html).toContain(DEMO_LABEL);
    expect(html).toContain("Step 4 is the check every payment runs.");
    expect(html).toContain('<a href="try/sign">Try it yourself →</a>');
    expect(html).toContain(f.transfer.slice(0, 8));
    expect(heroDemoHtml(null)).toBe("");
  });

  it("is on Home in the hero, light enough to inline, with a still frame for reduced motion", () => {
    const home = buildPages({ TRY_SIGN_ENABLED: "on" } as NodeJS.ProcessEnv).home!;
    expect(/<section class="hero">[\s\S]*?<\/section>/.exec(home)![0]).toContain('id="hero-demo"');
    expect(Buffer.byteLength(heroDemoHtml(f) + HERO_DEMO_CSS + HERO_DEMO_JS)).toBeLessThan(30_000);
    expect(HERO_DEMO_CSS).toContain("prefers-reduced-motion: reduce");
    expect(HERO_DEMO_JS).toContain("prefers-reduced-motion: reduce");
  });
});
