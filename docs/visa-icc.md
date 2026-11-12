# Visa Intelligent Commerce Connect: the documented API and Purser's design

Intelligent Commerce Connect: access requested, not granted yet; not used in this entry.

Every fact below was read from public documentation on 12 November 2026. No API call was made: there are no
credentials yet. Nothing here has run. This is a reading of the documentation and a design for the first sandbox hour.

How to read it:

- A key in square brackets, such as [g-init], is a link to the page a fact came from. The full list, with the date
  read, is under [Sources](#11-sources). All pages are on `developer.cybersource.com`.
- "unknown until sandbox access" means the public pages are silent or disagree. Each such point is listed once more in
  [section 10](#10-unknown-until-sandbox-access) with its consequence.
- Intelligent Commerce Connect (ICC) is the name on the product page [p-icc]. The developer guide calls the same API
  "Intelligent Commerce" and marks every page "pilot" [g-intro], [g-endpoints].

## 2. The API as documented

### Two descriptions that differ

The developer guide (pilot release 25.09.01, last revision 25.12.01 [g-rev]) and the API reference (spec version
1.3.0, dated 2026.08.12 in its own revision table [s-init]) describe the same six operations differently.

| Topic | Developer guide | API reference |
|---|---|---|
| Path prefix | `/acp/v1` [g-endpoints] | `/icc/v1` [a-app], [s-init]. The spec's revision table says the reference moved to `/icc/v1` on 2026.06.12 and that the service still supports both prefixes [s-init] |
| Authentication | a "REST API shared secret key", and a system that is "REST compliant" as the Getting Started guide explains [g-prereq] | every operation lists `authorizationType: ["Json Web Token"]`, `mleForRequest: "mandatory"`, `mleForResponse: "mandatory"` [a-app], [s-init]. The reference's script maps "Json Web Token" to its label "JWT with Asymmetric (JSON Web Token)" [a-app] |
| Initiate request | requires `tokenizedCard.number`; `recurringPaymentInformation.occurrence` at the top level [g-init] | no `tokenizedCard`; `recurringPaymentInformation` inside each mandate; adds `merchantCategory`, `merchantCategoryCode`, `isRecurring` [s-init] |
| Credentials request | `agreementInformation[].id`, `shippingAddress`, `products[]`, `tokenizedCard.number` [g-cred] | `mandateReferenceData[].mandateId`, `orderInformation.shipTo`, `orderInformation.lineItems[]`; no `tokenizedCard` [s-cred] |
| Credentials response | example: `clientCorrelationId`, `transactionId`, `status: "COMPLETED"` [g-cred] | `clientCorrelationId`, `instructionId`, `authorization`, `signedPayload` [s-cred] |
| Confirm request | `transactionData[]` with amount and merchant [g-confirm] | `confirmationData[]` with a required `processorInformation` [s-confirm] |
| Confirm response | example: `status: "COMPLETED"`, `signedPayload`, `transactionId` [g-confirm] | HTTP 202 with `clientCorrelationId` only [s-confirm] |

Purser builds to the API reference, because its revision date is the later one, and keeps the guide's shapes in this
document as the known alternative. Which shape the sandbox accepts: unknown until sandbox access.

### Hosts

| Environment | Host | Source |
|---|---|---|
| Test (sandbox) | `https://apitest.cybersource.com` | [g-endpoints]; `host` in the spec [s-init] |
| Production (not used by Purser) | `https://api.cybersource.com` | [g-endpoints] |
| Production in India, token endpoints (not used) | `https://api.in.cybersource.com` | [g-tms-ii] |
| Business Center, test (where keys are made) | `https://businesscentertest.cybersource.com` | [r-http-key] |

The sandbox sign-up form asks for an organisation ID, company, name, address, e-mail and phone. After it, an e-mail
with instructions to create a user in the Test Business Center is promised [p-sandbox]. How long that takes, and
whether the ICC operations are switched on for a new organisation: unknown until sandbox access. The pages on
`developer.visaacceptance.com` were not read in this session, so the Visa Acceptance host names are unknown here.

### Prerequisites the guide lists

From [g-prereq]: agentic capability on the site; a merchant ID or organisation ID; a REST API shared secret key (the
sandbox sign-up "creates a test key"); a REST compliant system; a token requester ID and a relationship ID ("contact
your Cybersource account manager"); the Token Management Service (TMS) Passkey Service set up, which starts with an
instrument identifier token for the card [g-tms-ii].

### Authentication

No page read describes a login or token call. Every request carries its own proof, so authentication costs 0 extra
calls [r-jwt-p12], [r-http].

| Fact | Source |
|---|---|
| Two schemes exist: JSON Web Token (JWT) messages and HTTP Signature messages | [r-intro] |
| HTTP Signature is marked "deprecating": everyone must move to JWT by March 2027; a first set-up is advised to use JWT | [r-intro], [r-toc] |
| JWT construction changed in February 2026 and now goes with Message-Level Encryption (MLE); systems must follow by March 2027 | [r-intro], [r-jwt-p12] |
| The API reference lists the six ICC operations for "Json Web Token" only, with MLE mandatory for request and response | [a-app], [s-init], [s-cred], [s-confirm], [s-cancel], [s-enroll] |
| The reference lists the TMS read calls and "Process a Payment" for all three labels (JWT with a shared secret, JWT with a certificate key, HTTP Signature), with MLE optional | [a-app] |

So the documented scheme for ICC is a JWT signed with the private key of a P12 certificate, with the body encrypted.
Whether a JWT signed with the shared secret, or an HTTP Signature, is also accepted on ICC paths: unknown until sandbox
access.

**JWT message** ([r-jwt-p12] for a P12 key, [r-jwt-ss] for a shared secret; the two pages agree except where noted).

| Part | Content |
|---|---|
| HTTP headers | `content-type: application/json`; `host: <API host>`; `authorization: Bearer <JWS token>`. The page lists all three as required; the client sends `content-type` on every call, with and without a body |
| JWS token | `<Base64URL header>.<Base64URL body claims>.<Base64URL signature>` |
| Header `alg` | P12 key: `RS256` (default), `RS384`, `RS512`, `PS256`, `PS384`, `PS512` [r-jwt-p12]. Shared secret: `HS256`, `HS384`, `HS512` [r-jwt-ss] |
| Header `kid` | the key ID of the P12 certificate [r-jwt-p12], or of the shared secret key pair [r-jwt-ss] |
| Header `typ` | `JWT` |
| Signature | P12: sign `<header>.<claims>` with the private key [r-jwt-p12]. Shared secret: HMAC over the same text with the Base64-decoded secret [r-jwt-ss] |

| Body claim | Value |
|---|---|
| `digest` | Base64 of the SHA-256 hash of the HTTP body; left out when the body is empty (GET, DELETE) |
| `digestAlgorithm` | `SHA-256` (as in the page's example); left out when `digest` is |
| `iat` | issue time, seconds since 1970-01-01T00:00:00Z |
| `exp` | expiry; at most two minutes after `iat` |
| `iss` | the merchant ID that created the key |
| `jti` | a unique token ID, UUID version 4, "used for replay prevention" |
| `request-host` | host name only, for example `api.cybersource.com` |
| `request-method` | lower case: `post`, `get`, `put`, `patch` or `delete` |
| `request-resource-path` | the path, for example `/pts/v2/payments` |
| `v-c-jwt-version` | `2` |
| `v-c-merchant-id` | the transacting merchant ID |
| `v-c-response-mle-kid` | the key ID of the REST API Response MLE key |

The claims table gives the type "String" for every claim, yet the page's own example writes `iat` and `exp` as JSON
numbers [r-jwt-ss]. Purser follows the example.

**Message-Level Encryption** ([r-mle-p12], [r-mle-ss]; the two pages give the same steps).

| Step | Documented |
|---|---|
| Keys | three: the signing key; the SJC public certificate for requests; the REST API Response MLE key for responses. The SJC certificate (`CyberSource_SJC_US`) is taken out of the Response MLE key's `.p12` file with `openssl pkcs12 -in {certificate_file_name}.p12` |
| Request | the JSON request is encrypted as a JWE with the SJC certificate; the HTTP body becomes `{"encryptedRequest": "<JWE>"}`; the `digest` claim is the hash of that HTTP body |
| JWE, request | the Java sample uses `JWEAlgorithm.RSA_OAEP` with `EncryptionMethod.A256GCM`, content type `JWT`, and as key ID the `SERIALNUMBER` of the certificate's subject |
| Response | `{"encryptedResponse": "<JWE>"}`, with header `alg: "RSA-OAEP-256"`, `enc: "A256GCM"`, `iat`, and `kid` (the serial number of `v-c-response-mle-kid`); decrypted with the Response MLE private key |
| Where keys are made | Test Business Center, Payment Configuration, Key Management, "Generate key", then the option for a REST shared secret or for a REST API Response MLE key [r-http-key], [r-mle-ss]. The page for creating the P12 signing certificate is in the guide's menu [r-toc] and was not read |

**HTTP Signature message** ([r-http]; deprecating, kept here because the TMS read calls list it [a-app]).

| Part | Documented |
|---|---|
| Headers | `content-type`, `host`, `v-c-date` (RFC 1123 date), `v-c-merchant-id`, `digest` (not on GET), `signature` |
| `digest` | `SHA-256=` followed by the Base64 of the SHA-256 hash of the body |
| Signature hash | Base64 of the HMAC SHA-256 of the "validation string", keyed with the Base64-decoded shared secret |
| Validation string | one `name: value` line per signed header, in the order of the `headers` parameter, each ended by `\n`; `request-target` is the lower-case method, a space and the path |
| `signature` header | parameters `keyid`, `algorithm` (`HmacSHA256`), `headers`, `signature`. The page's format line reads: `Signature:"keyid:"[keyid]",algorithm="[encryption algoritm]",headers="field1" "field2" "field3" "etc.", signature="[signature hash]"` |

The page is not consistent with itself: the header table names `v-c-date`, the validation string example and the
signature example use `date`; the validation string example ends its path with `/` while the text above it says a
trailing `/` is a different path [r-http]. Which spelling the server expects: unknown until sandbox access.

### The documentation's own worked examples

No page publishes a complete example: none gives a secret or private key together with the signature it produces. What
is published, quoted exactly from the saved pages:

1. The HTTP Signature validation string [r-http]. Its signature cannot be reproduced, because the example names no
   secret. The page's signature header example (key ID `123abcki-…`, see the page) is therefore format only.

```
host: apitest.cybersource.com\n
date: Thu, 18 Jul 2019 00:18:03 GMT\n
request-target: post /pts/v2/payments/\n
digest: SHA-256=gXWufV4Zc7VkN9Wkv9jh/JuAVclqDusx3vkyo3uJFWU=\n
v-c-merchant-id: mymerchantid
```

2. The JWT signing input for a shared secret [r-jwt-ss]. The page shows the commands and not their output.

```
  printf "%s.%s" \
    "$(echo -n '{"alg":"HS256","typ":"JWT","kid":"1234567890"}' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')" \
    "$(echo -n '{"digest":"Yjg0NGIxOTMxMzQ2NzhlYjdiMDdhMWZmYjZiYzUzNzlkMTk5NzFmNjAzNWRmMThlNzk0N2NhY2U0YTEwNzYyYQ==","digestAlgorithm":"SHA-256","iat":1709845200,"exp":1709845320,"request-method":"post",
  "request-resource-path":"/pts/v2/payments","request-host":"api.cybersource.com","iss":"merchantid","jti":"12345678-1234-1234-1234-123456789012","v-c-jwt-version":"2","v-c-merchant-id":"merchantid"}' | 
  base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')" \
    > signing_input.txt
```

```
openssl dgst -sha256 -mac HMAC -macopt key:"$(echo 'YOUR_BASE64_ENCODED_SECRET' | base64 -d)" -binary signing_input.txt | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '='
```

   Computed in this session with a short script, not by running the page's commands and with no network: each of
   the two JSON texts between the single quotes is Base64URL-encoded without padding, exactly as printed (the second
   text includes its line break and two spaces), and the two are joined with a point. The result is 579 characters
   long and its SHA-256 is `626201ca3922046d58402077f26688e88cd312a972c1b277eb5cc1a3e2269fe5`. The secret is a
   placeholder, so there is no expected signature.

3. The digest examples disagree with each other [r-jwt-ss], [r-jwt-p12], [r-http]. The shell example hashes a printed
   JSON body and then Base64-encodes the hexadecimal text of the hash; the `digest` in example 2 has that form (it
   decodes to 64 hexadecimal characters). The C# and Java samples on the same pages, the MLE Java sample [r-mle-p12]
   and the HTTP Signature example (`SHA-256=` plus 44 characters) Base64-encode the 32 raw bytes instead. The printed
   body also does not hash to the printed value: hashing it as the command describes gives `a3862d3b…`, the page prints
   `6ae5459b…` (computed locally).

Consequence for the signing code of task 2: the tests check the documented structure (headers, claim names, encodings,
the signing input of example 2 against the hash above, the digest of raw bytes as the code samples do), and check
signatures against Node's own verify function with keys made in the test. No documentation vector exists for a
signature itself. Which digest form the server accepts is settled by the first signed sandbox call.

### Endpoints

Paths as in the API reference; the guide has the same paths under `/acp/v1` [g-endpoints].

| Operation | Method and path | Purpose | Success answers | Sources |
|---|---|---|---|---|
| Enroll a card | `POST /icc/v1/tokens` | registers a card (already a TMS token) for agent payments | 200 `status: ACTIVE`; 202 `status: PENDING` with `pendingEvents` until the cardholder is verified | [s-enroll], [g-enroll] |
| Initiate a purchase intent | `POST /icc/v1/instructions` | creates the instruction with its mandates; returns `instructionId` | 200 with `instructionId`; 202 `PENDING` with `pendingEvents` | [s-init], [g-init] |
| Update a purchase intent | `PUT /icc/v1/instructions/{instructionId}` | changes the instruction; same body as initiate; returns the same `instructionId` | 200; 202 | [a-app], [g-update] |
| Cancel a purchase intent | `PUT /icc/v1/instructions/{instructionId}/cancel` | cancels before credentials are used | 200; 202 | [s-cancel], [g-cancel] |
| Retrieve payment credentials | `POST /icc/v1/instructions/{instructionId}/credentials` | returns the payment credential for one transaction | 200 `COMPLETED`; 202 `PENDING` with `pendingEvents` [a-app]. The spec lists both shapes under 200 | [s-cred], [g-cred], [a-app] |
| Confirm transaction events | `POST /icc/v1/instructions/{instructionId}/confirmations` | reports the payment's outcome | 202 | [s-confirm], [g-confirm] |

**No read call.** The reference's script lists every `/icc/v1` method and path. There is no GET for an instruction, a
mandate, an enrolment or a credential; the only GETs are for agents, merchants, checkout sessions and products [a-app].
An instruction cannot be read back through any documented call. The create answer holds three fields and none of the
mandate [s-init].

The same script lists other `/icc/v1` families (agent and merchant registration with keys, checkout sessions, a
product feed, `POST /icc/v1/mpp/credentials`) [a-app]. They were not read and are not used.

Supporting TMS calls named by the guide or listed in the reference:

| Call | Use | Source |
|---|---|---|
| `POST /tms/v1/instrumentidentifiers` | turns a card number into an instrument identifier token; required field `card.number`; the answer has `id`, `state: "ACTIVE"` and a masked number | [g-tms-ii] |
| `GET /tms/v1/instrumentidentifiers/{instrumentIdentifierId}` | reads that token; listed for all three authentication labels | [a-app] |
| `GET /tms/v2/tokenized-cards/{tokenizedCardId}` | reads a tokenized card; listed for all three authentication labels | [a-app] |
| `POST /tms/v2/tokenized-cards/{tokenId}/authentication-options` | asks which passkey step applies; answers `AUTHENTICATE`, `AUTHENTICATION_REGISTRATION` or `STEP_UP_AUTHENTICATE` | [g-pk-options] |
| `POST /tms/v2/tokens/{tokenId}/payment-credentials` | creates a cryptogram with the passkey data; "optional if you are sending a payment" | [g-pk-cred], [g-passkey] |

The one-time-password, validation and registration calls of the passkey flow are in the guide's menu [g-passkey] and
were not read.

### Initiate a purchase intent: request

From the spec [s-init]. "Guide" marks what the guide lists as required [g-init].

| Field | Type | Required | Limit | Meaning |
|---|---|---|---|---|
| `clientCorrelationId` | string | yes (guide: yes) | up to 255 | correlation ID, "used during the tokenization or during FIDO assertion"; echoed in every answer |
| `paymentInformation.instrumentIdentifier.id` | string | yes (guide: yes) | 12 to 32 | the TMS instrument identifier token of the card |
| `paymentInformation.customer.id`, `.paymentInstrument.id` | string | no (guide: yes; its example sends empty strings) | 1 to 32 | other TMS tokens |
| `tokenizedCard.number` | string | guide only: yes | not given | in the guide's example a 32-character reference, not a card number |
| `deviceInformation.applicationName` | string | yes (guide: yes) | up to 255 | name of the connecting application |
| `deviceInformation.fingerprintSessionId` | string | yes (guide: yes) | up to 255 | device fingerprinting session |
| `deviceInformation.deviceData.type`, `.brand` | string | yes (guide: yes) | up to 255 | device type and brand |
| `deviceInformation.ipAddress` | string | yes (guide: yes) | IPv4 pattern | the consumer device's address |
| `deviceInformation.clientDeviceId`, `.deviceData.manufacturer`, `.deviceData.model`, `.userAgent`, `.country` | string | no | 255; `userAgent` 2048; `country` 2 | more device data |
| `assuranceData[]` | array | yes | | proof that the consumer or device was verified; see below |
| `mandates[]` | array | yes | | the spending limits; see the next table |
| `buyerInformation.merchantCustomerId` | string | no | up to 255 | reference of the consumer |
| `isRecurring` | boolean | no | | default false |
| `consumerPrompt` | string | no | up to 4098, one line | a summary of the prompts that led to the purchase |

Most string fields carry one pattern: the value may not consist only of the characters `* . , ' # _ / -` and may not
contain `./` [s-init].

`assuranceData[]` items [s-init]: `verificationMethod` (required; codes such as `02` app-based authentication, `04`
one-time passcode, `21` and `22` token service step-up), `verificationResults` (required; `01` verified, `02` not
verified, `03` not performed, `04` not required, `21` not allowed), `verificationTimestamp` (required; UTC Unix epoch
as a string of up to 12 characters), `authenticatedIdentities.id` (required inside that object, 1 to 50; the identifier
the passkey step returned), `authenticatedIdentities.data` and `.provider`, `authenticationContext.action`,
`verificationType` (`CARDHOLDER` by default, or `DEVICE`), `verificationEntity` (`10` for Visa), `verificationEvents[]`
(`01` payment, `02` card enrolment, `03` profile access, `04` account verification), `additionalData`.

Where this data comes from: the Passkey Service, a pilot feature. The cardholder starts a session and a device
fingerprint in an iframe on the site; for the iframe and the Visa Token Service SDK the guide says "contact your
Cybersource account manager" [g-passkey].

### The constraints a mandate supports

All from `mandates[]` in the spec [s-init]; the guide lists the same required fields [g-init].

| Constraint | Field | Type and limit | Required | Notes |
|---|---|---|---|---|
| Amount cap | `declineThreshold.amount` | string, 1 to 12 | the object is required; the guide requires the field | "the maximum transaction amount the consumer is willing to authorize under this mandate"; examples `"10000.00"` [s-init] and `"100.00"` [g-update] |
| Currency | `declineThreshold.currencyCode` | string, 3, ISO 4217 | guide: yes | examples use `USD` only |
| Expiry | `effectiveUntilTime` | string, up to 12, UTC Unix epoch | yes | example `"1784841600"` |
| Merchant | `preferredMerchantName` | string, up to 255 | no | "User merchant preference"; a preference by its name |
| Merchant category | `merchantCategory`, `merchantCategoryCode` | string, up to 255 | no | spec only |
| Quantity | `quantity` | string, up to 10 | no | |
| Frequency | `recurringPaymentInformation.occurrence` | `WEEKLY`, `MONTHLY`, `YEARLY` | no | inside the mandate in the spec, at the top level in the guide; goes with `isRecurring` |
| Reference | `mandateId` | string, up to 50 | yes | given by the caller; unique within the instruction; not to be reused |
| Description | `description` | string, up to 255 | yes | "Description of the product" |

Not in the documentation read: a purchase type field; a field for the agent's identity; how many mandates one
instruction may hold; whether amounts are summed over several credentials; a default lifetime; what the service does
when a credential request breaks a mandate. All unknown until sandbox access.

### Initiate, update and cancel: answers

| Answer | Fields | Source |
|---|---|---|
| HTTP 200 | `clientCorrelationId` (required), `instructionId` (required), `status` (a string; values not listed) | [s-init], [s-cancel] |
| HTTP 202 | `clientCorrelationId`, `instructionId`, `status: "PENDING"`, `pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"]`, `propertyName` | [s-init], [s-cancel] |

`instructionId` is 36 to 50 characters where it is a path parameter [s-cred]. The cancel request needs
`clientCorrelationId`, `deviceInformation` and a fresh `assuranceData[]` with `authenticatedIdentities.id` [s-cancel],
[g-cancel]: cancelling needs a new cardholder verification record. The reference says cancel returns "status CANCELLED"
[a-app]. The update spec file was not read.

### Retrieve payment credentials

Request, from the spec [s-cred]; the guide's field names differ as listed at the top [g-cred].

| Field | Type | Required | Limit | Meaning |
|---|---|---|---|---|
| `clientCorrelationId` | string | yes | up to 255 | correlation ID |
| `paymentInformation.instrumentIdentifier.id` | string | yes | 12 to 32 | the card's token |
| `transactionData[].clientReferenceInformation.code` | string | yes | up to 50 | "A distinct identifier for this order/line item"; links the credential, the payment and the confirmation |
| `transactionData[].mandateReferenceData[].mandateId` | string | conditional | up to 50 | the mandate this transaction falls under |
| `transactionData[].type` | string | conditional | | `PURCHASE` (default), `BILL_PAYMENT`, `MONEY_TRANSFER`, `DISBURSEMENT`, `P2P` |
| `transactionData[].orderInformation.amountDetail.totalAmount` | string | yes | 1 to 12 | the amount to pay; examples `"100"` and `"100.00"` |
| `transactionData[].orderInformation.amountDetail.currency` | string | yes | 3 | ISO 4217 |
| `transactionData[].merchantInformation.merchantName` | string | yes | up to 40 | "Required for the Network's system to facilitate authentication" |
| `transactionData[].merchantInformation.merchantDescriptor.url` | string | yes | up to 255 | merchant URL; the spec's revision table says examples now include `https://` |
| `transactionData[].merchantInformation.merchantDescriptor.country` | string | yes | 2 | ISO 3166-1 alpha-2 |
| `transactionData[].merchantOrderId` | string | conditional | up to 50 | the order or invoice number |
| `transactionData[].paymentOptions.dynamicDataType` | string | no | | `TAVV`, `DAVV` or `NONE` |
| `transactionData[].paymentOptions.dpaDynamicDataTtlMinutes` | string | no | up to 10 | requested lifetime of the dynamic data, in minutes; example `"10080"` |
| `transactionData[].orderInformation.lineItems[].items.*` | object | no | `productName` up to 10; `additionalInfo[].key` and `.value` up to 255; `policies.*` up to 4098 | line items |
| `transactionData[].orderInformation.shipTo.*`, `.deliveryMethod`, `attachments[]`, `paymentServiceProviderName`, `paymentServiceProviderUrl` | | no | | shipping, delivery, images, payment service provider |

Answer, one of two shapes. The spec's 200 schema wraps each in an object, `TransactionResponseComplete` or
`TransactionResponseWithPendingEvents`; its example spells them `transactionResponseComplete` and
`transactionResponseWithPendingEvents` and gives `pendingEvents` as one string, where the schema has a list [s-cred]. The
reference says the pending shape comes with HTTP 202 [a-app]. Whether the sandbox wraps the fields, and with which
spelling: unknown until sandbox access. The client reads all three forms: either wrapper, or the fields at the top level.

| Shape | Fields |
|---|---|
| complete | `clientCorrelationId`, `instructionId`, `authorization` ("First Party Authorization Token/code"), `signedPayload` ("Signed payload containing the payment credentials"); the example adds `status: "COMPLETED"` and shows `"signedPayload": "jws-signed-payload"` |
| pending | `clientCorrelationId`, `instructionId`, `pendingEvents` (example: `PENDING_CARDHOLDER_AUTHENTICATION`) |

The reference describes the complete answer as "a signed payload containing encrypted payment credentials
(authorization token and JWS-signed payload)" that "is used by the merchant's payment processor to complete the
transaction" [a-app]. The guide says the agent then uses "your payment system to complete the transaction" [g-cred].

What the credential holds: unknown until sandbox access. No page read says what is inside `signedPayload` (a token
number, an expiry date, a cryptogram), with which key its signature is checked or its content decrypted, how long it
lives beyond the requested `dpaDynamicDataTtlMinutes`, or whether it works once only. For comparison only, a different
call: the TMS payment-credentials answer shows a token number, an expiry month and year, a `cryptogram` and an `eci`
value, and no card security code [g-pk-cred].

### Confirm transaction events

Request, from the spec [s-confirm]; the guide's shape is under "Two descriptions that differ" [g-confirm].

| Field | Type | Required | Limit | Meaning |
|---|---|---|---|---|
| `clientCorrelationId` | string | yes | up to 255 | correlation ID |
| `paymentInformation.instrumentIdentifier.id` | string | yes | 12 to 32 | the card's token |
| `confirmationData[].clientReferenceInformation.code` | string | yes | up to 50 | the same code as in the credentials request |
| `confirmationData[].processorInformation.transactionType` | string | yes | | `PURCHASE`, `AUTHORIZATION`, `CAPTURE`, `REFUND`, `REVERSAL`, `VERIFICATION`, `CHARGEBACK`, `FRAUD` |
| `confirmationData[].processorInformation.transactionStatus` | string | yes | | `APPROVED`, `DECLINED`, `PENDING`, `ERROR`, `CANCELLED` |
| `confirmationData[].processorInformation.amountDetail.totalAmount`, `.currency` | string | required inside the object | 1 to 12; 3 | the amount the processor handled |
| `confirmationData[].processorInformation.responseCode`, `.approvalCode`, `.transactionTimestamp`, `.retrievalReferenceNumber`, `.systemTraceAuditNumber`, `.acquirerReferenceNumber`, `.entryMode`, `.dynamicDataId` | string | no | 2; 128; 12; 64; 64; 64; a list; 50 | the processor's answer |
| `confirmationData[].orderInformation.orderId`, `.orderStatus`, `.orderDate` | string | no | 100; 50; 12 | the order |
| `confirmationData[].merchantInformation.merchantName`, `.merchantId`, `.categoryCode` | string | no | 255; 255; 4 | the merchant |

Answer: HTTP 202 with `clientCorrelationId` [s-confirm]. The guide's example shows `status: "COMPLETED"` and a
`signedPayload` instead [g-confirm].

### Idempotency, limits, errors

| Topic | Documented | Source |
|---|---|---|
| Idempotency key | none for these operations: the five spec files read define body and path parameters only, no header. The reference's script mentions an `Idempotency-Key` header only for the separate checkout-session operations | [s-init], [s-cred], [s-confirm], [s-cancel], [s-enroll], [a-app] |
| Replay | the JWT's `jti` is "used for replay prevention"; a `mandateId` is not to be reused | [r-jwt-p12], [s-init] |
| A repeated POST with the same `clientCorrelationId` | unknown until sandbox access | |
| Limits | the field lengths above; a JWT lives at most two minutes. Rate limits, credentials per instruction and instruction lifetime are not stated: unknown until sandbox access | [r-jwt-p12] |
| Error answers | HTTP 400, 401, 403, 404, 409 and 500, each with `{"error": {"status", "reason", "message", "detail": {"reason", "source", "sourceType", "message"}}}`. Example reasons: `INVALID_ARGUMENT`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `UNAVAILABLE`, `INTERNAL_SERVER_ERROR`. Every example carries the same message text, so the messages are placeholders | [s-init], [s-cred], [s-confirm] |
| Whether an error body is encrypted too; what 409 means here | unknown until sandbox access | |

The general response-codes page was not read.

### Sandbox test data

| Fact | Source |
|---|---|
| The sandbox "never processes an actual payment" and needs its own credentials | [t-guide] |
| Test card numbers "work only in the sandbox". The first row of the table is a Visa number ending 1111, with no security code listed. Without a stated expiry date, any later date may be used; where a security code is required and not given, any 3 digits for Visa | [t-guide] |
| The instrument identifier example shows a masked number that also ends 1111 | [g-tms-ii] |

No page read gives test data for ICC itself: no test token, no test assurance data, no passkey test values, no amounts
that trigger a refusal. The guide's examples use placeholder IDs [g-init], [g-cred]. All unknown until sandbox access.

## 3. Free-text and reference fields

Fields that could carry Purser's terms hash (64 hexadecimal characters) or a reference. Limits from the spec files.

| Call | Field | Limit | Fits the hash | Planned content | Source |
|---|---|---|---|---|---|
| Initiate | `mandates[].description` | 255 | yes | the purchase description, then `purser-terms-sha256 <hash>` | [s-init] |
| Initiate | `consumerPrompt` | 4098, one line | yes | one sentence: agent, cap, currency, merchant, expiry, proposal ID and the hash | [s-init] |
| Initiate | `mandates[].mandateId` | 50 | no | Purser's action ID (a reference) | [s-init] |
| Initiate | `clientCorrelationId` | 255 | yes, not planned | a call ID; the field may have to match the passkey step, see section 10 | [s-init] |
| Initiate | `buyerInformation.merchantCustomerId` | 255 | yes, not planned | left out: it names the consumer | [s-init] |
| Credentials | `transactionData[].clientReferenceInformation.code` | 50 | no | Purser's action ID | [s-cred] |
| Credentials | `transactionData[].merchantOrderId` | 50 | no | the order reference | [s-cred] |
| Credentials | `transactionData[].orderInformation.lineItems[].items.additionalInfo[]` | key 255, value 255 | yes | key `purser-terms-sha256`, value the hash | [s-cred] |
| Confirm | `confirmationData[].clientReferenceInformation.code` | 50 | no | Purser's action ID | [s-confirm] |
| Confirm | `confirmationData[].orderInformation.orderId` | 100 | yes | the order reference | [s-confirm] |

Whether any of these is stored, shown to anyone or returned: unknown until sandbox access. No documented answer returns
them.

## 4. Mapping from Purser's signed terms

The CFO signs the SHA-256 of the exact terms (`src/lib/terms.ts`). For a card purchase the terms hold: `proposal_id`,
`expires_at`, `agent`, `amount`, `currency`, `merchant {name, url, country}`, `items`, `description` and the payment
method (`airiTerms` in `src/airi/purchase.ts`). The ICC rail builds its instruction from those terms and from nothing
else, the way `mandateFromTerms` does for Airi.

| Signed term | Purser's format | ICC field | API format | Conversion |
|---|---|---|---|---|
| `amount` | two-decimal string, at most 9 digits before the point, so at most 12 characters (`AMOUNT` in `src/airi/purchase.ts`) | `mandates[0].declineThreshold.amount`; later `transactionData[0].orderInformation.amountDetail.totalAmount` | string, 1 to 12; the examples are decimal strings [s-init], [s-cred] | the string is sent as signed. Comparisons use integer cents from `toCents` (`src/lib/money.ts`). No number type is used anywhere |
| `currency` | ISO 4217 code | `mandates[0].declineThreshold.currencyCode`; later `amountDetail.currency` | string of 3 [s-init] | unchanged |
| `expires_at` | UTC ISO-8601 with `Z` | `mandates[0].effectiveUntilTime` | UTC Unix epoch seconds as a string [s-init] | parse to whole milliseconds; refuse unless they divide by 1000; divide as integers; write the digits |
| `merchant.name` | text | `mandates[0].preferredMerchantName`; later `merchantInformation.merchantName` | up to 255; later up to 40 [s-init], [s-cred] | unchanged. A name over 40 characters is refused before any call; it is never cut. The Airi rail's test shop name is 47 characters long, so the ICC rail needs its own registry entry |
| `merchant.url` | https URL | `merchantInformation.merchantDescriptor.url` | up to 255 [s-cred] | unchanged |
| `merchant.country` | two letters | `merchantInformation.merchantDescriptor.country` | 2 [s-cred] | unchanged |
| `agent` | Purser's agent name | `deviceInformation.applicationName`; also in `consumerPrompt` | up to 255 [s-init] | `Purser <agent> agent`. The API has no field for an agent's identity |
| `proposal_id` and action ID | text | `mandates[0].mandateId`; `clientReferenceInformation.code` | up to 50 [s-init], [s-cred] | the action ID, one per purchase; the proposal ID goes into `consumerPrompt` |
| terms hash | 64 lower-case hexadecimal characters | `mandates[0].description`; `consumerPrompt` | 255; 4098 [s-init] | appended as text; see section 3 |
| `description` | text | `mandates[0].description` | 255 [s-init] | shortened to make room for the hash; the hash still covers the full text |
| `items` | name, two-decimal unit price, quantity | none in the first run | `lineItems` are optional; a product name is limited to 10 characters [s-cred] | left out; Purser's own check that items add up to the amount stays |
| payment method | an ID | `paymentInformation.instrumentIdentifier.id` | 12 to 32 [s-init] | the enrolled test card's instrument identifier |

One mandate per instruction. `isRecurring` is left out (false by default). Device and assurance data do not come from
the terms: they come from the cardholder's passkey step and are passed through unchanged.

## 5. What Purser checks before the credential

**The API offers no read-back GET** (section 2, "No read call"). The stream's plan was to read the instruction back
from Visa and compare it. That cannot be done with the documented calls. What is compared instead, before any
credential is requested, is clearly less: Purser's own record of what it sent, and the three fields of the create
answer.

| Check | Compared | Refusal when |
|---|---|---|
| Terms hash | the stored terms hash again to the hash the CFO approved (as the Airi rail does twice) | they differ |
| Amount cap | cents of the request body's `declineThreshold.amount` against cents of the signed `amount` | they differ |
| Over-cap purchase | cents of the amount to pay against the cap | the amount is above the cap |
| Currency | `currencyCode`, and the currency to pay, against the signed `currency` | any differs |
| Merchant | `preferredMerchantName`, and the name, URL and country to pay, against the signed merchant | any differs |
| Expiry | `effectiveUntilTime` against the signed `expires_at` in seconds; then the clock | they differ, or the instruction has expired or expires within the time a checkout needs |
| Agent and reference | `applicationName`, `mandateId` and the action ID against the signed `agent` and Purser's row | any differs |
| Hash carried | the hash inside `mandates[0].description` and `consumerPrompt` | missing or different |
| Sent record | Purser's record of the instruction it sent, stored with its SHA-256 before sending, against a record rebuilt from the terms. The record holds every field that comes from the terms. It holds no device or assurance data: those are passed through and never stored (section 8) | they differ, or the stored record no longer matches its stored hash |
| Status | the create answer: HTTP 200, an `instructionId` of 36 to 50 characters, the same `clientCorrelationId` | HTTP 202, `PENDING`, a missing ID or another correlation ID |

Any difference, an expired instruction or an over-cap amount refuses the purchase. No credential is requested. The
refusal is written to the audit trail with Purser's code. An instruction that was already created is cancelled when
fresh assurance data is at hand; otherwise it runs out at `effectiveUntilTime`, which is the signed expiry.

If the sandbox turns out to have a read call that the documentation does not show, it replaces the "sent record" row
and the comparison is made against Visa's copy. The check is written as one function over the signed terms, the
instruction as recorded, the create answer, the purchase to make and the time, so only the source of the record changes.

## 6. The flow and its calls

Authentication adds no calls. Nothing is sent twice: a call whose answer is lost is recorded as unconfirmed and not
repeated, because no idempotency key is documented and no read call can tell what happened.

| Step | Calls | What happens |
|---|---|---|
| **Preflight** | at most 2, both reads | no purchase |
| 1 | 0 | the flag, the names of section 9, the host (test host only) and the keys are checked locally |
| 2 | 1 | `GET /tms/v1/instrumentidentifiers/{id}` [a-app]: the key signs, the clock is right, the test card's token is `ACTIVE` |
| 3 | 1 | `GET /tms/v2/tokenized-cards/{id}` [a-app]: the tokenized card exists (skipped when no ID is set) |
| **Run, purchase A (under the limit)** | 2 expected | |
| 4 | 0 | Purser's own rules; the CFO's passkey over the terms where the rules ask for it |
| 5 | 1 | `POST /icc/v1/instructions` [s-init], built from the terms |
| 6 | 0 | the checks of section 5 |
| 7 | 1 | `POST /icc/v1/instructions/{instructionId}/credentials` [s-cred] |
| 8 | 0 | the credential's envelope is checked, then it is dropped; no payment (section 7) |
| 9 | 0 or 1 | `POST …/confirmations` [s-confirm] only if the first sandbox hour shows what to report for a credential that was not used |
| 10 | 0 or 1 | `PUT …/cancel` [s-cancel] only after a refusal at step 6 and with fresh assurance data |
| **Run, attempt B (over the limit)** | 0 | Purser refuses before any call: no instruction, no credential |
| **Total for one run** | 2 expected, 3 at most | steps 9 and 10 exclude each other; suggested budgets: 2 for preflight, 3 for the run |

The preflight reads cannot show that the ICC operations are switched on for the organisation. The first POST shows it.

One-time set-up before the first run is not part of a run, and its size is unknown until sandbox access: at least one
`POST /tms/v1/instrumentidentifiers` [g-tms-ii], one `POST /icc/v1/tokens` [s-enroll] and one passkey call
[g-pk-options], and a browser step for the cardholder [g-passkey].

Whether the service itself refuses a credential above the mandate's amount is not documented. Purser never sends such
a request. Testing it would be a separate, deliberate probe that the owner decides on.

## 7. Checkout

What the documentation says may be done with the credential: the agent uses "your payment system to complete the
transaction" [g-cred], [g-flow]; the signed payload "is used by the merchant's payment processor" [a-app]. No page
read says how to open the payload or how to put it into a payment request.

| Option | Fits | Reason |
|---|---|---|
| The existing hosted checkout (`src/airi/hostedCheckout.ts`) | no | It types a card number, an expiry date and a security code into a card form (`src/airi/credential.ts` requires all three). The documented answer is a signed payload for a payment processor, asked for with a dynamic data type of `TAVV` or `DAVV` [s-cred]. No security code is documented anywhere |
| A Cybersource payment call with the credential | not yet | "Process a Payment" (`POST /pts/v2/payments`) is in the reference [a-app]. Its spec was not read, and no page links the ICC payload to its fields |
| Stop before checkout | yes | It needs nothing the documentation leaves open |

**Recommendation: the first run stops before checkout.** Purser requests the credential, checks only that the answer
has the documented shape, drops it and records "credential received, not used". Nothing is reported as paid. When the
sandbox shows what the payload holds and which payment call takes it, a Cybersource sandbox payment becomes the
checkout step. The hosted page stays out unless the payload turns out to hold a card number, an expiry date and a
security code, which nothing in the documentation suggests.

## 8. Card data rules

- Only the sandbox's documented test card: the Visa test number ending 1111 from the testing guide [t-guide]. Never a
  real card. The full number is not written in this repository's documents.
- The card number is sent once, by the owner, when the instrument identifier is created. Purser's ICC rail handles the
  token ID only.
- The credential (`signedPayload` and `authorization`) is treated as card data and as single-use, whatever the service
  allows: it lives in memory for one step, is never logged, never written to the ledger, a run record or an error,
  never given to a model, and is dropped after use. (A JavaScript string cannot be overwritten in memory: the client
  holds the two values in one object that prints nothing, and lets go of them.)
- Assurance data and device data are treated the same way.
- Decrypted answers are never logged. The call log holds the method, the path with IDs replaced, the time and the
  process, as `src/airwallex/callBudget.ts` does.
- A test proves that no card number or security code pattern reaches logs, run records or the ledger, as for the Airi
  rail.

## 9. Environment variables (names only)

| Name | Holds |
|---|---|
| `KIT11_ICC_RAIL` | the rail's switch: `on` or absent; off by default |
| `ICC_GO` | the go variable for the live commands |
| `ICC_CALL_BUDGET` | the approved number of calls, a whole number |
| `ICC_CALL_LOG` | the call log's file path; goes with the budget |
| `ICC_HOST` | optional; only the documented test host is accepted |
| `ICC_PATH_PREFIX` | optional; `/icc/v1` (default) or `/acp/v1`, the two documented prefixes |
| `ICC_MERCHANT_ID` | the organisation ID |
| `ICC_AUTH_SCHEME` | optional; which documented scheme to use: `jwt-p12` (default; the JWT signed with the key of the P12 certificate), `jwt-shared-secret` or `http-signature` |
| `ICC_JWT_KEY_ID` | the key ID of the P12 signing certificate |
| `ICC_JWT_PRIVATE_KEY_FILE` | the path of the signing certificate's private key, as a PEM file |
| `ICC_JWT_PRIVATE_KEY_PASSPHRASE` | optional; the passphrase of that PEM file, if it has one |
| `ICC_KEY_ID` | the key ID of the shared secret key pair (shared-secret JWT or HTTP Signature) |
| `ICC_SHARED_SECRET` | the shared secret |
| `ICC_MLE_REQUEST_CERT_FILE` | the path of the SJC public certificate that encrypts requests, as a PEM file |
| `ICC_MLE_RESPONSE_KEY_ID` | the key ID of the Response MLE key |
| `ICC_MLE_RESPONSE_PRIVATE_KEY_FILE` | the path of the Response MLE private key, as a PEM file |
| `ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE` | optional; the passphrase of that PEM file, if it has one |
| `ICC_DIGEST_FORM` | optional; `raw` (default: Base64 of the hash's bytes) or `hex` (Base64 of its hexadecimal text), the two forms the pages show |
| `ICC_HTTP_SIGNATURE_DATE` | optional; `v-c-date` (default) or `date`, the two names the HTTP Signature page uses for its date header |
| `ICC_INSTRUMENT_IDENTIFIER_ID` | the instrument identifier token of the enrolled test card |
| `ICC_TOKENIZED_CARD_ID` | optional; the tokenized card's ID, for the second preflight read |
| `ICC_ASSURANCE_FILE` | the path of a private file with the device and assurance data from the cardholder's passkey step |

Values are set by the owner and never printed.

Keys are read as PEM files, not as `.p12` files: Node cannot open a PKCS#12 file without an added library, and this
client adds none. The owner converts each downloaded `.p12` file once with `openssl` (the runbook gives the commands).
A private key file must belong to the user who runs the command and be readable by nobody else; the client refuses it
otherwise. The assurance file is held to the same rule.

Message-Level Encryption is on when its three variables are set. With a JWT, a call to an ICC path without it is
refused before it is sent, because the reference marks it mandatory there [a-app]; the two token reads of the preflight
may go without. The HTTP Signature has no documented way to ask for an encrypted answer, so that scheme sends plain
JSON.

Three points have two published forms that only the sandbox can settle (section 10, numbers 3 and 5). Each has one
switch, with the default this document chose: `ICC_PATH_PREFIX`, `ICC_DIGEST_FORM` and `ICC_HTTP_SIGNATURE_DATE`. There
are no other switches. Only the API reference's request shapes are built; the guide's other shapes (section 2, "Two
descriptions that differ"), and with them the guide's `tokenizedCard.number`, are not.

## 10. Unknown until sandbox access

| # | Open question | Consequence for the client | How the first sandbox hour settles it |
|---|---|---|---|
| 1 | Are the ICC operations switched on for a new sandbox organisation, and are a token requester ID and a relationship ID needed first [g-prereq]? | without them no ICC call works | the Business Center after login; the first POST |
| 2 | Which authentication does ICC accept: only the P12-key JWT with MLE [a-app], or also the shared-secret JWT or HTTP Signature [g-prereq]? | which keys the owner creates; which signer runs | the preflight read with each scheme, then the first POST |
| 3 | Digest form (raw bytes or hexadecimal text), `date` or `v-c-date`, claim types | a wrong form gives HTTP 401 | the preflight read and the first POST |
| 4 | JWE details: `RSA-OAEP` or `RSA-OAEP-256` for requests; whether error bodies are encrypted | the encryption settings | the first POST; one deliberately invalid request |
| 5 | `/icc/v1` or `/acp/v1`, and the guide's or the reference's field names | the request builders | the first POST; an HTTP 400 names the field |
| 6 | Where device and assurance data come from without the iframe and SDK, and whether the sandbox takes the documented sample values [g-passkey] | without valid assurance data no instruction can be made; this is the largest risk | the Business Center and the sandbox e-mail; the first POST |
| 7 | How a card is enrolled in the sandbox and how a 202 `PENDING` ends | the one-time set-up and its calls | the set-up itself |
| 8 | Is there any way to read an instruction back? | section 5 compares Purser's own record | the Business Center; the reference after login |
| 9 | What `signedPayload` and `authorization` hold, how they are opened, how long they live, whether they work once | the checkout step; section 7 | the first credential answer, looked at in memory only |
| 10 | Does the service refuse a credential above `declineThreshold`, for another merchant or after `effectiveUntilTime`? | whether the Visa-side limit is enforced there as well as in Purser | a separate probe, only if the owner decides on it |
| 11 | Does `preferredMerchantName` bind, or is it a preference? | what "merchant" means in the instruction | as 10 |
| 12 | Are `EUR` and a non-US merchant accepted? The examples use `USD` and `US` only | the run's currency and test merchant | the first POST |
| 13 | Amount format: are two-decimal strings required, allowed or rejected? | the amount is sent as signed | the first POST |
| 14 | Must `clientCorrelationId` equal the ID of the passkey step? | how the ID is chosen | the first POST |
| 15 | What does a repeated POST do; is there an idempotency key? | nothing is sent twice; a lost answer stays unconfirmed | not tested in the first hour |
| 16 | What should be reported for a credential that was not used, and with which status? | step 9 of section 6 | the reference after login; support |
| 17 | Is a free-text field stored or returned? | where the terms hash is visible on Visa's side | the Business Center's view of the instruction, if there is one |
| 18 | Rate limits, instruction lifetime, mandates per instruction, credentials per instruction | the budgets | not tested; read from any answer headers |
| 19 | Test data for ICC: a test token, test assurance values, amounts that trigger refusals | which test values the run uses | the sandbox e-mail; the Business Center |
| 20 | The Visa Acceptance host names, the response-codes page, the update spec, the P12 certificate page, the remaining passkey pages | none for the first run; they were not read | read them when access arrives |

## 11. Sources

All read on 12 November 2026. Number 1 was read with a page-scraping tool; the others were fetched as files. A copy of
every page was kept outside the repository for review. One more fetch failed (the Markdown form of [g-tms-ii]); its
HTML form was read instead.

The published spec files carry a notice in their description that the information is proprietary and confidential to
Visa. They are served without login by the public API reference. This document states field names, types and limits
in its own words and copies no descriptions beyond short quoted phrases. The owner decides whether it stays in a
public repository.

| Key | Page |
|---|---|
| [g-init] | Developer guide: Initiate a Purchase Intent |
| [g-endpoints] | Developer guide: Endpoints |
| [g-order] | Developer guide: Order of API Requests |
| [g-flow] | Developer guide: Complete a Purchase Workflow |
| [g-enroll] | Developer guide: Enroll a Card |
| [g-update] | Developer guide: Update a Purchase Intent |
| [g-cancel] | Developer guide: Cancel a Purchase Intent |
| [g-cred] | Developer guide: Retrieve Payment Credentials |
| [g-confirm] | Developer guide: Confirm Transaction Events |
| [g-prereq] | Developer guide: Prerequisites |
| [g-intro] | Developer guide: Introduction to Intelligent Commerce |
| [g-passkey] | Developer guide: Set Up Passkey Service |
| [g-rev] | Developer guide: Recent Revisions to This Document |
| [g-tms-ii] | Developer guide: Create an Instrument Identifier Token |
| [g-pk-options] | Developer guide: Create Tokenized Card Authentication Options |
| [g-pk-cred] | Developer guide: Create Tokenized Credentials with Authenticated Passkey Service Credentials |
| [r-intro] | Getting Started with REST: Introduction to REST |
| [r-toc] | Getting Started with REST: the same page as HTML, for its menu |
| [r-http] | Getting Started with REST: Construct Messages Using HTTP Signature Security |
| [r-http-test] | Getting Started with REST: Test Your Setup (HTTP Signature) |
| [r-http-key] | Getting Started with REST: Create a Shared Secret Key Pair |
| [r-jwt-ss] | Getting Started with REST: Construct Messages Using JSON Web Tokens (shared secret) |
| [r-mle-ss] | Getting Started with REST: Enable Message-Level Encryption (shared secret) |
| [r-jwt-p12] | Getting Started with REST: Construct Messages Using JSON Web Tokens (P12 certificate) |
| [r-mle-p12] | Getting Started with REST: Enable Message-Level Encryption (P12 certificate) |
| [p-icc] | Product page: Intelligent Commerce Connect |
| [p-sandbox] | Intelligent Commerce Sandbox Sign up |
| [a-index] | API Reference page |
| [a-app] | API Reference page: its script, which holds the list of operations |
| [s-init] | API Reference spec: Initiate a purchase intent |
| [s-cred] | API Reference spec: Retrieve payment credentials |
| [s-confirm] | API Reference spec: Confirm transaction events |
| [s-cancel] | API Reference spec: Cancel a purchase intent |
| [s-enroll] | API Reference spec: Enroll a card |
| [t-guide] | Testing guide |

[g-init]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-purchase-initiate-intro.html
[g-endpoints]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-process-trxn.md
[g-order]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-order-flow.md
[g-flow]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-initiate-flow.md
[g-enroll]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-enroll-card-intro.md
[g-update]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-purchase-update-intro.md
[g-cancel]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-purchase-cancel-intro.md
[g-cred]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-retrieve-credentials-intro.md
[g-confirm]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-confirm-trxn-intro.md
[g-prereq]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements.md
[g-intro]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/home.md
[g-passkey]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-passkey-intro.md
[g-rev]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-about-guide/intelligent-commerce-recent-revisions.md
[g-tms-ii]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-tms-ii-intro.html
[g-pk-options]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-passkey-intro/tms-net-tkn-card-authenticate-intro.md
[g-pk-cred]: https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-passkey-intro/tms-net-tkn-card-create-passkey-intro.md
[r-intro]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-intro.md
[r-toc]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-intro.html
[r-http]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-http-message-conf-intro.html
[r-http-test]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-test.md
[r-http-key]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-security-key-pair-intro.md
[r-jwt-ss]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-shared-secret-intro/restgs-jwt-con-shared-secret-intro.html
[r-mle-ss]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-shared-secret-intro/restgs-mle-shared-secret-intro.md
[r-jwt-p12]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-message-intro/restgs-jwt-const-intro.md
[r-mle-p12]: https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-message-intro/restgs-mle-intro.md
[p-icc]: https://developer.cybersource.com/products/intelligent_commerce.html
[p-sandbox]: https://developer.cybersource.com/hello-world/agentic-sandbox.html
[a-index]: https://developer.cybersource.com/api-reference-assets/index.html
[a-app]: https://developer.cybersource.com/api-reference-assets/static/js/main.BVga27j8.js
[s-init]: https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-purchase_intent-initiate-a-purchase-intent.json
[s-cred]: https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-payment_events-retrieve-payment-credentials.json
[s-confirm]: https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-payment_events-confirm-transaction-events.json
[s-cancel]: https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-purchase_intent-cancel-a-purchase-intent.json
[s-enroll]: https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-enrollment-enroll-a-card.json
[t-guide]: https://developer.cybersource.com/hello-world/testing-guide.html
