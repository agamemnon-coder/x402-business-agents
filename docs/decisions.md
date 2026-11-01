# Decisions

Decisions taken while working without Max present (master prompt of 29 October). Each entry says what was decided,
why, and what it costs if it turns out wrong. Max can overrule any of them.

## 29 October 2026

### D1. Product name Purser; example company Northwind Outdoor

- **What:** the product is **Purser**. The example company is **Northwind Outdoor**, a D2C outdoor brand in
  Amsterdam that sells in the EU and the US.
- **Why:** Max's choice (name and scenario A).
- **If wrong:** both names live in one file, `src/config/brand.ts`, so a change is cheap.

### D2. Internal agent ids stay; people see role names

- **What:** the code keeps the ids `sourcing`, `support` and `treasury`. Policy keys, mandates, key files and the
  ledger depend on them. People see these names:

  | Id | Shown as | Its job |
  |---|---|---|
  | `sourcing` | Operations agent | Buys live stock checks from the warehouse API (Stockline) per request on Metal. Its card pays the warehouse software. |
  | `support` | Sales agent | Its card pays for ads. It also owns the retailers' accounts, so it settles a retailer's claim (refunds on Metal). |
  | `treasury` | Finance agent | Pays the manufacturer's EUR invoice by SWIFT with FX, sweeps the earnings to Airwallex, and pays the bookkeeping on its card. |

- **Why:** renaming ids would touch money, mandate and policy code, the key files and every ledger, the night before
  the live runs. A display name changes nothing that moves money.
- **If wrong:** a juror who reads the code sees `sourcing` beside "Operations agent". `docs/architecture.md`
  explains the mapping. A full id rename can come after the freeze.

### D3. The parties in scenario A

| Role | Before | Now |
|---|---|---|
| Our company | Tidemark Data | Northwind Outdoor |
| Warehouse API we buy from per request (Metal) | Feedstock Labs | Stockline |
| Retailer whose buying agent pays us per request (x402, mandate, clearing) | Kestrel Quant | Summit Outfitters |
| Manufacturer paid by SWIFT invoice with FX | Lizenzhaus Beispiel GmbH | Bergtex Textil GmbH |
| What is sold per request | an EUR/USD tick | a live stock check for one product (units on hand and wholesale price) |
| Operations agent's card | Northwind Market Data | Packwise (warehouse software) |
| Sales agent's card | Tailspin Helpdesk | Adwave (ads) |
| Finance agent's card | Contoso Books | Ledgerly (bookkeeping) |

- **Why:** a juror from Airwallex should recognise the business at once: a brand that buys stock data, pays ads
  and a manufacturer abroad, and sells to retailers.
- **If wrong:** the names are fictional and sit in config and fixtures. The tests pin the stories, not the names.

### D4. The recorded demo stays rehearsal 3 until Friday's runs

**Done 30 October:** the recording is now Friday run 1 with Northwind Outdoor (`docs/runs/2026-10-30-friday-1.md`).

- **What:** `/demo`, `/?recorded` and the landing figures keep showing rehearsal 3 (Tidemark Data, EUR/USD ticks)
  until the runs of Friday 30 October replace them. The pages say "recorded with the earlier example company".
- **Why:** re-recording an old run under new names would claim that stock checks were sold when FX ticks were.
  That is not honest.
- **If wrong:** for one day the demo shows the old example company. The product name Purser is already on every
  page.
