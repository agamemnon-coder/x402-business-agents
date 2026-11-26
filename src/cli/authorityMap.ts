// npm run authority-map            each agent's authority, as a table: what it may pay, how much, from where, to whom,
//                                  when, under which grant, and what needs the CFO (src/policy/authorityMap.ts)
// npm run authority-map -- --json  the same, as JSON (the export)
// Every value is read from the live CFO policy and the ledger; nothing is written.
import { openDb } from "../db/open.js";
import { authorityMap, authorityMapText } from "../policy/authorityMap.js";

const map = authorityMap(openDb());
console.log(process.argv.includes("--json") ? JSON.stringify(map, null, 2) : authorityMapText(map));
