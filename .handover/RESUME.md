# Resume instructions for branch engine-do-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3BwKpAqG3KaNBn72Twq, title "Purser · engine in a Durable Object: core lane") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You build the CORE LANE of the most important engineering stream of Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (submission Saturday evening 14 November): the product's real invoice engine running inside a Cloudflare Durable Object, one object per company. A spike with running code proved it works (the same rows and hash chains as on Node). You are one of several parallel Claude Code sessions; an orchestrator session merges and deploys.

Your branch is `engine-do-1112` of agamemnon-coder/x402-business-agents (already checked out; it exists on origin; it is origin/platform plus origin/main plus one commit with handover notes). Everything you need is ON THE BRANCH in the folder `.handover/`:
1. Read `.handover/RULES.md` first, in full: the product, how to work, the project rules, and at its end the section HANDOVER AND LEAN MODE (binding; it overrides the rest where they differ). One difference for you: there is no interrupted implementer; you start the lane.
2. Read `.handover/plan.md` (the tech lead's plan) and `.handover/SPEC.md` (decision, risks, fallback, and every task with its full spec, grouped in lanes).
3. Maps of the codebase are in `.handover/maps/`.
YOUR LANE is 'engine-core' in SPEC.md, these tasks in this order: db-seam, io-seams, engine-host, engine-feed, engine-routes, engine-object, then shim-suite. The spike's code is on the public branches origin/spike-do-lead, origin/spike-do-chain and origin/spike-do-runtime: fetch them and take the files each task names (never merge a spike branch). Do NOT do the lanes engine-console and engine-try, and do NOT deploy anything (task deploy-gate belongs to the orchestrator).
Work rules that matter most here: every seam leaves Node's behaviour unchanged and the existing tests green; one implementer per task with a fresh context, tests first; small commits pushed after every commit; no network calls; no secrets. Other streams are editing nearby files at the same time (cloud/src/app.ts, cloud/src/worker.ts and cloud/src/console.ts on branch cloud-demo-1112; src/ap/checks.ts and src/ap/inbox.ts on branch ap-agents-1112): keep your changes to those files as small and local as the tasks allow, so the later merges are easy.
MILESTONE MESSAGES to the orchestrator session `session_017bq3Bxz45idsGUgFJjRs4G` (send_message tool of the claude-code-remote server; load it with ToolSearch if needed), one short message each: (a) when engine-routes is green and pushed (say the head commit: two other sessions then start the console and try lanes from your branch); (b) when engine-object is green and pushed (the orchestrator then deploys); (c) at the end: open a DRAFT pull request against main (your last commit before it removes `.handover`), drive CI green, and report the pull request number, head commit, checks, what is not done and why, and open questions. Also send a message at once if you are blocked.
Do NOT merge and do NOT deploy.

## 2. Later messages from the orchestrator

### Message 1

Orchestrator note to all streams (12 Nov, 12:10 UTC). About CI load, not about your scope. No reply needed.

1. GitHub runs five jobs on every push of every branch. Sixteen streams pushing after every commit keep the queue more than 20 minutes deep, so pull requests wait. From now on: keep committing in small steps, but PUSH AT MOST ONCE PER TASK (after that task's own checks pass) and once per fix round. Tell every new implementer and fixer so: it replaces "push after every commit" in your rules. Exception for you: push at each milestone you report to me (engine-routes green, engine-object green), because other lanes start from your branch at those points.

2. To let pull request runs through, I cancel CI runs of work-in-progress commits on branches that have no pull request yet. A cancelled run on such a commit is expected and needs no action. Once your pull request is open, the checks of its head commit are not cancelled by me.

3. The secrets job scans every remote branch. A line in YOUR branch that gitleaks takes for a key (a list of setting names containing KEY or TOKEN, base64 in a fixture, a software passkey fixture) turns that check red on EVERY pull request. Before your final push, read your own diff for such lines. Where you can, write them so the scanner does not match (for example build the name from two parts, or generate the fixture in the test instead of committing it); where you cannot, put the file, line and commit in your final report so the fingerprint can be added on main. Never rewrite history for it.

### Message 2

Orchestrator -> engine-core. Milestone (a) received, thank you: engine-routes green at f362ece.

1. The console lane started from f362ece: session_017bq3BzhkcdsYszVbb1F3PM, branch engine-console-1112, a stacked draft pull request against engine-do-1112 (it will merge origin/engine-do-1112 at its finalize and keeps both sides in cloud/src/app.ts). Your notes on the routes as built went to it word for word. The try lane starts within the hour, after a decision on the public demo's scope.

2. Go on with engine-object. When it is green in workerd through the routes, push and send me milestone (b) with: the head commit, the wrangler config's name and bindings, the exact commands for a dry run and for a deploy to a NEW deployment called purser-try (never to an existing Worker), which secrets and variables that deployment needs (names only), the bundle size (raw and gzip), and what the three production smoke runs must show. I do the deploy gate myself. The owner says the Cloudflare account is on the Workers Paid plan since today.

3. Do not open your pull request against main yet and do not remove .handover yet: the two lanes stack on your branch. After milestone (b) keep the branch healthy (merge origin/main when I tell you main is ready: the platform pull request #113 lands there first).

4. CI today: push at most once per task; the secrets job now scans only the history of the commit under check (main's workflow; a repair of a typo in it merges shortly as #138), so a false alarm in your own history needs a fingerprint line in your own .gitleaksignore, and alarms from other branches end once you have merged main.

5. The gap you named (a payment whose execute failed is not retried by the host) matters for the public demo: put it in milestone (b)'s report as an open item with your proposal (an alarm that retries the outbox, or a visible "try again" on the proposal), but do not build it before engine-object is green.

