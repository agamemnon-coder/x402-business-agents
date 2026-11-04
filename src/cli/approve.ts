// npm run approve -- <proposal> <first 8 hex of its hash> [--reject] [--note "..."]
// Records the decision and, on approval, runs the executor at once. The executor re-checks the hash.

import { openDb } from "../db/open.js";
import { execute } from "../executors/index.js";
import { decide } from "../policy/approvals.js";

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
const result = decide(db, { proposalId, decision, typedPrefix: prefix, approver: process.env.KIT11_APPROVER ?? "max", method: "cli", note });
console.log(`${proposalId} ${result}`);
if (result === "APPROVED") {
  await execute(db, proposalId);
  console.log(`${proposalId} executed`);
}
