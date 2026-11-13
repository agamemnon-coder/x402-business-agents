// npm run alerts:live: ONE live approval alert by WhatsApp, through Twilio's WhatsApp sandbox, for a sandbox approval: the
// demo company's invoice that waits for the CFO's Face ID (made-up data, test money; nothing is paid, nothing approves).
// It needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM (the sandbox's sender) and ALERT_WHATSAPP_TO (a
// number that joined the sandbox), from the environment only. Without them it says so and sends nothing.
//
// It writes docs/runs/<day>-approval-alert.json and .md: the message's SID, Twilio's status and the alert's words. Never
// the recipient's number, not even masked, and never a credential.

import { mkdirSync, writeFileSync } from "node:fs";
import { alertText, cleanTarget, twilioWhatsApp, type ApprovalAlert } from "../cloud/src/alerts.js";

const env = process.env;
const missing = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "ALERT_WHATSAPP_TO"].filter((k) => !env[k]);
if (missing.length) {
  console.log(`built, live once Twilio keys are set (missing: ${missing.join(", ")}); nothing was sent`);
  process.exit(2);
}

const now = new Date();
const day = now.toISOString().slice(0, 10);
const origin = (env.ALERT_ORIGIN ?? "https://purser-try.max-31b.workers.dev").replace(/\/$/, "");
// The demo company's invoice waiting for the CFO (cloud/src/guest/seed.gen.ts, AP-0005): made-up data, test money.
const alert: ApprovalAlert = {
  key: `live-proof|AP-0005|P-0009|${now.toISOString()}`, invoice_id: "AP-0005", proposal_id: "P-0009", amount: "1309.00", currency: "EUR",
  payee: "Bergtex Textil GmbH", why: "The checks found nothing irregular.", due_date: "2026-11-23", link: `${origin}/#/invoices/AP-0005`, test_money: true,
};
const to = cleanTarget("whatsapp", env.ALERT_WHATSAPP_TO!);
const res = await twilioWhatsApp({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, whatsappFrom: env.TWILIO_WHATSAPP_FROM! }, (u, i) => fetch(u, i)).send(to, alert, "live-proof");

const record = {
  what: "One live approval alert by WhatsApp through Twilio's WhatsApp sandbox, for a sandbox approval (the demo company's invoice AP-0005: made-up data, test money).",
  at: now.toISOString(),
  channel: "whatsapp (Twilio WhatsApp sandbox)",
  ok: res.ok,
  http_status: res.status,
  message_sid: res.providerRef ?? null,
  recipient: "not recorded",
  text: alertText(alert),
  approves: "nothing: the alert carries no token, code or reply word; approving takes the CFO's passkey (Face ID) in Purser Cloud",
  code: "cloud/src/alerts.ts twilioWhatsApp, alertText; scripts/approval-alert-live.ts",
};
mkdirSync("docs/runs", { recursive: true });
writeFileSync(`docs/runs/${day}-approval-alert.json`, `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(`docs/runs/${day}-approval-alert.md`, [
  `# Approval alert by WhatsApp, live in Twilio's sandbox (${day})`,
  "",
  record.what,
  "",
  `- Sent: ${record.at}, Twilio answered ${res.status}${res.ok ? "" : " (not sent)"}.`,
  `- Message SID: ${record.message_sid ? `\`${record.message_sid}\`` : "none (Twilio did not accept it)"}.`,
  "- Recipient: a number that joined the sandbox; not recorded here.",
  "- Nothing in it approves: no token, code or reply word. Approving takes the CFO's passkey (Face ID) in Purser Cloud.",
  "",
  "The message, as sent:",
  "",
  "```",
  record.text,
  "```",
  "",
  `Made by \`npm run alerts:live\` (${record.code}).`,
  "",
].join("\n"));
console.log(res.ok ? `sent: ${record.message_sid}` : `not sent: Twilio answered ${res.status}`);
process.exit(res.ok ? 0 : 1);
