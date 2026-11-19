<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Security artefacts

The software bill of materials and the supply-chain and static-analysis checks; the threat model is [security.md](../security.md).

| At a glance | Record |
|---|---|
| **192 components** in the bill of materials (CycloneDX 1.5, 19 Nov 2026) | [sbom.cdx.json](sbom.cdx.json) · `npm run sbom` |
| **0 vulnerabilities** from `npm audit`, root and `worker/` (19 Nov); CI fails on any not accepted in `.audit-allow.json` | CI job `test` |
| **0 findings** from Semgrep with the OWASP Top Ten set (143 rules, 801 files; re-run 19 Nov) | CI job `security`, blocking |

## The details

| Artefact or check | What it shows | Where |
|---|---|---|
| Bill of materials | The runtime dependencies (CycloneDX 1.5, npm 10.9.4), regenerated on 19 November 2026 from a clean `npm ci` of this lockfile: 192 components. The copy of 6 November listed 167; the lockfile changed since: the product's code merged into this repository on 15 November (#378, after which `qrcode`, `unpdf` and `@modelcontextprotocol/sdk` are runtime dependencies) and the dependency updates of 18 November (#432: `@x402/*` 2.30.0, `viem` 2.57.17, `hono` 4.13.18). CI regenerates it on every push and fails if it is empty. | `sbom.cdx.json`, `npm run sbom`, CI job `security` |
| Pinned Actions | Every GitHub Action in `.github/workflows/` is pinned to a full commit SHA with its tag in a comment. Checked on 19 November against the tags on GitHub: `actions/checkout` v7.0.1 (`3d3c42e`), `actions/setup-node` v7.1.0 (`949feb2`), `actions/cache` v6.1.0 (`55cc834`), `gitleaks/gitleaks-action` v3.0.0 (`e0c47f4`). The two container images are pinned by digest, also checked against their tags on 19 November: `ghcr.io/gitleaks/gitleaks:v8.24.3` (`sha256:e1b35e1…`) and `mcr.microsoft.com/playwright:v1.63.0-noble` (`sha256:eff16c3…`, the WebKit and Firefox jobs). | `.github/workflows/` |
| Locked installs | Every job installs with `npm ci` (the lockfile, with its integrity hashes), the Worker with its own. Since 19 November also Semgrep, with each of the 66 packages it installs pinned by version and hash, wheels only (`pip install --require-hashes`; it was `semgrep==1.180.0`, a version pin: a local run of the CI command with the hashed install found the same 0 findings), and the TAP interop job's reference proxy, which ships no lockfile: ours is its ranges resolved as of 19 October, the same 94 packages, versions and hashes that `npm install --before=2026-10-19` installed, now through `npm ci`. The interop job's Python packages were already hashed. | `package-lock.json`, `worker/`, `.semgrep/requirements.txt`, `test/interop/tap-ref-cdn-proxy.package-lock.json`, `test/interop/tap-ref-requirements.txt` |
| OpenSSF Scorecard | Since 19 November, `.github/workflows/scorecard.yml` scores the repository on every push to `main`, weekly and on demand, publishes the result to api.scorecard.dev and uploads the findings to code scanning. No token permission at the top; the job has only what Scorecard needs. No score is quoted here until it has run. | `.github/workflows/scorecard.yml` |
| Updates | Dependabot opens weekly update pull requests for npm (root and `worker/`) and the Actions. | `.github/dependabot.yml` |
| `npm audit` | 0 vulnerabilities of any level in the root and in `worker/` (19 November). CI fails on any advisory in `worker/` (`--audit-level=low`) and on any in the root that `.audit-allow.json` does not accept (development tools only, no patched release, with an expiry; `scripts/audit-check.ts`). | CI job `test` |
| Static analysis | Semgrep 1.180.0 with its public TypeScript, Node.js, secrets and OWASP Top Ten rule sets, blocking since 2 November (first run: 110 rules, 279 files, 0 findings). With the OWASP set: 598 rules loaded, 118 of them apply to our TypeScript, 279 files, 0 findings (CI, f88389c). Results stay on the runner (metrics off). | CI job `security` |
| Our own rules | No shell command built from a template or concatenation (`exec`/`execSync`), no `spawn` with `shell: true`. Added because the canary below showed the public sets miss that case. | `.semgrep/purser.yml` |
| Canary (2 November) | On branch `semgrep-canary`, one file with `eval` on request input and an `exec` with an interpolated template (removed afterwards, a79176040). The public sets caught the `eval` (2 findings, CI job red, run 41420187579) but not the `exec`; with our rules all three are caught ("Ran 121 rules on 280 files: 3 findings", job red, run 41421349282). Locally the rules also catch `cp.execSync("ls " + dir)`, `` cp.exec(`…${x}`) `` and `spawn(…, { shell: true })`, and leave SQL `db.exec(…)` alone. | CI runs 41420187579, 41421349282 |
| Secrets | gitleaks on the pushed commits and on the whole history. | CI |
