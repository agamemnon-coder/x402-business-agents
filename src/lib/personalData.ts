// The shapes of personal data that must not leave the runner in free text (GDPR Art. 5(1)(c)): an IBAN-shaped word (two
// letters, two check digits, then groups of four, with or without spaces, holding at least six digits) and an e-mail
// address. The runner takes them out of a payer's text before it goes (src/receivables/ar.ts referenceForCloud), and
// Purser Cloud refuses a snapshot that still holds one (cloud/src/moneyLoop.ts): the same patterns on both sides.
// The audit log keeps an account as its last four (accountsMaskedJson, applied by src/audit/log.ts to every payload it
// writes): its rows go to Purser Cloud too.

import { IBAN_LENGTHS, ibanValid } from "./iban.js";

/** An IBAN-shaped word, spaced or not (with its six digits checked by ibanShaped). */
const IBAN_WORD = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/gi;
/** An e-mail-shaped word. */
const EMAIL_WORD = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

const isAccount = (m: string) => /\d{6}/.test(m.replace(/\s/g, ""));

/** The text with every IBAN-shaped word and every e-mail address replaced by a placeholder. */
export const withoutAccountsOrAddresses = (s: string): string =>
  s.replace(EMAIL_WORD, "[e-mail]").replace(IBAN_WORD, (m) => (isAccount(m) ? "[account]" : m));

/** Whether the text holds an IBAN-shaped word or an e-mail address. */
export const holdsAccountOrAddress = (s: string): boolean =>
  new RegExp(EMAIL_WORD.source).test(s) || [...s.matchAll(IBAN_WORD)].some((m) => isAccount(m[0]));

/** The last four letters and digits of an account, as Purser shows it everywhere ("…3000"). */
const lastFour = (account: string) => `…${account.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`;

/**
 * The text with every IBAN in it replaced by its last four ("…3000"), spaced or not. A word is an IBAN when it starts
 * with a known country's code and holds as many characters as that country's IBANs: written in capitals, as IBANs are
 * printed, or passing the mod-97 check (in lower case). A hash, an id or a VAT number is left as it is.
 */
export function accountsMasked(s: string): string {
  return s.replace(IBAN_WORD, (m) => {
    const flat = m.replace(/\s/g, "").toUpperCase();
    const len = IBAN_LENGTHS[flat.slice(0, 2)];
    if (!len || flat.length < len) return m;
    // The match can run on into a short word after the account: only the account's own characters are masked.
    let seen = 0, cut = 0;
    while (seen < len) if (!/\s/.test(m[cut++]!)) seen++;
    const account = m.slice(0, cut);
    return !/[a-z]/.test(account) || ibanValid(account) ? `${lastFour(account)}${m.slice(cut)}` : m;
  });
}

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
