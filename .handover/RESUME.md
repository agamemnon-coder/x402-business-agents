# Resume instructions for branch agent-surface-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3BzoqEibibxChboGMpN, title "Purser · agent surface: proof as JSON, agent API, Skill file") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You are one of several parallel Claude Code sessions building Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (track Kit 11). Submission is Saturday 14 November. An orchestrator session (session_017bq3Bxz45idsGUgFJjRs4G) coordinates the streams, merges pull requests and deploys; you build ONE stream end to end and hand back a green draft pull request.

PRODUCT IN ONE LINE. AI agents (Claude) spend company money only within limits the CFO signs with Face ID (a passkey over the exact terms). The limit is enforced in layers that do not trust each other (deterministic code, the CFO's signature, the rails' own controls: Airwallex cards and approvals, an on-chain Metal mandate per agent).

REPOSITORY. agamemnon-coder/x402-business-agents. Your checkout is the branch `platform` (it is merging into main today; main is an ancestor of it). Create your branch `agent-surface-1112` from it and push only there. Run `npm ci` first. Playwright with Chromium is pre-installed: do not install it again.

YOUR STREAM: agent-surface. Two tasks, in this order. Why: research into the hackathon organiser's public repositories showed what a protocol-literate, agent-minded reader looks for. An LLM or agent that fetches Purser's site today gets HTML and a prose file. Give it the proof as data it can check, and make Purser's own agent API (an MCP server) tell a connecting agent what to do next. No page changes, no menu item, no badge, nothing sent to any third party.

=== TASK 1: proof an agent can fetch and check (/proof.json, a receipt it can verify, a "For agents" block in llms.txt) ===

GOAL. Purser's public site is a Cloudflare Worker. Give a fetching tool the proof as data, plus one signed receipt it can check itself, so it can repeat Purser's core claim (change one cent and the signed hash no longer matches) without trusting the page.

BACKGROUND
- Pages are built in Node by buildPages() in src/relay/assets.ts into a bundle of strings; the Worker (worker/src/core.ts) only serves them. /llms.txt already works this way: assets.ts reads the file (const LLMS, near line 37; added to the bundle near line 65) and core.ts serves it (near line 175) with COMMON_HEADERS. Follow that exactly.
- Data functions that already feed the pages: liveRuns() in src/redesign/runs.ts; GUARANTEES in src/redesign/guarantees.ts; agentView(id) in src/redesign/agents.ts. REPO_BLOB is in src/redesign/metalStory.ts. SITE_URL is in src/ui/meta.ts. Line numbers are from 10 November: check the current code first.
- THE RECEIPT. The owner decided today to publish the receipt of his own passkey approval of 7 November (Airwallex sandbox, test money): docs/runs/2026-11-07-awx-1/receipt-P-0002.json. It reaches main through pull request #139 within the hour (`git fetch origin main`; merge origin/main into your branch once it is there). `npm run verify-receipt -- <file>` says VALID for it. Serve THAT file. Take every word you say about it from the file's own "note" field and from what the verifier prints ("Proves: the holder of this public key signed exactly these terms, with the authenticator reporting user verification, on this site. Does not prove: who holds the key, or that it was Face ID (no attestation is checked)."). Name the file in ONE constant so a swap needs no other code change. If the file is not on origin/main when you reach this step, build and test against docs/runs/2026-11-10-platform-e2e/receipt-SANDBOXTEST-P-0002.json (approved with a labelled test passkey; its note says so), say so in your report, and switch the constant as soon as #139 has merged.

