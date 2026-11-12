# Invoice tokens on Metal (prototype)

**Status: built and tested on an in-memory EVM only. Nothing has run on Metal testnet yet.** The live run is planned
with Max's go and a call budget: [the runbook](runs/driver/tokenize-runbook.md), and the form of
[its run record](tokenize-run-template.md). Test money only. The financier is simulated. This is not legal advice and
not a claim about how tokenized receivables are treated by any regulator.

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

Live, one step at a time, in this order: `preflight`, `fund`, `deploy`, `mint`, `finance`, `settle`, `verify`, then
`record`. [The runbook](runs/driver/tokenize-runbook.md) has the variables, what each command prints and how many
calls it needs.

```bash
npm run tokenize -- preflight   # no transaction, at most 6 reads; the offline checks, the plan, the calls per step
npm run tokenize -- fund        # creates the four test keys, sends each what it lacks from a donor key
npm run tokenize -- deploy      # then mint, finance, settle, verify
npm run tokenize -- record      # writes docs/runs/<date>-tokenize.md and .json from the run's ledger; no call
```

Each live command refuses without its guards (`src/tokenize/guard.ts`): Max's go, a call budget for the command and
one for the whole run, a call log, the run's own ledger, and the keys outside the repository. `npm run tokenize --
facts` prints the run's ledger at any time.

## The live run: nothing is sent twice

- **The hash first.** Each transaction is signed on this machine, and its hash and signed bytes are written to the
  run's ledger before it is sent.
- **A stopped step resumes.** Run the same command again. A transaction that finished is answered from the ledger
  with no call. One that was sent but has no receipt in the ledger gets its receipt read first. Only if there is none
  are the same signed bytes sent once more: same nonce, same hash, so they cannot run twice.
- **One contract per ledger.** `deploy` cannot deploy a second contract for the same run ledger.
- **A revert stops.** A transaction that reverted on chain is not sent again unless the operator says so. The new
  one then asks the node's estimate first, whatever its kind.
- **A refusal by the node stops at once.** When the node answers a send with an error, the command ends with its
  own exit code (4) and reads no receipt: offering the same bytes again would only spend calls. A send that got no
  answer at all (a dropped connection) is different: the re-run reads the receipt first.
- **The nonce is never below the ledger's.** A new transaction takes the node's pending count, or one more than the
  highest nonce of that sender's transactions with a receipt in the ledger, whichever is higher.
- **Two budgets.** Every request is counted against the command's budget and against the whole run's budget in the
  call log, before it goes out. A transaction is signed only when the send and one receipt read still fit. The
  ledger remembers which file its call log is and counts the requests itself: another file, or an emptied one, is
  refused, and the larger of the two counts is the run's total.
- **Keys.** Only `fund` creates a key. `deploy` refuses until the ledger shows the four roles funded.

## Gas

Gas on Metal testnet is paid in *USDZ at 1 wei per unit, so a high limit costs nothing. A limit that is too low
would waste a transaction, so each limit follows a path that already ran on Metal:

| Transaction | Limit | Why |
|---|---|---|
| Deploy, mint, offer, accept, settle (Purser's own contract) | The node's `eth_estimateGas` plus half, never below a fixed floor | Purser's contract runs on Metal ask the node the same way (`src/cli/passkeyOwners.ts`, `src/cli/compliancePolicy.ts`; they add a fifth). The floor is at least twice what the in-memory chain measures. An estimate that reverts stops the step before anything is signed. |
| Funding transfer (a direct call to *USDZ) | 200,000, fixed | The limit of Purser's working *USDZ transfers (`src/metal/chain.ts`). No estimate call. |
| The two approvals (direct calls to *USDZ) | 300,000, fixed | The limit of the approval in Purser's hold run (`src/metal/hold.ts`). No estimate call. |

The estimate costs one call per transaction of Purser's own contract: five in a run. `TOKENIZE_GAS=fixed` skips
them and sends each floor as the limit. Not yet shown on Metal: these transactions are plain EIP-1559 ones, where
Purser's working *USDZ calls use Metal's own transaction type. The first funding transfer shows whether a plain call
to *USDZ is accepted, before anything else is spent.

## Code

- **Contract:** `contracts/PurserInvoiceToken.sol`, built on OpenZeppelin 5.6.1 ERC-721 and SafeERC20. The committed
  artifact `contracts/PurserInvoiceToken.json` is rebuilt and compared in the tests. Compile with
  `npm run contracts:tokenize`.
- **Client:** `src/tokenize/client.ts` signs locally, writes each hash to the ledger before sending, resumes from the
  ledger, sets the gas limits, and runs behind the two call budgets.
- **Live commands:** `src/tokenize/live.ts`, with the guards in `src/tokenize/guard.ts`, the plan and call counts in
  `src/tokenize/plan.ts`, the keys in `src/tokenize/keys.ts` and the run's ledger in `src/tokenize/ledger.ts`.
- **Ledger checks:** `src/tokenize/record.ts`.
- **Steps:** `src/tokenize/flow.ts`.
- **Run record:** `src/tokenize/runRecord.ts`; the block on `/metal` is `src/redesign/tokenizeRun.ts`.
- **In-memory chain:** `src/tokenize/localChain.ts`, loaded only by the stand-in (`src/tokenize/standInRun.ts`) and
  the tests.
- **CLI:** `src/cli/tokenize.ts`.
- **Tests:** `test/tokenize.test.ts`, `test/tokenize-live.test.ts`, `test/tokenize-record.test.ts`.
