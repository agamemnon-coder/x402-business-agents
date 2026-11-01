# Purser: requirements QA (independent review, 1 November 2026)

Project: `/home/user/x402-business-agents`, Airwallex Agentic Banking Hackathon, Starter Kit 11, Metal Award.
Reviewer rules: no project files edited. No calls to Airwallex, Metal or Anthropic. No secrets printed.
Legend: ✅ met, with evidence · 🟠 partly met, unverified, or still to do · ❌ not met today

---

## 0. Missing or blocking now (read this first)

| | Item | Why it blocks | What closes it |
|---|---|---|---|
| ❌ | **Final video and its link** | The microsite asks for "a short video walkthrough under five minutes". Only a silent animated master exists (`out/video/master.mp4`, 173.0 s by ffprobe). The voiced or hybrid cut is not recorded. `docs/video/hybrid-script.md` runs 4:10 and says "cut 15 s". `docs/submission/README.md` still has a placeholder for the video link. | Record, cut and upload one video (unlisted YouTube), then fill in the link. |
| ❌ | **Public repository link** | GitHub API: `private: true`. The default branch `main` holds only `README.md`, from the "Initial commit" of 29 Oct (73d642e). All work sits on `build/next`, 355 commits ahead. GitHub reports `license: None`, because `LICENSE` is not on `main`. If the repo goes public as it is, judges land on an empty `main`. | Merge `build/next` into `main` (or make it the default), run gitleaks, make the repo public, then fill in the link. |
| ❌ | **Open source ("all code needs to be in public domain")** | HackerEarth generic FAQ. The repo is private today. | Same as above. |
| 🟠 | **HackerEarth submission itself** | Not submitted. The form is behind the HackerEarth login, so its real fields could not be checked. | Submit by Thu 12 Nov as planned. |
| 🟠 | **Source zip is stale** | `out/submission/purser-source.zip` was written 31 Oct 09:46 (605 files, 25.2 MB unpacked, no `.env`, no sqlite, no keys). HEAD is 414351d from 1 Nov 06:11. | Rerun `npm run submission` on the final commit. |
| 🟠 | **Deadline conflict between official sources** | Microsite: "Nov 13 Project submissions due." (no time, no time zone). HackerEarth event data, read today: Build Phase "Oct 27 – Nov 15, 2026, 4:30 AM – 6:29 PM · UTC" (`end_date 2026-11-15T18:29:00Z`). `docs/rules.md` says "Nov 13, 18:29 UTC", which the event data no longer supports. | Treat Nov 13 as binding. Submit 12 Nov. Ask in Slack or at support@hackerearth.com which date counts. |
| 🟠 | **Hosted relay health** | `https://kit11.max-31b.workers.dev/health` answered **503** today (by its own design, an alarm or a runner that stopped syncing). `/`, `/film`, `/metal`, `/demo` and `/try` answered 200. | Start the runner (`npm run relay`) and keep it up until 19 Nov. |
| ✅ (later 1 Nov) | **An Airwallex id on the dashboard was never read back** — read back with `npm run awx-readback` (GET only): `7edb809a…` is the support card's 19.99 EUR charge, FAILED (the MCC decline). Record: `docs/runs/airwallex-readback.json`. Earlier text: | `docs/demo/snapshot.json` feed seq 168 shows `awx_id 7edb809a-48d4-440e-ab1f-3805645fd605` for the MCC decline. `docs/data-qa.md` notes it is *not* the ledger's id; the ledger's id is `01a18bb9-6320-…2c13`, and that one was verified. | Show the ledger's id, or verify this one read-only. |
| ✅ (later 1 Nov) | **Judge-facing docs cite unverified rehearsal ids** — every full id in airwallex.md, requirements-matrix.md, metal-award.md, data-qa.md, claims.md and snapshot.json was read back with GET (`npm run awx-readback`): 12 found, among them conversion `0650049f…` SETTLED, transfers `260638bd…`, `26954165…`, `c443a5da…` PAID, deposits `03d9d67d…`, `e49d68f2…` SETTLED, a quote and a beneficiary (shown only as existing). The 4 card transactions `01a18bb9…`/`01a18bbb…` do not answer a GET by id or the unfiltered list; data-qa verified them through the card's list on 31 Oct (4a). Earlier text: | `docs/airwallex.md` and `docs/requirements-matrix.md` cite the 29 Oct rehearsal ids, not the Friday ids that data-qa verified. See section 4. | Swap in the Friday ids, or add a read-only check for the rehearsal ids. |

