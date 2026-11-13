# Purser: the enterprise hand-in (film v10): the shot list (4:56)

Made by `npm run cut -- --docs handin-10` from src/film/cuts.ts and src/film/shots.ts. Who records: **Max (iPhone)** or **Max (screen)** for his own footage; **capture** for a page shot (`npm run capture -- <id>`: Playwright, dark, 1440x900, frame by frame, GETs only).

## 0:00–0:21 · The problem (x01)

- Title card, 7 s: “AI agents are starting to pay company bills. / Who signs off?” (drawn by the cut)
- **X-home**, 14 s · **capture** · Home: the H1 and the steps
  - Where: https://kit11.max-31b.workers.dev/
  - Do: hold 5 s, then scroll to "Purser's code holds the limits" (3 s), then hold 8 s (16 s)
  - Must show: "AI agents spend.", "You sign off."
  - On screen: caption "Agents pay only within limits the CFO signs"

## 0:21–0:47 · Purser Cloud (x02)

- **X-cloud-overview**, 6 s · **capture** · Purser Cloud, demo company: the Overview
  - Where: https://purser-try.max-31b.workers.dev/
  - Do: click "Try as guest", then go to #/overview, then hold 7 s (7 s)
  - Must show: "Try as guest"
  - On screen: caption "Purser Cloud · where a company runs Purser"; badge "Demo company · made-up data · test money"
- **X-cloud-agents**, 8 s · **capture** · Purser Cloud, demo company: the Agents tab
  - Where: https://purser-try.max-31b.workers.dev/
  - Do: click "Try as guest", then go to #/agents, then hold 2 s, then scroll to "LIMITS (CFO POLICY" (3 s), then hold 6 s (11 s)
  - Must show: "Try as guest"
  - On screen: caption "Agents · limits · may and may not"; badge "Demo company · made-up data · test money"
- **X-cloud-books**, 6 s · **capture** · Purser Cloud, demo company: Invoices & books
  - Where: https://purser-try.max-31b.workers.dev/
  - Do: click "Try as guest", then go to #/books, then hold 2 s, then scroll to "Waits for the CFO's Face ID" (2 s), then hold 4 s (8 s)
  - Must show: "Try as guest"
  - On screen: caption "Invoices & books"; badge "Demo company · made-up data · test money"
- **X-cloud-tokens**, 6 s · **capture** · Purser Cloud, demo company: the Tokenisation tab
  - Where: https://purser-try.max-31b.workers.dev/
  - Do: click "Try as guest", then go to #/tokenisation, then hold 2 s, then scroll to "Invoice token on Metal testnet" (2 s), then hold 5 s (9 s)
  - Must show: "Try as guest"
  - On screen: caption "Tokenisation · Metal testnet"; badge "Demo company · made-up data · test money"

## 0:47–1:06 · Approval alerts (x03)

- Title card, 19 s: “Approval alerts / WhatsApp · e-mail · Slack · Teams / The alert links; the passkey approves.” (drawn by the cut); badge "Built · live once Twilio keys are set"

## 1:06–1:21 · Try it: your own test company (x04)

- **try-start**, 15 s · **recorded by code** (`npm run record-try10`, headless Chromium at phone size, a CDP virtual test passkey) · /try on purser-try: start a test company; an invoice already paid, sent again, is caught as a duplicate
  - On screen: caption "Your own test company"; badge "Simulated bank · test money"

## 1:21–1:48 · x05 (x05)

- **try-approve**, 11 s · **recorded by code** (`npm run record-try10`, headless Chromium at phone size, a CDP virtual test passkey) · /try: a supplier's invoice of EUR 1,850.00 checked; the approval with the conversion, the fee's cap and the deadline
  - On screen: caption "Conversion · fee cap · deadline"; badge "Simulated bank · test money"
- **try-paid**, 8 s · **recorded by code** (`npm run record-try10`, headless Chromium at phone size, a CDP virtual test passkey) · /try: signed with the virtual test passkey; paid on the simulated bank, booked and filed
  - On screen: caption "Signed · paid · booked"; badge "Simulated bank · test money"
