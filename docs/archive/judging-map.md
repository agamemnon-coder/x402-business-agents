> Kept for history (archived 12 November 2026). Replaced by: the README's ["For reviewers in 30 seconds"](../../README.md#for-reviewers) and the site's [/judge](https://kit11.max-31b.workers.dev/judge).

# How we read the brief

**Not official judging criteria.** The official site ([airwallex.hackerearth.com](https://airwallex.hackerearth.com/))
publishes no judging criteria. The four areas below come only from Dan Kim's X article "Introducing the Airwallex
Agentic Banking Hackathon" (5 October 2026), as quoted in [docs/rules.md](../rules.md); we could read it only through a
search excerpt, so the wording is unverified. This page is our reading of the brief and where Purser answers it, not
a statement of how the entries are judged. No weights are published.

## How we read the brief

| Area, as we read it | What we take it to ask | Where Purser answers it | Matrix rows |
|---|---|---|---|
| Finance and product value | An important finance problem for a clear user | The CFO or controller of a small company whose AI agents spend company money, only within limits the CFO sets | [J6.1](../requirements-matrix.md#2-how-we-read-the-brief-the-judging-areas-not-official) (🟠) |
| Airwallex relevance and financial context | Airwallex carries a meaningful financial action, and financial context shapes it | Airwallex holds the agents' card limits, the FX conversion and the SWIFT payout; balances, floors and the quote decide the amount | J5.2, J5.3, J6.2 |
| Agentic behaviour and controls | The agent picks the next step, acts inside its permissions and handles approvals and exceptions | Claude agents decide inside their mandates and card limits; Metal and Airwallex enforce the limits; anything beyond them waits for the CFO's Face ID on the exact terms | J5.4, J6.3; section 3 (governance article) |
| Technical execution | A reliable end-to-end workflow with a clear resulting financial state | Agent run 1 (2 November) ran the whole Kit 11 flow in one world, with `npm run verify`, `reconcile` and `data-qa` after it ([run log](../runs/2026-11-02-agent-run-1.md)) | J6.4, K5 |

The "demonstrate" points (a working end-to-end workflow for a clear user; Airwallex used for a necessary financial
action; financial context influencing what the agent decides; clear controls) come from the same article and are read
the same way: rows J5.1 to J5.4 in [docs/requirements-matrix.md](../requirements-matrix.md).
