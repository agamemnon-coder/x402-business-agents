// The payee check is on by default (13 November). A test world's fictional suppliers have no bank to ask, so a labelled
// stand-in answers it: every account is held under the name asked, and the check's label says no bank was asked.
// test/airwallex-payee-name.test.ts covers the refusals (a mismatch, a closed account, no answer) on its own bank.
import { FakePayeeNames } from "../../src/airwallex/payeeName.js";

export const standInBank = () => Object.assign(new FakePayeeNames(), { confirmAll: true });

import type { DB } from "../../src/db/open.js";
import { recordNameCheck } from "../../src/airwallex/payeeName.js";
import { payeeAddCheckTarget } from "../../src/ap/vendors.js";

/** For a synchronous test helper: the stand-in's FULL_MATCH recorded for a verified supplier request (labelled stand-in). */
export function standInCheckedAdd(db: DB, addId: string, now = new Date()): void {
  const t = payeeAddCheckTarget(db, addId);
  recordNameCheck(db, { code: "VERIFIED", match: "FULL_MATCH", resolvedName: t.name, resolvedBank: "stand-in" }, t, "stand-in", "system", now);
}
