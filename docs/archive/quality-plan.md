> Kept for history (archived 12 November 2026). Replaced by: [README.md](../../README.md) and [decisions.md](../decisions.md).

# Quality plan: from "works" to "best in class" (29 October 2026)

**Rule:** no new features unless they are on this list. Every item ends with proof (a screenshot, a run log or a
test). Every step passes the tests, the type check and CI. Feature freeze is **Tuesday 4 November**; after it come only
polish, the video, the pitch and practice. Opus writes everything that touches money, policy or security.

**Verdicts** come from a fresh, jury-style review of the repo and the rendered pages (29 October), plus the external
QA test. **Done** means done with evidence.

## Already fixed today (QA findings)

These six QA findings were fixed and deployed on 29 October. Run log:
[runs/2026-10-29-qa-fixes.md](../runs/2026-10-29-qa-fixes.md).

1. `/` without a key shows a guest landing and polls nothing.
2. `/demo` no longer prints "null", and the Face ID steps no longer break on a phone.
3. The demo is card-first and in plain words.
4. The header is one line.
5. `npm run judge` runs the demo with no keys.
6. A Chromium page check runs in CI on a fresh clone.

## A. Product and story

| # | Item | Verdict | Plan |
|---|---|---|---|
| 1 | Product name | **poor**: only the kit name; "Northwind Outdoor" heads every page, as if it were the product | Max picks one of five names. Then use it everywhere: README, page titles (today three different ones), headers, phone, demo, PDF, package description. Northwind becomes "example company". |
| 2 | One core sentence | **mediocre**: on the pages, but not first everywhere, and the tab titles differ | Every page and the README open with "Give every AI agent its own company card, with limits the CFO sets." A test checks each page. |
| 3 | One customer | **poor**: a juror cannot tell whether the buyer is a CFO or a data reseller | Name the customer: the CFO or controller of an SMB that runs AI agents. Say it in the README, on the landing and in the deck. Northwind is the example. |
| 4 | Landscape | **poor**: missing | `docs/landscape.md` covers Ramp, Brex, Stripe (Agent Toolkit, Issuing for agents), Payman, Skyfire, Crossmint, Coinbase AgentKit / x402, Visa Intelligent Commerce and Mastercard Agent Pay. Only sourced facts. One table: one policy over card and chain, hash-bound Face ID, mandates on chain, a prompt is not a control. |

## B. The first 30 seconds

| # | Item | Verdict | Plan |
|---|---|---|---|
| 5 | README | **poor**: 486 lines, a "work in progress" banner, a stale screenshot, no diagram, no demo link | At most one screen: the sentence, 3 bullets, a mermaid diagram, the hosted demo, the video, `npm ci && npm run judge`. The rest moves to `docs/` (architecture, setup, security, metal-award, airwallex, runs). |
| 6 | Judge mode | **done (29 Oct)** | Keep it green in CI. A `.devcontainer` for Codespaces is optional, if time allows. |
| 7 | Hosted guest demo | **good** since today: `/` landing, `/demo` and `/month`, with no key | Product name and title. The live relay stays behind the viewer key. |

## C. Design and UX

| # | Item | Verdict | Plan |
|---|---|---|---|
| 8 | One design system | **mediocre**. The colour and type tokens match, but they are copy-pasted four times. There is no shared navigation. Raw ids show (`ext:acme-research`, `awx-executor`, transaction ids). The month page writes "1850.00 EUR" next to "1,850.00 EUR". The dashboard is 5 px too wide on a phone. | One stylesheet shared by every page, in light and dark. One top navigation (Dashboard, Demo, Month, Policy). Readable names instead of ids, hashes folded away. One money formatter (currency plus thousands) everywhere. The page check guards it. |
| 9 | Presentation mode | **poor**: missing | `?present` on every page: larger type, no noise. Refresh every screenshot in `docs/` at iPhone and laptop size. |
| 10 | Empty, error and loading states | **mediocre**: the guest state is fixed; others still say "Connecting" or show empty panels | A clear sentence for each state, with no stack traces. English product copy. |
| 11 | Accessibility | **mediocre**. The approve page is good. Elsewhere: no `aria-selected` before today, and focus styles only on the phone pages. | Check contrast, focus and labels on all approval buttons, with axe-core in the page check. |

## D. A demo that never fails

| # | Item | Verdict | Plan |
|---|---|---|---|
| 12 | `npm run demo:video` | **poor**: missing (only `demo:all`) | The five video moments, in order, with pauses for Max to speak. Live, or replay as the fallback. Run twice in a row from a fresh world on Saturday, with Max, and log both runs. |
| 13 | Visible fallback | **mediocre**: the replay exists, but nothing switches over | If Metal, Airwallex or Cloudflare stalls, the demo shows "Recorded run of <date>" and continues from the replay. |
| 14 | `npm run up` | **poor**: the runner is a background task that stops after 2 hours | One command starts the runner and the relay sync and prints a health check (Metal, Airwallex, relay, passkey, webhooks). It restarts on its own and has no time limit. |