---

## 1. Sources: what was fetched, and what each one says

| Source | Fetched? | What it actually contains (verbatim where quoted) |
|---|---|---|
| https://airwallex.hackerearth.com/ (microsite) | ✅ raw HTML, read in full | Deliverables: "A working demo, a short video walkthrough under five minutes, and a link to your repository with setup instructions." Metal Award $15,000: "Requires use of Metal and Airwallex tooling". Timeline: Oct 27 "Official hackathon build period begins."; Nov 13 "Project submissions due."; Nov 15 "Finalists are selected."; Nov 19 "Demo Day in San Francisco (remote participation optional)." Eligibility: "aged 18 and over, anywhere in the world". Team: "Enter on your own or form a team of up to four." IP: "You retain full ownership … Submitting only grants us permission to showcase your work". Kit 11 card: "Run three agents from one account. Rebalance limits when supplier costs rise. Setup: Funded Metal testnet wallet". Metal partner: "L1 blockchain, docs, nodes, faucet, wallets + Slack support". **The page has no judging criteria, no rules document and no link to a submission form.** |
| https://www.hackerearth.com/community/challenges/hackathon/agentic-banking-hackathon/ | ✅ HTTP 200 today (`docs/rules.md` says HTTP 500 on 29 Oct) | Phases: Registration Oct 5 15:30 – Oct 25 18:29 UTC; **Build Phase Oct 27 04:30 – Nov 15 18:29 UTC**. Team size 1–4. Tabs: Overview, Tracks, Key Dates, Prizes & Credits, Product Partners, Questions?, Teams, Discussion. There is **no Rules tab**, and the discussion widget is off. Generic FAQ: "submit it on HackerEarth in tar/zip file format along with instructions to run the application and source code."; "the submission should be functional so that it can be reviewed by the judges."; "all code needs to be in public domain (open source) so that it can be evaluated by the judges."; a video is "not mandatory, and only good to have" (the microsite overrides this: a video is required). |
| Submission form (HackerEarth) | ❌ behind login | Its fields cannot be verified. `docs/submission/README.md` assumes Title, Synopsis, Description, Instructions, Links, Screenshots, Deck and Zip. |
| https://airwallexdev.com/agentic-banking-builder-guide.md | ✅ raw markdown (61 KB). Section 11, "Build around a financial decision", "Before you start" and "Sandbox constraints" read in full | Kit 11 text is compared row by row in section 2D. The guide has no prize, judging or submission text. |
| https://www.airwallex.com/en-us/blog/agentic-banking-governance | ✅ | Dan Kim, 5 Oct 2026. All six principle quotes in `docs/rules.md` appear verbatim. The article does **not** mention the hackathon or judging. |
| Dan Kim's X article (`x.com/dankimxyz/article/2107199865004634605`), the source of judging areas J2, J5, J6 | ❌ HTTP 402 | Not verifiable. The J rows below take the wording quoted in `docs/requirements-matrix.md` / `docs/rules.md` and are **marked as such**. Two web searches found no other copy of the criteria. |

---

## 2. Requirements, criteria, award conditions and form fields

### 2A. Official deliverables and conditions (microsite, verbatim)

