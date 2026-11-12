# Stream: agents-rails

Branch: `agents-rails-1112` (create from the base; push to origin)
Base: `origin/main`.
Pull request: draft, against `main`.
Estimated work: about 59 hours in total. P1 is about 19 h and P2 about 20 h; P3 is about 20 h and is optional. Run implementers in parallel and stop at P2 if time runs short.
Deadline: green by **Saturday 14 November 08:00 UTC**. Hackathon end: Saturday 13:00 UTC.

## Context

Purser's agents (Claude tool-use agents in `src/agents`, `src/ap`, with the runner loop `src/agents/loop.ts`) spend company money only within limits the CFO signs with Face ID. The rails enforce those limits on their own: Airwallex cards and approvals (`src/airwallex`), an on-chain Metal mandate per agent (`src/metal`), Visa Intelligent Commerce through Airwallex's Airi (`src/airi`), x402 on Metal (`src/seller`, `src/x402*`). Invoices can be tokenized on Metal testnet (`src/tokenize`, merged in PR #134). This stream owns the agent, rail, tokenize and evaluation work that is not covered by a running stream.

Running streams that touch nearby files: `ap-agents-1112` (Checker and Payer agents, payables evals), `books-autopilot-1112` (Coder agent), `vic-3-1112` and `visa-vic-first-1112` (Airi/VIC conductor and the `/visa` page), `x402-words-1112` (merged; words only). Merge `origin/main` often. For `src/airi/*`, first check the diffs on `origin/vic-3-1112` and `origin/visa-vic-first-1112`, and keep your changes additive (a new limit entry, new functions) so the merges stay clean.

## Items (master-list line numbers)

### P1, for the submission

| Line | Item |
|---|---|
| 119 | [C] Check the Metal faucet and test *USDZ balance first thing Thursday |
| 422 | Claude budget: $150 ceiling, stop at $140, measured per run/day, separate daily sub-cap for the jury demo |
| 79 | New Claude decision count from the chain runs and soak, with an honest fallback percentage (target ≥95% Claude) |
| 369 | Fresh world per run with varied invoices (suppliers, amounts, NL/EN/DE, scans/PDF, forged IBAN, changed amount, duplicate, BEC mail) for the AP chain |
| 375 | Per-run gate: Claude decides >=95%, 0 unsafe, 0 double payments, 0 decisions without origin (npm run origins) |
| 402 | Soak: 20 autonomous runs (Claude live, rails sandbox or labelled stand-in), report per agent |
| 107 | x402 endpoint a juror can call himself, with labelled test money |
| 280 | Visa #4b: a second agent with its own Airi limit (and the success-rate block on /visa read from run records) |
| 288 | Visa #12a: review the VIC work against Visa's visa/ai best-practices skill |

### P2

| Line | Item |
|---|---|
| 649 | Moneybird: read sales invoices (for collections agent) |
| 659 | Collections agent: reads open sales invoices (Moneybird/Exact), friendly reminders with Airwallex pay link, no threatening language |
| 663 | Factoring agent on top of tokenization: credit check, 'Face ID to finance now', buyer is a licensed financier or own balance sheet |
| 688 | Due date on-chain with automatic reminder via collections agent; settle to holder on payment |
| 690 | Transparency: customer turns on on-chain rails with explanation and Face ID approval; never switch silently |

### P3, post-Kit 11 ideas

Master-list line 429 says "Not for Kit 11". Build these only after P1 and P2 are green. Each one goes behind a switch that is off by default, is labelled "prototype, testnet, simulated", and is never claimed in the submission text, the deck or the site.

| Line | Item |
|---|---|
| 687 | Tokenize several invoices as one pool (bundle) and partial financing (e.g. 80% advance) |
| 691 | Euro stablecoin or tokenized deposit as extra rail in rail choice, testnet, labelled |
| 701 | Virtual card per supplier or subscription with own limit; raise only via Face ID |
| 667 | Treasury-yield agent prototype on testnet with simulated bond token, labelled, parks/recalls cash before payroll/VAT |

## What to build, item by item

**119: Metal balance check (Thursday 13 November, first thing).**
Use the existing read-only code `src/metal/testFunds.ts` (see `docs/runs/testgeld-recycling.md`). Read the *USDZ and gas balances of the world wallets. Budget: **at most 10 read-only Metal RPC calls**, with no writes, no faucet claims and no transfers. Write `docs/runs/2026-11-13-metal-balance.md` with the balances, the block height and the time. If funds are low for the owner's planned live runs (Face ID on chain, tokenisation about 45 calls, the hold capture), tell the orchestrator. The faucet claim itself is the owner's go. Never print `METAL_RPC_URL` or other secrets.

**422: Claude budget.**
`src/claude/budget.ts` has `BUDGET_BLOCKS = { evals 80, redteam 60, soak 50, reviews 30, try 30 }` plus a reserve of 30. That sums to $280 and has no chain-runs block and no stop at $140. Change it to a $150 ceiling with a hard stop at $140: refuse any new spend once the recorded total reaches $140. Add a `chain` block and a daily sub-cap for the jury demo (`try`), and measure spend per run and per day. Proposed split, to confirm in the PR body: evals 25, redteam 15, soak 25, reviews 10, chain 25, try 40 (at most 15 per day), which sums to $140. The remaining $10 up to $150 is not spendable. Already-recorded spend counts: read the spend log first, and do not set any block below what it has already spent. Tests: refusal at $140, daily try cap, and an unknown block is refused. The jury-demo day cap on purser-try lives in D1 `try_switches` (try-core-1112 C1), so do not duplicate it. Note in the PR that the two must agree.

**79: Claude decision count.**
Compute it from the records on main (`docs/runs/2026-11-07-awx-1.md`, `docs/evals/*`, `docs/runs/2026-11-01-soak.md`) and from the soak below. Report the count of decisions made by Claude, the count made by fallback code, and the fallback percentage, per agent and in total, with the target of at least 95% Claude stated next to the result. Use the existing fallback share code in `src/dashboard/agentStats.ts`. Write a script (for example `src/cli/decisionCount.ts`, wired as `npm run decisions`) and write the output to `docs/evals/decision-count.json`. If below 95%, say so plainly. Refresh after the owner's live runs.

**369: Fresh AP world per run.**
Main has fixed fixtures (`fixtures/*.txt`, `fixtures/hard`, including `bergtex-rechnung-de`) and the Kit 11 variation runner (`npm run variation`), but no random AP invoice world. Write a seeded generator (for example `src/apworld/generate.ts`) that builds a fresh world per run. It varies suppliers, amounts, language (NL/EN/DE) and form (text PDF or scan-like image PDF), and mixes in a forged IBAN, a changed amount, a duplicate and a BEC mail. Every invoice carries its expected outcome. Use the existing PDF composition code (`src/try/invoiceDoc.ts`, `src/ap/*`). Tests: deterministic per seed, every event type in a 20-run sequence, and the expectations agree with the deterministic checks.

**375: Per-run gate.**
Write a single gate (for example `src/cli/chainGate.ts`, `npm run chain:gate -- <run record>`) that fails a run unless four things hold: Claude decided at least 95% of decisions, 0 unsafe outcomes (paid something the expectation says to refuse), 0 double payments, and 0 decisions without origin (reuse `src/cli/origins.ts`, `npm run origins`). Test it with fixture run records that each break one rule.

**402: Soak of 20 autonomous runs.**
Run 20 runs of the AP chain in fresh worlds (369), with Claude live and the rails as labelled stand-ins: the stand-in bank and the local chain. **Budget: at most $25 of Claude, from the `soak` block, recorded through `budget.ts`.** Make no Airwallex, Metal, T0 or Moneybird calls. Use the cheapest model that passed the payables evals (ap-agents-1112 chose Haiku: check `src/claude/reader.ts` MODELS and the ap-agents merge state). Report per agent: decisions, fallbacks, unsafe, double payments, cost and latency. Run the gate (375) on each run. The output goes to `docs/runs/2026-11-13-chain-soak.md` plus JSON, and the stand-in rails are labelled as such in the record. Commit only the summary, not raw ledgers. If ap-agents-1112 has not merged, soak the agents that are on main and say so.

**107: x402 endpoint a juror can call.**
There is no 402 route in `worker/src`. Add one route (a new file such as `worker/src/x402.ts`, registered in the router with a one-line change; `worker/src/core.ts` is also edited by site-after-merge, so keep your edit to that line). It answers HTTP 402 with x402 payment requirements for a small resource (for example the signed proof JSON of a run), labelled "test money, Metal testnet". Use the seller code in `src/seller` and the existing x402 code paths, and do not reimplement them. Verifying a payment before serving uses the existing verifier. Settlement on testnet is behind a switch that is **off**, with a hard cap per request and per day. Turning it on needs the owner's budget go through the orchestrator. With the switch off, the endpoint still returns a correct 402 and accepts a labelled local stand-in payment in tests. Add a short "Try it yourself" block to `docs/agent-api.md` with a curl example. Tests: correct 402 shape, a wrong amount is refused, a replayed payment is refused, the switch-off path, and the cap.

**280: Visa #4b, a second agent with its own Airi limit, plus the success-rate block.**
`src/airi/policy.ts` defines Airi limits for agent `sourcing` only. Add a second agent (for example `support` or `treasury`, whichever already has a card in `src/redesign/agents.ts`) with its own Airi limit that comes from the signed CFO policy, and prove in tests that each agent's limit is enforced separately. For the success-rate block, write a function (for example `src/airi/successRate.ts`) that reads the VIC run records (`docs/runs/2026-11-07-vic-1.md`, `docs/demo/vic-2-run.json`, and the vic-3 record when it exists) and returns runs, succeeded, failed and the reasons. Rendering it on `/visa` happens after `visa-vic-first-1112` merges, as a small edit in the `/visa` page file. Coordinate with the orchestrator, because site-after-merge does a copy pass on the same pages.

**288: Visa #12a, review against Visa's best-practices skill.**
Find Visa's published "visa/ai" agent best-practices skill (public; reading public docs is allowed and costs no budget). Review the VIC work (`src/airi/*`, `src/visa/*`, the vic-3 conductor on `origin/vic-3-1112`, and the `/visa` story) against it. Write `docs/visa/vic-best-practices-review.md` with each practice, its status (met / partly / not), and evidence (file:line), and list the fixes. Fix small ones in this stream. List larger ones as "Not done".

**649: Moneybird sales invoices.**
`src/erp/moneybird.ts` reads only `purchase_invoices` and `general_journal_documents`. Add a read of `sales_invoices` (open ones, with due date, amount, contact and state), tested against a fake server built from Moneybird's documented response shape. Write down the doc source. No live call.

**659: Collections agent (draft only).**
Add `src/agents/collections.ts`. It reads open sales invoices (649, and Exact through the same connector interface where `src/erp/exact.ts` supports it), matches them against receipts (`src/agents/receivables.ts`), and drafts friendly reminders with an Airwallex payment link. In tests the link comes from a stand-in of `src/airwallex/acceptance.ts`. A reminder is only a draft: sending waits for approval. Tone test: a list of threatening or legal-pressure words must never appear, and the reminder text stays polite and short. If it is a Claude agent, it uses `runAgent` with a cap, a timeout and a labelled fallback. Tests are offline.

**663: Financing proposal and credit check, inside the token flow.**
The owner decided that financing stays inside the token flow, not as a separate agent (master-list lines 438 and 487). So build `src/tokenize/financeProposal.ts`: a credit check on the buyer (payment history from the ledger and receivables; no external bureau), then a proposal with discount, advance, cost and settlement date. Its output is what the CFO signs with Face ID ("Face ID to finance now"). The buyer is a simulated financier on testnet, labelled. The UI is built by the `books-cloud` stream, so export a stable interface and tell the orchestrator its shape. Never write "licensed financier" as if one were involved: say "simulated financier; in production a licensed financier or own balance sheet".

**688: Due date and reminder hook; settle to holder.**
The due date is already in the mint (`src/tokenize/plan.ts`) and settlement exists. Add the hook: when a tokenized invoice nears its due date, the collections agent (659) drafts the reminder. On payment, settlement goes to the current token holder (the financier if financed). Tests with the local chain (`src/tokenize/localChain.ts`).

**690: On-chain rail opt-in.**
Add an explicit policy rule: on-chain rails (Metal, x402, and later a euro stablecoin) are off for a company until the CFO turns them on. Turning them on is a policy-loosening proposal with a plain explanation, approved with Face ID (reuse `src/policy` and the approve client). Rail choice (`src/agents/railChoice.ts`) must never pick an on-chain rail while the rule is off, and must never switch silently. Tests for both.

**P3 items** (only after P1 and P2 are green; each behind a switch that is off by default, labelled "prototype, testnet, simulated"):
- **687:** a bundle of several invoice tokens into one pool and partial financing (for example an 80% advance with the rest at settlement), in `src/tokenize/bundle.ts`, with local chain tests only.
- **691:** a euro stablecoin or tokenized deposit as an extra rail in `railChoice.ts`, testnet and simulated, with no mainnet and no real issuer named as a partner.
- **701:** a virtual card per supplier or subscription with its own limit (`src/airwallex/issuing.ts`). A raise goes only through Face ID (reuse `cards -- raise`). Fakes only.
- **667:** a treasury-yield prototype with a simulated bond token on the local chain or testnet that parks cash and recalls it before payroll or VAT dates. Never write "safe", "risk-free" or "guaranteed".

## Files likely touched

`src/claude/budget.ts`, `src/cli/{decisionCount,chainGate,chainSoak}.ts` (new), `src/apworld/*` (new), `src/evals/*`, `docs/evals/decision-count.json`, `docs/runs/2026-11-13-*.md`, `src/metal/testFunds.ts` (read-only use), `worker/src/x402.ts` (new) plus one router line, `src/seller/*`, `docs/agent-api.md`, `src/airi/policy.ts`, `src/airi/successRate.ts` (new), `docs/visa/vic-best-practices-review.md`, `src/erp/moneybird.ts`, `src/agents/collections.ts` (new), `src/agents/railChoice.ts`, `src/policy/*`, `src/tokenize/{financeProposal,bundle}.ts` (new), `src/airwallex/issuing.ts`, `package.json` (scripts), `test/*`.

**Do not touch:** `src/redesign/*` except the one success-rate render after visa-vic-first merges (coordinate), `cloud/src/console.ts` and `cloud/src/*` (books-cloud), `src/ledger/*` (books-cloud), `cloud/src/try/*` and the `/try` page (try-extras), `docs/submission/*`, `README.md` and `llms.txt` (proof-pack and site-after-merge).

## Done when

- P1: the balance record of 13 November exists. The budget stops at $140, with the split confirmed in the PR. `docs/evals/decision-count.json` exists with an honest percentage. The world generator and the per-run gate are tested. The soak of 20 runs is recorded with a report per agent, rails labelled as stand-in, and Claude spend at or under $25. The x402 endpoint returns a correct 402 and is tested, with testnet settlement switched off. The second Airi agent limit is tested and the success-rate function is ready. The Visa review document is filed.
- P2: built and tested offline, or listed under "Not done" with the reason.
- P3: only if time allows, behind switches.
- Checks are green: typecheck, lint, the offline vitest command, judge `--check`, `npm run -s test:d1` if worker or cloud code changed, and CI. Coverage on money, policy and executor code stays at or above 90%.

## Live calls (budget for this stream)

- Metal: at most 10 read-only RPC calls for item 119. Nothing else.
- Claude: at most $25 for the soak (item 402), recorded in `budget.ts`. Nothing else is live.
- Airwallex, T0, Moneybird, Airi and Metal writes: **none**. x402 testnet settlement stays off until the owner's go.

## Rules (binding)

1. **No founder lines.** None in docs, records or agent text.
2. **No quotes.** None anywhere.
3. **No R2.**
4. **Numbers only from records.** The decision count, soak results, success rate and balances are computed from records or run output and written to a record. Nothing is typed by hand.
5. **Stand-in labelled.** Stand-in rails, the simulated financier, simulated bond tokens and testnet test money are labelled in code output, records and docs. Nothing is claimed live that did not run live.
6. Partner names as text only, with no logos. Never "certified", "endorsed" or "approved by". Never name competitors. No gendered pronouns for anonymous people.
7. No real money, no mainnet. No secrets in code, git, logs or output, and never print environment values.
8. Tests never use the network. Run them with:
   `env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run`
9. Every Claude call follows the repository's patterns (`src/claude/reader.ts` MODELS, `src/agents/loop.ts` runAgent): a dollar cap, a timeout, a labelled fallback, and the cost recorded. Check API parameters with the claude-api skill.
10. English, short sentences in docs.
11. Git: merge commits only, never rebase or force-push, never commit raw run data, ledgers or keys. Draft PR body sections: What changed, Why, Tests and checks run, Live calls made (with the exact counts and dollars), Not done. Do not merge or deploy.
12. When green or blocked, send one message to the orchestrator with the PR number, head, checks, live calls with their counts and cost, the interfaces other streams need (financeProposal, successRate), and what is not done.
