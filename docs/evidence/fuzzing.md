# Fuzzing

Run on 2026-11-19 with `npm run fuzz` (src/cli/fuzz.ts): **17 properties, 315,300 runs, 17 held, 0 failed** (121 s).

Each property runs with fast-check (src/fuzz/properties.ts) at the run count shown, within its time limit, from a fixed seed. A failure is a finding: fast-check shrinks it to a small counterexample, kept below with the seed and path that replay it (`npm run fuzz -- --only <id> --seed <seed> --path <path>`). The signed artifacts are the ones committed in this repository, found as the tamper matrix finds them: 61 proof bundles and 2 receipts.

## Properties

| Property | Target | Runs | Time | Result |
|---|---|---|---|---|
| `parser-total`: on any text (invoice lines, random unicode, binary, 100-5,000 repeats of what its regexes look for) it never throws, answers in under 2 s, reads a total only as dddd.dd, an IBAN and an invoice number only as written in the text (an IBAN failing mod 97 is read as written, for the checker to block: iban_invalid) | parseApFallback (src/ap/reading.ts), the reader /try uses offline and every fallback uses | 20,000 of 20,000 | 2.3 s; slowest single read 27.6 ms | held |
| `parser-compose-roundtrip`: every invoice checkCompose accepts, written in the sample's layout, is read back by the parser with the same number, total, IBAN and due date | parseApFallback over invoiceText (src/engine/tryWorld.ts): what /try's "write your own" accepts | 20,000 of 20,000 (107,950 skipped by a precondition) | 5.9 s | held |
| `parser-compose-roundtrip-pdf`: every invoice checkCompose accepts, rendered to the enterprise PDF and its text extracted, is read back with the same number, total, IBAN and due date | the same through the PDF /try renders (src/engine/invoicePdf.ts) and the text extraction (src/ap/pdfText.ts) | 300 of 300 (1,792 skipped by a precondition) | 3.8 s | held |
| `reader-runner`: on any text it either reads an invoice whose amount is dddd.dd and whose IBAN and number are written in the text, or refuses with its own error ("invoice: ..."); never another exception | parseInvoiceFallback (src/claude/invoiceReading.ts), the runner's invoice reader without a model | 20,000 of 20,000 | 0.7 s | held |
| `terms-any-change`: any change of any field (a character, a key renamed, removed or added, a type swapped, a value replaced) either makes the terms unhashable (refused) or changes the hash | termsHash (src/lib/terms.ts): the hash a passkey signs | 50,000 of 50,000 (4,312 skipped by a precondition) | 18.4 s | held |
| `terms-order-whitespace`: the hash is the same whatever the key order (at every depth) and whatever whitespace the JSON was written with | canonicalTerms (src/lib/terms.ts, RFC 8785) | 30,000 of 30,000 | 9.0 s | held |
| `terms-four-canonicals-agree`: on any number-free JSON (lone surrogates, unicode keys, __proto__ included) all four write the same bytes, and Node's SHA-256 and the phone's WebCrypto SHA-256 agree | the four canonical forms: the runner's (src/lib/terms.ts, metal-pay jcs), the phone's (src/approve/client.ts), the receipt verifier's (src/try/receipt.ts) and /verify's (src/proof/bundle.ts) | 20,000 of 20,000 | 2.6 s | held |
| `terms-unicode`: canonicalization does no Unicode normalization: a payee written in NFC and the same text in NFD (different code points) hash differently, and the canonical text gives back exactly the code points it was given | canonicalTerms and termsHash: Unicode normalization (NFC/NFD) | 20,000 of 20,000 | 4.4 s | held |
| `terms-numbers`: a JSON number anywhere in the terms is refused by the runner, the receipt verifier and /verify (money is a decimal string); amounts written differently (1850.00, 1850.0, 1,850.00, 1850.00 with a space) are different strings and never share a hash | canonicalTerms and the verifiers: numbers and number formats | 20,000 of 20,000 | 7.3 s | held |
| `bundle-mutations`: a change to anything the passkey's signature covers (the terms and their hash, the canonical text, rp_id, origin, the assertion, the public key) is never VALID | verifyProofBundle (src/proof/bundle.ts: /verify and npm run verify-bundle), on the committed bundles | 10,000 of 10,000 (285 skipped by a precondition) | 21.9 s | held |
| `bundle-context`: the decision the engine recorded, the canonical texts, and the ledger's entries, head and count cannot be changed without a check failing; an entry the signed terms name (the payment's transfer, invoice and conversion) cannot be dropped; dropping another entry passes only where /verify's "ledger chain" says that entry is not in the file and that the file holding all of them is the engine's record | verifyProofBundle: the context a bundle carries beside the signature (the engine's decision, the ledger entries of the payment and the ledger's head) | 10,000 of 10,000 (456 skipped by a precondition) | 19.4 s | held |
| `bundle-malformed`: on anything (random values, a real bundle with any field replaced by junk or by a short base64url string) it answers with its checks: it never throws or rejects, and random values are never VALID | verifyProofBundle on malformed input | 10,000 of 10,000 | 9.3 s | held |
| `receipt-mutations`: a change to anything the signature covers (the terms and their hash, rp_id, origin, the assertion, the public key) is never valid, and any input at all is answered without throwing | verifyReceipt (src/try/receipt.ts: /try/verify and npm run verify-receipt), on the committed receipts | 10,000 of 10,000 (365 skipped by a precondition) | 5.7 s | held |
| `webhook-runner`: the true HMAC-SHA256(secret, x-timestamp + body) verifies (in either hex case); a one-character change to the timestamp, the body or the signature, another secret, or any other string never does; nothing throws | hookSignatureOk (src/policy/cardHooks.ts): the runner's check of Airwallex's x-signature | 50,000 of 50,000 (15 skipped by a precondition) | 1.7 s | held |
| `webhook-cloud`: any request whose x-signature is not HMAC-SHA256(secret, x-timestamp + body) or whose x-timestamp is not within 5 minutes is refused with 401, before anything is read or written; nothing else is ever thrown | receiveAccountEvent and receivePartnerEvent (cloud/src/awxPlatform.ts, cloud/src/connect.ts): Purser Cloud's Airwallex webhooks | 10,000 of 10,000 (913 skipped by a precondition) | 0.6 s | held |
| `mcp-cloud`: any message is answered without throwing (no 5xx); a tool call is carried out only when its arguments fit the tool's own published inputSchema (checked here with Ajv); nothing approves, pays or writes | Purser Cloud's MCP server (cloud/src/claude/mcp.ts mcpAnswer): every tool, any JSON-RPC message | 10,000 of 10,000 | 6.5 s | held |
| `mcp-agent-api`: any arguments to any tool are refused or handled: a call that succeeds fits the tool's published inputSchema (Ajv), nothing is approved, no card is issued or charged, the policy is never changed | the agent API's MCP server (src/platform/mcpServer.ts): every tool an outside agent can call | 5,000 of 5,000 | 1.1 s | held |

