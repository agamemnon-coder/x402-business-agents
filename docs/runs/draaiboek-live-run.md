# Draaiboek live run (de nieuwe hoofdopname)

Eén middag, ongeveer 60 minuten, testgeld (Airwallex-sandbox, Metal testnet). **Max is de CFO** (iPhone, Face ID).
De **controller** is een tweede persoon met een eigen apparaat en een eigen passkey: vier ogen betekent twee
verschillende mensen. Claude typt de commando's en keurt nooit iets goed. Max neemt het iPhone-scherm op.

## Vooraf (Claude, zonder Max)

- Een verse wereld met eigen sleutels: `KIT11_DB=data/live-1.sqlite`, `KIT11_KEYS_DIR=…-keys/live-1`. Niets uit eerdere
  werelden wordt hergebruikt.
- `npm run health` is groen: Airwallex, Metal en Claude antwoorden.
- De proefrun (dry run) liet elke stap werken, ook met twee passkeys, een verlopen quote, een mis-tik, netwerk weg,
  Face ID mislukt en een herstart van de runner. Verslagen: `docs/runs/2026-10-31-dry-run.md` en
  `docs/runs/2026-10-31-dry-run-2.md`.

## Begin (Max en de controller, 5 minuten)

1. Max opent de enrol-link in een privé-Safari-tab en zet zijn passkey met Face ID. In de chat zegt hij:
   "Bevestig passkey &lt;vingerafdruk&gt;".
2. De controller doet hetzelfde op het eigen apparaat (`npm run passkey -- add controller`).
   Wacht na het tonen van de code ongeveer 10 seconden voordat je hem typt: de runner moet het enrol-venster eerst
   naar de relay brengen.
3. Claude stelt vier ogen boven €1.000 voor (een beleidswijziging, P-0001). **Max keurt die goed met Face ID.** Pas
   daarna staat vier ogen aan: elke mandaatwijziging, elke bankwijziging en elke betaling boven €1.000 heeft dan beide
   passkeys nodig. Claude controleert met `npm run policy` dat `approval.four_eyes_eur` op 1000.00 staat, en begint
   pas dan aan stap 1. (De proefrun dry-6 vond dit: zonder die Face ID werd de mandaatwijziging na één passkey al
   goedgekeurd.)

## De run, in de volgorde van Kit 11

| # | Wat gebeurt er | Wie keurt goed | Wat Max ziet |
|---|---|---|---|
| 1 | De Sourcing agent verkoopt live voorraaddata per vraag voor 0,05. Hij koopt die bij Stockline voor 0,02. | niemand (binnen de limiet) | Verkopen lopen op; per betaling staat een Metal-bewijs. |
| 2 | Stockline verhoogt de prijs naar 0,04. | — | Een melding van de prijsstijging. |
| 3 | De aankoop botst op het mandaat (max 0,03): Metal weigert hem tegen het mandaat op de chain. | — | `mandate_cap_exceeded`; er is niets bewogen. |
| 4 | De Treasury agent stelt twee opties voor binnen de 20,00: A verkopen voor 0,05 (marge 0,01) en B voor 0,07 (marge 0,03). Opus geeft advies. | — | Twee opties op de telefoon, met het advies van Opus. |
| 5 | Vier ogen op de chain: een 2-van-2-rekening (CFO + controller) in dezelfde wereld. Eén handtekening wordt geweigerd, twee gaan door. | — (Claude draait `npm run four-eyes`) | De geweigerde en de geslaagde transactie in de explorer. |
| 6 | De nieuwe mandaten: 12 / 4 / 4, max 0,04 per aankoop. | **Max + controller** | "1 van 2" na Max, daarna "goedgekeurd"; de mandaten zijn vervangen op de chain. |
| 7 | Een dispute van Summit over 12 getekende orders. De Support agent betaalt alleen de 3 orders met foute voorraaddata terug (0,15, binnen zijn eigen limiet). De rest vraagt om een besluit. | niemand voor de 3; Max beslist over "alles terug" (advies Opus: weigeren) | De order-voor-order-controle; terugbetalingen alleen voor foute regels. |
| 8 | Een sweep van de opbrengst, pas na finality, naar de sweep-wallet. Die neemt alleen geld aan van de bedrijfsrekening (receive policy). | — | Het sweep-bewijs en de boeking bij Airwallex. |
| 9 | De euro-factuur van Bergtex van **€1.850,00** (boven €1.000): alleen het tekort wordt omgewisseld (USD → EUR 370,00). Een valse factuur en een verstopte opdracht worden tegengehouden. | **Max + controller** | Twee keer Face ID; de nepfactuur komt niet bij jou. |
| 10 | De maandelijkse licentie van **EUR 240,00** voor Stockline. De euro's zijn op na Bergtex, dus Airwallex FX (USD → EUR) en daarna SWIFT. | **Max** | Het bedrag, de koers, de begunstigde en de hash; daarna PAID. |
| 11 | Kaarten: €19,99 goed, €45,00 geweigerd door Airwallex (`LIMIT_EXCEEDED`). Na een verhoging van €30 naar €50 gaat €45,00 wel door. €19,99 op de Support-kaart bij de verkeerde winkel wordt geweigerd. | **Max** (verhoging) | De weigering, de vraag om meer, Face ID, daarna goedgekeurd. |
| 12 | Noodknop aan, een kaartbetaling wordt geweigerd, noodknop uit. | **Max** (aan en uit) | Alle kaarten op inactief, daarna weer actief. |
| 13 | Een bankwijziging voor Bergtex in drie stappen: verzoek, terugbellen, voorstel. | **Max + controller** | Het oude en het nieuwe IBAN naast elkaar. |
| 14 | Agentherkenning (Visa TAP-profiel, dev test): eerst herkennen, daarna betaalt de agent zelf met zijn kaart. | — | €19,99 goed, 7 pogingen geweigerd, €45,00 geweigerd door Airwallex. |

