// A command-line process that records a money row inside a transaction and ends at once (test/audit-checkpoints.test.ts):
// with process.exit, as the CLIs do, its checkpoint must still be written; with "kill" it dies by SIGKILL before it can
// be, as a crash would, and the row's signed intent must vouch for it. Arguments: the ledger file, then "kill" or none.
import { audit } from "../../src/audit/log.js";
import { openDb } from "../../src/db/open.js";

const db = openDb(process.argv[2]!);
db.transaction(() => { audit(db, "support", "refund.paid", "R-cli", { amount: "1.00", origin: null }); })();
if (process.argv[3] === "kill") process.kill(process.pid, "SIGKILL");
process.exit(0);
