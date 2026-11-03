# Spiekbrief Max (CFO): hoofdrun dinsdag 3 november, agents aan

**Start 12:30.** De runner start om 12:15; de links komen als **bestand**, stuur ze nergens heen. Hele run: **25 à 30 minuten**.
Testgeld (Airwallex-sandbox, Metal testnet). Claude typt alle commando's en keurt nooit iets goed. Jij kijkt en tikt.
Twijfel je? Zeg "stop". Er gaat dan niets weg.

## Vooraf

- iPhone boven 80 %, Face ID en iCloud-sleutelhanger aan, Niet storen aan, schermopname aan.
- Second approver: a labelled test passkey in this demo. In production this is a second person. (Claude bedient hem.)

## Begin

1. Link 1 in een **privé Safari-tab**, open laten. 2. Enrol-pagina, code, **10 seconden wachten**, Face ID.
3. Stuur in de chat: **"Bevestig passkey [vingerafdruk]"** (ook voor de test-passkey). 4. **Vier ogen aan:** P-0001 → tik de kaart → Confirm with Face ID.

## De run, in volgorde (Claude start eerst de leveranciers, dan de agents)

| Stap | Wat je ziet | Wat jij doet |
|---|---|---|
| 1 | Verkopen lopen op op het dashboard. | Niets. |
| 2 | Aankoop geweigerd (prijs 0,04, boven de cap). Daarna de regel: "Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved." | Niets. Lees de regel. |
| 3 | **Treasury: twee opties**, ongeveer **45 s** na de weigering. Is er na 2 minuten niets: wachten, Claude kijkt. | Kies de optie met "Treasury agent recommends this" → Confirm with Face ID. Je ziet "1 of 2"; daarna tekent de test-passkey (Claude). |
| 4 | Geschil: Summit vraagt "refund all". | **Reject** → Reject with Face ID. |
| 5 | Treasury veegt de opbrengst naar Airwallex. | Niets. |
| 6 | **Licentie EUR 240,00** (alleen het tekort van EUR 110,00 wordt gewisseld). | Tik de kaart → Confirm with Face ID. Van Face ID tot **PAID**: **±5 seconden**. |
| 7 | Packwise-kaartaankoop; boven €30 weigert de kaart. | Verhoging: tik de kaart → Confirm with Face ID. |
| 8 | Claude controleert alles (verify, reconcile). | Niets. Stop de schermopname. |

**Elke keer:** bedrag, ontvanger en begin van de hash gelijk aan wat Claude in de chat noemt. Zo niet: niet tikken, zeg "stop". Verkeerd getikt: **Back**.

## Zeg dit zo

- Vier ogen: "Second approver: a labelled test passkey in this demo. In production this is a second person."
- Bij de geweigerde aankoop: Purser weigert vóór het tekenen. De ene doorgelaten aankoop is door Metal zelf geweigerd.

## Als iets hangt

**Jij doet niets en tikt niet opnieuw.** Een goedkeuring die al gegeven is, blijft staan en wordt maar één keer uitgevoerd.
Claude start zo nodig de runner opnieuw, controleert met verify en meldt: "runner terug, laatste stap was …". Zeg dan "ok".
Verliep een voorstel? Dan komt er een nieuw voorstel en tik je daar één keer op.
