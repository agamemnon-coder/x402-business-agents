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
