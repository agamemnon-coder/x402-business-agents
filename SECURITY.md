# Security

This is a hackathon project that only uses test money (Metal testnet, the Airwallex sandbox). Please do not test
against the hosted relay with real credentials.

To report a vulnerability, open a private GitHub security advisory on this repository (Security → Advisories → Report a
vulnerability), or email the maintainer listed on the repository's GitHub profile. Please do not open a public issue for
security reports. We aim to answer within 3 working days.

What we treat as in scope: the relay Worker (worker/), the passkey approval flow, the policy and money executors
(src/policy, src/executors), and the TAP merchant layer (src/visa). The threat model is docs/security.md; the controls
are docs/controls.md.

## No secrets in this repository

No key, token, password or environment value is committed: gitleaks scans every push and the whole history of the
commit under check (CI job `secrets`), and its accepted false positives are listed by fingerprint, each with the reason,
in `.gitleaksignore`. Live runs read their keys from the environment or a proxy, never from a file in the repository;
`.env.example` lists variable names only. If you find a secret here, report it privately as above.
