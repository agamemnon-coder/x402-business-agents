# Face ID on chain: the live run, step by step

This is a plan. No real phone has signed on chain yet. What ran before: software stand-in passkeys on 1 November, and one dry run with Chrome virtual authenticators. Everything here is Metal testnet and test money.

The scene: the owner's phone passkey becomes one of two owners of a small on-chain account. Both owners bind a mandate for the Sourcing agent. The agent pays inside it; one payment over the cap is refused on chain. Both owners replace the mandate with a higher cap, and the refused payment then goes through. Both owners revoke it.

## Before the run

First, by the operator: `npm run relay:deploy`, so the hosted relay serves this branch's approval page (an older page cannot show or sign a replace). Then set these for every command and for the runner. Names only: no value belongs in this file or in a chat.

| For | Settings |
|---|---|
| The world | `KIT11_DB`, `KIT11_KEYS_DIR` (a folder outside the repository). Every owners command refuses without `KIT11_DB`, and every one but record without `KIT11_KEYS_DIR`: none falls back to a default |
| Metal testnet | `METAL_RPC_URL` |
| The switch | `KIT11_PASSKEY_OWNERS`, set to `on` |
| The owner's go and the call budget | `OWNERS_GO`, set to `yes`; `OWNERS_CALL_BUDGET`; `OWNERS_CALL_LOG` (a file) |
| The relay | `KIT11_RELAY_URL` (or `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`), `KIT11_RELAY_TOKEN` |
| Funding, for setup | `OWNERS_DONOR_KEY` (a key file outside the repository) |
| The runner | `KIT11_CARD_POLL_MS`, set to `off`: the runner then polls no card transactions at Airwallex |
| The record | `OWNERS_DEVICE_CFO`, `OWNERS_DEVICE_CONTROLLER` (free text, recorded as stated by the owner), `OWNERS_DEVIATIONS` (optional text file, one deviation per line) |

Set `OWNERS_CALL_BUDGET` to the higher number of the line "Lines in the call log" below; the owner agrees that number before anything runs. The budget counts those lines, so the requests the metal-agent CLI makes inside each CLI run are not counted. Preflight prints the same plan and says whether the budget covers it.

## The plan and its calls

