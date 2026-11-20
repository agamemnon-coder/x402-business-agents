# Retention and deletion

> **An engineering inventory, not legal advice.** These are the rules Purser Cloud's code applies, written down so a
> reviewer can check them. The periods follow the engineering team's reading of Dutch law and the GDPR. **The owner must
> confirm them with a qualified adviser** before Purser holds any real company's data. Test money only today.

This answers the outside audit's finding 3.4 ("no retention period or deletion procedure for ledger data and related
personal and financial information"). What is stored, where and on which legal basis is in
[data-inventory.md](data-inventory.md).

## Principles

1. **Keep the books, as they are.** Bookkeeping is kept for seven years (Article 2:10 BW, Article 52 AWR). Purser Cloud
   keeps a company's bookkeeping until 31 December of the seventh year after its last record, then purges it whole.
2. **Never rewrite audit evidence.** The audit log and the ledger are hash chains: each row's hash covers the one before.
   They are kept unchanged or deleted whole, never edited, so the chains still verify after any minimisation.
3. **Minimise the personal data around the books at once.** Names, e-mail addresses, phone numbers, passkeys, sessions
   and sign-in links are not bookkeeping. When a person is erased or a company is offboarded they are removed or replaced
   by a pseudonym straight away, not after seven years.
4. **Expire what is short-lived on a schedule.** Sessions, challenges, recovery requests, export links and exports expire
   on their own; the daily job deletes them.
5. **Touch one company only.** Every deletion is scoped by the company's id; tests hold that another company's rows and
   documents are left as they were.

## Rules per category

| Category | Examples | Kept for | Then |
|---|---|---|---|
| Statutory bookkeeping | Invoices and their documents and e-mails, suppliers with their bank details, payments, transactions, the ledger, the audit log, pushes to bookkeeping packages, the Airwallex account record | Seven years: until 31 December of the seventh year after the company's last record | Purged whole by the daily job (`purgeExpired`), documents and the company's engine included |
| People's identity and contact | Names, e-mail addresses, linked sign-in accounts | While the person has access | On erasure or offboarding: name replaced by a pseudonym, e-mail and links removed at once. The row (an id and a role) stays until the purge, so the records that name the id still read |
| Authentication | Passkeys, sessions, invites, keys | While the person or key is in use | Passkeys removed and keys revoked on erasure or offboarding; sessions deleted a day after expiry and at offboarding |
| Message targets | The webhook, alert phone numbers and e-mail addresses, Slack and Teams hooks | Until an owner removes them | Deleted at offboarding; the alert log keeps only a masked target, replaced by `[removed]` |
| Exports | A staged export's parts in R2 | A day | Swept by the daily job (`sweepExports`) |
| Export links | A spent download link's nonce | 15 minutes | Swept by the daily job |
| Sign-in challenges | Single-use passkey challenges | A day after expiry | Daily job |
| Owner recovery requests | Two platform admins' recovery of an owner | Unapproved: a day after expiry. Approved: a year | Daily job (`pruneRecoveryRequests`) |
| The company's security events | Who changed what in its security settings | Until the purge | Purged with the company |
| The platform's security log | Sign-in failures, refusals, admin actions (IP cut to its network) | A year; a database trigger refuses an earlier delete | Daily job (`pruneSecurityLog`) |
| Rate counters | Requests per key, person or network | A day | Daily job |
| Hands-on demo companies | Made-up data | 24 hours | Swept (`sweepTry`) |

## Offboarding a company

A company leaves with `POST /v1/offboarding` ([cloud/src/privacy.ts](../../cloud/src/privacy.ts) `offboardTenant`). It
is the only way a company's account ends together with its personal data.

**Who may.** A signed-in owner, whose passkey was checked in the last five minutes (a sign-in or a step-up), always,
whatever the company's step-up setting. A key cannot, and neither can a CFO, an accountant or a viewer
([cloud/src/stepUp.ts](../../cloud/src/stepUp.ts)).

