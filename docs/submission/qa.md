# Q&A: the hardest questions

For Max, for Demo Day (19 November). Each answer is three sentences or fewer, then the evidence: a page, a record or a
test. Figures are the main run's (3 November 2026, [log](../runs/2026-11-03-main-run.md),
[record](../demo/main-run.json)) or a dated record's; `test/pitch.test.ts` checks them, and
`test/demo-day-pack.test.ts` checks the length of each answer and that it names its evidence. Questions 18 to 26 were
added on 7 November: 18 to 22 on /try/sign's live agents and on awx-1 (the Airwallex-only run of 7 November,
[log](../runs/2026-11-07-awx-1.md)), 23 and 24 on the Airi run of that day, and 25 and 26 on Visa Intelligent Commerce
via Airwallex's Airi (the same run, [log](../runs/2026-11-07-vic-1.md)), answered only from that log and the docs. When you
do not know:
"Good question. I'll check and send it to you." Never guess.

The pitch: [pitch.md](pitch.md). The one page beside the laptop: [cheat-sheet.pdf](cheat-sheet.pdf).

## The 15

### 1. Was #24's refusal staged? ("Isn't letting one purchase through staged?")

Letting it through was, and we say so: we switched off our own check once to prove the chain holds the line. Purser
refuses an over-cap purchase before signing (0.04 over the 0.03 cap, `mandate_cap_exceeded`), and with that check off
for purchase #24, Metal refused it anyway. Metal refused it; the refusal is recorded on chain.

