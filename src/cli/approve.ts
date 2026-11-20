// npm run approve -- <proposal> <first 8 hex of its hash> [--reject] [--note "..."]
// Records the decision and, on approval, runs the executor at once. The executor re-checks the hash.
// --reject on an approved payment its executor blocked (the dashboard's BLOCKED_NEEDS_REVIEW) closes it: nothing is paid.

import { openDb } from "../db/open.js";
import { execute } from "../executors/index.js";
import { closeBlocked, decide } from "../policy/approvals.js";
import { isBlocked } from "../policy/blocked.js";

const args = process.argv.slice(2);
const [proposalId, prefix] = args.filter((a) => !a.startsWith("--"));
const noteAt = args.indexOf("--note");
const note = noteAt >= 0 ? args[noteAt + 1] : undefined;
if (!proposalId || !prefix) {
  console.error("usage: npm run approve -- <proposal id> <first 8 hex of its sha256> [--reject] [--note text]");
  process.exit(2);
}
const db = openDb();
const decision = args.includes("--reject") ? "REJECTED" : "APPROVED";
const approver = process.env.KIT11_APPROVER ?? "max";
if (decision === "REJECTED" && isBlocked(db, proposalId)) {
  closeBlocked(db, proposalId, prefix, approver);
  console.log(`${proposalId} closed after it was blocked at execution; nothing was paid`);
  process.exit(0);
}
const result = decide(db, { proposalId, decision, typedPrefix: prefix, approver, method: "cli", note });
console.log(`${proposalId} ${result}`);
if (result === "APPROVED") {
  await execute(db, proposalId);
  console.log(`${proposalId} executed`);
}
