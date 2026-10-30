# Compliance: who does what, and how Purser supports it

Purser is not certified, licensed or audited against any of the rules below, and this page does not claim it is.
It shows how the design is ready for them: for each topic, what the rule asks, who is responsible, and what Purser
does, with the proof in this repository. Today Purser runs on test money only: the Airwallex sandbox and Metal
testnet.

Who is who:

- **Airwallex** is the regulated party for the bank side: accounts, card issuing, FX and payouts. Its KYB on the
  business and its screening of payouts are Airwallex's own (not shown in this repo). The agents' cards sit under
  cardholders the business creates; in the sandbox they carry placeholder personal details.
- **Metal** provides the chain, *USDZ and the contracts that enforce mandates, clearing and receive policy.
- **The business** (in the demo, Northwind Outdoor) owns the money, sets the CFO policy and approves.
- **Purser** is software the business runs. It holds no customer money, never sees a card number, and cannot approve
  anything on the CFO's behalf.

## 1. Roles and money

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Only a licensed party holds and moves client money | Airwallex (bank side), Metal (chain) | The money sits in the business's own Airwallex account and Metal account. Purser asks those rails to move it; card limits at Airwallex and mandate limits on Metal apply whatever Purser asks; FX and SWIFT payouts are controlled by Purser's floors and the CFO's approval. | `docs/airwallex.md`, `docs/metal-award.md` |
| Know your customer and business | Airwallex | Each agent's card has a `DELEGATE` cardholder under the business's account: someone the business lets spend on its behalf. Airwallex's checks apply to the business. | `src/airwallex/issuing.ts` (`createCardholder`) |

## 2. EU AI Act: human oversight, logging, transparency, robustness

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| A person can oversee the AI and stop it | The business, with Purser's controls | No model output moves money. Code checks every limit; anything above the CFO's limits waits for the CFO's Face ID on the exact terms (small refunds and task cards within the policy run alone). Optional four eyes above a threshold the CFO sets. One Face ID stops every agent payment and freezes every card (tested against stand-ins; not yet run live). | `src/policy/approvals.ts`, `src/policy/fourEyes.ts`, `src/policy/rules.ts` (`frozen`), `test/freeze.test.ts` |
| Each AI step is logged | Purser | Every Claude reading is an audit row with the model, the request id, a hash of the input, the checked output and the token use; a fallback to the plain parser is logged too, with the reason. | `src/claude/reader.ts` (`claude.read`, `claude.fallback`) |
| People know when AI is involved | Purser | Proposals show which agent proposed and why; the dashboard says the agents are AI and that a person decides; simulated parts are labelled. | `src/dashboard/page.html`, `docs/overview.md` |
| Accuracy and robustness | Purser | Evals of the agents' readings run in CI on the deterministic parsers, and with the Claude models on demand (`npm run evals`); a red team attacks Purser and every attack must fail; injection in documents is caught before money moves. | `src/evals/cases.ts`, `docs/redteam/`, `docs/fraud-and-injection.md`, `test/adversarial.test.ts` |

## 3. PSD2 and strong customer authentication (the idea)

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Two factors to approve a payment, bound to its amount and payee | Airwallex for its own logins; Purser for the CFO's approval | The approval is a passkey on the CFO's phone (something you have) unlocked by Face ID (something you are). The signature covers a hash of the exact terms: amount, payee, fee ceiling, expiry. Change one character and it no longer fits. | `docs/phone-approval.md`, `src/passkey/webauthn.ts`, `test/approve-client.test.ts` |

## 4. GDPR: as little personal data as possible

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Keep only the personal data you need | The business, Purser | Agents are cardholders, not people. No card number or CVV ever reaches Purser or a model. The CFO's passkey stores a public key, not biometrics: Face ID stays on the phone. | `docs/cards-and-clearing.md`, `docs/security.md` |
| No personal data in logs or AI context without need | Purser | For model reads the audit log stores a hash of the document, not its text (chat messages and quoted planted lines are stored as text). Secrets are redacted from every text that leaves the runner. No key or credential ever reaches a model (tested). | `src/claude/reader.ts`, `src/lib/redact.ts`, `test/adversarial.test.ts` |
| Retention | The business | Not set in the demo. In production the business sets how long the ledger and audit log are kept; the log is append-only, so deletion would be by retention policy, not by editing. | — (open) |

