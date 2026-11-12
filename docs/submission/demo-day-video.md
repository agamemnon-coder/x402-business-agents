# Demo Day video: the script

For Max, to record the Demo Day video (Demo Day: 19 November 2026, 17:00–19:00 PT, which is 02:00–04:00 in the
Netherlands; the organisers play the video). This is not the 3:00 submission film: the organiser asked for a video
different from the submission, so this one has its own words and its own order. It is under 3 minutes, Max is on
camera the whole time (a small frame in a corner while the screen is shown), it is about agentic banking only, it has
one use case (one company's invoices, from a forged one to paid and booked) and it ends on a QR code.

How to record it: [demo-day-recording.md](demo-day-recording.md). The runbook for the day:
[demo-day.md](demo-day.md).

Rules for these words, checked by `test/demo-day-pack.test.ts`:
- each beat's words fit its seconds at about 2.3 words a second (the same rule as the pitch);
- the beats run from 0:00 without a gap and end before 3:00;
- every beat has a source line, every source is a file in this repository, and every number Max says appears in one
  of that beat's sources;
- what ran on a stand-in, a sandbox or a testnet is said so on screen or in the words, and what has not run is said
  as "next" or "pending".

## The beats at a glance

- **A forged IBAN is caught:** 0:00–0:22; budget 50 words; written 50 words
- **Over the limit, the agent asks the CFO:** 0:22–0:40; budget 41 words; written 37 words
- **Face ID on a mirrored iPhone:** 0:40–0:55; budget 34 words; written 26 words
- **One cent changed, and refused:** 0:55–1:10; budget 34 words; written 20 words
- **Paid via Airwallex, booked, archived:** 1:10–1:38; budget 64 words; written 52 words
- **An agent overspends, and the rails refuse:** 1:38–2:05; budget 62 words; written 53 words
- **The outcome:** 2:05–2:20; budget 34 words; written 29 words
- **What's next:** 2:20–2:42; budget 50 words; written 36 words
- **Try it yourself:** 2:42–2:55; budget 29 words; written 22 words
- **Total:** 2:55; budget 398 words; written 325 words

## The beats

### Beat 1 · 0:00–0:22 · A forged IBAN is caught

- **Screen:** the test company's inbox. The invoice from its usual supplier, the same amount, a different IBAN. The row
  says it is held as possible fraud (changed bank details). The label "test company, stand-in rail" is visible.
- **Max says:** "This invoice looks right: same supplier, same amount. But the bank account has changed. In our test run, an AI agent read an invoice like this, and Purser's code held it as possible fraud. No payment. That is Purser: AI agents pay company bills, only within limits the CFO signs."
- **Source:** [docs/runs/2026-10-29-fraud.md](../runs/2026-10-29-fraud.md) (live Claude reading; code blocked it as
  `bank_details_changed`; no proposal was created); the demo world's held invoice: `src/demoworld/companies.ts` (the
  forged account; stream cloud-demo-1112, once merged), stand-in, labelled.

### Beat 2 · 0:22–0:40 · Over the limit, the agent asks the CFO

- **Screen:** the next invoice from the same stand-in supplier, with the right bank account, over the agent's limit. The proposal shows the
  exact terms: amount, payee, IBAN, the hash of the terms.
- **Max says:** "The next invoice is genuine, with the right bank account, but it is over the agent's limit. So the agent cannot pay it alone. It asks me, the CFO, with the exact terms: amount, payee, bank account."
- **Source:** [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md) (two invoices went out only after the CFO's
  Face ID on the exact terms; Airwallex sandbox, test money).

### Beat 3 · 0:40–0:55 · Face ID on a mirrored iPhone

- **Screen:** the iPhone, mirrored to the Mac (iPhone Mirroring). Max taps Sign; Face ID; the green check: "Signed and
  verified."
- **Max says:** "I sign on my phone, with Face ID. The phone signs a hash of these exact terms. Not a yes to whatever is on the screen."
- **Source:** [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md) (Max approved P-0001, P-0002 and P-0003 with
  Face ID on his own phone); [docs/phone-approval.md](../phone-approval.md) (what the passkey signs). The server checks
  the signature, not the face: attestation is "none".

### Beat 4 · 0:55–1:10 · One cent changed, and refused

- **Screen:** "Try to pay changed terms": the amount plus one cent, sent with the same signature. Refused, in Purser's
  own words.
- **Max says:** "Now I change one cent, and send it with the same signature. Refused. One cent changed: the signature is worthless."
- **Source:** [docs/claims.md](../claims.md) (`/try/sign`: the server refuses the same signature on the amount plus
  0.01; tested on a real iPhone by Max on 6 November); `test/webauthn-soundness.test.ts`.

### Beat 5 · 1:10–1:38 · Paid via Airwallex, booked, archived

