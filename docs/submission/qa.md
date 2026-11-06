# Q&A: the 15 hardest questions

For Max, for Demo Day (19 November). Each answer is three sentences or fewer, then the evidence: a page, a record or a
test. Figures are the main run's (3 November 2026, [log](../runs/2026-11-03-main-run.md),
[record](../demo/main-run.json)) or a dated record's; `test/pitch.test.ts` checks them, and
`test/demo-day-pack.test.ts` checks the length of each answer and that it names its evidence. When you do not know:
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

The finance team of a company on Airwallex that lets AI agents spend; the CFO decides. Our intended price is EUR 49 a
company a month with 5 agents included, and EUR 10 a month for each extra agent. That is a hypothesis: we have not
validated demand, and no customer has seen a price.

**Evidence:** [docs/business/model.md](../business/model.md), "Intended pricing (hypothesis)".

### 10. What if Airwallex builds this itself?

It could, and the risk is real: Airwallex already ships agent features of its own (AgentOS, Spend Management agents,
an agentic wallet in development). Purser builds on them: Airwallex's card controls are one of its three locks, and it
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

At most 20.00 test USD on Metal (the three mandates' budgets, 10.00 + 4.00 + 6.00, held to that total in code) plus
EUR 300.00 on the cards (monthly limits 100.00 + 150.00 + 50.00), and those are totals, not daily figures: there is no
daily ceiling. The CFO sees each payment in the dashboard's feed as it happens, and a velocity breach (Sourcing: 30
payments a minute, 4.00 test USD or EUR 100.00 an hour) stops that agent and raises an alarm on `/health`; no pager is
connected yet.

**Evidence:** `src/config/policy.ts` (`TOTAL_BUDGET_CENTS`, `INITIAL_MANDATES`, `CARDS`, `VELOCITY`);
[docs/controls.md](../controls.md) (L4, I3).

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

<!-- T0-STATUS -->T:0 bookkeeping is built; posting failed (shared key 403 CAPI71 on 3 Nov, new key 401 CAPI11 on 5 Nov), so nothing is posted. We claim nothing in T:0.<!-- /T0-STATUS -->

**Evidence:** [docs/runs/2026-11-03-t0-sandbox.md](../runs/2026-11-03-t0-sandbox.md) (`403 CAPI71`);
[docs/runs/2026-11-05-t0-live.md](../runs/2026-11-05-t0-live.md) (`401 CAPI11`).

### 17. Did the SWIFT payment really settle?

No: PAID is the sandbox's status, and Purser itself moves the transfer to SENT and PAID through Airwallex's simulation
API. The 6 seconds from Face ID to PAID are measured, but the settlement is simulated.

**Evidence:** [README](../../README.md), "Earnings and euros"; the record, `timings` (faceToPaid 6); `SANDBOX_SETTLED`
in `src/config/brand.ts`.
