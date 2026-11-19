// npm run notify:approvals: tells Slack and/or Microsoft Teams about each payment that waits for the CFO's signature,
// once per proposal (src/integrations/approvalChat.ts). Run it from cron or a scheduler next to your Purser Cloud.
//
// From the environment only: PURSER_URL and PURSER_API_KEY (a key with the read scope is enough), and
// PURSER_SLACK_WEBHOOK_URL and/or PURSER_TEAMS_WEBHOOK_URL. PURSER_CHAT_STATE names the file of proposals already told
// (default .purser-approval-chat.json; it holds proposal ids only). Prints each proposal id with the channel and its
// HTTP status; never a URL or a key. The message links to the passkey page; nothing in it can approve.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Purser } from "../sdk/typescript/src/index.js";
import { CHAT_ENV, chatTargetsFromEnv, noticeFromInvoice, notifyApproval } from "../src/integrations/approvalChat.js";

const env = process.env;
const missing = ["PURSER_URL", "PURSER_API_KEY"].filter((k) => !env[k]);
if (missing.length) { console.log(`set ${missing.join(" and ")} (from the environment); nothing was sent`); process.exit(2); }
if (!chatTargetsFromEnv(env).length) { console.log(`set ${CHAT_ENV.slack} and/or ${CHAT_ENV.teams} (from the environment); nothing was sent`); process.exit(2); }

const stateFile = env.PURSER_CHAT_STATE ?? ".purser-approval-chat.json";
const told = new Set<string>(existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as string[]) : []);
const purser = Purser.fromEnv(env);

for (const inv of await purser.listPayableInvoices()) {
  const notice = noticeFromInvoice(inv, env.PURSER_URL!);
  if (!notice || told.has(notice.proposal_id)) continue;
  const results = await notifyApproval(notice, { env });
  console.log(`${notice.proposal_id}: ${results.map((r) => `${r.channel} ${r.ok ? "sent" : "failed"} (${r.status})`).join(", ")}`);
  if (results.some((r) => r.ok)) told.add(notice.proposal_id);
}
writeFileSync(stateFile, JSON.stringify([...told].sort()));