**Evidence:** [tx `0x2e92f9cb…1871`](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871);
[the main run's log](../runs/2026-11-03-main-run.md), acceptance row 5; `CHAIN_TEST` in `src/config/brand.ts`.

### 2. Was the second approver a test passkey?

Yes. In the main run the second approval (four eyes on P-0002, 2 of 2) came from a labelled virtual test passkey,
pressed by our build tool, Claude Code, on my go. Four eyes is built; a real second person with their own passkey is
on the list for next.

**Evidence:** [README](../../README.md), "The main run"; `SECOND_APPROVER` in `src/config/brand.ts`;
[docs/business/roadmap.md](../business/roadmap.md), "A real second human approver".

### 3. It's all sandbox and testnet: what's real?

Real: the Airwallex sandbox calls, the Metal testnet transactions, 24 of 24 Claude decisions and my passkey with Face
ID; I play the CFO, and all money is test money. Simulated or ours: the customer, the suppliers, the merchant, the
second approver, and the SWIFT settlement, which Purser moves to SENT and PAID through Airwallex's sandbox simulation
API. <!-- METAL-ONCHAIN -->On Metal testnet, on chain and checkable: 86 payments, each its own transaction (41 sales,
41 supplier purchases, 3 refunds, 1 sweep), plus 6 mandate transactions and the refusal of #24; no clearing in this
run.<!-- /METAL-ONCHAIN -->

**Evidence:** [README](../../README.md), "What is real, what is mock"; [/proof](https://kit11.max-31b.workers.dev/proof),
every id.

### 4. Why Face ID and not a password or a button?

A button or a password says yes to whatever is on the screen; a passkey signs the SHA-256 hash of these exact terms,
so one changed cent, IBAN or currency makes the signature worthless, which anyone can try on /try/sign. The server
checks the signature, not your face: attestation is "none", so it cannot tell which authenticator made the key, and
Face ID is what the phone asks for, not something we prove. The receipt checks offline, with no server:
`npm run verify-receipt -- receipt.json`.

**Evidence:** [/try/sign](https://kit11.max-31b.workers.dev/try/sign), "What's real?"; `attestation: "none"` in
`worker/src/trySign.ts`; `test/webauthn-soundness.test.ts`; [docs/phone-approval.md](../phone-approval.md).

### 5. What if the agent gets a prompt injection?

Inside its limits a lying agent can spend at most its cap and budget; beyond them, nothing moves without a signature.
Code screens every document first, the models read documents as data with no field for a payee or an approval, and
payees come from an allowlist. In the main run 1 planted instruction in the dispute changed nothing; in a separate
live test (29 October) an invoice "pre-approved by the CFO" became an ordinary proposal to the allowlisted IBAN,
waiting for Face ID.

**Evidence:** [docs/fraud-and-injection.md](../fraud-and-injection.md); [docs/runs/2026-10-29-injection.md](../runs/2026-10-29-injection.md);
`src/policy/injection.ts`.

### 6. What if Purser's server is hacked?

The rails refuse anything over their current limits; changing a limit needs a signed proposal. But the runner host
holds the owner keys, so a compromised runner is out of scope today, and a compromised relay could serve a script that
asks Face ID to sign another waiting proposal's hash: both are listed as accepted risks. Before real money: keys in a
KMS, and a signing page the relay does not serve.

**Evidence:** [docs/security.md](../security.md), "Accepted risks and what is out of scope".

### 7. Why a blockchain?

Because the limit then lives outside our code: each agent's Metal mandate holds its cap, budget and one payee, and
Metal refused #24 with our own check off. x402 pays per data query over HTTP, 0.02 to 0.05 test USD a query: in the
main run 86 Metal payments (sales, purchases, refunds and a sweep), each its own transaction, on testnet. And a dispute is checked from the chain: all 12
disputed orders carried the buying agent's own signature, so "never placed" failed.

**Evidence:** [docs/metal-award.md](../metal-award.md); [/metal](https://kit11.max-31b.workers.dev/metal);
[docs/metal-review.md](../metal-review.md); the record, [docs/demo/main-run.json](../demo/main-run.json).

### 8. Why Claude, and what does it cost?

Claude reads and proposes, holds no key and approves nothing; in the main run it made 24 of 24 decisions with 0
fallbacks, for USD 0.3170 in all (USD 0.0132 a decision). We measured the split: on everyday cases Haiku alone passed
18 of 18, but on a harder dispute it misread one order, so Sonnet reads documents and Treasury runs on Opus, the least
proven part, whose proposals the CFO reads before signing. The cost comes per exception, not per payment.

**Evidence:** [docs/claude.md](../claude.md), "Why these models, measured honestly"; [docs/unit-economics.md](../unit-economics.md);
the record, `agent_stats[].cost_usd_micros`.

### 9. Who pays for this, and how much?

The finance team of a company on Airwallex that lets AI agents spend; the CFO decides. Our intended price:
€49 per company a month, including 5 agents and 1,500 Claude decisions; €10 per extra agent; €3 per extra 100 decisions. That is a hypothesis: we have not
validated demand, and no customer has seen a price.

**Evidence:** [docs/business/model.md](../business/model.md), "Intended pricing (hypothesis)".

### 10. What if Airwallex builds this itself?

It could, and the risk is real: Airwallex already ships agent features of its own (AgentOS, Spend Management agents,
an agentic wallet in development). Purser builds on them: Airwallex's card controls are one of its locks (a lock per rail), and it
adds one CFO policy across card and chain, approvals signed over the exact terms, and a hash-chained audit log. The more
agent features Airwallex ships, the more there is to govern, and we would rather be the app or partner on the
platform that does it.

**Evidence:** [docs/business/model.md](../business/model.md), "Risks and what we do not know".

### 11. How does this scale to 1000 agents?

Each agent is one mandate, one card and its own limits, so a new agent adds bounded risk, and Claude costs come per
exception, not per payment. But we ran 3 agents, not 1000: today it is one company per ledger (SQLite) on test rails,
and a separate load run pushed 2,000 clearing payments from 16 wallets through Metal. At 1000
agents we would need Postgres, keys in a KMS and connected accounts for many companies, none of which is built or
measured.

**Evidence:** [docs/runs/2026-10-30-clearing-load.md](../runs/2026-10-30-clearing-load.md); [docs/roadmap.md](../roadmap.md),
"Phases"; [docs/unit-economics.md](../unit-economics.md).

### 12. Worst-case loss per day inside the limits, and how fast does the CFO know?

Worst case, set by policy: the agents together can spend at most EUR 28,200 (cards and task cards) and USD 20 (test
USD) a month; everything above waits for the CFO. The parts: at most 20.00 test USD on Metal (the three mandates'
budgets, 10.00 + 4.00 + 6.00, held to that total in code); EUR 300.00 on the cards (monthly limits 100.00 + 150.00 +
50.00); and the Treasury agent's task cards without Face ID, up to EUR 300.00 each and 3 in 24 hours, so EUR 900.00 a
day and EUR 27,900.00 over 31 days; a card or a mandate has no daily ceiling, so it can all go in one day: the worst day
is EUR 1,200.00 and 20.00 test USD. The CFO sees each payment in the dashboard's feed as it happens, and a velocity breach (Sourcing: 30
payments a minute, 4.00 test USD or EUR 100.00 an hour) stops that agent and raises an alarm on `/health`; no pager is
connected yet.

**Evidence:** `src/config/policy.ts` (`TOTAL_BUDGET_CENTS`, `INITIAL_MANDATES`, `CARDS`, `TASK_CARD_EUR_FALLBACK`,
`TASK_WITHIN_PER_DAY`, `VELOCITY`); `exposureOf` in `src/policy/exposure.ts`; [docs/controls.md](../controls.md) (L4, I3).

### 13. Why not Airwallex's own spend controls and approvals?

We use them: each agent's card limit is Airwallex's, enforced by Airwallex, and read back on 6 November, 3 of 3 cards
carry the CFO policy as Airwallex's own controls. Purser adds one policy across Airwallex and Metal, each agent's
mandate on chain, and a signature on the exact terms of each payment beyond the limits, whose hash Airwallex's own
record of the EUR 240.00 SWIFT payment carries.

**Evidence:** [airwallex-cards-2026-11-06.json](../runs/airwallex-cards-2026-11-06.json);
[airwallex-transfer-approval-2026-11-06.json](../runs/airwallex-transfer-approval-2026-11-06.json) (`approval_sha256`
`797d4483…abcd`, P-0005); [/airwallex](https://kit11.max-31b.workers.dev/airwallex).

### 14. Does it work every time, or did you get lucky once?

We reran the full flow in fresh worlds on 6 November: rel-1 stopped at the card purchase, because Treasury told
Sourcing to wait instead of sending it to ask the CFO itself. One rule added to Treasury's instructions took that
step's eval from 6/10 to 10/10, and the rerun, rel-1b, passed every step. Both runs are published, the failure
included, and in both the signers were labelled test passkeys.

**Evidence:** [docs/runs/reliability-2026-11.md](../runs/reliability-2026-11.md); [docs/demo/reliability.json](../demo/reliability.json);
`test/agent-card-raise-eval.test.ts`.

### 15. What would you do in the first month after the hackathon?

Talk to finance teams on Airwallex before building more: we have not validated demand, and we're looking for design
partners. Then the production basics: a production Airwallex account with a scoped key, a real second approver with
their own passkey, and each approved payment posted with its hash to the customer's books. It is a plan, not a
promise: no dates we cannot keep.

**Evidence:** [docs/business/roadmap.md](../business/roadmap.md); [docs/business/README.md](../business/README.md).

## Also asked: say plainly what is not done

### 16. Is T:0 live?

<!-- T0-STATUS -->T:0: 95 journal entries posted to T:0's shared sandbox entity on 10 Nov (first je_prod_z7kTCuZ1iiwad01q); debits equal credits, and T:0 matches our books line by line. Earlier keys were refused (403 CAPI71 on 3 Nov, 401 CAPI11 on 5 Nov).<!-- /T0-STATUS -->

**Evidence:** [docs/runs/2026-11-03-t0-sandbox.md](../runs/2026-11-03-t0-sandbox.md) (`403 CAPI71`);
[docs/runs/2026-11-05-t0-live.md](../runs/2026-11-05-t0-live.md) (`401 CAPI11`).

### 17. Did the SWIFT payment really settle?

No: PAID is the sandbox's status, and Purser itself moves the transfer to SENT and PAID through Airwallex's simulation
API. The 6 seconds from Face ID to PAID are measured, but the settlement is simulated.

**Evidence:** [README](../../README.md), "Earnings and euros"; the record, `timings` (faceToPaid 6); `SANDBOX_SETTLED`
in `src/config/brand.ts`.

## The live agents and awx-1 (added 7 November)

### 18. Are the agents on /try/sign live, or scripted?

Live, and labelled: on the first screen Claude Sonnet reads the supplier's invoice, Purser's code checks the reading
and writes the terms from it, and Claude Opus advises as the Treasury agent; on "Try to trick the agent" Claude Sonnet
reads each fake invoice live. When a live call cannot answer, the page says so, with a recorded real answer or code's
own reading, labelled with the reason, never silently. All live calls on the page share a budget of USD 10 a day, with
limits per address and a timeout of 8 s a call, and a switch on the server stops them all.

**Evidence:** [/try/sign](https://kit11.max-31b.workers.dev/try/sign), "What's real?"; `worker/src/trySign.ts`;
`worker/src/trick.ts`; `test/try-trick.test.ts`.

### 19. What does Claude Opus decide on the first screen?

Only the timing: it advises paying now or waiting, in one or two sentences, and code checks every amount in its reason
against code's own numbers. No model sets the amount, the payee, the conversion or the plan; the terms come from
Sonnet's reading after code has checked it against the invoice's own lines, the allowlist and the limit. Nothing
moves until you sign those terms with your passkey.

**Evidence:** `worker/src/trySign.ts`; `src/agents/timingAgent.ts`; [/try/sign](https://kit11.max-31b.workers.dev/try/sign),
"What's real?".

### 20. Can a fake invoice talk the agent into paying?

Try it: on /try/sign you send the agent a fake invoice, either "Pre-approved by the CFO" with a new IBAN, or a
lookalike supplier, and Claude Sonnet reads it live. Whatever it reads, Purser's code blocks the invoice: a new IBAN
needs a person's Face ID, and only allowlisted payees get paid. A blocked invoice creates no proposal, reads no balance
and asks for no quote.

**Evidence:** `TRICKS` and `TRICK_OUTCOME` in `worker/src/trick.ts`; `test/try-trick.test.ts`;
[docs/fraud-and-injection.md](../fraud-and-injection.md).

### 21. What is awx-1?

A separate world on the Airwallex sandbox only, run live on 7 November with test money and 0 Metal calls; I signed
all three proposals with Face ID on my phone, and it was accepted with all seven checks passed in one attempt. Three
agent cards carried the policy's limits, read back from Airwallex; Airwallex itself approved the charges within the limits, declined one
over the limit (`LIMIT_EXCEEDED`) and one outside the card's merchant category (`MERCHANT_CATEGORY_NOT_ALLOWED`); two
invoices went out by SWIFT after Face ID, each payout carrying the hash of the signed terms in Airwallex's own
metadata. The merchant charges and each payout's SENT and PAID are the sandbox's simulation; every approval, decline
and decline code is Airwallex's own.

**Evidence:** [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md); the record,
[docs/demo/airwallex-run.json](../demo/airwallex-run.json); [/airwallex](https://kit11.max-31b.workers.dev/airwallex#awx-1).

### 22. In awx-1, what did the agents do with Airwallex's declines?

The Sourcing agent (Claude Haiku) read `LIMIT_EXCEEDED` and asked the CFO to raise its limit per purchase from 30.00
to 45.00 instead of retrying; after my Face ID the card was updated at Airwallex and the same EUR 45.00 charge was
approved. The Support agent read `MERCHANT_CATEGORY_NOT_ALLOWED` and asked for no raise, since a higher limit would not
help. For the invoices, the Treasury agent (Claude Opus) advised paying now, and code bought only the shortfall: no FX
for the first, EUR 623.50 for USD 704.45 on a quote for the second.

**Evidence:** [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md), "What the agents said" and "f–g. The two
invoices"; [/airwallex](https://kit11.max-31b.workers.dev/airwallex#awx-1), "Every step and id".

### 23. Can the agents pay with Airwallex's own agent wallet, Airi?

Yes, in a separate run on 7 November (Airwallex sandbox, Airi's test card, test money): the Sourcing agent paid with a
single-use card credential from Airwallex's Airi wallet, on Airwallex's hosted checkout page for our own sandbox
merchant. EUR 12.00 within Purser's limit needed no Purser approval (Airi itself asks the cardholder to confirm each
purchase with a passkey); EUR 45.00 above it waited for the CFO's Face ID on its exact terms first, and a merchant the
CFO does not allow was refused by Purser before Airi was called. Purser's policy and the CFO's signature sit in front of Airi's own passkey confirmation, not
instead of it.

**Evidence:** [docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md); [docs/demo/airi-run.json](../demo/airi-run.json);
[/airwallex](https://kit11.max-31b.workers.dev/airwallex#airi-run).

### 24. Did the Airi run work the first time?

No: it passed on the fourth attempt that day, the second in its world. The three before it stopped on an answer format
the docs did not show, a card confirm our sandbox refuses over the API (so the agent now pays on Airwallex's hosted
page), a tap link that never reached Max, a missed tap and a reused order reference; nothing was charged in any of them.
Each is in the run log, with what changed after it.

**Evidence:** [docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md), "The attempts before this one".

## Visa Intelligent Commerce (added 7 November)

### 25. What is VIC?

VIC is Visa Intelligent Commerce: an agent gets a single-use Visa credential for one purchase. Here it is issued
through Airwallex's Airi wallet and confirmed by the cardholder's passkey, and the agent pays with it on Airwallex's
hosted checkout page. In our run of 7 November (Airwallex sandbox, Airi's test card, test money) it passed 5 of 5
checks.

**Evidence:** [docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md), "The run" and "Checks";
[docs/demo/airi-run.json](../demo/airi-run.json); [/visa](https://kit11.max-31b.workers.dev/visa#airi-run).

### 26. What does Purser add to Airi?

The CFO's policy, applied before Airi is asked: a limit per purchase (EUR 20.00 in the run), the merchants allowed
(which the CFO can lock with Face ID: a EUR 12.00 purchase was then refused, 0 Airi calls), and Face ID on the exact
terms above the limit (EUR 45.00, P-0002, paid only after it). A purchase outside the policy is refused before any
call (`PURSER_MERCHANT_NOT_ALLOWED`), terms changed after the CFO's Face ID are refused because they no longer match
the signed hash (EUR 30.00 → EUR 190.00, our own labelled test in the second live run,
[log](../runs/2026-11-07-vic-2.md)), and every step lands in the audit trail. Airi's own passkey confirmation stays:
Purser sits in front of it, not instead of it.

**Evidence:** [docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md), "The rail's policy", "The purchases" and
"Checks"; [docs/demo/airi-run.json](../demo/airi-run.json) (`policy`, `purchases[].audit_seq`);
[docs/runs/2026-11-07-vic-2.md](../runs/2026-11-07-vic-2.md), "Checks"; [docs/demo/vic-2-run.json](../demo/vic-2-run.json).
