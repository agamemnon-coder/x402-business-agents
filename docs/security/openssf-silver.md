# OpenSSF Best Practices: the silver level, criterion by criterion

Purser is project [16923](https://www.bestpractices.dev/projects/16923) on bestpractices.dev, at the *passing* level
since November 2026. This page checks each of the 55 silver criteria against the repository as of 19 November 2026,
with an answer ready to paste: Met, Unmet or N/A, and an English justification with its URL. Nothing is claimed that
is not true today; where an answer turns into Met only after an owner action, both texts are given. The prefilled
edit links are in [openssf-silver-links.md](openssf-silver-links.md). The criteria: <https://www.bestpractices.dev/en/criteria/1>.

**Today (19 November 2026): 47 Met, 2 Unmet, 6 N/A.** Every MUST is Met (or N/A where allowed). Unmet: `bus_factor` (SHOULD) and `version_tags_signed` (SUGGESTED), which silver allows. A SHOULD may stay Unmet with a justification, a SUGGESTED criterion may stay Unmet.

## Voor de eigenaar (Nederlands): wat jij moet doen

Geschreven op 19 november 2026. Alles hieronder kan alleen de eigenaar van de repository (@agamemnon-coder) doen; geen
commit of workflow kan het. Doe het in deze volgorde. De knoppen staan met hun Engelse naam, zoals GitHub en
bestpractices.dev ze tonen.

### 0. Eerst: deze branch in `main`

De onderbouwingen hieronder verwijzen naar bestanden op `main` (`GOVERNANCE.md`, `ROADMAP.md`,
`docs/security/requirements.md` enzovoort). Merge deze branch dus eerst, anders wijzen de links op bestpractices.dev
naar niets.

### 1. De badge in de README (`documentation_achievements`, MUST): klaar, staat in de README

Het silver-niveau eist dat de voorpagina de badge toont en ernaar linkt. Deze branch verandert de README niet. Zet
deze regel bovenaan in `README.md`, bij de andere badges:

```markdown
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16923/badge)](https://www.bestpractices.dev/projects/16923)
```

De badge toont vanzelf het niveau dat het project heeft (nu *passing*, later *silver*). Daarna mag
`documentation_achievements` op **Met** (de tekst staat onder "After the owner action" bij dat criterium).

### 2. Continuïteit als jij wegvalt (`access_continuity`, MUST): klaar sinds 19 november (optie A)

Silver eist dat het project binnen een week verder kan als de enige maintainer wegvalt. Dat kan alleen jij regelen;
het plan staat in [GOVERNANCE.md](../../GOVERNANCE.md#continuity-if-the-maintainer-is-gone).

1. **GitHub-opvolger:** GitHub → je profielfoto → **Settings** → **Account** → onder *Successor settings* een
   GitHub-gebruiker zoeken en **Add successor** klikken. Die persoon moet de uitnodiging accepteren (hij krijgt een
   mail). Kies iemand die je vertrouwt en die met GitHub overweg kan.
2. **Verzegelde herstelnotitie:** maak een notitie in je wachtwoordbeheerder met een noodtoegang (bijvoorbeeld
   Bitwarden *Emergency access*), of leg haar in een verzegelde envelop bij een notaris, met: de herstelcodes van je GitHub-account
   (GitHub → Settings → **Password and authentication** → *Recovery codes* → **View** → **Download**), de inlog van het
   Cloudflare-account dat `*.max-31b.workers.dev` serveert, en waar de README en deze checklist staan. Zet bij een
   noodtoegang een wachttijd (bijvoorbeeld 48 uur) waarin jij nog kunt weigeren. Geef dezelfde persoon als bij 1
   toegang.
3. **Schriftelijk recht om door te gaan:** één alinea, gedateerd en ondertekend, bij je testament of in de verzegelde
   notitie: dat de opvolger het project, de naam *Purser* en de bijbehorende accounts mag voortzetten. Live-sleutels
   hoeven niet mee: alle runs gebruiken sandbox en testnet; een opvolger maakt eigen sandbox-sleutels.
4. Pas als 1 tot en met 3 klaar zijn: zet `access_continuity` op **Met** (de tekst onder "After the owner action").
   Zet in GOVERNANCE.md in de tabel *Continuity* de status van "Owner action" op "In place since <datum>" (een kleine
   pull request).

### 3. De eerste ondertekende release, `v1.2.0` (`signed_releases` MUST, `version_tags_signed`)

[docs/releasing.md](../releasing.md) beschrijft het hele proces. In het kort:

1. **Eenmalig een ondertekensleutel:** de eenvoudigste is je SSH-sleutel.
   `git config --global gpg.format ssh` en `git config --global user.signingkey ~/.ssh/id_ed25519.pub`. Voeg dezelfde
   publieke sleutel toe op GitHub → Settings → **SSH and GPG keys** → **New SSH key** → *Key type*: **Signing Key**.
2. **Versie zetten:** in een pull request `version` in `package.json` en in `server.json` op `1.2.0`, `npm run changelog`,
   en release notes in `docs/releases/v1.2.0.md`. Mergen met groene CI.
3. **Tag ondertekenen en pushen:** `git switch main && git pull --ff-only`, dan `git tag -s v1.2.0 -m "v1.2.0"`,
   `git tag -v v1.2.0` (moet *Good signature* zeggen), `git push origin v1.2.0`.
4. **Controleren:** tabblad **Actions** → workflow *release* moet groen zijn; de release `v1.2.0` heeft de tarball,
   de SBOM, `SHA256SUMS` en twee `*.intoto.jsonl`-bestanden. Test één download:
   `gh release download v1.2.0 -R agamemnon-coder/x402-business-agents` en
   `gh attestation verify x402-business-agents-v1.2.0.tar.gz -R agamemnon-coder/x402-business-agents`. Op GitHub staat bij
   de tag **Verified**.
5. Daarna: `signed_releases` en `version_tags_signed` op **Met**, en op het passing-formulier `version_semver` ook.
6. **SLSA Build L3, vanaf de volgende release:** sinds 19 november (jouw keuze) heeft `release.yml` een tweede job,
   `slsa-provenance`, met de generieke SLSA-generator (`@v2.1.0`, met een tag zoals zijn README eist). Elke release
   ná `v1.2.0` krijgt daardoor ook `x402-business-agents-<tag>.slsa3.intoto.jsonl`, te controleren met
   `slsa-verifier verify-artifact` ([security/README.md](README.md#verify-a-release), stap 5). `v1.2.0` is zonder
   gemaakt: claim voor `v1.2.0` geen SLSA Build-niveau. Het antwoord bij `signed_releases` hieronder blijft zoals het is.

### 4. Wat al kan zonder eigen werk, maar wel een klik vraagt

- **Dependabot-meldingen en privé melden van kwetsbaarheden** aanzetten, als dat nog niet gebeurd is:
  [owner-actions.md](owner-actions.md), stap 1. SECURITY.md vraagt melders om een privé-advisory; die knop bestaat pas
  als dit aan staat.
- **De ruleset op `main`** na de jurering: [owner-actions.md](owner-actions.md), stap 3. Zet daarbij de check `dco` er
  nog niet als verplichte check in; maak eerst in `.github/workflows/dco.yml` `BLOCKING: "true"` als je de
  DCO-controle wilt laten blokkeren.

### 5. Het formulier invullen

1. Log in op <https://www.bestpractices.dev> (**Log in with GitHub**) en open je project
   <https://www.bestpractices.dev/projects/16923>.
2. Open de links in [openssf-silver-links.md](openssf-silver-links.md), één per sectie van het silver-formulier. Elke
   link vult status en onderbouwing in voor die sectie. Lees elk antwoord na en klik **Save** (of **Submit**) onderaan.
   Neemt het formulier de waarden niet over, plak ze dan uit de lijst hieronder.
3. Zijn stap 1 tot en met 3 gedaan, open dan ook de laatste link ("After the owner actions") en sla op.
4. Wat dan nog **Unmet** blijft is `bus_factor` (SHOULD: mag Unmet blijven met de onderbouwing; eerlijk is: er is één
   maintainer). Silver wordt toegekend zodra alle MUST-criteria Met of N/A zijn.

### Wat je níet moet aanvinken

- **`bus_factor` niet op Met** zolang er geen tweede maintainer is met eigen merge-rechten. Claude-sessies tellen niet:
  zij hebben geen rechten en geen sleutels.
- **`access_continuity` niet op Met** voordat stap 2 echt klaar is (de opvolger heeft geaccepteerd).
- **`signed_releases` niet op Met** voordat `v1.2.0` er staat en `gh attestation verify` slaagt.

## Still Unmet, and why

| Criterion | Level | Why | What turns it into Met |
|---|---|---|---|
| `bus_factor` | SHOULD | One maintainer: the bus factor is 1, and we say so. | A second maintainer joins (GOVERNANCE.md). Until then it stays Unmet with this justification, which a SHOULD allows. |
| `version_tags_signed` | SUGGESTED | The version tags are unsigned (v1.2.0 was made with its GitHub release). | The next tag is signed with `git tag -s`. SUGGESTED: Unmet does not block silver. |

## Every criterion

Each answer is what to select and paste on the silver form. URLs point to `main`; they resolve once this branch is merged.

### Basics (16 Met, 1 Unmet, 0 N/A)

#### `achieve_passing` (MUST): **Met**

The project has the passing badge: https://www.bestpractices.dev/projects/16923

#### `contribution_requirements` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md lists the checks every pull request must pass (typecheck, lint, the full test suite, the judge check), the coding style the tools enforce, the test policy, the DCO sign-off, and the rules every change keeps (nothing claimed that did not run, no secrets, no real money, no change that lets a model approve).

#### `dco` (SHOULD): **Met**

Contributors sign off every commit with the Developer Certificate of Origin 1.1 (https://developercertificate.org/), as https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#sign-off-developer-certificate-of-origin explains (git commit -s). https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/dco.yml lists unsigned commits on every pull request; it warns rather than fails for now, because the history before 19 November 2026 has no sign-offs (it comes from the maintainer's own account, the AI coding assistant he directs and automated dependency updates); it becomes a required check with the ruleset on main (https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#legal-the-developer-certificate-of-origin).

#### `governance` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md: a single-maintainer model (the repository owner makes final decisions), how changes are proposed, reviewed and merged, how disagreements are decided, how releases are made, and how a second maintainer joins.

#### `code_of_conduct` (MUST): **Met**

Contributor Covenant 2.1 in the standard location: https://github.com/agamemnon-coder/x402-business-agents/blob/main/CODE_OF_CONDUCT.md, linked from CONTRIBUTING.md.

#### `roles_responsibilities` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#roles-and-responsibilities lists each role (maintainer, security response, release manager, contributor, AI coding assistant, second maintainer), its tasks, and who holds it today: @agamemnon-coder holds every maintainer role; the second-maintainer role is vacant.

#### `access_continuity` (MUST): **Met**

> If the maintainer is gone, a trusted person can take over within a week: a sealed recovery note in a password manager's emergency access, with a waiting period the owner can deny while able, holds the GitHub account's recovery codes and the Cloudflare account, with a written statement that the successor may run the project. In place since 19 November 2026. The plan: https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#continuity-if-the-maintainer-is-gone. No live key is needed to continue: all runs use sandboxes and testnets.

#### `bus_factor` (SHOULD): **Unmet**

The bus factor is 1: one maintainer (@agamemnon-coder) writes, reviews, merges and releases, with AI coding assistants he directs. We do not claim otherwise. https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#how-a-second-maintainer-joins says how a second maintainer joins, and the continuity plan covers the gap meanwhile.

#### `documentation_roadmap` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/ROADMAP.md: what the project intends to do and not do through the end of 2027, with the detail in https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/roadmap-v2.md.

#### `documentation_architecture` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/architecture.md (components, where each runs, tooling), with https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/diagrams.md (five Mermaid diagrams) and the architecture decision records in https://github.com/agamemnon-coder/x402-business-agents/tree/main/docs/adr.

#### `documentation_security` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md: what a user can expect (eight security requirements, each with its code and tests) and cannot expect (no real money, no outside audit, no protection from a compromised runner host), and the assumptions; the threat model is https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security.md.

#### `documentation_quick_start` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/install.md#quick-start-no-keys-offline: clone, npm ci, npm run judge, then the hands-on /try in five minutes, with no keys and no network beyond npm.

#### `documentation_current` (MUST): **Met**

Documentation is kept current by tests that read it: figures in the READMEs are checked against their run records (test/readme-headers.test.ts), every link and function named in the assurance case must exist (test/assurance.test.ts), ids on public pages must be in a run record (test/link-records.test.ts), and generated documents (changelog, zero-trust report, tamper matrix) fail CI when they differ from the code. A known documentation defect is a bug, fixed as any other (https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md). Pages that are dated records say so.

#### `documentation_achievements` (MUST): **Met**

> The README links the OpenSSF Best Practices badge (https://www.bestpractices.dev/projects/16923) at the top: https://github.com/agamemnon-coder/x402-business-agents/blob/main/README.md

#### `accessibility_best_practices` (SHOULD): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/accessibility.md: the target is WCAG 2.1 AA; CI's browser checks fail on a page without a language, without exactly one h1, with a link or button without a name, an image without alt text, a page wider than a phone, and drive the navigation by keyboard; touch targets of 44 px; reduced motion honoured; light and dark themes. Not yet done, and said there: an axe-core run in CI, page-wide contrast checks, a recorded screen-reader session.

#### `internationalization` (SHOULD): **Met**

The product's pages (the payables and transactions pages, the CFO's phone pages, Purser Cloud's console) read every word from one message catalogue in Dutch and English (https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/ui/i18n.ts); tests hold that every key exists in both and that a Dutch page has no English left (test/i18n.test.ts, test/i18n-keys-used.test.ts); amounts and dates are formatted per language; a person, or the company, picks the language. The hackathon site and the CLIs stay English. Details: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/accessibility.md#internationalisation.

#### `sites_password_security` (MUST): **Met**

The project sites store no passwords of their own for external users: the repository, issues and downloads are on GitHub (which, as this criterion's details say, meets it), and the project's website and Purser Cloud sign people in with passkeys (WebAuthn) only, storing public keys; API keys it issues are stored as SHA-256 hashes.

### Change Control (1 Met, 0 Unmet, 0 N/A)

#### `maintenance_or_update` (MUST): **Met**

An upgrade path, documented in https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/releasing.md#supported-versions-and-upgrading: only main and the latest release are supported; upgrading is checkout of the new tag and npm ci, the ledger's schema migrates in place on open (with shape checks and a foreign-key check), Purser Cloud's database by numbered migrations, and a MAJOR release lists every changed interface.

### Reporting (2 Met, 0 Unmet, 1 N/A)

#### `report_tracker` (MUST): **Met**

GitHub Issues is the issue tracker: https://github.com/agamemnon-coder/x402-business-agents/issues, with templates for bugs and features.

#### `vulnerability_report_credit` (MUST): **N/A**

No vulnerability has been reported through the project's process (private GitHub advisories, https://github.com/agamemnon-coder/x402-business-agents/blob/main/SECURITY.md) in the last 12 months; the repository has no published advisories. SECURITY.md#credit commits to credit every reporter by name in the advisory and the release notes unless they ask to stay anonymous, and lists resolved reports. The security reviews the project ran itself are in docs/security.md.

#### `vulnerability_response_process` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/SECURITY.md#how-a-report-is-handled: acknowledge within 3 working days, assess with the reporter, fix in the advisory's private fork with a regression test, release a PATCH version, publish the advisory (with a CVE when users are affected) and credit the reporter.

### Quality (15 Met, 0 Unmet, 4 N/A)

#### `coding_standards` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#coding-style: TypeScript's strict mode (with noUncheckedIndexedAccess), ESLint's and typescript-eslint's recommended rules with no any, and the project's conventions (integer cents for money, zod or strict parsers at every boundary); the three Solidity contracts follow the Solidity style guide.

#### `coding_standards_enforced` (MUST): **Met**

npm run typecheck (tsc, strict) and npm run lint (ESLint, https://github.com/agamemnon-coder/x402-business-agents/blob/main/eslint.config.js) run in CI on every push to main and every pull request and fail it on any error (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/ci.yml). Exceptions to a lint rule are rare (eight in the product code) and written at their line. Not linted: the three small Solidity contracts in contracts/, which are compiled with a pinned solc in the tests.

#### `build_standard_variables` (MUST): **N/A**

No native binaries are built: the project is TypeScript (run by Node.js and Cloudflare Workers) and three Solidity contracts compiled to EVM bytecode.

#### `build_preserve_debug` (SHOULD): **N/A**

No build or installation system that could strip debugging information: TypeScript runs from source (tsx), the Workers are bundled by wrangler (esbuild), and nothing is installed system-wide.

#### `build_non_recursive` (MUST): **N/A**

No recursive build: there is no make-style build of subdirectories. TypeScript runs from source, and each Worker is bundled by esbuild from one import graph that it resolves as a whole.

#### `build_repeatable` (MUST): **Met**

What is generated from source is generated the same way every time: the release tarball is a git archive of the tag (two runs give the same SHA-256, https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/README.md#verify-a-release); the Solidity artifacts are compiled again in the tests and must match the committed bytecode (test/tokenize.test.ts, test/compliance-contract.test.ts); generated documents and pages have --check modes that fail when the committed copy differs.

#### `installation_common` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/install.md: the code installs with git clone and npm ci and uninstalls by deleting the folder (plus any keys or ledger folder the user set elsewhere); the MCP connector is added and removed in the AI client (claude mcp add / claude mcp remove); the Claude Code plugin with /plugin install and /plugin uninstall.

#### `installation_standard_variables` (MUST): **N/A**

No installation system that writes to system locations: npm installs into the clone's node_modules, and the runtime writes only to the paths the user sets with KIT11_DB and KIT11_KEYS_DIR (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/install.md#where-purser-writes).

#### `installation_development_quick` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/install.md#the-development-environment: npm ci installs everything, and npm run typecheck, npm run lint and npm test run the whole suite with no keys and no network (partners are faked in test/fakes/).

#### `external_dependencies` (MUST): **Met**

Dependencies are listed in https://github.com/agamemnon-coder/x402-business-agents/blob/main/package.json with exact versions and locked with integrity hashes in https://github.com/agamemnon-coder/x402-business-agents/blob/main/package-lock.json (the relay Worker in worker/package-lock.json); each release carries a CycloneDX bill of materials (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/sbom.cdx.json).

#### `dependency_monitoring` (MUST): **Met**

npm audit runs in CI on every push and pull request for the root and worker/ and fails on any advisory not accepted, with an expiry, in .audit-allow.json; Dependabot opens weekly update pull requests for npm and the GitHub Actions (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/dependabot.yml); OpenSSF Scorecard runs weekly. See https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/README.md.

#### `updateable_reused_components` (MUST): **Met**

Every reused component comes from npm through package.json and the lockfile and is updated there (Dependabot does so weekly); no library is vendored into the repository. The one copied file, pdf.js for Purser Cloud's static assets, is copied at deploy time from the pinned npm package by npm run cloud:pdfjs and is not in git.

#### `interfaces_current` (SHOULD): **Met**

Current interfaces throughout: Node.js 22 LTS, ES modules, WebCrypto and fetch, WebAuthn through a maintained library, GitHub Actions pinned to current releases by SHA. When a dependency deprecates an interface we move off it: for example the release workflow uses actions/attest because attest-sbom is deprecated (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/release.yml). Dependabot and TypeScript's type checks surface removed and changed APIs.

#### `automated_integration_testing` (MUST): **Met**

CI (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/ci.yml) runs the full test suite (over 7,000 tests, with coverage per area), the browser checks, npm audit, Semgrep and gitleaks on every push to main and every pull request, and reports success or failure on the commit and the pull request.

#### `regression_tests_added50` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/regression-tests.md: of the 46 merged pull requests since the project began (2 November 2026) whose title names a fix, 43 (93%) changed or added test files, 20 added a new test file; every one is listed with its test files, and the limits of that measure are stated. The test policy now requires a regression test with every fix (https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#tests-come-with-the-change).

#### `test_statement_coverage80` (MUST): **Met**

The FLOSS suite (vitest with V8 coverage, run in CI on every push and pull request) covers 88.8% of statements (54,705 of 61,603) and 78.0% of branches of the product: every TypeScript file under src/, cloud/src/ and worker/src/, files no test loads included, without the command-line entry points (src/cli, thin wrappers and live-run recorders started as separate processes) and generated files; measured on 19 November 2026 and held by a floor of 85% in https://github.com/agamemnon-coder/x402-business-agents/blob/main/vitest.config.ts. Stated plainly: with the CLI entry points included the figure is 76.8% (55,130 of 71,738). Scope, both figures, per area and the reasons: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/coverage.md

#### `test_policy_mandated` (MUST): **Met**

The written test policy, https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#tests-come-with-the-change: new functionality comes with tests in the automated suite (including tests of what it must refuse), a bug fix with a regression test, and coverage per area must not drop below 90% of lines; a pull request that does not keep it is not merged.

#### `tests_documented_added` (MUST): **Met**

The instructions for change proposals say it: https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#tests-come-with-the-change, and the pull request template asks which tests were added and run (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/pull_request_template.md).

#### `warnings_strict` (MUST): **Met**

Maximally strict where practical: TypeScript strict with noUncheckedIndexedAccess and verbatimModuleSyntax (https://github.com/agamemnon-coder/x402-business-agents/blob/main/tsconfig.json); ESLint's and typescript-eslint's recommended rules plus no-explicit-any and no-unused-vars as errors (https://github.com/agamemnon-coder/x402-business-agents/blob/main/eslint.config.js); both fail CI.

### Security (12 Met, 1 Unmet, 0 N/A)

#### `implement_secure_design` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#secure-design-principles-applied maps each of Saltzer and Schroeder's principles to the code: fail-safe defaults (a payment above the limits waits and expires unsigned; risky features off by default; the Airwallex client refuses any non-sandbox URL), complete mediation (the terms' hash is recomputed before every payment), least privilege (one mandate per agent; no agent can use the owner key), separation of privilege (three layers that do not trust each other), open design (anyone can verify a signed approval offline).

#### `crypto_weaknesses` (MUST): **Met**

No algorithm or mode with a known serious weakness: SHA-256, ECDSA P-256 (ES256) and RS256 for passkeys, HMAC-SHA256, AES-256-GCM; no MD5, SHA-1 or CBC anywhere (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#cryptography).

#### `crypto_algorithm_agility` (SHOULD): **Met**

Passkey verification accepts two signature algorithms (ES256 and RS256); the approval terms carry a schema version and sealed tokens a version prefix, so a hash or cipher can be replaced by a new version beside the old one. Stated as a limit: the approval hash is SHA-256 only and the token cipher AES-256-GCM only, and changing either is a code change, not a setting (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#cryptography).

#### `crypto_credential_agility` (MUST): **Met**

Keys and credentials are kept apart from code, configuration, data and logs and replaced without recompiling: the runner's keys are files in KIT11_KEYS_DIR outside the repository, API credentials are environment variables or Worker secrets, Purser Cloud's token-sealing key is a Worker secret (never in the database it protects), and every credential has a rotation procedure (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#cryptography, https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runbook.md).

#### `crypto_used_network` (SHOULD): **Met**

Every call to a partner is HTTPS; the hosted pages are served over HTTPS with HSTS. The only plain-HTTP servers are the runner's local pages, which answer loopback addresses only (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#cryptography).

#### `crypto_tls12` (SHOULD): **Met**

Outgoing TLS uses Node.js's and the Cloudflare Workers runtime's TLS clients, which offer TLS 1.2 and 1.3 by default; nothing lowers the minimum version.

#### `crypto_certificate_verification` (MUST): **Met**

All TLS connections use Node.js's or the Workers runtime's fetch, which verify the certificate chain and host name by default; no code disables it (no rejectUnauthorized: false, no NODE_TLS_REJECT_UNAUTHORIZED), and Purser offers no option to.

#### `crypto_verification_private` (MUST): **Met**

The certificate is verified during the TLS handshake, before any HTTP request is sent, so API keys and bearer tokens in request headers go only to a verified server; the relay's session cookie is HttpOnly, Secure and SameSite=Strict.

#### `signed_releases` (MUST): **Met**

> Releases are signed by the release workflow (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/release.yml): the source tarball, its CycloneDX SBOM and SHA256SUMS carry Sigstore-signed SLSA build provenance and an SBOM attestation, bound to this repository's workflow identity; the short-lived signing key is never on the download site. Users verify with gh attestation verify, as https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/releasing.md#verifying-a-release and https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/README.md#verify-a-release document. First signed release: https://github.com/agamemnon-coder/x402-business-agents/releases/tag/v1.2.0

#### `version_tags_signed` (SUGGESTED): **Unmet**

The version tags (v1.0-submission, v1.1-submission, v1.2.0) are not GPG- or SSH-signed: v1.2.0 was created with its GitHub release. The release files themselves are signed (see signed_releases). Future tags will be signed with the maintainer's key (git tag -s), as https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/releasing.md describes.

#### `input_validation` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#input-validation: every input from outside the runner is checked against what is allowed and refused otherwise: Purser Cloud's API bodies with size-capped zod schemas, model output and agent tool calls with zod, MCP tool arguments with zod, the relay Worker's bodies with byte limits, type checks and lists of known values, money as exact two-decimal strings, payees from an allowlist, webhooks by HMAC within five minutes, partner answers against their documented shapes.

#### `hardening` (SHOULD): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#hardening: a strict CSP on every hosted page (default-src 'none', scripts by hash or nonce, never 'unsafe-inline', frame-ancestors 'none'; the one known gap, the runner's loopback-only approvals page, is named there), HSTS, X-Frame-Options DENY, nosniff, no-referrer, no-store, COOP same-origin and a narrow permissions policy, asserted in test/security-headers.test.ts; rate and size limits on every public endpoint; TypeScript strict as type-level hardening; timeouts and idempotency keys on every external call; least-privilege CI with pinned Actions.

#### `assurance_case` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/assurance.md: each money invariant, the function that enforces it, its tests, the CI job and the run record; with the threat model and trust boundaries (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security.md#trust-boundaries, a diagram), the argument that secure design principles are applied and common weaknesses (OWASP Top Ten) countered (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md), and the accepted risks.

### Analysis (1 Met, 0 Unmet, 1 N/A)

#### `static_analysis_common_vulnerabilities` (MUST): **Met**

Semgrep with the OWASP Top Ten, TypeScript, Node.js and secrets rule sets plus the project's own rules runs on every push and pull request and blocks on any finding (CI job security); CodeQL runs through GitHub code scanning.

#### `dynamic_analysis_unsafe` (MUST): **N/A**

The project is written in memory-safe languages (TypeScript/JavaScript, and Solidity for three contracts); no C or C++.
