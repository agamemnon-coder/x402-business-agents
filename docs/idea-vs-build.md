# From idea to build: every promise, with its proof

The idea Max submitted before the shortlist (24 October; `entries/airwallex/idea.md` in the `rewardssystem` repo),
promise by promise, against what is built. Each row links its proof: a Metal transaction, an Airwallex id, a test or a
run log. "Recorded run" is Friday run 1 (30 October, the recording on the site); "dry-103" is an autonomous dry run of
1 November (a separate test world, test money). Thursday's main run (5 November) adds its own proof to this page.

## The setup

| Promise in the idea | Built | Proof |
|---|---|---|
| Three agents share one Metal account, each under its own mandate the account enforces (payees, cap, budget, expiry) | ✅ | Binds and replaces: [docs/metal-award.md](metal-award.md) (mandates section), e.g. the replace [`0x6b77d994…6f7e`](https://testnet.metalntwx.com/tx/0x6b77d9942f5e7ff9669c0a2fd11d4cea166f7db4eaf3f9728c89bc45ac846f7e); `npm run dashboard-vs-chain` reads them back in every dry run |
| Sourcing 10 test USD at most 3 cents a purchase, support 4, treasury 6; code holds the 20 | ✅ | `src/config/policy.ts`; `src/policy/holds.ts`; dry-103 passed "the dashboard's mandates match the chain" |
| No agent holds the owner key | ✅ | `test/no-owner-key.test.ts` (1 November); [docs/security.md](security.md), "Least privilege" |
| Customers' agents buy queries at 5 cents through an x402 route that requires a signed order; upstream data costs 2 cents | ✅ | First sale [`0xc1b06070…ecfa`](https://testnet.metalntwx.com/tx/0xc1b06070a050556f5e2ef820fb2826dd1babde33787fab5c75aef7d3b677ecfa); `src/servers/seller.ts` (`requireSignedOffer`) |

## The three moments

| Promise in the idea | Built | Proof |
|---|---|---|
| **Price rise.** The supplier moves to 4 cents; the next purchase is refused (`mandate_cap_exceeded`); the customer gets an error, not a charge | ✅ | Metal's own recorded refusal [`0x9f58cab1…206d`](https://testnet.metalntwx.com/tx/0x9f58cab1cc1e5466184da28e22d49193d7a428bb25cb73822c597bb54bba206d); Purser refuses before signing too ([docs/metal-qa-2026-11-01.md](metal-qa-2026-11-01.md)) |
| The treasury agent proposes limits within the 20, with the margin per option (keep 5 cents, or charge 7) | ✅ | Recorded run: two options, the CFO signed one with Face ID; in dry-103 the Treasury agent decided itself that no rebalance was needed (Sourcing switched to Ridgeline inside its cap) |
| The approver sees the exact terms and their SHA-256; code replaces the mandates only if the hash matches | ✅ (better: Face ID) | Replaces [`0x2909b164…8aed`](https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed), [`0xbc70858f…b5d7`](https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7); the CFO signs the terms hash with a passkey (`test/passkey.test.ts`) |
| **Dispute.** 12 orders the customer says its agent never placed; signed orders checked against on-chain payments (`verifyMandatePayment`) | ✅ | Dispute desk, `test/dispute-desk.test.ts`; recorded case on `/metal` |
| Claude compares the delivered data with the supplier's corrections; only wrong records are refunded, each under its own payment id | ✅ | Refund [`0xcf11b76d…bed1`](https://testnet.metalntwx.com/tx/0xcf11b76d424f22ca07c514e9a9acb325238ea851f8c600ee92a578b6e421bed1); dry-103: the Support agent refunded #7, #10 and #13 itself (0.15) |
| Large refunds wait for a person | ✅ | dry-103: "refund all 12" went to the CFO, who rejected it with Face ID |
| **Euro bill.** Earnings swept to a Metal address Northwind holds and booked in Airwallex as a simulated deposit that references the chain hash | ✅ | Sweep [`0x3caf1e9d…11b7`](https://testnet.metalntwx.com/tx/0x3caf1e9dbb0d2fca75e5af80dc825d3790dbeac5a0ff1c3f83a7dd700f7811b7); dry-103 sweep `sweep-20261101-1` paid on chain; [docs/airwallex.md](airwallex.md) |
| The EUR licence invoice paid by SWIFT from the EUR balance above its floor, or FX for the shortfall only, on a fresh quote that includes the fee; the approval covers amount, currency, payee, quote and rate | ✅ | [docs/airwallex.md](airwallex.md) (FX and transfers). From the EUR balance, no FX: agent run 1 (2 November), P-0007 EUR 240.00, transfer `7bbb3d61…` PAID, fee EUR 13.37, after Max's Face ID (payment started by the CFO with `npm run licence`; the Treasury agent's own plan P-0005 was refused by the sandbox with `fee_unknown`) ([run log](runs/2026-11-02-agent-run-1.md)); dry-103 paid it the same way with a virtual passkey. FX for the shortfall only: the 30 October end check (EUR 370.00, [run log](runs/2026-10-30-endcheck.md)) and the 1 November hosted reserve check (EUR 253.48 for the licence, [run log](runs/2026-11-01-reserve-check-hosted.md)) |
| The transfer tracked to PAID; a replacement only under a duplicate lock | ✅ | `test/euroBill.test.ts`; transfers reach PAID in the sandbox by its simulation (labelled) |
| An append-only log; `mandate verify` re-checks every payment from the chain | ✅ | `npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl`; `npm run verify` passes in every dry run |

## What got better than the idea

- **The agents decide for themselves**, as Claude agents with their own tools and memory, inside the same limits:
  autonomous dry runs dry-97 to dry-103 green in a row ([run log](runs/2026-11-01-autonomy-dry-96-97.md)).
- **Face ID instead of a typed hash**: the CFO approves the exact terms with a passkey on the phone.
- **Company cards from Airwallex Issuing** per agent, with limits Airwallex enforces, and Airwallex's own events (a
  declined card, money paid in) reaching the agents (D22).
- **Four eyes, an emergency stop, velocity limits, MFA** (behind its flag), each with tests.

## Promised and not done

- The plan named "a video under 5 minutes": v0 script written ([docs/video/script-v0.md](video/script-v0.md));
  the footage comes from Thursday's main run.
