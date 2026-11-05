# Inleveren: checklist voor Max

Claude zet alles klaar. Jij verstuurt.

- **Officieel (zo staat het er op 5 november):** "Nov 13 / Project submissions due"
  ([airwallex.hackerearth.com](https://airwallex.hackerearth.com/)), zonder tijd. HackerEarth: de bouwfase loopt tot
  15 nov 2026, 18:29 UTC (19:29 NL-tijd).
- Dan Kim (Airwallex) schreef op 4 nov '11 more days to go', wat past bij 15 nov.
- **Plan: donderdag 12 november, vóór 12:00 (NL-tijd).** Dan zit je onder elke lezing van de deadline.
- **Op de laatste dag (12 november): niets meer deployen.** De site blijft zoals hij is.

Zet nooit een sleutel of geheim in de chat. Typ ze alleen in je eigen terminal of in het Airwallex- of Cloudflare-scherm.

## 1. Video

- Voor de film hoef je niets op te nemen: de voice-over is een AI-stem (ElevenLabs), een verteller in de derde
  persoon, en de muziek is AI-gegenereerd (ElevenLabs); de eindkaart vermeldt beide. Zie
  [docs/video/README.md](../video/README.md).
- Upload de film op YouTube als **Niet vermeld** (unlisted). De regel is "under five minutes"; de film duurt 2:42.
  Zet in de beschrijving: "Test money only: the Airwallex sandbox and Metal testnet" en "Voice-over: an AI-generated
  voice (ElevenLabs) · Music: AI-generated (ElevenLabs)".
- Zet de link in het formulier. Claude zet hem in [README.md](README.md).

## 2. Repo

- De repo is publiek: <https://github.com/agamemnon-coder/x402-business-agents>. De versie voor de jury is de tag
  `v1.0-submission`.
- Claude draait vooraf de geheimenscan (`gitleaks` op de hele geschiedenis en alle branches) en meldt het resultaat.

## 3. Het formulier (HackerEarth)

- Tekst: kopieer de blokken uit [README.md](README.md) (titel, synopsis, beschrijving, instructies). Stuur Claude de
  velden en hun limieten, dan past Claude de tekst daarop aan.
- Screenshots: de 8 bestanden die [README.md](README.md) noemt (sectie "Screenshots"), uit `docs/submission/screens/`.
- Deck: `docs/submission/purser-deck.pdf`.
- Vraagt het formulier om een bestand met de code? Draai `npm run submission` op de tag; de zip staat dan in
  `out/submission/purser-source.zip`.
- Links: de video, de live site (<https://kit11.max-31b.workers.dev/>) en de repo.

## 4. Na het inleveren

- Zeg tegen Claude: **"ingeleverd"**. Dan, elk op jouw go:
  - MFA aan op de site, met een nieuwe viewer-link voor jou (de oude werkt daarna niet meer);
  - de Cardputer live in een testwereld, als tweede "ja" naast Face ID, nooit in plaats ervan;
  - Demo Day voorbereiden;
  - een lijst van branches die weg kunnen (alleen een voorstel; Claude verwijdert niets).
- Laat de site en de sandbox aan tot en met 19 november (Demo Day in San Francisco; op afstand mag ook).
- Finalisten worden 15 november gekozen. Zeg pas "Finalist" of "Winner" met een officiële bron.
- Geen Slack-, X- of LinkedIn-bericht zonder dat jij de tekst hebt goedgekeurd.

Optioneel, ook na het inleveren: een Airwallex-sleutel met alleen de nodige rechten
([docs/airwallex.md](../airwallex.md), sectie "The scoped key").