| Verdict | Requirement (source) | Where Purser meets it | Evidence |
|---|---|---|---|
| ✅ | "A working demo" (microsite FAQ) | Offline: `npm ci && npm run judge` (no keys). Hosted pages on the relay. Live: `npm run demo:all`. | `README.md` "For a juror"; `package.json` `judge`; `docs/runs/2026-10-30-friday-1.md` (live run, every check of `npm run verify` passes); `docs/runs/2026-10-30-endcheck.md`. HTTP 200 today on `/`, `/demo`, `/metal`, `/try`, `/film`. Caveat: `/health` = 503. |
| ❌ | "a short video walkthrough" (one video) | The silent animated film exists (2:53, also at `/film`). The voiced or hybrid walkthrough is not recorded. | `out/video/master.mp4` (173.0 s); `docs/video/README.md`; `docs/video/hybrid-script.md` ("this draft runs 4:10 … cut 15 s"). |
| ✅ | "under five minutes" (length) | Both cuts fit: 2:53 film, 4:10 hybrid draft. The team's own targets differ: rules.md 4:45, checklist "Maximaal 4:45", hybrid script "4:00 limit". | ffprobe; `docs/video/hybrid-script.md`. |
| 🟠 | Video count: "a … video walkthrough", so one | The plan has a hybrid cut, the animated film and a "60-second cut". Only one belongs in the form. | `docs/video/hybrid-script.md` heading. |
| ❌ | Video link (form field) | Placeholder "_(Max fills in: the unlisted YouTube link)_". | `docs/submission/README.md` § Links. |
| ❌ | "a link to your repository" | Private repo; `main` holds only README.md. | GitHub API `private: true`; `git ls-tree origin/main` lists `README.md` only; 355 commits on `build/next`. |
| ✅ | "with setup instructions" | README "For a juror" (`npm ci && npm run judge`), "Run it live", then `docs/run-it.md` and `.env.example`. CI runs on build/next (latest completed run: success). | `README.md`; `docs/run-it.md`; `.env.example`; `gh run list` (success on 1 Nov 06:08 UTC). **Only on `build/next`.** |
| ✅ | Metal Award: "Requires use of Metal and Airwallex tooling" | Metal: `@metalntwx/metal-agent` CLI (account, mandate create/bind/replace/pull/verify), `metal-pay` (x402 `requireSignedOffer`, `verifyMandatePayment`), clearing, testnet. Airwallex: Issuing cards and limits, FX quote and conversion, beneficiary, SWIFT transfer, deposit simulation, webhooks, Global Accounts. | `docs/metal-award.md`; `docs/airwallex.md`; `docs/data-qa.md` (31 Oct: 7 Airwallex objects and 112 Metal payments plus 6 mandates read back, 0 differences); `docs/runs/2026-10-30-friday-1.md`. |
| ✅ | Kit 11 track setup: "Funded Metal testnet wallet" | 20.00 *USDZ funded into the business account; RPC from the Metal console. | `docs/data-qa.md` (Metal funding `0x1fbcf64b…93e2`, match); `.env.example`. |
| 🟠 | "Nov 13 Project submissions due." | Not submitted; the plan is Thu 12 Nov. The HackerEarth platform says the build phase ends Nov 15 18:29 UTC (see section 3). | `docs/submission/checklist-max.md`. |
| 🟠 | Nov 15 finalists, Nov 19 Demo Day (remote optional) | The plan keeps the relay and sandbox up until 19 Nov. The relay is unhealthy today. | `docs/submission/checklist-max.md` § 7; `docs/submission/demo-day.md`. |
| 🟠 | Eligibility: "aged 18 and over" | Not checkable from the repo. Max to confirm. | n/a |
| ✅ | Team: "on your own or … a team of up to four" | Solo (Max Geurtsen). | `LICENSE`; `README.md`. |
| ✅ | IP: own the IP, showcase permission | MIT licence (on build/next). | `LICENSE`. |
| 🟠 | Visa Award: "Requires use of Visa and Airwallex tooling" | Not claimed. A TAP dev test only. | `docs/runs/2026-10-31-visa-tap-dev.md`; matrix V1/V2. |

### 2B. HackerEarth generic FAQ

