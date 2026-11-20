# OpenSSF Best Practices: the gold level, criterion by criterion

Purser is project [16923](https://www.bestpractices.dev/projects/16923) on bestpractices.dev, at the *silver* level
since 19 November 2026 ([openssf-silver.md](openssf-silver.md)). This page checks each of the 23 gold criteria against
the repository as of 19 November 2026, with an answer ready to paste: Met, Unmet or N/A, and an English justification
with its URL. Nothing is claimed that was not run or measured; where an answer turns into Met only after an owner
action, both texts are given. The criteria: <https://www.bestpractices.dev/en/criteria/2>. The form:
<https://www.bestpractices.dev/en/projects/16923/gold/edit>.

**Today (19 November 2026): 20 Met, 3 Unmet, 0 N/A**, the owner's two 2FA checks done the same evening. Gold needs
every MUST to be Met, so gold is not reachable yet. Three MUSTs stay Unmet, and we say why: `bus_factor`,
`contributors_unassociated` and `two_person_review` need a second, unaffiliated person with merge rights; the project
has one maintainer. `test_statement_coverage90` and `test_branch_coverage80` are Met since the evening of 19 November:
the suite covers 92.0% of statements and 81.9% of branches of the product (20 November), with tests that check behaviour, not
lines that only run ([docs/evidence/coverage.md](../evidence/coverage.md)).

## Voor de eigenaar (Nederlands): wat jij moet doen

Geschreven op 19 november 2026. Dit kan alleen de eigenaar van de repository (@agamemnon-coder); geen commit of
workflow kan het. De knoppen staan met hun Engelse naam, zoals GitHub en bestpractices.dev ze tonen.

### 0. Eerst: deze branch in `main`

De onderbouwingen verwijzen naar bestanden op `main` (`CONTRIBUTING.md#code-review`,
`docs/security/README.md#verify-a-release`, `docs/badges/coverage.json`). Merge deze branch eerst, anders wijzen de
links naar niets. De Dafny-badge in de README leest `docs/badges/dafny.json` en linkt naar
`docs/evidence/formal-proofs.md`; die komen uit de branch `formal-proof`. Merge die samen met deze, anders toont de
badge niets.

### 1. `bus_factor` terugzetten op Unmet (nu fout ingevuld)

Op bestpractices.dev staat `bus_factor` nu op **Met**, terwijl de onderbouwing zegt dat de bus factor 1 is. Dat
veld is hetzelfde op silver en gold. Open <https://www.bestpractices.dev/en/projects/16923/gold/edit>, zet
`bus_factor` op **Unmet**, laat de tekst staan en klik **Save**. Silver blijft: daar is het een SHOULD, en Unmet met
een onderbouwing mag.

### 2. Tweestapsverificatie controleren (`require_2FA`, `secure_2FA`)

Een sessie kan niet zien of jouw account 2FA heeft; jij wel.

1. GitHub → je profielfoto → **Settings** → **Password and authentication**. Onder *Two-factor authentication* moet
   staan dat het aan is. Staat er **Enable two-factor authentication**, klik dat en kies een authenticator-app.
2. Kijk onder *Two-factor methods* welke methoden er zijn. Goed: **Authenticator app**, **Security keys** of
   **Passkeys**. Staat **SMS/Text message** erbij als *enige* methode, voeg dan een authenticator-app of
   security key toe en klik bij SMS op **Delete** (of zet de app als *Preferred method*).
3. Doe hetzelfde voor het Cloudflare-account dat `*.max-31b.workers.dev` serveert: **My Profile** →
   **Authentication** → *Two-Factor Authentication* aan, met een app of security key.
4. Pas daarna: zet `require_2FA` en `secure_2FA` op **Met**, met de tekst onder "After the owner action" bij die
   criteria hieronder.

### 3. Kleine taken als issues (`small_tasks`, aanbevolen)

`CONTRIBUTING.md#small-tasks-for-a-first-contribution` noemt vier kleine taken en het label `good first issue`
bestaat al, maar er staat nog geen issue met dat label. Open voor elk van de vier taken een issue (**Issues** →
**New issue**), plak de zin uit CONTRIBUTING, en zet rechts onder **Labels** `good first issue`. Dan toont het label
echte taken.

### 4. REUSE registreren (voor de officiële badge, optioneel)

`reuse lint` slaagt (3.365 van de 3.365 bestanden) en draait in CI, dus de README toont een statische badge
"REUSE 3.3: compliant" die naar `REUSE.toml` wijst. De badge van de REUSE-API (`api.reuse.software`) toont nu
"unregistered", want het project is daar niet aangemeld. Wil je die: ga naar <https://api.reuse.software/register>,
vul de repository-URL `https://github.com/agamemnon-coder/x402-business-agents` en je e-mailadres in, en bevestig de
mail. Daarna kan de statische badge vervangen worden door
`[![REUSE status](https://api.reuse.software/badge/github.com/agamemnon-coder/x402-business-agents)](https://api.reuse.software/info/github.com/agamemnon-coder/x402-business-agents)`
(en `test/readme-badges.test.ts` mee).

### 5. Het formulier invullen

Log in op <https://www.bestpractices.dev> (**Log in with GitHub**), open
<https://www.bestpractices.dev/en/projects/16923/gold/edit>, en plak per criterium status en tekst uit de lijst
hieronder. Klik **Save** per sectie.

### Wat je níet moet aanvinken

- **`bus_factor`, `contributors_unassociated` en `two_person_review` niet op Met** zolang er geen tweede maintainer
  is, van een andere werkgever, die echt reviewt en merget. Claude-sessies tellen niet: zij hebben geen rechten, geen
  sleutels en zijn geen onafhankelijke persoon.
- **De coverage-criteria alleen op Met** zolang `docs/evidence/coverage.md` 90% statements en 80% branches laat zien
  (op 20 november: 92,0% en 81,9%, dus nu wel Met). Merge deze branch eerst: de onderbouwing linkt naar dat bestand op `main`.
- **`require_2FA` en `secure_2FA` niet op Met** voordat stap 2 gecontroleerd is.
- **Geen SLSA Build L3 claimen voor `v1.2.0`** (zie hieronder): je hebt op 19 november gekozen voor de
  SLSA-generator (`@v2.1.0`, met een tag, de enige uitzondering op "alles vastgepind op SHA", in `release.yml`), maar
  `v1.2.0` is zonder gemaakt. L3-provenance komt pas vanaf de volgende release, en de SLSA-badge in de README pas als
  die release er is en `slsa-verifier` hem goedkeurt.

## Still Unmet, and why

| Criterion | Level | Why | What turns it into Met |
|---|---|---|---|
| `bus_factor` | MUST | One maintainer: the bus factor is 1. | A second maintainer with merge rights (GOVERNANCE.md, "How a second maintainer joins"). |
| `contributors_unassociated` | MUST | One significant contributor; automated update pull requests and the AI coding assistant the maintainer directs are not unassociated contributors. | Two significant contributors from different organisations. |
| `two_person_review` | MUST | The maintainer's own pull requests are merged without a second person's review; CI is the only second check. | A second maintainer reviews at least half of the changes before release; the ruleset on `main` then requires an approving review. |

## SLSA Build Level 3: from the next release on

On 19 November 2026 the owner chose the SLSA project's generic generator
(`slsa-framework/slsa-github-generator`, `generator_generic_slsa3.yml`) for SLSA Build Level 3 provenance, accepting
that it is referenced by tag. Its README says the generator "MUST be referenced by a tag of the form `@vX.Y.Z`": the
build fails with a shorter tag or a commit SHA (the builder is identified by its release tag, which slsa-verifier
checks; the generator's main README explains the design). So `.github/workflows/release.yml` calls it at `@v2.1.0` (the latest release,
24 February 2025) in its job `slsa-provenance`: the one `uses:` in `.github/workflows/` not pinned to a full commit SHA,
which costs a little on OpenSSF Scorecard's Pinned-Dependencies check. Every other action stays pinned by SHA, and
`test/security-page.test.ts` allows exactly this one reusable workflow by tag. The release keeps GitHub's artifact
attestations (`actions/attest`, pinned by SHA) next to it.

What this gives, and from when:

- **From the next release on** (the first release built by `release.yml` with this change, once it is on `main` and
  in the tagged commit), the release also carries
  `x402-business-agents-<tag>.slsa3.intoto.jsonl`: SLSA Build L3 provenance for the source tarball and the bill of
  materials, signed by the generator's own isolated workflow. It is checked with `slsa-verifier verify-artifact`
  ([security/README.md](README.md#verify-a-release), step 5).
- **Not retroactively.** `v1.2.0` was released before this change: it has the Sigstore-signed provenance of
  `actions/attest`, not SLSA Build L3 provenance, and no SLSA Build level is claimed for it.
- **The badge waits.** The README gets an SLSA 3 badge, linked to the workflow and to the verify steps, only after the
  first release with L3 provenance exists and `slsa-verifier` passes on its files. Until then the README has no SLSA
  badge (`test/readme-badges.test.ts` checks that there is none).

## Every criterion

Each answer is what to select and paste on the gold form. URLs point to `main`; they resolve once this branch is
merged.

### Prerequisites (1 Met)

#### `achieve_silver` (MUST): **Met**

The project has the silver badge: https://www.bestpractices.dev/projects/16923

### Basics (2 Met, 2 Unmet, 0 N/A)

#### `bus_factor` (MUST): **Unmet**

The bus factor is 1: one maintainer (@agamemnon-coder) writes, reviews, merges and releases, with AI coding assistants he directs. We do not claim otherwise. https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#how-a-second-maintainer-joins says how a second maintainer joins, and the continuity plan (https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#continuity-if-the-maintainer-is-gone) covers the gap meanwhile.

#### `contributors_unassociated` (MUST): **Unmet**

There is one significant contributor, the maintainer. The other commit authors are Dependabot's automated update pull requests and the AI coding assistant the maintainer directs, which are neither significant contributors in their own right nor unassociated with him. https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#how-a-second-maintainer-joins describes how outside contributors become maintainers.

#### `copyright_per_file` (MUST): **Met**

The copyright of every file is stated per file through REUSE metadata (REUSE specification 3.3, https://reuse.software): https://github.com/agamemnon-coder/x402-business-agents/blob/main/REUSE.toml gives each path its SPDX-FileCopyrightText (the project's files: 2026 Max Geurtsen, the holder in LICENSE; the third-party font, icon paths and logos: their own holders, by file). The REUSE tool resolves it file by file: reuse lint 6.3.0 on this branch on 19 November 2026 reported "Files with copyright information: 3365 / 3365" and compliance with REUSE 3.3, and it runs in CI on every push and pull request (job reuse in https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/ci.yml). `reuse spdx` prints the statement for any single file. We use REUSE.toml rather than a comment header in each file, which the REUSE specification allows.

#### `license_per_file` (MUST): **Met**

The licence of every file is stated per file in the same REUSE metadata: https://github.com/agamemnon-coder/x402-business-agents/blob/main/REUSE.toml gives each path its SPDX-License-Identifier (MIT for the project's files; OFL-1.1 for the Inter font, ISC AND MIT for the Lucide icon paths, LicenseRef-Trademark-Permission for the partners' logos), with every licence text in https://github.com/agamemnon-coder/x402-business-agents/tree/main/LICENSES. reuse lint (REUSE 3.3), run in CI, reported "Files with license information: 3365 / 3365" on 19 November 2026. The three Solidity contracts also carry an SPDX-License-Identifier comment in the file, as Solidity expects.

### Change Control (4 Met, 0 Unmet, 0 N/A)

#### `repo_distributed` (MUST): **Met**

The source is in git, a distributed version control system, on GitHub: https://github.com/agamemnon-coder/x402-business-agents

#### `small_tasks` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#small-tasks-for-a-first-contribution names the small tasks for new or casual contributors (tests for an uncovered file, an axe-core accessibility run, a Solidity linter, documentation fixes) and the issue label that marks them: https://github.com/agamemnon-coder/x402-business-agents/labels/good%20first%20issue

#### `require_2FA` (MUST): **Met** (checked by the owner, 19 November 2026)

The only account that can change the repository or read private vulnerability reports is the maintainer's GitHub account (@agamemnon-coder, the only maintainer: https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#roles-and-responsibilities), which has two-factor authentication enabled; so does the Cloudflare account that serves the project's website. Checked by the owner on 19 November 2026.

#### `secure_2FA` (SHOULD): **Met** (checked by the owner, 19 November 2026)

The maintainer's GitHub two-factor authentication uses an authenticator app (TOTP) and/or a security key or passkey (WebAuthn); SMS is not the only method. Checked by the owner on 19 November 2026.

### Quality (6 Met, 1 Unmet, 0 N/A)

#### `code_review_standards` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#code-review: how a review is done (CI green first, the whole diff read with the pull request template), what the reviewer must check (behaviour and its tests, money and approval rules, input parsing, secrets and live calls, claims backed by a record, dependencies, style), and what makes a change acceptable (CI green, every point holding, commits signed off, every comment answered); the process around it is https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#how-a-change-is-proposed-reviewed-and-merged.

#### `two_person_review` (MUST): **Unmet**

The project has one maintainer, whose own pull requests are merged after CI without a second person's review; fewer than half of the changes are reviewed by someone other than their author. We do not count CI, Dependabot or an AI assistant as a reviewer. When a second maintainer joins, the ruleset on main will require an approving review from a code owner other than the author (https://github.com/agamemnon-coder/x402-business-agents/blob/main/GOVERNANCE.md#how-a-second-maintainer-joins).

#### `build_reproducible` (MUST): **Met**

The release artefact is the source tarball, a git archive of the tag, which is bit-for-bit reproducible: on 19 November 2026 two local runs of git archive (git 2.43.0, Linux) for v1.2.0 gave SHA-256 e4375a3cc90c5221b25d2efc5b018ab1f32a36222e774f84e51be79011c48fba, the hash in the SHA256SUMS that GitHub's runner published with the release (https://github.com/agamemnon-coder/x402-business-agents/releases/tag/v1.2.0). The commands: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/README.md#verify-a-release. Nothing else is compiled for a release: TypeScript runs from source; the Solidity bytecode is compiled again in the tests and must match the committed artifacts.

#### `test_invocation` (MUST): **Met**

The standard way for a Node.js project: npm test (vitest run), after npm ci; npm run test:coverage adds coverage. https://github.com/agamemnon-coder/x402-business-agents/blob/main/CONTRIBUTING.md#before-you-open-a-pull-request

#### `test_continuous_integration` (MUST): **Met**

Every push to main and every pull request runs the full test suite, type checks, lint, browser checks, the TLA+ model check, REUSE and the security scans on GitHub Actions (https://github.com/agamemnon-coder/x402-business-agents/blob/main/.github/workflows/ci.yml). Changes are integrated often: main's history has 356 commits from 29 October to 19 November 2026, on 15 of the 16 days from 4 to 19 November.

#### `test_statement_coverage90` (MUST): **Met**

Measured with vitest and V8 coverage (FLOSS) on 20 November 2026: 92.0% of statements (65,458 of 71,122, in 830 files) of the product (every TypeScript file under src/, cloud/src/ and worker/src/, untested files included, without the command-line entry points and generated files). The command: npm run test:coverage (vitest run --coverage), with the scope set in https://github.com/agamemnon-coder/x402-business-agents/blob/main/vitest.config.ts, which fails the run below 90% of statements; 8,659 tests passed in that run. The dated record, with the method, the figures per area, the tests that were added (each checks behaviour, not lines) and the largest gaps left: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/coverage.md. Stated plainly: with the CLI entry points included the figure is 80.1% (65,978 of 82,369).

#### `test_branch_coverage80` (MUST): **Met**

Measured with the same FLOSS tool and scope on 20 November 2026: 81.9% of branches (49,091 of 59,929); vitest.config.ts fails the run below 79%. https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/coverage.md

### Security (5 Met, 0 Unmet, 0 N/A)

#### `crypto_used_network` (MUST): **Met**

Every call to a partner (Airwallex, Alta (formerly Metal), Anthropic, T:0) is HTTPS, and the hosted pages are served over HTTPS only, with HSTS. The only plain-HTTP servers are the runner's local pages, which answer loopback addresses only; no insecure protocol is offered on the network (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#cryptography).

#### `crypto_tls12` (MUST): **Met**

All TLS goes through Node.js's and the Cloudflare Workers runtime's TLS clients and Cloudflare's edge, which support TLS 1.2 and 1.3; nothing lowers the minimum version.

#### `hardened_site` (MUST): **Met**

Checked on 19 November 2026 with curl: the website (https://kit11.max-31b.workers.dev/, /try and /proof) and Purser Cloud (https://purser-try.max-31b.workers.dev/) send Content-Security-Policy (default-src 'none', scripts by hash or nonce), Strict-Transport-Security (max-age=31536000; includeSubDomains), X-Content-Type-Options: nosniff and X-Frame-Options: DENY, plus Referrer-Policy no-referrer and COOP same-origin, asserted in test/security-headers.test.ts. The repository and the download site are GitHub, which sends CSP, HSTS, nosniff and X-Frame-Options deny.

#### `security_review` (MUST): **Met**

Security reviews of the design and code against the security requirements (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md) and the trust boundaries (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security.md#trust-boundaries), done by the maintainer with tools and by hand, all in November 2026: the threat model (docs/security.md), the security and bug sweep of 15 November with its findings and fixes (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/audit/security-sweep-2026-11-15.md), the hardening review of 19 November (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/2026-11-19-hardening.md), the zero-trust analysis layer by layer (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/zero-trust.md) and the red team of the public API, 128 attacks (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/redteam-api.md). Stated plainly: no outside firm has audited the project.

#### `hardening` (MUST): **Met**

https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security/requirements.md#hardening: a strict CSP on every hosted page (default-src 'none', scripts by hash or nonce, never 'unsafe-inline', frame-ancestors 'none'), HSTS, X-Frame-Options DENY, nosniff, no-referrer, no-store, COOP same-origin and a narrow permissions policy, asserted in test/security-headers.test.ts; rate and size limits on every public endpoint; TypeScript strict as type-level hardening; the signed terms' hash checked before any outside call; timeouts and idempotency keys on every external call; least-privilege CI with Actions pinned by SHA and a hardened runner.

### Analysis (2 Met, 0 Unmet, 0 N/A)

#### `dynamic_analysis` (MUST): **Met**

Property-based fuzzing with fast-check (FLOSS) of the parsers, the signed-terms hash, the proof-bundle and receipt verifiers, the webhook signature checks and both MCP servers: the full set (17 properties, 315,300 runs, 0 failed on 19 November 2026, https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/fuzzing.md) runs before every release (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/releasing.md#making-a-release, step 4), and every property runs at a low count, with the property-based tests, in CI on every pull request (test/fuzz.test.ts, test/property-*.test.ts). Also dynamic: the red team of the public API on a local server and the browser checks in Chromium, Firefox and WebKit.

#### `dynamic_analysis_enable_assertions` (SHOULD): **Met**

The product's run-time checks are always on, in production as under test: 1,476 explicit throw statements in the product code (src/, cloud/src/, worker/src/, without the CLI entry points), zod schemas for the inputs from outside in 51 files, and invariant checks in the money and approval code (the signed terms' hash recomputed before any payment, integer cents, payee allowlists). Fuzzing and the tests run with them: a violated check fails the property or the test (https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/fuzzing.md).
