// The Airi run on the site (7 Nov): a single-use card credential from Airwallex's Airi wallet, in a separate world, shows
// on /airwallex and in Proof's "Airwallex, read back", dated and labelled "Airwallex sandbox, test card, test money",
// every figure and id from its record (docs/demo/airi-run.json), nothing private (no Airi link, no card number, no
// passkey label or credential, no viewer key, no full hash), no card-network programme named (docs/runs/vic-1-plan.md), and
// nothing at all without a live record with test money and the test card.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { AIRI_CREDENTIAL, AIRI_RUN_FILE, AIRI_RUN_LABEL, AIRI_RUN_LOG, airiRun, airiRunBlock, airiRunHtml, airiRunSummary, type AiriRunRecord } from "../src/redesign/airiRun.js";

const RAW = readFileSync(AIRI_RUN_FILE, "utf8");
const rec = JSON.parse(RAW) as AiriRunRecord;
const LOG = readFileSync(AIRI_RUN_LOG, "utf8");
const pages = buildPages() as unknown as Record<string, string>;
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The block on a page: in full on /airwallex (its steps in a fold), short on /proof (a link to them). */
const block = (html: string) => (html === pages.proof ? /<div class="card" id="airi-run">[\s\S]*?<\/a><\/div>/ : /<div class="card" id="airi-run">[\s\S]*?<\/details><\/div>/).exec(html)?.[0] ?? "";
const buy = (s: string) => rec.purchases.find((p) => p.step === s)!;
/** No one-time Airi link, viewer or runner key, card-like number, passkey label or credential id. */
const PRIVATE = [/airi\.com/i, /#view=|view=|runner=|view_key|viewer/i, /\b\d{13,19}\b/, /\(passkey [A-Za-z0-9_-]+\)/, /credential_id|assertion_sha256|public_key|payment_method_id/, /\bENROL\b/];

describe("the Airi run on the site", () => {
  it("reads the committed live record: test money, the test card, the second attempt in world vic-1c, all five checks", () => {
    expect(airiRun()).toMatchObject({ run: "vic-1", world: "vic-1c", attempt: 2, mode: "live", test_money: true, test_card: true, label: AIRI_RUN_LABEL });
    expect(Object.values(rec.checks).every((c) => c.ok)).toBe(true);
    expect(Object.keys(rec.checks)).toEqual(["a_alone", "a_answered", "b_cfo_first", "b_ran_after_face_id", "c_refused_by_purser"]);
    expect(rec.started_at.slice(0, 10)).toBe("2026-11-07");
  });

  it("shows on /airwallex and in Proof's Airwallex read back, dated and labelled sandbox, test card, test money", () => {
    for (const name of ["airwallex", "proof"]) {
      const t = text(block(pages[name]!));
      expect({ name, t }).toEqual({ name, t: expect.stringContaining(`7 November, the Airi run: a separate run · ${AIRI_RUN_LABEL}`) });
      expect(t).toContain("5 of 5 checks pass");
      expect(t).toContain(AIRI_CREDENTIAL);
    }
    // On /airwallex below awx-1; on Proof under the "Airwallex, read back" heading, after awx-1, short, linking to the
    // steps on /airwallex, whose fold opens on arrival.
    expect(pages.airwallex!.indexOf('id="airi-run"')).toBeGreaterThan(pages.airwallex!.indexOf('id="awx-1"'));
    expect(pages.proof!.indexOf('id="airi-run"')).toBeGreaterThan(pages.proof!.indexOf('id="awx-1"'));
    expect(pages.proof!.indexOf('id="airi-run"')).toBeGreaterThan(pages.proof!.indexOf('id="airwallex-readback"'));
    expect(block(pages.proof!)).toContain('href="airwallex#airi-run-steps"');
    expect(pages.airwallex!).toContain('<details class="fold" id="airi-run-steps">');
    expect(text(block(pages.proof!))).toContain(`The Sourcing agent paid with ${AIRI_CREDENTIAL}: EUR ${buy("A").amount} within the CFO's limit alone, EUR ${buy("B").amount} only after the CFO's Face ID; a merchant the CFO does not allow was refused by Purser before Airi.`);
  });

  it("names every id and code of the passing attempt, from the record", () => {
    const t = text(block(pages.airwallex!));
    const a = buy("A"), b = buy("B"), c = buy("C");
    for (const x of [a.mandate_id!, a.payment_intent_id!, b.proposal_id!, b.mandate_id!, b.payment_intent_id!, c.code!, b.terms_sha256!.slice(0, 8)]) expect({ x, shown: t.includes(x) }).toEqual({ x, shown: true });
    expect(t).toContain(`PaymentIntent ${a.payment_intent_id} SUCCEEDED, reported to Airi`);
    expect(t).toContain(`PaymentIntent ${b.payment_intent_id} SUCCEEDED: P-0002 EXECUTED`);
    expect(t).toContain(`within the CFO's limit of EUR ${rec.policy.alone_max_eur} for this rail`);
    expect(t).toContain(`refused by Purser, PURSER_MERCHANT_NOT_ALLOWED, with 0 Airi calls`);
    expect(t).toContain(`${rec.calls.airwallex.this_attempt} Airwallex API calls`);
    expect(t).toContain("our own sandbox merchant on Airwallex's hosted checkout page");
    expect(t).toContain("The second attempt in this world");
    expect(t).toContain(AIRI_RUN_FILE);
    expect(block(pages.airwallex!)).toContain(AIRI_RUN_LOG);
  });

  it("has no number the record does not hold", () => {
    const counted = new Set([String(Object.keys(rec.checks).length)]);
    const inRecord = new Set((RAW.match(/\d+(?:\.\d+)*/g) ?? []));
    // Ids, the record's file name and the short terms hash are names, not figures.
    const t = text(block(pages.airwallex!) + block(pages.proof!)).replace(/\b(?:int|mdt)_[a-z0-9]+/g, " ").replace(/P-\d{4}/g, " ").replace(/[0-9a-f]{8}…/g, " ").replace(/airi-run\.json/g, " ");
    const unknown = (t.match(/\d+(?:\.\d+)*/g) ?? []).filter((n) => !inRecord.has(n) && !counted.has(n));
    expect(unknown).toEqual([]);
  });

  it("shows nothing private, and names no card-network programme and not the run's working name", () => {
    for (const name of ["airwallex", "proof"]) {
      const b = block(pages[name]!);
      for (const re of PRIVATE) expect({ name, re: String(re), found: re.exec(b)?.[0] ?? null }).toEqual({ name, re: String(re), found: null });
      expect(b).not.toMatch(/\b[0-9a-f]{64}\b/);
      expect(text(b)).not.toMatch(/Intelligent Commerce|\bVIC\b|vic-1|emulat/i);
    }
    // The record and the run log too: ids, hashes and codes only.
    for (const [name, body] of [["record", RAW], ["run log", LOG]] as const) {
      for (const re of PRIVATE) expect({ name, re: String(re), found: re.exec(body)?.[0] ?? null }).toEqual({ name, re: String(re), found: null });
      expect(body).not.toMatch(/Intelligent Commerce|\bVIC\b/);
      expect(body).not.toMatch(/code decides/i);
    }
    // Every mention of the card in the run log says it is the test card.
    expect(LOG).toContain("visa •••• 1111");
    for (const line of LOG.split("\n").filter((l) => l.includes("•••• 1111"))) expect({ line, test: /test card/.test(line) }).toEqual({ line, test: true });
  });

  it("tells every attempt in the run log, the failed ones included", () => {
    for (const x of rec.attempts) expect({ world: x.world, at: LOG.includes(x.at.slice(11, 19)) }).toEqual({ world: x.world, at: true });
    for (const code of ["AIRI_OUTPUT_UNRECOGNISED", "validation_error", "not enabled for native API access", "PURSER_NO_TAP", "duplicate_request", "1b5cbd4", "b252cd3", "2016aac"]) expect({ code, told: LOG.includes(code) }).toEqual({ code, told: true });
  });

  it("shows nothing without a live record, or when a fact it needs is missing; a failed check shows as failed", () => {
    expect(airiRunBlock(null)).toBe("");
    expect(airiRunHtml(null)).toBe("");
    expect(airiRun("docs/demo/no-such-run.json")).toBeNull();
    expect(airiRunSummary({ ...rec, purchases: rec.purchases.filter((p) => p.step !== "B") })).toBeNull();
    // A failed check shows as such, never as passed.
    const failed = airiRunHtml(airiRunSummary({ ...rec, checks: { ...rec.checks, c_refused_by_purser: { ok: false, detail: "x" } } }));
    expect(text(failed)).toContain("4 of 5 checks pass");
    expect(failed).toContain('class="awm bad"');
  });
});
