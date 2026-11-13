// What the sandbox could not show, on /visa (jury panel, 12 Nov): the five facts under the drawing, outside any fold,
// in at most five short lines; purchase B in three columns with equal amounts (signed by the CFO, sent to Airi,
// charged); the attempts that failed first, listed in a fold. Every line and value is held here to the raw records:
// docs/demo/airi-run.json, the run log, and Airwallex's own record of the two payments. No network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { airiRun, type AiriRunRecord } from "../src/redesign/airiRun.js";
import { visaPage } from "../src/redesign/partners.js";
import { VIC_ATTEMPTS_ID, VIC_COMPARE_COLUMNS, VIC_COMPARE_ID, VIC_FACTS_ID, vicAttemptCount, vicAttemptLines, vicAttemptsHtml, vicCompare, vicCompareHtml, vicFacts, vicFactsHtml, HEADLESS_LINE } from "../src/redesign/vicFacts.js";
import { visaFlowHtml } from "../src/redesign/visaHero.js";
import { vic3Run } from "../src/redesign/vic3Run.js";
import { vicNetworkRecord } from "../src/redesign/vicNetwork.js";

const raw = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const LOG = readFileSync(new URL("../docs/runs/2026-11-07-vic-1.md", import.meta.url), "utf8");
const rec = airiRun()!;
const airi = raw("docs/demo/airi-run.json");
const html = visaPage(), main = /<main[\s\S]*<\/main>/.exec(html)![0];
const unfolded = main.replace(/<details\b[\s\S]*?<\/details>/g, " ");

