# eIDAS signatures in Purser: the passkey, the JAdES evidence export, and a QES option

**Not legal advice.** This page explains how Purser's approval signatures relate to the eIDAS Regulation, from the
primary texts listed at the end. It is written by the people who build Purser, not by lawyers. Before relying on any
of it, ask a lawyer qualified in the Member State concerned.

## Voor Max

- **Wat de passkey nu is.** Een goedkeuring met de passkey (Face ID) is juridisch een *elektronische handtekening*
  (eIDAS art. 3 lid 10) over de SHA-256 van de exacte betaalvoorwaarden. Ze *kan* voldoen aan de eisen voor een
  *geavanceerde* handtekening (art. 26), vooral als de passkey aantoonbaar aan de CFO gekoppeld is. Ze is **geen
  gekwalificeerde elektronische handtekening (QES)**: daarvoor zijn een gekwalificeerd certificaat van een
  gekwalificeerde verlener (QTSP) en een gekwalificeerd middel (QSCD) nodig.
- **Wat er nu gebouwd is (achter een vlag, standaard uit: `PURSER_EIDAS=on`).** (1) Een export van elke goedkeuring
  als bewijsbestand in JAdES-opmaak (ETSI TS 119 182-1), met een offline verifier: `npm run eidas:export` en
  `npm run verify-eidas`. (2) Een optionele RFC 3161-tijdstempel. (3) Een QES-adapter voor de CSC API v2 (de API
  van de meeste QTSP's voor handtekeningen op afstand).
- **Wat echt draait en wat niet.** De export en de verifier: gebouwd en getest. De tijdstempel: getest met een
  nep-TSA; daarnaast op 19 november twee echte tokens van openbare TSA's (freetsa.org, DigiCert) opgehaald en offline
  gecontroleerd. De QES-adapter: **alleen getest tegen een nep-CSC-server; er is nooit een echte QES gezet.** Daarvoor
  is een QTSP-account nodig.
- **Wat een QES zou betekenen.** In de hele EU dezelfde rechtskracht als een handgeschreven handtekening (art. 25 lid 2
  en 3). Voor een interne betaalgoedkeuring is dat zelden wettelijk verplicht; het verandert het bewijsgewicht, niet de
  betaling. De passkey blijft de poort voor het geld; de QES komt er alleen naast.
- **Wat jij nog moet doen voor een echte QES.** Een QTSP kiezen die op de EU Trusted List staat en remote QES via
  CSC API v2 biedt, een contract (inclusief verwerkersovereenkomst), de identiteit van de CFO laten vaststellen door die
  QTSP, en de kosten per handtekening of per jaar opvragen. Voor Peppol is geen QES nodig: Peppol-facturen worden niet
  per document ondertekend.
- **Geen juridisch advies.** Laat dit toetsen door een jurist voordat je er iets mee claimt.

## What is built, mocked, live, or only written here

| Piece | Status |
|---|---|
| Passkey approval (WebAuthn over the terms SHA-256) | **Live**, unchanged by this option. Same code, same money rules. |
| JAdES-layout evidence export + offline verifier (`src/eidas/jades.ts`, `npm run eidas:export`, `npm run verify-eidas`) | **Built**, tested (`test/eidas-evidence.test.ts`): round trip; every one-byte change of a file refused. Behind `PURSER_EIDAS=on`, off by default. |
| RFC 3161 time-stamp (`src/eidas/tsa.ts`) | **Built**, tested against a **mock** TSA (the test suite has no network). Two real responses from public TSAs (freetsa.org, timestamp.digicert.com) were fetched **live** on 19 Nov 2026 with curl and verify offline in the tests (`test/fixtures/eidas/`); the same day `npm run eidas:export -- docs/proof/try-paid.json --tsa https://freetsa.org/tsr` ran **live** once and its file verified. Neither TSA is a qualified TSA as far as this check knows: it does not check the Trusted List. |
| QES adapter: CSC API v2 client (`src/eidas/csc.ts`) | **Built and tested against a mock CSC server; needs a QTSP account to run live.** No live qualified signature has ever been made. Purser has no QTSP contract, no credential, no qualified certificate. |
| EU Trusted List validation, JAdES-B-LT / B-LTA, ASiC-E, PAdES, XAdES | **Not built.** Docs only (below). |
| Everything in this page about the law | **Docs only.** Not legal advice. |

## 1. The tiers, and what each one is

### Tier 1: the passkey approval (live today)

Above an agent's limit, the CFO approves a payment with a WebAuthn passkey. The passkey signs a challenge that is the
32 raw bytes of the SHA-256 of the exact payment terms (RFC 8785 canonical JSON). One changed cent gives another
hash, and the signature no longer covers it.

Under eIDAS this is an **electronic signature**: "data in electronic form which is attached to or logically
associated with other data in electronic form and which is used by the signatory to sign" (art. 3(10)). Art. 25(1)
says an electronic signature "shall not be denied legal effect and admissibility as evidence in legal proceedings
solely on the grounds that it is in an electronic form or that it does not meet the requirements for qualified
electronic signatures".

Whether it is also an **advanced electronic signature** (AdES, art. 3(11)) depends on art. 26, point by point. Our
reading, not a ruling:

| Art. 26 requirement | The passkey approval | May it meet it? |
|---|---|---|
| (a) uniquely linked to the signatory | One key pair per enrolled person; the runner pins its public key and refuses any other (`src/passkey/webauthn.ts`). | Likely, for a device-bound key. |
| (b) capable of identifying the signatory | The key is tied to a label ("max") by Purser's own enrolment (a one-time code, a fingerprint confirmed on the runner). No identity document is checked; no attestation is verified. | **Depends** on how the enrolment ties the key to the CFO as a person. This is the weakest point. |
| (c) created using signature creation data the signatory can, "with a high level of confidence, use under his sole control" | The private key stays in the phone's secure hardware; every signature needs user verification (Face ID, fingerprint or PIN). | **Arguable.** A *synced* passkey (iCloud Keychain, Google Password Manager) is copied to the person's cloud account and other devices; a device-bound security key is stronger here. |
| (d) linked to the data signed so that "any subsequent change in the data is detectable" | The challenge is the terms hash; one changed byte fails the check, offline. | Yes. |

So: the passkey approval **may meet** the AdES requirements, depending mainly on (b) and (c). It **is not** a
qualified electronic signature, and nothing in Purser should say otherwise.

### Tier 2: the JAdES evidence export (built, behind the flag)

`npm run eidas:export` writes one signed approval as a JWS JSON Serialization (RFC 7515 clause 7.2.1) in the layout
of **ETSI TS 119 182-1 V1.2.1 (2024-07), JAdES**. Its payload is the approval's evidence in canonical JSON: the
canonical terms and their SHA-256, each passkey's WebAuthn assertion (authenticatorData, clientDataJSON, signature),
the passkey's public key (COSE), rpId and origin, the CFO policy version the approval was signed under (from the
runner's ledger; a /try proof bundle has none), and the signing and export times. It can carry an RFC 3161
time-stamp on the payload.

Precisely what this is, and is not:

- **An evidence format, in the AdES family's JSON layout.** JAdES is ETSI's format for AdES *digital signatures*. Using
  the format does not by itself make a signature "advanced" in the legal sense of art. 26: that depends on the
  signature, the key and the signer, as in the table above.
- **The passkey assertion is not a JWS signature, and cannot be made one.** WebAuthn signs
  `authenticatorData ‖ SHA-256(clientDataJSON)`, never a JWS signing input. So it rides inside the payload, and the
  verifier checks it by WebAuthn's own rules, with the same function the runner uses (`verifyApprovalSignature` in
  `src/passkey/webauthn.ts`).
