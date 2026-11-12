# Purser Cloud demo deployment: runbook

How to put [demo mode](cloud.md#demo-mode-a-read-only-deployment-of-test-companies) on Cloudflare as a deployment of
its own, check it, seed it again and take it back. **No step below has run yet (12 November): nothing is deployed, and
no command here was run against Cloudflare.** What is tested on this machine is said at each step.

## What it is

| | The demo | The private preview (not touched here) |
|---|---|---|
| Worker | `purser-demo`, on its workers.dev address | `purser-cloud` |
| Database (D1) | `purser-demo` | `purser-cloud` |
| Documents (R2) | `purser-demo-docs` | `purser-cloud-docs` |
| Holds | three seeded test companies, nothing else | the preview's companies |
| Secrets | none | `SESSION_SECRET`, `ADMIN_TOKEN_SHA256` |
| Mail, cron | none | Email Routing, a daily job |

The demo is the environment `demo` in `cloud/wrangler.jsonc`. **Every wrangler command for it carries `--env demo`.**
A command without it acts on the private preview: if you left it out, stop and check what it did.

The demo needs no secret. The Worker otherwise needs two, `SESSION_SECRET` and `ADMIN_TOKEN_SHA256`; in demo mode it
reads neither (`cloud/src/worker.ts`). Do not set them on the demo: with no secret on it, there is nothing to leak.

Its variables are in the file: `DEMO_PUBLIC` is `on`; `DEMO_SLUGS` lists the three companies; `RP_ID` and `ORIGIN` are
its workers.dev address, and the console's page is built for that address. There is no `MAIL_DOMAIN` and no cron.
`test/cloud-demo-deploy.test.ts` checks all of this, and that the preview's settings are unchanged.

## Before you start

- Run every command from the repository root, with `npm ci` and `npm ci --prefix worker` done.
- Sign in to Cloudflare with `npx wrangler login`. Never paste an account id, a token or a command's output with
  them into a file, a chat or a commit.

## 1. Make its database and bucket

```sh
npx wrangler d1 create purser-demo --location enam
```

```sh
npx wrangler r2 bucket create purser-demo-docs
```

Put the `database_id` that the first command prints into `cloud/wrangler.jsonc`, under `env.demo`, in place of
`SET-AFTER-wrangler-d1-create-purser-demo`. Keep that edit out of git, as the preview does. The location is eastern
North America because the people who look at it are mostly in the United States. The demo holds test data only.

## 2. The schema and the test world

```sh
npx wrangler d1 migrations apply purser-demo --env demo --remote -c cloud/wrangler.jsonc
```

```sh
npm run cloud:seed-demo -- --out ../purser-demo-bundle
```

```sh
npx wrangler d1 execute purser-demo --env demo --remote --file ../purser-demo-bundle/seed.sql -c cloud/wrangler.jsonc
```

```sh
(cd ../purser-demo-bundle && sh r2-put.sh purser-demo-docs)
```

The seed command builds the world offline, the same bytes every time, and refuses a folder inside the repository. It
prints each company's counts and the SHA-256 of `seed.sql`; `manifest.json` in the bundle holds every hash.
`seed.sql` first deletes the demo companies' own rows (ids starting `t_demo_`) and nothing else. `r2-put.sh` puts
every object with `--remote`. Tested here: `test/cloud-demo-world.test.ts` runs every statement of `seed.sql` on
local D1. With `npm run test:d1`, `test/cloud-demo-deploy.test.ts` loads the bundle as these steps do into local D1
and R2, starts the Worker in workerd with the demo's own variables and runs the smoke check of step 5 on it.

## 3. Deploy

```sh
npm run cloud:pdfjs
```

```sh
npx wrangler deploy -c cloud/wrangler.jsonc --env demo --var VERSION:$(git rev-parse --short HEAD)
```

Load steps 1 and 2 before the first deploy: demo mode writes nothing, so it never makes its own schema. Without the
schema the health check answers 503 and reads answer 500. `npm run cloud:pdfjs` copies pdf.js into `cloud/public`, so
the console can draw a PDF.

## 4. No secret, and the address

```sh
npx wrangler secret list -c cloud/wrangler.jsonc --env demo
```

It must list nothing. Then open the address in a browser: three test companies, the line "A test world: test
companies, no real money, read-only." on every screen, and no way to sign in.

Rate limits: the Worker allows 300 requests a minute per address and 600 uncached reads a minute per isolate (at most
120 of them from one address), all counted in memory ([cloud.md](cloud.md#demo-mode-a-read-only-deployment-of-test-companies)). A Cloudflare rate rule
belongs to a zone, and a workers.dev address has none, so those limits are the only bound there. Not checked against
Cloudflare's documentation in this session (no external calls). To put a rate rule in front, serve the demo on a
route in a zone of your own; `RP_ID` and `ORIGIN` then change to that address.

## 5. Smoke check

```sh
npm run cloud:smoke-demo -- --base https://purser-demo.max-31b.workers.dev
```

GET requests only, at most 54 requests for the three companies, with no key. It prints one line per check and exits 0
when all pass. The code is `src/demoworld/smoke.ts`; `test/cloud-demo-deploy.test.ts` shows that it passes on the demo
world and fails on a cloud that is not in demo mode, on a refused GET that answers, on a missing company, on a document
that is not what its hash says and on a console page made for another address. Each run uses one of the 300 requests a
minute of your address for every request it makes, so wait a minute between two runs.

**Must answer 200:**

- `/v1/health`: `ok` is true, `demo_companies` is 3, and there is no mail count.
- `/v1/openapi.json`: only the demo's own routes.
- `/v1/demo/companies`: the three companies in order, `read_only` and `test_world`, each with invoices, documents and
  ledger entries.
- `/`: the console, built for this address, with the three companies.
- For each company: `/v1/demo/{company}/me` (`kind` is `demo`, scope `read`), `/v1/demo/{company}/invoices` (each
  labelled stand-in or sandbox), `/v1/demo/{company}/vendors`, `/v1/demo/{company}/payments`,
  `/v1/demo/{company}/transactions`, `/v1/demo/{company}/transactions/summary`, `/v1/demo/{company}/ledger/entries`,
  `/v1/demo/{company}/reports/trial`, `/v1/demo/{company}/insights`, `/v1/demo/{company}/vault`.
- From those: one invoice (`/v1/demo/{company}/invoices/{id}`), its document
  (`/v1/demo/{company}/invoices/{id}/document`), and one vault file (`/v1/demo/{company}/documents/{sha256}`) whose
  bytes must have that SHA-256.
- Not one answer may hold anything that looks like a key or a session.

**Must answer 403 with the code `demo_read_only` (GETs that exist outside demo mode):** `/v1/me`, `/v1/invoices`,
`/v1/keys`, `/v1/users`, `/v1/export`, `/v1/mail`, `/v1/sync/state`, `/v1/admin/companies`,
`/v1/demo/{company}/keys`, `/v1/demo/{company}/export`.

**Must answer 404 with the code `not_found`:** `/v1/demo/no-such-company/invoices`.

**Write attempts: must answer 403 `demo_read_only`.** The smoke check makes none. To try them by hand, send each one
once (`BASE` is the address):

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" -d "{}" "$BASE/v1/auth/challenge"
```

That one is `POST /v1/auth/challenge`. Do the same for `POST /v1/auth/enrol`, `POST /v1/admin/tenants`,
`POST /v1/sync`, `POST /v1/keys`, `POST /v1/demo/northwind-outdoor/sync` and `DELETE /v1/keys/any` (with `-X DELETE`
and no body). `HEAD` and `OPTIONS`
also answer 403, so an uptime monitor must use `GET /v1/health`. These answers are tested on Node and in workerd
(`test/cloud-demo.test.ts`, `test/cloud-demo-workerd.test.ts`), not on Cloudflare.

## Seed it again

When the world changes (`WORLD_VERSION` in `src/demoworld/build.ts`), run step 2 again without the migration, then the
smoke check. Answers kept in memory can be up to 300 seconds old, and browsers may keep them 60 seconds more; a
document fetched by its hash never changes. To drop what the isolates remember at once, deploy again (step 3). For the
few seconds that `seed.sql` runs, a read can find a company half loaded. Objects of an older world stay in the bucket
unused.

## Roll back

- **Code:** list the versions, then go back to the one before:

  ```sh
  npx wrangler deployments list -c cloud/wrangler.jsonc --env demo
  ```

  ```sh
  npx wrangler rollback <version id> -c cloud/wrangler.jsonc --env demo
  ```

- **Data:** the world is the same bytes every time. Run step 2 again from the commit the demo should show.
- **Take it down:** remove the Worker; the database and bucket stay:

  ```sh
  npx wrangler delete -c cloud/wrangler.jsonc --env demo
  ```

  Do not switch `DEMO_PUBLIC` off instead. With no secret on the demo, every request would then fail with 500. That is
  safe, but it is not a way to run it.
- **Remove it for good**, only after the Worker is gone: `npx wrangler d1 delete purser-demo`, then empty the bucket
  `purser-demo-docs` and delete it with `npx wrangler r2 bucket delete purser-demo-docs`.

When the demo is live and the smoke check passes, the texts that today call the hosted preview private change
together, from [cloud-demo-wording.md](cloud-demo-wording.md).
