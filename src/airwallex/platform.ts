// Purser as an Airwallex platform (docs/airwallex-platform.md): Purser opens an Airwallex account for a company (a
// connected account), Airwallex verifies the company in its own hosted flow, and the company's payouts run on behalf of
// that account. Behind AIRWALLEX_PLATFORM=on; the Purser fee behind AIRWALLEX_PLATFORM_FEE=on as well, because how a
// payout platform takes a fee from a connected account is not confirmed by Airwallex yet (see the doc).
//
// Every endpoint and field here is from Airwallex's documentation, read 9 November 2026; none has been called yet.

import type { Airwallex } from "./client.js";

/** An Airwallex account id as the platform docs write it (acct_…); nothing else may go into a header or a row. */
export const ACCOUNT_ID = /^acct_[A-Za-z0-9_-]{4,64}$/;

export const platformOn = (env: Record<string, string | undefined> = process.env) => env.AIRWALLEX_PLATFORM === "on";
export const platformFeeOn = (env: Record<string, string | undefined> = process.env) => platformOn(env) && env.AIRWALLEX_PLATFORM_FEE === "on";

/** What Purser shows for a connected account: its onboarding as the company sees it. */
export type PlatformStatus = "created" | "pending" | "action_required" | "active" | "refused" | "dormant" | "closed";

/**
 * Purser's fee per payout, at most this many basis points (1.00%), whatever the CFO policy says (red team 6: a fee of
 * 10000 bps doubled every payout). The CFO sets the fee within it as policy (platform.fee_bps), with Face ID.
 */
export const FEE_BPS_CAP = 100;

/** How long a binding Purser Cloud signs holds; the runner fetches a fresh one on every sync. */
export const BINDING_TTL_MS = 60 * 60_000;
export const BINDING_VERSION = 1;

/**
 * The company's binding to its own connected account, signed by Purser Cloud with the platform's Ed25519 key
 * (cloud/src/awxPlatform.ts signs, src/airwallex/binding.ts checks): which company, which account and its status, the
 * account's name as the cloud holds it, and Purser's own platform account any fee goes to.
 */
export interface AccountBinding {
  v: typeof BINDING_VERSION;
  tenant: string;
  account_id: string;
  status: PlatformStatus;
  name: string;
  fee_account: string;
  issued_at: number;
  expires_at: number;
}

/** Airwallex's account statuses (accounts/create response) in Purser's words; an unknown one is left unknown. */
export function statusFromAccount(s: string): PlatformStatus | null {
  return ({ CREATED: "created", SUBMITTED: "pending", ACTION_REQUIRED: "action_required", ACTIVE: "active", SUSPENDED: "refused", DORMANT: "dormant", CLOSED: "closed" } as Record<string, PlatformStatus>)[s] ?? null;
}

/** Airwallex's account webhooks (listen-for-webhook-events/account) in Purser's words; any other event is not one. */
export function statusFromWebhook(name: string): PlatformStatus | null {
  return ({
    "account.submitted": "pending", "account.action_required": "action_required", "account.active": "active",
    "account.suspended": "refused", "account.dormant": "dormant", "account.closed": "closed",
  } as Record<string, PlatformStatus>)[name] ?? null;
}

export interface NewConnectedAccount {
  businessName: string;
  countryCode: string;
  email: string;
  /** Idempotency: the same opening always sends the same id, so a retry never opens a second account (UNCONFIRMED field). */
  requestId: string;
}

export interface PlatformRail {
  createConnectedAccount(a: NewConnectedAccount): Promise<{ accountId: string; status: string }>;
  /** The hosted onboarding (KYC) link for the person, created and authorized; short-lived, so made when asked for. */
  onboardingLink(a: { accountId: string; template: string; returnUrl: string; identity: string }): Promise<string>;
  getAccount(accountId: string): Promise<{ accountId: string; status: string }>;
  /**
   * The account a create under this request id opened, if any (looked up before a stale opening is retried). Throws
   * when Airwallex cannot answer: then nothing is replaced. The lookup is UNCONFIRMED (docs/airwallex-platform.md).
   */
  findConnectedAccount(requestId: string): Promise<{ accountId: string; status: string } | null>;
}

