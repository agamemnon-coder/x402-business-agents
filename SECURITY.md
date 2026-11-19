# Security

This is a hackathon project that only uses test money (Alta (formerly Metal) testnet, the Airwallex sandbox). Please do not test
against the hosted relay with real credentials.

## Reporting a vulnerability

Please report privately, never in a public issue, pull request or discussion.

- **GitHub private vulnerability reporting** (enabled on this repository; the preferred way):
  https://github.com/agamemnon-coder/x402-business-agents/security/advisories/new
  (on the repository: Security → Advisories → Report a vulnerability). Only you and the maintainer see the report, and
  the fix is prepared in the advisory's private fork.
- If you cannot use GitHub's form, contact the maintainer through their GitHub profile,
  https://github.com/agamemnon-coder, and ask for a private channel; do not put the details in a public place.
- The same contact, machine-readable, is in `/.well-known/security.txt` on the relay
  (https://kit11.max-31b.workers.dev/.well-known/security.txt). Published advisories:
  https://github.com/agamemnon-coder/x402-business-agents/security/advisories

Please include what is affected (the route, file or commit), how to reproduce it, and what an attacker gains. Test money
only: do not use real credentials, and do not test against partners' systems (see Scope).

### Disclosure timeline

| When | What happens |
|---|---|
| Within 3 working days of the report | We acknowledge it and say who is looking at it. |
| Within 10 working days | We tell you whether it is in scope and how severe we think it is (CVSS where it helps). |
| As soon as a fix is ready | A PATCH release, and the hosted test preview redeployed if it is affected. |
| Within 90 days of the report at the latest | Coordinated public disclosure: the GitHub security advisory is published (with a CVE requested through GitHub when the issue affects users), sooner once the fix is out, at a date agreed with you. |

If we cannot fix it within 90 days, we agree a later date with you and say why in the advisory. You are free to disclose
after 90 days if we have stopped answering.

## How a report is handled

1. **Acknowledge** within 3 working days, in the advisory (or by e-mail), with who is looking at it.
2. **Assess**: reproduce it, decide whether it is in scope, and rate it (CVSS where it helps), together with the
   reporter. The reporter hears the outcome either way.
3. **Fix in private**: in the advisory's temporary private fork, with a regression test that fails before the fix
   (the test policy in [CONTRIBUTING.md](CONTRIBUTING.md#tests-come-with-the-change)). A fix that touches the money
   rules is checked against the assurance case ([docs/assurance.md](docs/assurance.md)).
4. **Release**: merge, deploy the hosted test preview if it is affected, and cut a PATCH release
   ([docs/releasing.md](docs/releasing.md)) whose notes name the advisory.
5. **Disclose**: publish the GitHub security advisory (with a CVE requested through GitHub when the issue affects
   users), normally within 90 days of the report or sooner once the fix is out, at a date agreed with the reporter.

## Credit

Every reporter of a vulnerability that is resolved is credited by name (or handle) in the published advisory and in the
release notes, unless they ask to stay anonymous. Resolved reports, with their credit, are listed below.

| Date | Advisory | Reported by |
|---|---|---|
| (none yet) | No vulnerability has been reported through this process as of 19 November 2026. | |

The reviews and sweeps the project ran itself (the security reviews of 1, 8 and 13 November, the sweeps of
15 November) are in [docs/security.md](docs/security.md) and their tests; they were not outside reports.

## Scope

In scope:

- the relay Worker (`worker/`): the site, `/try/sign`, and the relay's Durable Object that carries proposals and approvals;
- Purser Cloud (`cloud/`): the console, its API, its engine, and the MCP server at `/mcp` (read and propose only: no
  tool can approve or pay);
- the passkey approval flow, the policy and money executors (`src/policy`, `src/executors`), and the hash-chained audit
  log with its on-chain anchor (`src/audit`, `src/anchor`);
- the TAP merchant layer (`src/visa`).

Out of scope: the partners' own systems (the Airwallex sandbox, Alta testnet, Airi, T:0, Moneybird): report those to
them. Denial of service against the hosted test preview, and anything that needs a real person's device or account.

Supported: `main`. There are no other release branches; the tags (`v1.0-submission`, and `v1.1-submission` once the owner creates it) are kept as they were submitted.

The threat model is [docs/security.md](docs/security.md); the controls are [docs/controls.md](docs/controls.md).

## No secrets in this repository

No key, token, password or environment value is committed: gitleaks scans every push and the whole history of the
commit under check (CI job `secrets`), and its accepted false positives are listed by fingerprint, each with the reason,
in `.gitleaksignore`. Live runs read their keys from the environment or a proxy, never from a file in the repository;
`.env.example` lists variable names only. If you find a secret here, report it privately as above.
