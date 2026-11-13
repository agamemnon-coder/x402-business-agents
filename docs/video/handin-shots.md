# Purser: the hand-in film: the shot list (4:38)

Made by `npm run cut -- --docs handin-5` from src/film/cuts.ts and src/film/shots.ts. Who records: **Max (iPhone)** or **Max (screen)** for his own footage; **capture** for a page shot (`npm run capture -- <id>`: Playwright, dark, 1440x900, frame by frame, GETs only).

## 0:00–0:20 · The problem (h01)

- **M1**, 20 s · **Max (iPhone)** · iPhone, landscape, 1080p 30 fps, on a tripod at eye height
  - Where: a quiet room, light from the front
  - Do: Say the opening line word for word; look into the lens; Hold the gaze 1 s after the last word; Three takes
  - On screen: caption "Max · Purser → Agents pay only within limits the CFO signs"

## 0:20–0:40 · Kit 11's core (h02)

- **D1a** (or T14), 7 s · **capture** · Home (home-story): the H1, then the four steps
  - Where: https://kit11.max-31b.workers.dev/ or https://kit11-next.max-31b.workers.dev/
  - Do: hold 3 s, then scroll to "An approval is usually a button" (2.5 s), then hold 6 s (11.5 s)
  - Must show: "AI agents spend. You sign off.", "+1 cent"
- **T3**, 13 s · **capture** · /claude: the H1, the three agents, 24/24
  - Where: https://kit11.max-31b.workers.dev/claude
  - Do: hold 3 s, then scroll to "24/24" (2.5 s), then hold 18.5 s (24 s)
  - Must show: "Claude decides the exceptions", "24/24", "Haiku", "routine payments by code"
  - On screen: caption "Main run · 3 Nov · 24 decisions · USD 0.3170"

## 0:40–1:22 · Try it: your own test company (h03)

- **P2a**, 16 s · **Max (iPhone)** · iPhone screen recording (Control Centre), dark mode, Do Not Disturb on
  - Where: https://kit11.max-31b.workers.dev/try
  - Do: Start a test company; Pick the clean sample invoice (Bergtex Textil GmbH, EUR 1,850.00); Keep only a take whose screen says Claude read it and the agents ran on Claude; hold 2 s on that
  - On screen: caption "Claude reads; code holds the limits"; badge "Simulated bank · test money"
- **P2b**, 14 s · **Max (iPhone)** · iPhone screen recording, plus 2–3 s of a second camera at the Face ID moment
  - Where: the same test company
  - Do: Open the terms; Sign with Face ID; Hold on Paid (simulated bank) 2 s
  - On screen: caption "The CFO signs the exact terms"; badge "Simulated bank · test money"
- **P2c**, 12 s · **Max (iPhone)** · iPhone screen recording
  - Where: the same test company
  - Do: Change the amount by one cent; Hold on the refusal 2 s
  - On screen: caption "One cent changed → refused"; badge "Simulated bank · test money"

## 1:22–1:46 · Face ID, checked on chain (h04)

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

## 1:46–2:04 · Refused on chain (h05)

- **F2**, 7 s · **capture** · The explorer page of the refused payment, tx 0xe6d9c7ea…585df4
  - Where: https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4
  - Do: hold 8 s (8 s)
  - Must show: "0xe6d9…5df4"
  - On screen: caption "0.06 over the 0.05 cap · refused on chain"; badge "Metal testnet · test USD"
- **F1b**, 11 s · **capture** · The same record: refused, then paid
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-faceid-onchain.md
  - Do: hold 0.5 s, then scroll to "Refused, then paid" (1.5 s), then highlight "refused on chain under the 0.05 cap", then hold 10 s (12 s)
  - Must show: "Refused, then paid", "refused on chain"
  - On screen: caption "Both owners signed · cap 0.10 · paid"; badge "Metal testnet · test USD"

## 2:04–2:16 · Airwallex: the card limit (h06)

- **T9a**, 12 s · **capture** · /airwallex, awx-1: the EUR 45.00 decline, the raise, the same charge approved
  - Where: https://kit11.max-31b.workers.dev/airwallex
  - Do: hold 0.5 s, then scroll to "LIMIT_EXCEEDED" (2 s), then highlight "LIMIT_EXCEEDED", then hold 17.5 s (20 s)
  - Must show: "7 November, awx-1", "LIMIT_EXCEEDED", "P-0001"
  - On screen: caption "LIMIT_EXCEEDED · card ····2441 · 7 Nov"; badge "Airwallex sandbox · test money"

## 2:16–2:42 · Visa via Airi (h07)

- **V4**, 16 s · **capture** · The vic-4 record on GitHub: A by one tap, B after Face ID, both paid
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-vic-4.md
  - Do: hold 0.5 s, then scroll to "within the CFO's limit: the agent alone, one tap in Airi" (1.5 s), then highlight "above the CFO's limit: Face ID", then hold 14 s (16 s)
  - Must show: "above the CFO's limit: Face ID", "succeeded"
  - On screen: caption "Visa via Airi · 13 Nov · hash read back"; badge "Airi test card · test money"
