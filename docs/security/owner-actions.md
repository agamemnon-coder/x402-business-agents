# What the owner sets up by hand (security, 19 November)

Steps only the owner can take, in the Airwallex web app and in Cloudflare. No key or secret goes into a file, a chat
or a commit; each is typed into the place named below. What the code does with them:
[2026-11-19-hardening.md](2026-11-19-hardening.md).

## Scoped Airwallex keys, one per role

Purser can use a separate Airwallex API key for each of its roles (`src/airwallex/keyScopes.ts`). Each is read from
its own variable, with the same `AIRWALLEX_CLIENT_ID`, and falls back to `AIRWALLEX_API_KEY` while it is unset, so
nothing changes until a key is set. With a role key set, Purser refuses, before sending anything, any call outside that
role's scopes, and a runner whose code would make such a call refuses to start.

In the Airwallex web app, where API keys are managed, create one scoped key per row (scope labels as the web app
shows them; Read lets a key call a resource's GET endpoints, Write its GET and POST endpoints, per
[Airwallex's scope reference](https://www.airwallex.com/docs/developer-tools/api/api-key-scopes.md)):

| Variable | Role | Write | Read | Used by |
|---|---|---|---|---|
| `AIRWALLEX_API_KEY_READ` | reads only | none | Balances, Deposits, Global Accounts, Transfers, Beneficiaries, Conversion, Financial Transactions, Bills, Vendors, Authorizations and Transactions, Cards | reconciliation (`src/finance/sources.ts`), the check after each payout, `npm run reconcile`, `npm run verify`, `npm run health` |
| `AIRWALLEX_API_KEY_PAYOUT` | the payout executors | Transfers, Beneficiaries, Conversion, Simulations (sandbox only) | Balances | the payout rail (`src/airwallex/adapter.ts` via `airwallexFromEnv`), the one Airwallex batch transfer, the sandbox's card-charge simulation |
| `AIRWALLEX_API_KEY_ISSUING` | the agents' cards | Cards, Cardholders | Authorizations and Transactions | the card rail (`issuingFromEnv`): issue, limits, freeze, the card transactions |
| `AIRWALLEX_API_KEY_SPEND` | bills and vendors | Bills, Vendors, Upload Files | none | reserved: the bills sync (`AIRWALLEX_BILLS=on`) still uses the general key until it is wired to this role |

Then, on the runner host (never in git), each key into the environment the runner reads, beside the existing
`AIRWALLEX_CLIENT_ID`:

```bash
AIRWALLEX_API_KEY_READ=…      # typed into the host's secret store, not on a command line
AIRWALLEX_API_KEY_PAYOUT=…
AIRWALLEX_API_KEY_ISSUING=…
```

Notes:

- **What still uses `AIRWALLEX_API_KEY`.** Calls made without a role keep the general key: setup (global accounts,
  webhooks, beneficiaries created from the CLIs), the payee name check, the platform's connected accounts, payment
  acceptance, the demo and sweep CLIs. Once every role key is set, the general key can be a restricted key that holds
  only what those still need, or be unset on a runner that runs none of them.
- **Simulations is a payout scope.** In the sandbox the card-charge simulation runs on the payout key, not the issuing
  key; in production there is no simulation and Simulations is not granted.
- **A company's own OAuth connection** (`AIRWALLEX_OAUTH=on`) is not an API key: these roles do not apply to it.
- **Check after setting them:** start the runner; it stops at once with `a scoped Airwallex key would be used outside its
  scopes` if a key's role does not cover a call Purser makes with it. Then `npm run health` reads the balances with the
  read key.
- **What scoping does not change:** anyone with the Airwallex web app, or a key with Issuing write, can still change a
  card's limit at Airwallex directly (see the hardening note, section 2). Keep web-app access to people who need it,
  and add Airwallex's IP allowlist for each key in production.

## Cloudflare Turnstile on the /try start

The steps are in [cloud.md](../cloud.md#cloudflare-turnstile-before-a-start-19-nov-off-by-default): add the widget in
the Cloudflare dashboard, `worker/node_modules/.bin/wrangler secret put TURNSTILE_SECRET -c cloud/wrangler.try.jsonc`,
then the switch `turnstile` on. Not before the /try page renders the widget: until then the switch refuses every start
from the page.

---

# Wat alleen de eigenaar kan aanklikken

Drie instellingen die geen workflow of commit kan zetten: ze staan in de instellingen van de repository op GitHub of op
bestpractices.dev en vragen een eigenaar met admin-rechten. Geschreven op 19 november 2026. De knoppen staan hieronder
met hun Engelse naam, zoals GitHub ze toont. Zie ook [repo-settings.md](../repo-settings.md) (About, social preview,
releases).

## 1. Dependabot-beveiligingsupdates en privé melden van kwetsbaarheden (kan nu)

Raakt geen CI-job en geen site: het zet alleen meldingen en pull requests aan.

1. Ga naar de repository → **Settings** → in de linkerkolom onder *Security*: **Code security** (heet op sommige
   accounts nog *Code security and analysis*).
2. **Dependabot alerts**: klik **Enable**.
3. **Dependabot security updates**: klik **Enable**. Dependabot opent dan zelf een pull request zodra een afhankelijkheid
   een bekende kwetsbaarheid met een oplossing heeft, los van de wekelijkse updates in
   [`.github/dependabot.yml`](../../.github/dependabot.yml).
4. **Grouped security updates** (als die regel er staat): **Enable**, dan komt er één pull request per ecosysteem in
   plaats van één per pakket.
5. **Private vulnerability reporting**: klik **Enable**. [SECURITY.md](../../SECURITY.md) vraagt melders om
   *Security → Advisories → Report a vulnerability*; die knop bestaat pas als dit aan staat.
6. Controle: het tabblad **Security** toont *Dependabot alerts* en *Private vulnerability reporting: enabled*.

## 2. De OpenSSF Best Practices-badge aanvragen (kan nu)

De aanvraag zelf verandert niets aan de repository; de badge komt pas in de README als de eigenaar dat wil (de README
wordt nu niet aangepast).

1. Ga naar <https://www.bestpractices.dev> en klik **Get Your Badge Now!**, log in met GitHub (**Log in with GitHub**).
2. Kies **Add new project**, vul de URL `https://github.com/agamemnon-coder/x402-business-agents` in en klik **Submit
   GitHub Repository**. De site vult een deel zelf in.
3. Loop het formulier *Passing* door. Bij elk criterium **Met**, **Unmet** of **N/A** kiezen en een URL als
   onderbouwing plakken. Hieronder wat er al staat, met het bewijs (paden in deze repository; plak op de site de volledige
   GitHub-URL, `https://github.com/agamemnon-coder/x402-business-agents/blob/main/<pad>`).
4. **Save** (de site bewaart tussendoor; na het laatste criterium verschijnt de badge-code).

### Criteria die al gehaald zijn (passing-niveau)

| Criterium | Bewijs |
|---|---|
| `description_good`, `interact` | [README.md](../../README.md): wat het is, hoe het te proberen en te verifiëren |
| `contribution`, `contribution_requirements` | [CONTRIBUTING.md](../../CONTRIBUTING.md) (proces, regels, de checks vóór een pull request), [pull request-template](../../.github/pull_request_template.md) |
| `floss_license`, `floss_license_osi`, `license_location` | [LICENSE](../../LICENSE) (MIT), [NOTICE](../../NOTICE) |
| `documentation_basics` | [docs/README.md](../README.md), [docs/run-it.md](../run-it.md) |
| `documentation_interface` | [docs/agent-api.md](../agent-api.md), [docs/connect-claude.md](../connect-claude.md) |
| `sites_https`, `repo_public`, `repo_track`, `repo_interim`, `repo_distributed` | GitHub (https, publiek, git, elke commit zichtbaar) |
| `discussion`, `report_process`, `report_tracker`, `report_archive` | GitHub Issues, met [sjablonen](../../.github/ISSUE_TEMPLATE/bug_report.md) |
| `english` | alle documentatie is Engels (dit bestand uitgezonderd) |
| `maintained` | commits en pull requests in november 2026 ([CHANGELOG.md](../../CHANGELOG.md)) |
| `version_unique`, `version_tags` | git-tags (`v1.0-submission`); vanaf nu ook releases via [release.yml](../../.github/workflows/release.yml) |
| `release_notes` | [CHANGELOG.md](../../CHANGELOG.md), [docs/releases/v1.1-submission.md](../releases/v1.1-submission.md) |
| `vulnerability_report_process`, `vulnerability_report_private`, `vulnerability_report_response` | [SECURITY.md](../../SECURITY.md): privé melden via een security advisory (zet stap 1.5 eerst aan), antwoord binnen 3 werkdagen |
| `build`, `build_common_tools`, `build_floss_tools` | npm-scripts en TypeScript ([package.json](../../package.json)) |
| `test`, `test_invocation`, `test_most`, `test_continuous_integration` | `npm test` (vitest), CI op elke push en pull request ([ci.yml](../../.github/workflows/ci.yml)), dekking per gebied met een ondergrens van 90% ([test/coverage-areas.ts](../../test/coverage-areas.ts)) |
| `test_policy`, `tests_are_added`, `tests_documented_added` | [CONTRIBUTING.md](../../CONTRIBUTING.md) ("a test checks it"), de pull request-template vraagt welke tests draaiden |
| `warnings`, `warnings_fixed`, `warnings_strict` | `tsc` met `strict` ([tsconfig.json](../../tsconfig.json)) en eslint ([eslint.config.js](../../eslint.config.js)), beide blokkerend in CI |
| `know_secure_design`, `know_common_errors` | het dreigingsmodel [docs/security.md](../security.md), [docs/zero-trust.md](../zero-trust.md), [docs/assurance.md](../assurance.md) |
| `delivery_mitm`, `delivery_unsigned` | alles via https (GitHub, npm met integriteitshashes in de lockfile); releases met SHA256SUMS en attestaties ([README.md](README.md#verify-a-release)) |
| `vulnerabilities_fixed_60_days`, `vulnerabilities_critical_fixed` | `npm audit`: 0 in root en `worker/` (19 november), CI faalt op elke niet-geaccepteerde melding ([README.md](README.md)) |
| `no_leaked_credentials` | gitleaks op elke push en over de hele geschiedenis (CI-job `secrets`, [SECURITY.md](../../SECURITY.md)) |
| `static_analysis`, `static_analysis_common_vulnerabilities`, `static_analysis_fixed`, `static_analysis_often` | Semgrep (OWASP Top Ten, blokkerend, CI-job `security`) en CodeQL (GitHub code scanning) |
| `dynamic_analysis`, `dynamic_analysis_fixed` | property-tests (`test/property-*.test.ts`), het red team ([docs/redteam/report.json](../redteam/report.json)) en de zero-trust-matrix |

### Zelf nakijken vóór je **Met** kiest

- `crypto_*`: de code gebruikt SHA-256, ES256/P-256 (WebAuthn, via `@simplewebauthn/server`) en AES-256-GCM, allemaal
  uit Node's `crypto` of gepubliceerde bibliotheken; een zoektocht op 19 november vond geen MD5 of SHA-1 via
  `createHash`. `Math.random` komt alleen voor in stand-ins en in de wachttijd van een databaseslot, niet voor sleutels
  of nonces. `crypto_password_storage`: Purser slaat geen wachtwoorden op (passkeys), dus waarschijnlijk **N/A**.
- `release_notes_vulns`: de release notes noemen geen opgeloste kwetsbaarheden met een CVE; als er geen waren: **N/A**.
- `version_semver`: de tags zijn `v1.0-submission` en `v1.1-submission`, geen strikte SemVer. Een volgende release als
  `v1.2.0` haalt dit criterium (en start [release.yml](../../.github/workflows/release.yml)).
- `report_responses`, `enhancement_responses`: gaat over hoe snel issues de afgelopen 2 tot 12 maanden beantwoord zijn;
  kijk het lijstje issues na.

## 3. Een ruleset op `main` (na de jurering)

Niet nu: tijdens de jurering wordt er nog op `main` gemerged, en een verplichte check die nog niet bestaat blokkeert
elke merge. Daarna:

1. **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name**: `main`. **Enforcement status**: **Active**.
3. **Bypass list**: leeg laten (of alleen *Repository admin* voor noodgevallen; dan geldt de regel niet voor jou).
4. **Target branches** → **Add target** → **Include default branch**.
5. Vink aan onder *Branch rules*:
   - **Restrict deletions**.
   - **Block force pushes**.
   - **Require a pull request before merging**; **Required approvals**: `0` zolang je alleen bent (een review van
     jezelf telt niet), `1` zodra er een tweede maintainer is, met **Require review from Code Owners**
     ([CODEOWNERS](../../.github/CODEOWNERS)). Zet **Require conversation resolution before merging** aan.
   - **Require status checks to pass** → **Add checks**, en kies de jobs van de workflow `ci` (zoals GitHub ze na een
     run toont): `test`, `judge`, `secrets`, `security`. Desgewenst ook `webkit` en `firefox`. Zet **Require branches
     to be up to date before merging** aan als je elke pull request eerst met `main` wilt laten bijwerken.
   - Optioneel: **Require code scanning results** met *CodeQL* (en *Scorecard* zodra
     [scorecard.yml](../../.github/workflows/scorecard.yml) gedraaid heeft).
6. **Create**.
7. Controle: een `git push --force` naar `main` wordt geweigerd, en een pull request kan pas mergen als de vier checks
   groen zijn.

Laat `tap-interop` buiten de verplichte checks: die draait alleen als bepaalde paden veranderen, en een verplichte check
die niet draait houdt de pull request vast.