| Verdict | Requirement (verbatim) | Where | Evidence |
|---|---|---|---|
| 🟠 | "submit it on HackerEarth in tar/zip file format along with instructions to run the application and source code" | The zip exists with README, LICENSE and `.env.example`, but it is from 31 Oct 09:46 and so stale. | `out/submission/purser-source.zip`. |
| ✅ | "the submission should be functional so that it can be reviewed by the judges" | `npm run judge` runs offline. | `README.md`; CI. |
| ❌ | "all code needs to be in public domain (open source) so that it can be evaluated by the judges" | Private repo; LICENSE not on `main`. | GitHub API. |
| ✅ | "all team members can login … and do application submission on HackerEarth" | Solo, so Max submits. | `checklist-max.md` § 6. |

### 2C. Judging areas and "what every submission shows" (source: Dan Kim on X, **not fetchable, HTTP 402**; wording from `docs/rules.md` and `docs/requirements-matrix.md`)

| Verdict | Criterion (as quoted by the project) | Where Purser meets it | Evidence |
|---|---|---|---|
| ✅ | J5.1 "A working end-to-end workflow for a clear user." | A CFO of a small company; Friday run 1 went from zero to `verify`. | `docs/runs/2026-10-30-friday-1.md`; `docs/runs/2026-10-30-endcheck.md`. |
| ✅ | J5.2 "Airwallex used for a necessary financial action." | FX conversion and SWIFT transfer to PAID; card limits enforced by Airwallex. | `docs/data-qa.md`: transfer `4d508b0b…feb4` PAID, conversion `08736b6e…f3c7` SETTLED, `LIMIT_EXCEEDED` and `MERCHANT_CATEGORY_NOT_ALLOWED` declines read back on 31 Oct. |
| ✅ | J5.3 "Financial context influencing what the agent decides to do." | Converts only the shortfall above floors and fee; escalates when the USD floor would break. | `docs/runs/2026-10-29-s3.md`, `-f4.md` (rehearsal); `src/policy/treasury.ts`. |
| ✅ | J5.4 "Clear controls showing what the agent can do, what requires approval, and how it handles an exception." | CFO policy, passkey approvals bound to a hash, on-chain mandates, card controls. | `docs/runs/2026-10-30-friday-1.md` (P-0001…P-0005); `docs/submission/README.md` § Controls. |
| 🟠 | J6.1 Finance and product value | Clear user and problem. `docs/landscape.md` does not exist; the matrix's own items are open. | `docs/requirements-matrix.md` J6.1. |
| ✅ | J6.2 Airwallex relevance and financial context | As J5.2 and J5.3. | as above |
| ✅ | J6.3 Agentic behaviour and controls | Refusal on chain, then options, then replace after Face ID; late approval approves nothing. | `docs/runs/2026-10-30-friday-1.md`; `docs/runs/2026-10-29-f1.md`. |
| ✅ | J6.4 Technical execution | Two end-to-end worlds on 30 Oct, PAID, `verify` passes; tests and CI. | `docs/runs/2026-10-30-endcheck.md`; CI success. |
| 🟠 | (Source check) The J criteria themselves | Could not be checked against the original. The blog (fetched) has no judging text. | HTTP 402 on X. |

### 2D. Kit 11 brief (builder guide § 11, checked against the live guide today)

