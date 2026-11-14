// npm run t0:readback [-- --from <saved T:0 response.json>]: T:0's read-back of the main run's books (entry date
// 2026-11-03, manual entries), kept as a record a reader can download and check: docs/runs/2026-11-14-t0-readback.json.
// Read only: one GET /v1/journal-entries (or none, with --from). Then the month-close check (src/accounting/closeGate.ts)
// runs on it against Purser's books as recorded on 10 Nov (src/accounting/recordedChecks.ts), and its result is written
// into the record. The record keeps T:0's ids, our je_numbers, dates, timestamps and amounts; no key, header or token.
// Other teams' entries on the shared entity are counted, never copied.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { T0Client, type T0JournalEntry } from "../src/accounting/t0.js";
import { readBackRecord } from "../src/accounting/t0Readback.js";

const { values } = parseArgs({ options: { from: { type: "string" }, out: { type: "string", default: "docs/runs/2026-11-14-t0-readback.json" }, day: { type: "string", default: "2026-11-03" } } });
const ENTITY = "entity_prod_ieEAMzvhgtHalvsm";

let entries: T0JournalEntry[] = [];
let readAt = new Date().toISOString();
if (values.from) {
  const body = JSON.parse(readFileSync(values.from, "utf8")) as { data: T0JournalEntry[]; read_at?: string };
  entries = body.data;
  if (body.read_at) readAt = body.read_at;
} else {
  const key = process.env.T0_API_KEY;
  if (!key) throw new Error("T0_API_KEY is not set (or pass --from a saved response)");
  const client = new T0Client({ apiKey: key, entity: ENTITY });
  for await (const e of client.listJournalEntries({ dateFrom: values.day, dateTo: values.day, source: ["manual"] })) entries.push(e);
}
const record = readBackRecord(entries, { readAt, entity: ENTITY, day: values.day! });
writeFileSync(values.out!, `${JSON.stringify(record, null, 2)}\n`);
console.log(`${values.out}: ${record.entries.length} Purser entries, ${record.other_entries_ignored} other ignored; ${record.close_check.text}`);
