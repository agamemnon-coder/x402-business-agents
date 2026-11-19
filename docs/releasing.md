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
   with CI green. CI's test suite runs every fuzz property at a low run count (`test/fuzz.test.ts`) and the
   property-based tests (`test/property-*.test.ts`) on every pull request.
4. **Before merging it, run the full fuzzing set** on that pull request's branch, as the dynamic analysis of the release:
   `npm run fuzz` (fast-check, every property at its full run count, no network). Commit the report it writes
   ([docs/evidence/fuzzing.md](evidence/fuzzing.md)) in that pull request, so the tagged commit carries it. A property that fails stops the
   release until it is fixed, or listed as an open finding with its reason in the release notes.
5. **Tag the merge commit with a signed tag** and push it:

   ```sh
   git switch main && git pull --ff-only
   git tag -s v1.2.0 -m "v1.2.0"         # signed with the maintainer's GPG or SSH signing key
   git tag -v v1.2.0                      # check the signature locally before pushing
   git push origin v1.2.0
   ```

   The maintainer's public signing key is the one on their GitHub account (`https://github.com/agamemnon-coder.gpg`,
   or for an SSH signing key the account's *signing keys*), so GitHub shows the tag as *Verified*.
6. **The release workflow runs on the pushed tag** ([release.yml](../.github/workflows/release.yml)): it builds the
   source tarball (`git archive` of the tag), the runtime bill of materials (CycloneDX) and `SHA256SUMS`, attests them
   through GitHub's artifact attestations (SLSA build provenance and an SBOM attestation, signed with Sigstore through
   the workflow's own OIDC identity) and publishes all of it, with the attestation bundles, on the tag's GitHub
   release. It never creates, moves or deletes a tag.
7. **Paste the release notes** into the GitHub release, and check one download as below.

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
