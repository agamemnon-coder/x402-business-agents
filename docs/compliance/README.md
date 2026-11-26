# Compliance evidence: run it, verify it

**Mapped to, not certified against: certification or an attestation needs an independent auditor, and nobody has audited Purser against any of these frameworks. Purser moves test money only, in the Airwallex sandbox and on Alta testnet.**

Three parts, one source:

- **The control map**, [controls.md](controls.md): for each requirement of the EU AI Act (Arts. 9, 12, 13, 14, 15),
  ISO/IEC 42001 Annex A, SOC 2 (CC6, CC7, CC8) and DORA, the Purser controls mapped to it, where its evidence comes
  from, and a status: *evidence in ledger*, *documented* or *gap*. Its source is
  [`src/compliance/controls.ts`](../../src/compliance/controls.ts); `npm run compliance:controls` renders the page, and a
  test fails when the page is behind it.
- **The evidence for a period**, `npm run compliance-evidence`: per control, the records in the ledger that show it ran
  in the period, a summary per framework, and a manifest signed with Ed25519 exactly as the signed audit pack's is
  (`npm run audit-pack`; the same code: [`src/audit/pack.ts`](../../src/audit/pack.ts)).
- **The verifier**, `npm run verify-compliance-evidence`: offline, no database, no network. It names the file that fails.

## Run it

The ledger is `KIT11_DB` (read only: the command opens it read-only and writes nothing to it). The signing key is the
audit checkpoint key, as for the audit pack: `PURSER_CHECKPOINT_KEY_FILE`, an Ed25519 key kept outside this repository
(`npm run verify-audit -- keygen --out <file>` makes one).

```sh
npm run compliance-evidence -- --from 2026-11-01 --to 2026-11-30 --out evidence-2026-11
npm run audit-pack -- --from 2026-11-01 --to 2026-11-30 --out audit-pack-2026-11.json
npm run verify-compliance-evidence -- evidence-2026-11 --trust <public key> --audit-pack audit-pack-2026-11.json
```

The first command prints the summary per framework and the public key to pin. It refuses (exit 1) a ledger whose audit
log does not verify from the genesis hash, and writes only into a new or empty directory.

## What the directory holds

| File | What it is |
|---|---|
| `manifest.json` | The period, the run of the audit chain it covers (first and last row, the hash before it, its head), each file's size and SHA-256, the signer's public key and the Ed25519 signature over the manifest's canonical JSON (RFC 8785). |
| `summary.json` | Per framework: requirements with evidence in the period, mapped to a ledger control but with no records in the period, documented only, and gaps. Per control: its records in the period. |
| `mapping.json` | Every requirement of the map with its controls, status, what is missing, and what stood behind it in this period. |
| `controls/PC-xx.json` | One per control: how its evidence is derived, the count per audit event, every cited audit row (`seq`, time, event, subject, `row_hash`), every cited table row (the columns the map names and the row's SHA-256), and for PC-10 the period's run of the chain. |

What leaves the ledger is what the audit pack already carries, and less: no payload, no terms, no secret, no token
(ids only), no card number, no person's name from a table. A test scans the output for keys, tokens and card-number
patterns, and for the secrets its seeded ledger handed out.

The same ledger and period give the same files, byte for byte: nothing in them depends on the time they were made, and
Ed25519 signatures are deterministic. Rows written later to the ledger, after the period, change nothing in it.

## What the verifier checks

| Check | Fails when |
|---|---|
| `format` | `manifest.json` is missing or is not a `purser.compliance-evidence/v1` manifest. |
| `signature`, `key` | The Ed25519 signature does not verify over the manifest; with `--trust`, the signer is not a pinned key. |
| `files` | A file's SHA-256 is not the manifest's (the file is named), a listed file is missing, or a file is not listed. |
| `summary` | A count in a control's file, the mapping or the summary does not agree with the rows the files cite. |
| `audit pack` | With `--audit-pack`: the pack does not verify, is of another period, or covers another run of the chain. |
| `cited rows` | With `--audit-pack`: a cited audit row is not in the pack's period, or its hash, event, subject or time differ; a cited policy version or approval is not as the pack has it. |

What it does not prove: that a control is designed well enough for a framework (that is an auditor's judgement), that
nothing happened outside the ledger (a webhook with a bad signature, for one, is dropped and logged by the runner, not
recorded in the ledger), or whose key signed it unless you pin one with `--trust`.

## An example, on test data

The seeded ledger of `test/support/complianceWorld.ts` (test data: a November with policy changes, two-person
approvals, the emergency stop pulled and lifted, agent identities rotated, verified, refused and revoked, one payment
approved and one rejected, holds and a reconciliation) gives, for 1 to 30 November:

| Framework | Requirements | Evidence in period | Ledger control, no records in period | Documented | Gap |
|---|---|---|---|---|---|
| EU AI Act | 14 | 7 | 1 | 3 | 3 |
| ISO/IEC 42001 | 13 | 5 | 0 | 4 | 4 |
| SOC 2 | 11 | 8 | 0 | 2 | 1 |
| DORA | 16 | 7 | 0 | 4 | 5 |

The one EU AI Act row with no records is Art. 13(1): its ledger control is the rationale record per payment (PC-12), and
no payment was executed in that test month. `test/compliance-evidence.test.ts` checks these counts, the determinism,
the verifier, and that one changed byte is named.

## See also

- [controls.md](controls.md): the map, and its gaps in one list.
- [../compliance.md](../compliance.md): who does what, and how Purser supports each rule.
- [../governance.md](../governance.md): Airwallex's governance principles, held in code.
- [../security/SECURITY-MAPPING.md](../security/SECURITY-MAPPING.md): SSDF, OWASP LLM Top 10 and DORA, by security control.
