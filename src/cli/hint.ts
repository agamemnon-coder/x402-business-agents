// How a person approves here: once a passkey is enrolled, only with it, on the phone (security review H1).

import type { DB } from "../db/open.js";
import { activePasskey } from "../passkey/ledger.js";

export function approvalHint(db: DB, id = "<id>", prefix = "<first 8 hex>"): string {
  return activePasskey(db)
    ? `approve or reject ${id} on the phone with Face ID (the approval page on the relay, npm run relay)`
    : `npm run approve -- ${id} ${prefix} (no passkey enrolled yet)`;
}
