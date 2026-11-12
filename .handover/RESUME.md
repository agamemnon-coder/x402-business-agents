# Resume instructions for branch zero-trust-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3ByCQjkWo8SDc8ovWTW, title "Purser · zero trust matrix (stream, continued)") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You continue an interrupted work stream of Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (submission Saturday evening 14 November). You are one of several parallel Claude Code sessions; an orchestrator session merges and deploys.

Your branch is `zero-trust-1112` of agamemnon-coder/x402-business-agents (already checked out; it exists on origin). Everything you need is ON THE BRANCH in the folder `.handover/`:
1. Read `.handover/RULES.md` first, in full: the product, how to work, the project rules, and at its end the section HANDOVER AND LEAN MODE, which is binding and overrides the rest where they differ.
2. Read `.handover/SPEC.md`: your stream (context, tasks, the addition from the jury panel, review lenses).
3. Maps of the codebase are in `.handover/maps/`.
Then run `npm ci`, read `git log` and the diff against origin/platform to see what the interrupted implementer already did (the last commit is marked WIP: work in progress, not reviewed; it touches production code in src/ap/pay.ts, src/policy/approvals.ts, src/policy/holds.ts and src/vault/build.ts: verify each of those changes is a real fix with a test, or revert it), and carry the stream to a green DRAFT pull request against main. Your last commit before the pull request removes the `.handover` folder. Do NOT merge and do NOT deploy.
When the pull request is green, or when you are blocked, send ONE message to the orchestrator session `session_017bq3Bxz45idsGUgFJjRs4G` with the send_message tool (claude-code-remote server; load it with ToolSearch if needed): pull request number, head commit, checks and results, any real hole you found in the product and how it was fixed, what is not done and why, open questions. Then stop.

## 2. Later messages from the orchestrator

### Message 1

Orchestrator note to all streams (12 Nov, 12:10 UTC). About CI load, not about your scope. No reply needed.

1. GitHub runs five jobs on every push of every branch. Sixteen streams pushing after every commit keep the queue more than 20 minutes deep, so pull requests wait. From now on: keep committing in small steps, but PUSH AT MOST ONCE PER TASK (after that task's own checks pass) and once per fix round. Tell every new implementer and fixer so: it replaces "push after every commit" in your rules.

2. To let pull request runs through, I cancel CI runs of work-in-progress commits on branches that have no pull request yet. A cancelled run on such a commit is expected and needs no action. Once your pull request is open, the checks of its head commit are not cancelled by me.

3. The secrets job scans every remote branch. A line in YOUR branch that gitleaks takes for a key (a list of setting names containing KEY or TOKEN, base64 in a fixture, a sample signature) turns that check red on EVERY pull request. Before your final push, read your own diff for such lines. Where you can, write them so the scanner does not match (for example build the name from two parts); where you cannot, put the file, line and commit in your final report so the fingerprint can be added on main. Never rewrite history for it.

### Message 2

Orchestrator note (12 Nov, 12:30 UTC), no reply needed. main (83ff42f) now holds the repaired secrets scan: it reads only the history of the commit under check (--log-opts=HEAD), no longer every branch. For you: (1) once your branch has merged origin/main, a red secrets check can only come from your own commits; fix it yourself with a fingerprint line and a comment in your own .gitleaksignore, after checking the line is not a secret; (2) until you merge main the check may still fail on other branches' commits: ignore that; (3) do not edit .github/workflows/ci.yml.

