// npm run iso20022 -- <invoice number> [out file]: the paid invoice as an ISO 20022 pacs.008.001.08 message, linking
// the Airwallex SWIFT transfer and the Metal transaction booked before it (src/finance/iso20022.ts). Ledger: KIT11_DB.
import { writeFileSync } from "node:fs";
import { openDb } from "../db/open.js";
import { pacs008ForInvoice } from "../finance/iso20022.js";

const [invoice, out] = process.argv.slice(2);
if (!invoice) {
  console.error("usage: npm run iso20022 -- <invoice number> [out file]");
  process.exit(2);
}
const p = pacs008ForInvoice(openDb(), invoice);
if (out) {
  writeFileSync(out, p.xml);
  console.log(`${out}: ${p.reference} (Airwallex transfer ${p.legs.airwallex}${p.legs.metal ? `, Metal tx ${p.legs.metal}` : ""})`);
} else process.stdout.write(p.xml);
