# Workplace integrations

Plug Purser into the tools a company already uses: Google Workspace, Microsoft 365, Apple Wallet and Shortcuts, Exact
Online and Xero. Each one is a small module under [`src/workplace/`](../../src/workplace) with one job, and each is
tested against a local mock of the provider's REST API, with request shapes taken from the provider's own reference.

**Status, for every integration on this page: built and tested against a mock; needs the owner's OAuth app to run
live.** None of them has been run against a real Google, Microsoft, Apple or Xero account. The owner's steps to go
live are under each integration.

Other ways to connect to Purser (OpenAPI, the SDKs, A2A, n8n, Slack and Teams approval notices) are on
[Connect Purser to anything](README.md), every connection with its label; MCP and Claude are on [docs/mcp.md](https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/mcp.md) and [connect-claude.md](../connect-claude.md).

## The safety boundary

An integration may **bring invoices in**, **read**, and **propose**. It never approves and never pays.

- Only the CFO's **passkey** approves money: a signed-in person in Purser Cloud signs the exact terms, and one changed
  cent breaks the signature. `POST /v1/engine/proposals/{id}/approve` needs a signed-in person's session; no API key,
  OAuth token or integration reaches it.
- The inboxes (Gmail, Drive, Outlook, OneDrive) only fetch files. Each file goes through Purser's one way in,
  `ingestDocument` in [`src/ap/inbox.ts`](../../src/ap/inbox.ts): read, checked and filed with a status, exactly like an
  upload. A PDF goes through the existing pipeline unchanged.
- The exports (Sheets, Exact Online, Xero) write copies of what Purser already booked. Nothing they write is read back
  into Purser, and none of them can move money.
- The Wallet pass and the Shortcuts recipe only tell and link: the one link is the invoice's page in Purser Cloud,
  where the passkey signs.
- "Sign in with Google" makes a **viewer**. The identity it returns has `role: "viewer"` and `canApprove: false` in its
  type. The passkey stays required for every approval.

**Secrets.** Every OAuth client secret, refresh token and access token comes from the environment or the deployment's
secret config. None is in code or git, and none is logged: errors name the call (host and path, never the query) and
the provider's short error words, never a token or a token answer's body. A refused token request keeps only the OAuth
error code (`invalid_grant`).

**Inbound data.** Every answer from a provider is read with a size cap before it is parsed (4 MB for JSON), then
checked with a zod schema; an answer that is not the documented shape is refused and names only the path of the first
problem. Attachments and files are capped at the inbox's own limit (15 MB for a PDF; a UBL file may be up to about
22 MB because the PDF inside it is base64). The cap applies twice: to the declared size before anything is fetched,
and to the bytes as they arrive. Ids from a provider go into a URL only if they match the provider's id alphabet, and
a "next page" link is followed only on the provider's own address, so a token is never sent elsewhere.

**UBL invoices.** Purser reads invoices from their PDF. A UBL 2.1 invoice (Peppol BIS Billing 3.0, SI-UBL 2.0) is taken
in through the PDF it carries in `cac:AdditionalDocumentReference/cac:Attachment/cbc:EmbeddedDocumentBinaryObject`
(`mimeCode="application/pdf"`). That PDF is read and checked like any other. The UBL's own figures are kept beside it
as labelled metadata and never decide an amount. A UBL file without an embedded PDF is refused with that reason, and
so is a file with a `DOCTYPE` or an entity declaration ([`src/workplace/ubl.ts`](../../src/workplace/ubl.ts)).

## What is built, per integration

