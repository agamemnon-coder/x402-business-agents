// npm run controller -- review 2026-10 | list [2026-10] | approve CP-0001 --by <name> | reject CP-0001 --by <name> | ask "<question>"
// The ledger agents on the runner's ledger (KIT11_DB). review and ask need their flags on (KIT11_CONTROLLER_AGENT=on,
// KIT11_BOOKS_AGENT=on); off, they say so and do nothing. approve and reject are a person's: --by names who decides.

import { askBooks } from "../agents/booksAgent.js";
import { controllerProposals, decideProposal, reviewMonth } from "../agents/controllerAgent.js";
import { describeCorrection } from "../agents/controllerCore.js";
import { openDb } from "../db/open.js";

const [cmd, a1] = process.argv.slice(2);
const by = process.argv.includes("--by") ? process.argv[process.argv.indexOf("--by") + 1] ?? "" : "";
const db = openDb();
const fail = (why: string): never => { console.error(why); process.exit(2); };

switch (cmd) {
  case "review": {
    const r = await reviewMonth(db, a1 ?? fail("review takes a month, e.g. 2026-10"));
    if (!r) fail("the Controller agent is off (KIT11_CONTROLLER_AGENT is not on): nothing reviewed");
    console.log(`${r!.source === "claude" ? `Decided by Claude (${r!.run?.model})` : "Fallback (code)"}: ${r!.summary}`);
    for (const p of r!.proposals) console.log(`${p.id} ${p.kind}: ${describeCorrection(p.correction)}. ${p.reason}`);
    break;
  }
  case "list":
    for (const p of controllerProposals(db, a1)) console.log(`${p.id} ${p.month} ${p.status} ${p.kind} (${p.proposed_by}): ${describeCorrection(p.correction)}`);
    break;
  case "approve":
  case "reject": {
    const p = decideProposal(db, a1 ?? fail(`${cmd} takes a proposal id`), cmd, by || fail(`${cmd} needs --by <your name>: a person decides`));
    console.log(`${p.id} ${p.status} by ${by}${p.posted_entry ? `; posted entry ${p.posted_entry}` : ""}`);
    break;
  }
  case "ask": {
    const r = await askBooks(db, a1 ?? fail("ask takes a question"));
    if (!r) fail("the books agent is off (KIT11_BOOKS_AGENT is not on): nothing asked");
    console.log(`${r!.source === "claude" ? `Decided by Claude (${r!.run?.model})` : "Fallback (code)"}: ${r!.answer.text}`);
    for (const f of r!.answer.figures) console.log(`  ${f.label}: ${f.amount} ${f.currency} (${f.measure} of ${f.source})`);
    break;
  }
  default:
    fail("npm run controller -- review <YYYY-MM> | list [YYYY-MM] | approve|reject <id> --by <name> | ask \"<question>\"");
}
