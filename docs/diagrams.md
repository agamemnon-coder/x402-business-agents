# Purser in three diagrams

Mermaid, so GitHub draws them from this text. Each names the file that does the step; the README's
[How it works in 5 files](../README.md#how-it-works-in-5-files) links the exact lines. Test money only: the Airwallex
sandbox and Metal testnet.

## 1. Architecture: who holds which limit

```mermaid
flowchart LR
  subgraph Agents["Claude agents (propose)"]
    S["Sourcing · Haiku"]
    U["Support · Sonnet"]
    T["Treasury · Opus"]
  end
  subgraph Purser["Purser runner (code)"]
    P["Policy: reserveSpend<br/>src/policy/holds.ts"]
    A["Approvals: termsHash<br/>src/lib/terms.ts"]
    X["Executors: re-check the hash<br/>src/executors/"]
    L["Hash-chained audit log<br/>src/audit/log.ts"]
    B["Books: ledger, T:0, Moneybird"]
  end
  R["Relay (Cloudflare Worker)<br/>worker/"]
  F["CFO's phone<br/>passkey + Face ID"]
  subgraph Rails["Rails, own limits"]
    AW["Airwallex sandbox<br/>cards, FX, payouts"]
    M["Metal testnet<br/>mandates, x402"]
    V["Visa Intelligent Commerce<br/>via Airwallex's Airi"]
  end
  S & U & T --> P
  P -- "within the limits" --> X
  P -- "beyond them: a proposal" --> A
  A <--> R <--> F
  A -- "signed terms" --> X
  X --> AW & M & V
  X --> L --> B
```

## 2. One payment beyond the limit, end to end

```mermaid
sequenceDiagram
  autonumber
  participant Ag as Agent (Claude)
  participant Po as Purser policy (code)
  participant CFO as CFO's phone (Face ID)
  participant Ex as Executor
  participant Rail as Airwallex or Metal
  participant Bk as Books and audit log
  Ag->>Po: propose: pay this invoice
  Po->>Po: check payee allowlist, caps, floors
  Po-->>CFO: over the limit: the exact terms and their SHA-256
  CFO->>Po: passkey signs the hash (Face ID unlocks it)
  Po->>Ex: approved proposal
  Ex->>Ex: re-hash the stored terms, refuse if one cent changed
  Ex->>Rail: pay (an Airwallex payout carries the signed hash in its metadata)
  Rail-->>Ex: accepted (sandbox or testnet)
  Ex->>Bk: book it, append to the hash-chained log
```

## 3. The mandate on Metal: bound, refused, raised, revoked

From the run of 12 November ([record](runs/2026-11-12-faceid-onchain.md)): a passkey account with two owners, the
CFO's passkey and a labelled virtual test passkey, threshold 2.

```mermaid
sequenceDiagram
  autonumber
  participant O as Owners (2 of 2 passkeys)
  participant Acc as Passkey account (Metal testnet)
  participant Ag as Sourcing agent (its own mandate key)
  participant Sup as Supplier
  O->>Acc: sign P-0001: bind a mandate (cap per payment, budget, one payee)
  Ag->>Sup: pay inside the cap: paid, no owner signs
  Ag-xSup: pay over the cap: refused on chain (mandate_cap_exceeded)
  O->>Acc: sign P-0002: raise the cap
  Ag->>Sup: the same amount again: paid
  O->>Acc: sign P-0003: revoke the mandate
```
