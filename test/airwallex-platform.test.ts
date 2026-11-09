// Purser as an Airwallex platform (docs/airwallex-platform.md), behind AIRWALLEX_PLATFORM=on: a company's payouts run
// on behalf of its own connected account, the CFO's signed terms name that account and any Purser fee, and the fee is
// collected only after the payout is paid, once, booked and in the register. All against fakes: no call to Airwallex.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { apJournal } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { executePayeeAdd, proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../src/ap/vendors.js";
import { AirwallexRest } from "../src/airwallex/adapter.js";
import { Airwallex } from "../src/airwallex/client.js";
import { AirwallexPlatformRest, platformFeeOn, platformOn, statusFromWebhook } from "../src/airwallex/platform.js";
import { describeTerms } from "../src/approve/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { syncLedger } from "../src/ledger/feed.js";
import { transactionRegister } from "../src/money/register.js";
import type { PlatformFields, SupplierPaymentTerms } from "../src/payouts/plan.js";
import { decide } from "../src/policy/approvals.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { US } from "./fakes/fxInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { bind, BINDING_ENV } from "./support/platformBinding.js";

type Reply = { status: number; body?: unknown };
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = replies.shift();
    if (!r) throw new Error("no more replies");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}
const login = { status: 201, body: { token: "tok-1" } };
const client = (replies: Reply[], onBehalfOf?: string) => {
  const f = fakeFetch(replies);
  return { api: new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: f.impl, sleep: async () => {}, now: () => 0, ...(onBehalfOf ? { onBehalfOf } : {}) }), calls: f.calls };
};
const header = (c: { init: RequestInit }, name: string) => (c.init.headers as Record<string, string>)[name];
const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body)) as Record<string, unknown>;

describe("the flag", () => {
  it("is off unless AIRWALLEX_PLATFORM=on; the fee has its own flag, also off", () => {
    expect(platformOn({})).toBe(false);
    expect(platformOn({ AIRWALLEX_PLATFORM: "on" })).toBe(true);
    expect(platformFeeOn({ AIRWALLEX_PLATFORM: "on" })).toBe(false);
    expect(platformFeeOn({ AIRWALLEX_PLATFORM: "on", AIRWALLEX_PLATFORM_FEE: "on" })).toBe(true);
    expect(platformFeeOn({ AIRWALLEX_PLATFORM_FEE: "on" })).toBe(false);
  });
});

describe("acting on behalf of a connected account (x-on-behalf-of)", () => {
  it("sends the header on every call of the payout rail, never on the login", async () => {
    const { api, calls } = client([login, { status: 200, body: [] }, { status: 201, body: { id: "tr_1", request_id: "r1", status: "NEW", transfer_amount: 10, transfer_currency: "USD" } }], "acct_northwind");
    const rail = new AirwallexRest(api);
    await rail.balancesAll();
    await rail.createPayoutTransfer({ requestId: "r1", beneficiaryId: "b1", amountCents: 1000, currency: "USD", sourceCurrency: "USD", method: "LOCAL", reference: "INV-1", reason: "goods_purchased", approvalSha256: "a".repeat(64) });
    expect(header(calls[0]!, "x-on-behalf-of")).toBeUndefined();
    expect(calls.slice(1).map((c) => header(c, "x-on-behalf-of"))).toEqual(["acct_northwind", "acct_northwind"]);
  });
  it("sends no header for a company on its own Airwallex account", async () => {
    const { api, calls } = client([login, { status: 200, body: [] }]);
    await new AirwallexRest(api).balancesAll();
    expect(header(calls[1]!, "x-on-behalf-of")).toBeUndefined();
  });
  it("refuses an id that is not an Airwallex account id", () => {
    expect(() => new Airwallex({ clientId: "id", apiKey: "key", onBehalfOf: "acct_x\r\nx-evil: 1" })).toThrow(/account id/);
  });
});

