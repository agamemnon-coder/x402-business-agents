// Purser as an Airwallex platform, the cloud side (docs/airwallex-platform.md): an owner opens the company's Airwallex
// account through Purser, gets Airwallex's hosted onboarding link, and the account's status follows Airwallex's
// account.* webhooks. Against a fake platform rail: no call goes to Airwallex.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewConnectedAccount, PlatformRail } from "../src/airwallex/platform.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const SECRET = "whsec-test-not-a-secret-0123456789";

class FakeRail implements PlatformRail {
  opened: NewConnectedAccount[] = [];
  links: { accountId: string; template: string; returnUrl: string; identity: string }[] = [];
  next = 1;
  failNext: Error | null = null;
  async createConnectedAccount(a: NewConnectedAccount) {
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
    this.opened.push(a);
    return { accountId: `acct_fake${this.next++}`, status: "CREATED" };
  }
  async onboardingLink(a: { accountId: string; template: string; returnUrl: string; identity: string }) {
    this.links.push(a);
    return `https://www.airwallex.com/app/hosted/onboarding?code=fake-${this.links.length}`;
  }
  async getAccount(accountId: string) { return { accountId, status: "SUBMITTED" }; }
}

let c: TestCloud;
let t: TestTenant;
let rail: FakeRail;
beforeEach(async () => {
  c = testCloud();
  rail = new FakeRail();
  c.env.awxPlatform = { rail, template: "tmpl_fake_kyc", webhookSecret: SECRET };
  t = await c.tenant("northwind");
});
afterEach(() => c.close());

const OPEN = { business_name: "Northwind Outdoor B.V. (test)", country_code: "NL", email: "finance@northwind.test", agreed: true };

function signed(body: unknown, at = c.clock.now, secret = SECRET) {
  const text = JSON.stringify(body);
  const ts = String(at.getTime());
  return { raw: text, headers: { "x-timestamp": ts, "x-signature": createHmac("sha256", secret).update(ts + text).digest("hex") } };
}
const event = (name: string, accountId: string, id = `evt_${name}`) => ({ id, name, account_id: accountId, data: { object: { id: accountId } }, created_at: c.clock.now.toISOString() });

describe("opening the company's Airwallex account through Purser", () => {
  it("is off unless the cloud is configured for it", async () => {
    delete c.env.awxPlatform;
    expect((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json).toMatchObject({ switched_on: false, account: null });
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN })).status).toBe(404);
    expect((await c.req("POST", "/v1/airwallex/onboarding-link", { key: t.session })).status).toBe(404);
    expect((await c.req("POST", "/v1/airwallex/webhook", signed(event("account.active", "acct_fake1")))).status).toBe(404);
  });

  it("an owner opens it, once; the id is kept for the company and the status starts as created", async () => {
    const r = await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    expect(r.status).toBe(201);
    expect(r.json.account).toMatchObject({ account_id: "acct_fake1", status: "created", business_name: OPEN.business_name, country_code: "NL" });
    expect(rail.opened).toEqual([{ businessName: OPEN.business_name, countryCode: "NL", email: OPEN.email }]);
    expect((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json).toMatchObject({ switched_on: true, account: { account_id: "acct_fake1", status: "created" } });
    // A second request opens no second account.
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN })).status).toBe(409);
    expect(rail.opened).toHaveLength(1);
  });

  it("needs the terms agreed, a two-letter country and a signed-in owner (not a key, not another role)", async () => {
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.session, body: { ...OPEN, agreed: false } })).status).toBe(400);
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.session, body: { ...OPEN, country_code: "Netherlands" } })).status).toBe(400);
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.key, body: OPEN })).status).toBe(403);
    expect((await c.req("POST", "/v1/airwallex/onboarding-link", { key: t.key })).status).toBe(403);
    expect(rail.opened).toHaveLength(0);
  });

  it("stores nothing when Airwallex refuses, so the owner can try again", async () => {
    rail.failNext = new Error("Airwallex 400 invalid_argument");
    const r = await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    expect(r.status).toBe(502);
    expect(String(r.json.error)).toMatch(/Airwallex did not open the account/);
    expect((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json.account).toBeNull();
    expect((await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN })).status).toBe(201);
  });

  it("gives the owner Airwallex's onboarding link, made for the signed-in person and coming back to the console", async () => {
    expect((await c.req("POST", "/v1/airwallex/onboarding-link", { key: t.session })).status).toBe(404);
    await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN });
    const r = await c.req("POST", "/v1/airwallex/onboarding-link", { key: t.session });
    expect(r.status).toBe(200);
    expect(r.json.url).toMatch(/^https:\/\/www\.airwallex\.com\//);
    expect(rail.links).toEqual([{ accountId: "acct_fake1", template: "tmpl_fake_kyc", returnUrl: "https://cloud.test/#/settings", identity: t.owner }]);
    // The link is short-lived and never stored.
    expect(JSON.stringify((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json)).not.toMatch(/airwallex\.com/);
  });
});

