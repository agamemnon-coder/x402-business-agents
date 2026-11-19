// The workplace integrations from a terminal (docs/integrations/workplace.md). Every credential comes from the
// environment; nothing is printed but counts, file names and reasons.
//
//   npx tsx src/cli/workplace.ts poll gmail|drive|outlook|onedrive   fetch invoices and file them through the inbox
//   npx tsx src/cli/workplace.ts sheets                               append paid invoices and the journal to the sheet
//   npx tsx src/cli/workplace.ts books xero|exact [--dry-run]         push suppliers and the payables journal
//   npx tsx src/cli/workplace.ts xero-tenants                         the Xero organisations the token reaches
//
// Nothing here proposes, approves or pays: invoices are filed, and every payment still needs the CFO's passkey.
// Built and tested against mocks (test/workplace-*.test.ts); needs the owner's OAuth apps to run live.

import { apJournal, payablesSink } from "../ap/books.js";
import type { InboxDeps } from "../ap/inbox.js";
import { ClaudeReader } from "../claude/reader.js";
import { openDb } from "../db/open.js";
import { fileTokenStore } from "../erp/auth.js";
import { fetchTransport, type Transport } from "../erp/connector.js";
import type { Vendor } from "../erp/model.js";
import { liveConnector } from "../erp/registry.js";
import { ledgerItems } from "../erp/source.js";
import { journalsFromApEntries, pushBooked, type BooksPush } from "../workplace/accounting.js";
import { pollDriveFolder } from "../workplace/gdrive.js";
import { gmailQueryFromEnv, pollGmail } from "../workplace/gmail.js";
import { pollOneDriveFolder, pollOutlookFolder } from "../workplace/graph.js";
import { setting } from "../workplace/http.js";
import { deliverToInbox, type PollResult } from "../workplace/inbox.js";
import { tokenSourceFromEnv } from "../workplace/oauth.js";
import { exportToSheets } from "../workplace/sheets.js";
import { XeroConnector, xeroConfigFromEnv, xeroTenants, xeroTokens } from "../workplace/xero.js";

const env = process.env;
const [cmd, what] = process.argv.slice(2);

function xeroTokenProvider(transport: Transport) {
  return xeroTokens({ clientId: setting(env, "ERP_XERO_CLIENT_ID"), ...(env.ERP_XERO_CLIENT_SECRET ? { clientSecret: env.ERP_XERO_CLIENT_SECRET } : {}), store: fileTokenStore("data/erp/xero.token.json"), ...(env.ERP_XERO_REFRESH_TOKEN ? { seedRefreshToken: env.ERP_XERO_REFRESH_TOKEN } : {}), transport });
}

async function poll(source: string | undefined): Promise<PollResult> {
  switch (source) {
    case "gmail": {
      // after: takes seconds since the epoch in Gmail's search syntax.
      const since = env.PURSER_GMAIL_SINCE ? Date.parse(env.PURSER_GMAIL_SINCE) : NaN;
      return pollGmail({ token: tokenSourceFromEnv(env, "gmail", "PURSER_GMAIL"), query: `${gmailQueryFromEnv(env)}${Number.isNaN(since) ? "" : ` after:${Math.floor(since / 1000)}`}` });
    }
    case "drive": return pollDriveFolder({ token: tokenSourceFromEnv(env, "drive", "PURSER_GDRIVE"), folderId: setting(env, "PURSER_GDRIVE_FOLDER_ID"), ...(env.PURSER_GDRIVE_SINCE ? { modifiedAfter: env.PURSER_GDRIVE_SINCE } : {}) });
    case "outlook": return pollOutlookFolder({ token: tokenSourceFromEnv(env, "outlook", "PURSER_OUTLOOK"), folderId: env.PURSER_OUTLOOK_FOLDER_ID ?? "inbox", ...(env.PURSER_OUTLOOK_SINCE ? { receivedAfter: env.PURSER_OUTLOOK_SINCE } : {}) });
    case "onedrive": return pollOneDriveFolder({ token: tokenSourceFromEnv(env, "onedrive", "PURSER_ONEDRIVE"), driveId: setting(env, "PURSER_ONEDRIVE_DRIVE_ID"), folderPath: setting(env, "PURSER_ONEDRIVE_FOLDER_PATH") });
    default: throw new Error("poll what: gmail, drive, outlook or onedrive");
  }
}

async function main(): Promise<void> {
  if (cmd === "poll") {
    const polled = await poll(what);
    const db = openDb();
    const deps: InboxDeps = { dir: env.KIT11_AP_DIR ?? "data/ap", reader: new ClaudeReader(db), sink: payablesSink() };
    for (const d of await deliverToInbox(db, deps, polled.files)) {
      console.log(d.outcome === "filed" ? `filed    ${d.filename}  ${d.result.kind === "invoice" ? `${d.result.invoice.id} ${d.result.invoice.status}` : d.result.kind}` : `refused  ${d.filename}  ${d.reason}`);
    }
    for (const s of polled.skipped) console.log(`skipped  ${s.filename}  ${s.reason}`);
    return;
  }
  if (cmd === "sheets") {
    const out = await exportToSheets(openDb(), { token: tokenSourceFromEnv(env, "sheets", "PURSER_SHEETS"), spreadsheetId: setting(env, "PURSER_SHEETS_SPREADSHEET_ID") });
    for (const s of out) console.log(`${s.sheet}: ${s.appended} rows appended, ${s.already} already there`);
    return;
  }
  if (cmd === "xero-tenants") {
    const transport = fetchTransport();
    for (const t of await xeroTenants(transport, xeroTokenProvider(transport))) console.log(`${t.tenantId}  ${t.type}  ${t.name}`);
    return;
  }
  if (cmd === "books") {
    const db = openDb();
    const vendors = ledgerItems(db).filter((i) => i.kind === "vendor").map((i) => i.object as Vendor);
    const journals = journalsFromApEntries(apJournal(db));
    if (process.argv.includes("--dry-run")) {
      console.log(`would push ${vendors.length} suppliers and ${journals.length} journal entries to ${what}; nothing was sent`);
      return;
    }
    const transport = fetchTransport();
    const c: BooksPush = what === "xero" ? new XeroConnector(xeroConfigFromEnv(env), transport, xeroTokenProvider(transport)) : what === "exact" ? liveConnector("exact", env, transport) : (() => { throw new Error("books where: xero or exact"); })();
    for (const o of await pushBooked(c, { vendors, journals })) console.log(`${o.kind.padEnd(8)} ${o.id.padEnd(30)} ${o.outcome}${o.detail ? `  ${o.detail}` : ""}`);
    return;
  }
  throw new Error("usage: workplace poll gmail|drive|outlook|onedrive | sheets | books xero|exact [--dry-run] | xero-tenants");
}

main().catch((e: Error) => { console.error(e.message); process.exit(1); });
