# VEX: which known vulnerabilities affect Purser

[purser.openvex.json](purser.openvex.json) is an [OpenVEX](https://github.com/openvex/spec) 0.2.0 document. It says, for each known
vulnerability OSV-Scanner reports in this repository, whether it affects Purser and why.

## The scan of 19 November 2026

OSV-Scanner 2.7.1 (release binary, SHA-256 checked against the release's `osv-scanner_SHA256SUMS`), `scan source`, on every lockfile in the repository:

| Lockfile | What it is | Packages | Known vulnerabilities |
|---|---|---|---|
| `package-lock.json` | the product | 434 | **0** |
| `worker/package-lock.json` | the relay Worker | 92 | **0** |
| `.semgrep/requirements.txt` | Semgrep, CI job `security` only | 66 | 0 since 19 Nov (`mcp` and `opentelemetry-api` raised past Semgrep's own pins with `.semgrep/overrides.txt`) |
| `test/interop/tap-ref-cdn-proxy.package-lock.json` | a third-party reference proxy, CI job `tap-interop` only | 115 | 33 (`axios` 1.12.2, which the proxy pins exactly, and the dev-only `minimatch`; `body-parser` and `follow-redirects` fixed on 19 Nov) |
| `test/interop/tap-ref-requirements.txt` | a third-party reference registry, CI job `tap-interop` only | 24 | 0 since the evening of 19 Nov (`fastapi`, `starlette`, `anyio` and `pydantic` raised; all 22 interop cases still hold). The first raise that day left `starlette` 0.50.0 with 5 advisories while this row already said 0; corrected the same evening. |

The 33 open findings are all in CI tooling and test fixtures. None is in the product's lockfiles, so none is present in
Purser or reachable in the payment path. Each has a `not_affected` / `component_not_present` statement.

They are still real vulnerabilities in what CI runs. The interop job runs the reference proxy and registry on the
runner's loopback, with a test key made per run. They are reported here, not hidden:

- Semgrep's `mcp` and `opentelemetry-api`: closed on 19 Nov. Semgrep pins them exactly, so `.semgrep/overrides.txt` raises them (`mcp` 1.30.0, the OpenTelemetry packages 1.45.2) and CI installs the hashed file with `--no-deps`; the scan still runs with 143 rules.
- The TAP reference's Python packages (`starlette`, `anyio`, `fastapi`, `pydantic`): closed on 19 Nov, raised in `test/interop/tap-ref-requirements.in` (starlette 1.10.0 needs pydantic 2.9 or later, so the reference's pin of pydantic 2.5.0 is raised too).
- The proxy's `body-parser` and `follow-redirects`: fixed on 19 Nov inside the proxy's own ranges; their statements say `fixed`.
- The TAP reference's proxy packages (`axios` and the rest): our lockfiles reproduce the reference's own ranges as of 19 October, on purpose (the interop test runs it unchanged). Open: move to a newer reference commit, or patch the copies.

## The process

1. CI runs OSV-Scanner daily, on every pull request that changes a lockfile, and on demand (`.github/workflows/osv-scanner.yml`). Results go to code scanning (categories `osv-product` and `osv-tooling`).
2. A finding in `package-lock.json` or `worker/package-lock.json` fails the job. It is fixed by an update. A VEX `not_affected` statement is written only when a person has read the vulnerable code and shown it is not reachable from Purser's code, with the call path in the `impact_statement`. Otherwise it stays `affected` until fixed.
3. A finding in CI tooling or test fixtures is reported, never blocking. It gets a statement here naming where the package is installed.
4. Each change to the document raises `version` and `timestamp`. Statements are never deleted; a fixed one changes to `fixed`.

Not done yet: the document is not checked with `vexctl` in CI, and OSV-Scanner does not read OpenVEX, so the
tooling scan is kept non-blocking instead of being filtered by these statements.
