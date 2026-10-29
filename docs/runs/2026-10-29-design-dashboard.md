# Run log: the dashboard and landing in the design system, with real recorded data, 2026-10-29

This log covers Max's five points on the dashboard, built in `f3ef68a` and `3f71586`. A fresh, independent review
of the page found 11 issues; they were fixed in `3f71586`. The relay was deployed after the fix, about 21:30 UTC.
The runner (rehearsal 3) was stopped for the deploy and restarted after it.

## Max's five points, and where each one is

1. **Real data from the recorded live runs, labelled.**
   - The landing figures come from the rehearsal-3 ledger: 120 actions alone, 17 blocked, €0 above a card's limit,
     2 fake invoices and 4 AI tricks stopped, and 8 Face ID decisions.
   - `/?recorded` shows the full CFO dashboard as it stood at the end of that run.
   - Both say "Recorded run of …, real data from the Airwallex sandbox and Metal testnet".
   - Source: `docs/demo/snapshot.json`, written by `npm run demo:record` (`src/demo/recorded.ts`). Nothing is typed
     in.
   - "€0 above a card's limit" replays every approved card charge against the per-purchase and monthly limits that
     card had at that moment. The recording is refused if a charge has no limit on record.
   - The month page stays labelled "Simulated month".
2. **On-chain budgets (Metal), as visible as the cards.**
   - A tile per agent mandate shows the cap per payment, used of total, the one payee, the end date, and how often
     the CFO changed it with Face ID.
   - A tile for the prepaid clearing shows paid by receipt, withdrawn, and the requests in this ledger.
3. **Currency.** Metal amounts read "test USD", never "$". Euros show as €1,850.00. This holds on the dashboard, the
   demo and the month page.
4. **Bank transfers versus cards.**
   - Transfers and invoices carry a bank icon and "Bank transfer · SWIFT", in the activity and in the pending list.
   - The recorded activity always includes the SWIFT rows, so the €1,850 transfer is visible apart from the €500
     card limit.
5. **Emergency stop with Face ID.**
   - The button opens a sheet: "You confirm with Face ID on the next screen; nothing changes before that."
   - The policy page then asks "Confirm with Face ID". Only the passkey's signature, verified on the runner, turns
     the stop on.
   - Screenshots: `docs/screens/stop-sheet.png`, `stop-faceid.png`, `stop-frozen.png`.

## Checks

| Check | Result |
|---|---|
| `npm test` | 350 passed |
| `npm run typecheck` and the Worker's `tsc --noEmit` | clean |
| `npm run judge -- --check` | `/`, `/demo` and `/month` all 200 |
| Page check, local: `/`, `/?recorded`, `/demo` (every step), `/month`; 390 and 1440 px; light and dark | passes |
| Page check against the hosted relay (`--live`) | passes |
| Phone browser check (`test/browser/approve.check.ts`), including 8 new emergency-stop steps | passes |

The page check now measures width against the device. A phone browser widens its viewport to fit an overflowing
page, so the old check missed a 35 px overflow on phones. It was caused by the card transaction rows and by a long
address in the refusals list. Both are fixed.

## What the review found, and the fix

- **"For you to decide" on finished proposals.** Activity rows for executed, rejected and expired proposals now say
  so.
- **The clearing figures looked contradictory.** Earned showed 0.35, but 0.70 was withdrawn.
  - The truth: the customer paid 0.70 by receipt. Of that, 0.35 came from the first live probe before this ledger
    started, and 0.35 from this run. All 0.70 was withdrawn (Metal tx `0x5224…5092`).
  - The tile now shows exactly that, with the note.
- **A decline listed twice.** Airwallex reported the €61.00 decline under two ids. The list shows it once after the
  merge.
- **Figures without a unit.** Metal amounts in the ledger texts now carry USDZ, shown as test USD, and policy
  changes carry their unit.
- **`plain()` also regrouped IBANs and dates.** It now formats only amounts beside a currency.
- **After a 401, the status timer kept running.** It is now stopped, and the stale viewer key is forgotten.
- **The emergency-stop dialog.** It is now a modal `<dialog>`: focus stays inside, Escape closes it, and focus
  returns to the button.
- **Contrast in dark mode.** White on red was 2.8:1; it now uses dark ink.
- **The font URL was absolute.** It is now relative.
- **Visual details.** Card names are capitalised, long names are clipped, and the panels no longer stretch.

Not changed: landing animation rows can be mid-animation in a screenshot. This is the intended loop; with reduced
motion they are static.

## Design system

- **Inter** (OFL, `src/ui/inter.woff2`), served as `/assets/inter.woff2` by every host.
- **Lucide icons** (ISC), built with `createElementNS`; no markup is parsed.
- **Colours:** one accent (#4f46e5, dark #8b87ff), and green, amber and red only for status.
- The same tokens are used on the dashboard, the demo, the month and the phone pages.
- The CSP gains `font-src 'self'` and nothing else.
