// npx tsx scripts/vapid-keys.ts: a new VAPID key pair for the relay's Web Push (worker/src/webPush.ts,
// docs/app/README.md), printed once, stored nowhere. Set each as a Worker secret, never in a file of this repository:
//   npx wrangler secret put VAPID_PUBLIC_KEY   (in worker/)
//   npx wrangler secret put VAPID_PRIVATE_KEY
//   npx wrangler secret put VAPID_SUBJECT      (mailto:you@example.com or an https address)
// A new pair makes every phone subscribe again (tap "Notify me" once more).
import { b64u } from "../worker/src/webPush.js";

const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log(`VAPID_PUBLIC_KEY=${b64u(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
