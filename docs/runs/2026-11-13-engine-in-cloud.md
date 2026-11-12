# The engine in the cloud, on purser-try: the deploy gate's run record

A template. Every field is filled from what a command printed or a run measured, word for word; a field nobody measured
says "not measured". Test money only: the engine pays on its stand-in bank. Commands: [Deploying purser-try](../cloud.md#deploying-purser-try).

## The deploy

- Commit deployed:
- Version id (`wrangler deploy` output):
- Previous version id (none on the first deploy):
- Upload size as wrangler reported it (raw / gzip):
- Start-up check (accepted, or the refusal word for word):
- Time to the first answer of `GET /v1/health` after the deploy:
- First engine call of a fresh company (`GET /v1/engine`), wall time:

## The smoke, one company at a time (`npm run cloud:smoke -- <url>`)

| Run | Make a company | Sign-in passkey | Sign in | Upload | File the payment | Approval passkey | Other terms (refused) | Approve | Invoice back | Ledger back | Archive back | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | |
| 3 | | | | | | | | | | | | |

`--plain` (the cloud alone), once before the engine runs:

## Bursts with polling (`npm run cloud:smoke -- <url> --parallel N --poll <ms>`)

| N | Poll every | Companies passed | Upload p50 / p95 | Approve p50 / p95 | Polls (count, p50 / p95) | Not 2xx (by route and status) | D1 errors |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Errors, word for word

## What was not tried
