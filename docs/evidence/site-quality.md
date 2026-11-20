# Site quality: Lighthouse and axe on the public pages, 19 November 2026

Lighthouse and axe-core on five pages of https://kit11.max-31b.workers.dev, as deployed on the morning of 19 Nov:
`/`, `/try`, `/proof`, `/verify` and `/airwallex`. Read-only: every load is a GET, nothing was launched, signed or paid.
Figures as the tools gave them, none rounded up; the raw figures are in [site-quality.json](site-quality.json).

**In short.** Accessibility 100 and Best practices 100 on all 5 pages, mobile and desktop. Performance 100 on 4 of 5
pages on mobile and on 5 of 5 on desktop (median of 3 runs); `/try` on mobile is 95 and `/proof` on mobile 92, both from
Total Blocking Time. CLS 0 everywhere. SEO is 58 to 66 on the 4 pages served with `x-robots-tag: noindex, nofollow`
(set on purpose since 29 Oct), 100 on `/try`. axe: **0 critical**; **1 serious rule (color-contrast, 2 elements) on `/`
at 1440 px, measured mid-animation and gone at rest**; 1 moderate rule (`region`, 1 element) on every page at 390 px.

**Note, 20 November 2026.** By the owner's choice, `noindex, nofollow` was removed from the public pages (finding 7):
they are now sent without `x-robots-tag`, each with its canonical address, and listed in `/sitemap.xml` and
`/robots.txt` ([`src/lib/siteIndex.ts`](../../src/lib/siteIndex.ts)); the private and per-visitor pages, the JSON and
the assets keep it. The figures on this page were measured before that change and are left as measured.

## Lighthouse

Lighthouse 13.6.0, Chromium 153 (HeadlessChrome/153.0.0.0, Playwright's build 1243), `--headless --no-sandbox`, the
four categories only. **Mobile**: Lighthouse's default (a Moto G Power 2022 profile, simulated slow 4G: 150 ms RTT,
1.6 Mbps, 4x CPU slowdown). **Desktop**: `--preset=desktop` (40 ms RTT, 10 Mbps, no CPU slowdown). Throttling is
simulated (Lantern) from what the load really did on this machine: a cloud sandbox whose outbound HTTPS goes through a
proxy (its benchmark index 1269). Each page and preset was run 3 times, one at a time, from 09:26:51 to 09:39:08 UTC;
the table shows the run with the median performance score, and all 3 runs' figures follow it.

| Page | Preset | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT | FCP | Speed Index |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | mobile | 100 | 100 | 100 | 61 | 1,220 ms | 0 | 20 ms | 1,220 ms | 1,614 ms |
| `/` | desktop | 100 | 100 | 100 | 61 | 333 ms | 0 | 0 ms | 333 ms | 575 ms |
| `/try` | mobile | **95** | 100 | 100 | 100 | 2,130 ms | 0 | 196 ms | 1,725 ms | 2,508 ms |
| `/try` | desktop | 100 | 100 | 100 | 100 | 452 ms | 0 | 3 ms | 384 ms | 721 ms |
| `/proof` | mobile | **92** | 100 | 100 | 66 | 1,265 ms | 0 | 330 ms | 1,265 ms | 1,554 ms |
| `/proof` | desktop | 100 | 100 | 100 | 66 | 532 ms | 0 | 0 ms | 532 ms | 666 ms |
| `/verify` | mobile | 100 | 100 | 100 | 58 | 1,055 ms | 0 | 0 ms | 1,055 ms | 1,317 ms |
| `/verify` | desktop | 100 | 100 | 100 | 58 | 285 ms | 0 | 0 ms | 285 ms | 502 ms |
| `/airwallex` | mobile | 100 | 100 | 100 | 66 | 1,283 ms | 0 | 74 ms | 1,283 ms | 1,701 ms |
| `/airwallex` | desktop | 100 | 100 | 100 | 66 | 281 ms | 0 | 7 ms | 281 ms | 566 ms |

