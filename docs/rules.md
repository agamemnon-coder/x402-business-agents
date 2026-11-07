# Prize and judging rules (checked 2026-10-29)

What the organisers have published, what it means for this build, and what is still unconfirmed.
Sources are at the bottom; "verbatim" means copied from the source on the date above.

## Confirmed

| Topic | Rule | Source |
|---|---|---|
| Deadline | "Project submissions due" Nov 13. The HackerEarth event data gives the end of the build phase as Nov 13, 18:29 UTC (19:29 CET). We submit Thu Nov 12. | microsite timeline; HackerEarth event data (build plan section 0) |
| Finalists, Demo Day | Finalists selected Nov 15; Demo Day Nov 19 in San Francisco, "remote participation optional". "The eight strongest teams will advance to Demo Day." | microsite; Dan Kim, Oct 5 |
| Deliverables | "A working demo, a short video walkthrough under five minutes, and a link to your repository with setup instructions." | microsite FAQ (verbatim) |
| Metal Award, $15,000 | "Requires use of Metal and Airwallex tooling" | microsite (verbatim) |
| Visa Award, $15,000 | "Requires use of Visa and Airwallex tooling" | microsite (verbatim) |
| Founder's Choice $30,000, Judges' Choice $20,000 | "Open category. No specific requirements." | microsite (verbatim) |
| Judging areas | Finance and product value; Airwallex relevance and financial context; agentic behaviour and controls; technical execution. No weights published. | Dan Kim, Oct 5 |
| What every submission shows | (1) a working end-to-end workflow for a clear user; (2) Airwallex used for a necessary financial action; (3) financial context influencing what the agent decides; (4) clear controls: what the agent can do, what requires approval, how it handles an exception | Dan Kim, Oct 5 |
| Ownership | "You retain full ownership of your project." Submitting "only grants us permission to showcase your work". | microsite FAQ (verbatim) |
| Teams | Solo or up to four. | microsite FAQ |
| Open source | HackerEarth's generic FAQ: "all code needs to be in public domain (open source) so that it can be evaluated by the judges". | HackerEarth page data (build plan section 0) |

## What the judges are likely to look for

Dan Kim (VP at Airwallex, co-author of x402) published "Agentic banking starts with governance" on the day
applications opened. Its six principles read like the judging lens for "agentic behaviour and controls", and
the build maps onto each:

| Principle (verbatim) | Where we show it |
|---|---|
| "grant authority to agents by specifying what they can move, in which currencies, and to which recipients" | One Metal mandate per agent (cap, payee, expiry); allowlisted Airwallex beneficiary; CFO policy editor (tier 2) |
| "set limits on transaction amounts and establish an approval chain" | Per-payment and total caps on chain; refund and FX thresholds; proposals that wait for a person |
| "A prompt is not a financial control." | Policy lives in code and on chain; Claude reads and drafts but holds no key and cannot approve; injection drills |
| "People approve sensitive or high-risk decisions, with no exceptions for an agent's track record." | Hash-bound approvals; passkey on the phone (tier 2); the executor re-checks the hash |
| "We check every action against policy before execution and log every outcome for audit." | Executor pre-checks; hash-chained audit log; `npm run verify`; audit report (tier 3) |
| "Every transaction then carries a record connecting it back to the agent, the task, and the policy behind it." | `approval_sha256` in Airwallex metadata, payment ids on chain, audit rows with agent, model and rule |

## Not published, still to confirm

Ask in Slack `#metal-kits-11-and-12` or `#announcements`, or devhelp@airwallex.com. Until answered, we assume the
cautious reading in the right column.

| Question | Working assumption |
|---|---|
| Can one project win the Metal Award and also Founder's or Judges' Choice? | Possible; nothing forbids it. We build for the Metal Award and judge-level quality. |
| Can one project win both the Metal and the Visa Award? | Yes (organisers, 1 November). Visa said on 5 November that TAP is not eligible Visa tooling for this hackathon (VIC or ICC only) (D27), and on 7 November that the VIC run counts (the Airi run, Visa Intelligent Commerce via Airwallex's Airi), so Purser is entered for the Metal Award and the Visa Award (D28). Was, 5 to 7 November: Metal Award only. |
| Video: hard limit of 5:00, and where to host it (YouTube unlisted, Loom, file upload)? | Stay under 4:45; unlisted YouTube plus a link in the README. |
| Must the repo be public at submission, or may it stay private with judge access? | Public by Nov 12 (HackerEarth FAQ), after gitleaks on the full history. |
| Any rule on AI-written code? | None found. We say openly that it was built with Claude Code (Anthropic sponsors the credits). |
| Is the Metal Award judged across all submissions or only the eight finalists? | Unknown (build plan 1.6 item 10). Aim for the final eight either way. |
| Does a live demo link have to stay up after submission? | Keep the Cloudflare page and the sandbox up until Nov 19. |

The HackerEarth challenge page returned HTTP 500 on 2026-10-29; re-check its Rules tab and the Discussion tab
before submitting.

## Sources

- https://airwallex.hackerearth.com/ (prizes, timeline, FAQ; read 2026-10-29)
- https://www.hackerearth.com/community/challenges/hackathon/agentic-banking-hackathon/ (event data; HTTP 500 on 2026-10-29)
- https://www.airwallex.com/en-us/blog/agentic-banking-governance (Dan Kim, Oct 5, 2026)
- Dan Kim on X, Oct 5 (judging areas; read through a search snippet, see build plan section 0)
- https://airwallexdev.com/agentic-banking-builder-guide.md (Kit 11 brief; no prize or judging text)