const HOSTED = /^https:\/\/([a-z0-9-]+\.)*airwallex\.com\//;

/** The platform's own calls (never on behalf of anyone): opening and onboarding connected accounts. */
export class AirwallexPlatformRest implements PlatformRail {
  constructor(private readonly api: Airwallex) {
    if (api.onBehalfOf) throw new Error("the platform rail calls as the platform itself, never on behalf of a connected account");
  }

  /** POST /api/v1/accounts/create (native-api.md: the minimal account, with the company's name and country). */
  async createConnectedAccount(a: NewConnectedAccount): Promise<{ accountId: string; status: string }> {
    if (!/^[A-Z]{2}$/.test(a.countryCode)) throw new Error("the country is a two-letter code (NL, DE, …)");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(a.requestId)) throw new Error("the opening's request id is not an id");
    const r = await this.api.call<{ id: string; status: string }>("POST", "/accounts/create", {
      request_id: a.requestId,
      account_details: { business_details: { business_name: a.businessName.trim().slice(0, 200), registration_address: { country_code: a.countryCode } } },
      // The company agrees in Purser's console before this call (the console shows Airwallex's terms of use first).
      customer_agreements: { agreed_to_data_usage: true, agreed_to_terms_and_conditions: true },
      primary_contact: { email: a.email.trim() },
    });
    if (!ACCOUNT_ID.test(r.id)) throw new Error("Airwallex answered without an account id");
    return { accountId: r.id, status: r.status };
  }

  /** POST /api/v1/hosted_flows/create, then /hosted_flows/{id}/authorize (hosted-onboarding.md). */
  async onboardingLink(a: { accountId: string; template: string; returnUrl: string; identity: string }): Promise<string> {
    if (!ACCOUNT_ID.test(a.accountId)) throw new Error("not an Airwallex account id");
    const flow = await this.api.call<{ id: string; url?: string }>("POST", "/hosted_flows/create", { account_id: a.accountId, template: a.template, return_url: a.returnUrl, error_url: a.returnUrl });
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(flow.id)) throw new Error("Airwallex answered without a hosted flow id");
    const auth = await this.api.call<{ url?: string }>("POST", `/hosted_flows/${flow.id}/authorize`, { identity: a.identity });
    if (!auth.url || !HOSTED.test(auth.url)) throw new Error("the onboarding link is not on airwallex.com; it is not shown");
    return auth.url;
  }

  /** GET /api/v1/accounts/{id}. */
  async getAccount(accountId: string): Promise<{ accountId: string; status: string }> {
    if (!ACCOUNT_ID.test(accountId)) throw new Error("not an Airwallex account id");
    const r = await this.api.call<{ id: string; status: string }>("GET", `/accounts/${accountId}`);
    return { accountId: r.id, status: r.status };
  }

  /** GET /api/v1/accounts filtered by request_id (UNCONFIRMED filter): the one account it opened, or none. */
  async findConnectedAccount(requestId: string): Promise<{ accountId: string; status: string } | null> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new Error("not a request id");
    const r = await this.api.call<{ items?: { id?: string; status?: string; request_id?: string }[] }>("GET", `/accounts?request_id=${requestId}`);
    if (!Array.isArray(r.items)) throw new Error("Airwallex's account list has no items");
    const hits = r.items.filter((x) => x.request_id === requestId && typeof x.id === "string" && ACCOUNT_ID.test(x.id));
    if (hits.length > 1) throw new Error("more than one account under one request id");
    return hits[0] ? { accountId: hits[0].id!, status: hits[0].status ?? "" } : null;
  }
}
