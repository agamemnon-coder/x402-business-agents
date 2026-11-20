# Connecting Purser to everything: what to register, pay and set

## Samenvatting (Nederlands)

Purser kan nu met veel systemen praten, maar een paar dingen moet jij als eigenaar van het platform **één keer**
regelen: accounts aanmaken bij Google, Microsoft, Apple, Xero, Intuit (QuickBooks) en Exact, de juiste terug-adressen
(redirect URI's) invullen, en de sleutels die je daar krijgt als geheim in Cloudflare zetten met `wrangler secret put`
(nooit in git, nooit in een chat). Daarna doet **elk klantbedrijf zelf** de rest met één klik in Purser Cloud,
Instellingen: "Koppel Xero", een eigen Slack- of Teams-webhook plakken, een eigen Google-, Microsoft- of Apple-account
koppelen om in te loggen. Elk bedrijf ziet en gebruikt alleen zijn eigen koppelingen; "Jouw koppelingen" laat per
koppeling zien: gekoppeld, niet gekoppeld, of nog niet beschikbaar (dan heb jij hem nog niet ingesteld).

Wat het kost (controleer altijd de actuele prijs): Apple Developer Program USD 99 per jaar (nodig voor Inloggen met
Apple en de App Store), Google Play USD 25 eenmalig, Cloudflare Workers Paid USD 5 per maand, een domeinnaam ongeveer
USD 10 per jaar. Google, Microsoft, Slack, Teams, Intuit en Exact zijn gratis om te registreren; Xero rekent sinds 2026
per aantal gekoppelde organisaties (een kleine gratis laag). Beoordelingen: Google en Microsoft meestal een paar dagen
(alleen als je een logo toont of uitgever-verificatie wilt), Intuit een vragenlijst voor productiesleutels, app stores
één tot enkele dagen per versie.

Belangrijk: geen enkele koppeling kan een betaling goedkeuren. Inloggen met Google, Microsoft of Apple geeft alleen
leesrechten; instellingen wijzigen en betalingen goedkeuren vraagt altijd de passkey (Face ID) van de CFO. Labels zijn
eerlijk: wat hieronder "gebouwd, niet live getest" heet, is nog nooit tegen de echte dienst gedraaid. Dat verandert pas
als jij het in hun sandbox draait.

## How to read this

Two parts:

1. **One-time platform setup (Purser does this once).** You, as the operator of Purser Cloud, register an app at each
   provider and put its keys in the Worker. Until you do, that connection says "not available yet" for every company.
2. **What each customer does in Purser Cloud (one click).** Each company connects its own systems in Settings. Nothing
   the platform sets up gives one company access to another's.

`<origin>` below is the deployed Purser Cloud address, the Worker's `ORIGIN` (for example `https://cloud.purser.example`).
Every redirect URI is built from it and must match **exactly** (scheme, host, path, no trailing slash).

Secrets go in with `wrangler secret put <NAME>` from `cloud/` (it prompts for the value; for a file,
`wrangler secret put <NAME> < file`). Plain settings (marked *var*) go in `cloud/wrangler.jsonc` under `vars`. Never put a
secret in git, a chat, an issue or a ticket. Prices change: **check the current price** on each provider's page before
you pay.

Status labels, as `GET /v1/connections` shows them: **live**, **sandbox**, **built, not tested live**,
**planned**. Nothing here is claimed live that has not run.

## Part 1: one-time platform setup (Purser does this once)

### 1.0 The base: Cloudflare, the domain, the token key

| | |
|---|---|
| Register or buy | A Cloudflare account with **Workers Paid** (about USD 5/month; check current price) and a domain (about USD 10/year at Cloudflare Registrar; check current price). |
| Set | `ORIGIN` and `RP_ID` (*var*); `SESSION_SECRET` (secret, 48+ random characters). For any OAuth connection: `PURSER_OAUTH_CONNECT=on` (*var*) and `OAUTH_TOKEN_KEY` (secret: `openssl rand -base64 32`, piped into `wrangler secret put OAUTH_TOKEN_KEY`). It seals every company's tokens; losing it means every company connects again. |
| What Purser does then | Seals each company's tokens with AES-256-GCM, bound to that company, provider and field. |

### 1.1 E-mail inbox (invoices by e-mail, from Gmail or Outlook)

| | |
|---|---|
| Register | Cloudflare dashboard, your domain, **Email**, **Email Routing**: enable it on a mail subdomain (for example `in.<domain>`), add the MX and SPF records it proposes, and a catch-all rule **Send to a Worker: purser-cloud**. |
| Set | `MAIL_DOMAIN=in.<domain>` (*var*). |
| Cost | Email Routing: no charge known (check current price). |
| Review / time | DNS: minutes to hours. |
| What Purser does then | Each company gets `<company>@in.<domain>` (Settings, Company, Inbox). Each company forwards its own invoices there: [email-forwarding.md](email-forwarding.md). Gmail's confirmation code shows in Settings. |
| Label | built; no domain routed yet, so not tested live. SPF/DKIM/DMARC checks of incoming mail are **not built** ([go-live.md](../go-live.md)). |

### 1.2 Sign in with Google

| | |
|---|---|
| Register | **Google Cloud Console** (console.cloud.google.com): a project; **Google Auth Platform** (APIs & Services, OAuth consent screen): Branding (app name, support e-mail, your domain), Audience **External**, Data access: scopes `openid` and `email` only. **Clients**, **Create client**, type **Web application**. |
| Redirect URI | `<origin>/v1/auth/oidc/google/callback` (Authorized redirect URIs). No JavaScript origin is needed. |
| Set | `OIDC_GOOGLE_CLIENT_ID`, `OIDC_GOOGLE_CLIENT_SECRET` (both secrets). |
| Cost | Free. |
| Review / time | `openid` and `email` are not sensitive scopes: no security assessment. Publish the app ("In production"). If you show a logo, Google's **brand verification** applies (usually two to three business days). Sensitive or restricted scopes (for example reading Gmail) would need verification and, for restricted ones, a paid security assessment: Purser asks for none of them (invoices come by forwarding, not by reading mailboxes). |
| Google Workspace Marketplace | Only if you want Purser listed for Workspace admins: Google Cloud Console, **Google Workspace Marketplace SDK**, App configuration and Store listing, then Google's review (days to weeks). Not needed for sign-in. Not done. |
| What Purser does then | "Sign in with Google" appears on the sign-in page and in Settings, Sign-in accounts. Each person links their own Google account while signed in with their passkey; then it signs them in to **read**. |
| Label | built, not tested live (tested against a stand-in provider with a local RSA key and JWKS). |

### 1.3 Sign in with Microsoft

| | |
|---|---|
| Register | **Microsoft Entra admin center** (entra.microsoft.com), **App registrations**, **New registration**: supported account types "Accounts in any organizational directory" (work and school) or also personal accounts. Platform **Web**. **Certificates & secrets**, New client secret (it expires: at most 24 months; set a reminder). **Token configuration**, Add optional claim, ID token: `email` and `xms_edov` (so Purser can show a verified address; linking does not depend on it). |
| Redirect URI | `<origin>/v1/auth/oidc/microsoft/callback` (Web). |
| Set | `OIDC_MICROSOFT_CLIENT_ID`, `OIDC_MICROSOFT_CLIENT_SECRET` (secrets); `OIDC_MICROSOFT_TENANT` (*var*): `organizations` (work accounts only; recommended), `common` (also personal accounts), or one directory's id. |
| Cost | Free. |
| Review / time | **Publisher verification** (App registration, Branding & properties): needs a Microsoft AI Cloud Partner Program id (free to join) and a verified domain; without it, users in many organisations cannot consent and see "unverified". Usually a few days. |
| What Purser does then | As for Google. Purser checks the token's directory (`tid`); with `organizations` a personal account is refused. |
| Label | built, not tested live. |

### 1.4 Sign in with Apple

| | |
|---|---|
| Register | **Apple Developer Program** membership (USD 99/year; check current price). Certificates, Identifiers & Profiles: an **App ID** with *Sign in with Apple*; a **Services ID** (for example `com.<domain>.purser.web`) with *Sign in with Apple* configured (primary App ID, website domain `<host>`, return URL below); **Keys**, a new key with *Sign in with Apple*: download the `.p8` once, note its Key ID and your Team ID. |
| Redirect URI | `<origin>/v1/auth/oidc/apple/callback` (Return URL). Apple answers with `form_post` (a POST), which Purser accepts from Apple's origin on that path only. |
| Set | `OIDC_APPLE_CLIENT_ID` (the Services ID), `OIDC_APPLE_TEAM_ID`, `OIDC_APPLE_KEY_ID`, and `OIDC_APPLE_PRIVATE_KEY` (`wrangler secret put OIDC_APPLE_PRIVATE_KEY < AuthKey_<KEYID>.p8`). |
| Cost | The membership above. |
| Review / time | None for the web flow. |
| What Purser does then | As for Google. Purser makes Apple's client secret itself (an ES256 JWT, five minutes, per request). Apple documents no PKCE for this flow, so the code is bound by state, nonce and that client secret. |
| Label | built, not tested live. |

### 1.5 Slack and Microsoft Teams

| | |
|---|---|
| Register | **Nothing for the platform.** Each company makes its own incoming webhook (Part 2). A Slack App Directory listing with an "Add to Slack" button would need a Slack app and Slack's review: **planned**, not built. |
| Cost | Free on Slack's and Microsoft's side for incoming webhooks and the Teams Workflows template (Power Automate licensing applies to some Teams plans: check your licence). |
| What Purser does then | Posts `approval.needed`, `payment.paid`, `books.closed` to each company's own channel. Never an approve action. |
| Label | built, not tested live: tested with stand-ins; no real channel has received a post yet. It becomes live once a company's "Send a test" has reached a real Slack or Teams channel. |

### 1.6 Xero

| | |
|---|---|
| Register | **Xero Developer** (developer.xero.com), **My Apps**, **New app**: Web app, company URL, redirect URI below. Copy the client id; generate a client secret. Apps made after 2 March 2026 use granular scopes; Purser asks for `offline_access accounting.invoices accounting.contacts`. |
| Redirect URI | `<origin>/v1/connect/xero/callback` |
| Set | `XERO_OAUTH_CLIENT_ID`, `XERO_OAUTH_CLIENT_SECRET` (secrets), with 1.0. |
| Cost | Building and testing against the free **Demo Company** costs nothing. Since 2026 Xero charges developers by tier, by the number of connected organisations, with a small free tier (check current price at developer.xero.com). |
| Review / time | Beyond the free tier's connection limit, and to be listed on the **Xero App Store**, Xero's app partner certification (weeks). |
| What Purser does then | Each company clicks "Connect Xero" and picks its own organisation; "Send bills to Xero (drafts)" sends its supplier invoices as DRAFT bills, once each. Purser never authorises or pays a bill in Xero. |
| Label | built, not tested live. To change it: connect a Xero Demo Company, send bills, check them in Xero, record the run. |

### 1.7 QuickBooks Online (Intuit)

| | |
|---|---|
| Register | **Intuit Developer** (developer.intuit.com), Dashboard, **Create an app**, QuickBooks Online and Payments, scope `com.intuit.quickbooks.accounting`. Development keys work with a free sandbox company; **production keys** need Intuit's app assessment questionnaire (security and compliance). |
| Redirect URI | `<origin>/v1/connect/quickbooks/callback` (in both Development and Production settings). |
| Set | `QUICKBOOKS_OAUTH_CLIENT_ID`, `QUICKBOOKS_OAUTH_CLIENT_SECRET` (secrets). |
| Cost | Free to register; Intuit's App Partner Program meters some API use on paid tiers (check current price). Listing on the **QuickBooks App Store** is a separate review. |
| What Purser does then | Each company clicks "Connect QuickBooks"; Purser keeps that company's tokens and its company id. Sending bills is **planned** ([quickbooks-plan.md](quickbooks-plan.md)); until then the QuickBooks CSV export. |
| Label | connect flow built, not tested live; bills push planned. |

### 1.8 Exact Online

| | |
|---|---|
| Register | **Exact Online App Center** (apps.exactonline.com), Manage apps, **Register a production app** (or a test app), redirect URI below. You need an Exact Online account (a developer or partner licence). Making the app available to every Exact customer may need Exact's app partner agreement and listing (check with Exact). |
| Redirect URI | `<origin>/v1/connect/exact/callback` |
| Set | `EXACT_OAUTH_CLIENT_ID`, `EXACT_OAUTH_CLIENT_SECRET` (secrets). Each company's runner sets `ERP_EXACT_OAUTH=on` and its Exact settings ([erp.md](../erp.md)). |
| Cost | Check with Exact (partner and app centre fees). |
| What Purser does then | Each company clicks "Connect Exact Online"; the cloud keeps its tokens (refreshed only in their last 30 seconds, as Exact requires) and hands that company's runner short-lived ones; the runner posts purchase invoices and journals. Exact documents no revocation: disconnecting removes Purser's copy, and the owner also removes the app in Exact. |
| Label | built, not tested live. |

### 1.9 Zapier, Make, n8n

| | |
|---|---|
| Register | **Nothing needed** to use Purser from them today: the API, its OpenAPI document (`<origin>/openapi.json`) and signed webhooks work through Webhooks by Zapier, Make's HTTP module and n8n's HTTP Request node ([no-code.md](no-code.md)). A **published app** is optional: Zapier Developer Platform (build free, public listing after Zapier's review), Make's custom apps and partner programme (review), n8n's verified community nodes (npm, then n8n's review). None is applied for. |
| Cost | Free to build; check each partner programme. |
| What Purser does then | Each company makes its own `read` + `propose` key in Settings. No key can approve. |
| Label | the API is live; no published app. |

### 1.10 Claude and ChatGPT directories

| | |
|---|---|
| Register | **Claude connector directory** (Anthropic's submission for remote MCP servers) and the **ChatGPT apps directory** (OpenAI's app submission, a verified OpenAI organisation): both optional. Purser's MCP server (`<origin>/mcp`, OAuth 2.1) already works when a person adds it by URL. |
| Cost | No fee known (check). |
| Review / time | Each directory's review; weeks, not promised. |
| What Purser does then | Listed, a person finds Purser in the directory instead of pasting the URL. Not applied for. |

### 1.11 App stores (Google Play, App Store)

| | |
|---|---|
| Register | **Google Play Console** (USD 25 one-off; check current price). A new personal account must run a closed test with at least 12 testers for 14 days before production; an organisation account needs a D-U-N-S number. **App Store Connect** needs the Apple Developer Program (1.4). |
| Review / time | Google: hours to a few days per release. Apple: usually one to two days per version. |
| What Purser does then | Only once a store app exists: Purser Cloud is a web app (an installable PWA) today; no store app is built. |
| Label | planned. |

### 1.12 Already in place, for completeness

Airwallex (connect, `AIRWALLEX_OAUTH_CLIENT_ID`/`_SECRET`, `<origin>/v1/connect/airwallex/callback`), Moneybird
(`MONEYBIRD_OAUTH_CLIENT_ID`/`_SECRET`, `<origin>/v1/connect/moneybird/callback`), approval alerts (Twilio:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`; Resend: `RESEND_API_KEY`, `ALERT_EMAIL_FROM`): see
[real-customers.md](../real-customers.md) and [cloud.md](../cloud.md).

## Part 2: what each customer does in Purser Cloud (one click)

Each company's owner, signed in with their passkey, in **Settings**. "Your connections" at the top shows each one as
connected, not connected, or not available yet (the platform has not done Part 1 for it).

| Connection | What the customer does | Needs from Part 1 |
|---|---|---|
| API keys (Zapier, Make, n8n, scripts) | Settings, API keys: a key with `read` and `propose`; paste it in the tool. | 1.0 |
| Claude and other AI clients (MCP) | Settings, Connect Claude: a connector token, or add `<origin>/mcp` in the client and sign in. | 1.0 |
| Signed webhook | Settings: the address of their own endpoint; the secret is shown once. | 1.0 |
| Slack | In Slack: api.slack.com/apps, Create an app, Incoming Webhooks, on, Add New Webhook to Workspace, pick the channel, copy the URL. In Purser: Settings, Slack and Teams, paste, Save (Face ID), **Send a test**. | none |
| Microsoft Teams | In Teams: the channel, the "…" menu, **Workflows**, template "Send webhook alerts to a channel", copy the URL it shows. In Purser: Settings, Slack and Teams, paste, Save, Send a test. | none |
| Approval alerts | Settings, Alerts: an e-mail address, WhatsApp number, or a Slack or Teams webhook for "a payment waits". | Twilio / Resend for those channels |
| Invoices by e-mail | Forward from Gmail or Outlook to the address in Settings, Company ([email-forwarding.md](email-forwarding.md)). | 1.1 |
| Xero | Settings, **Connect Xero**, sign in at Xero, pick the organisation, Allow. Then **Send bills to Xero (drafts)**. **Disconnect** at any time. | 1.0, 1.6 |
| QuickBooks Online | Settings, **Connect QuickBooks**, sign in, pick the company. | 1.0, 1.7 |
| Exact Online | Settings, **Connect Exact Online**, sign in, Allow; their runner sets `ERP_EXACT_OAUTH=on`. | 1.0, 1.8 |
| Moneybird, Airwallex | Settings, Connect. | as before |
| Sign in with Google, Microsoft, Apple | Each **person**: Settings, Sign-in accounts, **Link (Face ID)**, sign in at the provider. Later: "Sign in with …" on the sign-in page, **read only**. **Unlink** at any time. | 1.2, 1.3, 1.4 |

What no customer and no connection can do: approve a payment, change a limit, or get owner rights from a sign-in.
Approving stays the CFO's passkey (Face ID) over the exact terms, in Purser Cloud.
