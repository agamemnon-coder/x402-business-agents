<div align="center">

<a href="../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/brand/purser-mark-dark.svg"><img src="assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Gallery

**Purser in pictures: the site, the phone, the console and four animations, light or dark as your GitHub is.**

[![Pictures from the site and the records](https://img.shields.io/badge/pictures-from_the_site_and_the_records-5996f9?style=flat-square&labelColor=1f2937)](#gallery)&nbsp;[![Four animations, CSS only, still under reduced motion](https://img.shields.io/badge/animations-4_%C2%B7_CSS_only_%C2%B7_still_under_reduced_motion-0ea5e9?style=flat-square&labelColor=1f2937)](#animations)&nbsp;[![Light and dark, as your GitHub is](https://img.shields.io/badge/themes-light_%C2%B7_dark-10b981?style=flat-square&labelColor=1f2937)](#gallery)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-f59e0b?style=flat-square&labelColor=1f2937)](../README.md#built-with)

[The pictures](#gallery) · [Animations](#animations) · [See it](see-it.md) · [Charts](charts.md) · [/try](https://kit11.max-31b.workers.dev/try)

</div>

Moved from the [README](../README.md) on 15 November, to keep it short.

<table>
<tr><td width="50%" align="center"><a href="https://kit11.max-31b.workers.dev/try"><img src="assets/readme/try-phone.webp" alt="/try on a phone: the approval with the exact terms, the conversion, the bank fee's cap and the deadline; test money" width="62%"></a><br><b>/try on a phone</b>: the approval with the exact terms (recorded from the live page; test money, a virtual test passkey)</td><td width="50%" align="center"><a href="https://kit11.max-31b.workers.dev/proof"><img src="assets/readme/proof.webp" alt="/proof: each claim with its id, its code and its run"></a><br><b>/proof</b>: what Purser guarantees, who enforces it, the evidence</td></tr>
<tr><td width="50%" align="center"><a href="https://purser-try.max-31b.workers.dev/"><img src="assets/readme/cloud-guest.webp" alt="Purser Cloud as a guest: the demo company's overview, made-up data, test money"></a><br><b>Purser Cloud as a guest</b>: the demo company, made-up data, test money</td><td width="50%" align="center"><a href="https://kit11.max-31b.workers.dev/security"><img src="assets/readme/security.webp" alt="/security: the layers a payment must pass"></a><br><b>/security</b>: the layers a payment must pass</td></tr>
</table>

<a href="https://kit11.max-31b.workers.dev/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-dark.webp"><img src="assets/readme/hero-light.webp" alt="Purser's Home page: AI agents spend. You sign off. One sample invoice from Read to Paid (a local build of this repository)" width="100%"></picture></a>

*Home, light or dark as your GitHub is: one sample invoice from Read to Paid.*

<a href="https://kit11.max-31b.workers.dev/"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/banner-dark.png"><img src="assets/readme/banner-light.png" alt="Purser: AI agents spend. You sign off. Passkey on the exact terms · Limits enforced in 3 layers · Books matched to the cent" width="100%"></picture></a><br><picture><source media="(prefers-color-scheme: dark)" srcset="assets/hero/flow-dark.svg"><img src="assets/hero/flow-light.svg" alt="Purser's flow, animated: an agent asks to pay EUR 240.00; Airwallex's card controls, Alta (formerly Metal)'s mandate and the CFO's passkey hold in turn; the passkey signs the SHA-256 of the exact terms; one cent changed (EUR 240.01) and the signature no longer matches: refused. An illustration; test money." width="100%"></picture>

*The banner and the animated flow (an illustration; test money), which opened the README until 21 Nov 2026, when the owner asked for the logo, the tags, a small demo and the three steps on top.*

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stats-dark.svg"><img src="assets/readme/stats-light.svg" alt="Four figures from the records: 10,239 tests passing in the last full run (docs/assets/test-summary.json); 24 Claude decisions and 86 Alta payments in the main run of 3 November; 0 wrong payments in the worst-case AI test" width="100%"></picture>

*Four figures from the records: the last full test run, and the main run of 3 November (Claude's decisions and the Alta payments in that run; the worst-case AI test of 15 Nov). Newer figures: the proof strip and /proof's evidence wall.*

## Animations

Drawn from their records by `npm run docs:anim` ([scripts/docs-anim.ts](../scripts/docs-anim.ts)); still for a
reader who asks for reduced motion.

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/anim/money-path-dark.svg"><img src="assets/anim/money-path-light.svg" alt="Animated: one payment's path. An AI agent proposes; Purser's checks in code; above the limit the CFO's passkey (Face ID) signs the exact terms; the rail's own control (Airwallex, Alta); then the books. Each step can stop the payment. Test money only." width="100%"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/anim/one-cent-dark.svg"><img src="assets/anim/one-cent-light.svg" alt="Animated: one changed cent breaks the signature. EUR 1,850.00 to Bergtex Textil GmbH hashes to f168e40f…ec5d, which the CFO's passkey signed: paid. The same signature sent with EUR 1,850.01 hashes to aa4e2b59…0aca: refused. The /try samples of 15 Nov 2026, test money." width="100%"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/anim/hash-chain-dark.svg"><img src="assets/anim/hash-chain-light.svg" alt="Animated: the books as a hash chain. Entries 3 to 6 of the /try payment, each hash over the previous one; change one entry and every hash after it breaks. Test money." width="100%"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="assets/anim/emergency-stop-dark.svg"><img src="assets/anim/emergency-stop-light.svg" alt="Animated: the emergency stop. One Face ID sets freeze; every agent payment is refused and every agent card is set INACTIVE at Airwallex, so a charge declines CARD_INACTIVE. Tested against stand-ins; CARD_INACTIVE checked live on a single card; the full stop has not been pulled live end to end." width="100%"></picture>
