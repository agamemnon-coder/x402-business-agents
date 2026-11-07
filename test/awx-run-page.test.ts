// awx-1 on the site (7 Nov): the separate Airwallex-only run shows on /airwallex and in Proof's "Airwallex, read back",
// dated and labelled "Airwallex sandbox, test money", every figure and id from its record (docs/demo/airwallex-run.json),
// nothing private (no passkey label, no IBAN, no full hash, no viewer key), and nothing at all without a live record.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/relay/assets.js";
import type { Awx1Record } from "../src/awx/scenario.js";
import { AWX_RUN_FILE, AWX_RUN_LABEL, AWX_RUN_LOG, awxRun, awxRunBlock, awxRunHtml, awxRunSummary } from "../src/redesign/awxRun.js";

const RAW = readFileSync(AWX_RUN_FILE, "utf8");
const rec = JSON.parse(RAW) as Awx1Record;
const pages = buildPages() as unknown as Record<string, string>;
const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
/** The block on a page: in full on /airwallex (its steps in a fold), short on /proof (a link to them). */
const block = (html: string) => (html === pages.proof ? /<div class="card" id="awx-1">[\s\S]*?<\/a><\/div>/ : /<div class="card" id="awx-1">[\s\S]*?<\/details><\/div>/).exec(html)?.[0] ?? "";

describe("awx-1 on the site", () => {
  it("reads the committed live record", () => {
    expect(awxRun()).toMatchObject({ run: "awx-1", mode: "live", test_money: true });
  });

  it("shows on /airwallex and in Proof's Airwallex read back, dated and labelled sandbox, test money", () => {
    for (const name of ["airwallex", "proof"]) {
      const t = text(block(pages[name]!));
      expect({ name, t }).toEqual({ name, t: expect.stringContaining(`7 November, awx-1: a separate run · ${AWX_RUN_LABEL}`) });
      expect(t).toContain("7 of 7 checks pass");
    }
    // On Proof, under the "Airwallex, read back" heading, short: no decline code on /proof (test/proof-first.test.ts),
    // a link to every step on /airwallex, whose fold opens on arrival.
    expect(pages.proof!.indexOf('id="awx-1"')).toBeGreaterThan(pages.proof!.indexOf('id="airwallex-readback"'));
    expect(block(pages.proof!)).toContain('href="airwallex#awx-1-steps"');
    expect(block(pages.proof!)).not.toMatch(/LIMIT_EXCEEDED|MERCHANT_CATEGORY_NOT_ALLOWED/);
    expect(pages.airwallex!).toContain('<details class="fold" id="awx-1-steps">');
    expect(text(block(pages.proof!))).toContain("3 agent cards with the CFO policy's controls; 2 declines by Airwallex, each read by its agent and none retried (1 raise asked of the CFO); 2 invoices paid by SWIFT after the CFO's Face ID, 1 with FX for the shortfall only.");
  });

  it("names every Airwallex id, decline code and payout of the run, from the record", () => {
    const t = text(block(pages.airwallex!));
    for (const x of rec.card_transactions) expect(t).toContain(x.id);
    for (const x of rec.card_transactions.filter((y) => y.decline_code)) expect(t).toContain(x.decline_code!);
    for (const i of rec.invoices) { expect(t).toContain(i.transfer_id!); expect(t).toContain(i.invoice_no); expect(t).toContain(`${i.status}, fee ${i.fee}`); }
    const fx = rec.invoices.find((i) => i.quote)!;
    expect(t).toContain(`only EUR ${fx.quote!.buy_eur} bought for USD ${fx.quote!.sell_usd} at ${fx.quote!.rate} (quote ${fx.quote!.quote_id}, conversion ${fx.conversion_id})`);
    expect(t).toContain(`${rec.webhooks.length} webhooks from Airwallex`);
    expect(t).toContain(`${rec.calls!.airwallex_total} of ${rec.calls!.budget} approved Airwallex calls`);
    expect(t).toContain("P-0001, instead of retrying");
    expect(t).toContain("(Claude Haiku)");
    expect(t).toContain(AWX_RUN_FILE);
    expect(block(pages.airwallex!)).toContain(AWX_RUN_LOG);
  });

  it("has no number the record does not hold (counts are counted from it)", () => {
    const counted = new Set([String(rec.cards.length), String(rec.card_transactions.length), String(rec.webhooks.length), String(Object.keys(rec.checks).length), "7",
      String(rec.declines_met.length), String(rec.declines_met.filter((m) => m.proposal_id).length), String(rec.invoices.length), String(rec.invoices.filter((i) => i.quote).length)]);
    const inRecord = new Set((RAW.match(/\d+(?:\.\d+)*/g) ?? []));
    // Ids and the record's file name are names, not figures; the date is the record's own (2026-11-07).
    const t = text(block(pages.airwallex!) + block(pages.proof!)).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, " ").replace(/(SLL|BTX)-\d{4}-\d{2}/g, " ").replace(/P-\d{4}/g, " ").replace(/airwallex-run\.json|2026-11-07-awx-1\.md|awx-1/g, " ");
    const unknown = (t.match(/\d+(?:\.\d+)*/g) ?? []).filter((n) => !inRecord.has(n) && !counted.has(n));
    expect(unknown).toEqual([]);
    expect(rec.attempts[0]!.at.slice(0, 10)).toBe("2026-11-07");
  });

  it("shows nothing private", () => {
    for (const name of ["airwallex", "proof"]) {
      const b = block(pages[name]!);
      expect(b).not.toMatch(/\(passkey [A-Za-z0-9_-]+\)/);
      expect(b).not.toMatch(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/);
      expect(b).not.toMatch(/\b[0-9a-f]{64}\b/);
      expect(b).not.toMatch(/#view=|view_key|viewer/i);
    }
    // The run log too: no viewer link, enrolment code or passkey credential.
    const log = readFileSync(AWX_RUN_LOG, "utf8");
    expect(log).not.toMatch(/#view=|ENROL|credential_id|public_key/);
  });

  it("shows nothing without a live record, or for a stand-in's", () => {
    expect(awxRunBlock(null)).toBe("");
    expect(awxRunHtml(null)).toBe("");
    expect(awxRun("docs/demo/no-such-run.json")).toBeNull();
    expect(awxRunSummary({ ...rec, invoices: [] })).toBeNull();
    // A failed check shows as such, never as passed.
    const failed = awxRunHtml(awxRunSummary({ ...rec, checks: { ...rec.checks, c: { ok: false, detail: "x" } } }));
    expect(text(failed)).toContain("6 of 7 checks pass");
    expect(failed).toContain('class="awm bad"');
  });
});
