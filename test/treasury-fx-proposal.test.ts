// The Treasury advisor's suggested conversion becomes a proposal like any money action (src/treasury/advisor.ts): checked
// against the CFO's policy when filed, never run before the CFO's passkey, and run only within what was signed
// (src/executors/fxConversion.ts): exactly the buy amount, at most sell_max, the sell currency kept above its floor, one
// conversion per signed request id. Breaks if a suggestion converts on its own, if a rate that moved past the signed
// maximum still converts, or if a retry converts twice.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import type { AnyQuote, Balance, Conversion } from "../src/airwallex/port.js";
import { executeFxConversion } from "../src/executors/fxConversion.js";
import { forecastInput, proposeFxConversion } from "../src/treasury/advisor.js";
import { cashForecast } from "../src/treasury/forecastCore.js";
import { fxAdvice, type IndicativeRate } from "../src/treasury/fxCore.js";
import { ProposalRefused } from "../src/policy/approvals.js";
import { summarize } from "../src/dashboard/snapshot.js";
import { approveSigned } from "./support/signedApproval.js";

const now = new Date("2026-11-26T09:00:00Z");
const setting = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());

function world(threshold: string | null = "400.00") {
  const db = openDb(":memory:");
  setting(db, "eur_floor", "2000.00");
  setting(db, "usd_floor", "1000.00");
  if (threshold) setting(db, "treasury.fx_threshold_eur", threshold);
  db.prepare("INSERT INTO ap_documents (sha256, filename, mime, bytes, path, source, text_chars, received_at) VALUES ('x', 'rd-1.pdf', 'application/pdf', 1, 'x', 'upload', 1, ?)").run(now.toISOString());
  db.prepare(`INSERT INTO ap_invoices (id, doc_sha256, doc_kind, classified_by, vendor, invoice_no, issue_date, due_date, currency, subtotal, tax, total, iban_last4, bic, reading_json, read_by, gl_account, gl_rule, cost_centre, status, findings_json, received_at, updated_at)
    VALUES ('AP-0001', 'x', 'invoice', 'code', 'Ridgeline Data', 'RD-1', '2026-11-20', '2026-12-15', 'USD', '4500.00', '0.00', '4500.00', '1234', 'BIC', '{}', 'code', '6900', 'r', 'ops', 'ready', '[]', ?, ?)`).run(now.toISOString(), now.toISOString());
  const f = cashForecast(forecastInput(db, "2026-11-26", [{ currency: "EUR", cents: 1_000_000 }, { currency: "USD", cents: 500_000 }], "test"));
  const rate: IndicativeRate = { buy_currency: "USD", sell_currency: "EUR", buy_cents: 50_000, sell_cents: 46_000, rate: "0.92", at: now.toISOString(), source: "stand-in" };
  return { db, f, advice: fxAdvice(f, [rate], threshold ? Number(threshold.replace(".", "")) : null) };
}

class FakeFx {
  calls: string[] = [];
  sellCents = 46_100;
  made = new Map<string, Conversion>();
  available: Record<string, number> = { EUR: 1_000_000, USD: 500_000 };
  async balancesAll(): Promise<Record<string, Balance>> { this.calls.push("balances"); return Object.fromEntries(Object.entries(this.available).map(([c, a]) => [c, { availableCents: a, pendingCents: 0, reservedCents: 0 }])); }
  async createQuoteAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<AnyQuote> {
    this.calls.push("quote");
    return { quoteId: `q-${this.calls.length}`, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents, sellAmountCents: this.sellCents, clientRate: "0.922", validFrom: now.toISOString(), validTo: new Date(now.getTime() + 60_000).toISOString() };
  }
  async createConversionAny(a: { requestId: string; quote: AnyQuote; approvalSha256: string }): Promise<Conversion> {
    this.calls.push(`convert:${a.approvalSha256.slice(0, 8)}`);
    const c = { conversionId: `conv-${this.made.size + 1}`, requestId: a.requestId, quoteId: a.quote.quoteId, status: "SCHEDULED", buyAmountCents: a.quote.buyAmountCents, sellAmountCents: a.quote.sellAmountCents };
    this.made.set(a.requestId, c);
    return c;
  }
  async findConversionByRequestId(id: string): Promise<Conversion | undefined> { this.calls.push("find"); return this.made.get(id); }
}