describe("the platform rail (docs: native-api, hosted-onboarding, connected_account_transfers)", () => {
  it("creates the connected account with the minimal body and the company's name and country", async () => {
    const { api, calls } = client([login, { status: 201, body: { id: "acct_newco1", status: "CREATED" } }]);
    const out = await new AirwallexPlatformRest(api).createConnectedAccount({ businessName: "Northwind Outdoor B.V.", countryCode: "NL", email: "cfo@northwind.example", requestId: "req_open_0001" });
    expect(out).toEqual({ accountId: "acct_newco1", status: "CREATED" });
    expect(calls[1]!.url).toMatch(/\/api\/v1\/accounts\/create$/);
    expect(body(calls[1]!)).toEqual({
      request_id: "req_open_0001",
      account_details: { business_details: { business_name: "Northwind Outdoor B.V.", registration_address: { country_code: "NL" } } },
      customer_agreements: { agreed_to_data_usage: true, agreed_to_terms_and_conditions: true },
      primary_contact: { email: "cfo@northwind.example" },
    });
    expect(header(calls[1]!, "x-on-behalf-of")).toBeUndefined();
  });
  it("makes the hosted onboarding flow and authorizes it for the person, in two calls", async () => {
    const { api, calls } = client([login, { status: 201, body: { id: "ahfi_1", url: "https://airwallex.com/app1/hostedflow?ahfi_id=ahfi_1", status: "INIT" } },
      { status: 200, body: { id: "ahfi_1", url: "https://airwallex.com/app1/hostedflow?ahfi_id=ahfi_1&authorization_code=abc", status: "INIT" } }]);
    const url = await new AirwallexPlatformRest(api).onboardingLink({ accountId: "acct_newco1", template: "tmpl_kyc", returnUrl: "https://app.example/settings", identity: "usr_1" });
    expect(url).toBe("https://airwallex.com/app1/hostedflow?ahfi_id=ahfi_1&authorization_code=abc");
    expect(calls[1]!.url).toMatch(/\/api\/v1\/hosted_flows\/create$/);
    expect(body(calls[1]!)).toMatchObject({ account_id: "acct_newco1", template: "tmpl_kyc", return_url: "https://app.example/settings" });
    expect(calls[2]!.url).toMatch(/\/api\/v1\/hosted_flows\/ahfi_1\/authorize$/);
    expect(body(calls[2]!)).toEqual({ identity: "usr_1" });
  });
  it("refuses an onboarding URL that is not on airwallex.com", async () => {
    const { api } = client([login, { status: 201, body: { id: "ahfi_1", url: "https://evil.example/x", status: "INIT" } }, { status: 200, body: { id: "ahfi_1", url: "https://evil.example/x?code=1" } }]);
    await expect(new AirwallexPlatformRest(api).onboardingLink({ accountId: "acct_newco1", template: "t", returnUrl: "https://app.example/s", identity: "u" })).rejects.toThrow(/airwallex\.com/);
  });
  it("reads the account status from Airwallex's account webhooks, and knows nothing it was not told", () => {
    expect(statusFromWebhook("account.submitted")).toBe("pending");
    expect(statusFromWebhook("account.action_required")).toBe("action_required");
    expect(statusFromWebhook("account.active")).toBe("active");
    expect(statusFromWebhook("account.suspended")).toBe("refused");
    expect(statusFromWebhook("account.closed")).toBe("closed");
    expect(statusFromWebhook("account.dormant")).toBe("dormant");
    expect(statusFromWebhook("payout.transfer.paid")).toBeNull();
  });
});

// ---- payouts on behalf of the connected account, with the fee in the signed terms ----

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const ADDRESS = { street: "1 Supplier Street", city: "Supplier City", postcode: "12345" };
const HOW = "called the supplier's accounts team on the number in our signed 2025 purchase contract; they confirmed the account";
let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
const ENV = { AIRWALLEX_PLATFORM: "on", AIRWALLEX_PLATFORM_FEE: "on", ...BINDING_ENV };
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "awx-platform-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  setSetting(db, "human", "eur_obligations", "0.00");
  deps = { dir, reader: parserOnly, now: () => now };
  Object.assign(process.env, ENV);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(ENV)) delete process.env[k];
});
const approve = (id: string) => {
  const p = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { terms_sha256: string };
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
};
const usInvoice = async () => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(US), filename: "us.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  const req = requestPayeeAddForInvoice(db, out.invoice.id, "treasury", now);
  recordPayeeAddVerification(db, req.add_id, { by: "the CFO", how: HOW, actor: "human", address: ADDRESS }, now);
  const p = proposePayeeAdd(db, req.add_id, "treasury", now);
  approve(p.proposal_id);
  await executePayeeAdd(db, awx, p.proposal_id, { now: () => now, reader: parserOnly }, now);
  return out.invoice.id;
};
const platform = async (feeBps = "50") => {
  // The company's binding to its own account, as Purser Cloud signs it (red team 6: never a local setting).
  await bind(db);
  setSetting(db, "human", "platform.fee_bps", feeBps);
  awx.payingAccount = "acct_northwind";
};
const propose = async (id: string) => {
  const out = await payApInvoice(db, awx, id, now);
  if (out.kind !== "proposed") throw new Error(out.reason);
  return { proposal: out.proposal, terms: JSON.parse(out.proposal.terms_json) as SupplierPaymentTerms & PlatformFields };
};

