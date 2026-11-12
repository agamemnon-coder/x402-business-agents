// Prints line coverage per area from coverage/coverage-summary.json (npm run test:coverage), and fails when an area
// is below its floor: 90% for each (hardening plan item 1, reached on 30 October), so a drop fails CI.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AREAS: Record<string, { prefixes: string[]; floor: number }> = {
  money: { prefixes: ["lib/money", "finance/", "agents/euroBill", "agents/sweep", "metal/pay", "executors/refunds", "executors/invoicePayment"], floor: 90 },
  policy: { prefixes: ["policy/"], floor: 90 },
  passkey: { prefixes: ["passkey/"], floor: 90 },
  executors: { prefixes: ["executors/"], floor: 90 },
  relay: { prefixes: ["relay/"], floor: 90 },
  clearing: { prefixes: ["metal/clearing"], floor: 90 },
  // Invoice tokens on Metal (docs/tokenize.md), added 12 November with test/property-tokenize.test.ts: 92.5% from the
  // tokenize tests alone that day.
  tokenize: { prefixes: ["tokenize/"], floor: 90 },
};

const root = resolve(import.meta.dirname, "..");
const summary = JSON.parse(readFileSync(resolve(root, "coverage/coverage-summary.json"), "utf8")) as Record<string, { lines: { covered: number; total: number } }>;
let failed = false;
for (const [name, a] of Object.entries(AREAS)) {
  let covered = 0, total = 0;
  for (const [file, v] of Object.entries(summary)) {
    const rel = file.startsWith(root) ? file.slice(root.length + 5) : file; // strip "<root>/src/"
    if (a.prefixes.some((p) => rel.startsWith(p))) { covered += v.lines.covered; total += v.lines.total; }
  }
  const pct = total ? (100 * covered) / total : 100;
  const ok = pct >= a.floor;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(10)} ${pct.toFixed(1).padStart(5)}% of ${total} lines (floor ${a.floor}%, goal 90%)`);
}
process.exit(failed ? 1 : 0);
