// The shapes of personal data that must not leave the runner in free text (GDPR Art. 5(1)(c)): an IBAN, however it is
// written, an e-mail address, and the names the runner knows. The runner takes them out of a payer's text before it goes
// (src/receivables/ar.ts referenceForCloud), and Purser Cloud refuses a snapshot that still holds an account or an
// address (cloud/src/moneyLoop.ts): the same detection on both sides.
// The audit log keeps an account as its last four (accountsMaskedJson, applied by src/audit/log.ts to every payload it
// writes) and an inbox sender as the domain only (senderDomain): its rows go to Purser Cloud too.

import { IBAN_LENGTHS, ibanValid } from "./iban.js";

/** What a person may write between the parts of an IBAN: spaces, dots, dashes, underscores, slashes. */
const IBAN_SEPARATOR = /[\s.\-_/]/;
/** Where an IBAN can start: a country's two letters, not inside a word. */
const IBAN_START = /(?<![\p{L}\p{N}])[A-Za-z]{2}/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Every IBAN in the text, by where it starts and ends (separators inside it included). It is read on a compacted copy:
 * a known country's code, two check digits and as many letters and digits as that country's IBANs have, whatever
 * separators stand between them, and at least six digits in all. One that runs on into more letters or digits is a
 * longer word (a hash, an id), not an account. `strict`: only one written in capitals, as IBANs are printed, or passing
 * the mod-97 check (in lower case); so a hex hash or an id in a log line is not taken for one.
 */
function ibanSpans(s: string, strict: boolean): { start: number; end: number; flat: string }[] {
  const out: { start: number; end: number; flat: string }[] = [];
  for (const m of s.matchAll(IBAN_START)) {
    const start = m.index;
    if (out.length && start < out[out.length - 1]!.end) continue;
    const len = IBAN_LENGTHS[m[0].toUpperCase()];
    if (!len) continue;
    let flat = "", i = start, end = start;
    while (i < s.length && flat.length < len) {
      const ch = s[i]!;
      if (/[A-Za-z0-9]/.test(ch)) { flat += ch; end = ++i; }
      else if (flat.length >= 2 && IBAN_SEPARATOR.test(ch)) i++;
      else break;
    }
    if (flat.length !== len || (end < s.length && LETTER_OR_DIGIT.test(s[end]!))) continue;
    if (!/^[A-Za-z]{2}\d{2}/.test(flat) || !/(?:\D*\d){6}/.test(flat)) continue;
    if (strict && /[a-z]/.test(flat) && !ibanValid(flat)) continue;
    out.push({ start, end, flat });
  }
  return out;
}

/** Each IBAN in the text replaced by what `to` makes of it. */
const replaceIbans = (s: string, strict: boolean, to: (flat: string) => string): string => {
  let out = "", at = 0;
  for (const x of ibanSpans(s, strict)) { out += s.slice(at, x.start) + to(x.flat); at = x.end; }
  return out + s.slice(at);
};

/** An e-mail address: its @ also written with spaces round it, or as (at) or [at]. */
const AT = String.raw`(?:\s*@\s*|\s*\(\s*at\s*\)\s*|\s*\[\s*at\s*\]\s*)`;
const ADDRESS_PART = String.raw`[^\s@()\[\]<>,;]`;
const EMAIL = new RegExp(String.raw`${ADDRESS_PART}+${AT}${ADDRESS_PART}+\.${ADDRESS_PART}+`, "giu");

/** The text with every IBAN and every e-mail address replaced by a placeholder. */
export const withoutAccountsOrAddresses = (s: string): string => replaceIbans(s.replace(EMAIL, "[e-mail]"), false, () => "[account]");

/** Whether the text holds an IBAN or an e-mail address. */
export const holdsAccountOrAddress = (s: string): boolean => new RegExp(EMAIL.source, "iu").test(s) || ibanSpans(s, false).length > 0;

/**
 * The text with each of these names taken out, whole words only, in any case. Letters outside ASCII count as letters
 * ("Ørsted" next to "É"), and a name is matched in the same Unicode form as the text.
 */
export function withoutNames(s: string, names: readonly string[]): string {
  let out = s.normalize("NFC");
  for (const n of [...new Set(names.map((x) => x.normalize("NFC").trim()).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), "[name]");
  }
  return out;
}

/** The last four letters and digits of an account, as Purser shows it everywhere ("…3000"). */
const lastFour = (account: string) => `…${account.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`;

/**
 * The text with every IBAN in it replaced by its last four ("…3000"), however it is written (ibanSpans): written in
 * capitals, as IBANs are printed, or passing the mod-97 check (in lower case). A hash, an id or a VAT number is left as
 * it is.
 */
export const accountsMasked = (s: string): string => replaceIbans(s, true, lastFour);

/** A field that names an account (iban, new_iban, old_iban): its value as the last four, whatever its shape. */
const ACCOUNT_KEY = /(?:^|_)iban$/i;

/** The same over every string inside a JSON value, and every account field by its name. */
export function accountsMaskedJson<T>(value: T): T {
  if (typeof value === "string") return accountsMasked(value) as T;
  if (Array.isArray(value)) return value.map((v) => accountsMaskedJson(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ACCOUNT_KEY.test(k) && typeof v === "string" && v.replace(/[^A-Za-z0-9]/g, "").length > 4 ? lastFour(v) : accountsMaskedJson(v)])) as T;
  }
  return value;
}

/** An e-mail sender ("Anna Bakker <anna@example.com>") as its domain only ("@example.com"); null when it names no address. */
export function senderDomain(from: string): string | null {
  const domain = /@([A-Za-z0-9.-]+\.[A-Za-z0-9-]+)/.exec(from)?.[1];
  return domain ? `@${domain.toLowerCase()}` : null;
}
