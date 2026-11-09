# Purser Cloud: before real money

Every item the reviews named before real customers and real money, with where it stands. **Done** means built and
tested in this repo, with the evidence. **Partly** says what is missing. **Who** is Max (an account, a contract, a
setting only the owner can make) or code. Nothing here is deployed: the cloud is not live.

| Item | Status | Evidence / what is missing | Who |
|---|---|---|---|
| One source of truth for the books | Partly | The payables inbox now posts its accruals into the stored ledger (`89ba10e`), and the cloud computes its reports from that ledger (`test/cloud-sync.test.ts`: the cloud's trial balance, P&L, balance sheet and VAT equal the runner's). The Kit 11 journal (`CHART`, mirrored to T:0) is still a separate chart; folding it in is open. | Code |
| Period locks everywhere | Partly | Month and year closes lock posting through the latest locked month (`src/ledger/close.ts`, `src/ledger/core.ts`); the vault keeps closed months closed (`7e3acd2`). Not yet checked for every writer outside the ledger (ERP push of a late correction). | Code |
| Reconcile path for stuck money | Done | `npm run reconcile -- --holds` lists stuck holds and releases one only when the money is accounted for or a strict Airwallex lookup finds nothing (`40cd9ee`); hourly reconciliation and its alerts in `src/ops/health.ts`. | Code |
| Live sandbox confirmation of fees and field limits | Partly | Both payout reasons (`goods_purchased`, `professional_business_services`) and a 140-character reference were accepted by Airwallex's sandbox `transfers/validate` on 9 November (3 calls); the cap is enforced (`61784f7`). Beneficiary name length and the fees charged on a live sandbox payout are not confirmed. | Code (one more sandbox call, with Max's ok) |
| Cloud database: safe concurrent writes | Partly | Guard rows and compare-and-swap instead of locks (`c6cd861`), proven on local D1 under workerd (`634b75a`, `npm run test:d1`). Not yet run against a real Cloudflare D1 database. | Code, after Max's Cloudflare account |
| WAF and edge rate limits | Open | The Worker limits requests per key, per session and per address on sign-in, and counts failed sign-ins (`cloud/src/app.ts`); a Cloudflare WAF / rate-limiting rule in front of it is not set. | Max (Cloudflare dashboard) |
| Monitoring and alerts | Partly | `GET /v1/health` for an uptime monitor, `GET /v1/status` for owners, structured logs without secrets or account numbers, signed alert webhooks with retries and a cap (`test/cloud-golive.test.ts`). An uptime monitor pointed at `/v1/health` and a webhook receiver are not set up. | Max (monitor, receiver) |
| Quotas | Done | Mail per company per day in messages and bytes, counted before storing (`6e42f01`); requests per minute; webhook events per hour; sign-in challenges per company. | Code |
| Export staging for large companies | Open | `/v1/export` returns every row in one response and lists the documents separately; a very large company's rows could outgrow one Worker response. Staging the export to R2 in parts is not built. | Code |
| Backups and restore | Partly | Export → import round trip with chain and document checks (`cloud/src/restore.ts`, `test/cloud-restore.test.ts`); no command or route runs it in production yet; D1 Time Travel not rehearsed (`docs/cloud.md`). | Code; rehearsal after Max's Cloudflare account |
| Retention and erasure | Done | Erasure keeps the books and removes personal data; a closed company is purged seven full years after its last record, documents and mail included, no other company touched (`test/cloud-retention.test.ts`, on D1 and R2 with `npm run test:d1`). | Code |
| Legal: terms, privacy notice, data processing agreement | Open | Nothing drafted in this repo. | Max |
| Airwallex production account | Open | Everything runs on the sandbox. | Max |
| Domain, Email Routing, SPF / DKIM / DMARC | Open | The Worker's e-mail handler and per-company addresses are built (`cloud/src/mail.ts`); no domain, so no Email Routing and no mail authentication records. | Max (domain); code checks after |
| Secrets in Cloudflare | Partly | The Worker reads `SESSION_SECRET` and `ADMIN_TOKEN_SHA256` only from Worker secrets and refuses to start without the first (`cloud/src/worker.ts`); nothing secret is in git. They are not set, because nothing is deployed. | Max (at deploy) |
| Incident runbook | Partly | The runner's runbook covers every alert, key rotation and stuck money (`docs/runbook.md`). A cloud section (D1 or R2 down, a leaked admin token, a tenant restore) is not written. | Code |