<!-- owners-plan:begin (built from ownersPlan and planTotals by test/owners-runbook.test.ts; never edited by hand) -->
| Step | Command | Requests | CLI runs | Transactions |
|---|---|---|---|---|
| 1 preflight | `npm run owners -- preflight` | 3 | 0 | none |
| 2 the owner's passkey | `npm run relay -- --enrol, then npm run passkey -- confirm <fingerprint>` | 0 | 0 | none |
| 3 the second approver | `npm run passkey -- add <name>, then confirm its fingerprint (a second device); or npx tsx docs/runs/driver/test-controller.ts enrol (a labelled virtual approver), then confirm its fingerprint` | 0 | 0 | none |
| 4 setup | `npm run owners -- setup` | 13 to 22 | 0 | donor key → gas sponsor, 5.00 test USD; create the account (gas sponsor → account factory); donor key → account, 0.60 test USD |
| 5 propose the bind | `npm run owners -- propose` | 1 | 0 | none |
| 5 the runner relays it | `npm run relay (running)` | 4 to 7 | 0 | executeSigned: the account binds the mandate (gas sponsor → account) |
| 6 pay | `npm run owners -- pay` | 1 | 2 | 0.05 to Stockline inside the mandate (signed by the mandate key, sent by Metal's facilitator); 0.06, over the cap: refused, and the refusal recorded on chain (sent by the gas sponsor) |
| 7 propose the replace | `npm run owners -- propose-replace <new cap> <new budget>` | 1 | 0 | none |
| 7 the runner relays it | `npm run relay (running)` | 4 to 7 | 0 | executeSigned: the account replaces the mandate (gas sponsor → account) |
| 7 pay again | `npm run owners -- pay` | 0 | 1 | 0.06 to Stockline, the amount refused in step 6, now inside the new cap (signed by the mandate key, sent by Metal's facilitator) |
| 8 propose the revoke | `npm run owners -- propose-revoke` | 1 | 0 | none |
| 8 the runner relays it | `npm run relay (running)` | 4 to 7 | 0 | executeSigned: the account revokes the mandate (gas sponsor → account) |
| 9 status | `npm run owners -- status` | 1 | 0 | none |
| 9 record | `npm run owners -- record` | 0 | 0 | none |
| **Total** | | 33 to 51 | 3 | 9 transactions |

Lines in the call log: 36 to 54. Every request is one line and every CLI run is one line; the requests inside a CLI run are not counted. The higher number is when every receipt takes all 4 polls.

Amounts, from the code: the mandate allows up to 0.05 per payment and 0.50 in total, to Stockline only; the payment over the cap is 0.06; the gas sponsor gets 5.00 test USD and the account 0.60 test USD; a proposal is open for 15 minutes and its signed deadline ends 120 seconds later.

On the phone, by step:

- **2 the owner's passkey**: Open the viewer link once. Open the enrol page and type the code. Tap "Create passkey with Face ID" and look at the phone. Read the fingerprint it shows aloud.
- **5 propose the bind**: Open the approval link within 15 minutes. Check: "Bind the sourcing mandate, signed on chain", 0.50 USDZ budget, up to 0.05 per payment, Stockline only. Tap "Approve with Face ID" and look at the phone. It shows "1 of 2 approvals"; then the second approver signs.
- **7 propose the replace**: Open the approval link within 15 minutes. Check: "Replace the sourcing mandate, signed on chain", <new budget> USDZ budget, up to <new cap> per payment (it was 0.05), Stockline only. Tap "Approve with Face ID" and look at the phone. It shows "1 of 2 approvals"; then the second approver signs.
- **8 propose the revoke**: Open the approval link within 15 minutes. Check: "Revoke the sourcing mandate, signed on chain", <new budget> USDZ budget, up to <new cap> per payment, Stockline only. Tap "Approve with Face ID" and look at the phone. It shows "1 of 2 approvals"; then the second approver signs.
<!-- owners-plan:end -->

## Each step: run, expect, and what the owner does

Every owners command ends with its count.

Expect: `CALLS            <used> of <budget> lines in the call log used in this world (this command: <n>); …`

**1 Preflight.** `npm run owners -- preflight`. It checks the settings, reads the chain and prints the plan. Nothing is sent.

Expect: `READY            nothing was sent`

**2 The owner's passkey.** `npm run relay -- --enrol`. Keep it running: it is the runner for the whole run.

Expect: `ENROL    on the phone open <address>/enrol and type <code> (valid until <time> UTC, five tries)`
Expect: `owners   relays behind the call budget: <used> of <budget> lines in the call log used in this world`

The viewer link is on the runner's `viewer` line. After Face ID the screen shows "Confirm on the runner" and "Fingerprint XXXX-XXXX-XXXX-XXXX"; the owner reads the fingerprint aloud. Then `npm run passkey -- confirm <fingerprint>`.

Expect: `confirmed  passkey <id> (fingerprint <fingerprint>); approvals now need it`

**3 The second approver.** The account needs two different approvers. One of two ways:

- A second real device: `npm run passkey -- add <name>`. That person opens the same viewer link and the enrol page on their own device, a moment after the command, and reads their fingerprint aloud. Confirm it as in step 2.

  Expect: `ENROL    <name>: on their phone open <address>/enrol and type <code> (valid until <time> UTC, five tries); the runner must be running`
- The owner has one device: `npx tsx docs/runs/driver/test-controller.ts enrol`, with the settings of The world and The relay; it needs Playwright with Chromium on the runner's machine. This is a virtual test passkey (test-controller): not a person and not a device. It keeps its key in the keys folder and does not confirm itself: on the owner's go, the operator runs the confirm line it prints. The record labels this owner as virtual.

  Expect: `CONFIRM          virtual test passkey (test-controller): it counts only once the operator confirms it on the runner, on the owner's go:`

**4 Setup.** `npm run owners -- setup`. It makes the key files it needs, funds the gas sponsor and the account from the donor key, and creates the account. The phone does nothing.

Expect: `ACCOUNT          <account>: owners <the two passkeys>, threshold 2; no server key is an owner`

**5 Bind.** `npm run owners -- propose`.

Expect: `PROPOSED         <id>: bind the sourcing mandate on <account>, cap <cap>, budget <budget>, <payee> only`

The owner opens the relay's address followed by `/approve/<id>` and follows the plan above. The first screen shows "Bind the sourcing mandate, signed on chain", the budget, the payee and "Needs your approval, and the second owner's" (the page's name for the second approver). "Details" holds the account, the limits and the digest the passkey signs.

Then the second approver signs: on the second device in the same way, or with `npx tsx docs/runs/driver/test-controller.ts approve <id>`. The virtual approver never signs first, never rejects, and signs nothing but this kind of proposal. The runner then relays the account call, and the second approver's page shows "Done".

Expect: `APPROVED         virtual test passkey (test-controller): signed <id> as the second approver, after <name>; the page says "<verdict>"`

**6 Pay.** `npm run owners -- pay`. The agent pays inside the mandate, then tries one cent over the cap. The phone does nothing.

Expect: `PAID             <amount> to <payee> inside the mandate: the mandate key alone signed`
Expect: `REFUSED          <amount> to <payee>, one cent over the <cap> cap: <reason>`

**7 Replace.** `npm run owners -- propose-replace` with the amounts in the plan above (the new cap, then the new budget). This is ONE proposal with one on-chain `replace` call; each owner signs it once. It is not a revoke followed by a bind.

Expect: `PROPOSED         <id>: replace the sourcing mandate <mandate>… that <id> bound on <account>: cap <cap> → <cap>, budget <budget> → <budget>, <payee> only; what was spent under it carries over`

The first screen shows "Replace the sourcing mandate, signed on chain" and, under "Per payment", the new cap with "(0.05 before)" beside it. Both sign as in step 5 and the runner relays it. Then `npm run owners -- pay` again: it pays the amount refused in step 6, once, and makes no new attempt over the cap.

Expect: `PAID             <amount> to <payee>: the payment Metal refused before, now inside the <cap> cap <id> set; the mandate key alone signed`

**8 Revoke.** `npm run owners -- propose-revoke`. The first screen shows "Revoke the sourcing mandate, signed on chain" and, under "Ends a budget of", the budget that ends. Both sign; the runner relays it.

Expect: `PROPOSED         <id>: revoke the sourcing mandate <mandate>… that <id> bound on <account>`

**9 Status and record.** `npm run owners -- status`, then `npm run owners -- record`. The record needs `OWNERS_CALL_LOG` and `OWNERS_CALL_BUDGET`, not the owner's go. It makes no call: it is written from the audit rows and the call log only.

Expect: `MANDATE          <mandate>… on <account>: proposal <id> (<what>) <status>; bound <yes or no>; revoked <yes or no>; spent <amount>`
Expect: `RECORD           <the .json file> and <the .md file> written from <n> audit rows and <m> call-log lines; no call was made`

## When something goes wrong

- **A proposal expires** (15 minutes; its signed deadline ends 120 seconds later). Signed too late: the phone shows "Too late" and nothing was approved. Signed in time but relayed too late (the runner was not running, or lacked a setting): the approval is void and the proposal is EXPIRED. Either way, run the same propose command again; both sign the new proposal.

  Expect: `<id> was approved, but execution stopped: <id> expired at <time>; approval void`
- **A signature is refused.** The phone shows "Refused" with the reason; nothing was approved. Usual reasons: the passkey is not confirmed yet, it is not an owner of this account, or the runner runs without `KIT11_PASSKEY_OWNERS`. Put that right and sign the same proposal again while it is open. A cancelled Face ID signs nothing: tap again.
- **A transaction reverts.** The proposal is FAILED and the runner's line gives the account's own error, decoded. Nothing is retried by itself: file a new proposal. If the replace reverts: `npm run owners -- propose-revoke`, both sign; then `npm run owners -- propose <cap> <budget>`, both sign; then `npm run owners -- pay`.

  Expect: `the account reverted executeSigned (<tx>): <reason>`
- **The outcome is open** (no receipt yet, the network, a spent budget in the runner). The proposal stays EXECUTING. Start the runner again: it carries on from the recorded hash, and nothing is sent twice. Setup or pay stopped halfway: run the same command again; every send is recorded before it leaves and is made at most once.
- **The budget is spent.** The command stops before the request that would go over and exits with code 3. Ask the owner before raising `OWNERS_CALL_BUDGET`.

  Expect: `STOPPED          <reason>`
