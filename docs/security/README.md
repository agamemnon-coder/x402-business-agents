# Security artefacts

- `sbom.cdx.json`: the software bill of materials for the runtime dependencies (CycloneDX 1.5, `npm run sbom`; 167
  components on 2 November). CI regenerates it on every push (job `security`).
- Static analysis: Semgrep 1.180.0 with its public TypeScript, Node.js, secrets and OWASP Top Ten rule sets, in CI (job `security`),
  blocking since 2 November (first run: 110 rules, 279 files, 0 findings). Results stay on the runner (metrics off).
  With the OWASP set: 598 rules loaded, 118 of them apply to our TypeScript, 279 files, 0 findings (CI, f88389c).
- Our own rules, `.semgrep/purser.yml`: no shell command built from a template or concatenation (`exec`/`execSync`),
  no `spawn` with `shell: true`. Added because the canary below showed the public sets miss that case.
- Canary (2 November, branch `semgrep-canary`, deleted afterwards): one file with `eval` on request input and an `exec`
  with an interpolated template. The public sets caught the `eval` (2 findings, CI job red, run 41420187579) but not the
  `exec`; with our rules both are caught. Locally the rules also catch `cp.execSync("ls " + dir)`, `cp.exec(\`…${x}\`)`
  and `spawn(…, { shell: true })`, and leave SQL `db.exec(…)` alone.
- Already in CI: `npm audit` (root and worker), gitleaks on the pushed commits and on the whole history.
- The threat model is [docs/security.md](../security.md).