| Verdict | Kit 11 sentence (abridged; full text in guide) | Where | Evidence |
|---|---|---|---|
| ✅ | Data business; customers' agents pay per query into your Metal account and sign each order | x402 seller with signed orders. | `src/servers/seller.ts`; data-qa: 50 sales matched. |
| 🟠 | Three agents … treasury agent "moves earnings to Airwallex and pays a monthly licence fee invoiced in euros" | The sweep to Airwallex is done (deposit `56366c9d…` verified). The EUR 240.00 licence fee is in code (`LICENCE_FEE_EUR_CENTS`), and the payment ran only in dry run 12 (test passkeys, no ids recorded). It is not in the recorded run. The recorded euro bill is a supplier invoice. | `docs/runs/2026-10-31-dry-run-2.md` ("killed right after the licence approval … paid exactly once"); matrix K1b. |
| ✅ | Simulate the customer, its agent and the upstream provider | Summit Outfitters and Stockline (ours, labelled as simulated). | `src/agents/customer.ts`; `src/servers/supplier.ts`. |
| ✅ | 20 *USDZ: sourcing 10 (cap 3 cents), support 4, treasury 6; sell 5 cents, upstream 2 cents | Mandates bound as specified. | data-qa mandates `0x25952ab9…` (cap 0.03, budget 10.00), `0x1b3308e2…` (4.00), `0xb89ea437…` (6.00); sales at 0.05, purchases at 0.02. |
| ✅ | Upstream rises to 4 cents, next purchase refused | Purchase #41 `REFUSED (mandate_cap_exceeded)`. | data-qa upstream purchase 41; `docs/runs/2026-10-30-friday-1.md`. |
| ✅ | Treasury proposes limits within 20, approve by replacing mandates | P-0002: treasury 4.00 and sourcing 12.00 (cap 0.04) replaced; old credential `mandate_revoked`. | data-qa `0x2909b164…`, `0xbc70858f…`; friday-1. |
| ✅ | Disputed batch; signed orders show its agent placed them; refund where data was wrong, from the support budget | 12 of 12 orders verified; `refund-7/10/13` paid from the support mandate. | data-qa Metal refunds; friday-1. |
| ✅ | "Keep prices, budgets and the licence fee in code, and let the model weigh the rest." | `src/config/policy.ts`; Claude reads and advises only. | matrix K4c. |
| 🟠 | **The flow** … "then move earnings to Airwallex and pay the licence fee" | Every step is live except the licence fee (dry run only, see above). | as above |
| ✅ | Metal endpoints: `account create`, `credential create`, `bind`, `replace`, `pull --payment-id`, `verify`; `requireSignedOffer`, `signedOfferOf`, `verifyMandatePayment` | `src/metal/agentCli.ts`; seller; disputes. | `docs/metal-award.md`; matrix K6a/K6b. |
| ✅ | Airwallex: `POST /simulation/deposit/create`, `GET /deposits`, then kit 1 FX, beneficiary, transfer calls | All used. | `docs/airwallex.md`; data-qa. |
| ✅ | Watch-outs: owner keys away from agents; store signed orders; hold the 20 in code; `--mandate-key-file`; whole cents; 402 then an error status, no settle; timeout means unconfirmed; stablecoin → Metal address → simulated deposit with the hash as `reference` | All have code and a run or test. | matrix K7a–K7f; data-qa deposit reference = Metal tx `0x808f9133…a94f`. |
| ✅ | Before you start: "Metal testnet … RPC endpoint of your own and a funded testnet key"; *USDZ from the faucet | Done. | matrix M3/M4. |
| ✅ | General: "Finish the demo with a financial action or an escalation to a person." *(missing from matrix)* | SWIFT transfer PAID; P-0003 escalated. | friday-1. |
| ✅ | General: "Keep amounts, limits, reserves, validation, duplicate protection, and state transitions in code … Give the model typed tools rather than unrestricted credentials" *(first half missing from matrix)* | `one_live_transfer_per_invoice`, saga step log, principals; Claude holds no key. | `docs/airwallex.md` § Transfers; matrix B2/B5. |
| ✅ | General: show goal, plan, new information, revised decision, result | CLI prints them. The video is not final (see 2A). | matrix K10 (🟠 there because of the video). |

### 2E. Submission form fields (the real form could not be fetched; fields as assumed in `docs/submission/README.md`)

