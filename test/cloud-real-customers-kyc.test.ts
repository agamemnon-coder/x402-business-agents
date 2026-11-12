// Real customers, part 1 (docs/real-customers.md): a new company in Purser Cloud gets its own Airwallex account with
// KYC done by Airwallex in its own hosted flow; Purser follows the status (webhook or poll) and nothing is paid from the
// account until Airwallex reports it ACTIVE. Purser never collects or keeps identity documents. Fake rail: no network.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkBinding } from "../src/airwallex/binding.js";
import { Airwallex } from "../src/airwallex/client.js";
import { AirwallexPlatformRest, type NewConnectedAccount, type PlatformRail } from "../src/airwallex/platform.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { PLATFORM_PRIVATE_KEY, PLATFORM_PUBLIC_KEY, PURSER_FEE_ACCOUNT } from "./support/platformBinding.js";

const SECRET = "whsec-test-not-a-secret-kyc";

class Rail implements PlatformRail {
  status = "CREATED";
  gets = 0;
  async createConnectedAccount(_a: NewConnectedAccount) { return { accountId: "acct_newco000001", status: "CREATED" }; }
  async findConnectedAccount() { return null; }
  async onboardingLink() { return "https://www.airwallex.com/app1/hostedflow?ahfi_id=ahfi_test&authorization_code=fake"; }
  async getAccount(accountId: string) { this.gets++; return { accountId, status: this.status }; }
}

let c: TestCloud;
let t: TestTenant;
let rail: Rail;
beforeEach(async () => {
  c = testCloud();
  rail = new Rail();
  c.env.awxPlatform = { rail, template: "tmpl_fake_kyc", webhookSecret: SECRET, bindingKey: PLATFORM_PRIVATE_KEY, feeAccount: PURSER_FEE_ACCOUNT, termsVersion: "airwallex-platform-terms-2026-11" };
  t = await c.tenant("newco");
});
afterEach(() => c.close());

const OPEN = { business_name: "NewCo B.V. (test)", country_code: "NL", email: "finance@newco.test", agreed: true };
const env = () => ({ PURSER_PLATFORM_PUBLIC_KEY: PLATFORM_PUBLIC_KEY, PURSER_TENANT_ID: t.id });
async function paysFrom(): Promise<ReturnType<typeof checkBinding>> {
  const b = await c.req("GET", "/v1/airwallex/binding", { key: t.key });
  return checkBinding(b.json.binding as string, c.clock.now, env());
}
function hook(name: string, at = c.clock.now) {
  const text = JSON.stringify({ id: `evt_${name}`, name, data: { object: { id: "acct_newco000001" } } });
  const ts = String(at.getTime());
  return c.req("POST", "/v1/airwallex/webhook", { raw: text, headers: { "x-timestamp": ts, "x-signature": createHmac("sha256", SECRET).update(ts + text).digest("hex") } });
}

describe("KYC onboarding through Airwallex's hosted flow", () => {
  it("refuses every payment from the company's account until Airwallex reports it ACTIVE (webhook or poll)", async () => {
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN })).status).toBe(201);
    // The owner gets Airwallex's own hosted onboarding link; Purser asks for no document itself.
    const link = await c.req("POST", "/v1/airwallex/onboarding-link", { key: t.session });
    expect(link.json.url).toMatch(/^https:\/\/www\.airwallex\.com\//);
    expect(await paysFrom()).toMatchObject({ ok: false, reason: expect.stringMatching(/created, not active/) });

    expect((await hook("account.submitted")).json).toMatchObject({ applied: true, status: "pending" });
    expect(await paysFrom()).toMatchObject({ ok: false, reason: expect.stringMatching(/pending, not active/) });

    // No webhook yet: the owner (or a scheduled check) asks Airwallex for the status.
    rail.status = "ACTION_REQUIRED";
    c.clock.now = new Date(c.clock.now.getTime() + 60_000);
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).json.account).toMatchObject({ status: "action_required" });
    expect((await paysFrom()).ok).toBe(false);

    rail.status = "ACTIVE";
    c.clock.now = new Date(c.clock.now.getTime() + 60_000);
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).json.account).toMatchObject({ status: "active" });
    expect(await paysFrom()).toMatchObject({ ok: true, binding: { account_id: "acct_newco000001", status: "active" } });

    // Suspended later: payments stop again.
    expect((await hook("account.suspended", new Date(c.clock.now.getTime() + 1000))).json).toMatchObject({ applied: true, status: "refused" });
    expect((await paysFrom()).ok).toBe(false);
  });

  it("a late webhook never makes a suspended account active again; only a poll of Airwallex does", async () => {
    await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    rail.status = "ACTIVE";
    await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session });
    expect((await hook("account.suspended", new Date(c.clock.now.getTime() + 1000))).json).toMatchObject({ applied: true, status: "refused" });
    // A retry of an old account.active, signed later than the suspension.
    expect((await hook("account.active", new Date(c.clock.now.getTime() + 2000))).json).toEqual({ applied: false });
    expect((await paysFrom()).ok).toBe(false);
    c.clock.now = new Date(c.clock.now.getTime() + 60_000);
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).json.account).toMatchObject({ status: "active" });
    expect((await paysFrom()).ok).toBe(true);
  });

  it("a poll is the newest word: an older webhook arriving after it changes nothing", async () => {
    await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    rail.status = "ACTIVE";
    await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session });
    expect((await hook("account.submitted", new Date(c.clock.now.getTime() - 30_000))).json).toEqual({ applied: false });
    expect((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json.account).toMatchObject({ status: "active" });
  });

  it("an unknown status from Airwallex leaves the status as it was; an answer about another account changes nothing", async () => {
    await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    rail.status = "SOMETHING_NEW";
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).json.account).toMatchObject({ status: "created" });
    rail.getAccount = async () => ({ accountId: "acct_someoneelse1", status: "ACTIVE" });
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).status).toBe(502);
    expect((await paysFrom()).ok).toBe(false);
  });

  it("only a signed-in owner asks; off without the platform configuration; none before an account exists", async () => {
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).status).toBe(404);
    await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.key })).status).toBe(403);
    delete c.env.awxPlatform;
    expect((await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session })).status).toBe(404);
  });

  it("reads only the id and status of the account, never the identity data Airwallex returns", async () => {
    const pii = { id: "acct_newco000001", status: "SUBMITTED", view_type: "COMPLETE", account_details: { individual_details: { first_name: "Test", date_of_birth: "1985-01-01", identification_number: "X1234567" } } };
    const f: typeof fetch = async (input) => new Response(JSON.stringify(String(input).endsWith("/authentication/login") ? { token: "tok" } : pii), { status: 200 });
    const r = await new AirwallexPlatformRest(new Airwallex({ clientId: "id", apiKey: "key", fetchImpl: f, sleep: async () => {}, minGapMs: 0 })).getAccount("acct_newco000001");
    expect(r).toEqual({ accountId: "acct_newco000001", status: "SUBMITTED" });
    await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    await c.req("POST", "/v1/airwallex/account/refresh", { key: t.session });
    expect(JSON.stringify(await c.env.sql.all("SELECT * FROM awx_accounts"))).not.toMatch(/date_of_birth|identification|1985/);
  });
});