| Integration | Module | Scopes (minimum) | Reads or writes | Test |
|---|---|---|---|---|
| Gmail inbox | [`gmail.ts`](../../src/workplace/gmail.ts) | `gmail.readonly` | reads | [`workplace-google.test.ts`](../../test/workplace-google.test.ts) |
| Drive watched folder | [`gdrive.ts`](../../src/workplace/gdrive.ts) | `drive.readonly` | reads | [`workplace-google.test.ts`](../../test/workplace-google.test.ts) |
| Sheets export | [`sheets.ts`](../../src/workplace/sheets.ts) | `spreadsheets` | appends rows to one sheet | [`workplace-google.test.ts`](../../test/workplace-google.test.ts) |
| Sign in with Google | [`googleSignIn.ts`](../../src/workplace/googleSignIn.ts) | `openid email` | reads who signed in | [`workplace-signin.test.ts`](../../test/workplace-signin.test.ts) |
| Outlook mail folder | [`graph.ts`](../../src/workplace/graph.ts) | `Mail.Read`, `offline_access` | reads | [`workplace-microsoft.test.ts`](../../test/workplace-microsoft.test.ts) |
| OneDrive / SharePoint folder | [`graph.ts`](../../src/workplace/graph.ts) | `Files.Read`, `offline_access` | reads | [`workplace-microsoft.test.ts`](../../test/workplace-microsoft.test.ts) |
| Apple Wallet pass | [`wallet.ts`](../../src/workplace/wallet.ts) | none (owner's Pass Type ID certificate) | builds a pass | [`workplace-apple.test.ts`](../../test/workplace-apple.test.ts) |
| Apple Shortcuts | this page | a Purser API key with `read` only | reads | (a recipe; it calls the tested read API) |
| Exact Online | [`src/erp/exact.ts`](../../src/erp/exact.ts), reused | Exact's app (no scopes; the app's rights) | pushes contacts and journal entries | [`workplace-accounting.test.ts`](../../test/workplace-accounting.test.ts) |
| Xero | [`xero.ts`](../../src/workplace/xero.ts) | `accounting.manualjournals`, `accounting.contacts`, `offline_access` | pushes contacts and manual journals | [`workplace-accounting.test.ts`](../../test/workplace-accounting.test.ts) |

OAuth 2.0 for Google, Microsoft and Xero is the authorization code flow with PKCE (S256), a random `state`, and for
OpenID Connect a `nonce` ([`oauth.ts`](../../src/workplace/oauth.ts)). It reuses the PKCE pair, `state` and the
refusal error from Purser's own OAuth connections ([`src/lib/oauth.ts`](../../src/lib/oauth.ts)). A list of broader
scopes is never asked for: `https://mail.google.com/`, `gmail.modify`, `gmail.send`, `drive`, `Mail.ReadWrite`,
`Mail.Send`, `Files.ReadWrite(.All)`, `accounting.transactions`, `accounting.payments` and
`accounting.banktransactions`. An authorization URL that asks for one is refused before it is built.

From a terminal (each reads its settings from the environment):

```
npx tsx src/cli/workplace.ts poll gmail|drive|outlook|onedrive   # fetch invoices and file them through the inbox
npx tsx src/cli/workplace.ts sheets                               # append paid invoices and the journal to the sheet
npx tsx src/cli/workplace.ts books xero|exact [--dry-run]         # push suppliers and the payables journal
npx tsx src/cli/workplace.ts xero-tenants                         # which Xero organisations the token reaches
```

## Google

### Register the OAuth app (once, for Gmail, Drive, Sheets and sign-in)

1. In the Google Cloud console, create a project for Purser and enable only the APIs you will use: Gmail API, Google
   Drive API, Google Sheets API.
2. OAuth consent screen: user type **Internal** (Google Workspace) so only your organisation's accounts can consent.
   Add only the scopes below for the integrations you turn on.
3. Credentials, Create OAuth client ID, type **Web application**. Add your redirect URI exactly (for example
   `https://<your-purser-cloud>/oauth/google`). Keep the client secret in your secret store.
4. Environment: `PURSER_GOOGLE_CLIENT_ID`, `PURSER_GOOGLE_CLIENT_SECRET`.
5. Authorize once per integration with that integration's scopes only (`workplaceAuthorizeUrl` with `offline: true`
   asks for a refresh token), exchange the code with the PKCE verifier, and store the refresh token as the
   integration's secret below. Earlier grants are never merged in (no `include_granted_scopes`), so each token holds
   only its own scope.

`gmail.readonly`, `drive.readonly` and `spreadsheets` are restricted or sensitive scopes. For an **Internal** app in
your own Workspace no Google verification is needed. A public app would need Google's verification and, for Gmail, a
security assessment: that is the owner's decision and is not done here.

