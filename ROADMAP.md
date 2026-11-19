# Roadmap

What Purser intends to do, and not do, from November 2026 to the end of 2027. It is the maintainer's intent, not a
promise of dates; the detail, layer by layer and agent by agent, is [docs/roadmap-v2.md](docs/roadmap-v2.md). Decisions
about it are taken as [GOVERNANCE.md](GOVERNANCE.md) says. Written on 19 November 2026.

## What the project intends to do

1. **Close the list before real money** ([docs/go-live.md](docs/go-live.md)) and the accepted risks in
   [docs/security.md](docs/security.md#accepted-risks-and-what-is-out-of-scope), first the two that fit a first
   customer: a signer the relay cannot serve (a native app that parses the terms itself, with hardware attestation),
   and policies compiled to code and checked for contradictions before the CFO signs them.
2. **Make the record checkable offline**: a Merkle-tree transparency log with inclusion and consistency proofs instead
   of a linear hash chain.
3. **Release properly**: SemVer from `v1.2.0`, signed tags, attested artefacts ([docs/releasing.md](docs/releasing.md)).
4. **Grow beyond one maintainer**: a second maintainer with review rights ([GOVERNANCE.md](GOVERNANCE.md#how-a-second-maintainer-joins)),
   then required reviews on `main`.
5. **Keep the evidence honest**: every figure from a run record, coverage above 80% of statements and 90% per money
   area, the OpenSSF Best Practices silver level ([docs/security/openssf-silver.md](docs/security/openssf-silver.md)).

## What the project does not intend to do

- **Move real customer money** before the list in [docs/go-live.md](docs/go-live.md) is closed and an outside security
  audit has been done ([docs/compliance.md](docs/compliance.md#what-a-real-launch-would-add)). Until then: the Airwallex sandbox and Alta testnet only.
- **Let an AI model approve a payment, or give a model a key.** That is a rule of the project, not a phase
  ([CONTRIBUTING.md](CONTRIBUTING.md#the-rules-this-repository-keeps)).
- **Translate the hackathon site** (`/try`, the landing pages) or the CLIs: the product's pages are in Dutch and English
  through one catalogue ([docs/accessibility.md](docs/accessibility.md#internationalisation)); the site stays English.
- **Maintain old versions in parallel**: fixes go to `main` and the latest release only ([docs/releasing.md](docs/releasing.md#supported-versions-and-upgrading)).
