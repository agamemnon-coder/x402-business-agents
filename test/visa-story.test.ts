// /visa as one story (Visa judge, 14 Nov): what Visa Intelligent Commerce asks for, how Purser meets each one with its
// record, the reuse finding side by side, the three runs counted from their records, TAP shown openly, and what is not
// proven yet. Every count, code and amount is checked against the records here, not typed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VISA_TAP_STATUS } from "../src/config/brand.js";
import { visaPage } from "../src/redesign/partners.js";
import { shortId } from "../src/redesign/proofRuns.js";
import { proofPage } from "../src/redesign/proof.js";
import { homePage } from "../src/redesign/home.js";
import { liveRuns } from "../src/redesign/runs.js";
import { VISA_ASKS, VISA_ASKS_ID, VISA_MEETS_ID, VISA_NOT_YET, VISA_NOT_YET_ID, VISA_PLAN_FILE, VISA_REUSE_ID, VISA_RUNS3_ID, visaStoryFacts } from "../src/redesign/visaStory.js";

const html = visaPage();
const main = /<main[\s\S]*<\/main>/.exec(html)![0];
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const section = (id: string) => new RegExp(`<section[^>]*id="${id}"[\\s\\S]*?</section>`).exec(main)?.[0] ?? "";
const rec = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")) as R;
const v4 = rec("docs/runs/2026-11-14-vic-5.json"), v3 = rec("docs/runs/2026-11-12-vic-3.json"), airi = rec("docs/demo/airi-run.json"), mid = rec("docs/runs/2026-11-13-vic-4.json");
interface P {
  step: string; status?: string; terms_sha256: string; request: { amount: string; currency: string };
  outcome?: { status?: string; code?: string }; calls: { airwallex: number };
  read_back: { mandate: { terms_sha256_in_mandate: string }; payment_intent: { read_back: string } };
  negative_test: { airwallex: { outcome: string } };
}
interface R { run: string; purchases: P[]; audit: { event: string; payload: { values: Record<string, string> } }[] }
const step = (r: R, s: string) => r.purchases.find((p) => p.step === s)!;

