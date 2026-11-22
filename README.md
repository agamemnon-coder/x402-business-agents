<div align="center">

<a href="https://kit11.max-31b.workers.dev/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/purser-mark-dark.svg"><img src="docs/assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>

# Purser · AI agents spend. You sign off.

[![CI](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain)&nbsp;[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16923/badge)](https://www.bestpractices.dev/projects/16923)&nbsp;[![Airwallex: sandbox](https://img.shields.io/badge/Airwallex-sandbox-ff6b35?style=flat-square&labelColor=1f2937)](https://kit11.max-31b.workers.dev/airwallex)&nbsp;[![Alta (formerly Metal): testnet](https://img.shields.io/badge/Alta_%28formerly_Metal%29-testnet-0d9488?style=flat-square&labelColor=1f2937)](https://kit11.max-31b.workers.dev/alta)&nbsp;[![Visa via Airi: sandbox](https://img.shields.io/badge/Visa_via_Airi-sandbox-1a1f71?style=flat-square&labelColor=1f2937)](https://kit11.max-31b.workers.dev/visa)&nbsp;[![T:0: sandbox ledger](https://img.shields.io/badge/T%3A0-sandbox_ledger-475569?style=flat-square&labelColor=1f2937)](https://kit11.max-31b.workers.dev/books#t0)&nbsp;[![Test money only](https://img.shields.io/badge/money-test_only-ca8a04?style=flat-square&labelColor=1f2937)](#built-with)

**AI agents pay your suppliers. Above their limit, you sign the exact terms with your passkey: one changed cent and the approval no longer matches the terms.**

[![Tests: from docs/assets/test-summary.json](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fassets%2Ftest-summary.json&query=%24.passed&label=tests%2C%20last%20full%20run&suffix=%20passing&color=16a34a&style=flat-square&labelColor=1f2937)](docs/assets/test-summary.json)&nbsp;[![Coverage: from docs/badges/coverage.json](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fbadges%2Fcoverage.json&style=flat-square&labelColor=1f2937)](docs/evidence/coverage.md)&nbsp;[![Claude: 111 decisions, 20 Nov long run](https://img.shields.io/badge/Claude-111_decisions%2C_20_Nov_long_run-d97757?style=flat-square&labelColor=1f2937)](docs/runs/2026-11-20-long-run.md)&nbsp;[![CodeQL](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql)&nbsp;[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb?style=flat-square&labelColor=1f2937)](LICENSE)&nbsp;[![REUSE 3.3: compliant](https://img.shields.io/badge/REUSE_3.3-compliant-16a34a?style=flat-square&labelColor=1f2937)](REUSE.toml)&nbsp;[![Releases: Sigstore-signed](https://img.shields.io/badge/releases-Sigstore--signed-7c3aed?style=flat-square&labelColor=1f2937)](docs/security/README.md#verify-a-release)&nbsp;[![TLA+ model: 1,102,845 states, 0 errors](https://img.shields.io/badge/TLA%2B_model-1%2C102%2C845_states%2C_0_errors-16a34a?style=flat-square&labelColor=1f2937)](docs/evidence/formal-model.md)&nbsp;[![Dafny: verified](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/agamemnon-coder/x402-business-agents/main/docs/badges/dafny.json&style=flat-square)](docs/evidence/formal-proofs.md)&nbsp;[![Held-out eval v17, offline: 14 → 0 wrong payments](https://img.shields.io/badge/held--out_eval_v17_%28offline%29-14_%E2%86%92_0_wrong_payments-16a34a?style=flat-square&labelColor=1f2937)](docs/evals/adversarial-v17.md)&nbsp;[![MCP server: read, propose only](https://img.shields.io/badge/MCP_server-read%2C_propose_only-6366f1?style=flat-square&labelColor=1f2937)](#try-it-in-2-minutes)

<a href="https://kit11.max-31b.workers.dev/try"><picture><source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="docs/assets/readme/demo-narrow-dark.svg"><source media="(max-width: 600px)" srcset="docs/assets/readme/demo-narrow-light.svg"><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/demo-dark.svg"><img src="docs/assets/readme/demo-light.svg" alt="Animated, one recorded walk through /try (21 Nov, test money): invoice BTX-2026-21 from Bergtex Textil GmbH, EUR 1,850.00, comes in; Claude (claude-haiku-5-5) reads “Total due EUR 1,850.00”; Purser's checks pass (not paid before, bank on file, known supplier) and flag the amount as over 2× the usual EUR 870.00; above the agent's EUR 500.00 limit the CFO signs the SHA-256 of the exact terms with a passkey; paid, the Airwallex sandbox transfer PAID (settlement simulated). Then the same approval with one cent changed (EUR 1,850.01): refused, nothing paid. Over all the /try walks of 19 to 21 Nov: All 66 attempted one-cent changes refused." width="100%"></picture></a>

<a href="https://youtu.be/gEUm8RlhZac"><img src="docs/assets/readme/demo-thumb.jpg" alt="1 · Watch the demo: Purser on YouTube (3:15)" width="32%"></a>&nbsp;<a href="https://kit11.max-31b.workers.dev/try"><img src="docs/assets/readme/step-try.svg" alt="2 · Try it live: /try · your own test company · 2 min. “Approve & sign EUR 1,850.00 with Face ID” (the button on /try, recorded 21 Nov; test money)" width="32%"></a>&nbsp;<a href="https://kit11.max-31b.workers.dev/proof"><img src="docs/assets/readme/step-proof.svg" alt="3 · See the proof: /proof · every id, every record. “VALID · every check passes (11 of 11)” (/verify on the walk’s proof file, 21 Nov; test money)" width="32%"></a>

**1 · [Watch the demo (3:15)](https://youtu.be/gEUm8RlhZac)** &nbsp;·&nbsp; **2 · [Try it live on /try](https://kit11.max-31b.workers.dev/try)** (2 min, test money) &nbsp;·&nbsp; **3 · [See the proof on /proof](https://kit11.max-31b.workers.dev/proof)**

| Sponsor track | What ran live (test money) | Record |
|---|---|---|
| **Airwallex** (sandbox) | Main run, 3 Nov: an agent's EUR 240.00 SWIFT payment; Airwallex's own transfer record carries the hash of the exact terms the CFO signed (`metadata.approval_sha256`, read back 6 Nov) | [transfer record](docs/runs/airwallex-transfer-approval-2026-11-06.json) |
| **Visa** via Airwallex's Airi (sandbox, test card) | 14 Nov: EUR 45.00 above the CFO's limit, paid with a Visa credential bound to that one purchase, only after the CFO's passkey; reused, or for another amount, refused by Purser before any call | [run log](docs/runs/2026-11-14-vic-5.md) |
| **Alta (formerly Metal)** (testnet) | Main run, 3 Nov: x402 agents buy and sell data under on-chain mandates, 86 Alta payments; purchase #24, over its mandate, refused on chain by Alta itself | [run log](docs/runs/2026-11-03-main-run.md) |
| **T:0** (shared sandbox ledger) | 14 Nov: all 95 of the main run's journal entries read back from T:0, every account matching Purser's books to the cent | [read-back](docs/runs/2026-11-14-t0-readback.md) |

</div>

> [!IMPORTANT]
> **Test money only.** Live: calls to the Airwallex sandbox, Alta testnet, Visa via Airi (sandbox), the T:0 sandbox ledger and Claude. Simulated: the customer, the supplier, the merchants' charges, the settlement and the second approver.

**What it is:** the control layer between a company's AI agents and its money on Airwallex and Alta (formerly Metal): one engine runs agents that pay supplier invoices and agents that buy and sell data over x402, hence the repository's name, x402-business-agents, after Starter Kit 11 ("x402 Business Agents"), the hackathon brief it was built for.

<details><summary><b>Words used here</b></summary>

- **VIC, Airi:** Visa Intelligent Commerce (VIC) through Airwallex's Airi: an agent pays with a Visa credential from Airi that Purser binds to one purchase (sandbox, test card).
- **T:0:** an outside general ledger; Purser posts its books to T:0's shared sandbox entity and reads them back, account by account.
- **/try/sign:** the hands-on page at the submission tag, where you sign with your own passkey; today's [/try](https://kit11.max-31b.workers.dev/try) came after it.
- **Purser Cloud:** the console with the demo company's dashboard and books, its API, /try's engine and the MCP server, on Cloudflare Workers.

</details>

**For judges:** [JUDGES.md](JUDGES.md), one page: the 2-minute path, what is real and what is sandbox, how to verify, and the honest limits.

**What is not finished:**

- No independent security review yet: the OWASP ASVS Level 2 assessment is a self-assessment, and no third party has tested its security. ([docs/security/asvs-l2.md](docs/security/asvs-l2.md))
- No production money: the Airwallex sandbox, Alta testnet and Airi's test card only; test money throughout.
- No second human approver yet: one CFO passkey signs; where a run shows a second approver, it is simulated (a labelled test passkey).
- No customers: no pilots and no revenue yet.
- Before real money: every go-live requirement, with where it stands, is in [docs/go-live.md](docs/go-live.md).

## The proof

<a href="https://kit11.max-31b.workers.dev/proof"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/proof-strip-dark.svg"><img src="docs/assets/readme/proof-strip-light.svg" alt="From the records, test money: Airwallex sandbox; Alta (formerly Metal) testnet; Visa via Airi sandbox; T:0 sandbox ledger; Claude 111 decisions, live. 10,239 tests passing (20 Nov); 262 checks passed, 0 failed (20 Nov); 48 of 48 attacks stopped before money moved, 0 caught after (the red team's full re-run, 20 Nov, not held out, test world)." width="100%"></picture></a>

**Evidence wall, from the records:** All 60 soak payments read back · All 132 /try payouts PAID · All 894 forged copies refused · 71 Airwallex endpoints live · [every figure, with its record](https://kit11.max-31b.workers.dev/proof#evidence) · [the index of /proof's figures](docs/evidence/proof-index.md)

| **For judges:** the four things every entry shows, and where every id is | Check it |
|---|---|
| **User:** a CFO whose AI agents pay suppliers; above an agent's limit, the CFO signs | [/try](https://kit11.max-31b.workers.dev/try) · [for the CFO](docs/finance-value.md) |
| **Airwallex action:** a SWIFT transfer that carries the hash of the signed terms in `metadata.approval_sha256` (main run of 3 Nov, read back from Airwallex on 6 Nov) | [record](docs/runs/airwallex-transfer-approval-2026-11-06.json) |
| **Financial context:** the agent spends only what is available (balance − holds − payouts in flight), above a cash floor; FX buys only the shortfall | [available.ts](src/policy/available.ts) · [treasury.ts](src/policy/treasury.ts) |
| **Controls:** per-agent limits; a passkey over the exact terms; duplicates held; a payout that fails after PAID goes back to a person | [approvals.ts](src/policy/approvals.ts) · [euroBill.ts](src/agents/euroBill.ts) · [follow.ts](src/payouts/follow.ts) |
| **Proof:** one id per rail, and every run with its record, live or simulated | [one id per rail](docs/in-depth.md#what-ran-live-one-id-per-rail) · [every run](docs/runs/README.md) · [/proof](https://kit11.max-31b.workers.dev/proof) |

- **The agent trace, live:** on [/try](https://kit11.max-31b.workers.dev/try), each Claude call, its lookups and its decision, as the engine recorded them ([record](docs/evidence/try-agentic-2026-11-15/README.md)).
- **Agents negotiate:** on [/try](https://kit11.max-31b.workers.dev/try) (the Clean invoice) and [/try/negotiate](https://kit11.max-31b.workers.dev/try/negotiate), two Claude agents agree a deal; code holds the limits, you sign it ([the rails](src/negotiate/rails.ts)).
- **The newest held-out eval (v17, offline, test data):** 146 adversarial invoices, committed before they were first run (commit `d83b80a3b`). The blind run, with a model that always says pay, found 14 payments Purser's rules let through (none past the CFO; 88 with no rules), and 5 false holds of 67 clean invoices ([docs/evals/adversarial-v17.md](docs/evals/adversarial-v17.md), [the blind run](docs/evals/adversarial-v17.json)). Those 14 gaps are fixed: the same 146 cases now give 0 wrong payments and 0 false holds ([the rerun](docs/evals/adversarial-v17-after.json)). That rerun is no longer blind; the next held-out set (v18) is the real test.
- **Airwallex declines one cent over, live (15 Nov):** EUR 30.00 approved, EUR 30.01 declined, `LIMIT_EXCEEDED` (charges simulated; the decline is Airwallex's) ([record](docs/runs/airwallex-card-cent-2026-11-15.json)).
- **The Airwallex sandbox calls in the run records**, listed with what came back and its record: [/airwallex/calls](https://kit11.max-31b.workers.dev/airwallex/calls).
- **Verify it yourself:** [/verify](https://kit11.max-31b.workers.dev/verify) checks a /try payment in your browser; the newest live report, 20 Nov: 262 checks passed, 3 could not run here, 0 failed ([report](docs/evidence/verification-2026-11-20.md)).

**Kit 11, step by step.** The Kit 11 scenario, run live on 3 November. The brief's eight steps, what Purser does in each, and one proof each from that main run: [docs/kit11.md](docs/kit11.md).

**One engine, two jobs.** In the Kit 11 run, the agents Sourcing, Support and Treasury bought and sold data over x402 on Alta testnet; the payables agents (Reader, Checker, Coder, Payer) pay supplier invoices through Airwallex. Both run under the same CFO limits, the same passkey and the same books.

**What stood at the submission:** the tag `v1.0-submission` (8 Nov), Purser's entry to the Airwallex Agentic Banking Hackathon (entered for the Founder's Choice Award, the Judges' Choice Award, the Metal Award and the Visa Award), holds the Kit 11 main run of 3 Nov and /try/sign; the payables inbox (`src/ap/`), Purser Cloud and today's /try came after, with run records dated 10 to 17 Nov ([CHANGELOG.md](CHANGELOG.md), [v1.1 notes](docs/releases/v1.1-submission.md)).

## How it works

An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless.

| 1 · The agent asks | 2 · Code checks the limit | 3 · You sign the exact terms |
|---|---|---|
| A Claude agent proposes a payment: an invoice, a card charge, an x402 purchase. | Within the CFO's limits it pays alone; Airwallex and Alta hold the limit again. | Above them, the CFO's passkey (Face ID on iPhone) signs the SHA-256 of the exact terms. |

**Above your limit: not signed, never paid.**

```mermaid
flowchart LR
  I["Invoice or purchase<br/>(PDF, card, x402)"] --> RD["Reader<br/>Claude reads it"]
  RD --> CK["Checker<br/>Purser's code: duplicates,<br/>bank details, payee"]
  CK --> PO{"CFO policy<br/>(code, also exported<br/>as OPA/Rego)"}
  PO -- "within the agent's limit<br/>e.g. EUR 120.00" --> PAY["Agent pays alone"]
  PO -- "above it<br/>e.g. EUR 1,850.00" --> FID["CFO signs the SHA-256<br/>of the exact terms<br/>(passkey, Face ID)"]
  FID --> HC{"Before paying:<br/>terms still match<br/>the signed hash?"}
  HC -- "yes" --> PAY
  HC -- "one cent changed" --> X["Payment refused.<br/>Nothing was paid."]
  PAY --> RAIL["Rails, each with its own limit<br/>Airwallex sandbox · Alta testnet<br/>· Visa via Airwallex Airi"]
  RAIL --> BK["Books<br/>T:0 · Moneybird (sandboxes)"]
  BK --> LOG["Hash-chained audit log"] --> ANC["Head anchored on Alta testnet<br/>npm run verify-all"]
```

- **A passkey signs the exact terms.** The approval is a signature over the SHA-256 of the terms; change one cent and it no longer verifies. The owner's real approval of 7 November is checked offline by `npm run verify-approval` ([record](docs/runs/2026-11-07-awx-1.md)).
- **Limits are enforced in 3 layers: Purser's code, Airwallex's card controls and Alta's on-chain mandate.** Airwallex itself declined an agent's card over the CFO's limit ([record](docs/runs/2026-11-07-awx-1.md)); Alta refused a purchase over the mandate on chain ([record](docs/runs/2026-11-03-main-run.md)). The mandates: [/api/metal/mandates](https://kit11.max-31b.workers.dev/api/metal/mandates), a live read from Alta testnet, or the recorded 12 Nov snapshot when the chain does not answer (the answer says which).
- **The audit chain is anchored on chain.** Every event goes into a hash-chained log; its head is in a value-0 Alta testnet transaction, and `npm run verify-anchor` prints MATCH ([record](docs/runs/2026-11-13-anchor.md); run live again on 15 Nov: MATCH, [record](docs/runs/2026-11-15-anchor-verified.md)).

**Run live on test money** (Alta testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude): the main run of 3 November (24 decisions by Claude, 86 Alta payments, 16 stops, nothing paid over a limit) and 37 live runs through 21 Nov, every id on [/proof](https://kit11.max-31b.workers.dev/proof), every figure on its [evidence wall](https://kit11.max-31b.workers.dev/proof#evidence).

Airwallex's AgentOS says its "components do not initiate money-out actions (transfers, FX conversions, or payouts) on
your behalf" ([docs](https://www.airwallex.com/docs/developer-tools/ai/agentos), read 13 November 2026). Purser is the control layer for when agents do move money on Airwallex: within limits the CFO signs, and above them only with the CFO's passkey on the exact terms.

<details><summary><b>One payment, step by step</b>: the sequence, from the agent to Airwallex</summary>

The approval path in [src/policy/approvals.ts](src/policy/approvals.ts) and the Airwallex transfer in [src/airwallex/adapter.ts](src/airwallex/adapter.ts):

```mermaid
sequenceDiagram
  participant A as Agent (Claude)
  participant P as Purser rails (code)
  participant C as CFO passkey
  participant X as Airwallex / Alta
  A->>P: proposes a payment: the exact terms
  P->>P: checks the CFO's limits
  Note over P: above the limit: a proposal with the SHA-256 of the terms
  P->>C: asks the CFO to approve those terms
  C->>P: signs the SHA-256 of the exact terms (WebAuthn)
  P->>P: before paying: do the stored terms still hash to the signed hash?
  alt the terms as signed
    P->>X: pays, the transfer carrying the signed hash (approval_sha256)
    X-->>P: Airwallex's record of the transfer carries the hash
  else one cent changed after signing
    P--xA: refused: the terms do not match the approved hash
  end
```

</details>

<details><summary><b>Architecture</b>: the whole system, the four layers, where it runs</summary>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/system-map-dark.svg"><img src="docs/assets/readme/system-map-light.svg" alt="Purser's whole system in six zones, left to right: who uses it, the surfaces, the Claude agents, the rails in code, the money rails on test money, and the proof and books; dots follow one payment from a visitor through /try, the Reader, the Checker, the CFO policy and the passkey to Airwallex and the proof files, and a red dot takes a changed cent to Refused" width="100%"></picture>

*The whole system at a glance: everything here is built and runs on test money; open the image for full size.*

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/architecture-dark.svg"><img src="docs/assets/readme/architecture-light.svg" alt="Purser in four layers: the CFO and company, the Purser engine, the payment rails and the proof, with the path of one payment" width="100%"></picture>

- **CFO & company:** /try, the Purser Cloud console and /verify; the CFO's passkey signs the SHA-256 of the exact terms.
- **Purser engine:** Claude agents propose (Reader, Checker, Sourcing, Support, Treasury); the CFO policy, the terms hash and the hash-chained audit log decide in code. One cent changed: refused.
- **Payment rails:** the Airwallex sandbox (cards, transfers, FX), Alta testnet (a mandate per agent) and Visa Intelligent Commerce via Airwallex Airi; each holds its own limit.
- **Proof:** the log's head anchored on Alta, the T:0 read-back, proof files anyone can check, `npm run verify-all`.
- **Where it runs:** two Cloudflare Workers with Durable Objects and D1; keys are Worker secrets; deployed by hand with wrangler, while CI only checks ([docs/architecture.md](docs/architecture.md#where-it-runs)).

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/deployment-dark.svg"><img src="docs/assets/readme/deployment-light.svg" alt="Where Purser runs: the browser with the passkey, two Cloudflare Workers, the test rails and models outside, and CI" width="100%"></picture>



</details>

<details><summary>Where each part lives in the code</summary>

| Path | What it does |
|---|---|
| `src/claude/reader.ts`, `src/ap/read.ts` | The Claude reader (Haiku, Sonnet, Opus) and the Reader of invoices |
| `src/ap/checkerAgent.ts` | The Checker: pay, ask the CFO, hold or reject; code enforces it |
| `src/agents/` | Sourcing, Support, Treasury and the other agents |
| `src/policy/rules.ts`, `src/policy/cardRules.ts` | The CFO policy, and its limits as Airwallex card controls |
| `src/lib/terms.ts`, `src/policy/approvals.ts`, `src/passkey/` | The terms hash, the approvals, the passkey checks |
| `src/audit/log.ts` | The hash-chained audit log |
| `src/negotiate/` | The negotiation: two Claude agents, rails in code |
| `src/airwallex/`, `src/metal/`, `src/airi/` | The rails: Airwallex sandbox, Alta testnet, Visa via Airi |
| `src/anchor/`, `src/accounting/t0.ts`, `src/proof/bundle.ts`, `src/cli/verifyAll.ts` | The anchor, T:0, the proof file, verify-all |
| `worker/wrangler.jsonc` | Worker kit11: the site, the relay, the Airwallex entrypoints |
| `cloud/wrangler.try.jsonc` | Worker purser-try: the console, /try's engine, /mcp, D1 |
| `.github/workflows/ci.yml` | CI: tests, browsers, secrets scan, security; no deploy |

</details>

<details><summary><b>Invariants</b>: what holds even if the AI is wrong</summary>

| Invariant | How the code holds it |
|---|---|
| **Intent integrity** | The passkey signs the SHA-256 of the canonical terms (keys sorted, money as decimal strings); one changed cent fails the check before any rail is called ([src/policy/approvals.ts](src/policy/approvals.ts)). |
| **No keys for agents** | Claude agents and the MCP server read and propose; they hold no payment credentials and cannot approve. |
| **No double payment** | A payout's request_id is fixed before payment; a lost answer is resolved by looking that id up, never by a blind resend ([src/executors/invoicePayment.ts](src/executors/invoicePayment.ts)). |
| **Tamper-evident log** | Every decision is hash-chained, and the chain's head is anchored on Alta testnet (`npm run verify-anchor`). |
| **The payee's bank checks the name** | Before a new supplier or changed bank details reach the CFO, Airwallex's account verification (`POST /beneficiaries/verify_account`) must match: a mismatch is refused, a partial match held (live, 12 Nov: [run](docs/runs/2026-11-12-airwallex-payee-check.md)). |
| **Money spoken for before it moves** | Available = balance − holds − payouts under way, the same everywhere, so two payments never count on the same euro ([src/policy/available.ts](src/policy/available.ts)). |
| **A payout that comes back** | PAID is not final at Airwallex: a `payout.transfer.failed` webhook gets the payout read again; the invoice goes to a person, the books take the payment back (the fee stays, Airwallex keeps it), and nothing is sent again under the old approval ([src/payouts/follow.ts](src/payouts/follow.ts)). Sandbox, 17 Nov: two PAID payouts failed by the simulation endpoint, a read of each in place of the webhook; both invoices went to a person, nothing was sent again ([record](docs/runs/2026-11-17-airwallex-late-failure.json)). The books taking a payment back: tested only. |

</details>

<details><summary><b>What the code enforces</b>, and who enforces it (tested on test money)</summary>

| Guarantee | Enforced by | Evidence |
|---|---|---|
| Beyond the limits, money moves only on the CFO's signature over the exact terms. | Purser's code + the CFO | [Passkey decisions](https://kit11.max-31b.workers.dev/proof#faceid) |
| An agent's card cannot spend over the CFO's limit. | Airwallex | [Airwallex's own decline](https://kit11.max-31b.workers.dev/airwallex#awx-1-steps) |
| A Visa card purchase above the limit waits for the CFO's passkey. | Purser's code + the CFO | [The Airi runs](https://kit11.max-31b.workers.dev/visa) |
| An agent cannot pay past its on-chain budget. | Alta (on chain) | [A refusal on chain](https://kit11.max-31b.workers.dev/alta) |
| An invoice is paid once. | Purser's code | [A renamed duplicate refused](test/invoice-duplicate-key.test.ts) |
| No key, token or credential reaches Claude. | Purser's code | [The test that checks it](test/adversarial.test.ts) |
| The record cannot be changed quietly. | Purser's code | [The offline verify](#verify-it-yourself-in-3-commands) |

</details>

## Built with

| Partner | What Purser uses | Live or simulated | Proof |
|---|---|---|---|
| **Airwallex** (sandbox) | agent cards and limits, FX, SWIFT payouts, its approval as a second lock, the payee name check | Sandbox, live calls; SWIFT settlement simulated through the sandbox's simulation API | [the card decline](docs/runs/2026-11-07-awx-1.md), [two locks](docs/runs/2026-11-12-airwallex-two-locks-paid.md), [name check](docs/runs/2026-11-12-airwallex-payee-check.md) |
| **Alta** (testnet) | a mandate per agent, x402 payments, limits changed only by two passkeys, the audit anchor | Testnet, live transactions, test money | [main run](docs/runs/2026-11-03-main-run.md), [two passkeys](docs/runs/2026-11-12-faceid-onchain.md), [series](docs/runs/2026-11-19-alta-series.md), [anchor](docs/runs/2026-11-19-anchor.md) |
| **Visa** Intelligent Commerce via Airwallex's Airi (sandbox, test card) | a Visa credential bound to one purchase; above the limit only after the CFO's passkey | Airwallex sandbox, live calls, test card; a headless browser typed the card into Airwallex's hosted page | [vic-3](docs/runs/2026-11-12-vic-3.md), [vic-4](docs/runs/2026-11-13-vic-4.md), [vic-5](docs/runs/2026-11-14-vic-5.md) |
| **Claude** by Anthropic | the agents' decisions (Haiku, Sonnet, Opus) and the invoice reader; code checks each | Live calls | [main run](docs/runs/2026-11-03-main-run.md), [/claude](https://kit11.max-31b.workers.dev/claude) |
| **T:0** (shared sandbox entity) | an outside ledger: the main run's 95 journal entries, checked against our books: every account to the cent, plus the entry count | Shared sandbox ledger, live calls, test balances | [posted](docs/runs/2026-11-10-t0-journal-sandbox.md), [read back](docs/runs/2026-11-14-t0-readback.md) |

No endorsement implied.

**Built on Airwallex.** Purser calls Airwallex's API for a card per agent with the CFO's limits (Issuing), FX quotes inside the signed terms, transfers that carry the hash the CFO signed, the payee's bank check, Airwallex's own approval as a second lock, and signed webhooks (the sandbox, test money: [docs/airwallex.md](docs/airwallex.md)).

The live FX quote in the signed terms, the sandbox transfer, the Cloud's Airwallex tab, the signed events and the agent cards: [docs/airwallex-centre.md](docs/airwallex-centre.md).

What the sandbox taught us: eight things we ran into in Airwallex's API, what we did about each, and what we would ask for ([docs/feedback-for-metal-and-airwallex.md](docs/feedback-for-metal-and-airwallex.md#airwallex)).

**Metal Award.** Each agent pays x402 under its own mandate on Alta testnet, and Alta refuses what is over it: in the main run of 3 November, 86 Alta payments and purchase #24 refused on chain ([tx](https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871), [run](docs/runs/2026-11-03-main-run.md)). On 12 November a passkey account with two owners (the CFO's passkey and a labelled test passkey) changed the mandate only when both signed, and Alta refused a payment over its cap ([record](docs/runs/2026-11-12-faceid-onchain.md), [diagram](docs/diagrams.md#3-the-mandate-on-alta-bound-refused-raised-revoked)). [/alta](https://kit11.max-31b.workers.dev/alta) · [docs/metal-award.md](docs/metal-award.md)

## Verify it yourself in 3 commands

The quick start: under 2 minutes, no keys. Needs Node.js 22.13+ (or 23.4+) and git. `npm ci` downloads packages from npm; after that, no network and no keys.

```sh
npm ci                       # under a minute: the exact versions in the lockfile
npm run judge -- --check     # about 5 s: every page in CHECK_PATHS built from the main run's record, offline
npm run verify-approval      # under 1 s: the owner's real passkey approval of 7 November, checked with Node's crypto
```

<p align="center"><img src="docs/assets/readme/refusal.webp" width="600" alt="Live on /try, test money: the CFO signs EUR 1,850.00 with a passkey and it is paid; one cent changed is refused"></p>

> [!NOTE]
> **Verify it yourself, offline:** `npm run verify-approval` checks the real approval; change one cent in a copy and `npm run verify-receipt -- tampered.json` says NOT VALID. Below, the real output of both.

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/terminal-verify-dark.svg"><img src="docs/assets/readme/terminal-verify-light.svg" alt="A terminal, animated: npm run -s verify-approval prints eleven ok checks and VALID for the owner's passkey approval of 7 November; then the amount is changed from 240.00 to 240.01 in a copy, and npm run -s verify-receipt -- tampered.json prints FAIL terms hash and NOT VALID. The real output, captured 15 Nov 2026; test money." width="100%"></picture>

<details><summary>What you should see (abridged)</summary>

```text
ok    /  200  63106 bytes
ok    /proof  200  138535 bytes
…
ok    signature          the ES256 signature verifies with the receipt's public key

VALID: docs/runs/2026-11-07-awx-1/receipt-P-0002.json
Proves: the holder of this public key signed exactly these terms, with the authenticator reporting user verification, on this site.
Does not prove: who holds the key, or that it was Face ID (no attestation is checked). A test world's terms: nothing real moved.
```

</details>

`npm run verify-receipt -- receipt.json`
checks any receipt of the same format. `npm run airwallex-trail` lists the Airwallex sandbox API calls in the run records it reads and re-checks, offline, that each transfer carries the hash the passkey signed (exit 1 on any mismatch; the same list is on [/airwallex/calls](https://kit11.max-31b.workers.dev/airwallex/calls)). Pay on [/try](https://kit11.max-31b.workers.dev/try), download the proof (JSON), and check it on [/verify](https://kit11.max-31b.workers.dev/verify) in your browser, or with `npm run verify-bundle -- purser-proof.json`: the same checks, the same code, no server ([samples](docs/proof/)).

The full suite, `npm test` (about 8 to 9 min on a laptop): **10239 tests passing**, 5 skipped, in 969 files (the last full run, on commit `c9cce6545`, 20 Nov 2026: [summary](docs/assets/test-summary.json)), on stand-ins for Airwallex, Alta and Claude. The skipped ones run only on local D1 (`npm run test:d1`). Two kinds of line in its output are expected noise, not failures: Node's "ExperimentalWarning: SQLite is an experimental feature" and "try-sign: a live agent call failed" (a test that checks the fallback when the model is down).

`npm run test-count` writes that count from the last full run; `npm run test:coverage` measures coverage per area. The coverage badge is from a separate, earlier coverage run on commit `7d42f9209` (10,229 passed, 6 failed, each fixed after it, 5 skipped: [coverage.md](docs/evidence/coverage.md)). CI runs these checks on every push, with CodeQL and gitleaks; the CI badge at the top shows the result of the latest run on main.

<details><summary><b>Where things are</b>: the folders</summary>

| Folder | What it holds |
|---|---|
| `src/` | Purser itself: the agents, the policy and its checks, the rails (Airwallex, Alta, Visa via Airi), the ledger |
| `cloud/` | Purser Cloud on Cloudflare Workers: the console, its API, /try and the engine |
| `worker/` | The public site's Worker (kit11): the pages and the relay for the dashboard and passkey approvals |
| `docs/` | The runs and their records (`docs/runs/`: ids, amounts, timestamps), the long description, security, claims |
| `test/` | The tests (`npm test`, vitest) and the browser checks (`test/browser/`) |
| `contracts/` | The Solidity contracts used on Alta testnet, with their ABIs |
| `examples/` | The Dispute desk, reusable by any seller on Alta |
| `scripts/` | Charts, changelog and other generators |

</details>

## Try it in 2 minutes

1. **Pay an invoice yourself:** [kit11.max-31b.workers.dev/try](https://kit11.max-31b.workers.dev/try). A test company of your own; Claude reads a sample invoice, you approve the exact terms with your own passkey, it is paid on a simulated bank and booked. Change what you signed: refused.
2. **Look around a company:** [Purser Cloud as a guest](https://purser-try.max-31b.workers.dev/), then *Try as guest*: the demo company's dashboard and books, read-only, made-up data, test money.
3. **Ask your own AI:** add the remote MCP server `https://purser-try.max-31b.workers.dev/mcp` and choose the demo company (public token `purser-demo-read-only`): ask "what's waiting for the CFO?". It reads; it cannot approve or pay ([Connect any AI](#more)). Everything else Purser connects to, each labelled: [Connect Purser to anything](docs/integrations/README.md).

**From code, the same question:** the TypeScript and Python clients ([sdk/typescript](sdk/typescript/README.md), [sdk/python](sdk/python/README.md)), no dependencies, run from a clone: not published to npm or PyPI. They take an API key with the read scope (the demo token works at /mcp only). Neither can approve.

```sh
git clone https://github.com/agamemnon-coder/x402-business-agents purser && cd purser
export PURSER_URL=https://purser.example.com
export PURSER_API_KEY=pck_...   # a key with the read scope; never in code
```

```ts
// quickstart.ts, in the clone: npx tsx quickstart.ts
import { Purser } from "./sdk/typescript/src/index.js";
const purser = Purser.fromEnv();
for (const i of await purser.listPayableInvoices())
  if (i.proposal?.status === "PENDING_APPROVAL") console.log(i.id, i.vendor, i.currency, i.total, "waits for the CFO");
```

```python
# quickstart.py, in the clone: python3 quickstart.py
import sys; sys.path.insert(0, "sdk/python")
from purser import Purser
purser = Purser.from_env()
for i in purser.list_payable_invoices():
    if (i.get("proposal") or {}).get("status") == "PENDING_APPROVAL":
        print(i["id"], i["vendor"], i["currency"], i["total"], "waits for the CFO")
```

## The business hypothesis

Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous); more in progress; no pilots, no revenue. Every line below is a hypothesis except the cited source.

- **The problem:** when an AI agent pays today, its limit lives in a prompt it can be talked out of, or in a month-end review that finds the money after it has left. ([problem.md](docs/business/problem.md#what-goes-wrong))
- **Who buys:** the finance team of a small company or scale-up that already banks with Airwallex and lets AI agents pay; the CFO uses it and decides. ([model.md](docs/business/model.md#who-buys-and-who-uses-it-hypothesis))
- **Pilot pricing:** Starter €49 a month (100 invoices, then €0.25 each); Business from €249 a month; a small fee per payout. A hypothesis. ([model.md](docs/business/model.md#pilot-pricing-hypothesis))
- **Why now:** Airwallex wrote on 5 October 2026 that agents moving money need limits enforced "through underlying infrastructure rather than prompts" ("Agentic banking starts with governance", source S1). ([problem.md](docs/business/problem.md#why-now-sourced))
- **Why Purser:** it builds on Airwallex's own card controls and Alta's mandates, and adds what sits on top: one CFO policy for card and chain, approvals signed over the exact terms, a hash-chained audit log. ([model.md](docs/business/model.md#risks-and-what-we-do-not-know))

**Why not Airwallex's own approvals?** Purser signs the exact terms with the CFO's passkey before the API call, enforces per-agent limits across Airwallex and Alta, and can additionally require Airwallex's approval workflow (`IN_APPROVAL` handled, [src/airwallex/approvals.ts](src/airwallex/approvals.ts)). Live in the sandbox, 10 and 12 Nov: Airwallex held a payout signed by a labelled test passkey `IN_APPROVAL` until the owner approved it in Airwallex's web app; then `PAID`, settlement simulated ([run](docs/runs/2026-11-12-airwallex-two-locks-paid.md)).

<details><summary><b>Questions judges ask</b></summary>

- **Can an agent bypass Purser?** Only routes connected to Purser are protected. An agent pays through the routes Purser governs (the company's Airwallex account, through Purser, and the agents' Alta mandates); a wallet, card or key it can reach outside Purser is not governed by it.
- **What is the moat if the code is open source?** The code is MIT: anyone may run it. What a company would pay for is the hosted service: the rails kept current with Airwallex and Alta, the CFO's policy, passkeys and audit log operated for it, and support. A hypothesis, not tested with customers.
- **Why not an existing spend or AP tool?** They control a person with a card, or review an invoice after it is paid. Purser sits before the payment for an AI agent: code holds the agent's limit, and above it the CFO signs the exact terms, which the rail then carries.
- **Why isn't this just Airwallex?** Purser runs on Airwallex and uses its own controls. It adds what sits on top for agents: one CFO policy across Airwallex and Alta, a passkey over the exact terms before the API call, and a hash-chained audit log.
- **Are you ASVS Level 2 certified?** No: the document is a self-assessment, not a certification and not an audit. Claude wrote it for the maintainer from the code, and nobody independent has verified it.
- **What does "all 48 attacks stopped" mean?** The red team's re-run of 20 Nov: our own scripted attacks, with no model, in a throwaway test world. All 48 were stopped before anything moved. It is an internal test, not an independent penetration test.
- **What does the one-cent test prove, and what not?** It proves that an approval signed over one set of terms is refused for any other: the amount changed by one cent after the CFO signed, refused on the signed hash before any transfer was made (test money, on /try). It does not prove who holds the passkey, that it was Face ID, or anything about a route outside Purser.

Also on [/security](https://kit11.max-31b.workers.dev/security#judge-questions).

</details>

## More

**[The demo (3:15)](https://youtu.be/gEUm8RlhZac)**, the video in the submission (its thumbnail is at the top) · test money only

Earlier videos: [the film, under the hood (3:29)](https://youtu.be/PNLuqhRzVfE) · [the trailer (1:30)](https://youtu.be/n3HLVGROJc4) · test money only

| Topic | In one line | Where |
|---|---|---|
| Gallery | The pages and the console, as screenshots | [docs/gallery.md](docs/gallery.md) |
| Visa Award | Purser's Visa Award entry: Visa Intelligent Commerce through Airwallex's Airi, sandbox | [docs/visa-award.md](docs/visa-award.md) |
| Enterprise | What a finance team gets beyond the demo, test money today | [docs/enterprise.md](docs/enterprise.md) |
| See it | The hands-on demo as a clip, and each page's first screen | [docs/see-it.md](docs/see-it.md) |
| How it works in 5 files | The five files that make a payment safe, and the policy's worst case | [docs/how-it-works.md](docs/how-it-works.md) |
| Proof in numbers | The charts, drawn from the run records | [docs/charts.md](docs/charts.md) |
| Connect any AI | Connect Claude or any MCP client to the demo company's books: it reads and proposes, never approves or pays | [docs/mcp.md](docs/mcp.md) · [docs/connect-any-ai.md](docs/connect-any-ai.md) |
| Connect to anything | Every way in or out, each with its honest label and a quickstart: payment rails, AI over MCP, the API and webhooks, no-code tools, accounting, Peppol, chat | [docs/integrations/README.md](docs/integrations/README.md) |
| Built after the kit | What was built after the kit (test environment, test money) | [docs/built-after-the-kit.md](docs/built-after-the-kit.md) |
| Who does what | Who built what, and what each partner runs | [docs/who-does-what.md](docs/who-does-what.md) |
| What's live, what's simulated | Every run, live or simulated, with its record (one column per rail in [Built with](#built-with)) | [docs/in-depth.md](docs/in-depth.md#whats-live-whats-simulated-run-by-run) |

- **Read:** [docs/in-depth.md](docs/in-depth.md) (each judging criterion, the live runs with every id, what is real and what is mock) · [docs/README.md](docs/README.md) (every doc, by reader) · [docs/diagrams.md](docs/diagrams.md) · [docs/claims.md](docs/claims.md) (every claim and its source) · [docs/runs/](docs/runs/) (every run log, dated) · [docs/controls.md](docs/controls.md) · [docs/security.md](docs/security.md)
- **Partners:** [docs/metal-award.md](docs/metal-award.md) and [docs/airwallex.md](docs/airwallex.md) (what Purser uses from each) · [The Visa TAP note](docs/submission/long-description.md#visa): built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov)
- **Run and build:** [docs/run-it.md](docs/run-it.md) (live, with sandbox keys and an Alta RPC) · [docs/payables.md](docs/payables.md) (the invoice inbox, built after the submission; code in [src/ap](src/ap)) · [skills/purser-spend/SKILL.md](skills/purser-spend/SKILL.md) (for outside agents) · [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)
- **Site:** [Hands-on demo](https://kit11.max-31b.workers.dev/try) (a test company of your own, test money) · [The replay of the main run of 3 November](https://kit11.max-31b.workers.dev/replay) (under Proof, not in the menu) · [/security](https://kit11.max-31b.workers.dev/security)
- **Releases:** [`v1.0-submission`](https://github.com/agamemnon-coder/x402-business-agents/releases/tag/v1.0-submission) (8 November, the hackathon submission) · [CHANGELOG.md](CHANGELOG.md) (every pull request since, generated from git) · [docs/releases/v1.1-submission.md](docs/releases/v1.1-submission.md) (the next tag, `v1.1-submission`)
- **Submission:** [docs/submission/README.md](docs/submission/README.md) (the submission text, with the short Description) · [docs/submission/long-description.md](docs/submission/long-description.md) (the long form text it replaced, in full)
- **Pilot or partnership:** **[Become a Founding Partner →](mailto:max.geurtsen@outlook.com)**

All money here is test money: the Airwallex sandbox and Alta testnet. Licence: MIT.