## Echte tijden (proefrun dry-12, 31 oktober, alles automatisch met twee virtuele passkeys)

| Stap | Tijd |
|---|---|
| Gezondheid en runner | 6 s |
| Twee passkeys inschrijven + vier ogen aan (P-0001) | 37 s |
| Start van de wereld (rekeningen, mandaten) | 38 s |
| 1 Verkopen 1–40 | 2 min 16 s |
| 2–4 Prijsstijging, weigering, opties met advies van Opus | 33 s |
| 5 Vier ogen op de chain (2-van-2) | 54 s |
| 6 Mandaten vervangen (optie B, beide passkeys) + verkopen 41–50 | 56 s |
| 7 Dispute, "refund all 12" afwijzen | 1 min 10 s |
| 8 Receive policy en sweep | 10 s |
| 9 Bergtex €1.850 voorstellen en betalen (beide passkeys) | 41 s |
| 10 Licentie €240 (FX + SWIFT), met een herstart van de runner | 49 s |
| 11 Kaarten €19,99 / €45 / verhoging €30 → €50 | 37 s |
| 12 Noodknop aan en uit | 47 s |
| 13 Bankwijziging Bergtex (beide passkeys) | 17 s |
| 14 Agentherkenning (dev test) | 10 s |
| Controle (verify) | 1 min 55 s |
| **Totaal zonder wachten** | **ongeveer 13 minuten** |

De proefrun wachtte ook 11 minuten tot een voorstel verliep; dat doen we in de live run niet. Met mensen erbij komen er
ongeveer 15 Face ID-momenten bij (elk 30–60 seconden lezen en tikken) en uitleg. **Verwachte duur live: 45 tot 60
minuten.** Plan een uur.

## Met de Claude-agents aan (de run van donderdag, `KIT11_AGENTS=on`)

Alles hierboven blijft gelijk: dezelfde stappen, dezelfde goedkeuringen, dezelfde Face ID-momenten. Wat verandert:

- **Stap 2–3:** de Sourcing agent (Haiku) probeert zelf de aankoop, ziet de weigering van Metal en schrijft de Treasury
  agent wat hij nodig heeft. Dat bericht staat in de log en op het dashboard.
- **Stap 4:** de Treasury agent (Opus) ontwerpt zelf de herverdeling en de opties, met zijn advies. Code keurt het plan
  goed of stuurt het terug; de bedragen kunnen dus anders zijn dan 12 / 4 / 4 en 0,07 (bijvoorbeeld 14 / 2 / 4). Max
  kiest nog steeds optie B als die de hoogste marge geeft; anders zegt Claude vooraf welke letter.
- **Stap 7:** de Support agent (Sonnet) controleert zelf de orders, refundt zelf alleen de foute (#7, #10, #13) en stuurt
  de rest met zijn advies naar Max. Max wijst "alles terug" af, zoals gepland.
- Proefrun met de agents aan: dry-15, 0 fouten, eindcontrole groen (zie `docs/agents.md`).

## Daarna (Claude, automatisch)

1. Vijf minuten wachten zodat de finality certificates er zijn. Dan `npm run verify`, `npm run audit:export` en
   `npm run demo:record`. Die laatste markeert de opname als Kit 11, waardoor de banner verdwijnt.
2. Uit deze run opnieuw opbouwen: landing, dashboard, /metal, /live, film, Disputes, Books, het deck, claims, de matrix
   en het script. Het oude record blijft alleen als archief.
3. Het runverslag `docs/runs/<datum>-live-1.md`, en dan publiceren.

## Eerlijk erbij zeggen

- De 2-van-2-rekening in stap 5 is een aparte rekening in dezelfde wereld. De eigen rekening van Northwind heeft één
  eigenaar op de chain; daarom vragen we op Purser-niveau beide passkeys voor de mandaatwijziging in stap 6.
- De agentherkenning in stap 13 is een dev test: met onze eigen sleutels, niet goedgekeurd door Visa.
- Summits klant-agent is gesimuleerd. Alle andere geldstromen gaan live, met testgeld.
