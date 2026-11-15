# After the hackathon: the roadmap to real customer money

Nothing on this page is built yet. It is the plan for after the hackathon. Everything Purser does today runs on test money
(the Airwallex sandbox, Alta testnet). The accepted risks it starts from are in [security.md](security.md).

## Six infrastructure layers

| Layer | The accepted risk it removes | First step |
|---|---|---|
| The runner and its key signer in a trusted execution environment, with remote attestation (the key service releases keys only to the exact code measurement) | A compromised runner host, or an insider with write access to the database, could add a fake approval or reach the Airwallex and Alta keys | Run the deterministic runner in an enclave; keys released by attestation only |
| A native signer app on the phone, with hardware attestation checked against the FIDO Metadata Service | A compromised web relay could show one thing while the passkey signs another; software passkeys are accepted today | The phone parses the canonical terms itself ("what you see is what you sign"); only certified secure hardware keys are accepted |
| Threshold signatures (2-of-3) instead of a single owner key for on-chain mandates | One owner key for the mandates exists as a whole | Shard 1 in the attested runner, shard 2 behind the CFO's Face ID, shard 3 in cold recovery; no full key ever in memory |
| A Merkle-tree transparency log (the RFC 9162 design) | Today: a linear hash chain with periodic on-chain anchors; checking it means reading the log | Every invoice and refusal gets an inclusion proof, and every pair of anchors a consistency proof, checkable offline |
| Policies as code (Cedar), checked by a solver before the CFO signs | Large companies need approval matrices that can contradict each other or leave a gap | Each policy change is proven free of contradictions and back doors before the Face ID step |
| Portable agent mandates: a short-lived SD-JWT signed by the CFO's passkey, presented over RFC 9421 HTTP signatures | Today a mandate lives in Purser or on chain; an outside agent can't carry one | A supplier checks the agent's key, maximum amount and allowed categories before any card or bank payment starts |

## AI agents: built today, and the next step

| Agent | Built today (test money) | Next step |
|---|---|---|
| Policy from plain language | The CFO writes the policy in words, Claude turns it into rules, the CFO signs them with Face ID | Compile to Cedar and Airwallex card controls, with the solver check above |
| Negotiation between agents | `/try/negotiate`: Purser's Sourcing agent and a simulated supplier's agent; the rails refuse a mid-negotiation bank change | Agent-to-agent with real suppliers; the agreed terms as a signed mandate |
| Fraud check | Invoice-fraud (BEC) checks, hidden instructions flagged, a red-team agent, the 50-invoice worst-case test | A risk score per invoice: changed bank details at a known supplier, invoices split under the signature threshold |
| Treasury and FX | The Treasury agent buys only the currency it lacks; batch transfers; live Airwallex FX quotes | Timing of conversions and batches from cash-flow forecasts |
| Reconciliation and disputes | The dispute desk (Support refunds what it may, the rest goes to the CFO); light reconciliation | Short deliveries, small differences and returned transfers matched to their documents, a settlement proposal ready to sign |

## For the first customer

The first customer we want after the hackathon is a mid-sized company already on Airwallex, whose CFO signs the payments.
The two layers that fit them first are the native signer with hardware attestation ("what I see is what I sign") and
the policy compiler with the solver check ("my rules can't contradict each other"). The enclave and threshold signatures
matter most for banks and larger amounts.