### Gmail inbox

- **Scope:** `https://www.googleapis.com/auth/gmail.readonly`. Purser can list and read messages. It cannot send,
  delete, label or move mail.
- **Calls:** `users.messages.list` (`q` and/or `labelIds`), `users.messages.get?format=full`,
  `users.messages.attachments.get` (base64url data).
- **Environment:** `PURSER_GMAIL_REFRESH_TOKEN`, and `PURSER_GMAIL_LABEL` (a label name, for example `invoices`, read
  as `label:invoices has:attachment`) or `PURSER_GMAIL_QUERY` (full Gmail search syntax). Optional
  `PURSER_GMAIL_SINCE` (a date; becomes `after:`).
- **What happens:** each PDF, UBL or photo attachment within the cap is fetched and filed through the inbox with the
  sender, subject and Message-ID as metadata (source `email`). The same attachment polled twice is the same document:
  the inbox knows it by its hash. A read-only scope cannot mark a message as processed, so a poll narrows by date
  instead.
- **Mock-tested:** list, get and attachment request shapes and the bearer header; filing through the real inbox; a
  second poll filed as a duplicate; nothing above the cap or of another type is fetched; a malformed answer, a
  path-like id and a 403 are refused without the query or token in the error.

### Drive watched folder

- **Scope:** `https://www.googleapis.com/auth/drive.readonly`. Nothing in Drive is moved, renamed or deleted.
- **Calls:** `files.list` with `q='<folderId>' in parents and trashed = false and (mimeType = 'application/pdf' or
  ...)`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true` (a shared drive works too); then
  `files.get?alt=media` for each file.
- **Environment:** `PURSER_GDRIVE_REFRESH_TOKEN`, `PURSER_GDRIVE_FOLDER_ID` (the last part of the folder's URL).
  Optional `PURSER_GDRIVE_SINCE` (only files modified after it).
- **Mock-tested:** the exact query, fields and alt=media download; a PDF and a UBL invoice with an embedded PDF filed,
  a UBL without a PDF refused and audited; a file above the cap not fetched; a download that lies about its size cut
  off at the cap.

Purser's document vault in Drive ([`src/vault/gdrive.ts`](../../src/vault/gdrive.ts)) is a separate integration that
writes the archive; this one only reads a folder.

### Sheets export

- **Scope:** `https://www.googleapis.com/auth/spreadsheets`, asked for this export alone. It is the one Google
  integration that writes, and it only appends rows to the spreadsheet you name. (If Purser should only ever touch a
  sheet it created, `drive.file` is narrower; the owner would then create the sheet through Purser.)
- **Calls:** `spreadsheets.values.get` on column A (the keys already written), then `spreadsheets.values.append` with
  `valueInputOption=RAW` and `insertDataOption=INSERT_ROWS`.
- **Environment:** `PURSER_SHEETS_REFRESH_TOKEN`, `PURSER_SHEETS_SPREADSHEET_ID`. Two tabs: `Paid invoices` and
  `Journal` (create them in the sheet first).
- **What happens:** the paid supplier invoices and the payables journal are appended, each row starting with a key.
  A row whose key is already in the sheet is not appended again, so running the export twice adds nothing. `RAW`
  means a supplier name that starts with `=` stays text and never becomes a formula in your sheet.
- **Mock-tested:** the header once, RAW and INSERT_ROWS, nothing appended on a second run, a formula-looking value kept
  as text, a sheet name with an apostrophe quoted.

### Sign in with Google (optional viewer login)

- **Scope:** `openid email`. No offline access.
- **Flow:** `startGoogleSignIn` gives the consent URL (PKCE, `state`, `nonce`) and what to keep in the session;
  `finishGoogleSignIn` checks the state, exchanges the code with the verifier and verifies the ID token:
  RS256 signature against Google's JWKS (`https://www.googleapis.com/oauth2/v3/certs`), `iss` is
  `https://accounts.google.com` or `accounts.google.com`, `aud` is your client id (`azp` too when there are several
  audiences), `exp` and `iat` within 60 seconds of the clock, the `nonce` is this sign-in's, `email_verified` is true,
  and, if you set allowed domains, `hd` is one of them.
