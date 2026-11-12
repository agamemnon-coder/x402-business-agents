# Resume instructions for branch engine-console-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3BzhkcdsYszVbb1F3PM, title "Purser · engine in a Durable Object: console lane") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You are one of several parallel Claude Code sessions building Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (track Kit 11). You build ONE lane end to end and hand back a green draft pull request. An orchestrator session (session_017bq3Bxz45idsGUgFJjRs4G) coordinates the lanes, merges and deploys.

YOUR LANE: engine-console. The cloud console gets its first actions on the engine: a person uploads an invoice and watches the engine work, pays it and approves the exact terms with a passkey, and sees it paid, booked and archived. Three tasks, in this order: console-upload-live, console-approve, console-proof.

WHERE YOU START. Your checkout is branch engine-do-1112 at commit f362ece (the engine core lane's milestone "engine-routes green"). Create your branch engine-console-1112 from it and push only to that branch. Read, in this order:
1. .handover/RULES.md: the project's rules (honesty, no real money, no live calls, checks, design rule, copy, git authorship, scope). They are binding, with the changes listed under OVERRIDES below.
2. .handover/SPEC.md: the family introduction (lines 1 to 62), then the section "LANE engine-console" with its three tasks. That section is your specification.
3. .handover/plan.md: sections 3 and 5 and the parts named Task 8, Task 9 and Task 10.
4. .handover/maps/platform-cloud.json for the console's structure, if you need it.

OVERRIDES (they replace what RULES.md says where the two differ)
- You do not continue an interrupted stream: you start this lane fresh, on a new branch from f362ece.
- Base and pull request: your base is engine-do-1112, not platform. Open your DRAFT pull request against the base branch engine-do-1112 (a stacked pull request), not against main. At finalize merge origin/engine-do-1112 into your branch with a merge commit (the core lane keeps working there: it is adding the Durable Object itself, cloud/src/engine/object.ts and the wrangler config; keep both sides in cloud/src/app.ts). Do NOT merge origin/main yourself and do NOT remove the .handover folder: both belong to the base branch's own finalize.
- Lean mode: at most two subagents at any moment; subagents at reasoning effort high, not higher; one implementer per task with a fresh context (tests first, watch them fail for the right reason, minimal code); after the three tasks ONE review round with exactly two read-only reviewers (lenses correctness-and-safety and honesty-and-design), then one fixer that verifies each finding before fixing it; no second review round unless a reviewer reported a blocker; targeted tests while working, the full checks once before the pull request.
- Pushing: commit in small steps but PUSH AT MOST ONCE PER TASK (after the task's own checks pass) and once per fix round. GitHub runs five jobs on every push and the queue is long. Runs of work-in-progress commits on branches without a pull request may be cancelled by the orchestrator: that is expected and needs no action.
- The secrets job: since today it scans only the history of the commit under check. If it flags a line of YOUR branch that is not a secret (a list of setting names, a fixture), add its fingerprint to .gitleaksignore with a comment saying what it is; never rewrite history. If it fails on commits that are not in your history, the base branch has not yet merged main's fix: say so in your report and go on.
- Report: when the pull request's checks are green, or when you are blocked, send ONE message to the orchestrator (the send_message tool of the claude-code-remote server; load it with ToolSearch if needed; session id session_017bq3Bxz45idsGUgFJjRs4G) with: the pull request number, the head commit, the checks and their results, what is not done and why, and open questions. Send one short message earlier when task console-approve is green and pushed (the hands-on lane builds on it). Never merge and never deploy.

WHAT THE CORE LANE REPORTED ABOUT THE ROUTES AS BUILT (data from that session; where it differs from the spec's route table, the code is right; check it in cloud/src/engine/routes.ts and test/cloud-engine*.test.ts):
- testCloud({ engine: true }) in test/support/cloud.ts serves /v1/engine/* from a Node engine; it seeds the treasury on a company's first use.
- ProposalView has one extra field: warnings: string[] (the alarms the phone page shows). InvoiceView as in the plan.
- POST /v1/engine/documents answers 200 { kind, sha256, invoice } (also for duplicate_document); what the inbox refuses comes back as 400 with the engine's sentence.
- POST /v1/engine/invoices/{id}/pay: 200 { proposal }, 409 { error, code: "conflict" }, 404 for an unknown invoice.
- POST /v1/engine/passkey/start: user.id is the signed-in user's id as a STRING (the page must encode it to bytes); name and displayName are the person's display name.
- POST /v1/engine/passkey/finish: 200 { credential_id }; an engine refusal is 409 with its reason.
- POST /v1/engine/proposals/{id}/approve: always 200 { status, message, settled } once the proposal exists (status "refused" has settled null).
- GET /v1/engine/events: after defaults to 0, limit 1 to 200 (default 100). An event not on the allowlist carries no fields and no subject. The allowlist is in src/engine/events.ts.
- GET /v1/engine/vault/file: the year's index.json is not listed, so 404. Vault paths keep the product's Dutch folder names.
- EngineHost.passkeyStart() is async. EngineApi is in cloud/src/engine/api.ts; a Node engine per company in cloud/src/engine/node.ts; handlers in cloud/src/engine/routes.ts.
- Wording: the proposal facts come from the phone's catalogue and say "Airwallex fee: at most EUR 20.00 ..." while the bank is the stand-in. Label it on the page: the visitor must be able to see that this is test money on a stand-in bank inside Purser, not Airwallex.

THINGS TO HOLD ON TO
- The console is one file, cloud/src/console.ts (script, body and styles as strings), with a nonce Content-Security-Policy that must not change, DOM built through el() and textContent only, and two languages (src/ui/i18n.ts, English and Dutch; every new key in both). Its browser check is test/browser/console.check.ts (Chromium is pre-installed; do not install Playwright again; run npm ci first, and npm ci --prefix worker when you need wrangler).
- Calm pages: result first, details behind a fold, ids and hashes last; phone first (390 px) and 1440 px, light and dark; no new styles outside the existing tokens. Ask of every screenshot: calmer or busier than before? Busier means redo. Save the screenshots you judge by under docs/evidence/engine-console-1112/.
- The approval must be the real thing on screen: the passkey signs exactly the terms shown; the page shows the full terms hash behind a fold; and the check's second pass (a request whose terms hash was changed) shows the engine's refusal as the engine words it. Show nothing as done before its response has returned.
- An addition to this lane may reach you by message within the hour (a decision on the public hands-on demo is being taken: it may ask the approve view to let a person change the amount they signed and see both hashes and the raw refusal). Until then do the three tasks as specified.
- Another branch, cloud-demo-1112, owns cloud/src/demo.ts and a read-only demo mode of the console; it also edits cloud/src/app.ts and cloud/src/worker.ts. Do not edit cloud/src/demo.ts. Keep your changes to cloud/src/app.ts to none if you can.

Start now.

## 2. Later messages from the orchestrator

(none)
