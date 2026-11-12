We have requested Visa Intelligent Commerce Connect access; it is not used here.

# ICC: the first sandbox hour, runbook

This is the plan for the hour after sandbox access arrives. Nothing in it has run. Every fact about the service comes
from [docs/visa-icc.md](../../visa-icc.md), which cites the documentation page for each one. What those pages do not
say is marked "unknown until sandbox access"; the full list is in
[section 10 of docs/visa-icc.md](../../visa-icc.md#10-unknown-until-sandbox-access).

The command is `npm run icc -- preflight | run | record` (`src/cli/icc.ts`). It talks only to the test host
`apitest.cybersource.com`, refuses to start without a call budget and a call log, and never prints a key, a
credential, device or assurance data, or the value of a variable.

## 1. In the Cybersource Test Business Center

Log in at `https://businesscentertest.cybersource.com` with the user the sandbox e-mail asks you to create
([p-sandbox], [r-mle-p12]). Then, under **Payment Configuration > Key Management**, **+ Generate key** ([r-mle-p12]):

| What | Where, as the pages say | What you keep | Source |
|---|---|---|---|
| The P12 signing certificate (for the default scheme, `jwt-p12`) | in the guide's menu as "Create or Submit a P12 Certificate"; that page was not read: unknown until sandbox access | the `.p12` file, its password, its key ID | [r-jwt-p12], [r-toc] |
| A REST API Response MLE key | under REST APIs, **REST -- API Response MLE**, **Generate key**; set a password; a `.p12` file downloads. Then filter **Key Type** = **REST-API Response MLE**, **Expires At** = **All Dates**, **Search**, and note its key ID | the `.p12` file, its password, its key ID | [r-mle-p12] |
| Only for the other two schemes: a shared secret key pair | under REST APIs, **REST -- Shared Secret**, **Generate key**, **Download key**. The **Key** value is the key ID, the **Shared Secret** value is the secret | the key ID and the secret | [r-http-key] |

Unknown until sandbox access: whether the ICC operations are switched on for a new organisation, and whether a token
requester ID and a relationship ID are needed first (section 10, number 1); which scheme ICC accepts (number 2); how
the test card is enrolled and where the cardholder's assurance data comes from without the iframe and SDK (numbers 6,
7 and 19). Enrolling the card (`POST /tms/v1/instrumentidentifiers`, `POST /icc/v1/tokens`) and the passkey calls are
a one-time set-up by the owner; they are not in this command. The test card is the testing guide's Visa number ending
1111 [t-guide]; its full number is not written here.

## 2. The keys as PEM files

Node reads no `.p12` file without a library, so convert each download once. The documentation itself opens the
Response MLE file with `openssl pkcs12 -in {certificate_file_name}.p12` and finds the `CyberSource_SJC_US`
certificate in it ([r-mle-p12]); the rest is standard `openssl` use. Each command asks for the `.p12` password. Work
in the private folder of section 4, never in the repository.

```bash
umask 077
# The signing certificate's private key (jwt-p12): ICC_JWT_PRIVATE_KEY_FILE
openssl pkcs12 -in signing.p12 -nocerts -nodes -out jwt-signing-key.pem
# The Response MLE private key: ICC_MLE_RESPONSE_PRIVATE_KEY_FILE
openssl pkcs12 -in response-mle.p12 -nocerts -nodes -out mle-response-key.pem
# The certificates in the Response MLE file; copy the one named CyberSource_SJC_US (its BEGIN CERTIFICATE to
# END CERTIFICATE block) into sjc-certificate.pem: ICC_MLE_REQUEST_CERT_FILE
openssl pkcs12 -in response-mle.p12 -nokeys -out response-mle-certs.pem
openssl x509 -in sjc-certificate.pem -noout -subject -dates
chmod 600 jwt-signing-key.pem mle-response-key.pem
rm response-mle-certs.pem
```

If `openssl` 3 says the `.p12` uses an unsupported algorithm, add `-legacy` to the `pkcs12` commands. To keep a key
encrypted on disk, leave out `-nodes`, choose a passphrase, and set the matching `…_PASSPHRASE` variable. The
preflight refuses a private key file that anyone but you can read.

## 3. Which value goes into which name

Names only; the owner sets the values in the shell and never in a file in the repository.

