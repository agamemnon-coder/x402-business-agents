# Invoices by e-mail from Gmail or Outlook

Every company in Purser Cloud has its own invoice address: `<company>@<mail domain>`, shown in Settings, Company,
Inbox (for example `northwind@in.purser.example`). `<company>+anything@<mail domain>` reaches the same inbox. Purser
files every PDF attached to a message sent there (at most 20 per message; an e-mail inside an e-mail is not opened) and
checks each invoice as it does an upload. Nothing that arrives by e-mail is paid without the CFO's passkey.

The address works once the platform has set up the mail domain ([owner-setup.md](owner-setup.md), "E-mail inbox").
Until then Settings says "not routed" and "Your connections" says "not available yet".

What is built and what is not (20 Nov 2026):

- **Built, tested with stand-ins:** the address per company, a daily quota (500 messages, 500 MB), duplicates queued
  once, unknown addresses refused (`cloud/src/mail.ts`); and, new, Gmail's forwarding confirmation code shown to the
  company's owners in Settings (below).
- **Not built: sender checks (SPF, DKIM, DMARC).** Purser does not read a message's authentication results today
  ([go-live.md](../go-live.md): "code checks after" the domain exists). Forwarding breaks SPF anyway (the message then
  comes from Google's or Microsoft's servers); DKIM usually survives, and Gmail and Microsoft 365 add ARC seals. A
  check, when it is built, should read DKIM and ARC, not SPF. What protects the money today: the invoice checks
  (a known supplier, unchanged bank details, no duplicate) and the CFO's passkey on every payment.
- **Not tested live:** no mail domain is routed yet, so no message from Gmail or Outlook has reached Purser.

## Gmail (a personal Google account)

1. Gmail, the gear, **See all settings**, **Forwarding and POP/IMAP**, **Add a forwarding address**: enter the
   company's Purser address. Gmail sends a confirmation code to that address.
2. Purser Cloud, Settings, Company: the code appears there ("Gmail's forwarding confirmation code: 123456789"), within
   a minute. Only the code and the Gmail address are read from that message; its links are never shown.
3. Back in Gmail, enter the code and **Verify**.
4. Forward invoices only, not all your mail: Gmail search box, **Show search options**, "Has the words":
   `filename:pdf (invoice OR factuur OR rechnung)`, "Has attachment" ticked, **Create filter**, **Forward it to** the
   Purser address, **Create filter**.

## Google Workspace (an administrator, for a shared mailbox such as invoices@company.com)

No code is needed this way, and it does not depend on one person's settings:

1. Google Admin console, **Apps**, **Google Workspace**, **Gmail**, **Routing**, **Configure** (or **Add another rule**).
2. Messages to affect: **Inbound**. For: the invoices mailbox (envelope recipient, or the group).
3. Also deliver to: **Add more recipients**, **Add**, Advanced, the Purser address. **Save**.

If users forward their own mailboxes instead, the setting "Allow users to automatically forward incoming email to
another address" (Gmail, End User Access) must be on.

## Outlook.com (a personal Microsoft account)

1. Outlook on the web, the gear, **Mail**, **Rules**, **Add new rule**.
2. Condition: **Has attachment**, and add **Subject includes** `invoice` (or `factuur`).
3. Action: **Redirect to** the Purser address (Redirect keeps the supplier as the sender; Forward makes you the sender).
   **Save**. No confirmation code is sent.

Or forward everything: the gear, **Mail**, **Forwarding**, **Enable forwarding**, the Purser address, keep a copy.

## Microsoft 365 (Outlook for work)

Set the same rule as for Outlook.com in the mailbox. Microsoft 365 blocks automatic forwarding to outside addresses by
default, so an administrator allows it once, for that mailbox only:

1. Microsoft Defender portal, **Email & collaboration**, **Policies & rules**, **Threat policies**, **Anti-spam**.
2. **Create policy**, **Outbound**: name it "Forward invoices to Purser", apply it to the invoices mailbox only.
3. **Forwarding rules**, Automatic forwarding rules: **On - Forwarding is enabled**. Save.

Without this, the rule runs but the message is refused with "550 5.7.520 Access denied, your organization does not
allow external forwarding". A transport rule (Exchange admin center, **Mail flow**, **Rules**, "Bcc the message to")
is the other way, and also needs no per-user setting.

## Check that it works

Send one PDF invoice to the mailbox you forward. Within a few minutes it is in Purser Cloud, Invoices. If not:
Settings, "Your connections", "Invoices by e-mail" must say connected; the runner (or the cloud's engine) must be
running to file it.
