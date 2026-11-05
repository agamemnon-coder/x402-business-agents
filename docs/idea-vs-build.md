# From idea to build: every promise, with its proof

The idea Max submitted on 24 October, in the hackathon's idea phase, quoted word for word from its description,
promise by promise, against what is built. Each proof comes from the main run of Tuesday 3 November (world `main-1`,
test money on Metal testnet and the Airwallex sandbox; record [docs/demo/main-run.json](demo/main-run.json), log
[docs/runs/2026-11-03-main-run.md](runs/2026-11-03-main-run.md)), with the record's row (`seq`) or id. Where the main
run does not cover a promise, the row names a test or another run, with its date. \*USDZ is Metal testnet's test
dollar, "test USD" on the pages.

## The setup

| Promise in the idea | Built | Proof |
|---|---|---|
| "One Metal account holds the funds. Each agent has a mandate that the account enforces on every payment (payees, per-payment cap, budget, expiry)" | ✅ | Main run: `dashboard-vs-chain` found all 4 mandates (the three agents' and the customer's) as the chain has them, payment by payment (run log, acceptance §2); after the CFO's approval the Treasury and Sourcing mandates were replaced on chain: [`0x789abb24…ebbc`](https://testnet.metalntwx.com/tx/0x789abb249896e01cee8e3641d7794676b6f2ce5d05f45093f6cc64101c9aebbc) and [`0x2a91ac97…e790`](https://testnet.metalntwx.com/tx/0x2a91ac97fc2a459da2b0c73f2b8020edec1901d051c7ef03bb088d36067fe790) (seq 207, 212) |
| "sourcing 10 \*USDZ at no more than 3 cents a purchase, supplier only; support 4 \*USDZ; treasury 6 \*USDZ. Code holds the 20 \*USDZ total, and no agent holds the owner key." | ✅ | Main run, as bound → after the CFO's approval: Sourcing 10.00 → 14.00 (cap 0.03 → 0.04), Support 4.00 (cap 0.10), Treasury 6.00 → 2.00; 20.00 before and after (record `tower.agents[].mandate`; P-0002's `total_budget` 20.00); `TOTAL_BUDGET_CENTS` and `INITIAL_MANDATES` in `src/config/policy.ts`. The owner's act, `mandate.replaced` (seq 207, 212), ran in the executor only after P-0002 was approved; `test/no-owner-key.test.ts` |
| "Customers' agents buy queries at 5 cents through an x402 route that requires a signed order; upstream data costs 2 cents a query." | ✅ | Main run: 41 sales at 0.05 and 41 supplier purchases, at 0.02 until the price rise (record `flows`: 23 sales, tx [`0x5637860a…f4aa`](https://testnet.metalntwx.com/tx/0x5637860a1ea4a7a109a45d2347e19d38887adbdb5bfd2415f0c3dc5bc785f4aa); 23 purchases, tx [`0x870e0c20…bc8f`](https://testnet.metalntwx.com/tx/0x870e0c20f626494109eb47cc7399662aca4d7cddca92cf08c1c5ffd81f3ebc8f)); all 12 disputed orders carry the customer's agent's signed order (record `ledger.disputes[0]`); `src/servers/seller.ts` (`requireSignedOffer`) |

## The three moments

| Promise in the idea | Built | Proof |
|---|---|---|
| **Price rise.** "The supplier moves to 4 cents. The account refuses the next purchase (mandate_cap_exceeded), and the customer gets an error, not a charge." | ✅ | Main run: purchase #24 at 0.04 was let through once on purpose (Purser normally refuses first), and Metal refused it itself, `mandate_cap_exceeded`, recorded on chain in [`0x2e92f9cb…1871`](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871) (seq 114–121); the customer got 503 with `settled: false` (seq 122) |
| "The treasury agent proposes limits within the 20 \*USDZ, with the margin for each option (keep 5 cents: 1 cent; charge 7 cents: 3 cents)." | ✅ | Main run: the Treasury agent (Claude Opus) filed P-0002 (option A: sell at 0.05, margin 0.01) and P-0003 (option B: sell at 0.07, margin 0.03), each with `total_budget` 20.00, at 11:24:07 (record `ledger.proposals`; seq 149–150) |
| "The approver sees the exact new terms and their SHA-256 hash, and code runs mandate replace only if the hash matches." | ✅ (better: Face ID) | Main run: Max signed P-0002's terms hash `bf7ec3a0…` with Face ID (1 of 2, seq 197); the second signature came from a labelled virtual test passkey on the runner machine, pressed by our build tool, Claude Code, on Max's go (2 of 2, seq 201; in production a second person); then the replace ran on chain (seq 207, 212). `test/passkey.test.ts`; `test/adversarial.test.ts` (terms changed after approval do not run) |
| **Dispute.** "A customer says its agent never placed 12 orders and that some data was wrong. Checking the signed orders against their on-chain payments (verifyMandatePayment) proves the orders." | ✅ | Main run: the claim `never_placed` and `wrong_data` on orders #5 to #16; all 12 have a signed order, paid by the customer within its mandate (record `ledger.disputes[0]`, `evidence`); `test/dispute-desk.test.ts` |
| "Claude compares the delivered data with the supplier's corrections. Only wrong records are refunded, each under its own payment id so a retry cannot pay twice." | ✅ | Main run: the Support agent (Claude Sonnet) refunded #7, #10 and #13 (0.15) as `refund-7`, `refund-10` and `refund-13` (seq 295–297): [`0xe4bf7962…c89d`](https://testnet.metalntwx.com/tx/0xe4bf79623f9cb9212a49ea7c0ced60d241041051f322d199e319989d6548c89d), [`0xe44a3460…75e5`](https://testnet.metalntwx.com/tx/0xe44a3460faf6cb2050067bf22791df61803f8646adeb5fcc2a205d1f1afa75e5), [`0x5099fe44…4510`](https://testnet.metalntwx.com/tx/0x5099fe44b03d83f4dd3963fc59a40e2a506bee533e5a41e8f1b00a12bee14510) |
| "Large refunds wait for a person." | ✅ | Main run: "refund the other 9" (P-0004) went to the CFO, who rejected it with Face ID at 11:29:37 (seq 316) |
| **Euro bill.** "Earnings are swept to a Metal address the business holds and booked in Airwallex as a simulated deposit that references the chain hash" | ✅ | Main run: 0.69 swept, [`0x86936a5b…ccb4`](https://testnet.metalntwx.com/tx/0x86936a5b29f9550857676fa710231af9e20882ebe6eee16f75a90af29767ccb4), locked after finalized block 14153325, then booked at Airwallex as the simulated sandbox deposit `b3812e05-2afa-4698-8f64-429f9608e0a0`, whose reference is that tx (seq 236, 237, 246) |
| "The EUR licence invoice is paid by SWIFT from the EUR balance if that stays above its floor. Otherwise the agent converts only the shortfall on a fresh quote that includes the EUR 12.85 fee, never goes below the USD reserve floor, and never counts money still in flight." | ✅ (the fee as a ceiling) | Main run, the shortfall path: the Treasury agent planned P-0005 itself; FX bought EUR 110.00 for USD 124.29, only the shortfall (EUR 240.00 + the EUR 20.00 fee ceiling − 150.00 free), conversion `3ca88196-05da-4d88-9caa-796f03704636` before transfer `03360bfa-afce-457b-89d1-e1097fbe3985` (seq 362, 363); the floors held (run log, acceptance 18/25). The fee is a ceiling in the approval, not a fixed EUR 12.85: it was EUR 13.42. The EUR-balance path, no FX, is not in the main run: agent run 1, 2 November, P-0007, transfer `7bbb3d61…` PAID, started by the CFO with `npm run licence` ([run log](runs/2026-11-02-agent-run-1.md)) |
| "The approval covers amount, currency, beneficiary, quote id and rate, so an expired quote means a new approval." | ✅ | Main run: P-0005's terms hold EUR 240.00, the beneficiary Stockline Data GmbH, the fee ceiling, quote `f6a63046…`, its rate 1.129917 and its end (record `ledger.proposals`); the approved hash `797d4483…` is in the conversion and the transfer (seq 362, 363). An expired quote: `test/adversarial.test.ts` |
| "The transfer is tracked to PAID or CANCELLED, and a replacement goes out only under a duplicate lock." | ✅ | Main run: transfer `03360bfa…` SENT at 11:31:23, PAID at 11:31:24 (seq 364, 366). Simulated: in the sandbox Purser itself moves the transfer to SENT and PAID through Airwallex's simulation API and reads it back (`settleInSandbox`, `src/executors/invoicePayment.ts`). The duplicate lock is not in the main run (no replacement was needed): `test/euroBill.test.ts` |
| "An append-only log keeps inputs, numbers, explanations, approvals, Metal transaction hashes and Airwallex ids, and mandate verify re-checks every payment from the chain." | ✅ | Main run: 412 audit rows, hash chain intact (record `audit`); `verify` passes and `reconcile` checked 88 with 0 differences (run log, acceptance §2) |
| "Claude reads notices, disputes and invoices, compares evidence and drafts proposals through typed tools; it never holds keys." | ✅, and more | Main run: the three agents decided through typed tools, 24 of 24 decisions by Claude (record `agent_stats`); no key reaches their models (`test/adversarial.test.ts`) and they hold no owner key and no passkey (`test/no-owner-key.test.ts`). The second approver's test passkey was pressed by Claude Code, our build tool, on Max's go, not by an agent |

## What got better than the idea

- **The agents decide for themselves**, as Claude agents with their own tools and memory, inside the same limits: in
  the main run 24 of 24 decisions by Claude, 0 fallbacks (record `agent_stats`).
- **Face ID instead of a typed hash**: the CFO approves the exact terms with a passkey on the phone; 5 decisions in the
  main run (P-0001, P-0002, the rejection of P-0004, P-0005, P-0006).
- **Company cards from Airwallex Issuing** per agent, with limits Airwallex enforces: in the main run the Sourcing
  agent asked for a card raise (P-0006, EUR 30.00 → 46.00), the CFO approved it with Face ID, and Airwallex approved the
  TAP-signed EUR 45.00 purchase (authorization `01a1a12f-4113-7000-b76d-014677710007`). Airwallex's own events (a
  declined card, money paid in) reaching the agents: the autonomous dry runs of the 1 November soak (D22,
  [soak report](runs/2026-11-01-soak.md)).
- **Four eyes, an emergency stop, velocity limits, MFA** (behind its flag), each with tests. Four eyes ran in the main
  run (P-0002); the emergency stop is tested against stand-ins, not yet run live.

## Promised and not done yet

- The plan named "a video under 5 minutes": the film is cut at 2:30 from the main run
  ([docs/video/README.md](video/README.md)); its link goes into the form when Max has recorded his lines.
