# Hardening log (30 October to the freeze on 4 November)

Max's plan of 30 October: tests, chaos, lint, red team, an independent review, supply chain, and the list before
going public. Each finding gets a row; a row is closed only with a commit and a test. Code that moves money is not
changed before the Friday runs: those fixes land after run 2.

## Measured

| What | Result (30 Oct) | How |
|---|---|---|
| Line coverage per area | policy 98.7%, passkey 97.6%, relay 94.4%, money 61.8%, executors 42.7%, clearing 19.0% | `npm run test:coverage` (CI fails if an area drops below its floor) |
| Secrets in git history | none, in the code repo and the plan repo (Airwallex, Metal RPC and endpoint, Anthropic, Cloudflare, every Airwallex webhook secret) | value scan of `git log --all -p`, values never printed |
| `npm audit` | 0 in the root and in `worker/` | CI on every push |
| Type checking | `strict` and `noUncheckedIndexedAccess`; no `any` anywhere in `src/` | `npm run typecheck`, `npm run lint` (`no-explicit-any` is an error) |
| Lint | ESLint 10 with typescript-eslint: 15 findings, 4 left in the phone client, passkey intake, card sync and the local approvals page (unused values, a missing error `cause`) | `npm run lint`; joins CI once those 4 files are fixed after the runs |
| Dependency pins | every dependency, dev dependency and override on an exact version | `package.json`, `worker/package.json` |

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| HF1 | The relay rate-limits what the phone sends, but not failed viewer-key attempts on `/api/*` or webhooks with a bad signature: they are refused, not counted. The viewer key is 128 bits, so guessing is not practical; counting them stops floods and makes guessing visible. | low | open (relay change, after the runs) |
| HF2 | JSON answers from the relay carry `nosniff`, `no-store` and `no-referrer`, but not HSTS; the HTML pages do. workers.dev is HTTPS-only, so this is defence in depth. | info | open (after the runs) |
| HF3 | The pre-commit secret scan did not include the Airwallex webhook secrets (they live in the keys repo, not in the environment). | low | fixed: the scan now reads them from the keys dirs; full history is clean |
| HF4 | `docs/airwallex.md`'s scoped-key table missed `GET /fx/rates/current` and `POST /beneficiaries/schema`, added this week. | info | fixed |
| HF5 | ESLint: 15 findings. Fixed now: the injection scanner's invisible characters are written as `\u` escapes (proved identical over all 65,536 BMP characters), and unused imports in the red team CLI and a browser check. Left for after the runs: unused assignments in `src/approve/client.ts`, `src/passkey/process.ts`, `src/servers/approvals.ts`, and errors without a `cause` in `src/policy/cards.ts`. | info | partly fixed |