- **With no QES, `signatures` is empty.** The file is then evidence in JAdES layout, not a JAdES signature. The
  verifier says so ("no JAdES signature: evidence in JAdES layout; the passkey is its only signature").
- **With the QES adapter, `signatures[0]` is a JAdES baseline signature** over the payload: protected header `alg`
  (ES256 or RS256), `x5c`, `x5t#S256`, `iat` (TS 119 182-1 clause 5.1.11: since 2025-07-15 the claimed signing time is
  `iat`, not `sigT`), and `srCms` with the commitment type `http://uri.etsi.org/01903/v1.2.2#ProofOfApproval`
  (JAdES-B-B). With a time-stamp, a `sigTst` in the unprotected `etsiU` array stamps the base64url signature value
  (clause 5.3.4): JAdES-B-T. `crit` is not needed: since V1.2.1 it is required only with `sigD` (clause 5.1.9).

`npm run verify-eidas -- file.jades.json` checks a file offline, with no network and no flag: the envelope and the
fixed note; that the payload is the canonical JSON of its evidence; the terms hash, recomputed; each passkey's
signature, origin, rpId and user-verification flag; that each signature predates the export and the terms' expiry;
the policy version's form; each RFC 3161 token (its imprint, its signed attributes, the TSA certificate bound by the
signed ESS signing-certificate attribute and its chain, the signature); each JAdES signature with the certificate in
`x5c`, and the QC statements that certificate claims (ETSI EN 319 412-5: QcCompliance, QcSSCD, QcType esign). A test
changes each byte of an exported file in turn (one bit at a time, at every position), and every changed file is
refused.

What the verifier does **not** do: check any certificate against the **EU Trusted List**. It reads what a
certificate *claims*; anyone can write those claims into a certificate (the test mocks do). Each detail line says
so. A real QES must be validated against the Trusted List, for example with the European Commission's DSS library.