All three runs (performance; LCP; TBT): `/` mobile 100, 100, 100; 1,160, 1,220, 1,091 ms; 32, 20, 51 ms. `/` desktop
100 × 3; 285, 333, 315 ms; 0 × 3. `/try` mobile 95, 93, 97; 2,130, 1,882, 1,830 ms; 196, 221, 153 ms. `/try` desktop
**100, 100, 81**; 452, 486, 470 ms; 3, 63, **427** ms. `/proof` mobile 91, 92, 99; 1,351, 1,265, 1,277 ms; 389, 330, 107
ms. `/proof` desktop 100 × 3; 330, 532, 355 ms; 0 × 3. `/verify` mobile 100 × 3; 1,007, 1,055, 1,137 ms; 18, 0, 66 ms.
`/verify` desktop 100 × 3; 296, 285, 288 ms; 0 × 3. `/airwallex` mobile 100 × 3; 1,169, 1,283, 1,080 ms; 5, 74, 10 ms.
`/airwallex` desktop 100 × 3; 360, 281, 403 ms; 0, 7, 1 ms. CLS was 0 in all 30 runs. Accessibility and Best practices
were 100 in all 30.

Said plainly: the scores move between runs on this machine (`/try` desktop 81 once, from a 427 ms TBT; `/proof` mobile
91 to 99), so one run is not a figure to quote; the medians are. Lighthouse could not record its trace 4 times in all
("NO_NAVSTART": `/try` desktop in the first attempt of the series, then `/try` desktop run 2, `/proof` mobile run 2 and
`/airwallex` mobile run 3); each of those loads was run again 5 s later and only the completed run is counted.

## axe-core

axe-core 4.14.1 through @axe-core/playwright 4.14.0, in the same Chromium, each page at 390 × 844 (mobile, touch,
deviceScaleFactor 3) and 1440 × 900, light, 1.5 s after the load event; rules tagged WCAG 2.0, 2.1 and 2.2 A and AA,
and axe's best-practice rules. Counted per element.

| Page | Width | Critical | Serious | Moderate | Minor | Rules | Needs review (axe "incomplete") |
|---|---|---|---|---|---|---|---|
| `/` | 390 | 0 | 0 | 1 | 0 | `region` | none |
| `/` | 1440 | 0 | **2** | 0 | 0 | `color-contrast` | none |
| `/try` | 390 | 0 | 0 | 1 | 0 | `region` | color-contrast |
| `/try` | 1440 | 0 | 0 | 0 | 0 | none | color-contrast |
| `/proof` | 390 | 0 | 0 | 1 | 0 | `region` | none |
| `/proof` | 1440 | 0 | 0 | 0 | 0 | none | none |
| `/verify` | 390 | 0 | 0 | 1 | 0 | `region` | none |
| `/verify` | 1440 | 0 | 0 | 0 | 0 | none | none |
| `/airwallex` | 390 | 0 | 0 | 1 | 0 | `region` | none |
| `/airwallex` | 1440 | 0 | 0 | 0 | 0 | none | color-contrast, label-content-name-mismatch |

In all: 0 critical; 2 serious (1 rule, 1 page, 1 width); 5 moderate (1 rule, 5 pages at 390); 0 minor.

## Findings

Reported, not fixed here (other branches are changing these pages). In order of weight.

1. **axe, serious, `color-contrast`, `/` at 1440: `.hf-reader > b` ("Claude reader") and `.hf-reader > small`
   ("Payee, amount, account").** The chip of the home page's looping hero animation
   ([`src/redesign/heroFlow.ts`](../../src/redesign/heroFlow.ts) line 65, its timing `AT["hf-reader"]` line 83, its
   style line 108). axe met it while it was fading in (1.5 s after load; the loop shows it from 12 % and fades every piece
   out at 95 %). A re-check of the same page in the same browser at 1.5 s and again 5.5 s after load found 0
   contrast violations: at rest, the colours pass. So not a defect at rest, but for part of every loop the chip's words
   are drawn below 4.5:1; a person who reads slowly meets the same. If it should be clean whenever axe looks: fade the
   chip's border and dot, not its words, or honour `prefers-reduced-motion` with the final frame.
2. **axe, moderate, `region`, every page at 390 px: `.awx-row`** (the "Built on Airwallex" badge's own line under the
   header on a phone) sits outside every landmark. [`src/redesign/ui.ts`](../../src/redesign/ui.ts) line 283
   (`<div class="awx-row">` after `</header>`). Moving it inside `<header class="top">` would clear it on all 5 pages.
