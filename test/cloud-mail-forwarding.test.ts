// Invoices forwarded from Gmail (docs/integrations/email-forwarding.md): Gmail asks the forwarding address to confirm with
// a code it mails there, where no person reads it. Purser Cloud takes the code (digits only) and the Gmail address from
// that message's subject into the company's security events, and shows them to the company's owners; nothing else of
// the message, and only from Gmail's own sender address.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forwardingConfirmation, receiveEmail } from "../cloud/src/mail.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const DOMAIN = "in.cloud.test";
const NOW = new Date("2026-11-08T12:00:00Z");
const mail = (from: string, subject: string) => new TextEncoder().encode(`From: ${from}\r\nTo: northwind@${DOMAIN}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\nClick https://mail-settings.google.com/mail/vf-abc to confirm.\r\n`);
const GMAIL_SUBJECT = "(#123456789) Gmail Forwarding Confirmation - Receive Mail from ap.northwind@gmail.com";

let c: TestCloud, t: TestTenant;
beforeEach(async () => { c = testCloud(); c.env.mailDomain = DOMAIN; t = await c.tenant("northwind"); });
afterEach(() => c.close());

async function deliver(from: string, raw: Uint8Array) {
  return receiveEmail(c.env.sql, c.env.blobs, { from, to: `northwind@${DOMAIN}`, raw, rawSize: raw.length, setReject() { /* taken */ } }, { domain: DOMAIN, now: NOW });
}

describe("Gmail's forwarding confirmation", () => {
  it("reads the code and the Gmail address from the subject, from Gmail's sender only", () => {
    expect(forwardingConfirmation(mail("forwarding-noreply@google.com", GMAIL_SUBJECT), "forwarding-noreply@google.com")).toEqual({ code: "123456789", gmail: "ap.northwind@gmail.com" });
    expect(forwardingConfirmation(mail("forwarding-noreply@google.com", GMAIL_SUBJECT), "someone@evil.example")).toBeNull();
    expect(forwardingConfirmation(mail("forwarding-noreply@google.com", "Your invoice 2026-114"), "forwarding-noreply@google.com")).toBeNull();
    expect(forwardingConfirmation(mail("forwarding-noreply@google.com", "(#123) Gmail Forwarding Confirmation - Receive Mail from https://evil.example"), "forwarding-noreply@google.com")).toBeNull();
  });

  it("shows the code to the company's owners in Settings, and never a link from the message", async () => {
    expect((await deliver("forwarding-noreply@google.com", mail("forwarding-noreply@google.com", GMAIL_SUBJECT))).queued).toBe(true);
    const r = await c.req("GET", "/v1/mail/forwarding-confirmations", { key: t.session });
    expect(r.json.items).toEqual([{ code: "123456789", gmail: "ap.northwind@gmail.com", at: NOW.toISOString() }]);
    expect(JSON.stringify(r.json)).not.toContain("mail-settings.google.com");
    // A key that only reads does not see it; the message is still queued for the runner as any other.
    const read = await c.req("POST", "/v1/keys", { key: t.session, body: { name: "r", scopes: ["read"] } });
    expect((await c.req("GET", "/v1/mail/forwarding-confirmations", { key: read.json.api_key as string })).status).toBe(403);
    expect(((await c.req("GET", "/v1/mail", { key: t.key })).json.items as unknown[]).length).toBe(1);
  });

  it("ignores an ordinary supplier's e-mail", async () => {
    await deliver("billing@supplier.example", mail("billing@supplier.example", "Invoice 2026-114"));
    expect((await c.req("GET", "/v1/mail/forwarding-confirmations", { key: t.session })).json.items).toEqual([]);
  });
});