- **Screen:** the signed invoice paid, then its booking and its file in the vault. On the hands-on page the bank is
  simulated and says so; for the Airwallex step, cut to the run record's payout (`PAID`, simulated settlement).
- **Max says:** "The signed terms get paid. In our Airwallex sandbox run, my Face ID approved a 240 euro payout, and it went to PAID, with settlement simulated. Purser books each payment: we ran that in Moneybird's sandbox and in T:0's. And it files the invoice in its vault, tested, not yet run live."
- **Source:** [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md) (P-0002: EUR 240.00, Max's Face ID, then
  SENT and `PAID`, simulated settlement); [docs/runs/2026-11-12-moneybird-sandbox.md](../runs/2026-11-12-moneybird-sandbox.md) (sandbox
  administration, 0 differences); [docs/runs/2026-11-10-t0-journal-sandbox.md](../runs/2026-11-10-t0-journal-sandbox.md)
  (95 journal entries, shared sandbox entity); [docs/vault.md](../vault.md) (the vault; tested, not a live run).

### Beat 6 · 1:38–2:05 · An agent overspends, and the rails refuse

- **Screen:** the agent overview: the Sourcing agent's Airwallex card decline (`LIMIT_EXCEEDED`), then Metal's refusal
  and its transaction on the testnet explorer.
- **Max says:** "Agents have limits of their own. In one run, an agent tried a 45 euro purchase on its own Airwallex card, with a limit of 30. Airwallex declined it. In another, an agent tried to pay over its Metal mandate, with our own check switched off on purpose. Metal refused it, on chain."
- **Source:** [docs/runs/2026-11-07-awx-1.md](../runs/2026-11-07-awx-1.md) (EUR 45.00 on a 30.00 limit, declined
  `LIMIT_EXCEEDED` by Airwallex); [docs/runs/2026-11-03-main-run.md](../runs/2026-11-03-main-run.md) (#24 let through
  by our own flag; Metal refused it, tx `0x2e92f9cb…1871`, testnet).

### Beat 7 · 2:05–2:20 · The outcome

- **Screen:** Max full frame, then the proof page with the run records.
- **Max says:** "So: inside the limits, agents pay alone. Beyond them, a person signs the exact terms. In our main run, Claude made 24 of 24 decisions. All on test money."
- **Source:** [docs/runs/2026-11-03-main-run.md](../runs/2026-11-03-main-run.md) (24 Claude decisions, 0 fallbacks;
  test money).

### Beat 8 · 2:20–2:42 · What's next

- **Screen:** one plain list, typed on screen as Max says it (no slide): Purser Cloud for small businesses; Moneybird
  (sandbox run); Exact (next); invoice tokens on Metal (one prototype run on testnet, the financier simulated); design partners wanted.
- **Max says:** "What's next. Purser Cloud for small businesses. Books in Moneybird, which ran in its sandbox, and Exact next. Invoice tokens on Metal: one prototype run on testnet so far. And we are looking for design partners."
- **Source:** [docs/cloud.md](../cloud.md) (Purser Cloud); [docs/runs/2026-11-12-moneybird-sandbox.md](../runs/2026-11-12-moneybird-sandbox.md)
  (Moneybird sandbox run); [docs/erp.md](../erp.md) (Exact Online not tested against a live system yet);
  [docs/runs/2026-11-12-tokenize.md](../runs/2026-11-12-tokenize.md) (one prototype run on Metal testnet,
  12 November: mint, finance, settle; the financier simulated; test money);
  [docs/business/README.md](../business/README.md) (no pilots, no revenue).

### Beat 9 · 2:42–2:55 · Try it yourself

- **Screen:** the QR code, full screen, the short URL under it: `<short URL from /go>`. Hold it for the last
  seconds.
- **Max says:** "Try it yourself. Scan the code, file an invoice, sign it with your own Face ID, and try to change one cent."
- **Source:** [docs/claims.md](../claims.md) (the hands-on page: a visitor signs with their own passkey; a changed cent
  is refused).

## What is said plainly, and where

| What | Said where |
|---|---|
| The demo company, its suppliers and the bank on the hands-on page are stand-ins | Beat 1 and 5 screens (the labels on the page) |
| Airwallex is the sandbox, settlement simulated, test money | Beat 5 words; Beat 7 words |
| The vault is tested, not yet run live | Beat 5 words |
| Metal is testnet | Beat 6 screen (the testnet explorer) and source |
| Exact has not run | Beat 8: "Exact next" |
| Invoice tokens on Metal ran once, as a prototype, with a simulated financier | Beat 8: "one prototype run on testnet so far"; the screen |
| No customers | Beat 8: "we are looking for design partners" |

The token beat follows its record: `docs/runs/2026-11-12-tokenize.md` (12 November) is on main, so beat 8 says one
prototype run on testnet; the test reads the folder and holds the words to it.