describe("the account's status from Airwallex's webhooks", () => {
  beforeEach(async () => { await c.req("POST", "/v1/airwallex/account", { key: t.session, body: OPEN }); });
  const status = async () => ((await c.req("GET", "/v1/airwallex/account", { key: t.session })).json.account as { status: string }).status;

  it("follows submitted, action required and active", async () => {
    for (const [name, want] of [["account.submitted", "pending"], ["account.action_required", "action_required"], ["account.active", "active"]] as const) {
      c.clock.now = new Date(c.clock.now.getTime() + 1000);
      expect((await c.req("POST", "/v1/airwallex/webhook", signed(event(name, "acct_fake1")))).status).toBe(200);
      expect(await status()).toBe(want);
    }
    // Once active there is nothing left to onboard.
    expect((await c.req("POST", "/v1/airwallex/onboarding-link", { key: t.session })).status).toBe(409);
  });

  it("shows a suspended account as refused", async () => {
    await c.req("POST", "/v1/airwallex/webhook", signed(event("account.suspended", "acct_fake1")));
    expect(await status()).toBe("refused");
  });

  it("refuses a bad, missing or old signature and changes nothing", async () => {
    const good = signed(event("account.active", "acct_fake1"));
    expect((await c.req("POST", "/v1/airwallex/webhook", { raw: good.raw, headers: { ...good.headers, "x-signature": "0".repeat(64) } })).status).toBe(401);
    expect((await c.req("POST", "/v1/airwallex/webhook", { raw: good.raw })).status).toBe(401);
    expect((await c.req("POST", "/v1/airwallex/webhook", signed(event("account.active", "acct_fake1"), new Date(c.clock.now.getTime() - 10 * 60_000)))).status).toBe(401);
    expect((await c.req("POST", "/v1/airwallex/webhook", signed(event("account.active", "acct_fake1"), c.clock.now, "another-secret-0123456789"))).status).toBe(401);
    expect(await status()).toBe("created");
  });

  it("ignores an older event that arrives after a newer one", async () => {
    const early = signed(event("account.submitted", "acct_fake1"));
    c.clock.now = new Date(c.clock.now.getTime() + 2000);
    await c.req("POST", "/v1/airwallex/webhook", signed(event("account.active", "acct_fake1")));
    await c.req("POST", "/v1/airwallex/webhook", early);
    expect(await status()).toBe("active");
  });

  it("answers an unknown account or event without changing any company", async () => {
    const other = await c.tenant("othercorp");
    rail.next = 9;
    await c.req("POST", "/v1/airwallex/account", { key: other.session, body: { ...OPEN, business_name: "Other (test)" } });
    expect((await c.req("POST", "/v1/airwallex/webhook", signed(event("account.active", "acct_nobody1")))).json).toMatchObject({ applied: false });
    expect((await c.req("POST", "/v1/airwallex/webhook", signed(event("payout.transfer.paid", "acct_fake1")))).json).toMatchObject({ applied: false });
    await c.req("POST", "/v1/airwallex/webhook", signed(event("account.active", "acct_fake9")));
    expect(await status()).toBe("created");
    expect(((await c.req("GET", "/v1/airwallex/account", { key: other.session })).json.account as { status: string }).status).toBe("active");
  });

  it("a company sees only its own account", async () => {
    const other = await c.tenant("othercorp");
    expect((await c.req("GET", "/v1/airwallex/account", { key: other.session })).json.account).toBeNull();
  });
});

describe("the console", () => {
  it("offers the Airwallex card in Settings, with the terms named before the button", async () => {
    const page = await (await c.fetch("https://cloud.test/")).text();
    expect(page).toContain("/v1/airwallex/account");
    expect(page).toContain("cs.awx.agree");
  });
});
