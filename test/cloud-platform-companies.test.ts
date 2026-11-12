// Purser as a platform with several companies (10 Nov): the operator's view lists each company with its Airwallex
// account (as Airwallex's webhooks reported it), the payouts that moved and Purser's fees that were taken, only from what
// the companies' runners pushed; and the console's /v1/me tells a company's own pages which Airwallex account it has.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_TOKEN, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(() => { c = testCloud(); });
afterEach(() => c.close());

const row = (id: string, amount: string, moved: boolean, description = "Supplier payout") => ({
  id, at: "2026-11-10T09:00:00Z", rail: "airwallex_transfer", direction: "out", currency: "EUR", moved, reconciliation: moved ? "matched" : "not_applicable",
  body: {
    id, at: "2026-11-10T09:00:00Z", direction: "out", flow: "out", rail: "airwallex_transfer", rail_label: "Airwallex transfer", description, counterparty: "Supplier", counterparty_account: null,
    amount, currency: "EUR", eur_equivalent: amount, fee: null, moved, status: moved ? "PAID" : "IN_APPROVAL", status_words: moved ? "paid" : "waiting", invoice: null,
    approval: { required: true, authority: "a", proposal_id: null, decision: null, method: null, approved_at: null, terms_sha256: null },
    booking: { entry_ids: [], accounts: [], booked: null }, proof: "tr_1", reconciliation: moved ? "matched" : "not_applicable", reconciliation_words: "x", flags: [],
  },
});

describe("the platform's companies", () => {
  it("are for the platform admin only", async () => {
    const t = await c.tenant("acme");
    expect((await c.req("GET", "/v1/admin/companies", { key: t.key })).status).toBe(401);
    expect((await c.req("GET", "/v1/admin/companies", { key: null })).status).toBe(401);
  });

  it("list each company with its Airwallex account, the payouts that moved and Purser's fees taken, nothing invented", async () => {
    const acme = await c.tenant("acme");
    await c.tenant("bolt");
    await c.env.sql.run("INSERT INTO awx_accounts (tenant_id, id, account_id, status, business_name, country_code, created_at, created_by, updated_at) VALUES (?, 'main', 'acct_test_acme', 'active', 'Acme', 'NL', ?, 'owner', ?)",
      [acme.id, "2026-11-10T08:00:00Z", "2026-11-10T08:30:00Z"]);
    const pushed = await c.req("POST", "/v1/sync", { key: acme.key, body: { transactions: [
      row("transfer:a1", "100.00", true), row("transfer:a2", "40.00", false), row("platform_fee:a1", "0.50", true, "Purser platform fee"),
    ] } });
    expect(pushed.status).toBe(200);
    const r = await c.req("GET", "/v1/admin/companies", { key: ADMIN_TOKEN });
    expect(r.status).toBe(200);
    const list = r.json.companies as Record<string, unknown>[];
    expect(list.map((x) => x.slug)).toEqual(["acme", "bolt"]);
    expect(list[0]).toMatchObject({ slug: "acme", airwallex: { account_id: "acct_test_acme", status: "active" }, payouts: { count: 1, totals: { EUR: "100.00" } }, fees: { EUR: "0.50" }, waiting: 1 });
    expect(list[1]).toMatchObject({ slug: "bolt", airwallex: null, payouts: { count: 0, totals: {} }, fees: {}, waiting: 0 });
    expect(r.json.totals).toMatchObject({ companies: 2, active_accounts: 1, payouts: { EUR: "100.00" }, fees: { EUR: "0.50" } });
  });
});

describe("a company's own pages", () => {
  it("learn from /v1/me which Airwallex account the company has, or none", async () => {
    const t = await c.tenant("acme");
    expect((await c.req("GET", "/v1/me", { key: t.key })).json.airwallex).toBeNull();
    await c.env.sql.run("INSERT INTO awx_accounts (tenant_id, id, account_id, status, business_name, country_code, created_at, created_by, updated_at) VALUES (?, 'main', 'acct_test_acme', 'pending', 'Acme', 'NL', ?, 'owner', ?)",
      [t.id, "2026-11-10T08:00:00Z", "2026-11-10T08:30:00Z"]);
    expect((await c.req("GET", "/v1/me", { key: t.key })).json.airwallex).toEqual({ account_id: "acct_test_acme", status: "pending" });
  });
});