| Name | Value |
|---|---|
| `KIT11_ICC_RAIL` | `on` |
| `ICC_GO` | `yes`, the owner's go for the live commands |
| `ICC_CALL_BUDGET` | the approved number of calls (section 6) |
| `ICC_CALL_LOG` | a file in the private folder; one log for the whole hour |
| `KIT11_DB` | this world's own ledger, a path ending `icc…sqlite`, for example `data/icc-1.sqlite` (git ignores `data/`) |
| `KIT11_KEYS_DIR` | this world's own keys folder, a path ending `/icc…`, outside the repository (the runner uses it) |
| `ICC_MERCHANT_ID` | the organisation ID chosen at sign-up |
| `ICC_AUTH_SCHEME` | leave unset for `jwt-p12`; else `jwt-shared-secret` or `http-signature` |
| `ICC_JWT_KEY_ID` | the key ID of the P12 signing certificate |
| `ICC_JWT_PRIVATE_KEY_FILE` | the path of `jwt-signing-key.pem` |
| `ICC_JWT_PRIVATE_KEY_PASSPHRASE` | only if that file is encrypted |
| `ICC_KEY_ID`, `ICC_SHARED_SECRET` | only for the two shared-secret schemes: the **Key** and **Shared Secret** values |
| `ICC_MLE_REQUEST_CERT_FILE` | the path of `sjc-certificate.pem` |
| `ICC_MLE_RESPONSE_KEY_ID` | the key ID of the Response MLE key |
| `ICC_MLE_RESPONSE_PRIVATE_KEY_FILE` | the path of `mle-response-key.pem` |
| `ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE` | only if that file is encrypted |
| `ICC_INSTRUMENT_IDENTIFIER_ID` | the instrument identifier token of the enrolled test card (12 to 32 letters and digits) |
| `ICC_TOKENIZED_CARD_ID` | optional; the tokenized card's ID, for the preflight's second read |
| `ICC_ASSURANCE_FILE` | the path of a private JSON file with the passkey step's data (below) |
| `ICC_HOST`, `ICC_PATH_PREFIX`, `ICC_DIGEST_FORM`, `ICC_HTTP_SIGNATURE_DATE` | leave unset; change one only as section 7 says |

The assurance file is a JSON object with `deviceInformation` and `assuranceData`, passed to the service unchanged and
never stored. The preflight names any of these documented required fields that it lacks: `deviceInformation`
`.fingerprintSessionId`, `.deviceData.type`, `.deviceData.brand`, `.ipAddress`; and in each `assuranceData` item
`verificationMethod`, `verificationResults`, `verificationTimestamp`, `authenticatedIdentities.id` ([s-init]).
Purser adds `deviceInformation.applicationName` itself.

## 4. Where the files live

One private folder outside the repository, for example `../x402-business-agents-keys/icc-1` (`mkdir -m 700`), used as
`KIT11_KEYS_DIR` and holding the three PEM files, the assurance file and the call log. Files `chmod 600`. The `.p12`
downloads and their passwords stay where you keep secrets, not in this folder's backups. Nothing from this folder is
committed.

## 5. The commands, in order

Unset the other rails' live variables in this shell and in the runner's (`AIRWALLEX_*`, `METAL_*`, `T0_*`,
`KIT11_AIRI_RAIL`): the ICC commands do not read them.

| # | Step | Command | Calls |
|---|---|---|---|
| 0 | A fresh world: ledger and keys folder | `mkdir -m 700 $KIT11_KEYS_DIR` | 0 |
| 1 | Preflight: local checks, then the reads | `npm run icc -- preflight` | 1 or 2, GET only |
| 2 | The runner, with the same variables, and the CFO's passkey enrolled for this world | `npm run relay -- --enrol` (its own terminal) | 0 to the ICC host |
| 3 | The run: A, the CFO's Face ID on the phone, the runner runs A; then B | `npm run icc -- run` | 2 (the runner's) |
| 4 | The record | `npm run icc -- record` | 0 |
| 5 | Stop the runner | `npm run stop -- icc-1` (the world whose ledger is `data/icc-1.sqlite`) | 0 |

`run` refuses a ledger with no enrolled passkey (only Face ID approves) and a ledger that already holds a run (a new
run needs a fresh `icc…` ledger). `record` writes `docs/runs/<the run's date>-icc.md` and `.json` from the ledger's
audit rows and the call log only; it refuses a ledger with no run.

**Expected shape, from the test stand-in; not a sandbox run.** Copied from `npm run icc` driven against the test
stand-in under `test/` (built from the documented shapes; it is not the service and proves nothing about it). The
terms hash, the times and the folder differ in every run.

