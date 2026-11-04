# Spiekbrief Max (CFO): reserve-run, datum: ________________

**Start 10:00 (zondag 1 of maandag 2 november: Max bevestigt), klaar rond 11:00.** Agents uit. Testgeld: Airwallex-sandbox en Metal testnet. Claude typt alle
commando's en keurt nooit iets goed. Jij leest en tikt. Claude geeft één stap per regel. Zeg "ok" als je klaar
bent. Twijfel je? Zeg "stop". Er gaat dan niets weg.

## Vooraf (om 9:45)

- iPhone boven 80 %, iOS bijgewerkt. Face ID en de iCloud-sleutelhanger staan aan. Niet storen staat aan.
- Zet de schermopname in het Bedieningspaneel. Start de opname vóór stap 1 en stop pas aan het eind.
- Laptop met deze chat open. Je vader zit naast je met zijn eigen iPhone en zijn eigen Apple ID.
- Claude stuurt de links bij de start als **bestand**. Stuur alleen link 1 naar je vader, via AirDrop. Nergens anders heen.

## Begin (5 minuten)

1. Open link 1 in een **privé Safari-tab**. Laat dat tabblad open tot het einde.
2. Open de enrol-pagina (link 2). Claude geeft een code. **Wacht 10 seconden** en typ hem dan. Face ID.
3. Je scherm toont een vingerafdruk. Stuur in de chat: **"Bevestig passkey XXXX-XXXX-XXXX-XXXX"**.
4. Je vader doet stap 1–3 op zijn iPhone. Lees zijn vingerafdruk van zijn scherm en stuur ook voor hem
   "Bevestig passkey …".
5. **Vier ogen eerst aanzetten met Face ID.** Open P-0001 ("four eyes above EUR 1,000") → tik de kaart → Confirm with Face ID.
   Claude controleert dat het aan staat. Pas dan begint stap 1 van de run.

## Jouw Face ID-momenten

| Stap | Wat je ziet | Wat jij doet | Daarna |
|---|---|---|---|
| Begin | Vier ogen boven €1.000 | Tik de kaart → Confirm with Face ID | — |
| 6 | Twee opties voor de mandaten | **Optie B (0,07)** → Confirm with Face ID | Je ziet "1 of 2 approvals". Dan je vader. |
| 7 | Summit: "refund all 12" (Opus adviseert afwijzen) | **Reject** → **Reject with Face ID** | — |
| 9 | Factuur Bergtex **€1.850,00** | Tik de kaart → Confirm with Face ID | "1 of 2". Dan je vader. |
| 10 | Licentie Stockline **EUR 240,00** (koers, begunstigde) | Tik de kaart → Confirm with Face ID | — |
| 11 | Kaartlimiet van €30 naar **€50** | Tik de kaart → Confirm with Face ID | — |
| 12a | Noodknop | Rode knop **Emergency stop** → Continue to Face ID → de knop eronder → Confirm with Face ID | Alle kaarten op inactief. |
| 12b | Noodknop uit | Tik de kaart → Confirm with Face ID | Kaarten weer actief. |
| 13 | Bankwijziging Bergtex: oud en nieuw IBAN | Tik de kaart → Confirm with Face ID | "1 of 2". Dan je vader. |

**Elke keer:** het bedrag, de ontvanger en het begin van de hash moeten gelijk zijn aan wat Claude in de chat noemt.
Klopt iets niet? Niet tikken. Zeg "stop".

## Zeg dit zo (Metal-QA, 1 november)

- Bij stap 3 (prijs 0,04): **"Purser weigert de aankoop vóór het tekenen, tegen de cap van het mandaat."** Zeg niet
  "Metal weigert hem op de chain": in deze run komt de betaling niet bij Metal.

## Als iets misgaat

- **"is not waiting for approval" of een leeg scherm:** de pagina probeert het 90 seconden zelf opnieuw. Wacht, en
  ververs pas daarna.
- **Verkeerde optie getikt:** tik **Back**. Er is niets ondertekend.
- **Face ID mislukt:** tik opnieuw op **Confirm with Face ID**. Er is niets gebeurd.
- **Tabblad per ongeluk dicht:** open link 1 opnieuw uit het bestand.
- **Geen netwerk:** je handtekening wacht tot 30 minuten op de relay. Zeg het tegen Claude.
- **Iets onduidelijk, of anders dan in Safari verwacht:** zeg het meteen ("dit snap ik niet"). Claude schrijft het op en
  lost het vóór donderdag op.

## Na afloop

- Stop de schermopname en stuur hem naar Claude.
- Claude controleert alles (verify, reconcile, data-QA) en schrijft het runverslag
  `docs/runs/<datum>-reserve-run.md`.