## Findings

No property failed.

## Every field, one at a time

Beside the random mutations: every field of every committed bundle and receipt changed once each way (a character appended, a number moved by one, a boolean flipped; the field deleted; a key added to an object), 38,722 changed copies. These still verify (`[]` stands for any index; "artifacts" counts the files it held for):

| Kind | Change | Path | Artifacts | Signed? |
|---|---|---|---|---|
| bundle | add a key | `asked` | 30 | context, not signed |
| bundle | add a key | `assertion` | 61 | context, not signed |
| bundle | add a key | `decision` | 61 | context, not signed |
| bundle | add a key | `decision.executor` | 61 | context, not signed |
| bundle | add a key | `decision.signature` | 61 | context, not signed |
| bundle | add a key | `ledger` | 61 | context, not signed |
| bundle | add a key | `public_key` | 61 | context, not signed |
| bundle | delete | `assertion.credential_id` | 61 | context, not signed |
| bundle | delete | `decision.executor.said` | 61 | context, not signed |
| bundle | delete | `decision.signature.reason` | 61 | context, not signed |
| bundle | delete | `ledger.entries[]` | 181 | context, not signed |
| bundle | delete | `made_at` | 61 | context, not signed |
| bundle | delete | `note` | 61 | context, not signed |
| bundle | delete | `proposal_id` | 61 | context, not signed |
| bundle | delete | `public_key.alg` | 61 | context, not signed |
| bundle | delete | `public_key.format` | 61 | context, not signed |
| bundle | edit | `assertion.credential_id` | 61 | context, not signed |
| bundle | edit | `decision.executor.said` | 61 | context, not signed |
| bundle | edit | `decision.signature.reason` | 61 | context, not signed |
| bundle | edit | `decision.transfers_after` | 31 | context, not signed |
| bundle | edit | `made_at` | 61 | context, not signed |
| bundle | edit | `note` | 61 | context, not signed |
| bundle | edit | `proposal_id` | 61 | context, not signed |
| bundle | edit | `public_key.alg` | 61 | context, not signed |
| bundle | edit | `public_key.cose` | 61 | same key: an encoding of the same signed value |
| bundle | edit | `public_key.format` | 61 | context, not signed |
| receipt | add a key | `assertion` | 2 | context, not signed |
| receipt | add a key | `e2e` | 1 | context, not signed |
| receipt | add a key | `e2e.chain` | 1 | context, not signed |
| receipt | add a key | `e2e.chain.rows[]` | 8 | context, not signed |
| receipt | add a key | `e2e.steps[]` | 8 | context, not signed |
| receipt | add a key | `public_key` | 2 | context, not signed |
| receipt | delete | `credential_id` | 2 | context, not signed |
| receipt | delete | `e2e` | 1 | context, not signed |
| receipt | delete | `e2e.company` | 1 | context, not signed |
| receipt | delete | `note` | 2 | context, not signed |
| receipt | delete | `verified_by_server_at` | 1 | context, not signed |
| receipt | delete | `verify` | 2 | context, not signed |
| receipt | edit | `assertion.signature` | 1 | same bytes: an encoding of the same signed value |
| receipt | edit | `credential_id` | 2 | context, not signed |
| receipt | edit | `e2e.company` | 1 | context, not signed |
| receipt | edit | `note` | 2 | context, not signed |
| receipt | edit | `verified_by_server_at` | 1 | context, not signed |
| receipt | edit | `verify` | 2 | context, not signed |

