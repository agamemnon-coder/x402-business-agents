# Purser: independent Metal QA, afternoon (Kit 11, Metal Award)

Reviewer: independent, read-only. Date: 1 November 2026. Project: this repository.
Scope: every Kit 11 brief sentence and every Metal feature Purser uses, re-proved from this week's autonomous dry runs
(dry-97 to dry-103, all on 1 November 2026, each a fresh world on Metal testnet and the Airwallex sandbox).

## How this was checked

- **Ledgers.** dry-97 … dry-103 were copied read-only (better-sqlite3 `{readonly:true, fileMustExist:true}`, `VACUUM INTO`) to
  scratch copies; only the copies were queried. dry-104 and kit11 were not touched. Nothing in the repo was edited.
- **Chain, read-only.** Receipts were read with viem `getTransactionReceipt` against `METAL_RPC_URL` (value never printed).
  **112 receipts read:** 91 hashes from the seven dry worlds (every account create, funding, mandate bind, refund, sweep and
  recorded refusal, plus the latest sale and upstream purchase per world): **91 of 91 `success`**. 21 hashes cited by the docs
  from 29 Oct to 1 Nov: 18 `success`, 3 `reverted` exactly where the docs say they revert (four-eyes CFO alone, compliance replay,
  passkey CFO alone; these are the proofs).
- **Decoded on chain.** The three refusals the agents recorded (dry-100, dry-101, dry-103) each hold one `MandateRefused(ref, to,
  l3aDigest, agentKey, amount, reason)` log (topic `0x4084f1f1`), emitted by the business account: `ref` = the sourcing mandate in
  the audit row, `to` = Stockline, `amount` = 0.04, `reason` = 8. Nothing else in the transaction (no transfer). Four-eyes'
  `0xda8acb12…` decodes to the same reason 8 (cap); `0xf97bcade…` to reason 2 (revoked).
- **Mandate state, read-only** (`readMandateState`, metal-pay 0.3.4): dry-103 sourcing bound at 11811239, not revoked, spent 0.66 in
  23 payments (ledger: 3 × 0.02 + 20 × 0.03 = 0.66, 23 purchases); dry-103 customer spent 1.15 in 23 (ledger: 23 sales × 0.05);
  dry-101 and dry-100 sourcing 0.69 in 24 (ledger matches).
- **Facilitator `/settlements`, read-only (public).** dry-103: 23 settlements to Northwind, total 1.15, all from Summit; 3 to
  Stockline, total 0.06, so no 0.04 purchase ever settled.
- **Rule for ✅:** a live proof from 26 Oct to 1 Nov with a concrete hash or audit row. Proof only in a run log, tests only, or
  partial gives 🟠. Claimed but untrue gives ❌. Explorer base: `https://testnet.metalntwx.com/tx/<hash>`.
- **"Autonomous worlds"** = dry-97 … dry-103 (`KIT11_AGENTS=on KIT11_AUTONOMY=on`, virtual passkeys, real Claude). dry-103 (09:54–10:05 UTC)
  is not yet in any run doc; dry-97 to dry-102 are in `docs/runs/2026-11-01-autonomy-dry-96-97.md`.

## Counts

| Section | ✅ | 🟠 | ❌ |
|---|---|---|---|
| 1. Kit 11 brief, sentence by sentence (34 rows) | 30 | 4 | 0 |
| 2. Metal features, latest live proof this week (27 rows) | 21 | 6 | 0 |
| 3. Versions (10 rows) | 8 | 2 | 0 |
| **Total** | **59** | **12** | **0** |

Morning QA, same sections: §1 29 / 5 / 0, §2 15 / 5 / 0, §3 3 / 0 / 0. Section 2 now has 27 rows instead of 20, so its
numbers do not compare directly. See "Compared with the morning QA" below.

---

## 1. Kit 11 brief, sentence by sentence

World: dry-103 unless stated (business account `0xf673…008c`, customer Summit `0xA5A1…C34c`, Stockline `0xBf53…3188`), 1 Nov 2026.

