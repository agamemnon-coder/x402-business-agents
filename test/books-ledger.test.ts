// /books' ledger half (21 Nov, the owner: "the books page, with T:0 in it, explained well with visuals, architecture and
// animations", and "a small demo that shows a cent must not be changed"). How a payment reaches the books is read from
// the partner-rails record of 20 Nov; the one-cent demo starts from the balance sheet as recorded, says it is a demo, and
// its script changes nothing but the page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_JS, RAILS_FILE, demoHtml, demoLines, railsHtml, railsRun } from "../src/redesign/booksLedger.js";
import { booksData } from "../src/redesign/booksPage.js";
import { BOOKS_PAGE } from "../src/servers/dashboard.js";

const rec = JSON.parse(readFileSync(new URL(`../${RAILS_FILE}`, import.meta.url), "utf8")) as { payments: { amount: string; currency: string; t0: { je_number: string; ms_after_settled: number } }[]; reconcile: { ok: boolean } };

describe("how a payment reaches the books", () => {
  const r = railsRun()!;
  it("reads every payment, its PURPAY- entry, its timing and its reconcile checks from the record", () => {
    expect(r.payments.map((p) => [p.currency, p.amount, p.je, p.ms])).toEqual(rec.payments.map((p) => [p.currency, p.amount, p.t0.je_number, p.t0.ms_after_settled]));
    expect(r.ok).toBe(rec.reconcile.ok);
    expect(r.rails).toBe(3);
    const html = railsHtml(r);
    for (const p of r.payments) expect(html).toContain(p.je.slice(0, 15));
    expect(html).toContain("PURPAY-");
    expect(BOOKS_PAGE).toContain('id="how"');
  });
  it("leaves the block out when the record is missing or a payment was not booked", () => {
    expect(railsRun(null)).toBeNull();
    const bad = structuredClone(rec) as unknown as { payments: { t0: { status: string } }[] };
    bad.payments[0]!.t0.status = "failed";
    expect(railsRun(JSON.stringify(bad))).toBeNull();
    expect(railsHtml(null)).toBe("");
  });
});

describe("change one cent", () => {
  const v = booksData().view!;
  it("starts balanced, from the balance sheet as recorded, and says it is a demo in the browser only", () => {
    const lines = demoLines(v);
    const a = lines.filter((l) => l.side === "a").reduce((n, l) => n + l.line.cents, 0), le = lines.filter((l) => l.side !== "a").reduce((n, l) => n + l.line.cents, 0);
    expect(a).toBe(v.totalAssets);
    expect(le).toBe(v.totalLiabilities + v.totalEquity);
    const html = demoHtml(v);
    expect(html).toContain("Demo · in your browser only");
    expect(html).toContain("Nothing is saved or sent.");
    expect(BOOKS_PAGE).toContain(DEMO_JS);
  });
  it("its script sends nothing and stores nothing", () => {
    expect(DEMO_JS).not.toMatch(/fetch|XMLHttpRequest|localStorage|sessionStorage|sendBeacon|innerHTML/);
  });
});
