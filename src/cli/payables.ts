// npm run payables                      the local page on http://127.0.0.1:4400 (upload, list, insight, exports)
// npm run payables -- add <file>...     file PDFs or saved e-mails (.eml) and read, check and book them
// npm run payables -- watch <dir> [--once]   file every PDF or .eml that appears in a folder (nothing is moved)
// npm run payables -- list | show <id> | insights
// npm run payables -- pay <id>          file the payment of a ready invoice for the CFO's Face ID (the phone)
// npm run payables -- sync              mark paid what Airwallex paid; check invoices waiting for a supplier again
// npm run payables -- supplier-request <id>                  ask for the new supplier of an invoice waiting for one
// npm run payables -- supplier-verify <N-id> --by <name> --how "<who you called, on which number from your records>"
//                                       --street <street> --city <city> --postcode <postcode>
// npm run payables -- supplier-propose <N-id>                the new supplier goes to the CFO (Face ID)
// npm run payables -- export journal|invoices [--out <file>]
// Test money only: the Airwallex sandbox. Every payment and every new supplier needs the CFO's Face ID.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { airwallexFromEnv } from "../airwallex/adapter.js";
import { apJournal, invoicesCsv, journalCsv, payablesSink } from "../ap/books.js";
import { ingestDocument, recheck, type InboxDeps, type IngestResult } from "../ap/inbox.js";
import { insights } from "../ap/insights.js";
import { payApInvoice, syncPayments } from "../ap/pay.js";
import { apInvoice, apInvoices } from "../ap/store.js";
import { proposePayeeAdd, recordPayeeAddVerification, requestPayeeAddForInvoice } from "../ap/vendors.js";
import { scanFolder } from "../ap/watch.js";
import { ClaudeReader } from "../claude/reader.js";
import { openDb } from "../db/open.js";
import { payablesApp } from "../servers/payables.js";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const db = openDb();
const dir = process.env.KIT11_AP_DIR ?? "data/ap";
const deps: InboxDeps = { dir, reader: new ClaudeReader(db), sink: payablesSink() };

const line = (r: IngestResult): string => r.kind === "invoice"
  ? `${r.invoice.id}  ${r.invoice.status.replace(/_/g, " ").padEnd(13)} ${r.invoice.vendor} ${r.invoice.invoice_no} ${r.invoice.currency} ${r.invoice.total}`
  : r.kind === "duplicate_document" ? `already filed (${r.invoice_id ?? r.sha256.slice(0, 12)})` : r.results.map(line).join("\n") || "an e-mail with no PDF attached";

async function main(): Promise<void> {
  const cmd = args[0] ?? "serve";
  if (cmd === "serve") {
    const port = Number(process.env.KIT11_PAYABLES_PORT ?? 4400);
    const awx = await airwallexFromEnv();
    payablesApp(db, { inbox: deps, rail: awx?.rail ?? null }).listen(port, "127.0.0.1", () => {
      console.log(`payables: http://127.0.0.1:${port}/  (documents in ${dir}/docs; Airwallex ${awx ? "sandbox" : "not set: paying is off"})`);
    });
    return;
  }
  if (cmd === "add") {
    for (const f of args.slice(1)) console.log(line(await ingestDocument(db, deps, { bytes: readFileSync(f), filename: basename(f), source: "upload" })));
  } else if (cmd === "watch") {
    const folder = args[1];
    if (!folder) throw new Error("usage: npm run payables -- watch <dir> [--once]");
    const once = args.includes("--once");
    const tick = async () => {
      const r = await scanFolder(db, deps, folder);
      for (const x of r.results.filter((y) => y.kind !== "duplicate_document")) console.log(line(x));
      for (const f of r.failed) console.error(`${f.file}: ${f.error}`);
    };
    await tick();
    if (!once) { console.log(`watching ${folder} every 10 s (Ctrl-C stops)`); setInterval(() => void tick(), 10_000); return; }
  } else if (cmd === "list") {
    const all = apInvoices(db);
    if (all.length === 0) console.log("no invoices yet");
    for (const i of all) console.log(`${i.id}  ${i.status.replace(/_/g, " ").padEnd(13)} ${i.doc_kind.padEnd(11)} ${i.vendor} ${i.invoice_no}  ${i.currency} ${i.total}  due ${i.due_date || "-"}`);
  } else if (cmd === "show") {
    const i = apInvoice(db, args[1] ?? "");
    if (!i) throw new Error(`no payables invoice ${args[1]}`);
    console.log(JSON.stringify(i, null, 2));
  } else if (cmd === "insights") {
    console.log(JSON.stringify(insights(db), null, 2));
  } else if (cmd === "pay") {
    const awx = await airwallexFromEnv();
    if (!awx) throw new Error("Airwallex sandbox keys are not set; the payment cannot be planned");
    const out = await payApInvoice(db, awx.rail, args[1] ?? "", new Date(), deps.reader);
    console.log(out.kind === "proposed" ? `${out.proposal.proposal_id}: waits for the CFO's Face ID on the phone` : `not planned: ${out.reason}`);
  } else if (cmd === "sync") {
    const paid = await syncPayments(db, deps);
    const checked = await recheck(db, deps);
    for (const x of [...paid, ...checked]) console.log(`${x.id}  ${x.status.replace(/_/g, " ")}`);
  } else if (cmd === "supplier-request") {
    const r = requestPayeeAddForInvoice(db, args[1] ?? "", "human");
    console.log(`${r.add_id}: ${r.vendor}, account ending ${r.iban.slice(-4)}. Now call the supplier on a number from your own records, then: npm run payables -- supplier-verify ${r.add_id} --by ... --how ... --street ... --city ... --postcode ...`);
  } else if (cmd === "supplier-verify") {
    const r = recordPayeeAddVerification(db, args[1] ?? "", {
      by: flag("--by") ?? "", how: flag("--how") ?? "", actor: "human",
      address: { street: flag("--street") ?? "", city: flag("--city") ?? "", postcode: flag("--postcode") ?? "" },
    });
    console.log(`${r.add_id} verified. Next: npm run payables -- supplier-propose ${r.add_id}`);
  } else if (cmd === "supplier-propose") {
    const p = proposePayeeAdd(db, args[1] ?? "", "human");
    console.log(`${p.proposal_id}: the new supplier waits for the CFO's Face ID on the phone`);
  } else if (cmd === "export") {
    const what = args[1] ?? "journal";
    const csv = what === "invoices" ? invoicesCsv(apInvoices(db)) : journalCsv(apJournal(db));
    const out = flag("--out");
    if (out) { writeFileSync(out, csv); console.log(`written: ${out}`); } else process.stdout.write(csv);
  } else {
    throw new Error(`unknown command ${cmd}; see the top of src/cli/payables.ts`);
  }
  db.close();
}

main().catch((e: unknown) => { console.error((e as Error).message); process.exit(1); });
