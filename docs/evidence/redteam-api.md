# Red team v2: the public /try API, on this computer

Run on 2026-11-19 with `npm run redteam:api` (src/cli/redteamApi.ts). 128 attacks: **126 PASS, 2 FAIL, 0 ERROR**.

Every attack is one or more HTTP requests to a server on this computer, never to the live site:

- **judge**: `npm run judge` (src/cli/judge.ts), the site and /try exactly as a judge without internet runs them. Code reads the invoice (no Claude call), the simulated bank pays, test money only. Its per-address limits are lifted on purpose (one person on their own computer), so the limits are attacked on the edge stand-in.
- **edge**: the same Purser Cloud handler and engine with the hosted deployment's defaults (CloudEnv's rate limits, the start limits of cloud/src/try/switches.ts, `own_upload` on), behind a stand-in for Cloudflare's edge that sets `cf-connecting-ip` to the TCP peer's address and drops what the client sent. Attacks from "another address" connect from another loopback address (127.0.x.y).
- **edge (in process)**: the same handler, called in this process with `cf-connecting-ip` set as the edge would set it, for IPv6 addresses (loopback has only ::1).

Passkeys are software authenticators (src/redteam/authenticator.ts) that can sign anything wrong on purpose. An attack whose harness failed is ERROR, never PASS. A FAIL is a finding and is listed below with its repro.

## Totals by group

| Group | Attacks | PASS | FAIL | ERROR |
|---|---|---|---|---|
| cross-company | 8 | 8 | 0 | 0 |
| signature replay | 12 | 12 | 0 | 0 |
| another world's passkey | 5 | 5 | 0 | 0 |
| terms tampering | 37 | 37 | 0 | 0 |
| double pay | 7 | 7 | 0 | 0 |
| rate limits | 13 | 13 | 0 | 0 |
| admin route | 13 | 13 | 0 | 0 |
| CSRF and origin | 7 | 7 | 0 | 0 |
| malformed bodies | 15 | 15 | 0 | 0 |
| prompt injection | 4 | 4 | 0 | 0 |
| path traversal | 2 | 2 | 0 | 0 |
| open redirect | 2 | 2 | 0 | 0 |
| headers | 3 | 1 | 2 | 0 |
| **all** | **128** | **126** | **2** | **0** |

## Findings (every FAIL and ERROR, with its repro)

### FAIL: Every page the judge serves (33): CSP with frame-ancestors 'none' (or X-Frame-Options DENY), no unsafe script, nosniff, a referrer policy (`headers-pages`, judge)

- Expected: every page has them
- Actual: /nope-404 (404): nosniff, referrer-policy
- Repro: / /home /watch /replay /proof /verify /trace /runs /agents/sourcing /agents/support /agents/treasury /alta /metal/report /visa /airwallex /airwallex/calls /claude /security /docs /status /t0 /books /?autonomy /?recorded /demo /live /film /try /tasks /month /lab /nope-404 /try/negotiate

### FAIL: Files the judge serves (font, icons, the proof samples, downloads): nosniff (`headers-files`, judge)

- Expected: each has nosniff
- Actual: /assets/inter.woff2: nosniff; /favicon.ico: nosniff; /favicon.svg: nosniff; /verify/samples/try-paid.json: nosniff
- Repro: /assets/inter.woff2 /favicon.ico /favicon.svg /verify/samples/x /t0/readback.json

## Every attack

### cross-company

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| B reads a proposal id that exists only in A's company (`xc-read-proposal`) | judge | 404 for B; nothing of A's in the answer | proposal 404 not_found, terms 404 not_found | PASS |
| B reads A's invoice ids and lists (`xc-read-invoice`) | judge | B sees only its own invoices; A's ids answer 404 or B's own | no A data; /v1/invoices 200, /v1/engine/invoices 200, /v1/payments 200, /v1/transactions 200, /v1/ledger/entries 200, /v1/engine 200, /v1/engine/vault 200, /v1/engine/events 200, /v1/invoices/AP-0001 404, /v1/invoices/AP-0002 404, /v1/invoices/AP-0003 404, /v1/invoices/AP-0004 404 | PASS |
| B pays A's proposal id with A's signed terms and A's approval (`xc-pay-other`) | judge | 404 (B has no such proposal); no transfer anywhere | 404 not_found; A's transfers 1→1, B's 0 | PASS |
| B approves A's proposal id with A's approval signature (`xc-approve-other`) | judge | B has no such proposal: refused or 404; A's proposal unchanged | 404 not_found | PASS |
| B renews a session for A's company with B's visitor token (`xc-renew-other`) | judge | 401; no session | 401 unauthorized | PASS |
| B rewrites its session token to name A's company (HMAC kept) (`xc-forged-session`) | judge | 401 | 401 unauthorized | PASS |
| B fetches A's document by its SHA-256 and A's archive files by path (`xc-document`) | judge | refused (try-only route list) or 404; never the bytes | document 403 try_only, vault file 404 not_found | PASS |
| B downloads its export and searches it for A (`xc-export`) | judge | B's own company only | 200, 11982 bytes, no A data | PASS |