| Verdict | Field | State | Evidence |
|---|---|---|---|
| ✅ | Title | Written. | `docs/submission/README.md` § Title |
| ✅ | Synopsis | Written. | § Synopsis |
| ✅ | Description | Written; claims cite the Friday run. | § Description |
| ✅ | Instructions | `npm ci && npm run judge`. | § Instructions |
| ❌ | Video link | Placeholder. | § Links |
| 🟠 | Live link | Placeholder. The pack says the relay address is "kept out of the repo", yet `README.md` publishes `kit11.max-31b.workers.dev`. `/health` = 503. | § Links; `README.md` |
| ❌ | Repository link | Placeholder; repo private, `main` empty. | § Links |
| ✅ | Screenshots | 6 named files present (20 files in `screens/`). | `docs/submission/screens/` |
| ✅ | Deck | `purser-deck.pdf`, 12 pages. | pdfinfo |
| 🟠 | Source zip | Present but stale. | `out/submission/purser-source.zip` |

### Verdict count (sections 2A–2E)

✅ 36 · 🟠 12 · ❌ 6 (2A 7/5/3, 2B 2/1/1, 2C 7/2/0, 2D 14/2/0, 2E 6/2/2). The 6 ❌ come down to 3 gaps: the video (walkthrough, plus its link in 2A and 2E), the repository link (2A and 2E), and open source (2B).

---

## 2F. `docs/requirements-matrix.md`: rows that are missing, wrong or overstated

| Row | Problem | Fix |
|---|---|---|
| H2 (and `docs/rules.md` "Deadline", `checklist-max.md` "13 november, 19:29") | **Wrong source data.** HackerEarth event data now gives Build Phase end **Nov 15 18:29 UTC**, not Nov 13 18:29 UTC. The "19:29 NL" time has no current source. The microsite still says Nov 13 with no time. | Record both dates. Keep Nov 12 as the plan. Ask the organisers. |
| H1c | **Missing fact.** `main` has only the initial README. 355 commits are on `build/next`. "Make public" alone would show judges an empty repo. | Add: merge to `main` or set the default branch. |
| H14 | **Missing fact.** `LICENSE` is not on `main`; GitHub shows "license: None". | As H1c. |
| H13 | **Stale.** The zip is older than HEAD. | Rebuild on the final commit. |
| H1b | 🟠 understates a blocker. No walkthrough exists yet, and the hybrid draft (4:10) is over the team's own 4:00/4:45 targets (legal under 5:00). | Keep it on top of the open items. |
| K5 | **Overstated (✅).** The flow's last step, "pay the licence fee", is not in a recorded live run. The matrix's own K1b says "not in the recorded run yet"; only dry run 12 paid it, with test passkeys and no ids. | 🟠 until a live run with ids. |
| M2 | **Overstated and misclassified.** Marked ✅ although the row says Slack support was not used and no node is run. It is a partner description, not an award condition. | Mark it n/a or 🟠, or drop it. |
| J2, J3, J5.x, J6.x | **Source still unverified.** The X article answers HTTP 402. The blog (verified) has no judging text. | Keep the caveat. Try to read the article in a logged-in browser. |
| `docs/rules.md` "HTTP 500 … re-check its Rules tab and the Discussion tab" | **Outdated.** The page is now 200; there is no Rules tab; the discussion widget is off. `checklist-max.md` § 6 last bullet is obsolete. | Update. |
| `docs/rules.md` "Dan Kim (VP at Airwallex, co-author of x402)" | "co-author of x402" is not supported by the blog, which gives "VP, Product Partnerships, Ecosystem & Developer Experience". | Drop or source it. |
| † rows (J5.2, K3, K6c, K7f, …) | They cite 29 Oct rehearsal Airwallex ids, which have no independent read-only check. The Friday-run ids were verified by `docs/data-qa.md` on 31 Oct and could be cited instead. | Swap the ids (see section 4). |
| **Missing rows** | Eligibility "aged 18 and over"; team "up to four"; Nov 15 finalists and Nov 19 Demo Day (keep the demo up); IP or showcase permission; Kit 11 setup "Funded Metal testnet wallet"; HackerEarth "functional so that it can be reviewed"; HackerEarth build-phase end Nov 15 18:29 UTC; video count (one); the submission-form fields; guide lines "Finish the demo with a financial action or an escalation to a person", "Keep amounts, limits, reserves, validation, duplicate protection, and state transitions in code", "If the agent should make the same choice every time, write the rule in code". | Add rows (all are met or tracked above). |
| Count line "✅ 74 · 🟠 13 · ❌ 0" | Matches the rows as written (74 / 13 / 0). After the corrections above it would be at least ✅ 73 · 🟠 14, and H1c/H14 arguably ❌ today. | Recount. |

