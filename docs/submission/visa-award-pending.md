# The Visa Award: ready to flip, not flipped

Purser stays entered for the Metal Award only until Visa confirms in writing that the Airi run (Visa Intelligent
Commerce via Airwallex's Airi, 7 November; Airwallex sandbox, test card, test money; log
[docs/runs/2026-11-07-vic-1.md](../runs/2026-11-07-vic-1.md)) makes Purser eligible for the Visa Award; once it does,
and only then, flip these lines: on Home, `KIT_LINE` in `src/config/brand.ts` becomes `Kit 11 · x402 Business Agents ·
entered for the Metal Award and the Visa Award` (Home's award pill then reads "entered for the Metal Award and the Visa
Award"; leave `VISA_AWARD_ON` off, since it also adds "Visa TAP" to "Built on", and TAP is not the eligible tooling); in
the form (`docs/submission/README.md`, the Description), "Starter Kit 11 (x402 Business Agents), entered for the Metal
Award." becomes "Starter Kit 11 (x402 Business Agents), entered for the Metal Award and the Visa Award.", and to stay
under 4,000 characters (3,999 after the flip) awx-1's "; Airwallex declined two card charges; two SWIFT payouts carry
the CFO's signed hash." becomes ", two card declines by Airwallex, the CFO's hash on two SWIFT payouts." and "or in a
review after the money has left." becomes "or in a review after the money left."; then update the count above the
Description, the tests that hold the Metal-only wording (`test/submission.test.ts`, `test/airi-run-page.test.ts`,
`test/site-v4.test.ts`), the Visa row in `docs/claims.md` (with a "Was …" note) and `docs/evidence/README.md` (Visa's
confirmation, its date and where it was given), and leave the TAP sentence ("not eligible Visa tooling for this
hackathon (Visa, 5 Nov)") as it is, since it is about TAP and stays true, except its tail ", so Purser is entered for
the Metal Award only" (`VISA_TAP_STATUS` in `src/config/brand.ts`, the form's Links line), which would no longer be.
