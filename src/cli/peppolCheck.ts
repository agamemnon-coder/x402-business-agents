// npm run peppol:check -- <file.xml> [...]: reads Peppol UBL invoices or credit notes with Purser's reader
// (src/ap/peppol.ts) and prints, for each, its kind, the fields Purser takes, the business rules it breaks and what
// would hold it for a person. Offline; files nothing. Exit code 1 when any file is refused or breaks a rule.
import { readFileSync } from "node:fs";
import { PeppolRefused, receivePeppol } from "../ap/peppol.js";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: npm run peppol:check -- <invoice.xml> [...]");
  process.exit(2);
}
for (const f of files) {
  try {
    const r = receivePeppol(readFileSync(f));
    const x = r.reading;
    console.log(`${f}: ${r.invoice.kind} ${x.invoice_no} from ${x.vendor}, ${x.currency} ${x.total} due ${x.due_date || "(no date)"}, account ${x.iban || x.account_number || "(none)"}`);
    for (const v of r.violations) console.log(`  rule ${v.rule}: ${v.message}`);
    for (const h of r.findings.filter((y) => y.code !== "peppol_rule")) console.log(`  holds: ${h.code}: ${h.detail}`);
    if (!r.violations.length) console.log("  every rule checked here holds");
    if (r.findings.length) process.exitCode = 1;
  } catch (e) {
    console.log(`${f}: refused: ${(e as Error).message}`);
    process.exitCode = 1;
    if (!(e instanceof PeppolRefused)) throw e;
  }
}
