<a href="../../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="purser-mark-dark.svg"><img src="purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Brand assets

Purser's mark and the "Built on Airwallex" badge: what each file is, where it is used, and what checks it.

| At a glance | Record |
|---|---|
| **One mark**, the site header's own: a white feather on a dark rounded square | [purser-mark.svg](purser-mark.svg) · `test/brand-mark.test.ts` |
| **"Built on Airwallex"**, the official logo unaltered; no partnership or endorsement implied | [SOURCES.md](../logos/SOURCES.md) · `src/ui/builtOn.ts` |

## Purser's mark

`purser-mark.svg` is the mark in the site's header (`src/ui/nav.ts`, `MARK` and `header.top .brand .mark`): a white
feather, 16 of 30 units wide, centred on a dark rounded square (`#0b1220`, corner radius 9 of 30). The README's top
uses it; `test/brand-mark.test.ts` checks it against the header's own paths and proportions. The social preview
(`docs/assets/social-preview.svg`) carries the same mark. `purser-mark-dark.svg` is the same mark in reverse (a light square, a dark
feather), for the dark theme of the READMEs' headers.

## Built on Airwallex (14 Nov 2026)

One badge, "Built on" and the official Airwallex logo (`src/ui/logos/airwallex.png`, unaltered;
[SOURCES.md](../logos/SOURCES.md)), from `src/ui/builtOn.ts`: in the site's header on every page that carries it (Home,
/try, /proof, /docs, Purser Cloud), beside the brand from 760 px and on its own line under the header on a phone, and
in the console's footer (on a phone, signed out: in the console's app bar; on /try's start: over the band's empty
top, so the first screen keeps its card). A white pill in both themes (the file is a dark wordmark with no light version), the logo
14 px high, below Purser's 30 px mark. The link preview (`built-on-airwallex-og.png`, the same file as
`../social-preview.png` and `src/ui/brand/og.png`, served as `/assets/og-1121.png` since 21 Nov, the new design with the badge on a white pill) says it too. "Built on" only: no
partnership or endorsement implied. Screenshots, rendered locally before the deploy:

| File | What |
|---|---|
| `built-on-airwallex-og.png` | The link preview, 1200 × 630 |
| `built-on-airwallex-home-1440-light.png`, `-home-1440-dark.png`, `-home-390-light.png` | Home's header, laptop and phone |
| `built-on-airwallex-try-1440-light.png`, `-try-390-light.png`, `-try-390-dark.png` | /try's header (start screen), laptop and phone |
| `built-on-airwallex-try-finish-390-light.png` | /try's finish ("What Purser did with it"), phone |
