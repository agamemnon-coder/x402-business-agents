# Resume instructions for branch x402-words-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3BwC6aedG2fWKZhHSvn, title "Purser · x402 in the protocol's own words (wire test, README, words table)") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You are one of several parallel Claude Code sessions building Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (track Kit 11). Submission is Saturday 14 November. An orchestrator session (session_017bq3Bxz45idsGUgFJjRs4G) coordinates the streams, merges pull requests and deploys; you build ONE small stream end to end and hand back a green draft pull request.

PRODUCT IN ONE LINE. AI agents (Claude) spend company money only within limits the CFO signs with Face ID (a passkey over the exact terms). The limit is enforced in layers that do not trust each other. Agents pay data sellers on Metal (a testnet) with the x402 payment protocol; the repository is called x402-business-agents.

REPOSITORY. agamemnon-coder/x402-business-agents. Your checkout is the branch `platform` (it is merging into main today; main is an ancestor of it). Create your branch `x402-words-1112` from it and push only there. Run `npm ci` first.

YOUR STREAM: x402 in the protocol's own words. One task. Why it matters: a judge who knows x402 well (one of the protocol's whitepaper authors may be among the organisers) will notice loose x402 wording or an untested claim at once. Purser uses x402 version 2 through Metal's facilitator. Three things would make a protocol-literate reader doubt it. (a) No test decodes the 402 offer Purser's own seller serves (the middleware is mocked in test/sale-settling.test.ts and stood aside in test/let-through.test.ts). (b) README.md says each query "is paid on Metal before it is answered", which is loose. (c) Two doc lines use x402 words in Metal's sense. Fix all three. Tests and docs only. No site change, no new dependency, no upgrade of @x402 (stay on the installed version; read it from package.json and node_modules).

FACTS (checked 12 November against the x402 specification at upstream commit f62a9fa and Purser's tree of 10 November; line numbers may have moved, so check the current code first)
- x402 version 2 HTTP headers: PAYMENT-REQUIRED (server), PAYMENT-SIGNATURE (client), PAYMENT-RESPONSE (server), each base64 JSON (specs/transports-v2/http.md in the x402 repository).
- The specification's default "authorization" flow is verify, resource, settle, respond. It lists "Client-side budget management" as out of scope and calls budget and spending controls "implementation-specific".
- Purser's buyer enforces the CFO's limit in the x402 client hook onBeforePaymentCreation (src/metal/pay.ts). The seller's mandate route answers 503 when its upstream purchase is refused, so nothing settles (src/servers/seller.ts header comment). The prepaid route (Metal's scheme "bajillion") commits money before the handler runs; it is Metal's scheme, not an x402 standard scheme.
- In x402's offer-and-receipt extension the SELLER signs the offer. In Purser, Metal's requireSignedOffer means the BUYER signs the order.
- If you want to read the specification itself: `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/x402-foundation/x402 /tmp/x402-spec` (public; read specs/ only; copy nothing into this repository). If the clone is refused, work from node_modules/@x402 and the facts above, and say so in your report.

TESTS FIRST (new test/x402-wire.test.ts, offline; copy the set-up of test/clearing.test.ts: vi.mock of @x402/core/server with test/support/facilitatorStandIn.ts, vi.stubEnv("METAL_RPC_URL", "http://127.0.0.1:1"), sellerApp(...).listen(0))
1. Seller offer. GET the mandate route with ?seq=1 and no payment. Expect status 402 and a PAYMENT-REQUIRED header. Decode it with decodePaymentRequiredHeader from @x402/core/http. Expect x402Version 2, resource.url set, and accepts[0] with scheme "exact", network "eip155:63825", amount as a string of digits, the *USDZ asset address, payTo equal to the option given, maxTimeoutSeconds a number.
2. The same for supplierApp's route (src/servers/supplier.ts).
3. Buyer request. With the fake-scheme set-up of test/contract/metal-facilitator.test.ts (real x402Client and wrapFetchWithPayment, fake signer), run payUnderMandate against a stubbed fetch that first answers 402 with an offer and then captures the retry. Expect the retry to carry PAYMENT-SIGNATURE and no X-PAYMENT, decoding to x402Version 2 with an "accepted" block equal to the chosen offer; expect the outcome to be read from PAYMENT-RESPONSE.
4. Unknown refusal. A settle answer with the specification's own reason "insufficient_funds" (not in Metal's list in pay.ts) is classed in_doubt, never refused.
5. README. In test/honesty-site.test.ts or the nearest README test: README.md does not contain "paid on Metal before it is answered" and does contain "leaves the payer's budget to the payer".
If tests like 1 to 3 already exist on the current branch, extend them; do not add a second file. Each test must be able to fail: say in your report which change in the code would make each one fail.

