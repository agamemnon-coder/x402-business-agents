// Card data on the Airi rail: the figures the code works with, in one place. The executor (purchase.ts), the
// credential reader (credential.ts), the hosted checkout (hostedCheckout.ts) and the text scrubber (client.ts) use
// them; /visa shows them (src/redesign/cardData.ts); test/airi-card-data.test.ts holds the code, the page and the
// committed run records to them. A leaf: it imports nothing.
//
// What this is not: a network-tokenised checkout (the credential is typed into a card form, as a card number), or a
// set-up anyone has assessed against the card industry's security standard (PCI DSS). Sandbox and a test card only.

/** The credential's folder, made fresh for one checkout: only its owner can open it. */
export const CREDENTIAL_DIR_MODE = 0o700;
/** A credential file with any of these permission bits (its group's or anyone else's) is refused unread. */
export const CREDENTIAL_OTHERS_MASK = 0o077;
/** The credential's file in that folder. */
export const CREDENTIAL_FILE_NAME = "credential.json";
/** A larger file is not a credential: refused unread. */
export const CREDENTIAL_MAX_BYTES = 64 * 1024;
/** The only origin the card is ever typed into: Airwallex's sandbox Hosted Payment Page (seen in the probe of 7 November). */
export const HPP_ORIGIN = "https://checkout.sandbox.airwallex.com";
/** Text kept from airi-cli or a checkout loses every run of this many digits or more (a card or token number is longer). */
export const SCRUB_DIGITS_FROM = 12;
/** A security code after its word: cvv, cvc, csc, cvv2 or "security code", then 3 or 4 digits. */
export const CVV_PATTERN = /\b(cvv|cvc|csc|cvv2|security[ _-]?code)\b\W{0,3}\d{3,4}/gi;