| Brief sentence | Status | Proof (link or audit row) | World / date | Note |
|---|---|---|---|---|
| "You run a data business. Customers' agents buy market data from you per query, paying into your Metal account and signing each order they pay for." | ✅ | Sale #23 [`0xc736b29d…a924`](https://testnet.metalntwx.com/tx/0xc736b29d41cb6f296a0b2a71a1c3148e48164b458d656a95ae34f6ed3728a924): 0.05, offer `signedOffer: required`, `resource: GET /v1/stock`; 23 of 23 sales carry `signed_offer`, `tx_hash`, `body_sha256` | dry-103, 1 Nov 10:04 | /settlements: 23 = 1.15 |
| "Three agents of yours draw on that account, each under its own mandate, limits your account enforces on chain" | ✅ | Binds on principal `0xf673…`: sourcing [`0xba17181a…4d19`](https://testnet.metalntwx.com/tx/0xba17181a61df978caa23e49cc80906913f59bab2059f23e424458a5347ec4d19), support [`0xbf102c58…8edf`](https://testnet.metalntwx.com/tx/0xbf102c580d973ebb478da5eea50e37f23eb0ee0f34f0e57ec2cb03c008a88edf), treasury [`0x2c2f1fa5…9e1b`](https://testnet.metalntwx.com/tx/0x2c2f1fa5ce4b63efbfbac31217947cb45f0d9223429d7ad10a1ea128c8929e1b) (audit #14, #16, #17) | dry-103, 1 Nov 09:55 | Same in all 7 worlds (28 binds, all `success`) |
| "a sourcing agent buys the upstream data" | ✅ | Upstream #28 [`0xf8034e6c…1e1d`](https://testnet.metalntwx.com/tx/0xf8034e6cbfbd11723bc57c1a2bf982e8d92329753e3b75e83a5544d14e291e1d) (Ridgeline 0.03, the mandate's second payee); 23 paid purchases | dry-103, 1 Nov 10:04 | Sourcing agent (Haiku) chose the supplier itself |
| "a support agent refunds customers" | ✅ | refund-5 [`0xe4c34b9f…ff2d`](https://testnet.metalntwx.com/tx/0xe4c34b9faf726e898a2eb6f8d302e3a6d8975b36d81e206ecdfd26453b6fff2d), refund-8 [`0x8d5430f7…1393`](https://testnet.metalntwx.com/tx/0x8d5430f7f9e45972b01903e84fd2d744689cc8f9d52f404d23a467afabb61393), refund-10 [`0xd288df0a…20a1`](https://testnet.metalntwx.com/tx/0xd288df0a0fc281f051796e2768ce8d5f98f66c742aacdc509550815aa29420a1): 0.05 each to Summit (audit #134, #136, #140) | dry-103, 1 Nov 10:01 | Support agent (Sonnet) decided; 7 others escalated to the CFO |
| "a treasury agent watches their spending, moves earnings to Airwallex" | ✅ | Sweep `sweep-20261101-1` [`0x92211f16…9e4f`](https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f) 0.09; decided by the Treasury agent (Opus), audit #70 "Swept the 0.09 net earnings…" | dry-103, 1 Nov 09:57 | Morning: treasury was code in the recorded run; now an agent |
| "…and pays a monthly licence fee invoiced in euros" | ✅ | Airwallex transfer `6b7ebec3-e3c7-…` EUR 240.00 SWIFT, PAID, fee EUR 13.48 (audit #177–#179); P-0003 planned by Treasury, approved with the (virtual) CFO passkey | dry-103, 1 Nov 10:03 | Was 🟠. Dry run, virtual passkey, not the recorded run with Max. Not a Metal rail. One month only |
| "You simulate the customer, its agent and the upstream provider too." | ✅ | Customer mandate [`0x8e27fbf4…fbae`](https://testnet.metalntwx.com/tx/0x8e27fbf49f27a12477990fc6c285483e4378aa51f5e16e087313cc0acfd7fbae): cap 0.10, budget 5.00, payee Northwind (audit #22); customer account [`0xe662b652…3ba2`](https://testnet.metalntwx.com/tx/0xe662b65208936096cef39c4e3c1968ca963d0b57b0359a5190e33c98f2a63ba2) | dry-103 | |
| "Let your three agents spend 20 *USDZ between them: sourcing 10 … at most 3 cents a purchase, support 4, treasury 6." | ✅ | Audit #14 (0.03 / 10.00), #16 (0.10 / 4.00), #17 (6.00 / 6.00); funding 20.00 [`0x00fefc99…fbef`](https://testnet.metalntwx.com/tx/0x00fefc993f25e4f214367f8529c7683c9340539de9fb4205806f1ae1f2b0fbef) (#13) | dry-103 | `policy.ts:8-14` |
| "A query sells for 5 cents and its upstream data costs 2 cents." | ✅ | Sale [`0xc736b29d…a924`](https://testnet.metalntwx.com/tx/0xc736b29d41cb6f296a0b2a71a1c3148e48164b458d656a95ae34f6ed3728a924) 0.05; Stockline purchase #3 [`0x7130c869…aa6d`](https://testnet.metalntwx.com/tx/0x7130c869e6b92074befcdb247ef1e299a1b915f595600dab1df03c80be27aa6d) 0.02 | dry-103 | `policy.ts:28,30` |
| "Then the upstream price rises to 4 cents, above the sourcing agent's 3-cent cap, so its next purchase is refused." | ✅ | Audit #42 `upstream.refused` seq 4 (`refused_by: purser`, before signing); audit #52 `upstream.refused_on_chain`: Metal's own refusal [`0xd24cb5a7…6acc`](https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc), `MandateRefused` reason 8, 0.04 to Stockline. Also dry-101 [`0x3ea88238…be03`](https://testnet.metalntwx.com/tx/0x3ea88238d02726a8eeb129214b4b57e233fdfec76418e2995d9062a91654be03), dry-100 [`0x88bacab0…ec25`](https://testnet.metalntwx.com/tx/0x88bacab033145185b3d1f671695d569d24035a23de4193c1d08b5a8879d7ec25) | dry-103 09:57; dry-101 08:00; dry-100 07:44 | Was 🟠. Purser still refuses first; Metal's record comes from `mandate pull --record-refusal`, not from the purchase. In dry-97/98/99/102 the agent switched supplier before any 0.04 purchase, so no refusal there |
| "The treasury agent proposes new limits within the 20 *USDZ … and you approve them by replacing the mandates." | ✅ | Friday run 1: treasury 6.00 → 4.00 [`0x2909b164…8aed`](https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed), sourcing 0.04 / 12.00 [`0xbc70858f…b5d7`](https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7) (both receipts `success`) | Northwind, 30 Oct | **No replace in any autonomous world:** in 7 of 7 the Treasury agent chose not to rebalance (supplier switch kept a 0.02 margin). Proposal came from code on 30 Oct |
| "A customer disputes a batch … The signed orders show its agent did place them." | ✅ | Dispute `D-2f8a03a4`: `verifyMandatePayment` "all steps pass" for every disputed sale, e.g. sale 5 [`0x70ea7081…22a6`](https://testnet.metalntwx.com/tx/0x70ea7081a4c82b998560d38a4ddfabbfd59a03cf136e117129b15cc6b00d22a6), mandate bound tx [`0x8e27fbf4…fbae`](https://testnet.metalntwx.com/tx/0x8e27fbf49f27a12477990fc6c285483e4378aa51f5e16e087313cc0acfd7fbae); audit #146 | dry-103, 1 Nov 10:02 | #6 and #12 never sold: listed, nothing refunded |
| "Where you judge the data you sold was wrong, the support agent refunds the charge from its budget." | ✅ | refund-5/8/10 above; verdicts on_hand 343 vs 93 etc. | dry-103 | Support spent 0.15 of 4.00 |
| "Keep prices, budgets and the licence fee in code, and let the model weigh the rest." | ✅ | `src/config/policy.ts` (2000, 3/1000, 10/400, 600/600, 5, 2, 24000); binds #14–#22 and transfer EUR 240.00 equal those constants | dry-103 | |
| Flow: create mandates … signed-order route … sell … raise price and show the refusal … replace the mandates … resolve the dispute … move earnings to Airwallex and pay the licence fee | 🟠 | dry-100, dry-101, dry-103 run every step **except "replace the mandates"**; Friday run 1 (30 Oct) runs every step except the licence fee | 30 Oct / 1 Nov | No single world this week ran the whole flow |
| Endpoint `metal-agent account create` | ✅ | Business account [`0x6f78e7f8…447e`](https://testnet.metalntwx.com/tx/0x6f78e7f8f0c20903733f427abe41a677c66834a0811c78277a80a0444b32447e) (`metal_accounts.created_tx`) | dry-103 | 14 account creates in 7 worlds, all `success` |
| Endpoint `mandate credential create` | ✅ | Sourcing credential ref `0xaf370e5c…edaa` (audit #52) is bound on chain: `readMandateState` boundBlock 11811239 | dry-103 | Offline command, no tx of its own |
| Endpoint `bind` | ✅ | [`0xba17181a…4d19`](https://testnet.metalntwx.com/tx/0xba17181a61df978caa23e49cc80906913f59bab2059f23e424458a5347ec4d19), [`0xbf102c58…8edf`](https://testnet.metalntwx.com/tx/0xbf102c580d973ebb478da5eea50e37f23eb0ee0f34f0e57ec2cb03c008a88edf), [`0x2c2f1fa5…9e1b`](https://testnet.metalntwx.com/tx/0x2c2f1fa5ce4b63efbfbac31217947cb45f0d9223429d7ad10a1ea128c8929e1b), [`0x8e27fbf4…fbae`](https://testnet.metalntwx.com/tx/0x8e27fbf49f27a12477990fc6c285483e4378aa51f5e16e087313cc0acfd7fbae) | dry-103 | |
| Endpoint `replace` | ✅ | [`0x2909b164…8aed`](https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed), [`0xbc70858f…b5d7`](https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7) | Northwind, 30 Oct | Not in autonomous worlds |
| Endpoint `pull` (a `--payment-id` per refund) | ✅ | `refund-5` [`0xe4c34b9f…ff2d`](https://testnet.metalntwx.com/tx/0xe4c34b9faf726e898a2eb6f8d302e3a6d8975b36d81e206ecdfd26453b6fff2d); `sweep-20261101-1` [`0x92211f16…9e4f`](https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f) | dry-103 | |
| Endpoint `verify` | 🟠 | Only the run log says "`npm run verify` passes" (dry-97 to dry-102); no output or audit row in any ledger | 1 Nov | Morning ✅ (log only); 🟠 under this review's evidence rule |
| `requireSignedOffer`, `SIGNED_OFFER_REQUIRED` with the route as its resource | ✅ | Sale #23 `requirements_json.extra`: `signedOffer: "required"`, `resource: "GET /v1/stock"`; [`0xc736b29d…a924`](https://testnet.metalntwx.com/tx/0xc736b29d41cb6f296a0b2a71a1c3148e48164b458d656a95ae34f6ed3728a924) | dry-103 | |
| `signedOfferOf` and `verifyMandatePayment` | ✅ | Audit #110–#119 (10 rows) `verify_order` tool rows ("signed order yes, within the customer's mandate yes"); dispute evidence | dry-103 | |
| Airwallex `POST /simulation/deposit/create`, `GET /deposits` | ✅ | Audit #64 `credit.deposited`: deposit `05090865-c8c8-…` 0.09 USD, `reference` = [`0x92211f16…9e4f`](https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f) | dry-103 | Sandbox deposit, simulated as the kit says |
| FX, beneficiary, transfer calls of kit 1 | ✅ | Beneficiary `46c2bbca-…`, transfer `6b7ebec3-…` PAID (audit #177) | dry-103 | No FX in the autonomous worlds (paid from EUR held); FX last on 30 Oct (`08736b6e…`) |
| "Keep owner keys away from agents … own mandate and the mandate key `credential create` writes beside it" | ✅ | Every bind has actor `owner-signer`; each agent pays with its own mandate key | dry-103 | Owner key still on the runner host (morning §4.11) |
| "Nothing stores signed orders. Keep each one … with its transaction hash and what you delivered" | ✅ | `sales`: 23 of 23 with `signed_offer`, `tx_hash`, `body_sha256`, `requirements_json` | dry-103 | |
| "Hold the 20 in code. A replacement carries what the agent spent, so its budget must exceed that." | ✅ | Binds sum to 20.00 (#14, #16, #17); replace on 30 Oct: sourcing 12.00 > 0.80 spent ([`0xbc70858f…b5d7`](https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7)) | 1 Nov / 30 Oct | |
| "Create it with `--mandate-key-file` … the old credential is refused as revoked." | ✅ | On-chain `MandateRefused` reason 2 (revoked): [`0xf97bcade…f98d`](https://testnet.metalntwx.com/tx/0xf97bcade4a83d7a23198660bee37e1c84d72d6da153eaf6d49f39cd8f542f98d) | four-eyes world, 30 Oct | Not in autonomous worlds; Friday run 1 log only |
| "Mandates pay whole cents only." | ✅ | All amounts whole cents (0.02, 0.03, 0.05, 0.09, 0.04); `pay.ts` rounds up | dry-103 | |
| "A purchase over its cap moves nothing and comes back as a 402 naming the reason. When … refused, answer the customer with an error status: the middleware then doesn't settle." | 🟠 | Moves nothing: [`0xd24cb5a7…6acc`](https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc) has only `MandateRefused`, no transfer. Customer not charged: on chain 23 payments = 23 sales; /settlements has 23. **But no 402:** Purser aborts before signing (`holds.ts`), so the facilitator's 402 never arrives | dry-103 | Better than this morning (Metal now names the reason on chain), but the 402 path the brief names is not exercised |
| "A timeout is unconfirmed. For a payout, rerun the same `mandate pull`, which pays at most once." | ✅ | Audit #147 `refund.already_paid`: a second live `mandate pull --payment-id refund-5`, metal-agent answered "already paid, nothing sent" | dry-103, 10:02 | Same in all 7 worlds |
| "For a purchase, look it up in the facilitator's `/settlements` before paying again." | 🟠 | **Tests only.** `upstream_purchases.outcome = IN_DOUBT`: 0 in all 7 worlds | — | Unchanged |
| "The Airwallex sandbox can't receive stablecoins. Send earnings to a Metal address you hold, mark the hash credited, simulate a deposit … with the hash as its `reference`." | ✅ | Sweep [`0x92211f16…9e4f`](https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f) → `credit.locked` `63825:0x92211f16…:1`, block 11812824, final 11812833 (#59) → deposit with reference = tx (#64) | dry-103 | Also dry-100/101/102: [`0x91e21e8e…5253`](https://testnet.metalntwx.com/tx/0x91e21e8e250c56b08b76cfde25e3495f47ef208f389615e91d5e9728a92a5253), [`0x74cfedf1…a791`](https://testnet.metalntwx.com/tx/0x74cfedf135e7ef33cfa02bb9f1bc35beb5a2af645d81d6e6d9614af5bb9ca791), [`0x768374fa…1346`](https://testnet.metalntwx.com/tx/0x768374fa011243686d14fdf3ab03089b3326be74dc15df7c9bf486d144b51346) |

---

## 2. Metal features: latest live proof this week (26 Oct – 1 Nov)

| Feature | Status | Proof (link or audit row) | World / date | Note |
|---|---|---|---|---|
| Smart accounts (`account create`) | ✅ | [`0x6f78e7f8…447e`](https://testnet.metalntwx.com/tx/0x6f78e7f8f0c20903733f427abe41a677c66834a0811c78277a80a0444b32447e) | dry-103, 1 Nov | |
| *USDZ funding into the business account (20.00) | ✅ | [`0x00fefc99…fbef`](https://testnet.metalntwx.com/tx/0x00fefc993f25e4f214367f8529c7683c9340539de9fb4205806f1ae1f2b0fbef) (audit #13) | dry-103, 1 Nov | |
| Mandate credential create | ✅ | Ref `0xaf370e5c…edaa` bound (readMandateState) | dry-103, 1 Nov | Offline; no tx |
| Mandate bind | ✅ | [`0xba17181a…4d19`](https://testnet.metalntwx.com/tx/0xba17181a61df978caa23e49cc80906913f59bab2059f23e424458a5347ec4d19) (sourcing, two payees), [`0x8e27fbf4…fbae`](https://testnet.metalntwx.com/tx/0x8e27fbf49f27a12477990fc6c285483e4378aa51f5e16e087313cc0acfd7fbae) (customer) | dry-103, 1 Nov | 28 binds in 7 worlds, all `success` |
| Mandate replace | ✅ | [`0x2909b164…8aed`](https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed), [`0xbc70858f…b5d7`](https://testnet.metalntwx.com/tx/0xbc70858fef5ca185cb8dffb860becac2fe0876888aa5ea57d8aee2700449b5d7) | Northwind, 30 Oct | Not in any autonomous world |
| Mandate revoke (explicit) | ✅ | [`0xc82912c3…b8cd`](https://testnet.metalntwx.com/tx/0xc82912c30de9c996cb2b397989c1518e38ff3a32824c2e1a39b2d83d00bdb8cd) (passkey-owners account), [`0xb1723632…6d4b`](https://testnet.metalntwx.com/tx/0xb1723632242a7951136860c69baa46561c0d7d637b73196d98b6a051037e6d4b) (four-eyes, 2-of-2) | 1 Nov / 30 Oct | Separate test accounts |
| Old credential refused (`mandate_revoked`) on chain | ✅ | [`0xf97bcade…f98d`](https://testnet.metalntwx.com/tx/0xf97bcade4a83d7a23198660bee37e1c84d72d6da153eaf6d49f39cd8f542f98d): `MandateRefused` reason 2 | four-eyes, 30 Oct | Not in autonomous worlds |
| x402 `exact` under a mandate (`createMandatePaymentClient`) | ✅ | Purchase [`0xf8034e6c…1e1d`](https://testnet.metalntwx.com/tx/0xf8034e6cbfbd11723bc57c1a2bf982e8d92329753e3b75e83a5544d14e291e1d); sale [`0xc736b29d…a924`](https://testnet.metalntwx.com/tx/0xc736b29d41cb6f296a0b2a71a1c3148e48164b458d656a95ae34f6ed3728a924) | dry-103, 1 Nov | Chain spent = ledger (0.66 / 23; 1.15 / 23) |
| Metal refuses over cap, recorded on chain (`mandate_cap_exceeded`, `--record-refusal`) | ✅ | [`0xd24cb5a7…6acc`](https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc) (audit #52), [`0x3ea88238…be03`](https://testnet.metalntwx.com/tx/0x3ea88238d02726a8eeb129214b4b57e233fdfec76418e2995d9062a91654be03), [`0x88bacab0…ec25`](https://testnet.metalntwx.com/tx/0x88bacab033145185b3d1f671695d569d24035a23de4193c1d08b5a8879d7ec25): `MandateRefused` reason 8, amount 0.04, to Stockline | dry-103 / 101 / 100, 1 Nov | Was 🟠. These hashes are linked in no doc yet |
| Signed orders (`requireSignedOffer`, `signedOfferOf`) | ✅ | 23 of 23 sales signed; [`0xc736b29d…a924`](https://testnet.metalntwx.com/tx/0xc736b29d41cb6f296a0b2a71a1c3148e48164b458d656a95ae34f6ed3728a924) | dry-103, 1 Nov | |
| `verifyMandatePayment` | ✅ | Dispute `D-2f8a03a4` evidence, audit #110–#119 (10 rows) | dry-103, 1 Nov | |
| Mandate pulls with payment ids (refunds) | ✅ | `refund-5` [`0xe4c34b9f…ff2d`](https://testnet.metalntwx.com/tx/0xe4c34b9faf726e898a2eb6f8d302e3a6d8975b36d81e206ecdfd26453b6fff2d), `refund-8` [`0x8d5430f7…1393`](https://testnet.metalntwx.com/tx/0x8d5430f7f9e45972b01903e84fd2d744689cc8f9d52f404d23a467afabb61393), `refund-10` [`0xd288df0a…20a1`](https://testnet.metalntwx.com/tx/0xd288df0a0fc281f051796e2768ce8d5f98f66c742aacdc509550815aa29420a1) | dry-103, 1 Nov | |
| Pull idempotency (same payment id pays once) | ✅ | Audit #147 `refund.already_paid` (live re-pull) | dry-103, 1 Nov | |
| Sweep pull under the treasury mandate | ✅ | `sweep-20261101-1` [`0x92211f16…9e4f`](https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f) | dry-103, 1 Nov | Agent-decided |
| `metal-agent mandate verify` / `npm run verify` | 🟠 | Run log statements only (dry-97 … dry-102) | 1 Nov | No output kept per run |
| Mandate state read from chain (`readMandateState`, dashboard-vs-chain) | ✅ | Credential `0xaf370e5c…`: bound 11811239, spent 0.66 = ledger (read by this review) | dry-103, 1 Nov | The project's own check is a run-log statement (dry-99 to dry-102) |
| Facilitator `/settlements`: customer not charged after a refusal | 🟠 | No audit row shows Purser querying it this week. This review queried it: 23 settlements = 23 sales, none at 0.04 to Stockline | dry-103 | Fact confirmed; Purser's use not evidenced |
| Facilitator in-doubt lookup by nonce | 🟠 | Tests only; 0 `IN_DOUBT` in 7 worlds | — | |
| Clearing (`bajillion`: deposit, receipts, withdraw, claim) | ✅ | Deposit [`0x055ba899…6766`](https://testnet.metalntwx.com/tx/0x055ba89987f658cb038fcbd1660f4d9e98e78e4c44c86c5346946f8cca1a6766), queue [`0x902badf6…c3d4`](https://testnet.metalntwx.com/tx/0x902badf6f82f4e453c99ff9e5fd870d3e96ab40293bff64e3a611014930cc3d4), claim 0.70 [`0x522470d2…5092`](https://testnet.metalntwx.com/tx/0x522470d292f78b390fe153cb40905cdc6102afef1345d62e1dc975f900145092) | rehearsal-3 world, 29 Oct | Not in autonomous worlds (0 `clearing_ops`). Receipts `preconfirmed`, no `finalizedCount` watch |
| Receive policy and quarantine | ✅ | Setup [`0xf1a7fe96…0c37`](https://testnet.metalntwx.com/tx/0xf1a7fe9664053c9d2fdf1b2d11122bde5be0668da8afc8d4f17b08088e220c37), held [`0x9076343b…20d3`](https://testnet.metalntwx.com/tx/0x9076343b01ba60809fad1a25c4f8dfa91bfaa15ffec45f55946ceea4e15e20d3), returned after Face ID [`0x786686b6…fc3c`](https://testnet.metalntwx.com/tx/0x786686b6dd5112b80bbf84902c8b51f407459c3e3112a6a3d8a0e23bac60fc3c) | b1 world, 30 Oct | Not in autonomous worlds (0 `quarantines`, no setup row) |
| 2-of-2 account (EOA owners) | ✅ | CFO alone reverted [`0xe0976c5a…69c3`](https://testnet.metalntwx.com/tx/0xe0976c5a0ad7ebe51ed0bc9564b2f366fd141b6ba24a55b09fe71ea23e2269c3); both signed, paid [`0xd98e94ff…d30d`](https://testnet.metalntwx.com/tx/0xd98e94ffa3c859de037f944322b05c0f3a097f45780dbd1b8ec9d4689961d30d) | four-eyes, 30 Oct | Separate account; Northwind threshold 1 |
| Passkey owners (ERC-7913 WebAuthn verifier) | 🟠 | Verifier [`0x732c0e92…691c`](https://testnet.metalntwx.com/tx/0x732c0e92568a6578c7179773579a0adfba0d8d80d6387ddd7cd9e39159c3691c), account [`0xe7c0f526…d15d`](https://testnet.metalntwx.com/tx/0xe7c0f5264ae55adad87163e60c7598cb8057faf951d1e9b1073c8c6683d8d15d), bind with both [`0x96850ad4…7d5b`](https://testnet.metalntwx.com/tx/0x96850ad4562ae5abb370aead62e7ccd5d926d7b5d1a61b6a7aabbbbc78f17d5b), CFO alone reverted [`0x41a963a9…24de`](https://testnet.metalntwx.com/tx/0x41a963a9cb765dc98fbc98ed6e78abcb02dc1b341c4e7378dea3c1843acb24de) | passkey-owners, 1 Nov 04:51 | Software stand-in passkeys; no phone; separate account |
| Compliance send policy | ✅ | Good payment [`0xc2eb6814…f237`](https://testnet.metalntwx.com/tx/0xc2eb68144c8285a07ac6687a8f1c8085e9ee2826f8d6043663073eca2e79f237); replay reverted [`0x222385b5…2737`](https://testnet.metalntwx.com/tx/0x222385b575d3b143e462e1146bd37d556fd263a6aa87f264fce9721b63232737) | compliance world, 30 Oct | Agents' mandate payments bypass it (disclosed) |
| Finality certificates (`metal_getFinalityCertificate`) | 🟠 | 50 stored in dry-103, all `REPORTED`, header/number/quorum 3 of 4 checked, e.g. sweep block 11812824 | dry-103, 1 Nov | BLS not verified (no testnet validator keys). Now in an autonomous world |
| Finality gate on the sweep | ✅ | `credit.locked` block 11812824 → final 11812833 (#59), key `chainId:tx:logIndex` | dry-103, 1 Nov | |
| Sweep to Airwallex (deposit with tx as reference) | ✅ | Deposit `05090865-…` reference [`0x92211f16…9e4f`](https://testnet.metalntwx.com/tx/0x92211f16a88249a8f88e70207602f645e76e520c2ddf9d34e2facc1d41ea9e4f) (#64) | dry-103, 1 Nov | Simulated sandbox deposit |
| "CFO changes on-chain limits with Face ID" | 🟠 | No mandate change in the autonomous worlds; on 30 Oct the owner key signed [`0x2909b164…8aed`](https://testnet.metalntwx.com/tx/0x2909b164c50779c342783309943901472cf1c966402c550d0d28f5ab86a08aed) after an off-chain passkey | 30 Oct | Chain never sees the Face ID |

---

## 3. Versions and changelogs

`package-lock.json` versions against the npm registry (`npm view <pkg> version time dist-tags --json`, 1 Nov 2026):

| Package | Status | Pinned (lock) | Latest on npm (published) | Newer? |
|---|---|---|---|---|
| `@metalntwx/metal-agent` (CLI) | ✅ | 0.3.3 | 0.3.3 (23 Oct) | No. `dist-tags` only `latest` |
| `@metalntwx/metal-pay` | ✅ | 0.3.4 | 0.3.4 (27 Oct) | No |
| `@metalntwx/metal-ts` | ✅ | 0.3.2 | 0.3.2 (15 Oct) | No |
| `@x402/core` | ✅ | 2.29.0 | 2.29.0 (28 Oct) | No |
| `@x402/evm` | ✅ | 2.29.0 | 2.29.0 (28 Oct) | No |
| `@x402/express` | ✅ | 2.29.0 | 2.29.0 (28 Oct) | No |
| `@x402/fetch` | ✅ | 2.29.0 | 2.29.0 (28 Oct) | No |
| `@x402/extensions` | ✅ | 2.29.0 | 2.29.0 (28 Oct) | No |
| `metal-agent`'s own `@metalntwx/metal-pay` (nested) | 🟠 | 0.3.3 (`node_modules/@metalntwx/metal-agent/node_modules/…`) | 0.3.4 | The CLI pins `metal-pay` 0.3.3 exactly, so bind, replace, pull, `--record-refusal` and verify run on 0.3.3, while Purser's library code runs on 0.3.4. Not mentioned in the morning QA or in metal-award.md |
| `overrides` in package.json | 🟠 | `@x402/*` → 2.29.0; `@metalntwx/metal-agent` → `zod` 4.6.7 | — | metal-agent 0.3.3 declares `@x402/core` 2.28.0 and `zod` ^3.25.76. It runs with x402 2.29.0 and zod 4, a combination Metal did not ship. It worked: every CLI call this week succeeded on chain (binds, pulls, record-refusal) |

**How metal-agent is invoked.** `src/metal/agentCli.ts` spawns `node_modules/.bin/metal-agent <args> --network testnet` with
`HOME` set inside the keys directory and output scrubbed of secrets. `npm run verify` is `tsx src/cli/verify.ts`, which shells out
to the same binary. `metal-agent --version` (run with `METAL_RPC_URL` unset) prints `0.3.3`.

**Changelogs.**
- npm: none of the eight packages ships a CHANGELOG. The x402 release notes on GitHub (`coinbase/x402`) could not be read from
  this session (GitHub access not enabled for that repository). Pinned = latest, so no newer x402 release exists to assess.
- Metal docs changelog (`https://docs.metalntwx.com/changelog.md`, read 1 Nov):
  - **19 Oct 2026:** a credit refused by a receive policy now **reverts by default** (`CreditRefused(reason)`). Quarantine is opt-in
    via the new `refusal` argument of `setPolicy`. Purser passes `refusal = QUARANTINE (1)` explicitly
    (`src/metal/receivePolicy.ts:15,27`), and the 30 Oct run (after the change) quarantined as intended ([`0x9076343b…20d3`](https://testnet.metalntwx.com/tx/0x9076343b01ba60809fad1a25c4f8dfa91bfaa15ffec45f55946ceea4e15e20d3)). So it is
    compatible. A sweep wallet set up without that argument would revert unknown senders instead of holding them.
  - **Unreleased:** documentation only (Build guides reworked; "hookless MIP20 controls, refusal modes, quarantine"; smart-account
    guide aligned with the testnet SDK and factory).
  - 26–29 Sep: MIP20 hooks removed, `ReceivePolicy` genesis contract, ERC-3009 now OpenZeppelin's (custom errors), plain ERC-20
    allowances. These predate every pinned version.
- **Mandates, refusals, signed orders, clearing:** no changelog entry and no newer package version touches them. The only gap
  is the nested `metal-pay` 0.3.3 inside the CLI. The morning's diff of 0.3.3 → 0.3.4 found a clearing held-payment release fix,
  rewritten RPC-secret scrubbing and clone constants. None of these is a mandate, refusal or signed-order change. The CLI does not do clearing.

---

## 4. Compared with the morning QA

**Moved from 🟠 to ✅ because of this week's autonomous runs:**
1. **Price rise refused (§1 row 10, §2 cap refusal).** Metal's own refusal is now on chain in three worlds: [`0xd24cb5a7…6acc`](https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc), [`0x3ea88238…be03`](https://testnet.metalntwx.com/tx/0x3ea88238d02726a8eeb129214b4b57e233fdfec76418e2995d9062a91654be03),
   [`0x88bacab0…ec25`](https://testnet.metalntwx.com/tx/0x88bacab033145185b3d1f671695d569d24035a23de4193c1d08b5a8879d7ec25), decoded `MandateRefused` reason 8 for 0.04 to Stockline. Morning: audit-row-only refusal, no transaction.
2. **Licence fee (§1 row 6).** Paid in dry-100 to dry-103 after a Treasury plan and passkey approval: dry-103 transfer `6b7ebec3-…`
   EUR 240.00 PAID. Morning: no live run with ids.
3. **Explorer limitation.** The morning confirmed zero transactions. This review read 112 receipts (91 of 91 dry-world hashes
   `success`) and decoded the refusal events.
4. **Treasury sweep by an agent.** Morning ✅ with "the treasury agent is code"; now the Opus agent decided it (dry-100 to dry-103).
5. **Finality certificates** now come from an autonomous world (50 in dry-103), not only the four-eyes and compliance worlds. Still 🟠 (BLS).

**Moved from ✅ to 🟠, because of this review's stricter evidence rule (not a regression):** `verify` (§1, §2) and the
`/settlements` customer-not-charged check (§2). Both are run-log statements without an audit row or stored output. The facts
behind the second were confirmed independently.

**Still 🟠, unchanged:** the whole brief flow in one world; the facilitator's 402 path (Purser aborts first); the in-doubt
`/settlements` nonce lookup (tests only); finality BLS; passkey owners as stand-ins; Face ID not enforced on chain.

**New 🟠:** the CLI's nested `metal-pay` 0.3.3, and the dependency overrides (zod 4, x402 2.29.0) under metal-agent 0.3.3.

**Still proven only in separate worlds (not in any autonomous run):** replace, explicit revoke, `mandate_revoked` on chain,
clearing, receive policy, 2-of-2, passkey owners, compliance send policy.

---

## 5. Still open, in priority order

1. **No mandate replace in any autonomous world.** In 7 of 7, the Treasury agent judged a rebalance unnecessary, so the brief's
   "approve them by replacing the mandates" and the `mandate_revoked` refusal rest on 30 Oct (Friday run 1, code-proposed) and the
   four-eyes world. Add a world event that forces it (for example, Ridgeline stops offering), then record one agent-proposed replace
   and the old credential's refusal.
2. **Link the new on-chain refusals and fix the wording.** [`0xd24cb5a7…6acc`](https://testnet.metalntwx.com/tx/0xd24cb5a7a8219c69783420d9d14bdbdab188d9e2a46b6aab9aa8798adf496acc) (dry-103), [`0x3ea88238…be03`](https://testnet.metalntwx.com/tx/0x3ea88238d02726a8eeb129214b4b57e233fdfec76418e2995d9062a91654be03), [`0x88bacab0…ec25`](https://testnet.metalntwx.com/tx/0x88bacab033145185b3d1f671695d569d24035a23de4193c1d08b5a8879d7ec25) appear in no doc, page or
   `/metal` card. metal-award "Why this wins" still says Metal refused the payment. Accurate: "Purser refused before signing; Metal's
   mandate recorded its own refusal on chain (`MandateRefused`, reason 8)". Write up dry-103 in the run log.
3. **No single world ran the whole Kit 11 flow this week.** dry-100/101/103 lack the replace; Friday run 1 lacks the licence fee.
   Fixing item 1 in an autonomous world closes this too.
4. **Face ID and four eyes are not on Northwind's account.** Passkey owners exist only with software stand-ins on a separate account.
   The owner key signs every mandate change after an off-chain passkey.
5. **Keep evidence per run.** Store `npm run verify` output, the dashboard-vs-chain result and a `/settlements` check as audit
   rows or JSON. Today they are run-log lines. The in-doubt nonce lookup is still tests only.
6. **Finality certificates: BLS not verified.** They need the testnet validator keys from Metal.
7. **Clearing and the receive policy are absent from the autonomous worlds** (0 `clearing_ops`, 0 `quarantines`, no setup row).
   Clearing receipts are still treated as final while `preconfirmed`.
8. **CLI dependency drift.** metal-agent 0.3.3 runs with its own `metal-pay` 0.3.3, `zod` 4 (it declares ^3) and x402 2.29.0
   (it pins 2.28.0) through `overrides`. Disclose it in metal-award.md or ask Metal about it. No newer Metal release exists.
9. **The facilitator's 402 is never received for an over-cap purchase.** Purser's pre-sign hold aborts first. This is acceptable now
   that Metal's refusal is recorded on chain, but the docs should say so wherever they cite the 402.