**Export first.** The owner makes the company's export (`POST /v1/export/staged`) and downloads it, then offboards
within its day, naming that export and typing the company's address to confirm. Without a downloaded, open export it is
refused.

**In the console.** Settings, *Close and offboard the company*, shown only to an owner signed in with their passkey
([cloud/src/offboardingView.ts](../../cloud/src/offboardingView.ts)), walks through the same steps in this order:
download the export (the console makes the staged export, fetches its manifest and every part by their signed links,
checks each part's SHA-256 and saves them as one file), type the company's address, check with the passkey (a step-up,
always), then offboard. It adds no rule of its own: what it sends is the API's request, and a refusal is shown as the API
words it. The same request works without the console.

**What happens, in one transaction:**

1. The account closes: every key is revoked, every session ends, the connected accounts' tokens are deleted, and the
   purge day is set (seven years after the company's last record).
2. Each person's name becomes `Former member <id>` and their e-mail is removed; their passkeys, linked sign-in accounts,
   sessions, open invites and owner recovery requests are deleted. The company's engine first revokes each person's
   approval passkey.
3. The webhook, alert targets and chat hooks are deleted; the alert log's masked targets become `[removed]`.
4. The bookkeeping is not touched: every row of the statutory tables, the documents and the e-mails stay as they were,
   and both hash chains still verify.
5. It is recorded: a `company.offboarded` event in the company's security events, and an `access.change` row in the
   platform's security log, with the counts and the export's id; never a name.

**Afterwards.** The export's parts stay downloadable for the rest of their day, by the links already issued. On the
purge day the daily job deletes every row and document of the company and wipes its engine; a tombstone keeps the
company's address from being given to anyone else.

`POST /v1/close` (closing without the minimisation above) still exists for owners and admin keys; offboarding is the
complete procedure.

## Erasing one person

`POST /v1/users/{id}/erase` replaces a person's name and removes their e-mail, passkeys, linked accounts and keys at once,
and keeps the books. The last owner cannot be erased; the company is offboarded instead.

## What is not minimised, and why

- **The audit log and the ledger.** Rewriting a row to remove a name would break the hash chain that proves nothing was
  changed. They record actors by role, agent or id, and the runner strips secrets before it writes them. They are kept
  for the statutory period and deleted whole.
- **Supplier records.** A sole trader's name and bank details are personal data, and they are also the bookkeeping the
  law asks to keep. They are kept until the purge day.
- **The e-mails invoices came in.** Kept as the invoice as received. The owner should confirm with the adviser whether
  the e-mail itself must be kept, or only its attachment; if only the attachment, the e-mail could be deleted at
  offboarding.
- **The public blockchain.** Testnet payments between agents are on a public chain and cannot be deleted. Purser writes
  addresses, amounts and hashes there, never a name or an e-mail address.

## Open items

- `try_feedback` (the hands-on demo's optional note, up to 200 characters, no address) has no automatic deletion. A
  12-month rule and a daily prune would fit.
- The period Cloudflare's Workers Logs keep request lines is the account plan's; the owner should check it.
- Data processing agreements and transfer mechanisms for the subprocessors
  ([data-inventory.md](data-inventory.md#subprocessors-the-code-calls)) are for the owner and the adviser.

## Tests

- [test/console-offboarding.test.ts](../../test/console-offboarding.test.ts): the console's screen shows only to an owner's
  passkey session, opens its steps in the API's order, shows the API's refusal as it comes, and downloads the export
  against the API.
- [test/cloud-offboarding.test.ts](../../test/cloud-offboarding.test.ts): only a signed-in owner with a fresh passkey
  offboards, and only after a downloaded export; offboarding one company leaves another's rows and R2 objects exactly
  as they were; the bookkeeping and its documents are kept byte for byte and both hash chains still verify; the purge
  comes only after the retention day; expired recovery requests are pruned.
- [test/cloud-retention.test.ts](../../test/cloud-retention.test.ts): erasure keeps the books; a closed company is purged
  only after seven full years, and no other company.
- [test/cloud-worker-entry.test.ts](../../test/cloud-worker-entry.test.ts): the daily job runs every prune.
