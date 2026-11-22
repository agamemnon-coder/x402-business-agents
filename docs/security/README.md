<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Security: the index

Every security measure Purser has taken, each with its figure and its committed record, and how to check them yourself.

| At a glance | Record |
|---|---|
| **All 128** attacks on the /try API held (red team v2), **All 894** tampered proof copies refused, **0** money invariants broken in 317 chaos scenarios | [redteam-api.md](../evidence/redteam-api.md) · [tamper-matrix.md](../evidence/tamper-matrix.md) · [chaos-money.md](../evidence/chaos-money.md) |
| **1,102,845** states of the payment model checked by TLC, no error; **50 of 51** planted bugs caught in the proof verifier | [formal-model.md](../evidence/formal-model.md) · [mutation-testing.md](../evidence/mutation-testing.md) |
| **65 of 66** Actions pinned by SHA (the other, the SLSA generator, by its release tag, as its README requires); `v1.2.0` released with Sigstore-signed SLSA provenance; OpenSSF Best Practices **Silver** | [releases/v1.2.0.md](../releases/v1.2.0.md) · [openssf-silver.md](openssf-silver.md) |

Test money only: the Airwallex sandbox and the Alta (formerly Metal) testnet. Nothing here is a certificate: no auditor
has tested these controls, and no third-party penetration test has been run ([what is not in place
yet](../controls.md#not-in-place-summary)). The same figures, by category and with the architecture they protect, are on
[/security](https://kit11.max-31b.workers.dev/security#categories); `test/security-page.test.ts` holds the figures here to
the page, and the page to the records.

## How a payment is guarded

| Layer | Trust boundary after it | Controls that sit there |
|---|---|---|
| The agent asks; Claude reads the invoice (if Claude fails or answers outside its schema, code's own parser reads it) | Untrusted text becomes typed data that code checks | CSP and headers (`src/relay/assets.ts`), rate limits (`worker/src/core.ts`), zod validation (`src/agents/toolSchema.ts`) |
| Purser's rules: limits, payee allowlist, duplicates, cash floor | Above the limit, only a person can approve | Hash first: the stored terms re-hashed before any outside call (`src/policy/hashFirst.ts`) |
| The CFO's passkey signs the SHA-256 of the exact terms | Purser asks; the rails and the passkey each hold their own lock | The `/health` tamper alarm: terms changed after signing are a critical alarm and never paid (`src/ops/health.ts`) |
| Three independent locks: Airwallex card controls (sandbox), the Alta mandate on chain (testnet), the CFO's passkey | The record leaves Purser | Idempotency (`src/policy/saga.ts`), HMAC-checked webhooks that only record (`src/policy/airwallexEvents.ts`) |
| The proof file, which anyone can verify offline | | The hash-chained audit log (`src/audit/log.ts`), the offline verifier (`src/proof/bundle.ts`) |

The threat model with every trust boundary: [security.md](../security.md#trust-boundaries).

## What we did, with evidence

| Measure | Figure | Where it ran | Record |
|---|---|---|---|
| Zero-trust harness on the payment path | **All 53** attacks stopped; none moved money | Test world: simulated rails, on this computer | [report.json](../zero-trust/report.json) |
| A hostile model in the agents' place | **370 of 380** hostile tool calls stopped by code; the other 10 within the rules | Test world: offline | [ap-hostile.json](../evals/ap-hostile.json) |
| Red team v2 on the /try API | **All 128** attacks held | Test world: servers on this computer, no live site | [redteam-api.md](../evidence/redteam-api.md) |
| Chaos testing of money movement | **0** money invariants broken in 317 scenarios | Test world: in process, a simulated Airwallex | [chaos-money.md](../evidence/chaos-money.md) |
| Fuzzing (fast-check) | **All 17** properties held | Test world: in process | [fuzzing.md](../evidence/fuzzing.md) |
| Tamper matrix | **All 894** tampered proof copies refused | Test world: offline | [tamper-matrix.md](../evidence/tamper-matrix.md) |
| Formal model (TLA+, TLC) | **1,102,845** states, no error; 3 of 3 planted bugs caught | Offline; a model of the code, not the code | [formal-model.md](../evidence/formal-model.md), [PurserPayment.tla](../../formal/PurserPayment.tla) |
| Mutation testing of the proof verifier | **50 of 51** planted bugs caught (partial run: of the 20 November Stryker groups, one measured before and after) | Offline | [mutation-testing.md](../evidence/mutation-testing.md) |
| Scanners: OSV-Scanner with VEX, Semgrep, CodeQL, gitleaks, npm audit | **9** CI jobs on every change; 33 OSV findings left, all in CI tooling and test fixtures, each with an OpenVEX statement | CI | [osv-scanner.yml](../../.github/workflows/osv-scanner.yml), [vex/README.md](vex/README.md) |
| Harden-Runner, pinned Actions, SBOM, Sigstore-signed releases | **65 of 66** Actions pinned to a commit SHA (the other is the SLSA generator, by its release tag as its README requires); Harden-Runner on 19 of 20 jobs (audit only); 192 SBOM components; `v1.2.0` signed | CI | [v1.2.0.md](../releases/v1.2.0.md), [sbom.cdx.json](sbom.cdx.json) |
| STRIDE threat model | **40** attacks, each with its STRIDE class | Written down | [security.md](../security.md#attackers-and-attacks) |
| Security mapping to NIST SSDF, OWASP Top 10 for LLM Applications and DORA | **24** controls mapped; mapped, not certified; 10 gaps named | Written down | [SECURITY-MAPPING.md](SECURITY-MAPPING.md) |
| Security requirements | **8** requirements, each with where it is enforced and tested | Written down | [requirements.md](requirements.md) |
| OpenSSF Best Practices | **Silver**, project 16923 (19 Nov 2026) | External: the project's own answers | [openssf-silver.md](openssf-silver.md), [bestpractices.dev](https://www.bestpractices.dev/projects/16923) |
| Continuity if the maintainer is gone | **All 4** parts of the plan in place, as the owner reports; one maintainer | Written down | [GOVERNANCE.md](../../GOVERNANCE.md#continuity-if-the-maintainer-is-gone) |
| Private vulnerability reporting | **3** working days: our aim for answering | Written down | [SECURITY.md](../../SECURITY.md) |

Also: the hardening of 19 November ([2026-11-19-hardening.md](2026-11-19-hardening.md)), the controls matrix
([controls-matrix.md](../controls-matrix.md)) and the assurance case ([assurance.md](../assurance.md)).

## How to verify

Everything below runs offline on a clone, with no key of ours, unless it says otherwise.

| What | Command |
|---|---|
| The exact terms of a /try payment, its passkey signature and its ledger lines | `npm run verify-bundle -- purser-proof.json` (or drop the file on [/verify](https://kit11.max-31b.workers.dev/verify)) |
| The published audit log's hash chain | `npm run verify-log -- --jsonl docs/audit/friday-1-audit.jsonl` |
| The anchor of the records on Alta testnet (reads the chain) | `npm run verify-anchor` |
| Every forged copy refused | `npm run tamper-matrix` |
| The red team, chaos and fuzzing runs | `npm run redteam:api`, `npm run chaos:money`, `npm run fuzz` |
| The formal model (downloads TLC once, pinned by SHA-256) | `npm run formal` |
| The figures above against their records | `npx vitest run test/security-page.test.ts test/evidence-wall.test.ts` |
| A release's files, provenance and bill of materials | below |

### Verify a release

Download the files of a release (`gh release download <tag> -R agamemnon-coder/x402-business-agents`), then, in that
folder:

1. The files are the ones the release lists:

   ```sh
   sha256sum -c SHA256SUMS
   ```

2. The tarball and the bill of materials were built by this repository's release workflow, from the tag's commit, on
   GitHub's runners (this checks the Sigstore signature, the certificate's workflow identity and the SLSA provenance):

   ```sh
   gh attestation verify x402-business-agents-<tag>.tar.gz -R agamemnon-coder/x402-business-agents
   gh attestation verify x402-business-agents-<tag>.sbom.cdx.json -R agamemnon-coder/x402-business-agents
   ```

3. The bill of materials is attested for the tarball (CycloneDX):

   ```sh
   gh attestation verify x402-business-agents-<tag>.tar.gz -R agamemnon-coder/x402-business-agents --predicate-type https://cyclonedx.org/bom
   ```

4. The same with the bundle from the release, instead of fetching it from GitHub's attestation API:

   ```sh
   gh attestation verify x402-business-agents-<tag>.tar.gz -R agamemnon-coder/x402-business-agents --bundle x402-business-agents-<tag>.provenance.intoto.jsonl
   ```

5. SLSA Build Level 3 provenance, for releases after `v1.2.0` only (`v1.2.0` was released before the SLSA generator was
   added and has no `*.slsa3.intoto.jsonl`). The release workflow's job `slsa-provenance` runs the SLSA project's
   generic generator, which signs provenance for the tarball and the bill of materials in its own isolated workflow.
   Check each file with [slsa-verifier](https://github.com/slsa-framework/slsa-verifier) (`go install
   github.com/slsa-framework/slsa-verifier/v2/cli/slsa-verifier@v2.7.1`); it checks the signature, that the builder is
   the SLSA generator, the file's SHA-256, the source repository and the tag:

   ```sh
   slsa-verifier verify-artifact x402-business-agents-<tag>.tar.gz --provenance-path x402-business-agents-<tag>.slsa3.intoto.jsonl --source-uri github.com/agamemnon-coder/x402-business-agents --source-tag <tag>
   slsa-verifier verify-artifact x402-business-agents-<tag>.sbom.cdx.json --provenance-path x402-business-agents-<tag>.slsa3.intoto.jsonl --source-uri github.com/agamemnon-coder/x402-business-agents --source-tag <tag>
   ```

To check the tarball against the code itself (the build is reproducible): `git archive --format=tar.gz
--prefix=x402-business-agents-<tag>/ <tag>` in a clone gives the same bytes. On 19 November 2026, with git 2.43.0 on
Linux, two runs for `v1.2.0` (commit `8d5b51d`) both gave SHA-256
`e4375a3cc90c5221b25d2efc5b018ab1f32a36222e774f84e51be79011c48fba`, the hash the release's `SHA256SUMS` lists for
`x402-business-agents-v1.2.0.tar.gz`, which GitHub's runner built:

```sh
git fetch origin tag v1.2.0
git archive --format=tar.gz --prefix=x402-business-agents-v1.2.0/ -o x402-business-agents-v1.2.0.tar.gz v1.2.0
sha256sum x402-business-agents-v1.2.0.tar.gz
```

The bill of materials is not reproduced this way: `npm sbom` writes a serial number and a timestamp into it.

## The supply-chain details

| Artefact or check | What it shows | Where |
|---|---|---|
| Bill of materials | The runtime dependencies (CycloneDX 1.5, npm 10.9.4), regenerated on 19 November 2026 from a clean `npm ci` of this lockfile: 192 components. The copy of 6 November listed 167; the lockfile changed since: the product's code merged into this repository on 15 November (#378, after which `qrcode`, `unpdf` and `@modelcontextprotocol/sdk` are runtime dependencies) and the dependency updates of 18 November (#432: `@x402/*` 2.30.0, `viem` 2.57.17, `hono` 4.13.18). CI regenerates it on every push and fails if it is empty. | `sbom.cdx.json`, `npm run sbom`, CI job `security` |
| Pinned Actions | Every GitHub Action in `.github/workflows/` is pinned to a full commit SHA with its tag in a comment, but one: the SLSA project's generic generator (`slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.1.0`, in `release.yml`), whose README says it MUST be referenced by a release tag (`@vX.Y.Z`), not by SHA; the owner chose it on 19 November 2026, and `test/security-page.test.ts` allows exactly that one by tag. Checked on 19 November against the tags on GitHub: `actions/checkout` v7.0.1 (`3d3c42e`), `actions/setup-node` v7.1.0 (`949feb2`), `actions/cache` v6.1.0 (`55cc834`), `gitleaks/gitleaks-action` v3.0.0 (`e0c47f4`). The two container images are pinned by digest, also checked against their tags on 19 November: `ghcr.io/gitleaks/gitleaks:v8.24.3` (`sha256:e1b35e1…`) and `mcr.microsoft.com/playwright:v1.63.0-noble` (`sha256:eff16c3…`, the WebKit and Firefox jobs). Added on 19 November: `actions/dependency-review-action` v5.0.1 (`bbc44d1`, from `git ls-remote`) and ZAP's image `ghcr.io/zaproxy/zaproxy:2.17.0` (`sha256:9624669…`, read from ghcr.io). | `.github/workflows/` |
| Locked installs | Every job installs with `npm ci` (the lockfile, with its integrity hashes), the Worker with its own. Since 19 November also Semgrep, with each of the 66 packages it installs pinned by version and hash, wheels only (`pip install --require-hashes`; it was `semgrep==1.180.0`, a version pin: a local run of the CI command with the hashed install found the same 0 findings), and the TAP interop job's reference proxy, which ships no lockfile: ours is its ranges resolved as of 19 October, the same 94 packages, versions and hashes that `npm install --before=2026-10-19` installed, now through `npm ci`; two raised since inside the proxy's own ranges for their advisories (`body-parser` 1.20.9, `follow-redirects` 1.16.3). The interop job's Python packages were already hashed. | `package-lock.json`, `worker/`, `.semgrep/requirements.txt`, `test/interop/tap-ref-cdn-proxy.package-lock.json`, `test/interop/tap-ref-requirements.txt` |
| OpenSSF Scorecard | Since 19 November, `.github/workflows/scorecard.yml` scores the repository on every push to `main`, weekly and on demand, publishes the result to api.scorecard.dev and uploads the findings to code scanning. No token permission at the top; the job has only what Scorecard needs. No score is quoted here until it has run. | `.github/workflows/scorecard.yml` |
| OpenSSF Best Practices | The project's badge from the OpenSSF Best Practices programme: **silver** (project 16923, 19 Nov 2026; passing earlier that day), from the project's own answers to its criteria ([openssf-silver.md](openssf-silver.md)). | [bestpractices.dev/projects/16923](https://www.bestpractices.dev/projects/16923) |
| Updates | Dependabot opens weekly update pull requests for npm (root and `worker/`) and the Actions. | `.github/dependabot.yml` |
| Dependency review | Since 19 November, every pull request is checked by GitHub's dependency-review-action: a dependency version it adds with a known high or critical vulnerability (runtime scope) fails the check; lower ones are listed. Read-only token, no pull request comment. | `.github/workflows/dependency-review.yml` |
| DAST | Since 19 November, the OWASP ZAP baseline scan (passive: a one-minute spider, then the passive rules) runs weekly and on demand against our own two test sites only, the relay and the hosted /try; the reports are kept as artifacts and the job fails only on a High-risk alert. The first run, done locally the same day with ZAP 2.17.0's `zap-baseline.py`: 0 High, 0 Medium, 5 Low and 9 Informational alert types over the two sites, each accepted with its reason. | `.github/workflows/dast-zap.yml`, [dast-zap-2026-11-19.md](../evidence/dast-zap-2026-11-19.md) |
| Nightly evidence | Since 19 November, the money chaos suite (3,000 randomized scenarios, the committed report has 300), the fuzz properties (five times their runs and time limits) and the API red team (all 128 attacks) run every night on a fresh runner against a local server only, with a new seed each night. Any broken invariant, failed property or failed attack fails the run; the reports are artifacts, nothing is committed. | `.github/workflows/nightly-evidence.yml` |
| `npm audit` | 0 vulnerabilities of any level in the root and in `worker/` (19 November). CI fails on any advisory in `worker/` (`--audit-level=low`) and on any in the root that `.audit-allow.json` does not accept (development tools only, no patched release, with an expiry; `scripts/audit-check.ts`). | CI job `test` |
| Static analysis | Semgrep 1.180.0 with its public TypeScript, Node.js, secrets and OWASP Top Ten rule sets, blocking since 2 November (first run: 110 rules, 279 files, 0 findings). With the OWASP set: 598 rules loaded, 118 of them apply to our TypeScript, 279 files, 0 findings (CI, f88389c). Re-run on 19 November with the CI command and the hashed install, on a Linux machine outside CI: 143 rules ran on 801 files (`src` and `worker/src` have grown), 0 findings. Results stay on the runner (metrics off). | CI job `security` |
| Our own rules | No shell command built from a template or concatenation (`exec`/`execSync`), no `spawn` with `shell: true`. Added because the canary below showed the public sets miss that case. | `.semgrep/purser.yml` |
| Canary (2 November) | On branch `semgrep-canary`, one file with `eval` on request input and an `exec` with an interpolated template (removed afterwards, a79176040). The public sets caught the `eval` (2 findings, CI job red, run 41420187579) but not the `exec`; with our rules all three are caught ("Ran 121 rules on 280 files: 3 findings", job red, run 41421349282). Locally the rules also catch `cp.execSync("ls " + dir)`, `` cp.exec(`…${x}`) `` and `spawn(…, { shell: true })`, and leave SQL `db.exec(…)` alone. | CI runs 41420187579, 41421349282 |
| Secrets | gitleaks on the pushed commits and on the whole history. | CI |
| Signed releases | Since 19 November, `.github/workflows/release.yml` turns a pushed version tag (`v…`; never `v1.0-submission` or `v1.1-submission`, which stay as submitted) into a GitHub release with the source tarball (`git archive` of the tag), its bill of materials, `SHA256SUMS`, and GitHub artifact attestations (SLSA build provenance and an SBOM attestation, signed through Sigstore with the workflow's identity), whose bundles are on the release as `*.intoto.jsonl`. It never creates or moves a tag. The first release made with it is `v1.2.0` (19 November 2026; [notes](../releases/v1.2.0.md)). From the next release on, its job `slsa-provenance` also adds SLSA Build Level 3 provenance from the SLSA generic generator (`*.slsa3.intoto.jsonl`; [Verify a release](#verify-a-release), step 5); `v1.2.0` has none, and no SLSA Build level is claimed for it. | `.github/workflows/release.yml`, below |

What only the owner can switch on (Dependabot security updates, private vulnerability reporting, the OpenSSF Best
Practices badge, and after the judging a ruleset on `main`), click by click: [owner-actions.md](owner-actions.md). To
report a vulnerability: [SECURITY.md](../../SECURITY.md).

The OpenSSF Best Practices silver level, criterion by criterion, with the evidence, what is still open and the owner's
steps: [openssf-silver.md](openssf-silver.md); the gold level, with what stays Unmet while there is one maintainer:
[openssf-gold.md](openssf-gold.md); the security requirements, design principles, hardening, input
validation and cryptography: [requirements.md](requirements.md).
