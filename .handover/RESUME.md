# Resume instructions for branch faceid-onchain-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3BxhEoE7SLaLDLopUtV, title "Purser · Face ID on chain prep (stream, continued)") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You continue an interrupted work stream of Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (submission Saturday evening 14 November). You are one of several parallel Claude Code sessions; an orchestrator session merges and deploys.

Your branch is `faceid-onchain-1112` of agamemnon-coder/x402-business-agents (already checked out; it exists on origin; its base is main, not platform). Everything you need is ON THE BRANCH in the folder `.handover/`:
1. Read `.handover/RULES.md` first, in full: the product, how to work, the project rules, and at its end the section HANDOVER AND LEAN MODE, which is binding and overrides the rest where they differ. For this stream the base branch is origin/main: wherever the rules say origin/platform as your base, read origin/main; at finalize merge origin/main (and origin/platform only if it has already been merged into main).
2. Read `.handover/SPEC.md`: your stream (context, two tasks, review lenses). It makes NO network calls of any kind: no JSON-RPC, no faucet, no relay, no deploy.
3. The map of the Metal integration is `.handover/maps/metal-live.json`.
Then run `npm ci`, read `git log` and the diff against origin/main to see what the interrupted implementer already did (about ten commits of task 1), verify it, finish task 1 if anything is missing, do task 2, and carry the stream to a green DRAFT pull request against main. Your last commit before the pull request removes the `.handover` folder. Do NOT merge and do NOT deploy.
When the pull request is green, or when you are blocked, send ONE message to the orchestrator session `session_017bq3Bxz45idsGUgFJjRs4G` with the send_message tool (claude-code-remote server; load it with ToolSearch if needed): pull request number, head commit, checks and results, what is not done and why, the exact command sequence of the runbook with environment variable names, open questions. Then stop.

## 2. Later messages from the orchestrator

### Message 1

Orchestrator to faceid-onchain-prep: one ADDITION to your stream from the owner and the Metal juror (same rules, same lean mode; do it inside task 1's command set and cover it in task 2's rehearsal test, record writer and runbook). The live run should tell the WHOLE Kit 11 scene on the account owned by the two passkeys: (1) both owners bind the Sourcing mandate with a small cap; (2) the agent pays inside it; (3) the agent tries one payment over the cap and the chain refuses it; (4) the CFO's Face ID and the second owner sign a REPLACE that raises the cap (a new command `npm run owners -- propose-replace` with the new cap and budget as arguments; if the account's mandate functions only allow revoke-and-bind, do it as one proposal that both owners sign once, or as two proposals, whichever the on-chain terms check supports, and say which in the runbook); (5) the same payment that was refused now succeeds under the replaced mandate; (6) both owners revoke. Every step is recorded with its transaction hash and appears in the run record in that order, so a page can later show: refused on chain, Face ID, replaced on chain, paid. Keep the call estimates per step current in the preflight and the runbook (the owner approved about 150 Metal testnet calls for all of today's Metal runs together; this run should stay under about 90). No network calls in your stream, as before. No reply needed.

### Message 2

Orchestrator note to all streams (12 Nov, 12:10 UTC). About CI load, not about your scope. No reply needed.

1. GitHub runs five jobs on every push of every branch. Sixteen streams pushing after every commit keep the queue more than 20 minutes deep, so pull requests wait. From now on: keep committing in small steps, but PUSH AT MOST ONCE PER TASK (after that task's own checks pass) and once per fix round. Tell every new implementer and fixer so: it replaces "push after every commit" in your rules.

2. To let pull request runs through, I cancel CI runs of work-in-progress commits on branches that have no pull request yet. A cancelled run on such a commit is expected and needs no action. Once your pull request is open, the checks of its head commit are not cancelled by me.

3. The secrets job scans every remote branch. A line in YOUR branch that gitleaks takes for a key turns that check red on EVERY pull request. This already happened with your branch: commit a711ca6, test/owners-runbook.test.ts line 101 (the list of setting names; gitleaks rule generic-api-key). I verified it holds names only and am adding its fingerprint on main (pull request #137); merge origin/main at finalize as planned and it will pass. Before your final push, read the rest of your diff for similar lines. Where you can, write them so the scanner does not match (for example build a name from two parts); where you cannot, put the file, line and commit in your final report. Never rewrite history for it.

### Message 3

Orchestrator note (12 Nov, 12:30 UTC), no reply needed. main (83ff42f) now holds the repaired secrets scan: it reads only the history of the commit under check (--log-opts=HEAD), no longer every branch, and it holds the fingerprint for your line (test/owners-runbook.test.ts line 101 at a711ca6, pull request #137). For you: (1) once your branch has merged origin/main, a red secrets check can only come from your own commits; fix it yourself with a fingerprint line and a comment in your own .gitleaksignore, after checking the line is not a secret; (2) until you merge main the check may still fail on other branches' commits: ignore that; (3) do not edit .github/workflows/ci.yml.

