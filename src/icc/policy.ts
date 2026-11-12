// The ICC rail's switch, its merchants and its fixed limits (docs/visa-icc.md). Nothing here has run against the
// service: the rail exists so that the first sandbox hour needs no new code.
//
// Off unless KIT11_ICC_RAIL=on. With the switch absent nothing of this rail is reachable: the executor refuses the
// kind, no proposal is filed, no table is made. The rail adds no setting to the CFO policy: every ICC purchase needs
// the CFO's passkey over its exact terms (there is no amount an agent may spend alone here), a merchant outside the
// registry below is always refused, and above ICC_HARD_CAP_CENTS a purchase is refused even with Face ID.

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function iccRailOn(env: Env = process.env): boolean {
  return env.KIT11_ICC_RAIL === "on";
}

/** Refused above this even with Face ID. */
export const ICC_HARD_CAP_CENTS = 200_00;
/** The currencies a purchase may be in. The documentation's examples use USD only; whether EUR is taken is open. */
export const ICC_CURRENCIES: readonly string[] = ["EUR", "USD"];
/** The credential request's documented limit for a merchant name. A longer name is refused, never cut. */
export const ICC_MERCHANT_NAME_MAX = 40;

export interface IccMerchant {
  id: string;
  /** At most ICC_MERCHANT_NAME_MAX characters. */
  name: string;
  url: string;
  country: string;
}

/**
 * The merchants this rail knows. One: Northwind's own test shop, under a name that fits the API's 40 characters (the
 * Airi rail's name for the same shop is 47 long); its URL is our public site. Nothing here is a real merchant.
 */
export const ICC_MERCHANTS: readonly IccMerchant[] = [
  { id: "northwind-test-shop", name: "Northwind Outdoor test shop", url: "https://kit11.max-31b.workers.dev/", country: "NL" },
];

export function iccMerchantById(id: string): IccMerchant | undefined {
  return ICC_MERCHANTS.find((m) => m.id === id);
}

/** The registry's merchant with exactly this name, URL and country, if any. */
export function iccMerchantOf(m: { name: string; url: string; country: string }): IccMerchant | undefined {
  return ICC_MERCHANTS.find((x) => x.name === m.name && x.url === m.url && x.country === m.country);
}
