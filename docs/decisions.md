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

### D18. Four eyes on the real business account: not before Thursday (1 November)

Max's block 2 asked for the passkeys as owners of Northwind's own business account. **Not done, on purpose:** the
security review of block 1 (`docs/security.md`, "The relay serves the phone's script") showed that with passkey owners a
compromised relay page could collect both Face IDs for a digest of its own, and the business account holds the 20.00
the agents' mandates draw on. So the passkeys own a separate, small passkey account (`npm run owners -- setup`, at most
1.00 test USD), where binding and revoking a mandate needs both Face IDs on chain, and the business account keeps its
owner key (with Purser's four eyes in front of every mandate change). Moving the business account over is one
owner-change call (`addSigners`/`removeSigners`/`setThreshold`, Metal's docs on smart accounts) once owner signing has a
page the relay cannot serve.

### D19. Real agents, not a script: plan, estimate, risk (1 November, morning)

Max's call (1 November): the run feels like a script, because it mostly is. The demo plays steps; the agents act at
three moments; routine is code. **New rule: we change the world, the agents decide.** Everything here sits behind
`KIT11_AUTONOMY=on` (with `KIT11_AGENTS=on`); the reserve run on Monday stays at `reserve-run-2026-11-02`, agents off.
Kill rule: not green (three dry runs in a row, 0 unsafe actions, 0 double payments, fallbacks reported and under 10%)
by Wednesday 4 November 23:00 → Thursday runs the current agents (three exception moments), and the video and deck say
exactly what the agents do and do not decide.

**What is still script today:** the run's CLI steps decide *when* each agent acts (`s1 raise`, `s2`, `cards scenario`,
`licence`); each agent runs once per step with a fixed task; nothing wakes an agent but its step; agents talk only
through code (Sourcing's message is passed to Treasury by `s1.ts`); Sourcing has one supplier, so "switch supplier" is no
choice; routine (per-query buying) has no strategy the agent sets.

| Order | Block | Estimate | Risk |
|---|---|---|---|
| 1 | Proof per decision: API request id, tokens, cache hits, latency, cost in every trace; "decided by Claude" / "fallback (code)" on every decision; fallback share on the dashboard; one retry then a labelled fallback; cost cap per agent per hour and per run (alert at 80%) | 3 h | low |
| 2 | Runtime: an event bus and agent messages in the ledger; one loop per agent (own process) that wakes on its events or every N minutes, with a goal, its tools and a memory of its last decisions; kill switch and emergency stop checked on every wake | 6 h | medium |
| 3 | Sourcing with real choices: a second supplier (another x402 seller, other price, freshness, reliability), cache and "don't buy"; the agent sets a buy policy that code executes per query; it can switch supplier, ask Treasury, or propose a price change | 7 h | **high** (bootstrap binds two payees; per-query code path) |
| 4 | Support and Treasury as event-driven loops: a dispute event wakes Support (tools as today); Treasury acts on messages, refusals, invoices and deposits (plan, sweep, licence timing), within the rules; above the limits it goes to the CFO | 5 h | medium |
| 5 | The world: `npm run world -- price-rise | dispute | invoice | decline | deposit`; a world draaiboek and an autonomy dry run that checks invariants (no unsafe action, no double payment, fallback share) instead of fixed outcomes | 6 h | medium |
| 6 | Variation test (10 runs same world, 10 other worlds; real Claude, stand-in rails) and red team on the loop (injection, retry after refusal, agent manipulating agent, runaway cost) → `docs/agents-autonomy.md` | 6 h | medium |
| 7 | What you see: per agent what it thinks and does, agent-to-agent chat with the model on each message, "Powered by Claude" per agent card, on the dashboard and /live | 6 h | low |
| 8 | /try: the jury changes the world in a separate demo world | 6 h | high (public, cost) — first to be cut |

About 45 hours against about 85 until the kill rule, beside three dry runs a day and Max's QA, MFA and design asks. Order:
1–5 Sunday and Monday, 6–7 Tuesday, Wednesday three dry runs. 8 only if 1–7 are green on Tuesday evening.

### D20. Phishing-resistant MFA for the dashboard: passkey sessions, a read-only viewer link that expires (1 November)

Max's priority 5 (after 1–4). Today the hosted relay has one viewer key, derived from the relay token, that never
expires and also lets its holder post to the CFO's endpoints (policy, policy text, Ask Purser); approvals are signed per
terms hash with the passkey, so no money moves on the key alone.

Behind `MFA_SESSIONS=on` on the Worker (and `KIT11_MFA=on` on the runner); off, nothing changes (the reserve run):
1. **A passkey session.** `POST /api/session/options` gives a one-time challenge (two minutes); the phone signs it with
   its enrolled passkey (user verification required); the Worker verifies the WebAuthn assertion itself against the
   enrolled credentials' public keys, which the runner syncs (public, not secret). It checks the challenge, origin,
   RP id hash, the UP and UV flags, the signature counter, and the ES256 signature. It answers with a session cookie
   (random, stored hashed, 12 hours, `HttpOnly; Secure; SameSite=Strict; Path=/api`).
2. **The CFO's endpoints need that session:** policy, policy text, Ask Purser. Approvals keep their own per-terms
   passkey signature (step-up); enrolment keeps its code and the runner's fingerprint confirmation.
3. **The viewer link is read-only and expires:** the key is derived per ISO week; the Worker accepts this week's and
   last week's; it never opens a POST.
4. **Red team** (tests): a stolen cookie (expired, or from another credential once revoked), a replayed assertion, a
   passkey that is not enrolled, a leaked viewer link posting to the CFO's endpoints, a wrong origin, a missing UV flag.

Estimate 5 hours (Worker verifier 1.5, sessions and gates 1, runner sync and link 1, phone sign-in 0.5, red-team tests
and a fresh security review 1). Risk: medium (security code, public endpoint) — behind its flag until the review is
green and Max agrees; the Worker needs a redeploy (Max's go) to take effect on the hosted site.

**Built (1 November), all four steps behind the flags.** Two things the end-to-end browser check found, both fixed:
signing in is two posts, and they counted against the same ten posts an address gets in ten minutes as approvals,
so after the policy editor and policy-in-words the reject was refused with a 429. Sign-ins now count in their own
bucket of the same size (the approvals' limit is unchanged, and sign-ins are limited too; test). And the page first
posted, got a 401 and then signed in; `GET /api/approvals` now says `session_active` under MFA, so the page signs in
before the CFO's action (the 401-retry stays for a session that lapses meanwhile, with one Face ID prompt per action).
The phone check (`test/browser/approve.check.ts`) passes with `KIT11_MFA=on` and without it; it needs the rehearsal
ledger from the other repo, so it runs locally, not in CI. The Worker's tests (red team included) run in CI.

**Fresh security review (1 November, Opus, read-only):** nothing critical, high or medium. Four low findings, all
fixed with a test each: two sign-ins at once could move the stored counter backwards (it is read again after the
signature check, with no await before the write); a 401 right after a sign-in could ask for Face ID a second time
(one prompt per action now); an RSA passkey could not sign in (under MFA enrolment offers ES256 only, and the error
says why); the weekly viewer link was printed only at start (the runner prints the new one each Monday). Also: the
sign-in paths answer 405 to a GET, and tests now cover a cross-origin assertion, a missing user-presence flag and a
challenge whose two minutes have passed. Left as is, with the reason: no logout (a session lives 12 hours and dies
when its passkey is removed); `derToRaw` accepts non-minimal DER (malleability does not matter with one-time
challenges); enrolment under MFA is still guarded by the code and the runner's fingerprint confirmation, not a session.

### D21. /try: the jury changes the world and the Sourcing agent decides (1 November)

Max's priority 7 (first to drop if time runs short). The autonomy runtime needs the ledger (SQLite on the runner), so it
cannot run in the Cloudflare Worker that serves the public `/try`. Plan, behind nothing (it moves no money and touches
no rail; the Worker's change needs Max's redeploy like D20):
1. **One shared core, no ledger:** the Sourcing agent's brief (what it observes), its goal and rules, the
   `set_buy_policy` tool's schema and its code check move to a pure module that the real runtime and `/try` both use.
   The runtime's tests and the variation eval guard that nothing changes for the real agent.
2. **A world change, picked by the visitor:** five buttons (Stockline raises its price, Ridgeline gets flaky, the CFO
   raises the cap, Stockline drops back, Ridgeline cheap and fresh), the same worlds as the variation eval. One wake of
   the Sourcing agent with its real model (Haiku), at most five model calls; `set_buy_policy` is checked by the same code
   as in the runtime; a message to the Treasury agent is shown, not sent anywhere.
3. **The page shows** what the agent saw, each tool call, what code refused and why, the policy it set, and the cost;
   labelled "demo world · stand-in suppliers · no money moves".
4. **Limits:** the Try desk's own (per address a minute and a day, all visitors a minute, the daily model budget);
   past them, code alone answers and the page says so. Locally (no key) it says the hosted page asks Claude.
5. **Tests:** the shared core equals the runtime's behaviour; the engine with a stand-in model (test only, labelled);
   red team: a policy over the cap, under the margin, an unknown world id, a model that answers garbage; the page check.

Estimate 5 hours (core 1, engine and Worker route 1.5, page 1, tests and red team 1, review 0.5). Risk: low to medium
(public endpoint that spends model money, already bounded by the Try desk).

**Built (1 November).** Dev run against the real Haiku: 5 of 5 world changes decided by Claude, about 0.0005 USD and
4 to 5 seconds each (`docs/runs/2026-11-01-try-world-dev.md`). **Fresh review (Opus, read-only):** the refactor is
faithful (compared character by character), no XSS, no high finding. Fixed, each with a test: a test now runs the
runtime's own `wake()` on the same world with a stand-in client and requires the same model, system prompt, first
message and tools as /try's; the reminder uses the runtime's words and an answer cut off at max_tokens ends the wake
as in the runtime; the model's own blocks go back unchanged; the fallback's message is kept after two of Claude's; the
Try desk's ceiling a minute counts model calls (a typed task two, a world change five; 30 typed tries a minute as
before), each call's cost is recorded as it returns and the budget is checked before the next, and no call starts
after 30 seconds; request ids are shown as proof per call; the page shows the agent's whole prompt and says the match
is with the variation test (no card tools here), not the live runs.

### D22. The autonomous world gets Airwallex's own events (1 November, afternoon)

Max: "Zonder Airwallex in de autonome wereld is Airwallex weer alleen uitvoerder." Three world events that start at
Airwallex (or at a supplier that offers both rails), never at an agent, each reaching the agent as an event it decides
on itself, behind `KIT11_AUTONOMY=on` like the rest of D19:
1. **A card decline from Airwallex.** Packwise's monthly renewal at the Pro price is charged to the Sourcing agent's
   card by the merchant (Airwallex's issuing simulation, `npm run world -- packwise-renewal`). Airwallex decides; the
   decline reaches the runner by webhook (hosted relay) or the poll (local relay), is recorded once, and only then
   becomes the event `card.declined` for the card's agent, saying which way it came. The agent decides: ask the CFO for
   a raise (bounded), go back to Starter, or nothing. In autonomy mode the block 5.2 decline agent does not also act.
2. **Money in at Airwallex.** A customer pays a receivable into Northwind's Global Account (sandbox deposit,
   `npm run world -- deposit`). Matched by the webhook or the poll as today, it becomes `money.in` (rail Airwallex) for
   the Treasury agent, with the match result. Its position shows the receipts; with euros in, the licence invoice may
   need no FX, so it may plan it now, or wait; an unmatched deposit stays in suspense for the CFO (code, as today).
3. **The rail choice: x402 on Metal or an Airwallex task card.** Ridgeline Data offers a one-off demand report, either
   over x402 (0.20 test USD, over the Sourcing mandate's cap, so Purser and Metal refuse it) or by card in EUR on a
   single-use card per order (`npm run world -- report-offer`). The Sourcing agent picks: x402 (refused, with the reason),
   a single-use task card (a proposal for the CFO's Face ID; once approved and issued, the card is charged by the
   merchant at its next wake), asking Treasury for a higher cap, or not buying.

Each gets a dry-run step and tests; the soak runs all of them. Estimate 7 hours (decline event 1.5, deposit event 1.5,
report offer and task card 3, dry-run steps and tests 1). Risk: medium (money paths on the sandbox; every limit stays
where it is: Airwallex's card limits, the mandate cap, the CFO's Face ID for a card).

### D23. The money flow, animated, in the control tower (design 4.1; 1 November, evening)

Max: money moves visibly, customer agents → Northwind → the agents → suppliers, refunds, the sweep to Airwallex, the
licence in euros; each movement says which agent, which Claude model decided, the amount, the rail (a Metal
stablecoin payment in *USDZ on chain, or an Airwallex card, deposit or SWIFT transfer) and a clickable proof; a refusal
visibly hits its rail (Metal or the bank) with the reason. Only real events: `flowEvents(db)` reads them from the
ledger's audit log (each row's own tx hash or Airwallex id), on the live dashboard, and in the recordings as a replay
with its label (the recorded run, the autonomous dry run). Nothing is generated. "Decided by" is the agent's own Claude
decision that led to it (its model), the CFO's Face ID for an approval, or code following a policy, as recorded.
Works at 390 and 1440 px, light and dark, without motion for `prefers-reduced-motion`, and frames well for the video.
No new features beyond this.

Estimate 5 hours (flowEvents and tests 1.5, the animated panel 2.5, recordings, page check and review 1). Risk: low
(read-only, display only).

Built (part 2): the token runs through the gaps between the boxes (the edges that face each other), not over their
text. A refusal stops in the gap before the rail that refused it, at a red wall named after that rail ("Metal ✕",
"Airwallex ✕", "Purser ✕"); a card that Airwallex declined stops at Airwallex, not at the merchant. A card charge the
Airwallex sandbox simulated says so. The `/?autonomy` replay is now dry-105 (a `VACUUM INTO` copy; 19 decisions, 0
fallbacks, with the D22 events), so its movements name the Claude model that decided them. The page check's rule
"chain money reads test USD, never USDZ" on `/?recorded` now skips the money-flow panel only, where Max asked for
*USDZ to be visible; inside the panel a stronger check holds: always "*USDZ" with its star, the words "*USDZ stablecoin
on chain" present, never "$". Both recordings and the landing have their own money-flow checks (labelled a replay, a
proof per movement, a Claude model named in the autonomous run).

Fresh review (part 3), all fixed. (1) The landing said the CFO approved the recorded run's three refunds; code made
them within the automatic limits (and the CFO rejected the only refund batch). "Who decided" now comes from evidence
only: the refund's executed batch proposal (the CFO's Face ID), the Dispute desk's `refund.auto_approved` row (code),
the agent's own run, or "who decided is not recorded". (2) Claude was credited by the next decision in time, even one
that began after the move (a blocked sweep, a merchant's declined charge the agent then heard about). Now a movement is
Claude's only when its row lies inside the agent's run (`agent.run` records `from_seq`), the run finished with a model,
used the tool behind the movement without every call of it blocked, and the decision after it says Claude made it.
(3) A settlement carries the dispute's earlier refunds; it now records `refunded_now`, and only those count. (4) The
euro invoice names the Treasury agent's plan only for the same proposal (by the transfer's approval hash), by Claude.
(5) A retailer's bank payment comes from a "Retailers" box, not from Summit's agent. (6) On the live dashboard new
movements are taken in place: the viewer's place and Pause stay, a changed caption follows without a replay. (7) Timers
are cleared on Play and on every step, so ticks do not stack and a refusal's red mark never lands on the next movement.
(8) The refusing rail is marked by name in its own box (Metal on the business account, Airwallex, Purser on the agent),
also without motion. Also: the agents' boxes name a Claude model only when a movement shown was that agent's own Claude
decision; a row missing its amount or currency is left out instead of shown as 0.00 or euros; Purser's refused refunds
and sweeps, and sales through clearing (no tx of their own), are shown for what they are; the page check now reads every
movement's caption on `/?recorded` (each *USDZ amount beside "stablecoin on chain", never "$", the refusing rail marked).
`upstream.paid_after_lookup` stays out: its row records no amount.

Second fresh review, all fixed. A refund is now decided by its evidence first (the CFO's executed batch, then code's
automatic limits); Claude only through the Support agent's own settlement, the innermost run around the refund that
ends in one, so an outer autonomous wake whose inner settlement fell back to code no longer takes the credit. A card
charge is the agent's only when its own purchase started in the same run (same card, same amount); a merchant's
charge that lands while the agent is awake is not. Money that moved inside an agent's run without a Claude credit
reads "who decided is not recorded", not "code". A single-use card an agent asked for says so. On a live panel a new
movement is lit, marked and animated as its own; the panel shows again after an empty world. The autonomous recording
is built as of its last row, so its "Claude cost, last hour" is the run's own.

### D24. Who decided, recorded at the source (Max, 2 November)

The fresh reviews of D23 found the same root cause twice: "who decided" a money movement was worked out afterwards
from timing. Max: record it at the source. Every action that moves money gets an origin when it starts, which never
changes afterwards: the actor (an agent's Claude decision, the CFO with a passkey, the controller, code within an
automatic limit or a policy, or an outside party: a customer, supplier, retailer or merchant), with the model and the
API request id for Claude, the approval id for a Face ID, and the run id. It goes into the audit chain (the money
events' payload), the ledger rows (holds, refunds, sweeps, upstream purchases, transfers) and the outbox (money steps).

How: an origin is carried by the code path that starts the action (Node's AsyncLocalStorage), set at four doors only:
the agent loop around each tool call (agent, model, request id, run id), the executor around an approved proposal (the
approval, the CFO's passkey and, with four eyes, the controller), code's own automatic paths (named by their rule, and
overriding any agent around them), and the doors where outside money arrives (sales, deposits, card charges). A
subprocess a tool starts gets it through the environment. Code that moves money without an origin records none, and
that is counted as an error: `npm run origins -- <ledger>` lists every money movement without one, and a dry run with
the agents fails if there is any (Thursday's run must have 0). The dashboard, the money flow, the film and the Dispute
desk read only this field. Ledgers recorded before D24 (the 30 October run, dry-105) carry no origins; for those the
flow shows only what an explicit record says (an executed batch, an automatic-limit row) and is labelled as derived.

Estimate 8 hours (origin module and audit 1, the four doors and the ledger columns 3, readers 2, tests, red team,
browser check and review 2). Risk: medium; it adds a field and must not change any money path. Built in a separate
worktree while the soak runs on the current code.

Built (part 1, 1 November afternoon): the origin module (`src/provenance/origin.ts`, validated with zod; a stated
origin that is not well formed is recorded as missing), the audit writer attaching it to every money event, the four
doors (agent loop with the run id, the executor with the approval and cosigner, code's automatic refunds and the buy
policy with the agent run that set it, the outside doors: sales, deposits, card charges matched to the purchase they
answer or else the merchant), the ledger columns (`origin_json` on holds, refunds, sweeps, upstream purchases,
transfers and money steps; a resumed sweep keeps its origin), `npm run origins`, the dry-run check failing on any
movement without one, the money flow and the feed reading only the origin. The Dispute desk's route ("within the
automatic limits" or "waiting for your Face ID") is the desk's own record made when it decided, so it stays. The two
recordings were made before D24: their flows are labelled derived and credit no Claude model from a run; the next
autonomous dry run (after the faucet resets) replaces the `/?autonomy` recording with one that carries origins.

Fresh review of D24, fixed: a card charge answers only a purchase started on the same card for the same amount in the
15 minutes before it and not answered yet (an unanswered purchase no longer claims a renewal days later), and when that
purchase recorded no origin the charge records none either (not hidden behind the merchant); the agent trace takes a
money movement into a run only when its origin names that run (code's purchases during the run stay out); a sweep or
refund already sent is finished under the origin it started with, while a refused one tried again (or the CFO's batch)
is a new attempt that records its own, also on its ledger row and a reused hold; the adopted and deferred variants,
quarantine returns, test-money seeding and the passkey owners' transfer are money events too; an agent's direct pay
keeps its own origin; the check counts a ledger that began before D24 from its first movement with an origin; agents
and the relay start without an inherited origin; four eyes reads "two people approved it, each with their own Face
ID"; an origin that does not validate in the agent loop is left out (counted) instead of failing the tool; an index on
the audit log's events. Accepted: a writer may state an origin explicitly (the outside doors, code's booking with the
decision it follows); no writer puts model or outside input into that field, which a stated origin must pass zod.

A second look at those fixes, fixed: an agent's own purchase through our seller (the price-rise try, the rail
choice's pay) kept no origin across the in-process HTTP hop (the seller's handler runs outside the sender's code path),
so the purchase read as code's and dropped out of the run's trace; it is now carried by the stock check's number
(`src/provenance/carry.ts`, tested with a real local server). A sweep or refund left planned or proposed by a crash
during its pull is finished under the origin it started with; a refused one tried again records the new origin only
after its checks pass. Card charges answer the purchases of the same card and amount in order. A task card within the
CFO's policy (no proposal) is code's, asked for by the CFO at the runner.

### D25. The Visa Award: TAP claimed, and in the rail choice (Max, 1 November evening)

Airwallex answered Max in #help: (1) a TAP integration on Visa's open-source reference, with our own agent registry in
the sandbox, counts as "Visa tooling" for the Visa Award: "Yes"; (2) one project may enter both the Visa Award and the
Metal Award: "Yes". So TAP moves from "dev test, not claimed" to claimed for the Visa Award, with its honest label: the
agent registry is self-hosted per Visa's open-source reference, not Visa's production directory; Visa Intelligent
Commerce is not claimed. The Metal Award stays first, and Thursday's run takes no risk for this.

Plan: (1) claims, matrix, `/visa`, README and the submission text name it claimed, with the #help answer as the
source; the licence and brand rules of TAP are read again, and the Visa mark is used only where allowed (otherwise
"Visa's Trusted Agent Protocol"); the code follows the current spec and RFC 9421 (body bound by Content-Digest where a
request has one). (2) In the rail choice, a purchase from a card-only merchant is signed by the agent with TAP; the
merchant verifies it against the registry and refuses an unknown, expired, replayed or other-domain request; then the
agent's own Airwallex Visa card pays inside the CFO's limit (over it, a raise by Face ID). The TAP signature, the
merchant's verdict and the Airwallex authorisation id travel with the purchase's origin (D24) into the trace and the
money flow. Behind a flag (`KIT11_TAP_RAIL=on`): it goes into Thursday's run only if Wednesday's three dry runs are
green on exactly that code; otherwise it joins the short extra run on Monday 9 November (kill rule Tuesday 10 November
23:00). (3) Red team: replay, expired, wrong keyid, other domain or path, tampered body or digest, unknown agent, tag
swap, each refused with its reason; `/visa` browser check; a fresh review of the TAP code and the card path.

Estimate 8 hours (spec and licence check 1, the card path with TAP and provenance 3, red team and tests 2, docs,
`/visa`, browser check and review 2). Risk: medium, behind its flag; nothing changes for the reserve run.

Max's choices (1 November, late): use Visa's own reference where it can be used (at least the merchant-side
verification and/or the registry), with its licence respected and credited (LICENSE/NOTICE, README); an interop test
in CI both ways (our agent's signatures accepted by Visa's reference verifier, the reference's example signatures
accepted by our merchant) plus the negative cases (replay, expired, wrong tag, other domain) failing in both. If the
reference cannot be taken over (language, licence), say why and test against its vectors or examples; the claim then
reads "implements Visa's TAP specification, verified against Visa's open-source reference". The claim text is chosen
only after the interop test, on what is true. Content-Digest binds the body if TAP or web-bot-auth allows it. The
Packwise checkout is labelled as a merchant we run (simulated). Built Monday after the reserve run.

Found before building (1 November, evening; sources in the research notes, repo state 16d59bd):

- **Licence: Max decides, not Claude.** Visa's reference has no open-source licence. Its LICENSE.md says that using,
  downloading or installing the code means agreeing to the Visa Developer Center Terms of Use and the TAP Product
  Terms. Copying any of it into this repo, or running it in CI, is accepting a contract, so it waits for Max: he reads
  https://developer.visa.com/terms and
  https://developer.visa.com/capabilities/trusted-agent-protocol/product-terms and says yes or no. Until then no code
  of the reference enters this repo or CI, and nothing is attributed as "uses Visa's code".
- **The unmodified reference verifier rejects RFC 9421-correct signatures.** It reads `keyId` (camelCase; the RFC
  spelling `keyid` fails first, open issue #27), accepts only the label `sig2`, rebuilds only `@authority`, `@path`,
  `content-type` and `host` (any other covered component is dropped, so the signature fails), and takes `@path` with
  the query string. An interop test "both ways" against the unmodified reference therefore needs our agent to sign the
  way the reference reads (`sig2`, `@authority` `@path` only, no query string in checkout URLs) and to state the key
  id in the spelling it reads; our merchant accepts both spellings and the RFC one is what we document.
- **Content-Digest is not part of TAP.** The TAP signature covers only `@authority` and `@path`; neither TAP nor the
  reference binds the body. Following the spec (Max's rule) means `sig2` stays exactly as TAP says. Proposal: the body
  is bound by a second signature in the same headers (`sig1`, covering `@method`, `@authority`, `@path` and
  `content-digest` per RFC 9530), checked by our merchant; the reference ignores it. The red-team case "tampered body"
  is then refused by `sig1`, and the claim never says TAP itself binds the body.
- The reference ships no test vectors (open issue #23 asks Visa for them). Without the licence, the interop evidence
  is: TAP's published example headers as test cases, plus a clean-room reading of the reference's verification
  steps (listed above) as negative and positive cases. The claim would then read "implements Visa's TAP agent
  recognition signature as specified", not "verified against Visa's open-source reference".

Max, 2 November: "JA, gebruiken", reading the code's licence as MIT-like, on the condition that Claude reads
LICENSE.md itself and reports first if it differs. It does (read again 2 November, 00:20 UTC):

- The source files carry an MIT-style notice: `cdn-proxy/server.js` opens with "© 2025 Visa. Permission is hereby
  granted, free of charge, … The above copyright notice and this permission notice shall be included …".
- The repository's LICENSE.md still says, in full: "By using, downloading, or installing this code, you agree to the
  terms and conditions contained in the Visa Developer Center Terms of Use (including the related Visa Trusted Agent
  Protocol Product Terms). If you do not agree to such terms, do not download, use or install this code."
- So the two texts differ. Reported to Max before any code is taken over; nothing from the reference is in this repo
  or CI until he answers.

Also found in the same reading of `cdn-proxy/server.js` (for the build once the licence is settled):

- It verifies Ed25519 (registry `public_key` = the raw 32-byte key in base64, `alg="ed25519"`) as well as
  RSA-PSS-SHA256 (PEM). Our agent's Ed25519 keys therefore need no RSA-PSS for the proxy; `merchant-backend` is read
  before deciding whether RSA-PSS is needed there.
- A second signature in the same headers breaks the unmodified proxy: it takes everything after `sig2=(…);` as
  attributes (a later `keyId`, `nonce`, `created` would override sig2's) and uses the whole Signature-Input value as
  `@signature-params`. So the `sig1` body binding proposed above cannot share the headers when the unmodified proxy
  verifies. Options for Max: (a) the body is bound by our merchant's own Content-Digest check outside TAP (stated as
  ours, not TAP's); (b) a patched proxy, labelled as Visa's reference with our changes.
- It stores a nonce before it verifies the signature, so a forged request can use up a real nonce (a denial, not a
  bypass). Ours stores it only after verification; the difference goes in the notes, not into a patch of Visa's code.

Max, 2 November, morning: no yes to terms he has not read; a plain summary first. His preference either way: Visa's
code does not go into our repo; the reference runs unchanged as a separate component, cloned at a fixed commit at
test time, our agent signs and Visa's verifier checks. Body integrity: option (a), labelled "body integrity: our
Content-Digest check on top of TAP". Summary given to Max (TAP Product Terms of 10 October 2025, read in full on
2 November; the Developer Center Terms of Use as read on 1 November; not legal advice):

1. Free: no fee is named. But using or downloading the code is accepting the Developer Center Terms and the TAP
   Product Terms, and Visa can end that licence at any time (§6), after which use must stop.
2. Public repo: the licence is non-transferable and not sublicensable; distribution is allowed only as part of an
   application that implements the specification. Copying Visa's files into our public repo is not clearly allowed;
   cloning them at test time (Max's preference) avoids distributing them, but not the acceptance of the terms.
3. Hackathon or commercial: allowed for "developing, testing … selling or otherwise distributing" applications that
   comply with the specification, on one condition: implementing "the most current version of the Specification in
   its entirety in strict conformance". Purser implements the agent recognition signature only (the reference itself
   implements no more), so whether that counts as "in its entirety" is open.
4. To keep: the copyright and permission notice in any of their files; update at least yearly and within six months
   of a Visa update; tell users and get any consents the law needs.
5. Not allowed: changing their code or the specification beyond implementing or porting it (unpermitted changes
   become Visa's property); the Visa logo or marks without written permission; saying "certified", "endorsed" or
   "Visa-approved"; public statements about the agreement with Visa without its consent.

**Correction (Max, 2 November, evening).** Airwallex changed answer (1) in #help from "Yes" to "TBD" and added Visa
(@srahmatu) to the thread; answer (2) stays "Yes". From now on, everywhere: "Entered for the Visa Award (organisers confirmed one project may enter both Visa and Metal; whether TAP counts as Visa tooling is still being confirmed with Visa)." The technical claim stays as it is
(it is proven): VISA_CLAIM in `src/config/brand.ts`. No page, doc or text says the organisers confirmed TAP counts as
Visa tooling. No further investment in Visa until Visa answers; the Metal Award stays priority 1.

### D26. Proof with the API budget: variation, holdouts, red team (Max, 2 November; starts after the reserve run)

About $280 of Anthropic API credit is left for the product's own Claude calls. Plan for about $250, keeping $30 for
Thursday, the extra run and /try while the jury looks: evals and variation about $80, red team with Opus as the
attacker about $60, soak and dry runs about $50, Claude reviews of documents and claims about $30, /try day budget
during judging about $30. A cost counter per block (from the cost already recorded per call), a warning at 80%, and
spend per block in each evening report. Built: `src/claude/budget.ts` (blocks evals 80, redteam 60, soak 50, reviews 30, try 30; an unknown block is
refused), the spend log `docs/runs/api-budget.jsonl`, and `npm run budget` (`test/api-budget.test.ts`). Per task the cheapest model that passes its eval.

Variation (Max's choices): 40 worlds with simulated rails and 10 live worlds (Metal testnet and the Airwallex sandbox,
random parameters, about 280 *USDZ from recycling and about 2 hours). Simulated-rail worlds run the same code paths
and checks as live; only the Metal and Airwallex calls are replaced by a stand-in built from real responses of earlier
runs. Calibration: 3 seeds run both simulated and live, decisions and outcomes compared (error codes, refusals, fees),
and any difference reported. The report and the site show both counts apart ("40 simulated-rail worlds + 10 live
worlds, 0 unsafe actions"). Holdouts: 10 unseen situations, at least 3 of them live, the clearest, for the "Claude
agents" theme video.

Order after the reserve run: the dry-138 points first (the dispute names only sold orders, Treasury's timing measured
and in the draaiboek, the eval case, a fresh dry run); then the budget counters, variation, holdouts and the red team
at night; QA and enterprise items by day. Nothing here touches Thursday's code after Wednesday 23:00.

Max, 2 November, 10:15 NL:
- **Test worlds (D26):** explicit permission to run dry runs, the soak, the variation test (10 live worlds), the
  holdouts and the calibration in test worlds on Metal testnet and the Airwallex sandbox, including moving test money
  (recycling from finished dry worlds and the faucet). Never live-1, the reserve worktree, the hosted relay or
  Thursday's world; testnet and sandbox only, never real money; every transfer in the recycling log.
- **TAP claim (D25), only after a green interop test AND the live TAP run** (Max, 2 November, replacing the earlier
  text, which said "every card checkout" and "open-source"; neither was true: only the card-only merchant's checkout
  goes through TAP, and Visa's reference has no open-source licence): "Our agents sign their card checkouts at TAP
  merchants with Visa's Trusted Agent Protocol. Their signatures are accepted by Visa's public TAP reference verifier
  (pinned commit 16d59bd). The TAP merchant in this demo is run by us. Body integrity, tag and payment checks are our
  own layer on top." This exact text everywhere: claims.md, /visa, the description, the deck, the video. No "certified", "endorsed" or "Visa-approved", no
  Visa logo. The review's design fixes are approved (checkout under /product/, the merchant re-verifies signature 1,
  the registry on localhost with our pinned keys, duplicate headers refused, signature 2 covers the query, one skew).
