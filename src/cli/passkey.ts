// npm run passkey [-- confirm <fingerprint> | add <name> | seal [<fingerprint>]]: shows the enrolled passkeys and any new one waiting for
// confirmation, confirms a waiting one, or opens a window to add another person (E1, four eyes). Confirm only the fingerprint the CFO reads off the phone's enrolment screen: a passkey
// that someone else slipped in through the relay has another fingerprint (security review M3).

import { openDb } from "../db/open.js";
import { confirmPasskey, fingerprintOf, openEnrolment, pendingPasskeys, sealEnrolledPasskey, spkiSha256OfCose } from "../passkey/ledger.js";
import { unsealedPasskeys } from "../passkey/seal.js";
import { loadRunnerSealKey } from "../passkey/sealKeyFile.js";
import { enrolLink, relayConfig } from "../relay/config.js";

const db = openDb();
// The enrolment seal key (src/passkey/seal.ts): a confirmed passkey is sealed with it; only sealed passkeys decide.
loadRunnerSealKey();
const [cmd, fp] = process.argv.slice(2);
if (cmd === "confirm") {
  if (!fp) { console.error("usage: npm run passkey -- confirm <fingerprint, as the phone shows it>"); process.exit(2); }
  const id = confirmPasskey(db, fp);
  console.log(`confirmed  passkey ${id.slice(0, 8)} (fingerprint ${fp.toUpperCase()}); approvals now need it`);
  process.exit(0);
}
if (cmd === "seal") {
  // A passkey enrolled before the seal existed: sealed once its fingerprint is the one its owner's phone showed.
  if (!fp) {
    const open = unsealedPasskeys(db);
    if (open.length === 0) console.log("sealed     every active passkey is sealed");
    for (const k of open) console.log(`unsealed   ${k.label}, passkey ${k.credential_id.slice(0, 8)}, fingerprint ${fingerprintOf(spkiSha256OfCose(k.public_key))}; if their phone showed it: npm run passkey -- seal <fingerprint>`);
    process.exit(0);
  }
  const id = sealEnrolledPasskey(db, fp);
  console.log(`sealed     passkey ${id.slice(0, 8)} (fingerprint ${fp.toUpperCase()}); it may approve again`);
  process.exit(0);
}
if (cmd === "add") {
  // E1: a second person, with a passkey of their own, beside the ones enrolled. The runner (npm run relay) takes the
  // enrolment from their phone; confirm the fingerprint their phone shows with npm run passkey -- confirm.
  if (!fp) { console.error("usage: npm run passkey -- add <name>   (lower-case, e.g. anna)"); process.exit(2); }
  const cfg = await relayConfig();
  const { window, code } = openEnrolment(db, { rpId: cfg.rpId, origin: cfg.origin, addPerson: fp });
  console.log(`ENROL    ${fp}: on their phone open ${enrolLink(cfg)} and type ${code} (valid until ${window.expires_at.slice(11, 19)} UTC, five tries); the runner must be running`);
  process.exit(0);
}
const active = db.prepare("SELECT label, credential_id, enrolled_at FROM passkeys WHERE status = 'ACTIVE' ORDER BY enrolled_at").all() as { label: string; credential_id: string; enrolled_at: string }[];
if (active.length === 0) console.log("enrolled   none");
for (const pk of active) console.log(`enrolled   ${pk.label}, passkey ${pk.credential_id.slice(0, 8)}, since ${pk.enrolled_at}`);
for (const p of pendingPasskeys(db)) {
  console.log(`waiting    fingerprint ${p.fingerprint}, passkey ${p.credential_id.slice(0, 8)}, authenticator ${p.aaguid ?? "unknown"}, created ${p.created_at}`);
  console.log(`           if the phone shows ${p.fingerprint}: npm run passkey -- confirm ${p.fingerprint}`);
}