- **V4n**, 10 s · **capture** · The vic-4 record: a reused credential and a credential for another amount, refused by Purser
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-vic-4.md
  - Do: hold 0.5 s, then scroll to "PURSER_CREDENTIAL_AMOUNT_MISMATCH" (1.5 s), then highlight "PURSER_CREDENTIAL_AMOUNT_MISMATCH", "PURSER_CREDENTIAL_ALREADY_USED", then hold 10 s (12 s)
  - Must show: "PURSER_CREDENTIAL_ALREADY_USED"
  - On screen: caption "Reused credential → refused by Purser"; badge "Airi test card · test money"

## 2:42–3:09 · Two locks on one payout (h08)

- **AF1**, 13 s · **capture** · The 13 Nov Airwallex record on GitHub: Face ID on the owner's own iPhone, then IN_APPROVAL
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-airwallex-faceid.md
  - Do: hold 1 s, then highlight "approved P-0001 on the phone with Face ID", "IN_APPROVAL", then hold 13 s (14 s)
  - Must show: "own iPhone with Face ID", "IN_APPROVAL"
  - On screen: caption "Max's own Face ID · held at Airwallex"; badge "Airwallex sandbox · test money"
- **D3**, 8 s · **capture** · /runs (runs-timeline): one payout, two locks, PAID
  - Where: https://kit11.max-31b.workers.dev/runs or https://kit11-next.max-31b.workers.dev/runs
  - Do: hold 0.5 s, then scroll to "One payout, two locks" (2 s), then highlight "One payout, two locks", then hold 11.5 s (14 s)
  - Must show: "One payout, two locks", "then PAID"
  - On screen: caption "Two locks · PAID 12 Nov · settlement simulated"; badge "Airwallex sandbox · test money"
- **T5f**, 6 s · **capture** · The two-locks record on GitHub: approved at Airwallex, then PAID (12 Nov)
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-two-locks-paid.md
  - Do: hold 0.5 s, then scroll to "What happened on 12 November" (1.5 s), then highlight "The owner approved the transfer in the Airwallex sandbox web app", then hold 10 s (12 s)
  - Must show: "IN_APPROVAL", "PAID"
  - On screen: caption "Approved in Airwallex's web app · 12 Nov"; badge "Airwallex sandbox · test money"

## 3:09–3:29 · The books, coded by Claude (h09)

- **B1**, 20 s · **capture** · /books: the test company's books, then the Coder agent's choices with its reasons
  - Where: https://kit11.max-31b.workers.dev/books
  - Do: hold 3 s, then scroll to "chose account, VAT code and cost centre" (2.5 s), then highlight "chose account, VAT code and cost centre", then hold 16.5 s (22 s)
  - Must show: "Test company · test money", "chose account, VAT code and cost centre"
  - On screen: caption "Coded by Claude · checked by code"; badge "Test company · test money"

## 3:29–3:49 · Purser Cloud (h10)

- **S1**, 20 s · **Max (screen)** · Laptop screen recording, 1440 px wide, dark mode
  - Where: Purser Cloud's console for the test company of P2 (purser-try.max-31b.workers.dev)
  - Do: Overview, 4 s; Invoices: the paid invoice, 6 s; Transactions, 5 s; Books: the journal, 6 s; No e-mail, keys or personal data on screen
  - On screen: caption "Purser Cloud · a test company"; badge "Test company · test money"

## 3:49–4:04 · The proof (h11)

- **PR1**, 15 s · **capture** · /proof: what Purser guarantees, who enforces it, the evidence
  - Where: https://kit11.max-31b.workers.dev/proof
  - Do: hold 3 s, then scroll to "What Purser guarantees" (2 s), then hold 13 s (18 s)
  - Must show: "What Purser guarantees"

## 4:04–4:20 · What is not done (h12)

- **AF1b**, 16 s · **capture** · The same record: what it does not show, the step to PAID
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-airwallex-faceid.md
  - Do: hold 0.5 s, then scroll to "What it does not show" (1 s), then highlight "What it does not show: the step to PAID", then hold 12 s (13.5 s)
  - Must show: "What it does not show: the step to PAID"
  - On screen: caption "Held at Airwallex · not yet PAID"; badge "Airwallex sandbox · test money"

## 4:20–4:35 · Close (h13)

- **M2**, 15 s · **Max (iPhone)** · iPhone, landscape, 1080p 30 fps
  - Where: the same set as M1
  - Do: Say the close word for word; Three takes

## 4:35–4:38 · End card (h14)

- End card, 3 s: kit11.max-31b.workers.dev · Try it yourself · Airwallex sandbox · Metal testnet · test money · Claude by Anthropic (drawn by the cut)