Rows covered by the signature that still verify (a forgery): 0. "Same bytes" and "same key": the appended base64url character only fills the last group's unused bits, or adds a byte after the COSE map that the key reader ignores; the decoded signature or key is the one signed, so nothing is forged. "Context, not signed": a field the signature does not cover (see bundle-context above for what /verify shows of it).

## Canonical terms: Unicode and numbers

- Terms are canonicalized with RFC 8785 (JCS): keys sorted by UTF-16 code units, no whitespace, strings escaped as JSON.stringify escapes them (lone surrogates as \uXXXX). Key order and the whitespace the JSON was written with never change the hash (terms-order-whitespace).
- No Unicode normalization is done anywhere: a payee written in NFC (é, U+00E9) and in NFD (e + U+0301) are different code points, so different canonical bytes and different hashes (terms-unicode). The passkey signs the exact code points the phone shows and hashes itself; a normalized copy of the terms would be refused, never accepted.
- Terms carry no JSON numbers: money is a two-decimal string. The runner (src/lib/terms.ts), the receipt verifier (src/try/receipt.ts) and /verify (src/proof/bundle.ts) refuse a number anywhere in the terms (terms-numbers). The phone's canonicalize (src/approve/client.ts) would write a finite number in JS form; it never meets one, since the terms it hashes come from the runner. /verify's JCS writes whole numbers only, for the ledger entries a bundle carries.
- Amounts are compared as strings: 1850.00, 1850.0, 1,850.00 and "1850.00 " are four different terms with four different hashes (terms-numbers). The reader turns what a document says into dddd.dd before anything is proposed (parser-total).
- The four implementations (the runner's metal-pay jcs, the phone's, the receipt verifier's and /verify's) write the same bytes for any number-free JSON, and Node's SHA-256 and WebCrypto's agree (terms-four-canonicals-agree).

The JSON beside this file (`fuzzing.json`) holds the same results.
