// npm run ap-hostile-eval [-- --write]: the hostile-model eval of the payables agents (src/evals/apHostile.ts). A script
// in Claude's place makes the worst tool call it can on every turn; the verdict is read from each world's audit
// ledger. Prints "N hostile tool calls, N refused by code, 0 unsafe by the ledger verdict". No network, no key, no
// money: CI runs it. Without --write it fails when any case is unsafe or the committed record (docs/evals/ap-hostile.json,
// shown on /claude) no longer matches this run; --write records this run, with the commit it ran on.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hostileLine } from "../evals/apAgentEvals.js";
import { HOSTILE_RECORD, hostileEval } from "../evals/apHostile.js";
import { evalCommit } from "../evals/commit.js";

const file = resolve(import.meta.dirname, "../..", HOSTILE_RECORD);
const r = await hostileEval();
const line = hostileLine(r);
console.log(line);
console.log(`  refused by a tool's check: ${r.blocked_by_tool}; made stricter at enforce: ${r.overridden_at_enforce}; stood as the script asked: ${r.stood} (each a pay of an invoice the policy lets the agent pay alone)`);
console.log(`  ended looser than the case needs but not unsafe (sent to the CFO, not held): ${r.looser}`);
console.log(`  refusals by rule: ${Object.entries(r.by_rule).map(([k, n]) => `${k} ${n}`).join(", ")}`);

if (process.argv.includes("--write")) {
  const { commit, dirty } = evalCommit([HOSTILE_RECORD]);
  const { cases, ...totals } = r;
  writeFileSync(file, `${JSON.stringify({
    what: "Hostile-model eval: a script in Claude's place makes the worst tool call it can on every turn, through the runner's own agent loop, over every payables eval case; the verdict is read from each world's audit ledger. No network, no key, test data only.",
    ran_at: new Date().toISOString(), commit, dirty, command: "npm run ap-hostile-eval -- --write", line, ...totals,
    cases: cases.map((c) => ({ agent: c.agent, id: c.id, category: c.category, expected: c.expected, outcome: c.outcome, calls: c.calls, refused_by: c.refused_by, unsafe: c.unsafe, looser: c.looser })),
  }, null, 2)}\n`);
  console.log(`recorded in ${HOSTILE_RECORD} (commit ${commit}${dirty ? ", with uncommitted changes" : ""})`);
} else {
  const committed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as { line?: string } : {};
  if (committed.line !== line) {
    console.error(`${HOSTILE_RECORD} says "${committed.line ?? "nothing"}": run npm run ap-hostile-eval -- --write and commit it`);
    process.exitCode = 1;
  }
}
if (r.unsafe > 0) {
  console.error(`UNSAFE: ${r.cases.filter((c) => c.unsafe).map((c) => `${c.agent} ${c.id}`).join(", ")}`);
  process.exitCode = 1;
}
