# Red team coverage of the threat model

Every row of the threat model in [docs/security.md](../security.md) and what proves that it is blocked. Red team attacks
run in a fresh throwaway world each (`npm run redteam`, and in CI as `test/redteam.test.ts`); the verdict is read from
the ledger, not from an error message. Scenario Lab stories are in `npm run lab` (and `test/lab.test.ts`).

| Row | Threat | Red team attack | Also |
|---|---|---|---|
| 1 | Invoice with new bank details | `bank-detail-change` | Lab `changed-bank-details` |
| 2 | Lookalike vendor name | `lookalike-vendor` | `test/fraud.test.ts` |
| 3 | Prompt injection in a document | `invoice-injection`, `dispute-injection` | Lab `ai-trick`; `test/injection.test.ts` |
| 4 | A model with the wrong amount, payee or an "approve" | `model-wrong-payee`, `invoice-injection` | `test/claude.test.ts` |
| 5 | False dispute ("refund everything") | `dispute-injection` | `test/disputes.test.ts` |
| 6 | An agent overspends | `overspend` | Lab `price-rise` |
| 7 | Forged, replayed or reused approval | `forged-approval`, `replayed-approval`, `signature-for-other-terms` | `test/passkey*.test.ts` |
| 8 | Terms changed after approval | `terms-changed-after-approval` | |
| 9 | Expired quote, late approval | `late-approval` | `test/euroBill.test.ts` (quote expiry) |
| 10 | Double payment | `double-payment` | Lab `duplicate-invoice` |
| 11 | Pull under a replaced mandate | — (only the chain can refuse it) | Live: `docs/runs/2026-10-29-s1.md` (`mandate_revoked`) |
| 12 | Abuse of the relay | `relay-flood` | `test/relay-worker.test.ts` |
| 13 | A relay that changes what the phone shows, or replays an older state | — | `test/relay-sign.test.ts`, `test/approve-client.test.ts` (runner signature and counter checked on the phone) |
| 14 | Stolen phone | `stolen-phone-no-face-id` | |
| 15 | Edit or truncate the log | `rewrite-history` | `test/audit.test.ts`, `npm run verify-log` |
| 16 | A key in git or in a model's context | — | `test/adversarial.test.ts` (no key reaches a model); secret scan before every commit; gitleaks in CI |
| 17 | Buy past the card limit | `outside-agent-overreach` | Lab `over-limit-raise` |
| 18 | Fake a card transaction | `forged-webhook` | `test/relay-hooks.test.ts`, `test/property-webhooks.test.ts` |
| 19 | Keep spending during an incident | `spend-during-incident` | Lab `emergency-stop`; `test/freeze.test.ts` |
| 20 | Divert the next payment with new bank details | `bank-detail-change` | `test/payee-change.test.ts` |
| 21 | Loosen the policy from words or a hijacked phone page | `unstop-from-phone`, `stranger-policy` | `test/policy-from-text.test.ts` |
| 22 | An outside agent spends or raises its own limit | `outside-agent-overreach` | Lab `outside-agent`; `test/mcp-server.test.ts` |
| 23 | One person approves a large payment alone | `four-eyes-alone` | `test/four-eyes.test.ts` |
| 24 | Many payments inside each single limit | `velocity-burst` | Lab `velocity-stop` |
| 25 | A card used for something else, or after its time | `card-wrong-merchant` | `test/cards.test.ts` |
| 26 | The same invoice twice | `duplicate-invoice` | Lab `duplicate-invoice` |
| 27 | A model answer of the wrong shape | `schema-slip` | `test/claude.test.ts` |
| 28 | Ledger and outside world disagree | `hidden-payment` | Lab `reconciliation-difference`; `test/reconcile.test.ts` |
| 29 | A bigger or reusable task card from a message | `ask-raise-limit-in-words`, `ask-hidden-characters`, `task-card-second-use` | Lab `ask-purser` |
| — | Outside money into the sweep wallet (B1) | `stranger-into-sweep` | Lab `unknown-sender` |