## 5. Money laundering, sanctions and fraud

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Screen payments against sanctions lists | Airwallex | Euro payments go to beneficiaries Airwallex validates (and, in production, screens). In production a Metal send policy could also require a signed screening decision before an on-chain payment; not built (`docs/metal-award.md`, section 7). | `docs/airwallex.md` |
| Pay only known payees | Purser, on chain by Metal | A Metal mandate names its one payee. A supplier's changed bank details count only after a request, a person's check outside the system and the CFO's approval, which shows the full new IBAN. | `src/policy/payeeChange.ts`, `test/payee-change.test.ts` |
| Stop invoice fraud | Purser | The fraud check blocks changed bank details; a model's reading of an invoice must agree with the invoice's own lines on amount, vendor and bank details; planted "pre-approved" lines and hidden characters are flagged and change nothing. | `docs/fraud-and-injection.md` |
| Refuse money from unknown senders | Metal enforces; Purser sets it | Purser can set the sweep wallet to accept test USD only from the business account; Metal then holds anything else in quarantine, and the CFO returns or accepts it with Face ID (live on testnet in a separate world, 30 October; not set in the recorded run). | `src/policy/quarantine.ts`, `docs/metal-award.md`, section 5 |

## 6. Segregation of duties (in the spirit of SOX)

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| The person who proposes cannot approve | Purser | Agents propose; only the CFO's passkey approves; an agent has no way to sign. With four eyes, two different people sign and the proposer never counts. | `src/policy/approvals.ts`, `test/approvals.test.ts` |
| Changes to the rules are controlled too | Purser | A change to the CFO policy is itself a proposal approved with Face ID; from the phone, limits can only be tightened. | `src/executors/policyChange.ts`, `docs/cfo-policy.md` |

## 7. Record keeping and audit

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Complete, tamper-evident records | Purser | Every payment, decline, refusal and approval is in an append-only, hash-chained audit log; the database refuses edits and deletes. | `src/db/schema.sql` (`audit_log` triggers), `npm run verify-log` |
| Records an auditor can check | Purser | `npm run audit:report` writes a PDF; `npm run verify` re-checks every credential, pull, disputed payment, clearing receipt, Face ID approval and Airwallex booking; each payment carries a GL account and cost centre and exports to CSV or JSON. | `docs/audit-report-rehearsal-3.pdf`, `docs/metal-award.md` (section 6, evidence model) |
| Reconciliation | Purser | The runner reconciles the ledger with Airwallex and the chain every hour (and `npm run reconcile` on demand). | `src/finance/reconcile.ts` |

## 8. Operational resilience (in the spirit of DORA)

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Contain an incident fast | The business, with Purser's controls | The emergency stop: one Face ID makes Purser refuse to sign any agent payment and freezes every card at Airwallex (tested against stand-ins; not yet run live). The Metal mandates stay bound until revoked. | `test/freeze.test.ts` |
| Survive an outside service failing | Purser | Timeouts and retries per service; a payment without an answer is looked up, never resent; without a model the plain parsers take over; without keys the demo replays the recorded run. | `docs/security.md` (timeouts table), `docs/run-it.md` |
| Know what happened | Purser | The hardening log lists each finding and its fix. | `docs/hardening.md` |

## 9. Card rules

| What the rule asks | Who | How Purser supports it | Proof |
|---|---|---|---|
| Limits and allowed merchants per card | Airwallex enforces; the CFO sets | Each agent's card has a per-payment and monthly limit and allowed merchant categories (software 5734, ads 7311), synced from the CFO policy and read back; Airwallex declines the rest. Cards end after 90 days. | `src/config/policy.ts` (`CARDS`, `PLANS`, `CARD_ACTIVE_DAYS`), `src/policy/cards.ts`, `test/cards.test.ts` |
| No card numbers where they are not needed | Purser | Agents and models never see the card number or CVV. | `docs/security.md` |

## What a real launch would add

- A retention policy and a data processing agreement with each provider.
- A written incident procedure and named people for it.
- Sanctions screening on on-chain payments (a Metal send policy) if Purser pays outside parties on chain.
- An outside audit of the controls above.
