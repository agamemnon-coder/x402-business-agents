// "What you are seeing": the short key under the film on /watch, from the claims list (src/film/claims.ts). Each line
// names the claims it rests on; test/watch-film.test.ts checks that every one exists and holds in its record.

export interface KeyLine { text: string; claims: string[] }

/** Ran for real: sandbox and testnet runs with test money, real Claude calls, the owner's real signature. */
export const REAL: readonly KeyLine[] = [
  { text: "Airwallex sandbox, 7 November: a card charge declined over its limit; a payout the owner signed with Face ID, paid by SWIFT (settlement simulated).", claims: ["C09", "C12"] },
  { text: "Metal testnet, 3 November: 86 payments inside the limits; purchase #24 refused on chain, our own check off on purpose.", claims: ["C13", "C14"] },
  { text: "24 Claude decisions, main run, 3 November.", claims: ["C22"] },
  { text: "Visa Intelligent Commerce through Airwallex's Airi, 7 November, on a test card.", claims: ["C15"] },
  { text: "The owner's signature on receipt P-0002, which your browser can check.", claims: ["C18"] },
];

/** Simulated, or a stand-in, and said so in the film. */
export const SIMULATED: readonly KeyLine[] = [
  { text: "All money is test money; in the /try/sign test world and in the Moneybird run, none moves.", claims: ["C09", "C13", "C15", "C17"] },
  { text: "Settlement (SENT, PAID) and the card charges' merchants: simulated by the sandbox.", claims: ["C10", "C12"] },
    { text: "The test companies; and where a test passkey signed, not Face ID, the film says so.", claims: ["C20b", "C26", "C32"] },
];