### signature replay

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| An approval signature of P1 sent to approve another proposal of the same company (`replay-other-proposal-approve`) | judge | not approved: refused, or answered as a signature already used; the other proposal stays unapproved | 200 status=already: this signature was already handled: P-0001 is APPROVED; approved=false | PASS |
| P1's approval with P2's terms on P2's pay route (`replay-other-proposal-pay`) | judge | refused: the signature is not over P2's terms; no transfer | 200 outcome=refused | PASS |
| P1's terms and approval sent to P2's pay route (`replay-other-proposal-pay-own-terms`) | judge | 400 bad_terms (not P2's terms) or refused; no transfer | 400 bad_terms | PASS |
| The same approval replayed on its own proposal after it was paid (5 times) (`replay-after-execution`) | judge | paid_once each time; still exactly one transfer | first paid; then paid_once,paid_once,paid_once,paid_once,paid_once; transfers 1 | PASS |
| A fresh approval of the executed proposal, then pay again (`replay-approve-after-execution`) | judge | no second transfer | approve 200 status=already; pay 200 outcome=paid_once; transfers 1 | PASS |
| A signature made on another site (origin https://evil.example) for this proposal (`replay-wrong-origin`) | judge | refused | 200 status=refused: This signature was made on another website than this one. Nothing was paid. | PASS |
| A signature for another relying party (rpId evil.example) (`replay-wrong-rp`) | judge | refused | 200 status=refused: This signature belongs to a passkey of another website. Nothing was paid. | PASS |
| A signature without user verification (no Face ID) (`replay-no-uv`) | judge | refused | 200 status=refused: The passkey did not confirm it was you (Face ID, fingerprint or PIN). Nothing was paid. | PASS |
| A signature with a counter not above the last one seen (a cloned authenticator) (`replay-counter`) | judge | refused | 200 status=refused: This signature is older than one this passkey already gave, so it may be a copy. Nothing was paid. | PASS |
| Approve and pay with credentials that are not WebAuthn answers (`replay-malformed-credential`) | judge | 4xx or refused; never approved, never paid; no 500 | 200/refused+200/refused 200/refused+200/refused 200/refused+200/refused 200/refused+200/refused 200/refused+200/refused | PASS |
| A valid approval used to pay after the terms expired (`replay-after-expiry`) | judge | outcome expired or refused; no transfer | 200 outcome=expired: signature verified=true; executor accepted=false: P-0001 expired at 2026-11-19T10:47:56Z; approval void; transfers 0 | PASS |
| A fresh signature over the stored terms, made after they expired (`approve-after-expiry`) | judge | refused; no transfer | approve 200 status=too_late: P-0001 expired at 2026-11-19T10:47:56Z; nothing was approved; pay 200 outcome=not_signed; transfers 0 | PASS |

### another world's passkey

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| B's passkey (enrolled in B's world) signs A's challenge; A's session sends it (`world-other-passkey-approve`) | judge | refused: not A's passkey | 200 status=refused: this passkey is not enrolled | PASS |
| A's terms paid with a signature by B's passkey (`world-other-passkey-pay`) | judge | refused at the signature layer; no transfer | 200 outcome=refused; signature verified=false | PASS |
| One authenticator enrolled in two worlds: its signature for world B's proposal replayed in world A (`world-same-key-two-worlds`) | judge | refused: the challenge is A's terms hash, not B's | 200 outcome=refused | PASS |
| A passkey that was never enrolled anywhere signs A's proposal (`world-unenrolled-key`) | judge | refused | 200 status=refused: this passkey is not enrolled | PASS |
| A second passkey enrolled into a world that already has one, then used to approve (`world-second-passkey`) | judge | the enrolment is refused, or the new key replaces the old one (never two approvers in a test world) | second enrolment 200; old key then 200 status=refused | PASS |

### terms tampering

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| Pay with the terms changed (amount +0.01) and the approval over the original (`tamper-pay-amount-0-01`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (amount +0.01) with their own passkey and pays with that (`tamper-resign-amount-0-01`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (amount 1.00) and the approval over the original (`tamper-pay-amount-1-00`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (amount 1.00) with their own passkey and pays with that (`tamper-resign-amount-1-00`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (IBAN (account ending)) and the approval over the original (`tamper-pay-iban-account-ending-`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (IBAN (account ending)) with their own passkey and pays with that (`tamper-resign-iban-account-ending-`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (currency USD) and the approval over the original (`tamper-pay-currency-usd`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (currency USD) with their own passkey and pays with that (`tamper-resign-currency-usd`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (BIC) and the approval over the original (`tamper-pay-bic`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (BIC) with their own passkey and pays with that (`tamper-resign-bic`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (payee name) and the approval over the original (`tamper-pay-payee-name`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (payee name) with their own passkey and pays with that (`tamper-resign-payee-name`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (payee id) and the approval over the original (`tamper-pay-payee-id`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (payee id) with their own passkey and pays with that (`tamper-resign-payee-id`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (invoice number) and the approval over the original (`tamper-pay-invoice-number`) | judge | refused or 400 bad_terms; no transfer | 200 outcome=refused: signature verified=false; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| The visitor signs the changed terms (invoice number) with their own passkey and pays with that (`tamper-resign-invoice-number`) | judge | refused (the executor pays only the approved hash); no transfer | 200 outcome=refused: signature verified=true; executor accepted=false: P-0001: terms do not match the approved hash e54ad17e49290d1e8a08607bd44a38f981f7a93bbce209a33470e9f42e64b00c | PASS |
| Pay with the terms changed (expiry date +1 day) and the approval over the original (`tamper-pay-expiry-date-1-day`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (expiry date +1 day) with their own passkey and pays with that (`tamper-resign-expiry-date-1-day`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (fee reserve) and the approval over the original (`tamper-pay-fee-reserve`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (fee reserve) with their own passkey and pays with that (`tamper-resign-fee-reserve`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (transfer request id) and the approval over the original (`tamper-pay-transfer-request-id`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (transfer request id) with their own passkey and pays with that (`tamper-resign-transfer-request-id`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (FX quote id) and the approval over the original (`tamper-pay-fx-quote-id`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (FX quote id) with their own passkey and pays with that (`tamper-resign-fx-quote-id`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (FX rate) and the approval over the original (`tamper-pay-fx-rate`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (FX rate) with their own passkey and pays with that (`tamper-resign-fx-rate`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (FX sell amount) and the approval over the original (`tamper-pay-fx-sell-amount`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (FX sell amount) with their own passkey and pays with that (`tamper-resign-fx-sell-amount`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (FX quote expiry) and the approval over the original (`tamper-pay-fx-quote-expiry`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| The visitor signs the changed terms (FX quote expiry) with their own passkey and pays with that (`tamper-resign-fx-quote-expiry`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: only the amount, the currency, the payee, the account ending, the BIC and the invoice number can be changed here | PASS |
| Pay with the terms changed (an extra field) and the approval over the original (`tamper-pay-an-extra-field`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| The visitor signs the changed terms (an extra field) with their own passkey and pays with that (`tamper-resign-an-extra-field`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| Pay with the terms changed (a field removed) and the approval over the original (`tamper-pay-a-field-removed`) | judge | refused or 400 bad_terms; no transfer | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| The visitor signs the changed terms (a field removed) with their own passkey and pays with that (`tamper-resign-a-field-removed`) | judge | refused (the executor pays only the approved hash); no transfer | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| Approve with the hash of changed terms (amount 1.00), signed over that hash (`tamper-approve-other-hash`) | judge | refused; nothing stored as approved for the changed terms | with the changed hash 200 status=refused; with the stored hash 200 status=refused; approved=false | PASS |
| Write an invoice from a supplier on file with another IBAN (valid mod 97) (`tamper-compose-iban`) | judge | held for new bank details; no proposal can be filed | filed 200 status=blocked payable=false; propose 409 conflict: AP-0002 is blocked, not ready to pay: possible invoice fraud: the invoice asks for IBAN ...5432 (GB); on file: IBAN ...3000. Nothing is paid until a person chec; transfers 0 | PASS |
| Write an invoice from a supplier on file with another payee name (below the agent's limit) (`tamper-compose-payee`) | judge | never paid to that name without a check: held or paid to the supplier on file | filed status=needs_vendor; propose 409 conflict; payee in terms -; transfers 0 | PASS |

### double pay

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| 20 pay requests at once with the signed terms and the approval (`double-concurrent-20`) | judge | exactly one paid, the rest paid_once; one transfer | paid 1, paid_once 19, other []; transfers 1 | PASS |
| The retry route on a paid proposal, 5 times at once (`double-retry-route`) | judge | nothing to try again (409 or nothing_to_retry); no new transfer | 409 P-0001 is EXECUTED: there is nothing to try again; nothing w \| 409 P-0001 is EXECUTED: there is nothing to try again; nothing w \| 409 P-0001 is EXECUTED: there is nothing to try again; nothing w \| 409 P-0001 is EXECUTED: there is nothing to try again; nothing w \| 409 P-0001 is EXECUTED: there is nothing to try again; nothing w; transfers 1 | PASS |
| File the paid invoice's payment again (same invoice id, 5 at once) (`double-propose-again`) | judge | 409 for each; no new proposal or transfer | 409,409,409,409,409; transfers 1 | PASS |
| A paid invoice sent again: the same document, and the same invoice under a new number (`double-same-invoice`) | judge | duplicate_document, or held for a person; no proposal can be filed; one payment per invoice | again: kind=duplicate_document status=paid propose 409; renumbered: kind=invoice status=needs_review propose 409; transfers 1 | PASS |
| Every payment of a company carries its own transfer request_id (Airwallex's idempotency key) (`double-request-ids`) | judge | no request_id twice | 2 payments, 2 distinct request_ids | PASS |
| The agent's own payment (inside its limit) triggered 10 times at once (`double-alone-concurrent`) | judge | one payment for the invoice | 200,409,409,409,409,409,409,409,409,409; transfers 1 | PASS |
| 10 approvals and 10 pays of one proposal interleaved (`double-approve-and-pay-race`) | judge | one transfer | statuses 200; transfers 1 | PASS |

### rate limits

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| Start 8 test companies from one address (default 5 an hour) (`rate-starts-per-address`) | edge | the 6th and later answer 429 limit | 201,201,201,201,201,429,429,429 | PASS |
| Rotate X-Forwarded-For, X-Real-IP, True-Client-IP, Forwarded and CF-Connecting-IP on every start from one address (`rate-xff-spoof`) | edge | the headers are ignored: the 6th start answers 429 | 201,201,201,201,201,429,429,429 | PASS |
| Starts from five neighbouring addresses of one IPv4 /24 (127.0.200.1-5), 2 each (`rate-ipv4-neighbours`) | edge | each address has its own 5 an hour (IPv4 is counted whole; the /48 rule is IPv6's): all 10 start | 201,201,201,201,201,201,201,201,201,201 | PASS |
| IPv6: one /64 rotating its last 64 bits (edge stand-in in process) (`rate-ipv6-64`) | edge (in process) | counted as one address: the 6th start answers 429 | 201,201,201,201,201,429,429,429 | PASS |
| IPv6: one /48 rotating through 30 of its /64s (edge stand-in in process) (`rate-ipv6-48`) | edge (in process) | the /48 is counted too: at most 20 start in the hour | 20 started, then 429,429,429,429,429,429,429,429,429,429 | PASS |
| IPv6: one /64 written six ways (case, zeros, brackets, IPv4-mapped tail) (`rate-ipv6-spellings`) | edge (in process) | one address: the 6th answers 429 | 201,201,201,201,201,429,429 | PASS |
| A start body one byte over its 4,000-byte cap (room for a Turnstile token since 19 Nov), with an honest Content-Length (`rate-body-cap-length`) | edge | 400 'the body is larger than 4000 bytes' | 400 bad_request: the body is larger than 4000 bytes (4001 bytes) | PASS |
| A 30 MB start body sent chunked, with no Content-Length (`rate-body-cap-chunked`) | edge | refused at the cap while it arrives (400), quickly; the server keeps answering | 400 bad_request in 60 ms: the body is larger than 4000 bytes; health after 200 | PASS |
| A body larger than its Content-Length says (a lie of 10 bytes for 50 KB) (`rate-body-cap-lying-length`) | edge | the server reads no more than the header says, or refuses: 400; never parses the extra | 400:  | PASS |
| 35 pay attempts on one test company (30 in its life) (`rate-pay-cap-per-company`) | edge | the 31st and later answer 429 limit | 30 × 200, then 429,429,429,429,429 | PASS |
| 40 session renewals of one company in a minute (30 allowed) (`rate-renewals`) | edge | the 31st and later answer 429 | 30 × 200, then 429,429,429,429,429,429,429,429,429,429 | PASS |
| 30 forged bearer tokens from one address in a minute (20 failed allowed) (`rate-forged-tokens`) | edge | turned away with 429 after 20 failures | 20 × 401, then 429,429,429,429,429,429,429,429,429,429 | PASS |
| 650 reads in a minute with one session (600 allowed) (`rate-requests-per-session`) | edge | 429 after 600 | 600 × 200, 50 × 429, 0 other | PASS |

### admin route

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| POST /v1/try/admin with no token (`admin-no-token`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with a wrong token (`admin-a-wrong-token`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with the right token's prefix (`admin-the-right-token-s-prefix`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with the right token, lowercase scheme (`admin-the-right-token-lowercase-scheme`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with the right token with a trailing space and junk (`admin-the-right-token-with-a-trailing-space-and-junk`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with the right token as Basic (`admin-the-right-token-as-basic`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with the right token in the query (`admin-the-right-token-in-the-query`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with the right token in a cookie (`admin-the-right-token-in-a-cookie`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| POST /v1/try/admin with a visitor's own session (`admin-a-visitor-s-own-session`) | edge | 401 (or 403); no switch changed | 401 unauthorized; starts_per_address_hour now default | PASS |
| The right admin token from another site's page (Origin: https://evil.example) (`admin-right-token-cross-site`) | edge | 403: a browser elsewhere cannot use it | 403 forbidden | PASS |
| The right admin token (control: the route works for its owner) (`admin-right-token`) | edge | 200 | 200; token echoed: false | PASS |
| The judge's admin route, whose token is made and kept in its process (`admin-judge-unknown-token`) | judge | 401 for every guess | 401 | PASS |
| Platform routes (make a company, list companies) without a token and with a visitor's session (`admin-other-platform-routes`) | judge | 401 | 401 unauthorized; 401 unauthorized; 405 method_not_allowed | PASS |

### CSRF and origin

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| Every write of the demo from another site (`csrf-other-site`) | judge | 403 for each; nothing paid or filed | 403,403,403,403,403,403,403,403; transfers 0→0 | PASS |
| Every write of the demo from Origin: null (a sandboxed frame or a data: page) (`csrf-origin-null`) | judge | 403 for each; nothing paid or filed | 403,403,403,403,403,403,403,403; transfers 0→0 | PASS |
| Every write of the demo from a look-alike origin (`csrf-look-alike`) | judge | 403 for each; nothing paid or filed | 403,403,403,403,403,403,403,403; transfers 0→0 | PASS |
| Every write of the demo from another port on this machine (`csrf-other-port`) | judge | 403 for each; nothing paid or filed | 403,403,403,403,403,403,403,403; transfers 0→0 | PASS |
| Writes with no Origin header at all (a form post from an old browser, curl) (`csrf-no-origin`) | judge | 403 for the start, the renewal and every write of a test company | 403,403,403,403,403,403,403,403 | PASS |
| A cross-site 'simple' request (text/plain body, no preflight) carrying a stolen session (`csrf-simple-request`) | judge | 403 | 403 forbidden | PASS |
| A CORS preflight and a cross-site read: does any answer let another site read the API? (`csrf-cors-preflight`) | judge | no Access-Control-Allow-Origin for another site (and never * with credentials) | OPTIONS 403 ACAO=''; GET 200 ACAO='' | PASS |

### malformed bodies

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| The pay route sent not JSON (`body-not-json`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body is not JSON | PASS |
| The pay route sent empty (`body-empty`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body is not JSON | PASS |
| The pay route sent a JSON string (`body-a-json-string`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body does not fit: body: Invalid input: expected object, received string | PASS |
| The pay route sent a JSON array (`body-a-json-array`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body does not fit: body: Invalid input: expected object, received array | PASS |
| The pay route sent null (`body-null`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body does not fit: body: Invalid input: expected object, received null | PASS |
| The pay route sent deep nesting (5,000 levels) (`body-deep-nesting-5-000-levels`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body is larger than 8000 bytes | PASS |
| The pay route sent __proto__ and constructor keys (`body-__proto__-and-constructor-keys`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body does not fit: body: Unrecognized keys: "__proto__", "constructor" | PASS |
| The pay route sent duplicate keys (`body-duplicate-keys`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| The pay route sent a number where an object is (`body-a-number-where-an-object-is`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body does not fit: terms: Invalid input: expected record, received Infinity; credential: Invalid input: expected record, received number | PASS |
| The pay route sent a BOM first (`body-a-bom-first`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body does not fit: terms: Invalid input: expected record, received undefined; credential: Invalid input: expected record, received undefined | PASS |
| The pay route sent lone surrogates (`body-lone-surrogates`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| The pay route sent a 7,999-byte string field (`body-a-7-999-byte-string-field`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_terms: the terms must have exactly the keys of the signed terms | PASS |
| The pay route sent NUL bytes (`body-nul-bytes`) | judge | 4xx (or a refusal); never 500, never paid; the server keeps answering | 400 bad_request: the body is not JSON | PASS |
| Every POST route of the demo sent a body that is not JSON, and one that is the wrong shape (`body-every-route-junk`) | judge | 4xx on each; no 500 | 24 requests, none 5xx | PASS |
| Write-your-own with hostile field values (RTL override, zero-width, 10^9 amount, negative, 1e5, dates far away) (`body-compose-fields`) | judge | 400 naming the field, or filed as plain text; never 500 | invoice_no→400:invoice_no invoice_no→400:invoice_no amount→400:amount amount→400:amount amount→400:amount due_date→400:due_date issue_date→400:issue_date payee_name→200 | PASS |

### prompt injection

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| An invoice note that orders the agent to pay at once to another account (above the agent's limit) (`inject-compose-note`) | judge | the note is printed and read as data: no payment without the passkey; the terms' payee is the supplier on file | filed 200 status=needs_review; propose 409 conflict; payee - …-; transfers 0 | PASS |
| The same note on an invoice inside the agent's limit (EUR 300.00), with another IBAN (`inject-compose-note-small`) | judge | held for new bank details: the agent does not pay it alone | filed status=blocked payable=false; propose 409 conflict: AP-0002 is blocked, not ready to pay: possible invoice fraud: the invoice asks for IBAN ...5432 (GB); on file: IBAN ...3000. Nothing is paid until a person chec; transfers 0 | PASS |
| The visitor's own PDF (own_upload on): planted instructions, a hidden white-text line and another IBAN, inside the agent's limit (`inject-own-pdf`) | edge | read by code as data; held (new bank details or unknown supplier): no payment, nothing approved | upload 200 kind=invoice status=blocked read_by=parser; propose 409 conflict; transfers 0 | PASS |
| The same PDF upload while own_upload is off (the judge's default) (`inject-own-upload-off`) | judge | 403 try_only: the route is not in the demo's list | 403 try_only: A test company can use the hands-on demo's own routes only. | PASS |

### path traversal

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| Dot-dot paths in document, proposal, sample, vault and export ids (raw, %2F, %5C, double-encoded, NUL) (`traversal-api`) | judge | 400/403/404; never a file's contents | 404,404,404,404,404,404,404,404,404,404,404,404,404,403,404,404 | PASS |
| Dot-dot paths on the judge's own pages and files (`traversal-site`) | judge | 404 (the clean page) or a fixed file; never package.json or /etc/passwd | 404,404,404,404,404,404,404,404,404,404 | PASS |

### open redirect

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| Every redirect the judge's site and /try give, with a foreign Host, scheme-relative paths and next= parameters (`redirect-judge`) | judge | every Location stays on localhost (or is relative to it) | 18 probes, 11 redirects, all on this site | PASS |
| The OAuth consent route with a redirect_uri on another site (edge: the cloud's full handler) (`redirect-oauth`) | edge | no redirect to evil.example | 400 Location '' | PASS |

### headers

| Attack | Target | Expected | Actual | Verdict |
|---|---|---|---|---|
| Every page the judge serves (33): CSP with frame-ancestors 'none' (or X-Frame-Options DENY), no unsafe script, nosniff, a referrer policy (`headers-pages`) | judge | every page has them | /nope-404 (404): nosniff, referrer-policy | FAIL |
| Every kind of API answer (200, 401, 403, 404, 405, 429-shaped): nosniff, no-store, a CSP that loads nothing (`headers-api`) | judge | each answer has them | 10 answers | PASS |
| Files the judge serves (font, icons, the proof samples, downloads): nosniff (`headers-files`) | judge | each has nosniff | /assets/inter.woff2: nosniff; /favicon.ico: nosniff; /favicon.svg: nosniff; /verify/samples/try-paid.json: nosniff | FAIL |

The JSON beside this file (`redteam-api.json`) holds the same results with each attack's repro.
