# Resume instructions for branch home-story-1112

Written by the orchestrator (session_017bq3Bxz45idsGUgFJjRs4G) on 12 November 2026, about 12:50 UTC. The session that built this stream (session_017bq3BwbTkzsUcmcWTZvASL, title "Purser · home story + Watch removal (stream)") stopped because the model it ran on ran out of usage credits. Below, verbatim: (1) its first message (its full instructions), (2) every later message the orchestrator sent it, oldest first. Later messages override earlier ones where they differ.

## 1. Original instructions

ultracode

You are one of several parallel Claude Code sessions building Purser, the owner's entry for the Airwallex Agentic Banking Hackathon (track Kit 11). Submission is Saturday evening 14 November (Europe/Amsterdam). The owner (Max) asked for the whole build to be done with multi-agent workflows ("ultracode") at the highest quality, fast. An orchestrator session coordinates the streams, merges pull requests and deploys; you build ONE stream end to end and hand back a green draft pull request.

PRODUCT IN ONE LINE. AI agents (Claude) spend company money only within limits the CFO signs with Face ID (a passkey over the exact terms). The limit is not in a prompt: it is enforced in layers that do not trust each other (deterministic code, the CFO's signature, the rails' own controls: Airwallex cards and approvals, an on-chain Metal mandate per agent). Live site: https://kit11.max-31b.workers.dev. The public site is plain TypeScript that renders HTML strings (src/redesign/*.ts with the design system in src/redesign/ui.ts; pages are registered in src/servers/dashboard.ts, worker/src/core.ts pageResponse, src/relay/assets.ts buildPages and src/cli/judge.ts; word budgets and the menu are pinned in test/site-v4.test.ts, test/partner-pages.test.ts and test/browser/*.check.ts).

REPOSITORY. agamemnon-coder/x402-business-agents. Your base is the branch `platform` (it is being merged into main today; main is an ancestor of it). Work on the branch named in YOUR STREAM (create it from origin/platform). First run `npm ci` in the repository root (and `npm ci --prefix worker` if you need wrangler). Playwright with Chromium is pre-installed: do not install it again.
PRIVATE PLANNING FILES. Add the private repository agamemnon-coder/x402-business-agents-keys with the add_repo tool (read access) and check out its branch claude/charming-maxwell-pezr3l somewhere OUTSIDE your working repository. Read plans/2026-11-12/child-preamble.md (the full rules), plans/2026-11-12/jury-panel-1-verdicts.json (seven independent jurors judged the live site this morning; read the verdicts of first-time-visitor-phone, fintech-founder, llm-prescreen and airwallex-vp-product in full: their problems, fixes, what would make them say wow, and what to cut are your backlog) and plans/2026-11-12/maps/site-and-try.json (a map of how the site is built: read answers 1 to 8). Never copy anything from that repository into the public one, and never commit to it. If you cannot get access, continue without it using the rules below.

