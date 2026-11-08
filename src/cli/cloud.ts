// npm run cloud -- push | mail
//   push: send what this ledger records to Purser Cloud (idempotent; only what the cloud does not hold yet).
//   mail: file the e-mail the cloud received for this company through the payables inbox.
// Configuration from the environment only: PURSER_CLOUD_URL, PURSER_CLOUD_KEY (a key with the sync scope; never in
// git or a log), and optionally PURSER_CLOUD_PEOPLE, a JSON map from a passkey's label to the cloud person's id.

import { ClaudeReader } from "../claude/reader.js";
import { pullMail, pushToCloud } from "../cloudsync/client.js";
import { openDb } from "../db/open.js";

const url = process.env.PURSER_CLOUD_URL;
const key = process.env.PURSER_CLOUD_KEY;
if (!url || !key) {
  console.error("set PURSER_CLOUD_URL and PURSER_CLOUD_KEY (a key with the sync scope) in the environment");
  process.exit(1);
}
const people = process.env.PURSER_CLOUD_PEOPLE ? (JSON.parse(process.env.PURSER_CLOUD_PEOPLE) as Record<string, string>) : {};
const db = openDb();
const target = { url, key, people };

const cmd = process.argv[2];
if (cmd === "push") {
  for (const r of await pushToCloud(db, target)) console.log(JSON.stringify(r));
} else if (cmd === "mail") {
  const dir = process.env.KIT11_AP_DIR ?? "data/ap";
  for (const r of await pullMail(db, { dir, reader: new ClaudeReader(db) }, target)) console.log(`${r.id}: ${r.status}${r.note ? ` (${r.note})` : ""}`);
} else {
  console.error("usage: npm run cloud -- push | mail");
  process.exit(1);
}
