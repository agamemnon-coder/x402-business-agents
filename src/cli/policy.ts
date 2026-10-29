// npm run policy                                   the CFO policy now
// npm run policy -- set <key> <value> [--reason …]  propose a change (value "none" removes an agent limit)
// A change is a policy_change proposal: approve it on the phone with the passkey (npm run relay) or on the laptop
// page; it takes effect when it runs, and every change is in the audit log.

import { openDb } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { currentPolicy } from "../policy/rules.js";

const args = process.argv.slice(2);
const db = openDb();
if (args[0] === "set") {
  const [, key, raw] = args;
  const at = args.indexOf("--reason");
  if (!key || raw === undefined) {
    console.error("usage: npm run policy -- set <key> <value> [--reason text]   (keys: npm run policy)");
    process.exit(2);
  }
  const p = proposePolicyChange(db, { changes: [{ key, to: raw === "none" ? "" : raw }], reason: at >= 0 ? (args[at + 1] ?? "") : "CFO policy change" }, "human");
  console.log(`${p.proposal_id} policy change, hash ${p.terms_sha256.slice(0, 8)}, expires ${p.expires_at}; approve on the phone (/approve/${p.proposal_id}) or the laptop page`);
} else {
  for (const e of currentPolicy(db)) console.log(`${e.key.padEnd(44)} ${e.display.padEnd(44)} ${e.label}`);
}
