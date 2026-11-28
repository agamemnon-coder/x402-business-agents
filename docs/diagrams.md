# Purser in five diagrams

Mermaid, so GitHub draws them from this text. Each names the file that does the step;
[How it works in 5 files](how-it-works.md) links the exact lines. Test money only: the Airwallex
sandbox and Alta (formerly Metal) testnet.

## 0. In one line

The README opens with it: an agent proposes, the CFO's policy decides, above the limit the CFO's passkey signs, the
rail pays under its own limit, and the books and the audit log record it.

```mermaid
flowchart LR
  I["Invoice or purchase<br/>(PDF, card, x402)"]:::cash --> RD["Reader<br/>Claude reads it"]:::agent
  RD --> CK["Checker<br/>Purser's code: duplicates,<br/>bank details, payee"]:::purser
  CK --> PO{"CFO policy<br/>(code, also exported<br/>as OPA/Rego)"}:::purser
  PO -- "within the agent's limit<br/>e.g. EUR 120.00" --> PAY["Agent pays alone"]:::paid
  PO -- "above it<br/>e.g. EUR 1,850.00" --> FID["CFO signs the SHA-256<br/>of the exact terms<br/>(passkey, Face ID)"]:::purser
  FID --> HC{"Before paying:<br/>terms still match<br/>the signed hash?"}:::purser
  HC -- "yes" --> PAY
  HC -- "one cent changed" --> X["Payment refused.<br/>Nothing was paid."]:::refused
  PAY --> RAIL["Rails, each with its own limit<br/>Airwallex sandbox · Alta testnet<br/>· Visa via Airwallex Airi"]:::testmoney
  RAIL --> BK["Books<br/>T:0 · Moneybird (sandboxes)"]:::proof
  BK --> LOG["Hash-chained audit log"]:::proof --> ANC["Head anchored on Alta testnet<br/>npm run verify-all"]:::proof
  classDef purser fill:#246bdd,stroke:#89b5fc,color:#fff
  classDef agent fill:#356fcd,stroke:#818cf8,color:#fff
  classDef paid fill:#047857,stroke:#34d399,color:#fff
  classDef refused fill:#be123c,stroke:#fb7185,color:#fff
  classDef testmoney fill:#b45309,stroke:#fbbf24,color:#fff
  classDef cash fill:#0369a1,stroke:#38bdf8,color:#fff
  classDef proof fill:#334155,stroke:#94a3b8,color:#fff
```

## 1. Architecture: who holds which limit

```mermaid
flowchart LR
  subgraph Agents["Claude agents (propose)"]
    S["Sourcing · Haiku"]
    U["Support · Sonnet"]
    T["Treasury · Opus"]
  end
  CL["Your own Claude<br/>connector or Code plugin"]
  subgraph Purser["Purser (code)"]
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
    M["Alta testnet<br/>mandates, x402"]
    V["Visa Intelligent Commerce<br/>via Airwallex's Airi"]
  end
  S & U & T --> P
  CL -- "/mcp: read, propose only" --> A
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
  participant Rail as Airwallex or Alta
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

## 3. The mandate on Alta: bound, refused, raised, revoked

From the run of 12 November ([record](runs/2026-11-12-faceid-onchain.md)): a passkey account with two owners, the
CFO's passkey and a labelled virtual test passkey, threshold 2.

```mermaid
sequenceDiagram
  autonumber
  participant O as Owners (2 of 2 passkeys)
  participant Acc as Passkey account (Alta testnet)
  participant Ag as Sourcing agent (its own mandate key)
  participant Sup as Supplier
  O->>Acc: sign P-0001: bind a mandate (cap per payment, budget, one payee)
  Ag->>Sup: pay inside the cap: paid, no owner signs
  Ag-xSup: pay over the cap: refused on chain (mandate_cap_exceeded)
  O->>Acc: sign P-0002: raise the cap
  Ag->>Sup: the same amount again: paid
  O->>Acc: sign P-0003: revoke the mandate
```

## 4. Where it runs

The two Cloudflare Workers (`worker/wrangler.jsonc`, `cloud/wrangler.try.jsonc`), their Durable Objects, the D1
database, the MCP server and the relay. The live runs are made by the runner (Node, `src/cli`), not by a Worker.

```mermaid
flowchart LR
  U["Browser or phone"] --> K
  F["CFO's phone<br/>passkey"] <--> RO
  subgraph K["Worker kit11 · worker/"]
    S["Site: Home, Try, Proof, /security<br/>the hands-on demo"]
    RO["Durable Object RelayObject<br/>the relay: proposals, approvals"]
  end
  RN["Runner · Node, src/cli<br/>the live runs"] <--> RO
  K -- "service binding TRY_ENGINE" --> API
  subgraph C["Worker purser-try · cloud/"]
    API["Console and API"]
    MCP["/mcp · MCP server<br/>read, propose only"]
    E["Durable Object CompanyEngine<br/>one per company"]
    D[("D1 database")]
  end
  AI["Your AI · any MCP client"] --> MCP
  API & MCP --> E --> D
  RN --> AW["Airwallex sandbox"] & M["Alta testnet"] & V["Airi · Visa Intelligent Commerce"]
  S -- "FX quote, read-only" --> AW
  S & E --> CL["Claude · Anthropic API"]
```
