# Product media

Recorded with Playwright from the **live** sites by `npm run media:record` (scripts/media-record.ts). Nothing is staged or mocked. Every company in them is a test company, and all money is test money.
No secret, viewer key, token or jury link is visible in any frame or URL: the hands-on demo and Purser Cloud's guest keep their sessions in browser storage.

**The passkey in the /try clip is not a person's.** It is Chromium's virtual WebAuthn authenticator, a test passkey whose user presence is simulated. No phone and no Face ID are involved. In the product, the CFO's own passkey signs.

## Clips (each at most 15 s; GIFs at most 5 MB)

### books

kit11 /books: a test company's month, read and booked by Claude live; balance sheet, charts and the invoices sorted by Claude. Test money.

Source: https://kit11.max-31b.workers.dev/books · recorded 2026-11-13 · sped up 1.1x to fit 15 s

File | Type | Size | Length | Recorded
--- | --- | --- | --- | ---
[books.gif](books.gif) | GIF | 4.67 MB | 14.3 s | 2026-11-13
[books.mp4](books.mp4) | MP4 | 1.70 MB | 14.4 s | 2026-11-13
[books.webm](books.webm) | WEBM | 1.55 MB | 14.3 s | 2026-11-13

### cloud-dashboard

Purser Cloud as a guest: the demo company's dashboard (made-up data from a simulated month, test money), then its books.

Source: https://purser-try.max-31b.workers.dev/ (Try as guest) · recorded 2026-11-13 · sped up 1.1x to fit 15 s

File | Type | Size | Length | Recorded
--- | --- | --- | --- | ---
[cloud-dashboard.gif](cloud-dashboard.gif) | GIF | 4.26 MB | 13.4 s | 2026-11-13
[cloud-dashboard.mp4](cloud-dashboard.mp4) | MP4 | 0.96 MB | 13.4 s | 2026-11-13
[cloud-dashboard.webm](cloud-dashboard.webm) | WEBM | 1.02 MB | 13.4 s | 2026-11-13

### proof

kit11 /proof: every claim with its run record.

Source: https://kit11.max-31b.workers.dev/proof · recorded 2026-11-13 · real time

File | Type | Size | Length | Recorded
--- | --- | --- | --- | ---
[proof.gif](proof.gif) | GIF | 1.17 MB | 12.5 s | 2026-11-13
[proof.mp4](proof.mp4) | MP4 | 0.16 MB | 12.5 s | 2026-11-13
[proof.webm](proof.webm) | WEBM | 0.22 MB | 12.5 s | 2026-11-13

### try-flow

The hands-on demo, end to end: a test company files a sample invoice, Claude reads it, Pay, the approval passkey (Chromium's virtual authenticator: a test passkey, no person or phone), paid on the simulated bank, booked and filed. Test money.

Source: https://kit11.max-31b.workers.dev/try · recorded 2026-11-13 · sped up 2x to fit 15 s

File | Type | Size | Length | Recorded
--- | --- | --- | --- | ---
[try-flow.gif](try-flow.gif) | GIF | 3.48 MB | 14.3 s | 2026-11-13
[try-flow.mp4](try-flow.mp4) | MP4 | 0.38 MB | 14.4 s | 2026-11-13
[try-flow.webm](try-flow.webm) | WEBM | 0.41 MB | 14.3 s | 2026-11-13

## Screenshots (first screen, device scale 2)

Page | 1440 px | 390 px | Source | Recorded
--- | --- | --- | --- | ---
books | [books-1440.png](books-1440.png) | [books-390.png](books-390.png) | https://kit11.max-31b.workers.dev/books | 2026-11-13
cloud-dashboard | [cloud-dashboard-1440.png](cloud-dashboard-1440.png) | [cloud-dashboard-390.png](cloud-dashboard-390.png) | https://purser-try.max-31b.workers.dev/ (Try as guest) | 2026-11-13
home | [home-1440.png](home-1440.png) | [home-390.png](home-390.png) | https://kit11.max-31b.workers.dev/home | 2026-11-13
metal | [metal-1440.png](metal-1440.png) | [metal-390.png](metal-390.png) | https://kit11.max-31b.workers.dev/metal | 2026-11-13
proof | [proof-1440.png](proof-1440.png) | [proof-390.png](proof-390.png) | https://kit11.max-31b.workers.dev/proof | 2026-11-13
try | [try-1440.png](try-1440.png) | [try-390.png](try-390.png) | https://kit11.max-31b.workers.dev/try | 2026-11-13
visa | [visa-1440.png](visa-1440.png) | [visa-390.png](visa-390.png) | https://kit11.max-31b.workers.dev/visa | 2026-11-13

Every file, with its exact recording time and size: [media.json](media.json).