describe("a suggested conversion", () => {
  it("is filed as a proposal waiting for the CFO's passkey, with the signed maximum in its terms, and converts nothing", () => {
    const { db, f, advice } = world();
    expect(advice.suggestions).toHaveLength(1);
    const p = proposeFxConversion(db, advice.suggestions[0]!, f, now);
    expect(p.status).toBe("PENDING_APPROVAL");
    const t = JSON.parse(p.terms_json) as Record<string, string>;
    expect(t).toMatchObject({ kind: "fx_conversion", buy_currency: "USD", buy_amount: "500.00", sell_currency: "EUR", sell_max: "464.60", indicative_sell: "460.00", money: "test money (Airwallex sandbox)" });
    expect(summarize("fx_conversion", p.terms_json)).toMatch(/^Convert at most EUR 464\.60 to USD 500\.00/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM fx_conversions").get()).toEqual({ n: 0 });
    // A second of the same pair is not filed while one waits.
    expect(() => proposeFxConversion(db, advice.suggestions[0]!, f, now)).toThrow(/already waiting/);
  });

  it("is refused by the policy under the emergency stop, a paused Treasury agent, or below the threshold", () => {
    const a = world();
    setting(a.db, "freeze", "on");
    expect(() => proposeFxConversion(a.db, a.advice.suggestions[0]!, a.f, now)).toThrow(ProposalRefused);
    const b = world();
    setting(b.db, "pause.treasury", "on");
    expect(() => proposeFxConversion(b.db, b.advice.suggestions[0]!, b.f, now)).toThrow(/paused/);
    const c = world();
    setting(c.db, "treasury.fx_threshold_eur", "900.00");
    expect(() => proposeFxConversion(c.db, c.advice.suggestions[0]!, c.f, now)).toThrow(/below the CFO's threshold/);
    expect(a.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });

  it("does not run before the CFO approves it, and then converts once, carrying the approval hash", async () => {
    const { db, f, advice } = world();
    const p = proposeFxConversion(db, advice.suggestions[0]!, f, now);
    const fx = new FakeFx();
    await expect(executeFxConversion(db, fx, p.proposal_id, () => now)).rejects.toThrow(/not approved/);
    expect(fx.calls).toEqual([]);
    approveSigned(db, p.proposal_id, now);
    const r = await executeFxConversion(db, fx, p.proposal_id, () => now);
    expect(r).toMatchObject({ outcome: "EXECUTED", detail: expect.stringMatching(/converted EUR 461\.00 to USD 500\.00/) });
    expect(fx.calls).toEqual(["find", "balances", "quote", `convert:${p.terms_sha256.slice(0, 8)}`]);
    expect(db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.proposal_id)).toEqual({ status: "EXECUTED" });
    expect(db.prepare("SELECT buy_amount, sell_amount, approval_sha256 FROM fx_conversions").all()).toEqual([{ buy_amount: "500.00", sell_amount: "461.00", approval_sha256: p.terms_sha256 }]);
    await expect(executeFxConversion(db, fx, p.proposal_id, () => now)).rejects.toThrow();
    expect(fx.made.size).toBe(1);
  });

  it("stops for a new approval when the rate moved past the signed maximum, or the sell currency would fall under its floor", async () => {
    const a = world();
    const p = proposeFxConversion(a.db, a.advice.suggestions[0]!, a.f, now);
    approveSigned(a.db, p.proposal_id, now);
    const fx = new FakeFx();
    fx.sellCents = 47_000;
    expect(await executeFxConversion(a.db, fx, p.proposal_id, () => now)).toMatchObject({ outcome: "NEEDS_REAPPROVAL", detail: expect.stringMatching(/rate moved/) });
    expect(fx.made.size).toBe(0);
    const b = world();
    const q = proposeFxConversion(b.db, b.advice.suggestions[0]!, b.f, now);
    approveSigned(b.db, q.proposal_id, now);
    const fx2 = new FakeFx();
    fx2.available.EUR = 210_000;
    expect(await executeFxConversion(b.db, fx2, q.proposal_id, () => now)).toMatchObject({ outcome: "NEEDS_REAPPROVAL", detail: expect.stringMatching(/under its floor/) });
    expect(fx2.calls).not.toContain("quote");
  });

  it("adopts the conversion Airwallex already made on a retry, never a second one", async () => {
    const { db, f, advice } = world();
    const p = proposeFxConversion(db, advice.suggestions[0]!, f, now);
    approveSigned(db, p.proposal_id, now);
    const fx = new FakeFx();
    const t = JSON.parse(p.terms_json) as { conversion_request_id: string };
    fx.made.set(t.conversion_request_id, { conversionId: "conv-earlier", requestId: t.conversion_request_id, quoteId: "q-earlier", status: "SETTLED", buyAmountCents: 50_000, sellAmountCents: 46_050 });
    expect(await executeFxConversion(db, fx, p.proposal_id, () => now)).toMatchObject({ outcome: "EXECUTED" });
    expect(fx.calls).toEqual(["find"]);
    expect(db.prepare("SELECT conversion_id FROM fx_conversions").all()).toEqual([{ conversion_id: "conv-earlier" }]);
  });
});
