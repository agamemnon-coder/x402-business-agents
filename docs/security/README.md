# Security artefacts

- `sbom.cdx.json`: the software bill of materials for the runtime dependencies (CycloneDX 1.5, `npm run sbom`; 167
  components on 2 November). CI regenerates it on every push (job `security`).
- Static analysis: Semgrep 1.180.0 with its public TypeScript, Node.js and secrets rule sets, in CI (job `security`),
  non-blocking until its first findings are triaged; then blocking. Results stay on the runner (metrics off).
- Already in CI: `npm audit` (root and worker), gitleaks on the pushed commits and on the whole history.
- The threat model is [docs/security.md](../security.md).