- **Result:** a viewer (`role: "viewer"`, `canApprove: false`). Wiring it into Purser Cloud's session is a separate
  step and is not done on this branch; approvals keep needing the passkey either way.
- **Mock-tested:** with an RSA key made in the test: a good token accepted; wrong audience, wrong issuer, expired,
  issued in the future, wrong or missing nonce, unverified e-mail, wrong domain, another key's signature, `alg: none`,
  an unknown key id, a tampered payload and a malformed token all refused; a forged state refused before any code is
  exchanged.

## Microsoft

### Register the Entra app (once, for Outlook and OneDrive)

1. Microsoft Entra admin center, App registrations, New registration. Supported account types: **this organisation's
   directory only** (single tenant). Redirect URI (Web): for example `https://<your-purser-cloud>/oauth/microsoft`.
2. API permissions, Microsoft Graph, **Delegated**: `Mail.Read` for Outlook, `Files.Read` for OneDrive, plus
   `offline_access`. Use `Files.Read.All` only if the folder is in a SharePoint library or someone else's drive.
   No application permissions: Purser acts as the one user who consented, on that user's mail or files.
3. Certificates and secrets: a client secret (or none, for a public client with PKCE alone).
4. Environment: `PURSER_MS_TENANT_ID` (your tenant id or domain; `common` is refused), `PURSER_MS_CLIENT_ID`,
   `PURSER_MS_CLIENT_SECRET`.
5. Authorize once per integration with its scopes, exchange the code with the PKCE verifier, store the refresh token.
   Microsoft may rotate it on a refresh; the token source hands the new one to `onRotate` for your secret store.

### Outlook mail folder

- **Scope:** `Mail.Read` (delegated). Purser cannot send, move or delete mail.
- **Calls:** `GET /me/mailFolders/{id}/messages?$filter=hasAttachments eq true[ and receivedDateTime ge …]&$select=…`
  (paged with `@odata.nextLink`), `GET /me/messages/{id}/attachments?$select=id,name,contentType,size,isInline`, and
  `GET /me/messages/{id}/attachments/{id}/$value` for each file attachment within the cap. Attached items and links
  are not fetched.
- **Environment:** `PURSER_OUTLOOK_REFRESH_TOKEN`, `PURSER_OUTLOOK_FOLDER_ID` (a folder id, or `inbox`). Optional
  `PURSER_OUTLOOK_SINCE`.
- **Mock-tested:** filter, select and `$value` request shapes; filing through the inbox with sender, subject and
  Message-ID; item attachments and oversized files skipped; a next page on another host refused; a malformed folder
  id refused.

### OneDrive or SharePoint folder

- **Scope:** `Files.Read` (delegated); `Files.Read.All` only for a SharePoint library.
- **Calls:** `GET /drives/{drive-id}/root:/{folder-path}:/children?$select=…` and
  `GET /drives/{drive-id}/items/{item-id}/content` (a redirect to a pre-authenticated download URL; the bearer token is
  not sent across origins).
- **Environment:** `PURSER_ONEDRIVE_REFRESH_TOKEN`, `PURSER_ONEDRIVE_DRIVE_ID`, `PURSER_ONEDRIVE_FOLDER_PATH` (for
  example `Finance/Invoices in`; `..` is refused).
- **Mock-tested:** the path-addressed listing, subfolders and other types skipped, a PDF filed, a UBL with a DOCTYPE
  refused.

### Teams

Approval notices to Teams (an Adaptive Card whose one action opens the passkey page) are built on the integrations
branch's Slack and Teams webhook notifier (`src/integrations/approvalChat.ts`, described in [Connect to
Purser](README.md)). They are not duplicated here: on the Microsoft side this page covers the Graph inboxes only.

## Apple

### Apple Wallet pass: "payment waiting for your signature"

