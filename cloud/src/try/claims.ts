// The one sentence every document uses for what Purser Cloud does with money, kept here so it changes in one place
// (test/try-claims.test.ts holds every document to it). The clause about the Airwallex sandbox key is in it only while
// that key is set on purser-try (gate GR to the freeze); if the rail did not pass, A8 sets HOLDS_SANDBOX_KEY to false
// once the owner deleted the key, and the documents follow.
export const HOLDS_SANDBOX_KEY = false;
export const MONEY_SENTENCE = `Purser Cloud moves no real money. Its hands-on deployment runs the engine on test money and a simulated bank${HOLDS_SANDBOX_KEY ? ", and holds one Airwallex sandbox key" : ""}.`;
/** The hands-on link in the README and llms.txt: "coming" until the orchestrator flips it after gate G5 (flipped 13 Nov: /try is live). */
export const HANDS_ON_LIVE = true;
