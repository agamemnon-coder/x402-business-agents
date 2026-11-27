// The shapes of personal data that must not leave the runner in free text (GDPR Art. 5(1)(c)): an IBAN-shaped word (two
// letters, two check digits, then groups of four, with or without spaces, holding at least six digits) and an e-mail
// address. The runner takes them out of a payer's text before it goes (src/receivables/ar.ts referenceForCloud), and
// Purser Cloud refuses a snapshot that still holds one (cloud/src/moneyLoop.ts): the same patterns on both sides.

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
