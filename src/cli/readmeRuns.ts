// npm run readme-runs: rewrites the README's "What ran live" table from the run records (src/readme/runsTable.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { withRunsTable } from "../readme/runsTable.js";

const path = new URL("../../README.md", import.meta.url);
const now = readFileSync(path, "utf8"), next = withRunsTable(now);
if (process.argv.includes("--check")) {
  if (now !== next) { console.error("README's runs table differs from the records: npm run readme-runs"); process.exit(1); }
  console.log("README's runs table matches the records");
} else { writeFileSync(path, next); console.log("README: runs table written"); }