describe("the four facts under the drawing, the headless browser beside the purchase flow", () => {
  const facts = vicFacts(rec);

  // The jury check of 12 Nov: the attempt history is folded ("The N attempts that failed first"); in sight, the headless
  // browser said to be sandbox only, and the production path (a network token, no card number in the agent's process).
  // Partner review, 13 Nov: the headless browser (sandbox only) moved from this list to right under /visa's purchase flow,
  // next to purchase B (src/redesign/visaHero.ts, HEADLESS_LINE); it is still said once, in sight.
  it("are four short lines, each backed by the record: test credential, one person in both roles, the production path, our own merchant; the headless browser sits under the purchase flow", () => {
    expect(visaFlowHtml(vic3Run()!)).toContain(HEADLESS_LINE);
    expect(facts).toEqual([
      "The credential is a test credential, from Airi's test card.",
      "One person played both the CFO and the cardholder.",
      "In production no card number would enter the agent's process: the merchant would get a network token via the Connect access above.",
      "The merchant is Purser's own sandbox account.",
    ]);
    expect(facts.join(" ")).not.toMatch(/attempt/);
    for (const f of facts) expect({ f, words: f.split(" ").length <= 22 }).toEqual({ f, words: true });
    // 1. The record: a test card, and the record's own words on what the sandbox cannot show.
    expect(airi.test_card).toBe(true);
    expect(airi.not_shown).toMatch(/the card is Airi's test card, whose credential is a test credential/);
    // 2. Both roles, one person: every paid purchase's tap in Airi is the CFO's, by the record; the run log names one person for both.
    const paid = airi.purchases.filter((p: { outcome?: string }) => p.outcome === "SUCCEEDED") as { tap: string }[];
    expect(paid).toHaveLength(2);
    for (const p of paid) expect(p.tap).toMatch(/^the CFO, once, with a passkey in Airi/);
    // 3. Four attempts that day, the fourth passed.
    expect(airi.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(["stopped", "failed", "failed", "passed"]);
    expect(vicAttemptCount(rec)).toMatchObject({ all: 4, paid: 1, passedAt: 4, failedFirst: true });
    // 4. The hosted page with a headless browser, because the sandbox refused the direct confirm (the second attempt).
    expect(airi.checkout.kind).toBe("airwallex-sandbox-hosted");
    expect(airi.attempts[1].cause).toMatch(/our Airwallex sandbox refused the API confirm, validation_error \("This account is not enabled for native API access"\)/);
    expect(LOG).toMatch(/headless Chromium, `checkout\.sandbox\.airwallex\.com` only/);
    // 5. Our own merchant.
    expect(airi.checkout.what).toMatch(/for our own Airwallex sandbox merchant account/);
    expect(airi.not_shown).toMatch(/the merchant is our own Airwallex sandbox account/);
  });

  it("stand on /visa right under the drawing, outside any fold, and say \"with no Purser approval\", never \"without the CFO\"", () => {
    const at = unfolded.indexOf(`id="${VIC_FACTS_ID}"`);
    expect(at).toBeGreaterThan(unfolded.indexOf('id="vic-flow"'));
    expect(at).toBeLessThan(unfolded.indexOf(`id="${VIC_COMPARE_ID}"`));
    const list = /<ul class="pl vfacts"[\s\S]*?<\/ul>/.exec(unfolded)![0];
    expect([...list.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]!.replace(/&#39;/g, "'"))).toEqual(facts);
    expect(list.match(/<li>/g)!.length).toBeLessThanOrEqual(5);
    expect(text(html)).not.toMatch(/without the CFO/);
    expect(text(html)).toMatch(/within Purser's limit with no Purser approval/);
    expect(vicFactsHtml([])).toBe("");
  });

  it("stop the page build when a live record no longer backs a line, instead of saying it anyway", () => {
    const without = (change: (r: AiriRunRecord) => AiriRunRecord) => () => vicFacts(change(structuredClone(rec)));
    expect(without((r) => ({ ...r, test_card: false }))).toThrow(/test card/);
    expect(without((r) => ({ ...r, purchases: r.purchases.map((p) => (p.step === "A" ? { ...p, tap: "the cardholder, once, with a passkey in Airi" } : p)) }))).toThrow(/who confirmed/);
    expect(without((r) => ({ ...r, attempts: r.attempts.map((a) => ({ ...a, outcome: "failed" })) }))).toThrow(/attempts/);
    expect(without((r) => ({ ...r, checkout: { ...r.checkout, kind: "airwallex-sandbox" } }))).toThrow(/hosted page/);
    expect(without((r) => ({ ...r, attempts: r.attempts.map((a) => ({ ...a, cause: null })) }))).toThrow(/refused the direct confirm/);
    expect(without((r) => ({ ...r, checkout: { ...r.checkout, what: "A real shop's page; the agent types the card" } }))).toThrow(/merchant/);
    // A run that passed first time says "first".
    const first = structuredClone(rec);
    first.attempts = [first.attempts[1]!, first.attempts[3]!].map((a, i) => ({ ...a, outcome: i === 1 ? "passed" : "failed" }));
    expect(vicAttemptCount(first).passedAt).toBe(2);
  });

  it("count the series, wherever a failure falls: 2 of 5 paid, with a failure after a pass, builds the page's lines", () => {
    // The day's five attempts: the record's own (vic-1c #2) passed third; vic-1d #1 passed fourth, then vic-1d #2 failed.
    const series = structuredClone(rec);
    const day = series.started_at.slice(0, 10);
    series.attempts = [
      series.attempts[0]!, series.attempts[1]!, series.attempts[3]!,
      { world: "vic-1d", attempt: 1, at: `${day}T15:00:00.000Z`, outcome: "passed", cause: null },
      { world: "vic-1d", attempt: 2, at: `${day}T15:30:00.000Z`, outcome: "failed", cause: "B: PURSER_NO_TAP. Nothing charged." },
    ];
    const n = vicAttemptCount(series);
    expect(n).toMatchObject({ all: 5, paid: 2, passedAt: 3, failedFirst: false });
    expect(n.failed.map((a) => a.world)).toEqual(["vic-1", "vic-1b", "vic-1d"]);
    expect(vicAttemptLines(series).at(-1)).toBe("15:30 UTC, failed: the cardholder did not confirm in time (PURSER_NO_TAP). Nothing charged.");
    expect(/<summary>([^<]*)<\/summary>/.exec(vicAttemptsHtml(series))![1]).toBe("The 3 attempts that failed");
    // An attempt of another day is not part of the series; the record's own attempt must be among the day's.
    expect(vicAttemptCount({ ...series, attempts: [...series.attempts, { world: "vic-1e", at: "2026-11-08T09:00:00.000Z", outcome: "failed", cause: null }] }).all).toBe(5);
    expect(() => vicAttemptCount({ ...series, attempt: 9 })).toThrow(/own attempt/);
  });
});

describe("purchase B: signed, sent, charged", () => {
  const net = vicNetworkRecord()!;
  const c = vicCompare(rec, net)!;
  const b = airi.purchases.find((p: { step: string }) => p.step === "B");
  const intent = raw(net.file).payment_intents.find((p: { purchase: string }) => p.purchase === "B");

  it("shows equal amounts in its three columns: the terms the CFO signed, the mandate built from them, Airwallex's own record", () => {
    expect(VIC_COMPARE_COLUMNS).toEqual(["Signed by the CFO", "Sent to Airi", "Charged"]);
    expect(c.heading).toBe("Purchase B: signed, sent, charged");
    const amount = c.rows.find((r) => r.name === "Amount")!;
    // The middle cell is the signed amount, said so (the record of 7 Nov holds no amount read back from Airi), and the
    // mark compares only what was compared: the signed and the charged amount.
    expect(amount.values).toEqual(["EUR 45.00", "EUR 45.00", "EUR 45.00"]);
    expect(amount).toMatchObject({ sub: [null, "from the signed terms", null], equal: true, mark: "signed = charged" });
    // Signed and sent: purchase B's terms in the Airi run's record. Charged: Airwallex's own answer, a separate record.
    expect(`${b.currency} ${b.amount}`).toBe(amount.values[0]);
    expect(intent.id).toBe(b.payment_intent_id);
    expect(`${intent.intent.currency} ${Number(intent.intent.amount).toFixed(2)}`).toBe(amount.values[2]);
    expect(c.rows.find((r) => r.name === "Record")!.values).toEqual([`${b.proposal_id} · terms ${b.terms_sha256.slice(0, 8)}…`, b.mandate_id, b.payment_intent_id]);
    // What the middle column rests on is said under the table: the mandate is built from the signed terms; this record
    // holds its id, not Airi's own copy of the amount.
    expect(c.note).toBe("Purser builds the mandate from the signed terms only; this record holds the mandate's id, not Airi's copy of the amount. Charged: Airwallex's own record, read 12 Nov.");
    expect(readFileSync(new URL("../src/airi/purchase.ts", import.meta.url), "utf8")).toMatch(/function mandateFromTerms\(t: AiriTerms, actionId: string\): AiriMandateRequest/);
  });

  it("stands on /visa outside any fold, each value under its column's name, marked equal", () => {
    const section = /<section class="card vc"[\s\S]*?<\/section>/.exec(unfolded)![0];
    expect(text(section)).toMatch(/^Purchase B: signed, sent, charged Signed by the CFO Sent to Airi Charged Amount ✓ signed = charged Signed by the CFO EUR 45\.00 Sent to Airi EUR 45\.00 from the signed terms Charged EUR 45\.00 Record/);
    expect(section).toContain(net.file);
    expect(vicCompareHtml(null)).toBe("");
  });

  it("marks a difference as one, and is left out without Airwallex's record of the payment", () => {
    const other = structuredClone(net);
    (other.rec.payment_intents.find((p) => p.purchase === "B")!.intent as { amount: number }).amount = 54;
    const d = vicCompare(rec, other)!;
    expect(d.rows[0]).toMatchObject({ values: ["EUR 45.00", "EUR 45.00", "EUR 54.00"], equal: false });
    expect(vicCompareHtml(d)).toContain("✕ signed ≠ charged");
    expect(vicCompare(rec, null)).toBeNull();
    expect(vicCompare({ ...rec, purchases: rec.purchases.filter((p) => p.step !== "B") }, net)).toBeNull();
  });

  it("shows the terms hash read back from the mandate only when a record holds it; the record of 7 November has none, and nothing is said", () => {
    expect(b.mandate_terms_sha256).toBeUndefined();
    expect(c.rows.map((r) => r.name)).toEqual(["Amount", "Record"]);
    expect(text(html)).not.toMatch(/read back from Airi/);
    // A later record with the hash read back from Airi's mandate: a third row, equal to what the CFO signed.
    const later = structuredClone(rec);
    const lb = later.purchases.find((p) => p.step === "B")!;
    lb.mandate_terms_sha256 = lb.terms_sha256;
    const l = vicCompare(later, net)!;
    expect(l.rows[2]).toEqual({ name: "Terms hash", values: [`${lb.terms_sha256!.slice(0, 8)}…`, `${lb.terms_sha256!.slice(0, 8)}… read back from Airi`, "not sent to Airwallex"], equal: true });
    expect(l.note).toBe("Purser builds the mandate from the signed terms only. Charged: Airwallex's own record, read 12 Nov.");
    lb.mandate_terms_sha256 = "f".repeat(64);
    expect(vicCompare(later, net)!.rows[2]!.equal).toBe(false);
  });
});

describe("the attempts that failed first", () => {
  it("are listed in a fold, one line each from the record: time, outcome, the codes of its cause; no person is named", () => {
    const lines = vicAttemptLines(rec);
    expect(lines).toEqual([
      "12:51 UTC, stopped: Airi's answer came in another spelling (AIRI_OUTPUT_UNRECOGNISED). Nothing charged.",
      "12:56 UTC, failed: the sandbox refused a direct confirm (validation_error); the cardholder did not confirm in time (PURSER_NO_TAP). Nothing charged.",
      "13:30 UTC, failed: the cardholder did not confirm in time (PURSER_NO_TAP); an order reference was reused (duplicate_request). Nothing charged.",
    ]);
    const failed = (airi.attempts as { at: string; outcome: string; cause: string }[]).filter((a) => a.outcome !== "passed");
    expect(lines).toHaveLength(failed.length);
    failed.forEach((a, i) => {
      expect(lines[i]!.startsWith(`${a.at.slice(11, 16)} UTC, ${a.outcome}`)).toBe(true);
      expect(a.cause).toMatch(/nothing charged/i);
      for (const code of [...lines[i]!.matchAll(/\(([A-Za-z_]+)\)/g)].map((m) => m[1]!)) expect({ code, inCause: a.cause.includes(code), inLog: LOG.includes(code) }).toEqual({ code, inCause: true, inLog: true });
    });
    const fold = new RegExp(`<details class="fold" id="${VIC_ATTEMPTS_ID}">[\\s\\S]*?</details>`).exec(main)![0];
    expect(/<summary>([^<]*)<\/summary>/.exec(fold)![1]).toBe("The 3 attempts that failed first");
    for (const l of lines) expect(text(fold)).toContain(l);
    expect(fold).toContain("docs/runs/2026-11-07-vic-1.md");
    expect(text(fold)).not.toMatch(/\bMax\b/);
    // A run that passed first time has no such fold.
    expect(vicAttemptsHtml({ ...rec, attempts: rec.attempts.filter((a) => a.outcome === "passed") })).toBe("");
  });
});
