// Money is integer cents, never a float, and a fixed two-decimal string in words ("0.05"). *USDZ, Metal's test
// dollar, has 18 decimals on chain: one cent is 10^16 base units. These two helpers are kept identical to Purser's
// src/lib/money.ts so the example has no imports outside its folder; test/metal-dispute-desk-parity.test.ts in the
// Purser repository fails if they drift.

/** 185000 -> "1850.00". */
export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`not a non-negative integer cent amount: ${cents}`);
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${whole}.${rest.toString().padStart(2, "0")}`;
}

const CENT_BASE_UNITS = 10n ** 16n;

/** On-chain base units -> cents. Refuses sub-cent amounts: mandates work in whole cents only. */
export function baseUnitsToCents(units: bigint): number {
  if (units < 0n) throw new Error("negative amount");
  if (units % CENT_BASE_UNITS !== 0n) throw new Error(`sub-cent amount on chain: ${units}`);
  const cents = units / CENT_BASE_UNITS;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount too large");
  return Number(cents);
}
