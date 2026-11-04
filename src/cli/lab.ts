// npm run lab [scenario id]: the Scenario Lab (E), the CFO's test script. Each scenario runs in a fresh throwaway world
// with stand-ins for Airwallex and Metal; nothing moves and nothing reaches a phone. Prints what was expected and what
// happened, writes docs/lab/results.json (the Lab page of npm run judge shows it), and exits 1 if any is not as expected.

import { mkdirSync, writeFileSync } from "node:fs";
import { runAll, runScenario, SCENARIOS } from "../lab/scenarios.js";

const id = process.argv[2];
const one = id ? SCENARIOS.find((s) => s.id === id) : undefined;
if (id && !one) {
  console.error(`no scenario ${id}; known: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  process.exit(2);
}
const results = one ? [await runScenario(one)] : await runAll();
for (const r of results) {
  console.log(`${r.passed ? "ok  " : "FAIL"} ${r.id}: ${r.title}`);
  console.log(`     expected: ${r.expected}`);
  console.log(`     happened: ${r.happened}`);
}
const passed = results.filter((r) => r.passed).length;
console.log(`${passed} of ${results.length} as expected`);
if (!one) {
  mkdirSync(new URL("../../docs/lab/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../docs/lab/results.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n");
}
process.exit(passed === results.length ? 0 : 1);
