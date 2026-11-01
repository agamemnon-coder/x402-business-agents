# Wereld-draaiboek donderdag: wij veranderen de wereld, de agents beslissen

Dit is het draaiboek voor de run met de autonome agents (`KIT11_AGENTS=on`, `KIT11_AUTONOMY=on`). Het verschil met
[draaiboek-live-run.md](draaiboek-live-run.md): daar volgt elke stap een vast script. Hier veranderen wij alleen de
wereld. Wat de agents daarop doen, staat **niet** vast. Er staan dus geen vaste bedragen of uitkomsten in dit draaiboek,
alleen wat wij doen, waar je kijkt en wat de regels zijn.

**Kill-regel.** Alleen als op woensdag 4 november om 23:00 drie autonome dry runs op rij groen zijn (0 onveilig, 0 dubbel
betaald, fallbacks onder 10%). Anders draaien we donderdag het gewone draaiboek met de huidige agents.

Stand op 1 november: dry-96 rood (opgelost), dry-97 en dry-98 groen. Stappen 4b en 4c zijn op 1 november toegevoegd; die tellen pas mee vanaf de eerste run met deze stappen. Zie [2026-11-01-autonomy-dry-96-97.md](2026-11-01-autonomy-dry-96-97.md).

## Wie doet wat

- **Max (CFO)** keurt goed of af met Face ID. Hij hoeft niets te typen.
- **Controller**: de tweede passkey (vier ogen boven €1.000 en bij elke mandaatwijziging).
- **Claude** typt de wereld-commando's en keurt nooit iets goed.
- **De drie agents** draaien elk als eigen proces. Elk heeft een doel, tools en een geheugen van de laatste 5 besluiten.
  Ze worden wakker van een wereld-event, een bericht van een andere agent of hun routine-check.

## Vooraf (Claude, zonder Max)

1. Een verse wereld met eigen sleutels. De naam begint niet met `dry-`; dat is alleen voor proefwerelden.
2. `npm run health` is groen (Airwallex, Metal, Claude).
3. `npm run cards -- setup`: elke agent zijn bedrijfskaart bij Airwallex. De runner start de drie agents zelf. Ze wachten rustig tot de mandaten op de chain staan.
4. Max en de controller zetten hun passkeys. Max zegt in de chat: "Bevestig passkey &lt;vingerafdruk&gt;".
5. Max zet vier ogen aan (P-0001, Face ID).

## De wereld, stap voor stap

| # | Wij doen (Claude typt) | Wie beslist | Waar Max kijkt | Wat er kan gebeuren (geen script) |
|---|---|---|---|---|
| 1 | `npm run world -- serve`: elke 15 s een klant-vraag | code volgt het koopbeleid van Sourcing | Dashboard: verkopen lopen op | — |
| 2 | `npm run world -- price-rise 0.04` | **Sourcing** (Haiku), daarna eventueel **Treasury** (Opus) | Dashboard → "The agents decide": het besluit en het gesprek | Sourcing stapt over naar Ridgeline, cachet, koopt niet, of vraagt Treasury om een hogere cap. Treasury doet niets, legt het uit, of ontwerpt twee opties voor de CFO. **Als er opties komen:** Max kiest met Face ID, en de controller tekent mee. |
| 3 | Wachten tot er ±16 vragen zijn geweest (±4 min), dan `npm run world -- dispute` | **Support** (Sonnet) | De besluit-regel van Support; de Dispute desk | Support controleert elke order op de chain en tegen de correcties van de leverancier. Foute orders betaalt hij terug binnen zijn limiet. Orders die nooit verkocht zijn, betaalt hij niet. "Alles terug" gaat naar Max (advies: weigeren). |
| 4 | `npm run world -- invoice` | **Treasury** | De telefoon: een factuurbetaling met timing-advies | Nu betalen, wachten (niet na de vervaldatum min 2 dagen), of eerst wisselen. Max keurt goed of af. |
| 4b | `npm run world -- packwise-pro`: Packwise stopt met Starter, Pro kost €45 per maand | **Sourcing** | De besluit-regel; bij een weigering de telefoon: een limietverhoging | Sourcing kiest plan én rail. Packwise neemt alleen een kaart, dus x402 weigert de code met de reden. De kaart kan door Airwallex geweigerd worden (limiet €30): dan stelt de agent een begrensde verhoging voor. Max keurt die goed of af. Sourcing kan ook niets kopen. |
| 4c | `npm run world -- money-in`: de verkopen van vandaag zijn binnen op Metal | **Treasury** | De besluit-regel; bij een sweep het bewijs | Treasury veegt de netto-opbrengst naar Airwallex (na finality, geboekt), of wacht. Code houdt over wat de andere mandaten nog mogen uitgeven. |
| 5 | Claude draait `npm run verify` en `npm run agent-summary` | code | Terminal | Niets dubbel betaald, elke goedkeuring met een passkey, elke Claude-call met een request-id, het fallback-%. |

Tijden uit dry-97: elk besluit kwam binnen 1 minuut na het wereld-event. De dispute duurt het langst (1–2 minuten),
omdat Support elke order op de chain controleert.

## Wat altijd vaststaat (wat de agents niet kunnen)

- Een agent kan zijn eigen mandaat niet veranderen. Purser weigert alles boven de cap al vóór het tekenen, en Metal
  weigert het op de chain.
- Een agent kiest geen sleutel, URL of ontvanger. Geld beweegt alleen binnen het mandaat, of na Face ID van Max op de
  exacte voorwaarden.
- Code controleert elke tool-call en geeft de reden terug als hij weigert. Dat staat in de trace.
- De noodstop en de pauze per agent werken ook midden in een loop: de volgende tool-call wordt geweigerd. Ook de
  fallback van code doet dan niets.
- Kostenrem: per agent per uur en per run. Bij 80% komt er een waarschuwing; daarboven doet de agent geen Claude-call meer
  en beslist de code, met een label.

## Als het misgaat

- **Een agent beslist niet (fallback).** Dat staat zichtbaar als "Fallback (code)". Gewoon doorgaan; het telt mee in het %.
- **Een agent doet iets onverwachts maar binnen de regels.** Dat is de demo: laten gebeuren en uitleggen.
- **Iets lijkt niet goed.** Max drukt op de noodstop (Face ID). Alle agents stoppen direct. Daarna gaan we verder met het
  gewone draaiboek.
- **Claude API weg.** Eén nieuwe poging, daarna beslist de code met een label. De run gaat door.

## Eerlijk erbij zeggen

- De klant, de leveranciers en de wereld-events zijn van ons (testgeld, sandbox, testnet). De besluiten van de agents
  zijn echt: echte Claude-calls met request-id, tokens en kosten per besluit.
- De agents gebruiken de geteste flows als tools (bijvoorbeeld de dispute-afhandeling). Ze beslissen óf en wanneer ze die
  gebruiken, en wat ze aan andere agents vragen.
- In de variatietest kiest Sourcing in dezelfde wereld steeds dezelfde kern (Ridgeline binnen de cap). Het verschil zit
  in de details, zoals wel of niet Treasury vragen. In andere werelden kiest hij anders. Zie
  [../agents-autonomy.md](../agents-autonomy.md).
