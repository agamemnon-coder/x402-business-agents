# Jury cheat sheet: AWS

For Max, Demo Day (19 November). The questions a juror from AWS is most likely to ask, most likely first: hosting,
scale, keys and reliability. Each answer is two sentences at most and in line with [docs/claims.md](../../claims.md);
every figure in an answer is in that file or in a run record (`test/jury-cheat-sheets.test.ts`). Purser does not run
on AWS today: say so plainly if asked.

## 1. Where does it run?

The public site and the hands-on page run on Cloudflare Workers, and Purser Cloud on Workers with D1. The runner that talks to Airwallex and Metal runs on one machine with one SQLite ledger per company; none of it runs on AWS today.

**Source:** [docs/cloud.md](../../cloud.md); [docs/submission/qa.md](../qa.md), question 11

## 2. How does it scale to many companies?

Today it is one ledger per company on test rails; connected accounts for many companies ran in the Airwallex sandbox on 10 November for 3 test companies, not at scale. At real scale it needs Postgres and keys in a KMS, and neither is built or measured.

**Source:** [docs/runs/2026-11-10-platform-e2e.md](../../runs/2026-11-10-platform-e2e.md); [docs/submission/qa.md](../qa.md), question 11

## 3. What is the largest load you measured?

A separate load run pushed 2,000 clearing payments from 16 wallets through Metal testnet. Nothing larger has run.

**Source:** [docs/runs/2026-10-30-clearing-load.md](../../runs/2026-10-30-clearing-load.md)

## 4. Where are the keys?

On the runner host today, which is listed as an accepted risk. Before real money they move to a KMS, and the signing page moves off the relay.

**Source:** [docs/security.md](../../security.md), "Accepted risks and what is out of scope"

## 5. What if your server is hacked?

The rails refuse anything over their current limits, and changing a limit needs a signed proposal. A compromised runner is out of scope today and listed as an accepted risk, not hidden.

**Source:** [docs/security.md](../../security.md); [docs/submission/qa.md](../qa.md), question 6

## 6. How do you make sure nothing is paid or booked twice?

Every transaction and every sync is recorded before it is sent, and a retry first asks whether the partner already holds it. The chaos tests take Airwallex, Metal, T:0, Moneybird and Claude down in the middle of a flow and check that each entry is there once afterwards.

**Source:** `test/chaos.test.ts`; `test/chaos-partners.test.ts`; `test/erp-hardening.test.ts`

## 7. How do you audit what happened?

Every step is a row in a hash-chained audit log; the main run's log has 412 rows, intact. Anyone can check the chain and the published ids offline with the repository's own verify command.

**Source:** [docs/runs/2026-11-03-main-run.md](../../runs/2026-11-03-main-run.md); [docs/runs/README.md](../../runs/README.md)

## 8. Backups and disaster recovery?

Not in place yet: backups, key management and live drills are listed as production gaps. We would rather say that than claim them.

**Source:** [docs/business/model.md](../../business/model.md), "Production gaps"; [docs/controls.md](../../controls.md)

## 9. How is it tested?

On stand-ins for Airwallex, Metal and Claude, with no network: CI runs the type check, lint and the full suite with coverage floors per area, then browser checks of the pages. A fresh clone serves the whole demo offline with one command, `npm run judge`, with no key.

**Source:** `.github/workflows/ci.yml`; `test/coverage-areas.ts`

## 10. What happens when a partner is slow?

Each live call has a time limit, and a call that runs past it fails plainly instead of hanging the flow. A payment never waits on the books: a failed post to T:0 is logged and retried on the next push.

**Source:** `test/chaos-partners.test.ts`; `src/accounting/t0Sink.ts`