3. **Lighthouse, `/try` mobile 95 and `/proof` mobile 92: Total Blocking Time** (median 196 ms and 330 ms; up to 427 ms
   on `/try` desktop once). `/try` is one HTML answer of 515,693 bytes (175,927 sent, Brotli) with its whole app inline
   ([`cloud/src/tryPage.ts`](../../cloud/src/tryPage.ts)); Lighthouse counts 3.6 s of main-thread work on mobile, 53 KiB of
   JavaScript not used on first load, 39 KiB of unused CSS, 16 KiB of JavaScript and 10 KiB of CSS unminified. `/proof`
   is 204,008 bytes (41,563 sent) and has 11 KiB of unused CSS. The easy part is minifying the inline script and style;
   splitting `/try`'s app so the first screen runs less is the larger part.
4. **Lighthouse, every page: "Improve image delivery", est. 35 KiB.** The Airwallex logo is a 2435 × 334 PNG of 36,172
   bytes shown at 102 × 14 CSS px (179 × 25 device px on the phone profile). [`src/ui/builtOn.ts`](../../src/ui/builtOn.ts)
   (`AIRWALLEX_LOGO_PATH`, `AIRWALLEX_LOGO_SIZE`), the file `src/ui/logos/airwallex.png`, served by
   [`src/servers/dashboard.ts`](../../src/servers/dashboard.ts) line 96. The comment there says the official file is
   used unaltered: a copy scaled to, say, 3× the shown size (306 × 42) is the same artwork, smaller; the owner decides.
5. **Lighthouse, `/try`: one image without `width` and `height`**: `article.pp-card > div.pp-top > span.hw-logo > img`,
   made by `logoChip` in [`cloud/src/try/presentMode.ts`](../../cloud/src/try/presentMode.ts) line 887
   (`document.createElement('img')` with `src` and `alt` only). CLS was 0 in every run, so it costs nothing measured
   today; the attributes would keep it so.
6. **Lighthouse, every page: "Use efficient cache lifetimes", est. 33 to 36 KiB**: `/assets/inter.woff2`,
   `/assets/logo-airwallex.png` and `/assets/logo-claude-slate.svg` are sent with `cache-control: public, max-age=86400`
   ([`worker/src/core.ts`](../../worker/src/core.ts) lines 226 to 239). Lighthouse wants a longer life for files whose
   address does not change. Small.
7. **SEO 58 to 66 on `/`, `/proof`, `/verify` and `/airwallex`: `x-robots-tag: noindex, nofollow`** on every answer of the
   site ([`worker/src/core.ts`](../../worker/src/core.ts) line 144, `COMMON_HEADERS`; there since the relay Worker of
   29 Oct). `/try` is answered by Purser Cloud through a binding without it, and scores 100. A choice, not a slip: if the
   public pages should be findable, scope the header to the JSON and asset answers. Also on `/` and `/verify`:
   "robots.txt is not valid", which is Lighthouse's own fetch of `/robots.txt` from the page being refused by the page's
   CSP (`Protocol error … CSP violation`); the file itself answers 200.
8. **`/airwallex`: no back/forward cache**, because the page and a request it makes are sent with `cache-control:
   no-store` (`COMMON_HEADERS`). Lighthouse marks it "not actionable"; it only means Back reloads the page.

Lighthouse's audits for image alternative text, form labels (where the page has a form), button and link names,
`lang`, the document title, the meta description and viewport, target size, colour contrast, image aspect ratio and
resolution, and errors in the console passed in all 30 runs (Lighthouse's own contrast check runs on its loaded page;
axe's 1440 run on `/` met the hero mid-animation, finding 1).

## How to reproduce

Neither tool is a dependency of the repository. Install both, pinned, into a prefix of their own, then run the script
([`scripts/site-quality.ts`](../../scripts/site-quality.ts)):

```bash
npm i --prefix /dev/shm/qtools lighthouse@13.6.0 @axe-core/playwright@4.14.0
QTOOLS=/dev/shm/qtools CHROME_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome npm run site:quality
```

It writes `docs/evidence/site-quality.json` (every run's scores and metrics, the median run's failed audits, every axe
violation with its first 8 elements) and leaves the full Lighthouse reports in `SITE_QUALITY_OUT` (a temporary folder by
default). `--runs 1` for one run per page and preset, `--pages /,/try` for some pages, `--no-lighthouse` or `--no-axe`
for one tool, `--reuse` to resume a series that stopped. It is 30 Lighthouse loads and 10 axe loads, one at a time,
about 15 minutes; it calls nothing but GET. The script checks the installed versions against the pinned ones and stops
if they differ. `test/quality-proof.test.ts` checks the record covers every page, preset and width, and the script's
parsing (offline).