- **What is built:** `pass.json` (formatVersion 1, a `generic` pass with the amount, payee, invoice, proposal and
  "Test money" while it is), a 29 x 29 `icon.png`, and `manifest.json` with each file's SHA-1, in the `.pkpass` layout
  ([`wallet.ts`](../../src/workplace/wallet.ts)). Its one link, on the back and as the QR code, is the invoice's page in
  Purser Cloud (`https://<origin>/#/invoices/<id>`, the same link the approval alerts send). The pass has no
  `webServiceURL`, no `authenticationToken`, no NFC payload and no app launch: holding it approves nothing, and it says
  so on the back.
- **The owner's step: signing.** A pass installs only when `manifest.json` is signed (detached PKCS #7, DER) with an
  Apple Developer **Pass Type ID certificate** and Apple's WWDR intermediate certificate. That certificate and its
  private key are yours and never come near this code. `packPass(payment, identity, signer)` zips the files with the
  signature your signer returns, for example a signer that runs:

  ```
  openssl smime -binary -sign -certfile wwdr.pem -signer pass.pem -inkey pass.key \
    -in manifest.json -out signature -outform DER
  ```

- **Environment:** `PURSER_WALLET_PASS_TYPE_ID` (for example `pass.com.example.purser`), `PURSER_WALLET_TEAM_ID` (ten
  characters), optional `PURSER_WALLET_ORGANIZATION`.
- **Owner's steps:** in the Apple Developer account, Identifiers, add a Pass Type ID; create its certificate; download
  Apple's WWDR certificate; write the signer; optionally add higher-resolution icons and a logo. Then send the
  `.pkpass` (MIME type `application/vnd.apple.pkpass`) to the CFO when a proposal is filed.
- **Tested:** the required keys, the generic fields, the QR code and back link being the passkey page and the only URL,
  none of the action keys present, the manifest's SHA-1s, the zip's entries and CRCs, a valid PNG, settings from the
  environment. The signer in the test is a stand-in: the structure is tested, Apple's acceptance is not.

### Apple Shortcuts: "Get Purser approvals"

A shortcut on the CFO's iPhone that shows what waits for their passkey and opens it. It calls the read API only.

1. In Purser Cloud, Settings, API keys, make a key with the **`read`** scope only (it expires; revoke it any time).
   It cannot propose or approve: the approve route refuses every API key.
2. In Shortcuts, a new shortcut "Get Purser approvals":
   1. **Get Contents of URL**: `https://<your-purser-cloud>/v1/engine/invoices`, Method `GET`, Headers
      `Authorization: Bearer <your read key>` and `Accept: application/json`.
   2. **Get Dictionary Value**: key `items` from Contents of URL.
   3. **Repeat with Each** item in Dictionary Value:
      **Get Dictionary Value** `proposal` from Repeat Item; **Get Dictionary Value** `status` from it;
      **If** `status` is `PENDING_APPROVAL`: **Add to Variable** `Waiting` the text
      `Repeat Item.id · Repeat Item.vendor · Repeat Item.currency Repeat Item.total`.
   4. **Count** items in `Waiting`; **Show Notification** "`Count` payments wait for your passkey".
   5. **Choose from List** `Waiting`; **Get Text** before the first ` · ` (the invoice id); **Open URLs**
      `https://<your-purser-cloud>/#/invoices/<that id>`. Purser opens on the payment's page, where your passkey
      signs.
3. Optional: an Automation (for example each weekday at 9:00) that runs it.

The key lives in the shortcut on the phone: use a `read` key made for this alone, and revoke it if the phone is lost.

## Accounting: Exact Online and Xero

Both take what Purser booked, in the canonical model of Purser's ERP connectors
([`src/erp/model.ts`](../../src/erp/model.ts)): suppliers as contacts and the payables journal (each invoice's
accrual and payment, from `apJournal`) as balanced journal entries (`journalsFromApEntries`). `pushBooked` checks each
object against the model, looks for it first (a second run or a lost answer never makes a second one), then sends it;
one failure never stops the others ([`accounting.ts`](../../src/workplace/accounting.ts)). `BooksPush` is the part of
the ERP connector interface this needs, so the existing Exact Online and Moneybird connectors fit it unchanged.

### Exact Online

