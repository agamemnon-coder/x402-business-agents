# External link check, 2026-11-18

Run by `npm run links:external` (scripts/linkcheck-external.ts) at 2026-11-18T15:15:15.260Z: every external link and explorer URL in
README.md, llms.txt, the docs and the site's pages, asked with HEAD, then GET where a host refuses HEAD.

- **URLs found:** 611; **asked:** 391; **left out by the budget:** 220 (asked in order: the README, llms.txt and the site's pages first, then the submission and claims, then the other docs).
- **Requests:** 400 of a budget of 400.
- **Failed:** 0; **ok:** 391.

| | Status | Method | URL | Found in | Note |
|---|---|---|---|---|---|
| ok | 200 | HEAD | http://www.w3.org/2000/svg | page client, page dashboard, page month |  |
| ok | 200 | GET | https://developer.visa.com/capabilities/visa-intelligent-commerce | docs/plans/visa-1114.md, page visa |  |
| ok | 200 | HEAD | https://docs.metalntwx.com/agents/facilitator | page metal |  |
| ok | 200 | HEAD | https://docs.metalntwx.com/agents/mandates | page metal |  |
| ok | 200 | HEAD | https://docs.metalntwx.com/agents/payouts | page metal |  |
| ok | 200 | HEAD | https://docs.metalntwx.com/agents/x402-on-metal | page metal |  |
| ok | 200 | HEAD | https://docs.metalntwx.com/build/controls/create-and-manage-a-smart-account | page metal |  |
| ok | 200 | HEAD | https://docs.metalntwx.com/reference/network-fundamentals/settlement | page metal |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents | docs/requirements-matrix.md, docs/submission/README.md, docs/submission/long-description.md and 4 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml?query=branch%3Amain | README.md, page home, page proof and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/ci.yml/badge.svg?branch=main | README.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql | README.md, page proof, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/actions/workflows/github-code-scanning/codeql/badge.svg | README.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/cloud/src/app.ts | page docs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/agent-api.md | page docs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/agent-evals.md | page claude, page home |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/airwallex.md | page docs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/archive/overview.md | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/assets/test-summary.json | llms.txt, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/audit/README.md | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/claims.md | llms.txt, page llms, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/cloud.md | page docs, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/compliance.md | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/connect-claude.md | page docs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/connections.md | page docs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/controls-matrix.md | llms.txt, page llms, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/controls.md | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/demo/agent-run.json | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/demo/airi-run.json | docs/submission/long-description.md, page proofJson, page runs and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/demo/airwallex-run.json | docs/submission/long-description.md, page awxCalls, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/demo/main-run.json | docs/submission/long-description.md, page awxCalls, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/demo/metal.json | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/demo/vic-2-run.json | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evals/agents.json | page claude |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evals/ap-hostile.json | page claude, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/evidence/verification-2026-11-15.md | llms.txt, page llms, page proof |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/finance-value.md | llms.txt, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/in-depth.md | llms.txt, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/metal-award.md | docs/submission/long-description.md, page docs, page proof and 3 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/plans/visa-1114.md | page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/redteam/report.json | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/roadmap-v2.md | llms.txt, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-10-29-clearing.md | docs/submission/long-description.md, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-10-30-clearing-load.md | docs/submission/long-description.md, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-10-30-compliance-policy.md | docs/submission/long-description.md, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-10-30-dispute-desk.md | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-10-30-four-eyes.md | docs/submission/long-description.md, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-02-agent-run-1.md | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-02-night-batch.md | page claude, page proof, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-03-main-run-data-qa.md | page metal |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-03-main-run-metal-transactions.md | docs/submission/README.md, docs/submission/long-description.md, page airwallex and 5 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-03-main-run.md | docs/submission/README.md, docs/submission/long-description.md, llms.txt and 5 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-07-awx-1.md | llms.txt, page airwallex, page awxCalls and 5 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-07-awx-1/receipt-P-0002.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-07-vic-1.md | llms.txt, page airwallex, page llms and 5 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-07-vic-2.md | page airwallex, page proof, page proofJson and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-airwallex-two-locks.md | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-connected-accounts-sandbox.md | docs/submission/long-description.md, page proof, page proofJson and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-metal-extra.md | docs/submission/long-description.md, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-payment-acceptance-sandbox.md | docs/submission/long-description.md, page airwallex, page proof and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-platform-e2e.md | docs/submission/long-description.md, page airwallex, page proof and 3 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-10-t0-journal-sandbox.md | docs/submission/long-description.md, docs/video/film-v10-shots.md, page books and 4 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-batch-transfer-2.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-batch-transfer.json | docs/submission/long-description.md, page awxCalls, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-batch-transfer.md | page airwallex, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-financial-transactions.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-financial-transactions.md | page airwallex |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-payee-check.json | docs/submission/long-description.md, page awxCalls, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-payee-check.md | docs/video/film-v10-shots.md, page airwallex, page proof and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-airwallex-two-locks-paid.md | docs/submission/long-description.md, docs/video/handin-shots.md, page proof and 3 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-faceid-onchain.json | docs/submission/long-description.md, page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-faceid-onchain.md | docs/video/handin-shots.md, page metal, page proof and 3 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-mcp-transcript.json | page claude |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-metal-inspector.md | page metal |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-moneybird-sandbox.json | docs/submission/long-description.md, page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-moneybird-sandbox.md | page books, page proof, page proofJson and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-real-customers.md | page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-tokenize.json | docs/submission/long-description.md, page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-tokenize.md | page metal, page proof, page proofJson and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-vic-3.json | docs/submission/long-description.md, page proofJson, page runs and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-12-vic-3.md | docs/video/film-v10-shots.md, docs/video/handin-shots.md, page proof and 3 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-airwallex-deposits.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-airwallex-faceid.md | docs/submission/long-description.md, page proof, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-airwallex-switch-on.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-anchor.json | docs/submission/long-description.md, page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-anchor.md | docs/video/film-v10-shots.md, page metal, page proof and 4 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-books-month.json | llms.txt, page books, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-try-sample.json | llms.txt, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-vic-4.json | docs/submission/long-description.md, page proofJson, page runs and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-13-vic-4.md | page proof, page proofJson, page runs and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-14-vic-5.json | docs/submission/long-description.md, page proofJson, page runs and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-14-vic-5.md | docs/submission/README.md, llms.txt, page llms and 5 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-15-anchor-verified.md | docs/submission/long-description.md, llms.txt, page llms and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-17-airwallex-late-failure.json | page awxCalls, page proof, page proofJson and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/airwallex-card-cent-2026-11-15.json | llms.txt, page airwallex, page llms and 4 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/airwallex-cards-2026-11-06.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/airwallex-readback.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/airwallex-transfer-approval-2026-11-06.json | page awxCalls |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/airwallex-vic-payment-intents-2026-11-12.json | page awxCalls, page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/holdouts/2026-11-03-blind/results.md | page claude |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/passkey-owners.json | page metal, page proofJson, page runs |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/README.md | llms.txt, page llms |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/redteam-2026-10-31/README.md | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/reliability-2026-11.md | page proof |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/visa-tap-live-2026-11-02.json | docs/submission/long-description.md, page proofJson, page runs and 2 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/security.md | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/t0.md | page t0 |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/worst-case-ai.md | llms.txt, page llms, page proof |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/zero-trust/report.json | page claude, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/README.md | docs/submission/long-description.md, page docs, page proof and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/accounting/closeGate.ts | page t0 |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/agents/euroBill.ts | page proof, page proofJson |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/airi/credential.ts | page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/airi/credentialGuard.ts | page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/airi/hostedCheckout.ts | page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/airi/purchase.ts | page proof, page proofJson, page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/audit/log.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/claude/tools.ts | page proof, page proofJson |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/policy/approvals.ts | page proof, page proofJson, page security and 1 more |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/policy/cards.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/policy/mandates.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/src/policy/secondKey.ts | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/adversarial.test.ts | page proof, page proofJson |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/airi-card-data.test.ts | page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/airi-credential-guard.test.ts | page visa |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/airi-purchase.test.ts | page proof, page proofJson |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/approvals.test.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/audit.test.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/cards.test.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/executors-mandate.test.ts | page proof, page proofJson, page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/invoice-duplicate-key.test.ts | docs/submission/long-description.md, page proof, page proofJson |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/test/second-key.test.ts | page security |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/releases/tag/v1.0-submission | README.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/tree/main/docs/business | llms.txt, page llms, page proof |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/tree/main/docs/runs | page runs |  |
| ok | 200 | HEAD | https://img.shields.io/badge/Airwallex-sandbox-ff6b35?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/Alta_%28formerly_Metal%29-testnet-0d9488?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/Claude-24_decisions-d97757?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fassets%2Ftest-summary.json&query=%24.passed&label=tests&suffix=%20passing&color=16a34a&style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/license-MIT-2563eb?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/MCP_server-read%2C_propose_only-6099f4?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/money-test_only-ca8a04?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/T%3A0-sandbox_ledger-475569?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/Visa_VIC_via_Airi-sandbox-1a1f71?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://img.shields.io/badge/worst--case_AI_%28offline_eval%29-0_wrong_payments-16a34a?style=flat-square&labelColor=1f2937 | README.md |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/ | README.md, docs/assets/screens/README.md, docs/evidence/verification-2026-11-15.md and 15 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/agents/sourcing | docs/in-depth.md, page proofJson |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/agents/support | page proofJson |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/agents/treasury | page proofJson |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/airwallex | README.md, docs/assets/screens/README.md, docs/in-depth.md and 12 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/airwallex/calls | README.md, llms.txt, page llms |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/alta | README.md, docs/evidence/verification-2026-11-15.md, docs/submission/long-description.md and 2 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/api/metal/mandates | README.md, llms.txt, page llms and 1 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/assets/og-1114.png | page agents, page airwallex, page awxCalls and 26 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/books | docs/assets/media/README.md, docs/built-after-the-kit.md, docs/see-it.md and 4 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/claude | README.md, docs/README.md, docs/in-depth.md and 8 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/docs | llms.txt, page llms |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/home | docs/assets/media/README.md, page home |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/metal | docs/assets/media/README.md, docs/assets/screens/README.md, docs/in-depth.md and 7 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/proof | README.md, docs/assets/media/README.md, docs/assets/screens/README.md and 16 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/proof.json | llms.txt, page llms |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/receipt-sample.json | llms.txt, page llms, page proofJson |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/replay | README.md, docs/in-depth.md, docs/submission/README.md and 3 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/runs | docs/assets/screens/README.md, docs/evidence/verification-2026-11-15.md, docs/in-depth.md and 7 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/security | README.md, docs/enterprise.md, docs/gallery.md and 5 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/status | llms.txt, page llms |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/t0 | README.md, docs/README.md, docs/who-does-what.md and 2 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/trace | docs/submission/long-description.md, page proofJson |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/try | README.md, docs/airwallex-centre.md, docs/assets/media/README.md and 9 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/try/negotiate | README.md, docs/finance-value.md, llms.txt and 1 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/verify | README.md, docs/proof/README.md, llms.txt and 1 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/visa | README.md, docs/assets/media/README.md, docs/assets/screens/README.md and 10 more |  |
| ok | 200 | HEAD | https://purser-try.max-31b.workers.dev/ | README.md, docs/assets/media/README.md, docs/assets/screens/README.md and 36 more |  |
| ok | 200 | GET | https://purser-try.max-31b.workers.dev/connect-ai | docs/connect-claude.md, page docs |  |
| ok | 405 | GET | https://purser-try.max-31b.workers.dev/mcp | README.md, docs/connect-any-ai.md, docs/connect-claude.md and 4 more | API endpoint, not a page (answered 405) |
| ok | 200 | HEAD | https://purser-try.max-31b.workers.dev/try | docs/evidence/try-agentic-2026-11-15/README.md, docs/proof/README.md, docs/video/handin-shots.md and 1 more |  |
| ok | 200 | HEAD | https://purser-try.max-31b.workers.dev/try/negotiate | page home |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/address/0x6e621D0f1ff6a03cAF1dbFE9747eCEc4513Efefc | docs/metal-award.md, page metal, page proof |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/ | docs/metal-qa-2026-11-01-week.md, page dashboard, page demo |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x02d5bf5b302a5dea04a80f4ef9da555300aa0a00067af96d5ae7e6d2c0c3e8fd | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x0381193151a1990c4d6c829fa15243b30471e72dfb9bdfdfcd9c2ce13ad5e23a | docs/metal-award.md, docs/runs/README.md, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x03c218ced23f5c3721a90d386f2dd044fe279c40b6b4b40f5c7b75c6ed88d2f0 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x0536400e04ea60ea9d6f352266a68872661d33ee64c9e53453230846a9cd5dd0 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x053d2b7ce158a197e83d5c2ee143e3d9195ea4c6e7f1c5c194aba4130cd7c861 | docs/runs/2026-11-12-faceid-onchain.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x055ba89987f658cb038fcbd1660f4d9e98e78e4c44c86c5346946f8cca1a6766 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/2026-10-29-clearing.md and 6 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x080cf1b07dfeb6608d5838450f2a39b4c7cd0bc9c6edff93906ec3ca87cc4e1c | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x0913353458e90e3e8402d81d70893df68d011f381ba13abd33ac0662dd912ed9 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x108e9e743d26f030607e36526fec063ab613c115d783c904a2a9fa5dc9ca4136 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x147281a44d35a4a3b56c04b272e63bd1ce7cdd67dd5db7a4eb755c8c18716676 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x168c657909460959b0444f05db2e7c03728435311ac059415d3504ef7b2a8c2d | docs/runs/2026-11-12-faceid-onchain.md, docs/runs/README.md, page metal and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x182fbd2620c8efc6f2f31f6850581f48cd79b11d2cd13e60747f6ca577a56668 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x1add0f462da3cf0a1e60666a78df7777fed1dc2ac7c1ea397ac4ecd4c53adcce | docs/runs/2026-11-12-faceid-onchain.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x1b82bda54c82cb48714fac20dd68c33644b1359ea8eeed8254788d778c9e2e1e | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x1b8c645f6ff693bade67a70a41b2a8ff99839a6ed37a4c251d8db4188fb6f744 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x222385b575d3b143e462e1146bd37d556fd263a6aa87f264fce9721b63232737 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x25952ab99bf9ba1abd31050883bcb5aa8c2b6337d0e9b70f88656461f19260aa | page dashboard, page live, page try |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x285281ea1e1aa1c8d7cfb84504fc251e79ce6072a461cf0a541d57a042da2724 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, page dashboard and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x294576a13d8a04c71f1ab542ccebed8d65931db409e138766e47dc1c140fffd9 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2a81d430d7ad08d9c009088b9ce965d30b5d6697c179cf85fe94f14f0922f08a | docs/runs/README.md, page live, page metalReport and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2a91ac97fc2a459da2b0c73f2b8020edec1901d051c7ef03bb088d36067fe790 | docs/idea-vs-build.md, docs/kit11.md, docs/metal-award.md and 8 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2b0231e7af8e59c7a64e072019349872068cc593096ab2b24bcde9b3c473c7ea | page dashboard |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2b3a31102b4f10c36bac7dd4b596428379d018e5a541754431f31b8b6f0a7159 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2cc5a16e4aa74d5912e1b155f815270bd6f8a82796c08371dafa540410fa2fc7 | docs/in-depth.md, docs/kit11.md, docs/metal-award.md and 7 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871 | README.md, docs/feedback-for-metal-and-airwallex.md, docs/idea-vs-build.md and 14 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x2f2d7afce9fce6b21278104828cc552c9d0aea387857f1c8384419cc6b64fb2a | docs/runs/2026-11-10-metal-extra.md, docs/runs/README.md, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x3167d81015e3e1613bb2f8de8f6d28e5d932e4d498d9e46b5e8c59e2e5b0742e | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x31ecebc2045bcdce45aeb87bf2dbc965e81f1a71e11ef8d8f81ee4ed6a642d3e | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x320447bb3fff39f0aa083502fc7e76f2548b33b609ff28550af2ce91ba1e4109 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x3212737162d2fcac7474bcb076e632015981521b112ab16eade124220268434e | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x32c0e6918a7fa9439375acda943100cc63941d3c0623cc32f93c318c0aad1486 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x3878ee902ac7238e1f989465af04de7a613ebd5061db2cdb78c55187ab833bcf | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x39a4a2e5f05b3093e656e3eaa34a316b93166d7d940c609838819186eb6d07ac | docs/runs/2026-11-03-main-run-metal-transactions.md, page dashboard, page replay and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x39c5c7b0006a84a548b7ddba155060b9acc4c55b243a06874e33744e532dee33 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x3bf9f70e0b7c4e3c9cef05eddc755d3a4218227251b3699ddaa77756ba303ab5 | docs/metal-award.md, docs/runs/README.md, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x3e4db1a771fd2faaffdef209e7bbfb68310ee1298787e17280f10079884beadb | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x41a963a9cb765dc98fbc98ed6e78abcb02dc1b341c4e7378dea3c1843acb24de | docs/metal-qa-2026-11-01-week.md, page metal, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x41e7571d137d6cb750afdab9d9164e6e9d9ef19269371e55f1ac981d70ac9771 | page dashboard |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x41ef8b799002e32015fad9a0a988d1f7c2772636a0552e22f8424ed4e1bb39fb | docs/runs/2026-11-10-metal-extra.md, docs/runs/README.md, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x4fde2db7720fbd282c894affc11048c978ddd0223668a32ae521a2ded7232b04 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5099fe44b03d83f4dd3963fc59a40e2a506bee533e5a41e8f1b00a12bee14510 | docs/idea-vs-build.md, docs/metal-award.md, docs/runs/2026-11-03-main-run-metal-transactions.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x512fdb1d9680e74d8a735d9d9596211d266904018f816104f2a5c13f838fa97b | docs/runs/2026-10-30-friday-1.md, page dashboard |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x51f907258bd7493ef932cb65d0b84715d2ba4ed2939607a1c5f4f53494723170 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x522470d292f78b390fe153cb40905cdc6102afef1345d62e1dc975f900145092 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/2026-10-29-clearing.md and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5362e5e7e9aee4d92a95bcf2f637939f0cca1acf5848748c500ccc2af2be82be | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5637860a1ea4a7a109a45d2347e19d38887adbdb5bfd2415f0c3dc5bc785f4aa | docs/idea-vs-build.md, docs/runs/2026-11-03-main-run-metal-transactions.md, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5669f975b6c9fcd039453984f8c98811b31874186461a448d5c6d6c9baddbe41 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5717cfbc222837c34d68e5ca815b61ddd97303c30060c44355c44974825d8633 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5c3c0161742d0e65537a9732bf9bc1e220cda1485f52b72dfd70660ce201e986 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x5f09a1fb8d8511834e8079a8e59e41d1559a87c9000c9d0a89bb11d1f2e1f594 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6086aa0a65e0ffb4cb765aeaf4ca5e1cf2af1aaed17a9231f48aef3ac7cdc831 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x64d22177140e07b30b4493eb6cab456c9af594383ffeb0f07599766073dd4c7d | docs/metal-award.md, docs/runs/2026-11-03-main-run-metal-transactions.md, page agents and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x65fac96280f0b1097e3aa629e667f2f83490a490644cce8c1f45603f169b3518 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x67fb45900d3ee2704296d46eb7affa1e910f792982c0d49fe55a7e2123891836 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x68ab794be6e6d0ca8c68e20d2d73804c5e75db6a2084856e22e21e118c9967be | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6972c97d15381dac56ded0094d4c6d4f35aee9f477daae6412cdbaf905996bd0 | docs/runs/2026-11-03-main-run-metal-transactions.md, page dashboard, page replay and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6a4622a9ed5a1880b9e56f89adb59f003c9793a78c080db7ec2ae2f4f2ba59a6 | docs/metal-award.md, docs/runs/2026-10-30-dispute-desk.md, page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6a6d3e45da77b7cba4d98ae1715c140bf10f3887fae207a13f650ab7b0b9ab60 | page dashboard |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6b6ac4ab5fd312942eefc20f4a2fcf88ef67e3cc118ba8d77b457e85c808a61e | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6e7516497ace3a3c74b322979ac37fe2deda20cdc8b32efc12c243808721874c | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6eba6d485b312b36288bc27aab9dfff1d68ddead1a5123373d57bc2ba0538caa | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x6f7d1da8dc2d3e15166b766c5915c40b9b89a3ffe5e2ce123d6766d273b2f13c | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x728a9c270614d5bbeb11540f897a3b29fab00e2275c84cbb4022c74d7149c43b | docs/metal-award.md, docs/runs/README.md, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x7860403ed99b0362dbe2219817f77fe6eaf5da0563163ddf1532508da151ebe2 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x786686b6dd5112b80bbf84902c8b51f407459c3e3112a6a3d8a0e23bac60fc3c | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x789abb249896e01cee8e3641d7794676b6f2ce5d05f45093f6cc64101c9aebbc | docs/idea-vs-build.md, docs/metal-award.md, docs/runs/2026-11-12-metal-inspector.md and 7 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x78e585580d066feaffc2540315565ed6eb221304152c7c74853972d6d5e5ac3c | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x7e6d0104f163607f71429aea587063ebb223410acbcc5f57065b038aca001098 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x808f913345b176d20a1a319c1fd29965c283980c7616a9c838ccc522341fa94f | docs/metal-award.md, docs/runs/2026-10-30-friday-1.md, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x809e7a30aff19c19e0eb9f147267a60a97fee6872e3ad52195473db7b0f93a9f | docs/metal-award.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x81897ab40485937d1b4e139636cbf268e453884a5fa16579285c6eed2906b4fe | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x86936a5b29f9550857676fa710231af9e20882ebe6eee16f75a90af29767ccb4 | docs/idea-vs-build.md, docs/kit11.md, docs/metal-award.md and 12 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x870e0c20f626494109eb47cc7399662aca4d7cddca92cf08c1c5ffd81f3ebc8f | docs/idea-vs-build.md, docs/runs/2026-11-03-main-run-metal-transactions.md, page agents and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x871c658ef7dd9e8a8eaf6ff1034836d55cc54fe022b425ed412cce7aa7e94da5 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x88d59e383a70bce3f37b10a12e2f1440e2e59cf81d713b1b8aabfd88f1211d09 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x8f3e8de3191fe3b9b2a568240cc7142520c4744386a73df798cf5014f3ae9b6e | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x902badf6f82f4e453c99ff9e5fd870d3e96ab40293bff64e3a611014930cc3d4 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/2026-10-29-clearing.md and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x9076343b01ba60809fad1a25c4f8dfa91bfaa15ffec45f55946ceea4e15e20d3 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x91ed35a52e1b3a0c01dbff9ab23f934d7d617b506ab89ac4022cf0739aed442e | docs/metal-award.md, docs/runs/README.md, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x91f25465953772decefaf5934c17117abce91e7a368e88a8ee309afa08a27ead | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x9312b362d919c0579dc22497d869fcd69d5c82b1563dcf9f613d92fa3251fede | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x93b8a8b31fed1d9bbc9c57f05210db67551a1387d015532d64da2b57f454bcea | docs/runs/2026-11-03-main-run-metal-transactions.md, page dashboard, page replay and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x96850ad4562ae5abb370aead62e7ccd5d926d7b5d1a61b6a7aabbbbc78f17d5b | docs/metal-qa-2026-11-01-week.md, page metal, page proofJson and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x99c7d22d5c6b419afb3c05fc39463dde71f97bac73b18d73787ae1a47125ae0d | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x9c7d37f248cd0037881c6becf0ef2e865769b411313ee267cf763f28b9e8a2f7 | docs/metal-award.md, page metal, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x9cb933624be5946c890f77a33aceb2adde3d75d138890a6e1abb91fdad721808 | docs/metal-award.md, docs/runs/2026-11-12-metal-inspector.md, page agents and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0x9de16c5ce16a428d369307b1b2f020f6e70a854641172fa671104ade4a618fd3 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xa0c537b44c103df51ffa07865f6f3d51d4cc12eff5cb4140565e02a0c2d470ad | docs/runs/2026-10-30-friday-1.md, page dashboard |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xa2e3a329654845d5c8605ebebe82d34247dd4635482d7d973c745d0efbea8ed4 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xa465e23be513b2f0b9586c87d7b60a6896fdb6eb97df89278ab3b1615137ea2a | page dashboard, page demo, page live and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xa59a14619b0cacfa707dca5c3257088b229f1e87f4417c24b65df4094536b19e | docs/runs/2026-10-30-friday-1.md, page dashboard, page demo and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xa6b615ce2a980169d66875aec460890def1a331a4c840e178672f4435beec309 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xa86b5f049ac952a26b392329e950c28891550ae6bafd06dc9636305cbdceee11 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xaa93f270a37c66e8be033949b8a6dc89278e47722ca0be5067a744a32b20e6c1 | docs/runs/2026-11-13-anchor.md, docs/runs/2026-11-15-anchor-verified.md, docs/runs/README.md and 6 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xac6f03f2512f4720dc8dda773f969892776cd35664473482332062e3025d0efd | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xad900a08b042207d9c185bc0babe46bd7291830895a3af6143fc7d576eb0cfa3 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xadb282a0a1779c1e407152416708a554232bb5de0b5bb97d302439924cdfc79d | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xaf863cecec9e99cd8d7e2108e5289c6edf27eaa663a5d02e0cd7d2f58f833e50 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb28b58314d55e69047f8c00251a630b2a02d812f43bb810f77836ed2c68307ac | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb2fbcfc409816191124573304f189d67c31493278b19603564eca52af1e1668d | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb371a336f5a0ec74c4e3a26691dc3f2233882535dcac92e8a74b82f28b7a7859 | docs/runs/2026-11-10-metal-extra.md, docs/runs/README.md, docs/submission/long-description.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb4f04a35418ea5593f18c2436b33459818163661c5748e43f4f41c5b56c8cf0b | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb64d78eaaaab1281ba2404432d5a4784f1600099d5e0ad92fb1fe60a948d82bc | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb6eff587c71ddec3014503364135c5072c6e1a1315df5abf52d26e554ddd315d | docs/runs/2026-11-12-faceid-onchain.md, docs/runs/README.md, page metal and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb7451dbf2b4d3c621a2dbe4082bec3b0c1763244646399d19d1fe8c40b92a282 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb7ef08bb4531c3cbd4b56f4307255b4d88f68d279c8073d9bc96d352fb3d44ad | docs/kit11.md, docs/metal-award.md, docs/submission/README.md and 5 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb8fe41c81170039ee9937df0a35e504d01eb78c02f162c5087a06fbc363b9ffa | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xb941d7db8b78e0bd9a4b3405b0af069d3e472b0899ee537a18eb9ca2611cd0c4 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xba330558c8637a95f6aa4bd45c2d5ff3d297aed1747c547c7b12f66e6ac84c38 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, page demo |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xbdb5b8f21a1a856b813d49a211dfcb8c8af904cac37982343b7d83058657b0a8 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc27764bec045d4c8a573672b68b5e222098c8f9f07ada65bd06ca4ed19726fad | docs/runs/2026-11-12-tokenize.md, docs/runs/README.md, page metal and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc2eb68144c8285a07ac6687a8f1c8085e9ee2826f8d6043663073eca2e79f237 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 5 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc3ac51e43f02dcb234a854358a6b74116091e61684c783be07bebb1e4da656cf | docs/runs/2026-11-12-tokenize.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc3e7487eb6e8ac862d2bd029f992795c5bcbad2588a64899614e0d6ac13ec237 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc6e1f0b284b3d7d21124edf06cb1691e5d037819c147659f3b68741d4b000723 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc704078ef23e2af7cb03dd01ee6c1bb169a6ecff4ce3aaa7085b22f565596ded | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc7f59df339cf9f4ec578d8c2c809b3563e050727d76134c0f52c5ddc573a3b59 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xc82912c30de9c996cb2b397989c1518e38ff3a32824c2e1a39b2d83d00bdb8cd | docs/metal-qa-2026-11-01-week.md, page proofJson, page runs |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xcf02673efcad2326c0bb8603be23d3972f744a11c7b99ecf7156b69b0fe4ab4e | docs/runs/2026-11-12-tokenize.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xcf11b76d424f22ca07c514e9a9acb325238ea851f8c600ee92a578b6e421bed1 | docs/metal-award.md, docs/runs/2026-10-30-friday-1.md, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xcfb214b1e950035b44f9785d0f7dbe55e8cdf59420247fb6d5f5928c9a03875d | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd00cf2e49eb85619d999b667628d6a1683088515b95507910af1cde1b0d7de7a | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd3bf7e0df56fc267ff071fdbe2356ccd9270fb62585dbf31b0c9fef8b3e29f3e | docs/runs/2026-11-12-faceid-onchain.md, docs/runs/README.md, page metal and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd4c40c277410d5c2769db1b316b40a222b4e32081bed6300815ff643d2ff9b91 | docs/runs/2026-11-12-tokenize.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd5a11eca1a5d2d94ada310eb382b3348a64819453d8384fe291dac3f1c56a2d8 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd5f548251d6c1e174a8b27e1ce61d51301a3375d5fcf956c10b5713886a59134 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd95bf33cb2ec1ac3c910011c94c023fd89849ec015590463359e385dcbb7900c | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xd98e94ffa3c859de037f944322b05c0f3a097f45780dbd1b8ec9d4689961d30d | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 3 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe0976c5a0ad7ebe51ed0bc9564b2f366fd141b6ba24a55b09fe71ea23e2269c3 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe20e14284212a1c4db1ddce86908693201df58026188660557eada96dd8de45a | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe44a3460faf6cb2050067bf22791df61803f8646adeb5fcc2a205d1f1afa75e5 | docs/idea-vs-build.md, docs/metal-award.md, docs/runs/2026-11-03-main-run-metal-transactions.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe4bf79623f9cb9212a49ea7c0ced60d241041051f322d199e319989d6548c89d | docs/idea-vs-build.md, docs/kit11.md, docs/metal-award.md and 9 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4 | docs/runs/2026-11-12-faceid-onchain.md, docs/runs/README.md, docs/video/film-v10-shots.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe892abfd354543e27f777bd76bdbdb65b6c74e0402b301be00935fcff38fa884 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xe9e765bb66eed6654e78f3a015d60d787e7d2810a01902eefc133c3386ac37d6 | page metalReport |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xebd682c7b7f15a87193b2fee145337c0118b6ef0b7e948c48bd9983ffbcf8ae0 | docs/runs/2026-11-12-tokenize.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xee14c617291c39d0f41659d52ef2b397d6539b6911d9d027579c67266295eb44 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xef3c845b00bd7066638ff2acbe97f9e8ef0cb786bed240bc3a4c1263c78f32be | docs/runs/2026-11-12-tokenize.md, docs/runs/README.md, page metal and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xefc6831934784df1ae4b65a0d03d5f2e9e08c1d009ef4bd73d07844b5559b575 | docs/runs/2026-11-12-tokenize.md, docs/runs/README.md, docs/submission/long-description.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf1a7fe9664053c9d2fdf1b2d11122bde5be0668da8afc8d4f17b08088e220c37 | docs/metal-award.md, docs/metal-qa-2026-11-01-week.md, docs/runs/README.md and 4 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf23d83dc77d754a7ea984de3392f067e14ed03e45cb3e7b21db0c60fcd0c7b0b | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf45301127515cc35511591538a221d95c16c6e87f387c9317a844572db93a1a6 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page dashboard and 2 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf4bdd52d65aa032f49901788fb251805aca415238811b1d4eb2ee1defd86cf23 | docs/runs/2026-11-03-main-run-metal-transactions.md, page dashboard, page replay and 1 more |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf6b06a110202d82ee4554ef78643e157f18285460b3d4065607672ce1915f555 | page dashboard |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf97bcade4a83d7a23198660bee37e1c84d72d6da153eaf6d49f39cd8f542f98d | docs/metal-qa-2026-11-01-week.md, docs/runs/2026-11-12-metal-inspector.md, page metal |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xf9be147f549664028372ade452a2fd650d3265c87dbd215b07083a2ad659e93f | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xfab9cc3dc73a8526566ab5e16ac705f48483dd59fb4766c56c2ef6eb9ddac4c6 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xfacf21264a589d1caf93b3c0a5c4862a6592e78659114afec3361a9fa52036a8 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xfd1db54e3a59b90984b850fece4735a4255ec975810be2d817f8c5b35cefb1d5 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xfdfa0cfca372c97894127e78b9ede8946365850e09b1a01b30b8c10e166c4fb4 | docs/runs/2026-11-03-main-run-metal-transactions.md, page agents, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xff8debd3c0a4dea07b0eeceb84bb2bc22e23273ad534f9fe4ba199f78a0a9516 | docs/runs/2026-11-03-main-run-metal-transactions.md, page trace |  |
| ok | 200 | HEAD | https://testnet.metalntwx.com/tx/0xff9aaa36168e043c1a40e4d858f75499fba4fda57b89c9bbd2a356d56971c64f | page metalReport |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/accounts/receive-funds/receive-bank-transfers-to-global-accounts/simulate-deposits-to-your-global-account | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/finance/financial_transactions | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/issuing/cards | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/issuing/transactions | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/payments/payment_intents/confirm | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/payments/payment_intents/create | docs/airwallex.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/payouts/transfers | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/scale/accounts/create | docs/airwallex.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/transactional_fx/conversion | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/api/transactional_fx/quotes | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/connected-accounts/about/about-connected-accounts | docs/airwallex.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/connected-accounts/about/platform-relationships | docs/airwallex.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/developer-tools/ai/agentos | README.md |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/issuing/card-controls/authorization-controls/transaction-limits | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/issuing/get-started/create-cards/create-commercial-cards | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payments/integration-options/web-checkout/hosted-payment-page | docs/airwallex.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payments/payment-methods/global/airi | docs/plans/vic-airi.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payouts/batch-transfers/create-a-batch-transfer | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payouts/beneficiaries/create-beneficiaries | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payouts/beneficiaries/verify-a-beneficiary-account | page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payouts/transfers/create-a-transfer/transfer-statuses | docs/airwallex.md, page airwallex |  |
| ok | 200 | HEAD | https://www.airwallex.com/docs/payouts/transfers/manage-transfers/manage-approvals-for-transfers | docs/airwallex.md, page airwallex |  |
| ok | 204 | HEAD | https://youtu.be/n3HLVGROJc4 | README.md, docs/releases/v1.1-submission.md, docs/submission/README.md and 5 more |  |
| ok | 204 | HEAD | https://youtu.be/PNLuqhRzVfE | README.md, docs/idea-vs-build.md, docs/submission/README.md and 9 more |  |
| ok | 200 | GET | https://developer.visa.com/docs/visa-intelligent-commerce/concepts | docs/claims.md, docs/plans/visa-1114.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/learning.md | docs/submission/long-description.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/run-it.md | docs/submission/README.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-14-t0-readback.json | docs/submission/long-description.md |  |
| ok | 200 | HEAD | https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/submission/long-description.md | docs/submission/README.md |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/try/sign | docs/after-the-kit.md, docs/claims.md, docs/in-depth.md and 6 more |  |
| ok | 200 | HEAD | https://kit11.max-31b.workers.dev/watch | docs/submission/pitch.md |  |
| ok | 204 | HEAD | https://youtu.be/mp9fmOYfBWc | docs/claims.md, docs/requirements-matrix.md |  |
| ok | 200 | HEAD | http://adaptivecards.io/schemas/adaptive-card.json | docs/connections.md |  |
| ok | 200 | HEAD | https://airwallex.com/oauth/authorize | docs/real-customers.md |  |
| ok | 200 | HEAD | https://airwallex.hackerearth.com/ | docs/assets/logos/SOURCES.md, docs/requirements-matrix.md, docs/rules.md |  |
| ok | 200 | HEAD | https://airwallexdev.com/agentic-banking-builder-guide.md | docs/plans/vic-airi.md, docs/requirements-matrix.md, docs/rules.md |  |
| ok | 200 | HEAD | https://airwallexdev.com/guide | docs/plans/vic-airi.md |  |
| ok | 200 | HEAD | https://alta.finance/ | docs/assets/logos/SOURCES.md, docs/evidence/logo-permissions.md |  |
| ok | 404 | GET | https://api.cybersource.com/ | docs/visa-icc.md | API endpoint, not a page (answered 404) |
| ok | 404 | GET | https://api.in.cybersource.com/ | docs/visa-icc.md | API endpoint, not a page (answered 404) |
| ok | 403 | GET | https://api.sandbox.airwallex.com/api/v1 | docs/airwallex.md | API endpoint, not a page (answered 403) |
| ok | 403 | GET | https://api.sandbox.airwallex.com/oauth/token | docs/real-customers.md, docs/runs/2026-11-12-real-customers.md | API endpoint, not a page (answered 403) |
| ok | 404 | GET | https://apitest.cybersource.com/ | docs/visa-icc.md | API endpoint, not a page (answered 404) |
| ok | 200 | HEAD | https://app.airi.com/ | docs/plans/vic-airi.md |  |
| ok | 200 | HEAD | https://app.airi.com/device | docs/plans/vic-airi.md |  |
| ok | 200 | HEAD | https://businesscentertest.cybersource.com/ | docs/runs/driver/icc-runbook.md, docs/visa-icc.md |  |
| ok | 200 | HEAD | https://checkout.sandbox.airwallex.com/ | docs/runs/vic-1-plan.md |  |
| ok | 200 | HEAD | https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol | docs/business/problem.md |  |
| ok | 200 | HEAD | https://console-testnet.metalntwx.com/ | docs/run-it.md |  |
| ok | 200 | HEAD | https://corporate.visa.com/en/about-visa/mediakits.html | docs/assets/logos/SOURCES.md, docs/evidence/logo-permissions.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/api-reference-assets/index.html | docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-enrollment-enroll-a-card.json | docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-payment_events-confirm-transaction-events.json | docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-payment_events-retrieve-payment-credentials.json | docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-purchase_intent-cancel-a-purchase-intent.json | docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/api-reference-assets/specs/acp-swagger-purchase_intent-initiate-a-purchase-intent.json | docs/runs/driver/icc-runbook.md, docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/home.md | docs/visa-icc.md |  |
| ok | 200 | HEAD | https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-about-guide/intelligent-commerce-recent-revisions.md | docs/visa-icc.md |  |

## Not asked (over the budget)

- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-confirm-trxn-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-enroll-card-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-initiate-flow.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-order-flow.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-passkey-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-passkey-intro/tms-net-tkn-card-authenticate-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-passkey-intro/tms-net-tkn-card-create-passkey-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-intro-requirements/intelligent-commerce-tms-ii-intro.html
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-process-trxn.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-purchase-cancel-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-purchase-initiate-intro.html
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-purchase-update-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce/intelligent-commerce-retrieve-credentials-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-http-message-conf-intro.html
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-security-key-pair-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-http-message-intro/restgs-test.md
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-intro.html
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-message-intro/restgs-jwt-const-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-message-intro/restgs-mle-intro.md
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-shared-secret-intro/restgs-jwt-con-shared-secret-intro.html
- https://developer.cybersource.com/docs/cybs/en-us/platform/developer/all/rest/rest-getting-started/restgs-jwt-shared-secret-intro/restgs-mle-shared-secret-intro.md
- https://developer.cybersource.com/hello-world/agentic-sandbox.html
- https://developer.cybersource.com/hello-world/testing-guide.html
- https://developer.cybersource.com/products/intelligent_commerce.html
- https://developer.moneybird.com/authentication
- https://developer.visa.com/capabilities/trusted-agent-protocol/product-terms
- https://developer.visa.com/docs/trusted-agent-protocol/product-terms.md
- https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications
- https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications.md
- https://developer.visa.com/docs/visa-intelligent-commerce.md
- https://developer.visa.com/docs/visa-intelligent-commerce/workflows
- https://developer.visa.com/terms
- https://developers.cloudflare.com/queues/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://docs.metalntwx.com/agents/clearing
- https://docs.metalntwx.com/agents/clearing.md
- https://docs.metalntwx.com/agents/facilitator.md
- https://docs.metalntwx.com/agents/mandates.md
- https://docs.metalntwx.com/agents/metal-agent.md
- https://docs.metalntwx.com/agents/x402-on-metal.md
- https://docs.metalntwx.com/build/controls/create-and-manage-a-smart-account.md
- https://docs.metalntwx.com/build/payments/authorized-payment.md
- https://docs.metalntwx.com/build/payments/direct-payment.md
- https://docs.metalntwx.com/build/payments/payment-from-reserved-funds
- https://docs.metalntwx.com/build/payments/verify-and-reconcile-payments.md
- https://docs.metalntwx.com/build/prepare/estimate-and-record-fees.md
- https://docs.metalntwx.com/build/prepare/fund-a-test-account.md
- https://docs.metalntwx.com/changelog.md
- https://docs.metalntwx.com/learn/compliance/regulatory-access.md
- https://docs.metalntwx.com/reference/compliance/receive-policy.md
- https://docs.metalntwx.com/reference/network-fundamentals/settlement.md
- https://docs.metalntwx.com/start/introduction
- https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
- https://github.com/airwallex/airi-cli
- https://github.com/airwallex/airi-cli/blob/master/docs/airi-get-started.md
- https://github.com/airwallex/airi-cli/blob/master/skills/airi-get-credential/SKILL.md
- https://github.com/airwallex/airi-cli/releases
- https://github.com/visa/ai
- https://github.com/visa/trusted-agent-protocol
- https://kit11-next.max-31b.workers.dev/
- https://kit11-next.max-31b.workers.dev/runs
- https://kit11-next.max-31b.workers.dev/security
- https://kit11.max-31b.workers.dev/.well-known/security.txt
- https://kit11.max-31b.workers.dev/replay?scene=1
- https://kit11.max-31b.workers.dev/replay?scene=2
- https://kit11.max-31b.workers.dev/replay?scene=3
- https://kit11.max-31b.workers.dev/try/stage
- https://kit11.max-31b.workers.dev/x402/proof
- https://kit11/
- https://moneybird.com/oauth/authorize?client_id=%E2%80%A6&redirect_uri=%E2%80%A6&response_type=code&scope=
- https://moneybird.com/oauth/revoke
- https://moneybird.com/oauth/token
- https://moneybird.com/user/applications/new
- https://platform.claude.com/docs/en/about-claude/pricing
- https://purser-try.max-31b.workers.dev/v1/try/admin
- https://registry.modelcontextprotocol.io/v0/servers?search=io.github.agamemnon-coder/purser
- https://registry.npmjs.org/@airwallex%2fairi-cli
- https://testnet.metalntwx.com/
- https://testnet.metalntwx.com/address/0x15eb7c1322952e0c549b7da0b57d35171518a41a
- https://testnet.metalntwx.com/address/0x15Eb7c1322952E0C549b7Da0b57d35171518A41A
- https://testnet.metalntwx.com/address/0x1936e1869FadF65a53B8492fb6ccCf21200d42ED
- https://testnet.metalntwx.com/address/0x24c159D585981113357aE805fA49ce1B0f2044C4
- https://testnet.metalntwx.com/address/0x7b71643913d05D14376562B3682dd1A45CCa6cdf
- https://testnet.metalntwx.com/tx/0x
- https://testnet.metalntwx.com/tx/0x00fefc993f25e4f214367f8529c7683c9340539de9fb4205806f1ae1f2b0fbef
- https://testnet.metalntwx.com/tx/0x0197b1c9e3c8339775439ff90b22d416644f9f0774fc58244826cc724c622281
- https://testnet.metalntwx.com/tx/0x0b257c8deb359d1df85fc934bf112ec2f9e00211f532aeeb11826151917799ca
- https://testnet.metalntwx.com/tx/0x0db87f8d32cd5158fd5b333386e191efabce20aeeab2ca18585d1a351f33a578
- https://testnet.metalntwx.com/tx/0x12a319f3baf957dbbb6a6cadfc4f1dda0a28ccda6fe4c4f766de1853fad576ee
- https://testnet.metalntwx.com/tx/0x1844bff9d11282add2b74a3cc639e61cc6b3258bff87d44b00eb98b90e82fea8
- https://testnet.metalntwx.com/tx/0x217da656e278a1264dad7c0ae9ed50f41b6d34c52356229e44d691a3fcf8f898
- https://testnet.metalntwx.com/tx/0x22eb392b9bc6824135ca710fc130305a320bc6794b21b5e16122d2c3eab94a3d
- https://testnet.metalntwx.com/tx/0x2744a9c03a957c655a98ac74d66229a93ba3e5196286228a6527c5cf979e49d8
- https://testnet.metalntwx.com/tx/0x2c2f1fa5ce4b63efbfbac31217947cb45f0d9223429d7ad10a1ea128c8929e1b
- https://testnet.metalntwx.com/tx/0x330a3c74de47d4334aa30d1175a1d81e19713e3ac209beb08bfff4f89b4911d8
- https://testnet.metalntwx.com/tx/0x336b16557daa65ff2d6b49a6f2a99bfaf2578036a32b82e0dd14dc1a486a698b
- https://testnet.metalntwx.com/tx/0x339b65e4dea2441600f48c7a1880d48c6b185cc6034de6b6d72f4de7978218e9
- https://testnet.metalntwx.com/tx/0x33fb24ff25bdac52b38767d3e71064106bff106e51cb7bcb7f3633ac1c4f44fc
- https://testnet.metalntwx.com/tx/0x3404a5fa4e4c5b4b4141f1084c3b22049d6e5cfe7c209ed664b098c48e074730
- https://testnet.metalntwx.com/tx/0x39efb6f27ae8dc598c06a0c9c9c5db6031c8e94c2afa63cbf59b5bd9adaf44ab
- https://testnet.metalntwx.com/tx/0x3caf1e9dbb0d2fca75e5af80dc825d3790dbeac5a0ff1c3f83a7dd700f7811b7
- https://testnet.metalntwx.com/tx/0x3ea88238d02726a8eeb129214b4b57e233fdfec76418e2995d9062a91654be03
- https://testnet.metalntwx.com/tx/0x3fd87766d4392f93ed20a88c47d6d5e7a1c7fee2a8d534990371694aed9321a5
- https://testnet.metalntwx.com/tx/0x41203e6e35aaa3e29d863c1adf9effc227b5940c52feed310a0bc08c7cac3e76
- https://testnet.metalntwx.com/tx/0x479c52f30326c7bf7b87def688f3cbefb869b606e2fb63eb61ec534f9cbd0cc0
- https://testnet.metalntwx.com/tx/0x47f83737060e34446c20a07de30026bd153618b5694b42bc4141e0f055770a3a
- https://testnet.metalntwx.com/tx/0x4b9b0ad7e1e9c5dffbb6c64719e66b97b38375512cf0e6265be4b4d03a3c5e6d
- https://testnet.metalntwx.com/tx/0x4c995a768da10d611bee3d82d0d54812b3018bbdc12969bc4c20e46f3a5dccdc
- https://testnet.metalntwx.com/tx/0x508a71d2de0fda97a8d2ba2f26a500059e8841ffea7c48bed082e8e43516b786
- https://testnet.metalntwx.com/tx/0x52275a117c8a164b8d5e7601fc43bb994d93b8ffe6699ad5548809977437c6f0
- https://testnet.metalntwx.com/tx/0x5e903a732c3895cda73a26dd6bc22645f350235e9a99042d4830c0f8ebf97a96
- https://testnet.metalntwx.com/tx/0x695eea1d805f30d646e0eb530d8e55dd15fda6834a609ef53f8bd11006dcfa83
- https://testnet.metalntwx.com/tx/0x6b77d9942f5e7ff9669c0a2fd11d4cea166f7db4eaf3f9728c89bc45ac846f7e
- https://testnet.metalntwx.com/tx/0x6df197fff130c8262a7ea743410c97e5dd1fa30cbbce66b4a4ceedf8f90a3961
- https://testnet.metalntwx.com/tx/0x6ea6668492b625f7812cbae5be1178dc2adc13f83342136b074a547283378e0e
- https://testnet.metalntwx.com/tx/0x6f78e7f8f0c20903733f427abe41a677c66834a0811c78277a80a0444b32447e
- https://testnet.metalntwx.com/tx/0x70ea7081a4c82b998560d38a4ddfabbfd59a03cf136e117129b15cc6b00d22a6
- https://testnet.metalntwx.com/tx/0x7130c869e6b92074befcdb247ef1e299a1b915f595600dab1df03c80be27aa6d
- https://testnet.metalntwx.com/tx/0x732c0e92568a6578c7179773579a0adfba0d8d80d6387ddd7cd9e39159c3691c
- https://testnet.metalntwx.com/tx/0x74cfedf135e7ef33cfa02bb9f1bc35beb5a2af645d81d6e6d9614af5bb9ca791
- https://testnet.metalntwx.com/tx/0x74e8a46282c971b3497b6a9917882cb33fdad44837597897a9c9a508925ba18c
- https://testnet.metalntwx.com/tx/0x768374fa011243686d14fdf3ab03089b3326be74dc15df7c9bf486d144b51346
- https://testnet.metalntwx.com/tx/0x76fac750da15ed1f616533b528d16b1095caa04c4283da3ba675e43eb5f673ed
- https://testnet.metalntwx.com/tx/0x77bc5185a8f70e42941e51078162706f437dbd7ff344f1f4c6a679456d436cb7
- https://testnet.metalntwx.com/tx/0x788788eec4c8d99bb7d7129a68f0a0eea42412b87879d8ec41e66cefee0c08d1
- https://testnet.metalntwx.com/tx/0x790c42d467844300869f917e0e33e1ccc509ad089029ebcf04bf40c90c717754
- https://testnet.metalntwx.com/tx/0x7bd269593fc2add443e10646e08d3ff56f1c77ae84e3ba86216de2a316d12add
- https://testnet.metalntwx.com/tx/0x7c53378d3e989e8f780657f39392dfd0a319a79cb0e4d84aae158a430fd0486b
- https://testnet.metalntwx.com/tx/0x87c3aca2ea9444c04550064b22a0ff3c7c486b0d244e33a29de1ec968d30b30c
- https://testnet.metalntwx.com/tx/0x88bacab033145185b3d1f671695d569d24035a23de4193c1d08b5a8879d7ec25
- https://testnet.metalntwx.com/tx/0x8a0add8a37517d9b8b8bd2989fce757808e6a275c486d8f24f88d287ce4c97e4
- https://testnet.metalntwx.com/tx/0x8d5430f7f9e45972b01903e84fd2d744689cc8f9d52f404d23a467afabb61393
- https://testnet.metalntwx.com/tx/0x8e27fbf49f27a12477990fc6c285483e4378aa51f5e16e087313cc0acfd7fbae
- https://testnet.metalntwx.com/tx/0x90d970d336f7acbc66e061d96dee6c9dcfe8969113cb461c3bb5e8ed91aba2eb
- https://testnet.metalntwx.com/tx/0x91262cf765ca1fdfafc30e37aab56b61698da13595ecf451f084188ae6cfa1bc
- https://testnet.metalntwx.com/tx/0x91e21e8e250c56b08b76cfde25e3495f47ef208f389615e91d5e9728a92a5253
- https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f
- https://testnet.metalntwx.com/tx/0x9a1f5fe03e0be5d8c69f0f9af00d24ef3d94f86e6c0e756ffeec48cc416ed94a
- https://testnet.metalntwx.com/tx/0x9ce719f551df11e2c60075206ea0704e09f56d6412d987c31c1305c1b9b2e6ea
- https://testnet.metalntwx.com/tx/0x9d9c1807ca44ae2b835c35c5530e0645f1ecd3622aec6d7eb5a79319998e1f10
- https://testnet.metalntwx.com/tx/0x9f16b5ba3a3045a81560ec313365fdccf4a4804f5a47abaad0986c623fef2cda
- https://testnet.metalntwx.com/tx/0x9f58cab1cc1e5466184da28e22d49193d7a428bb25cb73822c597bb54bba206d
- https://testnet.metalntwx.com/tx/0xa4fb723c41bddbe6de84ac1064aa9abbadaab3a2d4c5be29efeba04e25b48e52
- https://testnet.metalntwx.com/tx/0xa54182873017cd2ad4c8120c1d5e2c6cd9bbbfd58ee4a01ccbca933b80f84a3f
- https://testnet.metalntwx.com/tx/0xaebf04e8cd8046b4244e9bcdaceac563581f54ae441de6a304ff8d63cd28cbd5
- https://testnet.metalntwx.com/tx/0xaef30865033f010c79a38f2992f458d849e56ca2fd62b1f78c263a3e2650e66c
- https://testnet.metalntwx.com/tx/0xb06e906dba2c559893bacdb5fe4aa6c7d4109604d19c78a3c2443f9cb3d88470
- https://testnet.metalntwx.com/tx/0xb1723632242a7951136860c69baa46561c0d7d637b73196d98b6a051037e6d4b
- https://testnet.metalntwx.com/tx/0xb29628dd47cc27aebe345ebc19f0af38da6a733dc67a46698d3d8fe13a69fc2f
- https://testnet.metalntwx.com/tx/0xb5ad2ce898f56c1233b0e20d5ef231cf1517354e591f8e4ba246481d74acf6cf
- https://testnet.metalntwx.com/tx/0xba17181a61df978caa23e49cc80906913f59bab2059f23e424458a5347ec4d19
- https://testnet.metalntwx.com/tx/0xbec1155a17665cf43c7c95ccade9808af4f02ba7861793836e5052a72b5de1b5
- https://testnet.metalntwx.com/tx/0xbf102c580d973ebb478da5eea50e37f23eb0ee0f34f0e57ec2cb03c008a88edf
- https://testnet.metalntwx.com/tx/0xbf1c36253692e403c470426df4fec389b1da04326ff66bdf612937e2d89295aa
- https://testnet.metalntwx.com/tx/0xbf89f70e77d7f41384d76b70ec1d7a6baff4166f3d6d4b953a4ed97d374a2951
- https://testnet.metalntwx.com/tx/0xc1b06070a050556f5e2ef820fb2826dd1babde33787fab5c75aef7d3b677ecfa
- https://testnet.metalntwx.com/tx/0xc3c050eacce9be159c2c70cc03df080a59cb8034f19f60a3ebc6945e66fd4505
- https://testnet.metalntwx.com/tx/0xc4c57ff1368b1d10e55c889fc32c07edef8aeffb1d3f6a747ab3399c6dd03f65
- https://testnet.metalntwx.com/tx/0xc65fd6708f62a3e91c3396af3cdfb1b2ebbf0eb468eba66cfdd63f58f1a3376d
- https://testnet.metalntwx.com/tx/0xc736b29d41cb6f296a0b2a71a1c3148e48164b458d656a95ae34f6ed3728a924
- https://testnet.metalntwx.com/tx/0xcddb61cfc1658612dbc35f65d7dc739abaee5bb33ed16358ce4957c873ef28da
- https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc
- https://testnet.metalntwx.com/tx/0xd288df0a0fc281f051796e2768ce8d5f98f66c742aacdc509550815aa29420a1
- https://testnet.metalntwx.com/tx/0xd4b4d0454f340547aa027fbdab66ccd56af2abf581821bb7ea2a099a8cb0c29c
- https://testnet.metalntwx.com/tx/0xd525573c5ef06c01e4a92c39f0ab087c06ef21ec5281a3a490dfe410615919bf
- https://testnet.metalntwx.com/tx/0xd685371f38a94b47fe068ffa86d9bae42a9aab6bd50e377e828e41dc4c65b20d
- https://testnet.metalntwx.com/tx/0xe0650566bc9752b1dc23c28ca082c804e3ab974cf821dd3f3ca8049f241328d3
- https://testnet.metalntwx.com/tx/0xe4c34b9faf726e898a2eb6f8d302e3a6d8975b36d81e206ecdfd26453b6fff2d
- https://testnet.metalntwx.com/tx/0xe662b65208936096cef39c4e3c1968ca963d0b57b0359a5190e33c98f2a63ba2
- https://testnet.metalntwx.com/tx/0xe78b3197e617179a3a78fd0f59c4a8f05715984caca0594e82e0d293edd9c729
- https://testnet.metalntwx.com/tx/0xe7c0f5264ae55adad87163e60c7598cb8057faf951d1e9b1073c8c6683d8d15d
- https://testnet.metalntwx.com/tx/0xe8150bf7c4f98d85085d470e8f7b2ef9ca9bdc9adda812768f3aefdec26aafd5
- https://testnet.metalntwx.com/tx/0xe84330d5b6869679d11596a2ef235dc9bd5cc280e38f7509b4835172fb006f0b
- https://testnet.metalntwx.com/tx/0xf5ebbba94f42ed0a0d7f1fdf51f4d0d51b1889eb4d8fa0db37e8f608a87fdc79
- https://testnet.metalntwx.com/tx/0xf6f364ea7114b3b3bd47271b4938677629744a939ac9af285733c8b86a33643d
- https://testnet.metalntwx.com/tx/0xf8034e6cbfbd11723bc57c1a2bf982e8d92329753e3b75e83a5544d14e291e1d
- https://testnet.metalntwx.com/tx/0xfbb55b23f8514a2579a65bb57f66e5be99eff3c4983adcd73601fe64193ab201
- https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21366.html
- https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22276.html
- https://vscode.dev/redirect
- https://www.airwallex.com/airi
- https://www.airwallex.com/docs/api/scale/accounts/retrieve
- https://www.airwallex.com/docs/connected-accounts/onboarding/kyc-and-onboarding/hosted-onboarding
- https://www.airwallex.com/docs/developer-tools/api/api-key-best-practices
- https://www.airwallex.com/docs/developer-tools/api/manage-api-keys
- https://www.airwallex.com/docs/developer-tools/partner-connections/implement-your-authorization-flow/existing-customers
- https://www.airwallex.com/docs/developer-tools/partner-connections/notifications-and-workflow-automation
- https://www.airwallex.com/docs/developer-tools/partner-connections/oauth-permissions
- https://www.airwallex.com/docs/developer-tools/partner-connections/oauth-scopes
- https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events/account
- https://www.airwallex.com/docs/developer-tools/webhooks/listen-for-webhook-events/partner-connections
- https://www.airwallex.com/docs/partner-api/authentication/oauth2
- https://www.airwallex.com/en-eu/pricing
- https://www.airwallex.com/en-sg/blog/agentic-payments
- https://www.airwallex.com/en-sg/blog/agentic-wallet-ai-payments-singapore
- https://www.airwallex.com/en-us/blog/agentic-banking-governance
- https://www.airwallex.com/en-us/blog/airwallex-agentic-finance-guide
- https://www.airwallex.com/en-us/payments/agentic-commerce
- https://www.airwallex.com/en-us/payments/airi
- https://www.anthropic.com/press-kit
- https://www.businesswire.com/news/home/20251014974512/en/Visa-Introduces-Trusted-Agent-Protocol-An-Ecosystem-Led-Framework-for-AI-Commerce
- https://www.cloudflare.com/press-kit/
- https://www.cloudflare.com/trademark/
- https://www.coinbase.com/developer-platform/discover/launches/x402
- https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
- https://www.fool.com/earnings/call-transcripts/2026/10/28/visa-v-q4-2026-earnings-call-transcript/
- https://www.googleapis.com/auth/drive.file
- https://www.hackerearth.com/community/challenges/hackathon/agentic-banking-hackathon/
- https://www.ic3.gov/AnnualReport/Reports/2025_ic3report.pdf
- https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf
- https://www.mastercard.com/us/en/news-and-trends/press/2025/april/mastercard-unveils-agent-pay-pioneering-agentic-payments-technology-to-power-commerce-in-the-age-of-ai.html
- https://www.pleo.io/en/pricing
- https://www.sandbox.airwallex.com/oauth/authorize
- https://www.sandbox.airwallex.com/oauth/authorize?response_type=code&client_id=%E2%80%A6&redirect_uri=%E2%80%A6&state=%E2%80%A6&scope=
- https://www.visa.com/en-us/solutions/intelligent-commerce
- https://x.com/dankimxyz/article/2107199865004634605

