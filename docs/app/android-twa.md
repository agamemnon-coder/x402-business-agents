# Purser in Google Play: a Trusted Web Activity

A Trusted Web Activity (TWA) is an Android app that opens the site full screen in Chrome, with no browser bar, once the
site says that app may do so. It is the same web app as on [the README](README.md), the same passkeys, the same service
worker; Google Play only adds the listing. Building and signing it is the owner's step: nothing here builds an APK.

What you need: Node.js, a JDK 17 and the Android SDK (Bubblewrap offers to download both), and, to publish, a Google
Play developer account (a one-time $25).

## 1. Make the project with Bubblewrap

```bash
npm i -g @bubblewrap/cli
mkdir purser-android && cd purser-android
bubblewrap init --manifest https://kit11.max-31b.workers.dev/manifest.webmanifest
```

Bubblewrap reads the app's name, colours, icons (including the maskable one) and shortcuts from the manifest. Answer:

- **Domain**: `kit11.max-31b.workers.dev` (or the site's own domain, if it moves to one).
- **Start URL**: `/app`.
- **Application ID** (the package name): for example `dev.purser.app`. It cannot change once published.
- **Signing key**: let Bubblewrap make `android.keystore`. Keep it, and its passwords, out of this repository.

## 2. Build

```bash
bubblewrap build
```

This writes `app-release-signed.apk` (to install on a phone for a test: `adb install app-release-signed.apk`) and
`app-release-bundle.aab` (for Google Play).

## 3. Let the site vouch for the app

Until the site publishes the app's key, Android opens the app with a browser bar. To remove it:

1. Get the SHA-256 fingerprint of the key that signs the app the phone installs:
   `bubblewrap fingerprint list`, or `keytool -list -v -keystore android.keystore`. With Play App Signing, use the one
   Google shows in Play Console, under Setup, App integrity, App signing key certificate.
2. Copy [`assetlinks.template.jsonc`](assetlinks.template.jsonc) to `docs/app/assetlinks.json`, delete its comment
   lines, and put in your package name and that fingerprint.
3. Deploy the site (`npm run relay:deploy`). The Worker then serves the file at `/.well-known/assetlinks.json`
   (`src/relay/assets.ts`); without the file it serves nothing there.
4. Check it with Google's tool: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://kit11.max-31b.workers.dev&relation=delegate_permission/common.handle_all_urls`.

## 4. Publish

Upload `app-release-bundle.aab` in Play Console as a new app, with the store listing, the data-safety answers (the app
collects nothing the site does not: it is the site) and a test track first.

## Notes

- The passkey works in a TWA as in Chrome: it is the same origin, and Chrome runs the page.
- Notifications in a TWA are the site's Web Push, through Chrome ([README.md](README.md#what-works)).
- A new version of the site needs no new app: the TWA always loads the live site. Rebuild only for a new icon, name or
  start URL.
