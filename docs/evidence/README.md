<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Evidence

What the organisers answered in the hackathon Slack, in our own words, and the verification reports this folder keeps.

| At a glance | Record |
|---|---|
| **Entered for the Metal Award and the Visa Award** since 7 Nov; the Visa Award on the Airi run, never on TAP | [decisions.md](../decisions.md) (D27, D28) |
| **189 checks passed**, 3 could not run here, 0 failed (15 Nov, `npm run verify-all`) | [verification-2026-11-15.md](verification-2026-11-15.md) · [.json](verification-2026-11-15.json) |
| **Airwallex API coverage**: 56 endpoints the code calls; 45 in a committed sandbox run record, 3 named only by tests, 8 in the code only (19 Nov, `npm run airwallex:coverage`, offline) | [airwallex-api-coverage.md](airwallex-api-coverage.md) · [.json](airwallex-api-coverage.json) |
| **Tamper matrix**: every signed field of the 6 receipts and proof bundles committed here changed by one step (a cent, a digit, a letter, a second); 894 changed copies, 894 refused, 0 accepted; all 6 originals verify (19 Nov, `npm run tamper-matrix`, offline) | [tamper-matrix.md](tamper-matrix.md) · [.json](tamper-matrix.json) |

Also here: [mutation testing](mutation-testing.md) ([.json](mutation-testing.json)), partial. These are bugs planted in the money-critical code to see whether the tests catch them. The proof-bundle verifier caught 15 of 51 before and 50 of 51 after the new tests. Four Stryker groups were measured before the new tests; the approval group is not finished (`npm run mutation`, offline).

## What the organisers answered

The screenshots that were here were removed on 4 November 2026: they showed people's names and messages.

| When | Where | What was answered |
|---|---|---|
| 30 October 2026 | the hackathon Slack, #treasury-kits-1-and-3 | Another builder asked seven questions, and Airwallex answered them: judges review the video, the code and the write-up; a ring-fenced budget inside the sandbox wallet, an offline mock mode as a backup and calling the REST API directly at run time are all fine; beneficiaries may be created once and reused; the transfer simulation call is adequate (webhooks are not required); an outside LLM (Claude) is allowed, and builders got Claude API credits. |
| 1 and 2 November 2026 | the hackathon Slack, #help (our thread) | We asked two questions. One project may be considered for both the Visa and the Metal Award: yes. Whether a TAP integration built on Visa's reference counts as Visa tooling: first answered yes, then edited to "TBD", and Airwallex added someone from Visa to the thread. |
| 5 November 2026 | the hackathon Slack (Visa, in our thread) | Visa answered the open question: TAP is not available as Visa tooling for this hackathon; the only Visa tooling for the builds is Visa Intelligent Commerce (VIC) or Intelligent Commerce Connect (ICC). So, until 7 November, Purser was entered for the Metal Award only (`docs/decisions.md` D27); since 7 November it is entered for the Metal Award and the Visa Award (the next row). |
| 7 November 2026 | the hackathon Slack (Visa), as reported by the owner | Visa: the VIC run counts for the Visa Award. The run is the Airi run of 7 November, Visa Intelligent Commerce via Airwallex's Airi (Airwallex sandbox, test card, test money; log `docs/runs/2026-11-07-vic-1.md`). So Purser is entered for the Metal Award and the Visa Award (`docs/decisions.md` D28). Nothing changed about TAP. |

## What we say since

Since 7 November: entered for the Metal Award and the Visa Award; the Visa Award on the Airi
run (Visa Intelligent Commerce via Airwallex's Airi), never on TAP. "Visa TAP: built and verified against Visa's public
reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov)." No page may say TAP is eligible, or
that TAP or Purser is certified, endorsed or confirmed by Visa.

From 5 to 7 November we said Purser was entered for the Metal Award alone, because Visa had said TAP is not eligible
Visa tooling for this hackathon (5 Nov). That ended on 7 November (above).

From 2 to 5 November we said: "Entered for the Visa Award (organisers confirmed one project may enter both Visa and
Metal; whether TAP counts as Visa tooling is still being confirmed with Visa)."
