# The VIC work, reviewed against Visa's published best-practices skill

What this is: a review of Purser's Visa Intelligent Commerce work against Visa's public agent skill
`visa-best-practices`, in the `visa/ai` repository on GitHub (`skills/visa-best-practices/SKILL.md` and its three
references). Read on 12 November 2026 from the `main` branch. SHA-256 of the files read: `SKILL.md` 286b87ba…,
`references/visa-intelligent-commerce.md` cdda56f4…, `references/vdp-integration.md` 71386e52…,
`references/machine-payments-protocol.md` 6fbeec1c…. The practices below are in our words, not the skill's.

Reviewed: `src/airi/*` and `src/visa/*` on main, the vic-3 conductor on branch `vic-3-1112` (`src/airi/vic3.ts`), and the
run records (`docs/runs/2026-11-07-vic-1.md`, `docs/demo/vic-2-run.json`). This review is our own reading. It is not a
statement by Visa or Airwallex.

**How Purser reaches Visa.** Not through the Visa Developer Platform. Purser's agents use Airwallex's Airi wallet
(`airi-cli`), which talks to Visa Intelligent Commerce for us, and Airwallex's hosted checkout in the Airwallex sandbox,
with Airi's test card and test money. So the skill's practices for calling Visa's APIs directly (X-Pay token, two-way
SSL, message level encryption, VDP certificates) apply to Airwallex's side, not ours. They are listed as "n/a" with the
reason.

## Practices

| # | Practice (from the skill, in our words) | Status | Evidence |
|---|---|---|---|
| 1 | Develop in the sandbox, then certification, then production | met (sandbox only) | Every VIC run is Airwallex sandbox with Airi's test card: `docs/runs/2026-11-07-vic-1.md` (The run), `src/airi/policy.ts:39` (the only merchant is our own sandbox shop). No certification or production step exists. |
| 2 | Keep credentials out of source code: environment or a secrets manager | met | Airwallex keys come from the environment (`src/airi/deps.ts:148`, `src/airwallex/client.ts:96`). The single-use card credential lives in a private temp folder (`src/airi/purchase.ts:346`, mode 700) and is deleted after the one checkout (`src/airi/purchase.ts:387`); it is never logged or returned (`src/airi/credential.ts:1-3`). |
| 3 | Rotate credentials: watch expiry, keep 2 to 3 active sets, revoke old ones after migration | n/a | Purser holds no VDP certificate or key ID. Airi's session belongs to the wallet owner and is renewed by them (`docs/runs/2026-11-07-vic-1.md`, the attempts). |
| 4 | Authenticate with X-Pay token or two-way SSL; mind the VIC resource path | n/a | Purser makes no VDP call; `airi-cli` does (`src/airi/cli.ts:1`). |
| 5 | Message level encryption (JWE, key IDs) for VIC calls | n/a | As 4. |
| 6 | For an AI agent, prefer the MCP route over direct REST | partly | Purser runs Airwallex's `airi-cli`, pinned by version and SHA-256 before first use (`src/airi/cli.ts:1-4`, `src/airi/cli.ts:27`), not Visa's MCP server. The agent never gets the CLI or its output: Purser's executor calls it (`src/airi/purchase.ts:1-17`). |
| 7 | Card enrolment with step-up and a passkey | met (by Airi) | The wallet owner taps in Airi with a passkey before any credential exists (`docs/runs/2026-11-07-vic-1.md`, timeline A and B). |
| 8 | A purchase instruction states how, when and where to pay | met | One Airi mandate per purchase, built only from the CFO-signed terms: merchant, URL, country, total, currency, items (`src/airi/client.ts:161-173`). Above the limit the CFO signs the terms with Face ID first (`src/airi/purchase.ts:117`). |
| 9 | Get the payment credential only after checking it against the instruction | met | The executor checks the approved terms hash before the mandate and again before the credential (`src/airi/purchase.ts:258`, `src/airi/purchase.ts:335`). vic-3 also reads the hash back from Airi's mandate before asking for the credential (`src/airi/vic3.ts:5-7` on `vic-3-1112`). |
| 10 | Report the transaction outcome back (completed, failed, delivered) | partly | The checkout's result is reported to Airi after every submitted checkout, SUCCEEDED or DECLINED, and retried by recovery if the report fails (`src/airi/purchase.ts:397-409`). A purchase stopped before the checkout cancels its mandate instead (`src/airi/purchase.ts:284-290`). Delivery is not reported: `airi-cli` documents only SUCCEEDED, CANCELLED and DECLINED (`src/airi/client.ts:17`). |
| 11 | Register the agent with Visa (agent onboarding) | partly | Purser signs each agent checkout with a Trusted Agent Protocol signature in the shape of Visa's reference proxy (`src/visa/tapSig.ts:1-9`). No agent is registered with Visa itself: that step is Airwallex's in this setup. |
| 12 | The agent never handles raw card data | partly | The card number Purser types into the hosted page is Airi's single-use tokenised number (DPAN), not a PAN, and it lives in memory for one request (`src/airi/credential.ts:1-8`). The page is filled by Purser's code in a headless browser, not by the model. It is still card data inside our process, which a network token flow through a payment processor would avoid. |
| 13 | A server refuses a replayed credential (single use per challenge) | met | Each order has its own reference (fix 2016aac after a `duplicate_request`, `docs/runs/2026-11-07-vic-1.md`, attempt 3). vic-3 tests a reused credential against Airi and the Airwallex sandbox and records whatever they answer (`src/airi/vic3.ts:12-17` on `vic-3-1112`). Purser's own x402 endpoint refuses a replayed nonce (`worker/src/x402.ts`). |
| 14 | Amounts as strings in the smallest unit; ISO currency codes | met for Airi; n/a for MPP | Airi takes two-decimal amounts and three-letter codes, checked before the call (`src/airi/client.ts:166-168`). Purser has no MPP card-charge server. |

## Fixes

Made in this stream:
- None to the VIC code. The review found no small gap that a code change here closes: the partly rows depend on what
  `airi-cli` and the Airwallex sandbox offer.

## Not done

- **Report delivery to Visa (10).** Needs a delivery result in `airi-cli`; it documents none today.
- **Visa's MCP route (6) and agent registration with Visa (11).** Both mean a direct Visa Developer Platform account
  with its own credentials, which this project does not have. Larger than this stream.
- **Keep card data out of our process (12).** Needs a processor-side network token flow instead of typing the
  tokenised number into a hosted page. Larger than this stream.