- **Known mix:** the pages name the agents by their new roles everywhere, also over the old recording (the "Sourcing
  agent" of rehearsal 3 shows as "Operations agent"). The landing's card illustration already uses the new merchant
  names; its amounts and steps are those of rehearsal 3 (€19.99 approved, €45 declined over €30, Face ID, €50).
  Friday's runs make both match again.

### D5. The Friday runs replace the Saturday runs

- **What:** the live runs are Friday 30 October at 19:00 and 21:00 CET. They are the source for the screenshots,
  the figure strip, the Metal dossier and the video.
- **Why:** the master prompt (it replaces the earlier choice of Saturday 10:00 and 15:00).

## 30 October 2026 (night)

### D6. The red team runs as code; the model declined to play the attacker

- **What:** `npm run redteam` runs the 14 attacks of `src/redteam/attacks.ts`, each in a throwaway world. It was
  meant to let Opus pick the attacks and write test documents of its own. Opus declined twice, the second time
  with an honest framing as the tester of our own software in a test world. I did not try other wordings or another
  model to get around that. The report says the model declined, and the attacks ran without it: 14 of 14 blocked. (Later runs had Opus attacking: see `docs/redteam/report.json` for the latest.)
- **Why:** the controls are tested either way, by the same code. The red team still found one real weakness: the
  Claude reader trusted the shape of a model's answer. It now checks every reading against its schema itself.
- **If wrong:** the demo moment shows "14 attacks, 14 blocked" from code, not from a model choosing attacks. The
  model hook stays in place, so Max can try again.

### D7. Velocity limits are code constants; the stop is a policy switch

- **What:**
  - The limits per agent (payments in a minute, amount in an hour) live in `src/config/policy.ts`. They are set well
    above the busiest live run.
  - The stop itself is the policy rule `stop.<agent>`. Code turns it on; only an approved policy change with Face ID
    turns it off.
  - Declined card attempts do not count.
- **Why:**
  - The phone editor already handles on/off rules. A new "count" rule kind would mean new phone code the night
    before the runs.
  - Counting declines would let anyone with a card number stop an agent (found in the independent review).
- **If wrong:** the CFO cannot tune the limits from the phone yet. That is a small change after the freeze.

### D8. The Friday worlds are bootstrapped the night before

- **What:** `friday-1` (19:00 CET) and `friday-2` (21:00 CET) were bootstrapped on Thursday night: accounts, 20.00 test
  USD and the four mandates on Metal testnet. Everything after that (sales, the price rise, every approval, the
  cards, the invoices) happens live during the runs. Max enrols his passkey fresh in each world.
- **Why:** the testnet faucet gives one grant a minute and asked us to wait in both bootstraps. Doing it on Friday
  would cost minutes in front of the camera and add a step that can fail, for no gain: the bootstrap is the same
  code and its transactions are on the explorer with their time.
- **If wrong:** a world can be bootstrapped from zero in about four minutes; `rehearsal-6` shows it on the new code.

### D9. The `support` agent is shown as the Sales agent

- **What:** the agent with id `support` was shown as the Marketing agent. It is now the Sales agent: its card pays for
  ads, and it settles the retailers' claims (refunds on Metal). The id stays (D2).
- **Why:** a fresh juror read "the Marketing agent refunds wrong stock checks" as a leftover. A sales agent owns the
  retailers' accounts, so both jobs fit one name.
- **If wrong:** it is one line in `src/config/brand.ts` and the card's first name in `src/config/policy.ts`.

### D10. Double-entry bookkeeping waits until after the freeze

- **What:** no double-entry ledger before the Friday runs. The GL journal (`npm run gl`) keeps one signed line per
  movement, with its account, cost centre, bank account, proof and approval.
- **Why:** postings made from that journal would balance by construction, so they would prove little. The daily
  reconciliation already checks each money flow against Airwallex and Metal, and that is the check that can fail.
  A new money-adjacent module the night before the runs is a risk with no visible gain for the CFO or the jury.
- **If wrong:** the GL export is the input for it; it is a day's work after 4 November.

### D11. A company-sized euro reserve, and guests see only Northwind

- **What:**
  - The EUR reserve floor is EUR 25,000 (was EUR 500). Free euros before the manufacturer's bill stay EUR 1,500, so
    the finance agent still buys only the EUR 370 missing. The treasury shows euros on hand, the reserve and what
    is free for new bills.
  - After the Friday runs, every recording, the landing figures, the recorded dashboard and the Metal dossier come
    from the Northwind runs only. `demo:record` refuses a ledger that still shows the earlier example company or
    the old agent names, and `test/guest-names.test.ts` checks what guests can open once the recording is Northwind.
- **Why:** an external QA pass read "€6.54 free" next to a EUR 500 reserve as not credible for a real company, and
  found the earlier example company's names still visible to guests.
- **If wrong:** the reserve is one constant (`EUR_FLOOR_CENTS`) and a CFO policy value (`eur_floor`).

### D12. The Dispute desk rules live in one shared example (31 October)

- **What:** the per-payment dispute rules, the evidence pack and the refund routing moved unchanged into
  `examples/metal-dispute-desk/`; Purser imports them from there. A parity test runs one case table against both.
- **Why:** the judge review asked for something any seller on Metal can reuse; one copy cannot drift.
- **If wrong:** the example is plain functions; moving them back is a revert of one commit.

### D13. minimatch pinned to 11.0.3 by override (31 October)

- **What:** `overrides.minimatch` is `11.0.3`. eslint's own range resolved to 10.2.6, which npm audit now reports as
  moderate (GHSA-g3hv-75wg-m249); the fix exists only from 11.0.1.
- **Why:** CI runs `npm audit --audit-level=low`; lowering that level would weaken a check. minimatch is used only by
  the lint tooling, and lint passes on 11.0.3.
- **If wrong:** drop the override once eslint's own dependency moves to a fixed version.

### D14. The agents carry Kit 11's names, word for word (31 October)

- **What:** Operations agent → Sourcing agent, Sales agent → Support agent, Finance agent → Treasury agent, in the
  code, every page, the deck, the README and the docs a juror reads. The Support agent's card pays helpdesk software
  (MCC 7372) instead of ads. Budgets stay the brief's: 10 / 4 / 6 = 20, at most 3 cents a purchase, then 12 / 4 / 4
  after the price rise.
- **The recording:** the 30 October run was made with the earlier names. Its recorded data (`docs/demo/*.json`, the
  Lab and red-team reports, the Visa dev test) now shows the Kit 11 names, and every page that plays it says at the
  top that it was recorded before the rename and that the Support card then bought ads. The audit log
  (`docs/audit/friday-1-audit.jsonl`) and the dated run logs in `docs/runs/` are left as they were: they are the
  record, and the chain's hashes cover the old wording. The live run with Max becomes the new recording; the label
  goes away when `docs/demo/story.json` carries `agent_names: "kit11"`.
- **Why:** Max: the names must be literally Kit 11's, with no "= Kit 11's …" mapping.
- **If wrong:** the names live in `src/config/brand.ts`; the guard is `test/kit11-names.test.ts`.

### D15. From good to winner: estimates and risk, before any code (31 October, evening)

All of this sits behind `KIT11_AGENTS=on` and is for Thursday's run. The reserve run runs from the tag
`reserve-run-2026-11-02` (`eff08b4`) in its own git worktree, so nothing below can reach it. Kill rule: a block goes
into Thursday's run only if it is in three green dry runs in a row by Wednesday 4 November 23:00; otherwise it stays
behind its flag and the pages say nothing about it.

| Order | Block | Estimate | Risk | Why that risk |
|---|---|---|---|---|
| 1 | 4.1 Agent trace: one timeline per decision (model, tool calls, tokens, cost, latency, the check that let it through or stopped it, tx or Airwallex id, audit hash), opened from its feed line | 4 h | low | Read-only; built from audit rows that exist. Tokens need one more field in `agent.run`. |
| 2 | 4.2 Pause per agent with Face ID: really revokes the agent's Metal mandate (`mandate revoke`) and freezes its Airwallex card; resume binds a fresh credential for what is left of the budget and unfreezes the card | 7 h | **high** | Money and chain code. A revoked mandate cannot come back: resume binds a new one, whose budget must be the old budget minus what was spent, or the agent could spend twice its budget. Resume re-grants spending power, so it needs four eyes like any mandate change. |
| 3 | 3 The agent picks the rail: x402 via Metal for data, a single-use Airwallex task card for a card-only supplier; code checks the choice | 6 h | medium | Task cards exist (Ask Purser); the agent only chooses. Code refuses a rail the purchase does not allow. |
| 4 | 2 Customer agents (Summit, Stockline) on Claude: they buy, sign orders, Summit opens the dispute in its own words | 8 h | medium | Summit's agent becomes another reader of hostile text; its signed orders must still be checked by code. Labelled "customer agents simulated by us, running on Claude". |
| 5 | 1 The jury raises the supplier price on /try and watches the agents work, with a real Metal refusal | 10 h | **high** | Public, real chain, real Claude spend. Needs its own wallet with little *USDZ, an hourly reset, a per-IP limit, a daily cap on runs and on Claude cost, view-only proposals. Biggest abuse surface. |
| 6 | 4.3 Unit economics per agent, 4.4 the "agent was wrong" case, 5 pitch and ten jury questions | 4 h | low | Docs and one table from real run numbers only. |

Total about 39 hours for Saturday evening to Wednesday evening, beside three dry runs a day. If time runs short,
block 5 (the jury's own run) is the first to stay behind its flag: it has the highest risk and /try already works.

### D16. Face ID signs on chain: research (31 October, late evening)

Question (Max, block 1): can the CFO's and the controller's passkeys themselves be the two signers on chain, so no
server key changes a mandate? Findings, each tested or read, nothing created on chain:

1. **The P-256 precompile is there.** Metal testnet (chain 63825) answers RIP-7212 at `0x…0100`: an `eth_call` with a
   P-256 signature made here returned `1`; the same signature over another hash returned empty. (The node's gas
   estimate for the call was 470,019, which includes Metal's base cost; the verify itself is to be measured in a
   contract.) Script: scratchpad `p256/precompile.ts`, read-only.
2. **MetalAccount owners are ERC-7913 signers** (`src/metal/fourEyes.ts`, from Metal's docs: "To use other ERC-7913
   signer types, provide their verifier and signature encoding"). The account factory
   (`0x3dbED5DebA965A639bB0Fd40BE96b97922070FA8`) accepted, in a read-only `predictAccount`, a 2-of-2 configuration
   with an EOA and a signer of the form *verifier address ‖ 64-byte P-256 key*. Owners can also be changed later through
   the account's own `addSigners` / `removeSigners` / `setThreshold`, with the current quorum's approval, keeping the
   address and the funds.
3. **What Metal does not document:** a deployed WebAuthn/P-256 verifier, the signature encoding it expects, and
   whether the account calls `verify` on an ERC-7913 signer exactly as OpenZeppelin's `ERC7913` signers do. Max asks
   Metal in Slack (draft below); until they answer, the build tests it on testnet.
4. **Bind/replace/revoke are the account's own calls** (`OnlySelf` in the mandate ABI), so if the owners are the two
   passkeys, a mandate change *cannot* happen without both Face IDs: the owner key on the runner is gone for mandates.

**Plan (behind a flag, `KIT11_PASSKEY_OWNERS=on`; estimate 10 h; risk high):** deploy OpenZeppelin's audited
`ERC7913WebAuthnVerifier` (pinned `@openzeppelin/contracts`, compiled with the repo's `solc`) on testnet; create a 2-of-2
business account whose owners are the two passkeys (verifier ‖ public key from enrolment); the phone signs the
account's EIP-712 `Execute` digest as the WebAuthn challenge; the runner only relays `executeSigned` and pays gas, it
signs nothing. Tests and red team: replay (nonce), a wrong challenge, one signature alone, an expired `validUntil`,
a third key. If it is not green by Wednesday 23:00 it stays labelled as now, with this research in the roadmap.

**Slack draft for Metal (for Max to send):** "Hi Metal team, we're building passkey owners for a MetalAccount: two
ERC-7913 signers (verifier ‖ P-256 key) with threshold 2, so the CFO's and the controller's Face ID approve mandate
changes on chain. RIP-7212 at 0x…0100 works on testnet and predictAccount accepts the signer bytes. Two questions: does
MetalAccount validate ERC-7913 signers via `IERC7913SignatureVerifier.verify(key, hash, signature)`, and is there a
WebAuthn verifier you already deploy or recommend? Thanks!"

**Result on testnet (1 November, `npm run passkey-owners`, `docs/runs/passkey-owners.json`).** It works, first try.
Metal testnet runs Cancun (MCOPY tested read-only), so OpenZeppelin 5.6.1's `ERC7913WebAuthnVerifier` (committed
artifact, recompiled in `test/passkey-verifier.test.ts`) deployed at `0xd4c84c2b…755ab`. Its `verify` returned the
selector for a WebAuthn signature and `0xffffffff` for the same over another hash (estimate 490,263 gas with Metal's base
cost). A 2-of-2 account whose **only owners are two passkeys** (`0x44aF42d8…037e8`): a payment signed by the CFO's passkey
alone, by the CFO and a stranger's passkey, by both over another challenge, and by both after the deadline each
**reverted on chain**; both passkeys: paid (1,048,803 gas); the same signed batch again: reverted (nonce used). A mandate
**bound with both passkeys through Metal's own `authorizeMandateCall`** (the CFO's alone: reverted), the agent paid inside
it alone, and both passkeys revoked it. Metal's SDK documents passkey signatures for that callback
(`@metalntwx/metal-pay` README). **Honest limit:** these passkeys are software stand-ins in the WebAuthn format a phone
produces; the next step has the phone's own passkey sign the Execute digest (virtual authenticator in the dry run).

**With the phone's own passkey (1 November, behind `KIT11_PASSKEY_OWNERS=on`).** New proposal kind `owners_execute`
(`src/metal/ownersExecute.ts`): the terms carry the exact account calls, nonce, deadline and the account's Execute
digest; the phone shows them (hash and runner signature checked as for every proposal) and **the passkey signs the
digest as its WebAuthn challenge**. The runner checks the digest follows from the terms and that the passkey is one of
the account's owners, verifies both assertions, builds the quorum and relays `executeSigned` from a gas-only sponsor
(`npm run owners -- setup | propose | status`). The relay (Worker core) accepts the digest as the challenge for this
kind only. Dry-run step 12d (`DRYRUN_ONLY_OWNERS=1` for the step alone): in test world dry-93, two Chrome virtual
authenticators (the same WebAuthn a phone uses) enrolled as CFO and controller, the account created with them as its
only owners, a Sourcing mandate proposed, "1 of 2 approvals", then "Approved", the account ran it on chain, and the
Metal CLI reports the mandate bound. Tests: `test/owners-execute.test.ts` (10). **Still open:** the deployed Worker must
be redeployed with this change before Thursday; a real phone (Max) is the last proof; the phone shows the runner's
words for what the calls do (decoding the call on the phone is the next step).

**Security review of block 1 (1 November, fresh Opus).** No code path lets one person, a stranger or a non-owner
passkey get a call run. Two design gaps, both acted on: (1) a compromised relay page could have both passkeys sign its
own digest during routine approvals; written down as an accepted risk with its limit (`docs/security.md`): the passkey
account is a small demo account, and real funds need a page the relay cannot serve or an on-chain delay; (2) the calls
were not tied to the words shown; now the runner decodes the call and refuses unless it is one bind or revoke on the
account itself, no value, with the cap, budget and payee shown, and the phone checks the call's target, value and
selector, the deadline (within 300 s of the expiry), the nonce lane and the chain. Also fixed: a send whose receipt
was lost is waited for on retry, never sent again; the switch now gates the runner and the executor too; the account
must be the one this world created. Tests: `test/owners-execute.test.ts` (13), with a real bind from dry-93 as fixture.

### D17. The rail choice uses the agent's own card for Packwise (1 November)

Block 5.1 (estimate 6 h, risk medium) was planned with a single-use Airwallex task card for the card-only supplier.
Built instead with the Sourcing agent's own card: Packwise is a monthly subscription, and a single-use card is closed
after its first charge (live, 30 October), so the next month's charge would be declined. The agent's own card already
carries the CFO's limits at Airwallex (software only, per purchase, per month) and is frozen by a pause or the stop.
No new card type before Thursday, and Ask Purser's task kinds (flight, hotel, train) stay as they are. Actual time:
about 2 h. Evals 60/60 over three models; the dry-run checks are in step 11 (`test/browser/dryrun.check.ts`).
