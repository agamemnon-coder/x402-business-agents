// npm run passkey [-- confirm <fingerprint>]: shows the enrolled passkey and any new one waiting for confirmation,
// and confirms a waiting one. Confirm only the fingerprint the CFO reads off the phone's enrolment screen: a passkey
// that someone else slipped in through the relay has another fingerprint (security review M3).

import { openDb } from "../db/open.js";
import { activePasskey, confirmPasskey, pendingPasskeys } from "../passkey/ledger.js";

const db = openDb();
const [cmd, fp] = process.argv.slice(2);
if (cmd === "confirm") {
  if (!fp) { console.error("usage: npm run passkey -- confirm <fingerprint, as the phone shows it>"); process.exit(2); }
  const id = confirmPasskey(db, fp);
  console.log(`confirmed  passkey ${id.slice(0, 8)} (fingerprint ${fp.toUpperCase()}); approvals now need it`);
  process.exit(0);
}
const pk = activePasskey(db);
console.log(pk ? `enrolled   ${pk.label}, passkey ${pk.credential_id.slice(0, 8)}, since ${pk.enrolled_at}` : "enrolled   none");
for (const p of pendingPasskeys(db)) {
  console.log(`waiting    fingerprint ${p.fingerprint}, passkey ${p.credential_id.slice(0, 8)}, authenticator ${p.aaguid ?? "unknown"}, created ${p.created_at}`);
  console.log(`           if the phone shows ${p.fingerprint}: npm run passkey -- confirm ${p.fingerprint}`);
}