describe("a payout on behalf of the company's connected account", () => {
  it("names the paying account and Purser's fee in the terms the CFO signs; the phone shows both before Face ID", async () => {
    await platform();
    const id = await usInvoice();
    const { terms } = await propose(id);
    // USD 2,400.00 at 50 basis points: USD 12.00, in the payout's own currency, to Purser's platform account.
    expect(terms.paying_account).toEqual({ id: "acct_northwind", name: "Northwind Outdoor B.V. (Airwallex, through Purser)" });
    expect(terms.platform_fee).toMatchObject({ amount: "12.00", currency: "USD", to_account: "acct_purser_platform", bps: "50" });
    expect(terms.platform_fee!.request_id).toMatch(/^[0-9a-f-]{36}$/);
    const d = describeTerms(terms as never, {});
    expect(d.rows).toContainEqual(["Paid from", "Northwind Outdoor B.V. (Airwallex, through Purser), acct_northwind"]);
    expect(d.rows).toContainEqual(["Purser fee", "USD 12.00 (0.50%) to Purser's account acct_purser_platform, taken from the paying account after the payment is paid"]);
    expect(d.rows).toContainEqual(["Total out", "USD 2,412.00 (the amount and Purser's fee; no Airwallex fee is expected on this route)"]);
  });

  it("with the platform off nothing changes: no paying account, no fee", async () => {
    delete process.env.AIRWALLEX_PLATFORM;
    const id = await usInvoice();
    const { terms } = await propose(id);
    expect(terms.paying_account).toBeUndefined();
    expect(terms.platform_fee).toBeUndefined();
  });

  it("with the platform on but the fee flag off, the account is named and no fee is planned", async () => {
    delete process.env.AIRWALLEX_PLATFORM_FEE;
    await platform();
    const { terms } = await propose(await usInvoice());
    expect(terms.paying_account?.id).toBe("acct_northwind");
    expect(terms.platform_fee).toBeUndefined();
  });

  it("counts the fee toward the funds checked: what is free (or bought) covers the payout, the reserve and the fee", async () => {
    await platform("100"); // the cap: 1.00%
    const { terms } = await propose(await usInvoice());
    const free = Number(terms.balances_before.USD ?? 0) - Number(terms.floors.USD ?? 0) + Number(terms.conversion?.buy_amount ?? 0);
    expect(free).toBeGreaterThanOrEqual(Number(terms.amount) + Number(terms.fee_reserve) + Number(terms.platform_fee!.amount));
    expect(terms.platform_fee!.amount).toBe("24.00");
  });

  it("refuses to pay from another account than the one the CFO signed for", async () => {
    await platform();
    const { proposal } = await propose(await usInvoice());
    approve(proposal.proposal_id);
    awx.payingAccount = "acct_someone_else";
    await expect(executeSupplierPayment(db, awx, awx, proposal.proposal_id)).rejects.toThrow(/signed for payment from acct_northwind/);
    expect(awx.transfers.filter((t) => t.requestId)).toHaveLength(0);
  });

  it("takes the fee once, only after the payout is paid; books it and lists it in the register", async () => {
    await platform();
    const id = await usInvoice();
    const { proposal, terms } = await propose(id);
    approve(proposal.proposal_id);
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id);
    await syncPayments(db, { now: () => now });
    expect(apInvoice(db, id)!.status).toBe("paid");
    expect(awx.platformFees).toEqual([{ requestId: terms.platform_fee!.request_id, amountCents: 1200, currency: "USD", destination: "acct_purser_platform", reference: expect.stringContaining(terms.invoice_no) }]);
    // Run again: nothing is taken twice.
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id).catch(() => undefined);
    expect(awx.platformFees).toHaveLength(1);
    const fee = apJournal(db).filter((e) => e.invoice_id === id && /Purser platform fee/.test(e.memo));
    expect(fee.map((e) => [e.account, e.debit, e.credit, e.currency])).toEqual([["6800", "12.00", "", "USD"], ["1201", "", "12.00", "USD"]]);
    syncLedger(db, now);
    const row = transactionRegister(db).rows.find((r) => r.id === `platform_fee:${terms.platform_fee!.request_id}`);
    expect(row).toMatchObject({ rail: "airwallex_transfer", amount: "12.00", currency: "USD", moved: true, reconciliation: "matched", counterparty: "Purser" });
    expect(row!.approval.decision).toBe("APPROVED");
  });

  it("takes no fee for a payout that failed", async () => {
    await platform();
    const id = await usInvoice();
    const { proposal } = await propose(id);
    approve(proposal.proposal_id);
    awx.refuseNextTransfer = "insufficient_fund";
    await executeSupplierPayment(db, awx, awx, proposal.proposal_id).catch(() => undefined);
    expect(awx.platformFees).toHaveLength(0);
  });
});
