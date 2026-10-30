# Hardening log (30 October to the freeze on 4 November)

Max's plan of 30 October: tests, chaos, lint, red team, an independent review, supply chain, and the list before
going public. Each finding gets a row; a row is closed only with a commit and a test. Code that moves money is not
changed before the Friday runs: those fixes land after run 2.

## Measured

| What | Result (30 Oct) | How |
|---|---|---|
| Line coverage per area | Morning of 30 Oct: policy 98.7%, passkey 97.6%, relay 94.4%, money 61.8%, executors 42.7%, clearing 19.0%. After 98 new tests on the Metal executors, x402 payments, clearing and the sweep: money 97.3%, executors 98.6%, clearing 100%, the rest unchanged | `npm run test:coverage`; CI fails if any area drops below 90% |
| Secrets in git history | none, in the code repo and the plan repo (Airwallex, Metal RPC and endpoint, Anthropic, Cloudflare, every Airwallex webhook secret) | value scan of `git log --all -p`, values never printed |
| `npm audit` | 0 in the root and in `worker/` | CI on every push |
| Type checking | `strict` and `noUncheckedIndexedAccess`; no `any` anywhere in `src/` | `npm run typecheck`, `npm run lint` (`no-explicit-any` is an error) |
| Lint | ESLint 10 with typescript-eslint: 15 findings, 4 left in the phone client, passkey intake, card sync and the local approvals page (unused values, a missing error `cause`) | `npm run lint`; joins CI once those 4 files are fixed after the runs |
| Property-based tests | 54 properties with fast-check (200 to 500 runs each) on amounts and rounding, the pay guard, the terms hash, policy from plain words, webhook payloads and MCP input; the 6 that found HF7 to HF11 were kept as `it.skip` with their counterexample until the fix, and now run | `test/property-*.test.ts` |
| Dependency pins | every dependency, dev dependency and override on an exact version | `package.json`, `worker/package.json` |

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| HF1 | The relay rate-limits what the phone sends, but not failed viewer-key attempts on `/api/*` or webhooks with a bad signature: they are refused, not counted. The viewer key is 128 bits, so guessing is not practical; counting them stops floods and makes guessing visible. | low | open (relay change, after the runs) |
| HF2 | JSON answers from the relay carry `nosniff`, `no-store` and `no-referrer`, but not HSTS; the HTML pages do. workers.dev is HTTPS-only, so this is defence in depth. | info | open (after the runs) |
| HF3 | The pre-commit secret scan did not include the Airwallex webhook secrets (they live in the keys repo, not in the environment). | low | fixed: the scan now reads them from the keys dirs; full history is clean |
| HF4 | `docs/airwallex.md`'s scoped-key table missed `GET /fx/rates/current` and `POST /beneficiaries/schema`, added this week. | info | fixed |
| HF5 | ESLint: 15 findings. Fixed now: the injection scanner's invisible characters are written as `\u` escapes (proved identical over all 65,536 BMP characters), and unused imports in the red team CLI and a browser check. Left for after the runs: unused assignments in `src/approve/client.ts`, `src/passkey/process.ts`, `src/servers/approvals.ts`, and errors without a `cause` in `src/policy/cards.ts`. | info | partly fixed |
| HF6 | `netEarnings` (`src/agents/sweep.ts:33-34`) counts only PAID and HELD sweeps and refunds as gone. A pull still PENDING (sent, may still settle) is counted as unswept earnings, so planning a new sweep could plan it again. Today `npm run s3` resumes the unfinished sweep first, and the treasury mandate's budget is a limit on chain, so no money moved twice. | medium | fixed before the Friday runs: PENDING refunds and sweeps now count as gone (`test/sweep.test.ts`); the only caller already resumed an unfinished sweep, so no double sweep was possible, but a PENDING refund could have made the planned sweep too large |
| HF7 | Policy from plain words: a quote is checked as a plain substring and its amount is read from the quote alone, so a quote can cut a number. With "at most €1500 a month", a draft quoting "0" for `approval.refund_each` (0.10 → 0.00) is kept. The CFO still signs the one proposal, but the rule "the model may not split amounts" does not hold (`src/policy/fromText.ts:83, :92`). | medium | fixed on `build/next`: the amount must appear as a whole number both in the quote and in the CFO's text; property un-skipped |
| HF8 | A correctly signed but malformed card event is recorded as an approved charge: `transaction_amount` true, null, [45], "0x2d", "1e2" or "" and any `process_result` are read with `Number()` and accepted (`src/policy/cardHooks.ts:39`, `src/airwallex/issuing.ts:128, :134`). It needs the webhook secret, so it is a misreading, not a forgery; it also counts toward velocity. | medium | fixed on `build/next`: unknown statuses, non-string ids, a bad currency or date and any amount that is not a plain decimal number throw, so the event is not recorded; property un-skipped |
| HF9 | The runner's webhook handler can throw on a signed body (`null`, or a `name` like `{"toString":""}`), though its comment says it never does (`src/policy/cardHooks.ts:31, :35`). The relay only forwards JSON objects. | low | fixed on `build/next`: a parsed body that is not an object with a string `name` is ignored, never thrown on; properties un-skipped |
| HF10 | The relay checks a body that is not JSON against an empty string (`worker/src/core.ts:327`): wrong status codes (400 for 401 and back), nothing kept either way. | low | fixed on `build/next`: the signature is checked over the raw text first (401), then the body is parsed (400 "malformed event") |
| HF11 | The pay guard reads base units with `Number()` (`src/metal/pay.ts:42`) and can round down above 2^53 × 10^16 base units: no practical effect, every cap refuses such an amount. | info | fixed on `build/next`: an offer over 2^53 cents is refused before the guard and before signing; property un-skipped and run over the full range |
| HF12 | Card transactions with the same card, amount, outcome and timestamp are treated as one (`src/policy/cards.ts:205-207`), for Airwallex's two ids per authorisation. Two identical charges in the same instant would count once. Check how precise Airwallex's timestamps are. | low | to check |
