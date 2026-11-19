# Releasing: versions, signed tags, attested artefacts, upgrades

How a Purser release is numbered, made, signed and verified, and how to upgrade from one to the next. Written on
19 November 2026. The maintainer makes releases ([GOVERNANCE.md](../GOVERNANCE.md)); the workflow that builds and
attests them is [release.yml](../.github/workflows/release.yml).

## Version numbers: Semantic Versioning from v1.2.0

From `v1.2.0` on, every release is numbered with [Semantic Versioning 2.0.0](https://semver.org/) and tagged
`vMAJOR.MINOR.PATCH`:

- **MAJOR** when a published interface changes in a way that breaks a user: the agent API or an MCP tool's name,
  arguments or answer; the ledger or Cloud database in a way the automatic migration cannot carry; a CLI command's
  arguments; the approval-terms schema (`kit11.approval-terms/vN`) or the proof bundle's format.
- **MINOR** for new functionality that keeps those interfaces working.
- **PATCH** for fixes only, security fixes included.

The two tags before it, `v1.0-submission` (8 November 2026) and `v1.1-submission` (15 November 2026), are milestone tags
of the hackathon submission, not SemVer; they stay as submitted and are never moved or re-released. `package.json` and
`server.json` (the MCP Registry entry) carry the same version as the tag.

## Making a release

1. **Pick the number** from the changes since the last tag (`npm run changelog` lists the merged pull requests).
2. **Write the release notes** in `docs/releases/vX.Y.Z.md`: what changed for a user, what is simulated or not run, any
   upgrade step, and every vulnerability fixed with its advisory or CVE and the reporter's credit
   ([SECURITY.md](../SECURITY.md)).
3. **Set the version** in `package.json` and `server.json`, regenerate the changelog, and merge that as a pull request
   with CI green.
4. **Tag the merge commit with a signed tag** and push it:

   ```sh
   git switch main && git pull --ff-only
   git tag -s v1.2.0 -m "v1.2.0"         # signed with the maintainer's GPG or SSH signing key
   git tag -v v1.2.0                      # check the signature locally before pushing
   git push origin v1.2.0
   ```

   The maintainer's public signing key is the one on their GitHub account (`https://github.com/agamemnon-coder.gpg`,
   or for an SSH signing key the account's *signing keys*), so GitHub shows the tag as *Verified*.
5. **The release workflow runs on the pushed tag** ([release.yml](../.github/workflows/release.yml)): it builds the
   source tarball (`git archive` of the tag), the runtime bill of materials (CycloneDX) and `SHA256SUMS`, attests them
   through GitHub's artifact attestations (SLSA build provenance and an SBOM attestation, signed with Sigstore through
   the workflow's own OIDC identity) and publishes all of it, with the attestation bundles, on the tag's GitHub
   release. It never creates, moves or deletes a tag.
6. **Paste the release notes** into the GitHub release, and check one download as below.

## What the source tarball contains

The tarball is `git archive` of the tag, so it holds the tracked files minus those marked `export-ignore` in
[`.gitattributes`](../.gitattributes). Since 19 November that leaves out the screenshots, screen recordings and films
under `docs/` that neither the build nor the tests read: they made the tarball 238 MB, almost all of it media. They stay
in git and on GitHub, where the docs show them.

What is kept was found by running the whole test suite on an extracted archive (19 November, 685 test files), then
the files that failed again until none failed for a missing file: the README's images (a test lists
`docs/assets/readme/`), `docs/assets/media/` and `docs/assets/screens/` with the READMEs that describe them, the images
the site's pages embed (`docs/assets/try-walk/`, the built-with logo, the social preview), the submission form's
screenshots, and every image a document links to (the relative-link test checks each one exists). Nothing outside
`docs/` is left out: `src/` keeps its film stills and logos. Three test files cannot pass on any tarball, with or without
this change: two run `git ls-files` (there is no `.git`), and one (`test/cloud-engine-bundle.test.ts`) failed the same
way on the checkout it was compared with.

Measured on a test commit (the commit before this change plus the new `.gitattributes`), 19 November 2026:

| `git archive` of | `git archive HEAD \| wc -c` (tar) | `--format=tar.gz` (as the release ships it) |
|---|---|---|
| `3a5aebdbf` (before) | 282,798,080 bytes | 238,626,713 bytes (238.6 MB) |
| the test commit (after) | 79,421,440 bytes | 45,156,097 bytes (45.2 MB) |

A new image that a test or the code reads, outside the kept folders, needs its own `-export-ignore` line in
`.gitattributes`; otherwise the test fails on the tarball (never in CI, which runs on a checkout).

## Packages

Purser is not published to npm or any other package registry: it is run from a checkout or this tarball
([install.md](install.md)). The one registry it is listed in is the MCP Registry (`server.json`), published by its own
workflow (`mcp-publish.yml`, with the MCP publisher's GitHub OIDC login) when a release is published.

OpenSSF Scorecard's Packaging check does not count that: it recognises a fixed list of publishing steps (for example
`npm publish` after `actions/setup-node` with the npm registry, `docker push`, the PyPI publish action, GoReleaser;
read in Scorecard's `checks/fileparser/github_workflow.go` on 19 November 2026) and needs a successful run of that
workflow. The MCP publisher is not on the list, so the check stays inconclusive (shown as -1), which Scorecard leaves
out of the overall score. We do not publish an npm package only to satisfy the check.

## Verifying a release

Two independent signatures, each with a documented way to check it:

- **The artefacts** (tarball, bill of materials, `SHA256SUMS`) are signed with Sigstore by the release workflow. The
  signing key is short-lived and bound in its certificate to this repository's `release.yml` and the tag's commit; it
  is never stored on GitHub's release pages, where the files are downloaded from. Check with the GitHub CLI:
  `gh attestation verify x402-business-agents-<tag>.tar.gz -R agamemnon-coder/x402-business-agents`, then
  `sha256sum -c SHA256SUMS`. Every step, offline bundles included: [security/README.md](security/README.md#verify-a-release).
- **The tag** is signed by the maintainer's key (from `v1.2.0`): `git fetch --tags && git tag -v v1.2.0` with the
  maintainer's public key imported from `https://github.com/agamemnon-coder.gpg` (GPG), or with an allowed-signers
  file for an SSH key (`git config gpg.ssh.allowedSignersFile`). The private key stays on the maintainer's machine.

## Supported versions and upgrading

Only `main` and the latest release get fixes ([SECURITY.md](../SECURITY.md)). The upgrade path from any earlier
version is to the latest release:

1. Stop the runner and copy the ledger file (`KIT11_DB`) and the keys directory (`KIT11_KEYS_DIR`) somewhere safe.
2. Check out the new tag and install from its lockfile: `git fetch --tags && git checkout vX.Y.Z && npm ci`.
3. Start as before. The ledger's schema migrates in place when it is opened (`src/db/migrate.ts`): each step checks the
   table's shape first, refuses to migrate a table it does not recognise, and checks the foreign keys afterwards.
4. Purser Cloud's database migrates with its numbered migrations (`cloud/migrations/`):
   `npx wrangler d1 migrations apply purser-cloud --remote -c cloud/wrangler.jsonc` ([cloud.md](cloud.md)).
5. Read the release notes for any step they name. A MAJOR release lists every interface that changed and what to do
   for each.