### Tier 3: a qualified electronic signature (only with a QTSP)

A **QES** is "an advanced electronic signature that is created by a qualified electronic signature creation device,
and which is based on a qualified certificate for electronic signatures" (art. 3(12)). The qualified certificate is
issued by a **qualified trust service provider** and meets Annex I (art. 3(15)); the device meets Annex II
(art. 3(23)). Since Regulation (EU) 2024/1183, a QTSP can manage the device on the signatory's behalf: a **remote
QSCD** (art. 3(23a)), as a qualified service under **art. 29a** ("Requirements for a qualified service for the
management of remote qualified electronic signature creation devices"); the Commission's implementing acts under
art. 29a(2) set the detail (we have not read them in full).

Purser's QES adapter is built for that remote case. It speaks the **Cloud Signature Consortium API v2** (v2.0.0.2):

1. `credentials/list` (with `credentialInfo`, the certificate chain and the auth info) picks the CFO's credential, one
   the service marks `signatureQualifier: "eu_eidas_qes"` and `key/status: "enabled"`;
2. `credentials/authorize` sends the one hash to sign, its algorithm, and the CFO's PIN or OTP (explicit mode). The
   service returns a **Signature Activation Data (SAD)** bound to that hash (SCAL 2);
3. `signatures/signHash` returns the signature. The service refuses a hash the SAD was not bound to ("Hash is not
   authorized by the SAD."), an expired SAD ("SAD expired"), and wrong authentication data. The tests check each
   refusal against the mock.

The hash the QTSP signs is SHA-256 of the JAdES signing input. Its payload holds the canonical terms and their SHA-256,
so the qualified signature covers **the same terms hash** the passkey signed. The authorization's description names
that terms hash, so the CFO's signing app can show it. The export verifies its own file before handing it back, and
refuses one whose signature does not verify.

**Status: built and tested against a mock CSC server; needs a QTSP account to run live.** No live QES has been made.

## 2. What a QES would mean legally

- **Art. 25(2):** "A qualified electronic signature shall have the equivalent legal effect of a handwritten
  signature." **Art. 25(3):** a QES based on a qualified certificate issued in one Member State "shall be recognised as
  a qualified electronic signature in all other Member States". This is EU law; outside the EU, national law decides.
- **What it changes for Purser.** Most internal payment approvals have no legal form requirement: an electronic
  signature is admissible evidence (art. 25(1)). A QES matters where a law or a contract requires a handwritten
  signature, or where the CFO's approval must carry the strongest evidential weight across the EU. It changes the
  evidence, never the payment: the passkey stays the gate for the money, and every money rule stays as it is.
- **Time-stamps.** A *qualified* electronic time-stamp "shall enjoy the presumption of the accuracy of the date and the
  time it indicates and the integrity of the data to which the date and time are bound" (art. 41(2)). The free public
  TSAs used in the live check are not known here to be qualified; a qualified one comes from a QTSP on the Trusted
  List (art. 42).
- **Long-term validity.** A signature has to stay verifiable after its certificate expires: JAdES-B-LT (validation
  data in `xVals`, `rVals`) and B-LTA (`arcTst`). Not built.

## 3. What Purser must still do for a live QES

1. **Choose a QTSP** that is on the EU Trusted List (browse it at `https://eidas.ec.europa.eu/efda/trust-services/browse/eidas/tls`)
   for "qualified certificates for electronic signatures" with a remote QSCD, and that exposes the **CSC API v2**
   (or write a second `QesAdapter` for its own API). Check that its credentials are SCAL 2 and its auth mode
   (`explicit` PIN/OTP, which the adapter supports, or `oauth2code`, which it does not yet).
2. **Contract.** A service agreement for the remote signing service and API access, its certificate policy, and a
   data-processing agreement (GDPR): the QTSP processes the CFO's identity data.
3. **Identity proofing of the CFO.** Before issuing a qualified certificate, the QTSP verifies the person's identity
   (art. 24(1), as amended by 2024/1183, lists the accepted ways, such as physical presence or electronic
   identification, including the European Digital Identity Wallet; read the article itself before choosing). This is
   done by the QTSP, not by Purser, and replaces Purser's own enrolment as the identification step.
4. **Cost.** QTSPs charge per signature, per certificate per year, or per subscription. Ask for quotes; no figure is
   given here. Under art. 5a(5)(g), the European Digital Identity Wallet must let natural persons sign with a QES
   free of charge by default, but Member States may limit that to non-professional purposes; a CFO signing for the
   company should not count on it.
5. **Validate a real signature against the Trusted List** (for example with the EU DSS library or the Commission's
   validation service) before calling any signature a QES in the product.
6. **Then** set `PURSER_EIDAS=on`, configure the adapter (`baseUrl` ending in `/csc/v2`, a service access token, the
   credential ID), and run one signature on test terms first.

## 4. How it fits Peppol

- **Peppol does not sign invoices document by document.** Peppol BIS Billing 3.0 is a profile of EN 16931 (UBL). The
  Peppol network carries invoices between Access Points over AS4, whose messages are signed with certificates from
  Peppol's own PKI, not with eIDAS qualified certificates. A QES is not needed to send or receive Peppol invoices.
  (Confirm the details with the Access Point provider chosen.)
- **VAT: integrity of an invoice.** Under the VAT Directive (2006/112/EC, art. 233 as amended by Directive
  2010/45/EU), a business ensures the authenticity of origin, integrity and legibility of its invoices, for example by
  business controls that create a reliable audit trail between an invoice and the supply; an advanced electronic
  signature and EDI are named as other means. Purser's approval evidence belongs to that audit trail on the payables
  side: it binds the CFO's approval to the exact terms, which carry the invoice's number and the SHA-256 of the
  invoice document.
- **Where the tiers meet Peppol.** A Peppol invoice arrives as UBL; Purser hashes it, the terms name that hash, the
  CFO approves the terms with the passkey, and the export bundles that approval as evidence; a QES, if chosen, signs
  that same evidence. Putting the UBL invoice's own hash into the terms for every Peppol invoice is not built yet.
- **ViDA.** Council Directive (EU) 2025/516 ("VAT in the Digital Age") makes structured EN 16931 e-invoicing the rule
  for intra-EU B2B supplies from 1 July 2030 (as we read secondary summaries; check the Official Journal text). It
  asks for structured invoices, not qualified signatures.

## 5. Running it

```sh
# off by default; the flag turns the export on (verification needs no flag)
PURSER_EIDAS=on npm run eidas:export -- docs/proof/try-paid.json            # a /try proof bundle (test money)
PURSER_EIDAS=on npm run eidas:export -- --proposal P-0001                  # a passkey approval from the runner's ledger
PURSER_EIDAS=on npm run eidas:export -- --proposal P-0001 --tsa https://freetsa.org/tsr   # with an RFC 3161 stamp
npm run verify-eidas -- P-0001.jades.json
```

The CLI makes no QES: the adapter is a library (`CscQesAdapter` in `src/eidas/csc.ts`, passed as `qes` to
`exportJades`), and it needs a QTSP account. The `--tsa` call is the only network call, and only when asked.

## 6. Limits, said once more

- The verifier checks no certificate against the EU Trusted List, and no revocation (OCSP, CRL).
- No JAdES-B-LT or B-LTA, no ASiC-E container, no PAdES or XAdES.
- The QES adapter was never run against a real QTSP.
- The passkey's identification of the CFO (art. 26(b)) is Purser's own enrolment, without an identity check.

## Sources (primary texts)

- Regulation (EU) No 910/2014 (eIDAS), art. 3(9)–(12), (14), (15), (22), (23), (33), (34); art. 25; art. 26; art. 41;
  as adopted (EU text, via legislation.gov.uk's "as adopted" copy) and as amended by **Regulation (EU) 2024/1183**
  (art. 3(23a), art. 5a(5)(g), art. 29a), EUR-Lex `https://eur-lex.europa.eu/eli/reg/2024/1183/oj`.
- ETSI TS 119 182-1 V1.2.1 (2024-07), *JAdES digital signatures; Part 1: Building blocks and JAdES baseline
  signatures*: clauses 5.1.7 (x5t#S256), 5.1.9 (crit), 5.1.11 (iat), 5.2.3 (srCms), 5.3.1 (etsiU), 5.3.4 (sigTst),
  5.4.3.3 (tstContainer), 6 (baseline levels).
- ETSI EN 319 132-1 (XAdES) for the commitment-type URI; ETSI EN 319 142 (PAdES) and EN 319 182 (JAdES, the EN) are the
  sibling formats, not used here.
- ETSI EN 319 412-5 (QC statements in certificates).
- Cloud Signature Consortium, *Architectures and protocols for remote signature applications* (CSC API) v2.0.0.2:
  clauses 7.2 (base URI), 8.3 (explicit authorization), 11.4 (credentials/list), 11.6 (credentials/authorize),
  11.10 (signatures/signHash, including the errors "Hash is not authorized by the SAD." and "SAD expired").
- IETF RFC 3161 (time-stamp protocol), RFC 5816 (ESSCertIDv2), RFC 5652 (CMS), RFC 7515 (JWS), RFC 8785 (JCS).
- EU Trusted List: browser `https://eidas.ec.europa.eu/efda/trust-services/browse/eidas/tls`; machine-readable list of
  lists `https://ec.europa.eu/tools/lotl/eu-lotl.xml`.
- Council Directive 2006/112/EC, art. 233 (as amended by Directive 2010/45/EU); Council Directive (EU) 2025/516 (ViDA).

**Not legal advice.**
