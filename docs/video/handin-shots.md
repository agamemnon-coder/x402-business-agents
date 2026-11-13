# Purser: the hand-in film: the shot list (4:38)

Made by `npm run cut -- --docs handin-5` from src/film/cuts.ts and src/film/shots.ts. Who records: **Max (iPhone)** or **Max (screen)** for his own footage; **capture** for a page shot (`npm run capture -- <id>`: Playwright, dark, 1440x900, frame by frame, GETs only).

## 0:00–0:20 · The problem (h01)

- **M1**, 20 s · **Max (iPhone)** · iPhone, landscape, 1080p 30 fps, on a tripod at eye height
  - Where: a quiet room, light from the front
  - Do: Say the opening line word for word; look into the lens; Hold the gaze 1 s after the last word; Three takes
  - On screen: caption "Max · Purser → Agents pay only within limits the CFO signs"

## 0:20–0:42 · Kit 11's core (h02)

- **D1a** (or T14), 8 s · **capture** · Home (home-story): the H1, then the four steps
  - Where: https://kit11.max-31b.workers.dev/ or https://kit11-next.max-31b.workers.dev/
  - Do: hold 3 s, then scroll to "An approval is usually a button" (2.5 s), then hold 6 s (11.5 s)
  - Must show: "AI agents spend. You sign off.", "+1 cent"
- **T3**, 14 s · **capture** · /claude: the H1, the three agents, 24/24
  - Where: https://kit11.max-31b.workers.dev/claude
  - Do: hold 3 s, then scroll to "24/24" (2.5 s), then hold 18.5 s (24 s)
  - Must show: "Claude decides the exceptions", "24/24", "Haiku", "routine payments by code"
  - On screen: caption "Main run · 3 Nov · 24 decisions · USD 0.3170"

## 0:42–1:28 · Try it: your own test company (h03)

- **P2a**, 16 s · **Max (iPhone)** · iPhone screen recording (Control Centre), dark mode, Do Not Disturb on
  - Where: https://purser-try.max-31b.workers.dev/try
  - Do: Start a test company; Pick the clean sample invoice (Bergtex Textil GmbH, EUR 1,850.00); Let the screen show who read it and what the checks found; hold 2 s
  - On screen: caption "Your own test company · 24 hours"; badge "Simulated bank · test money"
- **P2b**, 17 s · **Max (iPhone)** · iPhone screen recording, plus 2–3 s of a second camera at the Face ID moment
  - Where: the same test company
  - Do: Open the terms (the card shows the conversion, the bank fee cap and the deadline); Sign with Face ID; Hold on Paid (simulated bank) 2 s
  - On screen: caption "The CFO signs the exact terms"; badge "Simulated bank · test money"
- **P2c**, 13 s · **Max (iPhone)** · iPhone screen recording
  - Where: the same test company
  - Do: Change the amount by one cent; Hold on the refusal 2 s
  - On screen: caption "One cent changed → refused"; badge "Simulated bank · test money"

## 1:28–1:52 · Face ID, checked on chain (h04)

- **F0**, 13 s · **capture** · /runs: Face ID signs on chain, two passkeys, the second a virtual test passkey (12 Nov)
  - Where: https://kit11.max-31b.workers.dev/runs
  - Do: hold 0.5 s, then scroll to "Face ID signs on chain" (2 s), then highlight "Face ID signs on chain", then hold 12.5 s (15 s)
  - Must show: "Face ID signs on chain", "virtual test passkey"
  - On screen: caption "Two passkeys · checked on chain · 12 Nov"; badge "Metal testnet · test USD"
- **F1**, 11 s · **capture** · The Face ID on-chain record on GitHub: the owners, and both passkeys signing
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-faceid-onchain.md
  - Do: hold 0.5 s, then scroll to "The owners" (1.5 s), then highlight "iPhone (Face ID) (as stated by the owner)", then hold 7 s, then scroll to "the owners sign P-0001" (1.5 s), then highlight "2 of 2 approvals", then hold 9.5 s (20 s)
  - Must show: "threshold 2", "virtual test passkey"
  - On screen: caption "Second approver: a labelled test passkey"; badge "Metal testnet · test USD"

## 1:52–2:12 · Refused on chain (h05)

- **F2**, 8 s · **capture** · The explorer page of the refused payment, tx 0xe6d9c7ea…585df4
  - Where: https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4
  - Do: hold 8 s (8 s)
  - Must show: "0xe6d9…5df4"
  - On screen: caption "0.06 over the 0.05 cap · refused on chain"; badge "Metal testnet · test USD"
- **F1b**, 12 s · **capture** · The same record: refused, then paid
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-faceid-onchain.md
  - Do: hold 0.5 s, then scroll to "Refused, then paid" (1.5 s), then highlight "refused on chain under the 0.05 cap", then hold 10 s (12 s)
  - Must show: "Refused, then paid", "refused on chain"
  - On screen: caption "Both owners signed · cap 0.10 · paid"; badge "Metal testnet · test USD"