---

## 3. Submission checklist: what, in what format, by when

**Where:** the HackerEarth challenge page (logged in as the registered team; Max submits solo).

**What (microsite, binding):**
1. A working demo: `npm run judge` (offline) plus the hosted relay link.
2. **One** video walkthrough, **under 5:00**, as a link. The hosting place is not specified; the plan is unlisted YouTube.
3. A **repository link** with setup instructions. Per the HackerEarth FAQ the code must be public or open source.

**Format (HackerEarth generic FAQ):** source plus run instructions "in tar/zip file format". `npm run submission` builds `out/submission/purser-source.zip`. Text fields per `docs/submission/README.md`; 6 screenshots; `purser-deck.pdf` (12 pages).

**By when:** microsite "Nov 13 Project submissions due." (no time zone). The HackerEarth platform closes the build phase **Sun Nov 15, 18:29 UTC (19:29 CET)**. The project's own deadline, "13 Nov 19:29 NL", has no current source. **Submit Thu 12 Nov**, which is safe under every reading. Then keep the demo up for finalists (Nov 15) and Demo Day (Nov 19, San Francisco, remote optional).

**Still missing as of 1 Nov:**

| | Item |
|---|---|
| ❌ | Final video recorded, ≤ 5:00, uploaded, link in the form and in `docs/submission/README.md` |
| ❌ | Repo: merge `build/next` → `main` (with LICENSE), gitleaks on the full history, set public, link in the form |
| 🟠 | Live link decided (the README already publishes it) and the relay healthy (`/health` 503 today) |
| 🟠 | Zip rebuilt on the final commit |
| 🟠 | Form fields confirmed against the real HackerEarth form (not visible without login) |
| 🟠 | Deadline question to the organisers (Nov 13 vs Nov 15) |
| 🟠 | The licence-fee step live with ids, if K5/K1b are to be claimed in full |

---

## 4. Airwallex ids: which lack a recorded read-only check from this week

"This week" is taken as Mon 26 Oct to Sun 1 Nov. Basis: `docs/data-qa.md` (read-only GETs, 31 Oct 08:01 UTC) and `docs/runs/`. Airwallex was not called for this review.

### 4a. Verified read-only this week (data-qa, 31 Oct): 7 ids

| Id | Object | Shown in |
|---|---|---|
| `4d508b0b-ef38-41d3-b96e-f6cc3f5cfeb4` | SWIFT transfer, PAID, fee 13.41 | data-qa, metal-award.md, friday-1, snapshot.json |
| `08736b6e-0f62-41f8-9e4c-6f5a8cbff3c7` | conversion, SETTLED | data-qa, snapshot.json |
| `56366c9d-e537-428f-8681-9c1a8c43c838` | deposit (sweep) | data-qa, snapshot.json |
| `01a18bb9-4682-7000-bd95-43a3a930b03b` | card txn 19.99 (Airwallex: PENDING) | data-qa, snapshot.json |
| `01a18bb9-571a-7000-a390-0e6d4b0e3132` | card txn 45.00 LIMIT_EXCEEDED | data-qa, snapshot.json |
| `01a18bb9-6320-7000-8874-90025a882c13` | card txn MERCHANT_CATEGORY_NOT_ALLOWED | data-qa |
| `01a18bbb-6607-7000-ac01-0b4d20104e8e` | card txn 45.00 (Airwallex: PENDING) | data-qa, snapshot.json |

### 4b. Read back only inside the run that created them (`npm run verify` or a GET in the same run), with no separate read-only check

