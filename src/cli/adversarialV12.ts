// npm run eval:adversarial-v12 [-- --check]: the adversarial eval v12 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v11, in v12's world: src/evals/adversarialV12.ts) over the 158 held-out cases of
// src/evals/adversarialV12Cases.ts, written after the fixes that followed eval v11 and committed alone before anything
// ran on them (V12_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no
// key, no money. The first run writes docs/evals/adversarial-v12.json and .md (held out, with v11 on the same code
// beside it); after that, the held-out record is never written again and the command writes the run on today's code
// beside it (docs/evals/adversarial-v12-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V11_CASES_COMMIT, V11_WORLD } from "../evals/adversarialV11.js";
import { ADV_V11_CASES } from "../evals/adversarialV11Cases.js";
import { V12_CASES_COMMIT, V12_HYPOTHESES, V12_WORLD } from "../evals/adversarialV12.js";
import { ADV_V12_CASES } from "../evals/adversarialV12Cases.js";

await runRound({
  version: "v12", cases: ADV_V12_CASES, world: V12_WORLD, case_file: "src/evals/adversarialV12Cases.ts", cases_commit: V12_CASES_COMMIT, hypotheses: V12_HYPOTHESES,
  on_file: "ninety-three suppliers on file (v11's eighty, and thirteen whose names are Romanian, Hungarian, Czech, Polish, Indonesian, Russian, Egyptian Arabic, Taiwanese Chinese, Greek Cypriot, Turkish, Irish English, Dutch and Vietnamese)",
  about: "thirteen new suppliers; orders, changed accounts, approval claims and pressure in languages the lists hold, worded anew, and in neighbours of them (Slovak, Frisian, Kashubian, Sundanese, Belarusian, Sicilian, Romansh); English written to avoid the words of payment, approval and checks; a reply quoted from inside the buyer; a payment link, a QR code and a new payment provider; amounts against an order in another currency, a one-invoice history and an amount in words; and hard negatives",
  previous: { version: "v11", cases: ADV_V11_CASES, world: V11_WORLD, cases_commit: V11_CASES_COMMIT },
});
