# Purser uitgelegd, voor Max

Kort en simpel. Lees dit voor Demo Day en voor elk gesprek met de jury. Alle cijfers komen uit de opgenomen
run (vrijdag-run 1, 30 oktober) of uit een losse live test; waar het staat, zie [claims.md](../claims.md).

## 1. Purser in 30 seconden

> AI-agents gaan geld uitgeven voor bedrijven. Purser geeft elke agent een eigen Airwallex-bedrijfskaart en een
> mandaat op Metal. De CFO zet de limieten. Binnen de limiet betaalt de agent zelf. Daarbuiten stopt de agent en
> vraagt het; de CFO keurt goed op de telefoon met Face ID. Elke betaling heeft een bewijs.

Eén zin: **"Your AI agents spend through Airwallex and Metal. The CFO stays in control."**

**Met de agents aan (donderdag), om uit je hoofd te kennen (30 seconden):**

> "Drie Claude-agents runnen het bedrijf: Sourcing koopt de data in, Support handelt geschillen af, Treasury herverdeelt
> het budget. Ze beslissen zelf, met echte tools. Maar ze kunnen niet meer uitgeven dan mag: Metal weigert elke betaling
> boven hun mandaat, Airwallex weigert elke kaartbetaling boven hun limiet. Alles daarbuiten (een groter budget, een
> grote factuur, een nieuw bankrekeningnummer) gaat naar mij, en ik keur het goed met Face ID. Elke beslissing van een
> agent kun je stap voor stap terugzien, met het bewijs op de chain."

## 2. Hoe het werkt, in 5 stappen

1. **De CFO zet de regels.** In gewone woorden. Claude Opus maakt er een voorstel van; code houdt alleen regels die
   echt in de woorden van de CFO staan. De CFO keurt het voorstel goed met Face ID.
2. **Elke agent krijgt een kaart en een mandaat.** Een virtuele Visa-kaart van Airwallex (limiet, soort winkel,
   alleen EUR, einddatum) en een mandaat op Metal (max per betaling, budget, één ontvanger, einddatum).
3. **Binnen de limiet betaalt de agent zelf.** Geen mens nodig. In de opgenomen run: 106 betalingen zo (ongeveer de helft door de gesimuleerde klant-agent).
4. **Daarbuiten weigert iemand.** Airwallex weigert de kaart, Metal weigert tegen het mandaat op de chain, of Purser stopt het
   (fraude, dubbele factuur). Daarna vraagt de agent de CFO.
5. **De CFO beslist met Face ID.** Op de telefoon, met een passkey. Geen wachtwoord. Een agent kan nooit zelf
   goedkeuren.

## 3. Kit 11: wie is wie

| Agent (Kit 11-naam) | Taak | Budget bij start → na Face ID |
|---|---|---|
| Sourcing agent | koopt upstream data per vraag; kaart voor warehouse- en datasoftware | 10.00 → 12.00 (max 3 → 4 cent per aankoop) |
| Support agent | terugbetalingen bij disputes; kaart voor helpdesksoftware | 4.00 → 4.00 |
| Treasury agent | bewaakt uitgaven, veegt winst naar Airwallex, betaalt de maandelijkse licentie in euro (FX + SWIFT, Face ID) | 6.00 → 4.00 |

Samen altijd 20.00 test-USD. Dat staat vast in de code.

## 4. Wat is echt, wat niet (zeg dit altijd eerlijk)

**Echt, live gedraaid (testgeld):**
- Airwallex sandbox: kaarten, geweigerde betalingen, FX, SWIFT-betaling van €1.850,00, Global Accounts, webhooks.
- Metal testnet: mandaten, x402-betalingen, clearing, receive policy, four eyes (2-van-2), compliance-contract.
- Elke goedkeuring in de opgenomen run: jouw Face ID. De losse four-eyes- en compliance-runs gebruikten testsleutels.

**Gesimuleerd of nog niet live (zeg het erbij):**
- De klant-agent van Summit is gesimuleerd (ongeveer de helft van de 106 betalingen).
- De red team draaide tegen nep-versies van Airwallex en Metal, in een wegwerpwereld.
- Visa-agentherkenning (`/visa`): dev test, onze eigen sleutels en register, geen echte Visa-agents.
- T:0: gebouwd en getest tegen een nep-T:0; nog geen sleutel, dus nog niet live geboekt.
- De licentie van €240,00: in de code en getest, nog niet betaald in een live run met jou.
- Finality certificates: we checken de kop en het quorum, niet de BLS-handtekening (Metal publiceert de sleutels niet).
- ISO 20022: geldig bericht, maar naar geen enkele bank gestuurd.

