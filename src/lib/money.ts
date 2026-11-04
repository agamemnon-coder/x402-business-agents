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

/**
 * A written amount, in the notations suppliers use ("1.850,00", "1,850.00", "€1850", "1 850,00", "EUR 1.850"), as
 * Purser's one form ("1850.00"); null when it cannot be read whole. Thousands are grouped by one separator (dot,
 * comma or a space), used consistently; the decimal part, if any, is two digits after the other separator. A dot or
 * comma with three digits after it is a thousands separator, not a decimal one.
 */
export function readAmount(written: string): string | null {
  const s = written.trim().replace(/^(?:EUR|USD|USDZ|€|\$)\s*/i, "").replace(/\s*(?:EUR|USD|€)$/i, "");
  let whole: string, cents = "00";
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)$/.exec(s))) whole = m[1]!;
  else if ((m = /^(\d+)[.,](\d{2})$/.exec(s))) [whole, cents] = [m[1]!, m[2]!];
  else if ((m = /^(\d{1,3})([., \u00a0\u202f])(\d{3}(?:\2\d{3})*)(?:([.,])(\d{2}))?$/.exec(s)) && m[4] !== m[2]) {
    whole = m[1]! + m[3]!.split(m[2]!).join("");
    if (m[5]) cents = m[5];
  } else return null;
  const total = Number(whole) * 100 + Number(cents);
  return Number.isSafeInteger(total) ? fromCents(total) : null;
}
