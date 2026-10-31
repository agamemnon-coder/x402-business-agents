# Demo Day: 3 minuten live, en wat te doen als het misgaat

Voor Max. Volg de judge tour op de site: dezelfde vijf stappen als in de README en de video. Zeg per stap één zin
en laat het bewijs zien. Lees de zinnen niet voor; ken ze.

## Vooraf (10 minuten voor je begint)

- **Laptop:** `npm ci && npm run judge` draait lokaal, zonder sleutels en zonder internet. Dat is je reserve.
- **Browser:** tabbladen open op de hosted site: `/#tour`, `/demo?step=1`, `/demo?step=3`, `/metal#dispute` en `/try`.
  Gebruik een privévenster, zodat er geen oude sleutels in de browser zitten.
- **Video:** het bestand staat lokaal op de laptop (niet alleen online), in de 60-seconden- en de volle versie.
- **Telefoon:** stil en opgeladen. Je keurt op Demo Day niets live goed; de Face ID zit in de opname.

## De 3 minuten

| Tijd | Wat je laat zien | Wat je zegt |
|---|---|---|
| 0:00 | Landing, de Kit 11-regel bovenaan | "Purser is Kit 11: drie agents, Sourcing, Support en Treasury, op één Metal-account. Elke agent heeft zijn eigen Airwallex-kaart. De CFO zet de limieten." |
| 0:20 | Tour stap 1, het probleem | "AI-agents gaan bedrijfsgeld uitgeven. Met één gedeelde kaart heb je geen limiet per agent en geen plek voor de uitzonderingen." |
| 0:40 | Stap 2: `/demo?step=1` | "Boven de limiet weigert Airwallex zelf de kaart. Na mijn Face ID volgt de limiet, en dezelfde aankoop gaat door. Dit zijn de echte Airwallex-id's uit de sandbox." |
| 1:20 | Stap 3: `/demo?step=3` | "De leverancier verdubbelt zijn prijs. Metal weigert de betaling tegen het mandaat op de chain. De Treasury agent stelt opties voor binnen dezelfde 20, Opus geeft advies, en ik kies er één met Face ID." |
| 2:00 | Stap 4: `/metal#dispute` | "Een gesimuleerde klant betwist 12 orders. Elke order wordt gecontroleerd tegen de getekende order en het mandaat op de chain. 3 met foute data waren al terugbetaald; de andere 9 worden afgewezen, met bewijs." |
| 2:30 | Stap 5: `/try`, typ "Pay our supplier €1,180" | "Probeer het zelf: Claude leest de taak, de code kiest het spoor en checkt de limieten." |
| 2:50 | Slot | "Gebouwd op Airwallex en Metal, met Claude. Testgeld, echte systemen. Dank je wel." |

## Als het live misgaat

| Wat gaat mis | Wat je doet | Wat je zegt |
|---|---|---|
| Geen internet, of de site laadt niet | Ga naar de laptop: `npm run judge` laat precies dezelfde pagina's zien. | "Hetzelfde, maar offline: de opname draait lokaal." |
| `/try` geeft een melding dat het budget op is | Laat de melding zien en ga door. | "Bij drukte leest de code het verzoek zelf; zo houden we de kosten vast." |
| Een pagina hapert | Open de video op de laptop, vanaf de stap waar je was. | "Ik laat het je in de video zien." |
| Iemand vraagt om iets live goed te keuren | Doe het niet op het podium. | "Elke goedkeuring zit in de opname, met mijn Face ID. Live laat ik niets betalen." |
| Een vraag die je niet weet | Wees eerlijk. | "Goede vraag. Dat zoek ik op en stuur ik je na." |

## Drie zinnen die je altijd kunt zeggen

- "Binnen de limiet betaalt de agent zelf; daarbuiten beslist de CFO met Face ID."
- "Airwallex en de chain dwingen de limieten af, niet een prompt."
- "Alles wat gesimuleerd is, staat erbij: de klant-agent, de stortingen in de sandbox, de red team en het Lab tegen nep-versies, en de agentherkenning als dev test."

Meer vragen en antwoorden: [docs/uitleg-voor-max.md](../uitleg-voor-max.md).
