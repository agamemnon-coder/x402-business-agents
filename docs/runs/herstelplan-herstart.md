# Herstelplan: de container herstart midden in een run

Geldt voor de reserve-run (maandag 2 november) en de hoofdrun (donderdag 5 november).

## Wat er gebeurt

De machine waarop Claude en de runner draaien, start opnieuw op (in de nacht van 1 op 2 november gebeurde dat: ongeveer
zes uur stil, daarna in twee minuten weer op). Alle programma's stoppen tegelijk, ook de runner. Wat blijft:

- **De telefoons en de gehoste relay (Cloudflare).** Een goedkeuring die al met Face ID gegeven is, staat daar en wacht
  tot de runner terug is. Ze gaat niet verloren en wordt niet twee keer uitgevoerd.
- **Het grootboek** (`data/live-1.sqlite`, donderdag de verse wereld) en **de sleutels**: ze staan op de schijf, en
  die bleef bij de herstart van vannacht heel. De sleutels staan ook in de private keys-repo.
- **Metal testnet en de Airwallex-sandbox**: wat daar al gebeurd is, staat vast.

## Wat Max en de controller doen

1. **Niets.** Niet opnieuw tikken, niet opnieuw goedkeuren. Zie je "wacht" of geen nieuwe stap: dat is goed.
2. Wacht op Claude's bericht "runner terug, laatste stap was …".

## Wat Claude doet (in deze volgorde)

1. Nagaan dat het grootboek, de sleutels en de reserve-code (eff08b4) er nog zijn. Ontbreekt het grootboek: naar stap 7.
2. De runner opnieuw starten, met dezelfde instellingen. Bij het starten hervat hij elke onderbroken actie (een actie
   die al goedgekeurd was of al liep), via de eigen controles van de executor: de hash die Max tekende, de goedkeuring,
   de vervaldatum en de quote. Getest: na een kill direct na Face ID werd de licentie precies één keer betaald
   (dry-6, dry-12; `test/resume-approved.test.ts`). Een geschil dat al besloten was, wordt niet opnieuw besloten: het
   besluit staat in het grootboek vóór er iets betaald wordt, en de Support-agent (of `npm run s2`) betaalt alleen wat
   van dát besluit nog openstond, elke refund één keer (`test/dispute-decided-once.test.ts`).
3. `npm run verify` op de wereld: niets twee keer betaald, elke goedkeuring met een passkey.
4. Max laten weten: de laatste stap uit het log, wat er is hervat, en de volgende stap. Max zegt "ok".
5. Een voorstel dat in de tussentijd verliep: opnieuw voorstellen (een nieuw P-nummer) en opnieuw laten goedkeuren.
   Nooit iets forceren of een verlopen goedkeuring hergebruiken.
6. In het runlog: het tijdstip van de herstart, wat er hervat is, wat er opnieuw moest.
7. **Is de container helemaal nieuw en het grootboek weg:** de run stopt. Het grootboek staat niet in git (alleen
   sleutelbestanden horen in de keys-repo), dus deze wereld kan niet verder. Keuze voor Max: een verse wereld (ongeveer
   15 minuten voorbereiden, opnieuw passkeys koppelen) en opnieuw beginnen, of de run verzetten.

## Stoppen (sinds 2 november)

Op 2 november raakte een stopcommando alleen de setsid-starter; de runner van een andere wereld (live-1) draaide door
tot 11:03. Nu is elke wereld één eigen procesgroep met een slot in het eigen grootboek (tabel `locks`, rij `runner`:
pid, procesgroep, host, starttijd, wereld, run-token). Een tweede runner op hetzelfde grootboek weigert te starten.

- Stoppen: `npm run stop -- <wereld>` (bijvoorbeeld `npm run stop -- live-1`, of het pad naar het grootboek).
  Het stuurt SIGTERM naar de procesgroep uit het slot van díe wereld (runner, `up` en agents samen), wacht (standaard
  90 s, `--grace <s>`; een lopende uitvoering maakt hij eerst af), daarna zo nodig SIGKILL naar dezelfde groep, en
  controleert met `ps` dat er niets van die groep over is. Pas dan verwijdert het het slot.
- Het signaleert niets als er in die groep een proces zit zonder het run-token van het slot, en nooit een losse pid,
  een naam (`pkill -f` nooit) of een andere wereld.
- Exit 0 = de wereld is aantoonbaar gestopt. Anders blijft het slot staan en zegt de melding wat er nog draait.
- Een runner die gekild werd (container-herstart, kill -9) laat een oud slot achter; de volgende start ruimt het op als
  er niets van die run meer draait.
- Een runner van vóór deze wijziging heeft geen slot: `stop` noemt dan de processen die dat grootboek gebruiken en
  signaleert niets. Die stop je één keer met de hand, per procesgroep, na controle met `ps -o pid,pgid,args`.
- Na elke dry run: `npm run stop -- <wereld>`, dan `ps -eo pid,pgid,args` nalopen.

## Snapshots van het grootboek

Na elke stap maakt Claude een consistente kopie van het grootboek (SQLite online backup), lokaal in
`data/snapshots/<wereld>/<stap>.sqlite` (niet in git). Een beschadigd grootboek is daarmee binnen dezelfde container te
herstellen. Max besliste op 2 november: alleen lokaal, ook donderdag. Bij een volledig nieuwe container (grootboek weg)
stopt de run en kiest Max: een verse wereld of opschuiven (stap 7 hierboven).

## Om de kans te verkleinen

- Tijdens de run draait er niets anders: geen soak, geen dry runs, geen testgeld-recycling. Alleen de runner draait
  op de achtergrond; elke stap is één los commando dat Claude zelf start en afwacht.
- Een stap die halverwege stopte, wordt nooit blind herhaald: eerst `verify` en het grootboek lezen, dan pas verder.

## Relay token (2 November)

Since 2 November the relay token is a random secret, no longer derived from the Cloudflare key. It was renewed after
agent run 1, because an old viewer link appeared in a screen recording and in chat. It lives outside git, in
`/home/user/.kit11/relay-token`, and is never printed. Every runner start and every `npm run relay:deploy` needs
`KIT11_RELAY_TOKEN=$(cat /home/user/.kit11/relay-token)`. Without it the runner gets 401 from the relay. **This file is
lost with the container.** In a completely new container the relay is redeployed with a new token, and Max gets new links.
