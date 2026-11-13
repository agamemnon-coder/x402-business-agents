// "Card data" on /visa (12 Nov): how the Airi rail handles the single-use credential, as one folded row under the two
// Airi runs. The fold's own line already says what this is not; inside, the three plain statements first, then what the
// code does with the credential, each figure read from the code's constants (src/airi/cardData.ts), then the code and
// the test that hold it.
//
// Honesty: nothing here reads as a sign-off. Not a network-tokenised checkout: the credential is typed into a card form,
// as a card number (Airwallex's own record of the run calls it a PAN: "As reported by the Airwallex sandbox", above).
// No PCI attestation: no assessor has looked at this. Sandbox and a test card only. What is said about the code is
// held by test/airi-card-data.test.ts (the file and its folder gone after every outcome; no card number, expiry or
// security code in the ledger or a committed run record; this block's figures are the constants),
// test/airi-hosted-checkout.test.ts (one origin only) and test/airi-purchase.test.ts (a leftover folder removed at the
// next start).

import { CREDENTIAL_DIR_MODE, HPP_ORIGIN, SCRUB_DIGITS_FROM } from "../airi/cardData.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const CARD_DATA_ID = "vic-card-data";
/** The fold's line: what this is not, readable without opening it. */
export const CARD_DATA_SUMMARY = "Card data: not a network-tokenised checkout, no PCI attestation";
/**
 * The three plain statements, word for word, that open the block. Jury round 2, 13 Nov: the second says it was the
 * sandbox's hosted card page in a test run, and claims nothing about production (the records do not document it).
 */
export const CARD_DATA_NOT: readonly string[] = [
  "This is not a network-tokenised checkout.",
  "In a sandbox test run, a headless browser types Airi's Visa credential into Airwallex's hosted card page, as Airi's instructions say: like a normal card. How that credential relates to a Visa network token is not documented.",
  "There is no PCI attestation.",
];
/** The code that handles the credential, and the test that holds this block. */
const CODE = ["src/airi/credential.ts", "src/airi/hostedCheckout.ts", "src/airi/purchase.ts"];
const TEST = "test/airi-card-data.test.ts";

const octal = (mode: number) => `0${mode.toString(8)}`;

/** What the code does with the credential, its figures from the constants. */
export function cardDataFacts(): string[] {
  return [
    `The credential is one file, alone in a fresh folder that only its owner can open (mode ${octal(CREDENTIAL_DIR_MODE)}). A file anyone else could read is refused unread.`,
    "Purser removes the file and the folder when the checkout ends, paid or not. A leftover from a crash is removed at the next start.",
    `The browser types the card only into a page on ${new URL(HPP_ORIGIN).host}. It takes no screenshot, trace or video.`,
    `The full card number, the expiry and the security code are not written to the ledger or to a run record. Text kept from Airi or the checkout loses every run of ${SCRUB_DIGITS_FROM} or more digits.`,
  ];
}

/** The folded row for /visa. */
export function cardDataHtml(): string {
  const link = (f: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${f}`)}" target="_blank" rel="noopener">${esc(f)} ↗</a>`;
  return `<details class="fold" id="${CARD_DATA_ID}"><summary>${esc(CARD_DATA_SUMMARY)}</summary>
<p>${esc(CARD_DATA_NOT.join(" "))}</p>
<p>${esc("In plain words: a browser without a window, driven by the agent's code, fills in the card form the way a shopper would. No assessor has checked this against the card industry's security standard (PCI DSS). Sandbox and a test card only.")}</p>
<ul class="awc">${cardDataFacts().map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<p class="src">${esc("Code: ")}${CODE.map(link).join(esc(" · "))}${esc(" · held by ")}${link(TEST)}</p></details>`;
}

/** The list's bars in the border's own grey: these lines say what the code does, they are not passed checks. */
export const CARD_DATA_CSS = `#${CARD_DATA_ID} ul.awc { margin-bottom: 10px; } #${CARD_DATA_ID} ul.awc li { border-left-color: var(--border); }`;
