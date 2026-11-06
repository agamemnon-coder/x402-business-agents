# Security artefacts

- `sbom.cdx.json`: the software bill of materials for the runtime dependencies (CycloneDX 1.5, `npm run sbom`;
  regenerated on 6 November 2026 from a clean `npm ci` of this lockfile: 167 components, the same names and versions as
  on 2 November). CI regenerates it on every push (job `security`).
- Supply chain (checked 6 November 2026): every GitHub Action in `.github/workflows/` is pinned to a full commit SHA
  with its tag in a comment (checked against the tags: checkout v4.2.2, setup-node v4.4.0, gitleaks-action v2.3.9);
  the gitleaks image is pinned by digest too. Every job installs with `npm ci` (the lockfile, with its integrity
  hashes), the Worker with its own. Dependabot (`.github/dependabot.yml`) opens weekly update pull requests for npm
  (root and `worker/`) and the Actions. `npm audit --audit-level=high`: 0 vulnerabilities in the root and in
  `worker/` (0 of any level; CI fails on any, `--audit-level=low`). Not pinned by hash: Semgrep (`pip install
  semgrep==1.180.0`, a version pin) and the TAP interop job's reference proxy (`npm install --before`, it ships no lockfile).
- Static analysis: Semgrep 1.180.0 with its public TypeScript, Node.js, secrets and OWASP Top Ten rule sets, in CI (job `security`),
  blocking since 2 November (first run: 110 rules, 279 files, 0 findings). Results stay on the runner (metrics off).
  With the OWASP set: 598 rules loaded, 118 of them apply to our TypeScript, 279 files, 0 findings (CI, f88389c).
- Our own rules, `.semgrep/purser.yml`: no shell command built from a template or concatenation (`exec`/`execSync`),
  no `spawn` with `shell: true`. Added because the canary below showed the public sets miss that case.
- Canary (2 November, branch `semgrep-canary`; the unsafe file was removed afterwards, a79176040): one file with `eval`
  on request input and an `exec` with an interpolated template. The public sets caught the `eval` (2 findings, CI job
  red, run 41420187579) but not the `exec`; with our rules all three are caught ("Ran 121 rules on 280 files: 3
  findings", job red, run 41421349282). Locally the rules also catch `cp.execSync("ls " + dir)`, `cp.exec(\`…${x}\`)`
  and `spawn(…, { shell: true })`, and leave SQL `db.exec(…)` alone.
- Already in CI: `npm audit` (root and worker), gitleaks on the pushed commits and on the whole history.
- The threat model is [docs/security.md](../security.md).
