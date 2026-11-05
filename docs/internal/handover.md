# Overdracht (5 november 2026)

Voor de volgende sessie die aan Purser werkt (`agamemnon-coder/x402-business-agents`). Kort en feitelijk. De regels
van Max blijven gelden: geen geheimen in code, git, logs of beeld; elk getal uit de hoofdrun (3 nov, `main-1`, commit
`35e1cac`, `docs/demo/main-run.json`); nooit "code decides"; geen deploy zonder Max' ok; geen branches verwijderen of
history herschrijven; Max nooit om sleutels in de chat vragen.

## Wat af is (op main)

- Main staat op `b64a75b` (PR #24, de pitch, en PR #25, de juror review, allebei gemerged op 5 nov). CI groen.
- De site draait op https://kit11.max-31b.workers.dev (de Worker van main `94014cd`, deploy van 4 nov). Sindsdien heeft
  geen PR de Worker veranderd, dus er is geen nieuwe deploy nodig.
- Het pakket voor de inzending: `docs/submission/` (README met de formuliertekst, release-notes, checklist-max,
  pitch, qa, demo-day, `purser-deck.pdf`), `docs/media/try-sign-qr.png` en `docs/internal/spiekkaart-demo.pdf`.
- Metal: de getallen en zinnen staan in de README; ze zijn geverifieerd op chain 63825.
- De tag `v1.0-submission` staat op de freeze van 4 nov.

## Wat open staat

1. **De juror review is gemerged** ([#25](https://github.com/agamemnon-coder/x402-business-agents/pull/25)). Nog open:
   "2 stopped at a limit" staat nog op de site-tegels, in `docs/claims.md`, `docs/video-script.md` en filmkaart
   13. Vraag Max of daar ook zijn nieuwe zin moet komen; voor de site is dan een deploy nodig, op Max' ok.
2. **Film v3** (branch `premiere-v3`, nog geen PR):
   - Klaar: de render met de intro, de Face ID-scène, de achtergrond, de grijze credits en de aftiteling; 3:12, 1080p60.
   - Max heeft de master met muziek gekregen (`purser-film-v3.mp4`, muziek A op −20 LUFS, doorlopend, op de beat).
   - Nog te doen:
     - main mergen in `premiere-v3`;
     - het testgetal in de README gelijkzetten met de echte telling (`npx vitest run`), daarna `npm run video -- 13-specs`
       en `npm run video -- --docs`;
     - de kaart "2 stopped at a limit" in `13-specs` gelijktrekken met Max' nieuwe zin, als hij dat ook in de film wil
       (punt 6 van de review);
     - een PR maken en mergen.
   - Het eindbestand komt van Max: zijn voice-over over de master (`docs/video/script.md`, `opnames-max.md`).
3. **T:0** (zie hieronder).
4. **De README-link naar de video:** de placeholder `<!-- VIDEO-LINK -->` vervangen zodra Max de YouTube-link (unlisted)
   heeft.
5. **De lengte van het formulier:** de Description is ±14.500 tekens. Er is een melding van een limiet van 10.000. Max
   kijkt naar het echte formulier; daarna inkorten.
6. **Na alle merges:**
   - een fresh-clone-check (`npm ci && npm test && npm run judge -- --check`);
   - het testgetal overal gelijk (README, claims, release notes, film);
   - de tag `v1.0-submission` alleen verzetten met Max' ok (de tag staat al; een nieuwe tag kan ook, bijv. `v1.1-submission`).

## T:0: de taak

Status: gebouwd, niets geboekt. Eén zin overal: "T:0 bookkeeping is built; posting failed (shared key 403 CAPI71 on
3 Nov, new key 401 CAPI11 on 5 Nov), so nothing is posted." Bijzonderheden: `docs/runs/2026-11-05-t0-live.md` en
`docs/t0.md`.

- **Op 5 nov om 10:20 UTC opnieuw getest:** `GET /v1/entities` (base `https://api.t0.ai`, header `Authorization: Bearer`)
  gaf `401 CAPI11`. In die sessie stond `T0_API_KEY` niet in de omgeving. De sleutels die uit Justins screenshot waren
  overgetypt, zijn verwijderd (`shred`). Gebruik alleen `$T0_API_KEY` uit de omgeving.
- **Stap 1:** controleer of de sleutel er is, zonder de waarde te printen:
  `[ -n "$T0_API_KEY" ] && echo ja || echo nee`.
- **Stap 2:** één leesactie, en print alleen de status en de foutcode:
  `curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $T0_API_KEY" https://api.t0.ai/v1/entities`.
  - Bij 200: meld "T:0 werkt" en wacht op Max' go voor de boeking.
  - Bij 401 of 403: meld de status en de foutcode; Max stuurt dan Justin een bericht.
- **Stap 3 (alleen na Max' go):** de commando's in `docs/runs/2026-11-05-t0-live.md`, "To finish once T:0 accepts the
  key": `accounts`, dry-run (95 entries), push (95 posted), push opnieuw (0 posted, 95 skipped), `compare`. Allemaal met
  `KIT11_DB` op een kopie van de hoofdrun-ledger.
- **De ledger van de hoofdrun staat niet in git** (`data/` staat in `.gitignore`). Het is `data/main-1.sqlite` van
  3 nov, sha256 `09895aa2c454…`. Een nieuwe container heeft hem niet. Die staat nu alleen in de scratchpad van de sessie van 5 nov. Voorstel, wacht op Max' ok: zet hem in de privé-repo `agamemnon-coder/x402-business-agents-keys`, of laat Max hem van zijn eigen machine uploaden. Zonder deze ledger kan de T:0-boeking niet draaien, want de `PUR-`nummers hangen af van deze postings. Controleer de sha256 vóór gebruik.
- **Daarna:** een run-log in `docs/runs/` zonder sleutel of account-ids; de T:0-zin overal aanpassen naar "posted"
  (README, formulier, claims, deck, pitch, Q&A, spiekkaart, `docs/t0.md`), met tests; het bericht aan Justin met onze
  19 GL-accounts.

## Voor Max (zelf doen)

- de voice-over inspreken (`docs/video/script.md`);
- de QR-code testen op een iPhone en een Android, vanaf het scherm en vanaf papier;
- drie keer oefenen met een stopwatch en de tijden invullen in `demo-day.md`;
- Dan Kim de 8 vragen stellen (`demo-day.md` §1);
- de limiet van het formulier nakijken;
- `T0_API_KEY` in de omgeving zetten; Justin vragen de sleutel te controleren;
- optioneel: Turner vragen om `ISS_AUTH_REMOTE_AUTH_ENABLED`;
- inleveren vóór do 12 nov 12:00 NL. De officiële deadline is 13 nov (microsite) of 15 nov 18:29 UTC (HackerEarth);
  de repo blijft openbaar.

## Na het inleveren

- MFA aan, met een nieuwe kijklink;
- de Cardputer in een testwereld;
- Demo Day voorbereiden;
- een voorstel voor de branchlijst (niets verwijderen zonder Max).

## Open PR's op dit moment

- Geen open PR's (#25 is gemerged).
- `premiere-v3` (film v3) staat gepusht op `ddbd66a`. In de sessie van 5 nov werkte nog een agent aan animatie-upgrades 1–4 (het architectuurplaatje met een lichtpuls, de prijslijn door de cap, count-ups, push-ins); die commits komen erbij als ze klaar zijn. Daarna main mergen en een PR maken.
- Branch `handover`: dit bestand.