## 5. De 50 juryvragen

### Product (1–8)

1. **Wat is Purser?** Een controlelaag voor AI-agents die geld uitgeven. Elke agent een eigen kaart en mandaat; de CFO zet de limieten en keurt de rest goed met Face ID.
2. **Voor wie?** De CFO of controller van een klein bedrijf dat over grenzen werkt, Airwallex gebruikt en AI-agents laat werken.
3. **Welk probleem los je op?** Agents kunnen betalen, maar een bedrijf durft ze geen geld te geven. Purser maakt het veilig: harde limieten, en een mens voor alles daarbuiten.
4. **Waarom niet gewoon één bedrijfskaart voor alle agents?** Dan weet je niet wie wat deed, en één fout raakt alles. Met een kaart per agent zie je per agent wat er gebeurt, en kun je er één bevriezen.
5. **Wat ziet de CFO?** Een dashboard: elke betaling met bewijs, wat gestopt is en waarom, de boeken, en een telefoonscherm om goed te keuren.
6. **Hoeveel ging er in de opgenomen run vanzelf?** 106 betalingen binnen de limieten, zonder mens op dat moment (ongeveer de helft door de gesimuleerde klant-agent). 8 keer gestopt. €3.719,99 bleef buiten de deur.
7. **Hoe vaak moest de CFO iets doen?** 4 keer Face ID in de opgenomen run.
8. **Kan ik het zelf proberen?** Ja: `/try` online, of `npm ci && npm run judge` zonder sleutels en zonder internet.

### Airwallex (9–15)

9. **Welke Airwallex-producten gebruik je?** Issuing (kaarten), FX (omwisselen), Payouts (SWIFT), Global Accounts (geld ontvangen) en webhooks.
10. **Wie weigert een kaartbetaling boven de limiet?** Airwallex zelf. €45,00 boven de limiet: `LIMIT_EXCEEDED`. Na Face ID ging dezelfde €45,00 wel door.
11. **Wat als een agent bij de verkeerde soort winkel koopt?** Airwallex weigert: de kaart staat alleen bepaalde soorten winkels toe.
12. **Hoe werkt de euro-betaling?** De factuur van €1.850,00 aan Bergtex. Purser wisselt alleen het tekort om (€370,00), checkt de koers tegen de markt, en betaalt via SWIFT na Face ID.
13. **Hoe voorkom je dat een factuur twee keer betaald wordt?** Factuurnummers worden genormaliseerd en één keer opgeslagen. De tweede keer: geen voorstel, de CFO krijgt een melding.
14. **Wat doen de webhooks?** Elke gebeurtenis van Airwallex wordt één keer opgeslagen en vergeleken met onze boeken. Klopt het niet, dan gaat er een alarm af. 23 soorten zijn live geabonneerd.
15. **Waarom hebben Airwallex-klanten dit nodig?** Ze hebben al kaarten en betalingen. Purser laat ze die veilig aan AI-agents geven, met limieten en een mens voor de rest.

### Metal (16–23)

16. **Wat is een mandaat?** Een regel op de chain: max per betaling, totaal budget, één ontvanger, einddatum. De agent kan niet meer dan dat.
17. **Wie mag een mandaat veranderen?** Pas na Face ID van de CFO zet Purser het nieuwe mandaat op de chain. De agent kan het niet.
18. **Wat gebeurde er bij de prijsverhoging?** De leverancier ging van 0.02 naar 0.04. De betaling liep tegen het mandaat aan: `mandate_cap_exceeded`, niets bewogen. Daarna keurde de CFO nieuwe limieten goed.
19. **Wat is x402?** Betalen per verzoek via internet (HTTP 402). Een agent koopt data per vraag en betaalt meteen.
20. **Wat is clearing?** Veel kleine betalingen samen afgerekend. Belastingtest (aparte testwereld, 30 oktober): 2.000 van 2.000 betaald in 471,8 seconden, 4,24 per seconde.
21. **Wat is four eyes op de chain?** Een account met twee eigenaren: CFO en controller. Alleen de CFO: geweigerd op de chain. Beiden: gaat door. Dit draaide live in een aparte testwereld.
22. **Wat is de receive policy?** Geld dat binnenkomt op de wallet wordt gecontroleerd; van een onbekende afzender gaat het in quarantaine. (Dat liep in een aparte wereld, niet in de opgenomen run.)
23. **Wat doet het compliance-contract?** Geld gaat pas weg met Pursers getekende beslissing voor precies die betaling, na controle van de ontvanger. 11 aanvallen werden op de chain geweigerd. Mandaatbetalingen gaan er niet doorheen (zo werkt Metal).

