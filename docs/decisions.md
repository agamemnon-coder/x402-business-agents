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
  | `support` | Marketing agent | Its card pays for ads. It also owns the retailers' accounts, so it settles a retailer's claim (refunds on Metal). |
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
| Marketing agent's card | Tailspin Helpdesk | Adwave (ads) |
| Finance agent's card | Contoso Books | Ledgerly (bookkeeping) |

- **Why:** a juror from Airwallex should recognise the business at once: a brand that buys stock data, pays ads
  and a manufacturer abroad, and sells to retailers.
- **If wrong:** the names are fictional and sit in config and fixtures. The tests pin the stories, not the names.

### D4. The recorded demo stays rehearsal 3 until Friday's runs

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
