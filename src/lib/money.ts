// Money is integer cents everywhere in code, and a fixed two-decimal string ("1850.00") in terms and logs.
// Never a float. *USDZ has 18 decimals on chain; one cent is 10^16 base units.

const DECIMAL = /^(0|[1-9]\d*)\.(\d{2})$/;

/** "1850.00" -> 185000. Rejects anything that is not exactly two decimals. */
export function toCents(amount: string): number {
  const m = DECIMAL.exec(amount);
  if (!m) throw new Error(`not a two-decimal amount: ${JSON.stringify(amount)}`);
  const cents = Number(m[1]) * 100 + Number(m[2]);
  if (!Number.isSafeInteger(cents)) throw new Error(`amount too large: ${amount}`);
  return cents;
}

/** 185000 -> "1850.00". */
export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`not a non-negative integer cent amount: ${cents}`);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${whole}.${rest.toString().padStart(2, "0")}`;
}

const CENT_BASE_UNITS = 10n ** 16n;

/** Cents of *USDZ -> on-chain base units (18 decimals). */
export function centsToBaseUnits(cents: number): bigint {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`not a non-negative integer cent amount: ${cents}`);
  return BigInt(cents) * CENT_BASE_UNITS;
}

/** On-chain base units -> cents. Refuses sub-cent amounts: mandates work in whole cents only. */
export function baseUnitsToCents(units: bigint): number {
  if (units < 0n) throw new Error("negative amount");
  if (units % CENT_BASE_UNITS !== 0n) throw new Error(`sub-cent amount on chain: ${units}`);
  const cents = units / CENT_BASE_UNITS;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount too large");
  return Number(cents);
}