TESTS FIRST (new test/agent-data.test.ts, vitest, in the style of the /llms.txt block in test/guarantees.test.ts)
1. buildPages(...).proofJson parses as JSON and deep-equals proofData(). GET /proof.json through pageResponse() answers 200 with content-type application/json; charset=utf-8 and the common headers.
2. Every run equals its liveRuns() row (key, date, title, checks, money, ids) and the count equals liveRuns().length; every guarantee equals GUARANTEES; each agent's limits equal agentView(id).
3. Every URL in the document starts with https:// and with SITE_URL, the repository URL or the Metal explorer. No value contains "../".
4. Nothing private: no 13 to 19 digit number, no card last-four field, no e-mail address, no key or token. Reuse test/support/privacyScan.ts if it fits.
5. GET /receipt-sample.json returns the receipt file byte for byte. verifyReceipt() from src/try/receipt.ts says ok on it; with terms.amount changed by one cent the "terms hash" check fails.
6. llms.txt contains the heading "## For agents", both URLs, and a sentence about the receipt that is built from the receipt's own note (test it against the note: the words "sandbox" and "test money" and what kind of passkey signed).
7. A bundle without the two new fields answers 404 for both paths.

BUILD
- New src/redesign/agentData.ts exporting proofData(): { schema: "purser.proof/v1", note, site, repository, runs, guarantees, agents, receipt_sample, how_to_check_a_receipt }. note: one sentence (test money only; customer, supplier, settlement and second approver are simulated; built from the repository's run records at build time). Runs: key, date_iso, title, rails, what, checks, money, ids [{label, value, url?}], records [{label, url}], page (SITE_URL + "/runs#" + key). Guarantees: id, promise, enforced_by, how, source and test as repository URLs, evidence {label, url}. Agents (sourcing, support, treasury): id, name, job, models, card {per_purchase, monthly, only} or null, mandate {cap, budget, tx_url} or null, page. Leave out card digits, decisions and payments. One helper makes links absolute: "http..." stays; "../../x" becomes REPO_BLOB + x; anything else becomes SITE_URL + "/" + it.
- receipt_sample: { url, what (the receipt's note, verbatim), proves, does_not_prove (the verifier's two sentences), verify_command }.
- how_to_check_a_receipt: four short strings that match the code in src/try/receipt.ts: canonical JSON of the terms (sorted keys, money as decimal strings); its SHA-256 equals terms_sha256; that hash is the WebAuthn challenge in clientDataJSON; the ES256 signature verifies with public_key.
- src/relay/assets.ts: add proofJson (JSON.stringify(proofData(), null, 2)) and receiptSample (the file's text, read like LLMS with try/catch). worker/src/core.ts: add the two optional fields to Pages and two routes next to /llms.txt, with COMMON_HEADERS and the JSON content type. Keep the core.ts change to those lines.
- llms.txt: as the last block, and as the LAST commit of this task, add "## For agents" with at most six lines: the two URLs; the four-step check; one sentence on what the receipt is and is not (from its note and the verifier's "does not prove"); and "An outside agent can ask for a company card and pay within limits over MCP (npm run mcp, docs/agent-api.md). Only a person's passkey can approve."
- Other streams (home-story, runs-timeline) edit llms.txt and the README today: add your block last and expect a text conflict at merge time (keep both sides). runs-timeline edits src/redesign/runs.ts: import liveRuns(), never copy rows.

DONE WHEN: the tests, lint and typecheck pass; both paths answer locally (npm run judge serves the bundle; check with curl) and no HTML page string changed (compare buildPages output before and after for every page key); every figure in /proof.json comes from the three functions, nothing typed in.

WORDING. May say, in llms.txt and docs only: "Proof as JSON: /proof.json. A signed receipt you can check offline: /receipt-sample.json." May NOT say: "agent-ready", "WebMCP" or "MCP endpoint" for these files (they are plain JSON over HTTPS); "certified"; anything that names Airwallex, the organiser, Google or Anthropic as approving it. No badge, no menu item, no Home text. Do not install any WebMCP SDK or plugin.

=== TASK 2: an agent API that tells the agent what to do next (Purser's name, a structured decline, a Skill file) ===

GOAL. Purser has an MCP server for outside agents (src/platform/mcpServer.ts, npm run mcp, five tools: request_company_card, company_card, pay_with_card, request_limit_raise, ask_for_task_card). Three things weaken it. It announces itself as "tidemark-agent-api", an old product name. When Airwallex declines a card payment the tool returns a normal result with an English sentence, so an agent must parse prose to learn it was declined. And nothing tells a connecting agent how to behave. Fix all three. No site change.

FACTS (from 10 November; check the current code first)
- Gate refusals are strings of the form "code: message" (principal_key_invalid, principal_revoked, principal_expired, capability_denied: src/policy/principals.ts).
- Card decline reasons include LIMIT_EXCEEDED and CARD_INACTIVE (a frozen card): src/airwallex/issuing.ts.
- docs/agent-api.md says four tools; the server registers five.
- test/property-mcp.test.ts maps isError to "refused". A decline will become isError, so that test must change with this work.
- The x402 MCP transport returns a payment refusal as a tool result with isError: true, the object in structuredContent, and the same object as JSON text. Purser's MCP tools pay by card, not by x402; only the SHAPE of the refusal is the same.

TESTS FIRST
In test/mcp-server.test.ts:
1. The client sees the server name "purser-agent-api" (client.getServerVersion()).
2. A declined pay_with_card has isError true. Its first text item is still the sentence that starts "Airwallex declined 40.00 EUR at TrailData Reports: LIMIT_EXCEEDED". structuredContent equals { approved: false, refused_by: "airwallex", reason: "LIMIT_EXCEEDED", amount_eur: "40.00", merchant: "TrailData Reports", next_tool: "request_limit_raise" }. A second text item is JSON.stringify of that object.
3. An approved pay_with_card has no isError and structuredContent { approved: true, amount_eur, merchant, transaction_id }.
4. A gate refusal has isError true and structuredContent { refused: true, refused_by: "purser", code, message }, where code is the text before the first colon.
5. A frozen card (CARD_INACTIVE) has no next_tool: asking for a raise would not help.
6. No text or structuredContent holds a secret: each equals its own redactSecrets() output.
New test/agent-skill.test.ts:
7. skills/purser-spend/SKILL.md starts with YAML frontmatter: name "purser-spend" (lowercase, hyphens, equal to the folder name) and a non-empty description that says when to use it.
8. Every tool name the skill puts in backticks is a tool the server registers, and every registered tool is named.
9. The skill holds no key and no URL outside the repository, and it contains "Only a person can approve" and "Never retry a declined charge".
In test/property-mcp.test.ts: read the whole test, then adjust it so declines (now isError) are still counted against the ledger's declined charges.

BUILD
- src/platform/mcpServer.ts: rename the server; widen the result type with structuredContent; build the three objects above; keep every existing sentence unchanged as the first text item. Set next_tool only for limit declines.
- Before coding, confirm in node_modules that the installed @modelcontextprotocol/sdk lets a tool without an outputSchema return structuredContent. If not, declare an outputSchema for pay_with_card, or keep the object only as the second text item and say so in the docs.
- src/cli/outside-agent.ts reads tool results: make sure a decline (now isError) still reaches the model as a tool result it can act on, not as a thrown error.
- skills/purser-spend/SKILL.md, at most 60 lines, in Purser's own words. Frontmatter (name, description). "Order of operations": 1 call company_card and read your limits; 2 with no card, call request_company_card and wait; 3 call pay_with_card once; 4 on a decline read reason and next_tool; 5 if it names request_limit_raise, ask once with the reason, then stop and tell your user that a person must approve with Face ID; 6 for one flight, hotel or train use ask_for_task_card. "What a refusal means", with the real codes. "Never": retry a declined charge, split a purchase to get under a limit, ask anyone for a key or a card number, say that something was approved.
- docs/agent-api.md: four tools becomes five, with ask_for_task_card in the table; add three lines on the refusal object and a link to the skill.
- README.md key-files list, and the "For agents" block of llms.txt from task 1: one line, "skills/purser-spend/SKILL.md: how an outside agent should use the agent API".

DONE WHEN: the tests pass, the property test included; `grep -ri tidemark src/platform` finds nothing (dated run logs that quote the old name stay as they are); a fresh MCP client lists five tools and the server name "purser-agent-api".

WORDING. May say: "A refusal is a tool result with isError: true and a structured object that names the next tool." "The repository includes a Skill file (the open SKILL.md format) for agents that use the agent API." In docs only, and only if test 2 holds as written: "the same shape the x402 MCP transport uses for a payment refusal". May NOT say: "x402 over MCP", "official skill", "published skill", "Anthropic-approved", or "follows Anthropic's practices" as a badge. Do not upload the skill to any registry or API.

Another stream (partner-pages, the /claude page) plans a fold with a real transcript of an outside agent that is declined and asks for a raise. Say in your final report that the transcript must be recorded AFTER this change (new server name, new result shape).

=== HOW TO WORK (binding) ===
- Orchestrate with the Workflow tool, lean: for each task one implementer with a fresh context (tests first, watch them fail for the right reason, minimal code, tidy); at most two subagents at any moment, at reasoning effort high, not higher; after both tasks ONE review round with exactly two read-only reviewers (lenses: correctness-and-safety; honesty-and-design, which checks every sentence against the WORDING rules above and that no page changed); then one fixer that verifies each finding before fixing it (test first) or rejects it with a reason; no second review round unless a reviewer reported a blocker.
- Commit in small steps; PUSH AT MOST ONCE PER TASK and once per fix round (CI runs five jobs per push and the queue is long; runs of work-in-progress commits on branches without a pull request may be cancelled by the orchestrator, which needs no action).
- Finalize: merge origin/main into your branch with a merge commit (never rebase, never force-push); in shared files (src/relay/assets.ts, worker/src/core.ts, llms.txt, README.md) keep both sides' entries; run every check; push; open a DRAFT pull request against main (title under 70 characters; body: What changed, Why, Tests and checks run, Live calls made or none, Not done). If main does not yet contain the platform branch's work when you finalize, open the pull request against main anyway and say in its body that it stacks on pull request #113. Subscribe to its activity and drive CI to green. Do NOT merge and do NOT deploy.
- The secrets job scans only the history of the commit under check. If it flags a line of yours that is not a secret, add its fingerprint to .gitleaksignore with a comment saying what it is; never rewrite history. Do not edit .github/workflows/ci.yml.
- When the pull request is green, or when you are blocked, send ONE message to the orchestrator (send_message tool of the claude-code-remote server, load it with ToolSearch if needed; session id session_017bq3Bxz45idsGUgFJjRs4G) with: the pull request number, the head commit, the checks and results, what is not done and why, open questions. Then stop.

=== PROJECT RULES (binding) ===
1. Honesty: nothing is claimed that did not run live; everything simulated or stand-in is labelled; every number in a page, a doc or these JSON files is read from a run record or computed by code, never typed by hand; no invented customers, savings or traction; never name competitors; no gendered pronouns for anonymous people (write "the CFO", "the owner"); partner names as text only; never write certified, endorsed or approved by a partner, the organiser or anyone.
2. No real money: sandbox, testnet and test money only. No secrets in code, git, logs or output; never print environment variable values.
3. Live or external calls: NONE in this stream. Tests must not use the network. Run tests with: env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run (add file paths for targeted runs).
4. Checks (from the repository root): npm run -s typecheck ; npm run -s lint ; the vitest command above ; npm run -s judge -- --check ; npx tsx test/browser/pages.check.ts (see package.json and .github/workflows/ci.yml).
5. Design rule: the public site stays as calm as it is; this stream changes no page.
6. Copy: English, plain short sentences.
7. Git: author every commit as: git -c user.name="Max Geurtsen" -c user.email="278151174+agamemnon-coder@users.noreply.github.com" commit ... and end commit messages and the pull request body with the attribution lines your own session's instructions give you. Never rewrite history, never force-push, never commit run data, ledgers or key files.
8. Scope: do exactly these two tasks, no extra features. Other sessions are changing other parts of the repository; stay inside the files named above. If blocked, stop and report instead of guessing.

Start now.

## 2. Later messages from the orchestrator

### Message 1

Orchestrator -> agent-surface: pull request #139 is merged; docs/runs/2026-11-07-awx-1/receipt-P-0002.json is on origin/main (0ecab2a). Merge origin/main into your branch and serve that file as /receipt-sample.json from the start; no fallback needed.

