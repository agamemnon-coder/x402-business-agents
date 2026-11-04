# Security

This is a hackathon project that only uses test money (Metal testnet, the Airwallex sandbox). Please do not test
against the hosted relay with real credentials.

To report a vulnerability, open a private GitHub security advisory on this repository (Security → Advisories → Report a
vulnerability), or email the maintainer listed on the repository's GitHub profile. Please do not open a public issue for
security reports. We aim to answer within 3 working days.

What we treat as in scope: the relay Worker (worker/), the passkey approval flow, the policy and money executors
(src/policy, src/executors), and the TAP merchant layer (src/visa). The threat model is docs/security.md; the controls
are docs/controls.md.
