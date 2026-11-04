# Eisen-audit, 2 november 2026 (frisse Opus-reviewer, zonder onze claims)

Bronnen: de Kit 11-brief (airwallexdev.com/agentic-banking-builder-guide.md, kit 11, zin voor zin), de prijsteksten en
inlevereisen (airwallex.hackerearth.com; de jurycriteria alleen via docs/rules.md, niet op de site), het oorspronkelijke
idee (docs/idea-vs-build.md). Bewijs alleen uit runs van 26 oktober tot 2 november. De reviewer las onze claims pas na
zijn oordeel. Kolom "Hoofdrun": kan de fix in de hoofdrun (één wereld).

| # | Eis (geciteerd) | Oordeel en bewijs | Fix | Hoofdrun | Stand na Max' keuzes |
|---|---|---|---|---|---|
| 1 | "Customers' agents buy market data from you per query… signing each order they pay for" | ✅ agent-1: 63 sales, alle 63 met `signed_offer`, `tx_hash`, `body_json` (sale #5 tx 0xc2e8ec36…1540) | — | — | — |
| 2 | "Three agents… each under its own mandate, limits your account enforces on chain" | ✅ `mandate.bound` audit rows 2–4 (tx 0x725f7174…, 0xfd869974…4c61, 0xe395bf63…43e7) | — | — | — |
| 3 | "sourcing… 10 *USDZ in all, at most 3 cents… support 4… treasury 6" | ✅ 10.00/0.03, 4.00, 6.00; budgets 20.00 van 20.00 | — | — | — |
| 4 | "A query sells for 5 cents and its upstream data costs 2 cents" | ✅ (oordeel 2 nov: 44 van de 63 verkopen uit de cache (tot 300 s oud); #18–#32 uit één inkoop) | Cache uit in de hoofdwereld | ja | **Max: cache uit** (agent E) — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #4: 55 queries, 55 upstream-aankopen (41 betaald, 14 geweigerd), 0 uit de cache) |
| 5 | "the upstream price rises to 4 cents… its next purchase is refused" | ✅ (oordeel 2 nov: Purser weigerde vóór het tekenen (row 80); de on-chain weigering (tx 0x3ad8de2f…a84d) kwam van een aparte record-refusal-pull) | Tekst eerlijk | ja | **Max: één aankoop bewust langs de pre-check naar Metal, dat zelf weigert** (achter een vlag, met tests; anders blijft de eerlijke tekst) — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #5: aankoop #24 bewust naar Metal (`upstream.let_through`, seq 114); Metal weigerde zelf (402 `mandate_cap_exceeded`), on chain tx 0x2e92f9cb…1871 (seq 119), label "Defense in depth…" (seq 121); niets afgerekend) |
| 6 | "answer the customer with an error status: the middleware then doesn't settle" | ✅ (oordeel 2 nov: status per query staat niet in de ledger (alleen afgeleid: 70 queries, 63 sales)) | Status + "settled" per query in de ledger | ja | in aanbouw (agent E) — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #6: 14 queries 503 met `settled: false` (`sale.refused`, `query.answered` per query)) |
| 7 | "treasury agent proposes new limits within the 20, with or without a higher query price" | ✅ P-0002 (0.05) en P-0003 (0.06), elk 20.00 | — | — | — |
| 8 | "you approve them by replacing the mandates"; "A replacement carries what the agent spent" | ✅ replace-txs 0x563d4fff…b152 en 0x0e7f9d0a…ba2d8e; Sourcing 0.34 uitgegeven tegen nieuw budget 12; oude credential geweigerd (row 201) | — | — | — |
| 9 | Vier ogen | ✅ (oordeel 2 nov: de tweede handtekening is een test-passkey die de sessie bedient, geen tweede persoon) | Tekst eerlijk of tweede mens | ja | **Max: test-passkey, tekst eerlijk** — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #9: P-0002 1 van 2 (Max, seq 197) en 2 van 2 (test-controller, seq 201) over dezelfde terms bf7ec3a0…; label op het dashboard) |
| 10 | "The signed orders show its agent did place them" | ✅ D-2f8a03a4: 12 van 12 met `signed_order`, `within_mandate`, mandaat-tx 0xa3481923…6263 | — | — | — |
| 11 | "Where… the data you sold was wrong, the support agent refunds… from its budget" | ✅ refund #7, #10, #13 (0.15 uit Support's budget); de andere 9 → P-0004, door Max afgewezen | — | — | — |
| 12 | "Keep prices, budgets and the licence fee in code, and let the model weigh the rest" | ✅ `src/config/policy.ts`, `src/policy/holds.ts`; besluiten als `agent.decision` | — | — | — |
| 13 | "Keep owner keys away from agents" | ✅ `test/no-owner-key.test.ts`; replaces getekend door `owner-signer` | — | — | — |
| 14 | "Keep each one from `signedOfferOf` with its transaction hash and what you delivered" | ✅ `src/servers/seller.ts` 63–92; 63 van 63 compleet | — | — | — |
| 15 | "A timeout is unconfirmed… rerun the same pull… look it up in /settlements" | 🟠 in code (`src/metal/pay.ts` 103–119) en refunds veilig herhaald; geen echte in-doubt deze week | Een test is het praktische bewijs | nee | test bestaat; geen actie in de run |
| 16 | "Send earnings to a Metal address you hold, mark the hash credited… deposit… with the hash as its reference" | ✅ sweep 1.97, tx 0x659c5ac2…e2b2 na finality; deposit e80c3809 met de hash als referentie | — | — | — |
| 17 | "treasury agent… pays a monthly licence fee invoiced in euros" | ✅ (oordeel 2 nov: Treasury's eigen plan P-0005 geweigerd (fee_unknown), P-0006 verlopen; P-0007 PAID kwam van `npm run licence` (CFO)) | Treasury plant zelf en haalt PAID | ja | in aanbouw (agent D, treasury-paid) — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #17: P-0005 `created_by` treasury (Opus), Face ID (seq 360), transfer 03360bfa-afce-457b-89d1-e1097fbe3985 PAID, fee EUR 13.42 (plafond 20.00), geen `fee_unknown`) |
| 18 | "the FX, beneficiary and transfer calls of kit 1" | ✅ (oordeel 2 nov: geen FX in agent-1 (wel 30 okt EUR 370.00, 1 nov EUR 253.48)) | Minder vrije EUR → Treasury wisselt het tekort | ja | in aanbouw (agent E) — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #18/25: FX EUR 110.00 voor USD 124.29 (conversie 3ca88196…, seq 362) vóór `transfer.created` (seq 363), binnen de vloeren) |
| 19 | Metal Award: "Requires use of Metal and Airwallex tooling" | ✅ Metal-mandaten + Airwallex deposit en transfer in agent-1 | — | — | — |
| 20 | Visa Award: "Requires use of Visa and Airwallex tooling" | ✅ (oordeel 2 nov: TAP-run was een aparte wereld (kaart 0854), eigen registry en merchant; geschiktheid officieel TBD) | TAP-aankoop op een kaart van de hoofdwereld | ja | in aanbouw (agent E); verder geen Visa-investering — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #20: `tap.checkout_verified` (seq 401, sig1 en sig2 verified) op kaart ····1423 van deze wereld; Airwallex keurde 01a1a12f… goed, EUR 45.00. Geschiktheid voor de Visa Award blijft TBD) |
| 21 | "a short video walkthrough under five minutes" | 🟠 `out/video/master.mp4` 2:53, zonder stem, uit de run van 30 okt; nog geen link | Video uit de hoofdrun, met Max' opening en slot | na de run | **na de hoofdrun** |
| 22 | "a link to your repository with setup instructions" | 🟠 README heeft `npm ci && npm run judge` en CI; publiek of jurytoegang nog niet geregeld | Repo publiek of privé met jurytoegang; schone clone testen | na de run | **inleverpakket** |
| 23 | Jurycriteria (rules.md): end-to-end flow; Airwallex nodig; context verandert het besluit; controls | ✅ optie B gekozen, Sourcing naar cache-only, P-0004 afgewezen, P-0007 PAID | — | — | criteria zelf niet op de site te verifiëren |
| 24 | Idee: "approver sees exact terms and SHA-256; replace only if the hash matches" | ✅ `terms_sha256` 487a52e8… op co-sign en goedkeuring | — | — | — |
| 25 | Idee: "EUR licence by SWIFT… or FX for the shortfall on a fresh quote that includes the fee" | ✅ (oordeel 2 nov: SWIFT betaald (fee 13.37 onder plafond 20.00); FX-tak niet in agent-1) | zie #18 | ja | in aanbouw (agent E) — **✅ hoofdrun 3 nov** (`docs/runs/2026-11-03-main-run.md`, acceptatie #18/25: SWIFT PAID (fee 13.42 onder plafond 20.00) na FX voor alleen het tekort (EUR 110.00)) |

Totaal (2 november): ✅ 14 · 🟠 11 · ❌ 0. Na de hoofdrun (3 november): ✅ 22 · 🟠 3 · ❌ 0; #4, #5, #6, #9, #17, #18, #20 en #25 ✅ met bewijs uit `docs/runs/2026-11-03-main-run.md`.

## Grootste risico's voor de hoofdrun (reviewer)

1. De licentie: Treasury plande hem niet zelf opnieuw; `fee_unknown` kan terugkomen (retry en 20-minutenvenster zijn er nu).
2. Wie besliste bij de betaalde licentie stond fout (nu gelabeld: "payment started by the CFO (npm run licence)"; herkomst op het voorstel komt met treasury-paid).
3. De cache kan het prijsmoment verbergen (opgelost met cache uit).
4. Agents lezen feiten verkeerd: Stockline "unreachable", Treasury koos het offline Ridgeline, Treasury noemde de licentie onbetaald na betaling (fix op treasury-paid).
5. Processen: een stopcommando liet een runner van een andere wereld draaien; na een herstart werd het geschil twee keer afgehandeld (de refund-idempotentie voorkwam dubbel terugbetalen).
6. De tweede tekenaar wordt door de sessie bediend (tekst eerlijk).
7. Safari-privétabbladen, de faucet, en 6 minuten tussen prijsstijging en replace.

## Na de hoofdrun niet vergeten

- #21 de video (< 5 min, met stem, uit de hoofdrun, Max' opening en slot) en de link erheen.
- #22 de repo publiek of privé met jurytoegang; testen op een schone clone; de instructies.
- #23 de jurycriteria staan niet op de officiële site: bij de organisatie navragen of in de beschrijving niet meer
  beweren dan rules.md zegt.
