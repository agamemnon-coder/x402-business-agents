# Plan: one integrated live run in a Northwind world

The judge review asked for one live run in which the controls that so far ran in separate test worlds all happen in
the same Northwind world, on the same afternoon: four eyes, the compliance contract, the receive policy, clearing, the
emergency stop and a bank-detail change. Max picks the time; Claude runs the commands; every approval is Max's Face ID.
Test money only (Airwallex sandbox, Metal testnet).

## Voor Max (kort)

- **Duur:** ongeveer 45 minuten. Houd je telefoon bij de hand; je keurt alles goed met Face ID.
- **Vooraf (jij):**
  - de beperkte Airwallex-sleutel in je eigen `.env` (checklist stap 1);
  - een tweede apparaat voor de "controller" (bijvoorbeeld je laptop met Touch ID), voor vier ogen.
- **Daarna:** Claude neemt de run op, en de pagina's tonen dan deze run in plaats van vrijdag run 1.

## The world

```bash
export KIT11_DB=data/live-1.sqlite KIT11_KEYS_DIR=../x402-business-agents-keys/live-1
```

A fresh ledger and its own keys folder; nothing from earlier worlds is reused. The four-eyes and compliance steps use
sub-folders of the same keys folder and write their records under `RUN_OUT=live-1-…`, so the earlier records stay.

## Steps

| # | What | Command (Claude) | Max | Proof |
|---|---|---|---|---|
| 0 | Preflight: keys work, scoped key, health | `npm run health` | — | output in the run log |
| 1 | Enrol two passkeys: CFO (phone) and controller (second device); set four eyes above €1,000 | `npm run relay -- --enrol` and `npm run passkey -- confirm <fp>` (CFO); `npm run passkey -- add controller` (second device); `npm run policy -- set approval.four_eyes_eur 1000 --reason "four eyes above €1,000"` | Face ID on each device; "Bevestig passkey &lt;fingerprint&gt;" in chat | `passkey.enrolled` ×2, `policy.changed` |
| 2 | The day (starts with bootstrap: fresh accounts, mandates, cards), now with Kit 11's monthly licence fee (EUR 240.00 to Stockline Data GmbH, step S3b): cards, the price rise refused on chain, the mandate replace, the euro bill (€1,850, above €1,000: **both passkeys**), fraud and planted instructions | `npm run demo:all` | Face ID; the controller approves the invoice too | the usual run proofs; two passkey approvals on the invoice |
| 3 | Clearing: Summit prepays and buys by receipt | `npm run clearing -- deposit 5.00`; `npm run clearing -- buy 60 69`; later `npm run clearing -- withdraw` | — | deposit tx, receipts, claim tx |
| 4 | Receive policy on the sweep wallet; a stranger pays 0.02 (dev test); held; returned | `npm run receive-policy -- setup`; `npm run receive-policy -- stranger`; `npm run receive-policy -- poll` | Face ID to return it | policy tx, held payment, return tx |
| 5 | Bank-detail change for Bergtex, all three steps | `npm run payee -- request …`; `npm run payee -- verified <id> --by Max --how "…"`; `npm run payee -- propose <id>` | makes the call; Face ID | `payee_changes` rows, approval |
| 6 | Emergency stop, live: pull and lift | dashboard **Emergency stop**; `npm run cards` (all INACTIVE); a card charge declined `CARD_INACTIVE`; `npm run policy -- set freeze off --reason "drill"` | Face ID twice | `emergency_stop` alarm, decline id, lift approval |
| 7 | Four eyes on chain, same afternoon, same keys folder | `KIT11_KEYS_DIR=$KIT11_KEYS_DIR/four-eyes RUN_OUT=live-1-four-eyes npm run four-eyes` | — | reverted and passed transactions |
| 8 | Compliance contract, same afternoon | `KIT11_KEYS_DIR=$KIT11_KEYS_DIR/compliance RUN_OUT=live-1-compliance npm run compliance-policy` | — | 11 reverted attacks |
| 9 | Finality certificates while fresh (runner running), verify, record | runner keeps running ≥ 5 min; `npm run verify`; `npm run audit:export`; `npm run demo:record` | — | REPORTED certificates for this run's transactions; a new audit chain |
| 10 | Dispute desk on this run | `npm run dispute -- never_ordered 5-16 "…"` | — | the case and its report |

## Honest limits, said in the run log

- Steps 7 and 8 run their own accounts inside this world's keys folder: Northwind's main account stays one-owner. On
  chain, four eyes is shown on a 2-of-2 account; off chain (steps 1 and 2) a second person's passkey is required above
  €1,000 on Northwind's own payments.
- Step 4's stranger is a test key we control (labelled as a dev test).
- The emergency stop is pulled in the sandbox; Metal mandates stay bound while frozen (Purser refuses to sign).

## After the run

- Run log `docs/runs/<date>-live-1.md`; dossiers, claims and requirements matrix point to it.
- Re-record the pages (`npm run demo:record`), regenerate the submission pack (`npm run submission`), redeploy.