| Id | Object | Run log | Cited in judge-facing docs |
|---|---|---|---|
| `0650049f-acb1-476e-a72f-c4de56d5b7b1` | conversion | rehearsal-3 (verify, 20 checks) | airwallex.md, requirements-matrix.md |
| `260638bd-3400-4a6f-b170-268ecc1ffc5b` | transfer | rehearsal-3 | airwallex.md, requirements-matrix.md |
| `03d9d67d-449a-482b-9281-e2acf4fe058c` | deposit | rehearsal-3 | airwallex.md, requirements-matrix.md |
| `e2b5a849-0567-4a2f-9fc5-701349d2d0b8` | conversion | s3 (verify) | runs only |
| `26954165-5c6d-4796-91bd-c9aa356e1ea9` | transfer | s3 (verify) | airwallex.md |
| `e49d68f2-bcc2-4a0d-ab22-abca60ea6509` | deposit | s3 (`GET /deposits`, reference verbatim) | airwallex.md, requirements-matrix.md |
| `7f04e83e-2a19-46a2-bbc2-34d4894f20e7` | conversion | f1 (verify) | runs only |
| `c443a5da-aebb-486d-9101-5cf9ea0e3bae` | transfer | f1 (verify) | airwallex.md |
| `fd5fd1e2-…22b3`, `15557fe5-…74c7ca`, `03935770-…b0c36d` | conversion, transfer, deposit | rehearsal-1 (verify) | runs only |
| `8b78316e-…1c19`, `459b6a0a-…2f82`, `00fa4288-…8b47` | conversion, transfer, deposit | rehearsal-2 (verify) | runs only |
| `0c8a5ec9-8532-485d-99f9-c12043c76c2b` | transfer | friday-2 (verify) | runs only |
| `cf2c2777…`, `41f48599…`, `4cb22584…` (partial ids only) | transfers, deposit | endcheck eind-1/eind-2 (verify) | runs only |
| `50f623ac…`, `95fcf339…`, `5a6323a6…`, `acf543d2…` | retailer deposits (simulated) | receivables (read back from `/deposits`) | runs only |
| `91eff063…`, `c5b79316…`, `01a18eaa…` | deposits and card txn received by webhook | webhooks | runs only |
| cards •••• 8653 / 9799 / 7020 | single-use cards | single-use ("read back after issue") | runs only |

### 4c. No read-only check recorded at all

| Id | Object | Where shown | Note |
|---|---|---|---|
| `7edb809a-48d4-440e-ab1f-3805645fd605` | card charge id in the audit row | **dashboard feed** (`docs/demo/snapshot.json` seq 168); data-qa note | Not the ledger's id; never read back. Highest priority, because judges see it. |
| `101475c7-493b-3442-9734-3b2c0ce83f6f` | FX quote | airwallex.md, s3 | Quotes expire; a read-back is not possible later. Say so, or cite the conversion. |
| `1322d7e4-5102-4858-ac2f-912d0ad5b999` | beneficiary (DE EUR SWIFT) | airwallex.md, s3 | No GET recorded. |
| `3964c579…` | GBP Global Account | airwallex.md | Created 30 Oct; no read-back in data-qa. |
| cards •••• 8120 / 6882 / 7786 (friday-1), •••• 6418 / 5063 / 8404 (friday-2) | Issuing cards (objects, controls) | airwallex.md, snapshot.json, video script | data-qa checks card *transactions*, not cards. `airwallex.md` line 10 says "each of those ids was re-read from the sandbox, read-only, on 30 October", but no run log or output records that. |
| `wh_Wnhwa…` | webhook subscription | webhooks log | Ids are partial. |

**Bottom line for section 4:** only the 7 Friday-run ids in 4a have an independent read-only record this week. The ids that `docs/airwallex.md` and `docs/requirements-matrix.md` put in front of judges are mostly 29 Oct rehearsal ids (4b), plus the 4c ids, chiefly `7edb809a…` on the dashboard and the Friday card objects. Either swap the citations for the 4a ids, or run one read-only pass (data-qa style) over the 4b and 4c ids before 12 Nov.
