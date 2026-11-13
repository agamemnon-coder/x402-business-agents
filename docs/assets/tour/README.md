# Product tour screenshots

The four images on `/tour` (src/redesign/tour.ts), each 1200 x 750 WebP, taken on 13 November 2026:

| File | What it shows | Where it came from |
|---|---|---|
| `tour-try.webp` | The hands-on demo's start screen (`/try`) | Captured from this repository's build (a local Purser Cloud, the same page the site serves at `/try`), so it shows the current menu and copy |
| `tour-proof.webp` | `/proof` | `docs/assets/media/proof-1440.png`, recorded from the live site by `npm run media:record` |
| `tour-cloud.webp` | Purser Cloud as a guest: the demo company's overview | `docs/assets/media/cloud-dashboard-1440.png`, recorded from the live site by `npm run media:record` |
| `tour-connect.webp` | The docs' "Connect your AI" card, its guest steps open | Captured from this repository's build (`npm run judge` serves the same `/docs`) |

Every company in them is a test or demo company; all money is test money. No secret, session or viewer key is visible:
the only token shown is the demo company's public, read-only connector token, `purser-demo-read-only`.
