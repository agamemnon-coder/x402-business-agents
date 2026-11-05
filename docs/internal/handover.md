# Overdracht (5 november 2026)

Voor de volgende sessie die aan Purser werkt (`agamemnon-coder/x402-business-agents`). Kort en feitelijk. De regels
van Max blijven gelden: geen geheimen in code, git, logs of beeld; elk getal uit de hoofdrun (3 nov, `main-1`, commit
`35e1cac`, `docs/demo/main-run.json`); nooit "code decides"; geen deploy zonder Max' ok; geen branches verwijderen of
history herschrijven; Max nooit om sleutels in de chat vragen.

## Wat af is (op main)

- Main staat op `778bc8c` (5 nov). Gemerged: #24 (pitch), #25 (juror review), #27 (film v3 met animaties), #28 (/try/sign op
  de telefoon), #29 (stops-zin overal, formulier 3.821 tekens). CI groen; 2338 tests in 246 files.
- De site draait op https://kit11.max-31b.workers.dev: de Worker van main `656061d`, deploy van 5 nov (versie
  `0d591eae`). De vier checks na de deploy en de live /try/sign-check (390 px na de tamper) zijn groen. #27 raakt de
  Worker niet, dus er is geen nieuwe deploy nodig.
- Het pakket voor de inzending: `docs/submission/` (README met de formuliertekst, release-notes, checklist-max,
  pitch, qa, demo-day, `purser-deck.pdf`), `docs/media/try-sign-qr.png` en `docs/internal/spiekkaart-demo.pdf`.
- Metal: de getallen en zinnen staan in de README; ze zijn geverifieerd op chain 63825.
- De tag `v1.0-submission` staat op de freeze van 4 nov.

## Wat open staat

1. **Max' voice-over** over de film: `docs/video/script.md`. De regel bij kaart 13 is nieuw ("Metal refused one purchase
   over its cap; the CFO rejected one proposal."). Het eindbestand komt van Max: zijn stem over de master, met muziek A
   (Mixkit "Techno Fest Vibes", 120 BPM, doorlopend, −20 LUFS). Zie `docs/video/README.md`.
2. **T:0** (zie hieronder): wacht op Justin.
3. **De README-link naar de video:** de placeholder `<!-- VIDEO-LINK -->` vervangen zodra Max de YouTube-link (unlisted)
   heeft.
4. **De limiet van het formulier:** Max checkt die. De Description is 3.821 tekens; een test houdt hem onder 4.000.
5. **Na de laatste wijziging:**
   - een fresh-clone-check (`npm ci && npm test && npm run judge -- --check`);
   - het testgetal overal gelijk: README, claims, release notes "Since the tag", demo-day en filmkaart 13
     (`npm run video -- 13-specs`);
   - de tag `v1.0-submission` alleen verzetten met Max' ok, of een nieuwe tag zetten (bijv. `v1.1-submission`).

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
- **De ledger van de hoofdrun** (`data/main-1.sqlite` van 3 nov, sha256 `09895aa2c454…`) staat niet in de publieke repo,
  en daar hoort hij ook nooit in. Hij staat in de privé-repo `agamemnon-coder/x402-business-agents-keys`, branch
  `claude/charming-maxwell-pezr3l`, `main-1/ledger/main-1.sqlite`. Hij is gescand op geheimen: alleen passkey-credential-id's
  gevonden, en die zijn publiek. Kopieer hem eruit en zet `KIT11_DB` op de kopie.
- **Status 5 nov:** ook met de juiste sleutel in de omgeving geeft T:0 401 CAPI11 (Max). De boeking wacht op Justin.
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

- [#26](https://github.com/agamemnon-coder/x402-business-agents/pull/26) `handover`: dit bestand (draft, alleen docs).
- [x402-business-agents-keys#1](https://github.com/agamemnon-coder/x402-business-agents-keys/pull/1): de ledger van de
  hoofdrun in de privé-repo (draft).
