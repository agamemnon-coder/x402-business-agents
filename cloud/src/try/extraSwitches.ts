// The switches of the demo's extras (the try-extras stream): each one is OFF while its row is missing, like every
// on/off switch of the hands-on deployment (./switches.ts), so a late merge can never change what a visitor sees.
//   bot_check      the proof of work before a start (./botCheck.ts); needs the secret TRY_BOTCHECK_SECRET
//   counter        GET /v1/try/counter: scenarios played, frauds caught, Face ID signatures, payments without one (./counter.ts)
//   end_card       the end card: what you did with its ids, "Verify yourself", expected against the agents (src/try/endCard.ts)
//   books_effect   the books screen's P&L and VAT before and after, and the labelled T0 row (src/try/books.ts)
//   partner_lines  one plain line per screen naming whose part ran there (src/try/partners.ts)
//   scenarios      the scenario library and the visitor's seed, with replay and another scenario (src/try/scenarios/)
//   tour           the 30-second skippable tour (src/try/tour.ts)
//   feedback       the anonymous three-choice feedback on the end card (./feedback.ts)
//   talk_round     /try/sign's "talk the agent round" step on the kit11 Worker (worker/src/talkRound.ts) and its counter
//   awx_cards      the agents' live Airwallex sandbox cards: issue, freeze, unfreeze, limits, a test purchase, each signed
//                  with the CFO's passkey (cloud/src/agentCards.ts); off: no card action reaches Airwallex
//   awx_fx         the live Airwallex sandbox FX quote in the terms (cloud/src/engine/liveFx.ts); off: the recorded rate, labelled
//   awx_payout     after a verified signature, one Airwallex sandbox transfer of the signed payment (cloud/src/engine/livePayout.ts); off: the simulated bank only, labelled
export const EXTRA_SWITCHES = ["bot_check", "counter", "end_card", "books_effect", "partner_lines", "scenarios", "tour", "feedback", "talk_round", "awx_fx", "awx_payout", "awx_cards"] as const;
export type ExtraSwitch = (typeof EXTRA_SWITCHES)[number];
