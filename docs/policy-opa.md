# Purser's CFO policy in OPA (Rego)

Back to the [docs index](README.md). The policy itself, in Purser's words: [cfo-policy.md](cfo-policy.md).

## What it is

For a team that has standardised on [Open Policy Agent](https://www.openpolicyagent.org/), [`policy/purser.rego`](../policy/purser.rego)
states Purser's deterministic payment decisions in Rego (package `purser.policy`, OPA v1 syntax). Load it into the OPA
you already run, next to your other policies, and ask it what Purser would decide about a payment.

It is an export, not a second engine. **Purser still enforces in its own code and at the rails**, whatever OPA
answers: Purser never reads the Rego, and changing a rule in it changes nothing Purser does. What ties the two together
is a test: [`test/policy-rego.test.ts`](../test/policy-rego.test.ts) runs every case through Purser's own code and through
`opa eval`, and requires the same outcome and the same reason code on each. It runs in CI on every change (the `test`
job downloads a pinned OPA release and checks its SHA-256 first); with `CI` set, a missing `opa` fails it.

At the time of writing it holds them equal on **23,459 cases**, every one identical:

| Cases | Where from |
|---|---|
| 67 | The Payer's eval corpus (`src/evals/apAgentCases.ts`), each with code's own plan, a proposal to pay today, every rail and the due date |
| 19,979 | Every case of the held-out adversarial evals v2 to v17, as a reader hands the fields over and as Purser's own parser reads the document, with the same proposals |
| 3,413 | Generated: every limit and one cent either side (the limit to pay alone, each cash floor with and without money already spoken for, what one payout carries, the Airi rail's limit and hard cap, the count per day), a limit in another currency, a rail in another currency, a currency with no quote, every merchant allowed and not, every day boundary (before today, the due date, one day after, the latest the policy allows and one after, leap days, the year 9999), amounts code cannot read, and a seeded sweep of 1,500 combinations |

The test also checks that the Rego passes `opa check --strict`, that the cases reach every outcome and reason, that a
company's policy works from `data.json` as well as from the input, and that the bundle `npm run policy:rego` writes loads.
Changing one comparison in the Rego (`>` to `>=` at the limit to pay alone, `<` to `<=` at a floor, 3,651 days late
allowed instead of 3,650, `>=` to `>` on the count per day) fails it.

## What it decides

`data.purser.policy.decision` returns `{"outcome": ..., "reason": ...}`, the outcome one of `pay` (runs without a
person), `ask_cfo` (the CFO signs the exact terms with the passkey), `hold` (nothing is paid until a person has looked)
or `refuse`, and the reason Purser's own code for the rule that decided (`null` to pay).

| `input.kind` | Purser's code it restates | Outcomes | Reasons |
|---|---|---|---|
| `supplier_payment` | The Payer's boundary on a supplier invoice, `enforceProposal` in `src/ap/payerCore.ts`, with the limit rule of `src/ap/checkerCore.ts` | pay, ask_cfo, hold | `above_alone_limit`, `no_alone_limit`, `alone_limit_other_currency`, `rail_not_accepted`, `rail_limit`, `after_due_date`, `pay_date_past`, `pay_date_invalid`, `pay_currency_not_available`, `fx_quote_ended`, `not_enough_money`, `below_floor`, `amount_unreadable`, `invalid_proposal`, `position_unreadable` |
| `agent_purchase` | An agent's purchase on the Airi rail, `decideAiriPurchase` in `src/airi/purchase.ts` | pay, ask_cfo, refuse | `PURSER_MERCHANT_NOT_ALLOWED`, `PURSER_CURRENCY_NOT_ALLOWED`, `PURSER_ABOVE_HARD_CAP`, `PURSER_AMOUNT_INVALID`, `PURSER_ITEMS_TOTAL_MISMATCH`, `PURSER_MERCHANT_URL_INVALID`, `above_alone_limit`, `alone_per_day_used` |
| `pay_alone` | Whether an amount is within the CFO's limit to pay alone, `aloneDecision` in `src/policy/withinLimit.ts` (proven in `formal/dafny/Limit.dfy`) | pay, ask_cfo | `not_within`, `no_limit` |

Every amount is a two-decimal string and every sum is in integer cents, as in Purser; days are whole calendar days.

## How to run it

Write the bundle for a company's policy (the shape is [`policy/example-policy.json`](../policy/example-policy.json):
the limit to pay alone, the cash floors, whether an invoice may be paid late, and the Airi rail's policy):

```sh
npm run policy:rego -- policy/example-policy.json --out opa-bundle
```

It writes `opa-bundle/purser.rego` (the rules), `opa-bundle/data.json` (the policy's values, at `data.purser.cfo`) and a
`.manifest` whose revision is the SHA-256 of the two. Build an input with `exportRegoInput(policy, payment, context)`
from `src/policy/rego.ts` and ask OPA:

```sh
opa eval --format json -b opa-bundle -i input.json 'data.purser.policy.decision'
```

An input that carries its own `policy` uses that one instead of `data.json`, which is how the test runs thousands of
policies in one batched `opa eval`. To run the equivalence test yourself, put `opa` on `PATH` (or set `OPA_BIN`) and
run `npx vitest run test/policy-rego.test.ts`; without `opa` it is skipped locally with the reason.

## The honest limits

- **Deterministic policy only.** The Rego covers the three decisions above and nothing else. Passkey signatures, the
  hash over the exact terms, the CFO's approval, two-key and four-eyes approval, the emergency stop, pause and velocity
  stops (read from the ledger), the mandates on chain, the card controls at Airwallex and every rail's own checks are
  not in Rego: Purser and the rails enforce them, and OPA cannot see them.
- **No model steps.** The Checker's and the Payer's Claude calls are not in Rego. The Payer's proposal is an input to
  `supplier_payment`: OPA decides what happens to a proposal, as Purser's boundary does, whoever wrote it.
- **The invoice checks are not exported.** The Checker's findings on an invoice (a duplicate, a blocked payee, a changed
  account, a lookalike name, an injected instruction) read the document's text with Unicode normalisation and
  lookalike tables that Rego cannot reproduce exactly; they stay in `src/ap/checkerCore.ts`. In the Rego, the payee
  checks are the supplier's accepted rails (`rail_not_accepted`) and the Airi rail's merchant allowlist.
- **One step is the exporter's.** Rego has no URL parser, so `exportRegoInput` gives OPA the merchant's https origin,
  parsed by the same WHATWG URL parser Purser uses; the Rego compares it with the allowlist.
- **The input's shape.** Equivalence is tested over inputs in the shape `exportRegoInput` writes (amounts as strings,
  the case's objects present). A field of another JSON type than Purser's types allow (an amount as a number, a list
  where a date belongs) is outside what the test covers.