- **What is built:** the existing connector ([`src/erp/exact.ts`](../../src/erp/exact.ts), [docs/erp.md](../erp.md))
  is reused, not copied: contacts go to `crm/Accounts` (and `crm/BankAccounts`), journal entries to
  `generaljournalentry/GeneralJournalEntries`. The test pushes a contact and a journal entry through `pushBooked`
  against an OData v2 mock.
- **Owner's steps:** register an app in the Exact Online App Center (your redirect URI), authorize it once, then set
  `ERP_EXACT_CLIENT_ID`, `ERP_EXACT_CLIENT_SECRET`, `ERP_EXACT_REFRESH_TOKEN` (seeds the rotating token file
  `data/erp/exact.token.json`, mode 600), `ERP_EXACT_DIVISION` and the journal and VAT settings listed in
  [docs/erp.md](../erp.md). Exact's app rights are set on the app, not by scopes: give it only what the connector uses.

### Xero

- **Scopes:** `accounting.manualjournals`, `accounting.contacts`, `offline_access`. These are Xero's granular scopes,
  required for apps created after 2 March 2026. Nothing that touches invoices, payments or bank transactions is asked.
- **Calls:** `GET https://api.xero.com/connections` (the organisations the token reaches), then with the
  `xero-tenant-id` header: `GET Contacts?where=ContactNumber=="PURSER-<id>"` and `POST Contacts`;
  `GET ManualJournals?where=Narration=="… [Purser <id>]"` and `POST ManualJournals` with debits as positive and credits
  as negative `LineAmount`, `LineAmountTypes: "NoTax"` (Purser's lines already hold the VAT on its own account). Every
  POST carries an `Idempotency-Key`. Journals are `DRAFT` by default, so the accountant posts them in Xero;
  `ERP_XERO_JOURNAL_STATUS=POSTED` posts them directly. Manual journals are in the organisation's base currency only;
  an entry in another currency is refused with the reason.
- **Owner's steps:** at developer.xero.com, My Apps, New app, type **Web app**, your redirect URI; authorize with the
  three scopes above (PKCE), then set `ERP_XERO_CLIENT_ID`, `ERP_XERO_CLIENT_SECRET`, `ERP_XERO_REFRESH_TOKEN` (seeds
  the rotating token file `data/erp/xero.token.json`, mode 600; Xero rotates the refresh token on every refresh). Run
  `npx tsx src/cli/workplace.ts xero-tenants` and set `ERP_XERO_TENANT_ID`. Optional: `ERP_XERO_GL_MAP` (Purser account
  code to Xero account code, JSON), `ERP_XERO_BASE_CURRENCY` (default EUR), `ERP_XERO_JOURNAL_STATUS`.
- **Mock-tested:** contact lookup then create with tenant, bearer and idempotency headers and the documented body;
  a manual journal's lines, signs and mapped accounts; found-existing instead of a second push; another currency,
  an unbalanced entry and Xero's validation error each reported; the rotating refresh under the token store with HTTP
  Basic; the connections call; settings from the environment.

## Going live, in short

| Provider | The owner registers | Then sets | Live check |
|---|---|---|---|
| Google | an Internal OAuth client (Web), the APIs enabled | `PURSER_GOOGLE_CLIENT_ID/SECRET`, a refresh token per integration, folder or sheet ids | `poll gmail`, `poll drive`, `sheets` on a test label, folder and sheet |
| Microsoft | a single-tenant Entra app, delegated `Mail.Read` / `Files.Read` | `PURSER_MS_TENANT_ID/CLIENT_ID/CLIENT_SECRET`, refresh tokens, folder and drive ids | `poll outlook`, `poll onedrive` on a test folder |
| Apple | a Pass Type ID and its certificate | `PURSER_WALLET_PASS_TYPE_ID/TEAM_ID`, a signer | open a signed `.pkpass` on an iPhone |
| Apple Shortcuts | nothing at Apple | a `read` API key in the shortcut | run the shortcut with one proposal waiting |
| Exact Online | an App Center app | `ERP_EXACT_*` | `books exact` in a test division |
| Xero | a Web app with the three scopes | `ERP_XERO_*` | `books xero` against Xero's Demo Company |

Until those steps are done, every integration here is built and tested against a mock, and nothing on this page has
run against a real account.
