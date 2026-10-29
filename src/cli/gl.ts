// npm run gl -- csv|json [file]: the GL journal (E4), every payment with its GL account, cost centre, bank account,
// proof and approval. Without a file it prints to stdout. Map the accounts to your own chart in src/config/gl.ts.

import { writeFileSync } from "node:fs";
import { journal, journalCsv, journalJson } from "../accounting/gl.js";
import { openDb } from "../db/open.js";

const [format = "csv", file] = process.argv.slice(2);
if (format !== "csv" && format !== "json") throw new Error("usage: npm run gl -- csv|json [file]");
const lines = journal(openDb());
const out = format === "csv" ? journalCsv(lines) : journalJson(lines);
if (file) {
  writeFileSync(file, out);
  console.log(`${file}: ${lines.length} lines`);
} else process.stdout.write(out);
