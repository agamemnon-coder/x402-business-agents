# Inleveren: checklist voor Max

Claude zet alles klaar. Jij verstuurt. Deadline: 13 november, 19:29 (NL-tijd). Plan: inleveren op donderdag 12 november.

Zet nooit een sleutel of geheim in de chat. Typ ze alleen in je eigen terminal of in het Airwallex- of Cloudflare-scherm.

## 1. Airwallex-sleutel met alleen de nodige rechten

- Maak in de Airwallex-sandbox een nieuwe API-sleutel met alleen de rechten uit [docs/airwallex.md](../airwallex.md),
  sectie "The scoped key".
- Zet hem in je eigen `.env` (niet in git).
- Draai `npm run health`. Bij `401 Insufficient permissions` noemt de melding het recht dat mist.
- Zeg daarna tegen Claude: "nieuwe sleutel staat erin". Claude draait dan één keer de kaarten en de eurofactuur; de betaling keur jij goed met Face ID.

## 2. Webhooks voor alle objecten (klaar, 30 oktober)

- Gedaan na jouw go: 23 events live, met een korte live test (`docs/runs/2026-10-30-webhooks.md`).
- Maak je een nieuwe Airwallex-sleutel (stap 1)? Geef die ook het recht op FX-events; dan kan `conversion.overdue` erbij.

## 3. Viewer-link vernieuwen

- De viewer-link komt uit het relay-token. Een nieuw token is een nieuw geheim: dat doe jij, of Claude op jouw go.
- Zet een nieuw `KIT11_RELAY_TOKEN` in je `.env`, draai `npm run relay:deploy` en wacht een minuut.
- Draai `npm run relay` en open de nieuwe viewer-link één keer op je telefoon (privé-tabblad in Safari).
- De oude link werkt daarna niet meer.

## 4. Repo: publiek, of privé met toegang voor de jury

Beide mogen (Airwallex in #help, 1 november: een repo mag privé blijven met toegang voor de jury; een lokaal draaiende
demo mag ook). Plan: publiek. Kies één van de twee:

**A. Publiek (het plan)**
- Pas na groen CI op de laatste commit (daar zit gitleaks op de hele geschiedenis in).
- Claude draait vooraf nog één keer de geheimenscan en `gitleaks` lokaal en meldt het resultaat.
- Daarna zet jij de repo op publiek (GitHub, Settings, Danger zone). Dit kan niet ongedaan worden voor wie al keek.

**B. Privé, met toegang voor de jury**
- Dezelfde scan als bij A (een jurylid ziet alles wat erin staat).
- Jij nodigt de GitHub-accounts uit die de organisatie noemt (Settings, Collaborators, alleen lezen). Vraag in #help
  welke accounts; nodig niemand anders uit.
- In het formulier: "private repository, access granted to the judges' accounts", met de link.

## 5. Video

- Opnemen volgens [docs/video/opnames-max.md](../video/opnames-max.md).
- Upload op YouTube als **Niet vermeld** (unlisted). Maximaal 4:45.
- Zet de link in het formulier en in `docs/submission/README.md` (Claude doet het laatste).

## 6. Het formulier (HackerEarth)

- Tekst: kopieer de blokken uit [README.md](README.md) (titel, synopsis, beschrijving, instructies).
- Screenshots: de 6 bestanden in `docs/submission/screens/`.
- Deck: `docs/submission/purser-deck.pdf`.
- Zip: draai `npm run submission` op de laatste commit; het bestand staat dan in `out/submission/purser-source.zip`.
- Links: video, live-adres (de relay), repo.
- Controleer of het Rules- en Discussion-tabblad iets nieuws zeggen (de pagina gaf op 29 oktober een fout).

## 7. Na het inleveren

- Laat de relay en de sandbox aan tot en met 19 november (Demo Day).
- Geen Slack-, X- of LinkedIn-bericht zonder dat jij de tekst hebt goedgekeurd.
