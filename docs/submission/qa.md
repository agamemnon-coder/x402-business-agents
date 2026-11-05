# Q&A: what the jury will probably ask

For Max. Each answer is at most two sentences, then its source. Figures are the main run's (3 November 2026,
[log](../runs/2026-11-03-main-run.md), [record](../demo/main-run.json)); `test/pitch.test.ts` checks them. When you do
not know: "Good question. I'll check and send it to you." Never guess.

## The twelve

**1. Why Face ID and not a PIN or password?**
A password is the same for every payment; a passkey signs the hash of these exact terms, so changing one cent makes
the signature worthless. The server checks that signature, not your face: it checks no attestation, so Face ID is what
the phone asks for, not something we prove.
*Source: `docs/phone-approval.md`; the note on `/try/sign` (`src/try/sign.ts`); the film's `12-why-face-id`.*

**2. What happens if an agent lies, or gets a prompt injection?**
Inside its limits a lying agent can spend at most its cap and budget; beyond them, nothing moves without a signature.
In the main run an instruction planted in the dispute (an address 0x…dEaD) was flagged and ignored, and Metal refused
the one purchase we let through over the cap; the refusal is recorded on chain.
*Source: log, acceptance rows "dispute" and "5"; `docs/fraud-and-injection.md`; `docs/controls.md`.*

**3. What actually ran live, and what was simulated?**
Live, with test money: the Airwallex sandbox calls, the Metal testnet transactions, 24 of 24 Claude decisions and my
passkey (Face ID on my phone); I play the CFO. Simulated or ours: the supplier, the customer and the
merchant; the SWIFT SENT and PAID steps, which Purser moves through Airwallex's sandbox simulation API; and the second
approver, a labelled test passkey.
*Source: README, "What is real, what is mock"; log, "Approvals"; deck slide 7.*

**4. Why do you need Airwallex and Metal both?**
Metal carries the agents' own per-query payments under an on-chain mandate per agent: 86 payments in the main run,
each its own transaction. Airwallex is the company's bank: each agent's card, the FX for only the shortfall, and the
SWIFT payout of the euro licence.
*Source: README, "On Metal testnet, checked against the chain on 5 November"; record: `payments`, `fxOf`.*

**5. Why three Claude models? Couldn't Haiku do it all?**
Honestly, almost: on everyday cases Haiku alone passed 18 of 18, like our split, at a fraction of the cost. On a
harder mixed-language dispute Haiku alone misread one order, so Sonnet reads documents; Opus is the least proven part,
and Sonnet is the measured cheaper alternative.
*Source: `docs/claude.md`, "Why these models, measured honestly"; `docs/model-benchmark.md`.*

**6. How does this scale to a real company with 50 agents?**
Each agent gets its own mandate, card and limits, and code also holds a shared total and velocity limits per agent,
so each new agent comes with its own bounded limits. Today it is one company per ledger on test rails; Postgres, keys in a KMS and
many companies are the next step, not built.
*Source: `docs/controls.md` (budgets, velocity); `docs/roadmap.md`; deck slide 9.*

**7. What stops an agent from splitting a payment to stay under the limit?**
The mandate has a total budget as well as a cap per payment, and code holds the agents' shared total and velocity
limits per minute and per hour. There is no per-day limit yet.
*Source: `docs/controls.md` ("Velocity, per minute and per hour", "Mandate budget"); `test/velocity.test.ts`.*

**8. What if your server is compromised?**
The rails refuse anything over their current limits; changing a limit needs a signed proposal. The runner host holds
the keys, though, so a compromised host is out of scope today; keys move to a KMS before real money.
*Source: `docs/security.md`, "Accepted risks and what is out of scope"; log, acceptance row 5 and P-0006.*