- **try-cent**, 8 s · **recorded by code** (`npm run record-try10`, headless Chromium at phone size, a CDP virtual test passkey) · /try: the amount changed by one cent, the same signature refused
  - On screen: caption "One cent changed → refused"; badge "Simulated bank · test money"

## 1:48–2:11 · Security in layers (x06)

- **X-security**, 13 s · **capture** · /security: the layers a payment must pass
  - Where: https://kit11.max-31b.workers.dev/security
  - Do: hold 1 s, then scroll to "The layers a payment must pass" (2.5 s), then hold 10 s (13.5 s)
  - Must show: "The layers a payment must pass", "52 attacks, all stopped"
  - On screen: caption "Six layers · each stops on its own"; badge "Test harness · stand-in rails"
- **X-attacks**, 10 s · **capture** · /security: where each attack was stopped
  - Where: https://kit11.max-31b.workers.dev/security
  - Do: hold 0.5 s, then scroll to "Where each attack was stopped" (2.5 s), then hold 9 s (12 s)
  - Must show: "Where each attack was stopped"
  - On screen: caption "All 52 attacks stopped · test harness"; badge "Test harness · stand-in rails"

## 2:11–2:23 · x07 (x07)

- **X-hostile**, 12 s · **capture** · /security: a hostile model, against the code
  - Where: https://kit11.max-31b.workers.dev/security
  - Do: hold 0.5 s, then scroll to "A hostile model, against the code" (2.5 s), then hold 12 s (15 s)
  - Must show: "A hostile model, against the code", "380"
  - On screen: caption "Hostile-model eval · none unsafe"; badge "Test data · no network"

## 2:23–2:49 · Claude decides, code checks (x08)

- **X-claude**, 11 s · **capture** · /claude: the three agents and their decisions
  - Where: https://kit11.max-31b.workers.dev/claude
  - Do: hold 3 s, then scroll to "Three agents" (2.5 s), then hold 8 s (13.5 s)
  - Must show: "Three agents", "Haiku"
  - On screen: caption "Main run · 3 Nov · 24 decisions · USD 0.3170"
- **X-books**, 15 s · **capture** · /books: the Coder agent's choices with its reasons
  - Where: https://kit11.max-31b.workers.dev/books
  - Do: hold 2 s, then scroll to "Invoices, sorted by Claude" (2.5 s), then highlight "chose its account, VAT code and cost centre", then hold 11 s (15.5 s)
  - Must show: "Invoices, sorted by Claude", "chose its account, VAT code and cost centre"
  - On screen: caption "Coded by Claude · checked by code"; badge "Test company · test money"

## 2:49–3:15 · Airwallex (x09)

- **X-awx-card**, 8 s · **capture** · /airwallex: LIMIT_EXCEEDED
  - Where: https://kit11.max-31b.workers.dev/airwallex
  - Do: hold 0.5 s, then scroll to "LIMIT_EXCEEDED" (2 s), then highlight "LIMIT_EXCEEDED", then hold 8 s (10.5 s)
  - Must show: "LIMIT_EXCEEDED"
  - On screen: caption "LIMIT_EXCEEDED · card ····2441 · 7 Nov"; badge "Airwallex sandbox · test money"
- **X-awx-locks**, 10 s · **capture** · /airwallex: two locks, IN_APPROVAL then PAID
  - Where: https://kit11.max-31b.workers.dev/airwallex
  - Do: hold 0.5 s, then scroll to "IN_APPROVAL at Airwallex" (2 s), then highlight "IN_APPROVAL at Airwallex", then hold 9 s (11.5 s)
  - Must show: "IN_APPROVAL"
  - On screen: caption "Two locks · PAID 12 Nov · settlement simulated"; badge "Airwallex sandbox · test money"