```
$ npm run icc -- preflight
ICC preflight: no purchase; at most two read calls, both GET
ok    environment  every name the chosen scheme (ICC_AUTH_SCHEME) needs is set
ok    key files  private to this user and outside the repository
ok    keys  the signing key, the response key and the request certificate open
ok    serial number  found in the request certificate's subject (the key ID of encrypted requests)
ok    clock  2026-11-12T12:57:32.601Z, inside the request certificate's validity; a token lives two minutes, so read 1 shows whether the service's clock agrees
ok    assurance file  present and private, with every documented required field
ok    read 1  GET /tms/v1/instrumentidentifiers/{id}: HTTP 200, state ACTIVE
ok    read 2  GET /tms/v2/tokenized-cards/{id}: HTTP 200, state ACTIVE
note  These reads cannot show whether the Intelligent Commerce operations are switched on for this organisation. The first POST of the run shows it.
ICC preflight: every check passed; 2 call(s) made

$ npm run icc -- run
ICC run: purchase A within the limit, then attempt B above it
A     12.00 EUR at Northwind Outdoor test shop: filed as P-0001; it waits for the CFO's passkey over its exact terms
FACE ID  approve or reject P-0001 on the phone with Face ID (the approval page on the relay, npm run relay); the runner (npm run relay, with this environment) then runs it
A     P-0001 EXECUTED: credential received, not used; no payment was made
B     250.00 EUR at Northwind Outdoor test shop: refused by Purser before any call (PURSER_ABOVE_HARD_CAP); 0 calls
ok    a_waited_for_cfo  A was filed as P-0001 for the CFO, with 0 call(s) before the approval
ok    a_cfo_signed_exact_terms  approved with passkey over the terms hash 1359d26db9a2…
ok    a_credential_received_not_used  credential received, not used; the flow stopped before checkout
ok    a_two_calls  A's calls: POST /icc/v1/instructions, POST /icc/v1/instructions/{id}/credentials
ok    b_refused_before_any_call  B: refused PURSER_ABOVE_HARD_CAP, 0 call(s)
ok    nothing_paid  0 journal line(s) added, 0 confirmation call(s)
ICC run: every check passed

(the runner's console, meanwhile)
ICC INSTRUCTION  P-0001: created for at most 12.00 EUR at Northwind Outdoor test shop, until 2026-11-12T13:28:23Z
ICC CREDENTIAL  P-0001: credential received, not used; the flow stops before checkout and nothing is paid

$ npm run icc -- record
record   docs/runs/<the run's date>-icc.md
record   docs/runs/<the run's date>-icc.json
```

While A waits, `run` prints a `wait` line each minute. It waits 35 minutes at most (the approval lasts 30).

## 6. Calls and budgets

From [section 6 of docs/visa-icc.md](../../visa-icc.md#6-the-flow-and-its-calls). Authentication adds no calls.

| Step | Calls |
|---|---|
| Preflight | 1, or 2 with `ICC_TOKENIZED_CARD_ID`; both GET |
| Run, A | 2: `POST /icc/v1/instructions`, `POST /icc/v1/instructions/{id}/credentials` |
| Run, B | 0: Purser refuses it before any call |
| Confirmation | 0: not sent for a credential that was not used (section 10, number 16) |
| Cancel | 0 here: the runner holds no fresh assurance data, so a refused instruction runs out at its signed expiry |

The budget counts every line in the one call log, across the conductor and the runner. Suggested: `ICC_CALL_BUDGET=2`
for the preflight, then `ICC_CALL_BUDGET=5` (2 + 3) for the run, as section 6 suggests. A call over the budget is
refused before it is sent.

## 7. When a step fails

Nothing is ever sent twice and nothing is retried. A second try of the run needs a fresh `icc…` ledger, the CFO's
passkey enrolled again, and the owner's go for the extra calls.

| What you see | Likely cause | What to check or change |
|---|---|---|
| `FAIL` on a local check, `skip read 1` | a key file, a key, the certificate or the clock | the named variable; `chmod 600`; the PEM conversion of section 2; the machine's clock |
| HTTP 401 | the scheme, the digest form, the clock, a key ID | the key IDs; then `ICC_DIGEST_FORM=hex` (the documentation shows both forms); with `http-signature`, `ICC_HTTP_SIGNATURE_DATE=date`; then the other scheme (`ICC_AUTH_SCHEME`) with its keys; the clock (a token lives two minutes). Section 10, numbers 2 and 3 |
| HTTP 400 on the first POST | a field name or form, or the path prefix | the error names a field: compare it with section 2 of docs/visa-icc.md ("Two descriptions that differ"); then `ICC_PATH_PREFIX=/acp/v1`; the currency (EUR is not in the examples) and the amount format. Section 10, numbers 5, 12 and 13 |
| HTTP 403 or 404 | the Intelligent Commerce operations are not switched on for the organisation | the Business Center and the sandbox e-mail; ask support. Section 10, number 1 |
| 202 `PENDING` (`PENDING_CARDHOLDER_AUTHENTICATION`) | the cardholder verification is not complete | the passkey step and the assurance file; Purser refuses the purchase and requests nothing more. Section 10, numbers 6 and 7 |
| `unconfirmed`: a timeout, a network error, an answer that cannot be opened | the call went out and its answer was lost | nothing is re-sent. Check the call log (the call is counted), the network, the Response MLE key and its key ID; ask support what became of it. Section 10, number 15 |
| `REFUSED ... budget is spent` | the call log already holds the approved number | the owner decides on more calls; nothing was sent |

[p-sandbox]: https://developer.cybersource.com/hello-world/agentic-sandbox.html
[r-mle-p12]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-message-intro/restgs-mle-intro.md
[r-jwt-p12]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-message-intro/restgs-jwt-const-intro.md
[r-toc]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-intro.html
[r-http-key]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-security-key-pair-intro.md
[s-init]: https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-purchase_intent-initiate-a-purchase-intent.json
[t-guide]: https://developer.cybersource.com/hello-world/testing-guide.html