**9. Who is liable when an agent overspends?**
Inside a limit, the company is, because the CFO set that limit; beyond it nothing moves without the CFO's signature on
the exact terms. Every payment carries its proof and the approval behind it, so it is clear who allowed what; the
legal terms for a product are not written yet.
*Source: `docs/rules.md` (Dan Kim's principles, "a record connecting it back to the agent, the task, and the policy");
README.*

**10. How is this different from a corporate card with limits?**
A card limit says how much; Purser also says which agent, for what, and lets the agent propose options when the world
changes. Beyond the limit, the CFO signs the exact terms, not "yes" to a notification.
*Source: README; record: Treasury's options 40 s after the refusal (`timings`).*

**11. What would you build next with Airwallex and Metal?**
With Airwallex: refunds and returns, payouts to suppliers in their own currency, and connected accounts for many
companies. With Metal: mainnet, and four eyes as the default for mandate changes.
*Source: `docs/roadmap.md`, "Airwallex products that fit next" and "Phases"; deck slide 9.*

**12. Why can't the jury's test passkey touch the real CFO world?**
Your test world, its passkey record and its proposals live in their own store, apart from Northwind's. Your test
passkey is enrolled nowhere else, so it can never approve a real proposal or sign in to the CFO's pages.
*Source: the note on `/try/sign` (`src/try/sign.ts`); `worker/src/trySign.ts`.*

## The hard ones: say plainly what is not done

**The Cardputer hub: is it live?**
No: the hub push and gate are built and tested against a fake hub, not live. It is not in the demo.
*Source: README, "Built, not yet live".*

**Is T:0 live?**
<!-- T0-STATUS -->T:0 bookkeeping is built; posting failed (shared key 403 CAPI71 on 3 Nov, new key 401 CAPI11 on 5 Nov), so nothing is posted. We claim nothing in T:0.<!-- /T0-STATUS -->
*Source: [docs/runs/2026-11-03-t0-sandbox.md](../runs/2026-11-03-t0-sandbox.md) (`403 CAPI71`);
[docs/runs/2026-11-05-t0-live.md](../runs/2026-11-05-t0-live.md) (`401 CAPI11`); README, "Built, not yet live".*

**Was the second approver a second person?**
No: in the main run it was a labelled virtual test passkey, pressed by our build tool, Claude Code, on my go. In
production the second approver is a second person.
*Source: log, "Approvals"; README, "The main run"; `SECOND_APPROVER`.*

**Did the SWIFT payment really settle?**
No: PAID is the sandbox's status, and Purser itself moves the transfer to SENT and PAID through Airwallex's simulation
API. The 6 seconds from Face ID to PAID are measured, but the settlement is simulated.
*Source: README, "Earnings and euros"; record: `timings` (faceToPaid 6); `SANDBOX_SETTLED`.*

**How much is really on chain?**
<!-- METAL-ONCHAIN -->On Metal testnet, on chain and checkable: 6 mandate transactions, 86 payments each with its own
transaction (41 sales, 41 supplier purchases, 3 refunds, 1 sweep), and the refusal of #24; no emulator and no clearing
in this run. The euro licence and the card buy ran on the Airwallex sandbox (their ids are published on /proof), and 13
other refusals are in our ledger only.<!-- /METAL-ONCHAIN -->
*Source: README, "On Metal testnet, checked against the chain on 5 November".*

**Isn't letting one purchase through staged?**
Yes, on purpose and labelled: we tested the second layer, because Purser would have refused it itself
(`mandate_cap_exceeded`, 0.04 over the 0.03 cap). Metal refused it; the refusal is recorded on chain. Nothing moved.
*Source: log, acceptance row 5 ("Purser would have refused (`mandate_cap_exceeded`, 0.04 over 0.03)"); `DEFENSE_IN_DEPTH`.*

**Worst-case loss per day inside the limits, and how fast does the CFO know?**
At most 20.00 test USD on Metal (the three mandates' budgets, 10.00 + 4.00 + 6.00, held to that total in code) plus
EUR 300.00 on the cards (monthly limits 100.00 + 150.00 + 50.00), and those are totals, not daily figures: there is no
daily ceiling. The CFO sees each payment in the dashboard's feed as it happens, and a velocity breach (Sourcing: 30
payments a minute, 4.00 test USD or EUR 100.00 an hour) stops that agent and raises an alarm on `/health`; no pager is
connected yet.
*Source: `src/config/policy.ts` (`TOTAL_BUDGET_CENTS`, `INITIAL_MANDATES`, `CARDS`, `VELOCITY`); `docs/controls.md`
(L4, I3).*

**Why not Airwallex's own spend controls and approvals?**
We use them: each agent's card limit is Airwallex's, enforced by Airwallex. Purser adds one policy across Airwallex
and Metal, each agent's mandate on chain, and a signature on the exact terms of each payment beyond the limits.
*Source: README, third paragraph; `docs/roadmap.md` (Airwallex's AgentOS: "require manual approval for tool calls").*

## The top five, for the cheat sheet

1, 3, 5, 8 and 12 above; the cheat sheet carries them in one line each (`docs/internal/spiekkaart-demo.html`).
