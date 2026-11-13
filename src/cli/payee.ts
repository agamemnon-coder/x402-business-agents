// npm run payee                                           the supplier bank-detail changes and their state
// npm run payee -- request <vendor> <iban> <bic> [--from <invoice>]   a change is requested; nothing changes yet
// npm run payee -- verified <id> --by <name> --how "<who you called, on which number from your own records>"
//                                                         a person records the supplier's confirmation
// npm run payee -- propose <id>                           the change becomes a proposal for the CFO (Face ID)
// Changed bank details are how invoice fraud works: a new IBAN is paid only after all three steps (E3).

import { openDb } from "../db/open.js";
import { checkThenProposePayeeChange, recordVerification, requestPayeeChange, type PayeeChangeRow } from "../policy/payeeChange.js";
import { approvalHint } from "./hint.js";

const args = process.argv.slice(2);
const db = openDb();
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const cmd = args[0] ?? "list";
if (cmd === "list") {
  const rows = db.prepare("SELECT * FROM payee_changes ORDER BY created_at").all() as PayeeChangeRow[];
  if (rows.length === 0) console.log("no bank-detail changes");
  for (const r of rows) console.log(`${r.change_id}  ${r.status.padEnd(9)} ${r.vendor}: to …${r.new_iban.slice(-4)} (${r.new_iban.slice(0, 2)})${r.proposal_id ? `  ${r.proposal_id}` : ""}${r.source ? `  from ${r.source}` : ""}`);
} else if (cmd === "request") {
  const [, vendor, iban, bic] = args;
  if (!vendor || !iban || !bic) {
    console.error('usage: npm run payee -- request "<vendor>" <iban> <bic> [--from <invoice>]');
    process.exit(2);
  }
  const r = requestPayeeChange(db, { vendor, iban, bic, source: flag("--from") ?? null }, "human");
  console.log(`${r.change_id} requested. Nothing changes yet. Call ${vendor} on a number from your own records (not the invoice or the email), then: npm run payee -- verified ${r.change_id} --by <name> --how "<who, which number>"`);
} else if (cmd === "verified") {
  const id = args[1];
  const by = flag("--by");
  const how = flag("--how");
  if (!id || !by || !how) {
    console.error('usage: npm run payee -- verified <id> --by <name> --how "<who you called, on which number from your own records>"');
    process.exit(2);
  }
  const r = recordVerification(db, id, { by, how, actor: "human" });
  console.log(`${r.change_id} verified by ${by}. Next: npm run payee -- propose ${r.change_id}`);
} else if (cmd === "propose") {
  const id = args[1];
  if (!id) {
    console.error("usage: npm run payee -- propose <id>");
    process.exit(2);
  }
  const { payeeVerifierFromEnv } = await import("../airwallex/payeeName.js");
  const p = await checkThenProposePayeeChange(db, await payeeVerifierFromEnv(), id, "treasury");
  console.log(`${p.proposal_id} bank-detail change, hash ${p.terms_sha256.slice(0, 8)}; ${approvalHint(db, p.proposal_id, p.terms_sha256.slice(0, 8))}`);
} else {
  console.error("usage: npm run payee [-- request | verified | propose]");
  process.exit(2);
}
