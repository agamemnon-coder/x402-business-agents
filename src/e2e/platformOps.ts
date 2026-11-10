// What the platform end-to-end needs of Airwallex as Purser the platform (never on behalf of anyone): a connected
// account per test company (the existing ACTIVE one, or one opened, filled in with a fictional sole trader's details,
// submitted and activated with the sandbox's simulation), and test money moved into it from the platform.
//
// The live implementation uses Purser's client (src/airwallex/client.ts) and platform rail (src/airwallex/platform.ts)
// on the sandbox only; the fake one stands in for the dry run and the tests.

import { Airwallex } from "../airwallex/client.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { AirwallexPlatformRest, ACCOUNT_ID } from "../airwallex/platform.js";
import { fromCents } from "../lib/money.js";
import type { WorldCompany } from "./world.js";

export interface OpenedAccount { accountId: string; status: string; opened: boolean; ids: Record<string, string> }
export interface Funding { id: string; status: string }

export interface PlatformOps {
  /** Purser's own Airwallex account: where its fee goes, as the account binding names it. */
  readonly feeAccount: string;
  ensureAccount(c: WorldCompany): Promise<OpenedAccount>;
  /** Test money from the platform into the company's connected account (connected_account_transfers/create). */
  fund(accountId: string, cents: number, requestId: string): Promise<Funding>;
  /** Airwallex's current rate for EUR into another currency (GET /fx/rates/current), on the platform's own login. */
  eurRate(to: "USD"): Promise<FxRate>;
}

/** A rate as Airwallex gave it: units of `to` per EUR, worked out from the amounts it quoted, and when. */
export interface FxRate { rate: string; to: string; at: string; source: string }

/** Units of the buy currency per unit sold, from the amounts (cents), to 6 decimals: no direction to guess. */
export function rateFromAmounts(buyCents: number, sellCents: number): string {
  if (!(buyCents > 0 && sellCents > 0)) throw new Error("a rate needs two positive amounts");
  return (buyCents / sellCents).toFixed(6);
}

/**
 * The fictional, non-registered sole trader's details a sandbox account needs before it can be submitted. Field names
 * as Airwallex's minimum requirements for NL list them (docs: connected-accounts/onboarding/kyc-and-onboarding/
 * native-api/business-kyc-requirements/netherlands-(nl), read 10 November): no business identifier or documents for a
 * non-registered sole trader; addresses with state and suburb; the UBO as AUTHORISED_PERSON and BENEFICIAL_OWNER.
 */
export function soleTraderDetails(c: WorldCompany): Record<string, unknown> {
  const address = { address_line1: "Teststraat 1", suburb: "Amsterdam", state: "Noord-Holland", postcode: "1011 AA", country_code: "NL" };
  return {
    account_details: {
      legal_entity_type: "BUSINESS",
      business_details: {
        business_name: c.name,
        business_structure: "SOLE_PROPRIETOR",
        description_of_goods_or_services: "Fictional test company for Purser's sandbox end-to-end run; not a real business.",
        industry_category_code: "ICCV3_0808XX",
        operating_country: ["NL"],
        registration_address: address,
        account_usage: { product_reference: ["MAKE_TRANSFERS"], estimated_monthly_revenue: { amount: "5000", currency: "EUR" } },
      },
      business_person_details: [{
        first_name: "Test", last_name: "Persoon (fake)", date_of_birth: "1985-01-01", nationality: "NL",
        roles: ["AUTHORISED_PERSON", "BENEFICIAL_OWNER"], residential_address: address,
        identifications: { primary: { identification_type: "PASSPORT", issuing_country_code: "NL" } },
      }],
    },
  };
}

export class LivePlatformOps implements PlatformOps {
  private readonly rest: AirwallexPlatformRest;
  constructor(private readonly api: Airwallex, readonly feeAccount: string, private readonly o: { sleep?: (ms: number) => Promise<void>; activationWaitMs?: number } = {}) {
    if (api.onBehalfOf) throw new Error("the platform's own calls are never made on behalf of a connected account");
    this.rest = new AirwallexPlatformRest(api);
  }

  async ensureAccount(c: WorldCompany): Promise<OpenedAccount> {
    if (c.accountId) return { accountId: c.accountId, status: "ACTIVE (opened 10 November, not read again)", opened: false, ids: {} };
    const requestId = `e2e-open-${c.key.toLowerCase()}`;
    const opened = await this.rest.createConnectedAccount({ businessName: c.name, countryCode: "NL", email: `${c.key.toLowerCase()}@test.purser.invalid`, requestId });
    await this.api.call("POST", `/accounts/${opened.accountId}/update`, soleTraderDetails(c));
    const submitted = await this.api.call<{ status?: string }>("POST", `/accounts/${opened.accountId}/submit`, {});
    // The sandbox processes a submission in the background: activating 0.7 s after it was refused, 60 s after it worked.
    await (this.o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(this.o.activationWaitMs ?? 60_000);
    const active = await this.api.call<{ status?: string }>("POST", `/simulation/accounts/${opened.accountId}/update_status`, { next_status: "ACTIVE" });
    return { accountId: opened.accountId, status: active.status ?? "?", opened: true, ids: { created: opened.status, submitted: submitted.status ?? "?" } };
  }

  async eurRate(to: "USD"): Promise<FxRate> {
    const buyCents = 10_000;
    const r = await new AirwallexRest(this.api).currentRate({ buyCurrency: to, sellCurrency: "EUR", buyAmountCents: buyCents });
    return { rate: rateFromAmounts(buyCents, r.sellAmountCents), to, at: r.at, source: `Airwallex sandbox GET /fx/rates/current (client rate ${r.rate}; ${to} 100.00 for EUR ${(r.sellAmountCents / 100).toFixed(2)})` };
  }

  async fund(accountId: string, cents: number, requestId: string): Promise<Funding> {
    if (!ACCOUNT_ID.test(accountId)) throw new Error("not an Airwallex account id");
    const r = await this.api.call<{ id: string; status: string }>("POST", "/connected_account_transfers/create", {
      request_id: requestId, destination: accountId, amount: fromCents(cents), currency: "EUR", reason: "business_expenses", reference: "Purser e2e test money",
    });
    return { id: r.id, status: r.status };
  }
}

/** The dry run's platform: account ids made up in the run, funding that only counts. */
export class FakePlatformOps implements PlatformOps {
  readonly feeAccount = "acct_purser_platform";
  readonly funded: { accountId: string; cents: number }[] = [];
  /** Where the dry run's test money lands (its stand-in rails). */
  onFund: (accountId: string, cents: number) => void = () => undefined;
  private n = 0;
  async ensureAccount(c: WorldCompany): Promise<OpenedAccount> {
    if (c.accountId) return { accountId: c.accountId, status: "ACTIVE", opened: false, ids: {} };
    return { accountId: `acct_fake_${c.key.toLowerCase()}`, status: "ACTIVE", opened: true, ids: { created: "CREATED", submitted: "SUBMITTED" } };
  }
  async eurRate(): Promise<FxRate> { throw new Error("the dry run has no rate: its T:0 books in EUR"); }
  async fund(accountId: string, cents: number): Promise<Funding> {
    this.funded.push({ accountId, cents });
    this.onFund(accountId, cents);
    return { id: `cat_fake_${++this.n}`, status: "SETTLED" };
  }
}
