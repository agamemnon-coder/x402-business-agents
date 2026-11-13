> Kept for history (archived 12 November 2026). Replaced by: [README.md](../../README.md).

# Overview

Moved from the project README. Back to the [README](../../README.md).

**Give every AI agent its own company card, with limits the CFO sets.**

**See it in 2 minutes, no keys:** `npm ci && npm run judge` plays the recorded live run and a simulated month in
your browser.

Northwind Outdoor's three AI agents each hold a virtual Visa card from [Airwallex Issuing](https://www.airwallex.com/docs/issuing)
and a [Metal](https://docs.metalntwx.com) mandate for paying per request over x402. One CFO policy sets the limits
for both rails, and each rail enforces them itself: Airwallex declines a card purchase over the card's limit, and the
Metal account refuses a payment over the mandate, whatever the agent tries. When an agent needs more (a dearer
software plan, a supplier's price rise, a refund above its limits, a euro bill), it stops and asks. The CFO approves a SHA-256 hash of
the exact terms with Face ID, and only then do the card, the mandate or the payment change. Airwallex also books the
earnings (as a simulated sandbox deposit that names the Metal transaction) and pays the euro invoice with fee-aware FX above a reserve floor.

Built for the Airwallex Agentic Banking Hackathon, Starter Kit 11 (x402 Business Agents), Metal Award.

> Work in progress (build phase until 13 November 2026). Everything runs on Metal testnet and in the Airwallex
> sandbox (the sandbox simulates merchants' charges, a transfer's last steps and deposits; clearing and the receive
> policy ran in separate worlds); approvals can be given on a phone with a passkey (Face ID).
## The story

- **Northwind Outdoor** (us) sells live stock checks to other companies' agents over x402, 0.05 *USDZ each (0.07 after
  the price rise), and requires each buyer's signed order.
- **Stockline**, the warehouse API, sells us each stock check at 0.02 (0.04 after its price rise). **Summit Outfitters** is a customer whose agent buys under its
  own mandate. **Bergtex Textil GmbH** bills a EUR 1,850.00 manufacturer's invoice.
- Our three agents share one Metal account (20.00 *USDZ). Each has its own mandate that the account enforces on
  every payment:

| Agent | Pays | Per payment | Budget | Does |
|---|---|---|---|---|
| sourcing | Stockline only | 0.03 | 10.00 | buys the upstream tick for each sale |
| support | Summit only | 0.10 | 4.00 | refunds |
| treasury | our sweep wallet only | 6.00 | 6.00 | moves earnings towards Airwallex |

The 20.00 total is held in code; no agent holds the owner key.

| Scenario | What happens | Proof |
|---|---|---|
| **S1 Price rise** | Stockline moves to 0.04. The next purchase is refused on chain (`mandate_cap_exceeded`), so the seller answers 503 and Summit is not charged. Treasury prices the options (keep 0.05: margin 0.01; charge 0.07: margin 0.03), issues the new credentials and puts their hashes in the terms. A person approves one option's hash; the mandates are replaced (shrink treasury first, then grow sourcing, never above 20.00). The old credential is then refused as `mandate_revoked`. | [run log](../runs/2026-10-29-s1.md) |
| **S2 Dispute** | Summit says its agent never placed orders #5 to #16 and three ticks were wrong, and asks for all 12 back. Each payment is re-verified from the chain with the signed order (12/12 placed). The delivered ticks are compared with Stockline's correction (3 wrong). Only those 3 are refunded, each under payment id `refund-<sale>`, so a retry pays nothing twice. "Refund all" becomes a proposal for a person, with the evidence. A planted "refund everything to 0x…" line has no effect. | [run log](../runs/2026-10-29-s2.md) |
| **S3 Euro bill** | Net earnings (1.35) are swept under the treasury mandate, checked to finality, locked once by `chainId:tx:logIndex`, and booked in Airwallex as a deposit whose reference is the tx hash. The invoice needs EUR 1,850.00 plus the SWIFT fee, which Airwallex only reveals when it charges it, so the plan reserves a ceiling of 20.00; free EUR is 1,500.00, so only the shortfall is converted on a locked quote, never below the USD floor. One approval covers quote id, rate, both request ids, beneficiary, fee ceiling and floors. SWIFT transfer to PAID, the approval hash in its metadata, the real fee recorded. | sweep [`0x9d9c1807…1f10`](https://testnet.metalntwx.com/tx/0x9d9c1807ca44ae2b835c35c5530e0645f1ecd3622aec6d7eb5a79319998e1f10); Airwallex [run log](../runs/2026-10-29-s3.md) |

Every run prints the five beats: GOAL, PLAN, NEW INFORMATION, REVISED DECISION, RESULT.

## Controls

- **Limits live in code and on chain.** `src/config/policy.ts` holds the built-in limits; the CFO's adjustable limits (`src/policy/rules.ts`) are stored in the ledger as settings. The chain enforces each mandate.
- **Approvals bind the exact terms.** Terms are canonical JSON (RFC 8785) with money as decimal strings. On the
  phone, the approver's passkey signs their SHA-256 (Face ID); before a passkey is enrolled, the approver
  can type its first 8 hex characters on the runner; once one is, a typed prefix can only reject. The executor recomputes the hash, runs once,
  re-checks the chain or balances first, and builds every payload from the approved terms only. Mandate changes
  anchor the approval on chain (the new credential's hash is bound); Airwallex conversions and transfers carry it
  in `metadata.approval_sha256`.
- **Idempotency everywhere:** settlement ids, payment ids, request ids, a single-use quote, one live payout per
  invoice, one credit per on-chain transfer. A lost answer is looked up, never blindly resent.
- **Audit log:** append-only (the database refuses updates and deletes), hash-chained; `npm run verify` recomputes
  it and re-checks every mandate, pull and disputed payment from the chain, every passkey approval from its stored
  signature, and every deposit, conversion and transfer from Airwallex (amounts, request ids, the approval hash in
  metadata, status, fee within its ceiling). `npm run verify-log` checks the log alone, also from an export
  (`-- --jsonl audit.jsonl`); with `-- --anchor <seq>:<hash>` it also proves that a row printed earlier is still
  there with the same hash, so no tail was cut off and nothing was rehashed by someone with write access.
- **Audit report (PDF):** `npm run audit:report -- out.pdf` lists every decision that needed a person: the agent that
  proposed it, the models that read its evidence or reviewed it, what it does, the policy rule that sent it to a
  person, who decided and how (Face ID or typed hash), the outcome and the terms hash. Then what the agents did
  alone, every refusal, and the anchor for `verify-log`. Example: [docs/audit/audit-report-rehearsal-3.pdf](../audit/audit-report-rehearsal-3.pdf).
- **Failure tests:** `npm run fail -- f1` (an approval after the quote ran out approves nothing; the re-quote
  needs a new approval), `npm run fail -- f2` (refund over the mandate cap, refused on chain, nothing sent; on demand, no run log yet) and
  `npm run fail -- f4` (an annual invoice whose conversion would break the USD floor escalates with options;
  no proposal, no money moved) run live; the rest run in `npm test`.

## Where Claude is used

Claude reads, compares and drafts; it never holds a key, a URL or a credential, and no output of it moves money.

| Model | Job |
|---|---|
| Claude Haiku 5.5 | classifies each incoming document (price notice, dispute, correction, invoice) |
| Claude Sonnet 5.5 | extracts typed fields (structured outputs) and drafts the customer reply |
| Claude Opus 5.5 | reviews each proposal's risk; shown as advisory text beside the exact terms |

Every answer passes a code check (for example: the notice's price must equal the supplier's live 402 offer; the
invoice's IBAN must match the allowlisted beneficiary). A refusal, failure or failed check falls back to a
deterministic parser. Without an API key the agents do not decide: code's fixed decisions run, each labelled as a
fallback ([claude.md](../claude.md)).