- **X-awx-payee**, 8 s · **capture** · The payee-check record on GitHub: the bank's answer per name
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-payee-check.md
  - Do: hold 0.5 s, then scroll to "Airwallex's answer" (1.5 s), then highlight "FULL_MATCH", then hold 8 s (10 s)
  - Must show: "The payee's bank checks the name before the CFO is asked", "FULL_MATCH"
  - On screen: caption "Payee check · the bank checks the name"; badge "Airwallex sandbox · test money"

## 3:15–3:42 · Metal (x10)

- **X-faceid-chain**, 9 s · **capture** · /runs: passkeys sign on chain, two owners
  - Where: https://kit11.max-31b.workers.dev/runs
  - Do: hold 0.5 s, then scroll to "Passkeys sign on chain (P-256)" (2 s), then highlight "Passkeys sign on chain (P-256)", then hold 7 s (9.5 s)
  - Must show: "Passkeys sign on chain (P-256)"
  - On screen: caption "Two passkeys · checked on chain · 12 Nov"; badge "Metal testnet · test USD"
- **X-refused**, 8 s · **capture** · The explorer page of the refused payment, tx 0xe6d9c7ea…585df4
  - Where: https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4
  - Do: hold 8 s (8 s)
  - Must show: "0xe6d9"
  - On screen: caption "0.06 over the 0.05 cap · refused on chain"; badge "Metal testnet · test USD"
- **X-anchor**, 10 s · **capture** · The anchor record on GitHub: the chain head on Metal testnet, height 701
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-anchor.md
  - Do: hold 0.5 s, then scroll to "Purser's chain head anchored" (1.5 s), then highlight "Height: 701", then hold 8 s (10 s)
  - Must show: "Height: 701"
  - On screen: caption "Audit chain anchored · 13 Nov"; badge "Metal testnet · test USD"

## 3:42–3:59 · Visa via Airi (x11)

- **X-visa**, 17 s · **capture** · The vic-3 record on GitHub: 45.00 EUR after Face ID, both read-backs
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-vic-3.md
  - Do: hold 0.5 s, then scroll to "above the CFO's limit: Face ID" (1.5 s), then highlight "above the CFO's limit: Face ID", then hold 15 s (17 s)
  - Must show: "above the CFO's limit: Face ID"
  - On screen: caption "Visa via Airi · 12 Nov · hash read back"; badge "Airi test card · test money"

## 3:59–4:09 · T:0 (x12)

- **X-t0**, 10 s · **capture** · The T:0 record on GitHub: 95 journal entries, matched line by line
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-t0-journal-sandbox.md
  - Do: hold 0.5 s, then scroll to "matches our books line by line" (1.5 s), then highlight "matches our books line by line", then hold 8 s (10 s)
  - Must show: "matches our books line by line"
  - On screen: caption "T:0 sandbox · 10 Nov · all 95 entries"; badge "Sandbox · test data"

## 4:09–4:20 · The proof (x13)

- **X-proof**, 11 s · **capture** · /proof: what Purser guarantees, who enforces it, the evidence
  - Where: https://kit11.max-31b.workers.dev/proof
  - Do: hold 3 s, then scroll to "What Purser guarantees" (2 s), then hold 7 s (12 s)
  - Must show: "What Purser guarantees"

## 4:20–4:37 · What is not done (x14)

- **X-visa-n**, 17 s · **capture** · The vic-3 record: the negative tests, only Purser enforces the binding
  - Where: https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-vic-3.md
  - Do: hold 0.5 s, then scroll to "Negative test (F1, F2)" (1.5 s), then highlight "only Purser enforces the binding here", then hold 15 s (17 s)
  - Must show: "only Purser enforces the binding here"
  - On screen: caption "Sandbox did not refuse · only Purser held"; badge "Airi test card · test money"

## 4:37–4:50 · Close (x15)

- Title card, 13 s: “Agents do the work. / The CFO signs only the exceptions. / Purser · Kit 11” (drawn by the cut)

## 4:50–4:56 · End card (x16)

- End card, 6 s: kit11.max-31b.workers.dev · Try it yourself · Test money only: Airwallex sandbox · Metal testnet · Airi test card · simulated bank. Voice-over and music: AI-generated (ElevenLabs). (drawn by the cut)
