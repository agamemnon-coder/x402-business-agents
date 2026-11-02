Purser (x402-business-agents)
Copyright (c) 2026 Max Geurtsen. Licensed under the MIT License (see LICENSE).

This repository does not contain Visa's Trusted Agent Protocol reference code
(github.com/visa/trusted-agent-protocol). Its interop test clones that reference, unchanged, at a pinned commit
(16d59bd) into the CI runner's temporary directory, outside this repository, and never copies it in. Visa's reference
is subject to its own terms (its LICENSE.md); nothing in this repository relicenses it.

Third-party npm packages are listed with their licences in docs/security/sbom.cdx.json (CycloneDX SBOM). Airwallex,
Metal, Visa and Anthropic names are used only to describe what this project is built on; no endorsement is implied.
