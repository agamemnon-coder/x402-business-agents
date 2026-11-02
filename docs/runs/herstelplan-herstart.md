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
   (dry-6, dry-12; `test/resume-approved.test.ts`).
3. `npm run verify` op de wereld: niets twee keer betaald, elke goedkeuring met een passkey.
4. Max laten weten: de laatste stap uit het log, wat er is hervat, en de volgende stap. Max zegt "ok".
5. Een voorstel dat in de tussentijd verliep: opnieuw voorstellen (een nieuw P-nummer) en opnieuw laten goedkeuren.
   Nooit iets forceren of een verlopen goedkeuring hergebruiken.
6. In het runlog: het tijdstip van de herstart, wat er hervat is, wat er opnieuw moest.
7. **Is de container helemaal nieuw en het grootboek weg:** de run stopt. Het grootboek staat niet in git (alleen
   sleutelbestanden horen in de keys-repo), dus deze wereld kan niet verder. Keuze voor Max: een verse wereld (ongeveer
   15 minuten voorbereiden, opnieuw passkeys koppelen) en opnieuw beginnen, of de run verzetten.

## Snapshots van het grootboek

Na elke stap maakt Claude een consistente kopie van het grootboek (SQLite online backup), lokaal in
`data/snapshots/<wereld>/<stap>.sqlite` (niet in git). Een beschadigd grootboek is daarmee binnen dezelfde container te
herstellen. Een kopie buiten de container (Max, 2 november) staat nog open: het pushen naar de private keys-repo werd door
het veiligheidsfilter van deze omgeving geweigerd, en de keys-repo is volgens Max' regel voor testnet-sleutels. Max
beslist waar de kopie heen mag.

## Om de kans te verkleinen

- Tijdens de run draait er niets anders: geen soak, geen dry runs, geen testgeld-recycling. Alleen de runner draait
  op de achtergrond; elke stap is één los commando dat Claude zelf start en afwacht.
- Een stap die halverwege stopte, wordt nooit blind herhaald: eerst `verify` en het grootboek lezen, dan pas verder.
