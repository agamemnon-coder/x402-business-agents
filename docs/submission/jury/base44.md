# Jury cheat sheet: Base44

For Max, Demo Day (19 November). The questions a juror from Base44 is most likely to ask, most likely first: the user,
the product, and how it was built. Each answer is two sentences at most and in line with
[docs/claims.md](../../claims.md); every figure in an answer is in that file or in a run record
(`test/jury-cheat-sheets.test.ts`).

## 1. Who is the user?

The finance team of a small company on Airwallex whose AI agents pay suppliers; the CFO decides. Inside the CFO's limits the agents pay alone, and beyond them the CFO signs.

**Source:** [docs/business/model.md](../../business/model.md); [docs/submission/qa.md](../qa.md), question 9

## 2. What does the CFO actually see?

One approval sheet with the exact terms: the amount, the payee, the bank account and the hash of the terms. The CFO signs it with Face ID, and one changed cent makes that signature worthless.

**Source:** [docs/claims.md](../../claims.md), the `/try/sign` row

## 3. How long does it take to try?

About a minute on the hands-on page, with your own Face ID. The jury review timed signing and the one-cent tamper at 4 clicks, about 15 seconds.

**Source:** [docs/claims.md](../../claims.md), the three sentences' row

## 4. Can a non-technical CFO set the rules?

Yes: the CFO writes the rule in plain words, Claude Opus drafts it, and the CFO signs the change with Face ID. A looser rule needs that signature; a stricter one applies at once.

**Source:** [docs/claude.md](../../claude.md); `src/try/policy.ts`

## 5. Does it work on a phone?

The pages are checked in the browser at phone, tablet and laptop widths, in light and dark. Max signed with Face ID on a real iPhone; that part a test cannot do.

**Source:** `test/browser/pages.check.ts`; `test/browser/trysign.check.ts`; [docs/claims.md](../../claims.md)

## 6. How was it built?

With Claude Code as the build tool, against fakes for every partner, then in live runs in the Airwallex sandbox and on Metal testnet. Every run is logged with what worked and what did not.

**Source:** [docs/runs/README.md](../../runs/README.md)

## 7. What's next?

Purser Cloud for small businesses, the books in Moneybird, which ran in its sandbox, and Exact next. We are looking for design partners; there are no customers yet.

**Source:** [docs/runs/2026-11-12-moneybird-sandbox.md](../../runs/2026-11-12-moneybird-sandbox.md); [docs/business/README.md](../../business/README.md)

## 8. How do you make money?

A monthly plan per company, plus a small fee per payout made through Airwallex connected accounts. These are pilot prices for design partners, and nobody has paid us yet.

**Source:** `src/config/pricing.ts`; [docs/runs/2026-11-10-platform-e2e.md](../../runs/2026-11-10-platform-e2e.md)
