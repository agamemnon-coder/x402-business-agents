// The Airi run on the site (7 Nov): Visa Intelligent Commerce via Airwallex's Airi, a separate world, shows on /airwallex
// (in full), on /visa (in full, under the page's VIC heading, drawing and overview, above the TAP section; 12 Nov) and on
// /proof under the partners (short), dated and
// labelled "Airwallex sandbox, test card, test money", in the owner's copy of 7 Nov word for word (the heading, the
// summary sentence, purchase A's two sentences, the three outcome badges, every check linked to the run log's
// checks section), every figure and id from its record (docs/demo/airi-run.json), the ids in a "Details" fold, nothing
// private (no Airi link, no card number, no passkey label or credential, no viewer key, no full hash), no person's name
// for the cardholder or the CFO, and nothing at all without a live record with test money and the test card.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import { VISA_ENTRY_LINE } from "../src/redesign/partners.js";
import { AIRI_A_SENTENCE, AIRI_BADGES, AIRI_CHECKS_URL, AIRI_CREDENTIAL, AIRI_RUN_FILE, AIRI_RUN_LABEL, AIRI_RUN_LOG, AIRI_SUMMARY, airiHeading, airiSummaryLine, airiRun, airiRunBlock, airiRunHtml, airiRunSummary, type AiriRunRecord } from "../src/redesign/airiRun.js";