### Veiligheid (24–30)

24. **Kan een agent zelf goedkeuren?** Nee. Goedkeuren kan alleen met de passkey van de CFO (Face ID). Geen enkele agent-tool kan het.
25. **Wat als iemand de AI probeert te misleiden in een factuur?** Claude leest alleen; de code beslist. De verborgen opdracht wordt gemarkeerd en de echte bedragen van de factuur worden gebruikt.
26. **Wat als de bankgegevens van een leverancier veranderen?** Purser stopt het als mogelijke fraude. Een mens moet het eerst checken.
27. **Hoe weet je dat het logboek niet aangepast is?** Elke regel is gekoppeld aan de vorige met een hash. `npm run verify-log` rekent het na: 194 regels, keten intact.
28. **Wat deed de red team?** 39 aanvallen, alle 39 mislukt. 37 gestopt vooraf, 2 achteraf gevonden (niet voorkomen). In een wegwerpwereld tegen nep-versies.
29. **Waar staan de sleutels?** Nu in bestanden op de runner, nooit in git of logs. Voor productie: een KMS. Dat staat in de roadmap.
30. **Is er een noodstop?** Ja. Eén knop bevriest alles; daarvoor is Face ID nodig. De volledige noodstop is nog niet live getest.

### Claude en AI (31–35)

31. **Waarvoor gebruik je Claude?** Haiku sorteert documenten, Sonnet leest ze, Opus beoordeelt risico's voor de CFO. Claude heeft geen sleutel en keurt niets goed.
32. **Waarom drie modellen?** Het was een ontwerpkeuze; daarna hebben we het gemeten. Op de gewone testgevallen doet Haiku alleen het even goed. Op moeilijkere documenten las Haiku één geschil fout (het nam een order mee die de klant zelf had besteld). De verdeling Haiku sorteert, Sonnet leest, Opus adviseert haalde 15 van 15, en is de goedkoopste die dat haalt.
33. **Wat kost de AI?** In de opgenomen run: 23 calls, USD 0,093 per €1.000 betaald.
34. **Wat als Claude uitvalt?** Dan nemen vaste parsers het over. Dezelfde beslissingen, want de code beslist.
35. **Hoe heb je dit gebouwd?** Met Claude Code als ontwikkelaar. Ik deed het product, de beslissingen en elke Face ID.

### Business (36–40)

36. **Hoe verdien je geld?** Een maandbedrag per bedrijf en per actieve agent. Geen percentage van betalingen.
37. **Waarom nu?** Mastercard Agent Pay (april 2025), Visa Intelligent Commerce en Google AP2 (september 2025): agents gaan betalen. McKinsey schat $3–5 biljoen agent-handel in 2030.
38. **Wie zijn je eerste klanten?** Kleine bedrijven die over grenzen handelen, op Airwallex zitten en AI-agents gebruiken.
39. **Wat is nodig voor productie?** Sleutels in een KMS, Postgres met herstel, een pager op `/health/live`, en meer bedrijven per installatie. Daarna Metal mainnet.
40. **Wat is het moeilijkste geweest?** Dat elke claim klopt. Elke betaling heeft een bewijs, en alles wat gesimuleerd is staat erbij.

### De Claude-agents (41–50)

41. **Wat als Claude zich vergist?** Dan houdt code of de rail het tegen. Echt voorbeeld: een agent liet zich door een
    klant-mail verleiden om ook orders buiten het geschil mee te nemen; code weigerde dat, er ging niets weg
    ([agent-was-wrong.md](../agent-was-wrong.md)). De agent kan geen ontvanger kiezen en niet boven zijn mandaat betalen.
42. **Waarom niet volledig autonoom?** Binnen de limieten wél: de agents betalen en beslissen zelf. Een groter budget, een
    grote factuur of een nieuw rekeningnummer kan geld kwijtraken dat niet terugkomt; daar wil een CFO zelf ja zeggen.
43. **Wat kost een beslissing?** Gemeten in vier dry runs: Sourcing $0,0007, Treasury ongeveer $0,026, Support ongeveer
    $0,046 per beslissing. Per vraag van een klant samen ongeveer een halve cent; de marge blijft 1,9 cent per vraag
    ([unit-economics.md](../unit-economics.md)).
