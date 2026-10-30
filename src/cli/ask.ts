// npm run ask -- "<message>"                     ask Purser for a task card in plain words; Purser replies and, if the
//                                                 request fits the CFO policy, proposes a single-use card for Face ID
// npm run ask -- book <P-id> <amount> [merchant]  after approval and issue: an agent books on the task card (the
//                                                 merchant's charge is a sandbox simulation; Airwallex decides)
// npm run ask -- show <P-id>                      the second charge and a hotel charge on the same card, which Airwallex
//                                                 declines (a demonstration of single use and merchant categories)
// Sandbox only. The card number stays at Airwallex; this prints the last four digits.

import { issuingFromEnv } from "../airwallex/issuing.js";
import { askPurser, bookOnTaskCard } from "../agents/askPurser.js";
import { Tools } from "../claude/tools.js";
import { openDb } from "../db/open.js";
import { approvalHint } from "./hint.js";

const args = process.argv.slice(2);
const db = openDb();
const sim = () => {
  const awx = issuingFromEnv();
  if (!awx) {
    console.error("the Airwallex sandbox keys are not set (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY); nothing was done");
    process.exit(2);
  }
  return awx.sim;
};
const said = (t: { approved: boolean; failureReason: string | null; amountCents: number; merchant: string }) =>
  `${t.merchant} ${(t.amountCents / 100).toFixed(2)} EUR: ${t.approved ? "approved by Airwallex" : `declined by Airwallex (${t.failureReason ?? "no reason"})`}`;

const [cmd, id, amount, ...rest] = args;
if (cmd === "book" && id && amount) {
  console.log(said(await bookOnTaskCard(db, sim(), `task:${id}`, { merchant: rest.join(" ") || "Skyline Air", amount }, new Date(), issuingFromEnv()?.rail)));
} else if (cmd === "show" && id) {
  console.log(`demonstration on task:${id}, labelled as such in the log:`);
  console.log("  a second charge: " + said(await bookOnTaskCard(db, sim(), `task:${id}`, { merchant: "Skyline Air (second charge)", amount: "40.00" })));
  console.log("  a hotel:         " + said(await bookOnTaskCard(db, sim(), `task:${id}`, { merchant: "Hotel Adlon (wrong kind)", amount: "120.00", mcc: "7011" })));
} else if (cmd && !["book", "show"].includes(cmd)) {
  const r = await askPurser(db, new Tools(db), args.join(" "), new Date(), { rail: issuingFromEnv()?.rail ?? null, from: "runner" });
  console.log(`Purser: ${r.reply}`);
  if (r.proposalId) console.log(`next: ${approvalHint(db, r.proposalId)}`);
  if (r.taskId) console.log(`next: npm run ask -- book ${r.taskId.slice(5)} <amount>`);
} else {
  console.error('usage: npm run ask -- "<message>" | book <P-id> <amount> [merchant] | show <P-id>');
  process.exit(2);
}
