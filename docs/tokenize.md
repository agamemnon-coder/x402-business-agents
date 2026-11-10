# Invoice tokens on Metal (prototype)

**Status: built and tested on an in-memory EVM only. Nothing has run on Metal testnet yet.** The live run is planned
with Max's go and a call budget ([run record template](tokenize-run-template.md)). Test money only. The financier is
simulated. This is not legal advice and not a claim about how tokenized receivables are treated by any regulator.

## What it is

An invoice that Purser read and checked, and whose exact payment terms the debtor's CFO approved with a passkey
(Face ID), becomes one token on Metal. The CFO's approval is what makes the invoice worth financing: the debtor has
confirmed, with a signature anyone can check, that it owes this amount for this document.

```mermaid
sequenceDiagram
    participant CFO as Debtor's CFO (passkey)
    participant P as Purser (issuer key)
    participant T as PurserInvoiceToken (Metal)
    participant C as Creditor (supplier)
    participant F as Financier (simulated)
    participant D as Debtor's paying wallet
    CFO->>P: Face ID over the exact terms (ledger: approval by passkey)
    P->>P: check the approval, the terms hash and the document hash
    P->>T: mint(creditor, record): hashes and amounts only
    T-->>C: token
    C->>T: offerFinancing(financier, price)
    F->>T: acceptFinancing(price)
    T-->>C: price in *USDZ
    T-->>F: token
    D->>T: settle() on the due date
    T-->>F: face value in *USDZ (to whoever holds the token)
    T->>T: token burned; the invoice can never be tokenized again
```

## The steps

| Step | Who | What the chain checks |
|---|---|---|
| Mint | Purser's issuer key | Only the issuer mints. The token id is the document hash, so one document gives one token. A signed approval (terms hash) is used once. Zero or empty fields are refused. |
| Finance | Creditor, then financier | Only the holder offers, at most at face value. The financier pays exactly the price it saw: a changed price is refused. Any transfer cancels an open offer. |
| Settle | Debtor's paying wallet | Only the payer named at mint settles, once. The face value goes to the current holder and the token is burned. |
| Verify | Anyone with the ledger and the document | Recomputes every field (document hash, terms hash, amount, currency, face value, due date, both references, payer) and compares it with the chain. |

Before Purser signs a mint, `approvedInvoice` (`src/tokenize/record.ts`) refuses when:
- there is no approval, or it was a rejection;
- the approval was by anything but a passkey;
- the passkey signed other terms;
- the stored terms no longer hash to the signed hash;
- the proposal is not approved or executed.

`mintRecord` then refuses a document whose SHA-256 is not the one in the signed terms.

## What goes on chain

| Field | Value |
|---|---|
| `documentHash` | SHA-256 of the invoice document |
| `termsHash` | SHA-256 of the terms the CFO signed |
| `amountMinor`, `currency` | The invoice's own amount in cents and ISO 4217 code (e.g. 24000, EUR) |
| `faceValue` | What settlement pays, in *USDZ base units |
| `dueDate` | From the document's "Due date:" line, as unix seconds (UTC) |
| `debtorRef`, `creditorRef` | HMAC-SHA-256 of the party's name with a salt kept in the run's own ledger. Without the salt, a name cannot be guessed from the chain. |
| `payer` | The debtor's paying wallet address |

No names, invoice numbers, bank details or addresses go on chain. A test checks the mint's calldata for each of them.

## What is simulated or simplified

- **The financier is a test key.** There is no real financier, pricing model, recourse or KYC.
- **The face value is scaled.** On testnet the face value is the invoice amount divided by a whole number (default 100):
  EUR 240.00 settles as 2.40 *USDZ. It is test money with no exchange rate. The chain keeps the invoice's real amount
  and currency next to it.
- **Settlement is in *USDZ.** It is not EUR, and no real money moves.
- **The token is not a legal assignment of the claim.** It records it, and nothing more.
- **The stand-in passkey is not a phone.** It is a labelled virtual test passkey. A live run can use an invoice the
  CFO approved with real Face ID.

## Run it

```bash
npm run tokenize -- stand-in
```

The stand-in runs on an in-memory EVM (ethereumjs, cancun, chain id 63825) with a *USDZ stand-in token. It uses the
same contract bytecode and the same locally signed transactions as a live run, and makes zero network calls. It
mints, finances at a 2% discount, settles and verifies. It then shows five refusals: a second settlement, a second
mint, a mint by a key that is not the issuer, an invoice with no passkey approval, and a changed document.

Live, one step at a time (each command refuses without its guards, `src/tokenize/guard.ts`):

```bash
TOKENIZE_GO=yes TOKENIZE_CALL_BUDGET=10 TOKENIZE_CALL_LOG=… TOKENIZE_DB=…/tokenize-1.sqlite npm run tokenize -- deploy
```

The commands run in this order: `deploy`, `mint`, `finance`, `settle`, `verify`. `mint` and `verify` also need
`TOKENIZE_SOURCE_DB` (the ledger with the passkey approval, opened read-only), `TOKENIZE_PROPOSAL` and
`TOKENIZE_DOCUMENT`. `npm run tokenize -- facts` prints this run's ledger: the transaction hashes, each stored before
it was sent.

## Code

- **Contract:** `contracts/PurserInvoiceToken.sol`, built on OpenZeppelin 5.6.1 ERC-721 and SafeERC20. The committed
  artifact `contracts/PurserInvoiceToken.json` is rebuilt and compared in the tests. Compile with
  `npm run contracts:tokenize`.
- **Client:** `src/tokenize/client.ts` signs locally, hands each hash to the ledger before sending, uses fixed gas
  limits, and runs behind a call budget.
- **Ledger checks:** `src/tokenize/record.ts`.
- **Steps:** `src/tokenize/flow.ts`.
- **In-memory chain:** `src/tokenize/localChain.ts`.
- **CLI:** `src/cli/tokenize.ts`.
- **Tests:** `test/tokenize.test.ts`.