const RAW = readFileSync(AIRI_RUN_FILE, "utf8");
const rec = JSON.parse(RAW) as AiriRunRecord;
const LOG = readFileSync(AIRI_RUN_LOG, "utf8");
const pages = buildPages() as unknown as Record<string, string>;
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The block on a page: in full on /airwallex and /visa (its ids in a fold), short on /proof (a link to them). */
const block = (html: string) => (html === pages.proof ? /<div class="card airi" id="airi-run">[\s\S]*?<\/a><\/div>/ : /<div class="card airi" id="airi-run">[\s\S]*?<\/details><\/div>/).exec(html)?.[0] ?? "";
/** The block without its fold: what a visitor reads before opening anything. */
const inSight = (html: string) => text(block(html).replace(/<details[\s\S]*?<\/details>/, " "));
const PAGES = ["airwallex", "visa", "proof"] as const;
/** The owner's copy (7 Nov), word for word; the summary since 12 Nov (jury panel): the run was scripted, and within the limit it is "with no Purser approval". */
const HEADING = "Visa Intelligent Commerce via Airwallex's Airi: a live run (7 Nov)";
const SUMMARY = "A scripted run, no Claude call: paid with a Visa (VIC) credential from Airi that Purser binds to one purchase, each purchase confirmed by the cardholder's passkey: within Purser's limit with no Purser approval, above it only after the CFO's Face ID; a disallowed merchant was refused by Purser first.";
const A_SENTENCE = "Within Purser's limit, no Purser approval is needed. Airi itself asks the cardholder to confirm each purchase with a passkey.";
const BADGES = ["✓ Within the limit", "✓ Paid after Face ID", "✕ Refused by Purser"];
const CHECKS_URL = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-07-vic-1.md#checks-the-records-checks";
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

  it("says the owner's copy word for word on /airwallex, /visa and /proof: heading, summary, A's sentences, the three badges, every check linked", () => {
    expect([airiHeading("7 Nov"), airiSummaryLine(rec), AIRI_A_SENTENCE, Object.values(AIRI_BADGES), AIRI_CHECKS_URL]).toEqual([HEADING, SUMMARY, A_SENTENCE, BADGES, CHECKS_URL]);
    expect(SUMMARY.endsWith(AIRI_SUMMARY)).toBe(true);
    for (const name of PAGES) {
      const html = block(pages[name]!), t = inSight(pages[name]!);
      expect({ name, found: html.length > 0 }).toEqual({ name, found: true });
      // In sight, in this order: the heading, the label, the summary, A, B, C with their badges, the checks.
      const order = [HEADING, `A separate run · ${AIRI_RUN_LABEL}`, SUMMARY, `${BADGES[0]} EUR ${buy("A").amount} (Purser's limit: EUR ${rec.policy.alone_max_eur}). ${A_SENTENCE}`,
        `${BADGES[1]} EUR ${buy("B").amount}, above the limit: Purser asked Airi only after the CFO's Face ID on the exact terms.`,
        `${BADGES[2]} EUR ${buy("C").amount} at a merchant the CFO does not allow: refused before Airi was asked (0 Airi calls).`, "Every check passes"].map((x) => ({ x, at: t.indexOf(x) }));
      for (const o of order) expect({ name, x: o.x, shown: o.at >= 0 }).toEqual({ name, x: o.x, shown: true });
      expect(order.map((o) => o.at)).toEqual([...order.map((o) => o.at)].sort((x, y) => x - y));
      // The checks link to the run log's checks section on GitHub, which lists all five.
      expect({ name, link: html.includes(`href="${CHECKS_URL}" target="_blank" rel="noopener"`) }).toEqual({ name, link: true });
      // No ids in sight: they are behind "Details".
      for (const id of [buy("A").mandate_id!, buy("A").payment_intent_id!, buy("B").proposal_id!, buy("B").mandate_id!, buy("B").payment_intent_id!, buy("B").terms_sha256!.slice(0, 8), buy("C").code!])
        expect({ name, id, inSight: t.includes(id) }).toEqual({ name, id, inSight: false });
      // Every sentence in the block starts with a capital (or a badge, a figure, a code).
      for (const sentence of text(html).split(/(?<=[.!?])\s+/).filter(Boolean)) expect({ name, sentence, lower: /^[a-z]/.test(sentence.trim()) && !/^(a_|b_|c_|int_|mdt_|run log)/.test(sentence.trim()) }).toEqual({ name, sentence, lower: false });
      // The old contradiction is gone: no "alone, no CFO" beside the CFO confirming it.
      expect(text(html)).not.toMatch(/no CFO\. the CFO|the CFO confirmed it once in Airi/);
    }
    // The run log's checks section is the one the link names, with the record's five checks.
    expect(LOG).toMatch(/^## Checks \(the record's `checks`\)$/m);
    for (const k of Object.keys(rec.checks)) expect(LOG.split(/^## Checks/m)[1]!.split(/^## /m)[0]).toContain(`| ${k} | ✅ |`);
    // The ids behind a fold called "Details" on /airwallex and /visa; on /proof a link to them on /airwallex.
    for (const name of ["airwallex", "visa"] as const) {
      expect(block(pages[name]!)).toContain('<details class="fold" id="airi-run-steps"><summary>Details</summary>');
      // The five checks named in the fold, each with its result, from the record.
      // Each check in words (its key only as the item's title, jargon out: 10 Nov).
      // (The record's "A ran without the CFO" reads "with no Purser approval" on the page: the same person confirmed A in Airi, as the cardholder.)
      for (const [k, c] of Object.entries(rec.checks)) { expect(text(block(pages[name]!))).toContain(`✓ ${c.detail.charAt(0).toUpperCase()}${c.detail.slice(1)}`.replace("without the CFO", "with no Purser approval")); expect(block(pages[name]!)).toContain(`title="${k}"`); }
    }
    expect(block(pages.proof!)).toContain('href="airwallex#airi-run-steps"');
    expect(text(block(pages.proof!))).toContain("Details: every step and id");
  });

  it("sits below awx-1 on /airwallex, on /visa under the VIC heading and above the TAP section, and in sight under the partners on /proof", () => {
    expect(pages.airwallex!.indexOf('id="airi-run"')).toBeGreaterThan(pages.airwallex!.indexOf('id="awx-1"'));
    expect(pages.airwallex!).toContain('<details class="fold" id="airi-run-steps">');
    // /visa (12 Nov): under the page's h1, which is the VIC heading, and above the TAP section and its flow; its
    // heading an h2 there, an h3 on /airwallex.
    const visa = pages.visa!;
    expect(visa.indexOf('id="airi-run"')).toBeGreaterThan(visa.indexOf("<h1"));
    expect(visa.indexOf('id="airi-run"')).toBeLessThan(visa.indexOf('id="visa-tap"'));
    expect(visa.indexOf('id="airi-run"')).toBeLessThan(visa.indexOf('class="flow card'));
    expect(block(visa)).toMatch(/<h2 class="airi-h">/);
    expect(block(pages.airwallex!)).toMatch(/<h3 class="airi-h">/);
    // /visa keeps the TAP status word for word.
    expect(text(visa)).toContain("not eligible Visa tooling for this hackathon (Visa, 5 Nov)");
    // /proof: after the partner cards, before the folds; no longer inside "Airwallex, read back".
    const proof = pages.proof!;
    expect(proof.indexOf('id="airi-run"')).toBeGreaterThan(proof.lastIndexOf('class="pcard'));
    expect(proof.indexOf('id="airi-run"')).toBeLessThan(proof.indexOf('id="airwallex-readback"'));
    expect(proof.match(/id="airi-run"/g)).toHaveLength(1);
  });

  it("names every id and code of the passing attempt, from the record", () => {
    const t = text(block(pages.airwallex!));
    const a = buy("A"), b = buy("B"), c = buy("C");
    for (const x of [a.mandate_id!, a.payment_intent_id!, b.proposal_id!, b.mandate_id!, b.payment_intent_id!, c.code!, b.terms_sha256!.slice(0, 8)]) expect({ x, shown: t.includes(x) }).toEqual({ x, shown: true });
    expect(t).toContain(`PaymentIntent ${a.payment_intent_id} SUCCEEDED, reported to Airi`);
    expect(t).toContain(`PaymentIntent ${b.payment_intent_id} SUCCEEDED: P-0002 EXECUTED`);
    // Purchase A (12 Nov): no "agent alone"; no CFO approval, and the cardholder's own step right after it.
    expect(t).toContain(`within Purser's limit of EUR ${rec.policy.alone_max_eur} for this rail: no CFO approval. The cardholder still confirmed it once in Airi with a passkey, and the Sourcing agent received`);
    expect(t).not.toMatch(/agent alone/);
    expect(t).toContain(`(terms hash ${b.terms_sha256!.slice(0, 8)}…)`);
    expect(t).toContain(AIRI_CREDENTIAL);
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
    const t = text(PAGES.map((n) => block(pages[n]!)).join(" ")).replace(/\b(?:int|mdt)_[a-z0-9]+/g, " ").replace(/P-\d{4}/g, " ").replace(/[0-9a-f]{8}…/g, " ").replace(/airi-run\.json/g, " ");
    const unknown = (t.match(/\d+(?:\.\d+)*/g) ?? []).filter((n) => !inRecord.has(n) && !counted.has(n));
    expect(unknown).toEqual([]);
  });

  it("shows nothing private, no person's name for the cardholder or the CFO, no award claim, and not the run's working name", () => {
    for (const name of PAGES) {
      const b = block(pages[name]!);
      for (const re of PRIVATE) expect({ name, re: String(re), found: re.exec(b)?.[0] ?? null }).toEqual({ name, re: String(re), found: null });
      expect(b).not.toMatch(/\b[0-9a-f]{64}\b/);
      expect(text(b)).not.toMatch(/vic-1|emulat|\bMax\b|\b(he|him|his|she|her|hers)\b|Visa Award|code decides/i);
    }
    // Home names no award since it became one story (home-story, 12 Nov: no Kit line, no awards strip; it had said both
    // "entered for the Visa Award" and "not an award entry"). /visa names the entry, below.
    expect(text(pages.home!)).not.toMatch(/Visa Award|Metal Award/);
    // Since 10 Nov (Max: we compete for the Visa Award, keep it visible) /visa opens with one plain sentence naming the
    // entry, the Kit line's words, then the run; nowhere else on these pages.
    expect(text(pages.visa!)).toContain(VISA_ENTRY_LINE);
    for (const name of PAGES) expect({ name, award: /Visa Award/.test(text(pages[name]!).split(VISA_ENTRY_LINE).join(" ")) }).toEqual({ name, award: false });
    // The record and the run log too: ids, hashes and codes only.
    for (const [name, body] of [["record", RAW], ["run log", LOG]] as const) {
      for (const re of PRIVATE) expect({ name, re: String(re), found: re.exec(body)?.[0] ?? null }).toEqual({ name, re: String(re), found: null });
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
    expect(text(failed)).toContain("The checks, not every one passes");
    expect(failed).toContain('class="awm bad"');
    // A badge only as the record has it: an A that did not succeed is not "Paid alone".
    const notPaid = airiRunSummary({ ...rec, purchases: rec.purchases.map((p) => p.step === "A" ? { ...p, outcome: "FAILED" } : p) })!;
    expect(notPaid.outcomes[0]!.badge).not.toBe(AIRI_BADGES.A);
    expect(notPaid.outcomes[0]!.ok).toBe(false);
  });
});