## 2:12–2:24 · Airwallex: the card limit (h06)

- **T9a**, 12 s · **capture** · /airwallex, awx-1: the EUR 45.00 decline, the raise, the same charge approved
  - Where: https://kit11.max-31b.workers.dev/airwallex
  - Do: hold 0.5 s, then scroll to "LIMIT_EXCEEDED" (2 s), then highlight "LIMIT_EXCEEDED", then hold 17.5 s (20 s)
  - Must show: "7 November, awx-1", "LIMIT_EXCEEDED", "P-0001"
  - On screen: caption "LIMIT_EXCEEDED · card ····2441 · 7 Nov"; badge "Airwallex sandbox · test money"

## 2:24–2:42 · Visa via Airi (h07)

- **V3**, 18 s · **capture** · The vic-3 record on GitHub: purchase B, 45.00 EUR after Face ID, both read-backs equal
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-vic-3.md
  - Do: hold 0.5 s, then scroll to "above the CFO's limit: Face ID" (1.5 s), then highlight "above the CFO's limit: Face ID", then hold 16 s (18 s)
  - Must show: "above the CFO's limit: Face ID", "succeeded"
  - On screen: caption "Visa via Airi · 12 Nov · hash read back"; badge "Airi test card · test money"

## 2:42–3:03 · Two locks, then PAID (h08)

- **D3**, 11 s · **capture** · /runs (runs-timeline): one payout, two locks, PAID
  - Where: https://kit11.max-31b.workers.dev/runs or https://kit11-next.max-31b.workers.dev/runs
  - Do: hold 0.5 s, then scroll to "One payout, two locks" (2 s), then highlight "One payout, two locks", then hold 11.5 s (14 s)
  - Must show: "One payout, two locks", "then PAID"
  - On screen: caption "Two locks · PAID 12 Nov · settlement simulated"; badge "Airwallex sandbox · test money"
- **T5f**, 10 s · **capture** · The two-locks record on GitHub: approved at Airwallex, then PAID (12 Nov)
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-two-locks-paid.md
  - Do: hold 0.5 s, then scroll to "What happened on 12 November" (1.5 s), then highlight "The owner approved the transfer in the Airwallex sandbox web app", then hold 10 s (12 s)
  - Must show: "IN_APPROVAL", "PAID"
  - On screen: caption "Approved in Airwallex's web app · 12 Nov"; badge "Airwallex sandbox · test money"

## 3:03–3:26 · The books, coded by Claude (h09)

- **B1**, 23 s · **capture** · /books: the test company's books, then the Coder agent's choices with its reasons
  - Where: https://kit11.max-31b.workers.dev/books
  - Do: hold 3 s, then scroll to "chose account, VAT code and cost centre" (2.5 s), then highlight "chose account, VAT code and cost centre", then hold 16.5 s (22 s)
  - Must show: "Test company · test money", "chose account, VAT code and cost centre"
  - On screen: caption "Coded by Claude · checked by code"; badge "Test company · test money"

## 3:26–3:48 · Purser Cloud (h10)

- **S1**, 22 s · **Max (screen)** · Laptop screen recording, 1440 px wide, dark mode
  - Where: Purser Cloud's console for the test company of P2 (purser-try.max-31b.workers.dev)
  - Do: Overview, 4 s; Agents, 4 s; Invoices & books: the paid invoice, then the journal, 6 s; Transactions, 4 s; Tokenisation, 4 s; No e-mail, keys or personal data on screen
  - On screen: caption "Purser Cloud · a test company"; badge "Test company · test money"

## 3:48–4:06 · The proof (h11)

- **PR1**, 18 s · **capture** · /proof: what Purser guarantees, who enforces it, the evidence
  - Where: https://kit11.max-31b.workers.dev/proof
  - Do: hold 3 s, then scroll to "What Purser guarantees" (2 s), then hold 13 s (18 s)
  - Must show: "What Purser guarantees"

## 4:06–4:20 · What is not done (h12)

- **V3n**, 14 s · **capture** · The vic-3 record: the negative tests, only Purser enforces the binding
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-vic-3.md
  - Do: hold 0.5 s, then scroll to "Negative test (F1, F2)" (1.5 s), then highlight "only Purser enforces the binding here", then hold 12 s (14 s)
  - Must show: "only Purser enforces the binding here"
  - On screen: caption "Sandbox did not refuse · only Purser held"; badge "Airi test card · test money"

## 4:20–4:35 · Close (h13)

- **M2**, 15 s · **Max (iPhone)** · iPhone, landscape, 1080p 30 fps
  - Where: the same set as M1
  - Do: Say the close word for word; Three takes

## 4:35–4:38 · End card (h14)

- End card, 3 s: kit11.max-31b.workers.dev · Try it yourself · Airwallex sandbox · Metal testnet · test money · Claude by Anthropic (drawn by the cut)
