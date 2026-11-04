// One of several processes hammering the same ledger file with holds (test/holds-concurrency.test.ts), as the
// runner, the agent API and the CLIs do: each opens its own connection, says it is ready, waits for "go", then
// reserves as fast as it can and reports what happened.
import { openDb } from "../../src/db/open.js";
import { reserveSpend } from "../../src/policy/holds.js";

type Job = { agent: "sourcing" | "support" | "treasury"; cents: number; at: number };
process.once("message", (m: { file: string; id: number; jobs: Job[] }) => {
  const db = openDb(m.file);
  process.send!("ready");
  process.once("message", () => {
    const results = m.jobs.map((j, k) => ({ ...j, refused: reserveSpend(db, { agent: j.agent, rail: "metal", cents: j.cents, ref: `w${m.id}-${k}`, now: new Date(j.at) }) }));
    process.send!(results, () => process.exit(0));
  });
});
