# Purser as an app on your phone

Purser installs on iPhone and Android as a Progressive Web App: no app store, no fee. It opens full screen with its own
icon and launch screen, and your passkey (Face ID or fingerprint) signs approvals in it as it does in the browser. Test
money only, as everywhere in Purser.

Two addresses can be installed, each as its own app:

| Address | What the app opens | Starts at |
|---|---|---|
| The site, `https://kit11.max-31b.workers.dev` | The CFO's dashboard, what waits for your signature, the passkey pages (`/approve/P-…`, `/enrol`, `/policy`), and `/proof` | `/app` |
| Purser Cloud (`https://purser-try.max-31b.workers.dev`, or your own cloud's address) | The console, where invoices wait for your Face ID | `/#/invoices` |

## Install on iPhone

1. Open the site in **Safari** with the private link the runner gave you (it ends in `#view=…`), or open Purser Cloud
   and sign in.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Purser** from the Home Screen. It runs full screen, with the navy launch screen and a dark status bar.

On iPhone, a Home Screen app keeps its own storage, apart from Safari's. If the site's app opens on "Open Purser on this
phone", paste your private link there once (copy it from where the runner gave it to you). The key goes to the
dashboard's address after `#` and stays on the phone; it is never sent to a server. Purser Cloud asks you to sign in
once, with your passkey.

## Install on Android

1. Open the same address in **Chrome**.
2. Tap **Install app** when Chrome offers it, or the menu (⋮), then **Add to Home screen** and **Install**.
3. Open **Purser** from the launcher. Chrome draws the launch screen from the app's name, icon and navy background.

A long press on the icon shows two shortcuts: **Waiting for my signature** and **Proof**.

An Android app in Google Play, made from the same site as a Trusted Web Activity, is the owner's step:
[android-twa.md](android-twa.md).

## What works

- **Passkeys and Face ID in the app.** The app is the same origin as the site, so the passkey you enrolled on it signs
  in it, after Face ID or fingerprint. Nothing about the signature changed: the page checks the terms' hash itself, and
  the runner (or Purser Cloud's engine) verifies every signature.
- **Offline.** The app opens without a connection and says so plainly: "Offline: nothing can be approved without a
  connection." It stores the app's shell (the offline page, the stylesheet, the font, the icons), named after the build,
  and nothing else.
- **Never a stale approval.** The service worker ([`src/pwa/sw.ts`](../../src/pwa/sw.ts)) never stores a page and never
  touches `/api/`, `/v1/`, `/approve/`, `/enrol`, `/policy`, `/try`, OAuth or the approval page's script. Every page
  comes from the network; the terms, the challenge and the signature always do. `test/pwa.test.ts` runs the worker
  itself on fake requests to hold this.
- **Notifications ("Notify me").** On the site's dashboard, under "Waiting for you", once the relay has its Web Push
  keys. Tap it and allow notifications: when a payment waits above the agents' limit, the phone shows "Payment needs
  your signature" with the proposal's id, and a tap opens its passkey page. No amount or payee is in the notification.
  On iPhone this needs iOS 16.4 or later and the Home Screen app (Safari itself offers no Web Push to a site); on
  Android, Chrome. Purser Cloud's console has no notifications yet.

### Turning notifications on (the owner)

The relay sends Web Push itself (standard VAPID and aes128gcm encryption, [`worker/src/webPush.ts`](../../worker/src/webPush.ts)),
to the push services of Apple, Google, Mozilla and Microsoft only. It needs a key pair, as Worker secrets, never in a file:

```bash
npx tsx scripts/vapid-keys.ts        # prints a new pair, stores nothing
cd worker
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT   # mailto:you@example.com
```

Without the three secrets the relay sends nothing and the dashboard shows no "Notify me".

## What a native App Store app would add later

The web app covers the CFO's job: see what waits, check the exact terms, sign with Face ID. A native iPhone app would
add an App Store listing, notifications that do not depend on the Home Screen app, and widgets or a lock-screen action.
It needs:

- **Apple's developer account, $99 a year**, to sign and publish any iPhone app.
- **A build service in the cloud: Expo's EAS Build.** An Expo (React Native) app is built and signed by EAS on Apple's
  own build machines and sent to App Store Connect with `eas submit`, so **no Mac is needed**.
- The passkey would then live in the app through the platform's own passkey API, with the site's domain as an
  Associated Domain (`apple-app-site-association`), so the passkey you already have still signs.

None of that is built yet; the web app is the free way that works today.

## How this was checked

- `npx vitest run test/pwa.test.ts`: the manifest's fields and scope, its icons (the committed PNG files, their sizes,
  the same bytes both Workers serve), the pages' tags, every new answer's security headers and CSP, the service worker
  itself run on fake requests (nothing under `/api/`, `/v1/`, `/approve/` or the passkey ceremony is answered from a
  cache or stored, even with a planted stale copy; offline, an approval page is the offline page), and Web Push against
  a fake push service that checks the VAPID signature and decrypts the message (and RFC 8291's own example, byte for
  byte).
- `npx tsx test/browser/pwa.check.ts [screenshot dir]`: in Chromium against the local relay, Chromium's own
  installability check (no errors on `/app`, the dashboard, `/approve/P-…` and `/enrol`), the worker in control, its one
  cache holding only the shell, `/api/` never answered by the worker, the offline page offline, and `/app` taking a
  pasted link. Screenshots at 390 px.
- Lighthouse is not used for this: since Lighthouse 12 it has no PWA or installability category, and
  `npm run site:quality` measures the deployed site.
