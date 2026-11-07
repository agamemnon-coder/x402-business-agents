# Acceptatie van de drie dry runs vóór de hoofdrun (Max, 2 november)

Drie dry runs op rij, op exact de code en de relay van de hoofdrun, in drie verse werelden. Pas als alle drie aan
**alles** hieronder voldoen, gaat de code op slot (freeze) en plannen we de hoofdrun. Eén rode run: oorzaak vinden,
fixen, en de telling begint opnieuw.

## 1. De eisen uit de audit (docs/internal/requirements-audit-2026-11-02.md) — in elke run ✅, met bewijs per run

| # | Eis | Bewijs dat in de run-log moet staan |
|---|---|---|
| 4 | Per query wordt upstream gekocht (cache uit) | aantal verkopen = aantal upstream-aankopen (betaald of geweigerd); 0 rijen uit de cache |
| 5 | De weigering bij 0,04 | Met Max' vlag: één aankoop bewust naar Metal, Metal weigert zelf (code + tx), niets afgerekend, daarna weer Purser's pre-check. Zonder de vlag (als die niet veilig af is): "Purser refused before signing; Metal recorded the refusal on chain" met de tx |
| 6 | De klant krijgt een foutstatus en er wordt niet afgerekend | per query de status (bijv. 503/402) en "settled: false" in de ledger |
| 9 | Vier ogen, eerlijk benoemd | 1 van 2 (Max) en 2 van 2 (de gelabelde test-passkey) op dezelfde terms-hash; de tekst "Second approver: a labelled test passkey in this demo. In production this is a second person." |
| 17 | De licentie in EUR, door Treasury zelf gepland | voorstel met herkomst "Treasury agent" (niet de CFO-opdracht), Face ID, PAID (fee onder het plafond); bij fee_unknown de retry zichtbaar |
| 18 / 25 | FX voor het tekort | een FX-quote en -conversie voor alleen het tekort, vóór de SWIFT-transfer, binnen de vloer |
| 20 | TAP-kaartaankoop in dezelfde wereld | TAP-getekende checkout op een kaart van deze wereld; onze laag verifieert beide handtekeningen; Airwallex keurt goed of weigert op de limiet |

Plus de hele Kit 11-flow in één wereld: verkoop per query, prijsstijging, weigering, Treasury's herverdeling binnen de
20, vier ogen, replace (met wat al is uitgegeven), het geschil met alleen de foute data gerefund, de sweep na finality
met de hash als referentie, de licentie, de TAP-aankoop.

## 2. Altijd

- 0 onveilige acties (de verdict-regels van de variatietest, inclusief "payee relayed, withheld by code" apart geteld).
- 0 dubbel betaald; 0 dubbele beslissingen (één beslissing per geschil, ook na een herstart; één voorstel per factuur).
- Herkomst: 0 geldbewegingen zonder herkomst (`npm run origins`).
- `npm run verify` groen; `npm run reconcile` 0 verschillen; `npm run data-qa` 0 verschillen; dashboard = chain.
- Fallbacks onder 10%; elke Claude-beslissing met request-id, model, tokens, latency en kosten.
- **Geen feitenfouten van de agents in Watch**: geen besluit-regel die een bereikbare leverancier "unreachable" noemt,
  een offline leverancier aanraadt, of een betaalde factuur onbetaald noemt (de eval-cases draaien 10× per case vóór de
  dry runs).
- Stoppen: na de run stopt `npm run stop` precies deze wereld; `ps` toont daarna geen proces van deze wereld en raakt
  geen andere wereld.
- De link werkt in één tabblad (Safari-fix).

## 3. Wat Claude per run vastlegt

Een run-log per dry run met: de commit, de tijden per stap, de tabel hierboven met bewijs (tx, transfer-id, request-id,
audit-rij), de uitkomst van verify/reconcile/data-qa/origins, de fallback-%, de kosten, en elke afwijking. Daarna een
regel: GROEN of ROOD, met de reden.

## 4. Vóór de eerste dry run (Max, 2 november, avond)

1. **De variatietest volledig opnieuw** (40 gesimuleerde werelden) op de sim-31-fix, met per geval: hield code het
   tegen (geen geld bewogen) of niet. Pas daarna een uitspraak over "unsafe", met de precieze definitie erbij.
2. **Dashboard = chain, exact.** De 0,05–0,06 verschil bij het klant-mandaat (2 van 10 live werelden): oorzaak, fix,
   test. `npm run dashboard-vs-chain` faalt bij elk verschil en noemt de betaling die het verklaart.
3. **De Try-parser leest Europese notatie goed** (2.500 / 2,50 / 1.850,00 / €2.500) en laat geen item stil vallen;
   met tests, en gedeployd.

Daarnaast (geen poort voor de dry runs, wel vóór een uitspraak): tien holdouts geschreven door een agent die de
prompts en evals niet kent, waarvan ≥ 3 live; en de SWIFT-fee in de simulatie gelijk aan live (€13,40).
