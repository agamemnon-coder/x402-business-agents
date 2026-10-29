# x402 Business Agents

Three AI agents run a pay-per-query data business from one [Metal](https://docs.metalntwx.com) testnet account,
each held to its own on-chain mandate. When a supplier raises its price, a customer disputes charges or a euro bill
falls due, they stop and propose a priced change, and a person approves a SHA-256 hash of the exact terms before
money moves. Airwallex books the earnings and pays the euro invoice with fee-aware FX above a reserve floor.

Built for the Airwallex Agentic Banking Hackathon, Starter Kit 11 (x402 Business Agents), Metal Award.

> Work in progress. Setup and demo instructions follow as the build lands.

## What is in place

| Part | Where | What it does |
|---|---|---|
| Money | `src/lib/money.ts` | Integer cents only; *USDZ base units (18 decimals) |
| Approval hash | `src/lib/terms.ts` | RFC 8785 JCS + SHA-256 over the exact terms; no JSON numbers allowed |
| Policy | `src/config/policy.ts`, `src/policy/` | Every limit in code: the 20.00 total, replace ordering, refund limits, EUR shortfall with the SWIFT fee, floors |
| Approvals | `src/policy/approvals.ts` | Proposal → approval (typed 8-hex prefix) → single-use execution guard |
| Ledger | `src/db/schema.sql` | SQLite with unique keys for every idempotent operation |
| Audit log | `src/audit/log.ts` | Append-only, hash-chained; the database refuses updates and deletes |
| Bootstrap | `src/cli/bootstrap.ts` | Idempotent: accounts, 20.00 *USDZ into B, four mandates bound live ([run log](docs/runs/2026-10-29-bootstrap.md)) |
| Airwallex | `src/airwallex/client.ts` | Sandbox-only client: token cache, one queue at ≤ 5/s, 429 backoff, lost answers reported as ambiguous |

```sh
npm install
npm test          # unit tests
npm run health    # Metal RPC, finality, x402 facilitator, Airwallex sandbox
```

## Built with Claude

This project is written with Claude (Anthropic) as the developer, directed and reviewed by Max Geurtsen.
In the product itself, Claude only reads documents and drafts proposals; money moves only through limits in code.

## Licence

MIT