HOW TO WORK (binding)
- Orchestrate with the Workflow tool (or parallel subagents if it is not available): for each task in order one implementer with a fresh context (TDD: failing test first, minimal code, tidy; targeted tests while working, full checks at the end of the task; small commits, push after every commit); then the adversarial review lenses listed below, in parallel and read-only, each reporting only verified findings with a concrete failure scenario; then a fixer that verifies each finding before fixing it or rejects it with a reason; then one re-check round; then finalize.
- Finalize: merge origin/main and origin/platform into your branch with merge commits (never rebase, never force-push), resolve conflicts keeping both sides' behaviour (in shared registry files such as page lists, the menu and word budgets keep both sides' entries), run every check, push, and open a DRAFT pull request against main (title under 70 characters; body: What changed, Why, Tests and checks run, Live calls made or none, Not done; include before and after screenshots' paths). Subscribe to its activity and drive CI to green. Do NOT merge and do NOT deploy.
- When the pull request is green, or when you are blocked, send ONE message to the orchestrator session `session_017bq3Bxz45idsGUgFJjRs4G` with the send_message tool (claude-code-remote server; load it with ToolSearch if needed): pull request number, head commit, checks and results, what is not done and why, open questions. Then stop.

PROJECT RULES (all binding)
1. Honesty: nothing is claimed that did not run live; everything simulated or stand-in is labelled; every number on a page or in docs is read from a run record or computed by code, never typed by hand; no invented customers, savings or traction; never name competitors; no gendered pronouns for anonymous people (write "the CFO"); partner names as text only (no partner logos); never write certified, endorsed or approved by a partner. No founder biography or personal details of the owner.
2. No real money; no secrets in code, git, logs or output; never print environment variable values. No live or external calls in this stream; tests must not use the network. Run tests with: env -u KIT11_ANTHROPIC_API_KEY -u ANTHROPIC_API_KEY -u AIRWALLEX_CLIENT_ID -u AIRWALLEX_API_KEY -u METAL_RPC_URL -u METAL_ENDPOINT_SECRET -u T0_API_KEY npx vitest run
3. Checks: npm run -s typecheck ; npm run -s lint ; the vitest command ; npm run -s judge -- --check ; npx tsx test/browser/pages.check.ts ; npx tsx test/browser/redesign.check.ts ; npx tsx test/browser/trysign.check.ts.
4. Design rule: as clean and calm as the site is now, or calmer: more proof, not more text; one story per page; a menu of at most 5 items; progressive disclosure (result first, details on click, ids and hashes last); word budgets enforced by tests stay hard (Home at most 250 visible words); one design system (existing tokens, components and motion vocabulary only); every change checked at 390 and 1440 px, light and dark, reduced motion, keyboard focus. Ask of every screenshot: calmer or busier than before? Busier means redo.
5. Copy: English, plain short sentences a CFO understands.
6. Git: author commits as git -c user.name="Max Geurtsen" -c user.email="278151174+agamemnon-coder@users.noreply.github.com" commit ... and end commit messages and the pull request body with the attribution lines your own session's instructions give you. Never rewrite history or force-push.
7. Scope: exactly your stream. Other sessions are changing other parts at the same time: another stream adds a fifth menu item 'More' (Pricing, Security, Docs, Status and the partner pages) and four new pages; another rewrites /visa; another rewrites /airwallex, /metal and /claude; another rebuilds /runs and /proof and updates the 'two locks' run to PAID; another builds a new hands-on demo that will replace /try/sign behind the Try tab. Do not edit those pages or src/try, worker/src/trySign.ts, src/redesign/partners.ts, src/redesign/runs.ts or src/redesign/proof.ts.

YOUR STREAM: home-story. Branch: home-story-1112 (from origin/platform).

WHY. The owner said: the Watch page is really outdated, it is also at the bottom of the home page, and it has to go. Jurors said: in 5 seconds Home works ("AI agents spend. You sign off."; the one-cent REFUSED moment is the best 20 seconds of the entry), then the site spends the rest of a judge's three minutes on run dates, caveats and a replay nobody can follow; the heading "The agents' live run" sits on a nine-day-old replay; Home carries a mixed Visa message; the README's first screen says the pitch four times under eleven badges; stale documents contradict the README; the bold worst-case headline leaves out the largest exposure. Home must become ONE story a first-time visitor understands on a phone in under a minute, with a real moment they cause themselves.

TASKS (in this order)
1. home-one-story. Rebuild Home (src/redesign/home.ts, src/redesign/heroDemo.ts) as one story, top to bottom: (a) the headline and one sentence (keep the pinned first-screen sentences in src/config/brand.ts unless a juror's point requires a change; if you change one, update every place that pins it); (b) the hero IS the proof: a small widget in which the visitor changes the amount or the IBAN of a REAL approval and sees the signature stop matching, verified for real in the browser with WebCrypto, with no Face ID and no navigation. Use a real recorded approval if the repository holds everything a browser needs to verify it (terms, public key, authenticator data, client data and signature: look at src/try/receipt.ts and src/try/verify.ts, which already verify such a receipt in the browser, and at the run records under docs/runs and docs/demo); say on the widget exactly what it is (which run, which date, test money) and show both hashes when it fails. If no recorded approval is complete enough, build the sample at build time with a labelled test passkey and say so on the widget. No canned animation that only pretends: the verdict must come from the real check. (c) How it works as ONE calm animation or strip of four steps: invoice in, agents read and check, the CFO signs the exact terms, paid, booked and proven; reuse the existing motion vocabulary. (d) 'Three locks' on one phone screen without scrolling: Airwallex declined a card (the transaction or card id from the run record), Metal refused on chain (the transaction link), the CFO's signature (the hash), each one tap to the partner's own record; all read from the run records. (e) Two buttons only: 'Try it yourself' (the Try tab) and 'See the proof'. (f) One line and one link for the product for small companies only if the constant for a public demo URL is set; leave the constant unset and the line hidden for now.
   REMOVE from Home: the Watch block at the bottom (the replay under the heading "The agents' live run") and every other reference to Watch; the mixed Visa wording (Home must not say both 'entered for the Visa Award' and 'not an award entry'; say one true thing or nothing; the Visa page owns the detail). Keep Home within 250 visible words and calmer than today. Screenshots before and after at 390 and 1440 px, light and dark.
2. watch-out-of-the-menu. Take the Watch tab out of the main navigation in BOTH definitions (src/redesign/ui.ts TABS and src/ui/nav.ts NAV_MAIN) and out of every page's links and the judge tour; the old Watch page is not deleted but leaves the menu: it stays reachable only from the archive on Proof as 'Replay of the main run, 3 Nov' (do not edit proof.ts: if the archive link already exists nothing is needed; otherwise list it under Not done for the stream that owns Proof), and its own heading must say plainly that it is a replay of the 3 November run. Update the tests and checks that pin the tabs (test/site-v4.test.ts, test/partner-pages.test.ts, test/browser/redesign.check.ts, test/browser/pages.check.ts). Another stream is adding a fifth item 'More' at the same time: write your changes so that the merged result is Home, Try, Proof, More; if that stream has not merged when you finalize, your branch has Home, Try, Proof and the pull request says so.
3. readme-first-screen-and-stale-docs. (a) README.md first screen: the pitch once, at most five badges, a 'For reviewers in 30 seconds' block (what it is, what ran live with the three strongest proofs and their ids, how to try it, how to verify offline), then the rest. Keep every sentence that tests pin or update the tests consistently. (b) The worst-case headline: the bold number must be the real ceiling an agent can spend without the CFO, including task cards per day and the on-chain budget, computed by the same code the page uses (src/policy/exposure.ts or wherever the exposure is computed), with the fold explaining the parts; never a smaller number in bold than the fold reveals. Fix it wherever it appears (README, site, llms.txt). (c) docs/claims.md: its opening table must agree with the README and the site, every number traced to its run record; where two numbers describe different runs, say which run each is. (d) docs/claude.md is stale and contradicts the README: rewrite it from the current code and docs/agent-evals.md (real tool-use agents, code gates, labelled fallbacks, evals per model with cost, the published model failure), or replace it with a short pointer page; no sentence may describe the agents as a document reader only. (e) The README's Visa sentences must match the run record (the 7 November Airi run was a scripted purchase with a person's passkey taps and no model call; say so). (f) llms.txt: the same corrections in its summary. Do not touch the sentences about the 'two locks' run or the product-for-small-companies wording: other streams own those lines.

REVIEW LENSES
- jury: judge the result as the first-time visitor on a phone, the fintech founder and the automated pre-screener from the verdicts file would: after 5 seconds, 30 seconds and 2 minutes, what do they understand; did each of their red and yellow points about Home, Watch, the README's first screen and stale docs get resolved; is anything they loved lost (the headline, the one-cent moment, the honesty)? Is the entry better, or only busier?
- honesty: every sentence and number on Home, in the README's first screen, docs/claims.md's opening and docs/claude.md is true against the run records and the code; the hero widget's check is real and labelled for what it is; the worst-case number is the real ceiling; nothing implies endorsement; no founder biography.
- design: LOOK at Home at 360, 390, 768 and 1440 px, light and dark, reduced motion: one story, calm, no overflow, the widget usable with a thumb and a keyboard, focus visible, contrast sufficient, word budget met, the same components and motion as the rest of the site.
- correctness: routes, CSP hashes, the build with TRY_SIGN_ENABLED on and off, the judge command, the browser checks and the link check all pass; the menu tests pin the new tabs; no dead links to Watch; the widget's verification code is covered by tests, including a tampered amount, a tampered IBAN and an untouched receipt.

## 2. Later messages from the orchestrator

### Message 1

Addition from the orchestrator for the home-story stream (same rules, same branch). The jury panel's ranked action list is now in the private planning repository: plans/2026-11-12/jury-panel-1.json (pull the branch claude/charming-maxwell-pezr3l again). Treat these of its actions as acceptance criteria of your stream, with their exact acceptance sentences: 'Home never calls a replay live and carries one provenance line', 'Watch leaves the menu and the judge tour', 'The worst-case headline is the true ceiling, task cards included' (compute the true ceiling with the tested exposure function and show it identically in the README, the site and llms.txt; do not change the policy itself), 'README under 150 lines with one first screen' (you own the first screen and the structure; leave the two-locks sentences and the product-for-small-companies status sentences to their streams), 'Remove the stale docs that contradict the README' for docs/claude.md and the first section of docs/claims.md only, 'Tap targets of 44 px on the phone' (minimum height 44 px for links, buttons and fold headers at phone widths across the shared header, footer and Home, guarded by a browser check), and 'Cause the one-cent refusal on Home without Face ID' (your hero widget; it must replace a step of the existing hero, keep one animation and keep the hero's fourth step that jurors loved: EUR 240.00 becomes 240.01, REFUSED, hash no longer matches). Also honour the list things_to_keep in that file: nothing on it may be lost. Do not write any founder biography or founder lines; the owner supplies those later. No reply needed; include these in your final report.