44. **Kan een klant-agent liegen?** Ja, en daar is het op gebouwd. Wat de klant schrijft is alleen data; code controleert
    elke order zelf (getekend, binnen het mandaat, betaald) en refundt alleen als code's eigen data-check fout vindt.
45. **Waarom Metal en niet alleen kaarten?** Een kaart kan geen betaling van 5 cent per vraag doen, en de limiet zit bij
    de bank. Op Metal zit het mandaat per agent op de chain: maximum per betaling, totaalbudget, één ontvanger. Voor
    leveranciers die alleen kaarten nemen, gebruiken we Airwallex. Beide, elk waar het past.
46. **Hoe weet je dat de agents goed werken?** Evals met echte modellen, 5 runs per geval: Sourcing 10/10, Treasury
    20/20, Support 30/30. En live in de dry runs: Sourcing 4 van 5 goed (één keer sloeg hij een stap over; code nam het
    over en het is gerepareerd), Treasury en Support 5 van 5.
47. **Waarom drie verschillende modellen?** Gemeten: Haiku is goed genoeg voor Sourcing en kost bijna niets; Treasury
    moet echt herverdelen en dat doet alleen Opus betrouwbaar; Support op Sonnet negeert valse verzoeken in de mail.
48. **Kun je één agent stilzetten?** Ja, met Face ID. Zijn mandaat wordt op de chain ingetrokken en zijn kaart bevroren.
    Weer aanzetten kan alleen met beide passkeys.
49. **Wat als een agent iets doet wat je niet snapt?** Op elke regel van het dashboard staat "Trace": elke stap, welke
    tool, wat het kostte, welke check het doorliet of tegenhield, met de hash in de audit-keten.
50. **Wat doet Claude níet?** Claude heeft geen sleutel, keurt niets goed en kiest geen ontvanger. De sweep en de
    licentiebetaling zijn beslissingen van code, niet van een agent.

## 6. Zeg dit niet

- Niet "volledig productieklaar": het draait op sandbox en testnet.
- Niet "Visa-goedgekeurde agents": het is onze eigen agentherkenning volgens Visa's spec, met testsleutels.
- Niet "de red team draaide live": tegen nep-versies, in een wegwerpwereld.
- Niet "finality volledig geverifieerd": de BLS-handtekening checken we niet.
- Niet "T:0 werkt live": nog geen sleutel.
- Niet "de agents beslissen alles": ze beslissen op de uitzonderingen (prijsstijging, herverdeling, geschil); routine en
  de sweep en de licentie doet code.
- Niet "Metal draaide een transactie terug": Metal toetst tegen het mandaat op de chain en weigert vóór er iets
  verstuurd wordt.

## 7. Dagelijkse quiz (10 vragen)

Doe hem elke dag tot 14 november. Antwoorden staan onder elke vraag, ingeklapt.

1. Hoeveel betalingen gingen in de opgenomen run vanzelf, binnen de limieten?
   <details><summary>Antwoord</summary>106</details>
2. Wie weigerde de kaartbetaling van €45,00, en met welke code?
   <details><summary>Antwoord</summary>Airwallex zelf, <code>LIMIT_EXCEEDED</code></details>
3. Hoeveel test-USD hebben de drie agents samen?
   <details><summary>Antwoord</summary>20.00, vast in de code</details>
4. Wat zit er in een Metal-mandaat?
   <details><summary>Antwoord</summary>Max per betaling, budget, één ontvanger, einddatum</details>
5. Hoeveel keer Face ID in de opgenomen run?
   <details><summary>Antwoord</summary>4</details>
6. Welke drie Claude-modellen, en wat doet elk?
   <details><summary>Antwoord</summary>Haiku sorteert, Sonnet leest, Opus beoordeelt risico's</details>
7. Wat kost de AI per €1.000 betaald?
   <details><summary>Antwoord</summary>USD 0,093</details>
8. Hoeveel regels heeft het audit-logboek, en hoe check je het?
   <details><summary>Antwoord</summary>194; <code>npm run verify-log</code></details>
9. Wat is gesimuleerd? Noem er drie.
   <details><summary>Antwoord</summary>De klant-agent van Summit, de red team (nep-versies), Visa-agentherkenning (testsleutels), T:0 (nep-T:0)</details>
10. Hoeveel is de licentie, aan wie, en is hij al live betaald?
    <details><summary>Antwoord</summary>€240,00 per maand aan Stockline Data GmbH; nog niet live betaald</details>
