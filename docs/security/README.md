<a href="../../README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/brand/purser-mark-dark.svg"><img src="../assets/brand/purser-mark.svg" alt="Purser" width="36" height="36"></picture></a>

# Security artefacts

The software bill of materials and the supply-chain and static-analysis checks; the threat model is [security.md](../security.md).

| At a glance | Record |
|---|---|
| **167 components** in the bill of materials (CycloneDX 1.5, 6 Nov 2026) | [sbom.cdx.json](sbom.cdx.json) · `npm run sbom` |
| **0 vulnerabilities** from `npm audit`, root and `worker/`; CI fails on any | CI job `security` |
| **0 findings** from Semgrep with the OWASP Top Ten set (279 files) | CI job `security` (f88389c) |

## The details

| Artefact or check | What it shows | Where |
|---|---|---|
| Bill of materials | The runtime dependencies (CycloneDX 1.5), regenerated on 6 November 2026 from a clean `npm ci` of this lockfile: 167 components, the same names and versions as on 2 November. CI regenerates it on every push. | `sbom.cdx.json`, `npm run sbom`, CI job `security` |
| Pinned Actions | Every GitHub Action in `.github/workflows/` is pinned to a full commit SHA with its tag in a comment (checked 6 November against the tags: checkout v4.2.2, setup-node v4.4.0, gitleaks-action v2.3.9); the gitleaks image is pinned by digest too. | `.github/workflows/` |
| Locked installs | Every job installs with `npm ci` (the lockfile, with its integrity hashes), the Worker with its own. Not pinned by hash: Semgrep (`pip install semgrep==1.180.0`, a version pin) and the TAP interop job's reference proxy (`npm install --before`, it ships no lockfile). | `package-lock.json`, `worker/` |
| OpenSSF Best Practices | The project's badge from the OpenSSF Best Practices programme: **passing** (project 16923, 19 Nov 2026), from the project's own answers to its criteria. | [bestpractices.dev/projects/16923](https://www.bestpractices.dev/projects/16923) |
| Updates | Dependabot opens weekly update pull requests for npm (root and `worker/`) and the Actions. | `.github/dependabot.yml` |
| `npm audit` | `--audit-level=high`: 0 vulnerabilities in the root and in `worker/` (0 of any level; CI fails on any, `--audit-level=low`). | CI job `security` |
| Static analysis | Semgrep 1.180.0 with its public TypeScript, Node.js, secrets and OWASP Top Ten rule sets, blocking since 2 November (first run: 110 rules, 279 files, 0 findings). With the OWASP set: 598 rules loaded, 118 of them apply to our TypeScript, 279 files, 0 findings (CI, f88389c). Results stay on the runner (metrics off). | CI job `security` |
| Our own rules | No shell command built from a template or concatenation (`exec`/`execSync`), no `spawn` with `shell: true`. Added because the canary below showed the public sets miss that case. | `.semgrep/purser.yml` |
| Canary (2 November) | On branch `semgrep-canary`, one file with `eval` on request input and an `exec` with an interpolated template (removed afterwards, a79176040). The public sets caught the `eval` (2 findings, CI job red, run 41420187579) but not the `exec`; with our rules all three are caught ("Ran 121 rules on 280 files: 3 findings", job red, run 41421349282). Locally the rules also catch `cp.execSync("ls " + dir)`, `` cp.exec(`…${x}`) `` and `spawn(…, { shell: true })`, and leave SQL `db.exec(…)` alone. | CI runs 41420187579, 41421349282 |
| Secrets | gitleaks on the pushed commits and on the whole history. | CI |
