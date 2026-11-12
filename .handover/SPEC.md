# Stream vic-3 (Visa): specification

From the orchestrator's decision of 12 November 2026 (research on the Visa juror's score). Build exactly this; nothing live without the owner (the live run is his).

## vic-3 conductor: Claude picks the airi_vic rail; terms hash in mandate and PaymentIntent, read back; network-side negative test (Visa (and best use of Claude), about 4 h)

GOAL: one live-ready series, 'vic-3', in which a Claude agent, not a script, chooses the Airi rail. The CFO-signed terms hash is read back from Airi's mandate and from Airwallex's PaymentIntent. The series tests whether Airi or Airwallex refuse a credential used for another amount.

EXISTING CODE (branch visa-vic-first-1112):
- src/agents/railChoice.ts: Haiku chooses between Stockline (x402), the Packwise card, and AIRI_RAIL 'airi_vic' when airiRailOffer allows it.
- src/airi/purchase.ts: requestAiriPurchase, decideAiriPurchase, an audit 'airi.rail_choice' row {by:'claude', model, request_id}, and mandateDescription with '[<action> terms:<sha256>]', read back before the credential (d8dfb66).
- src/airi/checkout.ts creates the PaymentIntent with request_id, amount, currency, merchant_order_id and descriptor, and NO metadata.
- src/cli/vicReadback.ts does GET-only read-back.
- src/cli/airiVic1.ts (154 lines) is the model conductor.
- src/airwallex/callBudget.ts holds the call budget.

TESTS FIRST (fake Airi client and fake Airwallex; no network):
- (1) checkout.ts sends metadata {purser_terms_sha256: <hash>, purser_proposal: <id>} on create when the purchase has signed terms. vicReadback returns the metadata, and the record marks equal or not equal.
- (2) The conductor runs these purchases in order:
  - A: within the limit; Claude chooses.
  - B: above the limit. Face ID, then the hash goes into the mandate, the mandate is read back (mandate get) and checked equal BEFORE get-credential, the hash goes into the PaymentIntent metadata, and the PaymentIntent is read back.
  - C: over the hard cap.
  - D: a merchant not on the CFO allowlist.
  - E: terms changed after Face ID.
  - F1: a new EUR 10.00 mandate whose credential is tried on a EUR 40.00 PaymentIntent.
  - F2: B's used credential tried once more on a new PaymentIntent, within the same process before deletion.
- (3) C, D and E produce 0 Airi calls and 0 Airwallex calls, which is asserted by counters.
- (4) For F1 and F2 the conductor records the exact status and code from Airi and Airwallex whatever they are, including SUCCEEDED. A run with an accepted F is a PASS of the test with the finding 'not refused by Airi/Airwallex sandbox; only Purser enforces the binding here'.
- (5) The record holds per purchase: rail_choice (by, model, request_id, the rail menu offered), mandate_id, payment_intent_id, terms_sha256, the read-back values, and the outcome. Every failed attempt is kept.
- (6) assertNoSecrets passes: no PAN, CVV, one-time link or credential in records or logs. The credential file is deleted after F2 at the latest. The test proves deletion.
- (7) Call budgets are hard-enforced in code: Anthropic at most 6 calls; Airwallex at most 20; airi-cli at most 24. Over budget means stop and record.

THEN BUILD:
- src/cli/airiVic3.ts and 'airi:vic-3' in package.json. It needs KIT11_AIRI_RAIL=on and an explicit VIC3_GO=yes, otherwise it refuses to start.
- A Haiku call only for the rail choice of A, B and F1. C, D and E go straight to requestAiriPurchase and are refused by Purser.

THEN:
- Write docs/runs/vic-3-plan.md: the purchases, the calls per step, what Max does (Airi login, 3 passkey taps for A, B and F1, Face ID for B and E, phone screen recording), stop rules, and go or no-go by Friday 12:00 UTC.
- Do a full dry run against the labelled stand-in (src/airi/standIn.ts). Commit its record as docs/runs/2026-11-12-vic-3-standin.md, labelled STAND-IN, not live.

DONE WHEN:
- Tests and CI are green.
- The stand-in dry run record is committed.
- Max gets 'klaar voor de live run' with the exact commands and the budget numbers to approve.

FORBIDDEN:
- Any live call without Max's go.
- 'Claude decided to use Visa'. Say instead 'the Sourcing agent (Claude Haiku) chose the Airi rail from three'.
- 'The CFO's policy is the Visa mandate'. Each Airi mandate is one signed purchase.
- Calling the PaymentIntent 'Visa's record'. It is 'Airwallex's PaymentIntent record'.
- A real card. Only Airi's test card.

## /visa and README read the vic-3 record (N of M paid, request id, read-back, negative-test result, phone clip) (Visa, about 2 h)

PREREQUISITE: the vic-3 live run record exists (docs/runs/2026-11-1x-vic-3.md plus its JSON), built by item 2's conductor. If there is no live record by Friday 15:00 UTC, do nothing here; the page keeps vic-1 and the 'Not tested' line.

TESTS FIRST (test/visa-page.test.ts, reading the committed record, no typed numbers):
- (a) The single VIC summary card shows 'N of M paid', with N and M computed from the record. Refused purchases are listed with Purser's code and '0 Airi calls'.
- (b) The heading tag reads 'rail chosen by Claude' and the first request id appears, shortened, with a link to the record. This uses the existing logic in src/redesign/visaOverview.ts.
- (c) The purchase-B table gains rows 'Terms hash in Airi's mandate (read back)' and 'Terms hash in Airwallex's PaymentIntent metadata (read back)', each marked 'Match' only if equal in the record.
- (d) The 'Not tested' line is replaced by the record's F1 and F2 result, word for word from a template. Either 'Airi/Airwallex sandbox refused it: <code>' or 'The Airi/Airwallex sandbox did not refuse it; in this sandbox only Purser enforces the amount'.
- (e) The five sandbox facts still render, with the attempt count recomputed for the new day.
- (f) If public/visa/vic3-poster.jpg and the clip exist, the page shows one poster with a play mark and the caption 'Test card, test credential, our own sandbox shop'. The clip must have no card digits and no one-time link visible; Max confirms in the PR.
- (g) The README Visa section has one line with the same N of M and the date, read from the record.
Then implement in src/redesign/airiRun.ts, vicFacts.ts and visaOverview.ts, keeping one card. No new section and no new menu item.

EVIDENCE: test summary plus /visa screenshots at 390 and 1440 px in the PR.

DONE WHEN: merged after CI is green, deployed after Max says go, and Max gets 'klaar om te testen' with these checks:
1. N of M matches the run log.
2. The request id opens the record.
3. The hash rows say Match only where the record says so.
4. The negative-test line matches what happened.
5. The clip plays and shows no card number.

FORBIDDEN: rounding a failure away, hiding failed attempts, 'Visa refused' unless the answer literally came from Visa, any Visa logo.

