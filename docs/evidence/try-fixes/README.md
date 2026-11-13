# /try fixes (13 Nov 2026), before and after

All screenshots are from a local run: the real cloud and engine on localhost, test money on the simulated bank,
a Chromium virtual passkey. Nothing live was called. Claude was off, so the agents' timeline rows in `after/*-3-work-timeline.png`
are stood in for by `test/browser/try-review.check.ts` (labelled there): the same event shapes the engine writes.

## before/ (origin/main)

- `390-light-*-dup-sample.png`: "The same invoice, sent twice" in a fresh company came back **Ready to pay** and could be paid.
- `*-5-paid.png`: the ledger at 390 px cut off the Credit column ("EUR 1,85"); "Open Purser Cloud" led to the guest demo.
- `*-3-approve.png`: the approval showed the amount, payee, account and due date only.
- `guest-390-light.png`: the Cloud guest view's tab row ran past the screen edge, cutting off "Settings".

## after/ (try-fixes-1113)

`<width>-<scheme>-<step>.png` at 360, 390 and 1440 px, light and dark:

1. `1-duplicate`, `1-renumbered`: each new test company starts with Bergtex's BTX-2026-17 already paid (seeded,
   no money moved), so both duplicate samples are caught.
2. `3-work-timeline`: no empty or repeated rows, "its own words" only on a model's reason, the Coder's VAT line says
   Purser's code books the VAT (as the ledger shows), one clock. At 1440 the answer and "Pay this invoice" sit
   left of the steps, above the fold.
3. `4-approve`: conversion, bank fee cap and the deadline are rows; the full terms are pretty-printed in the fold.
4. `5-paid`: Paid, Booked and Filed blocks (skeletons while they load); the ledger stacks Dr/Cr on a phone,
   amounts right-aligned in tabular figures; "File another invoice"; the Cloud link reads "See a sample company in
   Purser Cloud" with a note.
5. `6-company`: "Start again" asks first.
6. `guest-360-light.png`, `guest-390-dark.png`: all five Cloud tabs fit.