BUILD
- README.md, the fold about mandate, x402, terms hash and four eyes. Replace the x402 bullet with: **x402:** HTTP 402 "Payment Required" as a payment protocol (version 2). On the mandate route the seller checks each payment before it does the work and settles it on Metal before it sends the answer. The protocol leaves the payer's budget to the payer; in Purser that is the CFO's signed limit, checked before anything is signed.
- docs/metal-award.md: where it says "the signed offer in the x402 payment (signedOfferOf)", write "the buyer's signed order, carried in the x402 payment by Metal's mandate extension (signedOfferOf)".
- docs/metal-award.md, the section on x402 on Metal: add a table of at most eight rows with three columns (our word, x402's word, whose it is): exact on eip155:63825 (x402 standard scheme, CAIP-2 network); 503 and nothing settles (the authorization flow); prepaid clearing "bajillion" (Metal's scheme, not an x402 standard scheme; money is committed before the work, so Purser offers it only after a free price check); the buyer's signed order (Metal's requireSignedOffer; not x402's offer-and-receipt, where the seller signs); never paid twice (ERC-3009 nonce plus Metal's /settlements lookup; x402's payment-identifier extension is not used); the CFO's limit (the x402 client hook; budgets are out of scope for x402); not used (x402 over MCP, A2A, Bazaar, sign-in-with-x, upto, seller receipts); ran against (Metal's hosted facilitator on Metal testnet only). Add one row to the section's proof list: "x402 version 2 on the wire, tested offline: test/x402-wire.test.ts".
- For the rows on Metal's mandate extension key and the prepaid route's payment flow, read node_modules/@metalntwx/metal-pay first. If a detail cannot be confirmed in code, leave that detail out.
- docs/rules.md says "Dan Kim (VP at Airwallex, co-author of x402)" with no source. Change the bracket to "(Airwallex; a Dan Kim is listed as an author of the x402 whitepaper of 6 May 2025, x402.org)" or drop the bracket. This is an internal doc; nothing about this goes on the site or in the README.
- src/servers/supplier.ts still checks the version 1 header x-payment. Remove the check, or keep it with a one-line comment that says why. Touch test/contract/metal-facilitator.test.ts only if the removal needs it.
- Optional, only if the route type of the installed @x402/core accepts it and every test still passes: mimeType "application/json" on the two routes. If in doubt leave it out: it changes the live offer.
- Do not edit docs/metal-qa-2026-11-01-week.md or any other dated record: they say what was true that day.
- Then grep README.md, llms.txt, docs/claims.md, docs/submission/ and src/redesign/ for other x402 sentences and hold each to the WORDING rules below; fix only what breaks a rule, minimally, and list each change in your report. Do not change src/metal/pay.ts.

DONE WHEN: the tests pass and the new file needs no network; grep finds no "paid on Metal before it is answered" in README.md, llms.txt or docs/submission; docs/metal-award.md has the table and the test row, and every row is true for the code on the branch (cite the file for each row in your report).

WORDING (binding)
- May say: "x402 version 2 on Metal testnet, through Metal's facilitator." "The CFO's limit is checked in the x402 client hook, before anything is signed." "The x402 specification leaves client-side budgets out of scope; that is the part Purser adds."
- May NOT say: "x402-compliant", "x402-certified", "latest x402" (Purser pins a version and newer ones exist), "works with any x402 facilitator or network", "x402 says Purser is needed", "x402 over MCP"; never call bajillion an x402 scheme; never write "the signed offer" for Purser's payments without "the buyer's signed order". Never name the organiser or the x402 authors as approving anything, and never state on the site or in the README that anyone co-wrote x402. Nothing new on the site.

=== HOW TO WORK (binding) ===
- Orchestrate with the Workflow tool, lean: one implementer with a fresh context (tests first, watch them fail for the right reason, minimal change); at most two subagents at any moment, at reasoning effort high, not higher; then ONE review round with exactly two read-only reviewers (lenses: correctness-and-safety, which checks each test can fail and each table row against the code and the installed packages; honesty-and-design, which checks every x402 sentence in the diff against the WORDING rules); then one fixer that verifies each finding before fixing it or rejects it with a reason; no second review round unless a reviewer reported a blocker.
- Commit in small steps; PUSH ONCE when the task's checks pass and once per fix round (CI runs five jobs per push; runs of work-in-progress commits on branches without a pull request may be cancelled by the orchestrator, which needs no action).
- Finalize: merge origin/main into your branch with a merge commit (never rebase, never force-push); README.md and docs/metal-award.md are edited by other streams today (home-story: the README's first screen; runs-timeline: a docs truth pass): keep both sides; run every check; push; open a DRAFT pull request against main (title under 70 characters; body: What changed, Why, Tests and checks run, Live calls made or none, Not done). If main does not yet contain the platform branch's work, open it against main anyway and say in its body that it stacks on pull request #113. Subscribe to its activity and drive CI to green. Do NOT merge and do NOT deploy.
- The secrets job scans only the history of the commit under check. A base64 header in a test may be flagged: if a flagged line is not a secret, add its fingerprint to .gitleaksignore with a comment; better, build such values in the test at run time so nothing is flagged. Never rewrite history. Do not edit .github/workflows/ci.yml.
- When the pull request is green, or when you are blocked, send ONE message to the orchestrator (send_message tool of the claude-code-remote server, load it with ToolSearch if needed; session id session_017bq3Bxz45idsGUgFJjRs4G) with: the pull request number, the head commit, the checks and results, every wording change you made with its file, what is not done and why, open questions. Then stop.

=== PROJECT RULES (binding) ===
1. Honesty: nothing is claimed that did not run or is not in the code; everything simulated is labelled; no invented facts; never name competitors; no gendered pronouns for anonymous people; partner names as text only; never write certified, endorsed or approved by anyone.
2. No real money; no secrets in code, git, logs or output; never print environment variable values.
3. Live or external calls: NONE (the one public git clone of the x402 specification above is allowed). Tests must not use the network. Run tests with: env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run (add file paths for targeted runs).
4. Checks: npm run -s typecheck ; npm run -s lint ; the vitest command above ; npm run -s judge -- --check ; npx tsx test/browser/pages.check.ts.
5. Copy: English, plain short sentences. Word budgets enforced by tests stay hard.
6. Git: author every commit as: git -c user.name="Max Geurtsen" -c user.email="278151174+agamemnon-coder@users.noreply.github.com" commit ... and end commit messages and the pull request body with the attribution lines your own session's instructions give you. Never rewrite history, never force-push.
7. Scope: exactly this task. If blocked, stop and report instead of guessing.

Start now.

## 2. Later messages from the orchestrator

(none)