describe("/visa, what Visa Intelligent Commerce asks for", () => {
  it("names four areas, each with a link to Visa's developer page, and the source table read on 14 Nov", () => {
    const s = section(VISA_ASKS_ID);
    expect(VISA_ASKS.map((a) => a.area)).toEqual(["Agent identity", "Payment credential", "Consumer authentication", "Intent, consent and limits"]);
    for (const a of VISA_ASKS) {
      expect(a.href).toMatch(/^https:\/\/developer\.visa\.com\//);
      expect(s).toContain(`href="${a.href}"`);
    }
    // The quoted terms are Visa's, and the plan file holds each one beside its source.
    const plan = readFileSync(new URL(`../${VISA_PLAN_FILE}`, import.meta.url), "utf8");
    for (const term of ["agent signatures", "agentic token", "one-time use", "Visa Payment Passkeys", "within the set instruction parameters"]) expect(plan).toContain(term);
    expect(text(s)).toContain("read 14 Nov 2026");
  });
});

describe("/visa, how Purser meets each one", () => {
  const s = text(section(VISA_MEETS_ID));
  it("binds the credential to one purchase: the codes and 0 Airwallex calls from vic-4, the sandbox's answer from vic-3", () => {
    const f1 = step(v4, "F1"), f2 = step(v4, "F2");
    expect([f1.outcome?.code, f2.outcome?.code]).toEqual(["PURSER_CREDENTIAL_AMOUNT_MISMATCH", "PURSER_CREDENTIAL_ALREADY_USED"]);
    expect([f1.calls.airwallex, f2.calls.airwallex]).toEqual([0, 0]);
    expect(s).toContain(`another amount, ${f1.outcome?.code}; a second use, ${f2.outcome?.code}; before any Airwallex call`);
    expect(s).toContain("Airi's credential, not a Visa agentic token");
  });

  it("says the passkey is Purser's, the hash read back for B, and the limits from the run's own policy row", () => {
    const b = step(v4, "B");
    expect(b.read_back.mandate.terms_sha256_in_mandate).toBe(b.terms_sha256);
    expect(b.read_back.payment_intent.read_back).toBe(b.terms_sha256);
    expect(s).toContain(`for B (${b.request.currency} ${b.request.amount}) Airi's mandate and Airwallex's PaymentIntent held the same hash`);
    expect(s).toContain("Purser's passkey, not a Visa Payment Passkey");
    const policy = v4.audit.find((a) => a.event === "airi.policy_initial")!.payload.values;
    expect(s).toContain(`up to EUR ${policy["approval.airi_alone"]} alone, ${policy["approval.airi_alone_per_day"]} a day`);
    expect(s).toContain(`over the hard cap ${step(v4, "C").outcome?.code}; a merchant not listed ${step(v4, "D").outcome?.code}`);
    expect(s).toContain(`(${v4.audit.length} rows)`);
  });

  it("says agent identity is not done yet in the Airi runs, and points to TAP below", () => {
    const row = /<li class="vs-row vs-no"><span class="vs-k">Agent identity<\/span>[\s\S]*?<\/li>/.exec(section(VISA_MEETS_ID))?.[0] ?? "";
    expect(text(row)).toMatch(/^Agent identity Not done yet in the Airi runs\./);
    expect(row).toContain("visa-tap-live-2026-11-02.json");
  });
});

describe("/visa, the reuse finding and the four runs", () => {
  it("sets the sandbox's answer (vic-3) beside Purser's refusal (vic-4)", () => {
    for (const f of ["F1", "F2"]) expect(step(v3, f).negative_test.airwallex.outcome).toBe("SUCCEEDED");
    const s = text(section(VISA_REUSE_ID));
    expect(s).toContain("A reused credential: Purser refused it, the sandbox did not");
    expect(s).toContain("both accepted (SUCCEEDED)");
    expect(s).toContain("PURSER_CREDENTIAL_AMOUNT_MISMATCH, PURSER_CREDENTIAL_ALREADY_USED");
  });

  // 14 Nov: four runs since vic-5 (the latest, its proof for the rows above); vic-4 counted as the run before it.
  it("counts each run from its record: 6 paid, 2 not confirmed in Airi", () => {
    const paid = airi.purchases.filter((p) => p.status === "SETTLED").length
      + [v3, mid, v4].reduce((n, r) => n + r.purchases.filter((p) => !/^F/.test(p.step) && p.outcome?.status === "succeeded").length, 0);
    const notConfirmed = [v3, mid, v4].reduce((n, r) => n + r.purchases.filter((p) => p.outcome?.code === "PURSER_NO_TAP").length, 0);
    expect([paid, notConfirmed]).toEqual([6, 2]);
    const s = text(section(VISA_RUNS3_ID));
    expect(s).toContain(`The 4 Visa runs: ${paid} paid, ${notConfirmed} not confirmed in Airi`);
    expect(s).toMatch(/7 Nov 2 0 1 airi-run\.json ↗ 12 Nov 1 1 3 2026-11-12-vic-3\.json ↗ 13 Nov 2 1 5 2026-11-13-vic-4\.json ↗ 14 Nov 1 0 4 2026-11-14-vic-5\.json ↗/);
    expect(visaStoryFacts()!.v4.run).toBe("vic-5");
  });
});

describe("/visa, TAP openly and what is not proven yet", () => {
  it("shows TAP with its status, its record and what it does not prove", () => {
    const s = text(section("visa-tap"));
    expect(s.startsWith(`Outside the entry: Visa TAP ${VISA_TAP_STATUS}`)).toBe(true);
    expect(s).toContain("not Visa's directory, and Visa has not approved the agent");
    expect(s).toContain("visa-tap-live-2026-11-02.json");
  });

  it("ends with what is not proven yet, word for word", () => {
    expect(text(section(VISA_NOT_YET_ID))).toBe(`What is not proven yet ${VISA_NOT_YET.join(" ")}`);
  });
});

describe("the Visa outcome on Home and /proof", () => {
  it("links each to the new sections", () => {
    expect(homePage()).toContain('href="visa#visa-reuse"');
    expect(proofPage()).toContain(`visa#${VISA_MEETS_ID}`);
  });
});

// Jury round 3, 14 Nov: each finding checked against the records before the fix.
describe("jury round 3, the Visa findings", () => {
  it("/proof's 7 Nov Visa card, named for the purchase above the limit, leads with that purchase's PaymentIntent", () => {
    const b = (airi as unknown as { purchases: { step: string; approved_at?: string; payment_intent_id?: string; amount: string }[] }).purchases.find((p) => p.approved_at)!;
    expect([b.step, b.amount, b.payment_intent_id]).toEqual(["B", "45.00", "int_sgpvzc9hjhnxvxc26ie"]);
    // Max, 14 Nov: ids are short in sight on /proof, whole on hover and in the copy button.
    const p = proofPage().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(p).toContain(`Payment intent, EUR ${b.amount}, after Face ID ${shortId(b.payment_intent_id!)}`);
    const row = /<li id="run-vic-1"[\s\S]*?<\/li>/.exec(proofPage())![0];
    expect(row).toContain(`title="${b.payment_intent_id}"`);
    expect(row).toContain(`data-copy="${b.payment_intent_id}"`);
    expect(liveRuns().find((r) => r.key === "vic-1")?.ids[0]?.value).toBe(b.payment_intent_id);
  });

  it("the flow's lane no purchase reached says so (vic-5 has none within the limit)", () => {
    const lane = /<div class="vh-lane vh-l-ok[^"]*">[\s\S]*?<\/div>/.exec(main)![0];
    expect(v4.purchases.some((p) => p.outcome?.status === "succeeded" && !(p as unknown as { approved_at?: string }).approved_at && p.step !== "B")).toBe(false);
    expect(lane).toContain("vh-empty");
    expect(text(lane)).toMatch(/None in this run\.$/);
  });

  it("says of production only what the sources say", () => {
    const s = text(main);
    expect(s).toContain("Airi's instructions give the agent a tokenised card number, expiry and CVV for one checkout; how a production checkout differs is not documented in what we could read.");
    expect(readFileSync(new URL("../docs/plans/vic-airi.md", import.meta.url), "utf8")).toContain('"A tokenized PAN, expiry, and CVV for one checkout"');
    expect(s).not.toMatch(/never sees card data/);
  });

  it("llms.txt has no N of N fractions and names the latest Visa run with its record", () => {
    const t = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
    expect(t).not.toMatch(/\b(\d+) of \1 checks\b/);
    expect(t).toContain("all seven checks passed");
    expect(t).toContain("all five checks passed");
    expect(t).toContain("docs/runs/2026-11-14-vic-5.md");
    expect(t).toContain(`(${step(v4, "F1").outcome?.code}, ${step(v4, "F2").outcome?.code}) before any call`);
  });
});