### Message 2

Note from the orchestrator (home-story stream; no reply needed). The CI job 'secrets' currently fails on every pull request for a reason outside your stream: its whole-history gitleaks scan reads every remote branch, and two test fixtures on spike branches (commit 9047e7d, files under spike/do-runtime/) are flagged. Pull request #135 adds their fingerprints to .gitleaksignore on main; once it is merged, merging origin/main into your branch (which your finalize step does anyway) makes that job green. Do not spend time on those two findings, do not edit .gitleaksignore for them yourself, and treat a red 'secrets' check that lists only spike/do-runtime files as not yours until you have merged main. Any OTHER finding is yours.

### Message 3

Orchestrator to home-story. Answers to your two points, then the pasted jury material you asked for.

1) HERO WIDGET: build your DEFAULT (one animation; step 4 is the visitor's own change, verified for real in the browser with WebCrypto; labelled sample signed once with a test key; one provenance line). Add one requirement: the sample must be a receipt file in the repository's own format (purser.try-sign-receipt/v1, the one src/try/receipt.ts and npm run verify-receipt check) and the widget must read everything from that file, so that swapping the file for another valid receipt needs no code change. Reason: a COMPLETE receipt of the real EUR 240.00 approval of 7 November (the owner's own passkey) exists in the private ledger and verifies VALID offline; whether it is published is the owner's decision and still open, so do not wait for it and do not reference it. Shape the sample's terms like that approval's terms so the swap is trivial: an object with the string fields schema ('kit11.approval-terms/v1'), kind ('invoice_payment'), proposal_id, expires_at, invoice_no, vendor, amount ('240.00'), currency ('EUR'), fee_max, beneficiary_id, beneficiary_name, iban_last4, bic, method ('SWIFT'), reference, reason, transfer_request_id, conversion (null), the objects balances_before, floors and after (string values), and evidence (an array of {type, ref, sha256}). The widget edits amount and iban_last4 (label it 'IBAN, last 4'). Do NOT take the alternative with the EUR 4.84 approval.

2) You cannot read the private repository: understood, do not retry. Here is what you need from it.

ACTIONS THAT ARE YOURS (jury panel round 1), each with its acceptance:
[P0] Home never calls a replay 'live' and carries one provenance line. WHAT: the heading 'The agents' live run' sits directly above 'Replay of the main run, 3 Nov'; the first screen and a half also show two runs, two dates and two transfer ids, and the word 'simulated' three times. Drop that block, keep one provenance line with a 'What's real?' link, replace the hedged card ('simulated charge') by three proof rows (Airwallex declined, Metal refused on chain, the signed hash in Airwallex's record), and add one reassurance line under the button (a throwaway test passkey, no account, no money, about a minute). ACCEPTANCE: no heading on Home contains 'live' unless its content is read live. The first two phone screens show one transfer id and one date. Outside the 'What's real?' fold, 'simulated' and 'test money' each appear at most once. The Home word-budget test passes, and the 390 px and 1440 px screenshots are calmer than today's.
[P0] The worst-case headline is the true ceiling, task cards included. WHAT: README lines 135 to 147 state in bold 'Worst case, set by policy: EUR 300 on cards + USD 20 on chain a month', then add that task cards may reach EUR 900 a day and are not counted. State the true ceiling (do not change the policy). ACCEPTANCE: the bold worst-case sentence in the README is the output of exposureOf in src/policy/exposure.ts and includes task cards. test/exposure.test.ts asserts that exact sentence. The worst-case label in the Try demo and the dashboard show the same figure (for the Try demo change only the shared constant or function it reads, not src/try pages; if that is impossible list it under Not done).
[P0] Remove the stale docs that contradict the README: YOUR PART is docs/claude.md and the opening of docs/claims.md only (another stream takes the rest). WHAT: docs/claude.md describes a document pipeline, 23 calls and 'The demo makes the same decisions with or without an API key'; docs/claims.md opens with the 30 October numbers (106 payments, 8 stops) although it is listed as a key file. ACCEPTANCE: 'grep -rn "same decisions with or without an API key" docs' returns nothing. The call counts and costs in docs/claude.md equal docs/demo/main-run.json. docs/claims.md opens with the main run and its 'Last checked' date is not older than its newest claim. The claims and link check in CI passes.
[P1] Watch leaves the menu and the judge tour. WHAT: a newcomer cannot follow /watch: the effect comes before the cause, raw agent text with tool names, 14 steps of about 8 seconds where /judge promises 40 seconds. Remove the tab and the Home block. ACCEPTANCE: the menu has at most five items and no Watch. /judge no longer starts with the replay. If /watch still exists it shows no proposal numbers or tool names outside a fold and its heading says it is a replay of the 3 November run (a full rework of /watch to five steps is NOT required of you).
[P1] README under 150 lines with one first screen. WHAT: the README is 427 lines; the pitch appears four times before line 125 under eleven badges and three competing links. First screen: title, two sentences, one line of links, a five-row table (Airwallex, Metal, Visa, Claude, x402: what ran, one id), one line on what is simulated and who built it. Move the per-run sections to docs/runs/ (link them), name runs in plain words, gloss T:0, Airi and VIC on first use, label TAP under 'Visa:' as an extra, and make the counts agree. ACCEPTANCE: 'wc -l README.md' gives at most 150. One badge row. A search of the README for 'awx-1', 'vic-2', 'rel-1' and 'main-1' finds nothing. The section 'Why this is a company' starts within the first 60 lines. The link check passes. (Keep the two-locks sentences and the small-company status sentences byte for byte, as you said. 'Who built it' stays the existing neutral credit line: no founder biography.)
[P1] Tap targets of 44 px on the phone. WHAT: measured below 44 px at 390 px width: menu links 37 px, the hero's secondary links 23 px, /judge checkboxes 26 px, id links 16 to 19 px; the hero's fourth tab reads 'refused' in lowercase and looks like a product failure. ACCEPTANCE: a browser test at 390 px asserts a height of at least 44 px for every link, button and fold header in the menu, the hero and /judge (the /proof part belongs to another stream). The fourth tab reads 'Refused' or '+1 cent'.
[P2] Cause the one-cent refusal on Home without Face ID. ACCEPTANCE: on Home, one tap changes 240.00 to 240.01 and shows both hashes and 'refused', with no network call and no added section.
[P2] Home details: at 1440 px the headline breaks mid-sentence (it must break after 'spend.'); amounts appear without a currency ('0.04 per query'): every amount on Home has a unit; the 'Kit 11' chip is jargon; footers have dead space.

THINGS TO KEEP (nothing on this list may be lost):
- The sentence every juror repeated: 'An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless.' On Home, in the README and in the form.
- Home's first phone screen: 'AI agents spend. You sign off.', one sentence, one button. The phone visitor scored it 9.
- The hero animation's fourth step: EUR 240.00 becomes 240.01, 'REFUSED', 'Hash no longer matches'.
- The honesty: 'Test money. Simulated: customer, supplier, settlement, second approver.', 'no customers yet', failed attempts kept in the run logs, the public list of controls not in place. Every juror scored honesty 7 to 9; relocate caveats, never soften them.
- The published model failure (Haiku as Support, 0 of 10, every call refused by code) and the found-and-fixed relay of a planted address between agents.
- 'Claude decides the exceptions; routine buying and selling per query is code', the labelled fallbacks, and the cost caps in code.
- The README paragraph 'Why not Airwallex's own approvals?' and 'How it works in 5 files' with line links.
- Verification without keys: 'npm ci && npm run judge', the offline receipt check, the hash-chained audit log.
- /judge as a short timed tour.
- The site's craft: one HTML file and one font per page, no overflow at 390 px, clean dark mode, no Visa logo and no implied endorsement.
No reply needed.

### Message 4

Orchestrator to home-story: you were paused because the account's usage limit was being consumed too fast across all sessions. Please CONTINUE your stream now, in LEAN MODE (binding from here on): (1) at most two subagents running at any moment; (2) subagents at reasoning effort 'high', not higher (set opts.effort 'high' in agent() calls or the equivalent); (3) after implementation run ONE review round with exactly two reviewers: 'jury-and-honesty' and 'design-and-correctness' (merge the four lenses of your brief into these two); (4) no second re-check round unless a reviewer reported a blocker; (5) targeted tests while working, the full checks once before the pull request; (6) do not re-read what you already know. Scope, rules, the hero-widget decision and the jury acceptance list I sent stay exactly as they are. Report as briefed when the draft pull request is green.

### Message 5

Orchestrator to home-story: one more jury action belongs to your files (README's first screen, llms.txt summary, Home); same rules, same lean mode; no reply needed.
[P0] One honest sentence about buyer, quotes and traction. WHAT: the only CFO quote says the product is not for that CFO's company, yet llms.txt labels it 'Customer voice' one line after 'no customers yet'. The headline's buyer (a CFO whose agents already pay) is contradicted by the entry's own source. Reframe the quote as a finding (companies with an ERP approval flow do not need this; the CFO pointed us at smaller companies), label both quotes 'Finance conversations (2, not customers)', and use ONE sentence everywhere that joins today's product (a small company's supplier invoices, paid through Airwallex after the owner signs the exact terms) with tomorrow's (every agent that spends). Add the ask for design partners in one line. ACCEPTANCE (your part): 'Customer voice' appears nowhere in the repository; Home, the README's first screen and llms.txt carry the same buyer sentence, pinned by one test that reads a shared constant; the two quotes keep their exact words (they are quotes: change only the label and the framing sentence around them) and stay anonymous, with no name or employer anywhere; the traction sentence says plainly: no customers yet, two finance conversations. NOT yours: the submission form text (docs/submission/README.md), which gets its own final pass later; the founder lines (the owner supplies them); the link from Home to a public demo world stays behind its unset constant.

### Message 6

Orchestrator note to all streams (12 Nov, 12:10 UTC). About CI load, not about your scope. No reply needed.

1. GitHub runs five jobs on every push of every branch. Sixteen streams pushing after every commit keep the queue more than 20 minutes deep, so pull requests wait. From now on: keep committing in small steps, but PUSH AT MOST ONCE PER TASK (after that task's own checks pass) and once per fix round. Tell every new implementer and fixer so: it replaces "push after every commit" in your rules.

2. To let pull request runs through, I cancel CI runs of work-in-progress commits on branches that have no pull request yet. A cancelled run on such a commit is expected and needs no action. Once your pull request is open, the checks of its head commit are not cancelled by me.

3. The secrets job scans every remote branch. A line in YOUR branch that gitleaks takes for a key (a list of setting names containing KEY or TOKEN, base64 in a fixture, a sample signature) turns that check red on EVERY pull request. Before your final push, read your own diff for such lines. Where you can, write them so the scanner does not match (for example build the name from two parts); where you cannot, put the file, line and commit in your final report so the fingerprint can be added on main. Never rewrite history for it. (Your sample receipt docs/demo/hero-receipt.json, line 56 at commit a97ac3b, is already accepted on main since pull request #136.)

### Message 7

Orchestrator -> home-story. OWNER DECISION, 12 November: the owner agreed (asked twice, answered "ja" both times, the second time at about 13:12 Amsterdam to the direct question whether his real Face ID proof of 7 November may be published on the home page) to PUBLISH the real receipt of his own Face ID approval of 7 November (run awx-1, proposal P-0002, EUR 240.00 to Stockline Data GmbH). Home's "one cent" check must run on this real signature instead of the labelled sample. The JSON at the end of this message is the file exactly as `npx tsx src/cli/verifyReceipt.ts` reports VALID for it. It is public data by design (the terms as signed, the passkey's public key, the credential id, the WebAuthn assertion). It holds no secret.

Do this inside your stream, before finalize (same rules as before: tests first, calm page, nothing claimed that did not run):

1. Add the file at docs/runs/2026-11-07-awx-1/receipt-P-0002.json (the path its own "verify" field names). Make the hero read it: either point src/redesign/heroReceipt.ts at that path or keep docs/demo/hero-receipt.json as a copy. Your call, but one source: if two files exist, a test holds them byte-equal.

2. Labels: it is no longer a sample. Say exactly what it is, in the words of the receipt's own "note": the owner's own passkey on an iPhone (Face ID as stated by the owner; the server checks no attestation), live in the Airwallex sandbox with test money, the payment already executed on 7 November 2026. Keep ONE provenance line and the What's real? link. No new blocks on Home.

3. The check stays a real in-browser WebCrypto verification of THIS receipt: unchanged terms verify; +1 cent, a changed IBAN or a typed amount are refused, with both hashes shown. The real terms have more fields than the sample (balances_before, floors, after, evidence, conversion: null). Your canonical hashing must reproduce terms_sha256 = b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb exactly, and the ES256 signature must verify against clientDataJSON + authenticatorData as WebAuthn defines it (the challenge inside clientDataJSON is the terms hash). Test both in Node and in the browser check.

4. docs/runs/2026-11-07-awx-1.md (near line 279) says: "No secret, view key, viewer link, enrolment code or passkey credential is in this log, the record or the commit." That sentence stays true for the 7 November commit. Add ONE dated sentence after it: on 12 November 2026 the owner chose to publish this approval's receipt (public key, credential id and assertion: public data, no secret) at the path above, so anyone can verify the signature offline. Grep for other places that say no passkey data is public ("passkey credential", "sanitised") and make each one true the same way, minimally.

5. The sample generator (npm run hero-receipt) may stay as a test fixture path if useful, but the shipped Home uses the real receipt. If the real file is missing or invalid, the hero disappears, as now.

6. gitleaks may flag the new file, as it flagged the sample (line 56). If the secrets job flags it, add the fingerprint line(s) to .gitleaksignore with a comment that says what it is (the public WebAuthn assertion of a published receipt). Main has the sample's fingerprint since pull request #136; merge origin/main at finalize as planned.

7. Where README, llms.txt, docs/claims.md or the What's real? page describe the hero or the one-cent proof, say it runs on the owner's real signature of 7 November. No other wording changes.

Report as before when the pull request is green. The receipt:

```json
{
  "receipt": "purser.try-sign-receipt/v1",
  "note": "Airwallex-only run awx-1 (live, Airwallex sandbox, test money), 7 November 2026: the licence invoice SLL-2026-11, EUR 240.00 to Stockline Data GmbH (a test supplier). Approved on the relay with the owner's own passkey on an iPhone (Face ID, as stated by the owner; the server checks no attestation). The terms are exactly as signed.",
  "terms": {
    "schema": "kit11.approval-terms/v1",
    "kind": "invoice_payment",
    "proposal_id": "P-0002",
    "expires_at": "2026-11-07T12:31:13Z",
    "invoice_no": "SLL-2026-11",
    "vendor": "Stockline Data GmbH",
    "amount": "240.00",
    "currency": "EUR",
    "fee_max": "20.00",
    "beneficiary_id": "46c2bbca-8b37-4ac9-ad3e-ef975dd35eeb",
    "beneficiary_name": "Stockline Data GmbH",
    "iban_last4": "2051",
    "bic": "BYLADEM1001",
    "method": "SWIFT",
    "reference": "SLL-2026-11",
    "reason": "professional_business_services",
    "transfer_request_id": "0439af88-a9c7-45f6-8d15-d15f66b70f0e",
    "conversion": null,
    "balances_before": {
      "eur_available": "9968920.73",
      "usd_available": "9995334.64"
    },
    "floors": {
      "eur_floor": "25000.00",
      "eur_obligations": "9942420.73",
      "usd_floor": "9990334.64"
    },
    "after": {
      "eur_free": "1240.00",
      "usd_available": "9995334.64"
    },
    "evidence": [
      {
        "type": "invoice",
        "ref": "SLL-2026-11",
        "sha256": "004ee3b21920ab1cce16af31e383be6225310efb9f61132f9449fc9117a909f9"
      }
    ]
  },
  "terms_sha256": "b0f075d94da077084d7fc6745f99e2c2253548d967e9c0413bffa9748dbbf7bb",
  "algorithm": "ES256",
  "public_key": {
    "kty": "EC",
    "crv": "P-256",
    "x": "XH_en21ezQ05quXpoKsR8Pc-5Nb6gQGji_JWY4hlwiI",
    "y": "T9xRr9o9gS5vfrF-YjbPI2zAS6A6AVuFqXod4FJ4wCY"
  },
  "credential_id": "GOvzfcV_7gRwPYxsbM1cN3TudEE",
  "rp_id": "kit11.max-31b.workers.dev",
  "origin": "https://kit11.max-31b.workers.dev",
  "assertion": {
    "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoic1BCMTJVMmdkd2hOZjhaMFg1bml3aVUxU05sbjZjQkJPXy1wZEkyNzk3cyIsIm9yaWdpbiI6Imh0dHBzOi8va2l0MTEubWF4LTMxYi53b3JrZXJzLmRldiIsImNyb3NzT3JpZ2luIjpmYWxzZX0",
    "authenticatorData": "Z25uI6ub1RwUR-JksUdeKxBD5kUJLernzQx15CB8arIdAAAAAA",
    "signature": "MEUCIH5kropYKfqMHOXjCtM3BI3uhRosibwZ_7ateiF7RwpdAiEAxjh_rg-9kRXy8vu-PFdObgiJGY6O0KaX6L-8BsC2YTo"
  },
  "verified_by_server_at": "2026-11-07T12:12:20.250Z",
  "verify": "npm run verify-receipt -- docs/runs/2026-11-07-awx-1/receipt-P-0002.json"
}
```

The file ends with one newline after the closing brace.

### Message 8

Orchestrator -> home-story. You were right to refuse a relayed approval. I hold the owner's answer first-hand (he answered my direct question in this session), so I am publishing the file myself, your option (a): pull request #139 against main, branch receipt-p0002-1112, commit cb0086e, adds exactly one file, docs/runs/2026-11-07-awx-1/receipt-P-0002.json (byte-identical to the JSON I sent; `npm run verify-receipt` says VALID; gitleaks 8.24.3 finds nothing in it, so no fingerprint is needed). I merge it as soon as its checks are green and will send you one line then.

Until that line arrives, keep the labelled sample and go on with your tasks. When the file is on main: merge origin/main into your branch at a task boundary and do the seven points of my earlier message inside your stream (the hero reads that path as its one source; labels in the receipt note's words; the Node and browser tests for the hash b0f075d9... and the signature; +1 cent, IBAN and typed amount refused with both hashes; the ONE dated sentence in docs/runs/2026-11-07-awx-1.md and the other "no passkey data" places; README, llms.txt, claims.md and the What's real? fold). I did not touch any doc: those are yours.

Also for your finalize: main's CI workflow changed today. The owner limited the whole-history secrets scan to the commit under check (--log-opts=HEAD). His edit missed a space; pull request #138 repairs it and merges shortly. If your secrets check fails with dozens of old findings after you merge main, main did not have #138 yet: merge main again, do not edit .github/workflows/ci.yml yourself.

### Message 9

Orchestrator -> home-story: #139 is on main (0ecab2a). docs/runs/2026-11-07-awx-1/receipt-P-0002.json is in the repository. Merge origin/main at your next task boundary and do the seven points.