## E. Metal Award

| # | Item | Verdict | Plan |
|---|---|---|---|
| 15 | Evidence dossier | **good**: every part has code, a tx link and the docs | Add: what we do not use, and why. Add a public way to check without keys (explorer links, the recorded story). Remove a stale status line. |
| 16 | Feedback from Metal | to do | I write the Slack message; Max sends it. |
| 17 | Clearing versus mandate | **mediocre** | One sentence on the dashboard and in the demo: "Prepaid clearing for many small calls from one customer; a mandate for open-ended spending with a cap per payment." |

## F. Visa Award

| # | Item | Verdict | Plan |
|---|---|---|---|
| 18 | TAP / VIC | not started (waits for Max's go) | After the go: an honest feasibility note on time and risk. A Visa card through Airwallex probably does not count as Visa tooling. |

## G. Airwallex depth

| # | Item | Verdict | Plan |
|---|---|---|---|
| 19 | `docs/airwallex.md` | **poor**: the endpoint list is buried in `security.md` | Every Airwallex action, why it is a real financial step, its endpoint and a run link. The sources are Issuing (cardholders, cards, limits, transactions, declines, webhooks), FX quote and conversion, beneficiaries, SWIFT transfers, deposits and global accounts. |
| 20 | Terms and best practices | **mediocre**. Idempotency keys (`request_id`) on transfers and conversions, webhook signatures and quote expiry are done. A scoped key is not. | Use Airwallex terms throughout. Max creates a scoped key with only the permissions we use (I list them); swap it in and document it. |

## H. Engineering quality

| # | Item | Verdict | Plan |
|---|---|---|---|
| 21 | Lint and format | **poor**: missing. Type checking is strict, with 0 `any`. | Add ESLint and Prettier to CI, and forbid `any` in the money and policy code. |
| 22 | Coverage | **poor**: no report | A coverage report in CI. At least 90% of lines in the money, policy, passkey and executor code; add tests where it falls short. |
| 23 | Architecture document | **poor**: missing | `docs/architecture.md` with mermaid diagrams: components, trust boundaries, money flows, and who holds which key. |
| 24 | Clean-up | **mediocre**: 37 npm scripts, some internal; `docs/rules.md` is an internal note | Remove dead code and old scripts. Group the scripts. Move internal notes out of `docs/`. Keep versions pinned, lockfiles clean and `npm audit` at 0. |
| 25 | Independent review | to do | A fresh bug and security review of the whole repo on 2 November. Fix every finding before the freeze. |

## I. Presentation (after the freeze)

| # | Item | Plan |
|---|---|---|
| 26 | Video script, 4:30 | Problem 30 s, solution 20 s, five moments 3 min, why us and the vision 30 s, close; a shot list per scene. |
| 27 | Pitch deck, 8 slides | Problem, customer, solution, live demo, safety, Airwallex and Metal, market and business model, team and vision; in the same design system. |
| 28 | An explainer for the owner (an internal working note, removed from the tree on 12 November 2026) | Each part in two plain sentences, plus 25 jury questions with short answers; a 15-minute daily quiz. |

## Schedule

| Day | What |
|---|---|
| Thu 29 Oct | QA fixes (done), this plan. |
| Fri 30 Oct | Product name everywhere (after Max picks). README on one screen. `architecture.md`, `airwallex.md`, `landscape.md`, and the Metal dossier polished. Lint, format and coverage in CI. |
| Sat 31 Oct | `npm run up` and `npm run demo:video`. Two fresh runs from zero with Max, logged. The design system pass: shared styles, navigation, readable names, money format. |
| Sun 1 Nov | Demo-ready: presentation mode, every screenshot refreshed, the visible fallback, the Slack message to Metal. |
| Mon 2 Nov | Coverage to 90% where it falls short, clean-up, independent review. |
| Tue 3 to 4 Nov | Fixes from the review; the scoped Airwallex key; final CI. **Freeze on 4 Nov.** |
| From 5 Nov | Video script, deck, the explainer for the owner (item 28), the daily quiz. |

## What we need from Max

- **The product name** (from the five proposals).
- **Two slots on Saturday** of about an hour each, for the fresh runs (enrol, plus about 6 Face IDs per run).
- **Go or no-go** on the Visa research.
- **A scoped Airwallex key:** Max creates it in the Airwallex web app; I give the exact permissions.
- **Sending** the Slack message to Metal.
- **Optional:** a second person, or a second device labelled as a test person, for four eyes live.
